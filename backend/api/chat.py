"""POST /api/chat —— 对话统一入口（M13 文本攻略提取 / M14 对话改路线共用）。

契约（DESIGN.md §2/§7）：
    输入  { prompt: str, history: [{role, content}], route: RouteJSON | null }
    输出  { reply: str, intent: "route_edit"|"chitchat", route: RouteJSON | null }

模式：
    route 为空 → 攻略提取/规划（SYSTEM_EXTRACT），产出 route JSON，reply 为简短介绍；
    route 非空 → 对话改路线（SYSTEM_EDIT，输出 JSON：{reply, changed, days}），
                changed=true 时 days 替换原 days 并整体校验；失败降级闲聊。

护栏（DESIGN.md §4.3）：pydantic 校验失败带错误重试一次；history 只保留最近 8 轮。
"""

import json

import httpx
from fastapi import APIRouter, HTTPException, Request
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
    "只输出 JSON 本身，不要 markdown 代码块标记，不要解释。"
    "JSON 结构：" + _SCHEMA_HINT + "\n"
    "要求："
    "1. 忠于攻略原文：只提取文中提到的地点，不私自添加；地点顺序保持攻略叙述顺序并按天合理分组\n"
    "2. lat/lng 用你确定知道的真实坐标（WGS84 近似）；不确定就填 0，系统会自动补全；不要编造\n"
    "3. type 只能是 attraction / food / transport / other；type=food 用于餐厅/小吃/美食\n"
    "4. 攻略中的营业时间/门票/贴士写进 time/ticket/note；transport 留空由用户补充\n"
    "5. 攻略提到住宿就填 hotel；没提则 hotel 为 null\n"
    "6. summary 提炼 2-4 条攻略里的关键建议（避坑/预约/交通等），不要泛泛而谈\n"
    '7. 无法从输入确定目的地或提取到任何地点时，输出 {"need_more_info": true, "reply": "<向用户提的一个具体问题>"}'
)

SYSTEM_EDIT = (
    "你是行程路线修改助手。你会收到当前行程 JSON（current_route）和用户的修改要求。"
    "只输出 JSON 对象（不要 markdown 标记），结构："
    '{"reply": str, "changed": bool, "days": [<与 current_route.days 完全相同的结构>]}\n'
    "规则："
    "1. reply 用第一人称、一两句话说明你改了什么，例如「已把成都博物馆挪到第一天下午，空出的上午改为人民公园」\n"
    "2. changed=true 时必须给出**完整** days 数组（未修改的天原样保留），禁止省略或输出差异片段\n"
    "3. 用户的明确要求优先；涉及时间冲突/动线明显不合理时可在 reply 里提醒，但仍按用户要求改\n"
    "4. 闲聊/咨询/与路线无关的请求：changed=false，days 给原样内容，reply 正常回答\n"
    "5. 不增删天；单日地点建议不超过 6 个；不确定的坐标修改保持原值"
)

# ---------------- 请求/响应模型 ----------------


