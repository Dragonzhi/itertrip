/**
 * 流式看门狗（优化②）：把「服务端还活着吗」变成可判定的状态。
 *
 * 后端在静默阶段（模型等待 / 坐标批处理 / 事实检查）每 ~2s 吐一帧 ping，
 * 于是「多久没收到任何事件」本身就是结论：
 *     < 6s    正常
 *   ≥ 6s     慢（可能只是这一跳网络卡了）
 *   ≥ 15s    停滞（明确告诉用户可能已断开，而不是无限转圈）
 *   ≥ 60s    且本轮**收到过 ping** → 自动中断
 *
 * 为什么要 sawPing 门控：老后端没有心跳，静默是正常的；没有心跳证据时绝不自动掐断，
 * 只降级提示。这样「新前端 + 旧服务端」不会误杀慢请求。
 */
export const PING_SOFT_MS = 6000;
export const PING_HARD_MS = 15000;
export const PING_ABORT_MS = 60000;

export type StreamHealth = "ok" | "slow" | "stalled";

export function healthOf(idleMs: number): StreamHealth {
  if (idleMs >= PING_HARD_MS) return "stalled";
  if (idleMs >= PING_SOFT_MS) return "slow";
  return "ok";
}

export function shouldAutoAbort(idleMs: number, sawPing: boolean): boolean {
  return sawPing && idleMs >= PING_ABORT_MS;
}

/** abort（用户点停止 / 看门狗自动中断）在 fetch 侧表现为 AbortError。 */
export function isAbortError(e: unknown): boolean {
  if (!e) return false;
  const name = (e as { name?: string }).name;
  return name === "AbortError" || /abort/i.test(String((e as Error).message || ""));
}

/** 每一句报错都要能指导下一步：把 fetch 的英文异常翻成人话。 */
export function describeStreamError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/Failed to fetch|NetworkError|Load failed|fetch failed/i.test(raw)) {
    return "连不上后端：请确认服务还在运行（默认 127.0.0.1:8100），然后重试。";
  }
  return raw;
}
