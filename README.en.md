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
- 🏨 **Hotel price card**: prices supplied manually by the user (neutral, no scraping) — add or edit quotes right in "✎ Edit hotel", or store the results of "🔍 Search online quotes" with one click; lowest auto-highlighted
- 📦 **Export & import**: editable HTML opens by double-click — sharing is the product experience; JSON / exported HTML can be re-imported for further editing
- 🧠 **Travel memory (RAG, opt-in)**: extracted guides are chunked per entity into a memory store, so a later chat about the same destination gets answers that **cite your past guides**; coordinates you fix by hand on the map are remembered and reused directly (retrieval-augmented geocoding)
- 🧭 **Visible decisions** (M19): every AI turn expands into a "decision trace" — which model, whether past guides were hit, where each place's coordinate came from (AMap POI vs model guess), and which were replaced or snapped to the POI
- 📍 **Trustworthy, traceable coordinates** (M19): AMap POI is the primary geocoder and existing coordinates are actively verified (measured model drift 100m~1.2km gets snapped); timeline and map popups show a provenance badge (you confirmed / AMap verified / AI guess / city fallback), and the editor offers "re-locate by name"
- 🗺 **Places never land in another province** (M20): a candidate coordinate is used only if it falls inside the destination's province/city (or within 200 km of the city centre); verification is now "refine, never relocate", so same-name POIs elsewhere can no longer drag a correct coordinate away. Older itineraries can be fixed in one click with "🔍 Re-calibrate coordinates" (undoable)
- 🤖 **It fixes misplaced places by itself** (M21): every generation and edit compares each place against **the destination you asked for** — if it is 200 km+ away from where AMap says that place is, and moving it lands closer to your destination, it is corrected automatically and the decision trace says "clearly off the requested destination, moved back". Legitimate far-away stops (Zhangjiajie in a Changsha trip) are protected, and your hand-placed coordinates are never overwritten
- 🗓 **No more walking into a closed museum** (M22): when the itinerary itself says "closed on Mondays", the app now actually works out what weekday each day is — the start date is inferred from text like "National Day" (labelled **inferred** in the UI, one click on the calendar to correct), and a hit is flagged in red on the timeline and in the decision trace. With no date at all it says "not checked" rather than pretending it passed. Pure deterministic arithmetic: no model call, no network request
- 💾 **Chats survive reloads**: home and planner conversations (including decision traces) persist across refresh; the planner drawer can be cleared on its own
- 🔑 **BYOK + free tier**: bring your own key via the settings panel (OpenAI-compatible, stored locally); the server may also expose a free provider / admin panel (/admin, token-protected) so visitors get real AI with zero setup

## Quick start

```powershell
# Windows: one command (first run auto-builds the frontend + creates the venv)
powershell -ExecutionPolicy Bypass -File start.ps1

# Double-clickable: start.cmd (same thing + opens the browser)
# Frontend hot reload: start.ps1 -Dev (backend 8100 + vite 5173, one window each)
```

Open http://127.0.0.1:8100 (子路径 /itertrip/ 部署，避开 8787 游戏 WS) → fill in your LLM API key in Settings (OpenAI-compatible, **multimodal recommended for screenshots**) → start chatting.

Works without a key: configure `ITERTRIP_FREE_API_KEY` in the server `.env` (free provider, real AI); with neither, a built-in mock router demonstrates the full flow. Operators can manage the free provider at `/admin?admin_token=<value>`.

To enable travel memory (RAG): set `ITERTRIP_MEMORY_ENABLED=1` in `.env` and `pip install fastembed` (local embeddings; add `HF_ENDPOINT=https://hf-mirror.com` in mainland China). It is off by default — once on, guide text is stored in the server's `memory.sqlite`, isolated per anonymous profile and clearable from the settings panel.

Want more accurate coordinates: set `ITERTRIP_AMAP_KEY` (AMap Web Service key) in `.env`. With it, AMap POI becomes the primary geocoder and the coordinates the model returns are actively verified and snapped (measured drift 100m~1.2km); without it the app falls back to model knowledge + city centroids.

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
├── docs/              # milestone records (M19 trust / M20 region gating / M21 destination conflict / M22 closure days)
└── LICENSE            # MIT
```

## Boundaries

- No accounts, no cloud sync, no price scraping
- Link parsing is best-effort and optional; pasting text / screenshots is the main path
- Routes are editable and exportable — the tool never locks in your data

## License

[MIT](./LICENSE) © 2026 ZLOONG