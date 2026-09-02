import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RouteJSON, Hotel, Place } from "../types/route";
import { dayColor, dayPoints, emojiFor, mercY, routeArrowDeg, routeMidPoint } from "../mapCore";
import type { MapSettings } from "../lib/settings";

interface MapViewProps {
  route: RouteJSON | null;
  activeDay: number;               // 高亮的当天索引（-1 = 无）
  picking: boolean;                // 选点模式：crosshair + 禁拖动，下一次点击返回坐标
  onPick?: (lat: number, lng: number) => void;
  onPlaceClick: (di: number, pi: number) => void;
  onHotelClick: (di: number) => void;
  /** 双击聚焦：单击已弹框，双击才 setView 聚焦 */
  onPlaceFocus?: (di: number, pi: number) => void;
  onHotelFocus?: (di: number) => void;
  /** 需要闪烁高亮的 pin key（"d{di}-p{pi}"），M14 对话改路线用 */
  flashKeys?: string[];
  /** 地点交互（优化④）：peek=单击弹框不挪图；zoom=双击聚焦 setView；seq 防重复 */
  focus?: { key: string; seq: number; mode: "peek" | "zoom" } | null;
  /** 视野平移补偿（优化②）：保留 prop，但不再运行时 panBy（见文档） */
  viewOffset?: number;
  /** 地图显示设置（M16）：源自 MapSettings，纯前端视图态 */
  view: MapSettings;
}

/** 地点弹窗 HTML（showMeta=false 时只留地名）。 */
function popupHtml(p: Place, emoji: string, showMeta: boolean): string {
  let html = `<div class="iter-popup"><div class="pp-name">${emoji} ${p.name || ""}</div>`;
  if (showMeta) {
    if (p.time) html += `<div class="pp-row">⏰ ${p.time}</div>`;
    if (p.ticket) html += `<div class="pp-row">🎫 ${p.ticket}</div>`;
    if (p.transport) html += `<div class="pp-row">🚗 ${p.transport}</div>`;
    if (p.note) html += `<div class="pp-row">${p.note}</div>`;
  }
  return html + `</div>`;
}

/** 酒店弹窗 HTML（showMeta=false 时只留酒店名）。 */
function hotelPopupHtml(h: Hotel, showMeta: boolean): string {
  const best = (h.prices || []).length
    ? (h.prices || []).reduce((a, b) => (a.price <= b.price ? a : b))
    : null;
  let html = `<div class="iter-popup"><div class="pp-name">🏨 ${h.name}</div>`;
  if (showMeta) {
    if (best) html += `<div class="pp-row">最低 ¥${best.price}（${best.platform}）</div>`;
    if (h.note) html += `<div class="pp-row">${h.note}</div>`;
  }
  return html + `</div>`;
}

