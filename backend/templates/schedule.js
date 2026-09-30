/* Same arithmetic as the app. Safe DOM rendering, no source credentials or remote queries. */
(function () {
  const core = globalThis.IterTripSchedule;
  let getTrip;
  const el = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  function link(box, value, title) {
    const href = core.url(value); if (!href) return;
    const a = el('a', title + ' ↗'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; box.append(a);
  }
  function box() { const b = el('section', ''); b.style.cssText = 'font:12px/1.65 system-ui;padding:12px;margin:10px 0;background:#fffdf7;border:1px solid #d8dfd2;border-radius:12px;overflow-wrap:anywhere'; return b; }
  function summary(container, di) {
    const r = core.calculate(getTrip(), di), day = getTrip().days[di];
    const b = box(); b.dataset.scheduleDay = di; b.dataset.testid = 'export-schedule-day';
    b.append(el('strong', `🕘 D${day.day} · ${r.date || '日期未知'} · ${r.label}`));
    b.append(el('p', `${day.start_from_hotel ? '离开酒店' : '首站开始'} ${day.schedule?.start || '未知'} → 当天结束 ${day.schedule?.end || '未知'} · Asia/Shanghai。交通为查询时估算，未来时段可能变化。`));
    if (!day.start_from_hotel) b.append(el('p', '开始时已到首站，不含出发地到首站交通。'));
    r.issues.forEach(v => { const p = el('p', '⚠ ' + v.text); p.style.color = '#a43e3e'; b.append(p); });
    if (r.unknown.length) { const d = el('details', ''); d.append(el('summary', `未评估条件 ${r.unknown.length} 项`)); r.unknown.forEach(v => d.append(el('p', v.text))); b.append(d); }
    if (r.issues.length) b.append(el('p', '尚无已验证可行方案；修改后需重新评估，固定／已完成站点保持原位。'));
    container.append(b);
  }
  function visit(container, di, id) {
    const day = getTrip().days[di], point = [...day.places, ...(day.hotel ? [day.hotel] : [])].find(p => p.id === id);
    const r = core.calculate(getTrip(), di).rows.find(r => r.id === id); if (!r || !point) return;
    const b = box(); b.dataset.scheduleVisit = id; b.dataset.scheduleDi = di; b.dataset.testid = 'export-schedule-visit';
    b.append(el('strong', `${point.name}：${core.fmt(r.start)} → ${core.fmt(r.departure)}`));
    b.append(el('p', `到达 ${core.fmt(r.arrival)} · 等待 ${r.wait} 分钟 · ${point.visit?.duration_min == null ? '停留未知／酒店到达边界' : `停留 ${point.visit.duration_min} 分钟（${point.visit.duration_source === 'user' ? '用户设置' : '估计'}）`}${r.fixed ? ' · 固定／已完成' : ''}${point.visit?.required ? ' · 必去' : ''}`));
    const reservation = point.visit?.reservation;
    if (reservation) { b.append(el('p', `预约 ${reservation.date} ${reservation.start}–${reservation.end} · ${{needed:'待办理',pending:'待确认',confirmed:'用户记录已确认',cancelled:'已取消'}[reservation.status] || '未知'}`)); link(b, reservation.url, '提供的预约入口'); }
    if (r.fact?.known) {
      const f = r.fact.value;
      b.append(el('p', `用户查阅后记录：${f.closed ? '当天关闭' : `${f.open}–${f.close}，最后入场 ${f.last_entry || '未提供'}`} · 查验 ${f.checked_at} · 有效 ${f.valid_from}–${f.valid_to}`)); link(b, f.source_url, '开放资料来源');
    }
    r.issues.forEach(t => { const p = el('p', '⚠ ' + t); p.style.color = '#a43e3e'; b.append(p); });
    r.unknown.forEach(t => b.append(el('p', '未评估：' + t)));
    r.suggestions.forEach(t => b.append(el('p', t))); container.append(b);
  }
  function init(getter) {
    getTrip = getter; core.refreshClosures(getTrip());
    if (typeof L === 'undefined') {
      const panel = document.querySelector('.it-nav-fallback');
      if (panel) getTrip().days.forEach((d, di) => { summary(panel, di); [...d.places, ...(d.hotel ? [d.hotel] : [])].forEach(p => visit(panel, di, p.id)); });
    }
    window.setInterval(() => {
      document.querySelectorAll('[data-schedule-day]').forEach(old => { const holder = el('div',''); summary(holder, Number(old.dataset.scheduleDay)); old.replaceWith(holder.firstChild); });
      document.querySelectorAll('[data-schedule-visit]').forEach(old => { const holder = el('div',''); visit(holder, Number(old.dataset.scheduleDi), old.dataset.scheduleVisit); if (holder.firstChild) old.replaceWith(holder.firstChild); else old.remove(); });
    }, 60_000);
  }
  window.IterTripExportSchedule = {init, summary, visit};
})();
