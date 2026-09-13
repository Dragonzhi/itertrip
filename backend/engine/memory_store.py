"""记忆库存储（M18_MEMORY_PLAN.md §5）：SQLite 单文件 + 候选集内余弦 top-k。

设计要点：
- **单文件零服务**：`memory.sqlite`（项目根，gitignore；可用 ITERTRIP_MEMORY_DB 覆盖路径），WAL 模式。
- **三种 chunk**：`place_card`（地点原子事实，检索主粒度）/ `trip_summary`（整篇攻略级）/
  `place_entity`（坐标真值，geocode 第 0 级专用）。
- **检索**：先 SQL 预过滤（traveler_id + 城市 + kind），候选集内暴力余弦取 top-k。
  单用户几百条量级 <1ms，引入 sqlite-vec / FAISS 的编译与兼容成本不值（YAGNI 自觉）。
- **`VectorIndex` 接口位**：日后要换向量索引实现，只需替换 `COSINE_INDEX`，上层不动。
- **隐私**：所有查询强制 `traveler_id` 过滤，不同匿名档案互不可见。
"""

import json
import re
import sqlite3
import struct
from contextlib import contextmanager
from pathlib import Path
from typing import Protocol

try:  # numpy 仅作为加速路径（fastembed 会带入）；缺失时退化为纯 stdlib
    import numpy as _np
except ImportError:  # pragma: no cover - 环境相关
    _np = None

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_DEFAULT_DB = _PROJECT_ROOT / "memory.sqlite"

KIND_PLACE = "place_card"
KIND_SUMMARY = "trip_summary"
KIND_ENTITY = "place_entity"
_RECALL_KINDS = (KIND_PLACE, KIND_SUMMARY)  # place_entity 不参与攻略检索（它是坐标真值表）

_ready: set[str] = set()


def enabled() -> bool:
    """记忆库总开关：ITERTRIP_MEMORY_ENABLED=1/true/yes/on 时开启（默认关闭，隐私 opt-in）。

    配置来源：进程环境变量 > 项目根 .env（与 ITERTRIP_FREE_* 同一口径）。
    """
    from ._llmutil import env_value

    return env_value("ITERTRIP_MEMORY_ENABLED").lower() in ("1", "true", "yes", "on")


def db_path() -> Path:
    from ._llmutil import env_value

    return Path(env_value("ITERTRIP_MEMORY_DB") or _DEFAULT_DB)


@contextmanager
def _conn():
    path = db_path()
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        if str(path) not in _ready:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS chunks (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    traveler_id TEXT NOT NULL,
                    kind        TEXT NOT NULL,
                    city        TEXT NOT NULL DEFAULT '',
                    text        TEXT NOT NULL,
                    meta        TEXT NOT NULL DEFAULT '{}',
                    embedding   BLOB,
                    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_scope ON chunks(traveler_id, kind, city)")
            conn.commit()
            _ready.add(str(path))
        yield conn
        conn.commit()
    finally:
        conn.close()


# ---------------- 向量相似度（VectorIndex 接口位） ----------------


class VectorIndex(Protocol):
    """向量索引接口：候选集内排序取 top-k。换 sqlite-vec / FAISS 时实现同一签名即可。"""

    def rank(self, candidates: list[tuple[int, bytes]], query: list[float], top_k: int) -> list[tuple[int, float]]: ...


class CosineIndex:
    """暴力余弦（默认实现）：候选集通常只有几十~几百条，纯算术即可。"""

    def rank(self, candidates: list[tuple[int, bytes]], query: list[float], top_k: int) -> list[tuple[int, float]]:
        scored: list[tuple[int, float]] = []
        for cid, blob in candidates:
            s = _cosine(blob, query)
            if s > -1.0:  # 维度不匹配/空向量返回 -1，直接丢弃
                scored.append((cid, s))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]


COSINE_INDEX: VectorIndex = CosineIndex()


