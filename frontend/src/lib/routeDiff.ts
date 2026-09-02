import type { RouteJSON, Place } from "../types/route";

/** 路线 diff 结果（DESIGN.md §2「AI 修改前在对话里说明我改了什么」+ §7 M14 变化可视化）。 */
export interface RouteDiff {
  /** 新增的地点（新路线有、旧路线无） */
  added: { di: number; pi: number; name: string }[];
  /** 被移除的地点（旧路线有、新路线无；di 为旧路线中的天索引） */
  removed: { di: number; pi: number; name: string }[];
  /** 位置变化的地点（同名匹配后位置不同） */
  moved: { name: string; fromDi: number; toDi: number; toPi: number }[];
  /** 天主题变化 */
  themeChanged: boolean;
  /** 是否产生了任何变化 */
  changed: boolean;
  /** 给对话气泡用的「我改了什么」短叙述（✓ 列表） */
  summary: string[];
}

function norm(s: string | undefined): string {
  return (s || "").trim().toLowerCase();
}

function flatten(days: { places: Place[] }[]): Map<string, { di: number; pi: number }[]> {
  const m = new Map<string, { di: number; pi: number }[]>();
  days.forEach((d, di) => {
    (d.places || []).forEach((p, pi) => {
      const k = norm(p.name);
      if (!k) return;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push({ di, pi });
    });
  });
  return m;
}

/** 对比两份路线，产出新增/移除/移动清单与叙述。同名多点按出现顺序配对。 */
export function diffRoute(oldRoute: RouteJSON, newRoute: RouteJSON): RouteDiff {
  const oldFlat = flatten(oldRoute.days);
  const newFlat = flatten(newRoute.days);

  const added: RouteDiff["added"] = [];
  const removed: RouteDiff["removed"] = [];
  const moved: RouteDiff["moved"] = [];

  // 新增：new 有而 old 没有（超过旧序号数量的部分即新增）
  for (const [k, newPos] of newFlat) {
    const oldPos = oldFlat.get(k) || [];
    for (let i = oldPos.length; i < newPos.length; i++) {
      const pos = newPos[i];
      const name = (newRoute.days[pos.di]?.places[pos.pi]?.name || "").trim();
      added.push({ di: pos.di, pi: pos.pi, name });
    }
  }
  // 移除：old 有而 new 没有
  for (const [k, oldPos] of oldFlat) {
    const newPos = newFlat.get(k) || [];
    for (let i = newPos.length; i < oldPos.length; i++) {
      const pos = oldPos[i];
      const name = (oldRoute.days[pos.di]?.places[pos.pi]?.name || "").trim();
      removed.push({ di: pos.di, pi: pos.pi, name });
    }
  }
  // 移动：两边都有的按序号配对，位置不同即 moved
  for (const [k, newPos] of newFlat) {
    const oldPos = oldFlat.get(k) || [];
    const n = Math.min(newPos.length, oldPos.length);
    for (let i = 0; i < n; i++) {
      const o = oldPos[i];
      const w = newPos[i];
      if (o.di !== w.di || o.pi !== w.pi) {
        const name = (newRoute.days[w.di]?.places[w.pi]?.name || "").trim();
        moved.push({ name, fromDi: o.di, toDi: w.di, toPi: w.pi });
      }
    }
  }

  // 主题变化
  let themeChanged = false;
  const nDays = Math.min(oldRoute.days.length, newRoute.days.length);
  for (let i = 0; i < nDays; i++) {
    if (norm(oldRoute.days[i]?.theme) !== norm(newRoute.days[i]?.theme)) {
      themeChanged = true;
      break;
    }
  }

  const summary: string[] = [];
  for (const m of moved) {
    if (m.fromDi === m.toDi) {
      summary.push("「" + m.name + "」在第 " + (m.toDi + 1) + " 天内调整了顺序");
    } else {
      summary.push("「" + m.name + "」从第 " + (m.fromDi + 1) + " 天挪到了第 " + (m.toDi + 1) + " 天");
    }
  }
  for (const a of added) summary.push("新增了「" + a.name + "」（第 " + (a.di + 1) + " 天）");
  for (const r of removed) summary.push("从第 " + (r.di + 1) + " 天移除了「" + r.name + "」");
  if (themeChanged) summary.push("调整了某天的主题描述");

  return {
    added,
    removed,
    moved,
    themeChanged,
    changed: added.length + removed.length + moved.length > 0 || themeChanged,
    summary,
  };
}