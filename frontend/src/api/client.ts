import type { PlanRequest, RouteJSON } from "../types/route";
import type { ClarifyQuestion, TraceStats, TraceStep } from "../types/chat";
import type { LlmSettings } from "../lib/settings";
import { memoryHeaders } from "../lib/memory";

/**
 * API 基地址：开发留空走 Vite 代理；生产构建时注入 VITE_API_BASE。
 * C-1 单进程形态下同源，留空即可。
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "";

/** BYOK 请求头（DESIGN.md §4.2）：有配置才带，后端优先读取。 */
export function llmHeaders(settings?: LlmSettings | null): Record<string, string> {
  const h: Record<string, string> = {};
  if (!settings) return h;
  if (settings.baseUrl.trim()) h["X-LLM-Base"] = settings.baseUrl.trim();
  if (settings.apiKey.trim()) h["X-LLM-Key"] = settings.apiKey.trim();
  if (settings.model.trim()) h["X-LLM-Model"] = settings.model.trim();
  return h;
}

/** 规划：返回 route JSON；来源（llm/mock）通过响应头带出。 */
export async function planTrip(
  req: PlanRequest,
  settings?: LlmSettings | null,
): Promise<{ route: RouteJSON; source: string }> {
  const resp = await fetch(API_BASE + "/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...llmHeaders(settings), ...memoryHeaders() },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`规划失败 (${resp.status}): ${detail.slice(0, 200)}`);
  }
  const route = (await resp.json()) as RouteJSON;
  return { route, source: resp.headers.get("X-IterTrip-Source") || "?" };
}

/**
 * 对话流式事件（优化①）：stage=阶段播报 trace=决策轨迹 delta=回复增量 reply=终帧 error=流内错误
 * 优化②新增 ping=心跳（静默阶段每 ~2s 一次，只证明服务端还活着，不携带内容）。
 */
export interface ChatStreamEvent {
  event: "stage" | "ping" | "trace" | "thinking" | "delta" | "reply" | "error";
  stage?: string;
  label?: string;
  text?: string;
  /** 心跳：本轮已耗时（毫秒）与最近的阶段名（前端只用它证明「还活着」） */
  ms?: number;
  /** M19 决策轨迹的单步（按 step.id upsert 到本轮轨迹） */
  step?: TraceStep;
  /** 推理模型思考链增量（实时滚动，淡色小字展示，不混入正文） */
  thinking?: string;
  reply?: string;
  intent?: "route_edit" | "chitchat";
  route?: RouteJSON | null;
  detail?: string;
  /** Agent 式澄清问题（M17） */
  questions?: ClarifyQuestion[];
  /** M19 终帧携带的完整轨迹与统计（供持久化与刷新后重放） */
  trace?: TraceStep[];
  stats?: TraceStats;
}

/** 把流内逐步下发的 trace 事件按 id 合并成完整轨迹（与后端 upsert 语义一致）。 */
export function mergeTrace(prev: TraceStep[], step?: TraceStep | null): TraceStep[] {
  if (!step || !step.id) return prev;
  const idx = prev.findIndex((s) => s.id === step.id);
  if (idx === -1) return [...prev, step];
  const next = prev.slice();
  next[idx] = step;
  return next;
}

export interface ChatStreamRequest {
  prompt: string;
  route?: RouteJSON | null;
  history?: { role: "user" | "assistant"; content: string }[];
  images?: string[];
}

export interface ChatStreamResult {
  reply: string;
  intent: "route_edit" | "chitchat";
  route: RouteJSON | null;
  questions?: ClarifyQuestion[];
  trace?: TraceStep[];
  stats?: TraceStats;
}

/**
 * 对话入口（SSE 流式）。
 * onEvent 按序回调 stage/ping/delta 事件；reply/error 只出现一次且为最后事件。
 * signal：优化②中断支持（用户点「停止」或看门狗自动中断时由调用方 abort）。
 * 返回终帧数据；**流结束却没有终帧时抛错**（此前会安静地返回空回复 → 空气泡）。
 */
