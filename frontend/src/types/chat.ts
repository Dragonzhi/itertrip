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

/* ---------- M19 决策轨迹：把 AI 的关键决策摊开给用户看（替代「盲盒」体验） ---------- */

export type TraceKind = "provider" | "memory" | "llm" | "retry" | "geocode" | "facts" | "edit" | "summary";

export type TraceStatus = "run" | "done" | "warn" | "fail" | "skip";

/** 一步决策记录（后端 SSE `trace` 事件 / 终帧 reply.trace 同构）。 */
export interface TraceStep {
  id: string;
  kind: TraceKind;
  status: TraceStatus;
  title: string;
  detail?: string;
  ms?: number;
  meta?: Record<string, unknown>;
}

/** 本轮统计（reply.stats）：耗时/尝试次数/地点数/命中记忆数/实际使用的模型。 */
export interface TraceStats {
  elapsed_ms?: number;
  attempts?: number;
  places?: number;
  geocoded?: number;
  replaced?: number;
  memory_hits?: number;
  model?: string;
  provider?: string;
  /** M22 本轮闭馆日冲突条数（0 或省略表示无冲突） */
  fact_warnings?: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** M15 随消息发送的截图（data URL，仅内存态；持久化历史不含图片） */
  images?: string[];
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
  /** M19 本轮决策轨迹（流内实时累积，终帧由后端补齐；随消息持久化，刷新后可重放） */
  trace?: TraceStep[];
  /** M19 本轮统计（模型/耗时/坐标写入数） */
  stats?: TraceStats;
}

import type { RouteJSON } from "./route";
