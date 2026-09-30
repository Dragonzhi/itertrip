import type { RouteJSON } from "../types/route";
import { visits, type OutingProgress, type Visit } from "../lib/outing";
import { transport } from '../lib/transport';
import { TransportLeg } from './TransportView';

export default function OutingView({ route, progress, onChange, onNavigate, onFocus }: { route: RouteJSON; progress: OutingProgress; onChange: (p: OutingProgress) => void; onNavigate: (key: string) => void; onFocus: (key: string) => void }) {
  const day = Math.min(progress.day, Math.max(0, route.days.length - 1));
  const list = visits(route).filter(v => v.di === day);
  const done = (v: Visit) => progress.completed.includes(v.id);
  const arrived = (v: Visit) => progress.arrived.includes(v.id);
  const next = list.find(v => !done(v));
  const toggle = (v: Visit, field: "completed" | "arrived") => onChange({ ...progress, [field]: progress[field].includes(v.id) ? progress[field].filter(id => id !== v.id) : [...progress[field], v.id] });
  return <div data-testid="outing-view" className="space-y-4 py-2">
    <label className="flex items-center gap-3 text-sm font-semibold">出行当天<select aria-label="出行当天" value={day} onChange={e => onChange({ ...progress, day: Number(e.target.value) })} className="min-h-11 flex-1 rounded-xl border border-line bg-white px-3">{route.days.map((d, i) => <option key={i} value={i}>第 {d.day} 天{d.theme ? ` · ${d.theme}` : ""}</option>)}</select></label>
    <div className="flex justify-between text-xs text-ink-soft"><span>由你确认到达和完成</span><span>{list.filter(done).length} / {list.length} 已完成</span></div>
    {next ? <section className="rounded-[20px] border border-moss/20 bg-white p-5 shadow-card">
      <span className="text-xs text-moss font-semibold">下一站 · {next.hotel ? "入住酒店" : `行程第 ${list.indexOf(next) + 1} 站`}</span>
      <h2 className="text-2xl font-bold mt-3 break-words">{next.point.name}</h2>
      {"time" in next.point && next.point.time && <p className="text-sm text-ink-soft mt-2">原行程时段：{next.point.time}</p>}
      {transport.legs(route, day).filter(e => e.to.id === next.point.id).map(e => <TransportLeg key={e.from.id} route={route} edge={e} compact />)}
      {"warnings" in next.point && next.point.warnings?.map(w => <p key={w} className="text-sm text-danger mt-2">⚠ {w}</p>)}
      <button className="nav-primary w-full mt-5" onClick={() => onNavigate(next.key)}>去这里 ↗</button>
      <button className="nav-secondary w-full mt-2" onClick={() => onFocus(next.key)}>在地图上看位置</button>
      <div className="grid grid-cols-2 gap-2 mt-3"><button className="nav-secondary" aria-pressed={arrived(next)} onClick={() => toggle(next, "arrived")}>{arrived(next) ? "✓ 已到达" : "我已到达"}</button><button className="nav-secondary" onClick={() => toggle(next, "completed")}>完成这一站</button></div>
      {next.repeated && <p className="text-xs text-ink-soft mt-3">这处地点在行程中出现多次。若修改路线顺序或时段，需要重新确认这些重复站点的进度。</p>}
      <p className="text-xs text-ink-soft mt-3 leading-relaxed">打开导航不会自动标记到达。交通耗时以外部地图计算为准。</p>
    </section> : <section className="rounded-[20px] bg-moss-soft p-5"><h2 className="font-bold">{list.length ? "当天行程已完成" : "当天还没有地点"}</h2><p className="text-sm mt-2">{list.length ? "可以选择下一天，或在下方恢复某一站。" : "切换到规划视图添加地点。"}</p></section>}
    <h3 className="text-sm font-semibold">当天清单</h3><ul className="space-y-2">{list.map(v => <li key={v.key} className="rounded-xl border border-line bg-white p-3"><div className="flex items-center gap-2"><button className="min-h-11 flex-1 text-left text-sm break-words" onClick={() => onFocus(v.key)}>{done(v) ? "✓ " : v.hotel ? "🏨 " : "○ "}{v.point.name}</button><button className="nav-secondary" aria-label={`前往${v.point.name}`} onClick={() => onNavigate(v.key)}>去这里</button></div><button className="min-h-11 text-xs text-moss underline" onClick={() => toggle(v, "completed")}>{done(v) ? "恢复为未完成" : "标记已完成"}</button></li>)}</ul>
  </div>;
}
