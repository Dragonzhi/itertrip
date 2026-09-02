"""LLM 行程规划引擎。

优先调用 OpenAI 兼容 API（DeepSeek / OpenAI / 本地模型均可），
未配置 key 或调用失败时降级为内置 mock 规划器（Phase 1 约定：坐标可先硬编码）。

环境变量：
    ITERTRIP_LLM_API_KEY   必填才走 LLM；缺省直接 mock
    ITERTRIP_LLM_BASE_URL  默认 https://api.deepseek.com
    ITERTRIP_LLM_MODEL     默认 deepseek-chat
"""

import copy
import json
import os

import httpx

from .coordinates import geocode
from ._llmutil import endpoint
from .schema import RouteJSON

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
    """解析 LLM 配置：请求头覆盖（BYOK，DESIGN.md §4.2）> 环境变量兜底；无 key 返回 None（走 mock）。"""
    ov = overrides or {}
    api_key = str(ov.get("api_key") or "").strip() or os.environ.get("ITERTRIP_LLM_API_KEY", "").strip()
    if not api_key:
        return None
    base_url = str(ov.get("base_url") or "").strip().rstrip("/") or os.environ.get(
        "ITERTRIP_LLM_BASE_URL", "https://api.deepseek.com"
    ).rstrip("/")
    model = str(ov.get("model") or "").strip() or os.environ.get("ITERTRIP_LLM_MODEL", "deepseek-chat")
    return {"api_key": api_key, "base_url": base_url, "model": model}


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


async def _enrich_coordinates(
    route: RouteJSON, destination: str, overrides: dict | None = None
) -> int:
    """对缺失/无效坐标的地点做补全（Phase 4）；返回补全个数。补不到的由前端低置信度提示。"""
    filled = 0
    for day in route.days:
        for p in day.places:
            if p.lat is not None and p.lng is not None and (p.lat != 0 or p.lng != 0):
                continue
            result = await geocode(p.name, destination, llm_overrides=overrides)
            if result["lat"] is not None:
                p.lat = result["lat"]
                p.lng = result["lng"]
                p.note = (p.note or "") + ("【坐标待确认】" if result["confidence"] != "high" else "")
                filled += 1
        h = day.hotel
        if h is not None and (h.lat == 0 and h.lng == 0):
            result = await geocode(h.name, destination, llm_overrides=overrides)
            if result["lat"] is not None:
                h.lat = result["lat"]
                h.lng = result["lng"]
    return filled


async def plan(req: dict, overrides: dict | None = None) -> tuple[RouteJSON, str]:
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
    try:
        filled = await _enrich_coordinates(route, route.trip.destination, overrides)
        if filled:
            print(f"[planner] 坐标补全 {filled} 个地点")
    except Exception as e:
        print(f"[planner] 坐标补全失败（忽略）: {e}")
    return route, source