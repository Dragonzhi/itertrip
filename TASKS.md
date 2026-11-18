# itertrip

status: 进行中
next: M39 已落地（AI 预排时间 + Agent 日程预览 + 坐标核验逐点流式 + 坐标链修正 + AGENTS 同步清单）；等用户真实使用一轮反馈；M36 legacy 收敛 / M37 LLM-as-judge / MCP / CI 继续挂起；真机回归与盲审 4 条继续挂起
updated: 2026-11-17

## 待办

- [ ] 桌面三栏改版（行程｜地图｜工作面板，用户指认布局别扭）：方向稿已出且用户初评「确实更好」；「大脑门」纠正已定（顶栏一行化，DESIGN.md §9 已写入）；余 4 条评估问题见方向稿 §4，确认后与顶栏收敛一起实施
- [ ] M36：legacy 改路线收敛到 propose_edits（+4 op：set_price/set_hotel/update_note/fix_coord，下线 M22 兜底 ~200 行，方案见 docs/AGENT_CODEX_CLAUDE_PROPOSAL.md ①）
- [ ] M37 候选（等用户挑）：LLM-as-judge 提取质量评估（golden 集 + rubric，opt-in 用真 key）／MCP 工具暴露（手写最小 stdio 子集，零新依赖）／GitHub Actions CI（确定性检查 + tsc/build）
- [ ] M32/M33 真机人工回归（iOS Safari / 实体 iPad），补记到 docs/M32_PLAN_COMPACT.md §5 与 docs/M33_UI_DECLUTTER.md §5
- [ ] docs/TODO.md 两条等反馈项：tid 可携带性、PING_ABORT_MS 自动中断策略
- [ ] M38 前端好用度冲刺·后续批次：用户真实使用一轮（配模型 → 贴攻略 → 改行程 → PWA → 导出），问题驱动修复；盲审 4 条已清（见已完成）

## 进行中

（无）

## 已完成

