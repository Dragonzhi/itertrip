import type { RouteJSON } from "../types/route";

/** 文件名中非法的字符（Windows 保留字符 + 控制字符）。全角「：」等非 ASCII 标点合法，保留。 */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * 导出文件名 = 当前行程的规划名（trip.title，即页面顶部 <h1> 展示的名字）。
 * 标题为空时回退到目的地，再回退到默认名；清理非法字符并限长，保证各系统可落盘。
 */
export function exportFilename(route: RouteJSON | null | undefined): string {
  const title = (route?.trip?.title || "").trim();
  const dest = (route?.trip?.destination || "").trim();
  const base = title || (dest ? `itertrip_${dest}` : "itertrip_trip");
  const safe = base
    .replace(ILLEGAL, "_")
    .replace(/\s+/g, " ")
    .replace(/_+/g, "_")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 100)
    .trim();
  return safe || "itertrip_trip";
}
