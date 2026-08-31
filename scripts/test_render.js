#!/usr/bin/env node
/* IterTrip 渲染冒烟测试：在 jsdom 中执行模板内联 JS，mock Leaflet，抓运行时错误 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

/* 被测产物默认取自 test-artifacts/（本地测试目录，已 gitignore）；也可传参覆盖 */
const htmlPath = process.argv[2] || path.join(__dirname, '..', 'test-artifacts', 'sample_route.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;

/* ---------- Leaflet mock ---------- */
const callLog = [];
function fakeEl() {
  return {
    _children: [],
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    style: {},
    appendChild(c){ this._children.push(c); return c; },
    querySelector(){ return fakeEl(); },
    addEventListener(){},
    scrollIntoView(){},
    set innerHTML(v){ this._html = v; },
    get innerHTML(){ return this._html || ''; },
    set textContent(v){ this._txt = v; },
    get textContent(){ return this._txt || ''; },
    setAttribute(){}, getAttribute(){ return null; },
  };
}
function fakeMarker(){
  return {
    _icon: { querySelector(){ return fakeEl(); } },
    addTo(target){ callLog.push(['layerAddTo', target && target._isLayerGroup ? 'mapLayers' : 'map']); return this; },
    bindPopup(){ return this; },
    on(){ return this; },
    openPopup(){ return this; },
    setIcon(){ return this; },
    getIcon(){ return this._icon; },
    getElement(){ return this._icon; },
  };
}
function fakeLayerGroup(){
  const layers = [];
  const g = {
    _isLayerGroup: true,
    _layers: layers,
    addTo(){ return g; },
    addLayer(l){ layers.push(l); return g; },
    clearLayers(){ layers.length = 0; return g; },
    eachLayer(fn){ layers.forEach(fn); return g; },
    getLayers(){ return layers.slice(); },
  };
  return g;
}
global.L = {
  _map: null,
  map(){
    let _zoom = 5;
    const handlers = {};
    const m = {
      setView(){ return this; },
      fitBounds(b, o){ callLog.push(['fitBounds', b, o || {}]); return this; },
      invalidateSize(o){ callLog.push(['invalidateSize', o || {}]); return this; },
      flyTo(){ callLog.push(['flyTo', Array.from(arguments)]); return this; },
      zoomIn(){ return this; }, zoomOut(){ return this; },
      getZoom(){ return _zoom; }, setZoom(z){ _zoom = z; return this; },
      _setZoom(z){ _zoom = z; (handlers.zoomend||[]).forEach(h => h()); return this; },
      on(evt, fn){ (handlers[evt] = handlers[evt] || []).push(fn); return this; },
      once(evt, fn){ (handlers[evt] = handlers[evt] || []).push(fn); return this; },
      off(evt, fn){ handlers[evt] = (handlers[evt] || []).filter(h => h !== fn); return this; },
      fire(evt, arg){ (handlers[evt] || []).slice().forEach(h => h(arg)); return this; },
      getCenter(){ return { lat: 34.05, lng: 108.94 }; },
      dragging: { disable(){ callLog.push(['draggingDisable']); }, enable(){ callLog.push(['draggingEnable']); } },
      touchZoom: { disable(){}, enable(){} },
      doubleClickZoom: { disable(){ callLog.push(['dblDisable']); }, enable(){ callLog.push(['dblEnable']); } },
    };
    global.L._map = m;
    return m;
  },
  tileLayer(url){
    callLog.push(['tileLayer', url]);
    return { addTo(){ return this; } };
  },
  control: {
    zoom(o){ callLog.push(['zoomCtl', o && o.position]); return { addTo(){ return this; } }; },
    layers(_b, _c, o){ callLog.push(['layersCtl', (o && o.position) || 'topright']); return { addTo(){ return this; } }; },
    attribution(o){ callLog.push(['attrCtl', o && o.position]); return { addTo(){ return this; } }; },
  },
  divIcon(o){ callLog.push(['divIcon', o.html || '']); return o; },
  marker(_latlng, opts){
    callLog.push(['marker', opts && opts.icon ? String(opts.icon.html || '') : '', opts || {}, _latlng]);
    return fakeMarker();
  },
  polyline(_pts, opts){ callLog.push(['polyline', (opts && opts.className) || '', (opts && opts.color) || '', _pts]); return { addTo(target){ callLog.push(['layerAddTo', target && target._isLayerGroup ? 'mapLayers' : 'map']); return this; }, getElement(){ return null; } }; },
  layerGroup(){ callLog.push(['layerGroup']); return fakeLayerGroup(); },
};

/* ---------- 提取并执行内联 JS ---------- */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let errors = [];
scripts.forEach((code, i) => {
  try {
    const fn = new Function('window', 'document', 'L', code);
    fn(window, document, global.L);
  } catch (e) {
    errors.push(`script block ${i}: ${e.message}\n  ${e.stack.split('\n')[1]}`);
  }
});

/* ---------- 断言 ---------- */
let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

console.log('== 执行错误 ==');
if (errors.length) { errors.forEach(e => console.log('  ERROR:', e)); }
else { console.log('  无运行时错误'); }

console.log('== 产物断言 ==');
assert('标题注入为成都行程', document.getElementById('ttTitle').textContent.includes('成都'));
assert('行程 meta 含目的地+预算', (document.getElementById('ttMeta').textContent || '').includes('中等'));
assert('时间线渲染 3 个 day-block', document.querySelectorAll('.day-block').length === 3);
assert('景点条目数量 ≥ 8', document.querySelectorAll('.place-item').length >= 8);
assert('酒店卡片 ≥ 3', document.querySelectorAll('.hotel-card').length >= 3);
assert('比价表行含美团/携程/RollingGo', /美团.*携程.*RollingGo/s.test(document.querySelector('.price-table')?.innerHTML || ''));
assert('最低价标签出现', document.body.innerHTML.includes('最低'));
assert('AI 综合建议渲染', document.getElementById('summary').innerHTML.includes('预算预估'));
assert('图例动态生成 ≥3 天', document.getElementById('legend').innerHTML.split('D').length - 1 >= 3);
assert('地图标记已创建', callLog.filter(c => c[0] === 'marker').length >= 4);
assert('路线折线已创建', callLog.filter(c => c[0] === 'polyline').length >= 1);

/* 新增：瓦片源 + 点击定位 */
assert('默认瓦片是高德(autonavi)而非Carto', callLog.some(c => c[0]==='tileLayer' && /autonavi/.test(c[1])));
assert('不再使用Carto瓦片', !callLog.some(c => c[0]==='tileLayer' && /cartocdn/.test(c[1])));
// 点击第一个地点条目 → 地图 flyTo 到该地点
const firstItem = document.querySelector('.place-item');
if (firstItem){
  firstItem.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const fly = callLog.filter(c => c[0] === 'flyTo');
  assert('点击地点条目触发地图 flyTo', fly.length >= 1);
}
// 点击酒店卡片 → 地图 flyTo 到酒店
const hotelCard = document.querySelector('.hotel-card');
if (hotelCard){
  hotelCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const fly = callLog.filter(c => c[0] === 'flyTo');
  assert('点击酒店卡片触发地图 flyTo', fly.length >= 2);
}

/* 地图缩放范围（高德瓦片 z3 起，z<3 为空白） */
assert('地图缩放下限 minZoom=3', /L\.map\('map',[^)]*minZoom:\s*3/.test(html));
assert('地球模块已完全移除', !html.includes('setGlobeVisible') && !html.includes('id=\"globe\"'));
assert('缩放控件为默认左上(zoomControl:true)', /L\.map\('map',[^)]*zoomControl:\s*true/.test(html));
assert('瓦片切换控件在左上角', callLog.some(c => c[0] === 'layersCtl' && c[1] === 'topleft'));
assert('版权控件在左下角', callLog.some(c => c[0] === 'attrCtl' && c[1] === 'bottomleft'));
assert('顶部控件下移至标题栏下方(.leaflet-top)', html.includes('.leaflet-top { top: 78px; }'));
assert('移动端默认收起行程面板', html.includes("matchMedia('(max-width: 640px)')"));console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
assert('移动端面板展开不压控件列', html.includes('calc(100vw - 96px)'));

/* 有向路线：描边 + 主线 + 段中点箭头 */
const pl = callLog.filter(c => c[0] === 'polyline');
assert('每日两条折线(描边+主线共6条)', pl.length === 6
  && pl.filter(c => String(c[1]).indexOf('route-line-casing') !== -1).length === 3
  && pl.filter(c => String(c[1]).indexOf('route-line-main') !== -1).length === 3);
const arrows = callLog.filter(c => c[0] === 'divIcon' && String(c[1]).indexOf('route-arrow') !== -1);
assert('段中点箭头 7 枚(样本 4+3+3 景点)', arrows.length === 7);
assert('箭头带旋转角与日配色变量', arrows.every(c => String(c[1]).indexOf('rotate(') !== -1 && String(c[1]).indexOf('--rc:') !== -1));
assert('箭头不拦截地图点击(interactive:false)', callLog.some(c => c[0] === 'marker' && c[2] && c[2].interactive === false && c[2].zIndexOffset === -800));

/* 有向路线几何正确性：测试内独立实现 Mercator 投影，与产物内箭头角度/中点比对（非循环验证） */
const RAD = Math.PI / 180;
const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));
const mainLines = pl.filter(c => String(c[1]).indexOf('route-line-main') !== -1);
const arrowMk = callLog.filter(c => c[0] === 'marker' && String(c[1]).indexOf('route-arrow') !== -1);
let segTotal = 0, maxAngErr = 0, maxMidErr = 0, paired = 0;
mainLines.forEach(line => {
  const pts = line[3] || [];
  for (let s = 0; s + 1 < pts.length; s++) {
    const a = pts[s], b = pts[s + 1];
    if (Math.abs(b[1] - a[1]) < 1e-9 && Math.abs(merc(b[0]) - merc(a[0])) < 1e-9) continue; /* 与模板一致：重合段跳过 */
    segTotal++;
    const mk = arrowMk[paired];
    if (!mk) return;
    paired++;
    const rot = parseFloat((String(mk[1]).match(/rotate\((-?[\d.]+)deg\)/) || [])[1]);
    let dl = b[1] - a[1];
    if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
    const expDeg = Math.atan2(-(merc(b[0]) - merc(a[0])), dl * RAD) * 180 / Math.PI;
    if (!isNaN(rot)) maxAngErr = Math.max(maxAngErr, Math.abs(rot - expDeg));
    const mid = mk[3];
    if (mid && mid.length === 2) {
      /* 投影空间中点须落在渲染线段中点：x 线性均值、y 为 mercY 均值 */
      const midYerr = Math.abs(merc(mid[0]) - (merc(a[0]) + merc(b[0])) / 2);
      const midXerr = Math.abs(mid[1] - (a[1] + b[1]) / 2);
      maxMidErr = Math.max(maxMidErr, midYerr, midXerr);
    }
  }
});
assert('箭头角度与独立投影计算一致(≤0.5°)', paired === segTotal && maxAngErr <= 0.5);
assert('箭头位于投影空间线段中点(≤1e-6°)', maxMidErr <= 1e-6);
console.log('  · 箭头配对 ' + paired + '/' + segTotal + ', 最大角度误差 ' + maxAngErr.toFixed(4) + '°, 最大中点误差 ' + maxMidErr.toExponential(2) + '°');


