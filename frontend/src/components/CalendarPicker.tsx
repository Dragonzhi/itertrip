import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  value: string; // YYYY-MM-DD or ""
  onChange: (v: string) => void;
  placeholder?: string;
}

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function parseISO(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function formatISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + dd;
}

function formatDisplay(iso: string): string {
  const dt = parseISO(iso);
  if (!dt) return iso;
  const w = ["日", "一", "二", "三", "四", "五", "六"][dt.getDay()];
  return dt.getFullYear() + "年" + (dt.getMonth() + 1) + "月" + dt.getDate() + "日 周" + w;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** 周一起始：把 JS 的 0(日) 映射为 6，1(一) 为 0 */
function startWeekday(y: number, m: number): number {
  const w = new Date(y, m, 1).getDay();
  return w === 0 ? 6 : w - 1;
}

function todayISO(): string {
  const n = new Date();
  return formatISO(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
}

export default function CalendarPicker({ value, onChange, placeholder }: Props) {
  const parsed = parseISO(value);
  const init = parsed || new Date();
  const [viewYear, setViewYear] = useState(init.getFullYear());
  const [viewMonth, setViewMonth] = useState(init.getMonth());
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const p = parseISO(value);
    if (p) {
      setViewYear(p.getFullYear());
      setViewMonth(p.getMonth());
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(() => {
    const first = startWeekday(viewYear, viewMonth);
    const dim = daysInMonth(viewYear, viewMonth);
    const prevDim = daysInMonth(viewYear, viewMonth - 1 < 0 ? 11 : viewMonth - 1);
    const out: { d: number; m: number; y: number; muted: boolean }[] = [];
    for (let i = 0; i < first; i++) {
      const d = prevDim - first + 1 + i;
      const m = viewMonth - 1 < 0 ? 11 : viewMonth - 1;
      const y = viewMonth - 1 < 0 ? viewYear - 1 : viewYear;
      out.push({ d, m, y, muted: true });
    }
    for (let d = 1; d <= dim; d++) out.push({ d, m: viewMonth, y: viewYear, muted: false });
    while (out.length < 42) {
      const last = out.length - first - dim;
      const d = last + 1;
      const m = viewMonth + 1 > 11 ? 0 : viewMonth + 1;
      const y = viewMonth + 1 > 11 ? viewYear + 1 : viewYear;
      out.push({ d, m, y, muted: true });
    }
    return out;
  }, [viewYear, viewMonth]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); } else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); } else setViewMonth((m) => m + 1);
  };

  const pick = (y: number, m: number, d: number) => {
    const iso = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    onChange(iso);
    setOpen(false);
  };

  const tISO = todayISO();

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="date-picker-trigger"
        className={
          "w-full flex items-center justify-between gap-2 border rounded-lg px-2.5 py-2 text-[13px] text-left transition-colors " +
          (value ? "border-moss bg-moss-soft text-ink" : "border-line bg-white text-ink-soft hover:border-moss")
        }
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm">📅</span>
          <span className="truncate">{value ? formatDisplay(value) : (placeholder || "选择日期")}</span>
        </span>
        <span className="text-ink-soft shrink-0">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="选择日期"
          data-testid="calendar-popup"
          className="absolute left-0 top-[calc(100%+6px)] z-[600] w-[280px] max-w-[calc(100vw-32px)] bg-white border border-line rounded-xl shadow-card p-2.5"
        >
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth} aria-label="上月" className="w-7 h-7 rounded-lg hover:bg-moss-soft flex items-center justify-center text-ink">
              ‹
            </button>
            <span className="text-[13px] font-bold text-ink">{viewYear}年 {viewMonth + 1}月</span>
            <button type="button" onClick={nextMonth} aria-label="下月" className="w-7 h-7 rounded-lg hover:bg-moss-soft flex items-center justify-center text-ink">
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1" role="row">
            {WEEK_LABELS.map((w) => (
              <span key={w} className="text-center text-[11px] font-semibold text-ink-soft py-1">{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5" role="grid">
            {cells.map((c, i) => {
              const iso = c.y + "-" + String(c.m + 1).padStart(2, "0") + "-" + String(c.d).padStart(2, "0");
              const isSelected = value === iso;
              const isToday = tISO === iso;
              return (
                <button
                  key={i}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  onClick={() => pick(c.y, c.m, c.d)}
                  className={
                    "h-7 rounded-lg text-xs flex items-center justify-center transition-colors " +
                    (isSelected
                      ? "bg-moss text-white font-bold"
                      : isToday
                        ? "border border-moss text-moss font-semibold bg-moss-soft"
                        : c.muted
                          ? "text-ink-soft/40"
                          : "text-ink hover:bg-moss-soft")
                  }
                >
                  {c.d}
                </button>
              );
            })}
          </div>
          <div className="flex gap-1.5 mt-2.5 pt-2 border-t border-line/60">
            <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="flex-1 border border-line rounded-lg py-1.5 text-xs font-semibold text-ink-soft hover:bg-cream">
              清空
            </button>
            <button type="button" onClick={() => { onChange(tISO); setOpen(false); }} className="flex-1 border border-moss rounded-lg py-1.5 text-xs font-bold text-moss hover:bg-moss-soft">
              今天
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
