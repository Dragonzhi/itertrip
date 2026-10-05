# M31 Desktop Design

## 1. Visual Theme & Atmosphere
Warm travel workspace. The itinerary, rather than system status, leads the page. Desktop planning only (>=1024px).

## 2. Color
Paper #FAF6F0; ink #2B2B28; muted #6B6B64; moss #1F6B54; pale moss #E3EFE8; gold #C8903C; line #E8E0D4; danger #9C4038. White surfaces distinguish the itinerary and inspector. Day colors remain map identifiers.

## 3. Typography
Local system/CJK fonts, no network fonts. Body 14px, supporting text >=12px, title 20px, day title 18px. Times use tabular numerals. Long names wrap in content; toolbar titles truncate with full title available.

## 4. Spacing & Grid
4px base; 8/12/16/24px spacing. Toolbar 80px. >=1280px: 360px itinerary, flexible map, optional 320px inspector. 1024–1279px: 320px itinerary/inspector shared column plus map. Independent scrolling, no body overflow. At <1024px use existing layout.

## 5. Layout & Composition
Toolbar: home/title/date, undo/redo, AI, export, more. Left: day selector, schedule/transport/weather summary, visits with connecting travel rows, add. Map owns its actual rectangle. Inspector: selected place/hotel/leg, AI, weather, map settings, offline management. Only one auxiliary surface visible at a time.

## 6. Components
Primary moss button, bordered secondary button, quiet icon action with text/title. Itinerary rows show arrival/departure/duration and urgent conflicts. Unknown and partial figures explicitly labelled. Detail shows full sources, facts, notes, hotel prices and explicit edit/booking/navigation/focus actions. Use simple inline SVGs for workspace actions. Preserve existing modal validation and reusable business components.

## 7. Motion & Interaction
Single click selects, double click focuses map. Day selection highlights/fits corresponding map day. Panel resizing invalidates map size without resetting zoom. Selection uses stable visit/edge IDs. Switching inspector views retains chat and weather state. Edits share existing undo; UI changes do not create history. Keyboard-visible focus; reduced motion supported. Native drag plus keyboard-accessible move/cross-day controls.

## 8. Voice & Brand
Concrete labels: 当天行程、让 AI 调整、交通耗时未知、查看依据. Confidence reflects existing calculations, not visual optimism. Competitor references guide capability expectations, not copied visual assets.

## 9. Anti-patterns
No full-screen map behind two covering desktop drawers. No edge-arrow-only AI entry. No offline setup or long weather configuration before the first visit. No automatic traffic query on selecting a row. No fake zero for unknown costs/time. No gradients, glass surfaces, decorative hero photography, animated prices, third-party UI framework or downloaded fonts.