- [x] M39 AI 预排时间 + Agent 日程 + 核验流式 + 坐标链审查：首次生成由 `engine/schedule_defaults.py` 补默认起止/停留（全标 `estimate`，`shared/schedule.js` 用 `caveats` 软提示，不再算「信息不全」），行程页提示「AI 预排，可调整」；Agent 新增 `set_day_schedule(day,start,end,durations,source)`，用户只说「规划第二天时间」可提议但必须预览，固定/预约/已完成点不覆盖；编辑模式坐标核验改为逐点 trace 实时下发（`_enrich_coordinates(on_record=…)` + 双通道队列），`stage:done` 移到坐标/facts/二次校验之后，facts/verify/changed=false 兜底都有进度；坐标链修回显降级（id 优先 + ~11m 容差）、自然景区类型误判、弱匹配「核验一致」文案、预算/缓存顺序、占位酒店与同名酒店去重、复合目的地解析；`AGENTS.md §10.1` 新增强制同步清单。验证：`_check_coords` 26 项、`_check_m27`、`_check_m30`（11 场景）、`_probe_stream` 27/27、`_check_injection`、tsc/build、m30-core/m30-dom/m31-dom、desktop-a/mobile-shot、真实浏览器 CDP（预排提示、Agent 预览应用、逐点 trace 先于 reply）（2026-11-17）
- [x] M39 后续（重庆实测反馈）：编辑模式不再显示「长期记忆未注入」空步；冲突日状态条/当天面板新增「让 AI 修复」，把确定性冲突原文反馈给 Agent 再跑一轮；Agent user payload 直接带每天 `schedule` 的 issues/unknown，`handles()` 识别「补充/补全/完善/修复某天时间」与「时间冲突」，`SYSTEM` 要求补充/修复时先看日程摘要、交通未知先 `query_transport` 再 `set_day_schedule`；流式状态显示「正文 N 字 · 思考 N 字」，长思考期间也有持续反馈。验证：`_check_m30` 12 场景、`_probe_stream` 28/28、chat-stream 26/26、m31-dom 冲突修复入口断言、真实浏览器 CDP 校验修复按钮请求含冲突原文与 agent_schedule（2026-11-17）
- [x] M38 前端好用度冲刺·第三批 = 桌面工作台重构实装（方向稿四轮迭代定稿后一次落地）：①地图升全幅底图（`isolation:isolate` 防瓦片越层），调整/收起侧栏不再 resize 地图；②日期带改左竖列 76↔36 角标（`itertrip:desktop-view` 持久化）；③行程列可拖 28–58%、收起只留贴边中段半圆；④顶栏一行化（行程名/日期芯片/天数并入，删 104px 大脑门与面包屑）；⑤AI 面板右缘锚定固定 380/340、无宽度拖拽（用户指认游离拖拽条后按删除测试移除）、顶栏按钮完整开关、**默认停在 AI**（Q2）；⑥「关闭辅助区」→「收起面板」；⑦行程文档标题与日期列去重；图例/标题 chip 跟随可见区（`--dw-left-w`）。验证：tsc/build、m25–m31 DOM（「AI 盖地图」断言翻转）、desktop-a 四尺寸（几何断言改底图架构）、mobile-shot 5 尺寸、CDP 四状态目检；紧凑态 <1024 未动。AGENTS v1.16（§6.3 desktop-view + §10 条目）、DESIGN.md §4/§5 同步（2026-11-15）
- [x] M38 前端好用度冲刺·第二批（用户指认）：未安排的日程默认安静 —— 当天没有任何安排输入（时刻／已查交通／停留时长全空）时不渲染 dw-statusline 待评估状态板，只留标题行一个安静文字入口「安排与交通」；时间列「未知／未知 离开」「停留时间未知」「耗时未知」占位全部改为留白/只留入口（时间只渲染推算出的真实值）；开始安排后状态板才出现（缺口仍如实报告），入口收敛为状态板一处，data-testid=day-settings 两态都在。起因：用户问「为什么这么多地方都是未知」——新提取行程四类排程依据全空，满屏警示板像坏了；用户方向：「未安排不是错误，暂不完善的效果先不拿出来」。DESIGN.md §9 已写入该规则。tsc/build/m25–m31 DOM/desktop-a/mobile-shot 5 尺寸全绿 + CDP 探针前后对比截图（未安排 0 处「未知」→ 设 19:30 后状态板出现）（2026-11-15）
- [x] M38 前端好用度冲刺·第一批 = 盲审 4 条收尾债全清：①🤖/🗺 aria-label/expanded + 展开态反色 + 一次性提示条（itertrip:plan-hint）；②⚙ 紧凑态归排右下角 + 抽屉打开时隐藏；③地图 D1–D6 循环配色 + 金色酒店左下角图例（顺带修 >6 天 pin 无色小洞）；④桌面状态条措辞人话化（未定/待查/待评估 + 怎么补，诚实口径不变）；附带 Chat 输入带改浮起圆角输入卡（接缝观感）。bee297b + f987a62；tsc/build/mobile-shot 5 尺寸/m25–m31 DOM/desktop-a/chat-stream 24/24 全绿，逐截图目检（2026-11-15）
- [x] M35 Agent 强化第一轮：两份代码审计（M30 工具循环 + 全仓 Agent 体系）→ 小白讲解页 agent-guide.html（10 成员 + 3 故事线 + 词典 13 条 + 体检表，随构建发布）；docs/AGENT_KNOWLEDGE_MAP.md 13 知识点映射（讲法/追问预案/诚实边界/刻意不做）；提示注入层次防御统一 —— agent_turn.DATA_NOT_INSTRUCTION 三处 SYSTEM 共用、chat.build_payload 统一组装 payload（攻略原文包裹/current_route 标注）、记忆参考头补声明、新增 backend/_check_injection.py（结构性防御，真模型鲁棒性留 M37）；顺带修首页对话当前消息重复进历史（2713675）与 AGENTS「8 轮→8 条」勘误；含走读问答沉淀（RAG/上下文管理/高德数据源）（49a97c3 + 141ef36，2026-11-15）
- [x] M34 天气系统整体退役：后端 /api/route/weather + engine/weather + schema 四模型三字段 + agent query_weather 工具/路由词 + 导出渲染、shared/weather.js + agent 校验块 + protect 回拷、前端 WeatherPanel/lib.weather/☂入口/桌面天气行/安排编辑器室内外属性 + 类型字段、m29 两脚本退役（m30/m31/desktop-a/fixture-time 收缩）；strip_generated（agent_receipts 护栏）迁 agent_tools 保留；旧数据残留键由 pydantic extra=ignore 静默脱落（2026-11-08）
- [x] M33 后续第三笔（用户指认）：空态删「📋 粘贴攻略」入口 —— 它就是 onChat() 开对话，与「开始对话」完全重复；两条提示文案收敛为一条（原「在下方粘贴」的下方是按钮行，悬空；「支持粘贴文字或上传攻略截图」与 ChatPanel 占位语重复）。a804e94；tsc/build/mobile-shot 5 尺寸/m28-dom 全绿（2026-11-14）
- [x] M33 后续（用户两轮指认）：续改态删 hero 解释段与错标 AI 按钮（原按钮 = onChat() 开新对话，与「新建行程」同路径还顶着错标签）；「新建行程」逻辑搞对 —— App.startNewTrip 先清 itertrip:chat 再进对话页（真新会话），不再顶着旧对话继续聊；chat-stream [5] 改写为新契约，24/24 全绿；行为代价（首页不再有回看旧对话入口）已记录 docs/M33_UI_DECLUTTER.md §7（2026-11-07）
- [x] M33 全站减设计：删三步卡/重复隐私句/✨发光条/抽屉品牌行/页脚标语；离线状态 quiet 一行化、抽屉天气默认收起、桌面状态阵合一（day-settings testid）、「继续出行」CTA 归位出行视图；日期芯片自适应、预算 ¥、触屏键盘提示收敛、ScheduleView 文案用户化；m29/m30 改 testid（2026-11-07）
- [x] 界面大改第二批（宁少勿滥）：Index / SettingsPanel / PlaceForm / HotelForm / Admin / NavigationDialog 控件 token 与弹窗半径对齐工作台；Index 导入失败改内联错误行（ui-fix-plan 欠账闭合）、删两处装饰 eyebrow；mobile-shot 新增 SKIP_FIXTURE 纯量页模式（2026-11-07）
- [x] M32 规划页全尺寸打通：<1024 统一底部抽屉与互斥（平板带不再双栏互叠）、窄屏观感与对话面板对齐工作台设计语言、mobile-shot 覆盖 5 尺寸（2026-11-07）

