# IterTrip · 从 Skill 到 Web 应用转型规划

> 2026-08-31 · v0.4 · 规划文档（Phase 1-4 已实现；Phase 5 自动化部分就绪，见 DEPLOY.md）

---

## 1. 缘起

### 1.1 当前状态

IterTrip 目前有两个形态：

**① 自包含 HTML 编辑器应用（v0.5，已实现，GitHub main）**
- 单文件 `templates/route_map.html`（1225 行），浏览器打开即用，零依赖，离线可用
- 内置交互式编辑器：拖拽排序、跨天移动、删除、地图点选新增、撤销/重做
- 新增地点表单：时间/交通/门票 `<datalist>` 预设配置，零外部依赖
- 编辑已有地点：全部字段修改 + 地图重选位置（`🗺 更改位置` 按钮进入选点模式）
- 空修改检测：保存前逐字段比对，无变化不进历史栈
- 导出：自包含 HTML（同一模板，固化行程数据）或 JSON
- 通过 `__TRIP_DATA__` 占位符支持服务端嵌入行程数据
- 移动端适配：375px 窗口验证通过，触屏编辑按钮常显
- 测试覆盖：jsdom 30 条断言 + Edge 真机探针 23/23 通过

**② Hana Agent Skill（itertrip）**
- 用户通过 Agent 对话输入需求，Skill 指导 Agent 搜索、规划、构建 HTML（173 行 SKILL.md）
- 产物同①，但由 Agent 在对话中生成后交付
- 依赖 RollingGo MCP 查实时价（已配置，已验证可工作）

### 1.2 三个问题

**侵入感**：Skill 嵌入在 Agent 对话流里，用户必须进入 Hana、启动 Agent、等待对话返回结果。整个流程是被动跟随式的，不是主动操作式的。

**可展示性**：Agent Skill 是一个「插件」，面试官无法直接体验。你说「我做了个 AI 旅行规划应用」，他打开网页就能用；你说「我做了个 Hana Agent 的 Skill」，他得先理解 Hana 是什么。

**可扩展性**：Skill 的核心逻辑（搜索、规划、坐标补全、HTML 构建）全部写在 SKILL.md 文档里，无法被其他场景复用。如果未来想做小程序、微信群机器人、Web 端，都要重新实现。

### 1.3 转型目标

把 IterTrip 从「一个 Skill」升级为**一个以 Web 应用为主产品的系统，Skill 作为 Hana 生态的接入点**。

---

## 2. 目标架构

