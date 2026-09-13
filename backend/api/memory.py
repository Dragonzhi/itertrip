"""M18 记忆库 API：坐标真值回传 / 统计 / 清空（AGENTS.md §6.4）。

    POST   /api/memory/feedback   编辑器「改点保存成功」上报坐标真值 → place_entity 入库
    GET    /api/memory/stats      当前匿名档案的记忆条数 / 类型分布 / 城市（设置面板展示）
    DELETE /api/memory/all        清空当前匿名档案的 namespace（隐私：绝不跨档案删除）

总开关 ITERTRIP_MEMORY_ENABLED≠1 时全部 no-op（不写库、不报错），用户无感。
档案由请求头 X-Traveler-Id 标识（前端 localStorage 生成的随机 id）；缺失时同样按 no-op 处理。
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..engine import memory_embed, memory_ingest, memory_store
from .deps import traveler_id

router = APIRouter()


class FeedbackRequest(BaseModel):
    """坐标真值上报（用户在编辑器里手动改过 / 新填的位置）。"""

    name: str = Field(min_length=1, max_length=80)
    city: str = ""
    lat: float
    lng: float
    source: str = "user_pin"


def _off() -> str:
    """返回不可用原因；可用时返回 ""。"""
    if not memory_store.enabled():
        return "disabled"
    return ""


@router.post("/api/memory/feedback")
def feedback(req: FeedbackRequest, request: Request) -> dict:
    tid = traveler_id(request)
    off = _off()
    if off or not tid:
        return {"ok": True, "stored": 0, "enabled": not off, "reason": off or "missing_traveler_id"}
    # 0,0 是「未定位」占位而非真值，不入库（否则会污染 geocode 第 0 级）
    if (req.lat == 0 and req.lng == 0) or not (-90 <= req.lat <= 90 and -180 <= req.lng <= 180):
        return {"ok": True, "stored": 0, "enabled": True, "reason": "invalid_coord"}
    try:
        n = memory_ingest.ingest_entity(tid, req.name.strip(), req.city.strip(), req.lat, req.lng, req.source)
        return {"ok": n > 0, "stored": n, "enabled": True}
    except Exception as e:  # noqa: BLE001 前端为 fire-and-forget，这里也保持静默语义
        print(f"[memory] feedback 入库失败: {e}")
        return {"ok": False, "stored": 0, "enabled": True, "reason": str(e)[:120]}


@router.get("/api/memory/stats")
def stats(request: Request) -> dict:
    tid = traveler_id(request)
    off = _off()
    if off or not tid:
        return {"enabled": False, "total": 0, "by_kind": {}, "cities": [], "reason": off or "missing_traveler_id"}
    try:
        st = memory_store.stats(tid)
    except Exception as e:  # noqa: BLE001
        print(f"[memory] stats 失败: {e}")
        return {"enabled": True, "total": 0, "by_kind": {}, "cities": [], "reason": str(e)[:120]}
    return {
        "enabled": True,
        "total": st["total"],
        "by_kind": st["by_kind"],
        "cities": st["cities"],
        "embed_provider": memory_embed.provider(),
        "embed_model": memory_embed.model_name(),
    }


@router.delete("/api/memory/all")
def clear_all(request: Request) -> dict:
    tid = traveler_id(request)
    off = _off()
    if off or not tid:
        return {"ok": True, "deleted": 0, "enabled": not off, "reason": off or "missing_traveler_id"}
    try:
        deleted = memory_store.clear(tid)
        return {"ok": True, "deleted": deleted, "enabled": True}
    except Exception as e:  # noqa: BLE001
        print(f"[memory] 清空失败: {e}")
        return {"ok": False, "deleted": 0, "enabled": True, "reason": str(e)[:120]}
