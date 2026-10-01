/* Forecast windows and bounded local changes. Shared by app/export; no LLM or I/O. */
(function (root) {
  'use strict';
  const S = root.IterTripSchedule, T = root.IterTripTransport;
  const clone = x => JSON.parse(JSON.stringify(x));
  const labels = {indoor:'室内', outdoor:'室外', mixed:'室内外混合（待确认避雨区域）', unknown:'未知（待确认）'};
  const stamp = s => typeof s === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(s) ? Date.parse(s) : NaN;
  function policy(route) {
    const p = route.weather_policy || {};
    return {probability: Number.isFinite(p.probability) && p.probability >= 1 && p.probability <= 100 ? p.probability : 60, precipitation_mm: Number.isFinite(p.precipitation_mm) && p.precipitation_mm >= .1 && p.precipitation_mm <= 100 ? p.precipitation_mm : .5};
  }
  function exposure(p) {
    const e = p.weather_exposure;
    if (!e || e.source !== 'user' || e.place_name !== p.name || !Number.isFinite(stamp(e.confirmed_at)) || stamp(e.confirmed_at) > Date.now()+60000) return 'unknown';
    return Object.hasOwn(labels,e.environment) ? e.environment : 'unknown';
  }
  function forecast(route, point) {
    if (!T.usable(point)) return {reason:'地点坐标未确认，未匹配天气'};
    // Weather is a regional grid, not a street forecast. GCJ offset is below this 3 km radius.
    const distance = f => Math.hypot((f.lat-point.lat)*111, (f.lng-point.lng)*111*Math.cos(point.lat*Math.PI/180));
    const matches = (Array.isArray(route.weather) ? route.weather : []).filter(f => f && Number.isFinite(f.lat) && Number.isFinite(f.lng) && distance(f) <= 3).sort((a,b) => stamp(b.queried_at)-stamp(a.queried_at) || distance(a)-distance(b));
    const f = matches[0];
    if (!f) return {reason:'缺少此地点区域的天气数据'};
    if (!['qweather','open_meteo'].includes(f.provider) || !S.url(f.source_url) || f.kind !== 'forecast') return {reason:'历史天气或来源未知，不用于未来判断', value:f};
    if (f.timezone !== 'Asia/Shanghai') return {reason:'天气时区不匹配', value:f};
    if (f.granularity !== 'hourly') return {reason:'只有每日天气，仅供当天建议，不能判断雨停时刻', value:f};
    if (!Number.isFinite(stamp(f.valid_from)) || !Number.isFinite(stamp(f.valid_to)) || stamp(f.valid_to)<=stamp(f.valid_from)) return {reason:'预报有效范围缺失或无效',value:f};
    if (f.refresh_error || !Number.isFinite(stamp(f.queried_at)) || stamp(f.queried_at) > Date.now()+60000 || Date.now()-stamp(f.queried_at) > 1800000) return {reason:'天气记录已过期或刷新失败，请联网刷新', value:f};
    if (f.issued_at && (!Number.isFinite(stamp(f.issued_at)) || stamp(f.issued_at) > Date.now()+60000 || Date.now()-stamp(f.issued_at) > 21600000)) return {reason:'预报发布时间过旧或无效', value:f};
    return {value:f};
  }
  function windowRisk(route, point, iso, start, end) {
    if (!iso || start == null || end == null || end < start) return {known:false, reason:'游览／交通时间未知'};
    if (end === start) return {known:true, risk:false, minutes:0};
    const f = forecast(route,point); if (f.reason) return {known:false, reason:f.reason};
    const from = Date.parse(iso+'T00:00:00+08:00')+start*60000, to = Date.parse(iso+'T00:00:00+08:00')+end*60000;
    if (from < Date.now()) return {known:false, reason:'过去时段不作为未来天气评估'};
    if (from < stamp(f.value.valid_from) || to > stamp(f.value.valid_to)) return {known:false, reason:'行程时段超出实际预报范围'};
    const p = policy(route); let cursor = from, minutes = 0, maxProbability = 0, maxAmount = 0;
    const hours = (Array.isArray(f.value.hours) ? f.value.hours : []).filter(h => h && stamp(h.end)>from && stamp(h.start)<to).sort((a,b)=>stamp(a.start)-stamp(b.start));
    for (const h of hours) {
      const a = stamp(h.start), b = stamp(h.end);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b-a !== 3600000 || a>cursor || a<cursor && cursor!==from || !Number.isFinite(h.probability) || h.probability<0 || h.probability>100 || !Number.isFinite(h.precipitation_mm) || h.precipitation_mm<0) return {known:false, reason:'逐小时预报有缺口、重叠或降水值缺失'};
      const n = Math.max(0,Math.min(b,to)-Math.max(a,from))/60000;
      if (h.probability>=p.probability || h.precipitation_mm>=p.precipitation_mm) minutes+=n;
      maxProbability=Math.max(maxProbability,h.probability); maxAmount=Math.max(maxAmount,h.precipitation_mm); cursor=Math.min(b,to);
    }
    if (cursor<to) return {known:false, reason:'逐小时预报未覆盖完整时段'};
    return {known:true, risk:minutes>0, minutes, probability:maxProbability, precipitation_mm:maxAmount};
  }
  function assess(route, di, completed=[]) {
    const day=route.days[di], r=S.calculate(route,di,completed), items=[], unknown=[];
    const add=(point,start,end,label)=>{
      const v=windowRisk(route,point,r.date,start,end);
      if (!v.known) unknown.push(`${point.name} · ${label}：${v.reason}`);
      else if (v.risk) items.push({id:point.id, name:point.name, label, start, end, minutes:v.minutes, probability:v.probability, precipitation_mm:v.precipitation_mm});
    };
    if (route.trip.date_source!=='user') unknown.push('请先确认出发日期，再评估天气');
    day.places.forEach(p=>{
      if (p.visit?.completed || completed.includes(p.id)) return;
      const row=r.rows.find(v=>v.id===p.id), env=exposure(p);
      if (!['indoor','outdoor'].includes(env)) unknown.push(`${p.name}：${labels[env]}，不能自动视为安全室内`);
      else if (env==='outdoor' && p.weather_exposure.rain_sensitive!==false) add(p,row?.arrival,row?.departure,'室外游览／等待');
    });
    for (const edge of T.legs(route,di)) {
      if (edge.to.visit?.completed || completed.includes(edge.to.id)) continue;
      const s=T.selected(day,edge), row=r.rows.find(v=>v.id===edge.to.id);
      if (!s.known || !Number.isFinite(s.option.walking_m)) { unknown.push(`${edge.from.name} → ${edge.to.name}：交通／室外步行信息未知`); continue; }
      if (s.option.walking_m<=0) continue;
      // Walking transfer timing is not supplied by Amap: conservatively assess the full leg at both endpoints.
      const end=row?.arrival, start=end==null?null:end-Math.ceil(s.option.duration_s/60)-(s.segment?.buffer_min||0);
      add(edge.from,start,end,'交通步行（起点区域，整段保守评估）'); add(edge.to,start,end,'交通步行（终点区域，整段保守评估）');
      if (Math.hypot((edge.from.lat-edge.to.lat)*111,(edge.from.lng-edge.to.lng)*111)>10) unknown.push(`${edge.from.name} → ${edge.to.name}：长距离沿途天气未覆盖，仅查了两端区域`);
    }
    return {date:r.date, items, unknown:[...new Set(unknown)], riskMinutes:items.reduce((n,v)=>n+v.minutes,0), label:unknown.length?'天气未完整评估':items.length?`${items.length} 处降水风险`:'已评估时段未触发降水阈值'};
  }
  function candidates(route, di, completed=[]) {
    const result=[], movable=p=>!S.fixed(p,completed) && !p.visit?.completed;
    const emit=(r,title,days,rank)=>{T.normalize(r,route); S.refreshClosures(r); result.push({route:r,title,days,rank});};
    const start=S.clock(route.days[di].schedule?.start);
    if (start!=null && !route.days[di].places.some(p=>p.visit?.completed || completed.includes(p.id))) for (const delta of [-60,-120,-180,60,120,180]) {
      const value=start+delta;
      if (value<0 || value>=S.clock(route.days[di].schedule?.end)) continue;
      const r=clone(route); r.days[di].schedule.start=S.fmt(value); emit(r,`D${di+1} 开始 ${S.fmt(start)} → ${S.fmt(value)}`,[di],0);
    }
    const ps=route.days[di].places;
    let count=0;
    for (let a=0;a<ps.length && count<4;a++) for (let b=a+1;b<ps.length && count<4;b++) if (movable(ps[a]) && movable(ps[b]) && (exposure(ps[a])==='outdoor' || exposure(ps[b])==='outdoor')) {
      const r=clone(route); [r.days[di].places[a],r.days[di].places[b]]=[r.days[di].places[b],r.days[di].places[a]]; emit(r,`D${di+1} 交换「${ps[a].name}」与「${ps[b].name}」`,[di],1); count++;
    }
    count=0;
    for (const other of [di+1,di-1].filter(i=>route.days[i])) for (let a=0;a<ps.length && count<2;a++) for (let b=0;b<route.days[other].places.length && count<2;b++) {
      const p=ps[a],q=route.days[other].places[b];
      if (!movable(p) || !movable(q) || exposure(p)!=='outdoor' || exposure(q)!=='indoor') continue;
      const r=clone(route); [r.days[di].places[a],r.days[other].places[b]]=[r.days[other].places[b],r.days[di].places[a]];
      emit(r,`D${di+1}「${p.name}」与 D${other+1}「${q.name}」交换`,[di,other],2); count++;
    }
    return result;
  }
  function validate(original,candidate,days,completed=[]) {
    const reasons=[], oldPoints=original.days.flatMap(d=>[...d.places,...(d.hotel?[d.hotel]:[])]), newPoints=candidate.days.flatMap(d=>[...d.places,...(d.hotel?[d.hotel]:[])]);
    if (JSON.stringify(oldPoints.map(p=>p.id).sort())!==JSON.stringify(newPoints.map(p=>p.id).sort())) reasons.push('必须保留原地点、酒店与访问次数');
    for (const p of oldPoints) {
      const q=newPoints.find(q=>q.id===p.id);
      if (!q || JSON.stringify([p.name,p.lat,p.lng,p.visit,p.opening,p.weather_exposure])!==JSON.stringify([q.name,q.lat,q.lng,q.visit,q.opening,q.weather_exposure])) reasons.push(`「${p.name}」的原信息或预约发生变化`);
    }
    original.days.forEach((d,i)=>[...d.places,...(d.hotel?[d.hotel]:[])].forEach((p,j)=>{
      if (!S.fixed(p,completed)) return;
      const q=[...candidate.days[i].places,...(candidate.days[i].hotel?[candidate.days[i].hotel]:[])][j];
      const before=S.calculate(original,i,completed).rows.find(v=>v.id===p.id), after=S.calculate(candidate,i,completed).rows.find(v=>v.id===p.id);
      if (q?.id!==p.id || before?.start!==after?.start || before?.departure!==after?.departure) reasons.push(`「${p.name}」固定／已完成时段不能改变`);
    }));
    let beforeRisk=0, afterRisk=0;
    for (const di of days) {
      const planned=S.calculate(candidate,di,completed), before=assess(original,di,completed), after=assess(candidate,di,completed);
      reasons.push(...planned.issues.map(v=>v.text), ...planned.unknown.map(v=>v.text), ...after.unknown);
      beforeRisk+=before.riskMinutes; afterRisk+=after.riskMinutes;
      if (after.riskMinutes>before.riskMinutes) reasons.push(`D${di+1} 降水风险增加`);
    }
    if (afterRisk>=beforeRisk) reasons.push('候选没有减少已知降水暴露');
    return {ok:!reasons.length, reasons:[...new Set(reasons)], beforeRisk, afterRisk};
  }
  function delta(original,candidate,days) {
    const sum=r=>days.map(di=>T.summary(r,di)).reduce((a,b)=>({total:a.total+b.total,known:a.known+b.known,seconds:a.seconds+b.seconds,walkKnown:a.walkKnown+b.walkKnown,walking:a.walking+b.walking,feeKnown:a.feeKnown+b.feeKnown,fees:a.fees+b.fees}),{total:0,known:0,seconds:0,walkKnown:0,walking:0,feeKnown:0,fees:0});
    const a=sum(original),b=sum(candidate);
    return {minutes:a.known===a.total && b.known===b.total?(b.seconds-a.seconds)/60:null,walking:a.walkKnown===a.total && b.walkKnown===b.total?b.walking-a.walking:null,fees:a.feeKnown===a.total && b.feeKnown===b.total?b.fees-a.fees:null};
  }
  root.IterTripWeather={labels,policy,exposure,forecast,windowRisk,assess,candidates,validate,delta};
})(globalThis);
