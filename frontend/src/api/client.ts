import type { PlanRequest, RouteJSON } from "../types/route";

/** 规划：返回 route JSON；来源（llm/mock）通过响应头带出。 */
export async function planTrip(req: PlanRequest): Promise<{ route: RouteJSON; source: string }> {
  const resp = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`规划失败 (${resp.status}): ${detail.slice(0, 200)}`);
  }
  const route = (await resp.json()) as RouteJSON;
  return { route, source: resp.headers.get("X-IterTrip-Source") || "?" };
}

/** 导出：把 route JSON 提交给后端换取自包含 HTML 并触发下载。 */
export async function exportHtml(route: RouteJSON, filename: string): Promise<void> {
  const resp = await fetch("/api/export", {
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
export async function geocode(name: string, city: string): Promise<{ lat: number | null; lng: number | null; confidence: string }> {
  const resp = await fetch("/api/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

export async function searchHotel(hotel: string, city: string, checkIn = "", checkOut = ""): Promise<SearchResult> {
  const resp = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hotel, city, checkIn, checkOut }),
  });
  if (!resp.ok) throw new Error("search 失败 (" + resp.status + ")");
  return resp.json();
}
