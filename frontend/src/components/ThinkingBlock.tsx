import { useEffect, useRef, useState } from "react";

interface Props {
  text: string;
}

/** 可折叠的思考链块：默认收起，点击展开查看实时滚动 */
export default function ThinkingBlock({ text }: Props) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, open]);

  if (!text) return null;

  return (
    <div
      className="max-w-[90%] border border-line/40 rounded-xl overflow-hidden bg-cream/60"
      data-testid="thinking-stream"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-ink-soft hover:text-ink transition-colors text-left"
        aria-expanded={open}
        data-testid="thinking-toggle"
      >
        <span className="inline-block text-[10px] leading-none select-none">{open ? "▼" : "▶"}</span>
        <span className="text-[10px]">🤔</span>
        <span className="font-medium">思考过程</span>
        <span className="font-mono text-ink-soft/60">{text.length} 字</span>
        <span className="ml-auto text-[10px] text-moss font-semibold shrink-0">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          className="max-h-[180px] overflow-y-auto px-2.5 pb-2 pt-0.5 text-[11px] text-ink-soft/70 leading-relaxed whitespace-pre-wrap break-words font-mono border-t border-line/30"
        >
          {text}
        </div>
      )}
    </div>
  );
}
