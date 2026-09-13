"""记忆库 embedding 抽象（M18_MEMORY_PLAN.md §6）。

两种 provider，同一接口 `embed_texts(texts) -> list[list[float]]`：

- `local`（默认）：fastembed ONNX 本地推理（bge-small-zh-v1.5，512 维）。懒加载——
  首次调用才载入模型（首次运行会从 HuggingFace 拉约 100MB，国内可设 HF_ENDPOINT=https://hf-mirror.com）。
  未安装 fastembed 时抛 `EmbedError`（可读提示），上层按「记忆不可用」降级，不影响主线对话。
- `api`：OpenAI 兼容 `/embeddings`，本地零模型依赖（需自备服务）。

环境变量（见 .env.example）：
    ITERTRIP_EMBED_PROVIDER   local | api（默认 local）
    ITERTRIP_EMBED_BASE_URL   provider=api 时的 OpenAI 兼容地址
    ITERTRIP_EMBED_API_KEY    provider=api 时的 key
    ITERTRIP_EMBED_MODEL      默认 BAAI/bge-small-zh-v1.5
"""

import os

import httpx

from ._llmutil import endpoint, env_value

DEFAULT_MODEL = "BAAI/bge-small-zh-v1.5"

_model = None  # fastembed TextEmbedding 单例（进程内复用，避免重复加载 ONNX）


class EmbedError(RuntimeError):
    """embedding 不可用：缺依赖 / 未配置 / 远端失败。调用方应降级而非中断。"""


def provider() -> str:
    return (env_value("ITERTRIP_EMBED_PROVIDER") or "local").strip().lower()


def model_name() -> str:
    return env_value("ITERTRIP_EMBED_MODEL") or DEFAULT_MODEL


def _prepare_hf_env() -> None:
    """自定义 HF 镜像（如 hf-mirror.com）不支持 HF 的 Xet CAS 协议，会返回 401。

    只要设了 HF_ENDPOINT 就自动关闭 Xet（环境变量 + 已导入模块的常量双写，覆盖两种读取时机），
    避免「镜像配了却下不动模型」的隐蔽故障。配置同样支持写在 .env 里。
    """
    hf = env_value("HF_ENDPOINT")
    if not hf:
        return
    os.environ.setdefault("HF_ENDPOINT", hf)  # huggingface_hub 只认进程环境变量
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    try:
        from huggingface_hub import constants as _hf_const

        _hf_const.HF_HUB_DISABLE_XET = True
    except Exception:  # noqa: BLE001 未安装 huggingface_hub 时忽略（下一步的 import 会给出明确报错）
        pass


def _local_model():
    global _model
    if _model is None:
        _prepare_hf_env()
        try:
            from fastembed import TextEmbedding
        except ImportError as e:  # 可选依赖缺失：给出可执行的提示
            raise EmbedError(
                "未安装 fastembed（记忆库本地 embedding 依赖）："
                "执行 `pip install fastembed`，或设 ITERTRIP_EMBED_PROVIDER=api 使用远程 embedding"
            ) from e
        try:
            _model = TextEmbedding(model_name=model_name())
        except Exception as e:  # noqa: BLE001  模型下载/ONNX 初始化失败
            raise EmbedError(
                f"加载本地 embedding 模型 {model_name()} 失败：{e}（国内网络可设 HF_ENDPOINT=https://hf-mirror.com）"
            ) from e
    return _model


def _embed_api(texts: list[str]) -> list[list[float]]:
    base = env_value("ITERTRIP_EMBED_BASE_URL")
    key = env_value("ITERTRIP_EMBED_API_KEY")
    if not base or not key:
        raise EmbedError("embedding provider=api 需配置 ITERTRIP_EMBED_BASE_URL 与 ITERTRIP_EMBED_API_KEY")
    try:
        resp = httpx.post(
            endpoint(base) + "/embeddings",
            headers={"Authorization": "Bearer " + key},
            json={"model": model_name(), "input": texts},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
    except EmbedError:
        raise
    except Exception as e:  # noqa: BLE001
        raise EmbedError(f"调用远程 embedding 失败：{e}") from e
    # 按 index 排序，保证与输入顺序一致（部分网关不保证返回顺序）
    rows = sorted(data, key=lambda r: r.get("index", 0))
    if len(rows) != len(texts):
        raise EmbedError(f"远程 embedding 返回条数不匹配（{len(rows)} != {len(texts)}）")
    return [[float(x) for x in r.get("embedding") or []] for r in rows]


def embed_texts(texts: list[str]) -> list[list[float]]:
    """把文本批量转成向量。失败抛 EmbedError（调用方捕获后降级）。"""
    clean = [t if isinstance(t, str) else str(t) for t in texts]
    if not clean:
        return []
    if provider() == "api":
        return _embed_api(clean)
    model = _local_model()
    try:
        return [[float(x) for x in vec] for vec in model.embed(clean)]
    except Exception as e:  # noqa: BLE001
        raise EmbedError(f"本地 embedding 推理失败：{e}") from e


def embed_one(text: str) -> list[float]:
    vecs = embed_texts([text])
    if not vecs:
        raise EmbedError("embedding 结果为空")
    return vecs[0]
