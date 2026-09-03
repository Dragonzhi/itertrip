# 🧭 IterTrip

> 拉丁语 *iter*「道路」，Itinerary 行程单的词源。
> **把你从任何地方看到的旅游攻略，变成一张可以动手改、可以带走的地图。**

IterTrip 是一个独立的 AI 旅行攻略落地应用：把小红书/公众号/截图里的碎片攻略贴进对话框，
AI 提取成结构化路线，在地图上直观呈现；支持对话式修改与手动编辑（拖拽/跨天/改点/撤销），
一键导出自包含 HTML 随时随地打开。

[English](./README.en.md) · [设计文档](./DESIGN.md) · [部署指南](./DEPLOY.md)

## 为什么需要它

刷攻略的痛点从来不是「没有攻略」，而是**攻略落地**：十张图里藏着三个店名、两个「导航搜 XX 就行」，
你得边刷边收藏、开地图逐个搜、手动排顺序——最后发现动线是乱的。

IterTrip 只做这一步：**攻略 → 结构化路线 → 可编辑的地图**。不生产攻略，只做攻略的落地工具。

## 功能

- 🗺 **地图直观呈现**：按天色板图钉、有向路线（段中点箭头）、点击联动高亮
- 💬 **对话式规划**：说「想去成都 3 天」或直接贴一段攻略文字/截图
- ✋ **双轨修改**：对话改（「博物馆挪到第一天下午」）+ 手动改（拖拽排序/跨天移动/编辑表单/地图改点/撤销重做）
- 🏨 **酒店比价卡**：价格由用户手动提供（中立，不抓数据），最低价自动高亮
- 📦 **自包含导出**：可编辑 HTML 双击即开，分享即产品体验
- 🔑 **BYOK**：设置面板填自己的 LLM key（OpenAI 兼容格式），本地存储不出本机

## 快速开始

```powershell
# Windows：一条命令（首次自动构建前端 + 创建 venv）
powershell -ExecutionPolicy Bypass -File start.ps1
```

打开 http://127.0.0.1:8100 (子路径 /itertrip/ 部署，避开 8787 游戏 WS) → 设置里填入你的 LLM API key（OpenAI 兼容，推荐多模态模型）→ 开始对话。

无 key 也可用：内置 mock 路由器供体验完整流程。

## 技术栈

FastAPI（规划引擎 + 静态托管）· React 18 + Vite + Tailwind · Leaflet（高德公共瓦片，OSM 兜底）
· pydantic route JSON 契约 · 零账号零云依赖，本地优先

## 目录结构

```
itertrip/
├── backend/           # FastAPI：规划引擎 / geocode / 导出 / SPA 托管
│   ├── api/           # plan / geocode / search / export
│   ├── engine/        # planner / coordinates / builder / schema
│   └── templates/     # 自包含 HTML 导出模板
├── frontend/          # React + Vite + Tailwind
│   └── src/           # pages / components / hooks / mapCore
├── start.ps1          # 一键单进程启动（本地方案）
├── DESIGN.md          # 设计文档（定位/架构/路线图）
├── DEPLOY.md          # 部署指南（本地/云）
└── LICENSE            # MIT
```

## 边界

- 不做账号、不做云同步、不抓取任何平台价格
- 链接解析为 best-effort 可选能力；粘贴文字/截图是主路径
- 产出的路线可编辑、可导出——工具不锁定你的数据

## License

[MIT](./LICENSE) © 2026 ZLOONG