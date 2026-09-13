"""跨路由共享的请求级工具：BYOK 请求头解析（DESIGN.md §4.2）+ 匿名档案 id（M18）。"""

import re

from fastapi import Request

_ID_RE = re.compile(r"[^0-9a-zA-Z\-_]")


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


def traveler_id(request: Request) -> str:
    """匿名档案 id（请求头 X-Traveler-Id，前端 localStorage 生成）——记忆库 namespace 隔离键。

    缺失或非法时返回 ""：记忆功能按「关闭」处理（不检索、不入库），主线对话不受影响。
    该 id 只是随机 UUID，不含身份信息，也不与账号关联（本项目无账号体系）。
    """
    tid = _ID_RE.sub("", (request.headers.get("X-Traveler-Id", "") or "").strip())
    return tid[:64]