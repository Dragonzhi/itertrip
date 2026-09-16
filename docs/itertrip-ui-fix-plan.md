# IterTrip 主界面修复优化方案（v2 · 核查后收缩）

> v2 说明：v1 的定位方式（file:line + 实算对比度）经逐条复核**基本准确**——抽查 55 处行号引用 49 处命中，
> §0 对比度 14 个数值独立复算误差 ≤0.01。问题出在**范围**：批次 C 占了一半工时却修的是品味，另有 8 处引用不实。
> 本版只留「真缺陷 + 低成本」，合计 **≈1 人日**（v1 估 2.5–3 人日）。
> 红线不变：不改「暖纸 + 墨绿 + 金」设计语言与信息架构；不引组件库；不动 admin 内部实现。

---

## 0. 事实基线

| 事实 | 值 | 来源 |
|---|---|---|
| 色板 | cream `#FAF6F0` · ink `#2B2B28` · ink-soft `#6B6B64` · moss `#1F6B54` · moss-soft `#E3EFE8` · gold `#C8903C` · gold-soft `#F6EBD8` · line `#E8E0D4` | `frontend/tailwind.config.js:10-17` |
| React / motion / 依赖数 | 18.3.1（`inert` 只能用 ref 方案） · motion ^13.2 · **运行时依赖 4 个**（leaflet/motion/react/react-dom，**无 react-router**） | `frontend/package.json:11-16` |
| `text-[10px]` | **24 处 / 10 文件**；另 `text-[10.5px]` 3 处（MapSettings:69、:79、HotelForm:212） | 全仓 grep |
| `isComposing` | **0 处**（IME 回车误发送确认存在） | 全仓 grep |
| 原生弹窗 | 5 处：`Plan.tsx:191` · `SettingsPanel.tsx:64` · `Chat.tsx:81` · `Index.tsx:80`（confirm）/ `:83`（alert） | 全仓 grep |
| `text-ink-soft/` 半透明文字 | **7 处**（DecisionTrace:83/105 · ThinkingBlock:48/54 · StreamControls:45/51/69；CalendarPicker:176 的 `/40` 是 disabled，不动） | 全仓 grep |
| `#B85C5C` 压浅底 | **18 处**（Plan:701/856/1096 · Admin:209/318/346 · SettingsPanel:162 · HotelCard:85 · ChatPanel:463 · Chat.tsx:124 · HotelForm:139 · DecisionTrace:86 · StreamControls:37/60/106 · Timeline:213/234 · MapView:45） | 全仓 grep |
| `.place-item.removed` | **JSX 应用 0 处**（只有 routeDiff 的数据字段同名）→ `fadeRemoved` 是死代码 | 全仓 grep |
| 导出菜单外点关闭 | **已实现**（`Plan.tsx:101-112` exportRef + mousedown），只缺 Esc | 读代码 |
| 触控目标标准 | WCAG 2.2 **2.5.8 AA = 24×24**；**2.5.5 AAA = 44×44**（v1 的「≥44px」是 AAA 门槛） | WCAG 2.2 |

**对比度基线**（WCAG 相对亮度公式，14 个数值已独立复算，误差 ≤0.01）：

| 前 / 背 | 对比度 | 判定 |
|---|---|---|
| ink / cream | 13.19:1 | ✓ |
| ink-soft / cream | 4.99:1 | ✓（全透明即达标，问题只出在 `/60` `/70` 折扣） |
| 白 / gold | 2.80:1 | ✗ |
| ink / gold | 5.08:1 | ✓ |
| gold / gold-soft | 2.37:1 | ✗ |
| `#A8A298` / cream | 2.35:1 | ✗ |
| ink-soft/70、/60 / cream | ≈2.8 / 2.5:1 | ✗ |
| `#8A7F6A` / `#F1EDE4` | 3.38:1 | ✗ |
| `#B85C5C` / cream | 4.13:1 | ✗ |
| `#B85C5C` / `#F6E7E7` | 3.71:1 | ✗ |
| `#B85C5C` / `#FDF4F4` | 4.11:1 | ✗ |
| **gold-deep** `#8A5E1E` ／ 白 · cream · gold-soft | 5.67 / 5.27 / 4.81:1 | ✓ |
| **danger** `#9C4038` ／ cream · `#F6E7E7` · `#FDF4F4` | 6.09 / 5.46 / 6.06:1 | ✓ |

