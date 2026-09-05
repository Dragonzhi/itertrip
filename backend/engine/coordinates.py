"""坐标补全引擎（Phase 4 + 2026-09 准确性增强）。

降级链（全链路输出统一 GCJ-02，与高德瓦片显示一致）：
1. 优先 LLM 已知知识——LLM 对知名地标坐标的记忆是可靠且零成本的（WGS84 → 转 GCJ-02）
2. 次选高德 POI 搜索（店名级精度，中国 POI 覆盖最好；直接返回 GCJ-02）
3. 再选 web_search 取坐标（Tavily 兼容，境内外通用；文本坐标按 WGS84 → 转 GCJ-02）
4. 都拿不到 → 城市中心兜底，confidence: "low"，前端显示「⚠️ 坐标可能需要确认」

环境变量：
    ITERTRIP_LLM_API_KEY / ITERTRIP_LLM_BASE_URL / ITERTRIP_LLM_MODEL   同 planner
    ITERTRIP_AMAP_KEY          可选，高德 Web 服务 key（启用 POI 兜底）
    ITERTRIP_SEARCH_API_KEY    可选，启用搜索兜底（Tavily 兼容格式）
    ITERTRIP_SEARCH_BASE_URL   默认 https://api.tavily.com
"""

import json
import os
import re
from typing import Any

import httpx

from ._llmutil import endpoint
from .geo import wgs84_to_gcj02

# 高置信度：知名城市中心（WGS84，供城市级兜底；返回前统一转 GCJ-02）
_CITY_CENTER: dict[str, tuple[float, float]] = {
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
}


def _round6(v: float) -> float:
    return round(v * 1e6) / 1e6


def _valid_coord(lat: Any, lng: Any) -> bool:
    try:
        la, ln = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    return -90 <= la <= 90 and -180 <= ln <= 180 and not (la == 0 and ln == 0)


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


async def geocode_by_amap(name: str, city: str) -> tuple[float, float] | None:
    """高德 POI 搜索兜底（GCJ-02 直出，无需转换）；未配 key 或无结果返回 None。

    匹配校验：首个 POI 名称与查询名互相包含（或前 4 字重合）→ 视为命中。
    """
    key = os.environ.get("ITERTRIP_AMAP_KEY", "").strip()
    if not key:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                "https://restapi.amap.com/v3/place/text",
                params={
                    "key": key,
                    "keywords": name,
                    "city": city or "",
                    "citylimit": "true" if city else "false",
                    "offset": 5,
                    "page": 1,
                    "extensions": "base",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        pois = data.get("pois") or []
        if not pois or str(data.get("status")) != "1":
            return None
        loc = str(pois[0].get("location", "")).split(",")
        if len(loc) != 2 or not _valid_coord(loc[1], loc[0]):
            return None
        poi_name = str(pois[0].get("name", ""))
        # 名称相关性校验：完全不相关的首个 POI 不可信（如搜店名命中了同名公交站）
        n, q = poi_name.replace(" ", ""), name.replace(" ", "")
        related = n in q or q in n or (len(n) >= 2 and n[:4] == q[:4])
        if not related:
            return None
        return _round6(float(loc[1])), _round6(float(loc[0]))  # location 是 "lng,lat"
    except Exception:
        return None


async def geocode_by_search(name: str, city: str) -> tuple[float, float] | None:
    """web_search 兜底：搜「地名 城市 坐标」，从结果文本中抓取坐标对（按 WGS84 → 转 GCJ-02）。"""
    key = os.environ.get("ITERTRIP_SEARCH_API_KEY", "").strip()
    if not key:
        return None
    base = os.environ.get("ITERTRIP_SEARCH_BASE_URL", "https://api.tavily.com").rstrip("/")
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


async def geocode(name: str, city: str = "", llm_overrides: dict | None = None) -> dict:
    """单点 geocode：返回 {name, lat, lng, confidence}（lat/lng 统一 GCJ-02）。

    confidence: high（LLM 确认 / 高德 POI 名称命中）| low（搜索兜底 / 模糊 POI / 城市中心）
    """
    # 1. LLM 知识
    llm = await geocode_by_llm(name, city, llm_overrides)
    if llm:
        return {"name": name, "lat": llm[0], "lng": llm[1], "confidence": "high"}

    # 2. 高德 POI（店名级精度）
    amap = await geocode_by_amap(name, city)
    if amap:
        return {"name": name, "lat": amap[0], "lng": amap[1], "confidence": "high"}

    # 3. 搜索兜底
    found = await geocode_by_search(name, city)
    if found:
        return {"name": name, "lat": found[0], "lng": found[1], "confidence": "low"}

    # 4. 城市中心兜底（明确标注低置信度；WGS84 → 转 GCJ-02）
    for city_name, center in _CITY_CENTER.items():
        if city_name in (city or "") or city_name in name:
            lat, lng = wgs84_to_gcj02(*center)
            return {"name": name, "lat": lat, "lng": lng, "confidence": "low"}

    # 5. 彻底失败
    return {"name": name, "lat": None, "lng": None, "confidence": "none"}
