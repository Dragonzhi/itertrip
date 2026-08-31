import type { DayPlan, Place } from "./types/route";

/** 移植自旧版模板 route_map.html：几何与配色纯函数，可单元测试。 */

export const DAY_COLORS = ["#E07A5F", "#E9B44C", "#3D8B8A", "#6D5B9E", "#B85C5C", "#4C7A3E"];
export const EMOJI: Record<string, string> = { attraction: "⛰️", food: "🍜", transport: "🚇", other: "📍" };
export const EMOJI_FALLBACK: Record<string, string> = { attraction: "📍", food: "🍽️", transport: "🚌", other: "📍" };

export function dayColor(di: number): string {
  return DAY_COLORS[di % DAY_COLORS.length];
}

export function emojiFor(p: Place): string {
  const t = p.type || "other";
  return EMOJI[t] || EMOJI_FALLBACK[t] || "📍";
}

/** Web Mercator 纵坐标（弧度尺度）；纬度截断到 ±85°。 */
export function mercY(lat: number): number {
  const r = Math.max(-85, Math.min(85, Number(lat) || 0)) * (Math.PI / 180);
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

export function mercYinv(y: number): number {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}

/** 有向路线段 a→b 的箭头角度（CSS rotate，正东为 0）。
 *  红线（DESIGN §7.2）：dx/dy 必须同为弧度尺度；跨 180° 经线取最短方向。 */
export function routeArrowDeg(a: [number, number], b: [number, number]): number {
  let dl = Number(b[1]) - Number(a[1]);
  if (dl > 180) dl -= 360;
  else if (dl < -180) dl += 360;
  const dx = dl * (Math.PI / 180);
  const dy = -(mercY(b[0]) - mercY(a[0]));
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** 投影空间中点：保证箭头落在渲染线段的视觉中点（非经纬度均值）。 */
export function routeMidPoint(a: [number, number], b: [number, number]): [number, number] {
  return [mercYinv((mercY(a[0]) + mercY(b[0])) / 2), (a[1] + b[1]) / 2];
}

/** 提取一天内所有有效坐标点（供连线与 fitBounds）。 */
export function dayPoints(day: DayPlan): [number, number][] {
  return (day.places || [])
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => [p.lat, p.lng] as [number, number]);
}