"""POST /api/export —— route JSON 导出为自包含 HTML。"""

import re

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from ..engine.builder import BuildError, build_html

router = APIRouter()


class ExportRequest(BaseModel):
    route: dict
    filename: str = "itertrip_trip"


@router.post("/api/export")
def export_route(req: ExportRequest) -> Response:
    try:
        html = build_html(req.route)
    except BuildError as e:
        raise HTTPException(status_code=422, detail=str(e))
    safe_name = re.sub(r"[^\w\u4e00-\u9fff-]", "_", req.filename).strip("_") or "itertrip_trip"
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=\"{safe_name}.html\""},
    )