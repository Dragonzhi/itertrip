"""LLM 行程规划引擎。

优先调用 OpenAI 兼容 API（DeepSeek / OpenAI / 本地模型均可），
未配置 key 或调用失败时降级为内置 mock 规划器（Phase 1 约定：坐标可先硬编码）。

环境变量：
    ITERTRIP_LLM_API_KEY   必填才走 LLM；缺省直接 mock
    ITERTRIP_LLM_BASE_URL  默认 https://api.deepseek.com
    ITERTRIP_LLM_MODEL     默认 deepseek-chat
    ITERTRIP_AMAP_KEY      可选，高德 Web 服务 key（坐标补全 POI 兜底）

坐标系约定：LLM 生成/mock 的坐标按 WGS84 处理，plan() 出口统一转 GCJ-02
（与高德瓦片显示一致）；route JSON 内存储/流转的坐标均为 GCJ-02（见 engine/geo.py）。
"""

import copy
import json
import os
import time

import httpx

from .coordinates import (
    _AMAP_AGREE_MIN,
    _AMAP_EXACT_SCORE,
    _AMAP_MAX_DRIFT_KM,
    _AMAP_STRONG_SCORE,
    AmapSession,
    destination_anchor,
    geocode,
    geocode_amap_scored,
)
from ._llmutil import endpoint
from .geo import haversine_km, in_china, wgs84_to_gcj02
from .schema import RouteJSON

# 离谱坐标检测：偏离行程中位数中心 > 100km 视为可疑；重定位结果与原值差 > 10km 才替换
_OUTLIER_KM = 100.0
_OUTLIER_REPLACE_KM = 10.0
# M19 主动核验：高德与现有坐标偏差超过此值（且名称强匹配）才替换模型坐标
_VERIFY_KM = 1.5
# 强匹配 / 精确同名 / 候选池一致 三个阈值统一取自 coordinates（单一事实来源，避免两处漂移）
# M20 行程地理包络：紧凑行程（spread ≤ _OUTLIER_KM）里，核验只允许把点挪到
# max(spread, 50) + 此值 的范围内，防止「异地同名 POI」被当成权威坐标
_VERIFY_DRIFT_KM = 150.0

SYSTEM_PROMPT = """你是专业旅行规划师。根据用户需求生成行程 JSON。
只输出 JSON 本身，不要输出任何解释文字或 markdown 代码块标记。
JSON 结构：
{"trip": {"title": str, "destination": str, "days": int, "dates": str, "budget": str, "style": str, "travelers": str},
 "days": [{"day": int, "theme": str, "places": [{"name": str, "lat": float, "lng": float,
   "type": "attraction|food|transport|other", "time": str, "transport": str, "ticket": str, "note": str}],
   "hotel": {"name": str, "lat": float, "lng": float, "note": str, "prices": []}}],
 "summary": [str]}
要求：
1. 每天安排 3-5 个地点，lat/lng 必须是你确定知道的真实坐标（WGS84 近似即可）
2. type 只能是 attraction / food / transport / other 之一
3. summary 给 2-4 条综合建议（性价比 / 交通 / 天气等）
4. hotel.prices 留空数组——价格由用户后续手动提供
"""


def _llm_config(overrides: dict | None = None) -> dict | None:
    """解析 LLM 配置：请求头覆盖（BYOK）> 环境变量 > 内置免费供应商（.env 配置）。

    都没配置 → 返回 None（调用方降级 mock 演示模式）。
    """
    from ._llmutil import default_provider

    ov = overrides or {}
    api_key = str(ov.get("api_key") or "").strip() or os.environ.get("ITERTRIP_LLM_API_KEY", "").strip()
    if not api_key:
        # 后台管理配置（admin_config.json，可热更新）优先于 .env 免费供应商
        from .admin_config import get_provider as get_admin_provider

        admin = get_admin_provider()
        if admin:
            return admin
        # 都没配 → 尝试内置免费供应商（key 来自服务器上的 .env，不入 Git）
        return default_provider()
    base_url = str(ov.get("base_url") or "").strip().rstrip("/") or os.environ.get(
        "ITERTRIP_LLM_BASE_URL", "https://api.deepseek.com"
    ).rstrip("/")
    model = str(ov.get("model") or "").strip() or os.environ.get("ITERTRIP_LLM_MODEL", "deepseek-chat")
    return {"api_key": api_key, "base_url": base_url, "model": model}


