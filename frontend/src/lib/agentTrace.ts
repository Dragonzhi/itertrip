import type { TraceStep, TraceStatus } from "../types/chat";
import type { AgentAction, AgentEvidence, AgentProposal } from "./agent";
import type { Hotel, Place, RouteJSON, TransportOption } from "../types/route";

/** Agent 路径的执行状态。noop=有 trace 但没有任何可应用候选。 */
export type AgentOutcome = "live" | "pending" | "applied" | "cancelled" | "noop" | "failed" | "interrupted";

export interface AgentReceiptOptions {
  outcome: AgentOutcome;
  proposal?: AgentProposal | null;
  /** 已按原始路线算好的改动数（跳过未变化的停留）；缺失时退回 proposal 的涉及范围 */
  counts?: ProposalCounts;
  changeSummary?: string[];
  unknownCount?: number;
  elapsedMs?: number;
  stageLabel?: string | null;
}

export interface ProposalCounts {
  windows: number;
  durations: number;
  moves: number;
  adds: number;
  reservations: number;
  locks: number;
  total: number;
}

export interface ProposalRow {
  key: string;
  kind: "window" | "duration" | "move" | "add" | "reservation" | "lock";
  label: string;
  from: string;
  to: string;
  isNew?: boolean;
}

export interface ProposalInfo {
  title: string;
  note: string;
  badge?: string;
}

export interface AgentStepView {
  key: string;
  title: string;
  detail?: string;
  status: TraceStatus;
  ms?: number;
}

type PointEntry = { point: Place | Hotel; di: number };

const CLIENT_IDS = new Set(["agent-client", "agent-commit"]);

/** Agent 轨迹用 `agent-*` id；legacy/提取路径的 id 是 edit/geo-summary 等。 */
export function isAgentTrace(steps?: TraceStep[]): boolean {
  return !!steps?.length && steps.some((step) => step.id.startsWith("agent-"));
}

export function agentOutcome(steps: TraceStep[], live = false): AgentOutcome {
  if (live) return "live";
  const client = [...steps].reverse().find((step) => CLIENT_IDS.has(step.id));
  if (client) {
    if (client.status === "skip") return "cancelled";
    if (client.status === "done") return "applied";
    if (/尚未应用|预览已准备/.test(`${client.title}${client.detail || ""}`)) return "pending";
    return "failed";
  }
  if (steps.some((step) => step.status === "fail")) return "failed";
  if (steps.some((step) => step.kind === "edit" && /候选与当前日程一致|没有可应用的改动|没有实际变化/.test(step.title))) return "noop";
  if (steps.some((step) => step.kind === "edit" && /候选已校验|尚未应用/.test(`${step.title}${step.detail || ""}`))) return "pending";
  return "noop";
}

const TOOL_UNITS: Record<string, string> = {
  query_transport: "段交通",
  check_schedule: "次日程",
  search_place: "个地点",
  search_facts: "次开放资料",
};

function rawToolName(step: TraceStep): string {
  return step.title.replace(/^查询结果：/, "").replace(/^查询：/, "").trim();
}

export function toolSummary(steps: TraceStep[]): string {
  const counts = new Map<string, number>();
  for (const step of steps) {
    if (step.kind !== "tool") continue;
    const unit = TOOL_UNITS[rawToolName(step)] || "次查询";
    counts.set(unit, (counts.get(unit) || 0) + 1);
  }
  return [...counts.entries()].map(([unit, n]) => `${n} ${unit}`).join(" · ");
}

export function countProposal(proposal?: AgentProposal | null): ProposalCounts {
  const counts: ProposalCounts = { windows: 0, durations: 0, moves: 0, adds: 0, reservations: 0, locks: 0, total: 0 };
  for (const action of proposal?.actions || []) {
    if (action.op === "set_day_schedule") {
      counts.windows += 1;
      counts.durations += action.durations?.length || 0;
    } else if (action.op === "set_duration") counts.durations += 1;
    else if (action.op === "move_place") counts.moves += 1;
    else if (action.op === "add_place") counts.adds += 1;
    else if (action.op === "set_reservation") counts.reservations += 1;
    else if (action.op === "lock_visit") counts.locks += 1;
  }
  counts.total = counts.windows + counts.durations + counts.moves + counts.adds + counts.reservations + counts.locks;
  return counts;
}