/* 侧边栏横向拖拽手柄 */
const handle = document.getElementById('panel-resize');
assert('面板左边缘存在拖拽手柄(role=separator)', !!handle
  && handle.getAttribute('role') === 'separator'
  && handle.getAttribute('tabindex') === '0');
assert('手柄 CSS:col-resize + touch-action:none', /\.panel-resize[^}]*cursor:\s*col-resize/s.test(html) && /\.panel-resize[^}]*touch-action:\s*none/s.test(html));
assert('手柄 CSS 拖动期间禁用地图交互', html.includes('body.panel-dragging .leaflet-container { pointer-events: none; }'));
assert('JS 走 Pointer Events 三件套(down/move/cancel)', html.includes('pointerdown') && html.includes('pointermove') && html.includes('pointercancel'));
assert('宽度本地记忆键存在', html.includes('itertrip-panel-width') && html.includes('localStorage'));

function dragFrom(clientX0, clientX1){
  const down = new window.Event('pointerdown', { bubbles: true, cancelable: true });
  down.clientX = clientX0; down.pointerId = 1;
  handle.dispatchEvent(down);
  const mv = new window.Event('pointermove', { bubbles: true, cancelable: true });
  mv.clientX = clientX1; mv.pointerId = 1;
  window.dispatchEvent(mv);
  window.dispatchEvent(new window.Event('pointerup', { bubbles: true, cancelable: true }));
}
const panelEl = document.getElementById('panel');
assert('拖拽前未写内联宽度', panelEl.style.width === '');
dragFrom(600, 450);   /* 向左拖 150px = 变宽 150px */
assert('拖动 150px 后面板宽 550px', panelEl.style.width === '550px', panelEl.style.width);
assert('内联 max-width 已解除', panelEl.style.maxWidth === 'none');
assert('抬手后 body 不再带 panel-dragging', !document.body.classList.contains('panel-dragging'));
assert('拖面板不碰地图(零 invalidateSize 调用)', !callLog.some(c => c[0] === 'invalidateSize'));
dragFrom(600, -400);   /* 一次拖到远超上限 */
const w1 = parseFloat(panelEl.style.width);
assert('宽度夹在上限 640 与下限 280 之间', w1 >= 280 && w1 <= 640, w1);
handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
assert('键盘 Home 落到最小值 280', parseFloat(panelEl.style.width) === 280, panelEl.style.width);
handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
assert('键盘 ArrowRight+Shift 大步 +80', parseFloat(panelEl.style.width) === 360, panelEl.style.width);
handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
assert('键盘 ArrowLeft 小步 -24', parseFloat(panelEl.style.width) === 336, panelEl.style.width);
console.log('  · 宽度链: 默认 → 550 → 夹边 ' + w1 + ' → Home 280 → Shift+80 → 336');

