"""坐标补全引擎（Phase 4 + 2026-09 准确性增强 + M19 可信度增强）。

降级链（全链路输出统一 GCJ-02，与高德瓦片显示一致）：
0. **坐标实体记忆**（M18，需 ITERTRIP_MEMORY_ENABLED=1 + 请求带 X-Traveler-Id）：
   用户在地图上手动改过的同名同城地点 = ground truth，命中即返回 confidence=high，不再问 LLM
1. **高德 POI 搜索**（M19 升为一级坐标源）：店名级精度，中国 POI 覆盖最好；
   前 5 条候选**全部打分**择优选（不再只看第一条），命中即直接返回 GCJ-02
2. LLM 已知知识（WGS84 → 转 GCJ-02）：知名地标可靠，小店可能幻觉 → 故降为兜底
3. web 搜索兜底（Tavily 兼容；文本坐标按 WGS84 → 转 GCJ-02）
4. 内置城市中心表兜底，confidence: "low"（前端显示「⚠️ 坐标可能需要确认」）
5. 彻底失败：lat/lng = None，confidence: "none"

M19 变化（见 docs/M19_TRUST_PLAN.md）：
- 顺序调整：高德优先、模型兜底。此前 LLM 在第一位，导致「模型随手编的同城坐标」永远不会落空，
  门店级精度的高德能力实际上从未被使用（模型只有在显式回 not_found 时才会走到高德）。
- 名称归一 + 多候选打分：剥掉「（必去）」类补充说明，按 完全相同/互相包含/公共前缀/字符二元重合
  打分，低于 _AMAP_MIN_SCORE 视为未命中（宁可不给也不给错，防同名连锁店误伤）。
- 每个地点最多 2 次高德请求（带 citylimit 一次、失败后去掉限制一次并要求城市一致）；
  请求级缓存去重 + 熔断（key 无效/配额用尽立即停，网络错误连续 2 次停），避免坏 key 时白等超时。
- 返回值统一带 `source`（memory|amap|llm|search|city|none），供路线溯源与决策轨迹展示。

M20 变化（区域校验，见 docs/M20_GEO_REGION_PLAN.md）：
- **目的地不再直接当城市名**：`parse_region()` 把「湖南·长沙」「湖南省长沙市」「长沙」都解析成
  (省, 市)，只把**城市**传给高德（高德不认省市连写，会静默忽略 citylimit 返回全国结果）。
- **候选地理闸门**：候选 POI 必须省份命中 / 城市命中 / 距目的地城市中心 ≤ 200km，否则一律不用。
  这一步专门拦「同名不同城」——高德全国检索里「天心阁」的头名在河北沧州、「五一广场」在山西太原。
- **城市中心表补全**：从 12 个城市扩到 40+，表外目的地的最后一级兜底不再失效。
- **置信度跟随匹配分**：弱匹配（0.72~0.85）与模糊兜底不再标成「高德核验」（high），而是 low。
- **模糊兜底**：同城内名称明显错别字（笨萝卜↔笨罗卜、炊烟时代↔炊烟）用字符重合度捞回来，
  分数钳在强匹配阈值以下，因此只用于补全、永不覆盖已有坐标。

环境变量：
    ITERTRIP_LLM_API_KEY / ITERTRIP_LLM_BASE_URL / ITERTRIP_LLM_MODEL   同 planner
    ITERTRIP_AMAP_KEY          可选，高德 Web 服务 key（启用 POI 一级坐标源 + 核验）
    ITERTRIP_SEARCH_API_KEY    可选，启用搜索兜底（Tavily 兼容格式）
    ITERTRIP_SEARCH_BASE_URL   默认 https://api.tavily.com
"""

import json
import re
from typing import Any

import httpx

from ._llmutil import endpoint, env_value
from .geo import haversine_km, in_china, wgs84_to_gcj02

