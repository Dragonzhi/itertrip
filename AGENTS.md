# IterTrip · AGENTS.md — AI 代理（Agent）架构指南

> 版本：v1.4 · 2026-09-14 · 适用代码库：`backend/`（FastAPI）+ `frontend/`（React 18 + Vite）
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
│  提取 / 改路线        (+mock降级)   六级降级       连通+视觉     价格抓取        │
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
| C | **坐标代理（Geocode Agent）** | `backend/engine/coordinates.py` | 给缺失/可疑坐标的地点补全经纬度 | 否 | 记忆真值 → 高德 POI → LLM 知识 → 搜索兜底 → 城市中心表 → none |
| D | **探测代理（Probe Agent）** | `backend/api/llm.py` | 测试 BYOK 连通性、鉴权、模型名、视觉（看图）能力 | 否 | max_tokens 逐档降级重试 |
| E | **Mock 规划器（Mock Agent）** | `backend/engine/planner.py`（`plan_mock`） | 无 key/调用失败时的确定性演示降级，产出标注「mock 占位」的草稿 | 否 | —（本身即降级终点） |
| F | **记忆服务（Memory Store，M18）** | `backend/engine/memory_{store,embed,ingest}.py` + `backend/api/memory.py` | 攻略实体级切分 → embedding → SQLite 向量检索（供 A 注入）+ 坐标实体真值表（供 C 第 0 级） | 否 | 未开启 / 缺依赖 / 出错 → 全部 no-op，主线不受影响 |
| G | **搜索服务（Search Service）** | `backend/api/search.py` | 酒店价格参考（best-effort，非 LLM 驱动） | 否 | RollingGo → Tavily → 返回空报价+提示 |

> 说明：E/F/G 严格说不算"智能体"——Mock 是确定性代码，Search 是数据抓取服务，Memory 是存储 + 检索组件；
> 但它们在调用链路中与代理同构（同样的输入输出契约与降级位置），故一并列出。
> F 让 A 拥有了**跨会话长期记忆**（RAG），并给 C 加了一层「用户手改为真值」的检索增强。

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
5. **截图解析（M15）**：`/api/chat` 接受 `images[]`（data URL，≤4 张、单张解码后 ≤4MB，仅提取模式）；
   user 消息由 `build_user_content` 组成 OpenAI 多模态数组，一次调用直出 route JSON，不做图→文中转；
   网关 4xx 拒图且错误体含视觉字样 → 错误消息带 `[vision-unsupported]` 标记，前端据此回写 `vision=false` 置灰入口。
6. **长期记忆检索（M18）**：提取模式启动前按 prompt 检索该档案的历史攻略片段（top-k ≤6 / ≤1200 字），
   拼【记忆参考】块注入 user payload 尾部，要求模型**带 [n] 引用**且不得凭记忆编造；命中时先播报
   `stage: memory`。路线成功产出后，把本次攻略切分入库（**后台任务**，不占用本次响应时间）。
   编辑模式不注入（上下文已含完整 route，收益低、膨胀风险高）。
7. **决策轨迹（M19）**：整轮对话逐步下发 `event: trace`——用了哪个模型/从哪来、记忆命中几条（或为什么没注入）、
   每个地点的坐标出自哪里（记忆真值/高德 POI/模型推测/兜底）、有没有被替换或对齐、解析是否重试、
   坐标兜底是否触发、本轮耗时。终帧 `reply` 带完整 `trace` + `stats`；前端渲染成可折叠「🧭 决策过程」
   并随消息持久化。原则：**静默兜底必须变成可见决策**（历史上一次漏 import 导致的坐标基准静默失败就藏了很久）。

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

六级降级链（`engine/coordinates.py`，输出统一 GCJ-02；返回值统一带 `source` 标注出处）：

| 级别 | 策略 | source | 说明 |
|------|------|--------|------|
| 0 | **坐标实体记忆**（M18，需记忆库开启 + 请求头 `X-Traveler-Id`） | `memory`（high） | 用户在编辑器里**手动改过/地图选点**的同名同城地点即 ground truth；命中直接返回 GCJ-02，**不再调用 LLM，也不被高德核验覆盖** |
| 1 | **高德 POI 搜索**（`geocode_amap_scored`，需 `ITERTRIP_AMAP_KEY`；M19 升为一级，M20 加地理闸门） | `amap`（high/low） | 店名级精度，中国 POI 覆盖最好；**前 5 条候选先过地理闸门再打分**（名称分：完全相同 1.0 / 互相包含 0.75~0.95 / 公共前缀 ≥3 字 / 括号分支名取两次打分的较大值；类型不符 −0.15；低于 `_AMAP_MIN_SCORE=0.72` 视为未命中）。**地理闸门（M20）**：候选必须省份命中 / 城市命中 / 距目的地城市中心 ≤200km，否则一律不用——高德 `city` 参数只接受**城市名**，「湖南·长沙」这类省市连写会被静默忽略并返回全国结果（事故根因，见 §4.C 末尾）；带城市查不到时去限制重试一次；同城内错别字店名（笨萝卜↔笨罗卜）走模糊兜底，分数钳在 0.80 以下 |
| 2 | LLM 已知知识（`geocode_by_llm`，temperature=0） | `llm`（high） | 知名地标可靠、零成本，但小店可能幻觉 —— 故**降为兜底**（此前它排第一位，导致高德实际上从未被使用）；不确定时模型输出 `not_found`；WGS84 → 转 GCJ-02 |
| 3 | Web 搜索兜底（`geocode_by_search`，Tavily 兼容） | `search`（low） | 搜「地名 城市 经纬度 坐标」，正则从结果文本抓坐标对；按 WGS84 → 转 GCJ-02 |
| 4 | 内置城市中心表（`_CITY_CENTER`，46 个城市硬编码；M20 补全，并按 `parse_region` 结果精确查表） | `city`（low） | 城市级兜底，至少落在正确城市；返回前转 GCJ-02 |
| 5 | 彻底失败 | `none` | lat/lng 返回 null，前端提示确认 |

