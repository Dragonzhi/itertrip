# Desktop decision record

2026-10-05 update: user selected A after seeing the three rendered alternatives. This decision supersedes the warm visual direction below; the following evidence table is the historical M31 implementation record. Current visual rules are in DESIGN.md.

User quote: “A方案吧，看来确实路线和AI规划是主体，地图更适合作为辅助？”

Approved reference: research-2026-10/design-demos/a-itinerary.html and screenshots/a-itinerary-1440.png. Use a bright, wide itinerary reading flow with coral actions and a supporting map/detail area. The itinerary remains the durable primary surface; AI proposes and explains edits; the map supports spatial judgement, selection and navigation. AI does not require an always-open main column. Approval and remaining implementation boundaries: [direction-approved.md](research-2026-10/direction-approved.md).

Target: M31 desktop planning workspace. Audience: travellers checking and editing city itineraries before travel.

| Evidence | Confidence | Decision |
| --- | --- | --- |
| User: desktop is inconvenient and lacks design; planning page first; warm workspace selected | provided | Reorganize desktop planning, preserve warm theme |
| Plan.tsx: full-screen map, 380/400px covering drawers, floating toolbar, 74px compensation | observed (code) | Use a real grid and independent scrolling |
| Timeline/Schedule/Transport/Weather components: detailed information mixed into narrow itinerary | observed (code) | Compact first layer and contextual detail |
| Qwen official capabilities include Amap/Fliggy integration | observed (public description, not hands-on UI) | Do not claim planning/maps/weather are exclusive |
| New layout improves completion of editing tasks | inferred | Validate selection/edit/undo and readable time/transport |

| Reference | Keep | Change | Do not copy |
| --- | --- | --- | --- |
| Existing IterTrip | Palette, map day identity, undo, honest data | Hierarchy, desktop layout, entry points | Old overlay compensation |
| Qwen public description | Short path from intent to useful result | Emphasize inspectable user itinerary | Screenshots, logos, service/booking claims |
| User brief | Time, transport, weather and local adjustment | Make those first-class UI | Unverified superiority claims |

One direction: quiet warm paper and white, restrained moss actions, readable time-based itinerary beside a genuine map area. Context replaces clutter.

Risks: shared components can affect mobile; hidden AI/weather must retain state without duplicate mounts; map resizing and stale selected indexes can break interaction. Unknown: real-browser visual experience has not been observed during planning.

Quality gate: four desktop widths; no covered controls/overflow; known/partial/unknown states visible; keyboard selection and focus; route edits/undo preserved; mobile and offline regression; actual visual acceptance recorded separately from DOM testing.
