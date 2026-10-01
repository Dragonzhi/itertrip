"""M30 domain transactions. Stateless validation; the browser owns commit/undo.

No generic JSON paths, model-written evidence, bookings or implicit confirmations.
"""
import copy
import json
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Target(Strict):
    place_id: str = Field(min_length=1, max_length=80)


class Move(Target):
    op: Literal['move_place']
    to_day: StrictInt = Field(ge=1, le=30)
    before_id: str = Field(default='', max_length=80)


class Duration(Target):
    op: Literal['set_duration']
    minutes: StrictInt = Field(ge=0, le=1440)


class Lock(Target):
    op: Literal['lock_visit']
    locked: StrictBool


class Reservation(Target):
    op: Literal['set_reservation']
    date: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')
    start: str = Field(pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')
    end: str = Field(pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')


class Add(Strict):
    op: Literal['add_place']
    to_day: StrictInt = Field(ge=1, le=30)
    name: str = Field(min_length=1, max_length=150)
    type: Literal['attraction', 'food', 'transport', 'other']


Action = Annotated[Move | Duration | Lock | Reservation | Add, Field(discriminator='op')]


class Proposal(Strict):
    transaction_id: str = Field(pattern=r'^[A-Za-z0-9_-]{8,60}$')
    base_version: str = Field(min_length=8, max_length=80)
    actions: list[Action] = Field(min_length=1, max_length=12)


def digest(proposal):
    return json.dumps(proposal, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def fixed(p, completed=()):
    v = p.get('visit') or {}
    r = v.get('reservation') or {}
    return p.get('id') in completed or v.get('completed') or v.get('locked') or bool(r and r.get('status') != 'cancelled')


def validate(route, raw, version, completed=()):
    """All or nothing. Returns candidate only; final temporal checks run in shared JS."""
    p = Proposal.model_validate(raw).model_dump()
    receipts = route.get('agent_receipts') or []
    prior = next((r for r in receipts if r['id'] == p['transaction_id']), None)
    if prior:
        if prior['payload'] != digest(p):
            raise ValueError('操作编号已用于另一组修改')
        return copy.deepcopy(route), p, False
    if p['base_version'] != version:
        raise ValueError('路线版本已变化，请重新生成')
    if p['transaction_id'] != version:
        raise ValueError('必须使用本轮提供的操作编号')
    if len(receipts) >= 1000 or len(json.dumps(receipts, ensure_ascii=False)) + len(digest(p)) > 500000:
        raise ValueError('本行程操作记录达到预算，请另存新行程后继续')
    candidate = copy.deepcopy(route)
    index = {}
    for di, d in enumerate(candidate['days']):
        for pi, point in enumerate(d.get('places', [])):
            key = point.get('id')
            if not key or key in index:
                raise ValueError('地点身份缺失或重复，请重新打开行程')
            index[key] = (point, di, pi)
        hotel = d.get('hotel')
        if hotel:
            key = hotel.get('id')
            if not key or key in index:
                raise ValueError('酒店身份缺失或重复')
            index[key] = (hotel, di, -1)
    for ai, a in enumerate(p['actions']):
        if a['op'] == 'add_place':
            if not a['name'].strip():
                raise ValueError('新增地点名称不能为空')
            di = a['to_day'] - 1
            if di >= len(candidate['days']):
                raise ValueError('目标天不存在')
            key = f"agent-{p['transaction_id']}-{ai}"
            if key in index:
                raise ValueError('新增地点已存在，拒绝重放')
            # Unverified coordinate, never label generated knowledge as map/user evidence.
            point = dict(id=key, name=a['name'], type=a['type'], lat=0, lng=0,
                         note='坐标待确认：请按名称定位后确认。', source='none', confidence='low')
            candidate['days'][di]['places'].append(point)
            index[key] = (point, di, len(candidate['days'][di]['places']) - 1)
            continue
        if a['place_id'] not in index:
            raise ValueError('地点不存在：' + a['place_id'])
        point, di, pi = index[a['place_id']]
        if a['place_id'] in completed or (point.get('visit') or {}).get('completed'):
            raise ValueError('已完成的访问不能由 AI 修改')
        visit = point.get('visit') or {}
        if a['op'] == 'move_place':
            if pi < 0 or fixed(point, completed):
                raise ValueError('酒店或固定预约不能移动')
            target = a['to_day'] - 1
            if target >= len(candidate['days']):
                raise ValueError('目标天不存在')
            dest = candidate['days'][target]['places']
            if a['before_id'] and not any(x.get('id') == a['before_id'] for x in dest):
                raise ValueError('插入位置的地点不存在于目标天')
            if a['before_id'] == a['place_id']:
                raise ValueError('不能移动到自身之前')
            candidate['days'][di]['places'].remove(point)
            at = next((i for i, x in enumerate(dest) if x.get('id') == a['before_id']), len(dest))
            dest.insert(at, point)
            for j, d in enumerate(candidate['days']):
                for k, x in enumerate(d['places']):
                    index[x['id']] = (x, j, k)
        elif a['op'] == 'set_duration':
            if fixed(point, completed):
                raise ValueError('固定访问的停留时间不能由 AI 改动')
            visit.update(duration_min=a['minutes'], duration_source='user')
            point['visit'] = visit
        elif a['op'] == 'lock_visit':
            if not a['locked'] and (visit.get('reservation') or {}).get('status') not in (None, 'cancelled'):
                raise ValueError('不能解除仍有效的预约约束')
            visit['locked'] = a['locked']
            point['visit'] = visit
        elif a['op'] == 'set_reservation':
            from datetime import date
            date.fromisoformat(a['date'])
            if a['end'] <= a['start'] or fixed(point, completed):
                raise ValueError('预约时间无效或原访问已固定')
            # It is a user scheduling record, not a booking success.
            visit['reservation'] = dict(type='entry', date=a['date'], start=a['start'], end=a['end'], status='pending', url='')
            point['visit'] = visit
    return candidate, p, candidate != route


def explicit(prompt, proposal, route):
    """Narrow direct-edit authority. Other candidates require a user preview."""
    if len(proposal['actions']) != 1:
        return False
    if re.search(r'如果|假如|是否|够不够|怎样|怎么样|[？?]|不要|不需要|别(?:改|动|锁)|仅.*(?:讨论|建议)', prompt):
        return False
    a = proposal['actions'][0]
    points = [p for d in route['days'] for p in [*d['places'], *([d['hotel']] if d.get('hotel') else [])]]
    point = next((p for p in points if p.get('id') == a.get('place_id')), None)
    if not point or point['name'] not in prompt or sum(p['name'] == point['name'] for p in points) != 1:
        return False
    if a['op'] == 'set_duration':
        return bool(re.search(r'(停留|游玩|参观|时长).*?(?:' + str(a['minutes']) + r'\s*分钟)', prompt))
    if a['op'] == 'lock_visit':
        return ('锁定' in prompt and a['locked']) or ('解锁' in prompt and not a['locked'])
    if a['op'] == 'move_place':
        return bool(re.search(r'(移|挪|调).*?第\s*' + str(a['to_day']) + r'\s*天', prompt)) and not a['before_id']
    return False
