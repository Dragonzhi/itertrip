---
name: itertrip
description: 旅行规划助手。用户告诉你想去哪儿、玩几天，生成包含景点/酒店/交通的行程规划，请用户手动提供各平台酒店报价做比价，最终产出一份可分享的 HTML 地图路线图（Leaflet + 比价表）。触发词：帮我规划行程、想去 XX 玩、做一份旅行攻略、旅游规划、帮我排路线、itertrip。
version: 1.0.0
license: MIT
---

# IterTrip · 旅行规划助手

IterTrip（拉丁语 *iter*「道路」，Itinerary 行程单的词源）是一个旅行规划 Agent Skill：
**AI 规划路线，用户喂价格，产出地图。**

核心设计：国内 OTA 不开放酒店价格聚合 API，任何自动抓价都违反 ToS。因此本 skill **不抓取任何平台价格**，由用户手动把各平台报价提供给 AI，AI 负责整理、汇总、比价。数据来源合法、结果中立。

## 何时使用

- 用户说「帮我规划去 XX 的行程」「想去 XX 玩 N 天」「做一份旅行攻略」
- 用户提供目的地 + 天数（可能附带预算/日期/风格）
- 不适用于：实时比价监控、长期收藏、自动预订系统（但可提供预订跳转链接）

## 工作流

### 第 1 步：收集信息
向用户确认（能问多少问多少，缺的用默认值兜底）：
- **目的地**（必填）
- **天数**（必填）
- 出行日期（默认最近一个可行周末/连休）
- 预算档位：经济 / 中等 / 舒适
- 旅行风格：人文 / 美食 / 自然 / 松弛 / 特种兵
- 同行人数

### 第 2 步：生成行程初稿
按天数生成每日安排，每天包含：
- 2~4 个景点（合理的地理邻近顺序，避免折返）
- 每个景点：名称、**真实坐标**、类型、建议时间段、交通方式、门票、一句备注
- 每个住宿日：1 家候选酒店（含坐标），三天尽量不换酒店
- 用 web_search 查证：开放时间、门票价格、当季天气，不要凭记忆编造

### 第 3 步：获取酒店价格（双分支）

**优先自动**：若宿主 Agent 挂着 RollingGo MCP（有 `searchHotels` 工具），直接调用查实时价，填入 JSON，标注来源 `RollingGo`，并写入 `bookingUrl`。

**退回手动**：没有 RollingGo MCP 时，输出「比价清单」，明确请求用户提供各平台酒店报价。接受三种形式：
1. 直接粘贴平台分享链接
2. 贴价格截图/文字（如「美团 328 无早」）
3. 口述平台+价格

用户给多少收多少，**不要替用户编造价格**。至少两家平台才开始比价，只有一家就在表格里照实展示。

### 第 4 步：整理为 route JSON
把全部信息整理成标准 route JSON（schema 见下），字段缺省用 null，**坐标必须真实**。

**自动查价来源**：若宿主 Agent 挂着 RollingGo MCP（有 `searchHotels` / `getHotelDetail` 工具），对每个候选酒店调用它取实时价格与 `bookingUrl`，填入 `hotel.prices`（platform 填 `RollingGo`，price 用 `lowestPrice`）与 `hotel.bookingUrl`。拿不到就保留用户手动喂的报价。

### 第 5 步：生成 HTML
运行构建脚本：

```bash
python3 scripts/build_html.py <route.json> <输出.html>
```

把生成的 HTML 路径交给用户（或直接打开）。

### 第 6 步：附 AI 综合建议
行程末尾附 3~5 条综合建议（用 `summary` 字段）：预算预估、酒店选择理由、节奏提醒、预订注意事项。

## route JSON Schema

```json
{
  "trip": {
    "title": "成都 3 日慢游",
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
        "name": "全季酒店（成都春熙路店）",
        "lat": 30.657,
        "lng": 104.081,
        "note": "离地铁 200 米",
        "bookingUrl": "https://rollinggo.cn/...",
        "prices": [
          { "platform": "美团", "price": 328, "breakfast": false, "note": "无早" },
          { "platform": "携程", "price": 356, "breakfast": true, "note": "含双早" }
        ],
        "verdict": "三天住这家不换，美团最便宜。"
      }
    }
  ],
  "summary": [
    "预算预估：交通约 180 元/人，门票 185 元/人。",
    "酒店选春熙路是枢纽最优解。"
  ]
}
```

