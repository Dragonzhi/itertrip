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