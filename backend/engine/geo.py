"""坐标工具：WGS84 → GCJ-02 纠偏 + 球面距离。

全链路坐标系约定（2026-09 起）：route JSON 内的 lat/lng 统一存 GCJ-02（火星坐标），
与高德瓦片（网页地图 + 导出模板主源）显示一致，手工选点（Leaflet 点击高德瓦片取到的
即 GCJ-02）天然吻合。LLM/搜索等外部来源的 WGS84 坐标在进入 route 前必须经
wgs84_to_gcj02 转换；高德 API 直接返回 GCJ-02，无需转换。
"""

import math

_A = 6378245.0  # 克拉索夫斯基椭球长半轴
_EE = 0.00669342162296594323  # 第一偏心率的平方


def _transform_lat(x: float, y: float) -> float:
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * math.pi) + 320.0 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lng(x: float, y: float) -> float:
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    return ret


def out_of_china(lat: float, lng: float) -> bool:
    """粗判是否在中国大陆坐标范围外（范围外不做纠偏，原样返回）。"""
    return not (73.66 < lng < 135.05 and 3.86 < lat < 53.55)


def in_china(lat, lng, margin_deg: float = 0.0) -> bool:
    """是否落在中国大陆粗略范围内（可带容差）。

    M19 用途：境内行程里落在范围外的点几乎一定是错的（幻觉坐标 / 把 lat,lng 写反），
    比「偏离行程中心 100km」这类相对判据更能抓住绝对错误。非法值一律按「不在境内」处理。
    """
    try:
        la, ln = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    return (3.86 - margin_deg) < la < (53.55 + margin_deg) and (73.66 - margin_deg) < ln < (135.05 + margin_deg)


def wgs84_to_gcj02(lat: float, lng: float) -> tuple[float, float]:
    """WGS84 → GCJ-02（国测局火星坐标）。境外坐标原样返回。精度约 1m，足够地图显示。"""
    if out_of_china(lat, lng):
        return lat, lng
    dlat = _transform_lat(lng - 105.0, lat - 35.0)
    dlng = _transform_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * math.pi
    magic = 1 - _EE * math.sin(radlat) ** 2
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((_A * (1 - _EE)) / (magic * sqrtmagic) * math.pi)
    dlng = (dlng * 180.0) / (_A / sqrtmagic * math.cos(radlat) * math.pi)
    return round(lat + dlat, 6), round(lng + dlng, 6)


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点球面距离（km），用于离谱坐标检测。"""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = p2 - p1
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