# 高置信度：知名城市中心（WGS84，供城市级兜底；返回前统一转 GCJ-02）
# M20 补全：此前表里只有 12 个城市，导致表外目的地的**最低一级兜底完全失效**
# （长沙行程的「特产采购」等非 POI 条目拿到了 lat/lng=0 而不是城市中心）。
_CITY_CENTER: dict[str, tuple[float, float]] = {
    "长沙": (28.1941, 112.9823),
    "成都": (30.6570, 104.0650),
    "北京": (39.9042, 116.4074),
    "上海": (31.2304, 121.4737),
    "广州": (23.1291, 113.2644),
    "深圳": (22.5431, 114.0579),
    "杭州": (30.2741, 120.1551),
    "西安": (34.3416, 108.9398),
    "南京": (32.0603, 118.7969),
    "重庆": (29.5630, 106.5516),
    "大理": (25.6065, 100.2676),
    "厦门": (24.4798, 118.0894),
    "苏州": (31.2989, 120.5853),
    "武汉": (30.5928, 114.3055),
    "天津": (39.0842, 117.2010),
    "青岛": (36.0671, 120.3826),
    "昆明": (24.8801, 102.8329),
    "贵阳": (26.6470, 106.6302),
    "南宁": (22.8170, 108.3665),
    "郑州": (34.7466, 113.6254),
    "济南": (36.6512, 117.1201),
    "福州": (26.0745, 119.2965),
    "合肥": (31.8206, 117.2272),
    "南昌": (28.6820, 115.8579),
    "哈尔滨": (45.8038, 126.5340),
    "沈阳": (41.8057, 123.4315),
    "大连": (38.9140, 121.6147),
    "石家庄": (38.0428, 114.5149),
    "太原": (37.8706, 112.5489),
    "兰州": (36.0611, 103.8343),
    "西宁": (36.6171, 101.7782),
    "银川": (38.4872, 106.2309),
    "呼和浩特": (40.8424, 111.7500),
    "乌鲁木齐": (43.8256, 87.6168),
    "拉萨": (29.6520, 91.1721),
    "海口": (20.0444, 110.1999),
    "三亚": (18.2528, 109.5119),
    "桂林": (25.2736, 110.2900),
    "丽江": (26.8721, 100.2299),
    "张家界": (29.1170, 110.4790),
    "宁波": (29.8683, 121.5440),
    "无锡": (31.4912, 120.3119),
    "珠海": (22.2707, 113.5767),
    "香港": (22.3193, 114.1694),
    "澳门": (22.1987, 113.5439),
    "台北": (25.0330, 121.5654),
    "长春": (43.8171, 125.3235),
}

# 省级行政区 → 省会（WGS84）。M21：目的地城市不在上面 46 城里时（如「河南·洛阳」），
# 仍需要一个「用户要求的地点」附近的地理参照点，用来判断某个坐标是不是明显跑到了别的省市。
# 注意：本表**不参与** `_region_ok` 候选放行（那会把省界外的邻省 POI 也放进来），
# 只用于 `destination_anchor()` 的「离目的地够近吗」判断，且配合「必须更靠近参照点」才允许改动。
_PROVINCE_CENTER: dict[str, tuple[float, float]] = {
    "北京": (39.9042, 116.4074), "天津": (39.0842, 117.2010),
    "上海": (31.2304, 121.4737), "重庆": (29.5630, 106.5516),
    "河北": (38.0428, 114.5149), "山西": (37.8706, 112.5489),
    "内蒙古": (40.8424, 111.7500), "辽宁": (41.8057, 123.4315),
    "吉林": (43.8171, 125.3235), "黑龙江": (45.8038, 126.5340),
    "江苏": (32.0603, 118.7969), "浙江": (30.2741, 120.1551),
    "安徽": (31.8206, 117.2272), "福建": (26.0745, 119.2965),
    "江西": (28.6820, 115.8579), "山东": (36.6512, 117.1201),
    "河南": (34.7466, 113.6254), "湖北": (30.5928, 114.3055),
    "湖南": (28.1941, 112.9823), "广东": (23.1291, 113.2644),
    "广西": (22.8170, 108.3665), "海南": (20.0444, 110.1999),
    "四川": (30.6570, 104.0650), "贵州": (26.6470, 106.6302),
    "云南": (24.8801, 102.8329), "西藏": (29.6520, 91.1721),
    "陕西": (34.3416, 108.9398), "甘肃": (36.0611, 103.8343),
    "青海": (36.6171, 101.7782), "宁夏": (38.4872, 106.2309),
    "新疆": (43.8256, 87.6168), "台湾": (25.0330, 121.5654),
    "香港": (22.3193, 114.1694), "澳门": (22.1987, 113.5439),
}

# ---- M19 高德调参（请求级预算/熔断，防止坏 key 或断网时逐点白等超时）----
_AMAP_TIMEOUT = 8.0            # 单次请求超时（原 30s × N 个地点是危险的组合）
_AMAP_MIN_SCORE = 0.72         # 低于此分视为未命中（宁可不给坐标，也不给错坐标）
_AMAP_STRONG_SCORE = 0.85      # 强匹配：核验时允许覆盖模型坐标
_AMAP_TYPE_MISS_PENALTY = 0.15  # 有类型提示却匹配到大类不符的 POI（问餐馆返回道路）→ 证据反对
_AMAP_CANDIDATES = 5           # 打分考察的候选条数
_MAX_AMAP_CALLS = 40           # 单次路线生成的高德请求预算
_AMAP_MAX_NET_FAILS = 2        # 连续网络失败次数上限（超过则本次请求不再尝试）

