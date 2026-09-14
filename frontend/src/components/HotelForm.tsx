import { useEffect, useRef, useState } from "react";
import type { PriceItem } from "../types/route";

export const PICK_HINT_REPICK_HOTEL = "📍 点击地图选择酒店新位置（Esc 取消）";

/** 常用平台名（仅作输入提示，不做任何抓取 —— 价格由用户自己填）。 */
const PLATFORM_PRESETS = ["携程", "美团", "飞猪", "去哪儿", "Booking", "Agoda", "酒店前台", "其它"];

export interface HotelDraft {
  name: string;
  note: string;
  lat: number;
  lng: number;
  /** 手动录入的报价（价格中立：工具不抓取、不预订，最低价只做高亮） */
  prices: PriceItem[];
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

/** 紧凑酒店表单：名称 / 备注 / 报价手动录入 / 在地图上重定位置 + 「仅改这天 / 设为所有天默认」。 */
export default function HotelForm({
  mode, draft, hasCoord, dayLabel, picking, onChange, onSave, onCancel, onStartRepick,
}: HotelFormProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<"day" | "all">("day");
  /* 价格输入框保留用户的原始文本（"89." 这类中间态不被 number 化吃掉）；
     增删行会清空它，显示退回按数值渲染 —— 值本身不丢。 */
  const [rawPrices, setRawPrices] = useState<Record<number, string>>({});
  const okDisabled = !draft.name.trim();

  useEffect(() => { if (!picking) nameRef.current?.focus(); }, [picking]);

  if (picking) return null;   // repick 选点进行中：隐藏表单，只留提示条

  const prices = draft.prices || [];
  const setPrice = (i: number, patch: Partial<PriceItem>) =>
    onChange({ prices: prices.map((pr, idx) => (idx === i ? { ...pr, ...patch } : pr)) });
  const addPrice = () => {
    setRawPrices({});
    onChange({ prices: [...prices, { platform: "", price: 0, breakfast: false, note: "" }] });
  };
  const removePrice = (i: number) => {
    setRawPrices({});
    onChange({ prices: prices.filter((_, idx) => idx !== i) });
  };
  const priceText = (i: number) => (i in rawPrices ? rawPrices[i] : (prices[i]?.price ? String(prices[i].price) : ""));
  const onPriceInput = (i: number, v: string) => {
    const clean = v.replace(/[^\d.]/g, "");
    setRawPrices((p) => ({ ...p, [i]: clean }));
    const n = Number(clean);
    setPrice(i, { price: Number.isFinite(n) ? n : 0 });
  };

  const posText = draft.lat || draft.lng
    ? "坐标：" + (hasCoord || mode === "add" ? draft.lat.toFixed(5) + ", " + draft.lng.toFixed(5) : "—")
    : "坐标：—";

  return (
    <div className="fixed inset-0 z-[700] bg-[rgba(43,43,40,0.35)] flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        role="dialog"
        aria-label={mode === "edit" ? "编辑酒店" : "添加酒店"}
        className="bg-white border border-line rounded-[14px] shadow-card p-[18px] w-[min(360px,calc(100vw-48px))] max-h-[calc(100vh-40px)] overflow-y-auto flex flex-col gap-2.5"
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

        <div className="flex flex-col gap-1.5" data-testid="price-editor">
          <div className="text-xs font-semibold text-ink-soft">
            报价 <span className="font-normal">（自己填；工具不抓取、不预订）</span>
          </div>
          {prices.length === 0 && (
            <div className="text-[11px] text-ink-soft" data-testid="price-empty">
              暂无报价 —— 看到的价格点「＋ 添加一条报价」记下来，最低价会自动高亮。
            </div>
          )}
          {prices.map((pr, i) => (
            <div key={i} className="border border-line rounded-lg p-1.5 flex flex-col gap-1" data-testid="price-row">
              <div className="flex items-center gap-1">
                <input
                  value={pr.platform}
                  onChange={(e) => setPrice(i, { platform: e.target.value })}
                  list="hotel-platform-presets"
                  placeholder="平台（如 携程）"
                  maxLength={20}
                  data-testid="price-platform"
                  className="flex-1 min-w-0 border border-line rounded-md px-2 py-[5px] text-[12px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
                />
                <div className="flex items-center gap-0.5 shrink-0">
                  <span className="text-[11px] text-ink-soft">¥</span>
                  <input
                    value={priceText(i)}
                    onChange={(e) => onPriceInput(i, e.target.value)}
                    inputMode="decimal"
                    placeholder="价格"
                    data-testid="price-amount"
                    className="w-[62px] border border-line rounded-md px-2 py-[5px] text-[12px] text-ink tabular-nums focus:outline-2 focus:outline-moss-soft focus:border-moss"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removePrice(i)}
                  title="删除这条报价"
                  data-testid="price-remove"
                  className="shrink-0 w-6 h-6 rounded-md border border-line bg-white text-ink-soft text-[11px] leading-none hover:bg-[#F6E7E7] hover:text-[#B85C5C]"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  value={pr.note || ""}
                  onChange={(e) => setPrice(i, { note: e.target.value })}
                  placeholder="备注（可选，如 不可取消 / 含双早）"
                  maxLength={40}
                  data-testid="price-note"
                  className="flex-1 min-w-0 border border-line rounded-md px-2 py-[5px] text-[11.5px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
                />
                <label className="flex items-center gap-1 text-[11.5px] text-ink-soft whitespace-nowrap shrink-0">
                  <input
                    type="checkbox"
                    checked={!!pr.breakfast}
                    onChange={(e) => setPrice(i, { breakfast: e.target.checked })}
                    data-testid="price-breakfast"
                  />
                  含早
                </label>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addPrice}
            data-testid="price-add"
            className="self-start border border-line bg-white text-moss rounded-lg px-2.5 py-[6px] text-xs font-semibold hover:bg-moss-soft"
          >
            ＋ 添加一条报价
          </button>
          <datalist id="hotel-platform-presets">
            {PLATFORM_PRESETS.map((p) => <option key={p} value={p} />)}
          </datalist>
        </div>

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