```
┌─────────────────────────────────────────────────────┐
│                    用户入口                           │
│                                                     │
│   ┌──────────────┐         ┌────────────────────┐    │
│   │  浏览器      │         │  Hana itertrip     │    │
│   │  (Web App)   │         │  Agent (Skill)     │    │
│   └──────┬───────┘         └─────────┬──────────┘    │
│          │                           │                │
│          ▼                           ▼                │
│   ┌─────────────────────────────────────────────────┐│
│   │              API 层 (FastAPI)                    ││
│   │  POST /api/plan  POST /api/geocode              ││
│   │  POST /api/search  POST /api/export             ││
│   └───────────────────────┬─────────────────────────┘│
│                           │                           │
│                           ▼                           │
│   ┌─────────────────────────────────────────────────┐│
│   │              规划引擎 (共享核心)                  ││
│   │  LLM 规划 → 坐标补全 → 价格注入 → HTML 构建     ││
│   └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

**核心原则**：规划引擎只写一次，Web 前端和 Hana Skill 都通过同一套 API 调用它。

---

## 3. 技术栈

### 3.1 后端

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | **FastAPI** (Python 3.12+) | 异步支持好，自动生成 OpenAPI 文档，轻量 |
| LLM 调用 | **httpx** + 任意 LLM API | 不绑定供应商，兼容 DeepSeek / OpenAI / 本地模型 |
| 搜索 | **AnySearch** / Tavily 等 | 复用现有 API key |
| 部署 | **Railway** 或 **fly.io** | 免费额度够用，Serverless 友好 |

### 3.2 前端

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | **React 18** + Vite | 求职标配，轻量 |
| 地图 | **Leaflet** (react-leaflet) | 与现有模板一致，国内高德瓦片可用 |
| 样式 | **Tailwind CSS** | 轻量、实用、求职常见 |
| 部署 | **Cloudflare Pages** 或 **Vercel** | 免费，自动 CI/CD |

### 3.3 现有资产复用

| 已有资产 | 在新架构中的角色 |
| --- | --- |
| `templates/route_map.html` | 后端导出功能的核心模板（不变）；同时已是独立可用的编辑器应用 |
| `scripts/build_html.py` | 后端 `POST /api/export` 直接调用 |
| Route JSON schema | 前后端共享的数据契约 |
| `templates/route_map.html` 中的编辑器逻辑 | 前端交互编辑器的参考实现（拖拽、撤销、地图点选、编辑表单等），React 移植的目标 |
| RollingGo MCP | 可选：后端可配置为价格源（不强制） |
| DESIGN.md | 编辑器设计决策与已知限制的记录 |

---

## 4. 项目结构

```
IterTrip/
├── backend/                     # FastAPI 后端
│   ├── main.py                  # 入口，路由注册
│   ├── api/
│   │   ├── plan.py              # POST /api/plan
│   │   ├── geocode.py           # POST /api/geocode
│   │   ├── search.py            # POST /api/search
│   │   └── export.py            # POST /api/export
│   ├── engine/
│   │   ├── planner.py           # 核心：LLM 行程规划
│   │   ├── coordinates.py       # 坐标补全与校验
│   │   ├── builder.py           # HTML 构建（调用 build_html.py）
│   │   └── schema.py            # route JSON 数据模型
│   ├── templates/
│   │   └── route_map.html       # 复用现有模板
│   └── requirements.txt
│
├── frontend/                    # React + Vite
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Index.tsx        # 首页：输入需求
│   │   │   ├── Plan.tsx         # 规划结果：地图 + 时间线
│   │   │   └── Edit.tsx         # 拖拽编辑（复用 EDITOR 设计）
│   │   ├── components/
│   │   │   ├── MapView.tsx      # Leaflet 地图组件
│   │   │   ├── Timeline.tsx     # 时间线面板
│   │   │   ├── Editor.tsx       # 拖拽编辑组件
│   │   │   ├── HotelCard.tsx    # 比价表
│   │   │   └── Toolbar.tsx      # 工具条
│   │   └── api/
│   │       └── client.ts        # API 调用封装
│   ├── package.json
│   └── vite.config.ts
│
├── hana-skill/                  # Hana Skill 薄客户端
│   └── SKILL.md                 # 简化版，只调 API 不自己干活
│
├── scripts/
│   └── build_html.py            # 保留，后端调用
├── templates/
│   └── route_map.html           # 保留，自包含 HTML 模板
├── examples/                    # 保留
├── DESIGN.md                    # 编辑器设计决策与已知限制
├── WEB_APP_PLAN.md              # 本规划文档（转型路线图）
├── SKILL.md                     # 当前 itertrip Agent Skill 指令
├── README.md
└── LICENSE
```

---

## 5. API 设计

### 5.1 POST /api/plan

生成行程规划。

**请求**：
```json
{
  "destination": "成都",
  "days": 3,
  "date": "2026-09-10",
  "travelers": 2,
  "budget": "中等",
  "style": "松弛探店",
  "constraints": "不要辣"
}
```

**响应**：
```json
{
  "trip": { "title": "...", "destination": "成都", "days": 3, ... },
  "days": [
    {
      "day": 1,
      "theme": "老成都巷子漫步",
      "places": [ /* 地点列表，含坐标 */ ],
      "hotel": { "name": "...", "lat": ..., "lng": ..., "prices": [] }
    }
  ],
  "summary": [ "建议 1", "建议 2" ]
}
```

### 5.2 POST /api/geocode

模糊名称 → 坐标。

**请求**：`{ "name": "宽窄巷子", "city": "成都" }`
**响应**：`{ "name": "宽窄巷子", "lat": 30.664, "lng": 104.052, "confidence": "high" }`

实现：优先走 LLM 已知知识，次选 web_search 取坐标，低置信度标记 `confidence: "low"`。

### 5.3 POST /api/search

搜索酒店实时价格（可选，对应 RollingGo MCP）。

**请求**：`{ "hotel": "美豪R酒店", "city": "成都", "checkIn": "2026-09-10", "checkOut": "2026-09-12" }`
**响应**：`{ "prices": [ { "platform": "RollingGo", "price": 221, ... } ], "bookingUrl": "..." }`

### 5.4 POST /api/export

将 route JSON 导出为自包含 HTML。

**请求**：`{ "route": { /* 完整 route JSON */ }, "filename": "chengdu_trip" }`
**响应**：HTML 文件内容（`text/html`）或文件下载链接。

backend 内部调用 `engine/builder.py`（即 `build_html.py` 的封装）。

---

## 6. 规划引擎（核心）

### 6.1 工作流

```
用户输入 → ① LLM 生成行程草稿 → ② 坐标补全 → ③ 价格注入（可选）
→ ④ 校验 schema → ⑤ 返回 route JSON
```

**步骤①**：LLM 接收目的地/天数/风格，输出结构化 JSON（含景点名、时间、交通、门票估算）。

**步骤②**：对每个有 `name` 但无 `lat/lng` 的地点，调用 `POST /api/geocode` 补全坐标。补不到的标记 `confidence: "low"`，前端显示「⚠️ 坐标可能需要确认」。

**步骤③**：如果用户提供了酒店名，调用 `POST /api/search` 查价（可选，不强制）。

**步骤④**：校验 route JSON schema 完整性（`pydantic` 或手工校验）。

### 6.2 与当前 Skill 的差异

当前 Skill 里，Agent 自己搜索、自己补坐标、自己写 JSON。做 Web 后，这部分逻辑从「Agent 的思考过程」变成「后端的确定代码」——**更可控、可测试、可缓存**。

> **注意**：当前自包含 HTML 应用（v0.5）采用的是**用户提供地点列表**的手动编辑模式，而规划引擎（Phase 1）定位的是**LLM 自动生成行程**。二者是互补的产品形态——LLM 生成初稿后，用户仍可进入编辑器手动调整。最终的前端应整合两种模式。

---

## 7. 前端概览

### 7.1 页面流

```
首页 (Index) → 输入目的地/天数/风格 → 点击「开始规划」
    ↓
