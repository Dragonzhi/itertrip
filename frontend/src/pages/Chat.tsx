import { useEffect, useRef, useState } from "react";
import { useChatStream } from "../hooks/useChatStream";
import ChatPanel from "../components/ChatPanel";
import { loadChatHistory, saveChatHistory, type LlmSettings } from "../lib/settings";
import { describeStreamError } from "../lib/streamWatch";
import type { ChatMessage } from "../types/chat";

interface ChatProps {
  onRoute: (route: import("../types/route").RouteJSON, source: string) => void;
  onOpenSettings: () => void;
  onBack: () => void;
  prefill?: string;
  /** BYOK 设置：对话请求必须带 X-LLM-* 头 */
  settings: LlmSettings;
  /** M15：探测发现模型不支持图片时回写 vision=false，置灰截图入口 */
  onPatchSettings: (patch: Partial<LlmSettings>) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** M13 对话页：粘贴攻略文字 / 自然语言 → /api/chat → route JSON → 进规划页。 */
export default function Chat({ onRoute, onOpenSettings, onBack, prefill, settings, onPatchSettings }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChatHistory());
  const sentPrefillRef = useRef(false);

  useEffect(() => {
    saveChatHistory(messages);
  }, [messages]);

  /**
   * 优化②：流式状态与中断统一交给 useChatStream。三类结果分开处理，**绝不假成功**：
   * 正常终帧才落回复/跳规划页；报错落错误气泡；中断保留已生成的部分并标「已中断」。
   */
  const stream = useChatStream({
    onReply: (r, partial, trace) => {
      const reply: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: r.reply || partial,
        questions: r.questions,
        trace: trace.length ? trace : undefined,
        stats: r.stats,
      };
      setMessages((prev) => [...prev, reply]);
      if (r.route && r.route.days.length > 0) onRoute(r.route, "chat");
    },
    onError: (e, _partial, trace) => {
      let msg = describeStreamError(e);
      // M15：后端识别出模型不支持图片 → 回写 vision=false 置灰截图入口，展示时去掉机器标记
      if (msg.includes("[vision-unsupported]")) {
        onPatchSettings({ vision: false });
        msg = msg.replace("[vision-unsupported]", "").trim();
      }
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: msg, error: true, trace: trace.length ? trace : undefined },
      ]);
    },
    onInterrupt: (partial, reason, trace) => {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: partial || (reason === "watchdog" ? "服务端长时间没有响应，已自动中断。" : "已停止生成。"),
          interrupted: true,
          trace: trace.length ? trace : undefined,
        },
      ]);
    },
  });

  /** 澄清卡提交/跳过后标记「已回答」，刷新恢复时不再重复渲染 */
  const markAnswered = (id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, answered: true } : m)));
  };

  const clearHistory = () => {
    if (stream.sending) return;
    if (!messages.length) return;
    if (!window.confirm("确定清空当前对话记录吗？此操作不可撤销。")) return;
    sentPrefillRef.current = true; // 清除后不再自动重发 prefill
    setMessages([]);
  };

  async function send(text: string, images?: string[]) {
    if (stream.sending) return;
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text || "📷 攻略截图×" + (images?.length || 0),
      images, // 仅内存态；saveChatHistory 持久化时剔除（M15 护栏）
    };
    const history = [...messages, userMsg]
      .filter((m) => !m.error)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    await stream.send({ prompt: text, history, images }, settings);
  }

  // 首页「带话过来」：进页面自动发送一次
  useEffect(() => {
    if (prefill && !sentPrefillRef.current) {
      sentPrefillRef.current = true;
      void send(prefill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  return (
    <div className="h-[100dvh] bg-cream flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-line bg-white">
        <button onClick={onBack} className="text-ink-soft hover:text-ink text-sm font-semibold" title="返回首页">
          ← 返回
        </button>
        <div className="flex items-center gap-2">
          <span className="text-lg">🧭</span>
          <h1 className="text-sm font-bold">IterTrip · 对话规划</h1>
        </div>
        <button
          onClick={clearHistory}
          disabled={stream.sending || !messages.length}
          className="ml-auto border border-line bg-white text-ink-soft rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-[#F6E7E7] hover:text-danger disabled:opacity-35 disabled:cursor-not-allowed"
          title="清空当前对话记录"
          data-testid="clear-chat"
        >
          🗑 清除记录
        </button>
        <button
          onClick={onOpenSettings}
          className="border border-line bg-white text-ink-soft rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-moss-soft hover:text-moss"
          data-testid="settings-btn"
        >
          ⚙️ 设置
        </button>
      </header>
      <div className="flex-1 min-h-0 max-w-2xl w-full mx-auto">
        <ChatPanel
          messages={messages}
          stream={stream}
          hasRoute={false}
          onSend={send}
          vision={settings.vision}
          onAnswered={markAnswered}
        />
      </div>
    </div>
  );
}
