import { useRef, useState } from "react";
import { motion } from "motion/react";
import type { DragEvent } from "react";
import { BlurFade } from "./magicui/blur-fade";
import type { PriceItem, RouteJSON } from "../types/route";
import { dayColor, emojiFor } from "../mapCore";
import type { MapSettings } from "../lib/settings";
import { BADGE_CLASS, coordBadge } from "../lib/coordSource";
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
  /** M23：触屏排序（桌面 HTML5 拖拽在触屏不触发）——dir=-1 上移 / 1 下移，可跨天 */
  onMovePlace?: (di: number, pi: number, dir: -1 | 1) => void;
  /** 双击地点 → 地图聚焦（与单击弹框区分） */
  onPlaceFocus?: (di: number, pi: number) => void;
  /** 双击酒店 → 地图聚焦 */
  onHotelFocus?: (di: number) => void;
  /** 编辑酒店（M16：逐天自定义） */
  onEditHotel?: (di: number) => void;
  /** 把「搜索网络报价」的结果存入行程（M22.1：此前搜出来只能看、存不下来） */
  onSaveHotelPrices?: (di: number, prices: PriceItem[]) => void;
  /** 地图显示设置（M16）：showSummary/showMeta 控制展示 */
  view?: MapSettings;
}

/** 时间线面板：按天分组、可折叠；点击条目与地图双向联动。 */
export default function Timeline({
  route, activeKey, onPlaceClick, onHotelClick,
  editing = false, onDeletePlace, onEditPlace, onDropMove, onMovePlace, onPlaceFocus, onHotelFocus,
  onEditHotel, onSaveHotelPrices,
  view,
}: TimelineProps) {
  const showSummary = view?.showSummary !== false;
  const showMeta = view?.showMeta !== false;
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
      {showSummary && route.summary && route.summary.length > 0 && (
        <div className="bg-moss text-[#F4FBF6] rounded-[14px] px-4 py-4 my-1.5 mb-5" data-testid="summary-block">
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
            {/* Magic UI BlurFade：天分组滚入视口时淡入（错峰，避免整屏同时闪） */}
            <BlurFade inView delay={Math.min(di * 0.04, 0.2)}>
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
                  const badge = showMeta ? coordBadge(p.source, p.confidence) : null;
                  return (
                    <motion.div
                      layout
                      key={key}
                      data-key={key}
                      onClick={(e) => { e.stopPropagation(); onPlaceClick(di, pi); }}
                      onDoubleClick={(e) => { e.preventDefault(); onPlaceFocus?.(di, pi); }}
                      draggable={editing}
                      onDragStart={(e) => {
                        if (!editing) return;
                        // motion.div 的 onDragStart 类型是手势事件联合，实际的 HTML5 拖拽事件仍是 DragEvent
                        const ev = e as unknown as DragEvent<HTMLDivElement>;
                        dragRef.current = { di, pi };
                        ev.dataTransfer.effectAllowed = "move";
                        try { ev.dataTransfer.setData("text/plain", key); } catch { /* noop */ }
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
                        <div className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
                          <span data-testid="place-name">{p.name}</span>
                          {badge && (
                            <span
                              title={badge.title}
                              data-testid="coord-badge"
                              className={"text-[10px] font-semibold rounded-md px-1.5 py-px " + BADGE_CLASS[badge.tone]}
                            >
                              {badge.text}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-ink-soft mt-0.5 leading-relaxed">
                          {showMeta && p.time && <span className="inline-block bg-moss-soft text-moss rounded-md px-1.5 mr-1.5 mt-0.5">{p.time}</span>}
                          {showMeta && p.ticket && <span className="inline-block bg-moss-soft text-moss rounded-md px-1.5 mr-1.5 mt-0.5">🎫 {p.ticket}</span>}
                          {showMeta && p.transport && <div>🚗 {p.transport}</div>}
                          {showMeta && p.note && <div>{p.note}</div>}
                          {/* M22 事实告警：**不受 showMeta 控制** —— 闭馆日冲突是安全警示，
                              不该被「显示详细程度」这类纯视图开关藏起来 */}
                          {(p.warnings || []).map((w, wi) => (
                            <div
                              key={wi}
                              data-testid="place-warning"
                              className="inline-block bg-[#F6E7E7] text-[#B85C5C] rounded-md px-1.5 mt-0.5 mr-1.5 font-semibold"
                            >
                              ⚠️ {w}
                            </div>
                          ))}
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
                      {/* M23：上/下移排序（触屏靠它；桌面也能用，与拖拽并存） */}
                      {editing && onMovePlace && (
                        <div className="reorder-btns flex-col gap-1 absolute top-[7px] right-[64px]">
                          <button
                            type="button"
                            title="上移（到上一天末位）"
                            onClick={(e) => { e.stopPropagation(); onMovePlace(di, pi, -1); }}
                            className="w-7 h-7 rounded-md border border-line bg-white text-ink-soft text-[12px] leading-none flex items-center justify-center"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            title="下移（到下一天首位）"
                            onClick={(e) => { e.stopPropagation(); onMovePlace(di, pi, 1); }}
                            className="w-7 h-7 rounded-md border border-line bg-white text-ink-soft text-[12px] leading-none flex items-center justify-center"
                          >
                            ↓
                          </button>
                        </div>
                      )}
                    </motion.div>
                  );
                })}

                {day.hotel && day.hotel.name && (
                  <HotelCard hotel={day.hotel} city={route.trip.destination} active={activeKey === `d${di}-hotel`} onClick={() => onHotelClick(di)} onFocus={onHotelFocus ? () => onHotelFocus(di) : undefined} showMeta={showMeta} onEdit={onEditHotel ? () => onEditHotel(di) : undefined} onSavePrices={onSaveHotelPrices ? (pr) => onSaveHotelPrices(di, pr) : undefined} />
                )}
              </div>
            )}
            </BlurFade>
          </div>
        );
      })}
    </div>
  );
}