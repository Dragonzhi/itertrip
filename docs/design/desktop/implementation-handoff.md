# M31 implementation handoff

Read Plan.tsx, MapView.tsx and existing Timeline/Schedule/Transport/Weather contracts. Keep business handlers in Plan; add desktop presentation components, scoped CSS, stable selection and controlled weather day. Desktop >=1024px; existing lower widths and export template retain their layout.

Use DESIGN.md tokens and grid. No online fonts, UI framework or competitor assets. First artifact example.html must demonstrate day switching and normal/unknown/appointment/rain/AI-preview scenarios. Actual implementation must expose edit/navigation/booking, selectable traffic, explicit undo/export, and a single auxiliary area. Hidden chat/weather must remain mounted. Add ResizeObserver cleanup; do not reset zoom on inspector toggle. No changes to route/API contracts.

Acceptance: verify selection after reorder/delete/undo, cross-day edits, stale async rejection, AI preview, weather day alignment, offline data and keyboard interactions. Run existing relevant integration/core/build checks. DOM evidence is not browser visual acceptance.
