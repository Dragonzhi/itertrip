"""M22.3 确定性酒店报价设置：把「把第X天 / 每天 酒店报价改为 N 元」直接落到 `hotel.prices`。

**为什么要有它**：这条请求连续两次被模型「说了没做」——第一次只回叙述不给 JSON，
第二次给了 JSON、`changed=true`、轨迹也显示「已应用路线改动」，**但报价字段没动**
（模型在报价上写错键名 / 只把结论写进 reply）。报价是**单值、结构化**的意图，
判据完全可以确定性化（与 M22 闭馆日同一思路：能算的别问模型）。

**范围刻意很窄**，解析不出就返回 `None` 交回模型，绝不猜：

- 必须是**祈使句**（含 改/设/调/统一/都… 之类动词），问句一律不接（「酒店报价一般多少？」→ None）；
- 必须出现**报价类词**（报价/房价/价格/价位）；
- 必须能拿到一个**价格数字**：优先带单位（元/块/￥/¥），否则取「第N天」之外剩下的最后一个数；
- 适用范围：`第N天`（支持中文数字）→ 只改这些天；`每天/所有天/全部/都` 或未指定 → 所有有酒店的天。

**写入语义**：**upsert 一条「手动录入」报价**（已存在就改价），**不动**其他平台已有的报价 ——
用户可能只是补一个自己心里的价位，平台比价数据不该被自动清掉。改了什么会记进决策轨迹。
"""

from __future__ import annotations

import re

#: 写入的报价平台名（与前端「＋ 添加一条报价」的默认口径一致）
MANUAL_PLATFORM = "手动录入"

_DAY_CN = {
    "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
}
_PRICE_WORDS = ("报价", "房价", "价格", "价位")
_IMPERATIVE_WORDS = (
    "改为", "改成", "设为", "设成", "设置", "定为", "定成", "调整", "调成", "统一", "修改",
    "都设", "都改", "全都", "全部", "每个", "每日", "每",
)
_DAY_RE = re.compile(r"第\s*([一二三四五六七八九十两]|\d{1,2})\s*天")
_UNIT_PRICE_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:元|块钱|块|人民币|￥|¥|rmb|RMB)")
_ALL_SCOPE_RE = re.compile(r"每天|每日|所有天|全部天|各天|每一天|所有酒店|全部酒店|每一家|都")
_ANY_NUM_RE = re.compile(r"(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])")


def _day_numbers(prompt: str) -> list[int]:
    out: list[int] = []
    for tok in _DAY_RE.findall(prompt):
        d = int(tok) if tok.isdigit() else _DAY_CN.get(tok, 0)
        if d and d not in out:
            out.append(d)
    return out


def parse_price_request(prompt: str) -> dict | None:
    """解析「把酒店报价设为 N 元」这类祈使句，返回 `{price, days, scope}`；不是这类请求返回 None。"""
    p = (prompt or "").strip()
    if not p or len(p) > 300:
        return None
    if "?" in p or "？" in p:  # 疑问句（「一般多少钱？」）不是命令
        return None
    if not any(w in p for w in _PRICE_WORDS):
        return None
    if not any(w in p for w in _IMPERATIVE_WORDS):
        return None

    m = _UNIT_PRICE_RE.search(p)
    if m:
        price = float(m.group(1))
    else:
        # 去掉「第N天」里的 N，再取剩下的最后一个数字（「把第1天报价改为 100」不指定单位也能认）
        rest = _DAY_RE.sub("第N天", p)
        nums = [float(x) for x in _ANY_NUM_RE.findall(rest)]
        if not nums:
            return None
        price = nums[-1]
    if not (0 < price < 100000):
        return None

    days = _day_numbers(p)
    return {
        "price": price,
        "days": days,
        "scope": "days" if days else "all",
    }


def _upsert(prices: list, price: float) -> list[dict]:
    """把「手动录入」这条报价设为 price（保留其他平台），返回新数组。"""
    out: list[dict] = []
    hit = False
    for pr in prices:
        if not isinstance(pr, dict):
            continue
        if str(pr.get("platform") or "").strip() == MANUAL_PLATFORM:
            if hit:
                continue  # 去重：只留一条
            hit = True
            out.append({**pr, "platform": MANUAL_PLATFORM, "price": price})
        else:
            out.append(pr)
    if not hit:
        out.append({"platform": MANUAL_PLATFORM, "price": price, "breakfast": False, "note": ""})
    return out


def apply_price(route: dict, spec: dict) -> list[dict]:
    """就地修改 route（dict 形态）里对应天数的酒店报价，返回改动记录。

    只处理「有酒店」的天；`spec["days"]` 给定时只改这些天（天号不存在则跳过）。
    """
    records: list[dict] = []
    wanted = set(spec.get("days") or [])
    price = float(spec["price"])
    for d in route.get("days") or []:
        if not isinstance(d, dict):
            continue
        day_no = d.get("day")
        if wanted and day_no not in wanted:
            continue
        h = d.get("hotel")
        if not isinstance(h, dict) or not str(h.get("name") or "").strip():
            continue  # 没安排酒店的天不动（不凭空补酒店）
        before = h.get("prices") or []
        if not isinstance(before, list):
            before = []
        after = _upsert(before, price)
        if before == after:
            continue
        h["prices"] = after
        records.append({"day": day_no, "name": str(h.get("name")), "price": price,
                        "before": before, "after": after})
    return records


def price_signature(days) -> tuple:
    """把各天酒店报价压成可比较的签名（用于判断「模型到底改了报价没有」）。"""
    out = []
    for d in days or []:
        if not isinstance(d, dict):
            continue
        h = d.get("hotel")
        ps = (h or {}).get("prices") if isinstance(h, dict) else None
        items = []
        if isinstance(ps, list):
            for pr in ps:
                if isinstance(pr, dict):
                    items.append((str(pr.get("platform") or ""), float(pr.get("price") or 0)))
        out.append((d.get("day"), tuple(sorted(items))))
    return tuple(out)


def summary_text(records: list[dict]) -> str:
    """一行中文，供决策轨迹/回复复用。"""
    if not records:
        return "报价未变动"
    days = "、".join(f"D{r['day']}" for r in records)
    return f"{len(records)} 处报价已设为 ¥{records[0]['price']:.0f}（{days}）"
