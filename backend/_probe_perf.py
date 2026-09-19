r"""简历指标探针：/api/chat 真实链路耗时 + LLM token 消耗（直连网关等价请求）。

用法（项目根目录执行）::

    .venv\Scripts\python.exe backend\_probe_perf.py
    .venv\Scripts\python.exe backend\_probe_perf.py --runs 5 --token-samples 3 --url http://127.0.0.1:8100

两段测量（各自独立，任一段失败不影响另一段）：

A. **真实链路耗时**：POST /api/chat（提取模式，route=null）按 SSE 逐帧计时 ——
   端到端（发出请求 → 收到终帧 reply）、TTFT（首个 delta 正文增量）、TTFB（首个 SSE 帧）、
   以及终帧 reply.stats.elapsed_ms（服务端自计）。

B. **token 消耗**：项目从不记录 usage，故用**等价请求**直连同一 LLM 网关 ——
   配置取自 backend.engine.planner._llm_config()（与 /api/chat 完全同一来源），
   系统提示词取 backend.api.chat.SYSTEM_EXTRACT，user 消息与测试 prompt 完全一致，
   解析响应 usage.{prompt,completion,total}_tokens。429/5xx 按退避重试。

为什么 token 段必须直连：/api/chat 的 _stream_llm 不带 stream_options={"include_usage":true}，
流式路径拿不到 usage；加 --stream-usage 可实测该网关流式是否回传 usage（供后续改造参考）。

结果同时写 backend/_perf_result.json（原始样本，便于复核/重算均值）。
"""
import argparse
import asyncio
import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, ".")

import httpx  # noqa: E402

from backend.api.chat import SYSTEM_EXTRACT  # noqa: E402
from backend.engine._llmutil import endpoint, env_value  # noqa: E402
from backend.engine.planner import _llm_config  # noqa: E402

# 测试 prompt：一段典型的「成都 3 天攻略」（小红书口吻，含门票/时间/贴士/住宿），
# 与线上真实用法同构：提取模式 → 出路线 → 需补坐标 → 跑坐标代理 + 闭馆日检查。
PROMPT = (
    "成都3天攻略（国庆去）：\n"
    "Day1 上午武侯祠（门票50，9点开门），中午锦里吃小吃，下午宽窄巷子喝茶，晚上九眼桥看夜景。\n"
    "Day2 一早去大熊猫繁育研究基地（8点前到，熊猫上午活跃），下午回市区逛人民公园鹤鸣茶社，"
    "晚上春熙路吃火锅（小龙坎春熙路店）。\n"
    "Day3 上午成都博物馆（周一闭馆，需要提前预约），中午文殊院吃素斋，下午青羊宫，傍晚太古里购物。\n"
    "住宿：春熙路附近的亚朵酒店，标间大概500一晚。\n"
    "贴士：办张天府通刷地铁；熊猫基地建议地铁3号线转观光车。"
)

_RESULT_PATH = Path("backend/_perf_result.json")
_BACKOFF = (5, 15, 30)  # 网关限流退避（秒）


def _ms(t: float) -> int:
    return int(round(t * 1000))


