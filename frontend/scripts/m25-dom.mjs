/** Offline DOM integration, not a browser/device test. No external network or UI automation. */
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { build } from "esbuild";

const artifacts = path.resolve("test-artifacts/m25");
const fixture = JSON.parse(await fs.readFile(path.join(artifacts, "route.json"), "utf8"));
fixture.trip.start_date = "2026-10-01"; fixture.trip.date_source = "user";
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://itertrip.test/itertrip/", pretendToBeVisual: true });
const w = dom.window;
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "SVGElement", "HTMLDialogElement", "localStorage", "history", "location", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? w : w[key] });
}
globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w);
globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w);
w.SVGSVGElement.prototype.createSVGRect = () => ({});
w.HTMLElement.prototype.scrollIntoView = function () {};
// jsdom doesn't implement native dialog or layout; these tests verify app state/DOM, not the browser's focus trap.
w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
w.matchMedia = query => ({ matches: query.includes("767"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
class Observer { observe() {} unobserve() {} disconnect() {} }
globalThis.IntersectionObserver = w.IntersectionObserver = Observer;
globalThis.ResizeObserver = w.ResizeObserver = Observer;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = async () => { throw new Error("Unexpected network request in offline DOM test"); };
localStorage.setItem("itertrip:route", JSON.stringify(fixture));
localStorage.setItem("itertrip:trip-session", "m25-test-session");
const bundle = await build({ entryPoints: ["src/App.tsx"], bundle: true, format: "esm", platform: "browser", jsx: "automatic", write: false, loader: { ".css": "empty" }, external: ["react", "react-dom", "react-dom/*"], define: { "import.meta.env": "{}" } });
const bundleFile = path.join(artifacts, "app-dom.mjs");
await fs.writeFile(bundleFile, bundle.outputFiles[0].text);
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: App } = await import(pathToFileURL(bundleFile).href);
const { act } = React;
let root;
const mount = async () => { root = createRoot(document.getElementById("root")); await act(async () => { root.render(React.createElement(App)); }); };
const unmount = async () => { await act(async () => root.unmount()); };
const query = selector => { const e = document.querySelector(selector); assert.ok(e, `Missing ${selector}`); return e; };
const byText = (text, scope = document) => { const e = [...scope.querySelectorAll("button,a")].find(e => e.textContent.trim() === text); assert.ok(e, `Missing control: ${text}`); return e; };
const click = async element => { await act(async () => { element.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }); };
const savedProgress = () => JSON.parse(localStorage.getItem("itertrip:outing:m25-test-session"));
await mount();
assert.equal(document.querySelectorAll('[data-pin-key="d0-p3"]').length, 0, "zero-coordinate place has no map pin");
await click(query('[data-testid="panel-toggle"]'));
const undoBefore = byText("↩ 撤销").disabled;
await click(query('[data-testid="place-navigate"]'));
let href = new URL(query('[data-testid="navigation-primary"]').href);
assert.equal(href.searchParams.get("to"), "104.0499,30.6414,武侯祠");
assert.equal(href.searchParams.has("from"), false);
assert.equal(savedProgress().completed.length, 0, "opening navigation doesn't mark completed");
await click(byText("百度地图", query("dialog")));
assert.equal(new URL(query('[data-testid="navigation-primary"]').href).searchParams.get("coord_type"), "gcj02");
await click(query('[aria-label="关闭导航选项"]'));
await click(query('[data-testid="hotel-navigate"]'));
assert.ok(query('[data-testid="navigation-primary"]').href.includes("api.map.baidu.com/marker"), "map preference persists between targets");
await click(byText("复制地点信息", query("dialog")));
assert.ok(query('[aria-label="可复制的地点信息"]').value.includes("测试酒店"), "clipboard denial provides selectable text");
await click(query('[aria-label="关闭导航选项"]'));
// Real Leaflet marker opens a popup whose navigation button uses the latest React callback.
await click(query('[data-pin-key="d0-p0"]').closest(".leaflet-marker-icon"));
await click(query('[data-popup-navigate]'));
assert.equal(query("dialog h2").textContent, "武侯祠");
await click(query('[aria-label="关闭导航选项"]'));
await click(query('[data-testid="outing-mode"]'));
await click(byText("我已到达"));
assert.equal(savedProgress().arrived.length, 1);
await click(byText("完成这一站"));
assert.equal(query('[data-testid="outing-view"] h2').textContent, "锦里");
await click(byText("去这里 ↗", query('[data-testid="outing-view"]')));
assert.ok(query('[data-testid="navigation-primary"]').href.includes("place/search"), "LLM coordinate defaults to search");
const check = query('dialog input[type="checkbox"]'); await click(check);
assert.ok(query('[data-testid="navigation-primary"]').href.includes("/marker"), "explicit confirmation enables stored coordinates");
await click(query('[aria-label="关闭导航选项"]'));
await click(query('[aria-label="前往城市中心占位"]'));
assert.ok(query('[data-testid="navigation-primary"]').href.includes("place/search"));
assert.equal(document.querySelector('dialog input[type="checkbox"]'), null, "city fallback cannot be confirmed into an exact pin");
await click(query('[aria-label="关闭导航选项"]'));
const select = query('[aria-label="出行当天"]');
await act(async () => { select.value = "1"; select.dispatchEvent(new w.Event("change", { bubbles: true })); });
assert.equal(query('[data-testid="outing-view"] h2').textContent, "人民公园");
await unmount(); await mount();
assert.equal(query('[aria-label="出行当天"]').value, "1", "reload restores day and mode");
assert.equal(savedProgress().completed.length, 1, "reload retains completion");
await click(query('[data-testid="planning-mode"]'));
assert.equal(byText("↩ 撤销").disabled, undoBefore, "outing and navigation don't push undo frames");
assert.equal(localStorage.getItem("itertrip:route"), JSON.stringify(fixture), "route unchanged after all outing actions");
await unmount();
const storageSet = w.Storage.prototype.setItem;
w.Storage.prototype.setItem = function (key, value) { if (key.startsWith("itertrip:outing:")) throw new Error("quota exceeded"); return storageSet.call(this, key, value); };
await mount();
assert.ok(document.body.textContent.includes("浏览器无法保存出行进度"), "storage failure is visible");
await unmount(); w.Storage.prototype.setItem = storageSet; dom.window.close();

// Execute only self-contained export scripts, with no Leaflet or network resources.
const html = await fs.readFile(path.join(artifacts, "export-no-map.html"), "utf8");
const exportErrors = [];
const vc = new VirtualConsole(); vc.on("jsdomError", e => exportErrors.push(e));
const exported = new JSDOM(html, { url: "http://export.test/", runScripts: "dangerously", virtualConsole: vc, beforeParse(win) {
  win.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  win.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
} });
const ed = exported.window.document;
assert.ok(ed.querySelector(".it-nav-fallback"));
assert.equal(ed.querySelectorAll('.it-nav-fallback [data-testid="export-navigate"]').length, 6, "all places/hotel retained without a map");
const exportButton = [...ed.querySelectorAll(".it-nav-fallback li")].find(e => e.textContent.includes("尚未定位的小店")).querySelector("button");
exportButton.click();
assert.ok(ed.querySelector('[data-testid="export-navigation-primary"]').href.includes("uri.amap.com/search"));
assert.equal(ed.querySelector('dialog input[type="checkbox"]'), null);
ed.querySelector('dialog button[aria-label="关闭导航选项"]').click();
ed.querySelector('.it-nav-fallback [data-testid="export-navigate"]').click();
assert.equal(new URL(ed.querySelector('[data-testid="export-navigation-primary"]').href).searchParams.get("to"), "104.0499,30.6414,武侯祠");
assert.ok(exportErrors.every(e => e.message.includes("L is not defined")), "only the unavailable map script may fail");
exported.window.close();

// Offline Leaflet is injected only into this in-memory DOM to test the normal export path.
const leaflet = await fs.readFile("node_modules/leaflet/dist/leaflet.js", "utf8");
const hostileHTML = await fs.readFile(path.join(artifacts, "export-hostile.html"), "utf8");
const normalErrors = [];
const normalVC = new VirtualConsole(); normalVC.on("jsdomError", e => normalErrors.push(e));
const normal = new JSDOM(hostileHTML.replace('<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>', () => `<script>${leaflet}</script>`), {
  url: "http://export.test/", runScripts: "dangerously", virtualConsole: normalVC,
  beforeParse(win) {
    win.SVGSVGElement.prototype.createSVGRect = () => ({});
    win.HTMLElement.prototype.scrollIntoView = function () {};
    win.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    win.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  },
});
const nd = normal.window.document;
assert.deepEqual(normalErrors.map(e => e.message), [], "normal export runs without script errors");
assert.equal(nd.querySelectorAll('#timeline [data-testid="export-navigate"]').length, 6);
assert.equal(nd.querySelectorAll('img[src="x"]').length, 0, "route text cannot create executable HTML");
assert.equal(nd.querySelector(".place-name").textContent, "</script> __EXPORT_NAVIGATION__ $& 测试");
nd.querySelector('.place-info [data-testid="export-navigate"]').click();
assert.equal(nd.querySelector("dialog h2").textContent, "</script> __EXPORT_NAVIGATION__ $& 测试");
nd.querySelector('dialog button[aria-label="关闭导航选项"]').click();
nd.querySelector('.hotel-card [data-testid="export-navigate"]').click();
assert.ok(nd.querySelector('[data-testid="export-navigation-primary"]').href.includes("uri.amap.com/search"), "hotel with invalid coordinates remains searchable");
const reexport = normal.window.__ITEST__.buildExportHTML();
const embedded = JSON.parse(reexport.match(/const TRIP = ([\s\S]*?);\n/)[1]);
assert.equal(embedded.days[0].places[0].name, "</script> __EXPORT_NAVIGATION__ $& 测试", "HTML re-export preserves replacement characters and script-like names");
normal.window.close();
console.log("M25 DOM integration passed: navigation, hotel/popup, completion, reload, history isolation, export without map");
