# IterTrip · AGENTS.md — AI 代理（Agent）架构指南

> 版本：v1.0 · 2026-09-05 · 适用代码库：`backend/`（FastAPI）+ `frontend/`（React 18 + Vite）
> 面向读者：开发者、测试者、运维者，以及希望了解系统如何使用 AI 的非技术相关方。
> 阅读建议：第 1–3 章对非技术读者友好；第 4–7 章面向工程实现；第 8–10 章供产品与规划参考。

---

## 1. 一句话理解本系统

IterTrip 把你在小红书/公众号里刷到的旅游攻略，变成一张**可以动手改、可以带走的地图**。
系统内没有一个"全能 AI"，而是由多个**各司其职的 AI 代理（Agent）**协作完成：
一个负责**理解攻略并生成路线**，一个负责**听懂你的修改要求并动手改**，一个负责**给地点找到正确坐标**，
还有一个负责**检查你配置的 AI 服务是否可用**。所有 AI 的产出都汇入同一份数据（route JSON），
由地图、时间线、编辑器和导出器共享。

**核心设计原则**：AI 是动手的，用户是把关的。AI 的每次修改都走同一条撤销栈，随时可以反悔。

---

## 2. 系统架构总览

```
┌────────────────────────────  浏览器（React SPA）  ────────────────────────────┐
│  Chat 页（首页对话）          Plan 页（规划编辑器）             设置/后台面板    │
│  ─ 提取模式对话               ─ 地图 + 时间线 + 编辑器          ─ BYOK 设置     │
│  ─ ClarifyCard 澄清卡        ─ AI 对话抽屉（改路线）           ─ 地图显示设置   │
│                              ─ routeDiff 变更高亮 + 撤销栈     ─ 管理后台       │
└──────────────┬───────────────────────────────────────────────────────────────┘
               │  HTTP / SSE（fetch 流式读取）
┌──────────────▼────────────────  FastAPI 后端（单进程 C-1）  ──────────────────┐
│  api/chat.py     ←→  api/plan.py   api/geocode.py   api/llm.py   api/search.py │
│      │                    │               │             │            │        │
│      ▼                    ▼               ▼             ▼            ▼        │
│  【对话代理】          【规划代理】   【坐标代理】   【探测代理】  【搜索服务】   │
│  chat.py 双模式       planner.py   coordinates.py  llm.py      search.py      │
│  提取 / 改路线        (+mock降级)   三级降级       连通+视觉     价格抓取        │
│      │                    │               │                              │
│      └────────────────────┴───── 共用 LLM 调用层（engine/_llmutil.py）────────┘
│                                     │
│                          供应商解析链（见 §5.1）
│                    BYOK 请求头 > env > admin 配置 > .env 免费源 > mock
└───────────────────────────────────────────────────────────────────────────────┘
               │
               ▼  OpenAI 兼容 /chat/completions（DeepSeek / Qwen-VL / GPT-4o / 网关…）
            外部 LLM 供应商          外部搜索服务（Tavily 兼容 / RollingGo，可选）
```

关键工程事实：

- **单模型策略**：一个多模态模型承担「攻略理解 + 提取 + 对话改路线」全部工作，不做多模型编排（DESIGN.md §1.3）。
- **后端代理调用**：浏览器永远不直连 LLM 供应商。请求头携带用户自己的 key（BYOK）经本地后端转发，
  规避各家 CORS 差异，key 不出用户机器。
- **零账号零云依赖**：本地优先，无后端数据库；状态存 localStorage，服务端配置存 `admin_config.json`（不入 Git）。

---

## 3. 代理类型总览

| # | 代理 | 代码位置 | 职责一句话 | 是否流式 | 降级策略 |
|---|------|----------|-----------|---------|---------|
| A | **对话代理（Chat Agent）** | `backend/api/chat.py` | 统一对话入口：攻略提取（新路线）+ 对话改路线（编辑现有路线）+ 澄清提问 | SSE 流式 | 解析失败带错误重试 1 次 |
| B | **规划代理（Planner Agent）** | `backend/engine/planner.py` | 结构化表单（目的地/天数/预算…）→ 生成 route JSON | 否 | 失败或无 key → mock 规划器 |
| C | **坐标代理（Geocode Agent）** | `backend/engine/coordinates.py` | 给缺失/可疑坐标的地点补全经纬度 | 否 | LLM 知识 → 搜索兜底 → 城市中心表 → none |
| D | **探测代理（Probe Agent）** | `backend/api/llm.py` | 测试 BYOK 连通性、鉴权、模型名、视觉（看图）能力 | 否 | max_tokens 逐档降级重试 |
| E | **Mock 规划器（Mock Agent）** | `backend/engine/planner.py`（`plan_mock`） | 无 key/调用失败时的确定性演示降级，产出标注「mock 占位」的草稿 | 否 | —（本身即降级终点） |
| F | **搜索服务（Search Service）** | `backend/api/search.py` | 酒店价格参考（best-effort，非 LLM 驱动） | 否 | RollingGo → Tavily → 返回空报价+提示 |

