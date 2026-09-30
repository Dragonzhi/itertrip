/* Execute the production worker in a deterministic Fetch/Cache harness; no browser or live network. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const origin = 'https://itertrip.test';
export const code = await fs.readFile('dist/sw.js', 'utf8');
export const config = JSON.parse(code.match(/const CONFIG = (.*);/)[1]);
export const storage = new Map();
export const network = { online: true, calls: [], broken: '', htmlFallback: '' };
const key = r => typeof r === 'string' ? r : r.url;
export async function resource(req) {
  const url = new URL(key(req), origin);
  network.calls.push({ url: url.href, credentials: req.credentials });
  if (!network.online || url.pathname === network.broken) throw new TypeError('offline/resource failure');
  if (url.pathname === network.htmlFallback) return new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } });
  const rel = url.pathname.slice(config.base.length);
  try {
    const bytes = await fs.readFile(path.join('dist', rel));
    const type = rel.endsWith('.html') ? 'text/html' : rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.css') ? 'text/css' : rel.endsWith('.png') ? 'image/png' : 'application/json';
    return new Response(bytes, { headers: { 'Content-Type': type } });
  } catch { return new Response('missing', { status: 404 }); }
}
const caches = {
  async keys() { return [...storage.keys()]; },
  async delete(name) { return storage.delete(name); },
  async open(name) {
    if (!storage.has(name)) storage.set(name, new Map());
    const map = storage.get(name);
    return {
      async match(req) {
        const entry = map.get(key(req));
        return entry ? new Response(entry.body.slice(0), { status: entry.status, headers: entry.headers }) : undefined;
      },
      async put(req, resp) { map.set(key(req), { body: await resp.arrayBuffer(), status: resp.status, headers: [...resp.headers] }); },
      async addAll(requests) {
        const responses = await Promise.all(requests.map(resource));
        assert.ok(responses.every(r => r.ok));
        for (let i = 0; i < requests.length; i++) map.set(key(requests[i]), { body: await responses[i].arrayBuffer(), status: responses[i].status, headers: [...responses[i].headers] });
      },
    };
  },
};
export function worker(source = code) {
  const handlers = new Map(), notices = [];
  const self = { location: { origin }, clients: { claim: async () => notices.push('claim'), matchAll: async () => [{ postMessage: m => notices.push(m) }] }, skipWaiting: async () => notices.push('skipWaiting'), addEventListener: (type, fn) => handlers.set(type, fn) };
  vm.runInNewContext(source, { self, caches, fetch: resource, URL, Request, Response, Promise, Date });
  return {
    notices,
    async lifecycle(type) { let pending; handlers.get(type)({ waitUntil: p => { pending = p; } }); await pending; },
    async message(type) {
      let pending, result;
      handlers.get('message')({ data: { type }, ports: [{ postMessage: value => { result = value; } }], waitUntil: p => { pending = p; } });
      await pending; return result;
    },
    fetch(url, init = {}) {
      let response;
      const request = { url: new URL(url, origin).href, method: 'GET', mode: 'cors', headers: new Headers(), ...init };
      handlers.get('fetch')({ request, respondWith: p => { response = p; } });
      return response; // undefined proves worker bypass, not a fake network response
    },
  };
}
export async function verifyWorker() {
  assert.equal(config.base, '/itertrip/');
  assert.ok(config.files.includes('/itertrip/index.html'));
  assert.ok(config.files.some(f => f.endsWith('.js')) && config.files.some(f => f.endsWith('.css')));
  assert.ok(!config.files.some(f => /api|sw\.js|\.map$/.test(f)));
  const manifest = JSON.parse(await fs.readFile('dist/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './'); assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const bytes = await fs.readFile('dist/' + icon.src);
    const n = Number(icon.sizes.split('x')[0]);
    assert.equal(bytes.readUInt32BE(16), n); assert.equal(bytes.readUInt32BE(20), n);
  }
  const first = worker();
  network.broken = config.files.find(f => f.endsWith('.css'));
  await assert.rejects(first.lifecycle('install'));
  assert.equal((await first.message('STATUS')).ready, false, 'partial install is never ready');
  network.broken = '';
  network.htmlFallback = config.files.find(f => f.endsWith('.js'));
  await assert.rejects(first.lifecycle('install'));
  assert.equal((await first.message('STATUS')).ready, false, 'HTML pretending to be JS is not an offline shell');
  network.htmlFallback = '';
  const before = network.calls.length;
  await Promise.all([first.message('PREPARE'), first.message('PREPARE')]);
  assert.equal(network.calls.length - before, config.files.length, 'concurrent preparation is deduplicated');
  await first.lifecycle('install');
  assert.equal((await first.message('STATUS')).ready, true);
  assert.ok(network.calls.every(r => r.credentials === 'omit'), 'precaching never uses credentials');
  await caches.open('another-site-private-cache');
  await first.lifecycle('activate');
  assert.ok(storage.has('another-site-private-cache'));
  assert.ok(!first.notices.includes('skipWaiting'), 'install never forces activation');
  network.online = false;
  const reopened = worker(); // worker memory is gone; only CacheStorage survives
  const shell = await reopened.fetch('/itertrip/', { mode: 'navigate' });
  assert.ok((await shell.text()).includes('id="root"'));
  for (const file of config.files) assert.ok((await reopened.fetch(file)).ok);
  for (const url of ['/api/health', '/itertrip/api/health', '/itertrip/admin', '/itertrip/private.json', '/itertrip/?token=test', 'https://tile.openstreetmap.org/0/0/0.png']) assert.equal(reopened.fetch(url, { mode: 'navigate' }), undefined, 'bypass ' + url);
  assert.equal(reopened.fetch('/itertrip/', { method: 'POST', mode: 'navigate' }), undefined);
  for (const name of ['Authorization', 'X-LLM-Key', 'X-Admin-Token', 'X-Traveler-Id']) assert.equal(reopened.fetch('/itertrip/index.html', { headers: new Headers({ [name]: 'test-secret' }) }), undefined);
  assert.equal(network.calls.filter(c => /api|private|test-secret/.test(c.url)).length, 0);
  const next = worker(code.replace(config.version, config.version + '-next'));
  network.online = true; await next.lifecycle('install');
  assert.equal((await reopened.message('STATUS')).ready, true, 'waiting install preserves active shell');
  assert.ok(!next.notices.includes('skipWaiting'));
  await next.message('APPLY_UPDATE'); assert.ok(next.notices.includes('skipWaiting'));
  await next.lifecycle('activate'); assert.equal(storage.size, 2, 'old shell cleaned, unrelated cache kept');
  await next.message('CLEAR'); assert.ok(![...storage.keys()].some(k => k.startsWith('itertrip-shell:')));
  assert.ok(storage.has('another-site-private-cache'));
  assert.equal((await next.message('APPLY_UPDATE')).ok, false, 'cannot activate missing shell');
  network.online = false; assert.equal((await next.message('PREPARE')).ok, false);
  assert.equal((await next.message('STATUS')).ready, false);
  network.online = true; await first.message('PREPARE');
  console.log('M28 worker: install failure, cache completeness, dedup, cold restart, privacy bypass, explicit update and scoped clear passed');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await verifyWorker();
