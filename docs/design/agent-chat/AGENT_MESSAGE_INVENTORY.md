# Agent 对话 · 前端消息清单

> 范围：`POST /api/chat` 的 Agent 路径（`agent_turn.handles()` 命中后），即规划页「AI 改行程」抽屉里的受约束操作模式。
> 目的：先把「后端到底会发什么」与「前端必须让用户看到什么」分开，再决定视觉方案。
> 合成数据仅用于设计演示；字段名以 `backend/engine/agent_turn.py`、`backend/api/chat.py`、`frontend/src/types/chat.ts` 为准。

## 1. 传输层事件

| SSE event | 数据 | 前端是否显示 | 说明 |
|---|---|---|---|
| `stage` | `{stage, label}` | 是，一句话状态 | Agent 相关：`agent`「正在理解修改要求…」、`agent-thinking`「正在生成修改方案（N/M）…」、`agent-tool`「正在查询只读资料…」、结束 `done`「完成」 |
| `ping` | `{ms, stage}` | 不显示文本 | 只驱动心跳点与「多久没响应」；不能当成进度 |
| `trace` | `{step}` | 是，按步 upsert | 本轮的核心过程消息，按 `id` 覆盖同一行 |
| `reply` | 终帧 | 是 | Agent 路径 `route` 恒为 `null`，真正的改动在 `agent_proposal` |
| `error` | `{detail}` | 是，错误气泡 | Agent 异常，如「Agent 未修改行程：…」 |
| `delta` / `thinking` | 增量文本 | Agent 路径不会出现 | Agent 是非流式多轮循环；正文只在终帧一次性返回 |

## 2. Trace 步：Agent 路径会出现的种类

| kind | 典型 status | 典型 title / detail | 用户需要知道什么 |
|---|---|---|---|
| `provider` | `done` | 「受约束操作模式」/ 单模型、最多 6 轮、360 秒、输出上限 | 这是一次受控操作，不是开放式聊天；预算信息默认折叠 |
| `llm` | `run → done` | 「操作分析 1/6」→「已返回」；`meta.usage` 带 token | 当前第几轮推理；token 只在技术细节里显示 |
| `llm` | `warn` | 「模型输出达到本轮上限」「模型没有返回最终内容」「已报告 token 用量达到预算」「原生工具参数被拒绝」 | 为什么这一轮没结果；要能重试 |
| `retry` | `warn` | 「供应商不支持 reasoning_effort，已关闭」「供应商不支持原生工具参数」 | 不是用户的错，系统已自动降级；不要制造恐慌 |
| `tool` | `run → done/warn` | 「查询：query_transport」→「查询结果：query_transport」；detail 是结果原因，meta 有 `source`/`queried_at`/`http_calls`/`cached`/`elapsed_ms` | 查了什么、查到什么、来源与时间；HTTP/缓存次数默认折叠 |
| `edit` | `warn` | 「时间候选仍有冲突，已反馈给模型」 | 第一版候选不合法，正在自动修正；修正成功后应收敛为完成 |
| `edit` | `done/warn` | 「领域候选已校验」/「候选与当前日程一致」 | 有可应用候选 / 没有实际变化 |
| `edit` | `warn/fail` | 「候选未通过校验」「拒绝并行工具批次」 | 校验失败或供应商违规；要给出可理解的下一步 |
| 客户端补的 `edit` | `done/warn` | 「已应用实际变更」「修改预览已准备」「已取消预览」 | 前端自己写入的状态，不是后端消息；必须与后端轨迹收敛 |

## 3. 终帧 `reply` 里的 Agent 载荷

| 字段 | 类型 | 前端是否显示 | 说明 |
|---|---|---|---|
| `reply` | string | 是 | 助手正文。无改动/失败时也靠它说明「行程未修改」 |
| `intent` | `route_edit \| chitchat` | 间接 | 决定气泡语义，不建议直接显示 |
| `agent_proposal` | `{transaction_id, base_version, actions[]}` | 是，核心 | 只有 `changed=true` 才存在；不含候选路线，前端用同构 `agent.prepare()` 派生 |
| `agent_direct` | bool | 是（作为状态） | 用户明确给了数值时可直接应用；否则必须预览 |
| `agent_evidence` | `AgentEvidence[]` | 是，折叠「依据」 | 只读工具查到的交通段与候选方式；让用户知道候选取自哪次查询 |
| `trace` | `TraceStep[]` | 是 | 终帧完整轨迹，刷新后重放 |
| `stats` | object | 默认隐藏 | `tool_calls` / `http_calls` / token / `protocol` / `elapsed_ms` / `model` / `provider`；只在「技术细节」或标题徽标露出模型与来源 |

## 4. 提案动作：预览卡需要逐条说清

| op | 参数 | 用户语言 |
|---|---|---|
| `move_place` | `place_id, to_day, before_id` | 「把 X 从第 A 天挪到第 B 天，放在 Y 之前」 |
| `set_duration` | `place_id, minutes` | 「X 的停留从 45 分钟改为 50 分钟」 |
| `lock_visit` | `place_id, locked` | 「锁定/解锁 X」 |
| `set_reservation` | `place_id, date, start, end` | 「记录 X 的待确认预约」；必须注明未预订 |
| `add_place` | `to_day, name, type` | 「第 N 天新增 X」；坐标暂未知 |
| `set_day_schedule` | `day, start, end, durations[], source` | 「第 N 天起止改为 …；各站停留 …」；`source=estimate` 必须标「AI 预排」 |

