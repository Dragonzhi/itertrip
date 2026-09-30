import "../../../shared/navigation.js";
export type NavPoint = { name: string; lat?: number | null; lng?: number | null; source?: string; confidence?: string; note?: string };
export type MapProvider = "amap" | "baidu";
export type TravelMode = "walk" | "car" | "bus";
type Options = { provider?: MapProvider; city?: string; mode?: TravelMode; confirmed?: boolean; previous?: NavPoint; mobile?: boolean; ios?: boolean };
type Links = { primary: string; web: string; search: string; compare: string | null; kind: "navigation" | "search" };
export const navigation = (globalThis as unknown as { IterTripNavigation: {
  validPoint(p?: NavPoint): boolean;
  risk(p?: NavPoint): "trusted" | "confirm" | "search";
  links(p: NavPoint, options?: Options): Links;
} }).IterTripNavigation;
export function loadMapProvider(): MapProvider {
  try { return localStorage.getItem("itertrip:navigation-map") === "baidu" ? "baidu" : "amap"; }
  catch { return "amap"; }
}
export function saveMapProvider(provider: MapProvider) {
  try { localStorage.setItem("itertrip:navigation-map", provider); } catch { /* session preference still works */ }
}
