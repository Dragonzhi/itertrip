import { useState } from "react";
import type { TraceStats, TraceStep } from "../types/chat";
import type { AgentProposal } from "../lib/agent";
import { agentOutcome, agentReceiptSummary, agentStepView } from "../lib/agentTrace";
import type { ProposalCounts } from "../lib/agentTrace";
import "./agentChat.css";

interface Props {
  steps?: TraceStep[];
  /** 流式进行中：摘要显示当前阶段，展开后仍可看到逐步状态 */
  live?: boolean;
  stageLabel?: string | null;
  /** 提案快照：应用/刷新后仍能说清涉及多少时间窗口、停留、移动 */
  proposal?: AgentProposal | null;
  /** 提案创建时算好的真实改动数（跳过未变化的停留） */
  counts?: ProposalCounts;
  /** 已应用但没有 proposal 旧数据时的兜底计数 */
  changeSummary?: string[];
  unknownCount?: number;
  stats?: TraceStats;
  /** 流式失败/中断：trace 里不一定有 fail 步，由消息层明确告诉收据 */
  failed?: boolean;
  interrupted?: boolean;
}

function fmtMs(ms?: number): string {
  if (!ms) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Agent 执行收据（M39 后续，用户选定 A + B 组合）：
 * 默认只有一行「查了什么 · 涉及多少改动 · 多久」，展开是完整时间线。
 * 非 Agent 轨迹仍走 DecisionTrace；技术统计只在展开层的最后一行。
 */
export default function AgentReceipt({ steps, live, stageLabel, proposal, counts, changeSummary, unknownCount, stats, failed, interrupted }: Props) {
  const [open, setOpen] = useState(false);
  const list = steps || [];
  if (!list.length) return null;

  const outcome = failed ? "failed" : interrupted ? "interrupted" : agentOutcome(list, !!live);
  const summary = agentReceiptSummary(list, {
    outcome,
    proposal,
    counts,
    changeSummary,
    unknownCount,
    elapsedMs: stats?.elapsed_ms,
    stageLabel,
  });
  const views = list
    .map(agentStepView)
    .filter((view): view is NonNullable<typeof view> => !!view)
    // 消息落库后（中断/失败/已结束）残留的 run 步不能再显示为「还在跑」。
    .map((view) => (view.status === "run" && !live
      ? { ...view, status: outcome === "failed" ? "warn" as const : "skip" as const }
      : view));

  const dot =
    live || outcome === "applied"
      ? "bg-moss"
      : outcome === "failed"
        ? "bg-[#B85C5C]"
        : outcome === "cancelled" || outcome === "interrupted"
          ? "bg-[#C9C2B4]"
          : "bg-gold";
  const tone =
    outcome === "failed"
      ? "text-danger"
      : outcome === "cancelled" || outcome === "interrupted"
        ? "text-ink-soft"
        : "text-ink/80";

  const statsText = (() => {
    if (!stats) return "";
    const parts: string[] = [];
    if (stats.attempts != null) parts.push(`${stats.attempts} 轮`);
    if (stats.tool_calls) parts.push(`${stats.tool_calls} 次查询`);
    if (stats.total_tokens != null && stats.total_tokens > 0) parts.push(`${(stats.total_tokens / 1000).toFixed(1)}k token`);
    parts.push(stats.cost_usd == null ? "费用未知" : `$${stats.cost_usd.toFixed(4)}`);
    if (stats.usage_complete === false) parts.push("token 用量不完整");
    return parts.join(" · ");
  })();

  return (
    <div className="w-full overflow-hidden rounded-xl border border-line/50 bg-cream/60" data-testid="agent-receipt">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="agent-receipt-toggle"
        className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-cream/80"
      >
        <span className={"mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full " + dot + (live ? " animate-pulse" : "")} />
        <span className={"min-w-0 flex-1 text-[11px] leading-relaxed " + tone}>{summary}</span>
        <span className="shrink-0 text-[11px] font-semibold text-moss">{open ? "收起" : "查看过程"}</span>
      </button>
      {open && (
        <div className="border-t border-line/40 px-2.5 pb-2 pt-2" data-testid="agent-receipt-steps">
          {views.length > 0 ? (
            <ol className="agent-timeline">
              {views.map((view) => (
                <li key={view.key} className={view.status}>
                  <span className={"agent-timeline-dot" + (view.status === "run" ? " animate-pulse" : "")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[11px] font-semibold text-ink/90">{view.title}</span>
                      {view.ms ? <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-soft">{fmtMs(view.ms)}</span> : null}
                    </div>
                    {view.detail && (
                      <p className="mt-0.5 break-words text-[11px] leading-relaxed text-ink-soft">{view.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[11px] text-ink-soft">没有更多过程记录。</p>
          )}
          {statsText && (
            <p className="mt-2 border-t border-line/40 pt-1.5 font-mono text-[10px] leading-relaxed text-ink-soft">{statsText}</p>
          )}
        </div>
      )}
    </div>
  );
}