/* ==================== 交互编辑器 ==================== */
const ITEST = window.__ITEST__;
console.log('== 编辑器：可重渲染 ==');
assert('暴露 __ITEST__ 测试钩子', !!ITEST && typeof ITEST.stats === 'function');
assert('渲染图层集中到 mapLayers(26 次 addTo:13标记+7箭头+6折线, 目标全为 mapLayers)',
  callLog.filter(c => c[0] === 'layerAddTo').length === 26
  && callLog.filter(c => c[0] === 'layerAddTo' && c[1] === 'mapLayers').length === 26);
assert('layerGroup 已创建且归入地图', callLog.filter(c => c[0] === 'layerGroup').length === 1);
assert('初始历史快照 1 帧指向第 0 步', ITEST.history().len === 1 && ITEST.history().idx === 0);
const templateSrc = fs.readFileSync(path.join(__dirname, '..', 'templates', 'route_map.html'), 'utf-8');
assert('模板仍保留 __TRIP_DATA__ 占位符(构建流程不受影响)', templateSrc.includes('const TRIP = __TRIP_DATA__;'));

console.log('== 编辑器：拖拽排序 ==');
const dayBodies = () => document.querySelectorAll('.day-block .day-body');   /* rerender 重建 DOM，必须每次重查 */
const d1Items = () => Array.from(dayBodies()[0].querySelectorAll('.place-item .place-name')).map(e => e.textContent);
const d1Before = ITEST.TRIP.days[0].places.map(p => p.name);
assert('所有地点条目 draggable=true', Array.from(document.querySelectorAll('.place-item')).every(el => el.draggable === true));
assert('每个条目带删除按钮', document.querySelectorAll('.place-item .place-del').length === document.querySelectorAll('.place-item').length);