def llm_config_with_source(overrides: dict | None = None) -> tuple[dict | None, str]:
    """在 `_llm_config` 之上补一个「配置来源」标签（M19 决策轨迹用）。

    返回 (cfg, source)，source ∈ {"byok", "env", "admin", "free", "none"}。
    cfg 的解析结果与 `_llm_config` **完全一致**（本函数只是包一层，不改行为）。
    """
    ov = overrides or {}
    from_byok = bool(str(ov.get("api_key") or ov.get("base_url") or ov.get("model") or "").strip())
    cfg = _llm_config(overrides)
    if cfg is None:
        return None, "none"
    if from_byok:
        return cfg, "byok"
    from .admin_config import resolve_active

    _, src = resolve_active()
    return cfg, (src if src in ("env", "admin", "free") else "env")


def describe_provider(cfg: dict | None, source: str) -> tuple[str, str]:
    """把 (cfg, source) 变成给人看的两段文案：模型名 + 来源说明（**绝不包含 key**）。

    返回 (model, label)，label 例：`你的 BYOK` / `服务器环境变量` / `后台配置` / `服务器免费源(.env)`。
    """
    model = str((cfg or {}).get("model") or "未配置")
    labels = {
        "byok": "你的 BYOK",
        "env": "服务器环境变量",
        "admin": "后台配置",
        "free": "服务器免费源(.env)",
        "none": "未配置",
    }
    return model, labels.get(source, source or "未知")


def _extract_json(text: str) -> dict:
    """从 LLM 回复中提取 JSON 对象（容忍 markdown 代码块与前后杂文）。"""
    text = text.strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        text = text[first_newline + 1 :] if first_newline != -1 else text.lstrip("`")
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("LLM 回复中未找到 JSON 对象")
    return json.loads(text[start : end + 1])


def _user_message(req: dict) -> str:
    rows = [
        ("目的地", req.get("destination") or "未定"),
        ("天数", req.get("days") or "未定"),
        ("出发日期", req.get("date") or "未定"),
        ("人数", req.get("travelers") or "未定"),
        ("预算", req.get("budget") or "未定"),
        ("风格", req.get("style") or "未定"),
        ("其他约束", req.get("constraints") or "无"),
    ]
    return "\n".join(f"{k}：{v}" for k, v in rows)


async def plan_with_llm(req: dict, cfg: dict | None = None) -> RouteJSON:
    cfg = cfg or _llm_config()
    if cfg is None:
        raise RuntimeError("未配置 LLM（请求头/env 均无 key）")
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            endpoint(cfg["base_url"]) + "/chat/completions",
            headers={"Authorization": "Bearer " + cfg["api_key"]},
            json={
                "model": cfg["model"],
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": _user_message(req)},
                ],
                "temperature": 0.7,
            },
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
    return RouteJSON.model_validate(_extract_json(content))


# ---------------- mock 规划器（Phase 1：坐标硬编码，无需 key 即可跑通全流程）----------------

_MOCK_POOL = [  # 成都样本地点池（坐标来自旧版 sample_itinerary.json）
    {"name": "武侯祠", "lat": 30.648, "lng": 104.047, "type": "attraction", "time": "09:00-11:30", "ticket": "50 元", "note": "建议一早去避开旅行团"},
    {"name": "锦里", "lat": 30.646, "lng": 104.046, "type": "food", "time": "11:30-14:00", "ticket": "免费", "note": "武侯祠旁，午餐+闲逛"},
    {"name": "宽窄巷子", "lat": 30.664, "lng": 104.052, "type": "attraction", "time": "15:00-18:00", "ticket": "免费", "note": "下午茶+巷子漫步"},
    {"name": "人民公园", "lat": 30.661, "lng": 104.055, "type": "attraction", "time": "09:00-11:00", "ticket": "免费", "note": "鹤鸣茶社喝盖碗茶"},
    {"name": "成都博物馆", "lat": 30.659, "lng": 104.056, "type": "attraction", "time": "11:00-13:30", "ticket": "免费", "note": "周一闭馆，需预约"},
    {"name": "春熙路", "lat": 30.657, "lng": 104.081, "type": "food", "time": "14:30-18:00", "ticket": "免费", "note": "购物+晚餐"},
    {"name": "大熊猫繁育研究基地", "lat": 30.733, "lng": 104.144, "type": "attraction", "time": "08:00-11:30", "ticket": "55 元", "note": "一定早去，熊猫上午活跃"},
    {"name": "文殊院", "lat": 30.676, "lng": 104.072, "type": "attraction", "time": "14:00-16:30", "ticket": "免费", "note": "素斋值得尝试"},
    {"name": "九眼桥", "lat": 30.635, "lng": 104.085, "type": "other", "time": "19:00-22:00", "ticket": "免费", "note": "夜景+酒吧街"},
]