## 交接摘要

### 2026-11-18 · M39 后续（重庆第三天实测）

**现象**：第二天修复通过；第三天「帮我补充一下第三天的时间安排」返回「行程未修改：操作没有实际变化」，界面仍「待评估」。

**根因**：第三天已由 M39 预排 09:30–16:00 + 90/90/60 分钟，模型原样重复提交同一组 `set_day_schedule`，`validate` 判定 `candidate == route`。真正未评估的原因是「山城第三步道」`confidence=low`（坐标待确认），该点参与的两段交通被 `transport.queryable` 拒绝；`query_transport` 又只回通用「数据未配置、未命中或仍需确认」，模型无法把原因告诉用户。

**变更**：

- `agent_turn.no_op_result`：日程候选与当前一致时，回复当前起止与停留、`schedule.unknown` 原文，并点名 `confidence=low`／【坐标待确认】的地点，给出「按名称重新定位 / 更改位置 → 查询当天交通」的操作路径；trace 改为「候选与当前日程一致」。
- `agent_turn` 的 `schedule` 摘要新增每天 `start/end/durations`；`SYSTEM` 明确「候选与现有起止/停留相同就不要重复提交，失败一次不要重复 query_transport」。
- `agent_tools` 透出 `query_transport` 的真实 unknown 原因；`transport.option` 改为点名被拦住的低置信地点。
- 文本-only 成功声明的兜底正则收窄，`无法成功` 这类说明不再被误判成「假成功」。
- 决策轨迹的 `tool`／`llm` 步骤改为同 id 闭合（工具结果覆盖「查询中」、模型失败覆盖「分析中」），终帧不再残留 `run`；`DecisionTrace` 只在 `live` 时显示「进行中」，已落库或中断的轨迹不再一直转圈。
- `DayItinerary` 在交通/停留导致算不出结束时刻时，状态条仍显示已配置的 `start–end` 并标「计划」，不再只写「09:30 起」。

**验证**：`_check_m30` 13 场景（新增工具原因透出、「补充日程但候选一致」与终帧无 `run` 步骤）；`_check_m26`、`_check_m27`；真实 `/api/chat`（重庆路线、第三天）返回点名「山城第三步道」的解释，终帧 `open run steps: []`；tsc/build；m30-dom、m31-dom（新增「10:00–18:00 · 计划」断言）；`chat-stream` 27/27（中断后不再显示「进行中」）。

**未完成/阻塞**：低置信坐标仍按 M26 边界拒绝交通估算；要得到第三天实际到达时刻，仍需用户确认「山城第三步道」坐标后刷新交通。

### 2026-11-17 · M39 后续（重庆实测反馈）

**变更**：

- 记忆未命中/编辑模式本来不注入时，不再输出「长期记忆未注入」空步（用户指认多此一举）。
- 冲突日状态条与当天安排面板新增「让 AI 修复」：把 `shared/schedule.js` 算出的冲突原文作为 prompt，连同 `agent_schedule` 一起发给 Agent；Agent 可先 `query_transport` 补齐未知交通，再 `set_day_schedule` 出候选。
- Agent user payload 新增每天 `schedule` 摘要（status/issues/unknown），模型不必为看冲突多花一轮 `check_schedule`。
- `handles()` 识别「补充/补全/完善/修复某天时间」与「时间冲突」；`SYSTEM` 要求补充/修复时不要反问具体时刻，直接给可执行候选。
- 流式状态新增「正文 N 字 · 思考 N 字」，长思考/长输出期间持续可见；「模型排队中」提示只在既无正文也无思考时显示。

**验证**：`_check_m30` 12 场景（含 Agent 看到 schedule issues 与 preflight 超时/压缩量）；`_probe_stream` 28/28（编辑模式无 memory 空步）；`chat-stream` 26/26（正文/思考字数与 trace 实时出现）；`m31-dom` 冲突修复入口；真实浏览器 CDP 确认修复按钮请求含冲突原文与 `agent_schedule`。

