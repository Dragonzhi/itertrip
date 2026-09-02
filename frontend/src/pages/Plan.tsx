import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "../components/MapView";
import MapSettings from "../components/MapSettings";
import Timeline from "../components/Timeline";
import PlaceForm, { PICK_HINT_ADD, PICK_HINT_REPICK, type PlaceDraft } from "../components/PlaceForm";
import HotelForm, { PICK_HINT_REPICK_HOTEL, type HotelDraft } from "../components/HotelForm";
import { useTripHistory } from "../hooks/useTripHistory";
import type { PlaceType, RouteJSON } from "../types/route";
import { exportHtml, chatStream, type ChatStreamEvent } from "../api/client";
import { diffRoute, type RouteDiff } from "../lib/routeDiff";
import type { ChatMessage } from "../types/chat";
import { loadMapSettings, saveMapSettings, type MapSettings as MapSettingsType, type LlmSettings } from "../lib/settings";

interface PlanProps {
  route: RouteJSON;
  source: string;
  /** 行程变化回传 App 层（localStorage 持久化用） */
  onRouteChange?: (r: RouteJSON) => void;
  onRestart: () => void;
  /** BYOK 设置（对话改路线请求用） */
  settings: LlmSettings;
}

type FormState =
  | { mode: "add"; draft: PlaceDraft; dayIdx: number }
  | { mode: "edit"; draft: PlaceDraft; target: { di: number; pi: number }; hasCoord: boolean };

