import { agentOutcome, agentReceiptSummary, agentStepView, countProposal, countProposalRows, isAgentTrace, proposalInfo, proposalRows } from "./agentTrace.ts";
import type { RouteJSON } from "../types/route";
import type { TraceStep } from "../types/chat";
import type { AgentProposal } from "./agent.ts";

let count = 0;
const ok = (value: unknown, why: string) => { count++; if (!value) throw new Error(why); };
const eq = (a: unknown, b: unknown, why: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${why}: ${JSON.stringify([a, b])}`);

const step = (id: string, kind: TraceStep["kind"], status: TraceStep["status"], title: string, detail = ""): TraceStep =>
  ({ id, kind, status, title, detail });

const route: RouteJSON = {
  trip: { title: "合成", destination: "重庆", days: 1 },
  days: [{
    day: 1,
    schedule: { start: "09:00", end: "18:00", source: "user" },
    places: [
      { id: "a", name: "李子坝", lat: 0, lng: 0, visit: { duration_min: 45, duration_source: "user" } },
      { id: "b", name: "鹅岭二厂", lat: 0, lng: 0, visit: { duration_min: 75, duration_source: "user" } },
    ],
  }],
  summary: [],
};

const proposal: AgentProposal = {
  transaction_id: "t",
  base_version: "v",
  actions: [{
    op: "set_day_schedule",
    day: 1,
    start: "09:30",
    end: "18:30",
    durations: [{ place_id: "a", minutes: 50 }, { place_id: "b", minutes: 75 }],
    source: "estimate",
  }],
};

const base = [
  step("agent-0", "provider", "done", "受约束操作模式"),
  step("agent-1", "llm", "done", "操作分析 1/6 已返回"),
  step("agent-2", "tool", "done", "查询结果：query_transport", "公交 24 分"),
  step("agent-3", "edit", "done", "领域候选已校验", "尚未应用；客户端将检查最新路线"),
];
const pending = [...base, step("agent-client", "edit", "warn", "修改预览已准备，尚未应用。")];
const applied = [...base, step("agent-client", "edit", "done", "已应用这组修改，可撤销。")];
const cancelled = [...base, step("agent-client", "edit", "skip", "已取消预览，行程未修改。")];
const failed = [step("agent-0", "llm", "fail", "模型输出达到本轮上限", "reasoning 占满输出预算")];
const noop = [
  step("agent-0", "provider", "done", "受约束操作模式"),
  step("agent-1", "edit", "warn", "候选与当前日程一致", "仍未评估：观音桥的营业时间；交通耗时未知"),
];

ok(isAgentTrace(pending), "agent ids are recognized");
ok(!isAgentTrace([step("edit", "edit", "done", "路线候选已生成")]), "legacy ids are not treated as agent traces");
eq(agentOutcome(pending), "pending", "pending preview");
eq(agentOutcome(applied), "applied", "applied preview");
eq(agentOutcome(cancelled), "cancelled", "cancelled preview");
eq(agentOutcome(failed), "failed", "failed turn");
eq(agentOutcome(noop), "noop", "no-op turn");
eq(agentOutcome(pending, true), "live", "live turn");

const rows = proposalRows(proposal, route);
eq(rows.length, 2, "unchanged durations are not repeated");
ok(rows[0].label.includes("起止") && rows[0].to === "09:30–18:30", "window row");
ok(rows[1].label === "李子坝" && rows[1].from === "停留 45 分钟" && rows[1].to === "停留 50 分钟", "duration row");
eq(countProposal(proposal).windows, 1, "window count");
eq(countProposal(proposal).durations, 2, "proposal duration scope");
eq(countProposalRows(rows).windows, 1, "changed window count");
eq(countProposalRows(rows).durations, 1, "unchanged duration is not counted as a change");

const info = proposalInfo(proposal, route);
ok(info.title.includes("第 1 天") && info.title.includes("时间安排"), "proposal title scopes the day");
eq(info.badge, "AI 预排", "estimate proposal is labelled");

const pendingSummary = agentReceiptSummary(pending, { outcome: "pending", proposal, counts: countProposalRows(rows) });
ok(pendingSummary.startsWith("待确认"), "pending summary starts with state");
ok(pendingSummary.includes("1 段交通") && pendingSummary.includes("1 个时间窗口") && pendingSummary.includes("1 处停留"), "pending summary counts real changes");
ok(agentReceiptSummary(applied, { outcome: "applied", proposal }).startsWith("已应用"), "applied summary");
ok(agentReceiptSummary(cancelled, { outcome: "cancelled" }).includes("已取消"), "cancelled summary");
ok(agentReceiptSummary(failed, { outcome: "failed" }).includes("未完成"), "failed summary");
const noopSummary = agentReceiptSummary(noop, { outcome: "noop" });
ok(noopSummary.includes("未改动") && noopSummary.includes("2 项仍未评估"), "no-op summary includes unknown count");
eq(agentReceiptSummary(pending, { outcome: "interrupted" }), "已中断 · 行程未修改", "interrupted summary");

const toolView = agentStepView(step("agent-2", "tool", "done", "查询结果：query_transport"));
eq(toolView?.title, "查交通", "tool title is translated");
eq(agentStepView(step("agent-1", "llm", "run", "操作分析 2/6"))?.title, "生成方案（2/6）", "llm round is translated");
eq(agentStepView(step("agent-0", "provider", "done", "受约束操作模式")), null, "provider step stays out of timeline");
eq(agentStepView(step("agent-client", "edit", "warn", "修改预览已准备")), null, "client step stays out of timeline");

console.log(`agentTrace check passed: ${count} assertions`);