**推理型模型发现**：`glm-5.3-flash` 默认会把 1800／4096／8192 token 全花在 reasoning 上，`content` 为空、`finish_reason=length`，Agent 只能回「请补充具体修改要求」。已改为 `max_tokens=16384` + `reasoning_effort=low`（供应商不支持时自动去掉并标记用量不完整）+ 焦点日上下文 + `schedule_preflight` 冲突反馈。同一重庆第 2 天冲突实测：2 轮、34 秒、7 个停留压到 300 分钟、20:55 结束的无冲突候选。

### 2026-11-17 · M39 AI 预排时间、核验流式化与坐标链审查

**变更**（backend + shared + frontend）：

- 默认时间：`engine/schedule_defaults.py` 在 `/api/plan`、`/api/chat` 提取、mock 出口补 `schedule`（09:00–18:00）与 `visit.duration_min`（景点 90／餐饮 60／交通 30／其他 60），全标 `estimate`；模型自称 `user` 强制降为 `estimate`。
- 日程语义：`shared/schedule.js` 新增 `caveats`；AI 估计不再进 `unknown`，状态条显示「预计可行 · 含 AI 预排」，行程页提示「时间为 AI 预排，点安排与交通可调整」；导出同步。
- Agent：`set_day_schedule` 领域 op（后端 Pydantic + `shared/agent.js` 同构 + 前端类型）；`handles()` 识别「第 N 天时间安排/规划」；用户明确给起止时可直接应用（source=user），只说「规划一下」必须 `AgentPreview`（source=estimate）；固定/预约/已完成点不可改。
- 流式：`_enrich_coordinates(on_record=…)` 每点完成即回调；`_enrich_progress` 双通道队列即时发 trace；编辑模式 `stage:done` 移到坐标/facts/二次校验之后；补 facts/verify/坐标兜底进度；Agent 路径补 stage 事件。
- 坐标链：`convert_new_coords` 改 id 优先 + ~11m 回显容差；自然景区类型提示；`confirm` 改「高德弱匹配参考（未采用）」并单列统计；`budget` 动作；缓存先于预算；`AmapSession(max_calls=…)`，recheck 80；占位酒店不入高德；`coordDigest` 同名去重分组；复合目的地保守拆分 + `geo-region` warn。
- 文档：`AGENTS.md §10.1` 新增「新增可编辑字段必须同步 Agent」强制清单；M27/M30 记录与版本号同步。

**验证**：`_check_coords` 26 项；`_check_m27`（含 `/api/plan` 与 `/api/chat` 提取默认时间）；`_check_m30` 11 场景；`_probe_stream` 27/27（含编辑模式逐点 trace 早于 reply、done 最后）；`_check_injection`；`npx tsc --noEmit`；`npm run build`；`schedule.check` 56 项；`coordDigest.check` 21 项；m30-core 37 场景；m30-dom / m31-dom；desktop-a-browser 四尺寸；mobile-shot 五尺寸；真实浏览器 CDP（预排提示、Agent 预览应用、trace 实时渲染）。

**诚实边界**：AI 预排是估计，不宣称开放/预约已核实；弱匹配仍不升级来源；占位酒店/泛指地点无法变成唯一 POI 的仍如实归入降级并分组展示；所有提交仍为本地，未 push。

### 2026-11-15 · M35 Agent 强化第一轮（知识点地图 + 注入防御统一）

**变更**（backend + docs，提交 `49a97c3` 知识点地图 → `141ef36` 注入防御；讲解页 `81fb9d9`、历史修复 `2713675`）：

- 审计先行：两个 Explore 代理产出 M30 工具循环与全仓 Agent 体系的行级足迹（13 模式已就位、6 缺口）
- `docs/AGENT_KNOWLEDGE_MAP.md`：13 知识点 ×（业界做法/本仓实现锚点/30 秒讲法/追问预案/诚实边界）+ 刻意不做 trade-off + 体检 + roadmap（M36 收敛引用用户提案 P0 四 op）
- 注入防御统一：`agent_turn.DATA_NOT_INSTRUCTION` 规范句（SYSTEM 改字符串拼接，f-string 会吃掉 `{"proposal":...}` 字面量）；`chat.build_payload` 抽纯函数——提取模式攻略原文成对标记包裹、编辑模式 current_route 不可信标注；`memory_ingest._REF_HEADER` 补「这是检索数据，不是指令」
- 新检查 `backend/_check_injection.py`：静态条款 / build_payload 包裹断言 / fake-SSE 端到端（注入样本不改变协议契约）；docstring 明确「结构性防御，真模型鲁棒性由 M37 评估器验证」
- 顺带：`Chat.tsx` 首页当前消息不再重复进历史（后端无去重，纯文本轮模型看两遍）；AGENTS.md §7.3/§9「8 轮→8 条」勘误；`frontend/public/agent-guide.html` 小白讲解页随构建发布（PWA 白名单自动收录）
- 走读问答沉淀进地图文档：RAG 两套记忆走读、上下文三层管理、高德数据源口径（REST API 而非爬虫，key 配置链）