# ---- M20 区域校验（防止「同名不同城」被当成命中，见 M20 事故复盘）----
# 事故：destination="湖南·长沙" 不是高德认识的城市名 → citylimit 被**静默忽略** → 返回全国结果，
# 「天心阁」取到河北沧州、「五一广场」取到山西太原。以下三道闸门保证只接受「在目的地合理范围内」的 POI。
_AMAP_MAX_DRIFT_KM = 200.0     # 无省份信息时，POI 距目的地城市中心的最大容忍距离（覆盖韶山 65km/乐山 140km/峨眉山 155km）
_AMAP_FUZZY_SCORE = 0.65       # 名称模糊兜底阈值（同城内错别字：笨萝卜↔笨罗卜、炊烟时代↔炊烟）
_AMAP_FUZZY_CAP = 0.80         # 模糊命中分数上限：永远低于强匹配阈值，不参与「覆盖已有坐标」的决策
_AMAP_TIE = 0.05               # 分数接近即视为并列，改用「离参考点更近」裁决（同名连锁店/同名子 POI）
_AMAP_EXACT_SCORE = 0.99       # 名称完全一致：唯一允许「把已有坐标挪到 1.5km 之外」的强佐证
_AMAP_AGREE_KM = 0.5           # 候选池一致性半径
_AMAP_AGREE_MIN = 3            # ≥3 条候选落在这半径内 → 互相印证（同样是允许远距离替换的佐证）

# 高德错误码 → 人话（用于决策轨迹；这些错误重试无意义，直接熔断）
_AMAP_FATAL_INFOCODE = {
    "10001": "key 无效或已过期",
    "10002": "key 已被禁用",
    "10003": "日访问量已超限",
    "10004": "访问频率超限",
    "10044": "日访问量已超限",
}


def _round6(v: float) -> float:
    return round(v * 1e6) / 1e6


def _valid_coord(lat: Any, lng: Any) -> bool:
    try:
        la, ln = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    return -90 <= la <= 90 and -180 <= ln <= 180 and not (la == 0 and ln == 0)


# ---------------- 名称归一 / 候选打分（M19） ----------------

_BRACKET_RE = re.compile(r"[（(\[【][^）)\]】]*[）)\]】]")
_PUNCT_RE = re.compile(r"[\s·・•∙⋅,，.。()（）\[\]【】\-—_/*|]+")
_FULLWIDTH = str.maketrans(
    "０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ"
    "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ",
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
)

# 类型提示：营地/门店名与 POI 大类吻合时给一点点加分（仅作同分裁决，不改变阈值）
_TYPE_HINTS: dict[str, tuple[str, ...]] = {
    "food": ("餐饮", "美食", "小吃", "咖啡", "茶艺"),
    "attraction": ("风景名胜", "景点", "公园", "博物馆", "展馆", "寺庙"),
    "transport": ("交通设施", "地铁", "车站", "机场", "港口", "长途汽车"),
}


def _clean_name(name: str) -> str:
    """去掉括号补充说明与装饰字符：'鹤鸣茶社（人民公园店）🍵' → '鹤鸣茶社'。"""
    s = _BRACKET_RE.sub("", name or "")
    s = re.sub(r"\s+", "", s).strip("·-—_*·")
    return s or (name or "").strip()


def _norm_name(s: str) -> str:
    return _PUNCT_RE.sub("", (s or "").translate(_FULLWIDTH)).lower()


# ---------------- 目的地区域解析 / 候选区域校验（M20） ----------------

# 省级行政区简称（含直辖市与特别行政区）。用于从「湖南·长沙」「湖南省长沙市」「湖南长沙」
# 这类写法里分离省市，并在无城市信息时按省份兜底。
_PROVINCES: tuple[str, ...] = (
    "内蒙古", "黑龙江", "北京", "天津", "上海", "重庆", "香港", "澳门",
    "河北", "山西", "辽宁", "吉林", "江苏", "浙江", "安徽", "福建", "江西", "山东",
    "河南", "湖北", "湖南", "广东", "广西", "海南", "四川", "贵州", "云南", "西藏",
    "陕西", "甘肃", "青海", "宁夏", "新疆", "台湾",
)
# 直辖市/特别行政区：既是省级也是市级，可直接作为高德 city 参数
_MUNICIPALITIES: tuple[str, ...] = ("北京", "天津", "上海", "重庆", "香港", "澳门")
_PROVINCES_SORTED = tuple(sorted(_PROVINCES, key=len, reverse=True))

_CITY_SPLIT_RE = re.compile(r"[·・•∙⋅/\\|、,，;；:：\-\u2014\s]+")
_ADMIN_SUFFIXES = (
    "特别行政区", "自治区", "自治州", "自治县", "地区", "新区", "省", "市", "区", "县", "盟", "旗",
)


