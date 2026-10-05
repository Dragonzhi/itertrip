# Desktop decision record

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
