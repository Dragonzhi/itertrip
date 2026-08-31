import { useEffect, useRef, useState } from "react";
import type { PlaceType } from "../types/route";

export const PICK_HINT_ADD = "📍 点击地图选择地点位置（Esc 取消）";
export const PICK_HINT_REPICK = "📍 点击地图为新位置（Esc 取消）";

export const TIME_PRESETS = ["上午 09:00-12:00", "中午 12:00-14:00", "下午 14:00-17:00", "傍晚 17:00-19:00", "晚上 19:00-22:00"];
export const TRANSPORT_PRESETS = ["步行", "地铁", "公交", "打车", "自驾", "景区直通车"];
export const TICKET_PRESETS = ["免费", "收费"];

export const TYPE_OPTIONS: { value: PlaceType; label: string }[] = [
  { value: "attraction", label: "⛰️ 景点 attraction" },
  { value: "food", label: "🍜 美食 food" },
  { value: "transport", label: "🚇 交通 transport" },
  { value: "other", label: "📍 其他 other" },
];

export interface PlaceDraft {
  name: string;
  type: PlaceType;
  time: string;
  transport: string;
  ticket: string;
  note: string;
  lat: number;
  lng: number;
}

interface PlaceFormProps {
  mode: "add" | "edit";
  draft: PlaceDraft;
  hasCoord: boolean;              // 编辑模式下原地点是否有坐标
  dayOptions: { index: number; label: string }[];
  initialDay: number;
  picking: boolean;               // repick 进行中（表单应隐藏）
  onChange: (patch: Partial<PlaceDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  onStartRepick: () => void;
}

/** 新增/编辑地点表单（移植自旧版 #add-form：双模式 + datalist 预设 + 更改位置）。 */
export default function PlaceForm({
  mode, draft, hasCoord, dayOptions, initialDay, picking, onChange, onSave, onCancel, onStartRepick,
}: PlaceFormProps) {
  const [dayIdx, setDayIdx] = useState(initialDay);
  const nameRef = useRef<HTMLInputElement>(null);
  const isEdit = mode === "edit";
  const okDisabled = !draft.name.trim();

  useEffect(() => { setDayIdx(initialDay); }, [initialDay]);
  useEffect(() => { if (!picking) nameRef.current?.focus(); }, [picking]);

  if (picking) return null;   // repick 选点进行中：隐藏表单，只留提示条

  const posText = draft.lat || draft.lng
    ? "坐标：" + (hasCoord || mode === "add" ? draft.lat.toFixed(5) + ", " + draft.lng.toFixed(5) : "—")
    : "坐标：—";

  return (
    <div className="fixed inset-0 z-[700] bg-[rgba(43,43,40,0.35)] flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        role="dialog"
        aria-label={isEdit ? "编辑地点" : "新增地点"}
        className="bg-white border border-line rounded-[14px] shadow-card p-[18px] w-[min(320px,calc(100vw-48px))] flex flex-col gap-2.5"
      >
        <h3 className="text-sm font-bold">{isEdit ? "✎ 编辑地点" : "📍 新增地点"}</h3>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          名称
          <input
            ref={nameRef}
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="地点名称（必填）"
            maxLength={60}
            className="border border-line rounded-lg px-2.5 py-[7px] text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          类型
          <select
            value={draft.type}
            onChange={(e) => onChange({ type: e.target.value as PlaceType })}
            className="border border-line rounded-lg px-2.5 py-[7px] text-[13px] text-ink bg-white"
          >
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        {!isEdit && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
            加入哪一天
            <select
              value={dayIdx}
              onChange={(e) => setDayIdx(Number(e.target.value))}
              className="border border-line rounded-lg px-2.5 py-[7px] text-[13px] text-ink bg-white"
            >
              {dayOptions.map((d) => <option key={d.index} value={d.index}>{d.label}</option>)}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          时间
          <input
            list="time-presets"
            value={draft.time}
            onChange={(e) => onChange({ time: e.target.value })}
            placeholder="如 09:00-11:30（可选）"
            maxLength={40}
            className="border border-line rounded-lg px-2.5 py-[7px] text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
          />
          <datalist id="time-presets">
            {TIME_PRESETS.map((t) => <option key={t} value={t} />)}
          </datalist>
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          交通
          <input
            list="transport-presets"
            value={draft.transport}
            onChange={(e) => onChange({ transport: e.target.value })}
            placeholder="如 地铁 3 号线（可选）"
            maxLength={60}
            className="border border-line rounded-lg px-2.5 py-[7px] text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
          />
          <datalist id="transport-presets">
            {TRANSPORT_PRESETS.map((t) => <option key={t} value={t} />)}
          </datalist>
        </label>

        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
          门票
          <input
            list="ticket-presets"
            value={draft.ticket}
            onChange={(e) => onChange({ ticket: e.target.value })}
            placeholder="如 50 元（可选）"
            maxLength={40}
            className="border border-line rounded-lg px-2.5 py-[7px] text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
          />
          <datalist id="ticket-presets">
            {TICKET_PRESETS.map((t) => <option key={t} value={t} />)}
          </datalist>
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

        {isEdit && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
            位置
            <span>
              <button
                type="button"
                onClick={onStartRepick}
                className="border border-line bg-white text-moss rounded-lg px-2.5 py-[6px] text-xs font-semibold hover:bg-moss-soft"
              >
                🗺 更改位置
              </button>
            </span>
          </label>
        )}

        <div className="text-[11px] text-ink-soft tabular-nums">{posText}</div>

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="border border-line bg-white text-moss rounded-lg px-2.5 py-[6px] text-xs font-semibold hover:bg-moss-soft">
            取消
          </button>
          <button
            type="button"
            onClick={() => { onSave(); }}
            disabled={okDisabled}
            className="bg-moss text-white border border-moss rounded-lg px-2.5 py-[6px] text-xs font-semibold hover:bg-[#175740] disabled:opacity-40"
          >
            {isEdit ? "保存修改" : "确定添加"}
          </button>
        </div>
      </div>
    </div>
  );
}