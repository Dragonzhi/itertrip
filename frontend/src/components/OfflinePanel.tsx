import { useEffect, useState } from 'react';
import { applyUpdate, clearOffline, installApp, prepareOffline, startOffline, useOffline } from '../lib/offline';
import { routeSaveStatus } from '../lib/settings';

/** Inline in the itinerary, so it stays reachable without covering mobile controls.
 * quiet 变体（首页/行程抽屉）：常态的联网/准备状态不值得一张卡 —— 状态并进 summary
 * 一行（既是入口也是状态），卡片壳与独立状态行只留给设置面板；
 * 需要注意的事（保存失败 / 有更新 / 出错）仍然主动可见（M28 契约：离线口径与准备结果不静默）。 */
export default function OfflinePanel({ blocked = false, quiet = false }: { blocked?: boolean; quiet?: boolean }) {
  const s = useOffline();
  const [saved, setSaved] = useState(routeSaveStatus);
  useEffect(() => {
    startOffline();
    const read = () => setSaved(routeSaveStatus());
    window.addEventListener('itertrip:route-saved', read);
    window.addEventListener('storage', read);
    return () => { window.removeEventListener('itertrip:route-saved', read); window.removeEventListener('storage', read); };
  }, []);
  const canUpdate = !blocked && !saved.failed;
  const status = !s.online
    ? `当前离线 · 可以手工编辑 · ${s.ready ? '应用文件已准备' : '离线文件未准备完整'}`
    : (s.ready ? '应用文件已准备' : '离线文件未准备完整');
  return <section className={quiet ? 'offline-panel offline-panel-quiet' : 'offline-panel'} aria-label="离线与安装" data-testid="offline-panel">
    {!quiet && <p role="status" className="font-semibold">{s.online ? '在线' : '当前离线 · 可以手工编辑'} · {s.ready ? '应用文件已准备' : '离线文件未准备完整'}</p>}
    {saved.failed && <p role="alert" className="text-danger">行程保存失败，修改仅在当前页面；请导出 JSON 备份，暂勿刷新。</p>}
    <details>
      <summary className="min-h-11 flex items-center cursor-pointer focus-ring">{quiet ? <><span aria-hidden className="mr-1.5">🧳</span>随身行程 · {status}</> : '随身行程 · 安装与离线设置'}</summary>
      <p>{saved.at ? `行程保存于 ${new Date(saved.at).toLocaleString('zh-CN')}` : saved.exists ? '已有本地行程（旧记录没有保存时间）' : '尚无本地行程，先生成或导入路线'}</p>
      <p>{s.preparedAt ? `应用文件准备于 ${new Date(s.preparedAt).toLocaleString('zh-CN')}` : '联网打开正式版并等待准备完成后，再断网重开。'}{s.version ? ` · 版本 ${s.version.slice(0, 8)}` : ''}</p>
      <p>离线保留当前行程、预约、交通快照与出行进度。AI、信息搜索、HTML 导出和地图底图需要网络；JSON 可随时备份。外部导航取决于地图 App 的网络与离线地图。</p>
      {!s.supported && <p>离线启动需 HTTPS 或本机 localhost 的正式构建；开发预览或此浏览器暂不支持。</p>}
      <div className="flex flex-wrap gap-2 my-2">
        {s.supported && <button className="nav-secondary" disabled={s.busy || !s.online} onClick={() => void prepareOffline()}>{s.busy ? '处理中…' : '准备离线文件'}</button>}
        {s.supported && <button className="nav-secondary" disabled={s.busy} onClick={() => {
          if (window.confirm('仅清理应用离线文件；行程、进度和模型设置会保留。清理后需联网重新准备，才能离线启动。')) void clearOffline();
        }}>清理离线文件</button>}
        {s.installable && <button className="nav-primary" onClick={() => void installApp()}>添加到手机桌面</button>}
      </div>
      {!s.installed && !s.installable && <p>Android：浏览器菜单中的「安装应用／添加到主屏幕」。iPhone：Safari 的「分享 → 添加到主屏幕」；入口取决于浏览器版本。</p>}
      {s.installed && <p>正在使用已安装的随身行程。</p>}
    </details>
    {s.update && <div className="mt-2"><p>有新版本可用。{!canUpdate ? '请先保存或取消表单，结束当前请求，并确认行程已保存。' : '更新会重新打开当前行程，当前页面的撤销历史将重置。'}</p><button className="nav-primary mt-2" disabled={s.busy || !canUpdate} onClick={() => void applyUpdate()}>更新并重新打开</button></div>}
    {s.error && <p role="alert" className="text-danger">{s.error}</p>}
  </section>;
}
