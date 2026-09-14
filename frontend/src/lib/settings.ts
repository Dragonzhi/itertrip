import type { RouteJSON } from "../types/route";
import type { ChatMessage } from "../types/chat";

const PREFIX = "itertrip:";

/** BYOK 配置（DESIGN.md §4.1）：存 localStorage，永不上传第三方。 */
export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 测试连接探测到的视觉能力：unknown=未探测 true=支持 false=不支持 */
  vision: "unknown" | boolean;
}

export const DEFAULT_SETTINGS: LlmSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
  vision: "unknown",
};

export function loadSettings(): LlmSettings {
  try {
    const raw = localStorage.getItem(PREFIX + "llm");
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<LlmSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: LlmSettings) {
  try {
    localStorage.setItem(PREFIX + "llm", JSON.stringify(s));
  } catch {
    /* 隐私模式等场景写不进就放弃，本次会话内存仍可用 */
  }
}

/** 当前行程快照（刷新后回填恢复）。 */
export function loadCurrentRoute(): RouteJSON | null {
  try {
    const raw = localStorage.getItem(PREFIX + "route");
    if (!raw) return null;
    const v = JSON.parse(raw) as RouteJSON;
    return v && v.trip && Array.isArray(v.days) && v.days.length ? v : null;
  } catch {
    return null;
  }
}

export function saveCurrentRoute(route: RouteJSON) {
  try {
    localStorage.setItem(PREFIX + "route", JSON.stringify(route));
  } catch {
    /* 忽略容量错误 */
  }
}

/** 已保存的对话历史（route 快照不重复入存，恢复时挂当前 route）。 */
export function loadChatHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(PREFIX + "chat");
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveChatHistory(msgs: ChatMessage[]) {
  try {
    // M15 护栏：原图不进持久化历史（localStorage 容量 + token 膨胀双重防护）
    const slim = msgs.slice(-30).map((m) => ({ ...m, route: undefined, images: undefined }));
    localStorage.setItem(PREFIX + "chat", JSON.stringify(slim));
  } catch {
    /* ignore */
  }
}

/* ---------- M19：规划页 AI 抽屉对话（此前只存内存，刷新即失） ---------- */

export const PLAN_CHAT_KEY = PREFIX + "planchat";

/** 行程指纹：换了行程（标题/目的地/天数变化）就开新会话，避免旧上下文串味。 */
export function routeFingerprint(route: RouteJSON | null | undefined): string {
  if (!route || !route.trip) return "";
  return [route.trip.title || "", route.trip.destination || "", (route.days || []).length].join("|");
}

export function loadPlanChatHistory(fp: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(PLAN_CHAT_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as { fp?: string; msgs?: ChatMessage[] };
    if (!v || !Array.isArray(v.msgs)) return [];
    if (fp && v.fp && v.fp !== fp) return []; // 属于另一条行程的历史：忽略
    return v.msgs.slice(-30);
  } catch {
    return [];
  }
}

export function savePlanChatHistory(msgs: ChatMessage[], fp: string) {
  try {
    // route 快照体积大且能从 itertrip:route 恢复，故不重复入库（与 saveChatHistory 同口径）；
    // 轨迹 trace / 变更清单 / 澄清问答状态都保留（刷新后仍能看到当时 AI 的决定）。
    const slim = msgs.slice(-30).map((m) => ({ ...m, route: undefined }));
    localStorage.setItem(PLAN_CHAT_KEY, JSON.stringify({ fp, msgs: slim }));
  } catch {
    /* 隐私模式 / 超限：放弃持久化，本次会话内存仍可用 */
  }
}

export function clearPlanChatHistory() {
  try {
    localStorage.removeItem(PLAN_CHAT_KEY);
  } catch {
    /* ignore */
  }
}

// ===== 地图显示设置（M16：右下角设置面板，纯前端视图态，不写入 route/后端）=====

export type DayViewMode = "all" | "current";
export type MapSource = "amap" | "osm";
export type ArrowDensity = "dense" | "normal" | "sparse";

export interface MapSettings {
  /** 开关路线：显示/隐藏地图上所有连线与箭头 */
  showRoutes: boolean;
  /** 天视图模式：all=全部显示(当天高亮其余淡化) / current=只显示当天 */
  dayViewMode: DayViewMode;
  /** 是否把当天酒店坐标接入路线终点 */
  connectHotel: boolean;
  /** 地图源：高德 / OSM */
  mapSource: MapSource;
  /** 隐藏「AI 综合建议」块（时间线顶部 summary） */
  showSummary: boolean;
  /** 显示/隐藏价格、时间、门票、备注等 meta 标签 */
  showMeta: boolean;
  /** 箭头密度：dense=每段(现状) / normal=隔1段 / sparse=隔2段 */
  arrowDensity: ArrowDensity;
  /** 箭头大小：0.75 / 1 / 1.25 */
  arrowScale: number;
}

export const DEFAULT_MAP: MapSettings = {
  showRoutes: true,
  dayViewMode: "all",
  connectHotel: true,
  mapSource: "amap",
  showSummary: true,
  showMeta: true,
  arrowDensity: "dense",
  arrowScale: 1,
};

export function loadMapSettings(): MapSettings {
  try {
    const raw = localStorage.getItem(PREFIX + "map");
    if (!raw) return { ...DEFAULT_MAP };
    return { ...DEFAULT_MAP, ...(JSON.parse(raw) as Partial<MapSettings>) };
  } catch {
    return { ...DEFAULT_MAP };
  }
}

export function saveMapSettings(s: MapSettings) {
  try {
    localStorage.setItem(PREFIX + "map", JSON.stringify(s));
  } catch {
    /* 隐私模式等场景写不进就放弃，本次会话内存仍可用 */
  }
}
