# 🧭 IterTrip · Web

> Latin *iter* — "road". The root of the word *itinerary*.
> **AI travel planning web application** (under development)

IterTrip is an AI-powered travel planning system. Tell the AI where you want to go, it plans the route, geocodes coordinates, and generates an interactive map. Supports drag-and-drop editing, hotel price comparison, and self-contained HTML export.

> 📢 **Hana Agent Skill edition**: visit [github.com/Dragonzhi/itertrip-skill](https://github.com/Dragonzhi/itertrip-skill)

[中文](./README.md) · [Planning doc](./WEB_APP_PLAN.md) · [Design doc](./DESIGN.md)

---

## Why it exists

Chinese OTA platforms (Ctrip / Meituan / Fliggy) do not expose any price-aggregation API, and the same hotel can differ in price by 3× across platforms — yet **no neutral price-comparison tool exists**. Incumbents won't build one (it undercuts their own inventory), and independent builders can't scrape legally.

IterTrip's answer: **let the user supply the prices.** You paste in what each platform quoted, the AI structures, compares and recommends. Legal, neutral, and impossible for the giants to copy.

## Current status

The project has transitioned from a single-file HTML app to a **client-server architecture** and is under active development:

| Component | Status | Description |
|-----------|--------|-------------|
| Backend (FastAPI) | 🟡 Skeleton | `backend/` directory ready, routes/engine pending |
| Frontend (React + Vite) | 🟡 Skeleton | `frontend/` directory ready, pages/components pending |
| Planning engine | ⏳ Pending | LLM planning → geocoding → HTML building |
| Interactive editor | 🔄 To port | v0.5 features to be ported to React |
| Self-contained HTML export | 🔄 Pending | Backend `POST /api/export` wrapper |

## Architecture overview

```
Browser (React)  ──►  API (FastAPI)  ──►  Planning engine
    │                                        │
    │                                        ▼
    └───────────────────  LLM + search + geocoding
```

See [WEB_APP_PLAN.md](./WEB_APP_PLAN.md) for the full roadmap.

## Map tiles

Defaults to the **AMap public raster tiles** (no key needed, fast in mainland China, Chinese labels, works out of the box). You can switch back to OSM standard anytime via the layer control in the map's top-left corner. To use the **official AMap Web JS API** (with your own key):

1. Register at [AMap Open Platform](https://lbs.amap.com/) and apply for a **Web JS API** key
2. Swap the tile source in `route_map.html` (see comments)
3. If CDN is slow, swap jsDelivr for BootCDN

## Zoom range

Zoom is clamped to **3–18**: AMap public tiles start at z3, and below that they are blank — so the floor is locked and the smallest level already shows a country-wide view.

## Layout

```
itertrip/
├── backend/              # FastAPI backend
│   ├── api/              # API routes (plan / geocode / search / export)
│   └── engine/           # Planning engine (planner / coordinates / builder)
├── frontend/             # React + Vite frontend
│   └── src/              # Pages & components
├── DESIGN.md             # Design document
├── WEB_APP_PLAN.md       # Transformation roadmap
├── README.md             # This file (Chinese)
├── README.en.md          # This file (English)
└── LICENSE               # MIT
```

## What it deliberately does NOT do

- No live price monitoring, no favorites, no booking, no accounts
- No scraping of any platform; no paid APIs
- Prices are time-sensitive — treat output as a *decide-now* tool, not a database

## License

[MIT](./LICENSE) © 2026 ZLOONG