**请求级预算与熔断（M19）**：高德超时 8s（原 30s × N 个地点会拖死一次规划）、单次路线预算 40 次请求、
同名同城走缓存去重；key 无效/配额用尽（`infocode` 10001/10003/10004/10044）**立即熔断**，网络类错误连续 2 次熔断，
之后本次请求不再尝试高德 —— 全部降级为「模型兜底」，绝不阻断出路线。

> 第 0 级只由**用户手改**写入（`source=user_pin`）。LLM/高德给出的 `high` 结果**不**自动入库——
> 否则幻觉坐标会被固化成「真值」，反而污染后续所有规划（设计取舍见 §4.F 与 DESIGN.md §4.4）。
> 前端「🔍 按名称重新定位」（`POST /api/geocode`）同理只写进表单草稿，需用户点「保存修改」才落库，也不写记忆真值表。

**坐标系约定（v1.1 起）**：route JSON 内 lat/lng 统一存 **GCJ-02**，与高德瓦片（网页地图 + 导出模板主源）显示一致。
LLM 生成/mock 的坐标视为 WGS84，在进入 route 前经 `engine/geo.py` 的 `wgs84_to_gcj02` 转换一次；
对话改路线时与旧路线同名同值的"回显坐标"跳过转换（防双重偏移）；编辑器地图选点天然是 GCJ-02。

> **M19 修复**：上面两条此前都没真正生效 —— 表单规划有转换循环，但**对话提取分支压根没转**；改路线分支调用了
> `wgs84_to_gcj02` 却**忘了 import**，每次 `NameError` 都被 `except: print("转换失败(忽略)")` 吞掉。
> 实测 WGS84 坐标画在高德瓦片上的固有偏移是 **361m（成都）~555m（北京）**，也就是「看着都偏一条街」。
> 现在转换收敛成两个共享函数：`planner.route_to_gcj02(route)`（整条）与 `planner.convert_new_coords(new, old)`
> （只转改动点、回显沿用旧来源）；真出问题也会在决策轨迹里以 `coord-datum` warn 步暴露，不再静默。

**离谱坐标检测（v1.1 新增，`planner._enrich_coordinates` 阶段①）**：以行程内有效坐标的
中位数为中心，偏离 > 100km 的点视为可疑 → 强制重新 geocode；新坐标与原值差 > 10km 才替换，
否则保留原值仅追加「坐标待确认」标注（防误杀跨城合法远点）。M19 追加：境内行程（中位数落在国境内）里
落在中国境外的点**一律**视为可疑（幻觉 / lat,lng 写反），重定位只要落回境内就替换；
`source=user` 或命中实体记忆的点跳过本阶段（用户可以合法地把点挪到很远的地方）。

**主动核验（M19 引入，M20 收紧为「精修不搬家」，`_enrich_coordinates` 阶段③；只在配了高德 key 时执行）**：
对行程内**已有坐标**的地点/酒店直接查高德（只查高德、不整链，避免自己证明自己）：

- 强匹配（≥0.85）且偏差 ≤ 1.5km → 采用 POI 坐标（记 `align`）：实测模型坐标虽同城，却普遍偏离真实 POI
  **113m~1.2km**，只标注不采用等于白核验 —— 这是 M19 最关键的一条修正；
- 偏差 > 1.5km 的强匹配**必须有佐证才允许搬**：名称完全一致（≥0.99）或候选池 ≥3 条互相同意（0.5km 内）；
  否则保留原坐标 + 标【坐标待确认】（记 `conflict`）。依据：同名子 POI「湖南博物院(南院)」拿到 0.94 分，
  会把只差 0.4km 的正确坐标挪走 2.3km；而 M20 之前「强匹配一律采用」正是 7 个长沙地点被搬到
  山西/河北/北京/河南/天津的直接原因（一次没有地理校验的「核验」比不核验更糟）；