**新增 2 个 token 覆盖全部问题**：`"gold-deep": "#8A5E1E"`、`"danger": "#9C4038"`。
统一规则：**金底上永不放白字**；红字一律走 `danger`。

### 0.1 v1 订正（8 处，v1 原文请勿再引用）

| v1 声称 | 实测 | 影响 |
|---|---|---|
| B4 用 `useLocation()` 拆组件，`/admin` 往返会崩溃 | 项目**无 react-router**（片段抄自别的项目）；`/admin` 是 `<a href>` 整页跳转，hooks 数量变化当前不可达 | 片段编译不过；严重性从「崩溃」降为 lint 隐患 |
| A1「透明度折扣 3 处」 | 实际 **7 处**（补 StreamControls:45/69、ThinkingBlock:48/54） | 与「全仓无 `text-ink-soft/`」的验收自相矛盾 |
| 「深红统一 #9C4038」只落 2 处 | 同类不合格点 **17 处** | 改完达不到自己定的 AA 目标 |
| D3「Esc 关闭 **+ 点击外部关闭**」 | 外点关闭**已实现**，只缺 Esc | 虚报工作量 |
| B2 ChatPanel:455 用 `before:-inset-3.5` 扩命中区 | 父容器（其上 `line 450`）就是 `overflow-hidden`，伪元素被裁到 **≈30px** | 方案在该落点不成立 |
| D2 把地点行 / 酒店卡改成真 `<button>` | 两处内部都已嵌套 `<button>`（Timeline 的 ✎/✕/↑↓、HotelCard 的 hotel-edit） | **非法 HTML**，须换方案（见 D2） |
| D4 把 `.place-item.removed` 纳入 reduced-motion | 该类 JSX 应用 0 处，`fadeRemoved` 是死代码 | 该**删**，不该包 |
| D1 把 `Plan.tsx:717` 标为「校准」 | 那是出发日期检查结果；校准结果是 `:1090` recheckMsg | 落点对、标签错 |

---

## 1. 批次 A · Token 与可读性（≈0.4 人日，10 文件）

**`frontend/tailwind.config.js` 新增 2 行**：

```js
gold: "#C8903C",        // 保留：装饰性底色、描边、图钉
"gold-deep": "#8A5E1E", // 新增：金系前景 / 承载白字的实底
danger: "#9C4038",      // 新增：红系前景（压 cream / #F6E7E7 / #FDF4F4 全部达标）
```

### A1 完整落点清单（v1 漏了的已补全）

| 问题 | 位置 | 改法 |
|---|---|---|
| 白字压金底（3 处，全量） | `Plan.tsx:976`（选点提示条）、`Plan.tsx:1048`（添加地点钮） | 文字 `text-white` → `text-ink`（ink/gold 5.08 ✓） |
| 白字压金底 | `HotelCard.tsx:127`（「最低」小徽标） | `bg-gold` → `bg-gold-deep`，白字保留 |
| `text-gold` 作前景（9 处，全量） | `Plan.tsx:709/794/908/1016`、`Index.tsx:88`、`ChatPanel.tsx:398`、`HotelCard.tsx:145`、`DecisionTrace.tsx:86`（warns 分支）、`lib/coordSource.ts:46`（`warn` tone → Timeline:196 / PlaceForm:205 自动生效） | → `text-gold-deep` |
| 装饰符（**不改**） | `Timeline.tsx:63` `before:text-gold` 的 ✦ | 纯装饰，保留 |
| `#A8A298`（5 处） | `Plan.tsx:1100`、`Index.tsx:99`、`ChatPanel.tsx:520`、`HotelCard.tsx:118`、`MapSettings.tsx:79` | → `text-ink-soft`（4.99 ✓，无需新 token） |
| `#8A7F6A`（2 处） | `Plan.tsx:687`、`lib/coordSource.ts:45`（`model` tone） | → `text-ink-soft`（4.59 ✓） |
| 透明度折扣（**7 处**） | `DecisionTrace.tsx:83`(/70)、`:105`(/60)、`ThinkingBlock.tsx:48`(/60)、`:54`(/70)、`StreamControls.tsx:45/51/69`(/70) | 去掉 `/N`，用实色 `text-ink-soft` |
| 红系前景（**18 处**，全量） | `Plan.tsx:701/856/1096`、`Admin.tsx:209/318/346`、`SettingsPanel.tsx:162`、`HotelCard.tsx:85`、`ChatPanel.tsx:463`、`Chat.tsx:124`、`HotelForm.tsx:139`、`DecisionTrace.tsx:86`（errs 分支）、`StreamControls.tsx:37/60/106`、`Timeline.tsx:213/234` | `text-[#B85C5C]` / `hover:text-[#B85C5C]` → `text-danger` / `hover:text-danger` |
| 红系（地图气泡，不能用 Tailwind 类） | `MapView.tsx:45` 的内联 `style="color:#B85C5C"` | 手写十六进制 → `#9C4038` |
| 地图气泡徽标 | `index.css:28` `.pp-model` → `#6B6B64`；`:29` `.pp-warn` → `#8A5E1E`（5.02 ✓） | `.pp-ok` 5.4 ✓、`.pp-none` 4.59 ✓ 不动 |
| 红点底色（**不改**） | `DecisionTrace.tsx:25` `fail: "bg-[#B85C5C]"`、`mapCore.ts:5` DAY_COLORS | 装饰图形，保留 |

