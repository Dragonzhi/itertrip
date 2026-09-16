import { useEffect, useRef, useState } from "react";
import type { TraceKind, TraceStatus, TraceStep } from "../types/chat";

interface Props {
  steps?: TraceStep[];
  /** 流式进行中：强制展开并自动滚动，结束后自动收起（用户可再手动展开） */
  live?: boolean;
}

const KIND_ICON: Record<TraceKind | string, string> = {
  provider: "🔌",
  memory: "🧠",
  llm: "✨",
  retry: "🔁",
  geocode: "📍",
  facts: "🗓",
  edit: "🛠",
  summary: "🏁",
};

const STATUS_DOT: Record<TraceStatus | string, string> = {
  run: "bg-moss animate-pulse",
  done: "bg-moss",
  warn: "bg-gold",
  fail: "bg-[#B85C5C]",
  skip: "bg-[#C9C2B4]",
};

function fmtMs(ms?: number): string {
  if (!ms) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * M19 决策轨迹块：把 AI 这一轮的关键决策摊开给用户看（用了哪个模型、有没有命中记忆、
 * 每个地点的坐标从哪来/是否被替换、有没有重试、坐标兜底是否触发）。
 *
 * 默认折叠、流式期间展开；步数由后端 trace 事件逐步下发（同 id 覆盖），终帧另带完整列表，
 * 因此刷新后仍能重放整条轨迹（见 Plan.tsx / Chat.tsx 的消息持久化）。
 */
export default function DecisionTrace({ steps, live }: Props) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const wasLive = useRef(false);
  const list = steps || [];

  useEffect(() => {
    if (live) {
      wasLive.current = true;
      setOpen(true);
    } else if (wasLive.current) {
      wasLive.current = false;
      setOpen(false);
    }
  }, [live]);

  useEffect(() => {
    if (open && live && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [list.length, open, live]);

  if (!list.length) return null;

  const warns = list.filter((s) => s.status === "warn" || s.status === "fail").length;
  const errs = list.filter((s) => s.status === "fail").length;
  const last = list[list.length - 1];
  const running = list.some((s) => s.status === "run");

  return (
    <div
      className="w-full border border-line/50 rounded-xl overflow-hidden bg-cream/60"
      data-testid="decision-trace"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="trace-toggle"
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-ink-soft hover:text-ink transition-colors text-left"
      >
        <span className="inline-block text-[11px] leading-none select-none">{open ? "▼" : "▶"}</span>
        <span className="text-[11px]">🧭</span>
        <span className="font-medium text-ink/80">决策过程</span>
        <span className="font-mono text-ink-soft">{list.length} 步</span>
        {running && <span className="text-moss font-semibold">进行中…</span>}
        {!running && warns > 0 && (
          <span className={errs ? "text-danger font-semibold" : "text-gold-deep font-semibold"}>{warns} 项需注意</span>
        )}
        {!running && !warns && last && <span className="truncate max-w-[46%]">{last.title}</span>}
        <span className="ml-auto text-[11px] text-moss font-semibold shrink-0">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          data-testid="trace-steps"
          className="max-h-[220px] overflow-y-auto px-2.5 pb-2 pt-0.5 border-t border-line/30 space-y-1"
        >
          {list.map((s) => (
            <div key={s.id} className="flex items-start gap-1.5 text-[11px] leading-relaxed" data-testid="trace-step">
              <span className={"mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 " + (STATUS_DOT[s.status] || "bg-[#C9C2B4]")} />
              <span className="shrink-0" aria-hidden>{KIND_ICON[s.kind] || "•"}</span>
              <span className="min-w-0">
                <span className="font-semibold text-ink/90">{s.title}</span>
                {s.detail && <span className="text-ink-soft"> · {s.detail}</span>}
              </span>
              {s.ms ? <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-soft">{fmtMs(s.ms)}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
