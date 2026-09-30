"""M26: bounded Amap queries; estimates are snapshots, never LLM inventions."""
import asyncio
import copy
import hashlib
import json
import math
import time
from collections import OrderedDict, deque
from datetime import datetime, timezone

import httpx

from .coordinates import _amap_key

SOURCE_URL = "https://lbs.amap.com/api/webservice/guide/api/direction"
MAX_CALLS = 24
TIMEOUT = 8
DEADLINE = 40
TTL = 900
_cache = OrderedDict()
_inflight = {}
_recent = deque()
_circuit = {}
_next_slot = 0.0


def number(value):
    if isinstance(value, bool) or isinstance(value, (list, dict)):
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) and n >= 0 else None
    except (TypeError, ValueError):
        return None


def trusted(p):
    lat, lng = p.get("lat"), p.get("lng")
    if isinstance(lat, bool) or isinstance(lng, bool):
        return False
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return False
    if not math.isfinite(lat) or not math.isfinite(lng) or not (0 < lat <= 55 and 72 <= lng <= 136):
        return False
    if p.get("confidence") == "low" or "坐标待确认" in p.get("note", "") or "mock 占位" in p.get("note", ""):
        return False
    return p.get("source") in ("user", "memory") or (p.get("source") == "amap" and p.get("confidence") == "high")


def unknown(mode, reason):
    return dict(mode=mode, status="unknown", reason=reason, queried_at=datetime.now(timezone.utc).isoformat(),
                source="amap", source_url=SOURCE_URL)


def parse(data, mode):
    if "_option" in data:
        return copy.deepcopy(data["_option"])
    route = data.get("route")
    route = route if isinstance(route, dict) else {}
    paths = route.get("transits" if mode == "bus" else "paths") or []
    candidates = [p for p in paths if isinstance(p, dict) and number(p.get("duration")) is not None] if isinstance(paths, list) else []
    if not candidates:
        return unknown(mode, "高德未返回可用方案或耗时")
    p = min(candidates, key=lambda p: number(p.get("duration")))
    distance = number(p.get("distance"))
    walking = distance if mode == "walk" else number(p.get("walking_distance")) if mode == "bus" else 0
    fee = 0 if mode == "walk" else number(p.get("cost")) if mode == "bus" else number(route.get("taxi_cost"))
    names = []
    if mode == "bus":
        for seg in p.get("segments") or []:
            if not isinstance(seg, dict) or not isinstance(seg.get("bus"), dict):
                continue
            for line in seg["bus"].get("buslines") or []:
                if isinstance(line, dict) and line.get("name"):
                    names.append(str(line["name"]))
    return dict(mode=mode, status="ok", duration_s=number(p["duration"]), distance_m=distance,
                walking_m=walking, fee_yuan=fee, tolls_yuan=number(p.get("tolls")) if mode == "car" else None,
                fee_kind="taxi_estimate" if mode == "car" else "transit" if mode == "bus" else "walking",
                description=" → ".join(names[:6]), queried_at=datetime.now(timezone.utc).isoformat(),
                source="amap", source_url=SOURCE_URL)


class QueryError(Exception):
    pass


