/** Node-only contracts: URLs, coordinate guards, progress isolation and editing. */
import { navigation } from "./navigation.ts";
import { createTripSession, loadProgress, loadTripSession, saveProgress, visits } from "./outing.ts";
import type { RouteJSON } from "../types/route";
const assert = {
  equal(a: unknown, b: unknown, reason = "equality") { if (!Object.is(a, b)) throw new Error(reason + ": " + JSON.stringify([a, b])); },
  notEqual(a: unknown, b: unknown, reason = "inequality") { if (Object.is(a, b)) throw new Error(reason); },
  deepEqual(a: unknown, b: unknown, reason = "deep equality") { this.equal(JSON.stringify(a), JSON.stringify(b), reason); },
  ok(value: unknown) { if (!value) throw new Error("assertion failed"); },
};

const p = { name: "武侯祠 & 南门|东门,入口", lat: 30.6414, lng: 104.0499, source: "amap", confidence: "high" };
const previous = { ...p, name: "锦里", lng: 104.051 };
const amap = navigation.links(p, { previous });
let params = new URL(amap.primary).searchParams;
assert.equal(params.get("to"), "104.0499,30.6414,武侯祠 & 南门 东门 入口");
assert.equal(params.has("from"), false, "actual origin is never a planned stop");
assert.equal(new URL(amap.compare!).searchParams.get("from"), "104.051,30.6414,锦里");
assert.equal(new URL(amap.web).searchParams.get("callnative"), "0");
for (const source of ["city", "mock", "none"]) {
  const links = navigation.links({ ...p, source }, { confirmed: true, previous });
  assert.equal(links.kind, "search");
  assert.equal(new URL(links.primary).searchParams.has("to"), false);
  assert.equal(links.compare, null);
}
for (const coords of [{ lat: null }, { lat: 0 }, { lng: 0 }, { lat: NaN }, { lng: Infinity }, { lat: 104.05, lng: 30.6 }]) {
  assert.equal(navigation.links({ ...p, ...coords }, { confirmed: true }).kind, "search");
}
assert.equal(navigation.links({ ...p, source: "llm" }).kind, "search");
assert.equal(navigation.links({ ...p, source: "llm" }, { confirmed: true }).kind, "navigation");
assert.equal(navigation.links({ ...p, confidence: "low" }).kind, "search");
assert.equal(navigation.links({ ...p, note: "【坐标待确认】" }).kind, "search");
assert.equal(navigation.links(p, { previous: { ...p, source: "llm" } }).compare, null);
const bd = navigation.links(p, { provider: "baidu", mobile: true, ios: true, previous });
assert.equal(new URL(bd.primary).protocol, "baidumap:", "iOS route protocol follows the iOS URI examples");
const android = navigation.links(p, { provider: "baidu", mobile: true, ios: false, mode: "bus" });
assert.equal(new URL(android.primary).protocol, "bdapp:", "Android webpage uses the documented browser protocol");
assert.equal(new URL(android.primary).searchParams.get("mode"), "transit");
assert.equal(new URL(android.primary).searchParams.get("src"), "andr.itertrip.web");
params = new URL(bd.primary).searchParams;
assert.equal(params.get("coord_type"), "gcj02");
assert.equal(params.get("origin"), "我的位置");
assert.equal(params.get("destination"), "latlng:30.6414,104.0499|name:武侯祠 & 南门 东门 入口");
assert.equal(new URL(bd.web).searchParams.get("location"), "30.6414,104.0499");
assert.equal(new URL(bd.compare!).searchParams.get("origin"), "latlng:30.6414,104.051|name:锦里");
const hostile = '</script><img src=x onerror="alert(1)"> & #?';
assert.equal(new URL(navigation.links({ ...p, name: hostile }).primary).searchParams.get("to"), `104.0499,30.6414,${hostile}`);
assert.equal(new URL(navigation.links({ ...p, source: "city", name: hostile }).primary).searchParams.get("keyword"), hostile);

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k: string) => store.get(k) || null, setItem: (k: string, v: string) => store.set(k, v) } });
const route: RouteJSON = { trip: { title: "成都", destination: "成都", days: 2 }, days: [{ day: 1, places: [p, previous], hotel: p }, { day: 2, places: [], hotel: p }] };
const orig = JSON.stringify(route);
const all = visits(route);
assert.notEqual(all[2].id, all[3].id, "same hotel has independent stays");
assert.equal(visits({ ...route, days: [{ ...route.days[0], places: [previous, p] }, route.days[1]] })[1].id, all[0].id, "reorder preserves unique visit");
assert.notEqual(visits({ ...route, days: [{ day: 1, places: [{ ...p, lng: p.lng + 0.1 }] }] })[0].id, all[0].id, "moved point requires fresh progress");
const repeated = visits({ ...route, days: [{ day: 1, places: [p, p] }] });
assert.ok(repeated.every(v => v.repeated));
assert.notEqual(repeated[0].id, repeated[1].id, "repeated stops have independent progress");
assert.notEqual(repeated[0].id, visits({ ...route, days: [{ day: 1, places: [p, previous, p] }] })[0].id, "changed repeated visits need reconfirmation");
const session = createTripSession();
saveProgress(session, { day: 1, mode: "outing", completed: [all[0].id], arrived: [] });
assert.equal(loadTripSession(), session);
assert.equal(loadProgress(session).day, 1);
assert.deepEqual(loadProgress(session).completed, [all[0].id]);
assert.deepEqual(loadProgress(createTripSession()).completed, [], "new imported/generated route never inherits progress");
assert.equal(JSON.stringify(route), orig, "outing progress never mutates route data");
store.set("itertrip:outing:broken", "{bad"); assert.equal(loadProgress("broken").mode, "plan");
store.set("itertrip:outing:typed", JSON.stringify({ day: 1, completed: [true, "valid"] })); assert.deepEqual(loadProgress("typed").completed, ["valid"]);
Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("storage denied"); } });
assert.equal(saveProgress(session, { day: 0, mode: "plan", completed: [], arrived: [] }), false);
assert.equal(loadProgress(session).day, 0);
console.log("M25 navigation and outing contracts passed");
