"""M39：首次生成路线时补一份可执行的默认时间安排。

为什么需要它：M27 只定义了 schedule / visit 的数据契约，提示词从未要求模型输出，
所以新行程永远是「时间未定、停留未设置」，用户要先手工填一遍才能看到任何时间。
现在改成「AI 预排 + 确定性兜底」：模型给出合理起止与停留；漏掉的按类型补一个保守值。
所有自动填入的值都标 estimate（界面显示「AI 预排」），用户改过后才变成 user。

只用于首次生成（/api/plan、/api/chat 提取模式、mock）。编辑旧路线不调用，
避免把用户已经删掉/留空的时间重新补回来。
"""
from __future__ import annotations

import math
import re

from .schema import DaySchedule, RouteJSON, VisitPlan

_CLOCK_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DEFAULT_START = "09:00"
_DEFAULT_END = "18:00"
# 保守的默认停留：宁可给短一点，也不要在首次生成时制造一整天的硬冲突。
_DURATION_BY_TYPE = {
    "attraction": 90,
    "food": 60,
    "transport": 30,
    "other": 60,
}


def _clock(value: str) -> int | None:
    s = (value or "").strip()
    if not _CLOCK_RE.match(s):
        return None
    return int(s[:2]) * 60 + int(s[3:])


def _valid_duration(value: float | None) -> bool:
    return value is not None and math.isfinite(value) and 0 <= value <= 1440


def _fill_day_schedule(day) -> bool:
    """补齐一天的起止；返回是否改动了 schedule。"""
    current = day.schedule
    start, end = (current.start if current else ""), (current.end if current else "")
    start_min, end_min = _clock(start), _clock(end)
    changed = False
    if start_min is None or end_min is None or end_min <= start_min:
        start, end = _DEFAULT_START, _DEFAULT_END
        changed = True
    # 首次生成的所有起止都来自模型或兜底，不允许模型自称 user。
    if current is None or current.start != start or current.end != end or current.source != "estimate":
        day.schedule = DaySchedule(start=start, end=end, source="estimate")
        changed = True
    return changed


def fill_default_schedule(route: RouteJSON) -> dict[str, int]:
    """给首次生成的路线补默认起止与停留；原地修改并返回计数。"""
    stats = {"days": 0, "durations": 0}
    for day in route.days:
        if _fill_day_schedule(day):
            stats["days"] += 1
        for place in day.places:
            visit = place.visit or VisitPlan()
            changed = False
            if not _valid_duration(visit.duration_min):
                visit.duration_min = _DURATION_BY_TYPE.get((place.type or "").strip(), 60)
                changed = True
            if visit.duration_source != "estimate":
                visit.duration_source = "estimate"
                changed = True
            if visit.kind == "visit" and (place.type or "").strip() == "food":
                visit.kind = "meal"
                changed = True
            if changed:
                place.visit = visit
                stats["durations"] += 1
        # 酒店不补停留：酒店是到达/入住边界，不是当天游玩时长。
    return stats
