"""记忆库切分与读写编排（M18_MEMORY_PLAN.md §5.2/§5.4）。

旅游攻略天然有语义单元，所以不做固定长度滑窗，而是按**实体级**切分：

- `place_card`  单地点原子事实（名称 + 备注 + 时间 + 门票 + 所属天主题）——检索主粒度
- `trip_summary` 整篇攻略级（标题 + 目的地 + 天数 + summary[]）——回答「上次那篇整体怎么排」
- `place_entity` 坐标真值（用户地图改点）——geocode 第 0 级专用，不参与语义检索

检索侧 `build_reference()` 负责：城市探测 → 向量 top-k → 拼【记忆参考】块（≤6 条 / ≤1200 字护栏）。
"""

from datetime import datetime

from . import memory_embed, memory_store

_TOP_K = 6
_MAX_CHARS = 1200  # 与 DESIGN §4.3 上下文护栏同族：注入块硬上限

_REF_HEADER = (
    "【记忆参考】这位旅行者过往攻略的相关片段（仅供引用，不是本次必含内容；冲突以本次为准）：\n"
)
_REF_RULES = "使用规则：与当前需求相关才提及，引用必须带 [n]；不得凭记忆编造本次攻略没有的内容。"


def _place_text(place, day) -> str:
    note = (place.note or "").strip()
    parts = [f"{place.name}：{note}" if note else place.name]
    if (place.time or "").strip():
        parts.append(place.time.strip())
    if (place.ticket or "").strip():
        parts.append(f"门票{place.ticket.strip()}")
    if day is not None:
        tag = f"D{day.day}" + (f" {day.theme.strip()}" if (day.theme or "").strip() else "")
        parts.append(tag)
    return " · ".join(parts)


def route_chunks(route, date: str = "") -> list[dict]:
    """把一条 route 切成 [trip_summary] + [每地点一张 place_card]（未含 embedding）。"""
    trip = route.trip
    title = (trip.title or trip.destination or "未命名行程").strip()
    city = (trip.destination or "").strip()
    date = date or datetime.now().strftime("%Y-%m")
    out: list[dict] = []

    summ = " ".join(s.strip() for s in (route.summary or []) if str(s).strip())
    summary_text = f"《{title}》{city} {trip.days} 天攻略" + (f"：{summ}" if summ else "")
    out.append({
        "kind": memory_store.KIND_SUMMARY,
        "city": city,
        "text": summary_text,
        "meta": {"date": date, "title": title, "source": "guide", "days": trip.days, "destination": city},
    })

    for day in route.days:
        for p in day.places:
            if not (p.name or "").strip():
                continue
            out.append({
                "kind": memory_store.KIND_PLACE,
                "city": city,
                "text": _place_text(p, day),
                "meta": {
                    "name": p.name, "lat": p.lat, "lng": p.lng, "source": "guide",
                    "date": date, "title": title, "day": day.day,
                },
            })
    return out


def ingest_route(traveler_id: str, route, date: str = "") -> int:
    """切分 → embedding → 入库。返回写入条数（embedding 不可用时抛 EmbedError，由调用方降级）。"""
    chunks = route_chunks(route, date)
    if not chunks:
        return 0
    vecs = memory_embed.embed_texts([c["text"] for c in chunks])
    for c, v in zip(chunks, vecs):
        c["embedding"] = v
    return memory_store.add_chunks(traveler_id, chunks)


def ingest_entity(traveler_id: str, name: str, city: str, lat: float, lng: float, source: str = "user_pin") -> int:
    """坐标真值入库（实体记忆无需 embedding：按名称+城市精确命中）。"""
    return memory_store.upsert_entity(traveler_id, name, city, lat, lng, source)


def _cite(item: dict) -> str:
    meta = item.get("meta") or {}
    title = (meta.get("title") or "").strip()
    date = (meta.get("date") or "").strip()
    if item.get("kind") == memory_store.KIND_SUMMARY:
        body = item.get("text") or ""
    else:
        body = f"《{title}》· {item.get('text')}" if title else (item.get("text") or "")
    return f"{body}（{date}）" if date else body


def build_reference(traveler_id: str, prompt: str, top_k: int = _TOP_K) -> str:
    """检索并拼装【记忆参考】块；无命中/记忆不可用时返回 ""（静默跳过）。

    护栏：top_k ≤ 6 且总字数 ≤ 1200，防上下文膨胀。
    """
    if not traveler_id or not (prompt or "").strip() or not memory_store.enabled():
        return ""
    if memory_store.count(traveler_id, (memory_store.KIND_PLACE, memory_store.KIND_SUMMARY)) == 0:
        return ""  # 库空 → 连 query embedding 都不必算（首轮零额外开销）
    try:
        qvec = memory_embed.embed_one(prompt)
        hits = memory_store.search(traveler_id, qvec, query_text=prompt, top_k=top_k)
    except memory_embed.EmbedError as e:
        print(f"[memory] 检索跳过：{e}")
        return ""
    except Exception as e:  # noqa: BLE001 记忆是增强能力，任何异常都不得影响主线对话
        print(f"[memory] 检索失败（忽略）: {e}")
        return ""
    if not hits:
        return ""
    rel = [h for h in hits if float(h.get("score") or 0) > 0]  # 零相关（候选集填充项）不进注入块
    lines: list[str] = []
    used = len(_REF_HEADER) + len(_REF_RULES)
    for i, h in enumerate(rel, 1):
        line = f"[{i}] {_cite(h)}"
        if used + len(line) > _MAX_CHARS:
            break
        used += len(line) + 1
        lines.append(line)
    if not lines:
        return ""
    return _REF_HEADER + "\n".join(lines) + "\n" + _REF_RULES
