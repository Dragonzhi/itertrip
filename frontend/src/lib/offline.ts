import { useSyncExternalStore } from 'react';

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
type State = { online: boolean; supported: boolean; ready: boolean; preparedAt: string; version: string; update: boolean; installed: boolean; installable: boolean; busy: boolean; error: string };
let state: State = { online: typeof navigator === 'undefined' || navigator.onLine !== false, supported: false, ready: false, preparedAt: '', version: '', update: false, installed: false, installable: false, busy: false, error: '' };
const listeners = new Set<() => void>();
const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
let registration: ServiceWorkerRegistration | undefined;
let installPrompt: InstallPrompt | undefined;
let started = false;
let reloading = false;
const base = import.meta.env.BASE_URL || '/itertrip/';
export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
export function requireOnline() { if (!isOnline()) throw new Error('当前离线：此操作需要联网，已保存行程仍可查看和手工编辑。'); }
export function useOffline() {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state);
}
function message(worker: ServiceWorker | null | undefined, type: string): Promise<Partial<State>> {
  if (!worker) return Promise.reject(new Error('离线服务尚未就绪，请稍后重试。'));
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => { channel.port1.close(); reject(new Error('离线准备超时，请检查网络和可用空间后重试。')); }, type === 'PREPARE' ? 45_000 : 5_000);
    channel.port1.onmessage = event => {
      window.clearTimeout(timeout); channel.port1.close();
      const { ok, message: error, ...value } = event.data;
      if (!ok) reject(new Error(error)); else resolve(value);
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}
async function refresh() {
  if (!registration?.active) return;
  try { publish({ ...(await message(registration.active, 'STATUS')), update: !!registration.waiting }); }
  catch (e) { publish({ ready: false, error: String(e instanceof Error ? e.message : e) }); }
}
export function startOffline() {
  if (started) return;
  started = true;
  window.addEventListener('online', () => { publish({ online: true }); void refresh(); void registration?.update().catch(() => {}); });
  window.addEventListener('offline', () => publish({ online: false }));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e as InstallPrompt; publish({ installable: true }); });
  window.addEventListener('appinstalled', () => { installPrompt = undefined; publish({ installed: true, installable: false }); });
  publish({ installed: window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true });
  // Development HMR files must never be intercepted/cached. Test the production build.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext || !location.pathname.startsWith(base)) return;
  publish({ supported: true });
  navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'OFFLINE_CACHE_CLEARED') publish({ ready: false, preparedAt: '' }); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload(); // only the page whose user requested an update reloads
    else void refresh();
  });
  void navigator.serviceWorker.register(base + 'sw.js', { scope: base, updateViaCache: 'none' }).then(reg => {
    registration = reg;
    const watch = (worker: ServiceWorker | null) => worker?.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'installed') void refresh();
      if (worker.state === 'redundant') publish({ error: '离线版本准备失败，请检查网络和空间后重新打开正式版。' });
    });
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    void refresh();
    void navigator.serviceWorker.ready.then(() => refresh());
  }).catch(() => publish({ error: '离线服务注册失败，请检查 HTTPS、浏览器权限与部署路径。' }));
}
export async function prepareOffline() {
  if (state.busy) return;
  publish({ busy: true, error: '' });
  try { requireOnline(); publish(await message(registration?.active, 'PREPARE')); }
  catch (e) { publish({ error: e instanceof Error ? e.message : String(e) }); }
  finally { publish({ busy: false }); }
}
export async function clearOffline() {
  if (state.busy) return;
  publish({ busy: true, error: '' });
  try { await message(registration?.active, 'CLEAR'); publish({ ready: false, preparedAt: '' }); }
  catch (e) { publish({ error: e instanceof Error ? e.message : String(e) }); }
  finally { publish({ busy: false }); }
}
export async function applyUpdate() {
  if (!registration?.waiting || state.busy) return;
  publish({ busy: true, error: '' });
  try {
    reloading = true;
    await message(registration.waiting, 'APPLY_UPDATE');
  } catch (e) { reloading = false; publish({ busy: false, error: e instanceof Error ? e.message : String(e) }); }
}
export async function installApp() {
  if (!installPrompt) return;
  const prompt = installPrompt; installPrompt = undefined; publish({ installable: false });
  try { await prompt.prompt(); await prompt.userChoice; }
  catch { publish({ error: '安装入口未打开，请使用浏览器菜单添加到主屏幕。' }); }
}
