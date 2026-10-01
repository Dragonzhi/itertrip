"""M30 realistic scenario regression with synthetic services (no paid calls).

Run from repository root: .venv/Scripts/python.exe -m backend._check_m30
Artifacts include frontend fixtures and honest reported usage, never credentials.
"""
import asyncio
import copy
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch, AsyncMock

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api import chat
from backend.engine import agent_ops as O, agent_tools as T, agent_turn as A
from backend.engine.schema import RouteJSON
from backend.engine.builder import build_html

iso = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
point = lambda key, name, lat: dict(id=key, name=name, lat=lat, lng=104.06, source='user', confidence='high', type='other', visit=dict(kind='rest', duration_min=30, duration_source='user'))
route = dict(trip=dict(title='M30 成都两日约束场景（合成资料）', destination='成都', days=2, start_date=iso, date_source='user'),
             days=[dict(day=1, schedule=dict(start='09:00', end='18:00'), traffic_mode='walk', start_from_hotel=False, places=[point('a','春熙路休息点',30.66),point('b','人民公园休息点',30.67)]),
                   dict(day=2, schedule=dict(start='09:00', end='18:00'), traffic_mode='walk', start_from_hotel=False, places=[point('c','宽窄巷子休息点',30.68)])])
version='m30-turn-001'
proposal=lambda *acts: dict(transaction_id=version,base_version=version,actions=list(acts))
duration=dict(op='set_duration',place_id='a',minutes=45)
move=dict(op='move_place',place_id='a',to_day=2,before_id='')
original=json.dumps(route)
assert not A.handles('把每天酒店报价调整到 200 元')
assert not A.handles('地点位置不对，请调整到长沙')
assert A.handles('看一下今天的天气') and A.handles('下午下雨，帮我调整路线')
candidate,p,changed=O.validate(route,proposal(duration),version)
assert changed and candidate['days'][0]['places'][0]['visit']['duration_min']==45
assert json.dumps(route)==original
assert O.explicit('把春熙路休息点停留改为 45 分钟',p,route)
assert not O.explicit('如果春熙路休息点停留 45 分钟会怎样？',p,route)
assert not O.explicit('不要把春熙路休息点停留改为 45 分钟',p,route)
assert not O.explicit('帮我优化路线',p,route)
assert not O.explicit('把同名地点停留改为 45 分钟',p,route)
bad=[proposal({**duration,'minute':40}),proposal({**duration,'place_id':'missing'}),proposal({**duration,'minutes':True}),proposal(duration,{**duration,'place_id':'missing'}),{**proposal(duration),'base_version':'old-version'}]
for raw in bad:
    try:O.validate(route,raw,version);raise AssertionError('invalid operation accepted')
    except (ValidationError, ValueError):pass
assert json.dumps(route)==original
fixed=copy.deepcopy(route);fixed['days'][0]['places'][0]['visit']['locked']=True
for r,completed in [(fixed,[]),(route,['a'])]:
    try:O.validate(r,proposal(move),version,completed);raise AssertionError('fixed/completed accepted')
    except ValueError:pass
added,p,_=O.validate(route,proposal(dict(op='add_place',to_day=1,name='新地点',type='other')),version)
added['agent_receipts']=[dict(id=p['transaction_id'],payload=O.digest(p))]
assert not O.validate(added,p,version)[2]
try:O.validate(added,proposal(duration),version);raise AssertionError('reused id accepted')
except ValueError:pass
assert RouteJSON.model_validate(added).model_dump()['agent_receipts']==added['agent_receipts']
assert O.digest(p) in json.loads(json.dumps(added,ensure_ascii=False))['agent_receipts'][0]['payload']
artifact=Path('frontend/test-artifacts/m30');artifact.mkdir(parents=True,exist_ok=True)
(artifact/'route.json').write_text(json.dumps(route,ensure_ascii=False),encoding='utf-8')
(artifact/'parity.json').write_text(json.dumps(dict(proposal=p,receipt=added['agent_receipts'][0]),ensure_ascii=False),encoding='utf-8')
(artifact/'export.html').write_text(build_html(RouteJSON.model_validate(added).model_dump()),encoding='utf-8')

