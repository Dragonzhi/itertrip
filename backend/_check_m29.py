"""Synthetic weather service/schema/provenance/export checks; no live credentials."""
import asyncio
import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from backend.api import weather as api
from backend.engine import weather as W
from backend.engine.schema import RouteJSON, WeatherPolicy, WeatherHour
from backend.engine.geo import wgs84_to_gcj02
from backend.engine.arrangements import protect_arrangements
from backend.engine.builder import build_html

now=datetime.now(timezone.utc)
iso=(now.astimezone(timezone(timedelta(hours=8)))+timedelta(days=2)).date().isoformat()
hourly=dict(time=[iso+'T13:00',iso+'T14:00',iso+'T15:00'],precipitation_probability=[0,80,90],precipitation=[0,1,2])
data=dict(timezone='Asia/Shanghai',utc_offset_seconds=28800,hourly=hourly,hourly_units=dict(precipitation='mm',precipitation_probability='%'))
parsed=W.parse(data,'open_meteo',30.64,104.05,now)
assert parsed['hours'][0]['start']==iso+'T12:00:00+08:00'
assert parsed['hours'][1]['probability']==80 and parsed['issued_at'] is None
assert parsed['valid_to']==iso+'T15:00:00+08:00'
for key,value in [('timezone','UTC'),('utc_offset_seconds',0),('hourly_units',{}),('hourly',dict(time=[iso+'T13:00'],precipitation_probability=[],precipitation=[]))]:
    bad=copy.deepcopy(data);bad[key]=value
    try: W.parse(bad,'open_meteo',30.64,104.05,now);raise AssertionError('invalid forecast accepted')
    except ValueError: pass
q=dict(hours=[dict(forecastTime=iso+'T13:00+08:00',precipitation=dict(probability=.8,intensity=dict(value=1.2,unit='mm/h')))],metadata=dict(attributions=['https://example.org/credit']))
assert W.parse(q,'qweather',30.64,104.05,now)['hours'][0]['probability']==80
assert W.number(True,0,100) is None
for model,value in [(WeatherPolicy,dict(probability=0)),(WeatherPolicy,dict(precipitation_mm=float('nan'))),(WeatherHour,dict(start='',end='',probability=101))]:
    try:model.model_validate(value);raise AssertionError('invalid weather value accepted')
    except ValidationError:pass
la,ln=wgs84_to_gcj02(30.64,104.05)
assert max(abs(x-y) for x,y in zip(W.location(dict(lat=la,lng=ln)),(30.64,104.05)))<.001
point=dict(id='a',name='合成公园',lat=la,lng=ln,source='user',confidence='high')
app=FastAPI();app.include_router(api.router);client=TestClient(app)
with patch.object(W,'env_value',return_value=''):
    r=client.post('/api/route/weather',json=dict(points=[point]));assert r.status_code==200 and not r.json()['results'] and r.json()['calls']==0
assert client.post('/api/route/weather',json=dict(points=[{**point,'lat':True}])).status_code==422
assert client.post('/api/route/weather',json=dict(points=[point]*13)).status_code==422

