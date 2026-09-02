"""POST /api/plan —— 生成行程规划，返回 route JSON。"""

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from ..engine import planner
from .deps import llm_overrides

router = APIRouter()


class PlanRequest(BaseModel):
    """规划请求（字段见 WEB_APP_PLAN.md §5.1）。"""

    destination: str = Field(min_length=1)
    days: int = Field(default=3, ge=1, le=30)
    date: str = ""
    travelers: str = ""
    budget: str = ""
    style: str = ""
    constraints: str = ""


@router.post("/api/plan")
async def plan(req: PlanRequest, request: Request, response: Response) -> dict:
    route, source = await planner.plan(req.model_dump(), llm_overrides(request))
    # 数据来源放响应头，不污染 route JSON（它会被原样注入导出 HTML）
    response.headers["X-IterTrip-Source"] = source
    return route.model_dump()