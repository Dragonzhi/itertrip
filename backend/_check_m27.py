"""M27 API/schema/AI guard/export checks. All source/provider data is synthetic, no network."""
import copy
import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api import search, plan, chat
from backend.engine.schema import RouteJSON, VisitPlan, OpeningFact
from backend.engine.arrangements import protect_arrangements
from backend.engine.builder import build_html
from backend.engine.hotel_price import apply_price

now = datetime.now(timezone.utc).isoformat()
fact = dict(place_name="测试馆A（合成）", open="09:00", close="17:00", last_entry="16:00", valid_from="2026-10-01", valid_to="2026-10-31", source_kind="official", source_url="https://example.org/synthetic-opening", checked_at=now, confirmed=True)
route = {"trip": {"title": "M27 合成日程测试", "destination": "成都", "days": 1, "start_date": "2026-10-05", "date_source": "user"}, "days": [{"day": 1, "schedule": {"start": "08:00", "end": "18:00"}, "places": [
    {"id": "a", "name": "测试馆A（合成）", "lat": 30.64, "lng": 104.05, "source": "user", "confidence": "high", "note": "周一闭馆", "visit": {"duration_min": 60, "duration_source": "user", "required": True}, "opening": [fact]},
    {"id": "b", "name": "测试休息点B（合成）", "lat": 30.65, "lng": 104.06, "source": "user", "confidence": "high", "visit": {"duration_min": 30, "duration_source": "user", "kind": "rest", "locked": True, "reservation": {"type": "entry", "date": "2026-10-05", "start": "10:00", "end": "12:00", "status": "confirmed", "url": "https://example.org/reservation"}}},
], "hotel": {"id": "h", "name": "测试酒店（合成）", "lat": 30.66, "lng": 104.07, "prices": [{"platform": "手动", "price": 300, "check_in": "2026-10-05", "check_out": "2026-10-06", "room": "双床", "occupancy": "2人1间", "cancellation": "不可取消", "unit": "night", "source_url": "https://example.org/quote", "queried_at": now}]}}]}
parsed = RouteJSON.model_validate(route).model_dump()
assert parsed["days"][0]["places"][0]["opening"][0]["source_url"] == fact["source_url"]
assert parsed["days"][0]["hotel"]["prices"][0]["room"] == "双床"
price_route = copy.deepcopy(route)
price_route['days'][0]['hotel']['prices'][0]['platform'] = '手动录入'
apply_price(price_route, {'price': 200})
assert price_route['days'][0]['hotel']['prices'][0]['queried_at'] == '', 'changed manual amount must not keep an old verified quote timestamp'
for model, args in [(VisitPlan, {"duration_min": -1}), (VisitPlan, {"duration_min": float("inf")}), (OpeningFact, {"weekdays": [8]})]:
    try:
        model.model_validate(args)
        raise AssertionError("invalid structured schedule accepted")
    except ValidationError:
        pass
candidate = copy.deepcopy(route)
candidate["days"][0]["places"].reverse()
assert protect_arrangements(route, candidate)[1]
candidate = copy.deepcopy(route)
candidate["days"][0]["places"].pop(0)
assert protect_arrangements(route, candidate)[1]
candidate = copy.deepcopy(route)
candidate["days"][0]["places"][0]["visit"] = {"duration_min": 1}
candidate["days"][0]["places"][0]["opening"] = []
candidate["days"][0]["schedule"]["start"] = "07:00"
out, errors = protect_arrangements(route, candidate)
assert not errors and out["days"][0]["places"][0]["visit"] == route["days"][0]["places"][0]["visit"]
assert out["days"][0]["schedule"]["start"] == "08:00"
candidate["days"][0]["places"][0].pop("id")
assert protect_arrangements(route, candidate)[0]["days"][0]["places"][0]["id"] == "a"

app = FastAPI(); app.include_router(search.router); app.include_router(plan.router); app.include_router(chat.router)
client = TestClient(app)
res = client.post('/api/route/datecheck', json={"route": route, "start_date": "2026-10-06"})
assert res.status_code == 200, res.text
data = res.json()["route"]
assert data["days"][0]["schedule"]["start"] == "08:00"
assert data["days"][0]["places"][1]["visit"]["locked"]
assert data["days"][0]["hotel"]["prices"][0]["check_in"] == "2026-10-05"

# Exercise the real SSE endpoint; a model's 'done' claim is rejected before any geocoding.
async def fake_model(*args, **kwargs):
    days = copy.deepcopy(route['days']); days[0]['places'].reverse()
    yield 'content', '<<<JSON>>>' + json.dumps({'changed': True, 'reply': '模型宣称已移动', 'days': days}, ensure_ascii=False)
with patch.object(chat, '_resolve_cfg', return_value=({'base_url':'https://example.org', 'api_key':'synthetic-test-key','model':'synthetic'}, False, 'env')), patch.object(chat, '_stream_llm', side_effect=fake_model):
    response = client.post('/api/chat', json={'prompt':'调整当天顺序', 'route':route})
    assert response.status_code == 200, response.text
    replies = [json.loads(block.split('data: ',1)[1]) for block in response.text.split('\n\n') if block.startswith('event: reply')]
    assert replies and replies[-1]['route'] is None and '行程未修改' in replies[-1]['reply'], response.text
    assert 'schedule-guard' in response.text and 'synthetic-test-key' not in response.text

real_client = httpx.AsyncClient
calls = []
def handler(request):
    body = json.loads(request.content); calls.append(body)
    return httpx.Response(200, json={"results": [{"title": "合成公告", "url": "https://example.org/test", "content": "合成线索 ￥300 ￥500"}, {"title": "bad", "url": "javascript:alert(1)", "content": "bad"}]})
with patch.object(search, 'env_value', side_effect=lambda name, default='': 'synthetic-test-key' if name == 'ITERTRIP_SEARCH_API_KEY' else default), patch.object(search.httpx, 'AsyncClient', side_effect=lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs)):
    result = client.post('/api/search', json={"hotel": "测试酒店", "city": "成都", "checkIn": "2026-10-05", "checkOut": "2026-10-06"}).json()
    assert '2026-10-05' in calls[-1]["query"] and '2026-10-06' in calls[-1]["query"]
    assert result["prices"][0]["source_url"] == "https://example.org/test"
    assert result["prices"][0]["check_in"] == '' and result["prices"][0]["room"] == '', "snippets cannot prove quote conditions"
    facts = client.post('/api/route/facts/search', json={"name":"测试馆", "date":"2026-10-05"}).json()
    assert len(facts["candidates"]) == 1 and 'opening' not in facts, facts
    assert 'synthetic-test-key' not in json.dumps(facts)
with patch.object(search, 'env_value', return_value=''):
    assert not client.post('/api/route/facts/search', json={"name":"馆"}).json()["candidates"]

html = build_html(route)
assert '__SCHEDULE_CORE__' not in html and '__EXPORT_SCHEDULE__' not in html
assert 'synthetic-test-key' not in html
hostile = copy.deepcopy(route); hostile['days'][0]['places'][0]['name'] = '</script> __SCHEDULE_CORE__ $&'
assert '\\u003c/script>' in build_html(hostile)
artifact = Path('frontend/test-artifacts/m27'); artifact.mkdir(parents=True, exist_ok=True)
(artifact / 'route.json').write_text(json.dumps(route, ensure_ascii=False), encoding='utf-8')
(artifact / 'export.html').write_text(html, encoding='utf-8')
print('M27 backend checks passed: contract, constraints, datecheck, dated quotes, source leads and safe export')
