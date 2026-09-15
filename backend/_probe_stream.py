r"""优化②探针：SSE 心跳与逐点进度的确定性自检（**零网络**）。

用法: .venv\Scripts\python.exe backend\_probe_stream.py

覆盖：
1. 静默期吐 ping，且**没有**把内层生成器掐死（内层睡 4s 仍完整跑完、终帧照常到达）；
2. 终帧之后不再吐 ping；ping 带最近阶段名；
3. 内层异常 → 服务端错误帧（不静默结束）；
4. _enrich_progress 逐点报进度并把 filled 回传；
5. 真实 /api/chat 路由（fake LLM + fake geocode）在「慢模型 + 需要补坐标」时，
   也能吐出 ping / streaming / parse / geocode 进度，并且 reply 仍是最后一帧。
"""
import asyncio
import json
import os
import sys
import time

sys.path.insert(0, ".")
# 记忆库可能被 .env 打开（会去下载模型/打网络）；本探针必须零网络，故强制关闭
os.environ["ITERTRIP_MEMORY_ENABLED"] = "0"

import httpx  # noqa: E402

from backend.api import chat as chat_mod  # noqa: E402
from backend.engine import planner  # noqa: E402
from backend.main import app  # noqa: E402

PASS = 0
FAIL: list[str] = []


def check(name: str, cond: bool, extra: str = "") -> None:
    global PASS
    if cond:
        PASS += 1
        print(f"  [ok] {name}")
    else:
        FAIL.append(name)
        print(f"  [FAIL] {name} {extra}")


def parse_frame(raw: str) -> tuple[str, dict]:
    """SSE 帧 → (event, data)。"""
    name, data = "message", {}
    for line in raw.split("\n"):
        if line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            try:
                data = json.loads(line[5:].strip() or "{}")
            except json.JSONDecodeError:
                data = {}
    return name, data


async def t_heartbeat() -> None:
    print("[1] 心跳：静默期吐 ping，且不掐死内层")
    inner_done = False

    async def inner():
        nonlocal inner_done
        yield chat_mod._sse("stage", {"stage": "understand", "label": "开始"})
        await asyncio.sleep(4.0)
        inner_done = True
        yield chat_mod._sse("reply", {"reply": "好了"})

    t0 = time.perf_counter()
    frames = [f async for f in chat_mod._with_heartbeat(inner(), t0)]
    elapsed = time.perf_counter() - t0
    parsed = [parse_frame(f) for f in frames]
    pings = [d for n, d in parsed if n == "ping"]
    names = [n for n, _ in parsed]

    check("静默 4s 至少吐 2 帧 ping", len(pings) >= 2, f"实际 {len(pings)}")
    check("ping.ms 单调递增", all(b["ms"] >= a["ms"] for a, b in zip(pings, pings[1:])),
          str([p["ms"] for p in pings]))
    check("内层完整跑完（未被 wait_for 取消）", inner_done and elapsed >= 4.0, f"elapsed={elapsed:.2f}s")
    check("终帧是 reply，其后没有任何 ping",
          names[-1] == "reply" and "ping" not in names[names.index("reply"):], str(names[-3:]))
    check("ping 携带最近阶段名", bool(pings) and pings[-1].get("stage") == "understand", str(pings[-1:] or None))


async def t_inner_error() -> None:
    print("[2] 内层异常 → 错误帧（不静默结束）")

    async def boom():
        yield chat_mod._sse("stage", {"stage": "understand", "label": "开始"})
        raise RuntimeError("模拟内层炸了")

    parsed = [parse_frame(f) async for f in chat_mod._with_heartbeat(boom(), time.perf_counter())]
    names = [n for n, _ in parsed]
    check("最后一帧是 error", names[-1] == "error", str(names))
    check("错误帧带原因", "模拟内层炸了" in parsed[-1][1].get("detail", ""), str(parsed[-1][1]))


async def t_enrich_progress() -> None:
    print("[3] _enrich_progress 逐点报进度")
    seen: list[tuple[str, object]] = []

    async def fake_enrich(route, destination, overrides=None, traveler="", records=None,
                          session=None, force_verify=False, on_progress=None):
        for i, name in enumerate(["橘子洲头", "太平老街", "湖南博物院"], 1):
            if on_progress:
                on_progress(i, 3, name)
            await asyncio.sleep(0.01)
        return 2

    orig = planner._enrich_coordinates
    planner._enrich_coordinates = fake_enrich
    try:
        seen = [x async for x in chat_mod._enrich_progress(object(), "长沙")]
    finally:
        planner._enrich_coordinates = orig

    stages = [v for k, v in seen if k == "stage"]
    done = [v for k, v in seen if k == "done"]
    check("3 条进度 + 1 条完成", len(stages) == 3 and done == [2], str(seen))
    check("进度文案含 序号/总数/名称", "1/3" in stages[0] and "橘子洲头" in stages[0], stages[0])


