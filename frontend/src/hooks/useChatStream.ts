import { useCallback, useEffect, useRef, useState } from "react";
import {
  chatStream,
  mergeTrace,
  type ChatStreamEvent,
  type ChatStreamRequest,
  type ChatStreamResult,
} from "../api/client";
import type { LlmSettings } from "../lib/settings";
import type { TraceStep } from "../types/chat";
import { healthOf, isAbortError, shouldAutoAbort, type StreamHealth } from "../lib/streamWatch";

export type StreamStopReason = "user" | "watchdog";

interface Options {
  /** 正常终帧：由页面决定怎么落消息、要不要应用新路线 */
  onReply: (r: ChatStreamResult, partial: string, trace: TraceStep[]) => void;
  /** 真错误（含「流结束却没有终帧」）→ 报错气泡 */
  onError: (e: unknown, partial: string, trace: TraceStep[]) => void;
  /** 被中断（用户点停止 / 看门狗超时）：保留已生成的部分，**不算错误**、不应用任何改动 */
  onInterrupt: (partial: string, reason: StreamStopReason, trace: TraceStep[]) => void;
}

export interface ChatStreamState {
  sending: boolean;
  stageLabel: string | null;
  text: string;
  thinking: string;
  trace: TraceStep[];
  /** 距最近一次收到服务端事件（含心跳）的毫秒数 */
  idleMs: number;
  health: StreamHealth;
  sawPing: boolean;
  send: (req: ChatStreamRequest, settings: LlmSettings | null | undefined) => Promise<void>;
  /** 用户点「停止」（幂等；不在运行时是 no-op） */
  stop: () => void;
}

const IDLE_TICK_MS = 500;

/**
 * 对话流式的状态与编排（优化②）。此前 Chat.tsx / Plan.tsx 各自复制了一份
 * stageLabel/streamText/streamThinking/liveTrace + onEvent + finally；现在统一在这里，
 * 并补上三件以前没有的能力：**可中断**、**空闲时间可感知**、**静默超时自动中断**。
 *
 * 关键点：
 * - 每个事件（含 ping 心跳）都刷新 lastEventAt → idleMs 就是「服务端多久没吭声」；
 * - sawPing 门控自动中断：老后端没有心跳，静默是正常的，绝不误杀；
 * - 文本用 ref 累积（state 只是渲染副本），避免闭包读到过期值；
 * - 回调用 ref 转发，页面重渲染不会用到旧闭包。
 */
export function useChatStream(opts: Options): ChatStreamState {
  const [sending, setSending] = useState(false);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState("");
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [idleMs, setIdleMs] = useState(0);
  const [sawPing, setSawPing] = useState(false);

  const cbs = useRef(opts);
  cbs.current = opts;

  const abortRef = useRef<AbortController | null>(null);
  const lastEventAt = useRef(0);
  const sawPingRef = useRef(false);
  const textRef = useRef("");
  const traceRef = useRef<TraceStep[]>([]);
  const reasonRef = useRef<StreamStopReason | null>(null);

  const stop = useCallback(() => {
    if (!abortRef.current) return;
    reasonRef.current = "user";
    abortRef.current.abort();
  }, []);

  const send = useCallback(async (req: ChatStreamRequest, settings: LlmSettings | null | undefined) => {
    if (abortRef.current) return; // 已在跑：重复发送直接忽略
    const ac = new AbortController();
    abortRef.current = ac;
    reasonRef.current = null;
    sawPingRef.current = false;
    lastEventAt.current = Date.now();
    textRef.current = "";
    traceRef.current = [];
    setSending(true);
    setSawPing(false);
    setStageLabel(null);
    setText("");
    setThinking("");
    setTrace([]);
    setIdleMs(0);

    const onEvent = (ev: ChatStreamEvent) => {
      lastEventAt.current = Date.now();
      setIdleMs(0);
      if (ev.event === "ping") {
        if (!sawPingRef.current) {
          sawPingRef.current = true;
          setSawPing(true);
        }
        return;
      }
      if (ev.event === "stage") {
        setStageLabel(ev.label || null);
        return;
      }
      if (ev.event === "thinking") {
        setThinking((prev) => prev + (ev.thinking || ""));
        return;
      }
      if (ev.event === "delta") {
        textRef.current += ev.text || "";
        setText(textRef.current);
        return;
      }
      if (ev.event === "trace") {
        traceRef.current = mergeTrace(traceRef.current, ev.step);
        setTrace(traceRef.current);
      }
    };

    try {
      const r = await chatStream(req, settings, onEvent, ac.signal);
      const merged = r.trace && r.trace.length ? r.trace : traceRef.current;
      cbs.current.onReply({ ...r, trace: merged.length ? merged : undefined }, textRef.current, merged);
    } catch (e) {
      const partial = textRef.current;
      const snapshot = traceRef.current;
      if (isAbortError(e) || reasonRef.current) {
        cbs.current.onInterrupt(partial, reasonRef.current || "user", snapshot);
      } else {
        cbs.current.onError(e, partial, snapshot);
      }
    } finally {
      abortRef.current = null;
      reasonRef.current = null;
      textRef.current = "";
      traceRef.current = [];
      setSending(false);
      setStageLabel(null);
      setText("");
      setThinking("");
      setTrace([]);
      setIdleMs(0);
    }
  }, []);

  // 看门狗：只在运行时评估「多久没收到任何事件」，超时即自动中断（带心跳证据才允许）
  useEffect(() => {
    if (!sending) return;
    const id = window.setInterval(() => {
      const idle = Date.now() - lastEventAt.current;
      setIdleMs(idle);
      if (shouldAutoAbort(idle, sawPingRef.current)) {
        reasonRef.current = "watchdog";
        abortRef.current?.abort();
      }
    }, IDLE_TICK_MS);
    return () => window.clearInterval(id);
  }, [sending]);

  return {
    sending,
    stageLabel,
    text,
    thinking,
    trace,
    idleMs,
    health: healthOf(idleMs),
    sawPing,
    send,
    stop,
  };
}
