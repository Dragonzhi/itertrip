"""坐标补全引擎（Phase 4）。

策略（WEB_APP_PLAN.md §5.2）：
1. 优先 LLM 已知知识——LLM 对知名地标坐标的记忆是可靠且零成本的
2. 次选 web_search 取坐标（复用现有搜索 API key）
3. 都拿不到 → confidence: "low"，前端显示「⚠️ 坐标可能需要确认」

环境变量：
    ITERTRIP_LLM_API_KEY / ITERTRIP_LLM_BASE_URL / ITERTRIP_LLM_MODEL   同 planner
    ITERTRIP_SEARCH_API_KEY    可选，启用搜索兜底（Tavily 兼容格式）
    ITERTRIP_SEARCH_BASE_URL   默认 https://api.tavily.com
"""

import json
import os
import re
from typing import Any

import httpx

# 高置信度：知名城市中心（供城市级兜底）
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


async def geocode_by_llm(name: str, city: str) -> tuple[float, float] | None:
    """让 LLM 直接给出地名坐标；拿不到或不可信返回 None。"""
    from .planner import _llm_config  # 延迟导入避免 planner ↔ coordinates 循环引用

    cfg = _llm_config()
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
                cfg["base_url"] + "/chat/completions",
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
        return _round6(float(data["lat"])), _round6(float(data["lng"]))
    except Exception:
        return None


async def geocode_by_search(name: str, city: str) -> tuple[float, float] | None:
    """web_search 兜底：搜「地名 城市 坐标」，从结果文本中抓取坐标对。"""
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
                return _round6(lat), _round6(lng)
        return None
    except Exception:
        return None


async def geocode(name: str, city: str = "") -> dict:
    """单点 geocode：返回 {name, lat, lng, confidence}。

    confidence: high（LLM 确认/城市表命中）| low（搜索兜底/未命中给城市中心）
    """
    # 1. LLM 知识
    llm = await geocode_by_llm(name, city)
    if llm:
        return {"name": name, "lat": llm[0], "lng": llm[1], "confidence": "high"}

    # 2. 搜索兜底
    found = await geocode_by_search(name, city)
    if found:
        return {"name": name, "lat": found[0], "lng": found[1], "confidence": "low"}

    # 3. 城市中心兜底（明确标注低置信度）
    for city_name, center in _CITY_CENTER.items():
        if city_name in (city or "") or city_name in name:
            return {"name": name, "lat": center[0], "lng": center[1], "confidence": "low"}

    # 4. 彻底失败
    return {"name": name, "lat": None, "lng": None, "confidence": "none"}