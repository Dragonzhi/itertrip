"""route JSON 数据模型 —— 前后端共享的数据契约。

契约定义见 DESIGN.md §6。LLM 输出、API 请求/响应、HTML 注入均以此为准。
"""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

#: 报价字段的常见别名（模型各写各的：amount / price_per_night / 房价…）
_PRICE_KEYS = ("price", "amount", "price_per_night", "nightly_price", "avg_price", "average_price",
               "value", "cost", "价格", "房价")
#: 平台名常见别名（模型有时用 name / channel / source 代替 platform）
_PLATFORM_KEYS = ("platform", "name", "source", "channel", "vendor", "type", "平台")
_NUM_RE = re.compile(r"\d+(?:\.\d+)?")
_TRUE_WORDS = ("true", "1", "yes", "y", "含早", "有早", "含早餐", "包早", "是")


def _pick(item: dict, keys: tuple[str, ...]) -> str:
    """按别名顺序取第一个非空字符串值。"""
    for k in keys:
        if k in item:
            v = item.get(k)
            if v is not None and str(v).strip():
                return str(v).strip()
    return ""


def _coerce_price(raw) -> float | None:
    """把模型五花八门的写法收敛成一个数：`100` / `"100"` / `"¥100元"` / `"约100/晚"` → 100.0。

    取不出数字返回 None（此时该条不是报价，调用方丢弃）。
    """
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).strip()
    if not s:
        return None
    m = _NUM_RE.search(s)
    return float(m.group(0)) if m else None


def _coerce_bool(raw) -> bool:
    """早餐标记：接受 True/1/"true"/"含早"/"是"，其余（"false"/"无早"/""）为 False。

    显式收敛，避免 `breakfast: "否"` 这类写法直接抛 ValidationError 把整条路线打掉。
    """
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return raw != 0
    return str(raw or "").strip().lower() in _TRUE_WORDS


class PriceItem(BaseModel):
    """单平台酒店报价。"""

    model_config = ConfigDict(extra="ignore")

    platform: str = Field(default="")
    price: float = Field(default=0)
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
    unit: Literal["", "night", "stay"] = ""


class Reservation(BaseModel):
    type: Literal["entry", "train", "hotel", "other"] = "entry"
    date: str = ""
    start: str = ""
    end: str = ""
    status: Literal["needed", "pending", "confirmed", "cancelled"] = "needed"
    url: str = ""


class VisitPlan(BaseModel):
    duration_min: float | None = Field(default=None, ge=0, le=1440, allow_inf_nan=False)
    duration_source: Literal["user", "estimate"] = "estimate"
    kind: Literal["visit", "meal", "rest"] = "visit"
    required: bool = False
    locked: bool = False
    completed: bool = False
    reservation: Reservation | None = None


class OpeningFact(BaseModel):
    place_name: str = ""
    entry_policy: Literal["unknown", "none", "last_entry"] = "unknown"
    open: str = ""
    close: str = ""
    last_entry: str = ""
    closed: bool = False
    reservation_required: bool = False
    weekdays: list[int] = Field(default_factory=list)
    valid_from: str = ""
    valid_to: str = ""
    source_kind: Literal["official", "map", "user"] = "user"
    source_url: str = ""
    checked_at: str = ""
    confirmed: bool = False

    @field_validator("weekdays")
    @classmethod
    def _weekdays(cls, v):
        if any(d < 1 or d > 7 for d in v):
            raise ValueError("weekday must be 1..7")
        return v


class WeatherExposure(BaseModel):
    environment: Literal['indoor', 'outdoor', 'mixed', 'unknown'] = 'unknown'
    rain_sensitive: bool = True
    source: Literal['user'] = 'user'
    place_name: str = ''
    confirmed_at: str = ''


class WeatherHour(BaseModel):
    start: str
    end: str
    probability: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False, strict=True)
    precipitation_mm: float | None = Field(default=None, ge=0, le=1000, allow_inf_nan=False, strict=True)


class WeatherForecast(BaseModel):
    provider: Literal['qweather', 'open_meteo']
    source_url: str = ''
    attributions: list[str] = Field(default_factory=list, max_length=8)
    queried_at: str
    issued_at: str | None = None
    timezone: str
    granularity: Literal['hourly', 'daily'] = 'hourly'
    kind: Literal['forecast', 'historical'] = 'forecast'
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lng: float = Field(ge=-180, le=180, allow_inf_nan=False)
    valid_from: str
    valid_to: str
    hours: list[WeatherHour] = Field(default_factory=list, max_length=400)
    refresh_error: str = ''


class WeatherPolicy(BaseModel):
    probability: float = Field(default=60, ge=1, le=100, allow_inf_nan=False, strict=True)
    precipitation_mm: float = Field(default=0.5, ge=0.1, le=100, allow_inf_nan=False, strict=True)