def _norm_region(s: str) -> str:
    """省市名归一：去标点空格与行政区后缀，便于「长沙市 ⊂ 湖南省长沙市」这类包含判断。"""
    t = _norm_name(s)
    changed = True
    while changed and t:
        changed = False
        for suf in _ADMIN_SUFFIXES:
            if t.endswith(suf) and len(t) > len(suf):
                t = t[: -len(suf)]
                changed = True
    return t


def parse_region(destination: str) -> tuple[list[str], list[str]]:
    """把目的地串解析成 (省份列表, 城市列表)，都做过去后缀归一。

    >>> parse_region("湖南·长沙")
    (['湖南'], ['长沙'])
    >>> parse_region("长沙")
    ([], ['长沙'])
    >>> parse_region("湖南省长沙市")
    (['湖南'], ['长沙'])
    >>> parse_region("成都·都江堰")
    ([], ['成都', '都江堰'])

    解析不出来（境外 / 泛指区域 / 空）时返回 ([], [])，调用方据此**不做区域否决**。
    """
    provinces: list[str] = []
    cities: list[str] = []
    for tok in _CITY_SPLIT_RE.split((destination or "").strip()):
        tok = _norm_name(tok)
        if not tok:
            continue
        hit = next((p for p in _PROVINCES_SORTED if tok.startswith(p)), "")
        rest = tok[len(hit):] if hit else tok
        if hit:
            if hit not in provinces:
                provinces.append(hit)
            rest = rest.lstrip("省市自治区特别行政区")
            if hit in _MUNICIPALITIES and not rest and hit not in cities:
                cities.append(hit)  # 直辖市：本身即城市，可直接用于高德 city 参数
        city = _norm_region(rest) if rest else ""
        if city and city not in cities:
            cities.append(city)
    return provinces, cities


def _region_anchors(cities: list[str]) -> list[tuple[float, float]]:
    """已知城市中心（WGS84 → GCJ-02）作为距离锚点，覆盖「无省份信息 + 跨城一日游」。"""
    out = []
    for c in cities:
        if c in _CITY_CENTER:
            out.append(wgs84_to_gcj02(*_CITY_CENTER[c]))
    return out


def destination_anchor(destination: str) -> tuple[float, float] | None:
    """「用户要求的目的地」附近的地理参照点：优先城市中心，其次省会，都没有则 None。

    供上层判断「一个已有坐标是否明显不在用户要的地方」：
    - 现有坐标离参照点超过 `_AMAP_MAX_DRIFT_KM`（200km）→ 它本身就离谱，不该再被行程包络保护；
    - 只有当高德给出的新坐标**比现有坐标更靠近参照点**时才允许这样的大幅改动。

    城市表命中优先（更精确）；城市不在表里时退到省会（M21，覆盖「河南·洛阳」这类目的地）。
    """
    provinces, cities = parse_region(destination)
    anchors = _region_anchors(cities)
    if anchors:
        return anchors[0]
    for p in provinces:
        c = _PROVINCE_CENTER.get(p)
        if c:
            return wgs84_to_gcj02(*c)
    return None


def _candidate_text(poi: dict) -> str:
    return _norm_region(_poi_city_text(poi))


def _region_ok(
    poi: dict,
    provinces: list[str],
    cities: list[str],
    anchors: list[tuple[float, float]],
) -> bool:
    """候选 POI 是否落在目的地的合理范围内（省份命中 / 城市命中 / 距锚点够近）。

    - 解析不出任何区域信息 → 不否决（没有判断依据，保留旧行为）
    - 候选缺城市字段 → 不否决（证据不足不构成反对）
    """
    if not provinces and not cities:
        return True
    txt = _candidate_text(poi)
    if not txt:
        return True
    if any(_norm_region(c) and _norm_region(c) in txt for c in cities):
        return True
    if any(_norm_region(p) and _norm_region(p) in txt for p in provinces):
        return True
    loc = _parse_loc(poi)
    if loc and anchors:
        return any(haversine_km(loc[0], loc[1], a[0], a[1]) <= _AMAP_MAX_DRIFT_KM for a in anchors)
    return False


def _common_prefix(a: str, b: str) -> int:
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def _name_score(query: str, cand: str) -> float:
    """名称相似度 0~1。

    只有三类能给到阈值（0.72）以上：完全相同 1.0；互相包含 0.75~0.95（按长度比）；
    公共前缀 ≥3 字 0.66~0.80。其余（含仅字符重合）一律 0 —— 宁可不给坐标，也不给错坐标。
    （曾用「字符二元重合度」兜底：0.5*Jaccard 永远到不了阈值，且会放过垃圾名 → 已删。）
    """
    q, c = _norm_name(query), _norm_name(cand)
    if not q or not c:
        return 0.0
    if q == c:
        return 1.0
    if q in c or c in q:
        ratio = min(len(q), len(c)) / max(len(q), len(c))
        return round(0.75 + 0.2 * ratio, 4)
    cp = _common_prefix(q, c)
    if cp >= 3:
        return round(0.6 + 0.02 * min(cp, 10), 4)
    return 0.0


