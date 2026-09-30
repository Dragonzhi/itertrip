import type { RouteJSON } from "../types/route";

export interface OutingProgress { day: number; mode: "plan" | "outing"; completed: string[]; arrived: string[] }
export const EMPTY_PROGRESS: OutingProgress = { day: 0, mode: "plan", completed: [], arrived: [] };
export function createTripSession(): string {
  // LAN HTTP previews may lack randomUUID (secure contexts only); this is a local identity, not a credential.
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem("itertrip:trip-session", id); } catch { /* session only */ }
  return id;
}
export function loadTripSession(): string {
  try { const id = localStorage.getItem("itertrip:trip-session"); if (id && /^[\w-]{1,80}$/.test(id)) return id; } catch { /* session only */ }
  return createTripSession();
}
export function loadProgress(session: string): OutingProgress {
  try {
    const p = JSON.parse(localStorage.getItem("itertrip:outing:" + session) || "null");
    if (p && Number.isInteger(p.day) && p.day >= 0) return {
      day: p.day, mode: p.mode === "outing" ? "outing" : "plan",
      completed: Array.isArray(p.completed) ? p.completed.filter((x: unknown) => typeof x === "string") : [],
      arrived: Array.isArray(p.arrived) ? p.arrived.filter((x: unknown) => typeof x === "string") : [],
    };
  } catch { /* corrupt/disabled storage */ }
  return { ...EMPTY_PROGRESS, completed: [], arrived: [] };
}
export function saveProgress(session: string, p: OutingProgress): boolean {
  try {
    localStorage.setItem("itertrip:trip-session", session);
    localStorage.setItem("itertrip:outing:" + session, JSON.stringify(p));
    return true;
  } catch { return false; }
}
/** Moving a unique place preserves progress. Changing its name/point requires a fresh confirmation.
 * Repeated visits use occurrence + itinerary context. Structural/time edits invalidate their progress,
 * rather than guessing which indistinguishable occurrence moved. M26 IDs distinguish repeated visits. */
export function visits(route: RouteJSON) {
  const raw = route.days.flatMap((d, di) => [
    ...d.places.map((point, pi) => ({ point, di, key: `d${di}-p${pi}`, hotel: false })),
    ...(d.hotel?.name ? [{ point: d.hotel, di, key: `d${di}-hotel`, hotel: true }] : []),
  ]);
  const base = (v: typeof raw[number]) => JSON.stringify([v.hotel, v.point.name, v.point.lat, v.point.lng]);
  const counts = new Map<string, number>();
  raw.forEach(v => { const id = base(v); counts.set(id, (counts.get(id) || 0) + 1); });
  const context = JSON.stringify(raw.map(v => [v.di, base(v), "time" in v.point ? v.point.time : ""]));
  return raw.map(v => {
    const repeated = !v.hotel && (counts.get(base(v)) || 0) > 1;
    const legacyId = v.hotel ? base(v) + ":day:" + v.di : repeated ? base(v) + ":visit:" + v.key + ":context:" + context : base(v);
    return { ...v, repeated: repeated && !v.point.id, legacyId, id: v.point.id ? base(v) + ':id:' + v.point.id : legacyId };
  });
}
export type Visit = ReturnType<typeof visits>[number];
