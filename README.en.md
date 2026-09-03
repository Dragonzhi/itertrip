# 🧭 IterTrip

> Latin *iter* — "road". The root of the word *itinerary*.
> **Turn any travel guide you see into a map you can edit and take away.**

IterTrip is a standalone AI travel-guide landing app: paste a fragmented guide from Xiaohongshu / WeChat / a screenshot into the chat, the AI extracts a structured itinerary, the map renders it visually; edit it conversationally or by hand (drag / cross-day / re-pick / undo), and export a self-contained HTML that opens anywhere.

[中文](./README.md) · [Design doc](./DESIGN.md) · [Deploy guide](./DEPLOY.md)

## Why it exists

The pain of browsing travel guides is never "not enough guides" — it is **landing them**: three shop names buried in ten photos, two "just navigate to XX" hints. You bookmark while scrolling, search each spot on a map, order them by hand — and end up with a messy route.

IterTrip does exactly one thing: **guide → structured route → editable map**. It does not produce guides; it lands them.

## Features

- 🗺 **Visual map**: day-colored pins, directed routes with midpoint arrows, click-to-link highlighting
- 💬 **Conversational planning**: say "Chengdu, 3 days" or paste guide text / a screenshot
- ✋ **Dual-track editing**: conversational edits ("move the museum to day 1 afternoon") + hands-on editing (drag reorder / cross-day / edit form / map re-pick / undo-redo)
- 🏨 **Hotel price card**: prices supplied manually by the user (neutral, no scraping), lowest auto-highlighted
- 📦 **Self-contained export**: editable HTML that opens by double-click — sharing is the product experience
- 🔑 **BYOK**: bring your own LLM key (OpenAI-compatible), stored locally, never leaves your machine

## Quick start

```powershell
# Windows: one command (first run auto-builds the frontend + creates the venv)
powershell -ExecutionPolicy Bypass -File start.ps1
```

Open http://127.0.0.1:8100 (子路径 /itertrip/ 部署，避开 8787 游戏 WS) → fill in your LLM API key in Settings (OpenAI-compatible, multimodal recommended) → start chatting.

Works without a key: a built-in mock router lets you try the full flow.

## Stack

FastAPI (planning engine + static hosting) · React 18 + Vite + Tailwind · Leaflet (AMap public tiles, OSM fallback)
· pydantic route JSON contract · zero accounts, zero cloud dependency, local-first

## Layout

```
itertrip/
├── backend/           # FastAPI: planning engine / geocode / export / SPA hosting
│   ├── api/           # plan / geocode / search / export
│   ├── engine/        # planner / coordinates / builder / schema
│   └── templates/     # self-contained HTML export template
├── frontend/          # React + Vite + Tailwind
│   └── src/           # pages / components / hooks / mapCore
├── start.ps1          # one-click single-process launcher (local mode)
├── DESIGN.md          # design doc (positioning / architecture / roadmap)
├── DEPLOY.md          # deploy guide (local / cloud)
└── LICENSE            # MIT
```

## Boundaries

- No accounts, no cloud sync, no price scraping
- Link parsing is best-effort and optional; pasting text / screenshots is the main path
- Routes are editable and exportable — the tool never locks in your data

## License

[MIT](./LICENSE) © 2026 ZLOONG