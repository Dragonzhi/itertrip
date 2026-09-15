import { useEffect, useRef, useState } from "react";
import type { Hotel, PriceItem } from "../types/route";
import { searchHotel, type SearchResult } from "../api/client";

/** 报价展示：整数不带小数位，非整数保留 1 位（与行情场景一致，不做任何计数动效）。 */
const fmtPrice = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

interface HotelCardProps {
  hotel: Hotel;
  active: boolean;
  onClick: () => void;
  /** 双击聚焦地图 */
  onFocus?: () => void;
  /** 显示/隐藏价格、备注、建议等 meta 详情（M16） */
  showMeta?: boolean;
  /** 编辑酒店（M16：逐天自定义） */
  onEdit?: () => void;
  /** 把搜索结果里的报价存进行程（M22.1：此前搜出来只能看、存不下来） */
  onSavePrices?: (prices: PriceItem[]) => void;
}

/** 酒店比价卡：最低价平台自动高亮 + 「最低」标签。 */
export default function HotelCard({ hotel, active, onClick, onFocus, city, showMeta = true, onEdit, onSavePrices }: HotelCardProps & { city?: string }) {
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const prices = hotel.prices || [];
  const best = prices.length ? prices.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
  const rows = searchResult
    ? [...prices, ...searchResult.prices.map((p) => ({ ...p, breakfast: p.breakfast ?? false }))]
    : prices;
  /**
   * 价格动效（优化③）：原来用 Magic UI NumberTicker 从 0 滚到目标价 —— 读起来像「这个价格正在涨」，
   * 而且它是**滚入视口**触发（切天/展开/重挂载都重播），跟「新数据到了」毫无关系。
   * 现在：价格静态渲染 + 报价到达时整行淡入一次 + 最低价行一次性金色描边脉冲；
   * 只比较「本轮渲染的报价指纹」，**首屏与无关重渲染都不播**，只有报价真的变了才播一次。
   */
  const rowsSig = rows.map((p) => p.platform + "|" + p.price).join(",");
  const [anim, setAnim] = useState(0);
  const prevSig = useRef(rowsSig);
  useEffect(() => {
    if (prevSig.current === rowsSig) return;
    prevSig.current = rowsSig;
    setAnim((n) => n + 1); // key 变化 → tbody 重挂载 → CSS 动画从头播一次
  }, [rowsSig]);
  return (
    <div
      onClick={onClick}
      onDoubleClick={(e) => { e.preventDefault(); onFocus?.(); }}
      className={`bg-white border border-line rounded-[14px] p-3.5 mt-3 shadow-[0_2px_10px_rgba(43,43,40,0.05)] cursor-pointer transition-shadow ${active ? "ring-2 ring-gold/45" : ""}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🏨</span>
        <h3 className="text-sm font-bold flex-1">{hotel.name}</h3>
        {onEdit && (
          <button
            type="button"
            title="编辑酒店（改名 / 重定位置 / 应用到所有天）"
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="shrink-0 w-6 h-6 rounded-md border border-line bg-white text-ink-soft text-[12px] leading-none cursor-pointer hover:bg-moss-soft hover:text-moss"
            data-testid="hotel-edit"
          >
            ✎
          </button>
        )}
      </div>
      {showMeta && <div className="space-y-0">{
        <>
        {hotel.note && <div className="text-xs text-ink-soft mb-2.5">{hotel.note}</div>}
        <div className="mb-2">
          <button
            type="button"
            disabled={searching}
            onClick={async () => {
              setSearching(true); setSearchErr(null);
              try { setSearchResult(await searchHotel(hotel.name, city || "", "", "")); }
              catch (e) { setSearchErr(e instanceof Error ? e.message : String(e)); }
              finally { setSearching(false); }
            }}
            className="border border-line bg-white text-moss rounded-lg px-2 py-1 text-[11px] font-semibold hover:bg-moss-soft disabled:opacity-40"
          >
            {searching ? "搜索中…" : "🔍 搜索网络报价"}
          </button>
          {searchErr && <span className="text-[11px] text-[#B85C5C] ml-2">{searchErr}</span>}
          {searchResult && searchResult.prices.length > 0 && onSavePrices && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSavePrices(searchResult.prices.map((p) => ({ ...p, breakfast: p.breakfast ?? false })));
                setSaved(true);
              }}
              disabled={saved}
              title="把这些搜索到的报价记进行程（之后可在「编辑酒店」里改）"
              data-testid="hotel-save-prices"
              className="ml-2 border border-moss bg-moss-soft text-moss rounded-lg px-2 py-1 text-[11px] font-semibold hover:bg-white disabled:opacity-50"
            >
              {saved ? "✓ 已存入" : "＋ 存入行程"}
            </button>
          )}
        </div>
        </>}
      </div>}
      {showMeta && <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {["平台", "价格", "早餐", "备注"].map((th) => (
              <th key={th} className="text-left text-[11px] text-ink-soft font-semibold px-2 py-1.5 border-b border-line uppercase">
                {th}
              </th>
            ))}
          </tr>
        </thead>
        <tbody key={anim}>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-2 py-2 text-[#A8A298]">暂无报价（可稍后手动补充）</td>
            </tr>
          )}
          {rows.map((pr, i) => {
            const isBest = pr === best;
            return (
              <tr key={i} className={(isBest ? "bg-gold-soft " : "") + "price-row" + (isBest ? " price-row-best" : "")}>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 font-semibold align-middle">
                  {pr.platform}
                  {isBest && <span className="bg-gold text-white text-[10px] font-bold rounded px-1.5 py-px ml-1.5 align-[1px]">最低</span>}
                </td>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 font-extrabold text-sm tabular-nums text-ink">
                  {/* 静态渲染：价格必须一眼可读、可直接上下比较（不做 0→N 的计数动效） */}
                  ¥{fmtPrice(pr.price)}
                </td>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 text-[11px] text-ink-soft">{pr.breakfast ? "含早" : "无早"}</td>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 text-[11px] text-ink-soft">{pr.note || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>}
      {showMeta && searchResult && (
        <div className="mt-2 text-[11px] text-ink-soft">🔍 {searchResult.note}</div>
      )}
      {showMeta && hotel.verdict && (
        <div className="mt-3.5 pt-2.5 border-t border-dashed border-line">
          <div className="text-xs font-bold text-gold mb-1">✦ 建议</div>
          <p className="text-[12.5px] leading-relaxed text-ink-soft">{hotel.verdict}</p>
        </div>
      )}
    </div>
  );
}