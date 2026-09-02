export type ChatRole = "user" | "assistant";

export type ChatIntent = "route_edit" | "chitchat";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** 改路线意图的完整路由快照（仅 assistant 携带） */
  route?: RouteJSON;
  /** 本条是否触发了实际路线变更（前端 diff 后写入） */
  changed?: boolean;
  /** 出错标记 */
  error?: boolean;
  /** AI 执行了哪些修改的短叙述（由前端 diff 生成，DESIGN §2「我改了什么」） */
  changeSummary?: string[];
}

import type { RouteJSON } from "./route";