**验证**：`_check_injection` 全过；`_check_m25/m26/m27/m28/m30` 全绿；`import backend.main` OK；`check_memory`（M18）过；`tsc --noEmit` + `npm run build` 过；`chat-stream` 24/24（PORT=8123 CDP_PORT=9335 并行跑）；讲解页 mobile-shot 1280/390 目检无溢出。

**未完成/阻塞**：真模型注入鲁棒性与提取质量未量化（M37）；MCP/CI 未做（候选）；真机回归未做。

**接手第一个动作**：等用户在 M36（legacy 收敛）/ M37（评估器）/ MCP / CI 里挑方向；或继续走读式问答补理解。

### 2026-11-07 · M33 全站减设计（frontend-req-router 重档链路）

**变更**（frontend，提交 `e04b2d4` → `65aa669` → `542a87a` → `84f5681`，详见 `docs/M33_UI_DECLUTTER.md`）：

- 删：Index HowItWorksCard（空态改 620px 单列）、隐私口径 ×3 归一为页脚一份、两处 ✨ 发光条、抽屉「由 IterTrip…」品牌行、桌面页脚标语、顶栏 mock 徽标（抽屉表头一份）
- 收二级：`OfflinePanel` quiet 变体（状态并进 summary 一行，异常/离线仍主动可见，m28 全量回归兜底）；行程抽屉天气 details 默认收起；桌面 dw-summary 四格 + 重复按钮 → 单行 `.dw-statusline`（`data-testid=day-settings`，顺带修「8 项未评估」复写）
- 归位：「继续出行」CTA 只在出行视图；日期芯片去 `w-[188px]` 固定宽（截断根因）；预算「¥3000」；触屏隐藏键盘提示；ScheduleView 工程腔注释用户化；ChatPanel 12px 下限
- 脚本：m29/m30 `byText('当天时间与交通设置')` → `[data-testid=day-settings]`；其余 testid 未动

**验证**：`npm run build` ✓；`tsc --noEmit` ✓；mobile-shot 5 尺寸全绿；m25–m31 七个 DOM 检查 ✓；desktop-a-browser ✓；**独立设计主管盲审 8.9/10 通过**（9 张真机截图、反塑料套路满分；9 条非阻塞建议清 5 留 4）。

**未完成/阻塞**：真机人工回归未做；盲审留档 4 条等用户反馈。

**接手第一个动作**：等用户真机反馈；若继续，候选见「待办」第 3 条与 docs/M33_UI_DECLUTTER.md §6。

### 2026-11-07 · 界面大改第二批（宁少勿滥）

**变更**（frontend，提交 `5e046c4` + `3da94d8`）：

- `Index.tsx`：导入失败 `window.alert` → home-grid 下方 `role=alert` 内联错误行（`data-testid=import-error`）；删除 `LATIN · ITER · ROAD` 装饰 eyebrow（`text-[10px]` 回潮点）；`text-[11px]`→12px
- `SettingsPanel / PlaceForm / HotelForm / Admin`：控件对齐工作台 token —— 6px 圆角、`min-h-[36px]`、13px、11px→12px；HotelForm 紧凑报价行内部小号体系保留；Admin 只做 token 级轻修 + 删 ADMIN eyebrow（不动布局）
- 弹窗壳半径统一 14px：SettingsPanel 18 / NavigationDialog 22 / schedule-editor 18 一律收拢
- `mobile-shot.mjs`：`SKIP_FIXTURE=1` 纯量页模式（不注入 fixture、只截图+溢出探针、跳过规划页专属断言）
- `docs/itertrip-ui-fix-plan.md` §7：alert 欠账标注闭合

**验证**：`npm run build` ✓；`tsc --noEmit` ✓；`mobile-shot.mjs` 全尺寸 ✓；m25–m31 七个 DOM 检查 ✓；Index 1280/390 与设置弹窗截图目检通过。

**未完成/阻塞**：PlaceForm/HotelForm 弹窗未单独截图目检（token 级改动，靠 build+DOM 检查兜底）；真机人工回归未做。

### 2026-11-07 · M32 规划页全尺寸打通

**变更**（frontend，5 个提交 `c6b2fbf` → `8f0f384`，详见 `docs/M32_PLAN_COMPACT.md`）：

