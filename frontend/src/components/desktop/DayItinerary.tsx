import {useRef, useState, type DragEvent} from 'react';
import type {TimelineProps} from '../Timeline';
import {schedule} from '../../lib/schedule';
import {transport, type Edge} from '../../lib/transport';
import {Icon} from './Workspace';

export default function DayItinerary(p:TimelineProps & {desktopDay:number}) {
  const di=p.desktopDay, day=p.route.days[di], drag=useRef<{di:number;pi:number}|null>(null);
  const [ordering,setOrdering]=useState(false);
  if(!day)return <p className="dw-empty">暂无当天行程。</p>;
  const result=schedule.calculate(p.route,di,p.scheduleActions?.completed), traffic=transport.summary(p.route,di);
  const edges=transport.legs(p.route,di), unknownDetail=result.unknown.map(v=>v.text).join('\n');
  // M38 用户方向：未安排不是错误 —— 当天没有任何安排输入（时刻／已查交通／停留时长全空）时，
  // 不渲染待评估状态板，也不渲染「未知／停留时间未知／耗时未知」占位，只留标题行一个安静的文字入口；
  // 出现任意安排痕迹后状态板才出现（缺口仍如实报告），入口随之收敛为状态板一处。
  const arranged=!!(day.schedule?.start||day.schedule?.end)||traffic.known>0||[...day.places,...(day.hotel?[day.hotel]:[])].some(pt=>pt.visit?.duration_min!=null);
  const drop=(e:DragEvent,at:number)=>{if(!drag.current)return;e.preventDefault();p.onDropMove?.(drag.current.di,drag.current.pi,di,at);drag.current=null;};
  const leg=(edge:Edge)=>{
    const s=transport.selected(day,edge);
    const minutes=s.known?Math.ceil(s.option!.duration_s!/60):null;
    const approx=s.known&&s.approx, historical=s.known&&s.historical, label=transport.labels[s.mode];
    // 默认方式耗时由规划页自动补全；未查到的段也只留一行安静文字，整行可点开比较（不再每段挂「查看与查询」）
    return <button key={`${edge.from.id}-${edge.to.id}`} className="dw-leg" data-testid="desktop-leg" title="查看与比较交通方式"
      aria-label={`${label}${minutes!=null?`，约 ${minutes} 分钟`:'，交通待查'}${approx?'，按未核验坐标估算':''}${historical?'，历史快照':''}，查看与比较交通方式`}
      onClick={()=>p.onLegSelect?.(edge)}>
      <span className="dw-leg-line"/>
      <span className="dw-leg-mode">{label}</span>
      <span className="dw-leg-sep" aria-hidden="true">·</span>
      <span className={minutes!=null?'dw-leg-time':'dw-leg-time dw-leg-pending'}>{minutes!=null?`约 ${minutes} 分钟`:'待查'}{approx&&<small className="dw-leg-approx"> · 估算</small>}{historical&&<small className="dw-leg-approx"> · 历史</small>}</span>
      <span className="dw-leg-action" aria-hidden="true">›</span>
    </button>;
  };
  return <div className="dw-day">
    <div className="dw-day-heading"><h2>{day.theme||`第 ${day.day||di+1} 天`}</h2><div>{!arranged&&<button className="dw-order-toggle" data-testid="day-settings" onClick={()=>p.onDaySettings?.()}>安排与交通</button>}{p.editing&&<button className="dw-order-toggle" aria-pressed={ordering} onClick={()=>setOrdering(v=>!v)}>{ordering?'完成排序':'调整顺序'}</button>}</div></div>
    {/* M33：原 dw-summary 四格（默认全是「未知/未评估」）+ 重复的「当天时间与交通设置」按钮
        收成一行 —— 数字仍可一眼扫到，逐项细节走二级的当天安排与交通面板。
        M38 措辞人话化：不再说「未知」，改为说明缺什么、怎么补（诚实口径不变）。
        M38 用户方向：完全未安排的天整块不渲染（见上方 arranged 注释）。 */}
    {arranged&&<button className="dw-statusline" data-testid="day-settings" onClick={()=>p.onDaySettings?.()}>
      <span>时间 <strong>{day.schedule?.start?(result.end?`${day.schedule.start}–${schedule.fmt(result.end)}`:`${day.schedule.start} 起`):'未定'}</strong>{!day.schedule?.start&&<small> · 补开始时刻后自动推算</small>}</span>
      <span>交通 <strong>{traffic.known?`${Math.ceil(traffic.seconds/60)} 分钟`:'待查'}</strong><small>{traffic.known?`${traffic.known}/${traffic.total} 段 · 缓冲 ${traffic.buffer} 分钟${traffic.approx?` · ${traffic.approx} 段估算`:''}`:`共 ${traffic.total} 段`}</small></span>
      <span>日程 <strong className={result.issues.length?'dw-danger':''}>{result.issues.length?`${result.issues.length} 处时间冲突`:result.unknown.length?'待评估':'预计可行'}</strong><small title={unknownDetail?`信息不全：\n${unknownDetail}`:undefined}>{result.unknown.length?` · ${result.unknown.length} 项信息不全`:result.issues.length?'':' · 交通为查询时估算'}</small>{!!unknownDetail&&<span className="dw-status-help" role="img" aria-label={`信息不全：${result.unknown.map(v=>v.text).join('；')}`} title={`信息不全：\n${unknownDetail}`}>!</span>}</span>
      <span className="dw-statusline-action">安排与交通 →</span>
    </button>}
    <div className="dw-visits" onDragOver={e=>{if(drag.current)e.preventDefault();}} onDrop={e=>drop(e,day.places.length)}>
      {day.places.map((point,pi)=>{
        const key=`d${di}-p${pi}`, row=result.rows.find(r=>r.id===point.id);
        // 时间列只渲染推算出的真实值（未安排 = 留白，不写「未知」）；说明行只在有内容时渲染。
        const time=row&&row.arrival!=null?row:null;
        const meta=[point.visit?.duration_min!=null?`停留 ${point.visit.duration_min} 分钟${point.visit.duration_source==='estimate'?'（估计）':''}`:'',row?.fixed?'固定':'',point.visit?.required?'必去':''].filter(Boolean).join(' · ');
        return <div key={point.id||key}>
          {edges.filter(e=>e.to.id===point.id).map(leg)}
          <article className={`dw-visit ${p.activeKey===key?'dw-selected':''}`} data-key={key} draggable={!!p.editing&&ordering} onDragStart={e=>{drag.current={di,pi};e.dataTransfer.setData('text/plain',key);e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{drag.current=null;}} onDragOver={e=>{if(drag.current)e.preventDefault();}} onDrop={e=>{e.stopPropagation();drop(e,pi);}}>
            <button className="dw-visit-select" data-testid="place-name" aria-pressed={p.activeKey===key} onClick={()=>p.onPlaceClick(di,pi)} onDoubleClick={()=>p.onPlaceFocus?.(di,pi)}>
              <span className="dw-time">{time&&<time>{schedule.fmt(time.arrival)}</time>}{time&&time.departure!=null&&<small>{schedule.fmt(time.departure)} 离开</small>}</span><span className="dw-number">{pi+1}</span><span className="dw-visit-main"><strong>{point.name}</strong>{meta&&<small>{meta}</small>}</span><span className="dw-chevron" aria-hidden="true">›</span>
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
