/* Cold-load the actual Vite production JS from worker cache into offline jsdom.
   This checks application logic, not a browser's native worker/install UI. */
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { worker, config, network, verifyWorker, storage } from './m28-worker.mjs';
await import('../../shared/navigation.js');
await import('../../shared/transport.js');
const traffic = globalThis.IterTripTransport;
await verifyWorker();
const active = worker();
let online = false, apiCalls = [], mode = 'fail', applyCount = 0;
const waiting = { postMessage: (data, ports) => { if (data.type === 'APPLY_UPDATE') applyCount++; ports[0].postMessage({ ok: true }); } };
const controlListeners = new Map();
const reg = { active: { postMessage: (data, ports) => { void active.message(data.type).then(value => ports[0].postMessage(value)); } }, waiting, update: async () => {}, addEventListener() {} };
const errors = [];
const consoleOutput = new VirtualConsole();
consoleOutput.on('jsdomError', e => errors.push(e.message));
consoleOutput.on('error', e => errors.push(String(e?.stack || e)));
const pause = async () => { await new Promise(r => setTimeout(r, 30)); };
const until = async predicate => { const end=Date.now()+2500; while(!predicate() && Date.now()<end) await pause(); assert.ok(predicate(),'asynchronous worker operation did not settle'); };
async function open(savedEntries = []) {
  network.online = false;
  const restarted = worker();
  const response = await restarted.fetch('/itertrip/', { mode: 'navigate' });
  const html = await response.text();
  const js = html.match(/<script[^>]+src="([^"]+)"/)[1];
  const css = html.match(/<link[^>]+href="([^"]+\.css)"/)[1];
  assert.ok((await restarted.fetch(css)).ok);
  const script = await (await restarted.fetch(js)).text();
  const dom = new JSDOM(html, { url: 'https://itertrip.test/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: consoleOutput });
  const w = dom.window;
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => online });
  Object.defineProperty(w, 'isSecureContext', { value: true });
  Object.defineProperty(w.navigator, 'serviceWorker', { value: { register: async (url, options) => { assert.equal(url, '/itertrip/sw.js'); assert.equal(options.scope, '/itertrip/'); assert.equal(options.updateViaCache, 'none'); return reg; }, ready: Promise.resolve(reg), addEventListener: (type, fn) => controlListeners.set(type, fn) } });
  w.MessageChannel = class {
    constructor() { this.port1 = { onmessage: null, close() {} }; this.port2 = { postMessage: value => setTimeout(() => this.port1.onmessage?.({ data: value }), 0) }; }
  };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  class Observer { observe() {} unobserve() {} disconnect() {} }
  w.IntersectionObserver = w.ResizeObserver = Observer;
  w.SVGSVGElement.prototype.createSVGRect = () => ({});
  w.HTMLElement.prototype.scrollIntoView = w.HTMLElement.prototype.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  w.HTMLDialogElement.prototype.close = function() { this.open = false; };
  w.confirm = () => true;
  w.fetch = async (url, init) => {
    apiCalls.push({ url, init });
    if (mode === 'fail') throw new TypeError('network unavailable');
    const { edges } = JSON.parse(init.body);
    return new Response(JSON.stringify({ results: edges.map(e => ({ signature: e.signature, options: ['walk', 'bus', 'car'].map(mode => ({ mode, status: 'unknown', reason: 'provider offline' })) })), stats: { calls: 0, cache_hits: 0, reason: 'provider offline' } }), { headers: { 'Content-Type': 'application/json' } });
  };
  for (const [key, value] of savedEntries) w.localStorage.setItem(key, value);
  w.eval(script); await pause(); await pause();
  assert.equal(w.location.pathname, '/itertrip/', 'root access canonicalized without a backend redirect');
  return dom;
}
const source = new Date().toISOString();
const place = (id, name, lng) => ({ id, name, lat: 30.65, lng, type: 'attraction', source: 'user', confidence: 'high', note: '到北门集合；周一闭馆', visit: { duration_min: 60, duration_source: 'user' }, opening: [{ place_name: name, open: '08:00', close: '18:00', entry_policy: 'none', valid_from: '2026-10-01', valid_to: '2026-10-31', source_kind: 'user', source_url: 'https://example.org/opening', checked_at: source, confirmed: true }] });
const fixture = { trip: { title: '离线测试行程', destination: '成都', days: 1, start_date: '2026-10-06', date_source: 'user' }, days: [{ day: 1, schedule: { start: '08:00', end: '18:00' }, places: [place('a', '第一站', 104.06), place('b', '第二站', 104.07)] }] };
fixture.days[0].places[1].visit.reservation = { type: 'entry', date: '2026-10-06', start: '10:00', end: '12:00', status: 'confirmed', url: 'https://example.org/ticket' };
traffic.normalize(fixture);
fixture.days[0].transport = traffic.legs(fixture, 0).map(e => ({ from_id: e.from.id, to_id: e.to.id, buffer_min: 5, snapshot: { signature: traffic.sign(e), options: [{ mode: 'walk', status: 'ok', duration_s: 600, description: '测试记录，不是真实交通', source: 'amap', source_url: 'https://lbs.amap.com', queried_at: '2026-01-01T00:00:00Z' }] } }));
let dom = await open([['itertrip:route', JSON.stringify(fixture)], ['itertrip:llm', JSON.stringify({ baseUrl: '', apiKey: 'test-only-local-key', model: 'test' })]]);
let w = dom.window, d = w.document;
const text = () => d.body.textContent;
const saved = () => JSON.parse(w.localStorage.getItem('itertrip:route'));
const byText = (label, scope = d) => { const el = [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === label); assert.ok(el, label + ': ' + [...scope.querySelectorAll('button')].map(b=>b.textContent.trim()).join(' / ') + ' ERRORS: ' + errors.join(' | ')); return el; };
const click = async el => { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await pause(); };
const input = async (el, value) => { Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new w.Event('input', { bubbles: true })); await pause(); };
assert.ok(text().includes('当前离线') && text().includes('应用文件已准备'));
assert.ok(text().includes('预约') && text().includes('到北门集合'));
assert.ok(text().includes('离线快照') && text().includes('不用于当前排程'));
assert.equal(apiCalls.length, 0);
await input(d.querySelector('[aria-label="第1天开始时间"]'), '09:00');
assert.equal(saved().days[0].schedule.start, '09:00');
await click(byText('↩ 撤销')); assert.equal(saved().days[0].schedule.start, '08:00');
await click(byText('↪ 重做')); assert.equal(saved().days[0].schedule.start, '09:00');
await click(byText('安排／预约', d.querySelector('[data-key="d0-p0"]')));
assert.equal(byText('更新并重新打开').disabled, true, 'waiting worker cannot interrupt a form');
await click(byText('取消', d.querySelector('.schedule-editor')));
assert.equal(byText('更新并重新打开').disabled, false);
const stamp = saved().days[0].transport[0].snapshot.options[0].queried_at;
await click(byText('比较当天交通'));
assert.equal(apiCalls.length, 0, 'offline query is blocked before fetch');
assert.equal(saved().days[0].transport[0].snapshot.options[0].queried_at, stamp);
// OS says online, but server/network may still fail. Old records must survive both failed paths.
online = true; w.dispatchEvent(new w.Event('online')); await pause();
await click(byText('比较当天交通')); assert.equal(apiCalls.length, 1);
assert.equal(saved().days[0].transport[0].snapshot.options[0].queried_at, stamp);
mode = 'unknown'; await click(byText('比较当天交通')); assert.equal(apiCalls.length, 2);
assert.equal(saved().days[0].transport[0].snapshot.options[0].queried_at, stamp);
online = false; w.dispatchEvent(new w.Event('offline')); await pause();
// Offline calendar arithmetic does not hit the API, but does update closure conflicts and undo.
await click(d.querySelector('[data-testid="date-picker-trigger"]'));
await click(byText('5', d.querySelector('[data-testid="calendar-popup"]')));
assert.equal(saved().trip.start_date, '2026-10-05'); assert.ok(saved().days[0].places[0].warnings.some(v => v.startsWith('闭馆日：')));
await click(byText('↩ 撤销')); assert.equal(saved().trip.start_date, '2026-10-06');
assert.equal(apiCalls.length, 2);
// A successful route save must not be implied when localStorage rejects the new value.
const set = w.Storage.prototype.setItem;
w.Storage.prototype.setItem = function(k, v) { if (k === 'itertrip:route') throw new w.DOMException('quota', 'QuotaExceededError'); return set.call(this, k, v); };
await input(d.querySelector('[aria-label="第1天结束时间"]'), '19:00');
assert.ok(text().includes('行程保存失败')); assert.equal(byText('更新并重新打开').disabled, true);
assert.equal(saved().days[0].schedule.end, '18:00');
w.Storage.prototype.setItem = set;
await click(byText('↩ 撤销')); assert.ok(!text().includes('行程保存失败'));
await click(d.querySelector('[data-testid="outing-mode"]'));
await click(byText('完成这一站')); assert.ok(text().includes('下一站') && text().includes('第二站'));
const entries = () => Array.from({ length: w.localStorage.length }, (_, i) => { const k = w.localStorage.key(i); return [k, w.localStorage.getItem(k)]; });
let snapshot = entries();
dom.window.close();
// No live document remains. Start JS/CSS from cache with only saved browser storage.
dom = await open(snapshot); w = dom.window; d = w.document;
assert.ok(d.querySelector('[data-testid="outing-view"]'));
assert.ok(text().includes('第二站'));
assert.equal(saved().days[0].schedule.start, '09:00');
assert.equal(saved().days[0].places[1].visit.reservation.url, 'https://example.org/ticket');
assert.ok(text().includes('测试记录，不是真实交通'));
await click(d.querySelector('[data-testid="planning-mode"]'));
// Clear controls delete shell assets only; the unique itinerary, credentials and progress survive.
snapshot = entries();
await click(byText('清理离线文件'));
assert.deepEqual(entries(), snapshot);
assert.ok(text().includes('离线文件未准备完整'));
assert.ok(![...storage.keys()].some(k => k.startsWith('itertrip-shell:')));
online = true; network.online = true; w.dispatchEvent(new w.Event('online')); await pause();
await until(()=>!byText('准备离线文件').disabled);
await click(byText('准备离线文件')); await until(()=>text().includes('应用文件已准备'));
assert.equal(applyCount, 0, 'update is never automatic');
await click(byText('更新并重新打开')); assert.equal(applyCount, 1);
assert.deepEqual(entries(), snapshot);
assert.deepEqual(errors, []);
dom.window.close();
console.log('M28 production DOM: offline cold load, edits/undo/redo, appointments, stale transport, failed refresh preservation, offline date edits, quota warning, progress recovery, safe clear and explicit update passed');
