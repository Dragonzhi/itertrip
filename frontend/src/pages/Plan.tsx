import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "../components/MapView";
import MapSettings from "../components/MapSettings";
import Timeline from "../components/Timeline";
import PlaceForm, { PICK_HINT_ADD, PICK_HINT_REPICK, type PlaceDraft } from "../components/PlaceForm";
import HotelForm, { PICK_HINT_REPICK_HOTEL, type HotelDraft } from "../components/HotelForm";
import { useTripHistory } from "../hooks/useTripHistory";
import type { Hotel, PlaceType, PriceItem, RouteJSON } from "../types/route";
import CalendarPicker from "../components/CalendarPicker";
import { exportHtml, dateCheck, geocode as geocodeApi, recheckRoute, reportPlaceEntity } from "../api/client";
import { ClarifyCard } from "../components/ChatPanel";
import ThinkingBlock from "../components/ThinkingBlock";
import DecisionTrace from "../components/DecisionTrace";
import CoordReport from "../components/CoordReport";
import { useChatStream } from "../hooks/useChatStream";
import { SendStopButton, StreamStatus } from "../components/StreamControls";
import { diffRoute, type RouteDiff } from "../lib/routeDiff";
import { describeStreamError } from "../lib/streamWatch";
import { coordDigest } from "../lib/coordDigest";
import { distanceKm } from "../lib/coordSource";
import { exportFilename } from "../lib/exportName";
import { isMobile } from "../lib/viewport";
import { moveTarget } from "../lib/reorder";
import { animate, motion, MotionConfig, useDragControls, useMotionValue } from "motion/react";
import type { ChatMessage, TraceStats } from "../types/chat";
import {
  clearPlanChatHistory,
  loadMapSettings,
  loadPlanChatHistory,
  loadSettings,
  routeFingerprint,
  saveMapSettings,
  savePlanChatHistory,
  type MapSettings as MapSettingsType,
  type LlmSettings,
} from "../lib/settings";

/** 供应商来源 → 人话（抽屉标题栏徽标用；key 永远不展示） */
const PROVIDER_LABEL: Record<string, string> = {
  byok: "你的 key",
  env: "环境变量",
  admin: "后台配置",
  free: "免费源",
  none: "未配置",
};

