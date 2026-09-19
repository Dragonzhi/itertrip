# M24 · 对话历史不再丢 AI 回复 + 坐标来源摘要进对话消息

> 版本 v1.0 · 2026-09-19 · 定位：一次**线上可复现**的「AI 消息凭空消失」修复 +
> 把坐标降级从折叠轨迹里搬到对话消息上（M19「静默兜底必须变成可见决策」的延续）
> 一句话：**AI 的消息不是没生成，是没来得及落盘就被卸载了；坐标是不是猜的，也不该只有点开轨迹才看得到。**

---

## 1. 问题 A：生成路线后回到对话页，AI 整轮消失

### 1.1 现象与复现

> 首次聊天生成地图路径后，再次回到对话页，只剩下用户的消息，**AI 方面的消息不见了**。

复现：对话页贴攻略 → 生成路线（自动跳规划页）→ 返回首页 →「和 AI 继续改这条行程」→ 对话页只剩用户气泡。
**纯聊天轮（不生成路线）的 AI 回复是存下来的** —— 这个差异正是根因的指纹。

### 1.2 根因：落盘挂在 effect 上，而这一次 commit 里 Chat 会被卸载

| # | 事实 | 位置 |
|---|---|---|
| 1 | 唯一的持久化入口是一个 passive effect | `frontend/src/pages/Chat.tsx:26-28`（改前） |
| 2 | AI 回复与「跳规划页」在**同一次回调**里提交 | `Chat.tsx:44-45`（改前）：`setMessages(...)` 紧接 `onRoute(r.route, "chat")` |
| 3 | `onRoute` → `setRoute` + `setScreen({plan})` | `frontend/src/App.tsx:62-65` |
| 4 | 项目是 **React 18.3.1** ⇒ 上面两个 update 被自动批处理成**一次 render** | `frontend/package.json` |

批处理的后果：App 这一次渲染直接返回 `<Plan/>`，Chat 子树在**同一次 commit 里被删除** ——
它**从未以新 messages 渲染过**，对应的 passive effect 自然永不执行。
于是 localStorage 停在「只有 user 消息」的那一版快照（`frontend/src/lib/settings.ts:72-80`）。

用户消息为什么在？它是在按钮事件里 append 的，那一刻 Chat 还挂着，effect 正常跑过一轮。

**附带损失**：下一轮请求的 `history` 也缺上一条 AI 回复 —— 模型的上下文被悄悄削掉一环。

### 1.3 实测证据（不是推理，是跑出来的）

把持久化临时改回「effect 写法」重新构建后跑 `chat-stream.mjs`，[5] 组直接抓出**悬空的用户消息**：

```
[FAIL] itertrip:chat 已落 AI 回复 ["user","user","assistant","user","assistant","user","assistant","user"]
[FAIL] 回到对话页仍能看到 AI 回复
结果: 19 通过 / 7 失败
```

最后一条是 `user`、后面没有配对的 AI 回复 —— 与线上现象逐字一致。改回 `commit` 写法后同一条断言变绿（26/26）。

### 1.4 修复：消息的**唯一**写入通道 `commit`，同步落盘

```tsx
const msgsRef = useRef(messages);
const commit = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
  const next = updater(msgsRef.current);
  msgsRef.current = next;
  setMessages(next);
  saveChatHistory(next);   // 同步：不依赖「组件还活着」这个前提
}, []);
```

- `onReply` / `onError` / `onInterrupt` / `markAnswered` / `clearHistory` 全部改走 `commit`；
- 原来的 `useEffect(() => saveChatHistory(messages), [messages])` **删除**；
- `send()` 里的 history 改从 `msgsRef.current` 取（澄清卡是「先 markAnswered 再 onSend」，读 state 会落后一拍）；
- 约定：**`setMessages` 不再被任何地方直接调用**，`msgsRef` 是唯一真相源（否则又会出现「两条写入路径」）。

**为什么不选别的做法**：`useLayoutEffect` 同样不会在「同批被卸载」时执行；在 `onRoute` 前手写一次只是把同一类坑
留给下一个人；把消息提升到 App 属于重构收益远小于风险。**顺带修好的边界**：用户在流式期间点「返回」导致
Chat 卸载后终帧才到 —— `setMessages` 是 no-op，但 `commit` 仍会把这条回复落盘，不再是静默丢弃。

---

## 2. 问题 B：坐标降级只活在折叠轨迹里

生成路线时，`_enrich_coordinates` 的每条替换/核验/兜底都已经以 `event: trace` 下发，但那是**折叠的**
「🧭 决策过程」，而且生成完成后会自动收起 —— 等于没告诉用户。而坐标恰恰是幻觉最常见、
用户又最难自己发现的地方（M19–M21 的全部教训）。

## 3. 实现 B：坐标来源摘要（`coordDigest` + `CoordReport`）

**数据源是 `reply.route` 里每个 place/hotel 的 `source` + `confidence`** —— 与时间线/地图徽标同一份数据，
口径天然一致；**零后端改动、零 SSE 契约改动、零 schema 迁移**。

