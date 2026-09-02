"""POST /api/chat —— 对话统一入口（M13 提取 / M14 改路线共用），SSE 流式（体验优化①）。

契约（DESIGN.md §2/§7）：
    输入  { prompt: str, history: [{role, content}], route: RouteJSON | null }
    输出  text/event-stream：
        event: stage    data: {"stage": "understand|retry|geocode|done", "label": str}
        event: delta    data: {"text": str}        # <<<REPLY>>> 段的增量（客户端追加）
        event: reply    data: {"reply": str, "intent": "route_edit|chitchat", "route": ...|null}
        event: error    data: {"detail": str}      # 流开始后的错误（预检失败仍是 HTTP 400）

双段输出协议（让模型先写给人看的过程叙述，再写结构化数据）：
    <<<REPLY>>>给用户的话…
    <<<JSON>>>{...}

模式：
    route 为空 → 攻略提取/规划（SYSTEM_EXTRACT），带坐标补全阶段播报；
    route 非空 → 对话改路线（SYSTEM_EDIT 输出 {reply, changed, days}）。

护栏（DESIGN.md §4.3）：解析/校验失败带错误重试一次；history 只保留最近 8 轮。
"""

import json

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from ..engine.schema import RouteJSON
from .deps import llm_overrides

router = APIRouter()

# ---------------- 系统提示词 ----------------

_SCHEMA_HINT = (
    '{"trip": {"title": str, "destination": str, "days": int, "dates": str, "budget": str, "style": str, '
    '"travelers": str}, "days": [{"day": int, "theme": str, "places": [{"name": str, "lat": float, "lng": float, '
    '"type": "attraction|food|transport|other", "time": str, "transport": str, "ticket": str, "note": str}], '
    '"hotel": {"name": str, "lat": float, "lng": float, "note": str, "prices": []} | null}], "summary": [str]}'
)

SYSTEM_EXTRACT = (
    "你是旅行攻略结构化助手。用户会给你一段旅游攻略文字（可能来自小红书/公众号，"
    "含表情符号、口语、推广内容），或一句旅行需求。你的任务：提取/规划出结构化行程 JSON。"
    "输出必须分两段，第一段是给用户看的过程叙述，第二段是结构化数据，格式如下："
    "第1行：<<<REPLY>>>开头，后面跟 2-4 句给用户的话（你识别出了哪些地点、准备怎么排程）；"
    "第2行：<<<JSON>>>开头，后面跟纯 JSON（不要 markdown 代码块标记），结构："
    + _SCHEMA_HINT + "\n"
    "要求："
    "1. 忠于攻略原文：只提取文中提到的地点，不私自添加；地点顺序保持攻略叙述顺序并按天合理分组\n"
    "2. lat/lng 用你确定知道的真实坐标（WGS84 近似）；不确定就填 0，系统会自动补全；不要编造\n"
    "3. type 只能是 attraction / food / transport / other；type=food 用于餐厅/小吃/美食\n"
    "4. 攻略中的营业时间/门票/贴士写进 time/ticket/note；transport 留空由用户补充\n"
    "5. 攻略提到住宿就填 hotel；没提则 hotel 为 null\n"
    "6. summary 提炼 2-4 条攻略里的关键建议（避坑/预约/交通等），不要泛泛而谈\n"
    '7. 无法确定目的地或提取不到任何地点时，只输出 <<<REPLY>>> 段（后接一个具体的追问），不要输出 <<<JSON>>> 段'
)

SYSTEM_EDIT = (
    "你是行程路线修改助手。你会收到当前行程 JSON（current_route）和用户的修改要求。"
    "输出必须分两段，格式："
    "第1行：<<<REPLY>>>开头，后面用第一人称、一两句话说明你改了什么"
    "（例如「已把成都博物馆挪到第一天下午，空出的上午改为人民公园」）；"
    '第2行：<<<JSON>>>开头，后面跟纯 JSON 对象（不要 markdown 标记）：'
    '{"reply": str, "changed": bool, "days": [<与 current_route.days 完全相同的结构>]}\n'
    "规则："
    "1. changed=true 时必须给出**完整** days 数组（未修改的天原样保留），禁止省略或输出差异片段\n"
    "2. 用户的明确要求优先；涉及时间冲突/动线明显不合理时可在 <<<REPLY>>> 里提醒，但仍按用户要求改\n"
    "3. 闲聊/咨询/与路线无关的请求：changed=false，days 给原样内容，reply 正常回答\n"
    "4. 不增删天；单日地点建议不超过 6 个；不确定的坐标修改保持原值"
)

