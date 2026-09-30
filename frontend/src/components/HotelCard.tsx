import { useEffect, useRef, useState } from "react";
import type { Hotel, PriceItem } from "../types/route";
import { searchHotel, type SearchResult } from "../api/client";
import { schedule } from '../lib/schedule';

/** 报价展示：整数不带小数位，非整数保留 1 位（与行情场景一致，不做任何计数动效）。 */
const fmtPrice = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

interface HotelCardProps {
  checkIn?: string;
  checkOut?: string;
  onNavigate?: () => void;
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
export default function HotelCard({ hotel, active, onClick, onFocus, city, checkIn = '', checkOut = '', showMeta = true, onEdit, onSavePrices, onNavigate }: HotelCardProps & { city?: string }) {
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const prices = hotel.prices || [];
  const rows = searchResult
    ? [...prices, ...searchResult.prices.filter(p => !prices.some(q => q.platform === p.platform && q.price === p.price && q.source_url === p.source_url && schedule.quoteGroup(q) === schedule.quoteGroup(p))).map((p) => ({ ...p, breakfast: p.breakfast ?? false }))]
    : prices;
  const queryVersion = useRef(0);
  useEffect(() => { queryVersion.current++; setSearchResult(null); setSearching(false); setSaved(false); return () => { queryVersion.current++; }; }, [hotel.id, hotel.name, city, checkIn, checkOut]);
  const comparable = rows.filter(p => schedule.comparable(p, checkIn, checkOut));
  const isGroupBest = (p: PriceItem) => {
    const group = comparable.filter(q => schedule.quoteGroup(q) === schedule.quoteGroup(p));
    return group.includes(p) && group.length >= 2 && p.price === Math.min(...group.map(q => q.price));
  };
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
      className={`bg-white border border-line rounded-[14px] p-3.5 mt-3 shadow-[0_2px_10px_rgba(43,43,40,0.05)] cursor-pointer transition-shadow hover:shadow-card ${active ? "ring-2 ring-gold/45" : ""}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">🏨</span>
        {/* D2：酒店名做成真按钮（卡片里已经有 ✎，不能再嵌一层 button） */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="text-left text-sm font-bold flex-1 rounded focus-ring"
        >
          {hotel.name}
        </button>
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
      {onNavigate && <button className="nav-secondary mb-2" data-testid="hotel-navigate" onClick={e => { e.stopPropagation(); onNavigate(); }}>去这里 ↗</button>}
      {showMeta && <div className="space-y-0">{
        <>
        {hotel.note && <div className="text-xs text-ink-soft mb-2.5">{hotel.note}</div>}
        <div className="mb-2">
          <button
            type="button"
            disabled={searching}
            onClick={async () => {
              setSearching(true); setSearchErr(null);
              setSaved(false); const version = ++queryVersion.current;
              try { const result = await searchHotel(hotel.name, city || "", checkIn, checkOut); if (queryVersion.current === version) setSearchResult(result); }
              catch (e) { if (queryVersion.current === version) setSearchErr(e instanceof Error ? e.message : String(e)); }
              finally { if (queryVersion.current === version) setSearching(false); }
            }}
            className="border border-line bg-white text-moss rounded-lg px-2 py-1 text-[11px] font-semibold hover:bg-moss-soft disabled:opacity-40"
          >
            {searching ? "搜索中…" : "🔍 搜索网络报价"}
          </button>
          {searchErr && <span className="text-[11px] text-danger ml-2">{searchErr}</span>}
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
        <p className="text-[11px] text-ink-soft mb-2">{checkIn && checkOut ? `入住 ${checkIn} · 离店 ${checkOut}` : '入住／离店日期未知'} · 仅相同日期、房型、人数、早餐、退改和计价单位的完整报价可比较。</p>
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
              <td colSpan={4} className="px-2 py-2 text-ink-soft">暂无报价（可稍后手动补充）</td>
            </tr>
          )}
          {rows.map((pr, i) => {
            const isBest = isGroupBest(pr);
            return (
              <tr key={i} className={(isBest ? "bg-gold-soft " : "") + "price-row" + (isBest ? " price-row-best" : "")}>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 font-semibold align-middle">
                  {pr.platform}
                  {isBest && <span className="bg-gold-deep text-white text-[11px] font-bold rounded px-1.5 py-px ml-1.5 align-[1px]">同条件最低</span>}
                </td>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 font-extrabold text-sm tabular-nums text-ink">
                  {/* 静态渲染：价格必须一眼可读、可直接上下比较（不做 0→N 的计数动效） */}
                  ¥{fmtPrice(pr.price)}
                </td>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 text-[11px] text-ink-soft">{!pr.breakfast_known ? '未知' : pr.breakfast ? "含早" : "无早"}</td>
                <td className="px-2 py-2 border-b border-[#F3EDE3] last:border-0 text-[11px] text-ink-soft">{pr.note || ""}<br/>{schedule.comparable(pr,checkIn,checkOut) ? `${pr.room} · ${pr.occupancy} · ${pr.cancellation} · ${pr.unit === 'night' ? '每晚' : '整次入住'}` : '日期／报价条件未核对，不参与最低比较'}{pr.queried_at && <div>查询 {pr.queried_at}</div>}{schedule.url(pr.source_url) && <a className="underline text-moss" href={schedule.url(pr.source_url)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>逐条来源 ↗</a>}</td>
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
          <div className="text-xs font-bold text-gold-deep mb-1">✦ 建议</div>
          <p className="text-[12.5px] leading-relaxed text-ink-soft">{hotel.verdict}</p>
        </div>
      )}
    </div>
  );
}