| source | 计数标签 | 语气 | 算降级 |
|---|---|---|---|
| `user` / `memory` | 你确认过 | ok | 否 |
| `amap`（confidence≠low） | 高德核验 | ok | 否 |
| `amap` + low | 高德核验（明细写「高德低置信」） | warn | **是** |
| `llm` | AI 推测 | model | **是**（未核验） |
| `search` | 搜索兜底 | warn | **是** |
| `city` | 城市中心 | warn | **是** |
| `mock` | mock 样例 | none | **是** |
| `none` / 空串（有坐标） | 无来源 / 来源未知 | warn | **是** |
| lat/lng 为 0/null | —— | warn | **是**（明细写「无坐标」） |

- `frontend/src/lib/coordDigest.ts`：纯计数（只 `import type`，故能被 `node` 直接跑），产出
  `{total, counts[], verified, degraded[]}`；无路线/无点位返回 `null`（调用方与组件都不渲染）。
- `frontend/src/components/CoordReport.tsx`：挂在**助手气泡内部**，11px 次级视觉；
  降级明细超过 6 条折叠 +「展开全部」；文案统一从 `coordSource.ts` 的 `SOURCE_LABEL` + `coordBadge` 取
  （新增 `SOURCE_LABEL` 是因为 `coordBadge` 对「未知来源」返回 `null`，计数行不能缺项）。
- 接线 4 处：`types/chat.ts` 加可选 `geo?: CoordDigest`；`Chat.tsx` 与 `Plan.tsx` 的 `onReply` 写入；
  `ChatPanel.tsx` 与 `Plan.tsx` 抽屉各渲染一次。

渲染实样（E2E 截图 `frontend/test-artifacts/chat-after-route.png`）：

```
已为你排好 2 天行程。
──────────────────────────────
📍 坐标 5 处  [高德核验 2] [AI 推测 1] [城市中心 1] [无来源 1]
⚠️ 4 处坐标降级：第 1 天「笨罗卜」AI 推测 · 第 2 天「某小店」城市中心 ·
   第 2 天「待定位点」无坐标 · 第 2 天酒店「测试酒店」高德低置信
```

全可信时第二行换成 `✓ 全部 N 处坐标可信（高德核验 / 你确认过）`。
摘要随消息进 `itertrip:chat` / `itertrip:planchat`（两者只剔除 `route`/`images`），刷新后仍在；
旧消息没有 `geo` 字段则照旧渲染，无需迁移。体积：每条降级项约 60B，30 点位 ≈ 2KB。

---

## 4. 实测

```
cd frontend
npm run build                      # tsc -b + vite build 全绿
node src/lib/coordDigest.check.ts  # ✓ coordDigest.check 16/16 通过
node scripts/chat-stream.mjs       # 结果: 26/26 全部通过（含新增 [5] 组 9 条断言）
```

- 新增 [5] 组断言：进地图页 → `itertrip:chat` 里确有 assistant 回复与 `geo` → 返回首页 →
  回对话页后 **AI 回复与坐标摘要都还在** → 摘要的来源分布与降级点名逐项正确 → 整轮零页面异常。
- **变异验证**：改回旧写法（effect 落盘）后 [5] 组 7 条失败（见 §1.3），证明它不是「恒真的摆设」。
- `chat-stream.mjs` 的端口改为可用 `PORT` / `CDP_PORT` 覆盖（默认仍是 8100/9334）：
  真后端正跑在 8100 时用 `$env:PORT=8123; $env:CDP_PORT=9335` 并行跑，**不必停掉用户的服**。

## 5. 参数与文件

| 文件 | 作用 |
|---|---|
| `frontend/src/pages/Chat.tsx` | `commit` 同步落盘（问题 A）；`geo` 写入（问题 B） |
| `frontend/src/lib/coordDigest.ts` · `coordDigest.check.ts` | 摘要纯逻辑 + 16 条自检 |
| `frontend/src/components/CoordReport.tsx` | 摘要渲染（6 条折叠阈值） |
| `frontend/src/components/ChatPanel.tsx` · `pages/Plan.tsx` · `types/chat.ts` | 挂载点与消息字段 |
| `frontend/src/lib/coordSource.ts` | 新增 `SOURCE_LABEL`（全量来源标签） |
| `frontend/scripts/chat-stream.mjs` | `route` 剧本 + [5] 组；端口可覆盖 |

## 6. 边界与不覆盖（诚实清单）

- **`/api/plan` 表单规划路径不显示摘要**：那条路径没有对话消息（时间线/地图徽标已覆盖）；
- **摘要是「最终态」而非「过程」**：谁被替换/改回/冲突仍由「🧭 决策过程」承载，两处不重复同一批数据；
- **不改 `coordBadge` 对未知来源返回 `null` 的既有行为**（否则时间线/表单会凭空多出一批徽标）；
- **不改 `#chat` 的启动导航语义**：刷新对话页 URL 时 App 仍按「有 route 就进规划页」启动
  （`App.tsx:30-32`，hash 不参与初始判定）。这是**另一条**导航行为，与本次的消息丢失无关，
  要改需单独决策（改法：初始 screen 判定里优先认 `#chat`）；
- **摘要不等于核验**：它只是把已有事实（source/confidence）摊开，不新增任何坐标校验能力；
- **不含票价值/营业时间**（属 M22 §7 的 P1/P2，未在本轮实施）。