- `Plan.tsx`：`!desktop` 分支（<1024）统一底部 sheet —— `isMobile()` 全部翻转为 `!desktop` 语义、`max-md:`/`md:` 类对翻转或删除、AI 左缘手柄与「☰ 行程」文字钮退役、顶栏收敛单行（🧭+标题+🤖/🗺）、metas/日期卡/mock 徽标不再双渲染、`panel-top-gap` 让位带删除
- `lib/viewport.ts` 新增 `isCompact()`（max-width:1023px）；`MapSettings.tsx` 浮窗定位改 `max-lg:`、right <1024 恒 12
- 观感：抽屉白表头/白工具条 + 米纸内容区；工具条按钮对齐 dw-toolbar token（1px line/6px 圆角/36px/13px + `.focus-ring`）；Timeline 来源徽标与 HotelCard 小字 11→12px；sheet 手柄加大加色
- `Chat.tsx` header 对齐 dw-toolbar；`ChatPanel.tsx` 空态/澄清卡/多选按钮统一（ClarifyCard 逻辑与 testid 未动）
- `mobile-shot.mjs`：768×1024 平板腿、布局分支断言、互斥真断言、桌面价格断言修复（先点 `button.dw-hotel`）+ fixture 补齐 M27 可比报价字段并加第二条报价（金环动效自此才可测）；导出 HTML 探针仅 `SHOT_URL` 时启用

**验证**：`npm run build` ✓；`tsc --noEmit` ✓；`mobile-shot.mjs` 5 尺寸全绿（320/375/390/768×1024/1280×800，含拖拽关闭/表头可达/跨天排序/互斥/价格金环）；`desktop-a-browser.mjs` exit 0；m25–m31 七个 DOM 集成检查 exit 0；768/390 截图目检通过。

**未完成/阻塞**：真机人工回归未做（验证基于 CDP 模拟 + 截图目检）。