> 说明：E/F 严格说不算"智能体"——Mock 是确定性代码，Search 是数据抓取服务；但它们在调用链路中
> 与代理同构（同样的输入输出契约与降级位置），故一并列出。

**非代理但密切协作的前端组件**：

- `frontend/src/lib/routeDiff.ts` — 对比新旧路线，产出新增/移除/移动/坐标修正清单与「我改了什么」中文叙述。
- `frontend/src/hooks/useTripHistory.ts` — 撤销栈（上限 50 帧），AI 修改与手动编辑共用同一栈。
- `frontend/src/components/ChatPanel.tsx`（ClarifyCard）/ `ThinkingBlock.tsx` — 澄清问题卡与思考链展示。

---

## 4. 各代理详解

### 4.A 对话代理（Chat Agent）——系统的"前台大脑"

**入口**：`POST /api/chat`（`backend/api/chat.py`），全站唯一对话入口，双模式共用。

**模式判定**：请求体 `route` 字段是否为 `null`：

| 模式 | 触发条件 | 系统提示词 | 输出契约 |
|------|---------|-----------|---------|
| **提取模式**（M13） | `route == null`（首页对话） | `SYSTEM_EXTRACT`（攻略结构化助手） | `<<<REPLY>>>` + `<<<JSON>>>`（完整 RouteJSON） |
| **修改模式**（M14） | `route != null`（规划页抽屉） | `SYSTEM_EDIT`（行程路线修改助手） | `<<<JSON>>>`：`{reply, changed, days}` |

**能力清单**：

1. **攻略提取**：贴一段攻略文字（含表情/口语/推广内容），忠于原文提取地点（不私自添加），按叙述顺序按天分组；
   营业时间/门票/贴士写入 `time/ticket/note`；summary 提炼 2-4 条关键避坑建议。
2. **对话改路线**：接收 `current_route` 完整 JSON + 用户修改要求；`changed=true` 时必须输出**完整** days 数组
   （禁止差异片段）；闲聊/咨询返回 `changed=false`。
3. **Agent 式澄清（M17）**：信息不足时不臆造路线，而是输出 `need_more_info: true` + 结构化问题数组
   `questions[]`（type 支持 `text`/`select`/`multi`/`date`，前端渲染成澄清卡片）。
4. **坐标修正硬约束**：用户指出"位置不对/在非洲/在海里"时，禁止 `changed=false` 口头道歉，必须改出真实坐标
   并在 reply 中说明新方位。后端另有三重兜底校验（见 §5.4）。

**调用参数**：`temperature=0.4`，`stream=true`，超时 180s，对话历史仅保留**最近 8 轮**（上下文护栏）。

**流式体验机制**：后端用 `asyncio.Queue` + 生产者任务并发——LLM 首个 token 到达前，按 0.9s 节奏轮播
前置阶段文案（"正在理解你的需求…/正在提取景点…/正在排行程…"），收到真实 thinking/delta 后立即接管。

### 4.B 规划代理（Planner Agent）

**入口**：`POST /api/plan`（`backend/api/plan.py` → `engine/planner.py`）。

- **输入**：结构化表单 `destination / days(1-30) / date / travelers / budget / style / constraints`。
- **系统提示词**：`SYSTEM_PROMPT`（专业旅行规划师），要求每天 3-5 个地点、坐标用确定知道的真实值（不确定填 0 等待补全）、
  `hotel.prices` 留空（价格中立，由用户手动提供）。
- **调用参数**：`temperature=0.7`，非流式，超时 120s。
- **产出**：RouteJSON；数据来源（`llm`/`mock`）通过响应头 `X-IterTrip-Source` 带出，不污染 route JSON。
- **规划后自动触发坐标代理**（`_enrich_coordinates`）补全缺失坐标。

