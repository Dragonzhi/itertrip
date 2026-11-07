# itertrip

status: 进行中
next: 界面大改停在此处 —— 规划页全尺寸已打通；下一步是界面大改第二批（Index 起始页 / 设置面板 / Admin / 各类弹窗表单对齐工作台设计语言）
updated: 2026-11-07

## 待办

- [ ] 界面大改第二批：Index 起始页 / SettingsPanel / MapSettings 浮窗 / Admin / PlaceForm·HotelForm 弹窗对齐工作台设计语言
- [ ] Index.tsx 原生 `window.alert` 改卡片内联错误行（ui-fix-plan §7 唯一明确代码欠账）+ 残留 `text-[10px]` 清理
- [ ] M32 真机人工回归（iOS Safari / 实体 iPad），补记到 docs/M32_PLAN_COMPACT.md §5
- [ ] docs/TODO.md 两条等反馈项：tid 可携带性、PING_ABORT_MS 自动中断策略

## 进行中

（无）

## 已完成

- [x] M32 规划页全尺寸打通：<1024 统一底部抽屉与互斥（平板带不再双栏互叠）、窄屏观感与对话面板对齐工作台设计语言、mobile-shot 覆盖 5 尺寸（2026-11-07）

## 交接摘要

### 2026-11-07 · M32 规划页全尺寸打通

**变更**（frontend，5 个提交 `c6b2fbf` → `8f0f384`，详见 `docs/M32_PLAN_COMPACT.md`）：

- `Plan.tsx`：`!desktop` 分支（<1024）统一底部 sheet —— `isMobile()` 全部翻转为 `!desktop` 语义、`max-md:`/`md:` 类对翻转或删除、AI 左缘手柄与「☰ 行程」文字钮退役、顶栏收敛单行（🧭+标题+🤖/🗺）、metas/日期卡/mock 徽标不再双渲染、`panel-top-gap` 删除
- `lib/viewport.ts` 新增 `isCompact()`（max-width:1023px）；`MapSettings.tsx` 浮窗定位改 `max-lg:`、right <1024 恒 12
- 观感：抽屉白表头/白工具条 + 米纸内容区；工具条按钮对齐 dw-toolbar token（1px line/6px 圆角/36px/13px + `.focus-ring`）；Timeline 来源徽标与 HotelCard 小字 11→12px；sheet 手柄加大加色
- `Chat.tsx` header 对齐 dw-toolbar；`ChatPanel.tsx` 空态/澄清卡/多选按钮统一（ClarifyCard 逻辑与 testid 未动）
- `mobile-shot.mjs`：768×1024 平板腿、布局分支断言、互斥真断言、桌面价格断言修复（先点 `button.dw-hotel`）+ fixture 补齐 M27 可比报价字段并加第二条报价（金环动效自此才可测）；导出 HTML 探针仅 `SHOT_URL` 时启用

**验证**：`npm run build` ✓；`tsc --noEmit` ✓；`mobile-shot.mjs` 5 尺寸全绿（320/375/390/768×1024/1280×800，含拖拽关闭/表头可达/跨天排序/互斥/价格金环）；`desktop-a-browser.mjs` exit 0；m25–m31 七个 DOM 集成检查 exit 0；768/390 截图目检通过。

**未完成/阻塞**：真机人工回归未做（验证基于 CDP 模拟 + 截图目检）；Index/设置面板等视觉统一明确留下一轮。

**接手第一个动作**：若继续界面大改，从 Index 起始页开始（对齐 `frontend/src/components/desktop/workspace.css` 的 token 体系）。

## 工作留痕

- 2026-11-07 · ZCode：落地 M32 规划页全尺寸打通（c6b2fbf 导航绿 token → 88f56b5 结构 → bdf3b2b 观感 → 90fefc5 对话 → 8f0f384 脚本）；验证如摘要所述全部通过；真机人工回归未验证。同步 AGENTS.md v1.12（§9 移动端口径、§10 路线图）并新增 docs/M32_PLAN_COMPACT.md。
