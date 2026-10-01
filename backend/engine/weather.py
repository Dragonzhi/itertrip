"""Bounded, optional hourly forecast service. No LLM, historical API or client keys."""
import asyncio
import copy
import math
import re
import time
from collections import OrderedDict, deque
from datetime import datetime, timedelta, timezone

import httpx

from ._llmutil import env_value
from .geo import wgs84_to_gcj02

TTL = 1800
_cache = OrderedDict()
_inflight = {}
_gate = asyncio.Semaphore(2)
_circuit = 0.0
_calls = deque()


def strip_generated(data):
    """A model cannot mint user confirmations or external-service forecast provenance."""
    data.pop('weather', None)
    data.pop('weather_policy', None)
    data.pop('agent_receipts', None)
    for day in data.get('days', []):
        for p in [*day.get('places', []), *([day['hotel']] if day.get('hotel') else [])]:
            p.pop('weather_exposure', None)
    return data


def stamp(value):
    if not isinstance(value, str):
        return None
    try:
        d = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return d if d.tzinfo else None
    except ValueError:
        return None


def number(value, low, high):
    if isinstance(value, bool):
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) and low <= n <= high else None
    except (TypeError, ValueError):
        return None


def location(point):
    # Iterative inverse avoids sending GCJ-02 coordinates to global forecast grids.
    lat, lng = point['lat'], point['lng']
    a, b = lat, lng
    for _ in range(3):
        x, y = wgs84_to_gcj02(a, b)
        a, b = a + lat - x, b + lng - y
    return round(a, 3), round(b, 3)


def config():
    provider = env_value('ITERTRIP_WEATHER_PROVIDER').strip()
    host = env_value('ITERTRIP_QWEATHER_HOST').strip()
    token = env_value('ITERTRIP_QWEATHER_TOKEN').strip()
    if not provider:
        provider = 'qweather' if host and token else 'none'
    if provider == 'qweather':
        if not re.fullmatch(r'[a-zA-Z0-9-]+\.(?:[a-zA-Z0-9-]+\.)?qweatherapi\.com', host) or not token:
            raise ValueError('和风天气未配置专属 API Host／JWT；请按部署文档配置。')
        return provider, host, token
    if provider == 'open_meteo':
        key = env_value('ITERTRIP_OPEN_METEO_KEY').strip()
        return provider, 'customer-api.open-meteo.com' if key else 'api.open-meteo.com', key
    raise ValueError('天气服务未开启。服务端可配置和风天气或 Open-Meteo；行程编辑与导航仍可用。')


def parse(data, provider, lat, lng, now):
    slots = []
    if provider == 'open_meteo':
        if data.get('timezone') != 'Asia/Shanghai' or data.get('utc_offset_seconds') != 28800:
            raise ValueError('天气响应时区不匹配，未用于评估。')
        h, units = data.get('hourly', {}), data.get('hourly_units', {})
        if units.get('precipitation') != 'mm' or units.get('precipitation_probability') != '%':
            raise ValueError('天气响应单位不匹配，未用于评估。')
        times, pops, amounts = h.get('time', []), h.get('precipitation_probability', []), h.get('precipitation', [])
        if len(times) != len(pops) or len(times) != len(amounts) or len(times) > 400:
            raise ValueError('逐小时天气数组缺失或长度不一致。')
        for t, pop, amount in zip(times, pops, amounts):
            end = stamp(t + '+08:00')
            if end:
                # Open-Meteo precipitation and probability describe the preceding hour.
                slots.append(dict(start=(end-timedelta(hours=1)).isoformat(), end=end.isoformat(), probability=number(pop, 0, 100), precipitation_mm=number(amount, 0, 1000)))
        source = 'https://open-meteo.com/'
        attributions = ['https://open-meteo.com/', 'https://creativecommons.org/licenses/by/4.0/']
    else:
        hours = data.get('hours', [])
        if not isinstance(hours, list) or len(hours) > 240:
            raise ValueError('和风逐小时响应格式不正确。')
        for h in hours:
            start = stamp(h.get('forecastTime'))
            p = h.get('precipitation') or {}
            intensity = p.get('intensity') or {}
            pop = number(p.get('probability'), 0, 1)
            if start:
                slots.append(dict(start=start.isoformat(), end=(start+timedelta(hours=1)).isoformat(), probability=None if pop is None else pop*100, precipitation_mm=number(intensity.get('value'), 0, 1000) if intensity.get('unit') == 'mm/h' else None))
        source = 'https://dev.qweather.com/en/docs/api/weather/weather-hourly-forecast/'
        attributions = [s for s in data.get('metadata', {}).get('attributions', []) if isinstance(s, str) and s.startswith('https://')][:8]
    # Never use already-ended/historical rows; reject duplicate/overlapping intervals.
    slots = sorted([s for s in slots if stamp(s['end']) > now], key=lambda s: stamp(s['start']))
    if not slots or any(stamp(a['end']) > stamp(b['start']) for a, b in zip(slots, slots[1:])):
        raise ValueError('没有可用的未来逐小时预报，或时段重叠。')
    return dict(provider=provider, source_url=source, attributions=attributions, queried_at=now.isoformat(), issued_at=None, timezone='Asia/Shanghai', granularity='hourly', kind='forecast', lat=lat, lng=lng, valid_from=slots[0]['start'], valid_to=slots[-1]['end'], hours=slots)