### 4.C 坐标代理（Geocode Agent）

**入口**：`POST /api/geocode`（单独调用）；同时作为 A/B 的**内部下游**自动触发。

五级降级链（`engine/coordinates.py`，输出统一 GCJ-02）：

| 级别 | 策略 | 置信度 | 说明 |
|------|------|--------|------|
| 1 | LLM 已知知识（`geocode_by_llm`，temperature=0） | `high` | 知名地标坐标记忆可靠且零成本；不确定时模型输出 `not_found`；WGS84 → 转 GCJ-02 |
| 2 | 高德 POI 搜索（`geocode_by_amap`，需 `ITERTRIP_AMAP_KEY`） | `high`（名称互相包含/前 4 字重合） | 店名级精度，中国 POI 覆盖最好；直接返回 GCJ-02；名称不相关的首个 POI 视为未命中 |
| 3 | Web 搜索兜底（`geocode_by_search`，Tavily 兼容） | `low` | 搜「地名 城市 经纬度 坐标」，正则从结果文本抓坐标对；按 WGS84 → 转 GCJ-02 |
| 4 | 内置城市中心表（`_CITY_CENTER`，12 个热门城市硬编码） | `low` | 城市级兜底，至少落在正确城市；返回前转 GCJ-02 |
| 5 | 彻底失败 | `none` | lat/lng 返回 null，前端提示确认 |

**坐标系约定（v1.1 起）**：route JSON 内 lat/lng 统一存 **GCJ-02**，与高德瓦片（网页地图 + 导出模板主源）显示一致。
LLM 生成/mock 的坐标视为 WGS84，在进入 route 前经 `engine/geo.py` 的 `wgs84_to_gcj02` 转换一次；
对话改路线时与旧路线同名同值的"回显坐标"跳过转换（防双重偏移）；编辑器地图选点天然是 GCJ-02。

**离谱坐标检测（v1.1 新增，`planner._enrich_coordinates` 阶段①）**：以行程内有效坐标的
中位数为中心，偏离 > 100km 的点视为可疑 → 强制重新 geocode；新坐标与原值差 > 10km 才替换，
否则保留原值仅追加「坐标待确认」标注（防误杀跨城合法远点）。

置信度 `low` 的地点前端会追加「⚠️ 坐标待确认」标注（`planner._enrich_coordinates` 拼入 note）。

### 4.D 探测代理（Probe Agent）

**入口**：`POST /api/llm/test`（设置面板「测试连接」）与 `POST /api/admin/provider/test`（管理后台复用同一套探测函数）。

两层探测（`api/llm.py`）：

1. **文本探测**：发 `max_tokens` 递减序列（512→256→128→32）找可用档位，同时验证连通性/鉴权/模型名；
   严格校验响应必须含 `choices`（防止错路径命中 SPA 首页返回 HTML 却 200 的假阳性）。
2. **视觉探测**：用合法 1×1 红色像素 PNG + 提问组合发一次请求；2xx = 支持视觉；4xx 且错误体含
   `image/vision/multimodal` 等字样 = 明确不支持；其他 4xx = 未知按支持处理（宁可信其有）。

**返回**：`{ok, source(user|env|default|none), model, vision, message}`；`vision=false` 时前端置灰截图入口（为 M15 预留）。

### 4.E Mock 规划器（演示模式）

`planner.plan_mock`：无 key 或 LLM 失败时的**确定性降级**，保证全流程可体验：

- 目的地含"成都"：从 9 个真实样本地点池（武侯祠/锦里/宽窄巷子/熊猫基地…）轮转取点；
- 其他城市：生成占位坐标 + 显式标注「【mock 占位】坐标与名称均为草稿，请在编辑器中修改」；
- summary 明确提示当前处于 mock 模式。

### 4.F 搜索服务（酒店价格，可选能力）

`POST /api/search`：三级数据源策略——RollingGo 公开 API（`ITERTRIP_ROLLINGO_BASE_URL`）→
Tavily 兼容搜索（正则抽取 ¥100-99999 区间价格）→ 返回空报价 + 提示用户手动填写。
产品红线：**不抓取平台价格、不做预订**，价格中立，最低价仅做前端高亮。

---

## 5. 代理之间的交互模式

### 5.1 供应商解析链（所有代理共用的"燃料开关"）

