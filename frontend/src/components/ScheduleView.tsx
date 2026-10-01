import { useEffect, useRef, useState } from 'react';
import type { RouteJSON, Place, Hotel, VisitPlan, OpeningFact, WeatherExposure } from '../types/route';
import {weather} from '../lib/weather';
import { schedule, type ScheduleRow } from '../lib/schedule';
import { onlineFetch, API_BASE } from '../api/client';

export interface ScheduleActions {
  day(di: number, patch: {start?: string; end?: string}): void;
  edit(di: number, id: string): void;
  completed: string[];
}
export function ScheduleDay({route, di, actions}: {route: RouteJSON; di: number; actions?: ScheduleActions}) {
  const result = schedule.calculate(route, di, actions?.completed);
  const config = route.days[di].schedule || {};
  return <section className="schedule-day" data-testid="schedule-day">
    <div className="flex justify-between gap-2"><strong>🕘 当天时间 · {result.date || '日期未知'}</strong><span className={result.status === 'conflict' ? 'text-danger' : 'text-moss'}>{result.label}</span></div>
    {actions && <div className="grid grid-cols-2 gap-3 my-2">
      <label>{route.days[di].start_from_hotel ? '离开酒店' : '首站开始'}<input aria-label={`第${di + 1}天开始时间`} type="time" value={config.start || ''} onChange={e => actions.day(di, {start: e.target.value})} /></label>
      <label>当天结束<input aria-label={`第${di + 1}天结束时间`} type="time" value={config.end || ''} onChange={e => actions.day(di, {end: e.target.value})} /></label>
    </div>}
    <p>目的地本地时间（首版中国境内，Asia/Shanghai）。{route.days[di].start_from_hotel ? '含酒店出发交通。' : '开始时间表示已到首站；不含出发地到首站交通。'}交通采用查询时估算，未来时段可能变化。</p>
    {!!result.issues.length && <ul className="text-danger">{result.issues.map((v, i) => <li key={i}>⚠ {v.text}</li>)}</ul>}
    {!!result.unknown.length && <details><summary>查看未评估条件（{result.unknown.length}）</summary><ul>{result.unknown.map((v, i) => <li key={i}>{v.text}</li>)}</ul></details>}
    {!!result.issues.length && <p>尚无已验证的可行方案。下方候选需修改后重新评估，固定／已完成部分保持原位。</p>}
  </section>;
}
export function ScheduleVisit({point, row, onEdit}: {point: Place | Hotel; row?: ScheduleRow; onEdit?: () => void}) {
  if (!row) return null;
  const r = point.visit?.reservation;
  return <section className="schedule-visit" data-testid="schedule-visit" onClick={e => e.stopPropagation()}>
    <div className="flex justify-between items-center gap-2"><strong>{schedule.fmt(row.start)} → {schedule.fmt(row.departure)}</strong>{onEdit && <button className="nav-secondary" onClick={onEdit}>安排／预约</button>}</div>
    <p>到达 {schedule.fmt(row.arrival)}{row.wait > 0 ? ` · 等待 ${row.wait} 分钟` : ''} · {point.visit?.duration_min == null ? row.hotel ? '酒店到达边界' : '停留未知' : `停留 ${point.visit.duration_min} 分钟（${point.visit.duration_source === 'user' ? '用户设置' : '估计'}）`}{row.fixed ? ' · 🔒 固定／已完成' : ''}{point.visit?.required ? ' · 必去' : ''}</p>
    <p>天气属性：{weather.labels[weather.exposure(point)]}{point.weather_exposure?.confirmed_at && ` · 用户确认 ${point.weather_exposure.confirmed_at}`}</p>
    {r && <p>预约：{r.date || '日期未知'} {r.start}–{r.end} · {{needed: '待办理', pending: '待确认', confirmed: '用户记录已确认', cancelled: '已取消'}[r.status]}{schedule.url(r.url) && <a href={schedule.url(r.url)} target="_blank" rel="noopener noreferrer" className="ml-2 underline">打开提供的入口 ↗</a>}</p>}
    {row.fact?.known && row.fact.value && <p>开放资料：{row.fact.value.closed ? '当天关闭' : `${row.fact.value.open}–${row.fact.value.close}${row.fact.value.last_entry ? `，最后入场 ${row.fact.value.last_entry}` : ''}`} · 用户查阅后记录（{{official:'官方',map:'地图',user:'用户提供'}[row.fact.value.source_kind]}）<a href={schedule.url(row.fact.value.source_url)} target="_blank" rel="noopener noreferrer" className="ml-2 underline">来源 ↗</a><br/>查验 {row.fact.value.checked_at} · 有效 {row.fact.value.valid_from}–{row.fact.value.valid_to}</p>}
    {row.issues.map((text, i) => <p key={'i' + i} className="text-danger">⚠ {text}</p>)}
    {row.unknown.map((text, i) => <p key={'u' + i} className="text-ink-soft">未评估：{text}</p>)}
    {row.suggestions.map((text, i) => <p key={'s' + i}>{text}</p>)}
  </section>;
}

