"""LLM 端点共享工具：URL 规范化 + 非流式响应文本提取。"""

import re as _re

_VERSION_RE = _re.compile(r"/v\d+$")


def endpoint(base_url: str) -> str:
    """规范化 OpenAI 兼容接口地址，返回用于拼 '/chat/completions' 的 base。

    - 填到根：https://host            -> https://host/v1
    - 已带版本根：https://host/v1 或 https://host/api/paas/v4 -> 原样（不重复补 /v1）
    - 已带完整路径：https://host/v1/chat/completions -> 截回 https://host/v1
    """
    b = (base_url or "").strip().rstrip("/")
    if not b:
        return b
    if b.endswith("/chat/completions"):
        return b[: -len("/chat/completions")]
    if _VERSION_RE.search(b):
        return b
    return b + "/v1"


def non_stream_parts(body: dict) -> tuple[str, str]:
    """从非流式响应体提取 (thinking, content)。

    常规 OpenAI：choices[0].message.content / reasoning_content
    部分网关：choices[0].text 当 content、无 thinking。
    取不到都是 ""。
    """
    try:
        choices = body.get("choices") or []
        if choices:
            msg = choices[0].get("message") or {}
            thinking = msg.get("reasoning_content") or ""
            content = msg.get("content") or ""
            if content or thinking:
                return (thinking, content)
            if choices[0].get("text"):
                return ("", choices[0].get("text"))
        d = body.get("data")
        if isinstance(d, dict):
            return (d.get("reasoning") or "", d.get("content") or d.get("text") or "")
    except (AttributeError, TypeError):
        pass
    return ("", "")


def non_stream_text(body: dict) -> str:
    """从非流式响应体提取文本，兼容多路径结构。取不到返回空字符串。"""
    thinking, content = non_stream_parts(body)
    return content or thinking
