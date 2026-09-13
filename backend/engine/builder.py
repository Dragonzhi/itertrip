"""HTML 构建：把 route JSON 注入模板，生成自包含 HTML。

移植自旧版 scripts/build_html.py（CLI 版），改为可导入函数供 POST /api/export 调用。
模板位于 backend/templates/route_map.html（自旧版 git 历史恢复）。

v1.1 导出清洗：剔除无坐标/(0,0) 地点与无效酒店（防 422 失败与「非洲点」），
剔除名单追加进导出副本的 summary，信息不静默丢失。
"""

import copy
import json
from pathlib import Path

TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "templates" / "route_map.html"
PLACEHOLDER = "__TRIP_DATA__"


class BuildError(Exception):
    """route 数据或模板问题导致的构建失败（对应 HTTP 422）。"""


def _bad_coord(v) -> bool:
    """None / 非 / (0,0) 都视为无效坐标（0,0 落在几内亚湾，即用户口中的「非洲点」）。"""
    if not isinstance(v, (int, float)):
        return True
    return v == 0


def _sanitize(route: dict) -> tuple[dict, list[str]]:
    """导出副本清洗：剔除无效坐标的地点/酒店，返回 (副本, 剔除名单)。不改入参。"""
    data = copy.deepcopy(route)
    dropped: list[str] = []
    for day in data.get("days") or []:
        if not isinstance(day, dict):
            continue
        kept = []
        for p in day.get("places") or []:
            if not isinstance(p, dict) or _bad_coord(p.get("lat")) or _bad_coord(p.get("lng")):
                dropped.append(str((p or {}).get("name") or "未命名地点"))
            else:
                kept.append(p)
        day["places"] = kept
        h = day.get("hotel")
        if isinstance(h, dict) and (_bad_coord(h.get("lat")) or _bad_coord(h.get("lng"))):
            day["hotel"] = None  # 酒店画不出 pin，但天数/行程信息保留
    if dropped:
        note = "以下地点因缺少有效坐标，未在导出地图中显示：" + "、".join(dropped)
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
    # 硬化：转义 "</" 防 place 名称里出现 </script> 提前终止脚本标签。
    # JSON 中 / 是合法转义，JS 字符串里 <\/ 与 </ 同值，不影响模板解析。
    data_json = data_json.replace("</", "<\\/")
    return template.replace(PLACEHOLDER, data_json)
