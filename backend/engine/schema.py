"""route JSON 数据模型 —— 前后端共享的数据契约。

契约定义见 DESIGN.md §6。LLM 输出、API 请求/响应、HTML 注入均以此为准。
"""

import re

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
    note: str = ""


class Hotel(BaseModel):
    """当日酒店。"""

    name: str
    lat: float
    lng: float
    note: str = ""
    prices: list[PriceItem] = Field(default_factory=list)
    # M19 坐标溯源（可选、向后兼容）：source=memory|user|amap|llm|search|city，confidence=high|low|none
    source: str = ""
    confidence: str = ""

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
                "platform": platform,
                "price": price_val,
                "breakfast": _coerce_bool(item.get("breakfast")),
                "note": str(item.get("note") or "").strip(),
            })
        if dropped:
            print(f"[schema] 报价清洗：修复/保留了 {len(cleaned)} 条，丢弃 {dropped} 条无价格条目")
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
    # M19 坐标溯源（可选、向后兼容）：source=memory|user|amap|llm|search|city，confidence=high|low|none
    source: str = ""
    confidence: str = ""
    # M22 事实告警（可选、向后兼容）：确定性检查写出的可见警告，如「闭馆日：周一闭馆，当天为周一」
    # 刻意**不复用 note** —— note 是给用户看的贴士，塞系统告警正是审计发现的坏味道
    warnings: list[str] = Field(default_factory=list)


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
    # M22 结构化出发日期（可选、向后兼容）：dates 是给人看的自由文本，算不出星期；
    # start_date 是给机器算的 YYYY-MM-DD，date_source ∈ user|inferred|""（界面据此标注「推断」）
    start_date: str = ""
    date_source: str = ""


class RouteJSON(BaseModel):
    """route JSON 顶层结构（注入模板的 __TRIP_DATA__）。"""

    trip: TripInfo
    days: list[DayPlan] = Field(min_length=1)
    summary: list[str] = Field(default_factory=list)