function dragEvent(type){
  const e = new window.Event(type, { bubbles: true, cancelable: true });
  e.dataTransfer = { effectAllowed: '', dropEffect: '', setData(){}, getData(){ return ''; } };
  return e;
}
/* 同天：把 D1 第 1 个拖到列表末尾（jsdom 无布局，占位符总落在末尾=酒店卡片之前） */
const d1first = dayBodies()[0].querySelector('.place-item');
d1first.dispatchEvent(dragEvent('dragstart'));
assert('dragstart 记录拖拽上下文并置灰', d1first.classList.contains('dragging'));
dayBodies()[0].dispatchEvent(dragEvent('dragover'));
const ph = dayBodies()[0].querySelector('.drop-placeholder');
assert('dragover 出现虚线占位符', !!ph);
assert('占位符至多插到酒店卡片之前', !ph.nextElementSibling || ph.nextElementSibling.classList.contains('hotel-card') || ph.nextElementSibling.classList.contains('place-item'));
dayBodies()[0].dispatchEvent(dragEvent('drop'));
assert('drop 后条目脱离拖拽态(新 DOM 重查)', !dayBodies()[0].querySelector('.place-item').classList.contains('dragging'));
assert('占位符已清理', !document.querySelector('.drop-placeholder'));
const d1After = ITEST.TRIP.days[0].places.map(p => p.name);
assert('同天拖动首条到末尾:TRIP 顺序更新', d1After[3] === d1Before[0] && d1After.slice(0, 3).join() === d1Before.slice(1, 4).join(),
  JSON.stringify(d1After));
