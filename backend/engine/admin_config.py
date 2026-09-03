"""后台 AI 服务配置存储（单 provider，无多 key）。

配置存于项目根目录 admin_config.json（.gitignore 已忽略，不入 Git）。
字段：provider = { name, base_url, api_key, model, enabled }

优先级（DESIGN.md §4.2）：
    BYOK 请求头（X-LLM-*）> ITERTRIP_LLM_* 环境变量 > 后台管理配置 > .env 免费供应商 > mock

安全：api_key 只在后端明文存于 gitignore 文件；对外接口一律脱敏。
"""

import os
import secrets
from pathlib import Path

from ._llmutil import _read_env_file

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_CONFIG_PATH = _PROJECT_ROOT / "admin_config.json"

_ADMIN_TOKEN_ENV = "ITERTRIP_ADMIN_TOKEN"


def _load() -> dict:
    """读取配置文件；不存在/损坏返回空 dict。"""
    try:
        import json

        raw = _CONFIG_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(data: dict) -> None:
    import json

    _CONFIG_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def get_provider() -> dict | None:
    """返回启用中的 provider（含真实 api_key）；未启用/无 key 返回 None。"""
    data = _load().get("provider") or {}
    if not data.get("enabled", False):
        return None
    api_key = str(data.get("api_key") or "").strip()
    if not api_key:
        return None
    return {
        "api_key": api_key,
        "base_url": str(data.get("base_url") or "").strip(),
        "model": str(data.get("model") or "").strip(),
    }


def mask_key(key: str) -> str:
    """脱敏展示：sk-…1234；过短则全打码。"""
    key = (key or "").strip()
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return key[:3] + "***" + key[-4:]


def view() -> dict:
    """给后台界面看的 provider 视图（api_key 脱敏）。"""
    p = _load().get("provider") or {}
    key = str(p.get("api_key") or "")
    return {
        "name": str(p.get("name") or ""),
        "base_url": str(p.get("base_url") or ""),
        "api_key_masked": mask_key(key),
        "has_key": bool(key),
        "model": str(p.get("model") or ""),
        "enabled": bool(p.get("enabled", False)),
    }


def save_provider(fields: dict) -> dict:
    """保存 provider。api_key 留空/未传 = 保留原 key。返回更新后的 view()。"""
    data = _load()
    old = data.get("provider") or {}
    new = dict(old)
    if "name" in fields:
        new["name"] = str(fields.get("name") or "")
    if "base_url" in fields:
        new["base_url"] = str(fields.get("base_url") or "").strip()
    if "model" in fields:
        new["model"] = str(fields.get("model") or "").strip()
    if "enabled" in fields:
        new["enabled"] = bool(fields.get("enabled"))
    api_key = str(fields.get("api_key") or "").strip()
    if api_key:
        new["api_key"] = api_key
    data["provider"] = new
    _save(data)
    return view()


def clear_provider() -> dict:
    """清空后台配置（恢复为未配置态）。"""
    _save({"provider": {"name": "", "base_url": "", "api_key": "", "model": "", "enabled": False}})
    return view()


def admin_token() -> str:
    """后台访问 token：环境变量优先，其次 .env 文件。"""
    env = os.environ.get(_ADMIN_TOKEN_ENV, "").strip()
    if env:
        return env
    return _read_env_file().get(_ADMIN_TOKEN_ENV, "")


def stored_key() -> str:
    """返回已保存的真实 api_key（供探测用）；未配置返回空串。"""
    return str((_load().get("provider") or {}).get("api_key") or "").strip()


def check_token(provided: str | None) -> bool:
    """常量时间比较，防时序侧信道。未配置 token 视为后台关闭（拒绝）。"""
    expected = admin_token()
    if not expected:
        return False
    return secrets.compare_digest(provided or "", expected)


def resolve_active() -> tuple[dict | None, str]:
    """复现 planner._llm_config 的无 BYOK 优先级，返回 (cfg, source)。

    source ∈ {"env", "admin", "free", "none"}。供后台界面显示「当前实际生效」状态。
    """
    from ._llmutil import default_provider

    key = os.environ.get("ITERTRIP_LLM_API_KEY", "").strip()
    if key:
        return (
            {
                "api_key": key,
                "base_url": os.environ.get("ITERTRIP_LLM_BASE_URL", "https://api.deepseek.com").rstrip("/"),
                "model": os.environ.get("ITERTRIP_LLM_MODEL", "deepseek-chat"),
            },
            "env",
        )
    admin = get_provider()
    if admin:
        return admin, "admin"
    free = default_provider()
    if free:
        return free, "free"
    return None, "none"
