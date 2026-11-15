import {useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode} from 'react';
import type {RouteJSON} from '../../types/route';
import {schedule} from '../../lib/schedule';
import './workspace.css';

export type Auxiliary = 'place' | 'leg' | 'ai' | 'map' | 'offline' | null;
export type Selection = {kind:'place'|'hotel'; id:string} | {kind:'leg'; from:string; to:string} | null;
export function Icon({name}:{name:'undo'|'redo'|'ai'|'export'|'more'|'close'|'plus'|'pin'}) {
  const paths={undo:'M9 5 4 10l5 5 M4 10h10a6 6 0 0 1 0 12',redo:'m15 5 5 5-5 5 M20 10H10a6 6 0 0 0 0 12',ai:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',export:'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',more:'M5 12h.01 M12 12h.01 M19 12h.01',close:'m6 6 12 12 M18 6 6 18',plus:'M12 5v14 M5 12h14',pin:'M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12Z M12 7v4'};
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}

// M38 第三批（用户方向稿定稿）：顶栏只做一行 —— 行程名/日期芯片/天数并入顶栏，不再有大标题横幅。
function Toolbar({route,date,undo,redo,canUndo,canRedo,open,onHome,onJson,onHtml,exporting,recheck,rechecking,aux,aiBusy}: {
  route:RouteJSON;date:ReactNode;undo():void;redo():void;canUndo:boolean;canRedo:boolean;open(a:Auxiliary):void;aux:Auxiliary;aiBusy:boolean;
  onHome():void;onJson():void;onHtml():void;exporting:boolean;recheck():void;rechecking:boolean;
}) {
  const [menu,setMenu]=useState<'export'|'more'|null>(null);
  const ref=useRef<HTMLElement>(null);
  useEffect(()=>{if(!menu)return; const close=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setMenu(null);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[menu]);
  return <header className="dw-toolbar" ref={ref} onKeyDown={e=>{if(e.key==='Escape'){setMenu(null); e.stopPropagation();}}}>
    <div className="dw-topline">
      <button className="dw-brand" onClick={onHome} title="返回首页（保留当前行程）"><Icon name="pin"/><span>IterTrip</span></button>
      <div className="dw-trip-inline">
        <h1 title={route.trip.title}>{route.trip.title || '我的旅行'}</h1>
        <div className="dw-date">{date}</div>
        <span className="dw-trip-count">{route.days.length} 天{route.trip.travelers?` · ${route.trip.travelers}`:''}</span>
      </div>
      <div className="dw-toolbar-actions">
        <div className="dw-menu-wrap"><button aria-label="更多工具" aria-expanded={menu==='more'} onClick={()=>setMenu(menu==='more'?null:'more')}><Icon name="more"/>更多工具</button>{menu==='more'&&<div className="dw-menu"><button data-testid="recheck-coords" disabled={rechecking} onClick={()=>{setMenu(null);recheck();}}>{rechecking?'校准中…':'校准坐标'}</button><button onClick={()=>{setMenu(null);open('map');}}>地图设置</button><button onClick={()=>{setMenu(null);open('offline');}}>离线管理</button></div>}</div>
        <button aria-label="撤销" title="撤销（Ctrl+Z）" disabled={!canUndo} onClick={undo}><Icon name="undo"/><span className="dw-action-label">撤销</span></button>
        <button aria-label="重做" title="重做（Ctrl+Y）" disabled={!canRedo} onClick={redo}><Icon name="redo"/><span className="dw-action-label">重做</span></button>
        <button className="dw-primary" data-testid="chat-toggle" aria-expanded={aux==='ai'} onClick={()=>open(aux==='ai'?null:'ai')}><Icon name="ai"/>{aiBusy?'AI 调整中…':'AI 调整行程'}</button>
        <div className="dw-menu-wrap"><button data-testid="export-trigger" aria-expanded={menu==='export'} onClick={()=>setMenu(menu==='export'?null:'export')}><Icon name="export"/>导出</button>{menu==='export'&&<div className="dw-menu"><button onClick={()=>{setMenu(null);onJson();}}>导出 JSON</button><button disabled={exporting} onClick={()=>{setMenu(null);onHtml();}}>{exporting?'导出中…':'导出 HTML'}</button></div>}</div>
      </div>
    </div>
  </header>;
}

// 桌面视图态（列宽/收起）持久化：itertrip:desktop-view
type DesktopView={railCollapsed?:boolean; docCollapsed?:boolean; docW?:number};
const loadView=():DesktopView=>{try{return JSON.parse(localStorage.getItem('itertrip:desktop-view')||'{}')||{};}catch{return {};}};

// M38 第三批（用户方向稿定稿）：地图是全幅底图（永不 resize），日期列/行程列/AI 面板是浮起的一层。
export default function Workspace(props:{
  route:RouteJSON;day:number;setDay(n:number):void;aux:Auxiliary;open(a:Auxiliary):void;map:ReactNode;itinerary:ReactNode;ai:ReactNode;detail:ReactNode;offline:ReactNode;mapSettings:ReactNode;date:ReactNode;messages:ReactNode;onAdd():void;
  undo():void;redo():void;canUndo:boolean;canRedo:boolean;onHome():void;onJson():void;onHtml():void;exporting:boolean;recheck():void;rechecking:boolean;
  aiBusy:boolean;
}) {
  const closeRef=useRef<HTMLButtonElement>(null);
  const previous=useRef<HTMLElement|null>(null);
  const bodyRef=useRef<HTMLDivElement>(null);
  const [view,setView]=useState<DesktopView>(loadView);
  const railCollapsed=!!view.railCollapsed, docCollapsed=!!view.docCollapsed;
  const docW=Math.max(28,Math.min(58,view.docW??40));
  const patchView=(p:DesktopView)=>setView(v=>{
    const n={...v,...p};
    try{localStorage.setItem('itertrip:desktop-view',JSON.stringify(n));}catch{/* 容量失败不打断布局 */}
    return n;
  });
  useEffect(()=>{
    if(props.aux){if(document.activeElement!==closeRef.current)previous.current=document.activeElement as HTMLElement;closeRef.current?.focus();}
    else if(previous.current?.isConnected){previous.current.focus();previous.current=null;}
  },[props.aux]);
  const close=()=>{props.open(null);};
  const titles:Record<Exclude<Auxiliary,null>,string>={place:'地点详情',leg:'交通方式比较',ai:'AI 调整行程',map:'地图设置',offline:'离线管理'};
  // 分割线拖拽：只改行程列宽度（底图架构下地图不再 resize），28–58 夹取；拖拽期间关宽度过渡
  const onDividerDown=(e:ReactMouseEvent)=>{
    if((e.target as HTMLElement).closest('button'))return;
    e.preventDefault();
    const el=bodyRef.current; if(!el)return;
    el.classList.add('dw-dragging');
    const move=(ev:MouseEvent)=>{
      const rect=el.getBoundingClientRect();
      let pct=(ev.clientX-rect.left)/rect.width*100;
      pct=Math.max(28,Math.min(58,pct));
      patchView({docW:Math.round(pct*10)/10});
    };
    const up=()=>{el.classList.remove('dw-dragging');window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);};
    window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);
  };
  return <div className={`dw-workspace${railCollapsed?' dw-rail-collapsed':''}${docCollapsed?' dw-doc-collapsed':''}`} data-testid="desktop-workspace">
    <Toolbar {...props}/>
    <div className="dw-body" ref={bodyRef}>
      <nav className="dw-dayrail" aria-label="选择行程日期">
        {props.route.days.map((d,i)=>{
          const date=schedule.dayDate(props.route,i);
          return <button key={i} aria-pressed={i===props.day} onClick={()=>{props.setDay(i);props.open(null);}}><strong>D{d.day||i+1}</strong>{date&&<span className="dw-rail-date">{date.slice(5).replace('-','.')}</span>}<small>{date?['周日','周一','周二','周三','周四','周五','周六'][schedule.date(date)!.getDay()]:''}</small></button>;
        })}
        <button className="dw-rail-toggle" aria-expanded={!railCollapsed} aria-label={railCollapsed?'展开日期列':'收起日期列'} title={railCollapsed?'展开日期列':'收起日期列'} onClick={()=>patchView({railCollapsed:!railCollapsed})}>{railCollapsed?'›':'‹'}</button>
      </nav>
      <button className="dw-doc-tab" hidden={!docCollapsed} aria-label="展开行程列" title="展开行程列" onClick={()=>patchView({docCollapsed:false})}>›</button>
      <section className="dw-itinerary" aria-label="当天行程">
        <div className="dw-scroll" data-testid="desktop-itinerary">{props.messages}{props.itinerary}</div>
        <footer><button className="dw-add" onClick={props.onAdd}><Icon name="plus"/>添加地点</button></footer>
      </section>
      <div className="dw-divider" role="separator" aria-label="调整行程列宽度" tabIndex={0} hidden={docCollapsed}
        onMouseDown={onDividerDown}
        onKeyDown={e=>{
          if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();patchView({docW:Math.max(28,Math.min(58,docW+(e.key==='ArrowRight'?2:-2)))});}
        }}>
        <button className="dw-div-collapse" aria-expanded={!docCollapsed} aria-label={docCollapsed?'展开行程列':'收起行程列'} title={docCollapsed?'展开行程列':'收起行程列'} onClick={()=>patchView({docCollapsed:!docCollapsed})}>‹</button>
      </div>
      <section className="dw-map" aria-label="行程地图">{props.map}<div className="dw-map-caption">D{props.route.days[props.day]?.day||props.day+1} · 地点顺序 <span>连线不代表实际道路</span></div></section>
      <aside className="dw-inspector" hidden={!props.aux} aria-label="行程辅助区" onKeyDown={e=>{if(e.key==='Escape'){close();e.stopPropagation();}}}>
        <header><h2>{props.aux?titles[props.aux]:''}</h2><button ref={closeRef} onClick={close} aria-label="收起面板" title="收起面板"><Icon name="close"/></button></header>
        <div className="dw-ai-slot" hidden={props.aux!=='ai'}>{props.ai}</div>
        <div className="dw-scroll" hidden={props.aux!=='place'&&props.aux!=='leg'}>{props.detail}</div>
        <div className="dw-scroll" hidden={props.aux!=='offline'}>{props.offline}</div>
        <div className="dw-scroll" hidden={props.aux!=='map'}>{props.mapSettings}</div>
      </aside>
    </div>
  </div>;
}