assert('DOM 顺序与 TRIP 一致', d1Items().join() === d1After.join());
assert('同天拖拽索引补偿正确(尾位=源0 → 目标3)', d1After[3] === d1Before[0]);

/* 跨天：把 D1 末条拖到 D2 末尾，酒店不动 */
const movedName = ITEST.TRIP.days[0].places[3].name;
const srcItem = Array.from(dayBodies()[0].querySelectorAll('.place-item'))
  .find(el => el.querySelector('.place-name').textContent === movedName);
srcItem.dispatchEvent(dragEvent('dragstart'));
dayBodies()[1].dispatchEvent(dragEvent('dragover'));
dayBodies()[1].dispatchEvent(dragEvent('drop'));
assert('跨天拖拽:TRIP 数据移动', ITEST.TRIP.days[1].places.some(p => p.name === movedName) && !ITEST.TRIP.days[0].places.some(p => p.name === movedName));
assert('跨天拖拽:D1 少 1 条、D2 多 1 条', ITEST.TRIP.days[0].places.length === 3 && ITEST.TRIP.days[1].places.length === 4);
const d2HotelName = ITEST.TRIP.days[1].hotel.name;
assert('酒店不受拖拽影响', !!d2HotelName && ITEST.TRIP.days[1].places.every(p => p.name !== d2HotelName));
assert('拖拽进历史栈(快照帧数增加)', ITEST.history().len >= 3);
/* 原位放置不算编辑：拖 D1 最后一条到末尾（补偿后 idx===srcPi） */
const lenBefore = ITEST.history().len;
const curItems = dayBodies()[0].querySelectorAll('.place-item');
const cur = curItems[curItems.length - 1];
cur.dispatchEvent(dragEvent('dragstart'));
dayBodies()[0].dispatchEvent(dragEvent('dragover'));
dayBodies()[0].dispatchEvent(dragEvent('drop'));
assert('原位放置不进历史栈', ITEST.history().len === lenBefore);