async def tools_checks():
    runtime=T.Tools(route,version,[dict(status='estimated',issues=[],unknown=[])]*2)
    async def query(name,args):return dict(value='synthetic'),['https://example.org/fixture'],1,True
    with patch.object(runtime,'_query',side_effect=query) as q:
        good=await runtime.run('search_place',dict(name='人民公园'))
        again=await runtime.run('search_place',dict(name='人民公园'))
        assert good['status']=='ok' and good['http_calls']==1 and again['cached'] and again['http_calls']==0 and q.call_count==1
        error=await runtime.run('search_place',dict(naem='wrong'));assert error['status']=='error'
    with patch.object(runtime,'_query',side_effect=httpx.ConnectError('credential-must-not-be-logged')):
        error=await runtime.run('search_place',dict(name='锦里'));assert error['status']=='error' and 'credential' not in json.dumps(error)
    with patch.object(runtime,'_query',side_effect=TimeoutError):
        timeout=await runtime.run('search_place',dict(name='武侯祠'));assert timeout['http_calls'] is None and timeout['status']=='error'
    await runtime.run('not_a_tool',{})
    assert '预算' in (await runtime.run('search_place',dict(name='超额')))['reason']
    assert json.dumps(route)==original
    # Actual adapter paths with fixture provider return values.
    from backend.engine import transport, weather, coordinates
    options=[dict(mode='walk',status='ok',duration_s=600,source='amap',queried_at=datetime.now(timezone.utc).isoformat())]
    runtime=T.Tools(route,version,[])
    with patch.object(transport,'query',new=AsyncMock(return_value=dict(results=[dict(options=options)],stats=dict(calls=1)))) as q:
        result=await runtime.run('query_transport',dict(from_id='b',to_id='a',mode='walk'))
        assert result['status']=='ok' and runtime.evidence[0]['from_id']=='b'
        assert q.call_args.args[0][0]['from']['id']=='b'
    with patch.object(weather,'query',new=AsyncMock(return_value=dict(results=[],error='unconfigured',calls=0))):
        assert (await runtime.run('query_weather',dict(place_id='a')))['status']=='unknown'
    assert (await runtime.run('query_weather',dict(place_id='missing')))['status']=='error'
    assert (await runtime.run('check_schedule',dict(day=1)))['status']=='unknown'
    with patch.object(coordinates,'geocode_amap_scored',new=AsyncMock(return_value=(30.66,104.06,.9,1))):
        assert (await runtime.run('search_place',dict(name='人民公园')))['source']
    # Real timeout cancellation path, with a shortened test deadline (not a thrown fixture).
    runtime=T.Tools(route,version,[]);cancelled=asyncio.Event();real_wait=asyncio.wait_for
    async def slow_query(*args):
        try:await asyncio.sleep(5)
        finally:cancelled.set()
    async def short_wait(coro,timeout):return await real_wait(coro,.01)
    with patch.object(runtime,'_query',side_effect=slow_query),patch.object(T.asyncio,'wait_for',new=short_wait):
        result=await runtime.run('search_place',dict(name='timeout'))
        assert result['status']=='error' and cancelled.is_set() and result['http_calls'] is None
asyncio.run(tools_checks())

app=FastAPI();app.include_router(chat.router);client=TestClient(app)
real_client=httpx.AsyncClient
cfg=({'base_url':'https://example.org','api_key':'synthetic-test-key','model':'synthetic'},False,'env')
rows=[]
def scenario(name,mode,handler,body=None):
    start=time.perf_counter()
    with patch.object(chat,'_resolve_cfg',return_value=cfg),patch.object(A,'env_value',side_effect=lambda key,default='':mode if key=='ITERTRIP_AGENT_PROTOCOL' else default),patch.object(A.httpx,'AsyncClient',side_effect=lambda **kw:real_client(transport=httpx.MockTransport(handler),**kw)):
        request_body=dict(prompt='把春熙路休息点停留改为 45 分钟',route=route,agent_version=version,agent_schedule=[dict(status='estimated',issues=[],unknown=[])]*2)
        request_body.update(body or {})
        response=client.post('/api/chat',json=request_body)
    frames=[json.loads(s.split('data: ',1)[1]) for s in response.text.split('\n\n') if s.startswith('event: reply')]
    assert frames,response.text
    result=frames[-1]
    assert result['route'] is None,'server must not claim committed route'
    rows.append(dict(scenario=name,passed=True,elapsed_ms=round((time.perf_counter()-start)*1000),metrics=result.get('stats',{}),proposed=bool(result.get('agent_proposal'))))
    return result,response.text