def plan_mock(req: dict) -> RouteJSON:
    """无 key / LLM 失败时的确定性降级：生成标注「占位草稿」的行程。"""
    dest = str(req.get("destination") or "成都")
    try:
        days = max(1, min(30, int(req.get("days") or 3)))
    except (TypeError, ValueError):
        days = 3

    day_list = []
    for i in range(days):
        if "成都" in dest:
            places = [_MOCK_POOL[(i * 3 + j) % len(_MOCK_POOL)].copy() for j in range(3)]
        else:
            # 非样本城市：占位坐标 + 明确标注需要人工调整
            places = [
                {
                    "name": f"{dest}·地点{a}",
                    "lat": 30.0 + i * 0.01 + a * 0.005,
                    "lng": 104.0 + i * 0.01 + a * 0.005,
                    "type": "attraction",
                    "time": "",
                    "ticket": "",
                    "note": "【mock 占位】坐标与名称均为草稿，请在编辑器中修改",
                }
                for a in range(1, 4)
            ]
        day_list.append({
            "day": i + 1,
            "theme": f"第{i + 1}天·mock 草稿",
            "places": places,
            "hotel": {
                "name": f"{dest}·酒店（待定）",
                "lat": places[0]["lat"],
                "lng": places[0]["lng"],
                "note": "【mock 占位】请替换为真实酒店",
                "prices": [],
            },
        })

    route = {
        "trip": {
            "title": f"{dest} {days} 日游（mock 草稿）",
            "destination": dest,
            "days": days,
            "dates": str(req.get("date") or ""),
            "budget": str(req.get("budget") or ""),
            "style": str(req.get("style") or ""),
            "travelers": str(req.get("travelers") or ""),
        },
        "days": day_list,
        "summary": [
            "本行程由 mock 规划器生成（未配置 LLM key 或调用失败），仅供联调验证。",
            "配置 ITERTRIP_LLM_API_KEY 环境变量后可获得真实规划。",
        ],
    }
    return RouteJSON.model_validate(route)


def _has_coord(p) -> bool:
    """是否有可用坐标（None / (0,0) 都算缺失；0,0 是「待补全」占位而非真值）。"""
    return bool(p.lat and p.lng) and not (p.lat == 0 and p.lng == 0)


def _is_user_truth(traveler: str, name: str, city: str) -> bool:
    """该地点是否已有「用户手改」的坐标真值（M18 实体记忆）——核验与离谱检测必须让路。"""
    if not traveler or not (name or "").strip():
        return False
    from . import memory_store

    try:
        if not memory_store.enabled():
            return False
        return memory_store.find_entity(traveler, name, city) is not None
    except Exception:  # noqa: BLE001 记忆是增强能力，读不到就按「没有」处理
        return False


def _add_note(p, text: str) -> None:
    if text and text not in (p.note or ""):
        p.note = (p.note or "") + text


def _geo_rec(rec: list[dict], *, rid: str, name: str, action: str, level: str = "", confidence: str = "",
             dist_km: float | None = None, score: float | None = None, ms: int = 0) -> None:
    """追加一条坐标决策记录（供 /api/chat 决策轨迹展示）。"""
    rec.append({
        "id": rid, "name": name, "action": action, "level": level, "confidence": confidence,
        "dist_km": round(dist_km, 3) if dist_km is not None else None,
        "score": round(score, 3) if score is not None else None,
        "ms": ms,
    })


