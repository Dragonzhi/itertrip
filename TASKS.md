# itertrip

status: 进行中
next: M33 全站减设计已收工（盲审 8.9 通过）；剩余为 M32/M33 真机人工回归与 docs/TODO.md 两条等反馈项，盲审留档的 4 条收尾债等用户反馈再动
updated: 2026-11-07

## 待办

- [ ] M32/M33 真机人工回归（iOS Safari / 实体 iPad），补记到 docs/M32_PLAN_COMPACT.md §5 与 docs/M33_UI_DECLUTTER.md §5
- [ ] docs/TODO.md 两条等反馈项：tid 可携带性、PING_ABORT_MS 自动中断策略
- [ ] 盲审留档 4 条（等反馈）：桌面状态条措辞人话化、🤖/🗺 入口语义 + ⚙ 归排、双色地图标记图例、Chat 输入带接缝

## 进行中

（无）

## 已完成

- [x] M33 全站减设计：删三步卡/重复隐私句/✨发光条/抽屉品牌行/页脚标语；离线状态 quiet 一行化、抽屉天气默认收起、桌面状态阵合一（day-settings testid）、「继续出行」CTA 归位出行视图；日期芯片自适应、预算 ¥、触屏键盘提示收敛、ScheduleView 文案用户化；m29/m30 改 testid（2026-11-07）
- [x] 界面大改第二批（宁少勿滥）：Index / SettingsPanel / PlaceForm / HotelForm / Admin / NavigationDialog 控件 token 与弹窗半径对齐工作台；Index 导入失败改内联错误行（ui-fix-plan 欠账闭合）、删两处装饰 eyebrow；mobile-shot 新增 SKIP_FIXTURE 纯量页模式（2026-11-07）
- [x] M32 规划页全尺寸打通：<1024 统一底部抽屉与互斥（平板带不再双栏互叠）、窄屏观感与对话面板对齐工作台设计语言、mobile-shot 覆盖 5 尺寸（2026-11-07）

## 交接摘要

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

- 2026-11-07 · ZCode：落地 M33 全站减设计（e04b2d4 offline quiet → 65aa669 Index 单列 → 542a87a 规划页去噪 → 84f5681 盲审修缮）；验证如摘要所述全部通过，独立盲审 8.9/10；真机人工回归未验证。同步 AGENTS.md v1.13（§10 路线图）并新增 docs/M33_UI_DECLUTTER.md。
- 2026-11-07 · ZCode：落地界面大改第二批（5e046c4 token 统一 → 3da94d8 SKIP_FIXTURE）；验证如摘要所述全部通过；PlaceForm/HotelForm 单独截图与真机回归未验证。
- 2026-11-07 · ZCode：落地 M32 规划页全尺寸打通（c6b2fbf 导航绿 token → 88f56b5 结构 → bdf3b2b 观感 → 90fefc5 对话 → 8f0f384 脚本）；验证如摘要所述全部通过；真机人工回归未验证。同步 AGENTS.md v1.12（§9 移动端口径、§10 路线图）并新增 docs/M32_PLAN_COMPACT.md。
