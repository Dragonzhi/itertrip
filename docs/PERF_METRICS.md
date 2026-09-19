# IterTrip · /api/chat 真实链路耗时与 token 消耗量化

> 版本 v1.0 · 2026-09-17 · 定位：可对外引用（简历/答辩）的端到端指标快照
> 一句话：在**不改一行业务代码**的前提下，用 SSE 逐帧埋点量出「贴一段成都攻略 → 出结构化路线」的真实链路耗时，
> 并用**参数完全一致的等价请求**直连同一网关补出项目从未记录的 token 消耗。

---

## 0. 结论速览

| 指标 | 值 | 样本 | 口径 |
|---|---|---|---|
| 端到端耗时（均值） | **64.46 s** | n=4 | 发请求 → 收到终帧 `reply`（客户端计时） |
| 端到端耗时（中位 / 区间 / SD） | 61.41 s / 54.93–80.10 s / 11.19 s | n=4 | 同上 |
| 服务端自计 `stats.elapsed_ms`（均值） | 64.45 s | n=4 | 与客户端差 **+11 ms**（SSE 传输 + 解析开销） |
| SSE 首帧 TTFB（均值） | **11.2 ms** | n=4 | 首个 SSE 帧（`stage`）到达 |
| 首个模型 token（思考链，均值） | **2.87 s** | n=4 | 首个 `thinking` 事件 |
| **TTFT（首个正文增量，均值）** | **43.02 s** | n=4 | 首个 `delta`（已剥离协议标记的用户可见正文） |
| 单次对话 tokens | prompt **1,071** + completion **4,110.6** = total **5,181.6** | n=5 | 等价请求（同 system/user/temperature/model）实测 |
| 其中思考链占比 | 68.3 %（reasoning 均值 2,827.8） | n=5 | `completion_tokens_details.reasoning_tokens` |
| 提示词缓存命中 | 1,024 / 1,071 tokens | 4/5 次 | `prompt_tokens_details.cached_tokens` |

**可直接引用的表述**

> 端到端链路埋点与量化：在 `/api/chat`（SSE）逐帧埋点，实测「成都 3 天攻略」提取链路端到端均值 **64.5 s**、SSE 首帧 **11 ms**、
> 首 token **2.9 s**、TTFT **43.0 s**（4 次样本，SD 11.2 s；客户端与服务端自计仅差 11 ms）；
> 单次对话 token 消耗 prompt **1,071** + completion **≈4.1 k** = **≈5.2 k tokens**（5 次均值），
> 其中推理链占 completion 的 **68 %**、提示词缓存命中 1,024/1,071。

---

## 1. 测试环境（样本数之外，环境必须写清）

| 项 | 值 |
|---|---|
| 机器 | Windows 11 家庭版 build 26200 · 13th Gen Intel i9-13980HX（24 核 32 线程）· 31.6 GB RAM |
| 运行时 | Python 3.12.6（`.venv`）· uvicorn 单进程 `127.0.0.1:8100` · FastAPI |
| 代码版本 | git `acf214d`（工作区干净，仅新增探针脚本） |
| 服务进程 | 启动于 2026-09-17 15:32，**晚于**最后一次后端代码改动（2026-09-15 23:21）→ 非陈旧进程 |
| 模型 / 网关 | `glm-5.3-flash` @ `https://api.dragonzhi.xyz/v1`（服务器 `.env` 免费源 `ITERTRIP_FREE_*`，provider=`free`） |
| 调用参数 | `temperature=0.4` · `stream=true` · `timeout=180s` · **无 `max_tokens`**（与 `chat._stream_llm` 一致） |
| 外部依赖 | 高德 key 已配置（坐标代理走真网络）· 记忆库 `ITERTRIP_MEMORY_ENABLED=1`（本轮未带 `X-Traveler-Id`，故未注入） |
| 请求内容 | 230 字符「成都 3 天攻略（国庆去）」文本，`route=null` → 提取模式（`SYSTEM_EXTRACT`） |
| 样本数 | 耗时 **4 次**（4/4 成功）· token **5 次** + 1 次流式 usage 探测 |

---

