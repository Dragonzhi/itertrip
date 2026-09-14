# M19 · 坐标可信度 + Agent 决策可见化 + 规划页对话留存

> 状态：**已实施**（2026-09-06）· 对应代码：`backend/engine/{coordinates,planner,geo,schema}.py`、
> `backend/api/chat.py`、`frontend/src/{pages/Plan.tsx, pages/Chat.tsx, components/DecisionTrace.tsx,
> lib/{coordSource,settings}.ts}`、`test-artifacts/{check_geocode,check_trace,probe_trace,smoke_m19}`。
> 本文既是实施计划，也是实施记录（§6 实测、§7 偏差）。

---

## 1. 三条用户反馈 → 实测根因

| # | 反馈 | 实测根因 | 证据 |
|---|------|----------|------|
| R1 | 地点标记不准确 | **改路线坐标转换从未执行**：`chat.py` 调用 `wgs84_to_gcj02(...)` 却从未 import，每次都抛 `NameError` 并被 `except: print("转换失败(忽略)")` 吞掉 | `'wgs84_to_gcj02' in vars(chat)` → `False`；线上表现为改动的点系统性偏移 |
| R2 | 同上 | **提取模式压根不做坐标基准转换**：只有表单规划 `planner.plan()` 有转换循环，`/api/chat` 提取分支直接把模型坐标写进 route | 代码路径对比 |
| R3 | 同上（量化） | WGS64 坐标画在高德瓦片（GCJ-02）上的固有偏移：成都 **361m**、上海 481m、海口 509m、北京 555m | 用项目自带 `geo.wgs84_to_gcj02` + `haversine_km` 实测 |
| R4 | 同上（小店尤其不准） | **高德 POI 实际上从未被使用**：降级链是 记忆 → **LLM** → 高德，而 LLM 只在显式回 `not_found` 时才落空；`_enrich_coordinates` 又只处理「(0,0)」与「偏中位数 >100km」的点 —— 模型随手编一个同城坐标就既不算缺失也不算离谱 | 代码路径 + 真机实测（模型坐标偏真实 POI 113m~1.2km） |
| R5 | 地图页左侧对话刷新即失 | `Plan.tsx` 的 `chatMsgs` 只是 `useState([])`，无 load/save（首页 `Chat.tsx` 早已用 `itertrip:chat` 持久化） | 代码对比 |
| R6 | AI 对话像盲盒 | 前端只有单行 `stageLabel` + 思考链；终帧 `reply` 不带任何决策信息，消息里也留不下「为什么这么改」 | SSE 协议现状 |

**结论**：R1+R2+R3 是全量 ~0.5km 的系统性偏移，R4 是小店/非知名点位的大偏差，两者叠加正是「好多地点标记不准」。

## 2. 目标与验收

| 目标 | 验收方式 | 结果 |
|------|----------|------|
| 坐标基准正确（三条路径统一 GCJ-02，不再有静默失败） | `check_geocode.py` §9 + `check_trace.py` §2/§5（断言 `coord-datum` 失败步不出现） | ✅ |
| 高德成为一级坐标源 + 已有坐标主动核验 | `check_geocode.py` §2~§6；真机 `/api/geocode` 返回 `source=amap` | ✅ |
| 每个地点可追溯（`source`/`confidence` + 界面徽标） | `probe_trace.cjs`（时间线徽标 / 地图气泡） | ✅ |
| 决策轨迹可见、可持久化重放 | `check_trace.py` 8/8；`probe_trace.cjs` 16/16 | ✅ |
| 规划页对话刷新不丢 + 可清除 + 换行程不串 | `probe_trace.cjs`（恢复 / 清除 / 指纹隔离） | ✅ |
| 零回归 | 既有 check/probe/smoke 全绿（见 §6.3） | ✅ |

## 3. 实施内容

### B1 坐标可信度（后端）
- `engine/geo.py`：新增 `in_china(lat,lng,margin)`（境内粗判，供离谱检测复用）。
- `engine/coordinates.py`：
  - 降级链**重排为 记忆 → 高德 → LLM → 搜索 → 城市中心**，返回值统一加 `source`；
  - 名称归一（`_clean_name` 剥括号补充说明）+ 多候选打分（`_name_score`：完全相同 1.0 / 互相包含 0.75~0.95 /
    公共前缀 ≥3 字 0.66~0.80，其余 0）+ 类型校准（有类型提示却匹配到大类不符的 POI 扣 0.15）；
  - 查询策略：带 `citylimit` 一次 → 失败且有城市时去限制重试一次（要求候选城市一致），每点最多 2 次请求；
  - `AmapSession`：请求级缓存去重 + 调用预算（40 次）+ 熔断（key/配额类错误 1 次即停，网络类连续 2 次停），
    超时从 30s 收到 8s；
  - `geocode_by_search` 的 key/地址改走 `env_value`（env > 项目根 `.env`），与其它配置同口径。
