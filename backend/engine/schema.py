"""route JSON 数据模型 —— 前后端共享的数据契约。

契约定义见 DESIGN.md §6。LLM 输出、API 请求/响应、HTML 注入均以此为准。
"""

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PriceItem(BaseModel):
    """单平台酒店报价。"""

    model_config = ConfigDict(extra="ignore")

    platform: str = Field(default="")
    price: float = Field(default=0)
    breakfast: bool = False
    note: str = ""


class Hotel(BaseModel):
    """当日酒店。"""

    name: str
    lat: float
    lng: float
    note: str = ""
    prices: list[PriceItem] = Field(default_factory=list)

    @field_validator("prices", mode="before")
    @classmethod
    def _sanitize_prices(cls, v):
        """容错清洗 LLM 幻觉的 prices：兼容 type→platform、缺 price 时直接丢弃。"""
        if v is None:
            return []
        if not isinstance(v, list):
            return []
        cleaned: list[dict] = []
        for item in v:
            if not isinstance(item, dict):
                continue
            # 兼容部分模型把 {type: "...", note: "..."} 当报价
            if "platform" not in item and "type" in item:
                item = {**item, "platform": str(item.get("type", "")).strip()}
                # 避免保留原 type 干扰后续 extra ignore 可不删
            platform = str(item.get("platform", "") or "").strip()
            raw_price = item.get("price", None)
            # price 缺失/不可转浮点 -> 视为无效报价，直接丢弃（而非让校验抛错导致整条路线失败）
            if raw_price is None or raw_price == "":
                continue
            try:
                price_val = float(raw_price)
            except (TypeError, ValueError):
                continue
            # 平台名空但有价格 -> 补一个兜底名，保留报价
            if not platform:
                item = {**item, "platform": "AI 生成"}
            # 统一回写合法的 price 浮点，避免字符串残留
            item = {**item, "price": price_val}
            cleaned.append(item)
        return cleaned


class Place(BaseModel):
    """行程地点。"""

    name: str
    lat: float
    lng: float
    type: str = "attraction"  # attraction / food / transport / other
    time: str = ""
    transport: str = ""
    ticket: str = ""
    note: str = ""


class DayPlan(BaseModel):
    """单日行程。"""

    day: int
    theme: str = ""
    places: list[Place] = Field(default_factory=list)
    hotel: Hotel | None = None


class TripInfo(BaseModel):
    """行程元信息。"""

    title: str
    destination: str
    days: int
    dates: str = ""
    budget: str = ""
    style: str = ""
    travelers: str = ""


class RouteJSON(BaseModel):
    """route JSON 顶层结构（注入模板的 __TRIP_DATA__）。"""

    trip: TripInfo
    days: list[DayPlan] = Field(min_length=1)
    summary: list[str] = Field(default_factory=list)
