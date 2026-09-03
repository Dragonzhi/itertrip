"""后台管理 API —— 管理免费 AI 服务配置（Key / 模型 / 启停）。

鉴权：所有接口要求 X-Admin-Token 请求头 == ITERTRIP_ADMIN_TOKEN（env 或 .env）。
未配置 token 时后台整体关闭（403）。token 校验用常量时间比较。

接口：
    GET    /api/admin/provider        查看（api_key 脱敏）+ 当前实际生效来源
    PUT    /api/admin/provider        保存（api_key 留空 = 保留原 key）
    DELETE /api/admin/provider        清空后台配置
    POST   /api/admin/provider/test   实时探测连通性 + 视觉能力
"""

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..engine import admin_config
from .llm import (
    _PIXEL_PNG,
    _VISION_FAIL_MARKS,
    _post,
    _short_error,
    _text_probe_max_tokens,
)

router = APIRouter()


class ProviderIn(BaseModel):
    name: str = ""
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    enabled: bool = False


class TestIn(BaseModel):
    base_url: str = ""
    api_key: str = ""
    model: str = ""


def _require_admin(request: Request) -> None:
    if not admin_config.admin_token():
        raise HTTPException(status_code=503, detail="后台管理未启用：请在服务器 .env 配置 ITERTRIP_ADMIN_TOKEN")
    provided = request.headers.get("X-Admin-Token", "").strip()
    if not admin_config.check_token(provided):
        raise HTTPException(status_code=401, detail="admin token 无效")


def _status() -> dict:
    cfg, source = admin_config.resolve_active()
    return {
        "provider": admin_config.view(),
        "active_source": source,
        "active_model": (cfg or {}).get("model", ""),
    }


@router.get("/api/admin/provider")
async def get_provider(request: Request) -> dict:
    _require_admin(request)
    return _status()


@router.put("/api/admin/provider")
async def put_provider(body: ProviderIn, request: Request) -> dict:
    _require_admin(request)
    admin_config.save_provider(body.model_dump())
    return _status()


@router.delete("/api/admin/provider")
async def delete_provider(request: Request) -> dict:
    _require_admin(request)
    admin_config.clear_provider()
    return _status()


@router.post("/api/admin/provider/test")
async def test_provider(body: TestIn, request: Request) -> dict:
    _require_admin(request)
    view = admin_config.view()
    base_url = (body.base_url or "").strip() or view["base_url"]
    model = (body.model or "").strip() or view["model"]
    api_key = (body.api_key or "").strip() or admin_config.stored_key()
    if not base_url or not model or not api_key:
        raise HTTPException(status_code=400, detail="请先填写 Base URL / API Key / 模型名")

    cfg = {"base_url": base_url, "api_key": api_key, "model": model}
    try:
        usable_mt = await _text_probe_max_tokens(cfg)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "model": model, "vision": False, "message": _short_error(e)}

    vision = False
    try:
        status, body_text = await _post(
            cfg,
            {
                "model": model,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "图里是什么颜色？答一个词即可。"},
                        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + _PIXEL_PNG}},
                    ],
                }],
                "max_tokens": usable_mt,
            },
        )
        if 200 <= status < 300:
            vision = True
        else:
            low = body_text.lower()
            vision = not (status == 400 and any(m in low for m in _VISION_FAIL_MARKS))
    except Exception:  # noqa: BLE001
        vision = True

    return {"ok": True, "model": model, "vision": vision, "message": "连接成功"}