/** 按预览行（已跳过未变化的停留）统计真实改动数。 */
export function countProposalRows(rows: ProposalRow[]): ProposalCounts {
  const counts: ProposalCounts = { windows: 0, durations: 0, moves: 0, adds: 0, reservations: 0, locks: 0, total: 0 };
  for (const row of rows) {
    if (row.kind === "window") counts.windows += 1;
    else if (row.kind === "duration") counts.durations += 1;
    else if (row.kind === "move") counts.moves += 1;
    else if (row.kind === "add") counts.adds += 1;
    else if (row.kind === "reservation") counts.reservations += 1;
    else if (row.kind === "lock") counts.locks += 1;
  }
  counts.total = counts.windows + counts.durations + counts.moves + counts.adds + counts.reservations + counts.locks;
  return counts;
}

function unknownCountFromSteps(steps: TraceStep[]): number {
  const step = [...steps].reverse().find((s) => s.kind === "edit" && (s.detail || "").startsWith("仍未评估"));
  if (!step) return 0;
  const text = (step.detail || "").replace(/^仍未评估：/, "");
  return text ? text.split("；").filter(Boolean).length : 0;
}

export function formatElapsed(ms?: number): string {
  if (!ms || ms < 0) return "";
  const seconds = ms / 1000;
  return seconds < 1 ? `${Math.round(ms)}ms` : `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

/**
 * 执行收据的一句话摘要：默认只讲「查了什么、涉及多少改动、多久」；
 * 失败/取消/无改动必须明说，不能靠沉默表达。
 */
export function agentReceiptSummary(steps: TraceStep[], options: AgentReceiptOptions): string {
  const tools = toolSummary(steps);
  const counts = options.counts ?? countProposal(options.proposal);
  const warnings = steps.filter((step) =>
    (step.status === "warn" || step.status === "fail") && !CLIENT_IDS.has(step.id)
  ).length;

  if (options.outcome === "live") {
    const running = [...steps].reverse().find((step) => step.status === "run");
    const label = options.stageLabel || running?.title || "正在处理";
    return [tools ? `已查 ${tools}` : "", label].filter(Boolean).join(" · ");
  }
  if (options.outcome === "failed") return warnings ? `未完成 · ${warnings} 项需注意` : "未完成";
  if (options.outcome === "interrupted") return "已中断 · 行程未修改";
  if (options.outcome === "cancelled") return "已取消 · 行程未修改";
  if (options.outcome === "noop") {
    const unknown = options.unknownCount ?? unknownCountFromSteps(steps);
    return `检查完成 · 未改动${unknown ? ` · ${unknown} 项仍未评估` : ""}`;
  }

  const parts: string[] = [];
  if (tools) parts.push(`已查 ${tools}`);
  if (counts.windows) parts.push(`${counts.windows} 个时间窗口`);
  if (counts.durations) parts.push(`${counts.durations} 处停留`);
  if (counts.moves) parts.push(`${counts.moves} 处移动`);
  if (counts.adds) parts.push(`${counts.adds} 个新增地点`);
  if (counts.reservations) parts.push(`${counts.reservations} 条预约记录`);
  if (counts.locks) parts.push(`${counts.locks} 处锁定`);
  if (!parts.length && options.changeSummary?.length) parts.push(`调整 ${options.changeSummary.length} 项`);
  if (options.outcome === "pending") parts.unshift("待确认");
  if (options.outcome === "applied") parts.unshift("已应用");
  if (options.elapsedMs) parts.push(formatElapsed(options.elapsedMs));
  return parts.join(" · ") || "没有可显示的变更";
}

const TOOL_TITLES: Record<string, string> = {
  query_transport: "查交通",
  check_schedule: "检查日程",
  search_place: "查地点",
  search_facts: "查开放资料",
};

const EDIT_TITLES: [RegExp, string][] = [
  [/候选与当前日程一致/, "没有可应用的改动"],
  [/时间冲突已反馈并修正/, "时间冲突已修正"],
  [/时间候选仍有冲突/, "发现时间冲突，已反馈修正"],
  [/领域候选已校验/, "候选已校验"],
  [/候选未通过校验/, "候选未通过校验"],
  [/拒绝并行工具批次/, "拒绝并行调用"],
  [/尚未应用/, "等待你确认"],
];

/** 把后端 trace 翻成用户语言；provider/client 步不进时间线（由收据头部表达）。 */
export function agentStepView(step: TraceStep): AgentStepView | null {
  if (CLIENT_IDS.has(step.id) || step.kind === "provider") return null;
  if (step.kind === "llm") {
    const match = step.title.match(/操作分析\s*(\d+)\s*\/\s*(\d+)/);
    if (match) {
      return {
        key: step.id,
        title: `生成方案（${match[1]}/${match[2]}）`,
        detail: step.status === "run" ? "正在推理…" : undefined,
        status: step.status,
        ms: step.ms,
      };
    }
  }
  if (step.kind === "retry") {
    return { key: step.id, title: "切换兼容模式", detail: step.detail || step.title, status: step.status, ms: step.ms };
  }
  if (step.kind === "tool") {
    const raw = rawToolName(step);
    return { key: step.id, title: TOOL_TITLES[raw] || raw, detail: step.detail, status: step.status, ms: step.ms };
  }
  if (step.kind === "edit") {
    const hit = EDIT_TITLES.find(([pattern]) => pattern.test(step.title));
    return { key: step.id, title: hit ? hit[1] : step.title, detail: step.detail, status: step.status, ms: step.ms };
  }
  return { key: step.id, title: step.title, detail: step.detail, status: step.status, ms: step.ms };
}

function indexPoints(route: RouteJSON): Map<string, PointEntry> {
  const index = new Map<string, PointEntry>();
  route.days.forEach((day, di) => {
    for (const point of [...(day.places || []), ...(day.hotel ? [day.hotel] : [])]) {
      if (point.id) index.set(point.id, { point, di });
    }
  });
  return index;
}

const TYPE_LABELS: Record<Extract<AgentAction, { op: "add_place" }>["type"], string> = {
  attraction: "景点",
  food: "用餐",
  transport: "交通",
  other: "其他",
};

/**
 * 提案卡的逐行 before → after。set_day_schedule 的 durations 里没有变化的站点不重复列，
 * 避免把「保持原样」写成一条改动；其余 action 一律展示。
 */
export function proposalRows(proposal: AgentProposal, route: RouteJSON): ProposalRow[] {
  const index = indexPoints(route);
  const rows: ProposalRow[] = [];
  const seen = new Set<string>();
  const push = (row: Omit<ProposalRow, "key">) => {
    const key = `${row.label}|${row.from}|${row.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ ...row, key });
  };

  for (const action of proposal?.actions || []) {
    if (action.op === "set_day_schedule") {
      const day = route.days[action.day - 1];
      const start = day?.schedule?.start || "";
      const end = day?.schedule?.end || "";
      if (start !== action.start || end !== action.end) {
        push({
          kind: "window",
          label: `第 ${action.day} 天起止`,
          from: start && end ? `${start}–${end}` : "未设置",
          to: `${action.start}–${action.end}`,
          isNew: !(start && end),
        });
      }
      for (const duration of action.durations || []) {
        const entry = index.get(duration.place_id);
        const current = entry?.point.visit?.duration_min;
        if (current === duration.minutes) continue;
        push({
          kind: "duration",
          label: entry?.point.name || duration.place_id,
          from: current ? `停留 ${current} 分钟` : "未设置",
          to: `停留 ${duration.minutes} 分钟`,
        });
      }
    } else if (action.op === "set_duration") {
      const entry = index.get(action.place_id);
      const current = entry?.point.visit?.duration_min;
      if (current === action.minutes) continue;
      push({
        kind: "duration",
        label: entry?.point.name || action.place_id,
        from: current ? `停留 ${current} 分钟` : "未设置",
        to: `停留 ${action.minutes} 分钟`,
      });
    } else if (action.op === "lock_visit") {
      const entry = index.get(action.place_id);
      const current = !!entry?.point.visit?.locked;
      if (current === action.locked) continue;
      push({
        kind: "lock",
        label: entry?.point.name || action.place_id,
        from: current ? "已锁定" : "未锁定",
        to: action.locked ? "锁定" : "解锁",
      });
    } else if (action.op === "set_reservation") {
      const entry = index.get(action.place_id);
      const current = entry?.point.visit?.reservation;
      if (current && current.status !== "cancelled" && current.date === action.date && current.start === action.start && current.end === action.end) continue;
      push({
        kind: "reservation",
        label: entry?.point.name || action.place_id,
        from: current ? `${current.date} ${current.start}–${current.end}${current.status === "cancelled" ? "（已取消）" : ""}` : "未设置",
        to: `${action.date} ${action.start}–${action.end}（待确认）`,
        isNew: !current,
      });
    } else if (action.op === "add_place") {
      push({
        kind: "add",
        label: action.name,
        from: "未安排",
        to: `第 ${action.to_day} 天 · ${TYPE_LABELS[action.type]}`,
        isNew: true,
      });
    } else if (action.op === "move_place") {
      const entry = index.get(action.place_id);
      const before = action.before_id ? index.get(action.before_id)?.point.name : "";
      push({
        kind: "move",
        label: entry?.point.name || action.place_id,
        from: entry ? `第 ${entry.di + 1} 天` : "当前位置",
        to: `第 ${action.to_day} 天${before ? ` · 放在「${before}」前` : ""}`,
      });
    }
  }
  return rows;
}

