"""POST /api/plan —— 生成行程规划，返回 route JSON。

POST /api/route/recheck —— 已有路线坐标重校准（M20）：修复历史遗留的错坐标/缺坐标。
POST /api/route/datecheck —— 出发日期推断 + 闭馆日冲突检查（M22）：确定性算术，不调 LLM/高德。
"""

from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..engine import facts, planner
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


class DateCheckRequest(BaseModel):
    """日期/闭馆日检查请求：完整 route JSON + 可选出发日期（用户在页面上改的值）。"""

    route: dict
    start_date: str = ""


def _date_range_text(start: str, days: int, fallback: str) -> str:
    """把 YYYY-MM-DD + 天数写成可读区间「2026-10-01 – 2026-10-06」（单日只写一天）。

    用户手动定了日期后，让 `trip.dates`（给人看的文本）与实际用于计算的
    `trip.start_date` 保持一致，避免两处对不上。
    """
    try:
        d0 = date.fromisoformat(start)
    except ValueError:
        return fallback
    if days <= 1:
        return d0.isoformat()
    return f"{d0.isoformat()} – {(d0 + timedelta(days=days - 1)).isoformat()}"


@router.post("/api/route/datecheck")
async def datecheck(req: DateCheckRequest) -> dict:
    """M22：推断/确认出发日期并检查闭馆日冲突。

    传了 `start_date` 视为**用户给定**（`date_source=user`）并同步 `trip.dates` 文本；
    没传则从 `trip.dates`/`trip.title` 推断（「国庆」→ 今年 10/1；只有月日 → 就近未来），
    标 `date_source=inferred`，由界面显式标注「推断」。
    纯确定性：**不调用 LLM、不调用高德**（`amap_calls` 恒为 0，供冒烟测试断言）。
    """
    route = RouteJSON.model_validate(req.route)
    start = (req.start_date or "").strip()
    if start:
        try:
            date.fromisoformat(start)
        except ValueError:
            raise HTTPException(status_code=400, detail="出发日期格式应为 YYYY-MM-DD") from None
        route.trip.start_date = start
        route.trip.date_source = "user"
        route.trip.dates = _date_range_text(start, len(route.days), route.trip.dates)
    result = facts.annotate_route(route)
    return {
        "route": route.model_dump(),
        "checked": result["checked"],
        "reason": result["reason"],
        "conflicts": result["conflicts"],
        "skipped": result["skipped"],
        "start_date": result["start_date"],
        "date_source": result["date_source"],
        "summary": facts.summary_text(result),
        "amap_calls": 0,
    }