def _char_overlap(query: str, cand: str) -> float:
    """字符集合 Jaccard（M20 模糊兜底）：只解决「同城 + 名称有明显错别字」这一类。

    实测动机：模型把「笨罗卜浏阳菜馆」写成「笨萝卜浏阳菜馆」（卜→萝卜），把「炊烟小炒黄牛肉」
    写成「炊烟时代小炒黄牛肉」——严格打分是 0 分，但这些店真实存在于目的地城市里。
    该分数**上限被钳在强匹配阈值以下**（`_AMAP_FUZZY_CAP`），因此永远不会覆盖已有坐标，
    只用于「本来就没坐标」的补全，并被标注为低置信度。
    """
    q, c = set(query or ""), set(cand or "")
    if not q or not c:
        return 0.0
    return round(len(q & c) / len(q | c), 4)


def _apply_type_hint(score: float, poi: dict, hint_type: str) -> float:
    """类型提示校准：大类吻合 +0.05；有提示但大类明显不符 -0.15（0 分不加不减）。"""
    if score <= 0:
        return 0.0
    marks = _TYPE_HINTS.get((hint_type or "").strip(), ())
    if marks:
        ptype = str(poi.get("type") or "")
        if any(m in ptype for m in marks):
            score = min(1.0, score + 0.05)
        else:
            score = max(0.0, score - _AMAP_TYPE_MISS_PENALTY)
    return round(score, 4)


def _candidate_score(poi: dict, query: str, hint_type: str = "", query_full: str = "") -> float:
    """名称分 + 类型提示校准：大类吻合 +0.05；有提示但大类明显不符 -0.15。

    两条修正都是实测逼出来的：
    - 类型惩罚：查「水巷口辣汤饭」（food）时高德返回同名的「水巷口」**道路**，名称包含关系拿到
      0.85 分，会盖掉正确的模型坐标；加惩罚后掉到 0.70，被判未命中。
    - 括号分支名（query_full）：原始名称里的「（坡子街总店）」「（海信广场店）」是**分店鉴别信息**，
      清洗掉反而会选错分店（火宫殿五一路店 2.3km 外 vs 坡子街总店 0.7km；文和友跳海店 vs 海信广场店）。
      故取「清洗名」与「完整名」两次打分的较大值：完整名能把带分店的后缀变成精确命中（1.0）。
    """
    cand = str(poi.get("name") or "")
    score = _name_score(query, cand)
    if query_full:
        score = max(score, _name_score(query_full, cand))
    return _apply_type_hint(score, poi, hint_type)


def _poi_city_text(poi: dict) -> str:
    return " ".join(str(poi.get(k) or "") for k in ("pname", "cityname", "adname"))


def _parse_loc(poi: dict) -> tuple[float, float] | None:
    loc = str(poi.get("location", "")).split(",")
    if len(loc) != 2 or not _valid_coord(loc[1], loc[0]):
        return None
    return _round6(float(loc[1])), _round6(float(loc[0]))  # location 是 "lng,lat"