**验收**：`grep -nE "text-gold[^-a-z]"`（排除 `-deep`/`-soft`）只剩 `Timeline.tsx:63`；`A8A298` 0 命中；`text-ink-soft/` 只剩 `CalendarPicker:176`；`/60`、`/70`、`B85C5C`（除上表标「不改」）0 命中。

### A2 字号下限

- 全仓 **24 处** `text-[10px]` → `text-[11px]`（徽标 / 标签类）；
- **3 处** `text-[10.5px]` → `text-[11px]`（`MapSettings.tsx:69/79`、`HotelForm.tsx:212`）；
- 句式 meta 升 `text-xs`（12px，4 处）：`ChatPanel.tsx:520`、`Plan.tsx:850`、`Plan.tsx:892`、`StreamControls.tsx:51`；
- 顶栏 eyebrow 10px → 11px：`Plan.tsx:776`、`Index.tsx:27`、`Admin.tsx:189`。

> A1 与 A2 会改到同一批 class 字符串，**逐文件一次改完**再进下一文件，别分两遍来回。

**验收**：grep 无 `text-\[10(px|\.5px)\]`；`npm run build` 通过。

---

## 2. 批次 B · 行为修复（≈0.3 人日）

### B1 中文输入法回车误发送（唯一的功能性 bug，先修）

落点 **3 处**（同一根因，施工时按「改根因不改单个调用点」补齐）：`Plan.tsx:952`（抽屉对话）、`ChatPanel.tsx:493`（首页对话）、`ChatPanel.tsx:145`（澄清卡「多选」自定义选项输入 —— 组词回车会把半截选项加进去）。
`Admin.tsx:375` 的登录 Token 输入**不动**：那里是 ASCII 粘贴，没有组词场景，加了只是噪音。

```tsx
onKeyDown={(e) => {
  if (e.key !== "Enter" || e.shiftKey) return;
  // IME 组词期间的回车是「选词」不是发送（老 Safari 用 keyCode 229 兜底）
  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
  e.preventDefault();
  send();          // Plan 里是 sendAiEdit(chatInput)，ChatPanel 里是 submit()
}}
```

> `e.nativeEvent` 本身就是 `KeyboardEvent`，**不需要** v1 里的 `as KeyboardEvent` 断言。

**验收**：微软拼音 / 搜狗组词中敲回车只上屏不发送；Shift+Enter 换行不变。

### B2 触控目标（v1 把 AAA 门槛当成了达标线，实际只有 1 处不达标）

| 位置 | 现状 | 改法 |
|---|---|---|
| `Plan.tsx:800/804`（🤖 / 🗺 手机圆钮） | 36px（`w-9 h-9`） | **已过 AA**；顺手 `w-11 h-11`（44px，浮层控件放大无副作用） |
| `ChatPanel.tsx:455`（删图 ✕） | **16px（唯一真不达标）** | `w-4 h-4 text-[10px]` → `w-6 h-6 text-[11px]`（24px 过 AA，与时间线 ✎/✕ 同规格） |
| `HotelCard.tsx:57`（编辑 ✎） | 24px | **已过 AA，不动** |

