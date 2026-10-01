/* Actual React history/persistence and both portable export paths. Synthetic data, offline jsdom. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM, VirtualConsole} from 'jsdom';
import {build} from 'esbuild';
const dir=path.resolve('test-artifacts/m29'), fixture=JSON.parse(await fs.readFile(path.join(dir,'route.json'),'utf8'));
const dom=new JSDOM('<div id="root"></div>',{url:'http://itertrip.test/',pretendToBeVisual:true}),w=dom.window;
for(const k of ['window','document','navigator','HTMLElement','Element','Node','SVGElement','HTMLDialogElement','localStorage','history','location','getComputedStyle']) Object.defineProperty(globalThis,k,{configurable:true,value:k==='window'?w:w[k]});
globalThis.requestAnimationFrame=w.requestAnimationFrame.bind(w);globalThis.cancelAnimationFrame=w.cancelAnimationFrame.bind(w);
w.SVGSVGElement.prototype.createSVGRect=()=>({});w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLElement.prototype.scrollTo=()=>{};
w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
class Observer{observe(){}unobserve(){}disconnect(){}}
globalThis.IntersectionObserver=globalThis.ResizeObserver=Observer;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const bundle=await build({entryPoints:['src/App.tsx'],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},external:['react','react-dom','react-dom/*'],define:{'import.meta.env':'{}'}});
const file=path.join(dir,'app-dom.mjs');await fs.writeFile(file,bundle.outputFiles[0].text);
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{default:App}=await import(pathToFileURL(file).href);
const T=globalThis.IterTripTransport,S=globalThis.IterTripSchedule,W=globalThis.IterTripWeather;
T.normalize(fixture);
fixture.days[0].transport=T.legs(fixture,0).map(e=>({from_id:e.from.id,to_id:e.to.id,buffer_min:0,snapshot:{signature:T.sign(e),options:[{mode:'car',status:'ok',duration_s:600,walking_m:0,fee_yuan:12,queried_at:new Date().toISOString(),source:'amap'}]}}));
localStorage.setItem('itertrip:route',JSON.stringify(fixture));
const saved=()=>JSON.parse(localStorage.getItem('itertrip:route'));
const click=async b=>act(async()=>b.dispatchEvent(new w.MouseEvent('click',{bubbles:true})));
const byText=(t,scope=document)=>{const b=[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===t);assert.ok(b,t);return b;};
const input=async(n,v)=>act(async()=>{Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(n,v);n.dispatchEvent(new w.Event('input',{bubbles:true}));});
globalThis.fetch=async()=>{throw new Error('unexpected network');};
let root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(App)));
assert.ok(document.querySelector('[data-testid="weather-panel"]'));
assert.ok(document.body.textContent.includes('1 处降水风险'));
const original=JSON.stringify(saved());
await click(byText('预览避雨调整'));assert.ok(document.querySelector('[data-testid="weather-preview"]'));
assert.equal(JSON.stringify(saved()),original,'preview writes nothing');
await click(byText('取消预览'));assert.equal(JSON.stringify(saved()),original);
await click(byText('预览避雨调整'));await click(byText('确认应用调整'));
assert.equal(saved().days[0].schedule.start,'12:00');assert.equal(W.assess(saved(),0).items.length,0);
await click(byText('↩ 撤销'));assert.equal(JSON.stringify(saved()),original,'one undo restores complete original');
await click(byText('↪ 重做'));assert.equal(saved().days[0].schedule.start,'12:00');
await click(byText('↩ 撤销'));
await click(byText('确认属性／安排',document.querySelector('[data-testid="weather-panel"]')));
const select=document.querySelector('[aria-label="室内外属性"]');
await act(async()=>{Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype,'value').set.call(select,'mixed');select.dispatchEvent(new w.Event('change',{bubbles:true}));});
await act(async()=>document.querySelector('.schedule-editor').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})));
assert.equal(saved().days[0].places[0].weather_exposure.environment,'mixed');assert.ok(W.assess(saved(),0).unknown.some(t=>t.includes('混合')));
await click(byText('↩ 撤销'));assert.equal(saved().days[0].places[0].weather_exposure.environment,'outdoor');

let resolve;
globalThis.fetch=async(url)=>{assert.ok(url.endsWith('/api/route/weather'));return new Promise(r=>resolve=r);};
await click(byText('刷新逐小时天气'));
await input(document.querySelector('[aria-label="第1天结束时间"]'),'21:00');
await act(async()=>resolve({ok:true,json:async()=>({results:[{...fixture.weather[0],queried_at:new Date().toISOString()}],error:'',calls:1})}));
assert.equal(saved().days[0].schedule.end,'21:00','delayed weather does not overwrite edits');
globalThis.fetch=async()=>{throw new TypeError('synthetic network failure');};
const timestamp=saved().weather[0].queried_at;
await click(byText('刷新逐小时天气'));
assert.equal(saved().weather[0].queried_at,timestamp,'failed refresh never relabels old timestamp');
assert.ok(saved().weather[0].refresh_error);assert.ok(W.assess(saved(),0).unknown.some(t=>t.includes('刷新失败')));
await click(byText('↩ 撤销'));assert.equal(saved().weather[0].refresh_error,undefined);

// Cold app mount with only localStorage and offline state; no provider request is allowed.
await act(async()=>root.unmount());
Object.defineProperty(w.navigator,'onLine',{configurable:true,value:false});
globalThis.fetch=async()=>{throw new Error('offline must never call provider');};
await act(async()=>w.dispatchEvent(new w.Event('offline')));
root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(App)));
assert.ok(document.body.textContent.includes('离线历史快照'));
assert.equal(byText('刷新逐小时天气').disabled,true);
assert.equal(saved().weather[0].queried_at,timestamp);
const final=saved();await act(async()=>root.unmount());w.close();

let html=await fs.readFile(path.join(dir,'export.html'),'utf8');
html=html.replace(/const TRIP = [\s\S]*?;\r?\nIterTripTransport.normalize\(TRIP\);/,()=>`const TRIP = ${JSON.stringify(final)};\nIterTripTransport.normalize(TRIP);`);
const leaflet=await fs.readFile('node_modules/leaflet/dist/leaflet.js','utf8');
for(const map of [false,true]) {
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const exported=new JSDOM(map?html.replace('<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>',()=>`<script>${leaflet}</script>`):html,{url:'http://export.test/',runScripts:'dangerously',virtualConsole:vc,beforeParse(win){win.SVGSVGElement.prototype.createSVGRect=()=>({});win.HTMLElement.prototype.scrollIntoView=()=>{};}});
 assert.equal(errors.length,0,errors.join('\n'));assert.ok(exported.window.document.querySelector('[data-testid="export-weather-day"]'));
 assert.ok(exported.window.document.body.textContent.includes('供应商未提供'));
 const trip=exported.window.eval('TRIP');assert.deepEqual(JSON.parse(JSON.stringify(trip.weather)),final.weather);
 assert.equal(JSON.stringify(exported.window.IterTripWeather.assess(trip,0)),JSON.stringify(W.assess(final,0)),'export and editor use identical weather arithmetic');
 if(map){const reexport=exported.window.__ITEST__.buildExportHTML();assert.ok(reexport.includes(final.weather[0].queried_at));}
 exported.window.close();
}
console.log('M29 DOM passed: preview/cancel/apply, one-frame undo/redo, attribute editing, delayed/failing refresh, offline reopen and both exports');