## 2. 方法

### 2.1 指标 A：真实链路耗时（端到端）

- 入口：`POST /api/chat`，SSE 逐帧读取（`httpx.AsyncClient.stream` + `aiter_lines`），**每帧打一次 `perf_counter`**；
- 计时起点 = 发起 HTTP 请求前；终点 = 收到 `event: reply` 终帧；
- 同时记录：TTFB（首个 SSE 帧）、首个 `thinking`、**TTFT = 首个 `delta` 正文增量**、`delta` 帧数/字符数、`ping` 心跳数、
  终帧 `stats.elapsed_ms` / `places` / `geocoded` / `intent` / `provider` / `error`；
- 4 次串行，间隔 2 s，避免共享免费源被限流；失败自动退避重试 1 次（本轮无需重试）。

### 2.2 指标 B：token 消耗（等价请求直连网关）

项目从不记录 usage：`chat._stream_llm` 的 payload 只带 `model/messages/temperature/stream`，**没有**
`stream_options={"include_usage": true}`，所以流式路径根本收不到 usage 字段。故：

1. 配置来源与线上完全同一份代码：`backend.engine.planner._llm_config()`；
2. endpoint 走项目自带的规范化函数 `_llmutil.endpoint()`（`https://api.dragonzhi.xyz` → `/v1/chat/completions`）；
3. system 提示词取 `backend.api.chat.SYSTEM_EXTRACT`，user 消息 = 同一条测试 prompt；
4. 请求参数与 `_stream_llm` 一致（`temperature=0.4`、同 model、不带 `max_tokens`），**唯一差异是 `stream=false`**；
   非流式对 `prompt_tokens` 无影响，`completion` 分布与流式一致（采样随机性照实报为区间）；
5. 解析 `usage`（含 `prompt_tokens_details.cached_tokens`、`completion_tokens_details.reasoning_tokens`）；
6. 429/5xx/网络错误按 **5 s → 15 s → 30 s** 退避重试。

### 2.3 为什么不用「前端页面手点」计时

浏览器手动计时会把「人点按钮的延迟、渲染抖动、DevTools 采样」混进来。本量化全部在 HTTP/SSE 边界完成，
客户端与服务端各记一次（`stats.elapsed_ms`），二者交叉校验。

---

## 3. 结果 A：真实链路耗时

### 3.1 逐次样本

| # | 端到端 | TTFT（首个正文） | TTFB | 首个思考 token | 服务端 elapsed_ms | delta 帧 | 正文长度 | ping | 地点 | 补坐标 | 错误 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 80.10 s | 60.12 s | 21 ms | 2.88 s | 80,091 ms | 106 | 142 字 | 3 | 11 | 13 | — |
| 2 | 58.15 s | 35.72 s | 7 ms | 2.48 s | 58,139 ms | 135 | 189 字 | 3 | 12 | 11 | — |
| 3 | 54.93 s | 32.77 s | 8 ms | 1.95 s | 54,915 ms | 119 | 156 字 | 4 | 11 | 9 | — |
| 4 | 64.68 s | 43.48 s | 9 ms | 4.17 s | 64,666 ms | 149 | 199 字 | 3 | 12 | 11 | — |
| **均值** | **64.46 s** | **43.02 s** | **11.2 ms** | **2.87 s** | **64,453 ms** | 127 | 172 字 | 3.25 | 11.5 | 11.0 | 0/4 |

- 中位数 61.41 s，样本标准差 11.19 s（样本量小，SD 只作波动量级参考）；
- 4/4 全部 `intent=route_edit`、`provider=free`、终帧正常，**零错误**；
- 每次生成 11–12 个地点、经坐标代理真写入 9–13 处坐标（高德网络调用在内），说明耗时里包含完整业务链路而非纯模型调用。

### 3.2 关键口径补充

