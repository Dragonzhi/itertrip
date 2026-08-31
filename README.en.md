# 🧭 IterTrip · Web

> Latin *iter* — "road". The root of the word *itinerary*.
> **AI travel planning web application.**

IterTrip's **Web application edition** (under development). Tell the AI where you want to go, it plans the route, geocodes coordinates, and generates an interactive map. Supports drag-and-drop editing, hotel price comparison, and self-contained HTML export.

> 📢 **Hana Agent Skill edition**: visit [github.com/Dragonzhi/itertrip-skill](https://github.com/Dragonzhi/itertrip-skill)

[中文](./README.md) · [Planning doc](./WEB_APP_PLAN.md) · [Design doc](./DESIGN.md)

## Why it exists

Chinese OTA platforms (Ctrip / Meituan / Fliggy) do not expose any price-aggregation API, and the same hotel can differ in price by 3× across platforms — yet **no neutral price-comparison tool exists**. Incumbents won't build one (it undercuts their own inventory), and independent builders can't scrape legally.

IterTrip's answer: **let the user supply the prices.** You paste in what each platform quoted, the AI structures, compares and recommends. Legal, neutral, and impossible for the giants to copy.

## Quick start

```bash
# 1. Prepare a route JSON (see examples/sample_itinerary.json)
# 2. Build the HTML
python3 scripts/build_html.py examples/sample_itinerary.json my_trip.html
# 3. Double-click my_trip.html
```

## Install as an Agent Skill

IterTrip follows the standard Agent Skill format (`SKILL.md` + frontmatter), loadable by any mainstream agent:

| Runtime | How |
| --- | --- |
| Claude Code | `claude add-skill <this-dir>` |
| Cursor | put this dir into `.cursor/skills/` |
| Codex | put this dir into `~/.codex/skills/` |
| HanaAgent | import this dir via the skill installer |

Then just say: **"Plan me a 3-day trip to Chengdu."**

## Workflow

```
① Tell the agent destination + days (budget/style optional)
② Agent drafts the itinerary: sights + transit + hotel candidates
③ Agent lists the hotels — you paste back each platform's quote
   (share link / screenshot text / "Meituan ¥328, no breakfast")
④ Agent builds the route JSON → outputs the HTML route map
```

## Map tiles

Defaults to the **AMap public raster tiles** (no key needed, fast in mainland China, Chinese labels, works out of the box). You can switch back to OSM standard anytime via the layer control in the map's top-left corner. To use the **official AMap Web JS API** (with your own key):

1. Register at [AMap Open Platform](https://lbs.amap.com/) and apply for a **Web JS API** key
2. Swap the tile source in `templates/route_map.html` (see comments)
3. If CDN is slow, swap jsDelivr for BootCDN

## Zoom range

Zoom is clamped to **3–18**: AMap public tiles start at z3, and below that they are blank — so the floor is locked and the smallest level already shows a country-wide view.
## Layout

```
itertrip/
├── SKILL.md              # Agent instructions
├── templates/
│   └── route_map.html    # route-map template
├── scripts/
│   └── build_html.py     # JSON → HTML (stdlib only, zero deps)
├── examples/
│   ├── sample_itinerary.json   # Chengdu 3-day sample
│   └── sample_route.html       # built example (open to see)
├── DESIGN.md             # design doc
└── LICENSE               # MIT
```

## What it deliberately does NOT do

- No live price monitoring, no favorites, no booking, no accounts
- No scraping of any platform; no paid APIs
- Prices are time-sensitive — treat output as a *decide-now* tool, not a database

## License

[MIT](./LICENSE) © 2026 ZLOONG