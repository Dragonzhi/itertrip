"""POST /api/plan —— 生成行程规划，返回 route JSON。

POST /api/route/recheck —— 已有路线坐标重校准（M20）：修复历史遗留的错坐标/缺坐标。
"""

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from ..engine import planner
from ..engine.schema import RouteJSON
from .deps import llm_overrides, traveler_id

router = APIRouter()


class PlanRequest(BaseModel):
    """规划请求（字段契约见 AGENTS.md §6.4 与 engine/schema.py）。"""

    destination: str = Field(min_length=1)
    days: int = Field(default=3, ge=1, le=30)
    date: str = ""
    travelers: str = ""
    budget: str = ""
    style: str = ""
    constraints: str = ""


class RecheckRequest(BaseModel):
    """坐标重校准请求：完整 route JSON（坐标须已是 GCJ-02，即应用内/导出的格式）。"""

    route: dict


@router.post("/api/plan")
async def plan(req: PlanRequest, request: Request, response: Response) -> dict:
    route, source = await planner.plan(req.model_dump(), llm_overrides(request), traveler_id(request))
    # 数据来源放响应头，不污染 route JSON（它会被原样注入导出 HTML）
    response.headers["X-IterTrip-Source"] = source
    return route.model_dump()


@router.post("/api/route/recheck")
async def recheck(req: RecheckRequest, request: Request) -> dict:
    """重新校准整条路线的坐标，返回 {route, filled, records, amap_calls, amap_reason}。

    典型场景：M20 修复前生成的行程（坐标被同名异地 POI 带跑偏）或手工改乱了的行程。
    用户手改真值不会被覆盖；无高德 key 时退化为「补全缺失坐标 + 城市中心兜底」。
    """
    route = RouteJSON.model_validate(req.route)
    out = await planner.recheck_route(route, llm_overrides(request), traveler_id(request))
    route_out: RouteJSON = out["route"]
    return {
        "route": route_out.model_dump(),
        "filled": out["filled"],
        "records": out["records"],
        "amap_calls": out["amap_calls"],
        "amap_reason": out["amap_reason"],
    }