FAKE_ROUTE_JSON = (
    '<<<REPLY>>>已识别 1 个地点。\n'
    '<<<JSON>>>{"trip": {"title": "长沙一日", "destination": "长沙", "days": 1}, '
    '"days": [{"day": 1, "theme": "抵达", "places": [{"name": "橘子洲头", "lat": 0, "lng": 0}], '
    '"hotel": null}], "summary": []}'
)


async def t_route() -> None:
    print("[4] 真实 /api/chat 路由（fake LLM + fake geocode，零网络）")

    async def fake_resolve(request):
        return {"base_url": "http://fake.local", "api_key": "k", "model": "fake-model"}, False, "env"

    async def fake_stream_llm(cfg, system, user_text, history, images=None):
        await asyncio.sleep(3.0)  # 慢模型：首字之前静默 3s（心跳要能盖住它）
        yield ("content", FAKE_ROUTE_JSON)

    async def fake_enrich(route, destination, overrides=None, traveler="", records=None,
                          session=None, force_verify=False, on_progress=None):
        # 坐标阶段是真正的长静默（整批跑完才吐 trace）——心跳就是为它准备的
        await asyncio.sleep(2.5)
        if on_progress:
            on_progress(1, 1, "橘子洲头")
        return 1

    orig_resolve, orig_stream = chat_mod._resolve_cfg, chat_mod._stream_llm
    orig_enrich = planner._enrich_coordinates
    chat_mod._resolve_cfg, chat_mod._stream_llm = fake_resolve, fake_stream_llm
    planner._enrich_coordinates = fake_enrich
    frames: list[str] = []
    t0 = time.perf_counter()
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://probe") as client:
            async with client.stream("POST", "/api/chat", json={"prompt": "长沙一日", "history": []}) as resp:
                check("HTTP 200 + text/event-stream",
                      resp.status_code == 200 and "text/event-stream" in resp.headers.get("content-type", ""),
                      f"{resp.status_code} {resp.headers.get('content-type')}")
                buf = ""
                async for chunk in resp.aiter_text():
                    buf += chunk
                    while "\n\n" in buf:
                        raw, buf = buf.split("\n\n", 1)
                        if raw.strip():
                            frames.append(raw)
    finally:
        chat_mod._resolve_cfg, chat_mod._stream_llm = orig_resolve, orig_stream
        planner._enrich_coordinates = orig_enrich
    elapsed = time.perf_counter() - t0

    parsed = [parse_frame(f) for f in frames]
    names = [n for n, _ in parsed]
    pings = [d for n, d in parsed if n == "ping"]
    stages = [d.get("stage") for n, d in parsed if n == "stage"]
    labels = [d.get("label", "") for n, d in parsed if n == "stage"]

    check("首字之前有阶段轮播（原有 liveness 机制仍在）",
          stages.count("thinking-steps") >= 1, str(stages))
    check("坐标阶段静默期有 ping", len(pings) >= 1, f"实际 {len(pings)}")
    check("ping 带着 geocode 阶段名", any(p.get("stage") == "geocode" for p in pings), str(pings[:3]))
    check("整条流没被心跳提前掐断（≥3s）", elapsed >= 3.0, f"elapsed={elapsed:.2f}s")
    check("有 streaming 阶段（首字播报）", "streaming" in stages, str(stages))
    check("有 parse 阶段（正在整理路线）", "parse" in stages, str(stages))
    check("有 geocode 逐点进度", any("1/1" in x for x in labels), str(labels))
    check("终帧是 reply 且是最后一帧", names[-1] == "reply", str(names[-3:]))
    check("reply 之后没有 ping", "ping" not in names[names.index("reply"):] if "reply" in names else True)


async def main() -> None:
    await t_heartbeat()
    await t_inner_error()
    await t_enrich_progress()
    await t_route()
    print()
    if FAIL:
        print(f"结果: {PASS} 通过 / {len(FAIL)} 失败 → {FAIL}")
        sys.exit(1)
    print(f"结果: {PASS}/{PASS} 全部通过")


asyncio.run(main())