## 工作留痕
- 2026-11-18 · ZCode：决策过程终帧仍显示「进行中」（用户实测）——根因是 `tool`/`llm` 的 run 步骤用新 id 输出结果、旧 run 永不闭合；改为同 id upsert，`DecisionTrace` 仅在 `live` 时显示「进行中」；`_check_m30` 断言终帧无 `run`，chat-stream 27/27。
- 2026-11-18 · ZCode：第三天「补充时间」返回没有实际变化（用户实测）——根因是模型重复提交现有 09:30–16:00 + 90/90/60，真正的阻塞是「山城第三步道」低置信坐标让两段交通无法查询；Agent 现在会说明已有安排并点名待确认地点，交通工具透出真实原因，状态条在算不出结束时刻时仍显示配置的 09:30–16:00（标「计划」）。验证 _check_m30 13 场景 / _check_m26 / _check_m27 / tsc+build / m30-dom / m31-dom。
- 2026-11-16 · ZCode：状态条信息不全可查看明细 + 开放资料明确为选填（用户指认「只写 1 项信息不全却不知道缺什么」「填完后仍提示开放资料没填，但不知道开放资料干什么」）——桌面状态条「N 项信息不全」旁新增 ❕，悬浮标题逐条列出具体缺项（如「春熙路跨年倒计时：停留时长未设置」）；开放资料从状态条与日程标签中移除，按到达时刻与停留推算不再被当作待办；只有已录入但缺来源／未确认／不完整／地点名称变化时，才在当天安排里列出「开放资料待完善」，编辑器字段组改标「开放资料（选填）」并说明用途；导出口径同步。
- 2026-11-16 · ZCode：当天交通补主动查询 + 详情页去掉原攻略时间（用户指认「安排与交通只有比较按钮」「原攻略时间没有作用」）——`TransportDay` 新增「查询／刷新当天交通」（只查当天默认方式，保留其他方式快照），与「比较当天交通」并列；地点详情移除 `原攻略时间` 字段与安排编辑器里的「原攻略时间保留」提示，数据仍保留用于闭馆文本解析；m26 增加当天查询只发默认方式断言，m31 增加按钮存在与原时间不展示断言。
- 2026-11-16 · ZCode：开放资料不再阻断时间线（用户指认「开放资料比较麻烦，到达时刻就可以了」）——`shared/schedule.js` 把缺失／待确认／失效／最后入场未知的开放资料从阻塞项降为 `notes` 软提示：仍按「到达时刻 + 停留」继续推算后续各站，只有资料冲突或已知关闭列冲突；当天状态改为「按到达估算 · 开放资料未核对」，安排面板单列可折叠说明，导出同步；schedule.check 覆盖缺失/过期/不安全资料仍生成到达时刻。
- 2026-11-16 · ZCode：交通查询等操作反馈移出行程正文（用户指认「查询返回显示在当天标题上方很割裂，本质是消息，应有合适位置和关闭按钮」）——新增 `NoticeToast` 顶部居中浮层：白卡+状态点，右上角 × 可关；普通提示 7 秒自动收起、错误保留；交通查询/校准/导出/排程提示统一走浮层（桌面与紧凑态共用），行程列只留保存失败/离线/mock 这类持续状态；m26 新增浮层与关闭回归，CDP 桌面探针验证位置与关闭。
- 2026-11-16 · ZCode：历史交通快照可直接用于计划评估（用户指认「有历史快照却不能直接使用，还得再查」）——共享 transport 的 selected 不再用 15 分钟 TTL 否定记录，改为标 historical 但仍计入汇总/排程；面板去掉重复的「上次记录／已过期／历史快照」三层文案，合并为一条「历史快照 · 查询于 …」；m26/transport.check 契约更新，导出同步。
- 2026-11-16 · ZCode：地点详情减负（用户指认「未安排地点摊开一大摞未知，越来越不轮椅」）——ScheduleVisit 仅在已有停留／预约／开放资料／真实冲突时渲染，未安排直接不渲染；时间行不再写「未知 → 未知 / 到达未知」，未评估原因合并为一行；顶部「安排／预约」保留为唯一入口。m31 新增未安排详情回归；m25–m31/desktop-a/mobile-shot 全绿 + CDP 目检详情面板。
- 2026-11-16 · ZCode：切换交通方式后自动查询（用户指认「切换方式一直待查，只有比较按钮」）——changeDay/changeLeg 把「指定天/段 + 方式」入队，延后一拍再跑（避开 mutate 后 routeLive 未更新导致 expected 失配）；TransportLeg 新增「查询此方式／刷新此方式」按钮；CDP 探针验证切到驾车后 1 次 modes=['car'] 请求并回填（步行+驾车双快照），m31 加切换自动查询回归。
- 2026-11-16 · ZCode：修复酒店/未核验坐标交通段无法估算（用户指认「出酒店和回酒店无法获取起始终点」）——根因：交通服务只接受 user/memory/amap-high，酒店与泛化地点 source=llm 被一律拒绝；现引入 approx 估算层：llm/search 高置信坐标照常查高德并标 approx，低置信/待确认/mock/城市中心仍拒绝；自动补全会重查旧「请先确认坐标」unknown 快照；交通行/面板/当天汇总/导出标「估算」。验证 _check_m26 / transport.check / m25–m31 七 DOM / desktop-a / mobile-shot 全绿 + CDP 假接口（旧 unknown 重查、2 段 approx、面板措辞）。
- 2026-11-16 · ZCode：交通段从「每段一个查看与查询按钮」改为自动补全 + 安静单行（用户提出「生成时让 agent 先收集一遍」）——Plan 落地按天串行补当天默认方式（只补缺失段／单批≤7 天，恢复路线按当前天懒补，手动查询优先；快照回写不占撤销栈，queryTransport 支持 modes）；交通行改成「方式 · 约 N 分钟/待查 ›」整行可点；不做全量三方式预取（额度／40 秒预算），比较仍按需。验证 tsc/build/m25–m31 七 DOM/desktop-a/mobile-shot 全绿 + CDP 假接口探针（1 次请求 modes=['walk']、3 段落盘、undo 仍禁用、点开不重复请求）。
- 2026-11-16 · ZCode：PWA 新版本胶囊上顶栏（用户提议）——Workspace 新增 UpdateCapsule（useOffline 待更新状态 + 与离线面板同一守卫 updateBlocked/routeSaveStatus.failed；可直接更新，被挡时点开离线面板），Plan 提取 updateBlocked 变量共用；CDP 假 SW 探针验证出现/文案/点击发 APPLY_UPDATE；tsc/build/m31/desktop-a/mobile-shot（dev server 重启后）全绿。
- 2026-11-15 · ZCode：日期列天数标签「D1」改「第N天」（用户问询，推荐案未答按推荐执行），收起态只留数字（新增 .dw-rail-num，对读屏隐藏、可访问名保留完整标签），地图角标与图例 D 色点同步；m31 断言改 第2天；验证 tsc/build/m31/desktop-a/mobile-shot 5 尺寸全绿 + CDP 两态目检。

- 2026-11-15 · ZCode：「攻略与 AI 综合建议」折叠条加修饰（用户指认太素）——米纸内衬 + 苔绿旋转角标 + 虚线分隔 + 灰绿圆点清单，与工作台 hover 语言对齐；CDP 目检收起/展开两态，build/m31/desktop-a 全绿。

