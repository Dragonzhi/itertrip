"""POST /api/geocode —— 模糊名称 → 坐标（WEB_APP_PLAN.md §5.2）。"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..engine.coordinates import geocode

router = APIRouter()


class GeocodeRequest(BaseModel):
    name: str = Field(min_length=1)
    city: str = ""


@router.post("/api/geocode")
async def geocode_route(req: GeocodeRequest) -> dict:
    return await geocode(req.name, req.city)