- `engine/planner.py`：
  - 抽出 `route_to_gcj02(route, source)` 与 `convert_new_coords(new, old)`（消除重复代码 = 消除 R1/R2 的根）；
  - `llm_config_with_source()` / `describe_provider()`：不改 `_llm_config` 行为，只补「配置来源」标签；
  - `_enrich_coordinates(...)` 三阶段：① 离谱检测（中位数 >100km **+ 境内行程落境外**）→ ② 缺失补全 →
    ③ **主动核验**（只查高德，避免自证）：强匹配直接采用 POI 坐标（>1.5km 记 `replace`、≤1.5km 记 `align`）；
    弱匹配且 >1.5km 保留原值并标注待确认（`conflict`）；弱匹配且很近保留原值且**不升级来源**（`confirm`）；
    用户真值（`source=user` / 实体记忆命中）在①③两处一律跳过。
- `engine/schema.py`：`Place`/`Hotel` 加可选 `source` / `confidence`（DESIGN.md §5 早已预留这两个字段名）。
- `api/chat.py`：提取分支补 `route_to_gcj02`；改路线分支改用 `convert_new_coords`；核验不再只在「有缺失点」时执行。

### B2 决策轨迹（后端）
- SSE 新增 `event: trace`（`{step:{id,kind,status,title,detail,ms,meta}}`，同 id upsert，上限 60 步）；
- 步类型：`provider`（模型 + 来源，**绝不含 key**）/`memory`（命中数或未注入原因）/`llm:<n>`（首字延迟、正文字数、
  失败原因）/`retry`（解析失败原因）/`geo:*`（逐地点来源与动作）/`geo-summary`/`edit`/`coord-fallback`/
  `coord-recheck`/`coord-datum`（坐标基准转换失败，历史静默 bug 从此可见）/`clarify`/`summary`；
- 终帧 `reply` 追加 `trace`（完整轨迹）与 `stats`（elapsed_ms/attempts/places/geocoded/replaced/memory_hits/model/provider）。

### B3 决策轨迹（前端）
- `components/DecisionTrace.tsx`（新）：可折叠「🧭 决策过程」，流式期间强制展开 + 自动滚动，终态收起；
  状态点按 `done/warn/fail/run/skip` 上色，展示耗时；
- `ChatPanel.tsx` / `Chat.tsx` / `Plan.tsx`：流式期间按 id upsert 实时渲染，终帧落到消息上并随历史持久化；
- `Plan.tsx` 抽屉标题栏新增本轮模型/来源徽标（`data-testid="ai-provider"`）；
- `Timeline.tsx` / `MapView.tsx`：坐标来源徽标（你确认过 / 高德核验 / AI 推测 / 城市中心…），受 `showMeta` 控制。

### B4 规划页对话持久化
- `lib/settings.ts`：`itertrip:planchat` = `{fp, msgs}`，`fp = 标题|目的地|天数`；落盘剔除 `route` 快照、保留
  `trace`/`changeSummary`/`questions`/`answered`；指纹不符返回空（换行程自动开新会话）；
- `Plan.tsx`：启动时恢复（有历史则自动展开抽屉）、变更即落盘、标题栏 `🗑 清除记录`；
- 澄清卡一致性：提交/跳过后回写 `answered`，刷新后已答的卡不再复活。

### B5 手动重新定位 + 来源徽标 + 文档
- `/api/geocode` 响应天然带 `source`；`PlaceForm.tsx` 新增「🔍 按名称重新定位」（写进表单草稿，保存才落库）；
- 地图选点/手改一律写 `source=user`、`confidence=high`（M18 真值表来源不变，但让核验能识别并让路）；
- 文档同步：`AGENTS.md` / `DESIGN.md` / `DEPLOY.md` / `README(.en).md`；本文件为里程碑记录。

## 4. 数据契约变更

