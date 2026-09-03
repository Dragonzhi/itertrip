import { useEffect, useRef, useState } from "react";
import CalendarPicker from "./CalendarPicker";
import ThinkingBlock from "./ThinkingBlock";
import type { ChatMessage, ClarifyQuestion } from "../types/chat";

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  hasRoute: boolean;
  onSend: (text: string) => void;
  /** 流式过程（优化①）：阶段播报 + 正在流出的回复文本 */
  stageLabel?: string | null;
  streamText?: string;
  /** 实时思考链（推理模型 reasoning_content，淡色小字滚动） */
  streamThinking?: string;
}

const EXAMPLES = [
  { icon: "📝", text: "想去成都玩 3 天，节奏松一点" },
  { icon: "🗺️", text: "帮我把第二天排松一点" },
  { icon: "🍽️", text: "第二天加点本地美食" },
];

/** 判断是否为日期题：type=date 或语义命中日期关键词（兼容旧模型 type=text） */
function isDateLike(q: ClarifyQuestion): boolean {
  if (q.type === "date") return true;
  if (q.type !== "text") return false;
  const hay = (q.key || "") + (q.label || "") + (q.placeholder || "");
  return /(日期|时间|出发|入住|到达|返程|date|time)/i.test(hay);
}

/** 单个问题的输入控件（text / date / select+自定义 / multi+自定义）。 */
function QuestionInput({
  q, value, customValue, multiCustomInput, onText, onSelect, onToggle, onCustomText, onMultiCustomInput, onAddMultiCustom,
}: {
  q: ClarifyQuestion;
  value: string | Set<string>;
  customValue?: string;
  multiCustomInput?: string;
  onText: (v: string) => void;
  onSelect: (v: string) => void;
  onToggle: (v: string) => void;
  onCustomText?: (v: string) => void;
  onMultiCustomInput?: (v: string) => void;
  onAddMultiCustom?: () => void;
}) {
  if (q.type === "text" || (q as any).type === "date") {
    // date-like text 升级为日历
    if (isDateLike(q) || q.type === "date") {
      return <CalendarPicker value={(value as string) || ""} onChange={onText} placeholder={q.placeholder || "选择日期"} />;
    }
    return (
      <input
        type="text"
        value={(value as string) || ""}
        onChange={(e) => onText(e.target.value)}
        placeholder={q.placeholder || "请输入"}
        className="w-full border border-line rounded-lg px-2.5 py-1.5 text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
      />
    );
  }
  if (q.type === "select") {
    const opts = q.options || [];
    const withCustom = [...opts, { value: "__custom__", label: "自定义… ✎" }];
    const selVal = (value as string) || "";
    const isCustom = selVal === "__custom__";
    if (opts.length) {
      return (
        <div className="space-y-1.5">
          <select
            value={selVal}
            onChange={(e) => onSelect(e.target.value)}
            className="w-full border border-line rounded-lg px-2.5 py-1.5 text-[13px] text-ink bg-white"
            data-testid="clarify-select"
          >
            <option value="">请选择…</option>
            {withCustom.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {isCustom && (
            <input
              type="text"
              value={customValue || ""}
              onChange={(e) => onCustomText?.(e.target.value)}
              placeholder={q.placeholder || "请输入自定义内容"}
              autoFocus
              data-testid="clarify-custom-input"
              className="w-full border border-line rounded-lg px-2.5 py-1.5 text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
            />
          )}
        </div>
      );
    }
    return (
      <input
        type="text"
        value={selVal}
        onChange={(e) => onText(e.target.value)}
        placeholder={q.placeholder || "请输入"}
        className="w-full border border-line rounded-lg px-2.5 py-1.5 text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
      />
    );
  }
  // multi + custom input
  const sel = (value as Set<string>) || new Set<string>();
  const opts = q.options || [];
  const customEntries = [...sel].filter((v) => String(v).startsWith("__custom:"));
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {opts.length === 0 && !customEntries.length && sel.size === 0 && (
          <span className="text-xs text-ink-soft">点击下方输入自定义偏好</span>
        )}
        {opts.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onToggle(o.value)}
            className={
              "px-2.5 py-1 rounded-full border text-xs font-semibold transition-colors " +
              (sel.has(o.value) ? "bg-moss text-white border-moss" : "border-line text-ink-soft hover:border-moss")
            }
          >
            {o.label}
          </button>
        ))}
        {customEntries.map((v) => {
          const label = String(v).slice("__custom:".length);
          return (
            <span key={String(v)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border bg-moss text-white border-moss text-xs font-semibold">
              {label}
              <button type="button" onClick={() => onToggle(String(v))} aria-label="删除" className="ml-0.5 leading-none">×</button>
            </span>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={multiCustomInput || ""}
          onChange={(e) => onMultiCustomInput?.(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAddMultiCustom?.(); } }}
          placeholder="自定义输入，回车添加"
          data-testid="clarify-multi-custom-input"
          className="flex-1 min-w-0 border border-line rounded-lg px-2.5 py-1.5 text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
        />
        <button type="button" onClick={() => onAddMultiCustom?.()} data-testid="clarify-multi-custom-add" className="shrink-0 border border-line bg-white rounded-lg px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-moss-soft hover:text-moss">+ 添加</button>
      </div>
    </div>
  );
}

/** 澄清问题卡：渲染 AI 待答问题，组装答案提交或跳过。 */
export function ClarifyCard({
  questions, msgId, disabled, onSend,
}: {
  questions: ClarifyQuestion[];
  msgId: string;
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string | Set<string>>>({});
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({});
  const [multiCustomInputs, setMultiCustomInputs] = useState<Record<string, string>>({});
  const answeredRef = useRef<Set<string>>(new Set<string>());
  if (answeredRef.current.has(msgId)) return null; // 已提交收起

  const setVal = (key: string, v: string | Set<string>) => setValues((prev) => ({ ...prev, [key]: v }));

  const buildAnswer = (): string => {
    const parts: string[] = [];
    for (const q of questions) {
      const renderType: string = isDateLike(q) ? "date" : q.type;
      const raw = values[q.key];
      if (renderType === "multi") {
        const s = (raw as Set<string>) || new Set<string>();
        // 合并输入框中未回车的残留文本
        const pending = (multiCustomInputs[q.key] || "").trim();
        const all = new Set(s);
        if (pending) all.add("__custom:" + pending);
        if (!all.size) continue;
        const labels = [...all].map((v) => {
          if (String(v).startsWith("__custom:")) return String(v).slice("__custom:".length);
          const o = q.options?.find((x) => x.value === v);
          return o ? o.label : String(v);
        }).join("、");
        parts.push(q.label + "：" + labels);
      } else if (renderType === "date") {
        const vv = (raw as string) || "";
        if (vv.trim()) parts.push(q.label + "：" + vv.trim());
      } else if (q.type === "select") {
        const vv = (raw as string) || "";
        if (!vv) continue;
        if (vv === "__custom__") {
          const t = (customTexts[q.key] || "").trim();
          if (t) parts.push(q.label + "：" + t);
        } else {
          const o = q.options?.find((x) => x.value === vv);
          parts.push(q.label + "：" + (o ? o.label : vv));
        }
      } else {
        const vv = (raw as string) || "";
        if (vv.trim()) parts.push(q.label + "：" + vv.trim());
      }
    }
    return parts.length ? parts.join("；") : "";
  };

  const submitAnswer = () => {
    answeredRef.current.add(msgId);
    const ans = buildAnswer();
    onSend(ans ? "好的，以下是我的选择：" + ans : "没什么特别偏好，按合理的默认来规划即可。");
  };

  return (
    <div className="mt-2 pt-2 border-t border-line/60" data-testid="clarify-questions">
      <div className="flex items-center gap-1.5 text-xs text-moss font-medium mb-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-moss" />
        规划前想先确认几点…
      </div>
      <div className="space-y-2">
        {(questions || []).slice(0, 5).map((q) => (
          <div key={q.key || q.label} className="flex flex-col gap-1">
            <div className="text-xs font-semibold text-ink">{q.label}</div>
            <QuestionInput
              q={q}
              value={values[q.key] ?? (isDateLike(q) || q.type === "date" ? "" : q.type === "multi" ? new Set<string>() : "")}
              customValue={customTexts[q.key]}
              multiCustomInput={multiCustomInputs[q.key] || ""}
              onText={(v) => setVal(q.key, v)}
              onSelect={(v) => setVal(q.key, v)}
              onToggle={(v) => {
                const cur = values[q.key] instanceof Set ? new Set(values[q.key] as Set<string>) : new Set<string>();
                if (cur.has(v)) cur.delete(v); else cur.add(v);
                setVal(q.key, cur);
              }}
              onCustomText={(v) => setCustomTexts((p) => ({ ...p, [q.key]: v }))}
              onMultiCustomInput={(v) => setMultiCustomInputs((p) => ({ ...p, [q.key]: v }))}
              onAddMultiCustom={() => {
                const t = (multiCustomInputs[q.key] || "").trim();
                if (!t) return;
                const cur = values[q.key] instanceof Set ? new Set(values[q.key] as Set<string>) : new Set<string>();
                cur.add("__custom:" + t);
                setVal(q.key, cur);
                setMultiCustomInputs((p) => ({ ...p, [q.key]: "" }));
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-2.5">
        <button
          type="button"
          onClick={submitAnswer}
          disabled={disabled}
          data-testid="clarify-submit"
          className="bg-moss text-white rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-[#175740] disabled:opacity-40"
        >
          ✓ 开始规划
        </button>
        <button
          type="button"
          onClick={() => { answeredRef.current.add(msgId); onSend("按合理默认来规划即可。"); }}
          disabled={disabled}
          data-testid="clarify-skip"
          className="border border-line bg-white text-ink-soft rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-moss-soft"
        >
          跳过
        </button>
      </div>
    </div>
  );
}

/** M13 对话面板：攻略粘贴/自然语言 → 路线；展示 AI 修改叙述（DESIGN §2）。M17 加澄清问题卡。 */
export default function ChatPanel({ messages, loading, hasRoute, onSend, stageLabel, streamText, streamThinking }: ChatPanelProps) {
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, loading, streamText, stageLabel, streamThinking]);

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
          <div key={m.id} className={m.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"}>
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
            {m.role === "assistant" && m.questions && m.questions.length > 0 && (
              <div className="w-full max-w-[90%] bg-white border border-line rounded-[14px] px-3.5 py-2.5 mt-1.5 shadow-sm">
                <ClarifyCard questions={m.questions} msgId={m.id} disabled={loading} onSend={onSend} />
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="space-y-1.5" data-testid="ai-streaming">
            {stageLabel && (
              <div className="flex items-center gap-1.5 text-xs text-moss font-medium px-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-moss animate-pulse" />
                {stageLabel}
              </div>
            )}
{streamThinking && <ThinkingBlock text={streamThinking} />}
            {streamText && (
              <div className="flex justify-start">
                <div className="max-w-[90%] bg-white border border-line rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {streamText}
                  <span className="inline-block w-[2px] h-[14px] bg-moss align-middle ml-0.5 animate-pulse" />
                </div>
              </div>
            )}
            {!streamText && !stageLabel && !streamThinking && (
              <div className="text-xs text-ink-soft animate-pulse px-1">AI 正在思考…</div>
            )}
          </div>
        )}
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