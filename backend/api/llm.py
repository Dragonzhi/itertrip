"""POST /api/llm/test —— BYOK 连接测试（DESIGN.md §4.1）。

两层探测：
1. 文本补全（max_tokens=1）：验证连通性 + 鉴权 + 模型名有效
2. 视觉探测（两段式，避免网关参数挑剔导致误判）：
   a) 先发 max_tokens=512 的纯文字请求，拿到基准可用的 max_tokens 上限；
      网关若对 max_tokens 报参数错，逐步降档（512→256→128）重试
   b) 用「文字+1×1 图片」组合发一次：HTTP 2xx = 支持视觉；
      4xx 且错误体含 image/vision/multimodal 字样 = 明确不支持；
      其他 4xx（参数挑剔等）= 未知，按支持处理（宁可信其有，M15 实测再纠正）

结果 source：user（请求头 BYOK）| env（服务端环境变量兜底）| none（两者皆无）。
"""

from fastapi import APIRouter, Request
import httpx

from .deps import llm_overrides

router = APIRouter()

# 保证合法的 1x1 红色像素 PNG（test-artifacts/gen_png.py 生成并自检过）
_PIXEL_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)

_VISION_FAIL_MARKS = ("image", "vision", "multimodal", "visual", "图片", "图像")


def _short_error(e: Exception) -> str:
    """压缩常见 httpx/网络异常为一句中文提示。"""
    s = str(e)
    if "429" in s:
        return "被供应商限流（429），key 有效但请稍后再试"
    if "401" in s or "Unauthorized" in s:
        return "鉴权失败（401）：请检查 API Key 是否正确"
    if "404" in s:
        return "接口不存在（404）：请检查 Base URL 与模型名"
    if "Connect" in s or "timed out" in s or "timeout" in s.lower():
        return "网络连接失败：请检查 Base URL 是否可达"
    return s[:160]


def _is_max_tokens_param_error(status: int, body: str) -> bool:
    """网关对 max_tokens 值挑剔（如「max_tokens must be ≤ 100」类参数错）。"""
    if status == 400 and body:
        low = body.lower()
        return "max_tokens" in low or "max_tokens" in low.replace(" ", "")
    return False


async def _post(cfg: dict, payload: dict) -> tuple[int, str]:
    """返回 (status, body)；HTTP 层异常向上抛。"""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            cfg["base_url"] + "/chat/completions",
            headers={"Authorization": "Bearer " + cfg["api_key"]},
            json=payload,
        )
        return resp.status_code, resp.text


async def _text_probe_max_tokens(cfg: dict) -> int:
    """文本探测：连通性 + 找到一个可用的 max_tokens 档位。失败抛异常。"""
    for mt in (512, 256, 128, 32):
        status, body = await _post(
            cfg,
            {"model": cfg["model"], "messages": [{"role": "user", "content": "Hi"}], "max_tokens": mt},
        )
        if 200 <= status < 300:
            return mt
        if status == 400 and not _is_max_tokens_param_error(status, body):
            raise RuntimeError(body[:200])
        # 401/404/429 等直接抛，保留原始信息给 _short_error
        if status != 400:
            resp_error = httpx.HTTPStatusError(f"{status}", request=None, response=None)
            resp_error.args = (body[:200],)
            raise RuntimeError(f"{status}: {body[:200]}")
        # 400 且疑似 max_tokens 问题 → 降档重试
    raise RuntimeError("max_tokens 各档位均被网关拒绝")


@router.post("/api/llm/test")
async def test_llm(request: Request) -> dict:
    overrides = llm_overrides(request)
    source = "user"
    cfg = overrides
    if cfg is None or not cfg.get("api_key"):
        from ..engine.planner import _llm_config

        cfg = _llm_config()
        source = "env" if cfg else "none"
    if cfg is None:
        return {
            "ok": False,
            "source": "none",
            "model": "",
            "vision": False,
            "message": "未配置：请在上方填入 Base URL / API Key / 模型名，或设置 ITERTRIP_LLM_* 环境变量",
        }

    model = cfg.get("model", "")

    # 1. 文本连通性（并确定可用 max_tokens）
    try:
        usable_mt = await _text_probe_max_tokens(cfg)
    except Exception as e:
        return {"ok": False, "source": source, "model": model, "vision": False, "message": _short_error(e)}

    # 2. 视觉探测（两段式：合法图片 + 合理 max_tokens，按错误语义分类）
    vision = False
    try:
        status, body = await _post(
            cfg,
            {
                "model": cfg["model"],
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
            low = body.lower()
            if status == 400 and any(m in low for m in _VISION_FAIL_MARKS):
                vision = False  # 明确不支持图片输入
            else:
                vision = True  # 参数挑剔等其他 4xx → 未知，按支持处理（M15 实测再纠正）
    except Exception:
        vision = True  # 探测通道本身异常 → 宽松判支持

    return {"ok": True, "source": source, "model": model, "vision": vision, "message": "连接成功"}
