import { useEffect, useRef, useState } from "react";

export const PICK_HINT_REPICK_HOTEL = "📍 点击地图选择酒店新位置（Esc 取消）";

export interface HotelDraft {
  name: string;
  note: string;
  lat: number;
  lng: number;
}

interface HotelFormProps {
  mode: "add" | "edit";
  draft: HotelDraft;
  hasCoord: boolean;              // 当前酒店是否有坐标
  dayLabel: string;                // 如 "D1 · 第 1 天"
  picking: boolean;               // repick 进行中（表单应隐藏）
  onChange: (patch: Partial<HotelDraft>) => void;
  /** scope: "day"=仅改这一天 / "all"=设为所有天默认酒店 */
  onSave: (scope: "day" | "all") => void;
  onCancel: () => void;
  onStartRepick: () => void;
}

/** 紧凑酒店表单：名称 / 备注 / 在地图上重定位置 + 「仅改这天 / 设为所有天默认」。 */
export default function HotelForm({
  mode, draft, hasCoord, dayLabel, picking, onChange, onSave, onCancel, onStartRepick,
}: HotelFormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<"day" | "all">("day");
  const okDisabled = !draft.name.trim();

  useEffect(() => { if (!picking) nameRef.current?.focus(); }, [picking]);

  if (picking) return null;   // repick 选点进行中：隐藏表单，只留提示条

  const posText = draft.lat || draft.lng
    ? "坐标：" + (hasCoord || mode === "add" ? draft.lat.toFixed(5) + ", " + draft.lng.toFixed(5) : "—")
    : "坐标：—";

  return (
    <div className="fixed inset-0 z-[700] bg-[rgba(43,43,40,0.35)] flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        role="dialog"
        aria-label={mode === "edit" ? "编辑酒店" : "添加酒店"}
        className="bg-white border border-line rounded-[14px] shadow-card p-[18px] w-[min(320px,calc(100vw-48px))] flex flex-col gap-2.5"
      >
        <h3 className="text-sm font-bold">{mode === "edit" ? "✎ 编辑酒店" : "🏨 添加酒店"}</h3>
        <div className="text-[11px] text-ink-soft">{dayLabel}</div>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          酒店名称
          <input
            ref={nameRef}
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="酒店名称（必填）"
            maxLength={80}
            className="border border-line rounded-lg px-2.5 py-[7px] text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          备注
          <input
            value={draft.note}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder="可选"
            maxLength={120}
            className="border border-line rounded-lg px-2.5 py-[7px] text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          位置
          <span>
            <button
              type="button"
              onClick={onStartRepick}
              className="border border-line bg-white text-moss rounded-lg px-2.5 py-[6px] text-xs font-semibold hover:bg-moss-soft"
            >
              🗺 在地图上重定位置
            </button>
          </span>
        </label>

        <div className="text-[11px] text-ink-soft tabular-nums">{posText}</div>

        <label className="flex flex-col gap-1.5 text-xs font-semibold text-ink-soft">
          应用到
          <div className="flex bg-[#F1EDE2] rounded-[10px] p-0.5">
            <button
              type="button"
              onClick={() => setScope("day")}
              className={"flex-1 rounded-[8px] px-2 py-1 text-[11px] font-semibold transition-colors " + (scope === "day" ? "bg-white text-moss shadow-sm" : "text-ink-soft hover:text-ink")}
            >
              仅改这一天
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={"flex-1 rounded-[8px] px-2 py-1 text-[11px] font-semibold transition-colors " + (scope === "all" ? "bg-white text-moss shadow-sm" : "text-ink-soft hover:text-ink")}
            >
              设为所有天默认
            </button>
          </div>
          {scope === "all" && (
            <span className="text-[10.5px] text-ink-soft font-normal">会覆盖其他天的酒店（含你单独改过的天）。</span>
          )}
        </label>

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="border border-line bg-white text-moss rounded-lg px-2.5 py-[6px] text-xs font-semibold hover:bg-moss-soft">
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(scope)}
            disabled={okDisabled}
            className="bg-moss text-white border border-moss rounded-lg px-2.5 py-[6px] text-xs font-semibold hover:bg-[#175740] disabled:opacity-40"
          >
            {scope === "all" ? "设为所有天默认" : (mode === "edit" ? "保存修改" : "添加酒店")}
          </button>
        </div>
      </div>
    </div>
  );
}