/** 箭头 scale 映射（M16）：按 arrowScale 生成 divIcon。 */
function arrowIcon(color: string, deg: number, scale: number): L.DivIcon {
  const s = scale || 1;
  const size = Math.round(14 * s);
  const bl = Math.round(9 * s);
  const tb = Math.round(5 * s);
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="route-arrow-wrap" style="--rc:${color};transform:rotate(${deg.toFixed(2)}deg);width:${size}px;height:${size}px"><i class="route-arrow" style="border-top-width:${tb}px;border-bottom-width:${tb}px;border-left-width:${bl}px"></i></div>`,
  });
}

/** Leaflet 地图组件：接收 route 数据，渲染标记 / 连线 / 箭头（逻辑移植自旧版模板 render()）。 */
export default function MapView({
  route, activeDay, picking, onPick, onPlaceClick, onHotelClick,
  onPlaceFocus, onHotelFocus, flashKeys, focus, viewOffset = 0, view,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);       // 标记层
  const routeLayerRef = useRef<L.LayerGroup | null>(null);   // 连线/箭头层（M16 拆分，避开 toggle 触发 fitBounds）
  const dayLinesRef = useRef<Map<number, L.Polyline>>(new Map());
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const amapRef = useRef<L.TileLayer | null>(null);
  const osmRef = useRef<L.TileLayer | null>(null);
  const cbRef = useRef({ onPlaceClick, onHotelClick, onPlaceFocus, onHotelFocus });
  cbRef.current = { onPlaceClick, onHotelClick, onPlaceFocus, onHotelFocus };

  // 初始化（仅一次）
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false, minZoom: 3 }).setView([34.05, 108.94], 5);
    const amap = L.tileLayer(
      "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
      { attribution: "&copy; 高德地图", subdomains: "1234", minZoom: 3, maxZoom: 18 },
    );
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", minZoom: 3, maxZoom: 19,
    });
    amapRef.current = amap;
    osmRef.current = osm;
    // 初始图层由设置面板控制（M16）：去掉 L.control.layers 双入口，按 view.mapSource 添加
    (view.mapSource === "osm" ? osm : amap).addTo(map);
    L.control.attribution({ position: "bottomleft" }).addTo(map);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      routeLayerRef.current = null;
      dayLinesRef.current.clear();
      amapRef.current = null;
      osmRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 标记层（含 fitBounds）：仅依赖 route，切设置不重绘视野
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();
    markersRef.current.clear();
    if (!route) return;
    const bounds: L.LatLngExpression[] = [];
    const callbacks = cbRef.current;
    route.days.forEach((day, di) => {
      (day.places || []).forEach((p, pi) => {
        if (p.lat == null || p.lng == null) return;
        const emoji = emojiFor(p);
        const m = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div class="iter-pin day-${di + 1}" data-pin-key="d${di}-p${pi}"><span class="e">${emoji}</span></div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 27],
            popupAnchor: [0, -24],
          }),
          title: p.name,
        }).addTo(layers);
        m.bindPopup(popupHtml(p, emoji, true), { className: "iter-popup", autoPan: false });
        m.on("click", () => callbacks.onPlaceClick(di, pi));
        m.on("dblclick", () => callbacks.onPlaceFocus?.(di, pi));
        markersRef.current.set("d" + di + "-p" + pi, m);
        bounds.push([p.lat, p.lng]);
      });

      const h = day.hotel;
      if (h && h.name && h.lat != null && h.lng != null) {
        const hm = L.marker([h.lat, h.lng], {
          icon: L.divIcon({
            className: "",
            html: '<div class="iter-pin hotel"><span class="e">🏨</span></div>',
            iconSize: [30, 30],
            iconAnchor: [15, 27],
            popupAnchor: [0, -24],
          }),
          title: h.name,
        }).addTo(layers);
        hm.bindPopup(hotelPopupHtml(h, true), { className: "iter-popup", autoPan: false });
        hm.on("click", () => callbacks.onHotelClick(di));
        hm.on("dblclick", () => callbacks.onHotelFocus?.(di));
        markersRef.current.set("d" + di + "-hotel", hm);
        bounds.push([h.lat, h.lng]);
      }
    });

    if (bounds.length) map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [60, 60] });
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  // popup 详情刷新（M16 showMeta）：不重建 marker、不重绘视野
  useEffect(() => {
    if (!route) return;
    const show = view.showMeta;
    route.days.forEach((day, di) => {
      (day.places || []).forEach((p, pi) => {
        const m = markersRef.current.get("d" + di + "-p" + pi);
        if (m) m.setPopupContent(popupHtml(p, emojiFor(p), show));
      });
      const h = day.hotel;
      if (h && h.name) {
        const hm = markersRef.current.get("d" + di + "-hotel");
        if (hm) hm.setPopupContent(hotelPopupHtml(h, show));
      }
    });
  }, [route, view.showMeta]);

  // 连线/箭头层（M16 拆分）：不调用 fitBounds，toggle 视野稳定
  useEffect(() => {
    const map = mapRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer) return;
    routeLayer.clearLayers();
    dayLinesRef.current.clear();
    if (!route) return;
    if (!view.showRoutes) return;   // 开关路线：隐藏所有连线/箭头（pin 仍在）

    const stride = view.arrowDensity === "sparse" ? 3 : view.arrowDensity === "normal" ? 2 : 1;
    const scale = view.arrowScale || 1;
    const effectiveDay = activeDay >= 0 ? activeDay : -1;

    route.days.forEach((day, di) => {
      if (view.dayViewMode === "current" && effectiveDay >= 0 && di !== effectiveDay) return;
      if (view.dayViewMode === "current" && effectiveDay < 0 && di !== 0) return; // 无选中天时兜底只画第 0 天
      const color = dayColor(di);
      const pts = dayPoints(day);
      if (view.connectHotel && day.hotel && day.hotel.lat != null && day.hotel.lng != null) {
        pts.push([day.hotel.lat, day.hotel.lng]);
      }
      if (pts.length < 2) return;
      // 白色描边
      const halo = L.polyline(pts, { color: "#FFFFFF", weight: 6, opacity: 0.65, lineCap: "round", lineJoin: "round" }).addTo(routeLayer);
      const line = L.polyline(pts, { color, weight: 3, opacity: 0.9, lineCap: "round", lineJoin: "round", dashArray: "6 8" }).addTo(routeLayer);
      dayLinesRef.current.set(di, line);
      // 当天高亮（route-flow 动画），非当天淡化（dayViewMode=all）
      const isActive = di === effectiveDay;
      if (view.dayViewMode === "all") {
        if (isActive) {
          line.getElement()?.classList.add("route-flow");
        } else {
          (line.getElement() as SVGPathElement | undefined)?.setAttribute?.("opacity", "0.22");
          (halo.getElement() as SVGPathElement | undefined)?.setAttribute?.("opacity", "0.16");
        }
      } else {
        // current：只画了当天（若兜底画第 0 天则视为活动）
        line.getElement()?.classList.add("route-flow");
      }
      for (let s = 0; s < pts.length - 1; s += stride) {
        const a = pts[s];
        const b = pts[s + 1];
        if (Math.abs(b[1] - a[1]) < 1e-9 && Math.abs(mercY(b[0]) - mercY(a[0])) < 1e-9) continue;
        const deg = routeArrowDeg(a, b);
        const mid = routeMidPoint(a, b);
        L.marker(mid, {
          icon: arrowIcon(color, deg, scale),
          interactive: false,
          zIndexOffset: -800,
        }).addTo(routeLayer);
      }
    });
  }, [route, view.showRoutes, view.dayViewMode, view.connectHotel, view.arrowDensity, view.arrowScale, activeDay]); // eslint-disable-line react-hooks/exhaustive-deps

  // M14：flashKeys 变化 → 对应图钉闪烁
  useEffect(() => {
    if (!flashKeys || flashKeys.length === 0) return;
    const map = mapRef.current;
    if (!map) return;
    const pins = map.getContainer().querySelectorAll("[data-pin-key]");
    const targets = new Set(flashKeys);
    const found: { el: Element | null } = { el: null };
    pins.forEach((el) => {
      const k = el.getAttribute("data-pin-key") || "";
      if (targets.has(k)) {
        el.classList.add("flash");
        if (!found.el) found.el = el;
        window.setTimeout(() => el.classList.remove("flash"), 6600);
      }
    });
    const firstEl = found.el;
    if (firstEl) {
      const m2 = (firstEl.getAttribute("data-pin-key") || "").match(/^d(\d+)-p(\d+)$/);
      if (m2) {
        const day = route?.days[Number(m2[1])];
        const place = day?.places?.[Number(m2[2])];
        if (place && place.lat != null && place.lng != null) {
          map.panTo([place.lat, place.lng], { animate: true, duration: 0.8 });
        }
      }
    }
  }, [flashKeys, route]); // eslint-disable-line react-hooks/exhaustive-deps

  // 优化④：单击（peek）= 只弹框不挪图；双击（zoom）= setView 聚焦
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const marker = markersRef.current.get(focus.key);
    if (!marker) return;
    if (focus.mode === "zoom") {
      const latlng = marker.getLatLng();
      map.setView(latlng, Math.max(map.getZoom(), 14), { animate: true, duration: 0.5 });
      const pin = marker.getElement();
      if (pin) {
        pin.classList.add("flash");
        window.setTimeout(() => pin.classList.remove("flash"), 6600);
      }
    } else {
      marker.openPopup();
    }
  }, [focus?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // 地图源切换（M16）：由设置面板统一控制，不再有 L.control.layers 双入口
  useEffect(() => {
    const map = mapRef.current;
    const amap = amapRef.current;
    const osm = osmRef.current;
    if (!map || !amap || !osm) return;
    if (view.mapSource === "amap") {
      if (map.hasLayer(osm)) map.removeLayer(osm);
      if (!map.hasLayer(amap)) amap.addTo(map);
    } else {
      if (map.hasLayer(amap)) map.removeLayer(amap);
      if (!map.hasLayer(osm)) osm.addTo(map);
    }
  }, [view.mapSource]);

  // 抽屉开合不再自动 pan 地图
  void viewOffset;

  // 选点模式：crosshair + 禁拖动/双击缩放
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!picking) return;
    document.body.classList.add("picking");
    map.dragging?.disable();
    map.doubleClickZoom?.disable();
    const handler = (e: L.LeafletMouseEvent) => {
      if (onPick) onPick(e.latlng.lat, e.latlng.lng);
    };
    map.once("click", handler);
    return () => {
      document.body.classList.remove("picking");
      map.dragging?.enable();
      map.doubleClickZoom?.enable();
      map.off("click", handler);
    };
  }, [picking, onPick]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="fixed inset-0 z-0 bg-[#dfe6dd]" />;
}
