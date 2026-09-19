import type { RouteJSON } from "../types/route";

/**
 * M24 坐标来源摘要：把「这条路线里哪些点的坐标可信、哪些是降级来的」算成一份可渲染的清单，
 * 随 AI 回复一起常驻在对话消息里（此前只有折叠的「🧭 决策过程」里才看得到，等于看不见）。
 *
 * 数据来源是 reply.route 里每个 place/hotel 的 source + confidence —— 与时间线/地图徽标同源，
 * 因此口径天然一致（M19–M21 写好的最终态，不是过程记录）。
 *
 * 本文件刻意**零运行时依赖**（只 import type），这样 `node src/lib/coordDigest.check.ts` 能直接跑。
 */

export interface CoordDigestItem {
  /** 第几天（days[].day 缺失时回退为下标 +1） */
  day: number;
  name: string;
  /** 酒店与地点同表，渲染时加「酒店」二字区分 */
  hotel: boolean;
  /** memory|user|amap|llm|search|city|mock|none；空串归入 unknown */
  source: string;
  confidence: string;
  /** lat/lng 缺失或为 0（schema 用 0 占位） */
  missing: boolean;
}

export interface CoordDigestCount {
  source: string;
  n: number;
}

export interface CoordDigest {
  /** 地点 + 酒店总数 */
  total: number;
  /** 按固定顺序（user/memory → amap → llm → search → city → mock → none → unknown）的分布，只含出现过的来源 */
  counts: CoordDigestCount[];
  /** 可信数：amap/user/memory 且非 low 且有坐标 */
  verified: number;
  /** 降级项（含无坐标），按天与出现顺序 */
  degraded: CoordDigestItem[];
}

/** 计数的固定展示顺序（未列出的来源追加在尾部，保持出现顺序） */
const ORDER = ["user", "memory", "amap", "llm", "search", "city", "mock", "none", "unknown"];

/** 可信来源：用户亲手确认过、记忆库真值、高德 POI 核验 */
const TRUSTED = new Set(["user", "memory", "amap"]);

function normSource(s?: string): string {
  return (s || "").trim() || "unknown";
}

/** 坐标缺失判定：0 / null / NaN 一律视为缺（与「离谱坐标检测」的 _has_coord 同口径） */
function isMissing(lat?: number, lng?: number): boolean {
  return !lat || !lng || Number.isNaN(lat) || Number.isNaN(lng);
}

/**
 * 生成坐标来源摘要；没有可说的（无路线 / 无点位）时返回 null，调用方据此完全不渲染。
 */
export function coordDigest(route: RouteJSON | null | undefined): CoordDigest | null {
  const days = route?.days;
  if (!Array.isArray(days)) return null;

  const items: CoordDigestItem[] = [];
  days.forEach((d, i) => {
    const day = d?.day || i + 1;
    for (const p of d?.places || []) {
      if (!p) continue;
      items.push({
        day,
        name: p.name || "未命名地点",
        hotel: false,
        source: normSource(p.source),
        confidence: (p.confidence || "").trim(),
        missing: isMissing(p.lat, p.lng),
      });
    }
    const h = d?.hotel;
    if (h && h.name) {
      items.push({
        day,
        name: h.name,
        hotel: true,
        source: normSource(h.source),
        confidence: (h.confidence || "").trim(),
        missing: isMissing(h.lat, h.lng),
      });
    }
  });
  if (!items.length) return null;

  const seen = new Map<string, number>();
  for (const it of items) seen.set(it.source, (seen.get(it.source) || 0) + 1);
  const counts = [...seen.entries()]
    .map(([source, n]) => ({ source, n }))
    .sort((a, b) => {
      const ia = ORDER.indexOf(a.source);
      const ib = ORDER.indexOf(b.source);
      return (ia === -1 ? ORDER.length : ia) - (ib === -1 ? ORDER.length : ib);
    });

  /** 可信 = 有坐标 + 来源可信 + 不是低置信（高德低置信照样算降级） */
  const trusted = (it: CoordDigestItem) =>
    !it.missing && TRUSTED.has(it.source) && it.confidence !== "low";

  return {
    total: items.length,
    counts,
    verified: items.filter(trusted).length,
    degraded: items.filter((it) => !trusted(it)),
  };
}
