import {useRef, useState, type DragEvent} from 'react';
import type {TimelineProps} from '../Timeline';
import {schedule} from '../../lib/schedule';
import {transport, type Edge} from '../../lib/transport';
import {weather} from '../../lib/weather';
import {Icon} from './Workspace';

export default function DayItinerary(p:TimelineProps & {desktopDay:number}) {
  const di=p.desktopDay, day=p.route.days[di], drag=useRef<{di:number;pi:number}|null>(null);
  const [ordering,setOrdering]=useState(false);
  if(!day)return <p className="dw-empty">暂无当天行程。</p>;
  const result=schedule.calculate(p.route,di,p.scheduleActions?.completed), traffic=transport.summary(p.route,di), rain=weather.assess(p.route,di,p.scheduleActions?.completed);
  const edges=transport.legs(p.route,di);
  const drop=(e:DragEvent,at:number)=>{if(!drag.current)return;e.preventDefault();p.onDropMove?.(drag.current.di,drag.current.pi,di,at);drag.current=null;};
  const leg=(edge:Edge)=>{
    const s=transport.selected(day,edge);
    return <button key={`${edge.from.id}-${edge.to.id}`} className="dw-leg" data-testid="desktop-leg" onClick={()=>p.onLegSelect?.(edge)}><span className="dw-leg-line"/><span>{transport.labels[s.mode]} · {s.known?`约 ${Math.ceil(s.option!.duration_s!/60)} 分钟`:'耗时未知'}{s.stale?' · 历史快照':''}</span><span className="dw-leg-action">{s.known?'比较交通':'查看与查询'} →</span></button>;
  };
  return <div className="dw-day">
    <div className="dw-day-heading"><div><p>DAY {String(day.day||di+1).padStart(2,'0')} · {result.date||'日期待确认'}</p><h2>{day.theme||`第 ${day.day||di+1} 天`}</h2></div>{p.editing&&<button className="dw-order-toggle" aria-pressed={ordering} onClick={()=>setOrdering(v=>!v)}>{ordering?'完成排序':'调整顺序'}</button>}</div>
    <button className={`dw-weather-link ${rain.items.length?'dw-weather-risk':''}`} data-testid="desktop-weather" onClick={p.onWeatherSelect}>
      <span><strong>{rain.items.length?`${rain.items.length} 处天气风险${rain.unknown.length?` · ${rain.unknown.length} 项未评估`:''}`:rain.label}</strong><small>{rain.items.length?'受影响安排：'+rain.items.slice(0,2).map(item=>`${item.name} ${schedule.fmt(item.start)}–${schedule.fmt(item.end)}`).join(' · '):'查看天气覆盖与依据，按需查询或调整'}{rain.items.length>2?` 等 ${rain.items.length} 处`:''}</small></span><span>查看天气与调整 →</span>
    </button>
    <section className="dw-summary" aria-label="当天摘要">
      <div><span>预计安排</span><strong>{day.schedule?.start||'开始未知'}–{schedule.fmt(result.end)}</strong></div>
      <div><span>{traffic.known===traffic.total&&traffic.total?'预计交通':'已知交通小计'}</span><strong>{traffic.known?`${Math.ceil(traffic.seconds/60)} 分钟`:'耗时未知'}</strong><small>{traffic.known}/{traffic.total} 段 · 缓冲 {traffic.buffer} 分钟</small></div>
      <div><span>已知步行</span><strong>{traffic.walkKnown?`${(traffic.walking/1000).toFixed(1)} km`:'距离未知'}</strong><small>{traffic.walkKnown}/{traffic.total} 段</small></div>
      <button className="dw-summary-status" onClick={()=>p.onDaySettings?.()}><span>日程检查</span><strong className={result.issues.length?'dw-danger':''}>{result.issues.length?`${result.issues.length} 项冲突`:result.label}</strong><small>{result.unknown.length} 项未评估 · 查看安排</small></button>
    </section>
    <div className="dw-day-actions"><button onClick={p.onDaySettings}>当天时间与交通设置</button><span>交通为查询时估算</span></div>
    <div className="dw-visits" onDragOver={e=>{if(drag.current)e.preventDefault();}} onDrop={e=>drop(e,day.places.length)}>
      {day.places.map((point,pi)=>{
        const key=`d${di}-p${pi}`, row=result.rows.find(r=>r.id===point.id);
        return <div key={point.id||key}>
          {edges.filter(e=>e.to.id===point.id).map(leg)}
          <article className={`dw-visit ${p.activeKey===key?'dw-selected':''}`} data-key={key} draggable={!!p.editing&&ordering} onDragStart={e=>{drag.current={di,pi};e.dataTransfer.setData('text/plain',key);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{drag.current=null;}} onDragOver={e=>{if(drag.current)e.preventDefault();}} onDrop={e=>{e.stopPropagation();drop(e,pi);}}>
            <button className="dw-visit-select" data-testid="place-name" aria-pressed={p.activeKey===key} onClick={()=>p.onPlaceClick(di,pi)} onDoubleClick={()=>p.onPlaceFocus?.(di,pi)}>
              <span className="dw-time"><time>{schedule.fmt(row?.arrival??null)}</time><small>{schedule.fmt(row?.departure??null)} 离开</small></span><span className="dw-number">{pi+1}</span><span className="dw-visit-main"><strong>{point.name}</strong><small>{point.visit?.duration_min!=null?`停留 ${point.visit.duration_min} 分钟${point.visit.duration_source==='estimate'?'（估计）':''}`:'停留时间未知'}{row?.fixed?' · 固定':''}{point.visit?.required?' · 必去':''}</small></span><span className="dw-chevron" aria-hidden="true">›</span>
            </button>
            {!!(row?.issues.length||point.warnings?.length)&&<div className="dw-row-warnings">{[...new Set([...(row?.issues||[]),...(point.warnings||[])])].map((s,i)=><p key={i}>{s}</p>)}</div>}
            {p.editing&&ordering&&<div className="dw-order"><button aria-label={`上移${point.name}`} onClick={()=>p.onMovePlace?.(di,pi,-1)}>↑</button><button aria-label={`下移${point.name}`} onClick={()=>p.onMovePlace?.(di,pi,1)}>↓</button><label>移到<select aria-label={`移动${point.name}到其他天`} value={di} onChange={e=>{const dst=Number(e.target.value);if(dst!==di)p.onDropMove?.(di,pi,dst,p.route.days[dst].places.length);}}>{p.route.days.map((d,i)=><option key={i} value={i}>D{d.day||i+1}</option>)}</select></label></div>}
          </article>
        </div>;
      })}
      {day.hotel&&<>{edges.filter(e=>e.to.id===day.hotel!.id).map(leg)}<button className="dw-hotel" onClick={()=>p.onHotelClick(di)} onDoubleClick={()=>p.onHotelFocus?.(di)}><Icon name="pin"/><span><strong>{day.hotel.name}</strong><small>当天住宿 · 查看酒店与报价</small></span></button></>}
      {!day.places.length&&<p className="dw-empty">当天还没有地点，可以添加或从其他天移入。</p>}
    </div>
    {p.view?.showSummary!==false&&!!p.route.summary?.length&&<details className="dw-notes"><summary>攻略与 AI 综合建议</summary><ul>{p.route.summary.map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
  </div>;
}
