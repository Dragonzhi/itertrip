import { useEffect, useRef, useState } from "react";
import { chatStream, mergeTrace, type ChatStreamEvent } from "../api/client";
import ChatPanel from "../components/ChatPanel";
import { loadChatHistory, saveChatHistory, type LlmSettings } from "../lib/settings";
import type { ChatMessage, TraceStep } from "../types/chat";

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
  const [loading, setLoading] = useState(false);
  /** 流式过程（优化①） */
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  /** 实时思考链（推理模型 reasoning_content，淡色小字滚动） */
  const [streamThinking, setStreamThinking] = useState("");
  /** M19 实时决策轨迹（逐步 upsert；终帧后落到消息上持久化） */
  const [liveTrace, setLiveTrace] = useState<TraceStep[]>([]);
  const liveTraceRef = useRef<TraceStep[]>([]);
  const sentPrefillRef = useRef(false);

  useEffect(() => {
    saveChatHistory(messages);
  }, [messages]);

  /** 澄清卡提交/跳过后标记「已回答」，刷新恢复时不再重复渲染 */
  const markAnswered = (id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, answered: true } : m)));
  };

  const clearHistory = () => {
    if (loading) return;
    if (!messages.length) return;
    if (!window.confirm("确定清空当前对话记录吗？此操作不可撤销。")) return;
    sentPrefillRef.current = true; // 清除后不再自动重发 prefill
    setMessages([]);
    setStageLabel(null);
    setStreamText("");
    setStreamThinking("");
    setLiveTrace([]);
    liveTraceRef.current = [];
  };

  // 首页「带话过来」：进页面自动发送一次
  useEffect(() => {
    if (prefill && !sentPrefillRef.current) {
      sentPrefillRef.current = true;
      send(prefill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  async function send(text: string, images?: string[]) {
    if (loading) return;
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text || `📷 攻略截图×${images?.length || 0}`,
      images, // 仅内存态；saveChatHistory 持久化时剔除（M15 护栏）
    };
    const history = [...messages, userMsg]
      .filter((m) => !m.error)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setLiveTrace([]);
    liveTraceRef.current = [];
    const onEvent = (ev: ChatStreamEvent) => {
      if (ev.event === "stage") setStageLabel(ev.label || null);
      else if (ev.event === "thinking") setStreamThinking((prev) => prev + (ev.thinking || ""));
      else if (ev.event === "delta") setStreamText((prev) => prev + (ev.text || ""));
      else if (ev.event === "trace") {
        liveTraceRef.current = mergeTrace(liveTraceRef.current, ev.step);
        setLiveTrace(liveTraceRef.current);
      }
    };
    try {
      const r = await chatStream({ prompt: text, history, images }, settings, onEvent);
      const trace = r.trace && r.trace.length ? r.trace : liveTraceRef.current;
      const reply: ChatMessage = {
        id: uid(), role: "assistant", content: r.reply || streamText, questions: r.questions,
        trace: trace.length ? trace : undefined, stats: r.stats,
      };
      setMessages((prev) => [...prev, reply]);
      if (r.route && r.route.days.length > 0) {
        onRoute(r.route, "chat");
      }
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      // M15：后端识别出模型不支持图片 → 回写 vision=false 置灰截图入口，展示时去掉机器标记
      if (msg.includes("[vision-unsupported]")) {
        onPatchSettings({ vision: false });
        msg = msg.replace("[vision-unsupported]", "").trim();
      }
      setMessages((prev) => [
        ...prev,
        {
          id: uid(), role: "assistant", content: msg, error: true,
          trace: liveTraceRef.current.length ? liveTraceRef.current : undefined,
        },
      ]);
    } finally {
      setStageLabel(null);
      setStreamText("");
      setStreamThinking("");
      setLiveTrace([]);
      liveTraceRef.current = [];
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
          onClick={clearHistory}
          disabled={loading || !messages.length}
          className="ml-auto border border-line bg-white text-ink-soft rounded-full px-3 py-1.5 text-xs font-semibold hover:bg-[#F6E7E7] hover:text-[#B85C5C] disabled:opacity-35 disabled:cursor-not-allowed"
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
          loading={loading}
          hasRoute={false}
          onSend={send}
          vision={settings.vision}
          stageLabel={stageLabel}
          streamText={streamText}
          streamThinking={streamThinking}
          liveTrace={liveTrace}
          onAnswered={markAnswered}
        />
      </div>
    </div>
  );
}