def route_to_gcj02(route: RouteJSON, source: str = "llm") -> RouteJSON:
    """整条路线坐标按 WGS84 处理一次 → GCJ-02（占位 0 不动），并打上来源底标（默认 llm）。

    表单规划（plan）与对话提取（chat 提取模式）共用：LLM 输出的坐标一律视为 WGS84。
    此前对话提取路径漏了这一步，导致模型给的坐标以 WGS84 画在高德瓦片上，系统性偏移
    约 360~560m（M19 修复）。
    """
    for d in route.days:
        for p in d.places:
            if p.lat and p.lng:
                p.lat, p.lng = wgs84_to_gcj02(p.lat, p.lng)
                if not p.source:
                    p.source, p.confidence = source, p.confidence or "high"
        h = d.hotel
        if h is not None and h.lat and h.lng:
            h.lat, h.lng = wgs84_to_gcj02(h.lat, h.lng)
            if not h.source:
                h.source, h.confidence = source, h.confidence or "high"
    return route


def convert_new_coords(new: RouteJSON, old: RouteJSON) -> RouteJSON:
    """改路线出口的坐标处理：只转「本轮新写/改动」的坐标。

    与旧路线同名同值的坐标是回显的 GCJ-02（连同来源标注一起沿用），跳过转换以防双重偏移；
    差异坐标视为模型新写的 WGS84 → 转换并标 source="llm"。
    """
    old_places = {p.name: p for d in old.days for p in d.places}
    old_hotels = {d.hotel.name: d.hotel for d in old.days if d.hotel}
    for d in new.days:
        for p in d.places:
            o = old_places.get(p.name)
            echoed = o is not None and o.lat is not None and abs(o.lat - p.lat) < 1e-6 and abs(o.lng - p.lng) < 1e-6
            if echoed:
                p.source, p.confidence = o.source, o.confidence
                continue
            if p.lat and p.lng:
                p.lat, p.lng = wgs84_to_gcj02(p.lat, p.lng)
                p.source, p.confidence = "llm", "high"
        h = d.hotel
        if h is not None and h.lat and h.lng:
            oh = old_hotels.get(h.name)
            echoed_h = oh is not None and oh.lat is not None and abs(oh.lat - h.lat) < 1e-6 and abs(oh.lng - h.lng) < 1e-6
            if echoed_h:
                h.source, h.confidence = oh.source, oh.confidence
                continue
            h.lat, h.lng = wgs84_to_gcj02(h.lat, h.lng)
            h.source, h.confidence = "llm", "high"
    return new


