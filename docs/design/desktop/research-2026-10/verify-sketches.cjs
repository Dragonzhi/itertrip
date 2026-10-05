// Independent static prototype verification; no application routes or external network.
const path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const puppeteer=require(process.env.PUPPETEER_PATH||path.join(process.env.APPDATA,'npm/node_modules/puppeteer'));
(async()=>{const out=path.join(__dirname,'screenshots');fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({headless:true,pipe:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--no-first-run','--disable-gpu']});const report=[];
try{for(const name of (process.argv.slice(2).length?process.argv.slice(2):['a-itinerary','b-map','c-schedule'])){if(!['a-itinerary','b-map','c-schedule'].includes(name))throw new Error('Unknown sketch');const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith('file:')||r.url().startsWith('data:'))r.continue();else r.abort()});
for(const [width,height] of [[1440,900],[1280,800]]){await page.setViewport({width,height});await page.goto(pathToFileURL(path.join(__dirname,'design-demos',name+'.html')).href,{waitUntil:'load'});
await page.screenshot({path:path.join(out,name+'-'+width+'.png')});const result=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,minFont:Math.min(...[...document.querySelectorAll('body *')].filter(e=>e.textContent.trim()&&e.getBoundingClientRect().width&&getComputedStyle(e).display!=='none').map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(n=>n>0)),buttons:[...document.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),id:b.id,action:b.dataset.action}))}));report.push({name,width,height,errors:[...errors],...result});}
await page.close()}
fs.writeFileSync(path.join(__dirname,'render-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close()}})();