每个代理调用 LLM 前都经过同一条配置优先级链（`planner._llm_config` + `api/deps.py`）：

```
① BYOK 请求头  X-LLM-Base / X-LLM-Key / X-LLM-Model   （用户自己的 key，最高优先）
        ↓ 未配置
② 环境变量     ITERTRIP_LLM_API_KEY / _BASE_URL / _MODEL （服务端默认供应商）
        ↓ 未配置
③ 后台管理配置  admin_config.json（可热更新，ITERTRIP_ADMIN_TOKEN 保护）
        ↓ 未配置/未启用
④ .env 免费源   ITERTRIP_FREE_API_KEY / _BASE_URL / _MODEL（服务器内置演示源）
        ↓ 未配置
⑤ Mock 降级     演示模式（规划代理）；HTTP 400 明确报错（对话代理）
```

注意：对话代理（chat）在无任何配置时**不静默降级**，而是流开始前预检并抛 HTTP 400，给出明确中文提示
（"请在模型设置填入 API Key，或服务器 .env 配置 ITERTRIP_FREE_API_KEY"）。

### 5.2 代理编排关系

```
用户输入
   ├─ 首页表单 ──→ 【B 规划代理】 ──触发──→ 【C 坐标代理】（批量补全）
   ├─ 首页对话 ──→ 【A 对话代理·提取模式】 ──触发──→ 【C 坐标代理】
   │                    │
   │                    └─ 信息不足 → 输出 questions[] → 前端澄清卡 → 用户补答 → 再入 A
   └─ 规划页对话 ─→ 【A 对话代理·修改模式】
                        │
                        ├─ changed=true ─→ 前端 diffRoute → 撤销栈 push → 地图闪烁高亮
                        └─ changed=false + 坐标类措辞 ─→ 后端强制调【C 坐标代理】真改坐标

设置面板/后台 ──→ 【D 探测代理】（只读探测，不改任何行程数据）
```

### 5.3 双段输出协议（A/B 与 LLM 之间的"握手格式"）

要求模型把**给人看的叙述**和**给机器解析的数据**分成两段输出：

```
<<<REPLY>>>已识别出 6 个地点，按 3 天排程…
<<<JSON>>>{"trip": {...}, "days": [...], "summary": [...]}
```

解析器（`_split_reply_json` / `_extract_json`）容忍多种退化形态：

- 模型漏掉标记、把 JSON 直接混在正文 → 从全文兜底挖出第一个 `{...}` 当结构化结果；
- 只有叙述没有 JSON → 当作追问/闲聊（合法路径，不算失败）；
- JSON 校验失败（pydantic ValidationError）→ **把错误信息回灌给模型重试 1 次**（自我修复环）；
  重试仍失败 → SSE `error` 事件终止。

### 5.4 坐标修正的三重后端兜底（修改模式特有）+ 生成时主动检测

防止模型"口头道歉但不真改"，`chat.py` 在 `changed=false` 或 `changed=true` 分支都有硬校验：

1. **关键词触发**：prompt 含「坐标/位置不对/非洲/海里/错/不对/偏」且模型返回 `changed=false` →
   后端直接对 prompt 中点名的地点强制重跑【C 坐标代理】，改完才返回路线；
2. **离谱坐标检测**：`lat<-30 或 >60、lng<70 或 >140`（中国境外）或 `(0,0)` 的可疑点纳入强制修正；
3. **二次校验**：`changed=true` 但用户点名的地点坐标与改前完全一致 → 判定"说了没做"，再次强制 geocode。

v1.1 起检测前移到生成阶段：每次规划/提取/改路线完成时，`_enrich_coordinates` 会**主动**做
行程内离谱检测（偏离中位中心 >100km → 强制重定位，见 §4.C），不再等用户抱怨。

### 5.5 前端协作模式（AI 修改的可视化闭环）

1. `chatStream` 收到终帧 `reply`（含新 route）→ `diffRoute(旧, 新)` 计算差异：
   `added / removed / moved / coordFixed / themeChanged` + 中文摘要列表（"✓ 把成都博物馆挪到了第 1 天"）；
2. 变化写入 `useTripHistory.mutate` —— **与手动拖拽共用同一撤销栈**（50 帧上限，AI 改动可撤销）；
3. 地图对新/移位地点做闪烁动画 + 自动 panTo 聚焦（`data-pin-key` 通道 + flash class）。

---

## 6. 数据流与通信协议

