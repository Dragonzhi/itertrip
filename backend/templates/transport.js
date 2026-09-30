/* Read-only traffic snapshots work with and without Leaflet; no API/key in the export. */
(function () {
  const core = globalThis.IterTripTransport;
  let getTrip;
  const el = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const mins = s => Math.ceil(s / 60) + ' 分钟';
  function summary(container, di) {
    const s = core.summary(getTrip(), di);
    if (!s.total) return;
    const p = el('p', `交通快照：${s.known ? `已知 ${s.known}/${s.total} 段 ${mins(s.seconds)}` : '交通耗时未知'} · 额外缓冲 ${s.buffer} 分钟 · ${s.walkKnown ? `已知步行 ${(s.walking / 1000).toFixed(1)} km（${s.walkKnown}/${s.total} 段）` : '步行距离未知'} · ${s.feeKnown ? `费用小计 ¥${s.fees.toFixed(1)}（${s.feeKnown}/${s.total} 段，缺项未知）` : '费用未知'}`);
    p.style.cssText = 'font:12px/1.6 system-ui;padding:12px;background:#edf1e7;border-radius:12px';
    p.dataset.trafficSummary = di;
    container.append(p);
  }
  function leg(container, di, toId) {
    core.legs(getTrip(), di).filter(e => e.to.id === toId).forEach(edge => {
      const s = core.selected(getTrip().days[di], edge);
      const box = el('section', ''); box.dataset.testid = 'export-transport';
      box.dataset.trafficDay = di; box.dataset.trafficTo = toId;
      box.style.cssText = 'font:12px/1.6 system-ui;padding:12px;margin:8px 0;border:1px solid #d8dfd2;border-radius:12px;background:#fffdf7';
      box.append(el('strong', `↳ ${edge.from.name} → ${edge.to.name}`));
      box.append(el('p', s.known ? `${core.labels[s.mode]}约 ${mins(s.option.duration_s)} · ${s.option.distance_m == null ? '距离未知' : (s.option.distance_m / 1000).toFixed(1) + ' km'} · ${s.option.fee_yuan == null ? '费用未知' : (s.mode === 'car' ? '出租车参考 ¥' : '费用 ¥') + s.option.fee_yuan}` : `交通耗时未知 · ${s.stale ? '查询快照已过期' : s.option?.reason || '未查询或路线已变化'}`));
      if (s.option) {
        box.append(el('p', `高德路径服务 · ${s.option.queried_at} · ${s.stale ? '历史快照' : '查询时估算'}`));
        if (s.stale && s.option.status === 'ok') box.append(el('p', `历史查询耗时：${mins(s.option.duration_s)}（未计入当前汇总）`));
        const link = el('a', '高德路径接口依据'); link.href = 'https://lbs.amap.com/api/webservice/guide/api/direction'; link.target = '_blank'; link.rel = 'noopener noreferrer'; box.append(link);
      }
      if (s.known && s.mode === 'car') box.append(el('p', `道路收费：${s.option.tolls_yuan == null ? '未知' : '¥' + s.option.tolls_yuan}（另列）`));
      box.append(el('p', `另留 ${s.segment?.buffer_min || 0} 分钟缓冲。未来日期可能变化；驾车不含叫车等待、接驳，出租车报价与道路收费分开。`));
      container.append(box);
    });
  }
  function init(getter) {
    getTrip = getter; core.normalize(getTrip());
    if (typeof L === 'undefined') {
      const panel = document.querySelector('.it-nav-fallback');
      if (panel) getTrip().days.forEach((day, di) => { summary(panel, di); [...day.places, ...(day.hotel ? [day.hotel] : [])].forEach(p => leg(panel, di, p.id)); });
    }
    window.setInterval(() => {
      document.querySelectorAll('[data-traffic-summary]').forEach(old => {
        const holder = el('div', ''); summary(holder, Number(old.dataset.trafficSummary));
        if (holder.firstChild) old.replaceWith(holder.firstChild); else old.remove();
      });
      document.querySelectorAll('[data-traffic-to]').forEach(old => {
        const holder = el('div', ''); leg(holder, Number(old.dataset.trafficDay), old.dataset.trafficTo);
        if (holder.firstChild) old.replaceWith(holder.firstChild); else old.remove();
      });
    }, 60_000);
  }
  window.IterTripExportTransport = { init, summary, leg };
})();
