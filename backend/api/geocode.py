"""POST /api/geocode —— 模糊名称 → 坐标（WEB_APP_PLAN.md §5.2）。"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..engine.coordinates import geocode
from .deps import llm_overrides

router = APIRouter()


class GeocodeRequest(BaseModel):
    name: str = Field(min_length=1)
    city: str = ""


@router.post("/api/geocode")
async def geocode_route(req: GeocodeRequest, request: Request) -> dict:
    return await geocode(req.name, req.city, llm_overrides(request))
