// Keep synthetic forecasts in the future without weakening production freshness checks.
export function futureFixture(fixture) {
  const original=fixture.trip.start_date, target=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  const offset=Date.parse(target)-Date.parse(original), now=new Date().toISOString();
  const shift=value=>{
    if(Array.isArray(value))return value.map(shift);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,shift(v)]));
    if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(T|$)/.test(value))return new Date(Date.parse(value.slice(0,10))+offset).toISOString().slice(0,10)+value.slice(10);
    return value;
  };
  const route=shift(fixture);
  for(const day of route.days)for(const p of [...day.places,...(day.hotel?[day.hotel]:[])]){
    for(const f of p.opening||[])f.checked_at=now;
    if(p.weather_exposure)p.weather_exposure.confirmed_at=now;
  }
  for(const f of route.weather||[]){f.queried_at=now;if(f.issued_at)f.issued_at=now;}
  return route;
}
