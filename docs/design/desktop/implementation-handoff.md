# M31 implementation handoff

## Current handoff: A 轻盈行程 (2026-10-05)

User chose A after reviewing three real rendered drafts. Use the updated DESIGN.md, [approval record](research-2026-10/direction-approved.md), and [A prototype](research-2026-10/design-demos/a-itinerary.html). The prior implementation notes below describe the already completed M31 structure, not the current visual target.

Develop the wide itinerary/document flow first: dates across the top, relevant weather and summary together, time-aligned visits with transportation between them. Give the itinerary about 58% at the reference desktop width; the rest supports a real map and selected-place details. AI is an explicit adjustment entry with retained conversation and confirmable previews. Keep results and unresolved issues visible in the itinerary. Test the narrower desktop layout before fixing its proportions.

Reuse Plan and M31 handlers, history, stable selection, navigation, forms, transport/weather logic and stale response protection. Keep a real Leaflet map; do not port the prototype's SVG relationship diagram or sample travel facts. Move presentation and visual hierarchy without duplicating business logic. Verify selection/edit/undo, AI visibility and cancellation, weather/transport unknown states, map resizing, four desktop widths, keyboard operation and existing mobile/offline regressions. No production code changed when recording this approval.

## Historical M31 implementation notes

Read Plan.tsx, MapView.tsx and existing Timeline/Schedule/Transport/Weather contracts. Keep business handlers in Plan; add desktop presentation components, scoped CSS, stable selection and controlled weather day. Desktop >=1024px; existing lower widths and export template retain their layout.

Use DESIGN.md tokens and grid. No online fonts, UI framework or competitor assets. First artifact example.html must demonstrate day switching and normal/unknown/appointment/rain/AI-preview scenarios. Actual implementation must expose edit/navigation/booking, selectable traffic, explicit undo/export, and a single auxiliary area. Hidden chat/weather must remain mounted. Add ResizeObserver cleanup; do not reset zoom on inspector toggle. No changes to route/API contracts.

Acceptance: verify selection after reorder/delete/undo, cross-day edits, stale async rejection, AI preview, weather day alignment, offline data and keyboard interactions. Run existing relevant integration/core/build checks. DOM evidence is not browser visual acceptance.
