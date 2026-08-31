# 🧭 IterTrip · Web

> 拉丁语 *iter*「道路」，Itinerary 行程单的词源。
> **AI 旅行规划 Web 应用**（开发中）

IterTrip 是一个 AI 驱动的旅行规划系统。输入目的地，系统自动规划路线、补全坐标、生成可交互地图。支持拖拽编辑、酒店比价、自包含 HTML 导出。

> 📢 **Hana Agent Skill 版本**：请访问 [github.com/Dragonzhi/itertrip-skill](https://github.com/Dragonzhi/itertrip-skill)

[English](./README.en.md) · [规划文档](./WEB_APP_PLAN.md) · [设计文档](./DESIGN.md)

---

## 为什么需要它

国内 OTA（携程/美团/飞猪）不开放酒店价格聚合 API，同酒店跨平台差价可达 3 倍，但**没有任何中立比价工具**——大厂没动机做打自己脸的比价，独立产品爬数据又违反 ToS。

IterTrip 的解法：**价格数据交给用户**。用户亲手把各平台报价喂给 AI，AI 负责整理、汇总、比价。数据合法、结果中立、大厂抄不了。

## 当前状态

项目已从自包含 HTML 单文件转型为**前后端分离架构**，处于积极开发中：

| 组件 | 状态 | 说明 |
|------|------|------|
| 后端（FastAPI） | 🟡 骨架 | `backend/` 目录已就绪，路由/引擎待实现 |
| 前端（React + Vite） | 🟡 骨架 | `frontend/` 目录已就绪，页面/组件待实现 |
| 规划引擎 | ⏳ 待实现 | LLM 规划 → 坐标补全 → HTML 构建 |
| 交互编辑器 | 🔄 待移植 | 旧版 v0.5 功能将移植到 React 版本 |
| 自包含 HTML 导出 | 🔄 待实现 | 后端 `POST /api/export` 封装 |

## 架构概览

```
浏览器 (React)  ──►  API (FastAPI)  ──►  规划引擎
    │                                        │
    │                                        ▼
    └───────────────────  LLM + 搜索 + 坐标补全
```

详细规划见 [WEB_APP_PLAN.md](./WEB_APP_PLAN.md)。

## 地图瓦片

默认用**高德公共栅格瓦片**（无需 key，国内加载快、中文标注，开箱即用），地图左上角图层面板可随时切回 OSM 标准。想用高德**官方 Web JS API**（带自己的 key）时：

1. 到 [高德开放平台](https://lbs.amap.com/) 注册，申请 **Web 端 JS API** key
2. 在 `route_map.html` 模板里把瓦片源换成官方高德（注释处有指引）
3. 网络不佳时，也可把 Leaflet CDN 从 jsDelivr 换成 BootCDN

## 地图缩放

缩放级别限制在 **3–18**：高德公共瓦片从 z3 起提供内容，更小级别没有瓦片（会白屏），因此直接锁定下限，最小级别即可总览全国。

## 目录结构

```
itertrip/
├── backend/              # FastAPI 后端
│   ├── api/              # API 路由（plan / geocode / search / export）
│   └── engine/           # 规划引擎（planner / coordinates / builder）
├── frontend/             # React + Vite 前端
│   └── src/              # 页面与组件
├── DESIGN.md             # 设计文档
├── WEB_APP_PLAN.md       # 转型规划文档
├── README.md             # 本文件
├── README.en.md          # English README
└── LICENSE               # MIT
```

## 边界

- 不做实时比价、收藏夹、预订、账号
- 不抓取任何平台价格，不依赖付费 API
- 价格有时效性，产出是「当场决策」工具，不是长期数据库

## License

[MIT](./LICENSE) © 2026 ZLOONG