def _cosine(blob: bytes | None, query: list[float]) -> float:
    if not blob:
        return -1.0
    dim = len(blob) // 4
    if dim == 0 or dim != len(query):
        return -1.0
    if _np is not None:
        v = _np.frombuffer(blob[: dim * 4], dtype=_np.float32)
        q = _np.asarray(query, dtype=_np.float32)
        denom = float(_np.linalg.norm(v) * _np.linalg.norm(q))
        return float(v @ q / denom) if denom else -1.0
    vec = struct.unpack(f"<{dim}f", blob[: dim * 4])
    dot = sum(a * b for a, b in zip(vec, query))
    na = sum(a * a for a in vec) ** 0.5
    nb = sum(b * b for b in query) ** 0.5
    return dot / (na * nb) if na and nb else -1.0


def pack(vec: list[float] | None) -> bytes | None:
    if not vec:
        return None
    return struct.pack(f"<{len(vec)}f", *[float(x) for x in vec])


# ---------------- 写入 ----------------


def add_chunks(traveler_id: str, chunks: list[dict]) -> int:
    """批量写入 chunk（每条含 kind/city/text/meta/embedding）。返回写入条数。"""
    if not traveler_id or not chunks:
        return 0
    rows = [
        (
            traveler_id,
            str(c.get("kind") or ""),
            str(c.get("city") or ""),
            str(c.get("text") or ""),
            json.dumps(c.get("meta") or {}, ensure_ascii=False),
            pack(c.get("embedding")),
        )
        for c in chunks
        if str(c.get("text") or "").strip()
    ]
    if not rows:
        return 0
    with _conn() as conn:
        conn.executemany(
            "INSERT INTO chunks (traveler_id, kind, city, text, meta, embedding) VALUES (?, ?, ?, ?, ?, ?)", rows
        )
    return len(rows)


def _norm(s: str) -> str:
    """名称归一化：去空格/标点/大小写差异，供实体精确匹配用。"""
    return re.sub(r"[\s·・,，.。()（）\[\]【】\-—_/]+", "", (s or "")).lower()


def upsert_entity(traveler_id: str, name: str, city: str, lat: float, lng: float, source: str = "user_pin") -> int:
    """坐标实体记忆 upsert：同名同城市覆盖（用户最新一次改动即真值），否则新增。"""
    if not traveler_id or not (name or "").strip() or lat is None or lng is None:
        return 0
    target = _norm(name)
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, city, meta FROM chunks WHERE traveler_id=? AND kind=?", (traveler_id, KIND_ENTITY)
        ).fetchall()
    drop = [int(r["id"]) for r in rows if _entity_hit(r, target, city)]
    if drop:
        with _conn() as conn:
            conn.executemany("DELETE FROM chunks WHERE id=?", [(i,) for i in drop])
    text = f"{name}：{city} 坐标 {round(float(lat), 6)},{round(float(lng), 6)}"
    meta = {"name": name, "lat": float(lat), "lng": float(lng), "source": source, "city": city}
    return add_chunks(traveler_id, [{
        "kind": KIND_ENTITY, "city": city or "", "text": text, "meta": meta, "embedding": None,
    }])


def _load_meta(raw) -> dict:
    try:
        v = json.loads(raw or "{}")
        return v if isinstance(v, dict) else {}
    except (TypeError, ValueError):
        return {}


def _entity_hit(row, target_norm: str, city: str) -> bool:
    """一行实体是否就是「同名 + 同城市」的那条（供 upsert 覆盖 / find 命中共用）。"""
    meta = _load_meta(row["meta"])
    if _norm(meta.get("name") or "") != target_norm:
        return False
    return _city_match(city, row["city"])


def _city_match(query_city: str, stored_city: str) -> bool:
    """城市匹配：互相包含即算同城（"成都" ↔ "成都市"/"成都 5 日游"）。"""
    a, b = _norm(query_city), _norm(stored_city)
    if not a or not b:
        return True  # 未给城市或旧数据缺城市：不做城市级拒绝，交由名称匹配判定
    return a in b or b in a