前端另外派生、但同样必须显示的：

- `candidate.unknown`：仍未充分评估的条件（交通未知、坐标待确认、开放资料未核验、营业时间未核验…）。
- `candidate.reasons`：为什么没有可应用候选（版本过期、固定预约冲突、访问进度变化…）。
- 客户端应用结果：已应用 / 已取消 / 预览失效；只能用实际 diff 说话，不能拿模型的话当成功。

## 5. 必须显示 vs 可折叠 vs 仅开发

**必须显示（用户据此做决定）**

1. 当前在做什么：一句话阶段（stage）。
2. 是否已经改动行程：待确认 / 已应用 / 已取消 / 未改动 / 失败。
3. 候选具体改什么：每个 action 的用户语言行，含 before → after。
4. 仍未评估/不能保证什么：`unknown`、弱匹配、查询时间。
5. 依据：查了哪几段交通、哪种方式、来源与时间。
6. 失败原因与下一步：重试、换模型、分步修改。
7. 应用后：可撤销。

**可折叠（需要时再查）**

- 轮次、每次查询的耗时、缓存命中、HTTP 次数。
- 中间预检冲突与自动修正过程。
- 协议的自动回退（reasoning_effort / 原生工具参数）。
- 完整轨迹与 token 用量。

**仅开发/诊断**

- `transaction_id`、`base_version`、`protocol`、`http_calls`、`usage_complete`、`cost_usd`。
- 原始 tool 名称（`query_transport`、`check_schedule`）——用户语言应是「查交通」「检查日程」。
- `meta` 里的原始字段。

## 6. 现有前端呈现的缺口

1. **过程是日志，不是叙述**：`DecisionTrace` 直接渲染后端 title/detail，出现「操作分析 1/6」「HTTP 2 次」「已报告 token 未知」等工程词。
2. **提案卡只看 diff 摘要**：`AgentPreview` 用 `diffRoute().summary`，`set_day_schedule` 只显示「更新了当天起止时间」，看不到每站停留 from → to，也看不到具体时刻。
3. **依据不可见**：`agent_evidence` 只存在内存里，预览卡没有「这次查了哪两段交通」。
4. **状态语义弱**：待确认 / 已应用 / 已取消 / 无改动 / 失败都只是文字变化，视觉上没有形成稳定的「本轮状态」。
5. **技术信息抢占注意力**：标题栏模型徽标、消息底部 token/HTTP 行，对日常使用价值低。
6. **长会话噪音**：每一轮都留下完整轨迹与统计，历史消息越滚越长。

## 7. 设计原则（供方案取舍）

- **过程可折叠，结论必须显眼**：默认只留一行「执行收据」，把视觉重量给提案卡。
- **用用户语言，不用协议语言**：查交通 / 校验时间 / 仍缺什么，而不是 tool / token / protocol。
- **待确认必须像「待确认」**：不是一条普通助手消息，而是一个有边界的决策卡。
- **没改就是没改**：无改动、失败、取消都要明确写「行程未修改」，不能靠沉默表达。
- **证据可追溯**：每个耗时/时刻都能点开看到来源与查询时间；不制造「已核实」的假象。
- **技术细节退到二级**：默认隐藏，保留一个「技术细节」入口给排查。

## 8. 三个演示方向

| 方案 | 一句话 | 优点 | 代价 | 实现 |
|---|---|---|---|---|
| A 执行收据 | 过程收成一行，提案卡是主角 | 安静、省空间、日常最顺手 | 过程不主动可见 | 纯前端，现有 trace 足够 |
| B 任务时间线 | 一轮 Agent 是一张任务卡 | 最透明，复杂修改好解释 | 占垂直空间，偏工程感 | 纯前端 + 文案改写 |
| C 分阶段对话 | 查交通→发现冲突→给方案，拆成几条短消息 | 有对话感，节奏清楚 | 消息多，长会话更吵 | 纯前端可派生；模型口吻叙述需后端补事件 |

推荐：**A 作为默认，展开层用 B 的时间线，提案卡三案共用**。这样日常安静，需要排查时不丢信息。

## 9. 已选方向与落地（2026-11-18）

用户选定 **A 执行收据 + 展开 B 时间线**，已落到真实组件：

- `frontend/src/lib/agentTrace.ts`：`isAgentTrace`、状态推断、用户语言步骤、逐 action 行、依据格式化、改动计数。
- `frontend/src/components/AgentReceipt.tsx`：默认一行收据；展开是时间线；仅在展开层显示轮次 / token / 费用。
- `frontend/src/components/AgentPreview.tsx`：逐 action 显示 before → after；`set_day_schedule` 未变化的停留不重复列；
  「依据」折叠展示 `agent_evidence`；`candidate.unknown` 金色摘要常驻。
- `Plan.tsx`：提案卡移出气泡；`agentProposal` / `agentCounts` 随消息持久化，刷新后收据仍能说明当时改了什么。
- `backend/engine/agent_ops.py` + `shared/agent.js`：`set_day_schedule` 只改写实际变化的停留，未变化的停留保留原来源，
  避免「AI 重申现有 75 分钟」把用户设置误标成 `estimate` 并制造假变更。
- 非 Agent 轨迹（提取模式、旧编辑、坐标核验）仍走 `DecisionTrace`，不混用两种视觉语言。

演示页保留为取舍存档：[`agent-conversation-options.html`](agent-conversation-options.html)。