console.log('== 编辑器:删除 / 撤销重做 ==');
const markerCount0 = ITEST.stats().markers;
const delBtn = dayBodies()[1].querySelector('.place-item .place-del');
delBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert('点击删除:TRIP 少 1 条', ITEST.TRIP.days[1].places.length === 3);
assert('点击删除:标记数同步减少', ITEST.stats().markers === markerCount0 - 1);
ITEST.undo();
assert('撤销恢复被删条目', ITEST.TRIP.days[1].places.length === 4 && ITEST.stats().markers === markerCount0);
ITEST.redo();
assert('重做再次删除', ITEST.TRIP.days[1].places.length === 3);
ITEST.undo();
assert('再撤销回到删除前', ITEST.TRIP.days[1].places.length === 4);
assert('重渲染不重置视野(零额外 fitBounds)', callLog.filter(c => c[0] === 'fitBounds').length === 1);

console.log('== 编辑器:选点新增 ==');
document.getElementById('btn-add').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert('进入选点模式:body.picking', document.body.classList.contains('picking'));
assert('选点模式禁用拖拽与双击缩放', callLog.filter(c => c[0] === 'draggingDisable').length === 1 && callLog.filter(c => c[0] === 'dblDisable').length === 1);
assert('按钮高亮 active-mode', document.getElementById('btn-add').classList.contains('active-mode'));
global.L._map.fire('click', { latlng: { lat: 30.65, lng: 104.06 } });
assert('地图点击后退出选点模式', !document.body.classList.contains('picking'));
assert('弹出新增表单', document.getElementById('add-form-backdrop').classList.contains('open'));
assert('坐标写入表单', document.getElementById('af-pos').textContent.includes('30.65'));
assert('名称为空时确定按钮禁用', document.getElementById('af-ok').disabled === true);
document.getElementById('af-name').value = '测试新增点';
document.getElementById('af-name').dispatchEvent(new window.Event('input', { bubbles: true }));
assert('输入名称后确定按钮启用', document.getElementById('af-ok').disabled === false);
const d3CountBefore = ITEST.TRIP.days[2].places.length;
document.getElementById('af-day').value = '2';
document.getElementById('af-ok').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert('确定后表单关闭', !document.getElementById('add-form-backdrop').classList.contains('open'));
const added = ITEST.TRIP.days[2].places[ITEST.TRIP.days[2].places.length - 1];
assert('新地点写入所选天(D3 末尾)', ITEST.TRIP.days[2].places.length === d3CountBefore + 1 && added.name === '测试新增点');
assert('新地点字段完整(空字段为空串)', added.lat === 30.65 && added.lng === 104.06 && added.type === 'attraction' && added.time === '');

console.log('== 编辑器:导出 ==');
const exJson = ITEST.buildExportJSON();
const parsed = JSON.parse(exJson);
assert('导出 JSON 合法且含新地点', parsed.days[2].places.some(p => p.name === '测试新增点'));
const exHtml = ITEST.buildExportHTML();
assert('导出 HTML 基于纯净快照(无 Leaflet 运行时 DOM)', !!exHtml && !exHtml.includes('class="leaflet-pane"'));
assert('导出 HTML 含编辑后数据', exHtml.includes('\\u6d4b\\u8bd5\\u65b0\\u589e\\u70b9') || exHtml.includes('测试新增点'));
assert('导出 HTML 的 TRIP 行内 < 已全量转义', !/const TRIP = [\s\S]*;</.test(exHtml.replace('\\u003c', '')));
assert('导出 HTML 是完整文档', exHtml.trimEnd().endsWith('</html>') && exHtml.includes('panel-resize'));
assert('导出 HTML 不再含占位符', !exHtml.includes('__TRIP_DATA__'));
assert('导出后重载可执行(内联脚本块完整)', (exHtml.match(/<script>([\s\S]*?)<\/script>/g) || []).length === 1);

