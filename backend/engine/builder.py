"""HTML 构建：把 route JSON 注入模板，生成自包含 HTML。

移植自旧版 scripts/build_html.py（CLI 版），改为可导入函数供 POST /api/export 调用。
模板位于 backend/templates/route_map.html（自旧版 git 历史恢复）。

M25 导出清洗：无坐标/(0,0) 地点与无效酒店保留在清单中，坐标设为 null，
隐藏无效地图 pin 并允许按名称搜索；导航脚本独立于地图依赖。
"""

import copy
import json
import math
from pathlib import Path

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "templates" / "route_map.html"
PLACEHOLDER = "__TRIP_DATA__"
NAVIGATION_PATH = Path(__file__).resolve().parents[2] / "shared" / "navigation.js"
EXPORT_NAVIGATION_PATH = TEMPLATE_PATH.parent / "navigation.js"
TRANSPORT_PATH = NAVIGATION_PATH.parent / "transport.js"
EXPORT_TRANSPORT_PATH = TEMPLATE_PATH.parent / "transport.js"


class BuildError(Exception):
    """route 数据或模板问题导致的构建失败（对应 HTTP 422）。"""


def _bad_coord(v) -> bool:
    """None / 非 / (0,0) 都视为无效坐标（0,0 落在几内亚湾，即用户口中的「非洲点」）。"""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return True
    return v == 0


def _sanitize(route: dict) -> tuple[dict, list[str]]:
    """保留缺坐标站点用于名称搜索；仅隐藏其地图 pin。不改入参。"""
    data = copy.deepcopy(route)
    dropped: list[str] = []
    for day in data.get("days") or []:
        if not isinstance(day, dict):
            continue
        kept = []
        for p in day.get("places") or []:
            if not isinstance(p, dict):
                continue
            if _bad_coord(p.get("lat")) or _bad_coord(p.get("lng")) or abs(p["lat"]) > 90 or abs(p["lng"]) > 180:
                dropped.append(str(p.get("name") or "未命名地点"))
                p["lat"] = p["lng"] = None
            kept.append(p)
        day["places"] = kept
        h = day.get("hotel")
        if isinstance(h, dict) and (_bad_coord(h.get("lat")) or _bad_coord(h.get("lng")) or abs(h["lat"]) > 90 or abs(h["lng"]) > 180):
            h["lat"] = h["lng"] = None
            dropped.append(str(h.get("name") or "未命名酒店"))
    if dropped:
        note = "以下地点缺少有效坐标，已保留在清单中，可按名称搜索；地图不显示标记：" + "、".join(dropped)
        summary = data.get("summary")
        data["summary"] = ([*summary, note] if isinstance(summary, list) else [note])
    return data, dropped


def _validate(route: dict) -> None:
    """结构校验（坐标有效性已由 _sanitize 保证，不再因缺坐标整单失败）。"""
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
        if not isinstance(day.get("places", []), list):
            raise BuildError(f"days[{i}].places 必须是数组")


def build_html(route: dict) -> str:
    """route dict -> 自包含 HTML 字符串。失败抛 BuildError。"""
    data, _dropped = _sanitize(route)
    _validate(data)
    if not TEMPLATE_PATH.exists():
        raise BuildError(f"找不到模板: {TEMPLATE_PATH}")
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    if PLACEHOLDER not in template:
        raise BuildError(f"模板中未找到占位符 {PLACEHOLDER}")

    data_json = json.dumps(data, ensure_ascii=False, indent=2)
    # Escape every '<', including script closing tags and HTML comment parser boundaries.
    # JSON/JS decode \u003c back to the original text.
    data_json = data_json.replace("<", "\\u003c")
    # Insert code before user data, so a literal placeholder in a place name stays literal.
    return (template.replace("__NAVIGATION_CORE__", NAVIGATION_PATH.read_text(encoding="utf-8"))
            .replace("__EXPORT_NAVIGATION__", EXPORT_NAVIGATION_PATH.read_text(encoding="utf-8"))
            .replace("__TRANSPORT_CORE__", TRANSPORT_PATH.read_text(encoding="utf-8"))
            .replace("__EXPORT_TRANSPORT__", EXPORT_TRANSPORT_PATH.read_text(encoding="utf-8"))
            .replace(PLACEHOLDER, data_json))
