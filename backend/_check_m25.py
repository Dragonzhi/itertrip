"""M25 export contracts + disposable browser fixtures. Run from repository root."""
import copy
import json
import re
from pathlib import Path

from backend.engine.builder import build_html

route = {
    "trip": {"title": "M25 成都出行验收", "destination": "成都", "days": 2},
    "days": [
        {"day": 1, "theme": "城南散步", "places": [
            {"name": "武侯祠", "lat": 30.6414, "lng": 104.0499, "source": "amap", "confidence": "high", "time": "09:00"},
            {"name": "锦里", "lat": 30.6412, "lng": 104.0511, "source": "llm", "confidence": "high"},
            {"name": "城市中心占位", "lat": 30.66, "lng": 104.06, "source": "city", "confidence": "low"},
            {"name": "尚未定位的小店", "lat": 0, "lng": 0, "source": "none"},
        ], "hotel": {"name": "测试酒店（非真实预订）", "lat": 30.65, "lng": 104.06, "source": "user", "prices": []}},
        {"day": 2, "theme": "市区公园", "places": [{"name": "人民公园", "lat": 30.657, "lng": 104.056, "source": "user", "time": "10:00"}], "hotel": None},
    ],
}
original = copy.deepcopy(route)
html = build_html(route)
assert route == original
data = json.loads(re.search(r"const TRIP = (.*?);\n", html, re.S).group(1))
assert len(data["days"][0]["places"]) == 4
assert data["days"][0]["places"][3]["lat"] is None
assert "__NAVIGATION_CORE__" not in html and "__EXPORT_NAVIGATION__" not in html
assert html.index("IterTripExportNavigation.init") < html.index("const map = L.map")
assert "if (typeof L !==" in html
assert "IterTripExportNavigation.attach(card, h" in html
assert "popupopen" in html
bad = copy.deepcopy(route)
bad["days"][0]["hotel"]["lat"] = float("nan")
bad["days"][0]["places"][0]["name"] = "</script> __EXPORT_NAVIGATION__ $& 测试"
bad["days"][0]["places"][0]["note"] = '<img src=x onerror="alert(1)">'
bad_html = build_html(bad)
bad_data = json.loads(re.search(r"const TRIP = (.*?);\n", bad_html, re.S).group(1))
assert bad_data["days"][0]["hotel"]["lat"] is None
assert "__EXPORT_NAVIGATION__" in bad_data["days"][0]["places"][0]["name"]
assert "</script> __EXPORT" not in bad_html
artifact = Path("frontend/test-artifacts/m25")
artifact.mkdir(parents=True, exist_ok=True)
(artifact / "route.json").write_text(json.dumps(route, ensure_ascii=False), encoding="utf-8")
(artifact / "export.html").write_text(html, encoding="utf-8")
(artifact / "export-hostile.html").write_text(bad_html, encoding="utf-8")
# A deterministic missing-map fixture verifies that navigation survives unavailable CDN scripts.
(artifact / "export-no-map.html").write_text(html.replace('<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>', ""), encoding="utf-8")
print("M25 export contracts passed; fixtures in frontend/test-artifacts/m25")
