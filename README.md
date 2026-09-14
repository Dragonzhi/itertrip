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
- 💬 **对话式规划**：说「想去成都 3 天」，贴攻略文字，或**直接丢截图**（VLM 看图直出路线，≤4 张）
- ❓ **澄清式问答**：信息不足时 AI 主动提问（日期日历/预算单选/偏好多选），答完自动生成
- ✋ **双轨修改**：对话改（「博物馆挪到第一天下午」）+ 手动改（拖拽排序/跨天移动/编辑表单/地图改点/撤销重做）
- 🏨 **酒店比价卡**：价格由用户手动提供（中立，不抓数据），最低价自动高亮
- 📦 **导出与导入**：可编辑 HTML 双击即开，分享即产品体验；JSON / 导出 HTML 均可再导入继续编辑
- 🧠 **旅行记忆（RAG，可选开启）**：提取过的攻略按实体级切分入库，下次聊到同一目的地 AI 会**引用旧攻略**回答；你在地图上手动改过的坐标会被记住，后续同名地点直接定位（检索增强 geocode）
- 🧭 **决策过程可见**（M19）：AI 每轮都摊开「决策过程」——用了哪个模型、有没有命中旧攻略、每个地点的坐标来自高德 POI 还是模型推测、哪几个被替换/对齐
- 📍 **坐标可信 + 可溯源**（M19）：高德 POI 为一级坐标源并主动核验（实测模型坐标普遍偏 100m~1.2km，会被对齐）；时间线/地图气泡标注来源徽标（你确认过 / 高德核验 / AI 推测 / 城市中心），编辑器可「按名称重新定位」
- 🗺 **地点不会跑到别的省**（M20）：候选坐标必须先落在目的地的省市范围（或距城市中心 200km）内才被采用；核验收紧为「精修不搬家」，跨城同名 POI 不再把正确坐标带偏；老行程可一键「🔍 校准坐标」重校准（可撤销）
- 💾 **对话不再丢**：首页与规划页的对话（含决策轨迹）刷新后仍在，规划页抽屉可单独清空
- 🔑 **BYOK + 免费源**：设置面板填自己的 key（OpenAI 兼容，本地存储）；服务器也可配置免费源/管理后台（/admin，token 保护），访客零配置用真实 AI

## 快速开始

```powershell
# Windows：一条命令（首次自动构建前端 + 创建 venv）
powershell -ExecutionPolicy Bypass -File start.ps1
```

打开 http://127.0.0.1:8100 (子路径 /itertrip/ 部署，避开 8787 游戏 WS) → 设置里填入你的 LLM API key（OpenAI 兼容，**推荐多模态模型以支持截图**）→ 开始对话。

无 key 也可用：服务器 `.env` 配好 `ITERTRIP_FREE_API_KEY`（免费源，真实 AI）；都没配时走内置 mock 路由器体验完整流程。运维可用 `/admin?admin_token=<值>` 在线管理免费源配置。

想开启旅行记忆（RAG）：`.env` 设 `ITERTRIP_MEMORY_ENABLED=1` 并 `pip install fastembed`（本地 embedding，国内加 `HF_ENDPOINT=https://hf-mirror.com`）。默认关闭——开启后攻略原文会存进服务器 `memory.sqlite`（按匿名档案隔离，设置面板可一键清空）。

想要更准的坐标：`.env` 配 `ITERTRIP_AMAP_KEY`（高德 Web 服务 key）。配了之后高德 POI 成为一级坐标源，AI 给出的坐标会被主动核验并对齐（实测模型坐标普遍偏 100m~1.2km）；不配也能用，只是回到「模型知识 + 城市兜底」。

## 技术栈

FastAPI（规划引擎 + 静态托管）· React 18 + Vite + Tailwind · Leaflet（高德公共瓦片，OSM 兜底）
· pydantic route JSON 契约 · SQLite + 本地 embedding（记忆库，可选）
· 零账号零云依赖，本地优先

## 目录结构

```
itertrip/
├── backend/           # FastAPI：对话/规划/geocode/导出/后台/记忆 + SPA 托管
│   ├── api/           # chat(SSE) / plan / geocode / search / export / llm / admin / memory
│   ├── engine/        # planner / coordinates / builder / schema / admin_config
│   │                  # memory_store / memory_embed / memory_ingest（M18 记忆库）
│   └── templates/     # 自包含 HTML 导出模板
├── frontend/          # React + Vite + Tailwind
│   └── src/           # pages(Admin) / components / hooks / lib / mapCore
├── start.ps1          # 一键单进程启动（本地方案）
├── DESIGN.md          # 设计文档（定位/架构/路线图）
├── AGENTS.md          # AI 代理架构指南（代理协作/协议/配置详表）
├── DEPLOY.md          # 部署指南（本地/云）
├── M19_TRUST_PLAN.md  # M19 实施记录（坐标可信度 / 决策轨迹 / 对话留存）
├── M20_GEO_REGION_PLAN.md # M20 实施记录（坐标区域校验 / 整条重校准）
└── LICENSE            # MIT
```


## 边界

- 不做账号、不做云同步、不抓取任何平台价格
- 链接解析为 best-effort 可选能力；粘贴文字/截图是主路径
- 产出的路线可编辑、可导出——工具不锁定你的数据

## License

[MIT](./LICENSE) © 2026 ZLOONG