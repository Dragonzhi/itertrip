"""跨路由共享的请求级工具：BYOK 请求头解析（DESIGN.md §4.2）。"""

from fastapi import Request


def llm_overrides(request: Request) -> dict | None:
    """从请求头提取 X-LLM-Base / X-LLM-Key / X-LLM-Model（BYOK）。

    优先级：请求头 > env 兜底 > mock 降级；无任何头返回 None（交由 env/mock 链路）。
    """
    base = request.headers.get("X-LLM-Base", "").strip()
    key = request.headers.get("X-LLM-Key", "").strip()
    model = request.headers.get("X-LLM-Model", "").strip()
    if not (base or key or model):
        return None
    return {"base_url": base, "api_key": key, "model": model}