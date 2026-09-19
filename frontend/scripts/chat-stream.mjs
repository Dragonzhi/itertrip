// 优化②验收：假 SSE 服务 + 真前端（dist）+ 零依赖 CDP。
// 用法: node scripts/chat-stream.mjs        （会占用 8100，请先停掉真后端；需要先 npm run build）
// 覆盖五条路径：正常终帧 / 点停止中断 / 流结束却没终帧 / 心跳正常但长静默（看门狗告警）
//              / 生成路线后回对话页（M24：AI 消息与坐标来源摘要都要还在）。
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
// 端口可用环境变量改（默认 8100/9334）：真后端正跑在 8100 时，用 PORT=8123 CDP_PORT=9335 并行跑本脚本
const CDP_PORT = Number(process.env.CDP_PORT || 9334);
const APP_PORT = Number(process.env.PORT || 8100);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const OUT = join(ROOT, "test-artifacts");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
const fails = [];
const check = (name, ok, extra = "") => {
  if (ok) { pass += 1; console.log("  [ok] " + name); }
  else { fails.push(name); console.log("  [FAIL] " + name + " " + extra); }
};

/* ---------------- 假后端：按 prompt 选剧本 ---------------- */
let serverAborted = false; // 客户端断开是否被服务端观察到
const sse = (res, event, data) => res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");

/**
 * M24 回归用的假路线：四种坐标来源 + 无坐标 + 低置信酒店，一条就覆盖全部降级形态。
 * `start_date` 是必需的：Plan 页缺日期时会自动请求 /api/route/datecheck（假后端没有这个端点）。
 */
const FAKE_ROUTE = {
  trip: { title: "长沙两日", destination: "长沙", days: 2, start_date: "2026-10-01", date_source: "user" },
  days: [
    {
      day: 1,
      theme: "抵达",
      places: [
        { name: "橘子洲头", lat: 28.19, lng: 112.96, type: "attraction", time: "09:00", source: "amap", confidence: "high" },
        { name: "笨罗卜", lat: 28.2, lng: 112.97, type: "food", time: "12:00", source: "llm", confidence: "high" },
      ],
      hotel: null,
    },
    {
      day: 2,
      theme: "市区",
      places: [
        { name: "某小店", lat: 28.21, lng: 112.98, type: "food", time: "10:00", source: "city", confidence: "low" },
        { name: "待定位点", lat: 0, lng: 0, type: "attraction", time: "15:00", source: "none", confidence: "none" },
      ],
      hotel: { name: "测试酒店", lat: 28.22, lng: 112.99, source: "amap", confidence: "low" },
    },
  ],
  summary: ["测试用摘要"],
};