async def checks():
    W._cache.clear();W._inflight.clear();W._calls.clear();W._circuit=0
    calls=[]
    async def fetch(*args):
        calls.append(args);await asyncio.sleep(.01);return parsed
    with patch.object(W,'config',return_value=('open_meteo','api.open-meteo.com','')),patch.object(W,'fetch_one',side_effect=fetch):
        a,b=await asyncio.gather(W.query([point,point]),W.query([point]))
        assert len(calls)==1 and a['results'] and b['results']
        c=await W.query([point]);assert c['calls']==0 and c['results'][0]['queried_at']==parsed['queried_at']
        assert not (await W.query([{**point,'source':'llm'}]))['results']
    W._cache.clear()
    async def fail(*args):raise httpx.ConnectError('sensitive-url-and-key-must-not-appear')
    with patch.object(W,'config',return_value=('open_meteo','api.open-meteo.com','')),patch.object(W,'fetch_one',side_effect=fail):
        a=await W.query([point]);assert 'sensitive' not in json.dumps(a) and a['error'] and not a['results']
    # Exercise real HTTP adapter request shapes (no external connection, only synthetic token).
    client_class=httpx.AsyncClient
    W._circuit=0;W._calls.clear()
    def handler(request):
        assert request.url.host=='synthetic.xy.qweatherapi.com'
        assert request.url.path.startswith('/weather/v1/hourly/')
        assert request.headers['Authorization']=='Bearer synthetic-test-token'
        assert request.url.params['localTime']=='true'
        return httpx.Response(200,json=q)
    with patch.object(W.httpx,'AsyncClient',side_effect=lambda **kw:client_class(transport=httpx.MockTransport(handler),**kw)):
        a=await W.fetch_one('qweather','synthetic.xy.qweatherapi.com','synthetic-test-token',30.64,104.05)
        assert a['provider']=='qweather' and 'synthetic-test-token' not in json.dumps(a)
    def denied(request):return httpx.Response(429,json={'secret':'must never be surfaced'})
    with patch.object(W.httpx,'AsyncClient',side_effect=lambda **kw:client_class(transport=httpx.MockTransport(denied),**kw)):
        try:await W.fetch_one('qweather','synthetic.xy.qweatherapi.com','synthetic-test-token',30.64,104.05);raise AssertionError('quota error accepted')
        except ValueError as e:assert 'secret' not in str(e)
        assert W._circuit>0
asyncio.run(checks())

opening=dict(place_name=point['name'],open='00:00',close='23:59',entry_policy='none',valid_from=iso,valid_to=iso,source_kind='user',source_url='https://example.org/opening',checked_at=now.isoformat(),confirmed=True)
exposure=dict(environment='outdoor',rain_sensitive=True,source='user',place_name=point['name'],confirmed_at=now.isoformat())
route=dict(trip=dict(title='M29 合成下午雨',destination='成都',days=1,start_date=iso,date_source='user'),days=[dict(day=1,schedule=dict(start='13:00',end='20:00'),traffic_mode='car',places=[dict(**point,visit=dict(duration_min=60,duration_source='user',required=True),opening=[opening],weather_exposure=exposure),dict(id='b',name='合成室内馆',lat=la,lng=ln+.002,source='user',confidence='high',visit=dict(duration_min=60,duration_source='user'),opening=[{**opening,'place_name':'合成室内馆'}],weather_exposure={**exposure,'environment':'indoor','place_name':'合成室内馆'})])],weather=[parsed])
assert RouteJSON.model_validate(route).weather[0].issued_at is None
candidate=copy.deepcopy(route);candidate['days'][0]['places'][0]['weather_exposure']['environment']='indoor';candidate['weather'][0]['queried_at']='2099-01-01T00:00:00Z'
out,reasons=protect_arrangements(route,candidate)
assert out['days'][0]['places'][0]['weather_exposure']==exposure and out['weather']==route['weather']
stripped=W.strip_generated(copy.deepcopy(route));assert 'weather' not in stripped and 'weather_exposure' not in stripped['days'][0]['places'][0]
directory=Path('frontend/test-artifacts/m29');directory.mkdir(parents=True,exist_ok=True)
(directory/'route.json').write_text(json.dumps(route,ensure_ascii=False),encoding='utf-8')
html=build_html(route);assert '__WEATHER_CORE__' not in html and '__EXPORT_WEATHER__' not in html
(directory/'export.html').write_text(html,encoding='utf-8')
evil=copy.deepcopy(route);evil['days'][0]['places'][0]['name']='</script><script>alert(29)</script>'
assert '</script><script>alert(29)</script>' not in build_html(evil)
print('M29 backend passed: provider semantics, timezone, missing data, coordinate inverse, optional configuration, dedup/cache, safe failure, schema, provenance guard and export')
