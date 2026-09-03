export type ChatRole = "user" | "assistant";

export type ChatIntent = "route_edit" | "chitchat";

export type ClarifyQuestionType = "text" | "select" | "multi" | "date";

/** Agent 式澄清问题（M17）：AI 信息不足时向用户提问。 */
export interface ClarifyQuestion {
  key: string;
  label: string;
  type: ClarifyQuestionType;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

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
  /** AI 待答问题卡（M17，仅 assistant 携带） */
  questions?: ClarifyQuestion[];
  /** 该条问题是否已回答（收起为普通文本，避免重复渲染） */
  answered?: boolean;
}

import type { RouteJSON } from "./route";
