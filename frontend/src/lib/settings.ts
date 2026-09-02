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
    const slim = msgs.slice(-30).map((m) => ({ ...m, route: undefined }));
    localStorage.setItem(PREFIX + "chat", JSON.stringify(slim));
  } catch {
    /* ignore */
  }
}