async def _chat_once(client: httpx.AsyncClient, base: str, run: int, prompt: str) -> dict:
    """跑一次真实 /api/chat，返回逐帧计时记录。"""
    rec: dict = {
        "run": run, "ok": False, "http_status": None, "error": "",
        "ttfb_ms": None, "first_stage_ms": None, "first_trace_ms": None,
        "first_thinking_ms": None, "ttft_ms": None, "total_ms": None,
        "server_elapsed_ms": None, "deltas": 0, "delta_chars": 0,
        "pings": 0, "events": {}, "reply_chars": 0, "places": None,
        "intent": None, "model": None, "provider": None, "geocoded": None,
    }
    t0 = time.perf_counter()
    try:
        async with client.stream("POST", base + "/api/chat", json={"prompt": prompt, "route": None}) as resp:
            rec["http_status"] = resp.status_code
            if resp.status_code != 200:
                raw = (await resp.aread()).decode("utf-8", "ignore")
                rec["error"] = f"HTTP {resp.status_code}: {raw[:300]}"
                return rec
            ev: str | None = None
            buf: list[str] = []
            counts: Counter = Counter()
            async for line in resp.aiter_lines():
                now = time.perf_counter() - t0
                if line == "":
                    if ev:
                        counts[ev] += 1
                        first_key = {
                            "stage": "first_stage_ms", "trace": "first_trace_ms",
                            "thinking": "first_thinking_ms", "delta": "ttft_ms",
                        }.get(ev)
                        if first_key and rec.get(first_key) is None:
                            rec[first_key] = _ms(now)
                        if rec["ttfb_ms"] is None:
                            rec["ttfb_ms"] = _ms(now)
                        if ev == "delta":
                            try:
                                rec["delta_chars"] += len((json.loads("\n".join(buf)) or {}).get("text") or "")
                            except json.JSONDecodeError:
                                pass
                        elif ev == "ping":
                            rec["pings"] += 1
                        elif ev == "reply":
                            rec["total_ms"] = _ms(now)
                            try:
                                payload = json.loads("\n".join(buf))
                            except json.JSONDecodeError:
                                payload = {}
                            stats = payload.get("stats") or {}
                            rec["server_elapsed_ms"] = stats.get("elapsed_ms")
                            rec["places"] = stats.get("places")
                            rec["model"] = stats.get("model")
                            rec["provider"] = stats.get("provider")
                            rec["geocoded"] = stats.get("geocoded")
                            rec["intent"] = payload.get("intent")
                            rec["reply_chars"] = len(payload.get("reply") or "")
                            rec["ok"] = True
                        elif ev == "error":
                            try:
                                rec["error"] = str(json.loads("\n".join(buf)).get("detail"))[:200]
                            except json.JSONDecodeError:
                                rec["error"] = "\n".join(buf)[:200]
                    ev, buf = None, []
                    continue
                if line.startswith("event:"):
                    ev = line[6:].strip()
                elif line.startswith("data:"):
                    buf.append(line[5:].lstrip())
            rec["deltas"] = counts.get("delta", 0)
            rec["events"] = dict(counts)
            if rec["total_ms"] is None:
                rec["total_ms"] = _ms(time.perf_counter() - t0)
                rec["error"] = rec["error"] or "流结束但没有 reply 终帧"
    except Exception as e:  # noqa: BLE001 探针要如实记录失败而不是崩掉
        rec["error"] = f"{type(e).__name__}: {e}"[:200]
        rec["total_ms"] = _ms(time.perf_counter() - t0)
    return rec