def _pick_best_poi(
    pois: list[dict],
    query: str,
    hint_type: str = "",
    *,
    provinces: list[str] | None = None,
    cities: list[str] | None = None,
    anchors: list[tuple[float, float]] | None = None,
    allow_fuzzy: bool = False,
    near: tuple[float, float] | None = None,
    query_full: str = "",
) -> tuple[float, float, float, int] | None:
    """前 N 条候选「先过地理闸门，再打分择优选」，返回 (lat, lng, score, agree)；无合格候选返回 None。

    地理闸门（M20）是这里最重要的一步：高德的 citylimit 在 city 参数不被识别时会被**静默忽略**
    并返回全国结果，此前只按名称打分，于是「天心阁」命中河北沧州、「五一广场」命中山西太原。
    现在候选必须先落在目的地省市范围内（或距目的地城市中心 ≤ _AMAP_MAX_DRIFT_KM）。

    并列裁决：分数差在 `_AMAP_TIE` 内视为同名多分店（火宫殿五一路店 2.3km vs 坡子街店 0.7km），
    取离 near（优先）或目的地城市中心更近的那个 —— 游客行程里离目的地近的那家才是有意去的那家。
    agree = 与选中点同分的候选里落在 `_AMAP_AGREE_KM` 内的条数（候选池互相印证，供核验阶段判断可信度）。
    allow_fuzzy=True 时，严格打分全部未命中则再做一次字符重合度兜底（分数钳在 _AMAP_FUZZY_CAP 以下）。
    """
    provs, cits, anchs = provinces or [], cities or [], anchors or []
    pool = [
        (poi, loc)
        for poi in (pois or [])[:_AMAP_CANDIDATES]
        if (loc := _parse_loc(poi)) is not None and _region_ok(poi, provs, cits, anchs)
    ]
    ref = near or (anchs[0] if anchs else None)

    def _dist(loc: tuple[float, float]) -> float:
        return haversine_km(loc[0], loc[1], ref[0], ref[1]) if ref else 0.0

    hits: list[tuple[dict, tuple[float, float], float]] = []
    for poi, loc in pool:
        score = _candidate_score(poi, query, hint_type, query_full)
        if score >= _AMAP_MIN_SCORE:
            hits.append((poi, loc, score))
    if not hits and allow_fuzzy:
        for poi, loc in pool:
            fuzzy = _apply_type_hint(
                _char_overlap(query, _clean_name(str(poi.get("name") or ""))), poi, hint_type
            )
            score = min(fuzzy, _AMAP_FUZZY_CAP)
            if score >= _AMAP_FUZZY_SCORE:
                hits.append((poi, loc, score))
    if not hits:
        return None
    top = max(h[2] for h in hits)
    band = [h for h in hits if h[2] >= top - _AMAP_TIE]
    chosen = min(band, key=lambda h: _dist(h[1])) if ref else max(band, key=lambda h: h[2])
    loc, score = chosen[1], chosen[2]
    agree = sum(1 for h in hits if haversine_km(loc[0], loc[1], h[1][0], h[1][1]) <= _AMAP_AGREE_KM)
    return (loc[0], loc[1], score, agree)


class AmapSession:
    """一次路线生成内的高德调用预算 / 去重缓存 / 熔断状态（由调用方贯穿传递）。

    - cache：按 (归一名, 城市, 类型提示) 去重，补全与核验两阶段不会重复打同一地点
    - disabled + reason：key 无效、配额用尽、连续网络失败 → 本次请求后续不再尝试高德
    """

    def __init__(self) -> None:
        self.cache: dict[str, tuple[float, float, float] | None] = {}
        self.calls = 0
        self.net_fails = 0
        self.disabled = False
        self.reason = ""


def _amap_key() -> str:
    """高德 Web 服务 key：ITERTRIP_AMAP_KEY（env > .env）> 后台管理配置。"""
    key = env_value("ITERTRIP_AMAP_KEY")
    if key:
        return key
    try:
        from . import admin_config  # 延迟导入，保持 coordinates 可独立测试

        return admin_config.get_amap_key()
    except Exception:  # noqa: BLE001 配置读取失败 = 未配置
        return ""


def amap_enabled() -> bool:
    """是否配了高德 key（M19：决定 POI 是否作为一级坐标源、以及是否做主动核验）。"""
    return bool(_amap_key())


