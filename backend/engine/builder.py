"""HTML 构建：把 route JSON 注入模板，生成自包含 HTML。

移植自旧版 scripts/build_html.py（CLI 版），改为可导入函数供 POST /api/export 调用。
模板位于 backend/templates/route_map.html（自旧版 git 历史恢复）。
"""

import json
from pathlib import Path

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "templates" / "route_map.html"
PLACEHOLDER = "__TRIP_DATA__"


class BuildError(Exception):
    """route 数据或模板问题导致的构建失败（对应 HTTP 422）。"""


def _validate(route: dict) -> None:
    """与旧版 build_html.py 相同的校验，不通过抛 BuildError。"""
    if not isinstance(route, dict):
        raise BuildError("route 顶层必须是对象")
    if "trip" not in route:
        raise BuildError("缺少 trip 字段")
    days = route.get("days")
    if not isinstance(days, list) or not days:
        raise BuildError("days 必须是非空数组")
    for i, day in enumerate(days):
        if not isinstance(day, dict):
            raise BuildError(f"days[{i}] 必须是对象")
        places = day.get("places", [])
        if not isinstance(places, list):
            raise BuildError(f"days[{i}].places 必须是数组")
        for j, p in enumerate(places):
            if not isinstance(p, dict) or p.get("lat") is None or p.get("lng") is None:
                raise BuildError(f"days[{i}].places[{j}] 缺少坐标(lat/lng)")


def build_html(route: dict) -> str:
    """route dict -> 自包含 HTML 字符串。失败抛 BuildError。"""
    _validate(route)
    if not TEMPLATE_PATH.exists():
        raise BuildError(f"找不到模板: {TEMPLATE_PATH}")
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    if PLACEHOLDER not in template:
        raise BuildError(f"模板中未找到占位符 {PLACEHOLDER}")

    data_json = json.dumps(route, ensure_ascii=False, indent=2)
    # 硬化：转义 "</" 防 place 名称里出现 </script> 提前终止脚本标签。
    # JSON 中 \/ 是合法转义，JS 字符串里 <\/ 与 </ 同值，不影响模板解析。
    data_json = data_json.replace("</", "<\\/")
    return template.replace(PLACEHOLDER, data_json)