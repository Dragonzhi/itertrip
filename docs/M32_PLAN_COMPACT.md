# M32 施工记录 · 规划页全尺寸打通（<1024 底部抽屉化 + 窄屏观感 + 对话精修）

> 2026-11-07 · 状态：已实现并本地验证 · 前置：M31 桌面工作台（≥1024px）已落地
> 用户确认的方向：规划页优先、平板带（768–1023px）底部抽屉化、视觉重点为手机观感 + 对话体验；配色维持 2026-10-17 确认的米白/墨绿/暖金。

## 1. 问题（为什么要改）

用户反馈「前端没适配窄屏幕」。实测结论比反馈更精确：

1. **M23 的 <768px 手机适配完好**，M31 没有破坏它 —— 用户的不满主要来自观感陈旧，而非功能缺失；
2. **768–1023px 平板带是真空地带**：`!desktop` 分支（<1024）里手机样式用 `max-md:`（768px）前缀、
   互斥逻辑用 `isMobile()`（<767px）判断 —— 平板走「桌面式双侧栏」，但 380px(AI) + 400px(行程) = 780 > 768，
   两栏互叠盖满地图，互斥逻辑不生效，开局还可双开（`panelOpen` 初始 true + 有 boot 消息时 `chatOpen` 初始 true）；
3. **观感未对齐 M31 工作台设计语言**：抽屉米纸底、工具条小按钮（12px/8px 圆角）、来源徽标 11px；
4. **mobile-shot.mjs 两处腐化**：桌面腿 `checkPrice` 找 `td` 报价行在 M31 后必然假红
   （初始视图是 DayItinerary，报价表在选中酒店后的 inspector 里）；`price-row-best-ring` 断言自 M27 引入
   `schedule.comparable` 门控起就结构性打不起来（fixture 裸报价缺房况字段，「同条件最低」需要 ≥2 条可比报价）。

## 2. 方案（断点语义统一）

`Plan.tsx` 的 `desktop` state（`matchMedia('(min-width:1024px)')`）已是唯一权威断点。
本轮把「紧凑交互」语义从 <768 上移到 **<1024**：`!desktop` 分支内所有 `isMobile()` 改 `!desktop` 判断
（新增 `lib/viewport.ts` 的 `isCompact()` 供 `MapSettings` 等组件外使用），`max-md:` 类前缀变无条件、
`md:` 侧栏变体删除 —— 分支只渲染 <1024，不存在中间态。≥1024 工作台分支零改动。

## 3. 改动清单

### 结构（`feat(m32): 规划页 <1024 统一底部抽屉与互斥`）

- `Plan.tsx`：
  - `panelOpen` 初始 `desktop || 出行模式`；`chatOpen` 初始 `desktop && 有 boot 消息`（平板开局不再双开/自动弹）
  - `toggleChat`/`togglePanel` 互斥去掉 `isMobile()` 条件；`draggable = !desktop`；`closeSheets` 改 `if (desktop) return`；
    地图 `bottomPadding` 与 OutingView 聚焦收面板同改 `!desktop`
  - 顶栏收敛单行：🧭 圆钮（返回）+ 标题 + 🤖/🗺 44px 圆钮；AI 左缘手柄与「☰ 行程」文字钮删除；
    metas/日期卡/mock 徽标不再双渲染（只在抽屉表头一份）；`panel-top-gap` 让位带删除（浮条与底部 sheet 不再重叠）
  - AI 抽屉与行程面板：全 <1024 底部 sheet（`inset-x-0 bottom-0 h-[70dvh]`），阴影改上投影
- `MapSettings.tsx`：浮窗定位 `max-md:` → `max-lg:`，`right` 偏移 <1024 恒 12
- `index.css`：地图缩放控件隐藏扩展到 <1023（底部被抽屉盖住、左上与顶栏圆钮冲突）

### 观感（`style(m32)` 两笔）

- 抽屉层次：表头/视图切换行/工具条 `bg-white`，滚动内容区保持 `bg-cream`（白纸边 + 米纸内容，对齐桌面白底行程栏）
- 工具条按钮 token 对齐 `workspace.css` 的 dw-toolbar：1px line / **6px 圆角（`rounded-md`）** / `min-h-[36px]` / 13px，
  补 `.focus-ring`（方案初稿写 10px 圆角，按 dw 实际 token 校正为 6px）
- `Timeline.tsx` 来源徽标与 `HotelCard.tsx` 全部小字 11px → 12px（设计规范「辅助 ≥12px」；
  桌面 inspector 的 `.dw-inspector .text-xs` 规则本就把 11px 归一为 12px，两端口径就此一致）
- sheet 手柄加大加色（5px 高 × 48 宽 `#CFC5B0`，拖拽几何不变）
- `Chat.tsx` header 对齐 dw-toolbar（品牌墨绿块 + 白底描边 36px 动作钮）；`ChatPanel.tsx` 空态
  （moss-soft 圆底图标、示例卡 420px 列宽）与澄清卡/多选按钮统一 token；ClarifyCard 逻辑与全部 testid 未动

### 脚本（`test: mobile-shot …`）

- 默认尺寸加 `768x1024`；`compact = w < 1024` 取代 `mobile = w < 768`（触屏仿真、拖拽关闭、表头可达、跨天排序全跑平板腿）
- 新增结构断言（≥1024 必有 `.dw-workspace` 且无 `[data-testid=ai-drawer]`，<1024 反之）
  与**互斥真断言**（面板开着时开 AI → 面板必须收起且 AI 打开）
- 桌面腿 `checkPrice`：先点 `button.dw-hotel` 让 inspector 渲染 HotelCard 再断言 ¥468；
  fixture 报价补齐 M27 可比字段（`check_in/check_out/room/occupancy/cancellation/unit/breakfast_known/source_url/queried_at`）
  并加第二条同房况报价 —— 两条可比报价才有「同条件最低」，金环动效自此才真正被测到
- 导出 HTML 专属探针（`#topbar`/`.brand`/…）仅在设置 `SHOT_URL` 时启用（React 页上恒 null，纯噪音）

## 4. 验证

- `npm run build` ✓（>500kB chunk 提示为 M31 起如实保留的既有项）；`npx tsc --noEmit` ✓
- `node scripts/mobile-shot.mjs` **5 尺寸全绿**（320/375/390/768×1024/1280×800）：
  无横向溢出、布局分支正确、拖拽下滑关闭（touch）、抽屉内控件可达、跨天下移+撤销、互斥断言、桌面价格与金环动效
- `node scripts/desktop-a-browser.mjs` exit 0（1024/1280/1440/1920 四档，无溢出无页面错误）
- `m25-dom / m26-dom / m27-dom / m28-dom / m29-dom / m30-dom / m31-dom` 七个 DOM 集成检查全部 exit 0
- 截图目检（768×1024 首屏/面板开、390×844 AI 抽屉开）：紧凑顶栏、白表头抽屉、统一工具条符合预期

## 5. 证据边界（未验证项）

- 真机（iOS Safari / Android Chrome / 实体 iPad）人工回归未做 —— 验证基于 CDP 模拟 + 截图目检；
- 真实 LLM 流式对话在窄屏抽屉内的长内容表现未实测（脚本用合成 fixture）；
- `itertrip:outing` 出行视图（M25）在平板底 sheet 的完整动线未逐一走查，仅排序/可达性断言覆盖。

## 6. 明确不做（留下一轮）

Index 起始页、SettingsPanel/Admin/地图设置面板观感、导出 HTML 模板、Index 原生 alert 内联化、
工作台下沉到 768 的激进方案（若平板反馈不佳再议）。