### 字段约束

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `trip.title` | 是 | 行程名称 |
| `trip.destination` | 是 | 目的地 |
| `place.name` | 是 | 景点名 |
| `place.lat` / `place.lng` | 是 | **真实坐标**，缺了构建会失败 |
| `place.type` | 是 | `attraction` / `food` / `transport` / `other` |
| `hotel.prices` | 否 | 数组，每项 `platform` + `price`(数字) + `breakfast`(布尔) + `note` |
| `hotel.bookingUrl` | 否 | 预订链接（如 RollingGo），有则渲染「去预订」按钮 |
| `summary` | 否 | AI 建议字符串数组 |

### type → emoji 映射
`attraction` → ⛰️，`food` → 🍜，`transport` → 🚇，`other` → 📍（模板内已配置，无需手填）

## 输出规范

- 产物是**单个自包含 HTML**，内含全部样式与数据，Leaflet 走 CDN，双击即开
- 地图默认高德公共瓦片（免费无 key，国内加载快、中文标注），左上角图层面板可切换 OSM 标准；缩放级别锁定 3–18
- 当日路线为有向连线：每段中点箭头标注行进方向；激活某天景点时该日线播放流动动画
- 比价表最低价自动高亮 + 打「最低」标签
- 桌面端右侧滑出行程面板（默认展开）；移动端默认收起、点「☰ 行程」展开，地图缩放/瓦片控件固定左上角标题栏下方
- 面板左边缘可横向拖拽调整宽度（280px 起，最宽不超过视口减 96px 控件带），拖窄即露出更多地图；宽度本地记忆、键盘可微调
- **产物即编辑器**：面板底部工具条支持拖拽排序/跨天移动地点（桌面 HTML5 DnD）、删除地点、地图选点新增（crosshair 模式 + 内联表单，含时间/交通/门票字段与 datalist 常用值预设）、撤销/重做（Ctrl+Z / Ctrl+Shift+Z，上限 50 步）、导出编辑后 route JSON 与自包含 HTML；每条地点悬停显现编辑按钮（✎），可改全部字段并「更改位置」重新选点，空修改不进历史；酒店卡片只读，不参与拖拽/删除
- 缺省无需任何 API key，开箱即用；如想用高德官方 JS API，见 README「地图瓦片」

## 自检

产物构建后跑 `scripts/test_render.js`（jsdom + mock Leaflet：抓运行时错误 + 渲染断言 + 箭头角度非循环比对）：

```powershell
python scripts\build_html.py <route.json> test-artifacts\sample_route.html
$env:NODE_PATH="<jsdom 的 node_modules 路径>"; node scripts\test_render.js
```

测试产物统一放 `test-artifacts/`（已 gitignore 的本地临时目录，可随时删掉重建）。`examples/sample_route.html` 是已提交的展示示例，不要当测试输出覆盖。

编辑器改动额外跑真实浏览器探针（puppeteer-core + 本机 Edge，jsdom 不抛监听器内异常，选点/导出回载必须在真浏览器验证）：

```powershell
$env:NODE_PATH="<puppeteer-core 的 node_modules 路径>"; node <探针>.cjs   # 桌面 1400x900 全流程 + 375x812 移动端
```

探针覆盖：同天/跨天拖拽（合成 DragEvent）、折叠状态保持、删除+撤销重做（按钮与键盘）、选点新增全流程、编辑表单预填/保存/更改位置（repick 选点）、空修改不进历史、导出 JSON（JSON.parse 校验）、导出 HTML 回载（编辑数据在、零脚本错误）、移动端编辑按钮常显、面板拖宽与比价回归。
## 边界与红线

1. **禁止**自动抓取任何平台价格（数据墙 + 违反 ToS）
2. **禁止**编造酒店价格，用户没提供的就空着
3. **禁止**编造景点坐标，不确定就先 web_search 查证
4. 不做预订、支付、账号体系
5. 不依赖任何付费 API

## 故障排查

- 构建报「缺少坐标」：某景点 lat/lng 没填，查真实坐标补上
- HTML 打不开地图：检查网络（Leaflet CDN 需联网），或换 BootCDN 源
- 地图空白但面板正常：瓦片源被墙，左上角图层面板切换 OSM 标准