| 观测 | 值 | 含义 |
|---|---|---|
| 客户端 − 服务端（均值） | +11 ms | SSE 传输 + 客户端解析 + JSON 反序列化开销，链路本身没有额外隐藏等待 |
| 首帧 11 ms → 首 token 2.87 s | 间隔 2.86 s | 连接建立、服务端预检、记忆检索（未注入）、请求上行与模型首 token 预热 |
| 首 token 2.87 s → 首个正文 43.02 s | 间隔 **40.15 s** | **纯推理链时间**：模型先连续吐 `reasoning_content`，正文增量迟迟不来 |
| 正文首发 43.02 s → 终帧 64.46 s | 间隔 21.44 s | 正文（约 172 字）+ 完整 route JSON 的生成、解析、坐标补全、闭馆日检查 |

---

## 4. 结果 B：token 消耗

### 4.1 逐次样本（非流式等价请求）

| 样本 | prompt | completion | total | 思考链 reasoning | 占比 | 缓存命中 |
|---|---|---|---|---|---|---|
| 1 | 1,071 | 4,450 | 5,521 | 3,235 | 72.7 % | 1,024 |
| 2 | 1,071 | 3,324 | 4,395 | 2,107 | 63.4 % | 0 |
| 3 | 1,071 | 4,953 | 6,024 | 3,652 | 73.7 % | 1,024 |
| 4 | 1,071 | 4,008 | 5,079 | 2,657 | 66.3 % | 1,024 |
| 5 | 1,071 | 3,818 | 4,889 | 2,488 | 65.2 % | 1,024 |
| **均值** | **1,071** | **4,110.6** | **5,181.6** | **2,827.8** | **68.3 %** | 4/5 命中 |

- `prompt_tokens` **5/5 恒定 1,071**（零方差）：system 提示词 + 同一条 prompt，上下文里没有 history、没有 route 快照；
- `completion` 区间 3,324–4,953（中位 4,008），波动来自采样随机性 —— 不同次生成的 JSON 长度本就不同；
- 另有 1 次首轮校验样本 total 6,720（completion 5,649），是本次观测到的**最大**值；
  计入后「观测区间」为 **4,395–6,720**。
  总计 **7 条等价请求记录** = 5 次正式样本 + 1 次流式 usage 探测 + 1 次首轮校验（未计入均值）。

### 4.2 流式路径能不能拿到 usage？——能

额外发了一次 `stream=true` + `stream_options={"include_usage": true}` 的等价请求：

| 项 | 值 |
|---|---|
| 是否回传 usage | ✅ 是（该网关支持，共 5,232 帧，末帧带 usage） |
| prompt / completion / total | 1,071 / 5,263 / 6,334 |
| reasoning_tokens / cached_tokens | 4,024（76.5 %）/ 1,024 |
| 模型原始输出长度 | 2,457 字符（`<<<REPLY>>>` 段 + `<<<JSON>>>` 段） |

**结论**：项目「未记录 usage」不是网关限制，而是 `_stream_llm` 少传了一个字段。
在该 payload 上加 `"stream_options": {"include_usage": True}` 并收集末帧 `usage`，即可把线上真实 token 落进终帧 `stats`。

### 4.3 补充测量：长期记忆检索的开销（本链路可忽略）

| 场景 | 耗时 | 命中 | 注入字数 |
|---|---|---|---|
| 冷启动（含本地 ONNX embedding 加载） | 1,213 ms | 4 条 | 349 字 |
| 热（第 2 次） | 23 ms | 4 条 | 349 字 |
| 热（第 3 次） | 21 ms | 4 条 | 349 字 |

库内 96 条 chunk（`memory.sqlite`），本次检索为**只读**（行数前后均为 96）。相对 64 s 的端到端耗时，记忆检索不是瓶颈；
但**线上真实浏览器请求会带 `X-Traveler-Id`**，命中记忆后 prompt 会多约 349 字（`prompt_tokens` 相应上升，本文的 1,071 **不含**该部分）。

---

## 5. 结论与可优化点

1. **TTFT 由推理链主导，不是网络也不是后端**：SSE 首帧 11 ms、首 token 2.87 s，但用户看到正文第一行要等 43.02 s ——
   该模型单次输出 2.1 k–4.0 k 思考 token（占 completion 的 68.3 %）。想压 TTFT，杠杆是**换非推理模型或限制 reasoning 预算**，
   而不是优化后端代码或传输层。