const SCENARIOS = {
  async normal(res) {
    sse(res, "stage", { stage: "understand", label: "正在读取攻略并规划路线…" });
    await sleep(300);
    sse(res, "delta", { text: "好的，已为你排好 2 天行程。" });
    await sleep(200);
    sse(res, "reply", { reply: "好的，已为你排好 2 天行程。", intent: "chitchat", route: null, trace: [], stats: {} });
  },
  async route(res) {
    sse(res, "stage", { stage: "understand", label: "正在读取攻略并规划路线…" });
    await sleep(300);
    sse(res, "delta", { text: "已为你排好 2 天行程。" });
    await sleep(200);
    sse(res, "reply", { reply: "已为你排好 2 天行程。", intent: "route_edit", route: FAKE_ROUTE, trace: [], stats: {} });
  },
  async forever(res) {
    let i = 0;
    while (!res.writableEnded && !serverAborted) {
      i += 1;
      sse(res, "stage", { stage: "geocode", label: "正在核验坐标 " + i + "/99：测试点…" });
      await sleep(700);
      if (i % 3 === 0) sse(res, "ping", { ms: i * 700, stage: "geocode" });
    }
  },
  async broken(res) {
    sse(res, "stage", { stage: "understand", label: "正在读取攻略…" });
    sse(res, "delta", { text: "半句话就没有了" });
    await sleep(300);
    res.end(); // 没有 reply / error：模拟后端进程退出
  },
  async stall(res) {
    sse(res, "stage", { stage: "geocode", label: "正在核验 7 个地点的坐标…" });
    for (let i = 1; i <= 3; i += 1) {
      await sleep(1500);
      sse(res, "ping", { ms: i * 1500, stage: "geocode" });
    }
    await sleep(20000); // 之后彻底静默：软阈值 6s / 硬阈值 15s
  },
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

const server = createServer((req, res) => {
  if (req.url.startsWith("/api/chat")) {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", async () => {
      let prompt = "";
      try { prompt = (JSON.parse(body || "{}").prompt || "").trim(); } catch { /* 忽略 */ }
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
      res.on("close", () => { serverAborted = true; });
      const fn = SCENARIOS[prompt] || SCENARIOS.normal;
      await fn(res);
      if (!res.writableEnded) res.end();
    });
    return;
  }
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.startsWith("/itertrip")) p = p.slice("/itertrip".length);
  if (!p || p === "/") p = "/index.html";
  const file = join(DIST, p);
  if (existsSync(file)) {
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

await new Promise((r) => server.listen(APP_PORT, "127.0.0.1", r));
console.log("假后端已启动: http://127.0.0.1:" + APP_PORT + "（静态 dist + /api/chat）");

/* ---------------- CDP（骨架同 mobile-shot.mjs） ---------------- */
const child = spawn(EDGE, [
  "--headless=new", "--remote-debugging-port=" + CDP_PORT,
  "--user-data-dir=" + mkdtempSync(join(tmpdir(), "itertrip-stream-")),
  "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
  "about:blank",
], { stdio: "ignore" });

let wsUrl = "";
for (let i = 0; i < 60 && !wsUrl; i += 1) {
  await sleep(250);
  try { wsUrl = (await (await fetch("http://127.0.0.1:" + CDP_PORT + "/json/version")).json()).webSocketDebuggerUrl; } catch { /* 重试 */ }
}
if (!wsUrl) { child.kill(); throw new Error("Edge 没起来"); }

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(msg.params.exceptionDetails).slice(0, 200));
};
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
});
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId: S } } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, S);
await send("Runtime.enable", {}, S);
const evalIn = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true }, S);
  if (r.result.exceptionDetails) console.log("  ! evaluate:", JSON.stringify(r.result.exceptionDetails).slice(0, 200));
  return r.result.result ? r.result.result.value : undefined;
};
const shot = async (label) => {
  mkdirSync(OUT, { recursive: true });
  const { result } = await send("Page.captureScreenshot", { format: "png" }, S);
  writeFileSync(join(OUT, label + ".png"), Buffer.from(result.data, "base64"));
  console.log("  shot " + label + ".png");
};
/** 轮询断言（返回实际值） */
const until = async (expr, ms = 8000, step = 200) => {
  const t0 = Date.now();
  for (;;) {
    const v = await evalIn(expr);
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await sleep(step);
  }
};

/** 往 React 受控 textarea 里输入（直接 set value 需要绕过 value tracker）+ 点发送 */
const sendPrompt = async (text) => {
  await evalIn("(() => { const el = document.querySelector('[data-testid=chat-input]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(el, " + JSON.stringify(text) + "); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()");
  await sleep(120);
  await evalIn("document.querySelector('[data-testid=send-btn]').click(); true");
};

const TEXT = "document.body.innerText";