# ---------------- 请求模型 ----------------


class HistoryItem(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    prompt: str = ""
    history: list[HistoryItem] = Field(default_factory=list)
    route: dict | None = None


# ---------------- LLM 流式调用 ----------------


async def _stream_llm(cfg: dict, system: str, user_text: str, history: list[HistoryItem]):
    """流式调用 LLM，逐段 yield 文本 delta。"""
    messages: list[dict] = [{"role": "system", "content": system}]
    for h in history[-8:]:  # 护栏：只保留最近 8 轮
        messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": user_text})
    async with httpx.AsyncClient(timeout=180) as client:
        async with client.stream(
            "POST",
            cfg["base_url"] + "/chat/completions",
            headers={"Authorization": "Bearer " + cfg["api_key"]},
            json={"model": cfg["model"], "messages": messages, "temperature": 0.4, "stream": True},
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                    piece = chunk["choices"][0]["delta"].get("content")
                    if piece:
                        yield piece
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


def _extract_json(text: str) -> dict:
    """从文本提取 JSON 对象（容忍 markdown 代码块与前后杂文）。"""
    text = text.strip()
    fence = "```"
    if text.startswith(fence):
        nl = text.find("\n")
        text = text[nl + 1:] if nl != -1 else text.lstrip("`")
        if text.rstrip().endswith(fence):
            text = text.rstrip()[:-3]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("未找到 JSON 对象")
    return json.loads(text[start: end + 1])


def _split_reply_json(full: str) -> tuple[str, str | None]:
    """按 <<<REPLY>>>/<<<JSON>>> 协议拆分；无标记时整体当 reply（旧格式兼容）。"""
    if "<<<JSON>>>" in full:
        head, rest = full.split("<<<JSON>>>", 1)
        return head.replace("<<<REPLY>>>", "").strip(), rest.strip()
    if "<<<REPLY>>>" in full:
        return full.replace("<<<REPLY>>>", "").strip(), None
    return full.strip(), None


async def _resolve_cfg(request: Request) -> tuple[dict, bool]:
    """BYOK 解析 + 预检（无 key 抛 HTTP 400，发生在流开始前）。返回 (cfg, is_user_key)。"""
    overrides = llm_overrides(request)
    if overrides and overrides.get("api_key"):
        return overrides, True
    from ..engine.planner import _llm_config

    cfg = _llm_config()
    if cfg is None:
        raise HTTPException(
            status_code=400,
            detail="未配置 LLM：请在右上角「模型设置」填入 API Key，或设置 ITERTRIP_LLM_API_KEY 环境变量",
        )
    return cfg, False


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _short_err(e: Exception) -> str:
    s = str(e)
    if "429" in s:
        return "被供应商限流（429），key 有效但请稍后再试"
    if "401" in s or "Unauthorized" in s:
        return "鉴权失败（401）：请检查 API Key 是否正确"
    if "404" in s:
        return "接口不存在（404）：请检查 Base URL 与模型名"
    if "Connect" in s or "timed out" in s or "timeout" in s.lower():
        return "网络连接失败：请检查 Base URL 是否可达"
    return s[:200]


@router.post("/api/chat")
async def chat(req: ChatRequest, request: Request) -> StreamingResponse:
    cfg, is_user_key = await _resolve_cfg(request)
    edit_mode = req.route is not None

    async def gen():
        yield _sse("stage", {
            "stage": "understand",
            "label": "正在读取攻略并规划路线…" if not edit_mode else "正在分析当前路线…",
        })

        base_payload = (
            f"current_route：\n{json.dumps(req.route, ensure_ascii=False)}\n\n用户要求：{req.prompt}"
            if edit_mode else req.prompt
        )
        system = SYSTEM_EDIT if edit_mode else SYSTEM_EXTRACT

        reply_text = ""
        data: dict | None = None
        parse_err = ""
        exhausted = False  # 重试后仍解析失败

        for attempt in range(2):
            if attempt == 1:
                yield _sse("stage", {"stage": "retry", "label": "格式有点问题，正在重新整理…"})
            payload = base_payload + (
                "\n\n（上次输出解析失败：" + parse_err + "。请严格按 <<<REPLY>>> / <<<JSON>>> 两段格式重新输出完整内容。）"
                if attempt == 1 and parse_err else ""
            )
            full = ""
            sent = 0
            try:
                async for piece in _stream_llm(cfg, system, payload, req.history):
                    full += piece
                    # <<<REPLY>>> 段增量实时下发（JSON 段不吐，避免刷屏）
                    if "<<<JSON>>>" not in full and "<<<REPLY>>>" in full:
                        text = full.split("<<<REPLY>>>", 1)[1]
                        if len(text) > sent:
                            yield _sse("delta", {"text": text[sent:]})
                            sent = len(text)
            except Exception as e:
                yield _sse("error", {"detail": f"LLM 调用失败：{_short_err(e)}"})
                return

            reply_text, json_part = _split_reply_json(full)
            if not json_part:
                data = None
                break  # 模型只给了叙述段（追问/闲聊），合法路径
            try:
                data = _extract_json(json_part)
                if edit_mode:
                    if not isinstance(data, dict) or "changed" not in data:
                        raise ValueError("缺少 changed 字段")
                    if data.get("changed"):
                        new_days = data.get("days")
                        if not isinstance(new_days, list) or not new_days:
                            raise ValueError("changed=true 但缺少 days 数组")
                        merged = dict(req.route)
                        merged["days"] = new_days
                        data["__route"] = RouteJSON.model_validate(merged).model_dump()
                else:
                    if not data.get("need_more_info"):
                        RouteJSON.model_validate(data)
                parse_err = ""
                break
            except (ValueError, json.JSONDecodeError, ValidationError, KeyError) as e:
                parse_err = str(e)[:200]
                data = None
                if attempt == 1:
                    exhausted = True

        if data is None and exhausted:
            mode = "路线修改" if edit_mode else "攻略"
            yield _sse("error", {"detail": f"{mode}解析失败（已重试）：{parse_err}"})
            return

        if not edit_mode:
            if data is None:
                yield _sse("stage", {"stage": "done", "label": "完成"})
                yield _sse("reply", {"reply": reply_text or "能再描述一下目的地吗？", "intent": "chitchat", "route": None})
                return
            if data.get("need_more_info"):
                yield _sse("stage", {"stage": "done", "label": "完成"})
                yield _sse("reply", {"reply": str(data.get("reply") or reply_text or "能再描述一下吗？"), "intent": "chitchat", "route": None})
                return
            route = RouteJSON.model_validate(data)
            # 坐标补全 + 阶段播报
            missing = sum(
                1 for d in route.days for p in d.places
                if p.lat is None or p.lng is None or (p.lat == 0 and p.lng == 0)
            )
            if missing:
                yield _sse("stage", {"stage": "geocode", "label": f"正在为 {missing} 个地点补全坐标…"})
                try:
                    from ..engine.planner import _enrich_coordinates

                    filled = await _enrich_coordinates(route, route.trip.destination, overrides=cfg if is_user_key else None)
                    if filled:
                        yield _sse("stage", {"stage": "geocode", "label": f"已补全 {filled} 个坐标"})
                except Exception as e:
                    print(f"[chat] 坐标补全失败（忽略）: {e}")
            yield _sse("stage", {"stage": "done", "label": "完成"})
            yield _sse("reply", {
                "reply": reply_text or f"已生成「{route.trip.title}」：{len(route.days)} 天。",
                "intent": "route_edit",
                "route": route.model_dump(),
            })
            return

        # ---- 改路线模式 ----
        yield _sse("stage", {"stage": "done", "label": "完成"})
        if data is None:
            yield _sse("reply", {"reply": reply_text or "我在呢，想怎么改？", "intent": "chitchat", "route": None})
            return
        if not data.get("changed"):
            yield _sse("reply", {"reply": str(data.get("reply") or reply_text or "好的。"), "intent": "chitchat", "route": None})
            return
        yield _sse("reply", {
            "reply": str(data.get("reply") or reply_text or "已更新路线。"),
            "intent": "route_edit",
            "route": data["__route"],
        })

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