async def measure_chat(base: str, runs: int, prompt: str) -> list[dict]:
    out: list[dict] = []
    timeout = httpx.Timeout(300.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for i in range(1, runs + 1):
            rec = await _chat_once(client, base, i, prompt)
            # 限流/网关瞬时错误：退避后重试一次（并发共享免费源时常见）
            if not rec["ok"] and ("429" in rec["error"] or "限流" in rec["error"] or "5" == rec["error"][:1]):
                print(f"  [run {i}] 失败（{rec['error'][:80]}）→ 20s 后重试一次", flush=True)
                await asyncio.sleep(20)
                rec = await _chat_once(client, base, i, prompt)
            flag = "ok" if rec["ok"] else "FAIL"
            print(
                f"  [run {i}] {flag} total={rec['total_ms']}ms ttft={rec['ttft_ms']}ms "
                f"server={rec['server_elapsed_ms']}ms deltas={rec['deltas']} "
                f"places={rec['places']} err={rec['error'][:80]}",
                flush=True,
            )
            out.append(rec)
            if i < runs:
                await asyncio.sleep(2)
    return out


def _token_call_sync(cfg: dict, prompt: str, stream_usage: bool = False) -> dict:
    """等价请求直连网关。返回 {ok, status, usage, finish_reason, error, text_len}。"""
    url = endpoint(cfg["base_url"]) + "/chat/completions"
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": SYSTEM_EXTRACT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.4,
    }
    if stream_usage:
        payload["stream"] = True
        payload["stream_options"] = {"include_usage": True}
    last = ""
    for attempt, delay in enumerate((0, *_BACKOFF)):
        if delay:
            print(f"    重试前等待 {delay}s（{last[:80]}）", flush=True)
            time.sleep(delay)
        try:
            with httpx.Client(timeout=300.0) as c:
                r = c.post(url, headers={"Authorization": "Bearer " + cfg["api_key"]}, json=payload)
            if r.status_code >= 400:
                last = f"HTTP {r.status_code}: {r.text[:160]}"
                if r.status_code in (429, 500, 502, 503, 504):
                    continue
                return {"ok": False, "status": r.status_code, "error": last, "usage": None}
            if stream_usage:
                # SSE：逐帧找 usage（OpenAI 约定最后一帧带 usage，且 choices 为空）
                usage, text_len, frames = None, 0, 0
                for line in r.text.splitlines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    frames += 1
                    if chunk.get("usage"):
                        usage = chunk["usage"]
                    for ch in chunk.get("choices") or []:
                        text_len += len(((ch.get("delta") or {}).get("content")) or "")
                return {
                    "ok": bool(usage), "status": r.status_code, "usage": usage,
                    "error": "" if usage else f"流式 {frames} 帧里没有 usage 字段",
                    "frames": frames, "text_len": text_len,
                }
            body = r.json()
            usage = body.get("usage")
            return {
                "ok": bool(usage),
                "status": r.status_code,
                "usage": usage,
                "error": "" if usage else "响应体没有 usage 字段",
                "finish_reason": ((body.get("choices") or [{}])[0] or {}).get("finish_reason"),
                "text_len": len((((body.get("choices") or [{}])[0] or {}).get("message") or {}).get("content") or ""),
            }
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
    return {"ok": False, "status": None, "error": last[:200], "usage": None}


async def measure_tokens(cfg: dict, samples: int, prompt: str) -> list[dict]:
    out: list[dict] = []
    for i in range(1, samples + 1):
        res = await asyncio.to_thread(_token_call_sync, cfg, prompt)
        u = res.get("usage") or {}
        print(
            f"  [token {i}] ok={res['ok']} prompt={u.get('prompt_tokens')} "
            f"completion={u.get('completion_tokens')} total={u.get('total_tokens')} err={res.get('error', '')[:80]}",
            flush=True,
        )
        out.append({"sample": i, **res})
        if i < samples:
            await asyncio.sleep(3)
    return out


def _mean(vals: list) -> float | None:
    v = [x for x in vals if isinstance(x, (int, float))]
    return round(statistics.mean(v), 1) if v else None


