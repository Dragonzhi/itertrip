"""POST /api/route/transport: adjacent leg comparison, no LLM."""
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from ..engine import transport

router = APIRouter()


class Point(BaseModel):
    id: str = Field(default="", max_length=80)
    name: str = Field(max_length=300)
    lat: float | None = Field(default=None, allow_inf_nan=False)
    lng: float | None = Field(default=None, allow_inf_nan=False)
    source: str = Field(default="", max_length=30)
    confidence: str = Field(default="", max_length=20)
    note: str = Field(default="", max_length=5000)
    poi_id: str = Field(default="", max_length=80)
    city_code: str = Field(default="", max_length=20)

    @field_validator("lat", "lng", mode="before")
    @classmethod
    def no_bool(cls, value):
        if isinstance(value, bool):
            raise ValueError("坐标必须为数字")
        return value


class Edge(BaseModel):
    signature: str = Field(max_length=16000)
    from_: Point = Field(alias="from")
    to: Point


class TransportRequest(BaseModel):
    edges: list[Edge] = Field(min_length=1, max_length=12)
    modes: list[Literal["walk", "bus", "car"]] = Field(default_factory=lambda: ["walk", "bus", "car"], min_length=1, max_length=3)


@router.post("/api/route/transport")
async def route_transport(req: TransportRequest):
    return await transport.query([e.model_dump(by_alias=True) for e in req.edges], list(dict.fromkeys(req.modes)))
