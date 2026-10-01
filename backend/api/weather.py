"""Optional weather tool, bounded by location count and whole-request timeout."""
import asyncio
from fastapi import APIRouter
from pydantic import BaseModel, Field
from .transport import Point
from ..engine import weather

router = APIRouter()


class WeatherRequest(BaseModel):
    points: list[Point] = Field(min_length=1, max_length=12)


@router.post('/api/route/weather')
async def route_weather(req: WeatherRequest):
    try:
        return await asyncio.wait_for(weather.query([p.model_dump() for p in req.points]), timeout=30)
    except TimeoutError:
        return dict(results=[], error='天气查询已达到 30 秒预算，请稍后分天重试。', calls=None)