> v1 的 `before:-inset-3.5` 扩区方案在 ChatPanel 那处**不可行**（父级 `overflow-hidden` 会裁到 ≈30px）；要 44px 得先把 ✕ 挪出缩略图容器并改布局，收益不值。
> 时间线 ✎/✕/↑↓ 的 28×28 维持 M23 既定取舍（`index.css:168` 有注释背书）。

### B3 闭合抽屉仍可 Tab 聚焦

React 18.3.1 不支持布尔 `inert`（`inert={false}` 会渲染成 truthy 的 `inert="false"`），用 ref effect：

```tsx
const drawerRef = useRef<HTMLElement>(null);
useEffect(() => { if (drawerRef.current) drawerRef.current.inert = !chatOpen; }, [chatOpen]);
// <aside ref={drawerRef} aria-hidden={!chatOpen} …>
```

- 落点 1：`Plan.tsx:814-819` 左抽屉（保留 `aria-hidden`，加 `inert`）；
- 落点 2：`Plan.tsx:982-987` 右侧面板（**补 `aria-hidden`** + 同法 `inert`）。

> 焦点返还（v1 的 `triggerRef.focus()`）**先不做**：抽屉关闭只能由抽屉外的触发钮发起，焦点本来就不在里面；真出现焦点掉到 body 再加。

### B4 App.tsx hooks 违规（降级 P2，10 分钟）

`App.tsx:23-26` 在 `useState` 之前提前 return —— 违反 hooks 规则，是 lint 隐患（当前 `/admin` 走整页跳转，用户可见崩溃不可达）。**照 React 原样拆，别引路由**：

```tsx
export default function App() {            // 本函数内不含任何 hook
  return isAdminRoute() ? <Admin /> : <MainApp />;
}
function MainApp() { /* 原第 26 行起的 hooks 与 JSX 原样搬入 */ }
```

**验收**：`npm run build`（`tsc -b`）通过；`/admin ↔ 主应用来回导航无异常。

---

## 3. 批次 C · 从 P1 降为可选（只留 2 项，≈0.1 人日）

### C2 地图气泡转义（真 bug，6 行）

`MapView.tsx:34-49` / `:52-64` 用模板串拼 HTML，地点名/备注含 `"` 会撑破 `title` 属性、含 `<` 会打乱结构。**不重构 DOM**，加一个转义函数（单遍替换天然安全，替换文本不会被二次扫描）：

```ts
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ESC[c]);
```

包裹两个函数里**全部字符串插值**（约 12 个值 / 6 行）：`p.name`、`badge.title`（属性位）、`badge.text`、`p.time/ticket/transport/note`、`w`、`h.name`、`best.platform`、`h.note`。

**验收**：地点名填 `A"B <C>` 时气泡正常渲染。

### C4 文案与行为一致（1 行）

`Index.tsx:59-61`：无行程时副按钮「🗺 直接进入地图（先去对话生成）」→ 只改括号里的括号说明为「去对话生成行程」（按钮本体语义不动）。

### 可选（不阻塞）

- `Index.tsx:83` 的 `window.alert` → 卡片内联错误行（需 `useState`，约 6 行）。

---

## 4. 批次 D · 可达性收尾（≈0.3 人日）

### D1 异步结果播报（`role="status"`，隐含 polite）

5 处容器：`SettingsPanel.tsx:156-165`（ok/fail 两态）、`:188`（memory-msg）；`Plan.tsx:717`（出发日期检查结果）、`:1090`（校准结果）、`:1095`（导出错误）。

### D2 键盘可达（**换方案**：不能把容器包成 `<button>`）

Timeline 的地点行（`Timeline.tsx:134-157`）内部有 ✎/✕/↑↓，HotelCard 卡片（`HotelCard.tsx:48`）内部有 hotel-edit —— `<button>` 不能嵌套 `<button>`。改为把**名字本身**做成按钮：