async def _enrich_coordinates(
    route: RouteJSON,
    destination: str,
    overrides: dict | None = None,
    traveler: str = "",
    records: list[dict] | None = None,
    session: AmapSession | None = None,
    force_verify: bool = False,
) -> int:
    """对缺失/离谱/不可信坐标做补全与核验；返回处理（写入坐标）个数。

    三阶段（输入坐标均已为 GCJ-02）：
    ① 离谱检测：以有效坐标中位数为基准，偏离 > 100km 视为可疑 → 强制重新 geocode；
       境内行程（中位数落在国境内）里落在中国境外的点也一律视为可疑（幻觉 / lat,lng 写反）；
       重定位结果与原值差 > 10km 才替换，否则保留原值仅追加「坐标待确认」
       （防误杀：跨城行程中合法远点 + LLM 坚持原坐标的知名远景点）。
       用户手改过的真值点不参与本阶段（用户可以合法地把点挪到很远的地方）。
    ② 缺失补全：lat/lng 缺失或 (0,0) 的地点/酒店走 geocode 降级链（高德优先）补全。
    ③ 主动核验（仅当配了高德 key）：对已有坐标**直接查高德**（不整链，避免自己证明自己）：
       - 名称强匹配（≥0.85）且偏差 ≤ 1.5km → **采用 POI 坐标**（记 `align`）：实测模型坐标虽同城，
         却普遍偏离真实 POI 113m~1.2km，只标注不采用等于白核验。
       - 偏差 > 1.5km 的强匹配必须有佐证才允许「搬家」：名称完全一致（score≈1.0）或候选池
         ≥3 条互相同意（agree）；否则保留原坐标 + 标待确认（记 `conflict`）。
         依据：同名子 POI（湖南博物院(南院) 0.94 分、差 2.3km）与异地同名点会骗过单纯的分值判断。
       - 弱匹配（0.72~0.85）且偏差 > 1.5km → 保留原值 + 标注待确认（记 `conflict`）；
         弱匹配但偏差 ≤ 1.5km → 不敢挪动，保留原值且**保持原有来源标注**（记 `confirm`，诚实优先）。
       - **行程地理包络（M20）**：紧凑行程（有效点离中位数都 ≤ 100km）里，强匹配 POI 若落在
         包络外（> max(spread,50)+150km），一律不采用 —— 高德「核验」曾把长沙行程的 7 个点搬到
         太原/沧州/北京/天津，比不核验更糟。但若现有坐标**本身已离谱**（离中位数 >100km 或离
         目的地城市中心 >200km），则不做包络保护：它就是那个该被修的错点
         （否则「整条路线都在错误省份」时一个点都修不回来，实测于「校准坐标」按钮）。
       用户真值（source=user / 实体记忆命中）永不覆盖。`force_verify=True` 时连本次刚由高德写入的
       点也重新核验（供「重新校准坐标」按钮修复历史遗留的错误来源标注）。

    records 非空时追加逐条决策记录（供 /api/chat 决策轨迹），元素形如
    {id, name, action, level, confidence, dist_km, score, ms}。
    """
    from .coordinates import amap_enabled

    sess = session if session is not None else AmapSession()
    rec: list[dict] = records if records is not None else []
    filled = 0

    # ---- 阶段①：离谱检测 ----
    valid = [(p.lat, p.lng) for d in route.days for p in d.places if _has_coord(p)]
    mlat = mlng = None
    china_trip = False
    if valid:
        from statistics import median

        mlat, mlng = median(v[0] for v in valid), median(v[1] for v in valid)
        china_trip = in_china(mlat, mlng, 4.0)
    for di, d in enumerate(route.days):
        for pi, p in enumerate(d.places):
            if not _has_coord(p):
                continue  # 缺失交给阶段②
            if p.source in ("user", "memory") or _is_user_truth(traveler, p.name, destination):
                continue
            dist_center = haversine_km(p.lat, p.lng, mlat, mlng) if mlat is not None else 0.0
            outside_china = not in_china(p.lat, p.lng, 2.0) and china_trip
            if dist_center <= _OUTLIER_KM and not outside_china:
                continue
            t0 = time.perf_counter()
            result = await geocode(
                p.name, destination, llm_overrides=overrides, traveler=traveler,
                hint_type=p.type, session=sess,
            )
            ms = int((time.perf_counter() - t0) * 1000)
            rid = f"geo:d{di}-p{pi}"
            if result["lat"] is None:
                _add_note(p, "【坐标待确认】")
                _geo_rec(rec, rid=rid, name=p.name, action="miss", level=result["source"], ms=ms)
                continue
            new_lat, new_lng = result["lat"], result["lng"]
            moved = haversine_km(new_lat, new_lng, p.lat, p.lng)
            # 境外点：只要重定位结果落回境内就替换（在非洲/海里没有第二种解释）
            replace = in_china(new_lat, new_lng, 2.0) if outside_china else moved > _OUTLIER_REPLACE_KM
            if replace:
                p.lat, p.lng = new_lat, new_lng
                p.source, p.confidence = result["source"], result["confidence"]
                if result["confidence"] != "high":
                    _add_note(p, "【坐标待确认】")
                filled += 1
                _geo_rec(rec, rid=rid, name=p.name, action="replace", level=result["source"],
                         confidence=result["confidence"], dist_km=moved, ms=ms)
            else:
                # 重新定位结果与原值接近 → 原坐标大概率没错（合法远点/知名地标），仅标注
                _add_note(p, "【坐标待确认】")
                _geo_rec(rec, rid=rid, name=p.name, action="keep", level=result["source"],
                         confidence=result["confidence"], dist_km=moved, ms=ms)

    # ---- 阶段②：缺失补全 ----
    for di, d in enumerate(route.days):
        for pi, p in enumerate(d.places):
            if _has_coord(p):
                continue
            t0 = time.perf_counter()
            result = await geocode(
                p.name, destination, llm_overrides=overrides, traveler=traveler,
                hint_type=p.type, session=sess,
            )
            ms = int((time.perf_counter() - t0) * 1000)
            rid = f"geo:d{di}-p{pi}"
            if result["lat"] is None:
                _geo_rec(rec, rid=rid, name=p.name, action="miss", level=result["source"], ms=ms)
                continue
            p.lat, p.lng = result["lat"], result["lng"]
            p.source, p.confidence = result["source"], result["confidence"]
            if result["confidence"] != "high":
                _add_note(p, "【坐标待确认】")
            filled += 1
            _geo_rec(rec, rid=rid, name=p.name, action="fill", level=result["source"],
                     confidence=result["confidence"], ms=ms)
        h = d.hotel
        if h is not None and not _has_coord(h):
            t0 = time.perf_counter()
            result = await geocode(h.name, destination, llm_overrides=overrides, traveler=traveler, session=sess)
            ms = int((time.perf_counter() - t0) * 1000)
            rid = f"geo:d{di}-hotel"
            if result["lat"] is not None:
                h.lat, h.lng = result["lat"], result["lng"]
                h.source, h.confidence = result["source"], result["confidence"]
                filled += 1
                _geo_rec(rec, rid=rid, name=h.name, action="fill", level=result["source"],
                         confidence=result["confidence"], ms=ms)
            else:
                _geo_rec(rec, rid=rid, name=h.name, action="miss", level=result["source"], ms=ms)

    # ---- 阶段③：主动核验（只查高德；仅在配置了 key 且高德未熔断时进行）----
    if amap_enabled() and not sess.disabled:
        # 行程地理包络（M20）：紧凑行程不允许把点挪到包络之外
        spread = 0.0
        if mlat is not None:
            spread = max((haversine_km(v[0], v[1], mlat, mlng) for v in valid), default=0.0)
        envelope_strict = mlat is not None and spread <= _OUTLIER_KM
        drift_limit = max(spread, 50.0) + _VERIFY_DRIFT_KM
        anchor = destination_anchor(destination)
        for di, d in enumerate(route.days):
            targets: list[tuple[str, object, str]] = [
                (f"geo:d{di}-p{pi}", p, getattr(p, "type", "")) for pi, p in enumerate(d.places)
            ]
            if d.hotel is not None and (d.hotel.name or "").strip():
                targets.append((f"geo:d{di}-hotel", d.hotel, ""))
            for rid, obj, hint in targets:
                if not _has_coord(obj):
                    continue
                if obj.source in ("user", "memory") or _is_user_truth(traveler, obj.name, destination):
                    continue
                if not force_verify and obj.source == "amap" and obj.confidence == "high":
                    continue  # 本次刚由高德写入，无需再问一遍
                t0 = time.perf_counter()
                ref = (obj.lat, obj.lng)
                # 现有坐标是否「可信」：离行程中位数 >100km，或离目的地城市中心 >200km，
                # 都说明它本身就是那个该被修的错点 —— 此时既不能拿它当就近裁决参考点，
                # 也不能用行程包络去保护它（否则整条路线都错时一个都修不回来）。
                plausible = not (
                    (mlat is not None and haversine_km(ref[0], ref[1], mlat, mlng) > _OUTLIER_KM)
                    or (anchor is not None
                        and haversine_km(ref[0], ref[1], anchor[0], anchor[1]) > _AMAP_MAX_DRIFT_KM)
                )
                hit = await geocode_amap_scored(
                    obj.name, destination, hint, sess, near=ref if plausible else None
                )
                ms = int((time.perf_counter() - t0) * 1000)
                if hit is None:
                    _geo_rec(rec, rid=rid, name=obj.name, action="miss", level="amap", ms=ms)
                    continue
                dist = haversine_km(obj.lat, obj.lng, hit[0], hit[1])
                score, agree = hit[2], (hit[3] if len(hit) > 3 else 1)
                # M20：核验是「精修」而不是「搬家」。>1.5km 的移动必须有佐证 ——
                # 名称完全一致（score≈1），或候选池里 ≥3 条互相同意（agree）；否则一律不动。
                # 依据：模型坐标同城偏差实测 113m~1.2km（≤1.5km 直接对齐即可），
                # 而「湖南博物院(南院)」这类同名子 POI 会骗到 0.94 分、把正确的点挪走 2.3km。
                far_ok = score >= _AMAP_EXACT_SCORE or agree >= _AMAP_AGREE_MIN
                in_envelope = not (
                    envelope_strict and plausible and dist > _VERIFY_KM
                    and haversine_km(hit[0], hit[1], mlat, mlng) > drift_limit
                )
                if score >= _AMAP_STRONG_SCORE and (dist <= _VERIFY_KM or far_ok) and in_envelope:
                    # 采用 POI 坐标（≤1.5km 记 align=对齐；更远记 replace=修正）
                    if abs(obj.lat - hit[0]) > 1e-6 or abs(obj.lng - hit[1]) > 1e-6:
                        obj.lat, obj.lng = hit[0], hit[1]
                        filled += 1
                    obj.source, obj.confidence = "amap", "high"
                    _geo_rec(rec, rid=rid, name=obj.name,
                             action=("replace" if dist > _VERIFY_KM else "align"), level="amap",
                             confidence="high", dist_km=dist, score=score, ms=ms)
                elif dist > _VERIFY_KM:
                    # 证据不足（弱匹配 / 同名子 POI / 异地同名点）：保留原坐标，标注交用户判断
                    _add_note(obj, "【坐标待确认】")
                    _geo_rec(rec, rid=rid, name=obj.name, action="conflict", level="amap",
                             confidence=obj.confidence, dist_km=dist, score=score, ms=ms)
                else:
                    # 弱匹配但很近：不敢挪动坐标，也**不升级来源标注**（避免「高德核验」名不副实）
                    _geo_rec(rec, rid=rid, name=obj.name, action="confirm", level="amap",
                             confidence=obj.confidence, dist_km=dist, score=score, ms=ms)
    return filled


