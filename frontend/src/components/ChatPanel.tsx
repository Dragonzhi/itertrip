import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../types/chat";

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  hasRoute: boolean;
  onSend: (text: string) => void;
}

const EXAMPLES = [
  { icon: "📝", text: "想去成都玩 3 天，节奏松一点" },
  { icon: "🗺️", text: "帮我把第二天排松一点" },
  { icon: "🍽️", text: "第二天加点本地美食" },
];

/** M13 对话面板：攻略粘贴/自然语言 → 路线；展示 AI 修改叙述（DESIGN §2）。 */
export default function ChatPanel({ messages, loading, hasRoute, onSend }: ChatPanelProps) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, loading]);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || loading) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 pt-2 pb-3 space-y-3 min-h-0">
        {messages.length === 0 && !loading && (
          <div className="text-center pt-6 px-2">
            <div className="text-3xl mb-2">🧭</div>
            <p className="text-sm font-bold mb-1">把攻略丢进来，变成一张地图</p>
            <p className="text-xs text-ink-soft leading-relaxed">
              粘贴小红书 / 公众号攻略文字，或直接说想去哪儿、玩几天。
              <br />
              生成后：对话可改路线，右侧时间线可拖拽精修，随时撤销。
            </p>
            <div className="mt-4 flex flex-col gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.text}
                  onClick={() => onSend(ex.text)}
                  className="text-left text-xs border border-line bg-white rounded-xl px-3 py-2 hover:border-moss hover:bg-moss-soft transition-colors"
                >
                  {ex.icon} {ex.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] bg-moss text-white rounded-2xl rounded-br-sm px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words"
                  : "max-w-[90%] bg-white border border-line rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words" +
                    (m.error ? " border-[#E0C3C3] bg-[#FDF4F4]" : "")
              }
            >
              {m.content}
              {m.changeSummary && m.changeSummary.length > 0 && (
                <ul className="mt-1.5 pt-1.5 border-t border-line/60 space-y-0.5" data-testid="change-summary">
                  {m.changeSummary.map((s, i) => (
                    <li key={i} className="text-xs text-moss font-medium">✓ {s}</li>
                  ))}
                </ul>
              )}
              {m.role === "assistant" && m.changed && (
                <div className="text-[11px] text-ink-soft mt-1">地图已更新 · 可撤销</div>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="text-xs text-ink-soft animate-pulse px-1">AI 正在思考…</div>}
      </div>
      <form onSubmit={submit} className="border-t border-line bg-white p-2.5">
        <div className="flex gap-2 items-end">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="粘贴攻略文字，或说「想去成都 3 天」…"
            className="flex-1 resize-none border border-line rounded-xl px-3 py-2 text-sm text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
          />
          <button
            type="submit"
            disabled={!text.trim() || loading}
            className="bg-moss text-white rounded-xl px-4 py-2.5 text-sm font-bold hover:bg-[#175740] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            发送
          </button>
        </div>
        <p className="text-[10px] text-[#A8A298] mt-1.5">
          {hasRoute ? "当前行程可继续对话修改 · Enter 发送 · Shift+Enter 换行" : "Enter 发送 · Shift+Enter 换行"}
        </p>
      </form>
    </div>
  );
}