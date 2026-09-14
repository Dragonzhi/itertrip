"""临时探针：用真实 builder 生成一份自包含导出 HTML 到 frontend/test-artifacts/export.html，
供 mobile-shot.mjs 量它在手机尺寸下的布局（node 侧执行时加 SHOT_URL）。
用法: .venv\\Scripts\\python.exe backend\\_probe_export.py
"""
import json, pathlib, sys
sys.path.insert(0, ".")
from backend.engine.builder import build_html
route = {
  "trip": {"title": "国庆长沙6日游：山水洲城与烟火湘味", "destination": "长沙", "days": 2, "dates": "10月1日–10月2日", "budget": "3000", "travelers": "2人"},
  "days": [
    {"day": 1, "theme": "抵达与夜市", "places": [{"name": "橘子洲头", "lat": 28.1663, "lng": 112.9636, "type": "attraction", "time": "14:00", "transport": "地铁2号线", "ticket": "免费", "note": "看毛主席青年艺术雕塑"}], "hotel": {"name": "五一广场某酒店", "lat": 28.1952, "lng": 112.9828, "note": "含早", "prices": [{"platform": "携程", "price": 468, "breakfast": True, "note": ""}]}},
    {"day": 2, "theme": "博物馆与湘菜", "places": [{"name": "湖南博物院", "lat": 28.2113, "lng": 112.9955, "type": "attraction", "time": "09:00", "transport": "打车", "ticket": "免费预约", "note": "周一闭馆"}], "hotel": None}
  ],
  "summary": ["节假日地铁比打车快；博物院需提前预约。"]
}
pathlib.Path("frontend/test-artifacts/export.html").write_text(build_html(route), encoding="utf-8")
print("ok")