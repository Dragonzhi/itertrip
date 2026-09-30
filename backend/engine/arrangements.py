"""M27: protect human arrangements before an AI edit is accepted. No LLM/network."""
from copy import deepcopy


def protect_arrangements(old: dict, proposed: dict) -> tuple[dict, list[str]]:
    new = deepcopy(proposed)
    def points(route):
        return [(p, di, pi, False) for di, d in enumerate(route.get("days", [])) for pi, p in enumerate(d.get("places", []))] + [(d["hotel"], di, -1, True) for di, d in enumerate(route.get("days", [])) if d.get("hotel")]
    before, after = points(old), points(new)
    reasons = []
    matched = set()
    for p, di, pi, hotel in before:
        matches = [item for item in after if p.get("id") and item[0].get("id") == p["id"] and item[3] == hotel]
        if not matches:
            # Missing IDs can only be recovered from an unambiguous same-kind name.
            old_names = [item for item in before if item[0].get("name") == p.get("name") and item[3] == hotel]
            candidates = [item for item in after if not item[0].get("id") and item[0].get("name") == p.get("name") and item[3] == hotel]
            if len(old_names) == len(candidates) == 1:
                matches = candidates
        match = matches[0] if len(matches) == 1 else None
        v = p.get("visit") or {}
        reservation = v.get("reservation") or {}
        fixed = v.get("locked") or v.get("completed") or (reservation and reservation.get("status") != "cancelled")
        moved = match and (match[1:3] != (di, pi) or any(match[0].get(k) != p.get(k) for k in ("name", "lat", "lng")))
        if ((fixed or v.get("required")) and not match) or (fixed and moved):
            reasons.append(f"「{p.get('name', '站点')}」为必去、固定或已完成站点，拒绝删除／移动")
        if match:
            q = match[0]
            matched.add(id(q))
            if p.get("id"):
                q["id"] = p["id"]
            q["visit"] = deepcopy(p.get("visit"))
            q["opening"] = deepcopy(p.get("opening", []))
            if hotel:
                for quote in q.get("prices", []):
                    prior = next((v for v in p.get("prices", []) if v.get("platform") == quote.get("platform") and v.get("price") == quote.get("price") and bool(v.get("breakfast")) == bool(quote.get("breakfast"))), {})
                    quote["breakfast_known"] = bool(prior.get("breakfast_known"))
                    for key in ("source_url", "queried_at", "check_in", "check_out", "room", "occupancy", "cancellation", "unit"):
                        quote[key] = prior.get(key, "")
    # For genuinely new points, the model may propose prose but cannot mint confirmed records.
    for p, *_ in after:
        if id(p) not in matched:
            p.pop("visit", None); p.pop("opening", None)
            for quote in p.get("prices", []):
                quote["breakfast_known"] = False
                for key in ("source_url", "queried_at", "check_in", "check_out", "room", "occupancy", "cancellation", "unit"):
                    quote.pop(key, None)
    for di, d in enumerate(new.get("days", [])):
        prior = old.get("days", [])[di] if di < len(old.get("days", [])) else {}
        for key in ("schedule", "traffic_mode", "start_from_hotel", "transport"):
            if key in prior:
                d[key] = deepcopy(prior[key])
            else:
                d.pop(key, None)
    for key in ("start_date", "date_source", "dates"):
        if key in old.get("trip", {}):
            new.setdefault("trip", {})[key] = old["trip"][key]
        else:
            new.get("trip", {}).pop(key, None)
    return new, reasons
