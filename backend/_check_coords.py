"""M39 坐标链回归（零网络）：回显降级、自然景区类型、复合目的地、预算/缓存、占位酒店。

用法：.venv\\Scripts\\python.exe -m backend._check_coords
"""
import asyncio
import json
import sys
from unittest.mock import patch

sys.path.insert(0, ".")

from backend.api import chat  # noqa: E402
from backend.engine import coordinates as C  # noqa: E402
from backend.engine import planner  # noqa: E402
from backend.engine.schema import RouteJSON  # noqa: E402

PASS = 0
FAIL: list[str] = []


def check(name: str, cond: bool, extra: str = "") -> None:
    global PASS
    if cond:
        PASS += 1
        print(f"  [ok] {name}")
    else:
        FAIL.append(name)
        print(f"  [FAIL] {name} {extra}")


def route_obj(days: list[dict]) -> RouteJSON:
    return RouteJSON.model_validate({
        "trip": {"title": "坐标回归", "destination": "长沙", "days": len(days)},
        "days": days,
    })


def test_parse_region() -> None:
    print("[1] 复合目的地解析")
    check("湖南·长沙", C.parse_region("湖南·长沙") == (["湖南"], ["长沙"]), str(C.parse_region("湖南·长沙")))
    check("长沙", C.parse_region("长沙") == ([], ["长沙"]), str(C.parse_region("长沙")))
    check("长沙·岳麓山 仍解析出长沙", "长沙" in C.parse_region("长沙·岳麓山")[1])
    check("长沙岳麓山-橘子洲 能拆出长沙", "长沙" in C.parse_region("长沙岳麓山-橘子洲")[1],
          str(C.parse_region("长沙岳麓山-橘子洲")))
    check("长沙湾 不被误判为长沙", "长沙" not in C.parse_region("长沙湾")[1], str(C.parse_region("长沙湾")))
    check("长沙湾 没有目的地锚点", C.destination_anchor("长沙湾") is None)


def test_name_scores() -> None:
    print("[2] 自然景区类型不再被误惩罚")
    yuelu = {"name": "岳麓山", "type": "风景名胜;自然地名;山/岛屿", "location": "112.93,28.18"}
    juzi = {"name": "橘子洲", "type": "风景名胜;自然地名;岛屿", "location": "112.96,28.19"}
    road = {"name": "岳麓山路", "type": "道路附属设施;道路", "location": "112.93,28.18"}
    metro = {"name": "橘子洲地铁站", "type": "交通设施;地铁站", "location": "112.96,28.19"}
    check("岳麓山景区 → 岳麓山 ≥0.85", C._candidate_score(yuelu, "岳麓山景区", "attraction", "岳麓山景区") >= 0.85,
          str(C._candidate_score(yuelu, "岳麓山景区", "attraction", "岳麓山景区")))
    check("橘子洲景区 → 橘子洲 ≥0.85", C._candidate_score(juzi, "橘子洲景区", "attraction", "橘子洲景区") >= 0.85)
    check("道路候选仍被拒", C._candidate_score(road, "岳麓山景区", "attraction", "岳麓山景区") < C._AMAP_MIN_SCORE)
    check("地铁站候选仍被拒", C._candidate_score(metro, "橘子洲景区", "attraction", "橘子洲景区") < C._AMAP_MIN_SCORE)


def test_echo_conversion() -> None:
    print("[3] 编辑回显不再二次转换/降级")
    old = route_obj([
        {"day": 1, "schedule": {"start": "09:00", "end": "18:00"},
         "places": [{"id": "p1", "name": "岳麓山", "lat": 28.196538, "lng": 112.972119,
                     "source": "amap", "confidence": "high"}],
         "hotel": {"id": "h1", "name": "树木岭地铁站附近连锁酒店（自选）",
                   "lat": 28.120000, "lng": 113.010000, "source": "amap", "confidence": "high"}},
        {"day": 2, "schedule": {"start": "09:00", "end": "18:00"},
         "places": [],
         "hotel": {"id": "h2", "name": "树木岭地铁站附近连锁酒店（自选）",
                   "lat": 28.120000, "lng": 113.010000, "source": "amap", "confidence": "high"}},
    ])
    new = json.loads(json.dumps(old.model_dump()))
    new["days"][0]["places"][0]["lat"] = 28.1965  # 模型保留 4 位小数
    new["days"][0]["places"][0]["lng"] = 112.9721
    new["days"][0]["hotel"]["lat"] = 28.1200
    new["days"][0]["hotel"]["lng"] = 113.0100
    new["days"][1]["hotel"]["lat"] = 28.12
    new["days"][1]["hotel"]["lng"] = 113.01
    out = planner.convert_new_coords(RouteJSON.model_validate(new), old)
    check("同名点回显保留原坐标", out.days[0].places[0].lat == 28.196538)
    check("同名点回显保留 amap/high", (out.days[0].places[0].source, out.days[0].places[0].confidence) == ("amap", "high"))
    check("同名酒店按 id 回显保留来源", out.days[0].hotel.source == "amap")
    check("第 2 天同名酒店不被折叠", out.days[1].hotel.source == "amap")

    moved = json.loads(json.dumps(old.model_dump()))
    moved["days"][0]["places"][0]["lat"] = 30.0
    moved["days"][0]["places"][0]["lng"] = 114.0
    out2 = planner.convert_new_coords(RouteJSON.model_validate(moved), old)
    check("真正移动的坐标仍会转换", abs(out2.days[0].places[0].lat - 30.0) > 1e-3)
    check("真正移动的坐标标 llm/high", (out2.days[0].places[0].source, out2.days[0].places[0].confidence) == ("llm", "high"))


