/* Actual production React acceptance/history and a late reply after stop.
   jsdom harness; this is not native-browser or mobile acceptance. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const dir=path.resolve('test-artifacts/m30'),fixture=JSON.parse(await fs.readFile(path.join(dir,'route.json'),'utf8'));
const dom=new JSDOM('<div id="root"></div>',{url:'http://itertrip.test/',pretendToBeVisual:true}),w=dom.window;
for(const k of ['window','document','navigator','HTMLElement','Element','Node','SVGElement','HTMLDialogElement','localStorage','history','location','getComputedStyle']) Object.defineProperty(globalThis,k,{configurable:true,value:k==='window'?w:w[k]});
globalThis.requestAnimationFrame=w.requestAnimationFrame.bind(w);globalThis.cancelAnimationFrame=w.cancelAnimationFrame.bind(w);
w.SVGSVGElement.prototype.createSVGRect=()=>({});w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLElement.prototype.scrollTo=()=>{};
const desktop=process.env.M31_DESKTOP==='1';
w.matchMedia=query=>({matches:desktop&&query.includes('1024'),addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
class Observer{observe(){}unobserve(){}disconnect(){}}
globalThis.IntersectionObserver=globalThis.ResizeObserver=Observer;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const bundle=await build({entryPoints:['src/App.tsx'],bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},external:['react','react-dom','react-dom/*'],define:{'import.meta.env':'{}'}});
const file=path.join(dir,'app-dom.mjs');await fs.writeFile(file,bundle.outputFiles[0].text);
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client'),{default:App}=await import(pathToFileURL(file).href);
const T=globalThis.IterTripTransport,S=globalThis.IterTripSchedule;
T.normalize(fixture);S.refreshClosures(fixture);
fixture.days[0].transport=T.legs(fixture,0).map(e=>({from_id:e.from.id,to_id:e.to.id,buffer_min:0,snapshot:{signature:T.sign(e),options:[{mode:'walk',status:'ok',duration_s:600,queried_at:new Date().toISOString(),source:'amap'}]}}));
localStorage.setItem('itertrip:route',JSON.stringify(fixture));
const saved=()=>JSON.parse(localStorage.getItem('itertrip:route'));
const click=async b=>{assert.ok(b);await act(async()=>b.dispatchEvent(new w.MouseEvent('click',{bubbles:true})));};
const byText=(t,scope=document)=>[...scope.querySelectorAll('button')].find(b=>b.textContent.trim()===(desktop?t.replace(/^[↩↪] /,''):t));
globalThis.fetch=async()=>{throw new Error('unexpected network');};
let root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(App)));
await click(document.querySelector('[data-testid="chat-toggle"]'));
const textarea=document.querySelector('textarea[placeholder^="告诉 AI"]');assert.ok(textarea);
const textInput=async value=>act(async()=>{Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype,'value').set.call(textarea,value);textarea.dispatchEvent(new w.Event('input',{bubbles:true}));});
const send=async text=>{await textInput(text);await act(async()=>textarea.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));};
const sse=obj=>new Response(`event: reply\ndata: ${JSON.stringify({reply:'模型宣称修改完成',intent:'route_edit',route:null,...obj})}\n\n`,{headers:{'Content-Type':'text/event-stream'}});
let latestProposal;
function model(actions,direct=true) {
  globalThis.fetch=async(url,options)=>{
    assert.ok(url.endsWith('/api/chat'));const req=JSON.parse(options.body);
    assert.equal(req.agent_schedule.length,2);assert.ok(req.agent_version);assert.ok(Array.isArray(req.completed_ids));
    latestProposal={transaction_id:req.agent_version,base_version:req.agent_version,actions};
    return sse({agent_proposal:latestProposal,agent_direct:direct,stats:{protocol:'protocol',tool_calls:0,http_calls:0,total_tokens:null,cost_usd:null}});
  };
}
const original=JSON.stringify(saved());
model([{op:'set_duration',place_id:'a',minutes:45}]);await send('把春熙路休息点停留改成 45 分钟');
assert.equal(saved().days[0].places[0].visit.duration_min,45);
assert.equal(saved().agent_receipts.length,1);assert.ok(document.querySelector('[data-testid="change-summary"]'));
assert.ok(document.body.textContent.includes('已按要求更新行程'));
const direct=JSON.stringify(saved());await click(byText('↩ 撤销'));assert.equal(JSON.stringify(saved()),original,'one undo restores entire original including receipts');
await click(byText('↪ 重做'));assert.equal(JSON.stringify(saved()),direct);
await click(byText('↩ 撤销'));

model([{op:'set_duration',place_id:'a',minutes:40},{op:'set_duration',place_id:'b',minutes:45}],false);
await send('把两处休息时间都调整一下');assert.ok(document.querySelector('[data-testid="agent-preview"]'));
assert.equal(JSON.stringify(saved()),original,'preview is read-only');
await click(byText('取消',document.querySelector('[data-testid="agent-preview"]')));assert.equal(JSON.stringify(saved()),original);
await send('把两处休息时间都调整一下');await click(byText('应用这组修改'));
assert.equal(saved().days[0].places[0].visit.duration_min,40);assert.equal(saved().days[0].places[1].visit.duration_min,45);assert.equal(saved().agent_receipts.length,1);
await click(byText('↩ 撤销'));assert.equal(JSON.stringify(saved()),original,'batch uses exactly one undo frame');

model([{op:'set_duration',place_id:'a',minutes:40},{op:'set_duration',place_id:'missing',minutes:45}],false);
await send('同时调整两处');assert.equal(JSON.stringify(saved()),original);assert.equal(document.querySelector('[data-testid="agent-preview"]'),null);
model([{op:'set_duration',place_id:'a',minutes:30}]);await send('把春熙路休息点停留改成 30 分钟');assert.equal(JSON.stringify(saved()),original);
assert.ok(document.body.textContent.includes('没有实际变化'));

// Legacy full-route response with a success claim and unchanged data is also honest.
globalThis.fetch=async()=>sse({route:saved()});await send('修改备注');assert.equal(JSON.stringify(saved()),original);
assert.ok(document.body.textContent.includes('行程未修改：没有实际变化'));

model([{op:'set_duration',place_id:'a',minutes:40},{op:'set_duration',place_id:'b',minutes:45}],false);
await send('调整两处');if(desktop)await click(byText('当天时间与交通设置'));await act(async()=>{
 const input=document.querySelector('[aria-label="第1天开始时间"]');Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,'09:15');input.dispatchEvent(new w.Event('input',{bubbles:true}));
});
const edited=JSON.stringify(saved());if(desktop)await click(document.querySelector('[data-testid=chat-toggle]'));await click(byText('应用这组修改'));assert.equal(JSON.stringify(saved()),edited);assert.ok(document.body.textContent.includes('预览期间路线或出行进度已变化'));
await click(byText('↩ 撤销'));assert.equal(JSON.stringify(saved()),original);

// A fake fetch intentionally ignores AbortSignal to reproduce the late-reply race.
let resolve,req;
globalThis.fetch=async(url,options)=>{req=JSON.parse(options.body);return new Promise(r=>resolve=r);};
await send('把春熙路休息点停留改成 45 分钟');
if(desktop){await click(document.querySelector('[aria-label=关闭辅助区]'));assert.ok(document.querySelector('[data-testid=ai-streaming]'),'closing inspector does not stop stream');await click(document.querySelector('[data-testid=chat-toggle]'));}
await click(document.querySelector('[data-testid="stop-btn"]'));
await act(async()=>resolve(sse({agent_proposal:{transaction_id:req.agent_version,base_version:req.agent_version,actions:[{op:'set_duration',place_id:'a',minutes:45}]},agent_direct:true})));
assert.equal(JSON.stringify(saved()),original,'stop prevents late successful reply from writing');assert.ok(document.querySelector('[data-testid="msg-interrupted"]'));

// Replay-add guard survives save/unmount/remount. Refresh never restores pending previews.
model([{op:'add_place',to_day:2,name:'新增草稿点',type:'other'}],false);await send('新增一个草稿点');
await click(byText('应用这组修改'));const stored=JSON.stringify(saved());assert.equal(saved().days[1].places.length,2);
await act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(App)));
assert.equal(JSON.stringify(saved()),stored);assert.equal(document.querySelector('[data-testid="agent-preview"]'),null);
const result=globalThis.IterTripAgent.prepare(saved(),latestProposal,latestProposal.base_version,[]);
assert.equal(result.changed,false);assert.ok(result.replayed);
await act(async()=>root.unmount());dom.window.close();
console.log('M30 actual React DOM passed: direct edits, atomic preview/cancel/apply, diff/no-op, stale preview, late stop, one undo/redo, receipt persistence/remount');
