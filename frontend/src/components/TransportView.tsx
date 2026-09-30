import type { RouteJSON, TransportSegment } from '../types/route';
import { transport, type Edge } from '../lib/transport';
export type TransportActions = {
  query: (di: number, edge?: Edge) => void;
  changeDay: (di: number, patch: Partial<RouteJSON['days'][number]>) => void;
  changeLeg: (di: number, edge: Edge, patch: Partial<TransportSegment>) => void;
  busy: boolean;
};
const minutes = (s: number) => `${Math.ceil(s / 60)} 分钟`;
const distance = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
export function TransportDay({ route, di, actions }: { route: RouteJSON; di: number; actions: TransportActions }) {
  const day = route.days[di], s = transport.summary(route, di);
  const start = di > 0 ? route.days[di - 1]?.hotel : day.hotel;
  return <section className="my-3 p-3 rounded-xl border border-line bg-cream text-xs" aria-label={`第${di + 1}天交通设置`}>
    <div className="flex items-center gap-2 flex-wrap"><strong className="flex-1">当天交通</strong><select aria-label={`第${di + 1}天默认交通方式`} className="min-h-11 border border-line rounded-lg bg-white px-2" value={day.traffic_mode || 'walk'} onChange={e => actions.changeDay(di, { traffic_mode: e.target.value as 'walk' | 'bus' | 'car' })}>{Object.entries(transport.labels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select><button className="nav-secondary" disabled={actions.busy || !s.total} onClick={() => actions.query(di)}>比较当天交通</button></div>
    {start && <label className="flex items-center gap-2 min-h-11"><input type="checkbox" checked={!!day.start_from_hotel} onChange={e => actions.changeDay(di, { start_from_hotel: e.target.checked })} />{di ? '从前一晚酒店出发' : '从当天酒店出发（已入住时勾选）'}：{start.name}</label>}
    {!start && <p className="text-ink-soft mt-2">未设出发酒店，交通从第一个景点开始计算。</p>}
    {s.total > 0 && <p className="leading-relaxed mt-2">{s.known ? `${s.known === s.total ? '预计交通' : `已知 ${s.known}/${s.total} 段交通小计`} ${minutes(s.seconds)}` : '交通耗时未知'} · 额外缓冲 {s.buffer} 分钟<br />{s.walkKnown ? `已知步行 ${distance(s.walking)}（${s.walkKnown}/${s.total} 段）` : '步行距离未知'} · {s.feeKnown ? `已有费用估算 ¥${s.fees.toFixed(1)}（${s.feeKnown}/${s.total} 段；缺项未知）` : '费用未知'}</p>}
    <p className="text-ink-soft leading-relaxed mt-2">查询时估算，未来日期与实际班次可能变化。地图直线仅表示地点顺序。单次最多比较 12 段，其余可逐段查询。</p>
  </section>;
}
export function TransportLeg({ route, edge, actions, compact = false }: { route: RouteJSON; edge: Edge; actions?: TransportActions; compact?: boolean }) {
  const day = route.days[edge.di], s = transport.selected(day, edge);
  const blocked = !transport.usable(edge.from) || !transport.usable(edge.to);
  return <section data-testid="transport-leg" className="my-2 p-3 rounded-xl border border-moss/20 bg-moss-soft/40 text-xs" aria-label={`交通：${edge.from.name}到${edge.to.name}`}>
    <p className="font-semibold break-words">↳ {edge.from.name} → {edge.to.name}</p>
    {s.known ? <p className="text-moss font-semibold mt-2">{transport.labels[s.mode]}约 {minutes(s.option!.duration_s!)}{s.option!.distance_m != null ? ` · ${distance(s.option!.distance_m)}` : ''}{s.option!.fee_yuan != null ? ` · ${s.mode === 'car' ? '出租车参考' : '费用'} ¥${s.option!.fee_yuan}` : ' · 费用未知'}</p> : <p className="text-ink-soft mt-2">交通耗时未知 · {blocked ? '先在编辑器确认起终点坐标' : s.stale ? '查询快照已超过 15 分钟，请刷新' : s.option?.reason || '待查询'}</p>}
    {s.known && s.option?.description && <p className="mt-1 break-words">{s.option.description}</p>}
    {s.known && s.mode === 'car' && <p className="mt-1">道路收费：{s.option?.tolls_yuan == null ? '未知' : `¥${s.option.tolls_yuan}`}（另列，不并入出租车参考价）</p>}
    {s.option && <p className="text-ink-soft mt-1"><a className="underline focus-ring" href="https://lbs.amap.com/api/webservice/guide/api/direction" target="_blank" rel="noopener noreferrer">高德路径服务</a> · {new Date(s.option.queried_at).toLocaleString('zh-CN')} {s.stale ? '（历史快照）' : ''}</p>}
    {!compact && actions && <>
      <div className="flex gap-2 flex-wrap items-center mt-2"><select aria-label={`前往${edge.to.name}的交通方式`} className="min-h-11 border border-line rounded-lg bg-white px-2" value={s.segment?.mode || ''} onChange={e => actions.changeLeg(edge.di, edge, { mode: e.target.value as TransportSegment['mode'] })}><option value="">跟随当天（{transport.labels[day.traffic_mode || 'walk']}）</option>{Object.entries(transport.labels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select><button className="nav-secondary" disabled={actions.busy || blocked} onClick={() => actions.query(edge.di, edge)}>比较三种方式</button></div>
      {s.segment?.snapshot?.options && <ul className="my-2 space-y-1">{s.segment.snapshot.options.map(o => <li key={o.mode}>{transport.labels[o.mode]}：{o.status === 'ok' && o.duration_s != null ? `${minutes(o.duration_s)}${o.fee_yuan != null ? ` · ${o.mode === 'car' ? '出租车参考 ' : ''}¥${o.fee_yuan}` : ' · 费用未知'}` : `未知（${o.reason || '没有方案'}）`}{s.stale ? ' · 历史快照' : ''}</li>)}</ul>}
      <label className="flex items-center gap-2 min-h-11">额外缓冲<input type="number" aria-label={`前往${edge.to.name}的额外缓冲分钟`} min="0" max="180" value={s.segment?.buffer_min || 0} className="min-h-11 w-16 rounded-lg border border-line px-2" onChange={e => actions.changeLeg(edge.di, edge, { buffer_min: Number(e.target.value) })} />分钟</label>
    </>}
    <p className="text-ink-soft mt-1">{s.mode === 'car' ? '驾车耗时不含叫车等待与上车接驳；出租车报价仅供比较，道路收费另计。' : s.mode === 'bus' ? '使用提供商方案总耗时，不重复叠加接驳步行；实际等车需留余量。' : '景区内游玩步行未计入交通距离。'}{s.segment?.buffer_min ? ` 另留 ${s.segment.buffer_min} 分钟缓冲。` : ''}</p>
  </section>;
}
