import type { RouteJSON } from "../types/route";

/**
 * 导入行程：支持 IterTrip 导出的 .json 与自包含 .html（内嵌 const TRIP = {...}）。
 * 结构非法时抛中文错误，调用方直接展示。
 */
export function parseRouteFile(text: string, filename: string): RouteJSON {
  const lower = (filename || "").toLowerCase();
  let raw: unknown;
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    raw = extractFromHtml(text);
  } else {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("不是有效的 JSON 文件");
    }
  }
  return validateRoute(raw);
}

/**
 * 从导出 HTML 提取内嵌行程：定位 "const TRIP = " 后做括号状态机配对
 * （容忍字符串值里出现花括号 / 引号 / 转义），比正则截取稳健。
 */
function extractFromHtml(html: string): unknown {
  const anchor = html.indexOf("const TRIP = ");
  if (anchor === -1) throw new Error("这不是 IterTrip 导出的行程 HTML");
  const start = html.indexOf("{", anchor);
  if (start === -1) throw new Error("行程 HTML 中未找到内嵌数据");
  let depth = 0;
  let inStr: string | null = null;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          throw new Error("行程 HTML 内嵌数据解析失败");
        }
      }
    }
  }
  throw new Error("行程 HTML 内嵌数据不完整");
}

/** 最小结构校验：trip.destination + 非空 days；字段细节由编辑器/后端容错。 */
function validateRoute(v: unknown): RouteJSON {
  const r = v as RouteJSON;
  if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("行程数据格式不对（顶层应是对象）");
  if (!r.trip || typeof r.trip.destination !== "string" || !r.trip.destination.trim()) {
    throw new Error("缺少 trip.destination —— 这可能不是 IterTrip 行程文件");
  }
  if (!Array.isArray(r.days) || r.days.length === 0) throw new Error("行程没有 days 数据");
  return r;
}