### 6.1 核心数据契约：RouteJSON（`engine/schema.py`，前后端共享）

```
RouteJSON
├── trip:   { title, destination, days:int, dates, budget, style, travelers }
├── days:   [ { day:int, theme, places:[Place], hotel: Hotel|null } ]      (≥1 天)
│             Place: { name, lat, lng, type: attraction|food|transport|other,
│                      time, transport, ticket, note }
│             Hotel:  { name, lat, lng, note, prices: [ {platform, price, breakfast, note} ] }
└── summary: [ str ]   （2-4 条综合建议）
```

- pydantic 严格校验 + **容错清洗**：LLM 幻觉出的 `prices`（如 `{type:...}` 当报价、price 缺失）会被
  清洗或丢弃而非整条路线报错（`Hotel._sanitize_prices`）；
- **坐标系（v1.1 起）**：lat/lng 统一存 GCJ-02（见 §4.C）；它是「生成、编辑、导出」三端共享的**唯一数据源**，
  也是 AI 对话修改的操作对象；
- 导出时注入自包含 HTML 模板的 `__TRIP_DATA__` 占位符（`engine/builder.py`，`</` 已转义防注入）。

### 6.2 /api/chat SSE 流式协议

请求：`{ prompt, history: [{role: user|assistant, content}] , route: RouteJSON|null }`

响应（`text/event-stream`），事件按序：

| event | data 内容 | 语义 |
|-------|----------|------|
| `stage` | `{stage: understand\|retry\|geocode\|done\|thinking-steps, label}` | 阶段播报（驱动前端状态文案） |
| `thinking` | `{thinking}` | 推理模型思考链增量（前端淡色小字滚动，不混入正文） |
| `delta` | `{text}` | 回复正文增量（已剥离协议标记，可直接追加渲染） |
| `reply` | `{reply, intent: route_edit\|chitchat, route, questions?}` | **终帧**：完整回复 + 新路线/澄清问题 |
| `error` | `{detail}` | 流开始后的错误（预检失败仍是 HTTP 400） |

`reply` 与 `error` 各只出现一次且必为最后一个事件；前端断流容错：网关不支持 stream 时自动回退非流式一次性取回。

### 6.3 前端持久化（localStorage，key 前缀 `itertrip:`）

| Key | 内容 | 备注 |
|-----|------|------|
| `itertrip:llm` | BYOK 设置 {baseUrl, apiKey, model, vision} | 永不上传第三方 |
| `itertrip:route` | 当前行程快照 | 刷新后回填恢复 |
| `itertrip:chat` | 对话历史（最近 30 条，剔除 route 快照） | 发请求时仅回传最近 8 条 |
| `itertrip:map` | 地图显示设置（M16，纯视图态） | 不写入 route/后端 |

### 6.4 REST 端点一览

| 端点 | 方法 | 作用 | 代理 |
|------|------|------|------|
| `/api/plan` | POST | 表单 → 路线（`X-IterTrip-Source` 头标明 llm/mock） | B/E |
| `/api/chat` | POST | 统一对话（SSE） | A |
| `/api/geocode` | POST | 单点名称 → 坐标 + confidence | C |
| `/api/search` | POST | 酒店价格参考 | F |
| `/api/llm/test` | POST | BYOK 连通 + 视觉探测 | D |
| `/api/export` | POST | route → 自包含 HTML 下载 | —（确定性构建） |
| `/api/admin/provider` | GET/PUT/DELETE | 后台供应商配置（key 脱敏返回） | — |
| `/api/admin/provider/test` | POST | 后台配置实时探测 | D |
| `/api/health` | GET | 健康检查 | — |

---

## 7. 配置选项与参数