def find_entity(traveler_id: str, name: str, city: str = "") -> dict | None:
    """geocode 第 0 级：同名 +（同城市 / 任意城市）精确命中，返回 {lat, lng, source}。"""
    if not traveler_id or not (name or "").strip():
        return None
    target = _norm(name)
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, city, meta FROM chunks WHERE traveler_id=? AND kind=?", (traveler_id, KIND_ENTITY)
        ).fetchall()
    hits = [r for r in rows if _entity_hit(r, target, city)]
    if not hits:
        return None
    # 同城（城市名互相包含）优先，其次跨城兜底
    exact = [r for r in hits if _norm(city or "") and _norm(city) in _norm(r["city"])]
    meta = _load_meta((exact or hits)[0]["meta"])
    lat, lng = meta.get("lat"), meta.get("lng")
    if lat is None or lng is None:
        return None
    return {"lat": float(lat), "lng": float(lng), "source": meta.get("source") or "user_pin"}


# ---------------- 检索 ----------------


def count(traveler_id: str, kinds: tuple[str, ...] | None = None) -> int:
    if not traveler_id:
        return 0
    sql = "SELECT COUNT(*) AS n FROM chunks WHERE traveler_id=?"
    args: list = [traveler_id]
    if kinds:
        sql += " AND kind IN (" + ",".join("?" * len(kinds)) + ")"
        args.extend(kinds)
    with _conn() as conn:
        return int(conn.execute(sql, args).fetchone()["n"])


def cities(traveler_id: str, kinds: tuple[str, ...] | None = _RECALL_KINDS) -> list[str]:
    """该档案库内出现过的城市名（用于「prompt 命中库内城市才过滤」，默认只看攻略类 chunk）。"""
    if not traveler_id:
        return []
    sql = "SELECT DISTINCT city FROM chunks WHERE traveler_id=? AND city<>''"
    args: list = [traveler_id]
    if kinds:
        sql += " AND kind IN (" + ",".join("?" * len(kinds)) + ")"
        args.extend(kinds)
    with _conn() as conn:
        rows = conn.execute(sql, args).fetchall()
    return [str(r["city"]) for r in rows]


def search(
    traveler_id: str,
    query_vec: list[float],
    query_text: str = "",
    kinds: tuple[str, ...] = _RECALL_KINDS,
    top_k: int = 6,
) -> list[dict]:
    """候选集内余弦 top-k。query_text 命中库内城市名时启用城市预过滤（否则跨城市召回）。"""
    if not traveler_id or not query_vec:
        return []
    matched = [c for c in cities(traveler_id) if c and c in (query_text or "")]
    sql = "SELECT id, kind, city, text, meta, embedding FROM chunks WHERE traveler_id=? AND kind IN (" + ",".join(
        "?" * len(kinds)
    ) + ") AND embedding IS NOT NULL"
    args: list = [traveler_id, *kinds]
    if matched:
        sql += " AND city IN (" + ",".join("?" * len(matched)) + ")"
        args.extend(matched)
    with _conn() as conn:
        rows = conn.execute(sql, args).fetchall()
    cand = [(int(r["id"]), r["embedding"]) for r in rows]
    by_id = {int(r["id"]): r for r in rows}
    out: list[dict] = []
    for cid, score in COSINE_INDEX.rank(cand, query_vec, top_k):
        r = by_id[cid]
        out.append({
            "id": cid, "kind": r["kind"], "city": r["city"], "text": r["text"],
            "meta": _load_meta(r["meta"]), "score": score,
        })
    return out


# ---------------- 统计 / 清空 ----------------


def stats(traveler_id: str) -> dict:
    if not traveler_id:
        return {"total": 0, "by_kind": {}, "cities": []}
    with _conn() as conn:
        rows = conn.execute(
            "SELECT kind, COUNT(*) AS n FROM chunks WHERE traveler_id=? GROUP BY kind", (traveler_id,)
        ).fetchall()
    by_kind = {str(r["kind"]): int(r["n"]) for r in rows}
    return {"total": sum(by_kind.values()), "by_kind": by_kind, "cities": cities(traveler_id, kinds=None)}


def clear(traveler_id: str) -> int:
    """只清空当前匿名档案的 namespace（隐私红线：不跨档案删除）。"""
    if not traveler_id:
        return 0
    with _conn() as conn:
        cur = conn.execute("DELETE FROM chunks WHERE traveler_id=?", (traveler_id,))
        return int(cur.rowcount or 0)
