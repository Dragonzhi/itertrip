import {useEffect, useRef, useState, type ReactNode} from 'react';
import type {RouteJSON} from '../../types/route';
import './workspace.css';

export type Auxiliary = 'place' | 'leg' | 'ai' | 'weather' | 'map' | 'offline' | null;
export type Selection = {kind:'place'|'hotel'; id:string} | {kind:'leg'; from:string; to:string} | null;
export function Icon({name}:{name:'undo'|'redo'|'ai'|'export'|'more'|'close'|'plus'|'pin'}) {
  const paths={undo:'M9 5 4 10l5 5 M4 10h10a6 6 0 0 1 0 12',redo:'m15 5 5 5-5 5 M20 10H10a6 6 0 0 0 0 12',ai:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',export:'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',more:'M5 12h.01 M12 12h.01 M19 12h.01',close:'m6 6 12 12 M18 6 6 18',plus:'M12 5v14 M5 12h14',pin:'M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12Z M12 7v4'};
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}

function Toolbar({route,date,undo,redo,canUndo,canRedo,open,onHome,onJson,onHtml,exporting,recheck,rechecking}: {
  route:RouteJSON;date:ReactNode;undo():void;redo():void;canUndo:boolean;canRedo:boolean;open(a:Auxiliary):void;
  onHome():void;onJson():void;onHtml():void;exporting:boolean;recheck():void;rechecking:boolean;
}) {
  const [menu,setMenu]=useState<'export'|'more'|null>(null);
  const ref=useRef<HTMLElement>(null);
  useEffect(()=>{if(!menu)return; const close=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setMenu(null);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[menu]);
  return <header className="dw-toolbar" ref={ref} onKeyDown={e=>{if(e.key==='Escape'){setMenu(null); e.stopPropagation();}}}>
    <button className="dw-brand" onClick={onHome} title="返回首页（保留当前行程）"><Icon name="pin"/><span>IterTrip</span></button>
    <div className="dw-title"><h1 title={route.trip.title}>{route.trip.title || '我的旅行'}</h1><p>{route.trip.destination || '目的地待确认'} · 行程规划工作台</p></div>
    <div className="dw-date">{date}</div>
    <div className="dw-toolbar-actions">
      <button aria-label="撤销" title="撤销（Ctrl+Z）" disabled={!canUndo} onClick={undo}><Icon name="undo"/><span className="dw-action-label">撤销</span></button>
      <button aria-label="重做" title="重做" disabled={!canRedo} onClick={redo}><Icon name="redo"/><span className="dw-action-label">重做</span></button>
      <button className="dw-primary" data-testid="chat-toggle" onClick={()=>open('ai')}><Icon name="ai"/>让 AI 调整</button>
      <div className="dw-menu-wrap"><button data-testid="export-trigger" aria-expanded={menu==='export'} onClick={()=>setMenu(menu==='export'?null:'export')}><Icon name="export"/>导出</button>{menu==='export'&&<div className="dw-menu"><button onClick={()=>{setMenu(null);onJson();}}>导出 JSON</button><button disabled={exporting} onClick={()=>{setMenu(null);onHtml();}}>{exporting?'导出中…':'导出 HTML'}</button></div>}</div>
      <div className="dw-menu-wrap"><button aria-label="更多工具" aria-expanded={menu==='more'} onClick={()=>setMenu(menu==='more'?null:'more')}><Icon name="more"/></button>{menu==='more'&&<div className="dw-menu"><button data-testid="recheck-coords" disabled={rechecking} onClick={()=>{setMenu(null);recheck();}}>{rechecking?'校准中…':'校准坐标'}</button><button onClick={()=>{setMenu(null);open('map');}}>地图设置</button><button onClick={()=>{setMenu(null);open('offline');}}>离线管理</button></div>}</div>
    </div>
  </header>;
}

export default function Workspace(props:{
  route:RouteJSON;day:number;setDay(n:number):void;aux:Auxiliary;open(a:Auxiliary):void;map:ReactNode;itinerary:ReactNode;ai:ReactNode;weather:ReactNode;detail:ReactNode;offline:ReactNode;mapSettings:ReactNode;date:ReactNode;messages:ReactNode;onAdd():void;
  undo():void;redo():void;canUndo:boolean;canRedo:boolean;onHome():void;onJson():void;onHtml():void;exporting:boolean;recheck():void;rechecking:boolean;
}) {
  const closeRef=useRef<HTMLButtonElement>(null);
  const previous=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(props.aux){if(!previous.current || !previous.current.isConnected)previous.current=document.activeElement as HTMLElement;closeRef.current?.focus();}
    else if(previous.current?.isConnected){previous.current.focus();previous.current=null;}
  },[props.aux]);
  const titles:Record<Exclude<Auxiliary,null>,string>={place:'地点详情',leg:'交通方式比较',ai:'让 AI 调整',weather:'天气与局部调整',map:'地图设置',offline:'离线管理'};
  return <div className="dw-workspace" data-testid="desktop-workspace">
    <Toolbar {...props}/>
    <div className={`dw-body ${props.aux?'dw-has-aux':''}`}>
      <section className="dw-itinerary" aria-label="当天行程">
        <nav className="dw-days" aria-label="选择行程日期">{props.route.days.map((d,i)=><button key={i} aria-pressed={i===props.day} onClick={()=>{props.setDay(i);props.open(null);}}><strong>D{d.day||i+1}</strong><span>{d.theme||`第 ${i+1} 天`}</span></button>)}</nav>
        <div className="dw-scroll" data-testid="desktop-itinerary">{props.messages}{props.itinerary}</div>
        <footer><button className="dw-primary dw-add" onClick={props.onAdd}><Icon name="plus"/>添加地点</button></footer>
      </section>
      <section className="dw-map" aria-label="行程地图">{props.map}<div className="dw-map-caption">D{props.route.days[props.day]?.day||props.day+1} · 地点顺序 <span>连线不代表实际道路</span></div></section>
      <aside className="dw-inspector" hidden={!props.aux} aria-label="行程辅助区" onKeyDown={e=>{if(e.key==='Escape'){props.open(null);e.stopPropagation();}}}>
        <header><h2>{props.aux?titles[props.aux]:''}</h2><button ref={closeRef} onClick={()=>props.open(null)} aria-label="关闭辅助区" title="返回当天行程"><Icon name="close"/></button></header>
        <button className="dw-back" onClick={()=>props.open(null)}>← 返回当天行程</button>
        <div className="dw-ai-slot" hidden={props.aux!=='ai'}>{props.ai}</div>
        <div className="dw-scroll" hidden={props.aux!=='weather'}>{props.weather}</div>
        <div className="dw-scroll" hidden={props.aux!=='place'&&props.aux!=='leg'}>{props.detail}</div>
        <div className="dw-scroll" hidden={props.aux!=='offline'}>{props.offline}</div>
        <div className="dw-scroll" hidden={props.aux!=='map'}>{props.mapSettings}</div>
      </aside>
    </div>
  </div>;
}
