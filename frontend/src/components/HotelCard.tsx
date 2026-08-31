import { useState } from "react";
import type { Hotel } from "../types/route";
import { searchHotel, type SearchResult } from "../api/client";

interface HotelCardProps {
  hotel: Hotel;
  active: boolean;
  onClick: () => void;
}

/** 酒店比价卡：最低价平台自动高亮 + 「最低」标签。 */
export default function HotelCard({ hotel, active, onClick, city }: HotelCardProps & { city?: string }) {
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const prices = hotel.prices || [];
  const best = prices.length ? prices.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
  return (
    <div
      onClick={onClick}
      className={`bg-white border border-line rounded-[14px] p-3.5 mt-3 shadow-[0_2px_10px_rgba(43,43,40,0.05)] cursor-pointer transition-shadow ${active ? "ring-2 ring-gold/45" : ""}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🏨</span>
        <h3 className="text-sm font-bold flex-1">{hotel.name}</h3>
      </div>
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
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {["平台", "价格", "早餐", "备注"].map((th) => (
              <th key={th} className="text-left text-[11px] text-ink-soft font-semibold px-2 py-1.5 border-b border-line uppercase">
                {th}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {prices.length === 0 && (
            <tr>
              <td colSpan={4} className="px-2 py-2 text-[#A8A298]">暂无报价（可稍后手动补充）</td>
            </tr>
          )}
          {(searchResult ? [...prices, ...searchResult.prices.map((p) => ({ ...p, breakfast: p.breakfast ?? false }))] : prices).map((pr, i) => {
            const isBest = pr === best;
            return (
              <tr key={i} className={isBest ? "bg-gold-soft" : ""}>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 font-semibold align-middle">
                  {pr.platform}
                  {isBest && <span className="bg-gold text-white text-[10px] font-bold rounded px-1.5 py-px ml-1.5 align-[1px]">最低</span>}
                </td>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 font-extrabold text-sm tabular-nums">¥{pr.price}</td>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 text-[11px] text-ink-soft">{pr.breakfast ? "含早" : "无早"}</td>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 text-[11px] text-ink-soft">{pr.note || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {searchResult && (
        <div className="mt-2 text-[11px] text-ink-soft">🔍 {searchResult.note}</div>
      )}
      {hotel.verdict && (
        <div className="mt-3.5 pt-2.5 border-t border-dashed border-line">
          <div className="text-xs font-bold text-gold mb-1">✦ 建议</div>
          <p className="text-[12.5px] leading-relaxed text-ink-soft">{hotel.verdict}</p>
        </div>
      )}
    </div>
  );
}