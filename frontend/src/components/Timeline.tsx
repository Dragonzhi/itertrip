import { useRef, useState } from "react";
import type { RouteJSON } from "../types/route";
import { dayColor, emojiFor } from "../mapCore";
import HotelCard from "./HotelCard";

interface TimelineProps {
  route: RouteJSON;
  activeKey: string | null;          // "d{di}-p{pi}" | "d{di}-hotel"
  onPlaceClick: (di: number, pi: number) => void;
  onHotelClick: (di: number) => void;
  editing?: boolean;                 // 编辑器开关（Phase 3 默认开启）
  onDeletePlace?: (di: number, pi: number) => void;
  onEditPlace?: (di: number, pi: number) => void;
  onDropMove?: (srcDi: number, srcPi: number, dstDi: number, dstPi: number) => void;
}

/** 时间线面板：按天分组、可折叠；点击条目与地图双向联动。 */
export default function Timeline({
  route, activeKey, onPlaceClick, onHotelClick,
  editing = false, onDeletePlace, onEditPlace, onDropMove,
}: TimelineProps) {
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const dragRef = useRef<{ di: number; pi: number } | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);

  const toggle = (di: number) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(di)) next.delete(di);
      else next.add(di);
      return next;
    });
  };

  return (
    <div>
      {route.summary && route.summary.length > 0 && (
        <div className="moss text-[#F4FBF6] rounded-[14px] px-4 py-4 my-1.5 mb-5">
          <h2 className="text-sm font-bold mb-2">🧠 AI 综合建议</h2>
          <ul>
            {route.summary.map((s, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed pl-4 relative mb-1 before:content-['✦'] before:absolute before:left-0 before:text-gold">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {route.days.map((day, di) => {
        const color = dayColor(di);
        const isClosed = closed.has(di);
        return (
          <div
              key={di}
              onDragOver={(e) => {
                if (!editing || !dragRef.current) return;
                e.preventDefault();
                setDragOverDay(di);
              }}
              onDrop={(e) => {
                if (!editing || !dragRef.current) return;
                e.preventDefault();
                const src = dragRef.current;
                dragRef.current = null;
                setDragOverDay(null);
                if (!onDropMove) return;
                // 计算插入索引：指针上方（前半）的条目数；同天先删后插补偿在 onDropMove 内做
                const container = e.currentTarget as HTMLElement;
                const items = Array.from(container.querySelectorAll(".place-item")) as HTMLElement[];
                let dstPi = items.length;
                for (let i = 0; i < items.length; i++) {
                  const r = items[i].getBoundingClientRect();
                  if (e.clientY < r.top + r.height / 2) {
                    // 找到该 DOM 条目对应的索引：按 data-key 解析
                    const k = items[i].getAttribute("data-key") || "";
                    const m = k.match(/-p(\d+)$/);
                    dstPi = m ? Number(m[1]) : i;
                    break;
                  }
                }
                onDropMove(src.di, src.pi, di, dstPi);
              }}
              className={`mb-7 ${dragOverDay === di ? "outline-2 outline-dashed outline-moss rounded-lg" : ""}`}
            >
            <button
              type="button"
              onClick={() => toggle(di)}
              className="w-full flex items-center gap-2.5 px-1 pt-4 pb-2.5 border-b-2 border-line cursor-pointer select-none text-left"
            >
              <span
                className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-white font-extrabold text-[13px] shrink-0"
                style={{ background: color }}
              >
                D{day.day || di + 1}
              </span>
              <span className="flex-1 text-[15px] font-bold">
                第 {day.day || di + 1} 天
                {day.theme && <span className="block text-xs font-normal text-ink-soft mt-px">{day.theme}</span>}
              </span>
              <span className={`text-ink-soft text-xs transition-transform duration-200 ${isClosed ? "-rotate-90" : ""}`}>▾</span>
            </button>

            {!isClosed && (
              <div>
                {(day.places || []).map((p, pi) => {
                  const key = `d${di}-p${pi}`;
                  const isActive = activeKey === key;
                  return (
                    <div
                      key={key}
                      data-key={key}
                      onClick={() => onPlaceClick(di, pi)}
                      draggable={editing}
                      onDragStart={(e) => {
                        if (!editing) return;
                        dragRef.current = { di, pi };
                        e.dataTransfer.effectAllowed = "move";
                        try { e.dataTransfer.setData("text/plain", key); } catch { /* noop */ }
                      }}
                      onDragEnd={() => { dragRef.current = null; setDragOverDay(null); }}
                      onDragOver={(e) => {
                        if (!editing || !dragRef.current) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverDay(di);
                      }}
                      className={`place-item flex gap-2.5 py-2.5 pr-2 pl-1 border-b border-dashed border-line cursor-pointer rounded-lg transition-colors relative ${isActive ? "bg-gold-soft" : "hover:bg-white"}`}
                    >
                      <div className="w-[34px] h-[34px] rounded-[10px] shrink-0 flex items-center justify-center text-lg bg-white border border-line">
                        {emojiFor(p)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold">{p.name}</div>
                        <div className="text-xs text-ink-soft mt-0.5 leading-relaxed">
                          {p.time && <span className="inline-block bg-moss-soft text-moss rounded-md px-1.5 mr-1.5 mt-0.5">{p.time}</span>}
                          {p.ticket && <span className="inline-block bg-moss-soft text-moss rounded-md px-1.5 mr-1.5 mt-0.5">🎫 {p.ticket}</span>}
                          {p.transport && <div>🚗 {p.transport}</div>}
                          {p.note && <div>{p.note}</div>}
                        </div>
                      </div>
                      {editing && (
                        <>
                          <button
                            type="button"
                            title="编辑此地点"
                            onClick={(e) => { e.stopPropagation(); onEditPlace?.(di, pi); }}
                            className="place-edit absolute top-[9px] right-[28px] w-5 h-5 rounded-md border border-line bg-white text-ink-soft text-[11px] leading-none cursor-pointer opacity-0 transition-opacity hover:bg-moss-soft hover:text-moss"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            title="删除此地点"
                            onClick={(e) => { e.stopPropagation(); onDeletePlace?.(di, pi); }}
                            className="place-del absolute top-[9px] right-1 w-5 h-5 rounded-md border border-line bg-white text-ink-soft text-[11px] leading-none cursor-pointer opacity-0 transition-opacity hover:bg-[#F6E7E7] hover:text-[#B85C5C]"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}

                {day.hotel && day.hotel.name && (
                  <HotelCard hotel={day.hotel} city={route.trip.destination} active={activeKey === `d${di}-hotel`} onClick={() => onHotelClick(di)} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}