class HistoryItem(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    prompt: str = ""
    history: list[HistoryItem] = Field(default_factory=list)
    route: dict | None = None


class ChatResponse(BaseModel):
    reply: str
    intent: str = "chitchat"  # route_edit | chitchat
    route: dict | None = None


# ---------------- LLM 调用 ----------------


async def _call_llm(cfg: dict, system: str, user_text: str, history: list[HistoryItem]) -> str:
    messages: list[dict] = [{"role": "system", "content": system}]
    for h in history[-8:]:  # 护栏：只保留最近 8 轮（DESIGN.md §4.3）
        messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": user_text})
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            cfg["base_url"] + "/chat/completions",
            headers={"Authorization": "Bearer " + cfg["api_key"]},
            json={"model": cfg["model"], "messages": messages, "temperature": 0.4},
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def _extract_json(text: str) -> dict:
    """从 LLM 回复提取 JSON 对象（容忍 markdown 代码块与前后杂文）。"""
    text = text.strip()
    fence = "```"
    if text.startswith(fence):
        nl = text.find("\n")
        text = text[nl + 1:] if nl != -1 else text.lstrip("`")
        if text.rstrip().endswith(fence):
            text = text.rstrip()[:-3]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("LLM 回复中未找到 JSON 对象")
    return json.loads(text[start: end + 1])


def _need_more_info(data: dict) -> ChatResponse:
    reply = str(data.get("reply") or "能再描述一下目的地或行程细节吗？")
    return ChatResponse(reply=reply, intent="chitchat", route=None)


@router.post("/api/chat")
async def chat(req: ChatRequest, request: Request) -> dict:
    overrides = llm_overrides(request)
    has_header_key = bool(overrides and overrides.get("api_key"))
    if not has_header_key:
        from ..engine.planner import _llm_config

        if _llm_config() is None:
            raise HTTPException(
                status_code=400,
                detail="未配置 LLM：请在右上角「模型设置」填入 API Key，或设置 ITERTRIP_LLM_API_KEY 环境变量",
            )
    if overrides is None:
        from ..engine.planner import _llm_config

        overrides = _llm_config()

    if req.route:
        branch = _edit_mode(req, overrides, has_header_key)
    else:
        branch = _extract_mode(req, overrides, has_header_key)
    try:
        return await branch
    except ValueError as e:
        # 可读业务错误（未配 key / LLM 失败 / 解析失败）→ 400 + 明确 detail，前端直接展示
        raise HTTPException(status_code=400, detail=str(e)) from e


async def _extract_mode(req: ChatRequest, cfg: dict, header_key: bool) -> dict:
    """无 route：攻略文本提取 / 纯对话规划（主路径 ① ③）。"""
    last_err = ""
    for attempt in range(2):  # 护栏：校验失败带错误重试一次
        try:
            user_text = req.prompt
            if attempt == 1 and last_err:
                user_text = req.prompt + "\n\n（上次输出 JSON 校验失败：" + last_err + "。请严格按给定结构重新输出完整 JSON。）"
            content = await _call_llm(cfg, SYSTEM_EXTRACT, user_text, req.history)
            data = _extract_json(content)
            if data.get("need_more_info"):
                return _need_more_info(data).model_dump()
            route = RouteJSON.model_validate(data)
            # 提取地点的坐标补全（geocode 三级降级），缺坐标标注待确认
            from ..engine.planner import _enrich_coordinates

            try:
                filled = await _enrich_coordinates(
                    route, route.trip.destination, overrides=cfg if header_key else None
                )
                if filled:
                    print(f"[chat] 坐标补全 {filled} 个地点")
            except Exception as e:
                print(f"[chat] 坐标补全失败（忽略）: {e}")
            n_places = sum(len(d.places) for d in route.days)
            reply = (
                f"已根据你的攻略生成「{route.trip.title}」：{len(route.days)} 天、{n_places} 个地点。"
                "已为你呈现在地图上，可以直接拖拽时间线调整，或继续在这里告诉我怎么改。"
            )
            return ChatResponse(reply=reply, intent="route_edit", route=route.model_dump()).model_dump()
        except ValidationError as e:
            last_err = str(e)[:300]
        except ValueError as e:
            last_err = str(e)[:300]
        except Exception as e:
            raise ValueError(f"LLM 调用失败：{e}") from e
    raise ValueError(f"攻略解析失败（已重试）：{last_err}")


async def _edit_mode(req: ChatRequest, cfg: dict, header_key: bool) -> dict:
    """有 route：对话改路线（M14 主路径 ②）。失败抛错由前端兜底提示。"""
    del header_key  # 改路线不再补坐标，仅占位保持签名一致
    current = json.dumps(req.route, ensure_ascii=False)
    user_text = f"current_route：\n{current}\n\n用户要求：{req.prompt}"
    last_err = ""
    for attempt in range(2):
        try:
            if attempt == 1 and last_err:
                user_text += f"\n\n（上次输出校验失败：{last_err}。请严格按结构重新输出完整 JSON。）"
            content = await _call_llm(cfg, SYSTEM_EDIT, user_text, req.history)
            data = _extract_json(content)
            reply = str(data.get("reply") or "好的。")
            if not data.get("changed"):
                return ChatResponse(reply=reply, intent="chitchat", route=None).model_dump()
            new_days = data.get("days")
            if not isinstance(new_days, list) or not new_days:
                raise ValueError("changed=true 但缺少 days 数组")
            merged = dict(req.route)
            merged["days"] = new_days
            route = RouteJSON.model_validate(merged)  # 整体校验：坏结构不过审
            return ChatResponse(reply=reply, intent="route_edit", route=route.model_dump()).model_dump()
        except ValidationError as e:
            last_err = str(e)[:300]
        except ValueError as e:
            last_err = str(e)[:300]
        except Exception as e:
            raise ValueError(f"LLM 调用失败：{e}") from e
    raise ValueError(f"路线修改解析失败（已重试）：{last_err}")
