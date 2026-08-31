# IterTrip · Web 应用设计文档

> 状态：Web 应用骨架就绪，积极开发中 · 版本：v0.3 · 作者：ZLOONG · 2026-08-31
> 仓库名：**IterTrip**（拉丁语 iter「道路」，Itinerary 行程单的词源）

## 1. 一句话定位

一个 AI 驱动的旅行规划 Web 应用：用户输入目的地和天数，系统自动规划路线、补全坐标、生成可分享的交互式地图。支持拖拽编辑、酒店比价、自包含 HTML 导出。

> 同时提供 [Hana Agent Skill 版本](https://github.com/Dragonzhi/itertrip-skill) 作为 Hana 生态的接入点。

## 2. 背景与问题

### 2.1 用户观察到的空白

市面上的旅行工具三件事永远凑不齐：

| 能力 | 现状 |
| --- | --- |
| 地图 + 位置标注 | 高德/腾讯开放平台，成熟 |
| AI 行程规划 | 携程问道、飞猪问一问、同程×DeepSeek，大厂混战 |
| 多平台酒店比价 | 去哪儿弱化、trivago 偏海外，**国内没有中立聚合** |

### 2.2 为什么没有三合一（数据墙）

国内 OTA 不开放酒店价格聚合 API，各家价格互相不透明，差价可达 3 倍（央视 2021 年报道过同酒店跨平台差价）。任何想中立比价的产品要么爬数据（违反 ToS、被封），要么绑自家库存（不中立，打自己脸）。大厂没有动机做中立比价。

### 2.3 破局思路

**把比价数据源交给用户。** 用户亲手把携程/美团/飞猪的报价贴给 AI，AI 负责整理、汇总、对比。数据来源合法、无平台倾向，还正好是 LLM 最擅长的「非结构化 → 结构化」场景。

## 3. 核心设计原则

1. **中立**：不绑任何 OTA，价格全部来自用户手动提供
2. **一次性**：当场决策工具，不做收藏夹、不做价格监控
3. **开箱即用**：零注册、零 API key 即可跑通（地图默认高德公共瓦片，OSM 兜底）
4. **单文件交付**：产物是一个自包含 HTML，可分享、可打印、手机电脑都能开
5. **双入口**：Web 应用为主力，Hana Agent Skill 为 Hana 生态接入点，共享同一套后端

## 4. 核心工作流

```
用户输入（目的地/天数/风格）
    ↓
① 前端 POST /api/plan → 后端 LLM 生成行程草稿
    ↓
② 坐标补全（LLM 知识 / web_search 兜底，低置信度标记）
    ↓
③ 价格注入（可选：用户手动提供 / RollingGo 搜索）
    ↓
④ 校验 schema → 返回 route JSON
    ↓
⑤ 前端渲染：地图 + 时间线 + 比价表
    ↓
⑥ 用户可在编辑器内调整（拖拽 / 编辑 / 新增 / 删除）
    ↓
⑦ 导出：自包含 HTML 或 JSON
```

**关键交互约束**：喂价一步必须「三步以内」完成，支持直接粘贴分享链接、贴价格截图、口述报价三种方式。

## 5. 技术选型

### 5.1 后端

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | **FastAPI** (Python 3.12+) | 异步支持好，自动生成 OpenAPI 文档，轻量 |
| LLM 调用 | **httpx** + 任意 LLM API | 不绑定供应商，兼容 DeepSeek / OpenAI / 本地模型 |
| 搜索 | **AnySearch** / Tavily 等 | 复用现有 API key |
| 部署 | **Railway** 或 **fly.io** | 免费额度够用，Serverless 友好 |

### 5.2 前端

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 框架 | **React 18** + Vite | 求职标配，轻量 |
| 地图 | **Leaflet** (react-leaflet) | 与现有模板一致，国内高德瓦片可用 |
| 样式 | **Tailwind CSS** | 轻量、实用、求职常见 |
| 部署 | **Cloudflare Pages** 或 **Vercel** | 免费，自动 CI/CD |

### 5.3 地图瓦片

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 地图库 | Leaflet 1.9.x | 42KB 轻量、开源、无需 key |
| 默认瓦片 | 高德公共栅格瓦片（webrd 端点） | 无需 key、国内加载快、中文标注 |
| 兜底瓦片 | OSM 标准 | 朴素，作 fallback |
| 可选瓦片 | 高德官方 JS API | 需用户自申请 key |
| ~~Carto Voyager~~ | ~~已弃用~~ | 2024 年起要求 API key 否则打水印 |
| CDN | jsDelivr（可换 BootCDN） | 稳定，国内备选已说明 |

## 6. 数据模型：route JSON（核心契约）

LLM 只负责生成结构化 JSON，HTML 统一由脚本渲染。JSON 是前后端之间的契约，也被设计成可被其他工具消费。

```json
{
  "trip": {
    "title": "成都 3 日游",
    "destination": "成都",
    "days": 3,
    "dates": "2026-09-01 ~ 2026-09-03",
    "budget": "中等",
    "style": "松弛探店",
    "travelers": "2 人"
  },
  "days": [
    {
      "day": 1,
      "theme": "市区文化线",
      "places": [
        {
          "name": "武侯祠",
          "lat": 30.648,
          "lng": 104.047,
          "type": "attraction",
          "time": "09:00-11:30",
          "transport": "地铁 3 号线",
          "ticket": "50 元",
          "note": "建议一早去避开旅行团"
        }
      ],
      "hotel": {
        "name": "XXX 酒店（春熙路店）",
        "lat": 30.657,
        "lng": 104.081,
        "note": "离地铁 200 米",
        "prices": [
          { "platform": "美团", "price": 328, "breakfast": false, "note": "无早" },
          { "platform": "携程", "price": 356, "breakfast": true, "note": "含双早" },
          { "platform": "飞猪", "price": 340, "breakfast": false, "note": "无早，可取消" }
        ]
      }
    }
  ]
}
```

字段约束：
- `place.type`：`attraction` / `food` / `transport` / `other`，决定地图图标
- `hotel.prices`：至少两家平台才参与比价；`breakfast` 布尔
- 坐标必须填，否则地图无法定位

## 7. 前端架构

### 7.1 页面流

```
首页 (Index) → 输入目的地/天数/风格 → 点击「开始规划」
    ↓
规划页 (Plan) → 地图 + 时间线展示 + 比价表
    ↓
编辑页 (Edit) → 拖拽排序 + 跨天移动 + 删除 + 新增地点 + 编辑 + 导出
```

### 7.2 组件树

```
App
├── Index（首页 · 输入表单）
├── Plan（规划结果页）
│   ├── MapView（Leaflet 地图封装）
│   ├── Timeline（时间线面板 · 双向联动）
│   └── HotelCard（比价表）
└── Edit（交互编辑页）
    ├── MapView（同上）
    ├── Timeline（同上 · 可拖拽）
    ├── Editor（拖拽排序 + 编辑表单）
    └── Toolbar（撤销/重做/导出）
```

### 7.3 布局与地图交互

这些设计继承自旧版 v0.5 模板，在 React 版本中延续：

- **全屏地图 + 右侧滑出面板**，桌面与移动统一
- 面板可收起/展开，点地图标记从右侧拉出对应详情
- 面板左边缘可拖拽手柄（`role=separator`，鼠标/触摸/键盘可达）
- 地图全屏铺底，面板是覆盖层，拖宽度不改地图容器，**故意不调用 `invalidateSize`**
- **图标规则**：emoji 优先（🏨 ⛰️ 🍜），缺失用 SVG 图钉兜底
- 酒店金色标记，景点按天着色
- 同天景点用**有向连线**串联，中点箭头标注方向
- 缩放级别限制 3–18

### 7.4 编辑器设计

编辑器功能参考旧版 v0.5 模板实现，移植为 React 组件：

- **拖拽重排 & 跨天移动**：HTML5 DnD 或 Sortable 库
- **撤销/重做**：快照模型历史栈，上限 50 帧
- **地图点选新增**：点击地图进入选点模式
- **编辑表单**：新增/编辑统一表单，含时间/交通/门票 `<datalist>` 预设
- **地图重选位置**：编辑表单中点击「更改位置」→ 选点模式 → 点击地图写回坐标
- **空修改检测**：保存前逐字段比对，无变化不进历史
- **导出**：自包含 HTML（调用后端 `POST /api/export`）/ JSON

### 7.5 视觉方向

旅行感配色，非通用蓝白后台风：
- 底色：暖米白 `#FAF6F0` / 卡片 `#FFFFFF`
- 主强调：深墨绿 `#1F6B54`
- 高亮（最低价 / 选中）：暖琥珀金 `#C8903C`
- 天数色板：珊瑚 `#E07A5F`、琥珀 `#E9B44C`、青绿 `#3D8B8A`、蓝紫 `#6D5B9E`、砖红 `#B85C5C`
- 字体：系统栈（`-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`）

## 8. 项目结构

```
itertrip/
├── backend/              # FastAPI 后端
│   ├── __init__.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── plan.py           # POST /api/plan
│   │   ├── geocode.py        # POST /api/geocode
│   │   ├── search.py         # POST /api/search
│   │   └── export.py         # POST /api/export
│   ├── engine/
│   │   ├── __init__.py
│   │   ├── planner.py        # LLM 行程规划
│   │   ├── coordinates.py    # 坐标补全与校验
│   │   ├── builder.py        # HTML 构建
│   │   └── schema.py         # route JSON 数据模型
│   ├── templates/
│   │   └── route_map.html    # 导出模板（复用旧版）
│   └── requirements.txt
├── frontend/               # React + Vite 前端
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Index.tsx     # 首页：输入需求
│   │   │   ├── Plan.tsx      # 规划结果
│   │   │   └── Edit.tsx      # 拖拽编辑
│   │   ├── components/
│   │   │   ├── MapView.tsx   # Leaflet 地图
│   │   │   ├── Timeline.tsx  # 时间线面板
│   │   │   ├── Editor.tsx    # 拖拽编辑
│   │   │   ├── HotelCard.tsx # 比价表
│   │   │   └── Toolbar.tsx   # 工具条
│   │   └── api/
│   │       └── client.ts     # API 调用封装
│   ├── package.json
│   └── vite.config.ts
├── DESIGN.md               # 本文件
├── WEB_APP_PLAN.md          # 转型规划文档
├── README.md                # 使用说明（中文）
├── README.en.md             # 使用说明（英文）
└── LICENSE                  # MIT
```

## 9. 边界（明确不做）

1. 不自动抓取任何平台价格（数据墙 + ToS）
2. 不做价格实时监控 / 收藏夹
3. 不做预订、支付、账号体系
4. 不依赖任何付费 API
5. 高德 key 为可选增强，缺省也能完整运行

## 10. 里程碑

- [x] M1：设计文档评审通过
- [x] M2：旧版自包含 HTML 模板跑通（已归档）
- [x] M3：SKILL.md 主指令编写（已归档至 skill 仓库）
- [x] M4：旧版编辑器 v0.5 完成（拖拽/撤销/编辑表单/地图点选/导出）
- [x] M5：真机实测 + 测试覆盖（jsdom 30 断言 + 探针 23/23）
- [x] M6：项目转型为 Web 应用架构（backend/ + frontend/ 骨架）
- [ ] M7：后端 Phase 1 — FastAPI 脚手架 + POST /api/plan 返回 route JSON
- [ ] M8：前端 Phase 2 — React 首页 + 规划页 + 地图渲染
- [ ] M9：前端 Phase 3 — 编辑器移植到 React
- [ ] M10：坐标补全 + 搜索 + 部署上线

## 11. 决策记录

### 布局与产品决策

1. 布局：全屏地图 + 侧滑面板（桌面移动统一）
2. 图标：emoji 优先，缺失用 SVG 兜底
3. 默认瓦片：高德公共栅格瓦片（OSM 兜底，官方高德 key 可选）
4. 打印 / PDF 导出：暂不做
5. 仓库名：**IterTrip**（拉丁语 iter「道路」）

### 架构决策

6. 前后端分离：FastAPI + React，同一套规划引擎服务 Web 和 Hana 两个入口
7. 编辑器历史栈：快照模型，上限 50 帧，变更后推入
8. 空修改检测：保存前逐字段比对，无变化不进历史
9. 导出基于纯净快照：模板渲染前捕获 outerHTML，正则替换 JSON 数据
10. 缩放下限锁定 3（Canvas 3D 地球方案已移除，原因见旧版 §7.6）

### 迁移注意事项

11. 旧版 `templates/route_map.html` 的 render()、routeArrowDeg、routeMidPoint、pinIcon 等逻辑直接移植为 React 组件
12. 旧版编辑器的状态机（formMode、editTarget、rePickTarget）和选点流程（startRepick → rePickTo）可作为 React 实现的参考
13. 酒店只读约束保持不变（酒店卡片不参与拖拽排序）
14. 触屏不支持 DnD（编辑/删除/新增/导出可用）
15. 行内（双击）编辑不做，统一走编辑表单