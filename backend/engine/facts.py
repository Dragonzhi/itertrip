"""行程事实校验（M22）：出发日期推断 + 闭馆日冲突检查。

**为什么单独一层**：坐标有 M19–M21 的多级核验与溯源，而 `time`/`ticket`/`note`
一直是「模型/攻略写什么就是什么」。本模块只做其中**可判定**的一小块，
判据全部是确定性算术（日期 + 星期），**不调用任何模型、不发起任何网络请求** ——
避免「再引入一次幻觉」来治幻觉。

事故背景：`trip.dates` 是自由文本（「10月1日下午 – 10月6日晚上（国庆假期）」），
不含年份 → 后端算不出「这天星期几」→ 一条真实交付物把「周一闭馆」的
谢子龙影像艺术馆排在了周一（D5），系统毫无察觉（全仓 `weekday` 零命中）。

明确不覆盖（见 docs/M22_FACT_CLOSURE_PLAN.md）：
- **农历节日**的年份推断：元旦/清明/五一/国庆为阳历固定，春节/端午/中秋不猜；
- 「M月D日闭园」这类**一次性公告**；
- 营业时间 vs 参观时段冲突、单日时段重叠（本轮范围外）。

判据原则（沿用 M19「静默兜底必须变成可见决策」）：
解析不出日期时返回 `checked=False`，由界面如实说明「未检查」，**不假装通过**。
"""

from __future__ import annotations

import re
from datetime import date, timedelta

# ---------------- 常量 ----------------

#: 告警前缀：本模块只为带此前缀的条目负责（幂等重写时只清理自己的，不动别人的）
WARN_PREFIX = "闭馆日："

_WEEKDAY_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
_WEEKDAY_CHARS = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}

# 「周一闭馆 / 每周一闭馆 / 星期一不开放 / 週一休館 / 周一休息」简繁两套字形
_CLOSURE_RE = re.compile(
    r"(?:周|週|星期|礼拜|禮拜)\s*([一二三四五六日天])\s*(?:例行|固定)?\s*"
    r"(?:闭馆|閉館|闭园|閉園|不开放|不開放|休馆|休館|休息|闭关|閉關)"
)

# 「（法定节假日除外）/ 节假日正常开放」—— 落在闭馆词附近的例外声明
_EXEMPT_RE = re.compile(
    r"(?:法定|节假日|節假日|黄金周|黃金周|国庆|國慶|长假|長假|假期)"
    r"[^。；;\n]{0,16}?(?:除外|正常开放|正常開放|不休|照常|正常接待|另行通知)"
)

# 中文日期：2026年10月1日 / 10月1日 / 10月1号
_DATE_CN_RE = re.compile(r"(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?")
# ISO 日期：2026-10-01 / 2026/10/1
_DATE_ISO_RE = re.compile(r"(?<![\d])(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?![\d])")

# 阳历固定的节日锚点（农历节日一律不猜，宁可让用户自己填）
_FESTIVAL_ANCHORS: list[tuple[str, int, int]] = [
    (r"元旦", 1, 1),
    (r"清明节?", 4, 4),
    (r"劳动节|五一", 5, 1),
    (r"国庆节?|十一", 10, 1),
]


# ---------------- 闭馆规则解析 ----------------


def parse_closures(text: str) -> list[dict]:
    """从一段文本里解析「星期几闭馆」规则。

    返回 `[{day: 0-6（0=周一）, claim: 命中的原文, holiday_exempt: bool}]`。
    同一句里「周一闭馆（法定节假日除外）」→ `holiday_exempt=True`（由调用方决定抑制）。

    已知不覆盖：`周一、周二闭馆` 这类顿号枚举只认到「周二闭馆」一条。
    """
    if not text or not isinstance(text, str):
        return []
    out: list[dict] = []
    seen: set[tuple[int, str]] = set()
    for m in _CLOSURE_RE.finditer(text):
        day = _WEEKDAY_CHARS.get(m.group(1))
        if day is None:
            continue
        claim = m.group(0).strip()
        # 例外声明必须落在闭馆词附近，避免另一句话里的「节假日」误伤
        window = text[max(0, m.start() - 8) : m.end() + 24]
        key = (day, claim)
        if key in seen:
            continue
        seen.add(key)
        out.append({"day": day, "claim": claim, "holiday_exempt": bool(_EXEMPT_RE.search(window))})
    return out


# ---------------- 出发日期推断 ----------------


def _mk_date(y: int, m: int, d: int) -> date | None:
    """构造日期，非法组合（2月30日等）返回 None。"""
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _next_occurrence(month: int, day: int, today: date) -> date | None:
    """今年的这个月日；已过则取明年（「默认就是今年」的就近未来口径）。"""
    cur = _mk_date(today.year, month, day)
    if cur is None:
        return None
    if cur < today:
        return _mk_date(today.year + 1, month, day)
    return cur