def test_budget_cache() -> None:
    print("[4] 预算与缓存")
    poi = {"name": "岳麓山", "type": "风景名胜;自然地名;山/岛屿", "location": "112.93,28.18",
           "pname": "湖南省", "cityname": "长沙市", "adname": "岳麓区"}
    calls = {"n": 0}

    async def fake_query(client, key, query, city, citylimit=True):
        calls["n"] += 1
        return [poi], "", False

    async def run():
        session = C.AmapSession(max_calls=1)
        with patch.object(C, "_amap_key", return_value="synthetic"), patch.object(C, "_amap_query", new=fake_query):
            hit = await C.geocode_amap_scored("岳麓山", "长沙", "attraction", session)
            check("首次查询命中", hit is not None and hit[2] >= 0.85, str(hit))
            session.calls = session.max_calls  # 预算耗尽
            again = await C.geocode_amap_scored("岳麓山", "长沙", "attraction", session)
            check("预算耗尽后仍复用缓存", again is not None and again == hit, str(again))
            other = await C.geocode_amap_scored("橘子洲", "长沙", "attraction", session)
            check("预算耗尽后新查询返回未命中", other is None)
            check("预算耗尽原因可见", "上限" in session.reason, session.reason)
        check("同名查询只打了一次接口", calls["n"] == 1, str(calls))

    asyncio.run(run())


def test_placeholder_hotel() -> None:
    print("[5] 占位酒店识别")
    check("树木岭附近连锁酒店是占位名", planner._is_placeholder_hotel("树木岭地铁站附近连锁酒店（自选）"))
    check("具体品牌分店不是占位名", not planner._is_placeholder_hotel("全季酒店（春熙路店）"))


def test_realtime_records() -> None:
    print("[6] _enrich_coordinates 逐点回调与弱匹配文案")
    route = route_obj([
        {"day": 1, "schedule": {"start": "09:00", "end": "18:00"},
         "places": [{"id": "p1", "name": "岳麓山景区", "lat": 28.196538, "lng": 112.972119,
                     "source": "llm", "confidence": "high", "type": "attraction"}],
         "hotel": None},
    ])
    seen: list[dict] = []

    async def fake_amap(name, city, hint="", session=None, near=None):
        return (28.1969, 112.9723, 0.92, 1)

    async def run():
        with patch.object(C, "amap_enabled", return_value=True), \
             patch.object(planner, "geocode_amap_scored", new=fake_amap):
            await planner._enrich_coordinates(route, "长沙", on_record=seen.append)

    asyncio.run(run())
    check("逐点记录通过 on_record 实时回调", bool(seen), str(seen))
    check("强匹配记录为 align/replace", seen and seen[0]["action"] in ("align", "replace"), str(seen))
    step = chat._geo_step({"id": "geo:x", "name": "岳麓山景区", "action": "confirm", "level": "amap",
                           "confidence": "high", "dist_km": 0.542, "score": 0.72, "ms": 10})
    check("确认型弱匹配不显示为核验一致", step["status"] == "skip" and "未采用" in step["detail"], str(step))


def main() -> None:
    test_parse_region()
    test_name_scores()
    test_echo_conversion()
    test_budget_cache()
    test_placeholder_hotel()
    test_realtime_records()
    print()
    if FAIL:
        print(f"M39 coords: {PASS} passed / {len(FAIL)} failed -> {FAIL}")
        sys.exit(1)
    print(f"M39 coords passed ({PASS} checks)")


if __name__ == "__main__":
    main()