/** 规划页：全屏地图 + 时间线 + 交互编辑器（拖拽/删除/新增/编辑/撤销重做/双导出）。 */
export default function Plan({ route: initialRoute, source, onRouteChange, onRestart, settings }: PlanProps) {
  const { route, mutate, undo, redo, canUndo, canRedo } = useTripHistory(initialRoute);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [hotelForm, setHotelForm] = useState<{ target: { di: number }; hasCoord: boolean } | null>(null);
  const [hotelDraft, setHotelDraft] = useState<HotelDraft>({ name: "", note: "", lat: 0, lng: 0 });
  const [picking, setPicking] = useState<null | { purpose: "add" } | { purpose: "repick"; target: { di: number; pi: number } } | { purpose: "repick-hotel"; target: { di: number } }>(null);
  const lastActiveDayRef = useRef(0);
  /* M16：地图显示设置（纯前端视图态，持久化到 localStorage） */
  const [mapView, setMapView] = useState<MapSettingsType>(() => loadMapSettings());
  useEffect(() => { saveMapSettings(mapView); }, [mapView]);

  /* ---------- M14：对话抽屉 + AI 改路线（流式，优化①） ---------- */
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  /** 流式过程：当前阶段播报 label + 正在流出的回复文本 */
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [flashKeys, setFlashKeys] = useState<string[]>([]);
  /** 优化④：地点交互 {key, seq, mode}；peek=单击弹框，zoom=双击聚焦 */
  const [focus, setFocus] = useState<{ key: string; seq: number; mode: "peek" | "zoom" } | null>(null);
  /** 右侧工具条：导出二级菜单开合 */
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);

  // 点击工具条外部关闭导出菜单
  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [exportOpen]);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  useEffect(() => {
    if (chatOpen) chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [chatMsgs.length, aiBusy, chatOpen, streamText, stageLabel]);

  const sendAiEdit = async (text: string) => {
    const t = text.trim();
    if (!t || aiBusy) return;
    const userMsg: ChatMessage = { id: uid(), role: "user", content: t };
    const history = chatMsgs
      .filter((m) => !m.error)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));
    setChatMsgs((prev) => [...prev, userMsg]);
    setChatInput("");
    setAiBusy(true);
    setStageLabel(null);
    setStreamText("");
    const onEvent = (ev: ChatStreamEvent) => {
      if (ev.event === "stage") setStageLabel(ev.label || null);
      else if (ev.event === "delta") setStreamText((prev) => prev + (ev.text || ""));
    };
    try {
      const r = await chatStream({ prompt: t, history, route }, settings, onEvent);
      setStageLabel(null);
      const diff: RouteDiff | null = r.route ? diffRoute(route, r.route) : null;
      const reply: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: r.reply || streamText,
        route: r.route || undefined,
        changed: !!(diff && diff.changed),
        changeSummary: diff && diff.changed ? diff.summary : undefined,
      };
      setStreamText("");
      setChatMsgs((prev) => [...prev, reply]);
      if (r.route && diff && diff.changed) {
        mutate((draft) => {
          draft.days = r.route!.days;
          draft.trip = r.route!.trip;
          draft.summary = r.route!.summary;
        }); // 同一历史栈：AI 改动可撤销
        const keys: string[] = [
          ...diff.added.map((a) => "d" + a.di + "-p" + a.pi),
          ...diff.moved.map((m) => "d" + m.toDi + "-p" + m.toPi),
        ];
        setFlashKeys(keys);
      }
    } catch (e) {
      setStageLabel(null);
      setStreamText("");
      setChatMsgs((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: e instanceof Error ? e.message : String(e), error: true },
      ]);
    } finally {
      setAiBusy(false);
    }
  };

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
    // 优化④：单击只弹详细框，不挪地图（消除「整体抽动」）
    setFocus({ key: "d" + di + "-p" + pi, seq: Date.now(), mode: "peek" });
  };
  const handlePlaceFocus = (di: number, pi: number) => {
    setActiveKey("d" + di + "-p" + pi);
    setFocus({ key: "d" + di + "-p" + pi, seq: Date.now(), mode: "zoom" });
  };
  const handleHotelClick = (di: number) => {
    setActiveKey("d" + di + "-hotel");
    setPanelOpen(true);
    setFocus({ key: "d" + di + "-hotel", seq: Date.now(), mode: "peek" });
  };
  const handleHotelFocus = (di: number) => {
    setActiveKey("d" + di + "-hotel");
    setFocus({ key: "d" + di + "-hotel", seq: Date.now(), mode: "zoom" });
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
    if (p.purpose === "repick-hotel") {
      const t = p.target;
      mutate((r) => {
        const h = r.days[t.di]?.hotel;
        if (!h) return;
        if (Math.abs(h.lat - rounded.lat) < 1e-9 && Math.abs(h.lng - rounded.lng) < 1e-9) return; // 点回原位不进历史
        h.lat = rounded.lat;
        h.lng = rounded.lng;
      });
      setHotelDraft((d) => ({ ...d, lat: rounded.lat, lng: rounded.lng }));
      lastActiveDayRef.current = t.di;
      return;
    }
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

  /* ---------- M16：酒店逐天自定义 ---------- */
  const openHotelForm = (di: number) => {
    const h = route.days[di]?.hotel;
    if (!h) return;
    lastActiveDayRef.current = di;
    setHotelDraft({ name: h.name || "", note: h.note || "", lat: h.lat, lng: h.lng });
    setHotelForm({ target: { di }, hasCoord: h.lat != null && (h.lat !== 0 || h.lng !== 0) });
  };
  const startHotelRepick = () => {
    if (!hotelForm) return;
    const t = hotelForm.target;
    setHotelForm(null);
    setPicking({ purpose: "repick-hotel", target: t });
  };
  const saveHotel = (scope: "day" | "all") => {
    if (!hotelForm) return;
    const d = { name: hotelDraft.name, note: hotelDraft.note, lat: hotelDraft.lat, lng: hotelDraft.lng };
    if (!d.name.trim()) return;
    const t = hotelForm.target;
    mutate((r) => {
      const base = r.days[t.di];
      if (!base) return;
      const apply = (hh: { name: string; note?: string; lat: number; lng: number }) => {
        hh.name = d.name; hh.note = d.note;
        hh.lat = d.lat; hh.lng = d.lng;
      };
      if (scope === "all") {
        // 设为所有天默认酒店：复制到每一个有酒店（或所有）天
        let any = false;
        r.days.forEach((day) => {
          if (day.hotel) { apply(day.hotel); any = true; }
        });
        if (!any && base.hotel) base.hotel.name = d.name; // 极端：天都为 null 时至少改当天
        void any;
      } else {
        if (base.hotel) apply(base.hotel);
      }
    });
    lastActiveDayRef.current = t.di;
    setHotelForm(null);
  };

  /* ---------- Esc：关表单 / 退选点 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (form) { setForm(null); return; }
        if (hotelForm) { setHotelForm(null); return; }
        if (picking) { setPicking(null); return; }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [form, hotelForm, picking]);

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
  const toggleChat = () => {
    setChatOpen((v) => {
      if (!v) setTimeout(() => chatInputRef.current?.focus(), 320);
      else setFlashKeys([]);
      return !v;
    });
  };
  const pickHint = picking ? (picking.purpose === "repick-hotel" ? PICK_HINT_REPICK_HOTEL : picking.purpose === "repick" ? PICK_HINT_REPICK : PICK_HINT_ADD) : null;

  return (
    <div className="h-screen overflow-hidden">
      <MapView
        route={route}
        activeDay={activeDay}
        picking={!!picking}
        onPick={handlePick}
        onPlaceClick={handlePlaceClick}
        onHotelClick={handleHotelClick}
        onPlaceFocus={handlePlaceFocus}
        onHotelFocus={handleHotelFocus}
        flashKeys={flashKeys}
        focus={focus}
        viewOffset={(chatOpen ? 380 : 0) + (panelOpen ? 400 : 0)}
        view={mapView}
      />

      {/* AI 抽屉手柄：左侧边缘凸出的半圆按钮，点击带动整个侧边栏拉出 */}
      <button
        onClick={toggleChat}
        className={
          "fixed top-1/2 -translate-y-1/2 z-[420] flex items-center justify-center w-[26px] h-[92px] rounded-r-[14px] rounded-l-none bg-moss text-white shadow-card transition-all duration-300 hover:bg-[#175740] hover:w-[30px] " +
          (chatOpen ? "left-[380px]" : "left-0")
        }
        title={chatOpen ? "收起 AI 对话" : "打开 AI 对话（让 AI 改行程）"}
        data-testid="chat-reentry"
      >
        <span className={"text-[15px] transition-transform duration-300 " + (chatOpen ? "rotate-180" : "")}>
          {chatOpen ? "◂" : "▸"}
        </span>
      </button>

      {/* 顶部悬浮标题（优化②：抽屉打开时整体让位，避免遮挡） */}
      <div
        className="fixed top-3.5 right-3.5 z-[500] flex items-center gap-3 pointer-events-none transition-[left] duration-300"
        style={{ left: chatOpen ? 396 : 14 }}
      >
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
          <button onClick={() => setPanelOpen((v) => !v)} className="border border-line bg-white text-moss rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-card hover:bg-moss-soft">
            {panelOpen ? "▸ 收起" : "☰ 行程"}
          </button>
        </div>
      </div>

      {/* M14：AI 对话改行程抽屉（地图常驻，改动走同一撤销栈） */}
      <aside
        className={`fixed top-0 left-0 bottom-0 w-[380px] max-w-[calc(100vw-96px)] bg-cream z-[400] shadow-[10px_0_40px_rgba(43,43,40,0.15)] border-r border-line flex flex-col transition-transform duration-300 ${
          chatOpen ? "translate-x-0" : "-translate-x-[calc(100%+2px)]"
        }`}
        data-testid="ai-drawer"
        aria-hidden={!chatOpen}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-white">
          <span className="text-lg">🤖</span>
          <h2 className="text-sm font-bold flex-1">AI 改行程</h2>
          <span className="text-[10px] text-ink-soft">改动可撤销 · 地图实时更新</span>
          <button onClick={toggleChat} className="text-ink-soft hover:text-ink leading-none" aria-label="关闭对话抽屉">✕</button>
        </div>
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5 min-h-0">
          {chatMsgs.length === 0 && !aiBusy && (
            <div className="text-center pt-8 px-3">
              <div className="text-3xl mb-2">🪄</div>
              <p className="text-sm font-bold mb-1">让 AI 动手改</p>
              <p className="text-xs text-ink-soft leading-relaxed">
                例如：「第二天太赶，博物馆挪到第一天下午」「加一个 Day3 晚上的去处」。
                <br />
                改完地图会高亮变化处，撤销按钮随时反悔。
              </p>
            </div>
          )}
          {chatMsgs.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] bg-moss text-white rounded-2xl rounded-br-sm px-3 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words"
                    : "max-w-[90%] bg-white border border-line rounded-2xl rounded-bl-sm px-3 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words" + (m.error ? " border-[#E0C3C3] bg-[#FDF4F4]" : "")
                }
              >
                {m.content}
                {m.changeSummary && m.changeSummary.length > 0 && (
                  <ul className="mt-1.5 pt-1.5 border-t border-line/60 space-y-0.5" data-testid="change-summary">
                    {m.changeSummary.map((s, i) => (
                      <li key={i} className="text-xs text-moss font-medium">✓ {s}</li>
                    ))}
                  </ul>
                )}
                {m.role === "assistant" && m.changed && (
                  <div className="text-[10px] text-ink-soft mt-1">地图已更新 · 撤销按钮可反悔</div>
                )}
              </div>
            </div>
          ))}
          {aiBusy && (
            <div className="space-y-1.5" data-testid="ai-streaming">
              {stageLabel && (
                <div className="flex items-center gap-1.5 text-xs text-moss font-medium px-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-moss animate-pulse" />
                  {stageLabel}
                </div>
              )}
              {streamText && (
                <div className="flex justify-start">
                  <div className="max-w-[90%] bg-white border border-line rounded-2xl rounded-bl-sm px-3 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                    {streamText}
                    <span className="inline-block w-[2px] h-[14px] bg-moss align-middle ml-0.5 animate-pulse" />
                  </div>
                </div>
              )}
              {!streamText && !stageLabel && (
                <div className="text-xs text-ink-soft animate-pulse px-1">AI 正在思考…</div>
              )}
            </div>
          )}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); sendAiEdit(chatInput); }}
          className="border-t border-line bg-white p-2.5"
        >
          <div className="flex gap-2 items-end">
            <textarea
              ref={chatInputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendAiEdit(chatInput);
                }
              }}
              rows={2}
              placeholder="告诉 AI 怎么改，例如「第二天加点美食」…"
              className="flex-1 resize-none border border-line rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || aiBusy}
              className="bg-moss text-white rounded-xl px-3.5 py-2.5 text-[13px] font-bold hover:bg-[#175740] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              发送
            </button>
          </div>
        </form>
      </aside>

      {/* 选点提示条 */}
      {pickHint && (
        <div className="fixed top-[62px] left-1/2 -translate-x-1/2 z-[600] bg-gold text-white px-[18px] py-2 rounded-full text-[13px] font-semibold shadow-card whitespace-nowrap">
          {pickHint}
        </div>
      )}

      {/* 右侧滑出面板 */}
      <aside
        data-testid="timeline-panel"
        className={`fixed top-0 right-0 bottom-0 w-[400px] max-w-[calc(100vw-96px)] bg-cream z-[400] shadow-[-10px_0_40px_rgba(43,43,40,0.15)] border-l border-line flex flex-col transition-transform duration-300 ${panelOpen ? "translate-x-0" : "translate-x-[calc(100%+2px)]"}`}
      >
        <div className="flex-1 overflow-y-auto px-[18px] pb-10 pt-2">
          <Timeline
            route={route}
            activeKey={activeKey}
            onPlaceClick={handlePlaceClick}
            onHotelClick={handleHotelClick}
            onPlaceFocus={handlePlaceFocus}
            onHotelFocus={handleHotelFocus}
            editing
            onDeletePlace={handleDelete}
            onEditPlace={openEditForm}
            onDropMove={handleDropMove}
            onEditHotel={openHotelForm}
            view={mapView}
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
            {/* 导出二级菜单（优化②：JSON/HTML 收进右侧工具条） */}
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen((v) => !v)}
                className="border border-line bg-white text-moss rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:bg-moss-soft"
                title="导出行程"
                data-testid="export-trigger"
              >
                ⤓ 导出
              </button>
              {exportOpen && (
                <div className="absolute bottom-[calc(100%+6px)] right-0 w-[150px] bg-white border border-line rounded-xl shadow-card p-1 z-[600] space-y-0.5">
                  <button
                    onClick={handleExportJson}
                    className="w-full text-left px-3 py-2 text-[13px] font-semibold text-ink rounded-lg hover:bg-moss-soft hover:text-moss"
                  >
                    ⤓ 导出 JSON
                  </button>
                  <button
                    onClick={handleExportHtml}
                    disabled={exporting}
                    className="w-full text-left px-3 py-2 text-[13px] font-semibold text-ink rounded-lg hover:bg-moss-soft hover:text-moss disabled:opacity-40"
                  >
                    {exporting ? "导出中…" : "⤓ 导出 HTML"}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="mt-2 text-[11px] text-[#A8A298] text-center">由 IterTrip · AI 生成行程 · 价格由用户手动提供</div>
        </div>
      </aside>

      {/* M16：右下角地图显示设置 */}
      <MapSettings value={mapView} onChange={(patch) => setMapView((v) => ({ ...v, ...patch }))} panelOpen={panelOpen} />

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

      {/* M16：酒店逐天编辑表单 */}
      {hotelForm && (
        <HotelForm
          mode="edit"
          draft={hotelDraft}
          hasCoord={hotelForm.hasCoord}
          dayLabel={"D" + (route.days[hotelForm.target.di]?.day || hotelForm.target.di + 1) + " · 第 " + (hotelForm.target.di + 1) + " 天"}
          picking={false}
          onChange={(patch) => setHotelDraft((d) => ({ ...d, ...patch }))}
          onSave={saveHotel}
          onCancel={() => setHotelForm(null)}
          onStartRepick={startHotelRepick}
        />
      )}
    </div>
  );
}