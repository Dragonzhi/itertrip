import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "../components/MapView";
import Timeline from "../components/Timeline";
import PlaceForm, { PICK_HINT_ADD, PICK_HINT_REPICK, type PlaceDraft } from "../components/PlaceForm";
import { useTripHistory } from "../hooks/useTripHistory";
import type { PlaceType, RouteJSON } from "../types/route";
import { exportHtml } from "../api/client";

interface PlanProps {
  route: RouteJSON;
  source: string;
  /** 行程变化回传 App 层（localStorage 持久化用） */
  onRouteChange?: (r: RouteJSON) => void;
  onRestart: () => void;
  /** 回到对话屏，继续用 AI 改路线（M13/M14） */
  onOpenChat: () => void;
}

type FormState =
  | { mode: "add"; draft: PlaceDraft; dayIdx: number }
  | { mode: "edit"; draft: PlaceDraft; target: { di: number; pi: number }; hasCoord: boolean };

/** 规划页：全屏地图 + 时间线 + 交互编辑器（拖拽/删除/新增/编辑/撤销重做/双导出）。 */
export default function Plan({ route: initialRoute, source, onRouteChange, onRestart, onOpenChat }: PlanProps) {
  const { route, mutate, undo, redo, canUndo, canRedo } = useTripHistory(initialRoute);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [picking, setPicking] = useState<null | { purpose: "add" } | { purpose: "repick"; target: { di: number; pi: number } }>(null);
  const lastActiveDayRef = useRef(0);

  const activeDay = useMemo(() => {
    if (!activeKey) return -1;
    const m = activeKey.match(/^d(\d+)-/);
    return m ? Number(m[1]) : -1;
  }, [activeKey]);

  const trip = route.trip;
  const metas = [trip.destination, trip.dates, trip.budget, trip.travelers].filter(Boolean);

  // 行程任何变更回传 App 层持久化（route 引用即快照）
  useEffect(() => {
    onRouteChange?.(route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  /* ---------- 双向联动 ---------- */
  const handlePlaceClick = (di: number, pi: number) => {
    setActiveKey("d" + di + "-p" + pi);
    lastActiveDayRef.current = di;
    setPanelOpen(true);
  };
  const handleHotelClick = (di: number) => {
    setActiveKey("d" + di + "-hotel");
    setPanelOpen(true);
  };

  /* ---------- 编辑器：删除 / 拖拽移动 ---------- */
  const handleDelete = (di: number, pi: number) => {
    mutate((r) => { r.days[di].places.splice(pi, 1); });
  };

  const handleDropMove = (srcDi: number, srcPi: number, dstDi: number, dstPi: number) => {
    mutate((r) => {
      let idx = dstPi;
      if (srcDi === dstDi && idx > srcPi) idx -= 1;   // 同天先删后插补偿（DESIGN 红线）
      if (srcDi === dstDi && idx === srcPi) return;   // 原位放置：不进历史
      const moved = r.days[srcDi].places.splice(srcPi, 1)[0];
      r.days[dstDi].places.splice(idx, 0, moved);
    });
  };

  /* ---------- 编辑器：选点新增 / 编辑表单 ---------- */
  const openAddFlow = () => {
    setForm(null);
    setPicking({ purpose: "add" });
  };

  const handlePick = (lat: number, lng: number) => {
    const p = picking;
    setPicking(null);
    if (!p) return;
    const rounded = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    if (p.purpose === "repick") {
      const t = p.target;
      mutate((r) => {
        const place = r.days[t.di]?.places[t.pi];
        if (!place) return;
        if (place.lat != null && Math.abs(place.lat - rounded.lat) < 1e-9 && Math.abs(place.lng - rounded.lng) < 1e-9) return; // 点回原位不进历史
        place.lat = rounded.lat;
        place.lng = rounded.lng;
      });
      lastActiveDayRef.current = t.di;
      return;
    }
    // add：带坐标打开新增表单
    setForm({
      mode: "add",
      dayIdx: Math.min(lastActiveDayRef.current, route.days.length - 1),
      draft: { name: "", type: "attraction", time: "", transport: "", ticket: "", note: "", ...rounded },
    });
  };

  const openEditForm = (di: number, pi: number) => {
    const p = route.days[di]?.places[pi];
    if (!p) return;
    lastActiveDayRef.current = di;
    setForm({
      mode: "edit",
      target: { di, pi },
      hasCoord: p.lat != null,
      draft: {
        name: p.name || "",
        type: (p.type || "attraction") as PlaceType,
        time: p.time || "",
        transport: p.transport || "",
        ticket: p.ticket || "",
        note: p.note || "",
        lat: p.lat ?? 0,
        lng: p.lng ?? 0,
      },
    });
  };

  const startRepick = () => {
    if (!form || form.mode !== "edit") return;
    const t = form.target;
    setForm(null);          // 关表单（清 target，参照旧版 startRepick 先复制目标）
    setPicking({ purpose: "repick", target: t });
  };

  const saveForm = () => {
    if (!form) return;
    const d = form.draft;
    if (!d.name.trim()) return;
    if (form.mode === "edit") {
      const t = form.target;
      mutate((r) => {
        const p = r.days[t.di]?.places[t.pi];
        if (!p) return;
        // 空修改检测（DESIGN 红线）：字段与坐标全部一致 → 不进历史
        const fieldsSame =
          (p.name || "") === d.name && (p.type || "attraction") === d.type &&
          (p.time || "") === d.time && (p.transport || "") === d.transport &&
          (p.ticket || "") === d.ticket && (p.note || "") === d.note;
        const posSame = (p.lat ?? 0) === d.lat && (p.lng ?? 0) === d.lng;
        if (fieldsSame && posSame) return;
        p.name = d.name; p.type = d.type; p.time = d.time;
        p.transport = d.transport; p.ticket = d.ticket; p.note = d.note;
        if (!posSame) { p.lat = d.lat; p.lng = d.lng; }   // 无坐标地点不得写入 0,0
      });
      lastActiveDayRef.current = form.target.di;
    } else {
      const di = form.dayIdx;
      mutate((r) => {
        r.days[di].places.push({
          name: d.name.trim(), lat: d.lat, lng: d.lng, type: d.type,
          time: d.time, transport: d.transport, ticket: d.ticket, note: d.note,
        });
      });
      lastActiveDayRef.current = di;
    }
    setForm(null);
  };

  /* ---------- Esc：关表单 / 退选点 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (form) { setForm(null); return; }
        if (picking) { setPicking(null); return; }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [form, picking]);

  /* ---------- 导出 ---------- */
  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(route, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my_trip.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const handleExportHtml = async () => {
    setExporting(true);
    try { await exportHtml(route, "itertrip_" + trip.destination + "_edited"); } finally { setExporting(false); }
  };

  const dayOptions = route.days.map((d, i) => ({ index: i, label: "D" + (d.day || i + 1) + (d.theme ? " · " + d.theme : "") }));
  const pickHint = picking ? (picking.purpose === "repick" ? PICK_HINT_REPICK : PICK_HINT_ADD) : null;

  return (
    <div className="h-screen overflow-hidden">
      <MapView
        route={route}
        activeDay={activeDay}
        picking={!!picking}
        onPick={handlePick}
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
          <button
            onClick={onOpenChat}
            className="border border-line bg-white text-moss rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-card hover:bg-moss-soft"
            title="回到对话框，让 AI 继续修改路线"
            data-testid="chat-reentry"
          >
            💬 对话
          </button>
          {source === "mock" && (
            <span className="bg-gold-soft text-gold text-xs font-semibold rounded-full px-3 py-2 shadow-card" title="后端未配置 LLM key，当前为 mock 草稿">
              mock 草稿
            </span>
          )}
          <button onClick={handleExportJson} className="border border-line bg-white text-moss rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-card hover:bg-moss-soft">
            ⤓ JSON
          </button>
          <button onClick={handleExportHtml} disabled={exporting} className="border border-line bg-white text-moss rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-card hover:bg-moss-soft disabled:opacity-40">
            {exporting ? "导出中…" : "⤓ HTML"}
          </button>
          <button onClick={() => setPanelOpen((v) => !v)} className="border border-line bg-white text-moss rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-card hover:bg-moss-soft">
            {panelOpen ? "▸ 收起" : "☰ 行程"}
          </button>
        </div>
      </div>

      {/* 选点提示条 */}
      {pickHint && (
        <div className="fixed top-[62px] left-1/2 -translate-x-1/2 z-[600] bg-gold text-white px-[18px] py-2 rounded-full text-[13px] font-semibold shadow-card whitespace-nowrap">
          {pickHint}
        </div>
      )}

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
            editing
            onDeletePlace={handleDelete}
            onEditPlace={openEditForm}
            onDropMove={handleDropMove}
          />
        </div>
        {/* 工具条 */}
        <div className="px-[18px] py-3 border-t border-line bg-white">
          <div className="flex gap-1.5 items-center justify-center flex-wrap">
            <button onClick={undo} disabled={!canUndo} className="border border-line bg-white text-moss rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:bg-moss-soft disabled:opacity-35">
              ↩ 撤销
            </button>
            <button onClick={redo} disabled={!canRedo} className="border border-line bg-white text-moss rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:bg-moss-soft disabled:opacity-35">
              ↪ 重做
            </button>
            <span className="w-px h-4 bg-line" />
            <button onClick={openAddFlow} className="bg-gold text-white border border-gold rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:opacity-90">
              📍 添加地点
            </button>
          </div>
          <div className="mt-2 text-[11px] text-[#A8A298] text-center">由 IterTrip · AI 生成行程 · 价格由用户手动提供</div>
        </div>
      </aside>

      {/* 新增/编辑表单 */}
      {form && (
        <PlaceForm
          mode={form.mode}
          draft={form.draft}
          hasCoord={form.mode === "edit" ? form.hasCoord : true}
          dayOptions={dayOptions}
          initialDay={form.mode === "add" ? form.dayIdx : 0}
          picking={false}
          onChange={(patch) => setForm((f) => (f ? { ...f, draft: { ...f.draft, ...patch } } : f))}
          onSave={saveForm}
          onCancel={() => setForm(null)}
          onStartRepick={startRepick}
        />
      )}
    </div>
  );
}