```tsx
// Timeline.tsx:191：<span data-testid="place-name"> → <button type="button"
<button type="button" data-testid="place-name" onClick={(e) => { e.stopPropagation(); onPlaceClick(di, pi); }}
  className="text-left rounded focus-visible:outline-2 focus-visible:outline-moss focus-visible:outline-offset-2">
  {p.name}
</button>
```

`HotelCard.tsx:55` 的 `<h3>` 同法（`onClick` 内 `e.stopPropagation()`，避免冒泡到卡片重复调用）。
行的 `onClick` 保留（鼠标/触屏便利），卡片补 `hover:shadow-card`（`HotelCard.tsx:51` 现在只有 `transition-shadow` 没有 hover）；`Index.tsx:91`「配置模型」内联钮补 hover + `focus-visible`。

> focus ring 用 `outline-moss`（moss/cream 5.4:1）。仓库里 `focus:outline-2 focus:outline-moss-soft` 那套只在「同时改 border 色」的输入框上成立，别直接照抄。

### D3 菜单 / 折叠钮语义

- `Timeline.tsx:109-125` 天分组折叠钮：补 `aria-expanded={!isClosed}`（`aria-controls` 可选）；
- `Plan.tsx:1063` 导出触发钮：补 `aria-haspopup="true"` + `aria-expanded={exportOpen}`；外点关闭**已有**（`:101-112`），只需把 Esc 加进既有 keydown 监听（`:528-538`）或菜单内独立 effect。
- **不标 `role="menu"` / `role="menuitem"`**：菜单语义承诺方向键导航，两个按钮的展开层用 `aria-haspopup` 才诚实。

### D4 动效降级 + 删死代码

**先删** `index.css:81-85`（`@keyframes fadeRemoved` + `.place-item.removed`，JSX 零引用）。然后把 `:48` 既有的 `@media (prefers-reduced-motion: reduce)` 块扩成：

```css
@media (prefers-reduced-motion: reduce) {
  .route-flow, .iter-pin.flash, .price-row, .price-row-best { animation: none; }
  .heart-dots i { animation: none; }
}
```

**验收**：系统开「减弱动态效果」后四类动画全静止，信息不丢（最低价仍有静态 `bg-gold-soft` 高亮）。

### D5 移动端 autofocus

`ChatPanel.tsx:89`：`autoFocus={window.matchMedia("(pointer: fine)").matches}`，避免弹键盘顶起抽屉。

### D6 死代码

只做一半：删 `viewOffset`（`MapView.tsx:24` 声明、`:83` 解构、`:337` `void viewOffset;` + `Plan.tsx:740` 调用处）。
`Plan.tsx:741` 的 `isMobile() && Math.round(window.innerHeight * 0.7)` **不动**：SPA 无 SSR，读 `innerHeight` 无副作用，加 resize 监听是净增代码（抽屉已是 `max-md:h-[70dvh]`，它只影响地图 padding）。

---

## 5. 执行顺序与提交切分

| # | 内容 | 规模 |
|---|---|---|
| 1 | **B1** IME 守卫（唯一的功能性 bug） | 2 文件 · 6 行 |
| 2 | **A1+A2** 2 个 token + 金/灰/红全量替换 + 24/3/4 处字号 | ~10 文件 · 替换为主 |
| 3 | **B3 + D6 + D4** 两个抽屉 `inert`；删 viewOffset 整条 prop；reduced-motion 收口 + 删 `fadeRemoved` | 4 文件 |
| 4 | **D1 + D3** 5 处 `role="status"`；`aria-expanded` + 导出菜单 Esc | 3 文件 |
| 5 | **C2 + C4（+D2）** 气泡转义；文案；名字变按钮 + hover/focus | 4 文件 |

提交切成 3 个，别按批次切：

| Commit | 内容 |
|---|---|
| `fix(theme): 金/灰/红三系对比度达标 + 最小字号 11px` | 第 2 步 |
| `fix(a11y): IME 回车、抽屉 inert、live region、触控目标、动效降级` | 第 1、3、4 步 |
| `chore(ui): 气泡转义、导出菜单 Esc、地点名可键盘聚焦、删 viewOffset` | 第 5 步 + 余量 |

## 6. 验证（复用现有探针，不新增框架）

