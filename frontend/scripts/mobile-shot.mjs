// M23：零依赖 CDP 验收脚本（复用本机 Edge，不需要 playwright）。
// 用法: node scripts/mobile-shot.mjs [375x667 ...]     输出: frontend/test-artifacts/*.png
// 前置: 另开终端跑  npx vite --host 127.0.0.1 --port 5173
// 三件事：① 各尺寸截图（含两个抽屉打开态）② 探针（横向溢出 + 关键控件是否在视口内）
// ③ 手机尺寸下的功能断言：点"下移"真能跨天移动、撤销能还原。
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;
const BASE = "http://127.0.0.1:5173/itertrip/";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test-artifacts");

// 最小合法 RouteJSON（够 Plan 页渲染；2 天 / 3 个带坐标地点 / 1 家带报价酒店）
const FIXTURE = {
  trip: { title: "国庆长沙6日游：山水洲城与烟火湘味", destination: "长沙", days: 2, dates: "10月1日–10月2日", budget: "3000", style: "美食", travelers: "2人", start_date: "2025-10-01", date_source: "user" },
  days: [
    { day: 1, theme: "抵达与夜市", places: [
      { name: "橘子洲头", lat: 28.1663, lng: 112.9636, type: "attraction", time: "14:00", transport: "地铁2号线", ticket: "免费", note: "看毛主席青年艺术雕塑" },
      { name: "太平老街", lat: 28.1946, lng: 112.9696, type: "attraction", time: "18:00", transport: "步行", ticket: "免费", note: "小吃街" },
    ], hotel: { name: "五一广场某酒店", lat: 28.1952, lng: 112.9828, note: "含早", prices: [{ platform: "携程", price: 468, breakfast: true, note: "" }] } },
    { day: 2, theme: "博物馆与湘菜", places: [
      { name: "湖南博物院", lat: 28.2113, lng: 112.9955, type: "attraction", time: "09:00", transport: "打车", ticket: "免费预约", note: "周一闭馆" },
    ], hotel: null },
  ],
  summary: ["节假日地铁比打车快；博物院需提前预约。"],
};

const sizes = (process.argv.slice(2).length ? process.argv.slice(2) : ["320x568", "375x667", "390x844", "1280x800"]).map((s) => s.split("x").map(Number));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const child = spawn(EDGE, [
  "--headless=new", "--remote-debugging-port=" + PORT,
  "--user-data-dir=" + mkdtempSync(join(tmpdir(), "itertrip-shot-")),
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
  "about:blank",
], { stdio: "ignore" });

let wsUrl = "";
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250);
  try { wsUrl = (await (await fetch("http://127.0.0.1:" + PORT + "/json/version")).json()).webSocketDebuggerUrl; } catch { /* 重试 */ }
}
if (!wsUrl) { child.kill(); throw new Error("Edge 没起来（端口 " + PORT + "）"); }

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg);
};
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
});
const waitEvent = async (method, ses, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const i = events.findIndex((e) => e.method === method && (!ses || e.sessionId === ses));
    if (i >= 0) return events.splice(i, 1)[0];
    await sleep(50);
  }
  return null;
};
/** 在页面里跑一段表达式并取回值（异常只打印不中断） */
const evalIn = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true }, S);
  if (r.result.exceptionDetails) console.log("  ! evaluate 异常:", JSON.stringify(r.result.exceptionDetails).slice(0, 240));
  return r.result.result ? r.result.result.value : undefined;
};

const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = sessionId;
await send("Page.enable", {}, S);
await send("Runtime.enable", {}, S);

const shoot = async (label, w, h) => {
  const { result } = await send("Page.captureScreenshot", { format: "png" }, S);
  writeFileSync(join(OUT, label + "." + w + "x" + h + ".png"), Buffer.from(result.data, "base64"));
  console.log("  shot", label + "." + w + "x" + h + ".png");
};

/** 探针：横向溢出 + 关键控件是否在视口内可达（手机验收的核心断言） */
const PROBES = ["[data-testid=settings-gear]", "[data-testid=chat-toggle]", "[data-testid=panel-toggle]", "[data-testid=export-trigger]", "[data-testid=date-picker-trigger]"];
const probe = async (w, h) => {
  const out = await evalIn(`(() => {
    const de = document.documentElement;
    const res = { size: "${w}x${h}", overflowX: de.scrollWidth - de.clientWidth, bodyOverflow: document.body.scrollWidth - window.innerWidth, items: {} };
    for (const sel of ${JSON.stringify(PROBES)}) {
      const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
      res.items[sel] = el ? (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), inView: r.width > 0 && r.x >= 0 && r.right <= window.innerWidth + 1 && r.y >= 0 && r.bottom <= window.innerHeight + 1 }; })() : null;
    }
    return res;
  })()`);
  const bad = out.overflowX > 1 || out.bodyOverflow > 1;
  console.log("  " + (bad ? "✗" : "✓") + " 无横向溢出:", JSON.stringify({ overflowX: out.overflowX, bodyOverflow: out.bodyOverflow }));
  console.log("  控件:", JSON.stringify(out.items));
};