| 位置 | 变更 | 兼容性 |
|------|------|--------|
| `route.days[].places[]` / `.hotel` | `+source`、`+confidence`（可选，默认 `""`） | 向后兼容；老路线无字段按「未标注」处理 |
| `POST /api/geocode` | 响应增加 `source` | 只加字段 |
| `POST /api/chat` SSE | 新增 `event: trace`；`reply` 增加 `trace`/`stats` | 纯新增，老前端忽略未知事件 |
| SSE `stage` | 取值集合不变（新增 `memory` 早已存在） | 兼容 |
| localStorage | 新增 `itertrip:planchat` | 新增键，不动既有键 |
| 环境变量 | **不新增**（核验由「是否配高德 key」单一开关决定） | — |

## 5. 关键阈值与取舍

| 参数 | 值 | 理由 |
|------|-----|------|
| 高德名称接受阈值 | **0.72** | 实测：0.6 会放过「不存在的店名xyzabc → 不存在茶铺(0.66)」与「水巷口辣汤饭 → 水巷口**道路**(0.85-0.15=0.70)」这类弱匹配 |
| 强匹配阈值 | 0.85 | 允许覆盖模型坐标的门槛：宁可不改也不改错（同名连锁店是主要误伤源） |
| 类型不符惩罚 | -0.15 | 「问餐馆返回道路」是实打实的反证 |
| 核验对齐阈值 | 1.5km | 实测模型坐标虽同城但偏 113m~1.2km：≤1.5km 直接对齐到 POI（`align`），>1.5km 视为修正（`replace`） |
| 高德超时 / 预算 / 熔断 | 8s / 40 次 / 致命 1 次·网络 2 次 | 坏 key 或断网时最多多花 ~16s，不会让一次规划卡死几分钟 |
| 轨迹步数上限 | 60 | 轨迹随消息进 localStorage，必须防膨胀（超出只计数并在汇总里提示） |

## 6. 实测记录

### 6.1 自检（零网络 / 零真实 LLM）
- `test-artifacts/check_geocode.py`：**10/10**（打分分层、高德优先零 LLM 调用、去 citylimit 重试、跨城拒绝、
  熔断、缓存去重、核验四态 replace/align/conflict/confirm、用户真值不可侵犯、境外离谱点重定位、
  基准转换 361m 量化、`.env` 口径）。
- `test-artifacts/check_trace.py`：**8/8**（轨迹齐全且先于 reply、终帧 trace/stats 一致、不泄露 key、
  基准转换在改路线分支生效、retry、clarify、坐标兜底、闲聊 skip、无档案头降级）。
- `test-artifacts/probe_trace.cjs`：**16/16**（刷新恢复对话、自动展开、轨迹渲染 5 步、标题栏模型徽标、
  时间线/气泡来源徽标、重新定位入口、清除记录、指纹隔离、零页面错误）。

### 6.2 真机端到端（`smoke_m19.py`：真实免费源 + 真实高德 key）
```
· 模型 sensenova/deepseek-v4-flash：来源：服务器免费源(.env)
· 📍 人民公园（鹤鸣茶社）：高德 POI · 核验并对齐 POI 坐标 · 偏离 113m · 名称匹配 1.00
· 📍 宽窄巷子：高德 POI · 核验并对齐 POI 坐标 · 偏离 608m · 名称匹配 0.93
· 📍 大熊猫繁育研究基地：高德 POI · 核验并对齐 POI 坐标 · 偏离 1.2km · 名称匹配 0.96
· 📍 文殊院：高德 POI · 核验并对齐 POI 坐标 · 偏离 523m · 名称匹配 1.00
· 📍 春熙路：高德 POI · 核验并对齐 POI 坐标 · 偏离 547m · 名称匹配 0.85
· 📍 太古里：高德 POI · 核验一致（未调整） · 偏离 235m · 名称匹配 0.72   ← 弱匹配，保留模型坐标并保持「AI 推测」徽标
· 📍 九眼桥：高德 POI · 核验并对齐 POI 坐标 · 偏离 659m · 名称匹配 0.85
· 坐标处理完成（写入 6 处）：高德 POI 7 · 对齐 6 处
```
**这是本轮最有价值的一组数字**：模型给的坐标虽然都在正确城市，但**普遍偏离真实 POI 113m~1.2km**；
本轮把它们全部对齐到高德 POI 精确坐标（1 处弱匹配诚实保留并标注）。改路线轮只重新核验了那 1 个弱匹配点
（其余已是 `amap/high`，跳过 → 不浪费配额），且 `coord-datum` 失败步不再出现（R1/R2 已修）。

另：`/api/geocode` 真机抽样 —— `鹤鸣茶社 → amap(30.656882,104.058603)`、
`宽窄巷子 → amap(30.662725,104.05503)`、`不存在的店名xyzabc → city（诚实兜底，不再假称高德核验）`。

