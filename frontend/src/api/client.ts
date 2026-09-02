import type { PlanRequest, RouteJSON } from "../types/route";
import type { ClarifyQuestion } from "../types/chat";
import type { LlmSettings } from "../lib/settings";

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
    headers: { "Content-Type": "application/json", ...llmHeaders(settings) },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`规划失败 (${resp.status}): ${detail.slice(0, 200)}`);
  }
  const route = (await resp.json()) as RouteJSON;
  return { route, source: resp.headers.get("X-IterTrip-Source") || "?" };
}

/** 对话流式事件（优化①）：stage=阶段播报 delta=回复增量 reply=终帧 error=流内错误 */
export interface ChatStreamEvent {
  event: "stage" | "delta" | "reply" | "error";
  stage?: string;
  label?: string;
  text?: string;
  reply?: string;
  intent?: "route_edit" | "chitchat";
  route?: RouteJSON | null;
  detail?: string;
  /** Agent 式澄清问题（M17） */
  questions?: ClarifyQuestion[];
}

/**
 * 对话入口（SSE 流式）：prompt 为空 = 只初始化。
 * onEvent 按序回调 stage/delta 事件；reply/error 只出现一次且为最后事件。
 * 返回终帧数据（reply/error 合一的 dict）。
 */
export async function chatStream(
  req: { prompt: string; route?: RouteJSON | null; history?: { role: "user" | "assistant"; content: string }[] },
  settings: LlmSettings | null | undefined,
  onEvent?: (ev: ChatStreamEvent) => void,
): Promise<{ reply: string; intent: "route_edit" | "chitchat"; route: RouteJSON | null; questions?: ClarifyQuestion[] }> {
  const resp = await fetch(API_BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...llmHeaders(settings) },
    body: JSON.stringify(req),
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
  let final: { reply: string; intent: "route_edit" | "chitchat"; route: RouteJSON | null; questions?: ClarifyQuestion[] } = {
    reply: "", intent: "chitchat", route: null,
  };
  let failed = false;
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
        final = { reply: payload.reply || "", intent: payload.intent || "chitchat", route: payload.route ?? null, questions: payload.questions || undefined };
      }
    }
  }
  if (failed) throw new Error("对话失败");
  return final;
}

export interface LlmTestResult {
  ok: boolean;
  source: "user" | "env" | "none";
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
  if (!resp.ok) throw new Error(`导出失败 (${resp.status})`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

/** 单点 geocode（编辑器「按名称找位置」用）。 */
export async function geocode(
  name: string,
  city: string,
  settings?: LlmSettings | null,
): Promise<{ lat: number | null; lng: number | null; confidence: string }> {
  const resp = await fetch(API_BASE + "/api/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...llmHeaders(settings) },
    body: JSON.stringify({ name, city }),
  });
  if (!resp.ok) throw new Error("geocode 失败 (" + resp.status + ")");
  return resp.json();
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