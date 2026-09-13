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
- 💬 **Conversational planning**: say "Chengdu, 3 days", paste guide text, or **drop screenshots** (VLM reads images straight into a route, up to 4)
- ❓ **Clarifying questions**: when info is missing the AI asks first (date picker / budget choice / preference multi-select), then generates
- ✋ **Dual-track editing**: conversational edits ("move the museum to day 1 afternoon") + hands-on editing (drag reorder / cross-day / edit form / map re-pick / undo-redo)
- 🏨 **Hotel price card**: prices supplied manually by the user (neutral, no scraping), lowest auto-highlighted
- 📦 **Export & import**: editable HTML opens by double-click — sharing is the product experience; JSON / exported HTML can be re-imported for further editing
- 🧠 **Travel memory (RAG, opt-in)**: extracted guides are chunked per entity into a memory store, so a later chat about the same destination gets answers that **cite your past guides**; coordinates you fix by hand on the map are remembered and reused directly (retrieval-augmented geocoding)
- 🔑 **BYOK + free tier**: bring your own key via the settings panel (OpenAI-compatible, stored locally); the server may also expose a free provider / admin panel (/admin, token-protected) so visitors get real AI with zero setup

## Quick start

```powershell
# Windows: one command (first run auto-builds the frontend + creates the venv)
powershell -ExecutionPolicy Bypass -File start.ps1
```

Open http://127.0.0.1:8100 (子路径 /itertrip/ 部署，避开 8787 游戏 WS) → fill in your LLM API key in Settings (OpenAI-compatible, **multimodal recommended for screenshots**) → start chatting.

Works without a key: configure `ITERTRIP_FREE_API_KEY` in the server `.env` (free provider, real AI); with neither, a built-in mock router demonstrates the full flow. Operators can manage the free provider at `/admin?admin_token=<value>`.

To enable travel memory (RAG): set `ITERTRIP_MEMORY_ENABLED=1` in `.env` and `pip install fastembed` (local embeddings; add `HF_ENDPOINT=https://hf-mirror.com` in mainland China). It is off by default — once on, guide text is stored in the server's `memory.sqlite`, isolated per anonymous profile and clearable from the settings panel.

## Stack

FastAPI (planning engine + static hosting) · React 18 + Vite + Tailwind · Leaflet (AMap public tiles, OSM fallback)
· pydantic route JSON contract · SQLite + local embeddings (optional memory store)
· zero accounts, zero cloud dependency, local-first

## Layout

```
itertrip/
├── backend/           # FastAPI: chat / planning / geocode / export / admin / memory + SPA hosting
│   ├── api/           # chat(SSE) / plan / geocode / search / export / llm / admin / memory
│   ├── engine/        # planner / coordinates / builder / schema / admin_config
│   │                  # memory_store / memory_embed / memory_ingest (M18 memory store)
│   └── templates/     # self-contained HTML export template
├── frontend/          # React + Vite + Tailwind
│   └── src/           # pages(Admin) / components / hooks / lib / mapCore
├── start.ps1          # one-click single-process launcher (local mode)
├── DESIGN.md          # design doc (positioning / architecture / roadmap)
├── AGENTS.md          # AI-agent architecture guide (agents / protocols / config)
├── DEPLOY.md          # deploy guide (local / cloud)
├── M18_MEMORY_PLAN.md # travel memory (RAG) implementation plan
└── LICENSE            # MIT
```

## Boundaries

- No accounts, no cloud sync, no price scraping
- Link parsing is best-effort and optional; pasting text / screenshots is the main path
- Routes are editable and exportable — the tool never locks in your data

## License

[MIT](./LICENSE) © 2026 ZLOONG