completion=lambda content: httpx.Response(200,json=dict(choices=[dict(message=dict(role='assistant',content=content))],usage=dict(prompt_tokens=200,completion_tokens=40,total_tokens=240)))
result,_=scenario('明确停留时长，双段协议', 'protocol',lambda req:completion('<<<JSON>>>'+json.dumps(dict(proposal=proposal(duration)))))
assert result['agent_direct'] and result['agent_proposal']
result,_=scenario('仅声称成功，无有效操作','protocol',lambda req:completion('<<<REPLY>>>已经修改成功'))
assert not result.get('agent_proposal') and '成功' not in result['reply']
result,_=scenario('合法 JSON，但停留时长不变','protocol',lambda req:completion('<<<JSON>>>'+json.dumps(dict(proposal=proposal({**duration,'minutes':30})))))
assert not result.get('agent_proposal') and '没有实际变化' in result['reply']
result,text=scenario('参数拼错，重试预算用尽','protocol',lambda req:completion('<<<JSON>>>'+json.dumps(dict(proposal=proposal({**duration,'minutes':True})))))
assert not result.get('agent_proposal') and result['stats']['attempts']==3 and '未通过校验' in text
calls=[]
def fallback(req):
    payload=json.loads(req.content);calls.append(payload)
    if len(calls)==1:
        assert payload['tools'] and not payload['parallel_tool_calls'];return httpx.Response(400,json=dict(error='unsupported tools parameter'))
    if len(calls)==2:return completion('<<<JSON>>>'+json.dumps(dict(tool=dict(name='check_schedule',arguments=dict(day=1)))))
    return completion('<<<JSON>>>'+json.dumps(dict(proposal=proposal(duration))))
result,text=scenario('原生能力不足，回退后查询再提案','tools',fallback)
assert result['agent_proposal'] and result['stats']['tool_calls']==1 and result['stats']['http_calls']==0 and not result['stats']['usage_complete']
assert len(calls)==3 and '回退双段协议' in text
def native(req):
    payload=json.loads(req.content)
    assert payload['tools'] and payload['max_tokens']==1800
    return httpx.Response(200,json=dict(choices=[dict(message=dict(role='assistant',tool_calls=[dict(id='call-1',type='function',function=dict(name='propose_edits',arguments=json.dumps(proposal(duration))))]))]))
result,_=scenario('原生工具提案且供应商无用量字段','tools',native)
assert result['agent_proposal'] and result['stats']['total_tokens'] is None and not result['stats']['usage_complete']
native_calls=[]
def native_read(req):
    payload=json.loads(req.content);native_calls.append(payload)
    if len(native_calls)==1:
        return httpx.Response(200,json=dict(choices=[dict(message=dict(role='assistant',content=None,tool_calls=[dict(id='check-1',type='function',function=dict(name='check_schedule',arguments='{"day":1}'))]))]))
    assert payload['messages'][-1]['role']=='tool' and payload['messages'][-1]['tool_call_id']=='check-1'
    assert json.loads(payload['messages'][-1]['content'])['base_version']==version
    return native(req)
result,text=scenario('原生只读工具回传与后续提案','tools',native_read)
assert result['agent_proposal'] and result['stats']['tool_calls']==1 and '查询结果：check_schedule' in text
def cost(req):return httpx.Response(200,json=dict(choices=[],usage=dict(prompt_tokens=17000,completion_tokens=1,total_tokens=17001)))
result,text=scenario('已报告 token 超出阈值，停止后续','protocol',cost)
assert not result.get('agent_proposal') and result['stats']['attempts']==1
large=copy.deepcopy(route);large['agent_receipts']=[dict(id='older-turn',payload='x'*200000)];large['weather']=[dict(provider='open_meteo',hours=[dict(start='x',end='y')]*10000)]
def compact(req):
    user=json.loads(json.loads(req.content)['messages'][-1]['content'])
    assert 'agent_receipts' not in user['current_route'] and 'hours' not in user['current_route']['weather'][0]
    return completion('<<<JSON>>>'+json.dumps(dict(proposal=proposal(duration))))
result,_=scenario('历史事务与原始天气网格不挤占模型上下文','protocol',compact,dict(route=large))
assert result['agent_proposal']

async def cancel_check():
    entered=asyncio.Event();cancelled=asyncio.Event()
    async def slow(request):
        entered.set()
        try:await asyncio.sleep(60)
        finally:cancelled.set()
    req=chat.ChatRequest(prompt='修改停留',route=route,agent_version=version)
    async def consume():
        async for _ in A.run(req,cfg[0]):pass
    with patch.object(A.httpx,'AsyncClient',side_effect=lambda **kw:real_client(transport=httpx.MockTransport(slow),**kw)):
        task=asyncio.create_task(consume());await entered.wait();task.cancel()
        try:await task
        except asyncio.CancelledError:pass
        assert cancelled.is_set()
asyncio.run(cancel_check())
(artifact/'backend-evaluation.json').write_text(json.dumps(dict(kind='synthetic-provider real-scenario regression',scenarios=rows,notes='No real user outcome or paid model calls. Null usage/cost means unavailable.'),ensure_ascii=False,indent=2),encoding='utf-8')
print('M30 backend passed: strict atomic/replay guards, read-only adapters, actual SSE native/fallback loop, budgets, no-op/text-only and cancellation; '+str(len(rows))+' model scenarios')
