"""Deterministic mocked-provider contracts. --live performs one bounded real comparison."""
import asyncio
import json
import sys
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from unittest.mock import patch

from .engine import transport as t
from .engine.builder import build_html
from .engine.schema import RouteJSON
from .engine.coordinates import _pick_best_poi
from .main import app

P = {"id": "p1", "name": "武侯祠", "lat": 30.6414, "lng": 104.0499, "source": "user", "confidence": "high"}
Q = {**P, "id": "p2", "name": "人民公园", "lat": 30.6586, "lng": 104.0552}
EDGE = {"from": P, "to": Q, "signature": "test-signature"}


def reset():
    t._cache.clear(); t._inflight.clear(); t._recent.clear(); t._circuit.clear(); t._next_slot = 0


async def check():
    reset()
    async def delayed(req):
        await asyncio.sleep(.02)
        return httpx.Response(200, json={'status': '1', 'route': {'paths': [{'duration': '600', 'distance': '800'}]}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(delayed)) as client:
        one, two = await asyncio.gather(t.query([EDGE], ['walk'], key='test-only-placeholder', client=client), t.query([EDGE], ['walk'], key='test-only-placeholder', client=client))
        assert one['stats']['calls'] + two['stats']['calls'] == 1
        assert one['stats']['deduplicated'] + two['stats']['deduplicated'] == 1
    reset()
    def timed_out(req):
        raise httpx.ReadTimeout('SECRET-key-in-url')
    async with httpx.AsyncClient(transport=httpx.MockTransport(timed_out)) as client:
        with patch.object(t.asyncio, 'sleep', return_value=None):
            out = await t.query([EDGE], ['walk', 'car', 'bus'], key='test-only-placeholder', client=client)
        assert out['stats']['calls'] == 2 and 'SECRET' not in json.dumps(out)
    reset()
    calls = []
    def handler(req):
        calls.append(req)
        if "regeo" in req.url.path:
            return httpx.Response(200, json={"status": "1", "regeocode": {"addressComponent": {"citycode": "028"}}})
        p = {"distance": "2000", "duration": "600", "walking_distance": "500", "cost": "4", "tolls": "3",
             "segments": [{"bus": {"buslines": [{"name": "地铁3号线"}]}}]}
        return httpx.Response(200, json={"status": "1", "route": {"paths": [p], "transits": [p], "taxi_cost": []}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with patch.object(t.asyncio, "sleep", return_value=None):
            out = await t.query([EDGE, EDGE], ["walk", "bus", "car"], key="test-only-placeholder", client=client)
        assert out["stats"]["calls"] == 5, out
        assert out["stats"]["cache_hits"] == 5
        walk, bus, car = out["results"][0]["options"]
        assert walk["duration_s"] == 600 and walk["walking_m"] == 2000
        assert walk.get("approx") is False
        assert bus["duration_s"] == 600 and bus["walking_m"] == 500 and bus["fee_yuan"] == 4
        assert car["fee_yuan"] is None and car["tolls_yuan"] == 3
        assert out["results"][1]["options"][0]["queried_at"] == walk["queried_at"]
        req = next(r for r in calls if "walking" in r.url.path)
        assert req.url.params["origin"] == "104.049900,30.641400"
        bus_req = next(r for r in calls if "transit" in r.url.path)
        assert bus_req.url.params["city"] == "028" and bus_req.url.params["cityd"] == "028"
        before = len(calls)
        invalid = {**EDGE, "from": {**P, "source": "city"}}
        unknown = await t.query([invalid], ["walk"], key="test-only-placeholder", client=client)
        assert len(calls) == before and unknown["results"][0]["options"][0]["status"] == "unknown"
        # 未核验但来源明确的模型坐标：允许估算并标 approx
        before = len(calls)
        approx_edge = {**EDGE, "from": {**P, "source": "llm", "lat": 30.6415}}
        approx = await t.query([approx_edge], ["walk"], key="test-only-placeholder", client=client)
        opt = approx["results"][0]["options"][0]
        assert len(calls) == before + 1 and opt["status"] == "ok" and opt["approx"] is True
        # 低置信 / 待确认仍然拒绝
        before = len(calls)
        low = {**EDGE, "from": {**P, "source": "llm", "confidence": "low", "lat": 30.6416}}
        blocked = await t.query([low], ["walk"], key="test-only-placeholder", client=client)
        assert len(calls) == before and blocked["results"][0]["options"][0]["status"] == "unknown"
        # 高德弱匹配但仍有具体 POI：允许估算并标 approx，来源不升级
        before = len(calls)
        specific = {**EDGE, "from": {**P, "source": "amap", "confidence": "low", "poi_id": "B0TEST", "note": "【坐标待确认】", "lat": 30.6417}}
        allowed = await t.query([specific], ["walk"], key="test-only-placeholder", client=client)
        opt = allowed["results"][0]["options"][0]
        assert len(calls) == before + 1 and opt["status"] == "ok" and opt["approx"] is True
        assert (await t.query([EDGE], ["car"], key="", client=client))["stats"]["calls"] == 0
    reset()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"status": "0", "infocode": "10003", "info": "SECRET-key"}))) as client:
        out = await t.query([EDGE], ["walk", "bus", "car"], key="test-only-placeholder", client=client)
        assert out["stats"]["calls"] == 1 and "SECRET" not in json.dumps(out)
    reset()
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with patch.object(t.asyncio, "sleep", return_value=None):
            edges = [{**EDGE, "to": {**Q, "lng": Q["lng"] + i * .001}, "signature": str(i)} for i in range(12)]
            out = await t.query(edges, ["walk", "bus", "car"], key="test-only-placeholder", client=client)
        assert out["stats"]["calls"] == 24 and out["stats"]["reason"]
        assert out["results"][-1]["options"][-1]["status"] == "unknown"
    reset()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"status": "1", "route": {"paths": [{"duration": "NaN"}]}}))) as client:
        out = await t.query([EDGE], ["walk"], key="test-only-placeholder", client=client)
        assert out["results"][0]["options"][0]["status"] == "unknown"
    reset()
    with patch.object(t, "_amap_key", return_value=""):
        with TestClient(app) as client:
            assert client.post('/api/route/transport', json={"edges": [EDGE]}).status_code == 200
            assert client.post('/api/route/transport', json={"edges": [EDGE] * 13}).status_code == 422
            assert client.post('/api/route/transport', json={"edges": [EDGE], "modes": ["plane"]}).status_code == 422
            assert client.post('/api/route/transport', json={"edges": [{**EDGE, 'from': {**P, 'lat': True}}]}).status_code == 422
    route = {"trip": {"title": "M26 测试", "destination": "成都", "days": 1}, "days": [{"day": 1, "places": [P, Q], "traffic_mode": "bus", "transport": [{"from_id": "p1", "to_id": "p2", "mode": "bus", "buffer_min": 5}]}]}
    meta = {}
    hit = _pick_best_poi([{'name': '武侯祠', 'location': '104.0499,30.6414', 'id': 'test-poi-id', 'citycode': '028', 'pname': '四川省', 'cityname': '成都市'}], '武侯祠', provinces=['四川'], cities=['成都'], metadata=meta)
    assert hit is not None and meta[(hit[0], hit[1])]['poi_id'] == 'test-poi-id'
    route["days"][0]["transport"][0]["snapshot"] = {"signature": "s", "options": [{"mode": "walk", "status": "ok", "duration_s": 60, "queried_at": "2026-01-01T00:00:00Z", "approx": True}]}
    assert RouteJSON.model_validate(route).model_dump()["days"][0]["transport"][0]["buffer_min"] == 5
    assert RouteJSON.model_validate(route).model_dump()["days"][0]["transport"][0]["snapshot"]["options"][0]["approx"] is True
    html = build_html(route)
    assert "__TRANSPORT_CORE__" not in html and "IterTripExportTransport" in html
    artifacts = Path('frontend/test-artifacts/m26'); artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / 'route.json').write_text(json.dumps(route, ensure_ascii=False), encoding='utf-8')
    (artifacts / 'export.html').write_text(html, encoding='utf-8')
    print('M26 provider parsing, cache, guards, budget, API and schema checks passed')


async def live():
    out = await t.query([EDGE], ["walk", "bus", "car"])
    # Sanitized normalized response only; never print request URLs, secrets or raw exceptions.
    artifacts = Path('frontend/test-artifacts/m26'); artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / 'live.json').write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(live() if '--live' in sys.argv else check())
