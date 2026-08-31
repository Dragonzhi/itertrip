"""route JSON 数据模型 —— 前后端共享的数据契约。

契约定义见 DESIGN.md §6。LLM 输出、API 请求/响应、HTML 注入均以此为准。
"""

from pydantic import BaseModel, Field


class PriceItem(BaseModel):
    """单平台酒店报价。"""

    platform: str
    price: float
    breakfast: bool = False
    note: str = ""


class Hotel(BaseModel):
    """当日酒店。"""

    name: str
    lat: float
    lng: float
    note: str = ""
    prices: list[PriceItem] = Field(default_factory=list)


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