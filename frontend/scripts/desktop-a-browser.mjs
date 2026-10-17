import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import '../../shared/transport.js';
const require=createRequire(import.meta.url);
const puppeteer=require(process.env.PUPPETEER_PATH||path.join(process.env.APPDATA,'npm/node_modules/puppeteer'));
const out=path.resolve('test-artifacts/desktop-a');await fs.mkdir(out,{recursive:true});
const index=await fs.readFile('dist/index.html','utf8');
const js=await fs.readFile('dist/'+index.match(/src="\/itertrip\/(assets\/[^" ]+\.js)"/)[1],'utf8');
const css=await fs.readFile('dist/'+index.match(/href="\/itertrip\/(assets\/[^" ]+\.css)"/)[1],'utf8');
const now=new Date().toISOString(),date=new Date(Date.now()+86400000).toISOString().slice(0,10);
const names=['武侯祠','锦里','人民公园','宽窄巷子'];
const route={trip:{title:'成都，慢慢逛 · 桌面验收样例',destination:'成都',start_date:date,date_source:'user',days:3,travelers:'2 人'},days:[
 {day:1,theme:'老城与茶馆',schedule:{start:'09:00',end:'18:00'},traffic_mode:'walk',places:names.map((name,i)=>({id:'p'+i,name,lat:30.64+i*.006,lng:104.055+i*.005,source:'user',confidence:'high',note:'合成验收数据，用于检查桌面布局；营业与交通以实际查询为准。',visit:{kind:'visit',duration_min:[90,75,90,120][i],duration_source:'user'},weather_exposure:{environment:'outdoor',rain_sensitive:true,source:'user',place_name:name,confirmed_at:now}})),hotel:{id:'h',name:'春熙路住宿 · 待确认',lat:30.66,lng:104.08,prices:[],note:'验收样例'}},
 {day:2,theme:'熊猫与城市记忆',schedule:{start:'08:30',end:'18:00'},places:[{id:'panda',name:'熊猫基地',lat:30.72,lng:104.14,visit:{duration_min:150,kind:'visit'}},{id:'museum',name:'成都博物馆（长名称与预约冲突的合成验收样例）',lat:30.65,lng:104.06,visit:{duration_min:120,kind:'visit',reservation:{date,start:'09:00',end:'10:00',status:'confirmed',type:'entry'}}}]},
 {day:3,theme:'留给临时起意',places:[]}
],summary:['验收样例：可以编辑、比较交通、查看天气并撤销。'],weather:[{provider:'open_meteo',source_url:'https://open-meteo.com/',attributions:[],queried_at:now,timezone:'Asia/Shanghai',granularity:'hourly',kind:'forecast',lat:30.65,lng:104.06,valid_from:date+'T08:00:00+08:00',valid_to:date+'T19:00:00+08:00',hours:Array.from({length:11},(_,i)=>({start:date+'T'+String(8+i).padStart(2,'0')+':00:00+08:00',end:date+'T'+String(9+i).padStart(2,'0')+':00:00+08:00',probability:i>=6?85:0,precipitation_mm:i>=6?2:0}))}]};
const T=globalThis.IterTripTransport;T.normalize(route);for(const [i,edge] of T.legs(route,0).entries()){if(i>=2)break;const segment=route.days[0].transport.find(s=>s.from_id===edge.from.id&&s.to_id===edge.to.id);segment.mode=i?'bus':'walk';segment.buffer_min=i?15:7;segment.snapshot={signature:T.sign(edge),options:[{mode:segment.mode,status:'ok',duration_s:(i?28:8)*60,walking_m:i?400:600,queried_at:now,source:'synthetic',source_url:''}]};}
for(const point of route.days[0].places)point.opening=[{place_name:point.name,open:'08:00',close:'19:00',entry_policy:'none',valid_from:date,valid_to:date,source_kind:'user',source_url:'https://example.org/synthetic-opening',checked_at:now,confirmed:true}];
const bootstrap=`localStorage.clear();localStorage.setItem('itertrip:route',${JSON.stringify(JSON.stringify(route))});Object.defineProperty(navigator,'onLine',{get:()=>false});window.__calls=[];window.fetch=async(url)=>{window.__calls.push(String(url));throw new Error('离线合成验收，无网络调用')};`;
const html='<!doctype html><meta charset="utf-8"><style>'+css+'</style><div id="root"></div><script>'+bootstrap+'</script><script type="module">'+js.replaceAll('</script','<\\/script')+'</script>';
const file=path.join(out,'production-fixture.html');await fs.writeFile(file,html);
const browser=await puppeteer.launch({headless:true,pipe:true,timeout:15000,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--no-first-run','--disable-gpu']});
const report=[];
try{
 for(const [width,height] of [[1024,768],[1280,800],[1440,900],[1920,1080]]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width,height});
  await page.setRequestInterception(true);page.on('request',r=>/^(file:|data:)/.test(r.url())?r.continue():r.abort());
  await page.goto(pathToFileURL(file).href);await page.waitForSelector('[data-testid=desktop-workspace]');
  await page.click('[data-key="d0-p2"] [data-testid=place-name]');
  await page.evaluate(()=>{document.querySelector('[data-testid=desktop-itinerary]').scrollTop=0;window.__mapNode=document.querySelector('.leaflet-container')});
  assert.ok(await page.$eval('[data-pin-key="d0-p2"]',e=>e.classList.contains('active')));
  assert.equal(await page.$('.leaflet-popup'),null);
  await new Promise(resolve=>setTimeout(resolve,350));
  const layout=await page.evaluate(()=>{const r=s=>{const {x,y,width,height}=document.querySelector(s).getBoundingClientRect();return{x,y,width,height}};return{overflow:document.documentElement.scrollWidth>innerWidth,left:r('.dw-itinerary'),right:r('.dw-support'),map:r('.dw-map'),details:r('.dw-inspector')}});
  assert.equal(layout.overflow,false);assert.ok(layout.map.width>300&&layout.map.height>160);assert.ok(layout.details.y>=layout.map.y+layout.map.height);
  assert.ok(layout.left.width/width>=.55&&layout.left.width/width<=.59);
  await page.screenshot({path:path.join(out,`desktop-${width}.png`)});
  await page.click('[data-testid=chat-toggle]');await page.type('[data-testid=plan-chat-input]','下午下雨，保留已预约的安排。');
  assert.equal(await page.$eval('.dw-map',e=>e.hidden),true);
  assert.equal(await page.$eval('.dw-itinerary',e=>e.getBoundingClientRect().width),layout.left.width);
  if(width===1440)await page.screenshot({path:path.join(out,'ai-1440.png')});
  await page.click('[aria-label="关闭辅助区"]');assert.equal(await page.$eval('.dw-map',e=>e.hidden),false);
  assert.ok(await page.evaluate(()=>window.__mapNode===document.querySelector('.leaflet-container')));
  await page.click('[data-testid=chat-toggle]');assert.equal(await page.$eval('[data-testid=plan-chat-input]',e=>e.value),'下午下雨，保留已预约的安排。');
  await page.keyboard.press('Escape');assert.equal(await page.$eval('.dw-map',e=>e.hidden),false);
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-testid')==='chat-toggle');
  if(width===1440){
    const clickText=async(scope,text)=>{for(const button of await page.$$(scope+' button'))if(await button.evaluate(e=>e.textContent.trim())===text){await button.click();return;}throw new Error('Missing button '+text)};
    await clickText('.dw-inspector','编辑地点');
    const input=await page.$('[placeholder="地点名称（必填）"]');await input.focus();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await input.type('人民公园（修改验收）');
    await clickText('[role=dialog]','保存修改');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('itertrip:route')).days[0].places[2].name),'人民公园（修改验收）');
    await page.click('[aria-label="撤销"]');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('itertrip:route')).days[0].places[2].name),'人民公园');
  }
  await page.click('[data-testid=desktop-weather]');if(width===1440)await page.screenshot({path:path.join(out,'weather-1440.png')});
  await page.click('[aria-label="关闭辅助区"]');await page.click('.dw-days button:nth-child(2)');
  await page.click('[data-key="d1-p1"] [data-testid=place-name]');
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.match(await page.$eval('.dw-inspector',e=>e.textContent),/预约|时段/);
  if(width===1440)await page.screenshot({path:path.join(out,'conflict-1440.png')});
  await page.click('.dw-days button:nth-child(3)');assert.match(await page.$eval('[data-testid=desktop-itinerary]',e=>e.textContent),/没有地点/);
  const captured=await page.evaluate(()=>window.__calls);assert.deepEqual(captured,[]);assert.deepEqual(errors,[]);
  report.push({width,height,...layout,pageErrors:errors,networkCalls:captured.length});await context.close();
 }
 const page=await browser.newPage();await page.setViewport({width:1440,height:900});await page.goto(pathToFileURL(path.resolve('../docs/design/desktop/research-2026-10/design-demos/a-cream-workspace.html')).href);await page.screenshot({path:path.join(out,'warm-prototype-1440.png')});await page.click('#ai-open');assert.equal(await page.$eval('#prototype-ai',e=>e.hidden),false);await page.screenshot({path:path.join(out,'warm-prototype-ai-1440.png')});await page.close();
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close()}
