/**
 * 流式看门狗自检（无框架，手写 assert）：node src/lib/stream.check.ts
 * 关键点：阈值边界 + 「没收到过心跳就绝不自动中断」这两条，写错了要么误杀慢请求、要么漏报断流。
 */
import { PING_ABORT_MS, PING_HARD_MS, PING_SOFT_MS, describeStreamError, healthOf, isAbortError, shouldAutoAbort } from "./streamWatch.ts";

let n = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error("✗ " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
  }
  n += 1;
};

// 健康度阈值边界
eq("0ms → ok", healthOf(0), "ok");
eq("(soft-1) → ok", healthOf(PING_SOFT_MS - 1), "ok");
eq("soft → slow", healthOf(PING_SOFT_MS), "slow");
eq("(hard-1) → slow", healthOf(PING_HARD_MS - 1), "slow");
eq("hard → stalled", healthOf(PING_HARD_MS), "stalled");
eq("10min → stalled", healthOf(600000), "stalled");

// 自动中断：没有心跳证据时永不触发
eq("没心跳 + 10min → 不中断", shouldAutoAbort(600000, false), false);
eq("有心跳 + (60s-1) → 不中断", shouldAutoAbort(PING_ABORT_MS - 1, true), false);
eq("有心跳 + 60s → 中断", shouldAutoAbort(PING_ABORT_MS, true), true);

// abort 识别
eq("AbortError", isAbortError(Object.assign(new Error("x"), { name: "AbortError" })), true);
eq("普通错误不是 abort", isAbortError(new Error("boom")), false);
eq("null 安全", isAbortError(null), false);

// 报错人话化
eq("Failed to fetch → 连不上后端", describeStreamError(new TypeError("Failed to fetch")),
   "连不上后端：请确认服务还在运行（默认 127.0.0.1:8100），然后重试。");
eq("后端错误原样透出", describeStreamError(new Error("LLM 调用失败：401")), "LLM 调用失败：401");

console.log("✓ stream.check " + n + "/" + n + " 通过");
