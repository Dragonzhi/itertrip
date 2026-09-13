"""POST /api/export —— route JSON 导出为自包含 HTML。"""

import re
from urllib.parse import quote

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
    # 修复：HTTP 头只能 latin-1。中文目的地（如 itertrip_成都_edited）直接放进
    # filename= 会 UnicodeEncodeError 500——此前「点导出没反应」的真正根因。
    # 按 RFC 5987/6266 双写：ASCII 兜底 + filename*=UTF-8'' 百分号编码（现代浏览器优先生效）。
    safe_name = re.sub(r"[^\w\u4e00-\u9fff-]", "_", req.filename).strip("_") or "itertrip_trip"
    ascii_name = re.sub(r"[^A-Za-z0-9_-]", "_", safe_name).strip("_") or "itertrip_trip"
    disposition = (
        f"attachment; filename=\"{ascii_name}.html\"; "
        f"filename*=UTF-8''{quote(safe_name + '.html', safe='')}"
    )
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": disposition},
    )