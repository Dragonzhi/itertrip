/* Route identity, adjacent transport legs and snapshot validation, shared with standalone exports. */
(function (root) {
  'use strict';
  const modes = ['walk', 'bus', 'car'];
  const labels = { walk: '步行', bus: '公交', car: '驾车' };
  const uid = () => root.crypto?.randomUUID?.() || 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const validId = x => typeof x === 'string' && /^[\w-]{1,80}$/.test(x);
  const pointKey = p => JSON.stringify([p.name, p.lat, p.lng]);
  function normalize(route, previous) {
    const seen = new Set(), old = (previous?.days || []).flatMap(d => [...d.places, ...(d.hotel ? [d.hotel] : [])]);
    const oldIds = new Set(old.map(p => p.id));
    // Reserve IDs already present later in the new route before matching omitted IDs.
    // A newly inserted duplicate must not steal the existing visit's identity.
    const reserved = new Set(route.days.flatMap(d => [...d.places, ...(d.hotel ? [d.hotel] : [])]).map(p => p.id).filter(validId));
    for (const [di, day] of route.days.entries()) {
      for (const p of [...day.places, ...(day.hotel ? [day.hotel] : [])]) {
        let candidates = old.filter(o => !seen.has(o.id) && !reserved.has(o.id) && pointKey(o) === pointKey(p));
        if (!candidates.length) candidates = old.filter(o => !seen.has(o.id) && !reserved.has(o.id) && o.name === p.name);
        if (!validId(p.id) || seen.has(p.id) || (previous && !oldIds.has(p.id) && candidates.length === 1)) p.id = candidates.length === 1 ? candidates[0].id : uid();
        if (!validId(p.id)) p.id = uid();
        seen.add(p.id);
        const prior = old.find(o => o.id === p.id);
        if (prior && (prior.lat !== p.lat || prior.lng !== p.lng || prior.name !== p.name)) {
          delete p.poi_id; delete p.city_code;
          if ((prior.lat !== p.lat || prior.lng !== p.lng) && p.source === 'user' && p.confidence === 'high') {
            p.note = (p.note || '').replace(/【坐标待确认】/g, '').trim();
          }
        }
      }
      const prev = previous?.days[di];
      if (!modes.includes(day.traffic_mode)) day.traffic_mode = prev?.traffic_mode || 'walk';
      if (typeof day.start_from_hotel !== 'boolean') day.start_from_hotel = prev?.start_from_hotel ?? di > 0;
    }
    route.days.forEach((day, di) => {
      const raw = day.transport || previous?.days[di]?.transport;
      const existing = Array.isArray(raw) ? raw : [];
      day.transport = legs(route, di).map(edge => {
        const stored = existing.find(s => s?.from_id === edge.from.id && s?.to_id === edge.to.id);
        const segment = { from_id: edge.from.id, to_id: edge.to.id,
          mode: modes.includes(stored?.mode) ? stored.mode : '',
          buffer_min: Number.isFinite(stored?.buffer_min) ? Math.max(0, Math.min(180, stored.buffer_min)) : 0 };
        const signature = sign(edge);
        if (stored?.snapshot?.signature === signature && Array.isArray(stored.snapshot.options)) segment.snapshot = stored.snapshot;
        return segment;
      });
    });
    return route;
  }
  function legs(route, di) {
    const day = route.days[di];
    if (!day) return [];
    const start = day.start_from_hotel ? (di > 0 ? route.days[di - 1]?.hotel : day.hotel) : null;
    const points = [...(start ? [start] : []), ...day.places, ...(day.hotel ? [day.hotel] : [])];
    return points.slice(1).flatMap((to, i) => {
      const from = points[i];
      return pointKey(from) === pointKey(to) ? [] : [{ from, to, city: route.trip.destination, di }];
    });
  }
  function sign(edge) {
    const key = p => [p.id, p.name, p.lat, p.lng, p.source || '', p.confidence || '', p.note || '', p.poi_id || '', p.city_code || ''];
    return JSON.stringify(['amap-v3-1', edge.city, key(edge.from), key(edge.to)]);
  }
  function usable(p) { return root.IterTripNavigation.risk(p) === 'trusted'; }
  function selected(day, edge) {
    const segment = (day.transport || []).find(s => s.from_id === edge.from.id && s.to_id === edge.to.id);
    const mode = segment?.mode || day.traffic_mode || 'walk';
    const snapshot = segment?.snapshot;
    const match = snapshot?.signature === sign(edge);
    const option = match && Array.isArray(snapshot.options) ? snapshot.options.find(o => o?.mode === mode) : null;
    const stale = !!option && (!!snapshot.refresh_error || !Number.isFinite(Date.parse(option.queried_at)) || Date.parse(option.queried_at) > Date.now() + 60_000 || Date.now() - Date.parse(option.queried_at) > 15 * 60 * 1000);
    return { segment, mode, option, stale, known: usable(edge.from) && usable(edge.to) && !stale && option?.status === 'ok' && Number.isFinite(option.duration_s) && option.duration_s >= 0 };
  }
  function summary(route, di) {
    const edges = legs(route, di);
    let seconds = 0, walking = 0, fees = 0, known = 0, feeKnown = 0, walkKnown = 0, buffer = 0;
    edges.forEach(e => {
      const s = selected(route.days[di], e); buffer += s.segment?.buffer_min || 0;
      if (!s.known) return;
      known++; seconds += s.option.duration_s;
      if (Number.isFinite(s.option.walking_m) && s.option.walking_m >= 0) { walking += s.option.walking_m; walkKnown++; }
      if (Number.isFinite(s.option.fee_yuan) && s.option.fee_yuan >= 0) { fees += s.option.fee_yuan; feeKnown++; }
    });
    return { total: edges.length, known, seconds, walking, walkKnown, fees, feeKnown, buffer };
  }
  root.IterTripTransport = { normalize, legs, sign, selected, usable, summary, labels };
})(globalThis);