async def _amap_query(
    client: httpx.AsyncClient, key: str, keywords: str, city: str, citylimit: bool
) -> tuple[list[dict], str, bool]:
    """一次 place/text 查询，返回 (pois, 错误说明, 是否致命错误)。

    致命（key/配额/频率）→ 调用方立即熔断；网络类错误累计到上限再熔断。
    """
    try:
        resp = await client.get(
            "https://restapi.amap.com/v3/place/text",
            params={
                "key": key,
                "keywords": keywords,
                "city": city or "",
                "citylimit": "true" if (city and citylimit) else "false",
                "offset": _AMAP_CANDIDATES,
                "page": 1,
                "extensions": "base",
            },
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:  # noqa: BLE001 高德不可用一律降级，绝不抛出
        return [], f"请求失败（{type(e).__name__}）", False
    if str(data.get("status")) != "1":
        info = str(data.get("infocode") or "")
        reason = _AMAP_FATAL_INFOCODE.get(info) or str(data.get("info") or "") or "高德返回错误"
        return [], reason, info in _AMAP_FATAL_INFOCODE
    return list(data.get("pois") or []), "", False


async def geocode_amap_scored(
    name: str,
    city: str = "",
    hint_type: str = "",
    session: "AmapSession | None" = None,
    *,
    near: tuple[float, float] | None = None,
) -> tuple[float, float, float, int] | None:
    """高德 POI 检索（M19 一级坐标源），返回 (lat, lng, 名称匹配分, 候选池一致条数)；未命中返回 None。

    查询策略（每个地点最多 2 次请求）：
      ① 归一名称 + citylimit=true，city 取**解析出的城市名**（不是目的地原文！）
      ② ①未命中且城市非空 → 去掉 citylimit 重试（覆盖跨城一日游，如长沙行程里的韶山）

    两步的结果都要过 `_region_ok` 地理闸门。M20 事故：直接把 "湖南·长沙" 当 city 传给高德，
    高德不认这个写法、**静默忽略 citylimit** 返回全国结果，第一步又没有城市校验，
    于是「天心阁=河北沧州」「五一广场=山西太原」「费大厨=北京」被当作满分命中写进了路线。
    near 传入「该地点现有坐标」时，同名并列候选取离它最近的那个（核验场景）。
    """
    key = _amap_key()
    if not key:
        return None
    sess = session if session is not None else AmapSession()
    if sess.disabled or sess.calls >= _MAX_AMAP_CALLS:
        if sess.calls >= _MAX_AMAP_CALLS and not sess.disabled:
            sess.disabled, sess.reason = True, f"本次请求高德调用已达上限 {_MAX_AMAP_CALLS} 次"
        return None
    query = _clean_name(name)
    if not query:
        return None
    ck = f"{_norm_name(query)}|{_norm_name(city)}|{hint_type or ''}"
    if ck in sess.cache:
        return sess.cache[ck]

    # 目的地 → (省份, 城市)。city_param 只取「城市」：高德不认识省市连写、也不认省级名称，
    # 传错等于没传（比不传更危险，因为会假装限制了范围）。无城市时用省份做粗过滤。
    provinces, cities = parse_region(city)
    city_param = cities[0] if cities else (provinces[0] if provinces else "")
    anchors = _region_anchors(cities)

    result: tuple[float, float, float] | None = None
    try:
        async with httpx.AsyncClient(timeout=_AMAP_TIMEOUT) as client:
            sess.calls += 1
            pois, err, fatal = await _amap_query(client, key, query, city_param, citylimit=True)
            if err:
                if fatal or sess.net_fails + 1 >= _AMAP_MAX_NET_FAILS:
                    sess.disabled, sess.reason = True, err
                else:
                    sess.net_fails += 1
                sess.cache[ck] = None
                return None
            sess.net_fails = 0
            result = _pick_best_poi(
                pois, query, hint_type, provinces=provinces, cities=cities, anchors=anchors,
                allow_fuzzy=True, near=near, query_full=name,
            )
            if result is None and city_param and sess.calls < _MAX_AMAP_CALLS:
                # 第二步：去掉城市限制，靠地理闸门（省份 / 距城市中心距离）筛跨城地点
                sess.calls += 1
                pois2, err2, fatal2 = await _amap_query(client, key, query, "", citylimit=False)
                if err2:
                    if fatal2 or sess.net_fails + 1 >= _AMAP_MAX_NET_FAILS:
                        sess.disabled, sess.reason = True, err2
                    else:
                        sess.net_fails += 1
                else:
                    sess.net_fails = 0
                    result = _pick_best_poi(
                        pois2, query, hint_type, provinces=provinces, cities=cities, anchors=anchors,
                        allow_fuzzy=True, near=near, query_full=name,
                    )
            if result is not None and not city_param and not in_china(result[0], result[1]):
                result = None  # 无任何区域约束时至少要求落在中国境内（防同名境外 POI 误配）
    except Exception as e:  # noqa: BLE001 任何意外都只是「高德没结果」—— 但必须留下痕迹
        # M20：这里曾把一个下标取错的编码错误吞成「高德无结果」，全线静默降级到城市中心。
        # 静默兜底必须可见：打印一行，别让「没结果」掩盖 bug。
        print(f"[amap] 查询异常（按未命中降级）: {type(e).__name__}: {e}")
        result = None
    sess.cache[ck] = result
    return result


async def geocode_by_amap(name: str, city: str = "") -> tuple[float, float] | None:
    """高德 POI 兜底（GCJ-02 直出，无需转换）；未配 key / 未命中返回 None。"""
    hit = await geocode_amap_scored(name, city)
    return (hit[0], hit[1]) if hit else None


async def geocode_by_llm(
    name: str, city: str, llm_overrides: dict | None = None
) -> tuple[float, float] | None:
    """让 LLM 直接给出地名坐标（WGS84 → 转 GCJ-02）；拿不到或不可信返回 None。"""
    from .planner import _llm_config  # 延迟导入避免 planner ↔ coordinates 循环引用

    cfg = _llm_config(llm_overrides)
    if cfg is None:
        return None
    prompt = (
        f"请给出地名坐标。只输出 JSON：{{\"lat\": number, \"lng\": number, \"confidence\": \"high|low\"}}\n"
        f"地名：{name}\n所在城市：{city}\n"
        f"如果你不确定该地点的精确位置，输出 {{\"not_found\": true}}。"
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                endpoint(cfg["base_url"]) + "/chat/completions",
                headers={"Authorization": "Bearer " + cfg["api_key"]},
                json={
                    "model": cfg["model"],
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.0,
                },
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
        m = re.search(r"\{[\s\S]*\}", content)
        if not m:
            return None
        data = json.loads(m.group(0))
        if data.get("not_found") or not _valid_coord(data.get("lat"), data.get("lng")):
            return None
        return wgs84_to_gcj02(_round6(float(data["lat"])), _round6(float(data["lng"])))
    except Exception:
        return None


async def geocode_by_search(name: str, city: str) -> tuple[float, float] | None:
    """web_search 兜底：搜「地名 城市 坐标」，从结果文本中抓取坐标对（按 WGS84 → 转 GCJ-02）。"""
    key = env_value("ITERTRIP_SEARCH_API_KEY")  # 与其它配置同口径：env > 项目根 .env
    if not key:
        return None
    base = env_value("ITERTRIP_SEARCH_BASE_URL", "https://api.tavily.com").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                base + "/search",
                json={"api_key": key, "query": f"{name} {city} 经纬度 坐标", "max_results": 5},
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])
        text = " ".join(str(r.get("content", "")) for r in results)
        # 抓「30.65, 104.06」类坐标对
        for m in re.finditer(r"(\d{1,2}\.\d{3,})[°,，\s]+(\d{1,3}\.\d{3,})", text):
            lat, lng = float(m.group(1)), float(m.group(2))
            if _valid_coord(lat, lng):
                return wgs84_to_gcj02(_round6(lat), _round6(lng))
        return None
    except Exception:
        return None