async def fetch_one(provider, host, token, lat, lng):
    global _circuit
    async with _gate:
        if time.monotonic() < _circuit:
            raise ValueError('天气服务暂时熔断，请稍后刷新。')
        tick = time.monotonic()
        while _calls and tick - _calls[0] > 60:
            _calls.popleft()
        if len(_calls) >= 30:
            raise ValueError('天气查询已达到每分钟预算，请稍后刷新。')
        _calls.append(tick)
        async with httpx.AsyncClient(timeout=8, follow_redirects=False) as client:
            if provider == 'qweather':
                response = await client.get(f'https://{host}/weather/v1/hourly/{lat}/{lng}', params={'hours':168, 'localTime':'true', 'lang':'zh'}, headers={'Authorization':f'Bearer {token}'})
            else:
                params = dict(latitude=lat, longitude=lng, hourly='precipitation_probability,precipitation', timezone='Asia/Shanghai', forecast_days=7, past_days=0)
                if token:
                    params['apikey'] = token
                response = await client.get(f'https://{host}/v1/forecast', params=params)
            if response.status_code in (401, 403, 429):
                _circuit = time.monotonic() + 60
                raise ValueError('天气服务鉴权、权限或额度不足；保留旧记录，未当作当前预报。')
            if response.status_code != 200 or len(response.content) > 500_000:
                raise ValueError('天气服务响应失败或数据过大。')
            return parse(response.json(), provider, lat, lng, datetime.now(timezone.utc))


async def query(points):
    global _circuit
    try:
        provider, host, token = config()
    except ValueError as e:
        return dict(results=[], error=str(e), calls=0)
    results, calls = [], 0
    locations = []
    for p in points:
        if p.get('source') not in ('user', 'memory', 'amap') or (p.get('source') == 'amap' and p.get('confidence') != 'high') or '坐标待确认' in p.get('note', ''):
            continue
        lat, lng = p.get('lat'), p.get('lng')
        if number(lat, 18, 54) is None or number(lng, 73, 135) is None:
            continue
        loc = location(p)
        if loc not in locations:
            locations.append(loc)
    if not locations:
        return dict(results=[], error='缺少已确认的境内坐标；先确认地点位置后再查询天气。', calls=0)
    errors = []
    for lat, lng in locations[:12]:
        key = (provider, host, token, lat, lng)
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < TTL:
            results.append(copy.deepcopy(cached[1])); continue
        try:
            task = _inflight.get(key)
            if task is None:
                if calls >= 12:
                    break
                calls += 1
                task = asyncio.create_task(fetch_one(provider, host, token, lat, lng))
                _inflight[key] = task
                def cleanup(done, key=key):
                    if _inflight.get(key) is done:
                        _inflight.pop(key, None)
                    # A timed-out requester may no longer await this task.
                    if not done.cancelled():
                        done.exception()
                task.add_done_callback(cleanup)
            data = await asyncio.wait_for(asyncio.shield(task), timeout=9)
            _cache[key] = (time.monotonic(), data)
            _cache.move_to_end(key)
            while len(_cache) > 256:
                _cache.popitem(last=False)
            results.append(copy.deepcopy(data))
        except (httpx.HTTPError, TimeoutError):
            errors.append('天气服务网络不可用，未获得新的预报。')
            _circuit = time.monotonic() + 30
            break
        except (ValueError, TypeError, KeyError, AttributeError):
            errors.append('天气服务配置、权限或响应资料不完整，未获得新的预报。')
            break
        finally:
            if key in _inflight and _inflight[key].done():
                _inflight.pop(key, None)
    return dict(results=results, error='；'.join(errors), calls=calls)