type Candidate = {title: string; url: string; excerpt: string};
export function ScheduleEditor({point, iso, city, onSave, onClose}: {point: Place | Hotel; iso: string; city: string; onSave(v: VisitPlan, facts: OpeningFact[], exposure?: WeatherExposure): boolean; onClose(): void}) {
  const [visit, setVisit] = useState<VisitPlan>(() => JSON.parse(JSON.stringify(point.visit || {duration_source: 'user', kind: 'visit'})));
  const [facts, setFacts] = useState<OpeningFact[]>(() => JSON.parse(JSON.stringify(point.opening || [])));
  const [exposure, setExposure] = useState<WeatherExposure | undefined>(() => point.weather_exposure ? {...point.weather_exposure} : undefined);
  const [error, setError] = useState(''), [searching, setSearching] = useState(false), [candidates, setCandidates] = useState<Candidate[]>([]), [sourceMsg, setSourceMsg] = useState('');
  const panel = useRef<HTMLFormElement>(null), abort = useRef<AbortController>();
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    panel.current?.querySelector<HTMLElement>('input')?.focus();
    return () => { abort.current?.abort(); old?.focus(); };
  }, []);
  const patch = (p: Partial<VisitPlan>) => setVisit(v => ({...v, ...p}));
  const changeFact = (i: number, p: Partial<OpeningFact>) => setFacts(fs => fs.map((f, j) => j === i ? {...f, ...p, confirmed: false, checked_at: ''} : f));
  const reservation = visit.reservation;
  return <div className="fixed inset-0 z-[1500] bg-black/30 flex items-center justify-center p-3" onClick={onClose}>
    <form ref={panel} role="dialog" aria-modal="true" aria-labelledby="schedule-title" className="schedule-editor" onClick={e => e.stopPropagation()} onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const list = Array.from(panel.current!.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled), a[href]'));
        if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list[list.length - 1]?.focus(); }
        else if (!e.shiftKey && document.activeElement === list[list.length - 1]) { e.preventDefault(); list[0]?.focus(); }
      }
    }} onSubmit={e => {
      e.preventDefault(); setError('');
      if (reservation && reservation.status !== 'cancelled' && (!reservation.date || schedule.clock(reservation.start) == null || schedule.clock(reservation.end) == null || schedule.clock(reservation.end)! <= schedule.clock(reservation.start)!)) return setError('请补全预约日期与时段，结束需晚于开始。');
      if (reservation?.url && !schedule.url(reservation.url)) return setError('预约入口仅支持 http(s) 链接。');
      if (facts.some(f => f.confirmed && (!f.valid_from || !f.valid_to || f.valid_to < f.valid_from || !schedule.url(f.source_url)))) return setError('确认开放资料前，请补全有效日期范围和来源链接。');
      if (facts.some(f => f.confirmed && !f.closed && (schedule.clock(f.open) == null || schedule.clock(f.close) == null || schedule.clock(f.close)! <= schedule.clock(f.open)! || (f.entry_policy === 'last_entry' && (schedule.clock(f.last_entry) == null || schedule.clock(f.last_entry)! < schedule.clock(f.open)! || schedule.clock(f.last_entry)! > schedule.clock(f.close)!))))) return setError('已确认的开放资料需有完整同日时段，最后入场应落在开放时段内。');
      if (onSave(visit, facts, exposure)) onClose();
      else setError('编辑期间路线已变化，草稿未写入。请取消后重新打开安排。');
    }}>
      <header className="flex justify-between items-center"><h2 id="schedule-title" className="font-bold text-lg">{point.name} · 时间安排</h2><button type="button" className="nav-secondary" onClick={onClose} aria-label="关闭时间安排">✕</button></header>
      <p className="text-xs text-ink-soft mt-2">原攻略时间保留。这里填写可计算的安排；每次保存可以撤销。手工改动固定时段仍会提示冲突。</p>
      <fieldset className="mt-3"><legend>天气属性 · 按实际参观区域确认</legend>
        <p className="text-xs">名称无法证明是室内。混合地点只有确认可以全程避雨后，才可改为室内。</p>
        <label>室内外属性<select aria-label="室内外属性" value={exposure?.environment || 'unknown'} onChange={e => setExposure({environment:e.target.value as WeatherExposure['environment'], rain_sensitive:exposure?.rain_sensitive ?? true, source:'user', place_name:point.name, confirmed_at:new Date().toISOString()})}>{Object.entries(weather.labels).map(([v,t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label className="flex gap-2 items-center my-2"><input type="checkbox" checked={exposure?.rain_sensitive ?? true} onChange={e => setExposure({environment:exposure?.environment || 'unknown', rain_sensitive:e.target.checked, source:'user', place_name:point.name, confirmed_at:new Date().toISOString()})}/>下雨影响游览（交通步行仍单独检查）</label>
        {exposure && <p className="text-xs">用户确认：{exposure.confirmed_at}</p>}
      </fieldset>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <label>停留分钟<input type="number" min="0" max="1440" step="1" value={visit.duration_min ?? ''} onChange={e => patch({duration_min: e.target.value === '' ? null : Number(e.target.value)})} /></label>
        <label>时长来源<select value={visit.duration_source || 'user'} onChange={e => patch({duration_source: e.target.value as VisitPlan['duration_source']})}><option value="user">用户设置</option><option value="estimate">估计（待确认）</option></select></label>
        <label>活动类型<select value={visit.kind || 'visit'} onChange={e => patch({kind: e.target.value as VisitPlan['kind']})}><option value="visit">参观</option><option value="meal">用餐</option><option value="rest">休息（无需场馆开放规则）</option></select></label>
      </div>
      <div className="flex flex-wrap gap-4 my-3">{(['required', 'locked', 'completed'] as const).map((key, i) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={!!visit[key]} onChange={e => patch({[key]: e.target.checked})} />{['必去', '锁定地点／顺序', '已完成（规划记录）'][i]}</label>)}</div>
      <fieldset><legend>固定预约／车次／酒店边界</legend>
        <label className="flex items-center gap-2 my-2"><input type="checkbox" checked={!!reservation} onChange={e => patch({reservation: e.target.checked ? {type: 'entry', date: iso, start: '', end: '', status: 'needed', url: ''} : undefined})} />记录固定时段（开始时刻必须准时到达）</label>
        {reservation && <div className="grid grid-cols-2 gap-3">
          <label>类型<select value={reservation.type} onChange={e => patch({reservation: {...reservation, type: e.target.value as typeof reservation.type}})}>{[['entry','入场'],['train','车次'],['hotel','酒店'],['other','其他']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <label>状态<select value={reservation.status} onChange={e => patch({reservation: {...reservation, status: e.target.value as typeof reservation.status}})}>{[['needed','待办理'],['pending','待确认'],['confirmed','我已确认'],['cancelled','已取消']].map(([v,t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          <label>日期<input type="date" value={reservation.date} onChange={e => patch({reservation: {...reservation, date: e.target.value}})} /></label>
          <label>开始<input type="time" value={reservation.start} onChange={e => patch({reservation: {...reservation, start: e.target.value}})} /></label>
          <label>结束<input type="time" value={reservation.end} onChange={e => patch({reservation: {...reservation, end: e.target.value}})} /></label>
          <label className="col-span-2">官方／用户提供的入口<input type="url" placeholder="https://…" value={reservation.url || ''} onChange={e => patch({reservation: {...reservation, url: e.target.value}})} /></label>
          <p className="col-span-2 text-xs text-ink-soft">打开入口办理后自行记录状态。网站不会下单或自动宣称预约成功。车次时段应包含实际乘坐时间。</p>
        </div>}
      </fieldset>
      <fieldset className="mt-4"><legend>开放／最后入场／闭馆资料</legend>
        <p className="text-xs my-2">先查阅对应地点的官方公告或地图资料，再录入值与适用日期。搜索结果只是待核对的资料线索。</p>
        <button type="button" className="nav-secondary" disabled={searching} onClick={async () => {
          const controller = new AbortController(); abort.current = controller; setSearching(true); setSourceMsg('');
          try {
            const resp = await onlineFetch(API_BASE + '/api/route/facts/search', {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name:point.name,city,date:iso}), signal: controller.signal});
            if (!resp.ok) throw new Error('资料搜索失败');
            const data = await resp.json(); setCandidates(data.candidates || []); setSourceMsg(data.note);
          } catch (err) { if (!controller.signal.aborted) setSourceMsg(err instanceof Error ? err.message : '资料搜索失败'); }
          finally { if (!controller.signal.aborted) setSearching(false); }
        }}>{searching ? '搜索中…' : '搜索资料线索'}</button>
        {sourceMsg && <p role="status" className="text-xs my-2">{sourceMsg}</p>}
        {candidates.map((c, i) => <div key={i} className="my-2 text-xs">{schedule.url(c.url) && <a className="underline text-moss" href={schedule.url(c.url)} target="_blank" rel="noopener noreferrer">{c.title} ↗</a>}<p>{c.excerpt}</p></div>)}
        {facts.map((f, i) => <section key={i} className="border border-line rounded-xl p-3 my-3">
          <div className="flex justify-between"><strong>资料 {i + 1}</strong><button type="button" className="nav-secondary" onClick={() => setFacts(fs => fs.filter((_, j) => i !== j))}>移除资料</button></div>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <label>开放<input type="time" value={f.open || ''} onChange={e => changeFact(i, {open:e.target.value})} /></label>
            <label>关闭<input type="time" value={f.close || ''} onChange={e => changeFact(i, {close:e.target.value})} /></label>
            <label>最后入场<input type="time" value={f.last_entry || ''} onChange={e => changeFact(i, {last_entry:e.target.value,entry_policy:e.target.value ? 'last_entry' : 'unknown'})} /></label>
            <label>入场限制<select value={f.entry_policy || (f.last_entry ? 'last_entry' : 'unknown')} onChange={e => changeFact(i, {entry_policy:e.target.value as OpeningFact['entry_policy'],last_entry:e.target.value === 'last_entry' ? f.last_entry : ''})}><option value="unknown">未知</option><option value="last_entry">有最后入场时刻</option><option value="none">来源说明无单独限制</option></select></label>
            <label>来源类型<select value={f.source_kind} onChange={e => changeFact(i, {source_kind:e.target.value as OpeningFact['source_kind']})}><option value="official">官方公告</option><option value="map">地图资料</option><option value="user">用户提供</option></select></label>
            <label>有效起日<input type="date" value={f.valid_from} onChange={e => changeFact(i, {valid_from:e.target.value})} /></label>
            <label>有效止日<input type="date" value={f.valid_to} onChange={e => changeFact(i, {valid_to:e.target.value})} /></label>
            <label className="col-span-2">来源链接<input type="url" value={f.source_url} onChange={e => changeFact(i, {source_url:e.target.value})} /></label>
          </div>
          <div className="flex flex-wrap gap-3 my-2">{[1,2,3,4,5,6,7].map(w => <label key={w} className="flex items-center gap-1"><input type="checkbox" checked={(f.weekdays || []).includes(w)} onChange={e => changeFact(i, {weekdays:e.target.checked ? [...f.weekdays || [],w] : (f.weekdays || []).filter(d => d !== w)})} />{'一二三四五六日'[w-1]}</label>)}</div>
          <p className="text-xs">未选星期表示有效期内每天适用；闭馆规则请单独添加对应星期资料。</p>
          <div className="flex flex-wrap gap-3 my-2"><label><input type="checkbox" checked={!!f.closed} onChange={e => changeFact(i, {closed:e.target.checked})} /> 当天关闭</label><label><input type="checkbox" checked={!!f.reservation_required} onChange={e => changeFact(i, {reservation_required:e.target.checked})} /> 要求预约</label></div>
          <label className="flex gap-2 items-center"><input type="checkbox" checked={f.confirmed} onChange={e => setFacts(fs => fs.map((v,j) => i === j ? {...v,place_name:point.name,confirmed:e.target.checked,checked_at:e.target.checked ? new Date().toISOString() : ''} : v))} />我已查阅来源，确认此地点的上述值与适用日期</label>
          {f.checked_at && <p className="text-xs mt-2">用户查验记录：{f.checked_at}</p>}
        </section>)}
        <button type="button" className="nav-secondary" onClick={() => setFacts(fs => [...fs, {valid_from:iso,valid_to:iso,source_kind:'official',source_url:'',checked_at:'',confirmed:false}])}>＋ 添加资料</button>
      </fieldset>
      {error && <p role="alert" className="text-danger my-2">{error}</p>}
      <footer className="flex justify-end gap-2 mt-4"><button type="button" className="nav-secondary" onClick={onClose}>取消</button><button className="nav-primary" type="submit">保存安排</button></footer>
    </form>
  </div>;
}