- **弱匹配（0.72~0.85）且偏差 > 1.5km** → 保留原值 + 标注【坐标待确认】（记 `conflict`，防同名连锁店误伤）；
- 弱匹配但偏差 ≤ 1.5km → 保留原值且**不升级来源标注**（记 `confirm`，避免「高德核验」名不副实）；
- **行程地理包络（M20）**：紧凑行程（有效点离中位数都 ≤100km）里，强匹配 POI 若落在
  `max(spread,50)+150km` 之外 → 不采用，只标注。但现有坐标**本身已离谱**（离中位数 >100km 或离目的地
  城市中心 >200km）时不做包络保护 —— 否则「整条路线都在错误省份」时一个点都修不回来；
- 用户真值（`source=user` / `source=memory` / 实体记忆命中）一律跳过：高德再权威也不能覆盖用户亲手点的位置。

置信度 `low` 的地点前端会追加「⚠️ 坐标待确认」标注（`planner._enrich_coordinates` 拼入 note）；
place/hotel 的 `source` + `confidence` 另在时间线与地图气泡渲染成来源徽标（M19）：
**你确认过**（user/memory）/ **高德核验**（amap, high）/ **AI 推测**（llm，未核验）/ **搜索兜底·城市中心**（low）/ **mock 样例**。

### 4.D 探测代理（Probe Agent）

**入口**：`POST /api/llm/test`（设置面板「测试连接」）与 `POST /api/admin/provider/test`（管理后台复用同一套探测函数）。

两层探测（`api/llm.py`）：

1. **文本探测**：发 `max_tokens` 递减序列（512→256→128→32）找可用档位，同时验证连通性/鉴权/模型名；
   严格校验响应必须含 `choices`（防止错路径命中 SPA 首页返回 HTML 却 200 的假阳性）。
2. **视觉探测**：用合法 1×1 红色像素 PNG + 提问组合发一次请求；2xx = 支持视觉；4xx 且错误体含
   `image/vision/multimodal` 等字样 = 明确不支持；其他 4xx = 未知按支持处理（宁可信其有）。

**返回**：`{ok, source(user|env|default|none), model, vision, message}`；`vision=false` 时前端置灰截图入口（M15 已接入）。

### 4.E Mock 规划器（演示模式）

`planner.plan_mock`：无 key 或 LLM 失败时的**确定性降级**，保证全流程可体验：

- 目的地含"成都"：从 9 个真实样本地点池（武侯祠/锦里/宽窄巷子/熊猫基地…）轮转取点；
- 其他城市：生成占位坐标 + 显式标注「【mock 占位】坐标与名称均为草稿，请在编辑器中修改」；
- summary 明确提示当前处于 mock 模式。

### 4.F 记忆服务（Memory Store，M18 · RAG）

**入口**：`POST /api/memory/feedback`、`GET /api/memory/stats`、`DELETE /api/memory/all`
（`backend/api/memory.py`）；并作为 A（检索注入 / 入库）与 C（第 0 级）的**内部下游**自动参与。

**三种 chunk**（`engine/memory_ingest.py`：旅游攻略天然有语义单元，故按**实体级**切分，不做定长滑窗）：

| kind | 内容 | 用途 |
|------|------|------|
| `place_card` | 单地点原子事实：名称 + 备注 + 时间 + 门票 + 所属天主题 | 语义检索主粒度 |
| `trip_summary` | 整篇攻略级：标题 + 目的地 + 天数 + summary[] | 回答「上次那篇整体怎么排的」 |
| `place_entity` | 坐标真值：名称 + 城市 + lat/lng + source=user_pin | geocode 第 0 级精确命中（不参与语义检索） |

**存储**（`engine/memory_store.py`）：`memory.sqlite` 单文件（项目根，gitignore；`ITERTRIP_MEMORY_DB` 可改），
WAL 模式；检索 = SQL 预过滤（档案 + 城市 + kind）后候选集内暴力余弦 top-k，留 `VectorIndex` 接口位。

**embedding**（`engine/memory_embed.py`）：`local`（默认，fastembed ONNX `BAAI/bge-small-zh-v1.5`，
512 维，懒加载；未安装依赖时报错可读）/ `api`（OpenAI 兼容 `/embeddings`）。

**注入格式**（拼在提取模式 user payload 尾部）：

```
【记忆参考】这位旅行者过往攻略的相关片段（仅供引用，不是本次必含内容；冲突以本次为准）：
[1]《成都 3 日》· 人民公园：鹤鸣茶社喝盖碗茶 · D1 上午（2026-09）
使用规则：与当前需求相关才提及，引用必须带 [n]；不得凭记忆编造本次攻略没有的内容。
```

**护栏与降级**：top-k ≤6 且总字数 ≤1200；库为空时连 query embedding 都不算（首轮零额外开销）；
缺 fastembed / 库损坏 / 未开开关 → 打印日志后静默跳过，**绝不影响主线对话**；入库走后台任务，不拖慢响应。