async def recheck_route(
    route: RouteJSON, overrides: dict | None = None, traveler: str = ""
) -> dict:
    """重新校准已有路线的坐标（M20，规划页「🔍 校准坐标」按钮的后端）。

    与生成时自动补全的差异只有一点：`force_verify=True` —— **不信任历史来源标注**
    （历史上曾被一个坏掉的「高德核验」把整条路线写坏，而它的来源恰好标成 amap/high，
    正是跳过核验的条件），因此所有非用户真值点都重新问一次高德。

    - 用户手改真值（source=user / 记忆库命中）一律跳过，绝不会被机器覆盖
    - 不调用 `route_to_gcj02`：输入必须是已存的 GCJ-02（应用内 route 即此格式）
    - 返回 {route, filled, records, amap_calls, amap_reason}，records 供前端展示改了什么
    """
    session = AmapSession()
    records: list[dict] = []
    filled = await _enrich_coordinates(
        route, route.trip.destination, overrides, traveler,
        records=records, session=session, force_verify=True,
    )
    return {
        "route": route,
        "filled": filled,
        "records": records,
        "amap_calls": session.calls,
        "amap_reason": session.reason,
    }


async def plan(req: dict, overrides: dict | None = None, traveler: str = "") -> tuple[RouteJSON, str]:
    """统一入口。返回 (route, source)，source ∈ {"llm", "mock"}。"""
    cfg = _llm_config(overrides)
    if cfg is not None:
        try:
            route = await plan_with_llm(req, cfg)
            source = "llm"
        except Exception as e:  # 降级不中断服务
            print(f"[planner] LLM 规划失败，降级 mock: {e}")
            route = plan_mock(req)
            source = "mock"
    else:
        route = plan_mock(req)
        source = "mock"
    # 新生成的坐标（LLM 知识/mock 样本池）按 WGS84 处理 → 统一转 GCJ-02（0,0 占位不动）
    route_to_gcj02(route, source=("mock" if source == "mock" else "llm"))
    try:
        filled = await _enrich_coordinates(route, route.trip.destination, overrides, traveler)
        if filled:
            print(f"[planner] 坐标补全 {filled} 个地点")
    except Exception as e:
        print(f"[planner] 坐标补全失败（忽略）: {e}")
    return route, source