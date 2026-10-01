/* Read-only forecast snapshots. No live service calls in portable exports. */
(function () {
  const W=globalThis.IterTripWeather, S=globalThis.IterTripSchedule;
  let getTrip;
  const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  function summary(container,di) {
    const route=getTrip(), r=W.assess(route,di), policy=W.policy(route), b=el('section','');
    b.dataset.weatherDay=di;b.dataset.testid='export-weather-day';b.style.cssText='font:12px/1.65 system-ui;padding:12px;margin:10px 0;background:#f6f8f0;border:1px solid #d8dfd2;border-radius:12px;overflow-wrap:anywhere';
    b.append(el('strong',`☂ D${di+1} · ${r.date || '日期未知'} · ${r.label}`));
    b.append(el('p',`便携文件只含上次预报；联网回到网站刷新。阈值：概率 ≥${policy.probability}% 或降水 ≥${policy.precipitation_mm} mm/h。区域估计不能保证不淋雨。`));
    route.days[di].places.forEach(p=>b.append(el('p',`${p.name} · ${W.labels[W.exposure(p)]}`)));
    r.items.forEach(v=>b.append(el('p',`⚠ ${v.name} · ${S.fmt(v.start)}–${S.fmt(v.end)} · ${v.label} · ${v.probability}%／${v.precipitation_mm} mm/h`)));
    if (r.unknown.length) {const d=el('details','');d.append(el('summary',`天气未评估条件 ${r.unknown.length} 项`));r.unknown.forEach(t=>d.append(el('p',t)));b.append(d);}
    const f=(Array.isArray(route.weather)?route.weather:[]).filter(f=>route.days[di].places.some(p=>W.forecast(route,p).value===f));
    for (const v of f) {
      b.append(el('p',`${v.provider} · WGS84区域 ${v.lat},${v.lng} · 读取 ${v.queried_at} · 发布 ${v.issued_at || '供应商未提供'} · ${v.timezone} · ${v.granularity} · ${v.valid_from} 至 ${v.valid_to}${v.refresh_error?' · 刷新失败：'+v.refresh_error:''}`));
      [v.source_url,...(Array.isArray(v.attributions)?v.attributions:[])].forEach(url=>{const href=S.url(url);if(!href)return;const a=el('a','预报来源／数据归属 ↗');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.style.marginRight='8px';b.append(a);});
    }
    container.append(b);
  }
  function init(getter) {
    getTrip=getter;
    if (typeof L==='undefined') {const panel=document.querySelector('.it-nav-fallback');if(panel)getTrip().days.forEach((d,i)=>summary(panel,i));}
    window.setInterval(()=>document.querySelectorAll('[data-weather-day]').forEach(old=>{const h=el('div','');summary(h,Number(old.dataset.weatherDay));old.replaceWith(h.firstChild);}),60000);
  }
  window.IterTripExportWeather={init,summary};
})();