### 7.1 环境变量（服务端）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ITERTRIP_LLM_API_KEY` | 空 | 主 LLM key（优先级②）；缺省走下级链 |
| `ITERTRIP_LLM_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容地址（自动补 `/v1`，兼容已带版本/完整路径的填法） |
| `ITERTRIP_LLM_MODEL` | `deepseek-chat` | 模型名 |
| `ITERTRIP_FREE_API_KEY` | 空 | 内置免费演示源 key（优先级④；仅存在于服务器 .env，不入 Git） |
| `ITERTRIP_FREE_BASE_URL` | `https://api.dragonzhi.xyz` | 免费源地址 |
| `ITERTRIP_FREE_MODEL` | `openrouter/free` | 免费源模型 |
| `ITERTRIP_SEARCH_API_KEY` | 空 | 可选，Tavily 兼容搜索 key（坐标兜底级 3 + 酒店搜索级 2） |
| `ITERTRIP_SEARCH_BASE_URL` | `https://api.tavily.com` | 搜索地址 |
| `ITERTRIP_AMAP_KEY` | 空 | 可选，高德 Web 服务 key（坐标兜底级 2：POI 店名级搜索，[申请地址](https://lbs.amap.com/)）；也可在后台界面配置，环境变量优先 |
| `ITERTRIP_ROLLINGO_BASE_URL` | 空 | 可选，RollingGo 酒店价格源 |
| `ITERTRIP_ADMIN_TOKEN` | 空 | 后台管理 token；**未配置 = 后台整体关闭（403/503）** |
| `ITERTRIP_CORS_ORIGINS` | 空（全放行） | 逗号分隔白名单，生产建议配置 |

### 7.2 后台配置文件 `admin_config.json`（项目根目录，.gitignore 忽略，可热更新）

```json
{ "provider": { "name": "", "base_url": "", "api_key": "", "model": "", "enabled": false }, "amap_key": "" }
```

- **保存即覆写本地文件**（整体 JSON 重写）；所有读取都重新 load 文件，无缓存，热更新即时生效；
- `amap_key`：高德 Web 服务 key，也可在后台界面配置；key 解析优先级 `ITERTRIP_AMAP_KEY` 环境变量 > 后台配置；
- 安全约束：api_key / amap_key 只在后端明文存于此文件；对外接口一律脱敏（`sk-***1234`）；
  PUT 时 key 留空 = 保留原值；token 比较用常量时间函数防时序侧信道；
- **主界面入口**：首页页脚有低调「后台」链接（灰字虚线下划线）→ Token 认证页（也支持 `/admin?admin_token=<值>` 免输登录）。

### 7.3 关键运行参数（代码内常量）

| 参数 | 值 | 位置 |
|------|-----|------|
| 规划代理 temperature / 超时 | 0.7 / 120s | `planner.plan_with_llm` |
| 对话代理 temperature / 超时 | 0.4 / 180s | `chat._stream_llm` |
| 坐标代理 temperature / 超时 | 0.0 / 30s | `coordinates.geocode_by_llm` |
| 对话历史护栏 | 后端与前端均取最近 8 轮 | `chat._stream_llm` / `Plan.sendAiEdit` |
| 解析失败重试 | 1 次（带错误回灌） | `chat` 主循环 |
| 撤销栈深度 | 50 帧 | `useTripHistory` |
| localStorage 对话留存 | 30 条 | `settings.saveChatHistory` |
| 表单天数范围 | 1–30 天 | `plan.PlanRequest` |
| max_tokens 探测档位 | 512→256→128→32 | `llm._text_probe_max_tokens` |

---

## 8. 用例与示例工作流

### 用例 1：粘贴攻略文字 → 地图（主路径①）

1. 首页对话框粘贴一段小红书攻略文字；
2. 【A 提取模式】流式输出：阶段播报 → （可选思考链）→ `<<<REPLY>>>` 叙述 → `<<<JSON>>>` 路线；
3. 有 0 坐标地点 → `stage: geocode` 播报，后端调【C】批量补全；
4. 终帧 `reply`（intent=route_edit）→ 前端跳转规划页，地图按天呈现。

### 用例 2：信息不足 → 澄清问答（Agent 式澄清，M17）

1. 用户只说"想去旅游"；【A】判定信息不足，返回 `need_more_info: true` + `questions[]`
   （如 type=date 的出发日期、type=select 的预算档位）；
2. 前端渲染澄清卡（ClarifyCard），用户填答后拼接进下一轮 prompt；
3. 信息足够后正常产出路线，澄清卡收起为普通文本（`answered` 标记）。

### 用例 3：对话改路线（M14 闭环）

1. 规划页打开 AI 抽屉，说「博物馆挪到第一天下午」；
2. 【A 修改模式】收到完整 current_route + 要求，返回 `{reply, changed: true, days: 完整数组}`；
3. 前端 `diffRoute` 得出 moved 清单 → 撤销栈 push → 地图闪烁 + panTo → 气泡显示「✓ 把成都博物馆从第 2 天挪到了第 1 天」；
4. 用户不满意 → Ctrl+Z / 撤销按钮回退（与手动编辑同栈）。

### 用例 4：坐标纠错（用户把关 AI 幻觉）

用户说「XX 店的位置不对，都标到海里去了」→ 即使模型返回 `changed=false` 口头道歉，
后端关键词兜底也会强制重跑【C】真改坐标，并在回复中注明"（已通过坐标服务修正 1 个地点）"。

### 用例 5：BYOK 配置与验证

设置面板填 Base URL / Key / 模型 → 【D】文本探测（找可用 max_tokens 档）→ 视觉探测（1×1 像素图）
→ 显示"连接成功 + 是否支持看图"；配置仅存本机 localStorage，后续请求经 `X-LLM-*` 头走后端代理。

### 用例 6：无 key 演示模式

服务器无任何 LLM 配置时：表单规划走【E Mock】生成成都样本行程（`X-IterTrip-Source: mock`）；
对话则返回 400 提示配置方法——保证"断网可演示、无 key 可联调"。

---

## 9. 限制与约束

**产品边界（DESIGN.md §8，明确不做）**：账号体系/云同步、价格抓取/预订、内置平台凭据、规划质量军备竞赛。

**代理能力约束**：

| 约束 | 细节 |
|------|------|
| 单模型全包 | 不做多模型/多代理编排；视觉能力取决于用户所配模型（推荐 VLM） |
| 截图输入未接入 | 视觉探测已就绪（M12），但 /api/chat 尚无图片字段——M15 待实现 |
| 链接解析不支持 | 平台链接解析是 v1 后 best-effort 扩展，当前需用户粘贴文字/截图 |
| 坐标可靠性 | 依赖 LLM 记忆（知名地标可靠，小店可能幻觉）→ 高德 POI 兜底（需 key）+ 离谱检测 + 置信度标注 + 用户确认；离谱检测针对中国境内外粗判（18-54N, 73-135E） |
| 上下文护栏 | 历史仅 8 轮 + 当前 route 快照；无 route 时历史对提取模式作用有限 |
| 重试预算 | JSON 解析失败仅重试 1 次；第二次失败直接终止并报错 |
| 价格中立 | prices 不由 AI 抓取（schema 主动清洗幻觉报价），搜索源 best-effort 不作保证 |
| 管理后台 | 未配置 `ITERTRIP_ADMIN_TOKEN` 即整体关闭；单 provider 无多 key 轮换 |
| 单进程形态 | 规划/对话长请求阻塞 uvicorn worker 数有限；无队列/限流，多人并发共享同一免费源时可能 429 |

**非功能性约束**：key 经本地进程但不出用户机器；导出 HTML 注入前已转义 `</`；admin token 常量时间比较。

---

## 10. 代理增强未来发展路线图

以下按 DESIGN.md §7/§9 整理，均属"已完成/规划中/待反馈"三档：

**已完成（M12–M14 + M17）**

- [x] BYOK 设置面板 + 连通/视觉探测（M12，探测代理上线）
- [x] 对话提取模式（M13）、对话改路线 + diff 可视化 + 同栈撤销（M14）
- [x] Agent 式澄清问题（M17，结构化 questions[]）
- [x] 后台管理配置（热更新 + 脱敏 + token 鉴权）

**近期规划**

- [ ] **M15 截图解析**：VLM 直出 route JSON（一次调用，不做图→文中转）；探测代理的 `vision`
      字段届时用于前端置灰/开启截图入口；截图完成后原图从上下文丢弃防 token 膨胀（§4.3 护栏①）
- [ ] **M16 可选上云**：HF Spaces / 国内 VPS（Dockerfile 已就绪）；届时需复核 CORS 白名单与后台 token

**v1 后扩展（待用户反馈决定）**

- [ ] **链接解析**：三层降级（匿名 fetch 分享短链 → 提示改用文字/截图 → 可选 resolver 插件）；
      永远 best-effort，不进核心依赖
- [ ] **数据契约增强**：`place.confidence` / `place.source`（攻略文本/截图/手填）可选字段，向后兼容

**候选方向（文档未承诺，仅记录讨论空间）**：多 provider 故障转移（当前单 provider 链）、
路线质量评分器、导出 HTML 内嵌轻量对话（分享后接收方可继续编辑式修改）。

---

*本文档基于代码实测编写（2026-09-05，对应 main 分支）。若提示词、参数或协议调整，请同步更新本文件。*
