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
 {day:1,theme:'老城与茶馆',schedule:{start:'09:00',end:'18:00'},traffic_mode:'walk',places:names.map((name,i)=>({id:'p'+i,name,lat:30.64+i*.006,lng:104.055+i*.005,source:'user',confidence:'high',note:'合成验收数据，用于检查桌面布局；营业与交通以实际查询为准。',visit:{kind:'visit',duration_min:[90,75,90,120][i],duration_source:'user'}})),hotel:{id:'h',name:'春熙路住宿 · 待确认',lat:30.66,lng:104.08,prices:[],note:'验收样例'}},
 {day:2,theme:'熊猫与城市记忆',schedule:{start:'08:30',end:'18:00'},places:[{id:'panda',name:'熊猫基地',lat:30.72,lng:104.14,visit:{duration_min:150,kind:'visit'}},{id:'museum',name:'成都博物馆（长名称与预约冲突的合成验收样例）',lat:30.65,lng:104.06,visit:{duration_min:120,kind:'visit',reservation:{date,start:'09:00',end:'10:00',status:'confirmed',type:'entry'}}}]},
 {day:3,theme:'留给临时起意',places:[]}
],summary:['验收样例：可以编辑、比较交通并撤销。']};
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
  const layout=await page.evaluate(()=>{const r=s=>{const {x,y,width,height}=document.querySelector(s).getBoundingClientRect();return{x,y,width,height}};return{overflow:document.documentElement.scrollWidth>innerWidth,left:r('.dw-itinerary'),right:r('.dw-inspector'),map:r('.dw-map')}});
  // M38 底图架构：地图全幅常驻（永不 resize），行程列 40% 浮层，面板右缘锚定；详情在右侧面板而非地图下方
  assert.equal(layout.overflow,false);
  assert.ok(layout.map.width===width&&layout.map.height>400,'地图全幅底图');
  assert.ok(layout.right.x+layout.right.width<=width+1&&layout.right.x>layout.left.x,'面板右缘锚定');
  assert.ok(layout.left.width/width>=.38&&layout.left.width/width<=.42);
  await page.screenshot({path:path.join(out,`desktop-${width}.png`)});
  await page.click('[data-testid=chat-toggle]');await page.type('[data-testid=plan-chat-input]','下午下雨，保留已预约的安排。');
  assert.equal(await page.$eval('.dw-map',e=>e.hidden),false); // M38 底图架构：AI 打开时地图仍常驻
  assert.equal(await page.$eval('.dw-itinerary',e=>e.getBoundingClientRect().width),layout.left.width);
  if(width===1440)await page.screenshot({path:path.join(out,'ai-1440.png')});
  await page.click('[aria-label="收起面板"]');assert.equal(await page.$eval('.dw-map',e=>e.hidden),false);
  assert.ok(await page.evaluate(()=>window.__mapNode===document.querySelector('.leaflet-container')));
  await page.click('[data-testid=chat-toggle]');assert.equal(await page.$eval('[data-testid=plan-chat-input]',e=>e.value),'下午下雨，保留已预约的安排。');
  await page.keyboard.press('Escape');assert.equal(await page.$eval('.dw-map',e=>e.hidden),false);
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-testid')==='chat-toggle');
  if(width===1440){
    // M38 回归：分割线拖拽必须真实跟手（曾连环踩两坑：docW 没绑 CSS 变量、dw-dragging 挂错元素导致过渡杀不掉）
    const before=await page.$eval('.dw-itinerary',e=>e.getBoundingClientRect().width);
    let b=await (await page.$('.dw-divider')).boundingBox();
    const y=b.y+300; // 避开垂直居中的收起按钮
    await page.mouse.move(b.x+b.width/2,y);
    await page.mouse.down();
    await page.mouse.move(b.x+b.width/2+90,y,{steps:6});
    const mid=await page.$eval('.dw-itinerary',e=>e.getBoundingClientRect().width);
    assert.ok(mid>before+50,'拖拽中列宽实时跟手（不过渡延迟）');
    await page.mouse.up();
    assert.ok(JSON.parse(await page.evaluate(()=>localStorage.getItem('itertrip:desktop-view'))).docW>40,'拖拽结果持久化');
    b=await (await page.$('.dw-divider')).boundingBox(); // 拖完分割线已移动，重取位置
    await page.mouse.move(b.x+b.width/2,y);
    await page.mouse.down();
    await page.mouse.move(b.x+b.width/2-90,y,{steps:6});
    await page.mouse.up();
    // 松手后列宽有一次过渡；等它落定再读，避免把动画中间帧误判成「没拖回去」。
    await new Promise(r=>setTimeout(r,200));
    const restored=await page.$eval('.dw-itinerary',e=>e.getBoundingClientRect().width);
    assert.ok(Math.abs(restored-before)<12,'拖回原宽');
    // 右侧 AI 面板：左侧分割线同样可拖，实时跟手并持久化（上限受行程列右缘约束）
    await page.click('[data-testid=chat-toggle]');
    const panelBefore=await page.$eval('.dw-inspector',e=>e.getBoundingClientRect().width);
    const ai=await (await page.$('.dw-ai-divider')).boundingBox();
    assert.ok(ai&&ai.width>0,'右侧面板分割线可见');
    const ay=ai.y+320;
    await page.mouse.move(ai.x+ai.width/2,ay);
    await page.mouse.down();
    await page.mouse.move(ai.x+ai.width/2-80,ay,{steps:6});
    const panelMid=await page.$eval('.dw-inspector',e=>e.getBoundingClientRect().width);
    assert.ok(panelMid>panelBefore+50,'右侧面板拖拽实时跟手');
    await page.mouse.up();
    const storedPanelW=await page.evaluate(()=>JSON.parse(localStorage.getItem('itertrip:desktop-view')).panelW);
    assert.ok(storedPanelW>panelBefore+50,'右侧面板宽度持久化');
    await page.screenshot({path:path.join(out,'ai-resized-1440.png')});
  }
  if(width===1440){
    const clickText=async(scope,text)=>{for(const button of await page.$$(scope+' button'))if(await button.evaluate(e=>e.textContent.trim())===text){await button.click();return;}throw new Error('Missing button '+text)};
    // M38 新语义：chat-toggle 是完整开关（上面已把面板关到 ai 槽），编辑入口在地点详情槽 —— 重新选中地点打开它
    await page.click('[data-key="d0-p2"] [data-testid=place-name]');
    await clickText('.dw-inspector','编辑地点');
    const input=await page.$('[placeholder="地点名称（必填）"]');await input.focus();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await input.type('人民公园（修改验收）');
    await clickText('[role=dialog]','保存修改');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('itertrip:route')).days[0].places[2].name),'人民公园（修改验收）');
    await page.click('[aria-label="撤销"]');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('itertrip:route')).days[0].places[2].name),'人民公园');
  }
  await page.click('[data-testid=day-settings]');if(width===1440)await page.screenshot({path:path.join(out,'aux-1440.png')});
  await page.click('[aria-label="收起面板"]');await page.click('.dw-dayrail button:nth-child(2)');
  await page.click('[data-key="d1-p1"] [data-testid=place-name]');
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.match(await page.$eval('.dw-inspector',e=>e.textContent),/预约|时段/);
  if(width===1440)await page.screenshot({path:path.join(out,'conflict-1440.png')});
  await page.click('.dw-dayrail button:nth-child(3)');assert.match(await page.$eval('[data-testid=desktop-itinerary]',e=>e.textContent),/没有地点/);
  const captured=await page.evaluate(()=>window.__calls);assert.deepEqual(captured,[]);assert.deepEqual(errors,[]);
  report.push({width,height,...layout,pageErrors:errors,networkCalls:captured.length});await context.close();
 }
 const page=await browser.newPage();await page.setViewport({width:1440,height:900});await page.goto(pathToFileURL(path.resolve('../docs/design/desktop/research-2026-10/design-demos/a-cream-workspace.html')).href);await page.screenshot({path:path.join(out,'warm-prototype-1440.png')});await page.click('#ai-open');assert.equal(await page.$eval('#prototype-ai',e=>e.hidden),false);await page.screenshot({path:path.join(out,'warm-prototype-ai-1440.png')});await page.close();
 await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close()}