class Hotel(BaseModel):
    """当日酒店。"""

    name: str
    id: str = ""
    poi_id: str = ""
    city_code: str = ""
    lat: float
    lng: float
    note: str = ""
    prices: list[PriceItem] = Field(default_factory=list)
    # M19 坐标溯源（可选、向后兼容）：source=memory|user|amap|llm|search|city，confidence=high|low|none
    source: str = ""
    confidence: str = ""
    verdict: str = ""
    bookingUrl: str = ""
    visit: VisitPlan | None = None
    opening: list[OpeningFact] = Field(default_factory=list)
    weather_exposure: WeatherExposure | None = None

    @field_validator("prices", mode="before")
    @classmethod
    def _sanitize_prices(cls, v):
        """把 LLM 写出的报价**尽量修好**，只有「压根没有价格」的条目才丢弃。

        M22.3 之前这里是**静默丢弃**：`price: "100元"` / `amount: 100` / `prices` 给成对象
        都会被无声吃掉 —— 于是模型在 reply 里说「已设为 100 元」，数据里却什么都没有，
        用户看到的就是「说了没做」。现在按别名与数值解析修复；真正丢了会打印一行日志。
        """
        dropped = 0
        if isinstance(v, dict):  # 有些模型把单条报价写成了对象而不是数组
            v = [v]
        if not isinstance(v, list):
            return []
        cleaned: list[dict] = []
        for item in v:
            if not isinstance(item, dict):
                dropped += 1
                continue
            raw_price = None
            for k in _PRICE_KEYS:
                if k in item and item.get(k) not in (None, ""):
                    raw_price = item.get(k)
                    break
            price_val = _coerce_price(raw_price)
            if price_val is None:
                dropped += 1  # 没有价格的条目（如 {type, note} 的纯备注）本就不算报价
                continue
            platform = _pick(item, _PLATFORM_KEYS)
            if not platform:
                platform = "AI 生成"  # 平台名缺失但价格有效 → 兜底名，保留报价
            cleaned.append({
                **{k: item[k] for k in ("source_url", "queried_at", "check_in", "check_out", "room", "occupancy", "cancellation", "unit") if k in item},
                "platform": platform,
                "price": price_val,
                "breakfast": _coerce_bool(item.get("breakfast")),
                "breakfast_known": _coerce_bool(item.get("breakfast_known", False)),
                "note": str(item.get("note") or "").strip(),
            })
        if dropped:
            print(f"[schema] 报价清洗：修复/保留了 {len(cleaned)} 条，丢弃 {dropped} 条无价格条目")
        return cleaned


class Place(BaseModel):
    """行程地点。"""

    name: str
    id: str = ""
    poi_id: str = ""
    city_code: str = ""
    lat: float
    lng: float
    type: str = "attraction"  # attraction / food / transport / other
    time: str = ""
    transport: str = ""
    ticket: str = ""
    note: str = ""
    # M19 坐标溯源（可选、向后兼容）：source=memory|user|amap|llm|search|city，confidence=high|low|none
    source: str = ""
    confidence: str = ""
    # M22 事实告警（可选、向后兼容）：确定性检查写出的可见警告，如「闭馆日：周一闭馆，当天为周一」
    # 刻意**不复用 note** —— note 是给用户看的贴士，塞系统告警正是审计发现的坏味道
    warnings: list[str] = Field(default_factory=list)
    visit: VisitPlan | None = None
    opening: list[OpeningFact] = Field(default_factory=list)
    weather_exposure: WeatherExposure | None = None


class TransportOption(BaseModel):
    mode: Literal["walk", "bus", "car"]
    status: Literal["ok", "unknown"]
    reason: str = ""
    duration_s: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    distance_m: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    walking_m: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    fee_yuan: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    tolls_yuan: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    fee_kind: str = ""
    description: str = ""
    queried_at: str
    source: Literal["amap"] = "amap"
    source_url: str = "https://lbs.amap.com/api/webservice/guide/api/direction"


class TransportSnapshot(BaseModel):
    refresh_error: str = ""
    signature: str
    options: list[TransportOption] = Field(default_factory=list)


class TransportSegment(BaseModel):
    from_id: str
    to_id: str
    mode: Literal["", "walk", "bus", "car"] = ""
    buffer_min: float = Field(default=0, ge=0, le=180)
    snapshot: TransportSnapshot | None = None


class DaySchedule(BaseModel):
    start: str = ""
    end: str = ""


class DayPlan(BaseModel):
    """单日行程。"""

    day: int
    theme: str = ""
    places: list[Place] = Field(default_factory=list)
    hotel: Hotel | None = None
    # M26：可选交通设置与查询快照；旧路线兼容。查询结果只由交通服务生成。
    traffic_mode: Literal["", "walk", "bus", "car"] = ""
    start_from_hotel: bool | None = None
    transport: list[TransportSegment] = Field(default_factory=list)
    schedule: DaySchedule | None = None


class TripInfo(BaseModel):
    """行程元信息。"""

    title: str
    destination: str
    days: int
    dates: str = ""
    budget: str = ""
    style: str = ""
    travelers: str = ""
    # M22 结构化出发日期（可选、向后兼容）：dates 是给人看的自由文本，算不出星期；
    # start_date 是给机器算的 YYYY-MM-DD，date_source ∈ user|inferred|""（界面据此标注「推断」）
    start_date: str = ""
    date_source: str = ""


class AgentReceipt(BaseModel):
    id: str = Field(pattern=r'^[A-Za-z0-9_-]{8,80}$')
    payload: str = Field(max_length=16000)


class RouteJSON(BaseModel):
    """route JSON 顶层结构（注入模板的 __TRIP_DATA__）。"""

    trip: TripInfo
    days: list[DayPlan] = Field(min_length=1)
    summary: list[str] = Field(default_factory=list)
    weather: list[WeatherForecast] = Field(default_factory=list, max_length=64)
    weather_policy: WeatherPolicy | None = None
    agent_receipts: list[AgentReceipt] = Field(default_factory=list, max_length=1000)