try {
  await send("Page.navigate", { url: "http://127.0.0.1:" + APP_PORT + "/itertrip/" }, S);
  await sleep(2500);
  await evalIn("localStorage.clear(); true");
  await send("Page.navigate", { url: "http://127.0.0.1:" + APP_PORT + "/itertrip/" }, S);
  await sleep(2000);
  await evalIn("document.querySelector('[data-testid=chat-entry]').click(); true");
  await sleep(800);
  check("进入对话页（有输入框与发送键）", !!(await evalIn("!!document.querySelector('[data-testid=chat-input]') && !!document.querySelector('[data-testid=send-btn]')")));

  // ① 正常终帧
  console.log("[1] 正常终帧");
  await sendPrompt("normal");
  const replyOk = await until("document.body.innerText.includes('已为你排好')", 8000);
  check("回复渲染出来", !!replyOk);
  check("结束后回到发送按钮", !!(await until("!!document.querySelector('[data-testid=send-btn]') && !document.querySelector('[data-testid=stop-btn]')", 3000)));
  check("没有出现中断角标", !(await evalIn("!!document.querySelector('[data-testid=msg-interrupted]')")));

  // ② 点停止
  console.log("[2] 点停止中断");
  serverAborted = false;
  await sendPrompt("forever");
  check("运行时同一位置出现停止按钮", !!(await until("!!document.querySelector('[data-testid=stop-btn]')", 5000)));
  check("运行时没有发送按钮（原位切换）", !(await evalIn("!!document.querySelector('[data-testid=send-btn]')")));
  check("状态块在（阶段名 + 计时）", !!(await until("!!document.querySelector('[data-testid=stream-status]') && !!document.querySelector('[data-testid=elapsed]')", 3000)));
  await sleep(2200); // 让阶段跑几拍，确保「停止」停的是真的进行中的流
  await shot("stream-running");
  const t0 = Date.now();
  await evalIn("document.querySelector('[data-testid=stop-btn]').click(); true");
  const interrupted = await until("!!document.querySelector('[data-testid=msg-interrupted]')", 5000);
  check("点击后出现「已中断」消息", !!interrupted, "耗时 " + (Date.now() - t0) + "ms");
  check("中断后 ≤1.5s 内恢复空闲", (await until("!!document.querySelector('[data-testid=send-btn]')", 1500)) ? true : false);
  check("中断不产生报错气泡", !(await evalIn(TEXT + ".includes('连接中断')")));
  check("服务端确实观察到连接断开", serverAborted);
  await shot("stream-interrupted");

  // ③ 流结束却没有终帧
  console.log("[3] 断流（无终帧）");
  await sendPrompt("broken");
  const brokenMsg = await until(TEXT + ".includes('连接中断')", 8000);
  check("报「连接中断」而不是空气泡", !!brokenMsg);
  check("报错后回到发送按钮", !!(await until("!!document.querySelector('[data-testid=send-btn]')", 3000)));
  await shot("stream-broken");

  // ④ 心跳正常 → 长静默 → 看门狗告警
  console.log("[4] 长静默告警（等 ~16s）");
  await sendPrompt("stall");
  check("静默初期能看到心跳副行", !!(await until("!!document.querySelector('[data-testid=stream-idle]')", 6000)));
  const soft = await until("((document.querySelector('[data-testid=stream-stalled]') || {}).innerText || '').includes('变慢')", 12000, 200);
  check("6s 软告警（服务端变慢）先出现", !!soft);
  const hard = await until("((document.querySelector('[data-testid=stream-stalled]') || {}).innerText || '').includes('没有任何服务端响应')", 20000, 300);
  check("15s 硬告警升级为「可能已断开」", !!hard,
        await evalIn("(document.querySelector('[data-testid=stream-stalled]') || {}).innerText || ''"));
  await shot("stream-stalled");
  // 收尾：停止这一轮
  await evalIn("document.querySelector('[data-testid=stop-btn]') && document.querySelector('[data-testid=stop-btn]').click(); true");

  // ⑤ M24 回归：生成路线（会跳规划页）后回对话页，AI 消息不能只剩用户那一半
  console.log("[5] 生成路线 → 回对话页：AI 消息 + 坐标摘要仍在");
  await sendPrompt("route");
  check("生成路线后进入地图页", !!(await until("!!document.querySelector('[data-testid=timeline-panel]')", 10000)));
  const stored = await evalIn("JSON.parse(localStorage.getItem('itertrip:chat') || '[]')");
  check("itertrip:chat 已落 AI 回复（同步写，不再靠卸载时跑不到的 effect）",
        Array.isArray(stored) && stored.some((m) => m.role === "assistant" && String(m.content).includes("已为你排好")),
        JSON.stringify((stored || []).map((m) => m.role)));
  check("落库的 AI 消息带坐标摘要", Array.isArray(stored) && stored.some((m) => m.geo && m.geo.total === 5));
  // 用户实际走的路径：返回首页 → 和 AI 继续改这条行程
  const back = await evalIn("(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.title || '').startsWith('返回首页')); if (!b) return false; b.click(); return true; })()");
  check("规划页能返回首页", !!back);
  check("首页进入已行程态", !!(await until("!!document.querySelector('[data-testid=chat-resume-entry]')", 6000)));
  await evalIn("document.querySelector('[data-testid=chat-resume-entry]').click(); true");
  check("回到对话页仍能看到 AI 回复", !!(await until(TEXT + ".includes('已为你排好 2 天行程')", 6000)));
  check("回到对话页仍能看到坐标摘要", !!(await until("!!document.querySelector('[data-testid=geo-digest]')", 6000)));
  const digest = await evalIn("(document.querySelector('[data-testid=geo-digest]') || {}).innerText || ''");
  check("摘要：来源分布正确", /坐标 5 处/.test(digest) && /高德核验 2/.test(digest) && /AI 推测 1/.test(digest)
        && /城市中心 1/.test(digest) && /无来源 1/.test(digest), digest.replace(/\n/g, " | "));
  check("摘要：降级项点名（含无坐标与低置信酒店）",
        /4 处坐标降级/.test(digest) && /待定位点」无坐标/.test(digest) && /测试酒店」高德低置信/.test(digest),
        digest.replace(/\n/g, " | "));
  await shot("chat-after-route");

  check("整轮没有页面异常", errors.length === 0, errors.join(" | "));
} catch (e) {
  fails.push("脚本异常: " + (e && e.message));
  console.log("  ! " + (e && e.stack ? e.stack : e));
} finally {
  try { await send("Browser.close", {}, S); } catch { /* 忽略 */ }
  child.kill();
  server.close();
}

console.log("");
console.log(fails.length ? "结果: " + pass + " 通过 / " + fails.length + " 失败 → " + fails.join(" ; ") : "结果: " + pass + "/" + pass + " 全部通过");
process.exit(fails.length ? 1 : 0);
