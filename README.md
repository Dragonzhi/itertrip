# 🧭 IterTrip

> 拉丁语 *iter*「道路」，Itinerary 行程单的词源。
> **AI 规划路线，用户喂价格，产出地图。**

一个开源的旅行规划 Agent Skill：告诉 AI 想去哪儿玩，它生成含景点、酒店、交通的行程，请你手动贴出各平台酒店报价，最终产出一份**可分享的 HTML 地图路线图**（Leaflet 地图 + 每日时间线 + 酒店比价表）。

[English](./README.en.md) · [设计文档](./DESIGN.md)

## 为什么需要它

国内 OTA（携程/美团/飞猪）不开放酒店价格聚合 API，同酒店跨平台差价可达 3 倍，但**没有任何中立比价工具**——大厂没动机做打自己脸的比价，独立产品爬数据又违反 ToS。

IterTrip 的解法：**价格数据交给用户**。用户亲手把各平台报价喂给 AI，AI 负责整理、汇总、比价。数据合法、结果中立、大厂抄不了。

## 快速上手

```bash
# 1. 准备一份行程 JSON（参照 examples/sample_itinerary.json）
# 2. 构建 HTML
python3 scripts/build_html.py examples/sample_itinerary.json my_trip.html
# 3. 双击打开 my_trip.html
```

## 作为 Agent Skill 安装

IterTrip 遵循通用 Agent Skill 格式（`SKILL.md` + frontmatter），主流 Agent 均可装载：

| 运行时 | 方式 |
| --- | --- |
| Claude Code | `claude add-skill <本目录>` |
| Cursor | 把本目录放进 `.cursor/skills/` |
| Codex | 把本目录放进 `~/.codex/skills/` |
| HanaAgent | 通过技能安装入口导入本目录 |

装载后直接说：**「帮我规划去成都 3 天的行程」**。

## 使用流程

```
① 告诉 AI 目的地 + 天数（预算/风格可选）
② AI 生成每日行程：景点 + 交通 + 酒店候选
③ AI 输出比价清单，你贴回各平台报价（链接/截图/口述皆可）
④ AI 整理成 route JSON，构建出 HTML 地图路线图
```

**喂价三选一**：粘贴分享链接 · 贴价格截图 · 口述「美团 328 无早」。

## 地图瓦片

默认用**高德公共栅格瓦片**（无需 key，国内加载快、中文标注，开箱即用），地图左上角图层面板可随时切回 OSM 标准。想用高德**官方 Web JS API**（带自己的 key）时：

1. 到 [高德开放平台](https://lbs.amap.com/) 注册，申请 **Web 端 JS API** key
2. 在 `templates/route_map.html` 里把瓦片源换成官方高德（注释处有指引）
3. 网络不佳时，也可把 Leaflet CDN 从 jsDelivr 换成 BootCDN

## 地图缩放

缩放级别限制在 **3–18**：高德公共瓦片从 z3 起提供内容，更小级别没有瓦片（会白屏），因此直接锁定下限，最小级别即可总览全国。
## 目录结构

```
itertrip/
├── SKILL.md              # Agent 主指令
├── templates/
│   └── route_map.html    # 地图路线图模板
├── scripts/
│   └── build_html.py     # JSON → HTML（纯标准库，零依赖）
├── examples/
│   ├── sample_itinerary.json   # 成都 3 日样本
│   └── sample_route.html       # 构建产物示例（点开即见效果）
├── DESIGN.md             # 设计文档
└── LICENSE               # MIT
```

## 边界

- 不做实时比价、收藏夹、预订、账号
- 不抓取任何平台价格，不依赖付费 API
- 价格有时效性，产出是「当场决策」工具，不是长期数据库

## License

[MIT](./LICENSE) © 2026 ZLOONG