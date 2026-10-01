/* Pure local-time arithmetic, shared by the editor and standalone export. No model or network. */
(function (root) {
  const transport = root.IterTripTransport;
  const clock = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null;
  const date = s => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(s + 'T00:00:00Z');
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s ? d : null;
  };
  const dayDate = (route, di) => {
    const d = date(route.trip.start_date); if (!d) return '';
    d.setUTCDate(d.getUTCDate() + di); return d.toISOString().slice(0, 10);
  };
  const fmt = m => m == null ? '未知' : (m >= 1440 ? `+${Math.floor(m / 1440)}天 ` : '') + String(Math.floor(m % 1440 / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0');
  const url = s => { try { const u = new URL(s); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
  const fixed = (p, completed = []) => !!(p.visit?.locked || p.visit?.completed || completed.includes(p.id) || (p.visit?.reservation && p.visit.reservation.status !== 'cancelled'));
  function fact(point, iso) {
    if (!date(iso)) return { known: false, reason: '日期未知' };
    const wd = date(iso).getUTCDay() || 7;
    const facts = (point.opening || []).filter(f => date(f.valid_from) && date(f.valid_to) && f.valid_from <= iso && iso <= f.valid_to && (!(f.weekdays || []).length || f.weekdays.includes(wd)));
    if (!facts.length) return { known: false, reason: '缺少适用于当天的开放资料' };
    if (facts.some(f => f.place_name !== point.name)) return { known: false, reason: '资料所属地点未确认或地点名称已变化，请重新查阅' };
    // Even a conflicting unconfirmed record cannot be silently discarded.
    const values = facts.map(f => JSON.stringify([f.open || '', f.close || '', f.last_entry || '', f.entry_policy || (f.last_entry ? 'last_entry' : 'unknown'), !!f.closed, !!f.reservation_required]));
    if (new Set(values).size !== 1) return { known: false, conflict: true, reason: '来源对开放规则的记录冲突，请核对' };
    const f = facts[0];
    if (facts.some(f => !f.confirmed || !url(f.source_url) || !Number.isFinite(Date.parse(f.checked_at)) || Date.parse(f.checked_at) > Date.now() + 60_000)) return { known: false, reason: '来源／查验时间缺失或资料尚未确认' };
    if (!f.closed && (clock(f.open) == null || clock(f.close) == null || clock(f.close) <= clock(f.open) || (f.last_entry && (clock(f.last_entry) == null || clock(f.last_entry) < clock(f.open) || clock(f.last_entry) > clock(f.close))))) return { known: false, reason: '开放时段不完整或跨夜规则暂不支持' };
    return { known: true, value: f };
  }
  function calculate(route, di, completed = []) {
    const day = route.days[di]; const iso = dayDate(route, di);
    const issues = [], unknown = [], rows = [];
    const push = (to, text, id = '') => to.push({ id, text });
    let cursor = clock(day.schedule?.start), finish = clock(day.schedule?.end);
    if (!iso) push(unknown, '出发日期未知');
    else if (route.trip.date_source !== 'user') push(unknown, '出发日期为推断，请确认日历');
    if (cursor == null) push(unknown, '当天开始时间未设置');
    if (finish == null) push(unknown, '当天结束时间未设置');
    if ([...day.places, ...(day.hotel ? [day.hotel] : [])].some(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && (p.lat < 18 || p.lat > 54 || p.lng < 73 || p.lng > 135))) push(unknown, '境外／跨时区行程暂不支持准确日程评估');
    if (cursor != null && finish != null && finish <= cursor) push(issues, '当天结束时间必须晚于开始时间（首版不支持跨夜）');
    const edges = transport.legs(route, di), windows = [];
    const points = [...day.places, ...(day.hotel ? [day.hotel] : [])];
    points.forEach((p, pi) => {
      const hotel = pi === day.places.length;
      const visit = p.visit || {}, row = { id: p.id, name: p.name, hotel, arrival: cursor, start: cursor, departure: null, wait: 0, fixed: fixed(p, completed), issues: [], unknown: [], suggestions: [], fact: null };
      const warn = text => { row.issues.push(text); push(issues, `${p.name}：${text}`, p.id); };
      const missing = text => { row.unknown.push(text); push(unknown, `${p.name}：${text}`, p.id); };
      const incoming = edges.find(e => e.to.id === p.id);
      if (incoming) {
        const s = transport.selected(day, incoming);
        if (!s.known) { cursor = null; missing(s.stale ? '交通快照已过期，需刷新后评估' : '到此站的交通耗时未知'); }
        else if (cursor != null) cursor += Math.ceil(s.option.duration_s / 60) + (s.segment?.buffer_min || 0);
      }
      row.arrival = row.start = cursor;
      const train = visit.reservation?.type === 'train' && visit.reservation.status !== 'cancelled';
      const rule = hotel || visit.kind === 'rest' || train ? null : fact(p, iso);
      row.fact = rule;
      if (rule && !rule.known) { missing(rule.reason); cursor = null; if (rule.conflict) warn(rule.reason); }
      const f = rule?.known ? rule.value : null;
      if (f?.closed) { warn('当天不开放'); cursor = null; }
      if (f && !f.closed && !f.last_entry && f.entry_policy !== 'none') missing('最后入场规则未知');
      if (f && !f.closed && cursor != null) {
        if (cursor < clock(f.open)) { row.wait += clock(f.open) - cursor; cursor = clock(f.open); }
      }
      const r = visit.reservation;
      if (r && r.status !== 'cancelled') {
        const start = clock(r.start), end = clock(r.end);
        if (!date(r.date) || start == null || end == null || end <= start) missing('预约日期／时段不完整或跨夜');
        else {
          if (iso && r.date !== iso) warn(`预约日期 ${r.date} 与当天 ${iso} 不一致`);
          if (r.date === iso) windows.push({ start, end, p });
          if (r.date === iso && cursor != null) {
            if (cursor > start) {
              warn(`预计 ${fmt(cursor)} 可开始，赶不上固定时段 ${r.start}（迟 ${Math.ceil(cursor - start)} 分钟）`);
              if (train) { missing('已错过车次，后续时间需重新安排'); cursor = null; }
            }
            else { row.wait += start - cursor; cursor = start; }
          }
        }
        if (r.status !== 'confirmed') missing(r.status === 'needed' ? '需要预约，尚未办理' : '预约待确认');
        if (!url(r.url)) missing('预约入口未提供有效链接');
        if (train && (!date(r.date) || r.date !== iso || start == null || end == null || end <= start)) cursor = null;
      }
      if (f?.reservation_required && (!r || r.status !== 'confirmed')) warn('资料要求预约，目前没有已确认记录');
      row.start = cursor;
      const duration = visit.duration_min;
      if (hotel && duration == null) row.departure = cursor;
      else if (!Number.isFinite(duration) || duration < 0 || duration > 1440) {
        if (train && r.date === iso && clock(r.start) != null && clock(r.end) > clock(r.start) && cursor != null) cursor = row.departure = Math.max(cursor, clock(r.end));
        else { missing('停留时长未设置'); cursor = null; }
      }
      else {
        if (visit.duration_source !== 'user') missing('停留时长为估计，请确认');
        if (cursor != null) cursor += duration;
        row.departure = cursor;
      }
      if (r?.type === 'train' && r.status !== 'cancelled' && r.date === iso && clock(r.end) != null && row.start != null) {
        if (duration != null && duration < clock(r.end) - clock(r.start)) warn('设置的停留短于车次占用时段，仍按车次结束推进');
        cursor = row.departure = Math.max(row.departure ?? row.start, clock(r.end));
      }
      if (f && !f.closed && row.start != null) {
        if (f.last_entry && row.start > clock(f.last_entry)) warn(`预计入场 ${fmt(row.start)}，超过最后入场 ${f.last_entry}`);
        if (row.departure != null && row.departure > clock(f.close)) warn(`预计离开 ${fmt(row.departure)}，超过关闭 ${f.close}`);
      }
      if (r && r.status !== 'cancelled' && r.date === iso && clock(r.end) != null && row.departure != null && row.departure > clock(r.end)) warn(`停留超出预约结束 ${r.end}`);
      if (finish != null && row.departure != null && row.departure > finish) warn(`预计离开 ${fmt(row.departure)}，超过当天结束 ${fmt(finish)}`);
      // Existing M22 warnings are recomputed by refreshClosures, never treated as verified opening hours.
      (p.warnings || []).filter(w => w.startsWith('闭馆日：')).forEach(warn);
      if (row.issues.length) {
        if (duration > 0 && !row.fixed) row.suggestions.push('候选：缩短此前或本站停留；需重新检查所有时间约束');
        if (incoming) {
          const selected = transport.selected(day, incoming);
          const faster = ['walk', 'bus', 'car'].map(mode => transport.selected({ ...day, transport: (day.transport || []).map(s => s.to_id === p.id ? { ...s, mode } : s) }, incoming)).filter(s => s.known && selected.known && s.option.duration_s < selected.option.duration_s).sort((a, b) => a.option.duration_s - b.option.duration_s)[0];
          if (faster) row.suggestions.push(`候选：改用${transport.labels[faster.mode]}可少约 ${Math.floor((selected.option.duration_s - faster.option.duration_s) / 60)} 分钟交通；仍需重新检查`);
        }
        row.suggestions.push(row.fixed ? '固定／已完成站点保留；请调整之前的活动或手工修改预约' : '候选：移至其他日期；先核对新日期的开放、交通和预约');
      }
      rows.push(row);
    });
    windows.sort((a, b) => a.start - b.start).forEach((w, i, all) => {
      all.slice(0, i).filter(v => v.end > w.start).forEach(v => {
        const text = `固定时段与「${v.p.name}」重叠（${fmt(w.start)}–${fmt(Math.min(v.end, w.end))}）`;
        push(issues, `${w.p.name}：${text}`, w.p.id); rows.find(r => r.id === w.p.id)?.issues.push(text);
      });
    });
    rows.filter(r => r.issues.length && !r.suggestions.length).forEach(r => r.suggestions.push(r.fixed ? '固定／已完成站点保留；需调整之前的活动或手工修改预约' : '候选：手工调整时段或移至另一日，重新检查交通与开放资料'));
    return { date: iso, rows, issues, unknown, end: cursor, status: issues.length ? 'conflict' : unknown.length ? 'unassessed' : 'estimated', label: issues.length ? `${issues.length} 项时间冲突` : unknown.length ? `${unknown.length} 项未评估` : '当前输入下预计可行（交通为查询时估算）' };
  }
  function refreshClosures(route) {
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    route.days.forEach((day, di) => {
      const d = date(dayDate(route, di));
      day.places.forEach(p => {
        p.warnings = (p.warnings || []).filter(w => !w.startsWith('闭馆日：'));
        if (!d) return;
        const text = [p.time, p.ticket, p.note].filter(Boolean).join(' ');
        const regex = /(?:周|週|星期|礼拜|禮拜)\s*([一二三四五六日天])\s*(?:例行|固定)?\s*(?:闭馆|閉館|闭园|閉園|不开放|不開放|休馆|休館|休息|闭关|閉關)/g;
        for (const match of text.matchAll(regex)) {
          const tail = text.slice(Math.max(0, match.index - 8), match.index + match[0].length + 24);
          if (/(?:法定|节假日|節假日|黄金周|黃金周|国庆|國慶|长假|長假|假期)[^。；;\n]{0,16}?(?:除外|正常开放|正常開放|不休|照常|正常接待|另行通知)/.test(tail)) continue;
          const wd = match[1] === '天' ? '日' : match[1];
          if (wd === weekdays[d.getUTCDay()]) p.warnings.push(`闭馆日：${match[0]}，当天为周${wd}（D${day.day} · ${dayDate(route, di)}${route.trip.date_source === 'inferred' ? '，日期为推断' : ''}）`);
        }
      });
    }); return route;
  }
  function protect(previous, candidate, completed = []) {
    const next = transport.normalize(JSON.parse(JSON.stringify(candidate)), previous);
    const oldPoints = previous.days.flatMap(d => [...d.places, ...(d.hotel ? [d.hotel] : [])]);
    const reasons = [];
    previous.days.forEach((d, di) => {
      next.days[di] && Object.assign(next.days[di], { schedule: d.schedule, traffic_mode: d.traffic_mode, start_from_hotel: d.start_from_hotel, transport: d.transport });
      [...d.places, ...(d.hotel ? [d.hotel] : [])].forEach((p, pi) => {
        const all = next.days.flatMap((day, nd) => [...day.places.map((p, np) => ({ p, di: nd, pi: np, hotel: false })), ...(day.hotel ? [{ p: day.hotel, di: nd, pi: day.places.length, hotel: true }] : [])]);
        const n = all.find(n => n.p.id === p.id);
        const hotel = pi === d.places.length;
        if ((fixed(p, completed) || p.visit?.required) && (!n || n.hotel !== hotel || (fixed(p, completed) && (n.di !== di || (!hotel && n.pi !== pi) || JSON.stringify([p.name, p.lat, p.lng]) !== JSON.stringify([n.p.name, n.p.lat, n.p.lng]))))) reasons.push(`「${p.name}」为必去、固定预约或已完成站点，拒绝本次删除／移动`);
      });
    });
    next.days.forEach(d => [...d.places, ...(d.hotel ? [d.hotel] : [])].forEach(p => {
      const old = oldPoints.find(o => o.id === p.id);
      // Only the human editor can record/confirm structured arrangements and facts in M27.
      p.visit = old?.visit; p.opening = old?.opening; p.weather_exposure = old?.weather_exposure;
      (p.prices || []).forEach(quote => {
        const prior = (old?.prices || []).find(v => v.platform === quote.platform && v.price === quote.price && !!v.breakfast === !!quote.breakfast);
        ['source_url', 'queried_at', 'check_in', 'check_out', 'room', 'occupancy', 'cancellation', 'unit'].forEach(k => { quote[k] = prior?.[k] || ''; });
        quote.breakfast_known = !!prior?.breakfast_known;
      });
    }));
    next.trip.start_date = previous.trip.start_date; next.trip.date_source = previous.trip.date_source; next.trip.dates = previous.trip.dates;
    next.weather = previous.weather; next.weather_policy = previous.weather_policy;
    return { route: refreshClosures(transport.normalize(next, previous)), reasons };
  }
  function comparable(p, checkIn, checkOut) {
    return !!(date(checkIn) && date(checkOut) && checkOut > checkIn && p.check_in === checkIn && p.check_out === checkOut && p.room && p.occupancy && p.cancellation && p.breakfast_known === true && ['night', 'stay'].includes(p.unit) && url(p.source_url) && Number.isFinite(Date.parse(p.queried_at)) && Date.parse(p.queried_at) <= Date.now() + 60_000 && p.price > 0 && Number.isFinite(p.price));
  }
  function quoteGroup(p) { return JSON.stringify([p.check_in, p.check_out, p.room, p.occupancy, p.cancellation, p.unit, !!p.breakfast]); }
  root.IterTripSchedule = { clock, date, dayDate, fmt, url, fixed, fact, calculate, refreshClosures, protect, comparable, quoteGroup };
})(globalThis);
