import type { RouteJSON, Place, PriceItem } from "../types/route";

/** 路线 diff 结果（DESIGN.md §2「AI 修改前在对话里说明我改了什么」+ §7 M14 变化可视化）。 */
export interface RouteDiff {
  /** 新增的地点（新路线有、旧路线无） */
  added: { di: number; pi: number; name: string }[];
  /** 被移除的地点（旧路线有、新路线无；di 为旧路线中的天索引） */
  removed: { di: number; pi: number; name: string }[];
  /** 坐标被修正的地点（同名同位但 lat/lng 变了） */
  coordFixed: { di: number; pi: number; name: string }[];
  /** 位置变化的地点（同名匹配后位置不同） */
  moved: { name: string; fromDi: number; toDi: number; toPi: number }[];
  /**
   * 地点**信息**变化（时间/交通/门票/备注）。
   * M22.3 之前这几项完全没参与 diff —— 于是「改门票」「改备注」这类只动字段的修改
   * 会被 `changed=false` 判成「没有变化」，整条新路线被前端丢弃（用户以为没生效）。
   */
  updated: { di: number; pi: number; name: string; labels: string[] }[];
  /** 酒店信息变化（名称/备注/位置/报价）；`prices` 为变更后的报价数值，便于叙述 */
  hotels: { di: number; labels: string[]; prices?: number[] }[];
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

/** 地点上「可改但不影响位置」的字段（改了这些也算路线变化） */
const PLACE_FIELDS: [keyof Place, string][] = [
  ["time", "时间"],
  ["transport", "交通"],
  ["ticket", "门票"],
  ["note", "备注"],
];

/** 报价签名：平台/价格/早餐/备注 全比（后端可能补齐 note 或改写 price） */
function pricesKey(ps?: PriceItem[]): string {
  return JSON.stringify((ps || []).map((p) => [norm(p.platform), Number(p.price) || 0, !!p.breakfast, norm(p.note)]));
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

  const coordFixed: RouteDiff["coordFixed"] = [];
  // 检测坐标变化（同名地点保留但 lat/lng 变了）
  for (const [k, newPos] of newFlat) {
    const oldPos = oldFlat.get(k) || [];
    const n = Math.min(newPos.length, oldPos.length);
    for (let i = 0; i < n; i++) {
      const o = oldPos[i];
      const w = newPos[i];
      const op = oldRoute.days[o.di]?.places[o.pi];
      const wp = newRoute.days[w.di]?.places[w.pi];
      if (!op || !wp) continue;
      const latChanged = Math.abs((op.lat || 0) - (wp.lat || 0)) > 1e-6;
      const lngChanged = Math.abs((op.lng || 0) - (wp.lng || 0)) > 1e-6;
      if ((latChanged || lngChanged) && o.di === w.di && o.pi === w.pi) {
        coordFixed.push({ di: w.di, pi: w.pi, name: wp.name.trim() });
      }
    }
  }

  // 地点信息变化（时间/交通/门票/备注）—— M22.3：这几项以前没参与 diff，
  // 只改字段的修改会被判成「无变化」从而整条路线被前端丢掉
  const updated: RouteDiff["updated"] = [];
  for (const [k, newPos] of newFlat) {
    const oldPos = oldFlat.get(k) || [];
    const n = Math.min(newPos.length, oldPos.length);
    for (let i = 0; i < n; i++) {
      const o = oldPos[i];
      const w = newPos[i];
      if (o.di !== w.di || o.pi !== w.pi) continue;
      const op = oldRoute.days[o.di]?.places[o.pi];
      const wp = newRoute.days[w.di]?.places[w.pi];
      if (!op || !wp) continue;
      const labels = PLACE_FIELDS.filter(([f]) => norm(op[f] as string) !== norm(wp[f] as string)).map(([, l]) => l);
      if (labels.length) updated.push({ di: w.di, pi: w.pi, name: (wp.name || "").trim(), labels });
    }
  }

  // 酒店变化（含**报价**）：逐天按下标配对；M22.3 之前酒店完全没参与 diff，
  // 于是「把酒店报价设为 100」这种只动 hotel.prices 的修改被静默丢弃
  const hotels: RouteDiff["hotels"] = [];
  for (let di = 0; di < Math.min(oldRoute.days.length, newRoute.days.length); di++) {
    const oh = oldRoute.days[di]?.hotel || null;
    const nh = newRoute.days[di]?.hotel || null;
    if (!oh && !nh) continue;
    if (!oh || !nh) {
      hotels.push({ di, labels: [nh ? "新增酒店" : "移除酒店"] });
      continue;
    }
    const labels: string[] = [];
    if (norm(oh.name) !== norm(nh.name)) labels.push("名称");
    if (norm(oh.note) !== norm(nh.note)) labels.push("备注");
    const posChanged = Math.abs((oh.lat || 0) - (nh.lat || 0)) > 1e-6 || Math.abs((oh.lng || 0) - (nh.lng || 0)) > 1e-6;
    if (posChanged) labels.push("位置");
    const hotelEntry: RouteDiff["hotels"][number] = { di, labels };
    if (pricesKey(oh.prices) !== pricesKey(nh.prices)) {
      labels.push("报价");
      // 变更后的报价数值（给「把第 N 天酒店报价设为 ¥X」这类叙述用）
      const before = new Set((oh.prices || []).map((p) => norm(p.platform) + ":" + (Number(p.price) || 0)));
      const added2 = (nh.prices || []).filter((p) => !before.has(norm(p.platform) + ":" + (Number(p.price) || 0)));
      const vals = (added2.length ? added2 : (nh.prices || [])).map((p) => Number(p.price) || 0).filter((v) => v > 0);
      if (vals.length) hotelEntry.prices = vals;
    }
    if (labels.length) hotels.push(hotelEntry);
  }

  const summary: string[] = [];
  for (const n of coordFixed) summary.push("修正了「" + n.name + "」的坐标");
  for (const m of moved) {
    if (m.fromDi === m.toDi) {
      summary.push("「" + m.name + "」在第 " + (m.toDi + 1) + " 天内调整了顺序");
    } else {
      summary.push("「" + m.name + "」从第 " + (m.fromDi + 1) + " 天挪到了第 " + (m.toDi + 1) + " 天");
    }
  }
  for (const a of added) summary.push("新增了「" + a.name + "」（第 " + (a.di + 1) + " 天）");
  for (const r of removed) summary.push("从第 " + (r.di + 1) + " 天移除了「" + r.name + "」");
  for (const u of updated) summary.push("更新了「" + u.name + "」的" + u.labels.join("、"));
  for (const h of hotels) {
    const day = "第 " + (h.di + 1) + " 天";
    if (h.labels.includes("新增酒店")) summary.push(day + "新增了酒店");
    else if (h.labels.includes("移除酒店")) summary.push(day + "移除了酒店");
    else if (h.labels.length === 1 && h.labels[0] === "报价" && h.prices && h.prices.length === 1) {
      summary.push("把" + day + "酒店的报价设为 ¥" + h.prices[0]);
    } else {
      // 报价和其他字段一起变时也要把金额写出来（否则用户看不出改成了多少钱）
      const parts = h.labels.map((l) =>
        l === "报价" && h.prices && h.prices.length === 1 ? "报价 ¥" + h.prices[0] : l,
      );
      summary.push("更新了" + day + "酒店的信息（" + parts.join("、") + "）");
    }
  }
  if (themeChanged) summary.push("调整了某天的主题描述");

  return {
    added,
    removed,
    coordFixed,
    moved,
    updated,
    hotels,
    themeChanged,
    changed:
      added.length + removed.length + moved.length > 0 ||
      themeChanged ||
      coordFixed.length > 0 ||
      updated.length > 0 ||
      hotels.length > 0,
    summary,
  };
}