export function proposalInfo(proposal: AgentProposal, route: RouteJSON): ProposalInfo {
  const index = indexPoints(route);
  const days = new Set<number>();
  let schedule = false;
  let move = false;
  let reservation = false;
  for (const action of proposal?.actions || []) {
    if (action.op === "set_day_schedule") {
      days.add(action.day);
      schedule = true;
    } else if (action.op === "move_place") {
      days.add(action.to_day);
      const entry = index.get(action.place_id);
      if (entry) days.add(entry.di + 1);
      move = true;
    } else if (action.op === "add_place") {
      days.add(action.to_day);
      move = true;
    } else if (action.op === "set_duration" || action.op === "lock_visit") {
      schedule = true;
      const entry = index.get(action.place_id);
      if (entry) days.add(entry.di + 1);
    } else if (action.op === "set_reservation") {
      reservation = true;
      const entry = index.get(action.place_id);
      if (entry) days.add(entry.di + 1);
    }
  }
  const scope = days.size === 1 ? `第 ${[...days][0]} 天 · ` : "";
  const kind = move ? "行程调整" : reservation && !schedule ? "预约记录" : "时间安排";
  const note = reservation
    ? "只记录待确认预约，不会替你预订"
    : move
      ? "应用后仍可撤销，固定预约不会被改动"
      : "只调整起止与停留，不改地点顺序";
  const badge = proposal?.actions?.some((a) => a.op === "set_day_schedule" && a.source === "estimate")
    ? "AI 预排"
    : reservation
      ? "待确认预约"
      : undefined;
  return { title: scope + kind, note, badge };
}

const MODE_LABELS: Record<string, string> = { walk: "步行", bus: "公交/地铁", car: "打车" };

export function optionText(option: TransportOption): string {
  const mode = MODE_LABELS[option.mode] || option.mode;
  const minutes = option.duration_s ? Math.round(option.duration_s / 60) : null;
  return `${mode}${minutes !== null ? ` ${minutes} 分钟` : ""}${option.approx ? " · 估算" : ""}`;
}

export function sourceText(source?: string): string {
  if (source === "amap") return "高德";
  if (source === "synthetic") return "合成";
  return source || "来源未知";
}

export function queryTime(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function evidenceSummary(evidence?: AgentEvidence[]): string {
  return evidence?.length ? `依据 · 查了 ${evidence.length} 段交通` : "";
}