/** 坐标来源 → 文案（「按名称重新定位」结果说明用） */
const GEO_SOURCE_TEXT: Record<string, string> = {
  amap: "高德 POI", memory: "记忆库真值", llm: "模型知识", search: "网络搜索", city: "城市中心",
};

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
  const [panelOpen, setPanelOpen] = useState(() => !isMobile());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  /** M20：整条路线坐标重校准（修历史遗留的错坐标） */
  const [rechecking, setRechecking] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState("");
  /** M22：出发日期确认 + 闭馆日冲突检查（确定性，不调 LLM/高德） */
  const [dateChecking, setDateChecking] = useState(false);
  const [dateMsg, setDateMsg] = useState("");
  const dateAutoRef = useRef("");
  const [form, setForm] = useState<FormState | null>(null);
  /** M19：编辑表单里的「按名称重新定位」状态（定位中 / 结果说明） */
  const [relocating, setRelocating] = useState(false);
  const [relocateMsg, setRelocateMsg] = useState("");
  const [hotelForm, setHotelForm] = useState<{ target: { di: number }; hasCoord: boolean } | null>(null);
  const [hotelDraft, setHotelDraft] = useState<HotelDraft>({ name: "", note: "", lat: 0, lng: 0, prices: [] });
  const [picking, setPicking] = useState<null | { purpose: "add" } | { purpose: "repick"; target: { di: number; pi: number } } | { purpose: "repick-hotel"; target: { di: number } }>(null);
  const lastActiveDayRef = useRef(0);
  /* M16：地图显示设置（纯前端视图态，持久化到 localStorage） */
  const [mapView, setMapView] = useState<MapSettingsType>(() => loadMapSettings());
  useEffect(() => { saveMapSettings(mapView); }, [mapView]);

  /* ---------- M14：对话抽屉 + AI 改路线（流式，优化①）；M19：对话与决策轨迹持久化 ---------- */
  const fp = useMemo(() => routeFingerprint(initialRoute), [initialRoute]);
  const bootMsgs = useMemo(() => loadPlanChatHistory(fp), [fp]);
  const [chatOpen, setChatOpen] = useState(() => !isMobile() && bootMsgs.length > 0);
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>(bootMsgs);
  const [chatInput, setChatInput] = useState("");
  /** 优化②：对话流态（sending / 中断 / 心跳）统一由 useChatStream 提供，不再各自复制一份 */
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
  /** B3：闭合的抽屉必须真的不可聚焦 —— React 18 不支持布尔 inert（inert={false} 会渲染成 truthy 的 inert="false"），只能 ref + effect 手动设 */
  const chatDrawerRef = useRef<HTMLElement | null>(null);
  const panelDrawerRef = useRef<HTMLElement | null>(null);
  useEffect(() => { if (chatDrawerRef.current) chatDrawerRef.current.inert = !chatOpen; }, [chatOpen]);
  useEffect(() => { if (panelDrawerRef.current) panelDrawerRef.current.inert = !panelOpen; }, [panelOpen]);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  /**
   * 优化②：流式状态与中断统一交给 useChatStream（与首页共用同一套心跳/看门狗/停止语义）。
   * 只有真终帧（onReply）才走 diffRoute + mutate；中断**不动行程** ——
   * 改动的唯一载体是 reply 帧里的新 route，服务端无状态，没有东西需要回滚。
   */
  const stream = useChatStream({
    onReply: (r, partial, trace) => {
      const diff: RouteDiff | null = r.route ? diffRoute(route, r.route) : null;
      const reply: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: r.reply || partial,
        route: r.route || undefined,
        changed: !!(diff && diff.changed),
        changeSummary: diff && diff.changed ? diff.summary : undefined,
        questions: r.questions,
        trace: trace.length ? trace : undefined,
        stats: r.stats,
        geo: coordDigest(r.route) || undefined, // M24：坐标来源/降级摘要随消息常驻
      };
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
          ...diff.coordFixed.map((c) => "d" + c.di + "-p" + c.pi),
        ];
        setFlashKeys(keys);
      }
    },
    onError: (e, _partial, trace) => {
      setChatMsgs((prev) => [
        ...prev,
        {
          id: uid(), role: "assistant", error: true,
          content: describeStreamError(e),
          trace: trace.length ? trace : undefined,
        },
      ]);
    },
    onInterrupt: (partial, reason, trace) => {
      setChatMsgs((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: partial || (reason === "watchdog" ? "服务端长时间没有响应，已自动中断。" : "已停止生成。"),
          interrupted: true,
          trace: trace.length ? trace : undefined,
        },
      ]);
    },
  });

  useEffect(() => {
    if (chatOpen) chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [chatMsgs.length, stream.sending, chatOpen, stream.text, stream.stageLabel, stream.thinking, stream.trace.length, stream.health]);

  /* M19：抽屉对话持久化（此前只存内存，刷新即失；按行程指纹隔离，换行程自动开新会话） */
  useEffect(() => {
    savePlanChatHistory(chatMsgs, fp);
  }, [chatMsgs, fp]);

  /** 澄清卡提交/跳过后标记「已回答」，刷新恢复时不再重复渲染 */
  const markAnswered = (id: string) => {
    setChatMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, answered: true } : m)));
  };

  const clearPlanChat = () => {
    if (stream.sending || !chatMsgs.length) return;
    if (!window.confirm("确定清空当前对话记录吗？此操作不影响行程本身。")) return;
    clearPlanChatHistory();
    setChatMsgs([]);
  };

  /** 最近一轮的实际模型/来源（抽屉标题栏徽标：回答「这轮到底在用谁」） */
  const lastStats: TraceStats | null = useMemo(() => {
    for (let i = chatMsgs.length - 1; i >= 0; i -= 1) {
      const s = chatMsgs[i].stats;
      if (s && (s.model || s.provider)) return s;
    }
    return null;
  }, [chatMsgs]);

  /** 攒历史 + 交给钩子；成功/中断/报错三种收尾都在上面的 onReply/onInterrupt/onError 里 */
  const sendAiEdit = (text: string) => {
    const t = text.trim();
    if (!t || stream.sending) return;
    const userMsg: ChatMessage = { id: uid(), role: "user", content: t };
    const history = chatMsgs
      .filter((m) => !m.error)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));
    setChatMsgs((prev) => [...prev, userMsg]);
    setChatInput("");
    void stream.send({ prompt: t, history, route }, settings);
  };

  const activeDay = useMemo(() => {
    if (!activeKey) return -1;
    const m = activeKey.match(/^d(\d+)-/);
    return m ? Number(m[1]) : -1;
  }, [activeKey]);

  const trip = route.trip;
  const metas = [trip.destination, trip.dates, trip.budget, trip.travelers].filter(Boolean);

  /**
   * M18：用户在地图上手动确定/修改的位置就是坐标真值，回传记忆库（实体记忆）。
   * fire-and-forget：静默失败，绝不影响编辑操作；后续任何攻略出现同名同城地点可直接命中。
   */
  const reportCoord = (name: string, lat: number, lng: number) => {
    const n = (name || "").trim();
    if (!n || !lat || !lng) return;
    reportPlaceEntity(n, trip.destination, lat, lng);
  };

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
        h.source = "user";       // M19：用户亲手选点 = 真值来源
        h.confidence = "high";
      });
      setHotelDraft((d) => ({ ...d, lat: rounded.lat, lng: rounded.lng }));
      lastActiveDayRef.current = t.di;
      reportCoord(route.days[t.di]?.hotel?.name || "", rounded.lat, rounded.lng);
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
        place.source = "user";   // M19：用户亲手选点 = 真值来源（后续 AI 核验永不覆盖）
        place.confidence = "high";
      });
      lastActiveDayRef.current = t.di;
      reportCoord(route.days[t.di]?.places[t.pi]?.name || "", rounded.lat, rounded.lng);
      return;
    }
    // add：带坐标打开新增表单
    setForm({
      mode: "add",
      dayIdx: Math.min(lastActiveDayRef.current, route.days.length - 1),
      draft: {
        name: "", type: "attraction", time: "", transport: "", ticket: "", note: "",
        ...rounded, source: "user", confidence: "high",
      },
    });
  };

  const openEditForm = (di: number, pi: number) => {
    const p = route.days[di]?.places[pi];
    if (!p) return;
    lastActiveDayRef.current = di;
    setRelocateMsg("");
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
        source: p.source || "",
        confidence: p.confidence || "",
      },
    });
  };

  /**
   * M19：按名称重新定位（走 /api/geocode 降级链：记忆真值 → 高德 POI → 模型知识 → 兜底）。
   * 只写进表单草稿，用户按「保存修改」才进撤销栈 —— 与手动选点保持同一把关节奏。
   */
  const relocatePlace = async () => {
    if (!form || form.mode !== "edit" || relocating) return;
    const name = form.draft.name.trim();
    if (!name) return;
    const t = form.target;
    setRelocating(true);
    setRelocateMsg("");
    try {
      const r = await geocodeApi(name, trip.destination, settings);
      if (r.lat == null || r.lng == null) {
        setRelocateMsg(`没找到「${name}」的坐标：可以点「🗺 更改位置」直接在地图上选点。`);
        return;
      }
      const prev = route.days[t.di]?.places[t.pi];
      const moved = prev && prev.lat ? distanceKm(prev, { lat: r.lat, lng: r.lng }) : 0;
      const src = GEO_SOURCE_TEXT[r.source || ""] || "坐标服务";
      setForm((f) => (f && f.mode === "edit" ? {
        ...f,
        draft: { ...f.draft, lat: r.lat!, lng: r.lng!, source: r.source || "", confidence: r.confidence },
      } : f));
      setRelocateMsg(
        `已按「${src}」定位到 ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`
        + (moved > 0.05 ? `（与原位置相差 ${moved < 1 ? Math.round(moved * 1000) + "m" : moved.toFixed(1) + "km"}）` : "")
        + " · 按「保存修改」才会写入行程",
      );
    } catch (e) {
      setRelocateMsg("定位失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRelocating(false);
    }
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
      const prev = route.days[t.di]?.places[t.pi];
      const posChanged = !!prev && ((prev.lat ?? 0) !== d.lat || (prev.lng ?? 0) !== d.lng);
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
        if (!posSame) {
          // 无坐标地点不得写入 0,0；M19 同时记录坐标出处（用户选点 / 重新定位拿到的来源）
          p.lat = d.lat; p.lng = d.lng;
          p.source = d.source || "user";
          p.confidence = d.confidence || (d.source && d.source !== "user" ? "" : "high");
        }
      });
      if (posChanged) reportCoord(d.name, d.lat, d.lng);  // M18：手改坐标 = 真值
      lastActiveDayRef.current = form.target.di;
    } else {
      const di = form.dayIdx;
      mutate((r) => {
        r.days[di].places.push({
          name: d.name.trim(), lat: d.lat, lng: d.lng, type: d.type,
          time: d.time, transport: d.transport, ticket: d.ticket, note: d.note,
          source: d.source || "user", confidence: d.confidence || "high",
        });
      });
      reportCoord(d.name.trim(), d.lat, d.lng);  // M18：地图选点新增 = 真值
      lastActiveDayRef.current = di;
    }
    setForm(null);
    setRelocateMsg("");
  };

  /* ---------- M16：酒店逐天自定义 ---------- */
  const openHotelForm = (di: number) => {
    const h = route.days[di]?.hotel;
    if (!h) return;
    lastActiveDayRef.current = di;
    setHotelDraft({
      name: h.name || "", note: h.note || "", lat: h.lat, lng: h.lng,
      prices: (h.prices || []).map((pr) => ({ ...pr })),
    });
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
    // 只留真正填了价格的报价；平台留空补「手动录入」（与后端 _sanitize_prices 的兜底口径一致）
    const prices = (hotelDraft.prices || [])
      .filter((pr) => Number(pr.price) > 0)
      .map((pr) => ({
        platform: (pr.platform || "").trim() || "手动录入",
        price: Number(pr.price),
        breakfast: !!pr.breakfast,
        note: (pr.note || "").trim(),
      }));
    const d = { name: hotelDraft.name, note: hotelDraft.note, lat: hotelDraft.lat, lng: hotelDraft.lng, prices };
    if (!d.name.trim()) return;
    const t = hotelForm.target;
    mutate((r) => {
      const base = r.days[t.di];
      if (!base) return;
      const apply = (hh: Hotel) => {
        hh.name = d.name; hh.note = d.note;
        hh.lat = d.lat; hh.lng = d.lng;
        hh.prices = d.prices.map((pr) => ({ ...pr }));
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

  /* ---------- M22.1：搜索到的酒店报价「存入行程」---------- */
  /**
   * 「🔍 搜索网络报价」此前只把结果拼在表格里给人看，一刷新就没了 —— 用户搜到价格却存不下来。
   * 这里按「平台 + 价格」去重后并入该天的 hotel.prices（走同一条撤销栈）。
   */
  const saveHotelPrices = (di: number, incoming: PriceItem[]) => {
    if (!incoming.length) return;
    mutate((r) => {
      const h = r.days[di]?.hotel;
      if (!h) return;
      const merged: PriceItem[] = (h.prices || []).map((pr) => ({ ...pr }));
      for (const pr of incoming) {
        const price = Number(pr.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        const platform = (pr.platform || "").trim() || "搜索来源";
        if (merged.some((x) => x.platform === platform && Number(x.price) === price)) continue;
        merged.push({
          platform, price,
          breakfast: !!pr.breakfast,
          note: (pr.note || "").trim(),
        });
      }
      h.prices = merged;
    });
  };

  /* ---------- Esc：关表单 / 退选点 ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (form) { setForm(null); return; }
        if (hotelForm) { setHotelForm(null); return; }
        if (picking) { setPicking(null); return; }
        if (exportOpen) { setExportOpen(false); return; }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [form, hotelForm, picking, exportOpen]);

  /* ---------- 导出 ---------- */
  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(route, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    // 文件名 = 当前行程的规划名（trip.title），与页面标题一致
    a.download = `${exportFilename(route)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const handleExportHtml = async () => {
    setExporting(true);
    setExportError("");
    try {
      await exportHtml(route, exportFilename(route));
      setExportOpen(false);
    } catch (e) {
      // 失败必须可见（此前静默无反应）：后端 422 detail / 网络错误均落到这里
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  /* ---------- 坐标重校准（M20）---------- */
  /** 整条路线重新核验坐标：修历史遗留的错坐标，用户手改过的点不会被覆盖，可撤销。 */
  const handleRecheck = async () => {
    if (rechecking) return;
    setRechecking(true);
    setRecheckMsg("");
    try {
      const res = await recheckRoute(route, loadSettings());
      const unsure = res.records.filter((r) => r.action === "conflict").length;
      mutate((draft) => {
        draft.days = res.route.days;
      });
      setFlashKeys([]);
      setRecheckMsg(
        (res.filled > 0 ? `已校准/补全 ${res.filled} 处坐标` : "坐标都已核对过，无需调整") +
          (unsure > 0 ? `；${unsure} 处存疑已标【坐标待确认】` : "") +
          (res.amapReason ? `（高德：${res.amapReason}）` : ""),
      );
    } catch (e) {
      setRecheckMsg("校准失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRechecking(false);
    }
  };

  /* ---------- 出发日期与闭馆日检查（M22）---------- */
  /**
   * 定出发日期 + 查闭馆日冲突：确定性算术，**不调 LLM、不调高德**。
   * `iso` 有值 = 用户手选（date_source=user）；不传 = 由后端就近推断（标 inferred）。
   * 结果走 `mutate` —— 与手动编辑同一条撤销栈（改日期可 Ctrl+Z）。
   */
  const handleDateCheck = async (iso?: string) => {
    if (dateChecking) return;
    setDateChecking(true);
    setDateMsg("");
    try {
      const res = await dateCheck(route, iso ?? "");
      mutate((draft) => {
        draft.trip.start_date = res.route.trip.start_date || "";
        draft.trip.date_source = res.route.trip.date_source || "";
        if (res.route.trip.dates) draft.trip.dates = res.route.trip.dates;
        draft.days = res.route.days;
      });
      setDateMsg(res.summary);
    } catch (e) {
      setDateMsg("闭馆日检查失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDateChecking(false);
    }
  };

  // 导入的旧 JSON / 导出的 HTML 都不会带日期：进页面自动补跑一次（每条行程只跑一次）。
  useEffect(() => {
    if (route.trip.start_date) return;
    if (!route.days.some((d) => d.places.length > 0)) return;
    if (dateAutoRef.current === fp) return;
    dateAutoRef.current = fp;
    void handleDateCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp]);

  /** 有告警的地点数量（改日期后由 route 反推，无需额外状态） */
  const warnCount = useMemo(
    () => route.days.reduce((n, d) => n + d.places.filter((p) => (p.warnings?.length ?? 0) > 0).length, 0),
    [route],
  );

  const dayOptions = route.days.map((d, i) => ({ index: i, label: "D" + (d.day || i + 1) + (d.theme ? " · " + d.theme : "") }));
  /** M23：手机上两个抽屉都是底部 sheet，必须互斥（同时开就互相盖住） */
  const toggleChat = () => {
    const next = !chatOpen;
    if (next) {
      if (isMobile()) setPanelOpen(false);
      setTimeout(() => chatInputRef.current?.focus(), 320);
    } else {
      setFlashKeys([]);
    }
    setChatOpen(next);
  };
  const togglePanel = () => {
    const next = !panelOpen;
    if (next && isMobile()) setChatOpen(false);
    setPanelOpen(next);
  };
  /* M23 P4：抽屉拖拽手柄（只手机；桌面侧栏是左右滑出，纵向拖会撕裂）。
     dragListener=false → 只有手柄起拖，内部滚动列表照常滚。 */
  const draggable = isMobile();
  const chatDrag = useDragControls();
  const panelDrag = useDragControls();
  const chatY = useMotionValue(0);
  const panelY = useMotionValue(0);

  /** 手机上点地图收起抽屉（桌面两个侧栏可常驻，不动） */
  const closeSheets = () => {
    if (!isMobile()) return;
    setChatOpen(false);
    setPanelOpen(false);
  };
  const pickHint = picking ? (picking.purpose === "repick-hotel" ? PICK_HINT_REPICK_HOTEL : picking.purpose === "repick" ? PICK_HINT_REPICK : PICK_HINT_ADD) : null;

  /** M23：这两个元素描述在桌面顶栏与手机抽屉表头各渲染一份，由 CSS（max-md:hidden / md:hidden）决定谁可见。 */
  const metasJsx = (
    <div className="text-xs text-ink-soft mt-0.5">
      {metas.map((m, k) => (
        <span key={k}>{k > 0 && <span className="mx-1.5 text-[#C9C2B4]">·</span>}{m}</span>
      ))}
    </div>
  );
  const dateCardJsx = (
        <div
          className="bg-white border border-line rounded-[14px] px-3 py-2 shadow-card pointer-events-auto shrink-0"
          data-testid="date-card"
        >
          <div className="flex items-center gap-2">
            <div className="w-[188px]">
              <CalendarPicker
                value={trip.start_date || ""}
                onChange={(v) => void handleDateCheck(v)}
                placeholder={dateChecking ? "检查中…" : "设置出发日期"}
              />
            </div>
            {trip.start_date && trip.date_source === "inferred" && (
              <span
                className="text-[11px] font-semibold rounded-md px-1.5 py-px bg-[#F1EDE4] text-ink-soft shrink-0"
                title="文本里只有月日或节日名，年份是按「就近未来」推断的 —— 点日期即可改成准确的"
                data-testid="date-inferred"
              >
                推断
              </span>
            )}
            {trip.start_date && trip.date_source === "user" && (
              <span className="text-[11px] font-semibold rounded-md px-1.5 py-px bg-moss-soft text-moss shrink-0" data-testid="date-user">
                已确认
              </span>
            )}
            {warnCount > 0 && (
              <span
                className="text-[11px] font-semibold rounded-md px-1.5 py-px bg-[#F6E7E7] text-danger shrink-0"
                data-testid="date-warn-count"
              >
                ⚠️ {warnCount} 处闭馆日冲突
              </span>
            )}
            {!trip.start_date && route.days.some((d) => d.places.length > 0) && (
              <span
                className="text-[11px] font-semibold rounded-md px-1.5 py-px bg-gold-soft text-gold-deep shrink-0"
                title="没有出发日期就算不出星期，闭馆日冲突无从判定 —— 这不是「检查通过」"
                data-testid="date-unchecked"
              >
                未检查闭馆日
              </span>
            )}
          </div>
          {dateMsg && (
            <div role="status" className="text-[11px] text-ink-soft mt-1 max-w-[300px] truncate" title={dateMsg} data-testid="date-msg">
              {dateMsg}
            </div>
          )}
        </div>

  );

  return (
    <MotionConfig reducedMotion="user">
    <div className="h-[100dvh] overflow-hidden">
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
        bottomPadding={isMobile() && (chatOpen || panelOpen) ? Math.round(window.innerHeight * 0.7) : 0}
        onMapClick={closeSheets}
        view={mapView}
      />

      {/* AI 抽屉手柄：左侧边缘凸出的半圆按钮，点击带动整个侧边栏拉出 */}
      <button
        onClick={toggleChat}
        className={
          "max-md:hidden fixed top-1/2 -translate-y-1/2 z-[420] flex items-center justify-center w-[26px] h-[92px] rounded-r-[14px] rounded-l-none bg-moss text-white shadow-card transition-all duration-300 hover:bg-[#175740] hover:w-[30px] " +
          (chatOpen ? "left-[380px]" : "left-0")
        }
        title={chatOpen ? "收起 AI 对话" : "打开 AI 对话（让 AI 改行程）"}
        data-testid="chat-reentry"
      >
        <span className={"text-[15px] transition-transform duration-300 " + (chatOpen ? "rotate-180" : "")}>
          {chatOpen ? "◂" : "▸"}
        </span>
      </button>

      {/* 顶部悬浮标题（优化②：抽屉打开时整体让位，避免遮挡）：
          左侧让位给 AI 抽屉（left 随 chatOpen 变）。
          右侧**不**让位：试过让浮条避开行程面板，但 1280 上面板占 400px，浮条宽度掉到 852 后
          内容装不下，要么折行（加 flex-wrap：浮条从 60px 涨到 128px 甚至 214px 的多行堆），
          要么标题被压到只剩省略号 —— 都比现在难看。
          改为**面板自己让出顶部**：见下方「面板顶部让位带」。浮条照旧横铺，面板内容从带下沿开始。 */}
      <div
        className="fixed top-3 right-3 z-[500] flex items-center gap-2 md:gap-3 md:top-3.5 md:right-3.5 pointer-events-none transition-[left] duration-300"
        style={{ left: isMobile() ? 12 : chatOpen ? 396 : 14 }}
      >
        <div className="bg-white border border-line rounded-[14px] px-2.5 md:px-3.5 py-2 shadow-card flex items-center gap-2 pointer-events-auto shrink-0">
          <button onClick={onRestart} className="flex items-center gap-2 text-sm font-bold tracking-wide hover:text-moss" title="返回首页（保留当前行程）">
            <span className="text-lg">🧭</span>
            <span className="max-md:hidden">
              IterTrip
              <span className="block text-[11px] font-normal text-ink-soft tracking-[1px]">LATIN · ITER · ROAD</span>
            </span>
          </button>
        </div>
        <div className="bg-white border border-line rounded-[14px] px-3 md:px-4 py-2 shadow-card min-w-0 flex-1 md:flex-initial overflow-hidden pointer-events-auto">
          <h1 className="text-sm md:text-base font-bold whitespace-nowrap overflow-hidden text-ellipsis">{trip.title}</h1>
          {/* 元信息必须**单行**：顶栏在 AI 抽屉打开时会被挤窄（left 让到 396），
              这一行一换行，整条浮条就从 60px 涨到 76px，而面板顶部让位带是固定 74px ——
              2px 缝隙会让综合建议卡露头。改为 nowrap + 省略号：浮条高度恒定，
              让位带才算得准（顺带修好「抽屉打开时日期卡被挤出屏幕」的老问题）。 */}
          <div className="max-md:hidden whitespace-nowrap overflow-hidden text-ellipsis">{metasJsx}</div>
        </div>
        {/* M22：出发日期（算星期用）+ 闭馆日冲突状态。刻意放在标题卡外侧的同层，
            避免被标题卡的 overflow-hidden 裁掉日历弹层。
            M23：手机上这一份隐藏，改在「行程」抽屉表头渲染同款（同一 JSX 变量） */}
        <div className="max-md:hidden flex shrink-0">{dateCardJsx}</div>
        <div className="ml-auto flex gap-2 pointer-events-auto shrink-0">
          {source === "mock" && (
            <span className="max-md:hidden bg-gold-soft text-gold-deep text-xs font-semibold rounded-full px-3 py-2 shadow-card" title="后端未配置 LLM key，当前为 mock 草稿">
              mock 草稿
            </span>
          )}
          {/* M23：手机专用入口（桌面手柄/侧栏按钮在窄屏够不着） */}
          <button onClick={toggleChat} data-testid="chat-toggle" title="AI 改行程"
            className="md:hidden border border-line bg-white text-moss rounded-full w-11 h-11 text-[15px] font-semibold shadow-card">
            🤖
          </button>
          <button onClick={togglePanel} data-testid="panel-toggle" title={panelOpen ? "收起行程" : "展开行程"}
            className="md:hidden border border-line bg-white text-moss rounded-full w-11 h-11 text-[15px] font-semibold shadow-card">
            🗺
          </button>
          <button onClick={togglePanel} className="max-md:hidden border border-line bg-white text-moss rounded-full px-3.5 py-2 text-[13px] font-semibold shadow-card hover:bg-moss-soft">
            {panelOpen ? "▸ 收起" : "☰ 行程"}
          </button>
        </div>
      </div>

      {/* M14：AI 对话改行程抽屉（地图常驻，改动走同一撤销栈） */}
      <aside
        className={`fixed z-[400] transition-transform duration-300 max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:h-[70dvh] md:top-0 md:left-0 md:bottom-0 md:right-auto md:w-[380px] ${
          chatOpen ? "translate-x-0 translate-y-0" : "max-md:translate-x-0 max-md:translate-y-[calc(100%+2px)] md:-translate-x-[calc(100%+2px)] md:translate-y-0"
        }`}
        data-testid="ai-drawer"
        aria-hidden={!chatOpen}
        ref={chatDrawerRef}
      >
        {/* M23 P4：可见的"纸面"是这层 —— 拖手柄下滑关闭（松手弹回，越阈值则关） */}
        <motion.div
          drag={draggable ? "y" : false}
          dragListener={false}
          dragControls={chatDrag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.4 }}
          style={{ y: chatY }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 90 || info.velocity.y > 500) setChatOpen(false);
            animate(chatY, 0, { type: "spring", stiffness: 400, damping: 40 });
          }}
          className="h-full flex flex-col bg-cream overflow-hidden shadow-[10px_0_40px_rgba(43,43,40,0.15)] max-md:rounded-t-[16px] max-md:border-t max-md:pb-[env(safe-area-inset-bottom)] md:border-r"
        >
        <div className="sheet-handle md:hidden shrink-0 flex justify-center pt-2 pb-1.5" onPointerDown={(e) => chatDrag.start(e)}>
          <span className="h-1.5 w-10 rounded-full bg-line" />
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-white">
          <span className="text-lg">🤖</span>
          <h2 className="text-sm font-bold">AI 改行程</h2>
          {lastStats && (
            <span
              className="text-[11px] bg-cream border border-line/70 rounded-md px-1.5 py-px text-ink-soft truncate max-w-[120px]"
              title={`本轮所用模型：${lastStats.model || "未知"} · 来源：${PROVIDER_LABEL[lastStats.provider || ""] || lastStats.provider || "未知"}`}
              data-testid="ai-provider"
            >
              {lastStats.model || "模型"} · {PROVIDER_LABEL[lastStats.provider || ""] || "来源未知"}
            </span>
          )}
          <span className="text-xs text-ink-soft ml-auto">改动可撤销 · 地图实时更新</span>
          <button
            onClick={clearPlanChat}
            disabled={stream.sending || !chatMsgs.length}
            title="清空当前对话记录（不影响行程本身）"
            data-testid="plan-clear-chat"
            className="text-ink-soft hover:text-danger disabled:opacity-30 leading-none px-1"
          >
            🗑
          </button>
          <button onClick={toggleChat} className="text-ink-soft hover:text-ink leading-none" aria-label="关闭对话抽屉">✕</button>
        </div>
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5 min-h-0">
          {chatMsgs.length === 0 && !stream.sending && (
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
            <div key={m.id} className={m.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"}>
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
                {m.role === "assistant" && <CoordReport digest={m.geo} />}
                {m.role === "assistant" && m.changed && (
                  <div className="text-xs text-ink-soft mt-1">地图已更新 · 撤销按钮可反悔</div>
                )}
              </div>
              {m.role === "assistant" && m.questions && m.questions.length > 0 && (
                <div className="w-full max-w-[90%]">
                  <ClarifyCard
                    questions={m.questions}
                    msgId={m.id}
                    disabled={stream.sending}
                    answered={m.answered}
                    onSend={sendAiEdit}
                    onAnswered={markAnswered}
                  />
                </div>
              )}
              {m.role === "assistant" && m.interrupted && (
                <div className="text-[11px] text-gold-deep mt-1 font-medium" data-testid="msg-interrupted">
                  ■ 已中断 · 以上是已生成的部分
                </div>
              )}
              {m.role === "assistant" && m.trace && m.trace.length > 0 && (
                <div className="w-full max-w-[90%] mt-1">
                  <DecisionTrace steps={m.trace} />
                </div>
              )}
            </div>
          ))}
          {stream.sending && (
            <div className="space-y-1.5" data-testid="ai-streaming">
              <StreamStatus
                active={stream.sending}
                stageLabel={stream.stageLabel}
                text={stream.text}
                idleMs={stream.idleMs}
                health={stream.health}
                sawPing={stream.sawPing}
                variant="edit"
              />
              {stream.trace.length > 0 && <DecisionTrace steps={stream.trace} live />}
              {stream.thinking && <ThinkingBlock text={stream.thinking} streaming />}
              {stream.text && (
                <div className="flex justify-start">
                  <div className="max-w-[90%] bg-white border border-line rounded-2xl rounded-bl-sm px-3 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                    {stream.text}
                    <span className="inline-block w-[2px] h-[14px] bg-moss align-middle ml-0.5 animate-pulse" />
                  </div>
                </div>
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
                if (e.key !== "Enter" || e.shiftKey) return;
                // B1：IME 组词期间的回车是「选词」，不是发送（老 Safari 用 keyCode 229 兜底）
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                e.preventDefault();
                sendAiEdit(chatInput);
              }}
              rows={2}
              data-testid="plan-chat-input"
              placeholder="告诉 AI 怎么改，例如「第二天加点美食」…"
              className="flex-1 resize-none border border-line rounded-xl px-3 py-2 text-[13px] text-ink focus:outline-2 focus:outline-moss-soft focus:border-moss"
            />
            <SendStopButton
              sending={stream.sending}
              disabled={!chatInput.trim()}
              onStop={stream.stop}
              size="sm"
            />
          </div>
        </form>
        </motion.div>
      </aside>

      {/* 选点提示条 */}
      {pickHint && (
        <div className="fixed top-[110px] md:top-[62px] left-1/2 -translate-x-1/2 z-[600] bg-gold text-ink px-[18px] py-2 rounded-full text-[13px] font-semibold shadow-card whitespace-nowrap">
          {pickHint}
        </div>
      )}

      {/* 右侧滑出面板 */}
      <aside
        data-testid="timeline-panel"
        aria-hidden={!panelOpen}
        ref={panelDrawerRef}
        className={`fixed z-[400] transition-transform duration-300 max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:h-[70dvh] md:top-0 md:right-0 md:bottom-0 md:left-auto md:w-[400px] ${
          panelOpen ? "translate-x-0 translate-y-0" : "max-md:translate-x-0 max-md:translate-y-[calc(100%+2px)] md:translate-x-[calc(100%+2px)] md:translate-y-0"
        }`}
      >
        <motion.div
          drag={draggable ? "y" : false}
          dragListener={false}
          dragControls={panelDrag}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.4 }}
          style={{ y: panelY }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 90 || info.velocity.y > 500) setPanelOpen(false);
            animate(panelY, 0, { type: "spring", stiffness: 400, damping: 40 });
          }}
          className="h-full flex flex-col bg-cream overflow-hidden shadow-[-10px_0_40px_rgba(43,43,40,0.15)] max-md:rounded-t-[16px] max-md:border-t max-md:pb-[env(safe-area-inset-bottom)] md:border-l"
        >
        {/* 面板顶部让位带（桌面）：浮条= top-3.5(14) + 高 60 = 底边 74，所以留 74。
            关键是它属于滚动区**之前**的兄弟节点 —— 滚动视口因此从 74px 开始，
            「🧠 AI 综合建议」「第 1 天」在带下沿被裁掉，而不会钻到日期卡/「收起」的白卡底下
            （改动前实测：浮条压住综合建议卡顶部 363×60，滚动后第 1 天卡也被压 16px）。 */}
        <div className="max-md:hidden shrink-0 h-[74px]" data-testid="panel-top-gap" />

        {/* M23：手机抽屉固定表头（日期/元信息；桌面这些在顶栏） */}
        <div className="md:hidden shrink-0 border-b border-line">
          <div className="sheet-handle shrink-0 flex justify-center pt-2 pb-1" onPointerDown={(e) => panelDrag.start(e)}>
            <span className="h-1.5 w-10 rounded-full bg-line" />
          </div>
          <div className="px-[18px] pb-3 flex flex-col gap-1.5">
            {dateCardJsx}
            {metasJsx}
            {source === "mock" && (
              <span className="self-start bg-gold-soft text-gold-deep text-xs font-semibold rounded-full px-3 py-1">mock 草稿</span>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-[18px] pb-10 pt-2">
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
            onMovePlace={(di, pi, dir) => { const t = moveTarget(route.days, di, pi, dir); if (t) handleDropMove(di, pi, t[0], t[1]); }}
            onEditHotel={openHotelForm}
            onSaveHotelPrices={saveHotelPrices}
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
            <button onClick={openAddFlow} className="bg-gold text-ink border border-gold rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:opacity-90">
              📍 添加地点
            </button>
            {/* M20 坐标重校准：修历史遗留的错坐标（同名异地 POI 带偏的那种） */}
            <button
              onClick={handleRecheck}
              disabled={rechecking}
              title="用高德重新核验整条路线的坐标（你手改过的点不会被覆盖，可撤销）"
              className="border border-line bg-white text-moss rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:bg-moss-soft disabled:opacity-45"
              data-testid="recheck-coords"
            >
              {rechecking ? "🔍 校准中…" : "🔍 校准坐标"}
            </button>
            {/* 导出二级菜单（优化②：JSON/HTML 收进右侧工具条） */}
            <div className="relative" ref={exportRef}>
              <button
                onClick={() => setExportOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={exportOpen}
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
          {recheckMsg && (
            <div role="status" className="mt-1.5 text-[11px] text-moss bg-moss-soft rounded-lg px-2.5 py-1.5" data-testid="recheck-msg">
              {recheckMsg}
            </div>
          )}
          {exportError && (
            <div role="status" className="mt-1.5 text-[11px] text-danger bg-[#F6E7E7] rounded-lg px-2.5 py-1.5" data-testid="export-error">
              {exportError}
            </div>
          )}
          <div className="mt-2 text-[11px] text-ink-soft text-center">由 IterTrip · AI 生成行程 · 价格由用户手动提供</div>
        </div>
        </motion.div>
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
          onCancel={() => { setForm(null); setRelocateMsg(""); }}
          onStartRepick={startRepick}
          onRelocate={relocatePlace}
          relocating={relocating}
          relocateMsg={relocateMsg}
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
    </MotionConfig>
  );
}