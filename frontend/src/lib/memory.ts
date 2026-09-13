/**
 * M18 旅行记忆库：匿名档案 id + 请求头注入。
 *
 * 档案 id 是浏览器本地生成的随机串（localStorage `itertrip:tid`），只作为**记忆库 namespace**，
 * 不含任何身份信息（本项目无账号体系），也用于把「你的攻略记忆」与别人的隔开。
 * localStorage 写不进（隐私模式）时返回空串 —— 记忆功能按关闭处理，主线功能不受影响。
 */
const TID_KEY = "itertrip:tid";

/** 读取（必要时生成并持久化）匿名档案 id。 */
export function travelerId(): string {
  try {
    const cur = localStorage.getItem(TID_KEY);
    if (cur) return cur;
    const raw =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    const tid = raw.replace(/[^0-9a-zA-Z\-_]/g, "").slice(0, 64);
    if (!tid) return "";
    localStorage.setItem(TID_KEY, tid);
    return tid;
  } catch {
    return "";
  }
}

/** 记忆库请求头（无档案 id 时返回空对象，后端按「记忆关闭」处理）。 */
export function memoryHeaders(): Record<string, string> {
  const tid = travelerId();
  return tid ? { "X-Traveler-Id": tid } : {};
}