/** 抽屉打开后：表头/工具条控件必须可达（手机验收项） */
const SHEET_PROBES = ["[data-testid=date-picker-trigger]", "[data-testid=export-trigger]"];
const probeSheet = async () => {
  const out = await evalIn(`(() => {
    const res = {};
    for (const sel of ${JSON.stringify(SHEET_PROBES)}) {
      const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
      res[sel] = el ? (() => { const r = el.getBoundingClientRect(); return { y: Math.round(r.y), w: Math.round(r.width), inView: r.x >= 0 && r.right <= window.innerWidth + 1 && r.y >= 0 && r.bottom <= window.innerHeight + 1 }; })() : null;
    }
    return res;
  })()`);
  const ok = SHEET_PROBES.every((s) => out[s] && out[s].inView);
  console.log("  " + (ok ? "✓" : "✗") + " 抽屉内控件可达:", JSON.stringify(out));
  return ok;
};

/** "太平老街"在第几天（按最近的 .mb-7 天分组取标题） */
const dayOf = (name) => evalIn(`(() => {
  const t = [...document.querySelectorAll(".place-item")].find((i) => i.textContent.includes("${name}"));
  if (!t) return "not-found";
  const d = t.closest(".mb-7");
  return d ? d.querySelector("button").textContent.replace(/\s+/g, "").slice(0, 3) : "no-day";
})()`);

/** 功能断言：D1 末项下移到 D2，再撤销还原（走 moveTarget + handleDropMove + 撤销栈） */
const checkReorder = async () => {
  const before = await dayOf("太平老街");
  const clicked = await evalIn(`(() => {
    const t = [...document.querySelectorAll(".place-item")].find((i) => i.textContent.includes("太平老街"));
    const b = t && t.querySelector('.reorder-btns button[title^="下移"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(400);
  const after = await dayOf("太平老街");
  const undid = await evalIn(`(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("撤销"));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  await sleep(400);
  const restored = await dayOf("太平老街");
  const ok = clicked && before.startsWith("D1") && after.startsWith("D2") && undid && restored.startsWith("D1");
  console.log("  " + (ok ? "✓" : "✗") + " 跨天下移 + 撤销:", clicked + " " + before + "→" + after + "→(撤销)" + restored);
  return ok;
};

let failures = 0;
for (const [w, h] of sizes) {
  const mobile = w < 768;
  console.log("== " + w + "x" + h + " ==");
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile }, S);
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 0 }, S);
  await send("Page.navigate", { url: BASE }, S);
  await waitEvent("Page.loadEventFired", S);
  await evalIn("localStorage.setItem('itertrip:route', " + JSON.stringify(JSON.stringify(FIXTURE)) + ")");
  await send("Page.reload", {}, S);
  await waitEvent("Page.loadEventFired", S);
  await sleep(mobile ? 1800 : 1200);          // 等瓦片与布局稳定
  await shoot("plan", w, h);
  await probe(w, h);
  // 抽屉打开态：用 testid 点（md:hidden 的元素 .click() 依然有效）
  if (await evalIn("(() => { const b = document.querySelector('[data-testid=chat-toggle]'); if (!b) return false; b.click(); return true; })()")) {
    await sleep(700); await shoot("plan-chat-open", w, h);
    await evalIn("document.querySelector('[data-testid=chat-toggle]').click()"); await sleep(400);
  }
  if (await evalIn("(() => { const b = document.querySelector('[data-testid=panel-toggle]'); if (!b) return false; b.click(); return true; })()")) {
    await sleep(700); await shoot("plan-panel-open", w, h);
    if (mobile && !(await probeSheet())) failures++;
    if (mobile && !(await checkReorder())) failures++;
    await evalIn("document.querySelector('[data-testid=panel-toggle]').click()"); await sleep(400);
  }
}

await send("Browser.close");
await sleep(300);
child.kill();
console.log(failures === 0 ? "done ✓ 全部通过 -> " + OUT : "done ✗ 失败 " + failures + " 项 -> " + OUT);