class Session:
    def __init__(self, key):
        self.key = key
        self.fingerprint = hashlib.sha256(key.encode()).hexdigest()[:16]
        self.started = time.monotonic()
        self.calls = 0
        self.hits = 0
        self.dedup = 0
        self.reason = ""
        self.net_fails = 0

    async def get(self, client, path, params):
        global _next_slot
        ck = (self.fingerprint, path, json.dumps(params, sort_keys=True))
        now = time.monotonic()
        cached = _cache.get(ck)
        if cached and now - cached[0] < TTL:
            self.hits += 1
            return copy.deepcopy(cached[1])
        if ck in _inflight:
            self.dedup += 1
            # Bounded join. Cancelling this caller does not cancel another request's query.
            return copy.deepcopy(await asyncio.wait_for(asyncio.shield(_inflight[ck]), TIMEOUT + 1))
        reason = self.reason
        circuit = _circuit.get(self.fingerprint)
        if circuit and now < circuit[0]:
            reason = circuit[1]
        if self.calls >= MAX_CALLS:
            reason = "本次查询已达 24 次预算，未查到的交通耗时未知"
        if now - self.started >= DEADLINE:
            reason = "本次查询已达 40 秒预算"
        while _recent and now - _recent[0] >= 60:
            _recent.popleft()
        if len(_recent) >= 60:
            reason = "交通查询较频繁，请稍后重试"
        if reason:
            self.reason = reason
            raise QueryError(reason)
        # Space requests across all callers; reservation happens before yielding.
        slot = max(time.monotonic(), _next_slot)
        if slot - self.started >= DEADLINE:
            self.reason = "交通请求队列已达 40 秒预算，请稍后重试"
            raise QueryError(self.reason)
        self.calls += 1
        _recent.append(now)
        _next_slot = slot + 0.35

        async def fetch():
            wait = slot - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                resp = await client.get("https://restapi.amap.com" + path, params={**params, "key": self.key})
                resp.raise_for_status()
                data = resp.json()
                if not isinstance(data, dict):
                    raise ValueError()
            except (httpx.HTTPError, ValueError):
                self.net_fails += 1
                if self.net_fails >= 2:
                    self.reason = "高德连续两次网络或响应异常，本次停止查询"
                # Never expose exception URLs, request keys, or provider error bodies.
                raise QueryError("高德请求超时、网络或响应异常") from None
            if str(data.get("status")) != "1":
                code = str(data.get("infocode") or "")
                if code in ("10001", "10003", "10004", "10044", "10009", "10010", "10021"):
                    self.reason = "高德 Key 权限、配额或频率限制，请检查服务端配置"
                    _circuit[self.fingerprint] = (time.monotonic() + 60, self.reason)
                raise QueryError(self.reason or "高德暂未提供可用路径")
            self.net_fails = 0
            # Cache normalized metrics, not large polylines/steps or sensitive request URLs.
            if "/direction/" in path:
                mode = "bus" if "transit" in path else "car" if "driving" in path else "walk"
                data = {"status": "1", "_option": parse(data, mode)}
            elif "regeo" in path:
                geo = data.get("regeocode")
                address = geo.get("addressComponent") if isinstance(geo, dict) else None
                code = address.get("citycode") if isinstance(address, dict) else None
                data = {"status": "1", "regeocode": {"addressComponent": {"citycode": code}}}
            # Preserve query timestamp across cache hits.
            data["_queried_at"] = datetime.now(timezone.utc).isoformat()
            _cache[ck] = (time.monotonic(), copy.deepcopy(data))
            _cache.move_to_end(ck)
            while len(_cache) > 512:
                _cache.popitem(last=False)
            return data

        task = asyncio.create_task(fetch())
        _inflight[ck] = task
        try:
            return await task
        finally:
            _inflight.pop(ck, None)

    async def city(self, client, p):
        # Use coordinates rather than trusting an imported city's label/code.
        data = await self.get(client, "/v3/geocode/regeo", {"location": coord(p), "extensions": "base"})
        code = (data.get("regeocode") or {}).get("addressComponent", {}).get("citycode")
        if not isinstance(code, str) or not code.isdigit():
            raise QueryError("无法确认公交起终点城市")
        return code

    async def option(self, client, edge, mode):
        if not trusted(edge["from"]) or not trusted(edge["to"]):
            return unknown(mode, "请先在编辑器确认起终点坐标；交通耗时未知")
        if not self.key:
            return unknown(mode, "服务端未配置高德 Web 服务 Key；交通耗时未知")
        params = {"origin": coord(edge["from"]), "destination": coord(edge["to"]), "extensions": "all"}
        path = "/v3/direction/" + {"walk": "walking", "bus": "transit/integrated", "car": "driving"}[mode]
        try:
            if mode == "bus":
                params["city"] = await self.city(client, edge["from"])
                params["cityd"] = await self.city(client, edge["to"])
                params["strategy"] = 0
            elif mode == "car":
                params["strategy"] = 0
                params["nosteps"] = 1
                for p, field in ((edge["from"], "originid"), (edge["to"], "destinationid")):
                    poi_id = p.get("poi_id", "")
                    if p.get("source") == "amap" and isinstance(poi_id, str) and poi_id.isalnum() and len(poi_id) <= 40:
                        params[field] = poi_id
            data = await self.get(client, path, params)
            result = parse(data, mode)
            if result["status"] == "ok":
                result["queried_at"] = data["_queried_at"]
            return result
        except (QueryError, asyncio.TimeoutError) as e:
            return unknown(mode, str(e) if isinstance(e, QueryError) else "交通查询等待超时")


def coord(p):
    return f'{p["lng"]:.6f},{p["lat"]:.6f}'


async def query(edges, modes, *, key=None, client=None):
    session = Session(_amap_key() if key is None else key)

    async def run(http):
        results = []
        # Sequential bounded calls protect low-QPS keys; no NxN matrix, no automatic retries.
        for edge in edges:
            options = [await session.option(http, edge, mode) for mode in modes]
            results.append({"signature": edge["signature"], "options": options})
        return {"results": results, "stats": {"calls": session.calls, "cache_hits": session.hits,
                "deduplicated": session.dedup, "budget": MAX_CALLS, "reason": session.reason,
                "elapsed_ms": int((time.monotonic() - session.started) * 1000)}}

    if client is not None:
        return await run(client)
    async with httpx.AsyncClient(timeout=TIMEOUT) as http:
        return await run(http)
