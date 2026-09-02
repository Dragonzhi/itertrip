import { useEffect, useRef, useState } from "react";
import { chatStream, type ChatStreamEvent } from "../api/client";
import ChatPanel from "../components/ChatPanel";
import { loadChatHistory, saveChatHistory, type LlmSettings } from "../lib/settings";
import type { ChatMessage } from "../types/chat";

interface ChatProps {
  onRoute: (route: import("../types/route").RouteJSON, source: string) => void;
  onOpenSettings: () => void;
  onBack: () => void;
  prefill?: string;
  /** BYOK 设置：对话请求必须带 X-LLM-* 头 */
  settings: LlmSettings;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** M13 对话页：粘贴攻略文字 / 自然语言 → /api/chat → route JSON → 进规划页。 */
export default function Chat({ onRoute, onOpenSettings, onBack, prefill, settings }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChatHistory());
  const [loading, setLoading] = useState(false);
  /** 流式过程（优化①） */
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const sentPrefillRef = useRef(false);

  useEffect(() => {
    saveChatHistory(messages);
  }, [messages]);

  // 首页「带话过来」：进页面自动发送一次
  useEffect(() => {
    if (prefill && !sentPrefillRef.current) {
      sentPrefillRef.current = true;
      send(prefill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  async function send(text: string) {
    if (loading) return;
    const userMsg: ChatMessage = { id: uid(), role: "user", content: text };
    const history = [...messages, userMsg]
      .filter((m) => !m.error)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    const onEvent = (ev: ChatStreamEvent) => {
      if (ev.event === "stage") setStageLabel(ev.label || null);
      else if (ev.event === "delta") setStreamText((prev) => prev + (ev.text || ""));
    };
    try {
      const r = await chatStream({ prompt: text, history }, settings, onEvent);
      const reply: ChatMessage = { id: uid(), role: "assistant", content: r.reply || streamText };
      setMessages((prev) => [...prev, reply]);
      if (r.route && r.route.days.length > 0) {
        onRoute(r.route, "chat");
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: e instanceof Error ? e.message : String(e), error: true },
      ]);
    } finally {
      setStageLabel(null);
      setStreamText("");
      setLoading(false);
    }
  }

  return (
    <div className="h-screen bg-cream flex flex-col">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-line bg-white">
        <button onClick={onBack} className="text-ink-soft hover:text-ink text-sm font-semibold" title="返回首页">
          ← 返回
        </button>
        <div className="flex items-center gap-2">
          <span className="text-lg">🧭</span>
          <h1 className="text-sm font-bold">IterTrip · 对话规划</h1>
        </div>
        <button
          onClick={onOpenSettings}
          className="ml-auto border border-line bg-white text-ink-soft rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-moss-soft hover:text-moss"
          data-testid="settings-btn"
        >
          ⚙️ 设置
        </button>
      </header>
      <div className="flex-1 min-h-0 max-w-2xl w-full mx-auto">
        <ChatPanel
          messages={messages}
          loading={loading}
          hasRoute={false}
          onSend={send}
          stageLabel={stageLabel}
          streamText={streamText}
        />
      </div>
    </div>
  );
}