def summarize(chat: list[dict], tokens: list[dict], cfg: dict, base: str, stream_probe: dict | None) -> dict:
    ok = [r for r in chat if r["ok"]]
    tok_ok = [r for r in tokens if r.get("ok")]
    return {
        "env": {
            "target": base,
            "gateway": cfg["base_url"],
            "endpoint": endpoint(cfg["base_url"]) + "/chat/completions",
            "model": cfg["model"],
            "memory_enabled": env_value("ITERTRIP_MEMORY_ENABLED") or "0",
            "amap_configured": bool(env_value("ITERTRIP_AMAP_KEY")),
            "chat_params": {"temperature": 0.4, "stream": True, "timeout_s": 180, "max_tokens": None},
            "token_params": {"temperature": 0.4, "stream": False},
            "prompt_chars": len(PROMPT),
        },
        "chat": {
            "samples": len(chat), "succeeded": len(ok),
            "total_ms_mean": _mean([r["total_ms"] for r in ok]),
            "total_ms_list": [r["total_ms"] for r in ok],
            "ttft_ms_mean": _mean([r["ttft_ms"] for r in ok]),
            "ttft_ms_list": [r["ttft_ms"] for r in ok],
            "ttfb_ms_mean": _mean([r["ttfb_ms"] for r in ok]),
            "server_elapsed_ms_mean": _mean([r["server_elapsed_ms"] for r in ok]),
            "server_elapsed_ms_list": [r["server_elapsed_ms"] for r in ok],
            "places": [r["places"] for r in ok],
            "provider": [r["provider"] for r in ok],
        },
        "tokens": {
            "samples": len(tokens), "succeeded": len(tok_ok),
            "prompt_tokens_mean": _mean([(r["usage"] or {}).get("prompt_tokens") for r in tok_ok]),
            "completion_tokens_mean": _mean([(r["usage"] or {}).get("completion_tokens") for r in tok_ok]),
            "total_tokens_mean": _mean([(r["usage"] or {}).get("total_tokens") for r in tok_ok]),
            "raw": [r.get("usage") for r in tok_ok],
        },
        "stream_usage_probe": stream_probe,
    }


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8100")
    ap.add_argument("--runs", type=int, default=4)
    ap.add_argument("--token-samples", type=int, default=3)
    ap.add_argument("--stream-usage", action="store_true", help="额外实测流式路径是否回传 usage")
    ap.add_argument("--skip-chat", action="store_true")
    ap.add_argument("--skip-tokens", action="store_true")
    ap.add_argument("--merge", action="store_true", help="与已有 backend/_perf_result.json 的样本合并（增量补测）")
    args = ap.parse_args()
    base = args.url.rstrip("/")

    cfg = _llm_config()
    if not cfg:
        print("未解析到 LLM 配置（.env / 环境变量 / admin_config.json 都没有 key），token 段无法进行。")
    else:
        print(f"网关 {cfg['base_url']} · 模型 {cfg['model']} · endpoint {endpoint(cfg['base_url'])}/chat/completions")

    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            h = (await c.get(base + "/api/health")).json()
        print(f"后端健康检查：{h}")
    except Exception as e:  # noqa: BLE001
        print(f"后端不可达（{base}）：{e}\n请先启动：.venv\\Scripts\\python.exe -m uvicorn backend.main:app --port 8100")
        if not args.skip_chat:
            return 2

    chat: list[dict] = []
    if not args.skip_chat and args.merge:
        print("提示：--merge 会把本轮的耗时样本接到已有文件之后（不覆盖历史样本）。")
    if not args.skip_chat:
        print(f"\n=== A. 真实链路耗时（{args.runs} 次，串行，间隔 2s）===")
        chat = await measure_chat(base, args.runs, PROMPT)

    tokens: list[dict] = []
    stream_probe = None
    if cfg and not args.skip_tokens:
        print(f"\n=== B. token 消耗（直连网关，{args.token_samples} 次等价请求）===")
        tokens = await measure_tokens(cfg, args.token_samples, PROMPT)
        if args.stream_usage:
            print("\n=== C. 流式路径 usage 探测（stream_options.include_usage）===")
            stream_probe = await asyncio.to_thread(_token_call_sync, cfg, PROMPT, True)
            print(f"  ok={stream_probe['ok']} usage={stream_probe.get('usage')} err={stream_probe.get('error', '')[:80]}")

    # 增量补测：把上一次的原始样本接在前面（重排序号），样本越多均值越稳
    prev: dict = {}
    if args.merge and _RESULT_PATH.exists():
        try:
            prev = json.loads(_RESULT_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            prev = {}
    chat = [*(prev.get("chat_raw") or []), *chat]
    tokens = [*(prev.get("tokens_raw") or []), *tokens]
    for i, r in enumerate(chat, 1):
        r["run"] = i
    for i, r in enumerate(tokens, 1):
        r["sample"] = i
    stream_probe = stream_probe or prev.get("stream_usage_probe")

    summary = summarize(chat, tokens, cfg or {"base_url": "", "model": ""}, base, stream_probe)
    summary["chat_raw"] = chat
    summary["tokens_raw"] = tokens
    _RESULT_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== 汇总 ===")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("chat_raw", "tokens_raw")}, ensure_ascii=False, indent=2))
    print(f"\n原始样本已写入 {_RESULT_PATH}")
    return 0 if (chat or tokens) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
