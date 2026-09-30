/* Shared by the React app and the standalone HTML export. Route coordinates are GCJ-02. */
(function (root) {
  "use strict";
  function validPoint(p) {
    return !!p && typeof p.lat === "number" && typeof p.lng === "number" &&
      Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 &&
      Math.abs(p.lng) <= 180 && p.lat !== 0 && p.lng !== 0;
  }
  function risk(p) {
    if (!validPoint(p)) return "search";
    if (["city", "mock", "none"].includes(p.source) || /mock 占位/.test(p.note || "")) return "search";
    if (p.confidence === "low" || /坐标待确认/.test(p.note || "")) return "confirm";
    return ["user", "memory"].includes(p.source) || (p.source === "amap" && p.confidence === "high") ? "trusted" : "confirm";
  }
  function url(base, params) {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") q.set(k, String(v)); });
    return base + "?" + q.toString();
  }
  // Names containing protocol separators must not create extra stops or alter the lat/lng grammar.
  function name(p) { return String(p.name || "目的地").replace(/[,|]/g, " "); }
  function links(p, options) {
    const o = options || {};
    const provider = o.provider === "baidu" ? "baidu" : "amap";
    const mode = ["walk", "car", "bus"].includes(o.mode) ? o.mode : "walk";
    const canPin = risk(p) === "trusted" || (risk(p) === "confirm" && o.confirmed === true);
    const city = String(o.city || "");
    const search = provider === "amap"
      ? url("https://uri.amap.com/search", { keyword: p.name, city, src: "itertrip", callnative: 0 })
      : url("https://api.map.baidu.com/place/search", { query: p.name, region: city, output: "html", src: "webapp.itertrip.web" });
    if (!canPin) return { primary: search, web: search, search, compare: null, kind: "search" };
    const prev = risk(o.previous) === "trusted" ? o.previous : null;
    if (provider === "amap") {
      const params = { to: p.lng + "," + p.lat + "," + name(p), mode, src: "itertrip" };
      const web = url("https://uri.amap.com/navigation", { ...params, callnative: 0 });
      return {
        primary: url("https://uri.amap.com/navigation", { ...params, callnative: 1 }), web, search,
        compare: prev ? url("https://uri.amap.com/navigation", { ...params, from: prev.lng + "," + prev.lat + "," + name(prev), callnative: 0 }) : null,
        kind: "navigation"
      };
    }
    const destination = "latlng:" + p.lat + "," + p.lng + "|name:" + name(p);
    const params = { destination, mode: { walk: "walking", car: "driving", bus: "transit" }[mode], coord_type: "gcj02" };
    const web = url("https://api.map.baidu.com/marker", { location: p.lat + "," + p.lng, title: p.name, content: city + " · " + p.name, coord_type: "gcj02", output: "html", src: "webapp.itertrip.web" });
    return {
      primary: o.mobile ? url(o.ios ? "baidumap://map/direction" : "bdapp://map/direction", { ...params, origin: "我的位置", src: o.ios ? "ios.itertrip.web" : "andr.itertrip.web" }) : web,
      web, search,
      compare: prev ? url("https://api.map.baidu.com/direction", { ...params, origin: "latlng:" + prev.lat + "," + prev.lng + "|name:" + name(prev), region: city, output: "html", src: "webapp.itertrip.web" }) : null,
      kind: "navigation"
    };
  }
  root.IterTripNavigation = { validPoint, risk, links };
})(globalThis);
