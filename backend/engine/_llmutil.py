"""LLM 端点共享工具：URL 规范化 + 非流式响应文本提取 + 默认供应商配置。

默认供应商的 key 不写入代码（避免随 Git 泄露）：
    优先读环境变量，其次读项目根目录 .env 文件（.gitignore 已忽略，不入库）。
    都没配 → DEFAULT_PROVIDER 为 None，回落 mock 演示模式。
"""

import os
from pathlib import Path

_DEFAULT_KEY_ENV = "ITERTRIP_FREE_API_KEY"
_DEFAULT_BASE_ENV = "ITERTRIP_FREE_BASE_URL"
_DEFAULT_MODEL_ENV = "ITERTRIP_FREE_MODEL"
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = _PROJECT_ROOT / ".env"


def _read_env_file() -> dict:
    """极简 .env 解析（KEY=VALUE 每行一条，# 开头为注释），零第三方依赖。"""
    out: dict = {}
    try:
        for raw in _ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass  # .env 不存在 = 没配置，静默跳过
    return out


def _free_provider() -> dict | None:
    """内置免费供应商配置：env 优先于 .env 文件；key 缺失视为未配置（返回 None）。"""
    env_file = _read_env_file()
    api_key = os.environ.get(_DEFAULT_KEY_ENV, "").strip() or env_file.get(_DEFAULT_KEY_ENV, "")
    if not api_key:
        return None
    base_url = (
        os.environ.get(_DEFAULT_BASE_ENV, "").strip()
        or env_file.get(_DEFAULT_BASE_ENV, "")
        or "https://api.dragonzhi.xyz"
    ).rstrip("/")
    model = (
        os.environ.get(_DEFAULT_MODEL_ENV, "").strip()
        or env_file.get(_DEFAULT_MODEL_ENV, "")
        or "openrouter/free"
    )
    return {"api_key": api_key, "base_url": base_url, "model": model}


def default_provider() -> dict | None:
    """对外入口：内置默认免费供应商（可能为 None = 未配置，走 mock 演示模式）。"""
    return _free_provider()

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