def resolve_start_date(*texts: str, today: date | None = None) -> tuple[str, str]:
    """从若干段文本里定出发日期，返回 `(iso, source)`。

    source 语义：
    - `"user"`     —— 文本里写明了完整日期（含年份），视为用户给定
    - `"inferred"` —— 只有月日或节日名，按「就近未来」推断出年份
    - `""`         —— 定不了（调用方据此如实说「未检查」）

    优先级：完整日期 > 月日 > 节日锚点。先命中的文本优先（调用方按可信度排序传入）。
    """
    today = today or date.today()
    items = [t for t in texts if isinstance(t, str) and t.strip()]

    # ① 完整日期（含年份）
    for t in items:
        m = _DATE_ISO_RE.search(t)
        if m and _mk_date(int(m.group(1)), int(m.group(2)), int(m.group(3))):
            d = _mk_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            return d.isoformat(), "user"  # type: ignore[union-attr]
    for t in items:
        m = _DATE_CN_RE.search(t)
        if m and m.group(1):
            d = _mk_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            if d:
                return d.isoformat(), "user"

    # ② 只有月日 → 就近未来
    for t in items:
        m = _DATE_CN_RE.search(t)
        if m:
            d = _next_occurrence(int(m.group(2)), int(m.group(3)), today)
            if d:
                return d.isoformat(), "inferred"

    # ③ 节日锚点（仅阳历固定节日）
    for t in items:
        for pat, mn, dd in _FESTIVAL_ANCHORS:
            if re.search(pat, t):
                d = _next_occurrence(mn, dd, today)
                if d:
                    return d.isoformat(), "inferred"

    return "", ""


# ---------------- 路线级检查 ----------------


def _iter_places(route):
    for d in route.days:
        for p in d.places:
            yield p


def summary_text(result: dict) -> str:
    """把检查结果压成一行中文（供决策轨迹 / 提示条复用）。"""
    if not result.get("checked"):
        return "未提供出发日期，未检查闭馆日"
    conflicts = result.get("conflicts") or []
    parts: list[str] = []
    if conflicts:
        parts.append(f"{len(conflicts)} 处闭馆日冲突")
        parts.append("、".join(f"D{c['day']} {c['name']}" for c in conflicts[:3]))
    else:
        parts.append("无闭馆日冲突")
    if result.get("skipped"):
        parts.append(f"{result['skipped']} 处因标注节假日除外未判定")
    return " · ".join(parts)


def annotate_route(route, hint: str = "", today: date | None = None) -> dict:
    """就地补全 `trip.start_date` 并写 `place.warnings`，返回检查结果。

    幂等：每次只重写自己写的 `WARN_PREFIX` 条目，重复调用不产生重复告警，
    改日期后也不会残留上一次的结论（这正是「改一下日期告警就消失」的机制）。

    返回 `{checked, reason, conflicts, skipped, start_date, date_source}`。
    """
    trip = route.trip
    start = (getattr(trip, "start_date", "") or "").strip()
    source = (getattr(trip, "date_source", "") or "").strip()

    # 先清空本模块上次写入的告警（幂等）
    for p in _iter_places(route):
        if p.warnings:
            p.warnings = [w for w in p.warnings if not w.startswith(WARN_PREFIX)]

    if not start:
        start, source = resolve_start_date(trip.dates, trip.title, hint, today=today)
        if start:
            trip.start_date, trip.date_source = start, source

    result: dict = {
        "checked": False,
        "reason": "",
        "conflicts": [],
        "skipped": 0,
        "start_date": start,
        "date_source": source,
    }
    if not start:
        result["reason"] = "no_date"
        return result

    base = _mk_date(int(start[0:4]), int(start[5:7]), int(start[8:10])) if len(start) >= 10 else None
    if base is None:
        result["reason"] = "bad_date"
        return result

    result["checked"] = True
    for idx, d in enumerate(route.days):
        cur = base + timedelta(days=idx)  # D1 = 出发日
        wd = cur.weekday()  # 0=周一
        for p in d.places:
            text = " ".join(x for x in (p.ticket, p.note, p.time) if x)
            for c in parse_closures(text):
                if c["day"] != wd:
                    continue
                if c["holiday_exempt"]:
                    # 无法确定法定假日表 → 宁可不报，只计入 skipped（界面会如实说明）
                    result["skipped"] += 1
                    continue
                suffix = "，日期为推断" if source == "inferred" else ""
                warn = (
                    f"{WARN_PREFIX}{c['claim']}，当天为{_WEEKDAY_CN[wd]}"
                    f"（D{d.day} · {cur.isoformat()}{suffix}）"
                )
                if warn not in (p.warnings or []):
                    p.warnings = [*(p.warnings or []), warn]
                result["conflicts"].append({
                    "name": p.name,
                    "day": d.day,
                    "date": cur.isoformat(),
                    "weekday": _WEEKDAY_CN[wd],
                    "claim": c["claim"],
                    "warning": warn,
                })
    return result