- 2026-11-15 · ZCode：M38 修复拖拽失效（用户指认「调整行程列宽度无法拖动」）——连环两坑：①docW 状态从未绑定 CSS 变量（拖拽/方向键只改 state 不改 DOM），补 workspace 根内联 --dw-doc-w（收起时不写内联以免覆盖类规则）；②dw-dragging 挂在 .dw-body 上而 CSS 选择器要 .dw-workspace.dw-dragging，过渡杀不掉导致不跟手；顺带把 pct 原点从 body 左缘改到行程列左缘（分割线 1:1 跟手）；desktop-a 新增真实拖拽回归（拖拽中读宽防过渡延迟 + 持久化 + 拖回原宽）。验证 tsc/build/m31-dom/desktop-a 四尺寸全绿。
- 2026-11-15 · ZCode：M38 第三批实装 = Workspace.tsx/workspace.css 重写（底图+三浮层+收起体系+顶栏一行化）、Plan.tsx 去 visitDetail + aux 默认 'ai'、DayItinerary 标题去重、MapView 图例跟随 --dw-left-w；脚本 m31-dom/desktop-a 断言按新架构翻转（关闭辅助区→收起面板 全仓更名）；期间踩坑：重写丢 desktop-workspace testid、Leaflet 瓦片 pane 越层需 isolation、margin 锚定后游离拖拽条（用户指认后删除）。验证全绿（tsc/build/m25–m31/desktop-a/mobile-shot/CDP 目检）。
- 2026-11-15 · ZCode：桌面布局诊断（右侧 42% 交换槽 = 三条别扭的共同根因）→ 用户选「设计稿先行」→ 产出三栏方向稿 three-column-workspace.html（真实瓦片+GCJ-02 坐标、两条可拖分割线、四槽切换、AI 应用变更演示）+ three-column-direction.md；CDP 自验 1440/1024（修掉 --panel-w 裸数字导致 width 无效的 bug、首行 leg/酒店边框/缩放位保真）；待用户回答评估问题后实施。
- 2026-11-15 · ZCode：M38 第二批（用户指认）= 未安排日程默认安静（DayItinerary arranged 条件渲染 + 占位收敛 + m31-dom 加未安排白天回归 + DESIGN.md §9 规则）；验证 tsc/build/m25–m31/desktop-a/mobile-shot 5 尺寸全绿 + CDP 前后对比探针；顺带讲解 M27「有据才算」排程机制。用户方向：界面简洁优先，暂不完善的效果先不拿出来。
- 2026-11-15 · ZCode：M38 第一批 = 盲审 4 条清偿（bee297b 入口语义+图例 → f987a62 输入卡+状态条措辞）；验证 tsc/build/mobile-shot/m25–m31/desktop-a/chat-stream 全绿 + 逐截图目检；M33 doc §8 记录。用户方向：前端好用度优先，M36/M37 挂起。
- 2026-11-15 · ZCode：M35 第一轮（81fb9d9 讲解页 → 2713675 重复消息修复 → 49a97c3 知识点地图 → 141ef36 注入防御统一 + AGENTS v1.15/TASKS）；验证如摘要；真模型评估与真机回归未做。
- 2026-11-14 · ZCode：M33 后续第三笔，空态删「📋 粘贴攻略」（a804e94，与「开始对话」同 onClick 纯重复）；验证 tsc/build/mobile-shot 5 尺寸/m28-dom 全绿；真机回归未做。
- 2026-11-08 · ZCode：M34 天气退役（a2ced36 后端 → 317bc84 shared → 11b7418 前端 → 8fd8750 脚本 → 6fec6c3 文档，AGENTS v1.14）；验证：venv `_check_m25/m26/m27/m28/m30` 全过（m30 收缩后 9 场景）、backend import OK、tsc/build、mobile-shot 5 尺寸、m25–m31 DOM（m29 退役）、desktop-a、chat-stream 24/24、导出 fixture 零天气、全仓 grep 仅剩历史文档与墓碑注；真机回归未做。
- 2026-11-07 · ZCode：M33 后续修正两笔（a4bfbf5 删解释段与错标按钮 → ba4cbac 新建行程清旧对话）；chat-stream 24/24、build/tsc/mobile-shot 全绿；resume 态目检以 chat-stream 断言 + 诊断输出兜底（SKIP_FIXTURE 截图只覆盖空态）；坐标摘要气泡 DOM 断言随旧路径退役，由 coordDigest.check.ts 兜底。
- 2026-11-07 · ZCode：落地 M33 全站减设计（e04b2d4 offline quiet → 65aa669 Index 单列 → 542a87a 规划页去噪 → 84f5681 盲审修缮）；验证如摘要所述全部通过，独立盲审 8.9/10；真机人工回归未验证。同步 AGENTS.md v1.13（§10 路线图）并新增 docs/M33_UI_DECLUTTER.md。
- 2026-11-07 · ZCode：落地界面大改第二批（5e046c4 token 统一 → 3da94d8 SKIP_FIXTURE）；验证如摘要所述全部通过；PlaceForm/HotelForm 单独截图与真机回归未验证。
- 2026-11-07 · ZCode：落地 M32 规划页全尺寸打通（c6b2fbf 导航绿 token → 88f56b5 结构 → bdf3b2b 观感 → 90fefc5 对话 → 8f0f384 脚本）；验证如摘要所述全部通过；真机人工回归未验证。同步 AGENTS.md v1.12（§9 移动端口径、§10 路线图）并新增 docs/M32_PLAN_COMPACT.md。
