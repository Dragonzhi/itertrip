import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RouteJSON } from "../types/route";
import { dayColor, dayPoints, emojiFor, mercY, routeArrowDeg, routeMidPoint } from "../mapCore";

interface MapViewProps {
  route: RouteJSON | null;
  activeDay: number;               // 高亮的当天索引（-1 = 无）
  picking: boolean;                // 选点模式：crosshair + 禁拖动，下一次点击返回坐标
  onPick?: (lat: number, lng: number) => void;
  onPlaceClick: (di: number, pi: number) => void;
  onHotelClick: (di: number) => void;
  /** 需要闪烁高亮的 pin key（"d{di}-p{pi}"），M14 对话改路线用 */
  flashKeys?: string[];
}

/** Leaflet 地图组件：接收 route 数据，渲染标记 / 连线 / 箭头（逻辑移植自旧版模板 render()）。 */
export default function MapView({ route, activeDay, picking, onPick, onPlaceClick, onHotelClick, flashKeys }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const dayLinesRef = useRef<Map<number, L.Polyline>>(new Map());
  const cbRef = useRef({ onPlaceClick, onHotelClick });
  cbRef.current = { onPlaceClick, onHotelClick };

  // 初始化（仅一次）
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false, minZoom: 3 }).setView([34.05, 108.94], 5);
    const amap = L.tileLayer(
      "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
      { attribution: "&copy; 高德地图", subdomains: "1234", minZoom: 3, maxZoom: 18 },
    );
    const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors", minZoom: 3, maxZoom: 19,
    });
    amap.addTo(map);
    L.control.attribution({ position: "bottomleft" }).addTo(map);
    L.control.layers({ 高德默认: amap, "OSM 标准": osm }, undefined, { position: "topleft" }).addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      dayLinesRef.current.clear();
    };
  }, []);

  // 数据变化 → 重绘图层 + fitBounds
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();
    dayLinesRef.current.clear();
    if (!route) return;
    const bounds: L.LatLngExpression[] = [];
    const callbacks = cbRef.current;

    route.days.forEach((day, di) => {
      const color = dayColor(di);
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
        m.bindPopup(
          `<div class="iter-popup"><div class="pp-name">${emoji} ${p.name || ""}</div>` +
            (p.time ? `<div class="pp-row">⏰ ${p.time}</div>` : "") +
            (p.ticket ? `<div class="pp-row">🎫 ${p.ticket}</div>` : "") +
            (p.transport ? `<div class="pp-row">🚗 ${p.transport}</div>` : "") +
            (p.note ? `<div class="pp-row">${p.note}</div>` : "") +
          `</div>`,
          { className: "iter-popup" },
        );
        m.on("click", () => callbacks.onPlaceClick(di, pi));
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
        const prices = h.prices || [];
        const best = prices.length ? prices.reduce((a, b) => (a.price <= b.price ? a : b)) : null;
        hm.bindPopup(
          `<div class="iter-popup"><div class="pp-name">🏨 ${h.name}</div>` +
            (best ? `<div class="pp-row">最低 ¥${best.price}（${best.platform}）</div>` : "") +
            (h.note ? `<div class="pp-row">${h.note}</div>` : "") +
          `</div>`,
        );
        hm.on("click", () => callbacks.onHotelClick(di));
        bounds.push([h.lat, h.lng]);
      }

      const pts = dayPoints(day);
      if (pts.length >= 2) {
        L.polyline(pts, { color: "#FFFFFF", weight: 6, opacity: 0.65, lineCap: "round", lineJoin: "round" }).addTo(layers);
        const line = L.polyline(pts, { color, weight: 3, opacity: 0.9, lineCap: "round", lineJoin: "round", dashArray: "6 8" }).addTo(layers);
        dayLinesRef.current.set(di, line);
        if (di === activeDay) line.getElement()?.classList.add("route-flow");
        for (let s = 0; s < pts.length - 1; s++) {
          const a = pts[s];
          const b = pts[s + 1];
          if (Math.abs(b[1] - a[1]) < 1e-9 && Math.abs(mercY(b[0]) - mercY(a[0])) < 1e-9) continue;
          const deg = routeArrowDeg(a, b);
          const mid = routeMidPoint(a, b);
          L.marker(mid, {
            icon: L.divIcon({
              className: "",
              iconSize: [14, 14],
              iconAnchor: [7, 7],
              html: `<div class="route-arrow-wrap" style="--rc:${color};transform:rotate(${deg.toFixed(2)}deg)"><i class="route-arrow"></i></div>`,
            }),
            interactive: false,
            zIndexOffset: -800,
          }).addTo(layers);
        }
      }
    });

    if (bounds.length) map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [60, 60] });
    // activeDay 故意不在依赖里：高亮由下方独立 effect 处理，避免重绘视野
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  // activeDay 变化 → 只切流动动画，不动地图视野
  useEffect(() => {
    dayLinesRef.current.forEach((line, di) => {
      const el = line.getElement?.();
      if (!el) return;
      if (di === activeDay) el.classList.add("route-flow");
      else el.classList.remove("route-flow");
    });
  }, [activeDay, route]);

  // M14：flashKeys 变化 → 对应图钉闪烁（重绘后 DOM 重建，故跟随 route 依赖触发）
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
    // 第一个变化点平移入视野（不缩放，避免突兀）
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

  // 选点模式：crosshair + 禁拖动/双击缩放，once click 回调坐标（移植自 enterPicking/exitPicking）
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