2. **usage 记录可以立刻补齐**：`_stream_llm` 加 `stream_options.include_usage` + 收集末帧 usage（已实测该网关支持），
   顺带能把 `reasoning_tokens` / `cached_tokens` 写进 `reply.stats`，让成本可观测。
3. **坐标与事实层不是耗时瓶颈**：每次仍完成 11–12 地点、9–13 处坐标写入与闭馆日检查，耗时占比远小于模型生成；
   心跳（每 2 s，观测 3–4 次/轮）证明静默期服务端在线。
4. **提示词缓存已生效**（1,024/1,071 ≈ 96 %）：system 提示词稳定，压缩提示词收益有限，重点应放在 completion 侧。

---

## 6. 复现方式

```powershell
# 1) 启动后端（若 8100 已有健康进程可复用，本文即复用该进程）
.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8100

# 2) 跑量化（耗时 4 次 + token 5 次 + 流式 usage 探测）
$env:PYTHONIOENCODING='utf-8'
.venv\Scripts\python.exe backend\_probe_perf.py --runs 4 --token-samples 5 --stream-usage

# 3) 增量补样本（与已有 backend/_perf_result.json 合并，不覆盖历史样本）
.venv\Scripts\python.exe backend\_probe_perf.py --skip-chat --token-samples 2 --merge
```

| 产物 | 说明 |
|---|---|
| `backend/_probe_perf.py` | 探针本体：`--url / --runs / --token-samples / --stream-usage / --skip-chat / --skip-tokens / --merge` |
| `backend/_perf_result.json` | 原始样本：`env` 快照 + `chat_raw`（逐帧计时）+ `tokens_raw`（每次 usage）+ `stream_usage_probe`，可直接重算均值 |

---

## 7. 口径边界（引用时必须同时带上的限定）

| 限定 | 说明 |
|---|---|
| 样本量 | 耗时 n=4、token n=5（+1 流式探测、+1 首轮校验）——**不是统计显著性结论，是量级与波动快照** |
| 模型与供应商 | `glm-5.3-flash` 经共享免费网关；换模型/换供应商数字会变（推理模型差异尤其大） |
| 并发 | 单进程串行测量（间隔 2 s），**不含并发/排队**场景；免费源多人共享时可能 429 |
| 记忆注入 | 本轮未带 `X-Traveler-Id`，属「无记忆注入」路径；线上浏览器路径的差异仅约 21 ms 检索 + 约 349 字注入 |
| token 测法 | 非流式等价请求（`stream=false`），`temperature=0.4` 下 completion 有采样随机性，故给区间而非单值 |
| 计费口径 | token 数来自网关 `usage` 原样上报，未做币种/单价换算（无报价表） |
| 观测到的异常 | 5 次 token 请求中有 1 次 SSL `UNEXPECTED_EOF`（免费网关偶发），按 5 s/15 s 退避后成功；不影响样本有效性 |

---

## 附：原始样本字段说明（`backend/_perf_result.json`）

| 字段 | 含义 |
|---|---|
| `chat_raw[].total_ms` | 客户端端到端（发请求 → `reply` 终帧） |
| `chat_raw[].ttfb_ms` / `first_stage_ms` / `first_trace_ms` | 首个 SSE 帧 / 首个 `stage` / 首个 `trace` |
| `chat_raw[].first_thinking_ms` | 首个思考链 token |
| `chat_raw[].ttft_ms` | 首个 `delta` 正文增量（本文 TTFT 定义） |
| `chat_raw[].server_elapsed_ms` | 终帧 `stats.elapsed_ms`（服务端自计） |
| `chat_raw[].deltas` / `delta_chars` / `pings` | 正文增量帧数 / 字符数 / 心跳数 |
| `chat_raw[].places` / `geocoded` / `intent` / `provider` | 终帧统计：地点数 / 坐标写入数 / 意图 / 供应商来源 |
| `tokens_raw[].usage` | 单次等价请求的 `usage` 原文（含 `cached_tokens` / `reasoning_tokens`） |
| `stream_usage_probe` | `stream_options.include_usage` 流式探测结果 |
