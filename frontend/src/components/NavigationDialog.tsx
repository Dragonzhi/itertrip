import { useEffect, useRef, useState } from "react";
import { loadMapProvider, navigation, saveMapProvider, type MapProvider, type NavPoint, type TravelMode } from "../lib/navigation";

export default function NavigationDialog({ point, previous, city, onClose }: { point: NavPoint; previous?: NavPoint; city: string; onClose: () => void }) {
  const [provider, setProvider] = useState<MapProvider>(loadMapProvider);
  const [mode, setMode] = useState<TravelMode>("walk");
  const [confirmed, setConfirmed] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); restore?.focus(); };
  }, []);
  const risk = navigation.risk(point);
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const links = navigation.links(point, { provider, mode, city, confirmed, previous, mobile, ios: /iPhone|iPad|iPod/i.test(navigator.userAgent) });
  const copyText = `${city} · ${point.name}${risk !== "search" ? `\nGCJ-02：${point.lat}, ${point.lng}` : ""}`;
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="nav-title" className="navigation-dialog w-[calc(100%-24px)] max-w-[430px] rounded-[14px] bg-cream p-5 text-ink shadow-card">
    <div className="flex items-start gap-3"><div className="flex-1 min-w-0"><p className="text-xs text-moss font-semibold">把下一站交给地图</p><h2 id="nav-title" className="text-xl font-bold mt-2 break-words">{point.name}</h2></div><button className="nav-secondary shrink-0" aria-label="关闭导航选项" onClick={onClose}>✕</button></div>
    <p className="text-xs text-ink-soft leading-relaxed my-3">起点由地图软件定位或选择。这里交接当前保存点位，出入口请在地图中核对。</p>
    {risk === "search" && <p role="status" className="rounded-xl bg-gold-soft p-3 text-sm">该地点缺少可用于导航的准确坐标，请先在地图中按名称搜索并确认地点。</p>}
    {risk === "confirm" && <div className="rounded-xl bg-gold-soft p-3 text-sm"><p>该坐标尚未可靠核验，默认按名称搜索。</p><label className="flex gap-2 items-center min-h-11"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对这个点位，使用保存坐标</label></div>}
    <fieldset className="my-4"><legend className="text-xs text-ink-soft mb-2">地图偏好 · 自动记住</legend><div className="grid grid-cols-2 gap-2">{([['amap', '高德地图'], ['baidu', '百度地图']] as const).map(([v, label]) => <button key={v} type="button" aria-pressed={provider === v} className={provider === v ? "nav-primary" : "nav-secondary"} onClick={() => { setProvider(v); saveMapProvider(v); }}>{label}</button>)}</div></fieldset>
    {links.kind === "navigation" && <fieldset className="my-4"><legend className="text-xs text-ink-soft mb-2">交通方式 · 实际耗时以地图结果为准</legend><div className="grid grid-cols-3 gap-2">{([['walk', '步行'], ['bus', '公交'], ['car', '驾车']] as const).map(([v, label]) => <button key={v} aria-pressed={mode === v} className={mode === v ? "nav-primary" : "nav-secondary"} onClick={() => setMode(v)}>{label}</button>)}</div></fieldset>}
    <a className="nav-primary w-full text-center" href={links.primary} target={links.primary.startsWith("https:") ? "_blank" : undefined} rel="noopener noreferrer" data-testid="navigation-primary">{links.kind === "search" ? "按名称搜索地点 ↗" : provider === "baidu" && !mobile ? "打开地图，选择起点 ↗" : "打开地图规划路线 ↗"}</a>
    <p className="text-xs text-ink-soft my-3">没有打开 App？可以使用网页版。网页地图可能需要再次选择当前位置。</p>
    <div className="grid grid-cols-2 gap-2"><a href={links.web} target="_blank" rel="noopener noreferrer" className="nav-secondary text-center">使用网页版 ↗</a><button className="nav-secondary" onClick={async () => { try { await navigator.clipboard.writeText(copyText); setCopyMessage("已复制地点信息"); } catch { setCopyMessage("未能自动复制，请选中下方文字复制"); } }}>复制地点信息</button></div>
    <p role="status" className="text-xs mt-2">{copyMessage}</p>{copyMessage && <textarea aria-label="可复制的地点信息" readOnly value={copyText} className="w-full mt-1 p-2 border rounded-lg text-xs bg-white" />}
    {links.compare && <a href={links.compare} target="_blank" rel="noopener noreferrer" className="nav-secondary w-full text-center mt-3">从上一计划点比较路线 ↗</a>}
    {links.compare && <p className="text-xs text-ink-soft mt-2">上一计划点仅用于比较路线，并不代表你当前所在位置。</p>}
  </dialog>;
}
