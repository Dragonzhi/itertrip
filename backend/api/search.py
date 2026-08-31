"""POST /api/search —— 酒店价格搜索（可选能力，对应 RollingGo MCP 的 Web 替代）。

数据源策略（不强制）：
1. RollingGo 公开 API（若 ITERTRIP_ROLLINGO_BASE_URL 配置）
2. Tavily 兼容搜索（若 ITERTRIP_SEARCH_API_KEY 配置）——从结果抽取价格数字
3. 都没配 → 返回空报价 + 提示，前端保持「价格由用户手动提供」的兜底体验
"""

import os
import re
from typing import Any

import httpx
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()


class SearchRequest(BaseModel):
    hotel: str = Field(min_length=1)
    city: str = ""
    checkIn: str = ""
    checkOut: str = ""


class PriceItemOut(BaseModel):
    platform: str
    price: float
    breakfast: bool = False
    note: str = ""


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

    # 1. RollingGo（可选）
    rg_base = os.environ.get("ITERTRIP_ROLLINGO_BASE_URL", "").strip().rstrip("/")
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
                prices.append(PriceItemOut(
                    platform=str(item.get("platform", "RollingGo")),
                    price=float(item["price"]),
                    breakfast=bool(item.get("breakfast", False)),
                    note=str(item.get("note", "")),
                ))
            source = "rollinggo"
        except Exception:
            pass

    # 2. 搜索 API 兜底（可选）
    if not prices:
        key = os.environ.get("ITERTRIP_SEARCH_API_KEY", "").strip()
        base = os.environ.get("ITERTRIP_SEARCH_BASE_URL", "https://api.tavily.com").rstrip("/")
        if key:
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        base + "/search",
                        json={"api_key": key, "query": f"{req.city} {req.hotel} 房价 每晚", "max_results": 5},
                    )
                    resp.raise_for_status()
                    results = resp.json().get("results", [])
                found = _extract_prices(" ".join(str(r.get("content", "")) for r in results))
                for i, v in enumerate(found):
                    prices.append(PriceItemOut(platform=f"搜索参考{i + 1}", price=v, note="来自公开搜索结果，仅供参考"))
                if prices:
                    source = "search"
            except Exception:
                pass

    booking_url = f"https://hotels.ctrip.com/hotels/list?city=&keyword={req.hotel}" if req.hotel else ""
    return {
        "prices": [p.model_dump() for p in prices],
        "bookingUrl": booking_url,
        "source": source,
        "note": "价格为公开信息抓取，时效性与准确性不作保证；最可靠方式仍是用户手动提供报价" if prices else "未配置价格源（ITERTRIP_ROLLINGO_BASE_URL / ITERTRIP_SEARCH_API_KEY），请手动提供报价",
    }
