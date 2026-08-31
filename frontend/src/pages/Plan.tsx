import { useMemo, useState } from "react";
import MapView from "../components/MapView";
import Timeline from "../components/Timeline";
import type { RouteJSON } from "../types/route";
import { exportHtml } from "../api/client";

interface PlanProps {
  route: RouteJSON;
  source: string;
  onRestart: () => void;
}

/** 规划页：全屏地图 + 右侧时间线面板；点击标记 ↔ 点击条目双向联动。 */
export default function Plan({ route, source, onRestart }: PlanProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [exporting, setExporting] = useState(false);

  const activeDay = useMemo(() => {
    if (!activeKey) return -1;
    const m = activeKey.match(/^d(\d+)-/);
    return m ? Number(m[1]) : -1;
  }, [activeKey]);

  const trip = route.trip;
  const metas = [trip.destination, trip.dates, trip.budget, trip.travelers].filter(Boolean);

  const handlePlaceClick = (di: number, pi: number) => {
    setActiveKey("d" + di + "-p" + pi);
    setPanelOpen(true);
  };

  const handleHotelClick = (di: number) => {
    setActiveKey("d" + di + "-hotel");
    setPanelOpen(true);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportHtml(route, "itertrip_" + trip.destination + "_" + trip.days + "d");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="h-screen overflow-hidden">
      <MapView
        route={route}
        activeDay={activeDay}
        onPlaceClick={handlePlaceClick}
        onHotelClick={handleHotelClick}
      />

      {/* 顶部悬浮标题 */}
      <div className="fixed top-3.5 left-3.5 right-3.5 z-[500] flex items-center gap-3 pointer-events-none">
        <div className="bg-white border border-line rounded-[14px] px-3.5 py-2 shadow-card flex items-center gap-2 pointer-events-auto">
          <span className="text-lg">🧭</span>
          <button onClick={onRestart} className="text-sm font-bold tracking-wide hover:text-moss" title="重新规划">
            IterTrip
            <span className="block text-[10px] font-normal text-ink-soft tracking-[1px]">LATIN · ITER · ROAD</span>
          </button>
        </div>
        <div className="bg-white border border-line rounded-[14px] px-4 py-2 shadow-card min-w-0 overflow-hidden pointer-events-auto">
          <h1 className="text-base font-bold whitespace-nowrap overflow-hidden text-ellipsis">{trip.title}</h1>
          <div className="text-xs text-ink-soft mt-0.5">
            {metas.map((m, i) => (
              <span key={i}>{i > 0 && <span className="mx-1.5 text-[#C9C2B4]">·</span>}{m}</span>
            ))}
          </div>
        </div>
        <div className="ml-auto flex gap-2 pointer-events-auto">
          {source === "mock" && (
            <span className="bg-gold-soft text-gold text-xs font-semibold rounded-full px-3 py-2 shadow-card" title="后端未配置 LLM key，当前为 mock 草稿">
              mock 草稿
            </span>
          )}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="border border-line bg-white text-moss rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-card hover:bg-moss-soft disabled:opacity-40"
          >
            {exporting ? "导出中…" : "⤓ 导出 HTML"}
          </button>
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className="border border-line bg-white text-moss rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-card hover:bg-moss-soft"
          >
            {panelOpen ? "▸ 收起" : "☰ 行程"}
          </button>
        </div>
      </div>

      {/* 右侧滑出面板 */}
      <aside
        className={`fixed top-0 right-0 bottom-0 w-[400px] max-w-[calc(100vw-96px)] bg-cream z-[400] shadow-[-10px_0_40px_rgba(43,43,40,0.15)] border-l border-line flex flex-col transition-transform duration-300 ${panelOpen ? "translate-x-0" : "translate-x-[calc(100%+2px)]"}`}
      >
        <div className="flex-1 overflow-y-auto px-[18px] pb-10 pt-2">
          <Timeline
            route={route}
            activeKey={activeKey}
            onPlaceClick={handlePlaceClick}
            onHotelClick={handleHotelClick}
          />
        </div>
        <div className="px-[18px] py-3.5 border-t border-line bg-white text-[11px] text-[#A8A298] text-center">
          由 IterTrip · AI 生成行程 · 价格由用户手动提供
        </div>
      </aside>
    </div>
  );
}