1. `cd frontend && npm run build`（`tsc -b` 会抓 `inert`、未用变量、类型错）；
2. `node scripts/mobile-shot.mjs`（零依赖 CDP：多尺寸截图 + 溢出/可达性探针 + 排序/价格断言，`SHOT_URL` 可指任意页）；
3. grep 三条硬指标：无 `text-gold`（用 `text-gold[^-a-z]` 排除 `-deep`/`-soft`，除 `Timeline.tsx:63`）、无 `A8A298`、无 `text-ink-soft/`（除 `CalendarPicker:176`）；
4. 键盘走查：Tab 进 → 顶栏 → 时间线（折叠/聚焦/编辑/删除）→ **闭合抽屉不可入** → 导出菜单 Esc 可关；
5. IME 走查：微软拼音 + 搜狗，组词回车不发送、Shift+Enter 换行；
6. 移动端 375×667：无横向滚动；ChatPanel 删图钮实测 ≥24px；
7. 回归：「生成行程 → 选点 → 酒店 → 导出」主路径手测一遍。

## 7. 施工记录（2026-09 · 已全部落地）

19 个文件 · +153 / −111 行。全部验证通过：

| 验证 | 命令 | 结果 |
|---|---|---|
| 类型 + 构建 | `cd frontend && npm run build` | exit 0（`tsc -b` 无错，gzip 176.53KB） |
| 流式看门狗自检 | `node src/lib/stream.check.ts` | **14/14** |
| 流式交互 CDP（真前端 + 假 SSE） | `node scripts/chat-stream.mjs` | **17/17** |
| 移动端 CDP + 探针 | `node scripts/mobile-shot.mjs 375x667` | 全部通过（无横向溢出 / 抽屉内控件可达 / 跨天下移+撤销） |
| 验收 grep 四条 | 见 §1 A1 验收 | `text-[10` 0、`A8A298` 0、`text-gold[^-a-z]` 仅 Timeline:63、`text-ink-soft/` 仅 CalendarPicker:176 |
| token 真的进了产物 | grep `dist/assets/*.css` | `text-danger` / `text-gold-deep` 均已生成（rgb 138 94 30 / 156 64 56） |

未做的手测项（需真人）：IME 组词回车（微软拼音 / 搜狗）、键盘 Tab 走查、
「生成行程 → 选点 → 酒店 → 导出」主路径。

## 8. 明确不做（v1 砍掉的 + 原有红线）

- **C1 手绘 12 个描边图标**：全仓 **59 处 emoji**（含 PlaceForm 标签、提示串、快捷问句），只换功能钮 12 处会变成「SVG + emoji 混搭」，做彻底是 30+ 文件。emoji 本来就是零依赖的原生方案，这是品味不是缺陷。真要做图标 → 加 `lucide-react`（tree-shaken）另立项，别手维护 12 条 path。
- **C3 统一确认弹层（~100 行）**：`window.confirm` 天生无障碍 + 键盘可用，自研 focus trap / `alertdialog` 是拿 100 行 a11y 关键代码换一点品牌感。4 处 confirm 维持原生（`Index:83` 的 alert 见 §3 可选）。
- **ChatPanel:455 伪元素扩命中区**：父级 `overflow-hidden` 会裁掉；要 44px 得改布局（见 B2）。
- **把地点行 / 酒店卡整体包成 `<button>`**：内部已有 button，嵌套非法（见 D2）。
- **`role="menu"` / `role="menuitem"`**：语义承诺方向键导航，两个按钮不值得（见 D3）。
- **给 `.place-item.removed` 加降级规则**：死代码，直接删（见 D4）。
- **`Plan.tsx:741` 加 resize 监听**：净增代码，收益为零（见 D6）。
- **`backend/templates/route_map.html` 的同源色值**（`:136/140/229` 的 `#B85C5C` 与 `:23` 的 `#F6E7E7`）：导出 HTML 是后端模板，色值独立；要「全站一致」时再同步 3 处，别塞进前端批次。
- 不改「暖纸 + 墨绿 + 金」设计语言与信息架构；不引组件库；不动 admin 路由内部实现（仅 B4 的入口拆分）；时间线 28×28 维持 M23 取舍（已过 AA 24px）。