export async function chatStream(
  req: ChatStreamRequest,
  settings: LlmSettings | null | undefined,
  onEvent?: (ev: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<ChatStreamResult> {
  const resp = await fetch(API_BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...llmHeaders(settings), ...memoryHeaders() },
    body: JSON.stringify(req),
    signal,
  });
  if (!resp.ok || !resp.body) {
    const detail = await resp.text();
    let msg = detail;
    try {
      msg = String(JSON.parse(detail).detail || detail);
    } catch { /* 保持原文 */ }
    throw new Error(String(msg).slice(0, 200) || `对话失败 (${resp.status})`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let final: ChatStreamResult = {
    reply: "", intent: "chitchat", route: null,
  };
  let failed = false;
  let gotReply = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let payload: ChatStreamEvent;
      try {
        payload = { event, ...(JSON.parse(dataLines.join("\n")) as object) } as ChatStreamEvent;
      } catch { continue; }
      if (event === "error") {
        failed = true;
        throw new Error(payload.detail || "对话失败");
      }
      onEvent?.(payload);
      if (event === "reply") {
        gotReply = true;
        final = {
          reply: payload.reply || "", intent: payload.intent || "chitchat", route: payload.route ?? null,
          questions: payload.questions || undefined, trace: payload.trace, stats: payload.stats,
        };
      }
    }
  }
  if (failed) throw new Error("对话失败");
  if (!gotReply) {
    // 优化②：流结束了却没有 reply/error —— 后端进程退出、连接被代理截断等。
    // 以前这里会安静返回空回复，用户看到一个空气泡还以为模型没话说；现在明确报错。
    throw new Error("连接中断：后端没有返回完整结果（后端可能已退出，或网络被切断）");
  }
  return final;
}

export interface LlmTestResult {
  ok: boolean;
  source: "user" | "env" | "default" | "none";
  model: string;
  vision: boolean;
  message: string;
}

/** 测试连接（DESIGN.md §4.1）：1-token 补全 + 1×1 像素视觉能力探测。 */
export async function testLlm(settings: LlmSettings): Promise<LlmTestResult> {
  const resp = await fetch(API_BASE + "/api/llm/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...llmHeaders(settings) },
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(String(detail.detail || resp.statusText).slice(0, 200));
  }
  return resp.json();
}

/** 导出：把 route JSON 提交给后端换取自包含 HTML 并触发下载。 */
export async function exportHtml(route: RouteJSON, filename: string): Promise<void> {
  const resp = await fetch(API_BASE + "/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route, filename }),
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(String(detail.detail || `导出失败 (${resp.status})`).slice(0, 200));
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 单点 geocode（编辑器「按名称重新定位」用）。source=amap|llm|memory|search|city|none */
export async function geocode(
  name: string,
  city: string,
  settings?: LlmSettings | null,
): Promise<{ lat: number | null; lng: number | null; confidence: string; source?: string }> {
  const resp = await fetch(API_BASE + "/api/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...llmHeaders(settings), ...memoryHeaders() },
    body: JSON.stringify({ name, city }),
  });
  if (!resp.ok) throw new Error("geocode 失败 (" + resp.status + ")");
  return resp.json();
}

/** 整条路线的坐标重校准（M20）：后端重跑补全 + 主动核验，用户手改真值不动。 */
export interface RecheckRecord {
  id: string;
  name: string;
  action: "align" | "replace" | "confirm" | "conflict" | "fill" | "keep" | "miss" | string;
  level?: string;
  confidence?: string;
  dist_km?: number | null;
  score?: number | null;
  ms?: number;
}

export interface RecheckResult {
  route: RouteJSON;
  filled: number;
  records: RecheckRecord[];
  amapCalls: number;
  amapReason: string;
}

export async function recheckRoute(
  route: RouteJSON,
  settings?: LlmSettings | null,
): Promise<RecheckResult> {
  const resp = await fetch(API_BASE + "/api/route/recheck", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...llmHeaders(settings), ...memoryHeaders() },
    body: JSON.stringify({ route }),
  });
  if (!resp.ok) throw new Error("坐标校准失败 (" + resp.status + ")");
  const data = await resp.json();
  return {
    route: data.route as RouteJSON,
    filled: Number(data.filled || 0),
    records: (data.records || []) as RecheckRecord[],
    amapCalls: Number(data.amap_calls || 0),
    amapReason: String(data.amap_reason || ""),
  };
}

/** M22 闭馆日检查结果（POST /api/route/datecheck，纯确定性：不调 LLM/高德）。 */
export interface DateCheckConflict {
  name: string;
  day: number;
  date: string;
  weekday: string;
  claim: string;
  warning: string;
}

export interface DateCheckResult {
  route: RouteJSON;
  checked: boolean;
  reason: string;
  conflicts: DateCheckConflict[];
  skipped: number;
  startDate: string;
  dateSource: string;
  summary: string;
}

/**
 * 出发日期推断 / 闭馆日冲突检查。
 * `startDate` 传空则由后端就近推断（并在 route.trip.date_source 标 inferred）；传了就视为用户给定。
 */