### 4.G 搜索服务（酒店价格，可选能力）

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
   ├─ 首页对话 ──→ 【A 对话代理·提取模式】 ──触发──→ 【C 坐标代理】（补全 + 主动核验）
   │                    │  ↑ 检索注入【记忆参考】
   │                    │  ├─ 成功产出攻略 ──→ 【F 记忆服务】切分入库（后台任务）
   │                    │  └─ 全程逐步下发 event: trace（M19 决策轨迹）→ 前端「🧭 决策过程」
   │                    └─ 信息不足 → 输出 questions[] → 前端澄清卡 → 用户补答 → 再入 A
   └─ 规划页对话 ─→ 【A 对话代理·修改模式】 ──同样下发 trace──→ 抽屉（对话 + 轨迹持久化在 itertrip:planchat）
                        │
                        ├─ changed=true ─→ 前端 diffRoute → 撤销栈 push → 地图闪烁高亮
                        └─ changed=false + 坐标类措辞 ─→ 后端强制调【C 坐标代理】真改坐标（trace 记 coord-fallback）

编辑器手动改点/地图选点 ──→ 【F 记忆服务·place_entity】（POST /api/memory/feedback，fire-and-forget）
                             └─ 之后同名同城地点 geocode 命中【C 第 0 级】，不再问 LLM

设置面板/后台 ──→ 【D 探测代理】（只读探测，不改任何行程数据）
设置面板 ──→ GET /api/memory/stats（条数/城市）· DELETE /api/memory/all（清空自己的记忆）
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

请求：`{ prompt, history: [{role: user|assistant, content}] , route: RouteJSON|null, images?: [data URL]（M15 截图，仅提取模式） }`

响应（`text/event-stream`），事件按序：

| event | data 内容 | 语义 |
|-------|----------|------|
| `stage` | `{stage: understand\|memory\|retry\|geocode\|done\|thinking-steps, label}` | 阶段播报（驱动前端状态文案）；`memory` = 已检索到历史攻略并注入（M18） |
| `trace` | `{step: {id, kind, status, title, detail, ms, meta}}` | **M19 决策轨迹**：逐步下发，同 `id` 为 upsert；`kind=provider\|memory\|llm\|retry\|geocode\|edit\|summary`，`status=run\|done\|warn\|fail\|skip`（见 §4.A 能力 7） |
| `thinking` | `{thinking}` | 推理模型思考链增量（前端淡色小字滚动，不混入正文） |
| `delta` | `{text}` | 回复正文增量（已剥离协议标记，可直接追加渲染） |
| `reply` | `{reply, intent: route_edit\|chitchat, route, questions?, trace: [...], stats: {...}}` | **终帧**：完整回复 + 新路线/澄清问题 + **本轮完整轨迹与统计**（供前端持久化重放） |
| `error` | `{detail}` | 流开始后的错误（预检失败仍是 HTTP 400） |

`reply` 与 `error` 各只出现一次且必为最后一个事件；前端断流容错：网关不支持 stream 时自动回退非流式一次性取回。
轨迹步上限 60（随消息进 localStorage，超出只计数并在 summary 步里提示省略条数）；轨迹不含 prompt/响应原文与任何 key。

### 6.3 前端持久化（localStorage，key 前缀 `itertrip:`）

| Key | 内容 | 备注 |
|-----|------|------|
| `itertrip:llm` | BYOK 设置 {baseUrl, apiKey, model, vision} | 永不上传第三方 |
| `itertrip:route` | 当前行程快照 | 刷新后回填恢复 |
| `itertrip:chat` | 对话历史（最近 30 条，剔除 route 快照） | 发请求时仅回传最近 8 条 |
| `itertrip:map` | 地图显示设置（M16，纯视图态） | 不写入 route/后端 |
| `itertrip:tid` | 匿名档案 id（M18 记忆库 namespace） | `crypto.randomUUID()` 随机生成，不含身份信息；随 `X-Traveler-Id` 头发送 |
| `itertrip:planchat` | 规划页 AI 抽屉对话（M19，含决策轨迹/变更清单/澄清问答状态） | 存 `{fp, msgs}`，`fp=标题\|目的地\|天数`：刷新恢复、换行程自动开新会话；剔除 route 快照，最近 30 条 |

### 6.4 REST 端点一览