### 6.3 回归
全部通过：`check_schema`、`check_schema_e2e`、`check_m15`、`check_export_filename`、`check_memory`（真实 fastembed 模型）、
`check_memory_api`、`check_geocode`(10/10)、`check_trace`(8/8)、`api_smoke`(22/22)、`smoke_m18`（记忆入库 → 二次对话注入）、
`smoke_m19`（真机）、`routeImport.test.cjs`、`check_import.test.js`(10/10)、`probe_mapsettings.cjs`(10/10)、
`probe_phase3_dnd.cjs`(4/4)、`probe_trace.cjs`(16/16)；`tsc -b && vite build` 通过（392.8 kB / gzip 123.1 kB）。
运行日志：`test-artifacts/m19_regression.log` / `m19_regression2.log`；探针需 `NODE_PATH="<npm 全局>/puppeteer/node_modules"`。

顺手修了两处**测试基建腐化**（都不是 M19 引入的，但会让回归假红）：

1. `api_smoke.py` 仍断言「导出缺坐标 → 422」，而 v1.1 起导出是**清洗并保证成功**（`builder._sanitize` 剔除无效坐标地点
   并在 summary 点名）→ 改为断言 200 + 导出副本点名剔除，并给 `geocode` 补上「必须带 source 且取值合法」；
2. `probe_phase3_dnd.cjs` 默认打 `localhost:5173`（Vite dev，C-1 单进程形态下早就不存在）且驱动的是已被改版的首页
   `<details>` 折叠表单 → 改为直接 seed `itertrip:route` 后刷新进规划页（零 LLM 依赖、确定性）；
   同时给时间线地点名加 `data-testid="place-name"`，让探针只读名字，不把新加的坐标来源徽标并进名字
   （这条也让「拖拽 DnD 未被新徽标破坏」成为可回归的断言）。

## 7. 偏差与未做

1. **`align` 动作是实机逼出来的**：最初设计里「强匹配 + 偏差 ≤1.5km」只把来源升级为 `amap` 却不采用 POI 坐标，
   真机一跑就露馅 —— 6 个点都偏 100m~1.2km 却顶着「高德核验」徽标（名不副实）。改为**强匹配一律采用 POI 坐标**，
   并区分 `replace`(>1.5km) / `align`(≤1.5km)；弱匹配且很近时**不升级来源**，保持诚实。
2. 高德阈值从 0.6 提到 0.72、并加入类型惩罚：0.6 会放过「不存在的店名 → 不存在茶铺」「辣汤饭 → 同名道路」。
3. 「重新定位」拿到的高德坐标**不写入 M18 真值表**（真值仍只由用户手写；避免把第三方数据固化成「用户确认」）。
4. 同名连锁/分店取舍仍可能选到非用户心中的那家（实测「水巷口辣汤饭」命中「鱼煲王(农垦店)」）——
   属数据源固有歧义：界面给了来源徽标与「重新定位」，用户手点一次即永久优先。
5. 「按名称重新定位」若高德没命中、由模型兜底，来源徽标仍如实显示 **AI 推测** —— 不因为「用户主动点了按钮」
   就把它升级成「高德核验」（可信度分级不因操作入口而变）。
6. 仓库里 `M18_MEMORY_PLAN.md` **并不存在**（AGENTS.md / README / 三个 `memory_*.py` 的 docstring 都引用了它）：
   属上一轮的记录缺失。本次把 AGENTS.md 与 README 里指向它的引用改为现有文档（AGENTS §4.F / DESIGN §4.4），
   README 目录树改列本次真实存在的 `M19_TRUST_PLAN.md`；代码 docstring 中的引用未动（不扩大改动面）。
7. 未做：多地理编码源交叉投票、轨迹导出/分享、服务端对话存储（仍是本机 localStorage）、路线质量评分器。

## 8. 运维注意

- **无新增环境变量**。核验与高德一级坐标源只在配了 `ITERTRIP_AMAP_KEY`（env 或后台配置）时生效；
  未配 key 的部署保持旧行为（LLM 兜底），只是不再有坐标基准 bug。
- 高德个人开发者配额（place/text 每日数千次）足够：一条 15 点的路线最多 ~30 次请求（含去限制重试），
  且同一路线内同名同城走缓存；坏 key/超额会自动熔断并降级，不影响出路线。
- 前端改动需 `npm run build`（C-1 由后端托管 `dist`）；后端改动需重启进程（无 `--reload`）。
- 老路线（无 `source` 字段）在下一次 AI 改动时会被核验一遍，坐标可能被对齐到 POI —— 这是修 bug 的预期效果。