console.log('== 编辑器:快捷键 ==');
const zk = (init) => { const e = new window.KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init)); document.dispatchEvent(e); return e; };
ITEST.undo();
assert('Ctrl+Z 撤销生效(键盘路径)', ITEST.TRIP.days[2].places.length === d3CountBefore);
zk({ key: 'z', ctrlKey: true });
assert('再次 Ctrl+Z 可继续回退', ITEST.history().idx < ITEST.history().len - 1);
zk({ key: 'z', ctrlKey: true, shiftKey: true });
assert('Ctrl+Shift+Z 重做生效(恢复跨天移动, D2=4)', ITEST.TRIP.days[1].places.length === 4);
zk({ key: 'z', ctrlKey: true, shiftKey: true });
assert('继续重做恢复新增(D3 +1)', ITEST.TRIP.days[2].places.length === d3CountBefore + 1);
const nameInput = document.getElementById('af-name');
nameInput.value = 'x';
/* 豁免路径必须以 input 为事件目标（真实浏览器中按键派发到聚焦元素）；
   若误派发到 document，e.target 不是输入框，会触发一次游离 undo 污染后续测试 */
const histBeforeExempt = ITEST.history().idx;
nameInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
assert('输入框聚焦时快捷键豁免(未触发撤销)', nameInput.value === 'x' && ITEST.history().idx === histBeforeExempt);

/* ==================== 编辑已有地点 ====================
   注意：本块会追加历史帧，必须放在快捷键测试之后（其 undo 断言
   假设当前帧 = 新增帧）；块内全部用增量 len 与动态取值保持自包含 */
console.log('== 编辑器:编辑已有地点 ==');
const tDay = 0, tPi = 0;
const editBtnAt = () => dayBodies()[tDay].querySelectorAll('.place-item .place-edit')[tPi];
assert('每个条目带编辑按钮', document.querySelectorAll('.place-item .place-edit').length === document.querySelectorAll('.place-item').length);
const pTarget = ITEST.TRIP.days[tDay].places[tPi];
const flyBeforeEdit = callLog.filter(c => c[0] === 'flyTo').length;
editBtnAt().dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert('点击编辑打开表单', document.getElementById('add-form-backdrop').classList.contains('open'));
assert('编辑不触发地图 flyTo', callLog.filter(c => c[0] === 'flyTo').length === flyBeforeEdit);
assert('编辑表单预填名称', document.getElementById('af-name').value === pTarget.name);
assert('编辑表单预填时间', document.getElementById('af-time').value === (pTarget.time || ''));
assert('编辑表单预填交通/门票/备注', document.getElementById('af-transport').value === (pTarget.transport || '')
  && document.getElementById('af-ticket').value === (pTarget.ticket || '')
  && document.getElementById('af-note').value === (pTarget.note || ''));
assert('编辑模式显示更改位置按钮', document.getElementById('af-repick-wrap').style.display === '');
assert('编辑模式隐藏天下拉', document.getElementById('af-day-wrap').style.display === 'none');
assert('确认按钮文案切换为保存修改', document.getElementById('af-ok').textContent === '保存修改');
assert('编辑模式确定按钮启用(名称已填)', document.getElementById('af-ok').disabled === false);

/* 空修改不进历史 */
const hLenNoop = ITEST.history().len;
document.getElementById('af-ok').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert('空修改保存后表单关闭', !document.getElementById('add-form-backdrop').classList.contains('open'));
assert('空修改不进历史栈', ITEST.history().len === hLenNoop);

