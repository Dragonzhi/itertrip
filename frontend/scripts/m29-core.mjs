import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../src/lib/navigation.ts';
import '../src/lib/transport.ts';
import '../src/lib/schedule.ts';
import '../../shared/weather.js';
const W=globalThis.IterTripWeather, T=globalThis.IterTripTransport, S=globalThis.IterTripSchedule;
const clone=r=>JSON.parse(JSON.stringify(r));
const r=JSON.parse(fs.readFileSync('test-artifacts/m29/route.json','utf8'));
T.normalize(r);const now=new Date().toISOString();
const fresh=r=>{
 T.normalize(r); r.days.forEach((d,i)=>d.transport=T.legs(r,i).map(e=>({from_id:e.from.id,to_id:e.to.id,buffer_min:0,snapshot:{signature:T.sign(e),options:[{mode:'car',status:'ok',duration_s:600,walking_m:0,fee_yuan:12,queried_at:now,source:'amap'}]}})));
};
fresh(r);
assert.equal(S.calculate(r,0).status,'estimated');
assert.equal(W.assess(r,0).items.length,1);
assert.equal(W.assess(r,0).unknown.length,0);
const candidates=W.candidates(r,0), early=candidates.find(c=>c.route.days[0].schedule.start==='12:00');
assert.ok(W.validate(r,early.route,[0]).ok,'earlier outdoor visit avoids afternoon rain without removing required place');
assert.equal(early.route.days[0].places[0].visit.required,true);
assert.equal(W.assess(early.route,0).items.length,0,'exclusive end at 13:00 must not count following rainy hour');
const before=JSON.stringify(r);W.candidates(r,0);assert.equal(JSON.stringify(r),before);
for (const env of ['mixed','unknown']) {const v=clone(r);v.days[0].places[0].weather_exposure.environment=env;assert.ok(W.assess(v,0).unknown.length);assert.equal(W.validate(v,early.route,[0]).ok,false);}
for (const patch of [{granularity:'daily'},{kind:'historical'},{timezone:'UTC'},{queried_at:'2000-01-01T00:00:00Z'},{issued_at:'2000-01-01T00:00:00Z'},{refresh_error:'synthetic failed refresh'},{valid_to:r.trip.start_date+'T12:00:00+08:00'}]) {const v=clone(r);Object.assign(v.weather[0],patch);assert.ok(W.assess(v,0).unknown.length);}
const gap=clone(r);gap.weather[0].hours=[];assert.ok(W.assess(gap,0).unknown.length);
const nullPop=clone(r);nullPop.weather[0].hours[1].probability=null;assert.ok(W.assess(nullPop,0).unknown.length);
const far=clone(r);far.weather[0].lat=39.9;assert.ok(W.assess(far,0).unknown.length);
const renamed=clone(r);renamed.days[0].places[0].name='changed';assert.equal(W.exposure(renamed.days[0].places[0]),'unknown');
const dateShift=clone(r);dateShift.trip.start_date='2099-01-01';assert.ok(W.assess(dateShift,0).unknown.length);
const inference=clone(r);inference.trip.date_source='inferred';assert.ok(W.assess(inference,0).unknown.length);
const old=clone(r);old.days[0].transport[0].snapshot.options[0].queried_at='2000-01-01T00:00:00Z';assert.equal(W.validate(old,W.candidates(old,0)[0].route,[0]).ok,false);
const rest=clone(r);rest.days[0].places[0].visit.completed=true;assert.equal(W.candidates(rest,0).length,0,'completed point never shifts/reorders');
const reservation=clone(r);reservation.days[0].places[0].visit.reservation={type:'entry',date:r.trip.start_date,start:'13:00',end:'14:00',status:'confirmed',url:'https://example.org/booking'};
assert.equal(W.validate(reservation,W.candidates(reservation,0)[0].route,[0]).ok,false,'reservation keeps outdoor visit in rainy interval');
const unknownOpen=clone(r);unknownOpen.days[0].places[0].opening=[];assert.equal(W.validate(unknownOpen,W.candidates(unknownOpen,0)[0].route,[0]).ok,false);
const injected=clone(r);injected.weather=[];injected.days[0].places[0].weather_exposure.environment='indoor';const guarded=S.protect(r,injected).route;assert.deepEqual(guarded.weather,r.weather);assert.equal(W.exposure(guarded.days[0].places[0]),'outdoor');
const walk=clone(r);walk.days[0].transport[0].snapshot.options[0].walking_m=100;
assert.ok(W.assess(walk,0).items.some(v=>v.label.includes('交通步行')),'indoor destinations still have outdoor transfer exposure');
// Reordering requires fresh snapshots for the new adjacency, not the old A→B result.
const reorder=clone(r);reorder.days[0].schedule.start='12:00';reorder.days[0].places.reverse();fresh(reorder);
const reordered=W.candidates(reorder,0).find(c=>c.rank===1);
assert.equal(W.validate(reorder,reordered.route,[0]).ok,false,'old direction snapshot cannot assess new edge');
fresh(reordered.route);assert.ok(W.validate(reorder,reordered.route,[0]).ok,'fresh transport validates swapping outdoor visit before the rain');
// Adjacent-day swap preserves all visit metadata and rejects new-day closure rules.
const cross=clone(r), nextDate=S.date(r.trip.start_date);nextDate.setUTCDate(nextDate.getUTCDate()+1);
const nextIso=nextDate.toISOString().slice(0,10);
cross.trip.days=2;cross.days=[{...cross.days[0],places:[cross.days[0].places[0]],transport:[]},{day:2,schedule:{start:'13:00',end:'20:00'},traffic_mode:'car',start_from_hotel:false,places:[cross.days[0].places[1]]}];
for(const d of cross.days)for(const p of d.places)p.opening[0].valid_to=nextIso;
cross.weather[0].valid_to=nextIso+'T16:00:00+08:00';
cross.weather[0].hours.push(...[12,13,14,15].map(h=>({start:nextIso+`T${h}:00:00+08:00`,end:nextIso+`T${h+1}:00:00+08:00`,probability:0,precipitation_mm:0})));
fresh(cross);
const swapped=W.candidates(cross,0).find(c=>c.rank===2);fresh(swapped.route);
assert.ok(W.validate(cross,swapped.route,[0,1]).ok,'clear next-day window permits same-visits cross-day swap');
swapped.route.days[1].places[0].opening[0].closed=true;assert.equal(W.validate(cross,swapped.route,[0,1]).ok,false,'closed destination is never an accepted alternative');
console.log('M29 shared weather passed: afternoon rain, boundary, constraints, mixed/unknown, stale/horizon/timezone, no mutation and outdoor transfers');
