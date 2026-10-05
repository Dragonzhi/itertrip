import {useEffect, useRef, useState} from 'react';
import type {Place, Hotel, RouteJSON, TransportSnapshot} from '../types/route';
import {weather, type WeatherCandidate} from '../lib/weather';
import {schedule} from '../lib/schedule';
import {transport, type Edge} from '../lib/transport';
import {isOnline, useOffline} from '../lib/offline';
import {queryWeather, queryTransport} from '../api/client';

type Preview = WeatherCandidate & {version:RouteJSON; baseline:RouteJSON; completed:string};
const copy = (r:RouteJSON):RouteJSON => JSON.parse(JSON.stringify(r));
const records = (r:RouteJSON) => Array.isArray(r.weather) ? r.weather : [];
function hydrate(r:RouteJSON, snapshots:TransportSnapshot[]) {
  for (const day of r.days) for (const s of day.transport || []) {
    const edge=transport.legs(r,r.days.indexOf(day)).find(e=>e.from.id===s.from_id && e.to.id===s.to_id);
    const snapshot=edge && snapshots.find(v=>v.signature===transport.sign(edge));
    if (snapshot) s.snapshot=snapshot;
  }
}
export default function WeatherPanel({route, completed, isCurrent, apply, edit, blocked, onBlocking, day, onDayChange}: {
  day?:number; onDayChange?(day:number):void;
  route:RouteJSON; completed:string[]; isCurrent(r:RouteJSON):boolean;
  apply(candidate:RouteJSON, expected:RouteJSON):boolean; edit(di:number,id:string):void;
  blocked:boolean; onBlocking(value:boolean):void;
}) {
  const offline=useOffline();
  const [di,setDay]=useState(0), [busy,setBusy]=useState(false), [message,setMessage]=useState(''), [preview,setPreview]=useState<Preview|null>(null);
  const abort=useRef<AbortController>(), seq=useRef(0), opening=useRef(false);
  const [,tick]=useState(0);
  const completedKey=JSON.stringify(completed.slice().sort());
  useEffect(()=>{const timer=window.setInterval(()=>tick(n=>n+1),60000); return ()=>window.clearInterval(timer);},[]);
  useEffect(()=>{seq.current++; abort.current?.abort(); abort.current=undefined; setBusy(false); setPreview(null);},[route,completedKey,day]);
  useEffect(()=>()=>{seq.current++; abort.current?.abort();},[]);
  useEffect(()=>onBlocking(busy || !!preview),[busy,preview,onBlocking]);
  const active=route.days[Math.max(0,Math.min(day ?? di,route.days.length-1))], index=route.days.indexOf(active);
  const assessment=weather.assess(route,index,completed), thresholds=weather.policy(route);
  const forecasts=records(route).filter(f=>active.places.some(p=>weather.forecast(route,p).value===f));
  const refresh=async(dayIndex:number)=>{
    if (busy || blocked) return;
    if (!isOnline()) {setMessage('当前离线，仅查看上次预报；不能刷新天气。');return;}
    const controller=new AbortController(); abort.current=controller; const job=++seq.current, version=route;
    setBusy(true); setPreview(null); setMessage('正在查询地点区域的逐小时天气…');
    const points:(Place|Hotel)[]=[];
    // Include transport origins (e.g. previous-night hotel) and the adjacent day's swap targets.
    for (const n of [dayIndex,dayIndex+1,dayIndex-1].filter(n=>route.days[n])) {
      points.push(...transport.legs(route,n).flatMap(e=>[e.from,e.to]),...route.days[n].places);
    }
    const unique=points.filter((p,i)=>points.findIndex(q=>q.lat===p.lat && q.lng===p.lng)===i).slice(0,12);
    if (!unique.length) {setBusy(false);setMessage('没有可查询的地点。');return;}
    try {
      const result=await queryWeather(unique,controller.signal);
      if (seq.current!==job || !isCurrent(version)) return;
      abort.current=undefined;
      const r=copy(version), key=(f:{lat:number;lng:number})=>`${f.lat},${f.lng}`;
      const incoming=new Set(result.results.map(key));
      r.weather=[...records(r).filter(f=>!incoming.has(key(f))).map(f=>result.error?{...f,refresh_error:result.error}:f), ...result.results].slice(-64);
      if (JSON.stringify(r)!==JSON.stringify(version)) apply(r,version);
      setMessage(result.error || `已读取 ${result.results.length} 个地点区域的逐小时预报；未覆盖的地点仍标为未评估。`);
    } catch(e) {
      if (seq.current!==job || controller.signal.aborted) return;
      abort.current=undefined;
      const msg=e instanceof Error?e.message:'天气查询失败';
      if (isCurrent(version) && records(version).length) {const r=copy(version);r.weather=records(r).map(f=>({...f,refresh_error:msg})); apply(r,version);}
      setMessage(msg);
    } finally {if (seq.current===job) setBusy(false);}
  };
  useEffect(()=>{
    if (opening.current) return; opening.current=true;
    if (isOnline() && !blocked && route.days[0]?.places.some(p=>weather.forecast(route,p).reason)) void refresh(day ?? 0);
    // One foreground lookup per opening; edits never trigger an automatic provider loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const propose=async()=>{
    if (busy || blocked) return;
    const version=route, job=++seq.current, controller=new AbortController(); abort.current=controller;
    setBusy(true);setPreview(null);setMessage('正在检查局部调整、开放资料、预约和交通…');
    const options=weather.candidates(version,index,completed), failures:string[]=[];
    const choose=(baseline:RouteJSON)=>{
      for (const c of options) {
        const v=weather.validate(baseline,c.route,c.days,completed);
        if (v.ok) return {...c,version,baseline,completed:completedKey};
        failures.push(...v.reasons);
      }
      return null;
    };
    try {
      // Changing only a start time can reuse still-current snapshots; no paid queries if it works.
      let chosen=choose(version);
      if (!chosen && isOnline()) {
        const edges:Edge[]=[];
        for (const r of [version,...options.map(c=>c.route)]) for (const n of [index,index+1,index-1].filter(n=>r.days[n])) for (const e of transport.legs(r,n)) {
          if (!transport.selected(r.days[n],e).known && !edges.some(v=>transport.sign(v)===transport.sign(e)) && edges.length<12) edges.push(e);
        }
        if (edges.length) {
          const result=await queryTransport(edges,controller.signal);
          if (seq.current!==job || !isCurrent(version)) return;
          const baseline=copy(version);hydrate(baseline,result.results);
          for (const c of options) hydrate(c.route,result.results);
          chosen=choose(baseline);
        }
      }
      if (seq.current!==job || !isCurrent(version)) return;
      setPreview(chosen);
      setMessage(chosen?'已找到风险较低的候选，确认后才修改行程。':`保留原行程：本次有限候选中没有通过全部检查的方案。${[...new Set(failures)].slice(0,5).join('；') || '未发现可调整项'}。可先补齐安排／资料，或手工查阅室内替代点；新地点不会自动加入。`);
    } catch(e) {if (seq.current===job && !controller.signal.aborted) setMessage(e instanceof Error?e.message:'调整检查失败，原行程保留。');}
    finally {if (seq.current===job) {abort.current=undefined;setBusy(false);}}
  };
  const delta=preview && weather.delta(preview.baseline,preview.route,preview.days);
  const number=(v:number|null|undefined,unit:string)=>v==null?'未知':`${v>0?'+':''}${Math.round(v*10)/10}${unit}`;
  return <section className="weather-panel" data-testid="weather-panel">
    <header className="flex justify-between items-center gap-2"><strong>☂ 按天气调整</strong><select aria-label="天气评估天数" value={index} onChange={e=>{if(onDayChange)onDayChange(Number(e.target.value));else setDay(Number(e.target.value));setPreview(null);}}>{route.days.map((d,i)=><option key={i} value={i}>D{d.day} · {schedule.dayDate(route,i) || '日期未知'}</option>)}</select></header>
    <p className="mt-2 font-medium">{assessment.label}{!offline.online && ' · 离线历史快照'}</p>
    <p className="text-xs">降水概率 ≥ {thresholds.probability}% 或每小时降水 ≥ {thresholds.precipitation_mm} mm 即提醒。逐小时为区域估计，不能保证具体地点不淋雨。</p>
    {!!forecasts.length && <p className="text-xs">天气数据：{[...new Set(forecasts.map(f=>f.provider))].map(p=><a key={p} href={p==='qweather'?'https://www.qweather.com/':'https://open-meteo.com/'} target="_blank" rel="noopener noreferrer" className="underline mr-2">{p==='qweather'?'和风天气':'Open-Meteo'} ↗</a>)} · 已按行程时段整理</p>}
    <details className="my-2"><summary>调整阈值与地点属性</summary>
      <div className="grid grid-cols-2 gap-2 my-2">
        <label>概率阈值 %<input type="number" min="1" max="100" value={thresholds.probability} onChange={e=>{const n=Number(e.target.value);if(n>=1&&n<=100){const r=copy(route);r.weather_policy={...thresholds,probability:n};apply(r,route);}}}/></label>
        <label>降水阈值 mm/h<input type="number" step="0.1" min="0.1" max="100" value={thresholds.precipitation_mm} onChange={e=>{const n=Number(e.target.value);if(n>=.1&&n<=100){const r=copy(route);r.weather_policy={...thresholds,precipitation_mm:n};apply(r,route);}}}/></label>
      </div>
      {active.places.map(p=><div key={p.id} className="flex justify-between items-center gap-2 py-1"><span>{p.name} · {weather.labels[weather.exposure(p)]}</span><button className="nav-secondary" onClick={()=>edit(index,p.id!)}>确认属性／安排</button></div>)}
    </details>
    {!!assessment.items.length && <ul className="text-danger text-xs space-y-1">{assessment.items.map((v,i)=><li key={i}>⚠ {v.name} · {schedule.fmt(v.start)}–{schedule.fmt(v.end)} · {v.label} · 最高概率 {v.probability}%／{v.precipitation_mm} mm/h</li>)}</ul>}
    {!!assessment.unknown.length && <details className="my-2"><summary>未评估条件 {assessment.unknown.length} 项</summary><ul className="text-xs">{assessment.unknown.map((t,i)=><li key={i}>{t}</li>)}</ul></details>}
    <details className="my-2"><summary>预报来源、范围与时效（{forecasts.length} 区域）</summary>{forecasts.length?forecasts.map((f,i)=><div key={i} className="text-xs my-2 break-words"><a href={schedule.url(f.source_url)} target="_blank" rel="noopener noreferrer" className="underline">{f.provider==='qweather'?'和风天气':'Open-Meteo'} ↗</a> · 区域 WGS84 {f.lat}, {f.lng}<p>读取 {f.queried_at} · 发布 {f.issued_at || '供应商未提供'} · {f.timezone} · {f.granularity}</p><p>覆盖 {f.valid_from} 至 {f.valid_to}{f.refresh_error && ` · 刷新失败：${f.refresh_error}`}</p>{(Array.isArray(f.attributions)?f.attributions:[]).map((a,j)=>schedule.url(a)&&<a key={j} className="underline mr-2" href={schedule.url(a)} target="_blank" rel="noopener noreferrer">数据归属 ↗</a>)}</div>):<p className="text-xs">暂无此区域天气数据。超过预报范围的日期不作判断。</p>}</details>
    <div className="flex flex-wrap gap-2"><button className="nav-secondary" disabled={busy || blocked || !offline.online} onClick={()=>void refresh(index)}>刷新逐小时天气</button><button className="nav-primary" disabled={busy || blocked || !assessment.items.length} onClick={()=>void propose()}>预览避雨调整</button>{busy && <button className="nav-secondary" onClick={()=>{seq.current++;abort.current?.abort();setBusy(false);setMessage('已取消查询，原行程保留。');}}>取消查询</button>}</div>
    {message && <p role="status" className="text-xs mt-2">{message}</p>}
    {preview && <div className="weather-preview mt-3" data-testid="weather-preview">
      <strong>{preview.title}</strong><p className="text-xs">调整 {preview.rank===0?'1 项开始时间':'2 处访问顺序'}；保留所有地点、酒店和固定预约。重新检查后开放、交通和天气均无缺失；交通仍为查询时估算。</p>
      <p className="text-xs">交通 {number(delta?.minutes,'分钟')} · 步行 {number(delta?.walking,'米')} · 已知交通费用 {number(delta?.fees,'元')}。未知费用不按零计算。</p>
      {preview.days.map(n=><p key={n} className="text-xs">D{n+1} · {preview.route.days[n].schedule?.start} 开始 → {schedule.fmt(schedule.calculate(preview.route,n,completed).end)} 结束 · 风险检查 {weather.assess(preview.baseline,n,completed).items.length} → {weather.assess(preview.route,n,completed).items.length} 处（含两端交通保守检查）</p>)}
      <div className="flex gap-2 mt-2"><button className="nav-primary" disabled={blocked} onClick={()=>{
        const v=weather.validate(preview.baseline,preview.route,preview.days,completed);
        if (!isCurrent(preview.version) || completedKey!==preview.completed || !v.ok) {setPreview(null);setMessage('路线、进度或数据时效已变化，请重新预览。');return;}
        if (apply(preview.route,preview.version)) {setPreview(null);setMessage('已应用天气调整，可用「撤销」一次恢复整份原行程。');}
      }}>确认应用调整</button><button className="nav-secondary" onClick={()=>{setPreview(null);setMessage('已取消预览，原行程未改变。');}}>取消预览</button></div>
    </div>}
  </section>;
}