export async function dateCheck(route: RouteJSON, startDate?: string): Promise<DateCheckResult> {
  const resp = await fetch(API_BASE + "/api/route/datecheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route, start_date: startDate || "" }),
  });
  if (!resp.ok) throw new Error("闭馆日检查失败 (" + resp.status + ")");
  const data = await resp.json();
  return {
    route: data.route as RouteJSON,
    checked: Boolean(data.checked),
    reason: String(data.reason || ""),
    conflicts: (data.conflicts || []) as DateCheckConflict[],
    skipped: Number(data.skipped || 0),
    startDate: String(data.start_date || ""),
    dateSource: String(data.date_source || ""),
    summary: String(data.summary || ""),
  };
}

/** 酒店价格搜索（可选能力；未配置数据源时返回提示）。 */
export interface SearchResult {
  prices: { platform: string; price: number; breakfast?: boolean; note?: string }[];
  bookingUrl?: string;
  source: string;
  note: string;
}

export async function searchHotel(
  hotel: string,
  city: string,
  checkIn = "",
  checkOut = "",
): Promise<SearchResult> {
  const resp = await fetch(API_BASE + "/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hotel, city, checkIn, checkOut }),
  });
  if (!resp.ok) throw new Error("search 失败 (" + resp.status + ")");
  return resp.json();
}
/** ---------- 后台管理（M-Admin-1） ---------- */

export interface AdminProviderView {
  name: string;
  base_url: string;
  api_key_masked: string;
  has_key: boolean;
  model: string;
  enabled: boolean;
}

export interface AdminAmapView {
  amap_key_masked: string;
  has_amap_key: boolean;
}

export interface AdminStatus {
  provider: AdminProviderView;
  amap: AdminAmapView;
  active_source: "env" | "admin" | "free" | "none";
  active_model: string;
}

export interface AdminTestResult {
  ok: boolean;
  model: string;
  vision: boolean;
  message: string;
}

function adminHeaders(token: string): Record<string, string> {
  return { "Content-Type": "application/json", "X-Admin-Token": token };
}

async function adminFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(API_BASE + path, {
    ...init,
    headers: { ...adminHeaders(token), ...(init?.headers || {}) },
  });
  if (!resp.ok) {
    const detail = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(String(detail.detail || resp.statusText).slice(0, 200));
  }
  return resp.json() as Promise<T>;
}

export function getAdminStatus(token: string): Promise<AdminStatus> {
  return adminFetch<AdminStatus>(token, "/api/admin/provider");
}

export function saveAdminProvider(
  token: string,
  body: { name: string; base_url: string; api_key: string; model: string; enabled: boolean; amap_key?: string },
): Promise<AdminStatus> {
  return adminFetch<AdminStatus>(token, "/api/admin/provider", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteAdminProvider(token: string): Promise<AdminStatus> {
  return adminFetch<AdminStatus>(token, "/api/admin/provider", { method: "DELETE" });
}

export function testAdminProvider(
  token: string,
  body: { base_url: string; api_key: string; model: string },
): Promise<AdminTestResult> {
  return adminFetch<AdminTestResult>(token, "/api/admin/provider/test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** ---------- M18 旅行记忆库 ---------- */

export interface MemoryStats {
  enabled: boolean;
  total: number;
  by_kind: Record<string, number>;
  cities: string[];
  embed_provider?: string;
  embed_model?: string;
  reason?: string;
}

/** 当前匿名档案的记忆统计（设置面板展示条数/城市）。 */
export async function memoryStats(): Promise<MemoryStats> {
  const resp = await fetch(API_BASE + "/api/memory/stats", { headers: { ...memoryHeaders() } });
  if (!resp.ok) throw new Error("记忆统计失败 (" + resp.status + ")");
  return resp.json();
}

/** 清空当前匿名档案的全部记忆（不影响其他档案）。 */
export async function clearMemory(): Promise<{ ok: boolean; deleted: number }> {
  const resp = await fetch(API_BASE + "/api/memory/all", { method: "DELETE", headers: { ...memoryHeaders() } });
  if (!resp.ok) throw new Error("清空记忆失败 (" + resp.status + ")");
  return resp.json();
}

/**
 * 坐标真值回传（M18）：编辑器里手动确定的位置 = ground truth，后续同名地点 geocode 直接命中。
 * fire-and-forget：任何失败都静默（不影响编辑操作本身），故不返回 Promise（void）。
 */
export function reportPlaceEntity(name: string, city: string, lat: number, lng: number): void {
  void fetch(API_BASE + "/api/memory/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...memoryHeaders() },
    body: JSON.stringify({ name, city, lat, lng, source: "user_pin" }),
  }).catch(() => { /* 静默：记忆是增强能力 */ });
}
