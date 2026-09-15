// 优化②验收：假 SSE 服务 + 真前端（dist）+ 零依赖 CDP。
// 用法: node scripts/chat-stream.mjs        （会占用 8100，请先停掉真后端；需要先 npm run build）
// 覆盖四条路径：正常终帧 / 点停止中断 / 流结束却没终帧 / 心跳正常但长静默（看门狗告警）。
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CDP_PORT = 9334;
const APP_PORT = 8100;
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

const SCENARIOS = {
  async normal(res) {
    sse(res, "stage", { stage: "understand", label: "正在读取攻略并规划路线…" });
    await sleep(300);
    sse(res, "delta", { text: "好的，已为你排好 2 天行程。" });
    await sleep(200);
    sse(res, "reply", { reply: "好的，已为你排好 2 天行程。", intent: "chitchat", route: null, trace: [], stats: {} });
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