async def geocode(
    name: str,
    city: str = "",
    llm_overrides: dict | None = None,
    traveler: str = "",
    *,
    hint_type: str = "",
    session: "AmapSession | None" = None,
) -> dict:
    """单点 geocode：返回 {name, lat, lng, confidence, source}（lat/lng 统一 GCJ-02）。

    confidence: high（记忆库真值 / 高德**强匹配** / LLM 确认）| low（高德弱匹配（含模糊兜底）/ 搜索兜底 / 城市中心）| none
    source:     memory | amap | llm | search | city | none（坐标最终出处，供路线溯源与轨迹展示）
    traveler 非空且记忆库开启时，先查坐标实体记忆（M18 第 0 级，用户手改 = 真值）。
    """
    # 0. 坐标实体记忆：用户手改过的坐标是 ground truth，优先于任何模型猜测与高德 POI
    if traveler:
        from . import memory_store

        if memory_store.enabled():
            mem = memory_store.find_entity(traveler, name, city)
            if mem:
                return {
                    "name": name, "lat": mem["lat"], "lng": mem["lng"],
                    "confidence": "high", "source": "memory",
                }

    # 1. 高德 POI（M19 一级坐标源：店名级精度，多候选打分择优选）
    #    M20：置信度跟随匹配分 —— 弱匹配/模糊兜底不再冒充「高德核验」
    amap = await geocode_amap_scored(name, city, hint_type, session)
    if amap:
        conf = "high" if amap[2] >= _AMAP_STRONG_SCORE else "low"
        return {"name": name, "lat": amap[0], "lng": amap[1], "confidence": conf, "source": "amap"}

    # 2. LLM 已知知识（知名地标可靠；小店可能幻觉，故在高德之后）
    llm = await geocode_by_llm(name, city, llm_overrides)
    if llm:
        return {"name": name, "lat": llm[0], "lng": llm[1], "confidence": "high", "source": "llm"}

    # 3. 搜索兜底
    found = await geocode_by_search(name, city)
    if found:
        return {"name": name, "lat": found[0], "lng": found[1], "confidence": "low", "source": "search"}

    # 4. 城市中心兜底（明确标注低置信度；WGS84 → 转 GCJ-02）
    #    M20：优先用解析出的省市名精确查表（"湖南·长沙" → 长沙），旧的字串包含规则作最后兜底
    provinces, cities = parse_region(city)
    for cand in [*cities, *provinces]:
        if cand in _CITY_CENTER:
            lat, lng = wgs84_to_gcj02(*_CITY_CENTER[cand])
            return {"name": name, "lat": lat, "lng": lng, "confidence": "low", "source": "city"}
    for city_name, center in _CITY_CENTER.items():
        if city_name in (city or "") or city_name in name:
            lat, lng = wgs84_to_gcj02(*center)
            return {"name": name, "lat": lat, "lng": lng, "confidence": "low", "source": "city"}

    # 5. 彻底失败
    return {"name": name, "lat": None, "lng": None, "confidence": "none", "source": "none"}
