#!/usr/bin/env python3
"""
IterTrip · build_html.py
把行程 route JSON 注入 route_map.html 模板，生成自包含的 HTML 地图路线图。

用法:
    python3 build_html.py <route.json> [输出.html]

不指定输出路径时，默认写到与 JSON 同名的 .html 文件。
零第三方依赖，仅用 Python 标准库。
"""
import json
import sys
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "templates" / "route_map.html"
PLACEHOLDER = "__TRIP_DATA__"


def validate(route: dict) -> list:
    """基础校验，返回错误信息列表（空列表 = 通过）。"""
    errors = []
    if not isinstance(route, dict):
        return ["route 顶层必须是对象"]
    if "trip" not in route:
        errors.append("缺少 trip 字段")
    days = route.get("days")
    if not isinstance(days, list) or not days:
        errors.append("days 必须是非空数组")
    for i, day in enumerate(days or []):
        if not isinstance(day, dict):
            errors.append(f"days[{i}] 必须是对象")
            continue
        places = day.get("places", [])
        if not isinstance(places, list):
            errors.append(f"days[{i}].places 必须是数组")
        for j, p in enumerate(places):
            if isinstance(p, dict) and (p.get("lat") is None or p.get("lng") is None):
                errors.append(f"days[{i}].places[{j}] 缺少坐标(lat/lng)")
    return errors


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".html")

    try:
        route = json.loads(src.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"[错误] 读取/解析 JSON 失败: {e}")
        return 1

    errors = validate(route)
    if errors:
        print("[错误] 校验未通过:")
        for e in errors:
            print(f"  - {e}")
        return 1

    if not TEMPLATE.exists():
        print(f"[错误] 找不到模板: {TEMPLATE}")
        return 1

    template = TEMPLATE.read_text(encoding="utf-8")
    if PLACEHOLDER not in template:
        print(f"[错误] 模板中未找到占位符 {PLACEHOLDER}")
        return 1

    data_json = json.dumps(route, ensure_ascii=False, indent=2)
    html = template.replace(PLACEHOLDER, data_json)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"[完成] 已生成: {out} ({len(html)} 字节)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
