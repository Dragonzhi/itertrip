"""POST /api/search —— 酒店价格搜索（可选能力，对应 RollingGo MCP 的 Web 替代）。

数据源策略（不强制）：
1. RollingGo 公开 API（若 ITERTRIP_ROLLINGO_BASE_URL 配置）
2. Tavily 兼容搜索（若 ITERTRIP_SEARCH_API_KEY 配置）——从结果抽取价格数字
3. 都没配 → 返回空报价 + 提示，前端保持「价格由用户手动提供」的兜底体验
"""

import re
import math
from datetime import datetime, timezone, date
from urllib.parse import urlparse, urlencode

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field
from ..engine._llmutil import env_value
from ..engine.schema import _coerce_bool

router = APIRouter()


class SearchRequest(BaseModel):
    hotel: str = Field(min_length=1, max_length=150)
    city: str = Field(default="", max_length=150)
    checkIn: str = Field(default="", max_length=30)
    checkOut: str = Field(default="", max_length=30)


class PriceItemOut(BaseModel):
    platform: str
    price: float
    breakfast: bool = False
    breakfast_known: bool = False
    note: str = ""
    source_url: str = ""
    queried_at: str = ""
    check_in: str = ""
    check_out: str = ""
    room: str = ""
    occupancy: str = ""
    cancellation: str = ""
    unit: str = ""


def _url(value: str) -> str:
    try:
        u = urlparse(value)
        return value if u.scheme in ("https", "http") and u.hostname and not u.username and not u.password else ""
    except ValueError:
        return ""


def _dates(start: str, end: str) -> bool:
    try:
        return date.fromisoformat(start) < date.fromisoformat(end)
    except (ValueError, TypeError):
        return False


class FactSearchRequest(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    city: str = Field(default="", max_length=150)
    date: str = Field(default="", max_length=30)


@router.post("/api/route/facts/search")
async def search_facts(req: FactSearchRequest) -> dict:
    """Return source leads only. Never turn snippets into confirmed facts or reservations."""
    key = env_value("ITERTRIP_SEARCH_API_KEY").strip()
    if not key:
        return {"candidates": [], "note": "未配置搜索服务，请直接查阅地点官方网站／官方公告或地图资料并记录来源。"}
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.post(env_value("ITERTRIP_SEARCH_BASE_URL", "https://api.tavily.com").rstrip("/") + "/search", json={"api_key": key, "query": f"{req.city} {req.name} {req.date} 官方公告 开放时间 最后入场 预约 闭馆", "max_results": 5})
            resp.raise_for_status()
            results = resp.json().get("results", [])
        candidates = [{"title": str(r.get("title") or "资料线索")[:200], "url": _url(str(r.get("url") or "")), "excerpt": str(r.get("content") or "")[:900]} for r in results[:5] if isinstance(r, dict) and _url(str(r.get("url") or ""))]
        return {"candidates": candidates, "note": "搜索线索尚未核实。优先打开地点官方公告／地图页面，核对具体场馆、日期及例外，再确认结构化资料。"}
    except Exception:
        return {"candidates": [], "note": "资料搜索暂不可用，请手工查阅来源；当前开放规则仍未评估。"}


def _extract_prices(text: str) -> list[float]:
    """从搜索结果文本抽取合理区间内的价格数字（100-99999）。"""
    prices = []
    for m in re.finditer(r"[¥￥]\s?(\d{2,6})", text):
        v = float(m.group(1))
        if 100 <= v <= 99999:
            prices.append(v)
    return sorted(set(prices))[:5]


@router.post("/api/search")
async def search_route(req: SearchRequest) -> dict:
    prices: list[PriceItemOut] = []
    source = "none"
    queried_at = datetime.now(timezone.utc).isoformat()

    # 1. RollingGo（可选）
    rg_base = env_value("ITERTRIP_ROLLINGO_BASE_URL").strip().rstrip("/")
    if rg_base:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    rg_base + "/hotel/prices",
                    json={"hotel": req.hotel, "city": req.city,
                          "checkIn": req.checkIn, "checkOut": req.checkOut},
                )
                resp.raise_for_status()
                data = resp.json()
            for item in data.get("prices", []):
                value = float(item["price"])
                if not math.isfinite(value) or value <= 0:
                    continue
                prices.append(PriceItemOut(
                    platform=str(item.get("platform", "RollingGo")),
                    price=value,
                    breakfast=_coerce_bool(item.get("breakfast", False)),
                    breakfast_known=isinstance(item.get("breakfast"), bool),
                    note=str(item.get("note", "")),
                    source_url=_url(str(item.get("source_url") or item.get("url") or "")),
                    queried_at=queried_at,
                    # A provider must explicitly associate its quote with these conditions.
                    check_in=str(item.get("check_in") or item.get("checkIn") or ""),
                    check_out=str(item.get("check_out") or item.get("checkOut") or ""),
                    room=str(item.get("room") or ""), occupancy=str(item.get("occupancy") or ""),
                    cancellation=str(item.get("cancellation") or ""),
                    unit=item.get("unit") if item.get("unit") in ("night", "stay") else "",
                ))
            source = "rollinggo"
        except Exception:
            pass

    # 2. 搜索 API 兜底（可选）
    if not prices:
        key = env_value("ITERTRIP_SEARCH_API_KEY").strip()
        base = env_value("ITERTRIP_SEARCH_BASE_URL", "https://api.tavily.com").rstrip("/")
        if key:
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        base + "/search",
                        json={"api_key": key, "query": f"{req.city} {req.hotel} 入住 {req.checkIn or '日期未定'} 离店 {req.checkOut or '日期未定'} 房价 每晚", "max_results": 5},
                    )
                    resp.raise_for_status()
                    results = resp.json().get("results", [])
                for r in results[:5]:
                    for v in _extract_prices(str(r.get("content", ""))):
                        prices.append(PriceItemOut(platform=str(r.get("title") or "搜索参考")[:100], price=v, note="搜索提及价格，具体日期与房型等条件未核实", source_url=_url(str(r.get("url") or "")), queried_at=queried_at))
                if prices:
                    source = "search"
            except Exception:
                pass

    booking_url = "https://hotels.ctrip.com/hotels/list?" + urlencode({"keyword": req.hotel, "checkIn": req.checkIn, "checkOut": req.checkOut}) if req.hotel else ""
    return {
        "prices": [p.model_dump() for p in prices],
        "bookingUrl": booking_url,
        "source": source,
        "context": {"check_in": req.checkIn, "check_out": req.checkOut, "dates_known": _dates(req.checkIn, req.checkOut)},
        "note": "价格为公开信息抓取，时效性与准确性不作保证；最可靠方式仍是用户手动提供报价" if prices else "未配置价格源（ITERTRIP_ROLLINGO_BASE_URL / ITERTRIP_SEARCH_API_KEY），请手动提供报价",
    }
