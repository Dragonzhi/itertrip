"""POST /api/plan —— 生成行程规划，返回 route JSON。"""

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from ..engine import planner
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


@router.post("/api/plan")
async def plan(req: PlanRequest, request: Request, response: Response) -> dict:
    route, source = await planner.plan(req.model_dump(), llm_overrides(request), traveler_id(request))
    # 数据来源放响应头，不污染 route JSON（它会被原样注入导出 HTML）
    response.headers["X-IterTrip-Source"] = source
    return route.model_dump()