/* 修改字段并保存 */
editBtnAt().dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const hLenEdit = ITEST.history().len;
const origTime = ITEST.TRIP.days[tDay].places[tPi].time;   /* 值快照：条目对象是活引用，保存后会被写入污染 */
const origNote = ITEST.TRIP.days[tDay].places[tPi].note || '';
document.getElementById('af-time').value = '10:00-12:00';
document.getElementById('af-note').value = '已修改备注';
document.getElementById('af-ok').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert('修改字段保存写回 TRIP', ITEST.TRIP.days[tDay].places[tPi].time === '10:00-12:00' && ITEST.TRIP.days[tDay].places[tPi].note === '已修改备注');
assert('编辑进历史栈(帧数 +1)', ITEST.history().len === hLenEdit + 1);
assert('编辑未改动坐标', ITEST.TRIP.days[tDay].places[tPi].lat === pTarget.lat && ITEST.TRIP.days[tDay].places[tPi].lng === pTarget.lng);
ITEST.undo();
assert('撤销恢复编辑前字段', ITEST.TRIP.days[tDay].places[tPi].time === origTime && ITEST.TRIP.days[tDay].places[tPi].note === origNote);
ITEST.redo();
assert('重做恢复编辑后字段', ITEST.TRIP.days[tDay].places[tPi].time === '10:00-12:00');

/* 更改位置（编辑表单 → repick 选点） */
const hLenPick = ITEST.history().len;
const curP = ITEST.TRIP.days[tDay].places[tPi];
const oldLat = curP.lat, oldLng = curP.lng;
editBtnAt().dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
document.getElementById('af-repick').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert('更改位置关闭表单并进入选点模式', !document.getElementById('add-form-backdrop').classList.contains('open') && document.body.classList.contains('picking'));
assert('选点提示切换为新位置文案', document.getElementById('pick-hint').textContent.includes('新位置'));
global.L._map.fire('click', { latlng: { lat: oldLat + 0.01, lng: oldLng + 0.01 } });
assert('选点后退出选点模式', !document.body.classList.contains('picking'));
assert('新坐标写回 TRIP(1e-6 取整)', ITEST.TRIP.days[tDay].places[tPi].lat === Math.round((oldLat + 0.01) * 1e6) / 1e6);
assert('更改位置进历史栈(帧数 +1)', ITEST.history().len === hLenPick + 1);
ITEST.undo();
assert('撤销恢复原坐标', ITEST.TRIP.days[tDay].places[tPi].lat === oldLat && ITEST.TRIP.days[tDay].places[tPi].lng === oldLng);
ITEST.redo();
assert('重做恢复新坐标', ITEST.TRIP.days[tDay].places[tPi].lat === Math.round((oldLat + 0.01) * 1e6) / 1e6);

/* Esc 中断 repick 不留残留状态 */
editBtnAt().dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
document.getElementById('af-repick').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
assert('Esc 退出选点模式', !document.body.classList.contains('picking'));
document.getElementById('btn-add').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
assert('残留清理后选点提示为默认文案', document.getElementById('pick-hint').textContent.includes('选择地点位置'));
global.L._map.fire('click', { latlng: { lat: 30.10, lng: 100.20 } });
assert('Esc 后重新选点走新增表单(非 repick)', document.getElementById('add-form-backdrop').classList.contains('open'));
document.getElementById('af-cancel').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

/* 新增表单：时间/交通/门票全字段写入 */
document.getElementById('btn-add').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
global.L._map.fire('click', { latlng: { lat: 30.70, lng: 104.10 } });
document.getElementById('af-name').value = '全字段新增点';
document.getElementById('af-time').value = '上午 09:00-12:00';
document.getElementById('af-transport').value = '地铁';
document.getElementById('af-ticket').value = '免费';
document.getElementById('af-note').value = '预设字段测试';
document.getElementById('af-name').dispatchEvent(new window.Event('input', { bubbles: true }));
document.getElementById('af-ok').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const full = ITEST.TRIP.days[0].places[ITEST.TRIP.days[0].places.length - 1];
assert('新增全字段写入 TRIP', full.name === '全字段新增点' && full.time === '上午 09:00-12:00' && full.transport === '地铁' && full.ticket === '免费' && full.note === '预设字段测试');
const exFull = JSON.parse(ITEST.buildExportJSON());
assert('全字段数据进入导出 JSON', exFull.days[0].places.some(p => p.name === '全字段新增点' && p.ticket === '免费'));

process.exit(fail ? 1 : 0);