/**
 * M19 坐标溯源徽标：把「这个点位到底可不可信」直接摊在界面上。
 *
 * 取值来自后端写的 place/hotel.source（memory|user|amap|llm|search|city|mock）与 confidence。
 * 文案刻意区分「你确认过 / 高德核验 / AI 推测 / 兜底」，因为用户最容易踩的坑就是
 * 把模型幻觉出来的小店坐标当成真的。
 */
export interface CoordBadge {
  /** 徽标文字（短，进时间线与地图气泡） */
  text: string;
  /** 语气：ok=可信 / model=模型推测 / warn=低可信 / none=占位 */
  tone: "ok" | "model" | "warn" | "none";
  /** 悬浮说明 */
  title: string;
}

export function coordBadge(source?: string, confidence?: string): CoordBadge | null {
  const src = (source || "").trim();
  const low = confidence === "low" || confidence === "none";
  switch (src) {
    case "user":
      return { text: "你确认过", tone: "ok", title: "你在地图上手动确定的位置（真值，后续不会再被 AI 改动）" };
    case "memory":
      return { text: "你确认过", tone: "ok", title: "命中你之前手动改过的同名同城坐标（记忆库真值）" };
    case "amap":
      return low
        ? { text: "高德低置信", tone: "warn", title: "高德 POI 检索结果，但名称匹配度不高" }
        : { text: "高德核验", tone: "ok", title: "高德 POI 检索得到的坐标（店名级精度）" };
    case "llm":
      return { text: "AI 推测", tone: "model", title: "模型凭自身知识给出的坐标，未经过第三方校核" };
    case "search":
      return { text: "搜索兜底", tone: "warn", title: "从网络搜索结果里抓取的坐标，可信度低" };
    case "city":
      return { text: "城市中心", tone: "warn", title: "只定位到城市中心，建议手动校准" };
    case "mock":
      return { text: "mock 样例", tone: "none", title: "演示模式（无 LLM key）的样例坐标" };
    default:
      return low ? { text: "待确认", tone: "warn", title: "坐标可信度低，建议手动校准" } : null;
  }
}

/** 徽标语气 → Tailwind 类（时间线/表单用） */
export const BADGE_CLASS: Record<CoordBadge["tone"], string> = {
  ok: "bg-moss-soft text-moss",
  model: "bg-[#F1EDE4] text-[#8A7F6A]",
  warn: "bg-gold-soft text-gold",
  none: "bg-[#F1EDE4] text-ink-soft",
};

/** 两点球面距离（km）：仅用于「重新定位后挪了多远」这类提示。 */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