| 端点 | 方法 | 作用 | 代理 |
|------|------|------|------|
| `/api/plan` | POST | 表单 → 路线（`X-IterTrip-Source` 头标明 llm/mock） | B/E |
| `/api/route/recheck` | POST | **整条路线坐标重校准（M20）**：`force_verify` 不信任历史来源标注，用户真值跳过；返回 `{route, filled, records, amap_calls, amap_reason}` | C |
| `/api/chat` | POST | 统一对话（SSE） | A |
| `/api/geocode` | POST | 单点名称 → 坐标 + `confidence` + `source`（M19：记忆真值 → 高德 POI → 模型 → 兜底） | C/F |
| `/api/search` | POST | 酒店价格参考 | G |
| `/api/llm/test` | POST | BYOK 连通 + 视觉探测 | D |
| `/api/export` | POST | route → 自包含 HTML 下载（导出副本自动清洗：无坐标/(0,0) 地点与无效酒店剔除，名单写入 summary；保证导出成功且无「非洲点」） | —（确定性构建） |
| `/api/admin/provider` | GET/PUT/DELETE | 后台供应商配置（key 脱敏返回） | — |
| `/api/admin/provider/test` | POST | 后台配置实时探测 | D |
| `/api/memory/feedback` | POST | 编辑器改点上报坐标真值（place_entity 入库；记忆关闭/无档案 → no-op） | F |
| `/api/memory/stats` | GET | 当前匿名档案的记忆条数/类型/城市（设置面板展示） | F |
| `/api/memory/all` | DELETE | 清空**当前档案**的全部记忆（不跨档案） | F |
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
| `ITERTRIP_AMAP_KEY` | 空 | **建议配置**：高德 Web 服务 key（[申请地址](https://lbs.amap.com/)）。M19 起它同时是**一级坐标源 + 主动核验开关**：配了就优先用 POI 店名级坐标并核验已有坐标；没配则回落模型知识（行为同 v1.1）。也可在后台界面配置，环境变量优先 |
| `ITERTRIP_ROLLINGO_BASE_URL` | 空 | 可选，RollingGo 酒店价格源 |
| `ITERTRIP_ADMIN_TOKEN` | 空 | 后台管理 token；**未配置 = 后台整体关闭（403/503）** |
| `ITERTRIP_MEMORY_ENABLED` | 空（关闭） | 记忆库总开关（`1/true/yes/on` 开启）；关闭时记忆端点全 no-op、geocode 跳过第 0 级 |
| `ITERTRIP_EMBED_PROVIDER` | `local` | `local`=fastembed 本地 ONNX；`api`=OpenAI 兼容 `/embeddings` |
| `ITERTRIP_EMBED_MODEL` | `BAAI/bge-small-zh-v1.5` | embedding 模型名（512 维） |
| `ITERTRIP_EMBED_BASE_URL` / `ITERTRIP_EMBED_API_KEY` | 空 | provider=api 时必填 |
| `ITERTRIP_MEMORY_DB` | `<项目根>/memory.sqlite` | 记忆库单文件路径（容器部署可指向持久卷） |
| `HF_ENDPOINT` | 空 | 本地模型下载镜像（国内建议 `https://hf-mirror.com`；设了会自动关 Xet 协议） |
| `ITERTRIP_CORS_ORIGINS` | 空（全放行） | 逗号分隔白名单，生产建议配置 |

> 读取口径：`ITERTRIP_CORS_ORIGINS` / `ITERTRIP_AMAP_KEY` / 记忆库系列与 `ITERTRIP_FREE_*`、`ITERTRIP_ADMIN_TOKEN`
> 一致——**进程环境变量优先，其次项目根 `.env`**（`engine/_llmutil.env_value`，每次读取都重新解析文件）。

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
| 记忆检索 top-k / 注入字数上限 | 6 条 / 1200 字 | `memory_ingest._TOP_K` / `_MAX_CHARS` |
| 记忆检索/入库超时 | 30s / 180s（入库为后台任务） | `chat._memory_reference` / `_memory_ingest_bg` |
| 高德超时 / 单次预算 / 熔断 | 8s / 40 次 / 致命 1 次·网络连续 2 次 | `coordinates._AMAP_TIMEOUT` / `_MAX_AMAP_CALLS` / `AmapSession` |
| 高德名称接受 / 强匹配 / 精确同名 | 0.72 / 0.85 / 0.99（类型不符 −0.15） | `coordinates._AMAP_MIN_SCORE` / `_AMAP_STRONG_SCORE` / `_AMAP_EXACT_SCORE` |
| 候选地理闸门 / 并列裁决 / 候选池一致 | 200km / 分数差 0.05 / ≥3 条落在 0.5km 内 | `coordinates._AMAP_MAX_DRIFT_KM` / `_AMAP_TIE` / `_AMAP_AGREE_MIN` |
| 模糊兜底阈值 / 分数上限 | 0.65 / 0.80（钳在强匹配阈值以下） | `coordinates._AMAP_FUZZY_SCORE` / `_AMAP_FUZZY_CAP` |
| 核验对齐 / 行程包络外扩 | 1.5km / 150km | `planner._VERIFY_KM` / `_VERIFY_DRIFT_KM` |
| 离谱检测触发 / 离谱替换门槛 | 偏离中位数 100km / 差 10km 才替换 | `planner._OUTLIER_KM` / `_OUTLIER_REPLACE_KM` |
| 决策轨迹步数上限 | 60 步 | `chat._TRACE_MAX` |
| 规划页对话留存 | 30 条（按行程指纹隔离） | `settings.savePlanChatHistory` |

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

### 用例 7：长期记忆（M18，需开启记忆库）

1. 首次贴一段成都攻略 → 【A】正常出路线；响应发完后【F】把「地点卡 + 整篇摘要」切分入库（后台任务，用户无感）；
2. 隔天再问「上次那家喝盖碗茶的茶馆在哪个公园？」→ 【A】先检索该档案历史攻略，命中则播报
   `stage: memory`（「参考了 N 条你过往的攻略记忆…」），模型回答**带 [n] 引用**（例：「人民公园的鹤鸣茶社 [1][2]」）；
3. 你在编辑器里把「水巷口辣汤饭」拖到正确位置 → 前端 fire-and-forget 上报
   `POST /api/memory/feedback` → 之后任何攻略再出现该店名，【C】第 0 级直接命中（`source=memory`），不再问 LLM；
4. 设置面板「🧠 旅行记忆」显示条数/城市，可一键 `DELETE /api/memory/all` 清空（只清本机档案）。

### 用例 8：看清 AI 这一轮做了什么（M19 决策轨迹 + 坐标溯源）

1. 首页贴一段成都攻略 → 生成过程中「🧭 决策过程」实时展开，逐条列出：用的模型与来源、记忆命中几条
   （或为什么没注入）、每个地点的坐标来自哪里、哪个点被高德替换/对齐（带偏差距离）、本轮耗时；
2. 生成完成后轨迹自动收起（点标题可再看），**刷新页面后仍在**（随消息持久化）；
3. 进规划页后，时间线与地图气泡上每个点位都有来源徽标：**你确认过 / 高德核验 / AI 推测 / 搜索兜底 / 城市中心**；
4. 觉得某个点位不对 → 点它的 ✎ → 「🔍 按名称重新定位」（高德优先）或「🗺 更改位置」亲手点一下
   → 坐标落库时记为 `source=user`，从此该地点**任何 AI 核验都不会再覆盖**；
5. 规划页左侧抽屉的对话与轨迹刷新后依然保留（`itertrip:planchat`），标题栏显示本轮所用模型与来源，
   `🗑` 可单独清空对话（不影响行程本身）。

---

### 用例 9：整条路线坐标跑偏了 → 一键校准（M20）

1. 进规划页 → 工具条「🔍 校准坐标」→ 后端对每个地点重查高德（用户手改过的点跳过、不会被覆盖）；
2. 结果走**同一条撤销栈**（可 Ctrl+Z 反悔），并提示「已校准/补全 N 处坐标；M 处存疑已标【坐标待确认】」；
3. 典型场景：M20 之前生成的行程（同名异地 POI 把坐标带到了别的省）、导入的旧 JSON、缺坐标的行程；
4. 也可用 `POST /api/route/recheck` 批处理，或用编辑器里的「🔍 按名称重新定位」单点修正。

---

## 9. 限制与约束

**产品边界（DESIGN.md §8，明确不做）**：账号体系/云同步、价格抓取/预订、内置平台凭据、规划质量军备竞赛。

**代理能力约束**：

| 约束 | 细节 |
|------|------|
| 单模型全包 | 不做多模型/多代理编排；视觉能力取决于用户所配模型（推荐 VLM） |
| 截图输入（M15 已接入） | `/api/chat images[]`：≤4 张、单张 ≤4MB data URL，仅提取模式；前端 canvas 压缩（长边 2400px / JPEG 0.82）；原图不进持久化历史与后续轮次上下文；HEIC 等浏览器不可解码格式明确报错 |
| 链接解析不支持 | 平台链接解析是 v1 后 best-effort 扩展，当前需用户粘贴文字/截图 |
| 坐标可靠性 | M19 起：高德 POI 为**一级源**（需 key）+ 对已有坐标**主动核验** + 离谱检测（偏离中位数 >100km / 境内行程落境外）+ 来源徽标 + 置信度标注 + 用户可重新定位或手点覆盖；**M20 追加**：候选地理闸门（省份 / 城市 / 距目的地城市中心 ≤200km，跨省同名 POI 一律拒）+ 核验「精修不搬家」（>1.5km 需精确同名或候选池一致）+ 行程地理包络 + 「🔍 校准坐标」整条重校准；无 key 时回落模型知识（同 v1.1） |
| 同名连锁/分店歧义 | 数据源固有歧义：高德同品牌多分店时按「名称分 + 括号分支名 + 离目的地/现有坐标更近」裁决，不保证选中用户心里那一家；界面给来源徽标与「按名称重新定位」兜底 |
| 坐标来源可信度分级 | `memory`/`user`（用户手点，最高）> `amap`（POI 核验）> `llm`（模型推测、未核验）> `search`/`city`（低置信兜底）；徽标如实展示，**不做「已核验」的过度声明**（弱匹配但接近时不升级来源标注） |
| 决策可见性 | 每条 AI 回复都可展开「🧭 决策过程」（≤60 步）；静默兜底（坐标转换失败、补全失败、解析重试）一律以 warn/fail 步暴露；轨迹不含 prompt/响应原文与任何 key |
| 上下文护栏 | 历史仅 8 轮 + 当前 route 快照；无 route 时历史对提取模式作用有限 |
| 长期记忆（M18，默认关闭） | opt-in：`ITERTRIP_MEMORY_ENABLED=1` + 装 `fastembed`（或 provider=api）才生效；按匿名档案隔离、可一键清空；注入 ≤6 条/≤1200 字；检索/入库异常只记日志不影响主线；不跨档案共享（隐私红线） |
| 坐标真值只由用户写入 | 实体记忆仅接受编辑器手改动点（`user_pin`）；LLM/高德结果不入库，防幻觉坐标被固化成「真值」 |
| 重试预算 | JSON 解析失败仅重试 1 次；第二次失败直接终止并报错 |
| 价格中立 | prices 不由 AI 抓取（schema 主动清洗幻觉报价），搜索源 best-effort 不作保证 |
| 管理后台 | 未配置 `ITERTRIP_ADMIN_TOKEN` 即整体关闭；单 provider 无多 key 轮换 |
| 单进程形态 | 规划/对话长请求阻塞 uvicorn worker 数有限；无队列/限流，多人并发共享同一免费源时可能 429 |

**非功能性约束**：key 经本地进程但不出用户机器；导出 HTML 注入前已转义 `</`；导出文件名按 RFC 5987 双写
（HTTP 头仅 latin-1，中文目的地走 `filename*=UTF-8''` 百分号编码，ASCII 兜底）；admin token 常量时间比较。

---

## 10. 代理增强未来发展路线图

以下按 DESIGN.md §7/§9 整理，均属"已完成/规划中/待反馈"三档：

**已完成（M12–M20）**

- [x] BYOK 设置面板 + 连通/视觉探测（M12，探测代理上线）
- [x] 对话提取模式（M13）、对话改路线 + diff 可视化 + 同栈撤销（M14）
- [x] Agent 式澄清问题（M17，结构化 questions[]）
- [x] 后台管理配置（热更新 + 脱敏 + token 鉴权）
- [x] 截图解析（M15）：VLM 直出 route JSON（一次调用，不做图→文中转）；`vision` 字段驱动
      前端置灰/开启截图入口；原图不进持久化历史与后续上下文（§4.3 护栏①）
- [x] 等待体验与导入导出补全：流式期间计时（⏱ Ns）+ 分时段提示文案 + 思考链流式强制展开；
      HTML 导出失败可见（catch + 后端 detail 透出）+ 导出副本坐标清洗；首页新增导入
      （支持 .json 与导出的自包含 .html，括号状态机提取内嵌 TRIP）
- [x] 上云（M16 事实完成）：自有腾讯云服务器已跑通 C-1 单进程 + 子路径部署
- [x] **旅行记忆库（M18，RAG）**：攻略实体级切分 → 本地 embedding（bge-small-zh ONNX）→
      SQLite 单文件向量检索（城市元数据预过滤）→ 带 [n] 引用注入提取模式；坐标实体记忆作
      geocode 第 0 级（用户手改 = 真值，`source=memory`）；匿名档案隔离 + 设置面板一键清空；
      默认关闭（`ITERTRIP_MEMORY_ENABLED=0`），缺依赖/出错全程静默降级
- [x] **坐标可信度（M19）**：修复「提取路径不转坐标系 + 改路线转换漏 import 被静默吞掉」两个基准 bug
      （实测固有偏移 361m~555m）；高德 POI 升为**一级坐标源**（多候选打分 + 城市校验 + 请求级缓存/熔断），
      并对已有坐标**主动核验**（强匹配直接采用 POI 坐标，实测模型坐标偏 113m~1.2km）；
      `place.source/confidence` 溯源 + 时间线/地图气泡来源徽标 + 编辑器「按名称重新定位」
- [x] **决策可见化（M19）**：`event: trace` 逐步下发 + 终帧 `trace`/`stats`；前端「🧭 决策过程」可折叠块
      （流式展开、终态收起、随消息持久化）；抽屉标题栏显示本轮模型与来源
- [x] **规划页对话留存（M19）**：`itertrip:planchat`（按行程指纹隔离：刷新恢复、可清除、换行程不串味）
- [x] **坐标区域校验与重校准（M20）**：修复「目的地整串被当高德 `city` 参数 → `citylimit` 被静默忽略 →
      同名异地 POI 被当成命中」（实测把一条长沙行程的 7 个地点搬到山西/河北/北京/河南/天津）；
      候选先过地理闸门（省份/城市/≤200km）再打分；核验收紧为「精修不搬家」+ 行程地理包络；
      城市中心表补到 46 城；模糊兜底捞回错别字店名 + 置信度跟随匹配分；
      新增「🔍 校准坐标」与 `POST /api/route/recheck`，让已经坏掉的行程能就地修好

**近期规划**
- [ ] **多 provider 故障转移 + 用量统计**：免费源多人并发实测会 429；等真出现压力再做（避免过度设计）

**v1 后扩展（待用户反馈决定）**

- [ ] **链接解析**：三层降级（匿名 fetch 分享短链 → 提示改用文字/截图 → 可选 resolver 插件）；
      永远 best-effort，不进核心依赖
- [x] **数据契约增强**：`place.confidence` / `place.source` 已于 M19 落地（坐标出处 memory/user/amap/llm/search/city，可选字段向后兼容）

**候选方向（文档未承诺，仅记录讨论空间）**：多 provider 故障转移（当前单 provider 链）、
路线质量评分器、导出 HTML 内嵌轻量对话（分享后接收方可继续编辑式修改）。

---

## 11. Git 管理规范（Agent 自主执行）

> 本节是给 AI 代理的**明确授权与操作手册**：在合适的时机自主提交，不必每次征求用户同意。
> 原则：**小步提交、验证先行、敏感信息零容忍、远端操作必须问**。

### 11.1 何时自主提交（授权范围）

**应当自主提交**（完成即 commit，无需询问）：

- 一个特性/修复**完整落地且验证通过**（后端模块可导入、前端 `npm run build` 通过、关键改动实测跑通）；
- 修复了一个可复现的 bug，验证不复现后；
- 文档与代码事实同步（AGENTS.md / DESIGN.md / .env.example / 注释），可单独 `docs:` 提交；
- 开始高风险操作（大重构、依赖升级、删改多文件）**之前**，先把工作区已有改动落成 checkpoint；
- 一次会话收尾时仍有干净的、已成块的小改动（如临时脚本清理、gitignore 微调）。

**必须先问用户**：

- `git push` 及一切远端操作（见 §11.4）；
- 合并冲突的解决方向、rebase/回滚已提交内容；
- 批量删除文件（>5 个）或删除非本会话产出的代码；
- 用户明确说过"先不要提交"的上下文。

**不要提交**：验证未通过的半成品（宁可留工作区也不污染历史）；与当前任务无关的顺手改动（单独说明或单独提交）。

### 11.2 提交信息规范（对齐仓库现有风格）

中文 Conventional Commits，标题一行讲清"为什么"：

```
feat: 落地 M19/M20 坐标可信度与区域校验功能
fix(llm): BYOK 只填 API Key 时补齐 base_url，避免空 URL 协议错误
feat(m18): 实现旅行记忆库RAG功能，支持坐标记忆与攻略检索
chore: 停止追踪 tsconfig.tsbuildinfo 构建缓存并加入 .gitignore
docs: 更新文档与注释，补充新功能与配置说明
deploy: IterTrip 子路径 /itertrip/ 部署（Vite base+8100+Nginx，反代 8100 避开 8787）
```

- type：`feat` / `fix` / `chore` / `docs` / `refactor` / `test` / `deploy`；scope 可选（模块名或里程碑号，如 `(llm)` `(m18)`）；
- 标题 ≤72 字；大特性可在正文用编号要点列改动清单；
- 一个 commit 只装一件事：特性与其文档同步可同 commit，不相关改动拆开。

### 11.3 提交前检查清单（每次 commit 走一遍）

1. `git status` + `git diff` 通读一遍改动，**点名 `git add <文件>`**，禁止 `git add -A` / `git add .`；
2. **敏感信息红线**（.gitignore 已覆盖，但仍需核对）：`.env`、`admin_config.json`、`memory.sqlite*`、
   `*.key`、`test-artifacts/`、构建产物（dist/、*.tsbuildinfo）绝不入库；
   提交含 key 相关改动前用自检命令确认：
   `git grep -i "mcp_\|bearer\|api_key" -- . ':!*.md'`（对照 diff 确认命中的都是代码引用而非明文）；
3. 验证已跑：后端改动至少过模块导入/冒烟；前端改动过 `npm run build`；
4. 确认没有把 IDE 缓存、临时脚本混入暂存区。

### 11.4 远端与历史

- **默认只 commit 不 push**。push（含首次推送分支）必须用户明确要求；远端为 `github.com/Dragonzhi/itertrip`；
- 禁止：force push、改写已推送历史、`--no-verify` 跳过钩子、非用户要求的 amend；
- 当前为单 `main` 分支直推的个人项目，无 CI/PR；若未来引入分支流或 CI，**先更新本节再遵循**；
- 多设备同步场景：push 前先 `git pull --rebase`（要求工作区干净，正好与本节的 checkpoint 习惯衔接）。

---

*本文档基于代码实测编写（2026-09-14，对应 main 分支；M18 记忆库、M19 坐标核验与决策轨迹、M20 坐标区域校验与「校准坐标」均已实测端到端跑通）。若提示词、参数或协议调整，请同步更新本文件。*
