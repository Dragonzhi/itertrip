// Core prototype interactions in a real browser, independent of IterTrip app tests.
const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const puppeteer=require(process.env.PUPPETEER_PATH||path.join(process.env.APPDATA,'npm/node_modules/puppeteer'));
const variants=[
 {name:'a-itinerary',day1:'[data-day="0"]',day2:'[data-day="1"]',map:'[data-pin]',leg:'[data-leg="1"]',unknown:'[data-leg="2"]',ai:'#ai-open',apply:'#confirm-proposal',modal:'#modal',selected:'.selected'},
 {name:'b-map',day1:'[data-day="0"]',day2:'[data-day="1"]',map:'[data-map-place]',leg:'[data-segment="1"]',unknown:'[data-segment="2"]',ai:'#ai-open',apply:'#confirm-proposal',modal:'#dialog',selected:'.selected'},
 {name:'c-schedule',day1:'.daytab[data-day="1"]',day2:'.daytab[data-day="2"]',map:'[data-map-place]',leg:'[data-transit="metro1"]',unknown:'[data-transit="unknown1"]',ai:'#ai',apply:'#apply-candidate',modal:'#modal',selected:'.selected'},
];
(async()=>{const browser=await puppeteer.launch({headless:true,pipe:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--no-first-run','--disable-gpu']});
try{for(const v of variants){const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:900});
await page.setRequestInterception(true);page.on('request',r=>/^(file:|data:)/.test(r.url())?r.continue():r.abort());
await page.goto(pathToFileURL(path.join(__dirname,'design-demos',v.name+'.html')).href);
await page.click(v.day2);await page.click(v.map+'[data-'+(v.name==='a-itinerary'?'pin':'map-place')+'="museum"]');
assert.match(await page.$eval('#detail',e=>e.textContent),/成都博物馆/,'map to detail');
await page.click(v.day1);await page.click('[data-place="park"]');
const pin=await page.$eval(v.map+'[data-'+(v.name==='a-itinerary'?'pin':'map-place')+'="park"]',e=>e.getAttribute('aria-pressed')==='true'||e.classList.contains('selected')||e.classList.contains('active'));
assert.ok(pin,'list to map');await page.click(v.leg);assert.match(await page.$eval(v.modal,e=>e.textContent),/28|地铁/,'traffic comparison');await page.keyboard.press('Escape');
await page.click(v.unknown);assert.match(await page.$eval(v.modal,e=>e.textContent),/未查询|尚未|主动/,'unknown traffic stays explicit');await page.keyboard.press('Escape');
await page.click(v.ai);const before=await page.$eval('#detail',e=>e.textContent);assert.match(before,/人民公园/,'preview has not applied');
await page.screenshot({path:path.join(__dirname,'screenshots',v.name+'-preview.png')});await page.click(v.apply);
assert.match(await page.$eval('#detail',e=>e.textContent),/成都博物馆/,'candidate applied');
await page.click('#undo');assert.ok(await page.$('[data-place="park"]'),'undo restored day 1 park');
await page.click(v.day2);assert.ok(await page.$('[data-place="museum"]'),'undo restored original day 2 museum');
assert.deepEqual(errors,[],'no page errors');console.log(v.name+': PASS day switch, map/list selection, comparison, unknown traffic, preview, apply, undo, no page errors');await page.close();}
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);await page.click('[data-demo="c-schedule"]');assert.match(await page.$eval('#demo',e=>e.src),/c-schedule/);await page.screenshot({path:path.join(__dirname,'screenshots','comparison.png'),fullPage:true});console.log('comparison: PASS switch and render');await page.close();
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