规划页 (Plan) → 地图 + 时间线展示 + 比价表
    ↓
编辑页 (Edit) → 拖拽排序 + 跨天移动 + 删除 + 新增地点 + 导出
```

### 7.2 关键组件

**MapView**：封装 Leaflet 地图，接收 `day[]` 数据，渲染标记和路线。从现有模板的 `render()` 函数提取逻辑。

**Timeline**：时间线面板，与地图双向联动。从现有模板的 timeline 渲染逻辑提取。

**Editor**：拖拽排序 + 跨天移动 + 删除 + 新增地点 + 编辑已有地点（字段修改 + 地图重选位置）。当前 `templates/route_map.html` 中的实现（v0.5）可直接作为 React 移植的参考。

**Toolbar**：撤销 / 重做 / 导出 JSON / 导出 HTML / 添加地点。

### 7.3 与现有模板的关系

现有模板的 `render()` 函数、`routeArrowDeg`、`routeMidPoint`、`pinIcon` 等逻辑直接移植为 React 组件。这是一次**代码重构**，不是重写——逻辑已经在模板里验证过了。

此外，模板中已实现的编辑器功能（v0.5）包括：
- **拖拽重排 & 跨天移动**：jQuery UI Sortable 实现，双向联动地图
- **撤销/重做**：快照模型历史栈，上限 50 帧
- **地图点选新增**：点击地图进入选点模式，提示条切换
- **新增地点表单**：名称/时间/交通/门票/备注，时间/交通/门票使用 `<datalist>` 预设配置
- **编辑已有地点**：点击 ✎ 打开编辑表单，预填全部字段，空修改不进历史
- **地图重选位置**：编辑表单中点击「🗺 更改位置」→ 选点模式 → 点击地图写回坐标
- **导出**：导出 HTML（自包含）/ JSON

这些功能将在 React 版本中重新实现，模板作为功能参考和回归测试基准。

---

## 8. Skill 的转型

### 8.1 新 Skill 定位

新 Skill 不再是自己搜索、规划、构建的「全功能工作流」，而是 **Web 应用的 Hana 客户端**：

```
用户 → itertrip Agent → Skill 读取需求 → POST /api/plan → 展示结果
```

### 8.2 SKILL.md 的核心变化

| 旧 Skill | 新 Skill |
| --- | --- |
| 自己搜索景点信息 | 需求传给 API，API 返回完整结果 |
| 自己补坐标 | 后端 engine 处理 |
| 自己构建 HTML | 后端 `POST /api/export` 生成 |
| 需要 MCP 连接器 | 不需要（后端直接调用搜索 API） |
| 侵入性强（对话流程长） | 薄客户端（需求→API→展示，三步） |

### 8.3 适用场景区分

- **Web 应用**：主力。用户方便、求职展示、可分享
- **Hana Skill**：Hana 用户的接入点。如果你在 Hana 里做别的事，顺便可以调 IterTrip

两者不冲突，都是同一套后端的客户端。

---

## 9. 导出能力

保持自包含 HTML 导出是核心卖点，不能丢。Web 应用里编辑后的行程，点击「导出 HTML」生成一个完整的 Leaflet 地图页面，没有 React 依赖，双击即开，可分享给任何人。

实现方式：后端 `POST /api/export` 内封装 `build_html.py`，前端调用后直接下载。

---

## 10. 开发阶段

> **当前状态**：Phase 1-4 全部实现并通过自动化验证（smoke 20/20；Edge 探针 13/13、18/18、4/4）。
> Phase 5 剩余为人工账号操作，步骤见 DEPLOY.md。

### Phase 1：后端先跑（✅ 已完成 · 实测 smoke 20/20）

- [x] FastAPI 脚手架 + 路由注册
- [x] `engine/planner.py`：调用 LLM 生成行程 JSON（mock 降级兜底，无 key 也可联调）
- [x] `engine/builder.py`：封装 build_html 为可调用函数（模板自 git 历史恢复至 backend/templates/）
- [x] `POST /api/plan` 返回 route JSON
- [x] `POST /api/export` 生成 HTML 下载
- [x] 验证：API 冒烟测试全通过，导出 HTML 经 Edge 探针 6/6 确认可打开渲染

### Phase 2：Web 前端（✅ 已完成 · Edge 探针 13/13）

- [x] React 18 + Vite + Tailwind 脚手架（frontend/）
- [x] 首页：输入表单（目的地/天数/日期/人数/预算/风格/约束）
- [x] 规划页：Leaflet 地图 + 时间线面板（几何逻辑逐行移植，mapCore.ts 纯函数可测）
- [x] 比价表展示（最低价自动高亮）
- [x] 双向联动（点击标记 ↔ 高亮条目 + 当日流动动画）
- [x] 调用 `POST /api/plan` 联调（Vite 代理 /api → 8787）

### Phase 3：交互编辑（✅ React 移植完成 · 探针 18/18 + DnD 4/4）

> v0.5 已在旧版自包含模板中实现（见 git 历史与 DESIGN §7.7）；现已完整移植到 React 前端。

- [x] 拖拽排序 + 跨天移动（jQuery UI Sortable，双向联动地图）
- [x] 撤销/重做（快照模型，上限 50 帧）
- [x] 删除地点（二次确认）
- [x] 地图点选新增地点（选点模式 + 提示条切换）
- [x] 新增地点表单：时间/交通/门票预设配置（`<datalist>`，零依赖）
- [x] 编辑已有地点：全部字段修改 + 地图重选位置
- [x] 空修改检测：保存前逐字段比对，无变化不进历史
- [x] 导出 JSON / HTML
- [x] 设计红线全移植：同天拖拽索引补偿 / 空修改不进历史 / repick 点回原位不进历史 / 无坐标不写 0,0 / Esc 优先级
- [x] 测试覆盖：Edge 真机探针 18/18 + 拖拽专项 4/4（历史栈/表单/选点/repick 全链路）

### Phase 4：坐标补全 + 搜索（✅ 已完成 · smoke 20/20）

- [x] `engine/coordinates.py`：LLM 知识 → 搜索兜底 → 城市中心表 三级降级 + confidence 标记
- [x] `POST /api/geocode`
- [x] 可选：`POST /api/search`（RollingGo / 搜索抓价，未配源时优雅降级为手动报价提示）
- [x] 前端集成：HotelCard「搜索网络报价」按钮 + 低置信「坐标待确认」标注

### Phase 5：Skill 转型 + 部署（⚙️ 自动化部分完成 · 账号操作待人工）

- [x] 重写 `SKILL.md` 为薄客户端版（需求→API→展示→比价→交付，含错误处理与 mock 告知义务）
- [x] 部署配置文件：`Dockerfile` + `railway.json`（healthcheck）+ `Procfile` + `.dockerignore`
- [x] 前端 `vercel.json` + `VITE_API_BASE` 环境变量化 + `.env.example`
- [x] 后端 CORS 白名单环境变量化（`ITERTRIP_CORS_ORIGINS`）
- [x] `DEPLOY.md`：Railway / Vercel / Cloudflare 逐步指引 + 环境变量汇总
- [ ] （人工）Railway 创建项目 + 配置 secrets + 绑定域名
- [ ] （人工）Vercel 导入 frontend + 配 VITE_API_BASE
- [ ] （人工）Hana Agent config 指向部署后的 API

---

## 11. 部署方案

| 组件 | 平台 | 费用 | 备注 |
| --- | --- | --- | --- |
| 后端 | Railway | 免费（每月 500 小时） | FastAPI 直部署 |
| 前端 | Cloudflare Pages | 免费 | 连 Git 仓库自动部署 |
| API 域名 | 自己的域名 或 Railway 自带 | 免费 | 如 `api.itertrip.dev` |
| LLM 费用 | SCNet API | 按量计费 | 复用现有 key |

---

## 12. 求职角度

这个项目在简历/面试里可以这样讲：

> **IterTrip · AI 旅行规划系统**
> 一个双入口的 AI 应用：用户通过浏览器或 Hana Agent 输入需求，系统自动规划路线、补全坐标、生成可分享的交互式地图。
> 
> 技术亮点：
> - **v0.5 自包含 HTML 应用（已发布）**：零依赖，浏览器打开即用，内置完整交互编辑器（拖拽、编辑、撤销、导出），可直接展示
> - **v1 目标**：前后端分离架构（FastAPI + React），同一套规划引擎服务两个入口
> - LLM 规划 + 坐标补全引擎，支持模糊地名降级
> - 纯前端交互编辑器（拖拽排序、跨天移动、地图点选新增、编辑已有地点）
> - 自包含 HTML 导出（零依赖，双击即开）
> - 可选集成酒店比价 API

面试官可以追问的点（都是正面可展开的）：
- 「LLM 输出怎么保证 schema 一致性？」→ engine 层的校验与降级
- 「坐标不准怎么处理？」→ confidence 标记 + 前端提示
- 「两个入口怎么共用逻辑？」→ API 层抽象
- 「前端编辑器的撤销怎么做？」→ 历史栈快照
- 「为什么不用 MCP 了？」→ 架构决策的思考过程

---

## 13. 开放问题（待讨论）

1. **LLM 调用 API key 放哪？** 后端环境变量最直接。如果部署在 Railway，通过 secrets 管理
2. **坐标补全的质量怎么保证？** 低置信度在前端加「⚠️ 坐标可能不准确，请在地图上拖动修正」提示
3. **前端要不要用户登录？** v1 不需要，匿名使用。以后再加可选保存
4. **后端要不要做缓存？** 对相同输入参数的规划结果可以缓存，但 v1 先不做
5. **Skill 那边的 API 地址怎么配？** 在 itertrip Agent 的 config 或环境变量里配置后端地址
6. **RollingGo MCP 还需要吗？** Web 后端可以直接调用 RollingGo 的公开 API（如果提供），不依赖 MCP 协议。MCP 只在 Hana 生态里有意义