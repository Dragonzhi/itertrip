"""POST /api/chat —— 对话统一入口（M13 提取 / M14 改路线共用），SSE 流式（体验优化①）。

契约（DESIGN.md §2/§7）：
    输入  { prompt: str, history: [{role, content}], route: RouteJSON | null,
            images?: [data:image/*;base64 …] }  # M15 截图，仅提取模式接受
    输出  text/event-stream：
        event: stage    data: {"stage": "understand|retry|geocode|done", "label": str}
        event: thinking data: {"thinking": str}    # 推理模型思考链增量（前端淡色小字实时滚动）
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

M18 记忆库（opt-in：ITERTRIP_MEMORY_ENABLED=1 且请求头带 X-Traveler-Id 才生效）：
    提取模式启动前检索【记忆参考】块（≤6 条 / ≤1200 字）拼到 user payload 尾部；
    路线成功后把本次攻略切分入库（后台任务，不阻塞响应流）。
    记忆是增强能力——任何异常（缺 fastembed、向量库损坏）都只打印日志，绝不影响主线对话。
"""

import asyncio
import base64
import json

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from ..engine.schema import RouteJSON
from .deps import llm_overrides
from ..engine._llmutil import endpoint as _endpoint, non_stream_parts as _non_stream_parts
from .deps import traveler_id as _traveler_id

router = APIRouter()

# ---------------- 系统提示词 ----------------

_SCHEMA_HINT = (
    '{"trip": {"title": str, "destination": str, "days": int, "dates": str, "budget": str, "style": str, '
    '"travelers": str}, "days": [{"day": int, "theme": str, "places": [{"name": str, "lat": float, "lng": float, '
    '"type": "attraction|food|transport|other", "time": str, "transport": str, "ticket": str, "note": str}], '
    '"hotel": {"name": str, "lat": float, "lng": float, "note": str, "prices": []} | null}], "summary": [str]}'
)

# Agent 式澄清（M17）：信息不足时输出结构化问题，而非直接生成。
_QUESTIONS_HINT = (
    '当用户信息明显不足（未给出关键要素：具体日期/天数/预算/风格/出行人数/酒店偏好，'
    '或请求过于模糊无法排程）时，不要直接生成草稿，而是先向用户提 3-5 个最能影响路线的关键问题。'
    '此时第二段 <<<JSON>>> 输出：'
    '{"need_more_info": true, "questions": [{"key": str, "label": str, "type": "text|select|multi|date", '
    '"placeholder": str, "options": [{"value": str, "label": str}]}], "reply": str}。'
    'questions[] 说明：label 是给用户看的问题；type=text 用于填空（如城市），'
    'type=date 用于日期/时间（无需 options，placeholder 形如 2026-10-03，前端会渲染日历）；'
    'type=select 用于单选（如预算档位、风格），type=multi 用于多选（如偏好项目）；'
    'options 需要时提供候选（如预算的 经济/中等/轻奢；风格的 亲子/美食/人文；偏好可从 美食/历史/自然/购物/亲子 选）。'
    '时间/日期类问题必须用 type=date，不要用 text；不要为 select/multi 额外输出“自定义”选项，前端会统一注入。'
    '只问真正影响路线编排的问题（日期、天数、大致预算、风格、人数、住城中心还是景区附近等），'
    '不要问无关紧要或模型该自己推断的细节。reply 里用一两句话说明「规划前我想先确认几点」。'
    '若用户信息已足够排程，则**不要**输出 need_more_info，直接按正常流程生成路线。'
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
    '7. 无法确定目的地或提取不到任何地点时，只输出 <<<REPLY>>> 段（后接一个具体的追问），不要输出 <<<JSON>>> 段\n'
    "8. 用户可能附攻略截图（多模态图片输入）：从图中提取地点名/营业时间/门票/贴士/住宿，忠于图片内容；多张截图视为同一篇攻略，按顺序合并为一条路线；图中未提及的坐标一律填 0（系统会自动补全），不要凭空编造\n"
    + _QUESTIONS_HINT
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
    "4. 不增删天；单日地点建议不超过 6 个；不确定的坐标修改保持原值\n"
    "5. 若用户的修改要求过于模糊（如只说「帮我优化」却没说要改什么、改哪里），"
    "或缺少完成修改所需的关键信息时，先按下方澄清规则输出 need_more_info 问题，changed=false，"
    "不要擅自猜测并大改路线。\n"
    "6. 坐标修正类要求（用户说某个地点位置不对、在非洲、在海里等）必须满足：changed 只能为 true（禁止 changed=false 的口头道歉），且 days 里对应地点的 lat/lng 必须改成你确信的真实坐标（WGS84），禁止原样返回或填 0；也要在 reply 里用一句话说明新坐标的大致方位（如“已修正到海口水巷口附近 20.03,110.32”）。\n"
    + _QUESTIONS_HINT
)

# ---------------- 请求模型 ----------------


class HistoryItem(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    prompt: str = ""
    history: list[HistoryItem] = Field(default_factory=list)
    route: dict | None = None
    # M15 截图解析：data:image/*;base64 data URL 列表（仅提取模式接受）
    images: list[str] = Field(default_factory=list)


# ---------------- M15 截图（多模态输入） ----------------

_MAX_IMAGES = 4
_MAX_IMAGE_BYTES = 4 * 1024 * 1024  # 解码后单张上限


def _check_image(data_url: str) -> tuple[bool, str]:
    """校验截图 data URL：MIME 须 image/*，解码后 ≤ 4MB。返回 (ok, 错误信息)。"""
    s = (data_url or "").strip()
    if not s.startswith("data:image/"):
        return False, "截图须为 data:image/*;base64 格式（PNG/JPG/WebP）"
    b64 = s.partition(",")[2]
    if not b64:
        return False, "截图 data URL 缺少 base64 数据"
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:  # noqa: BLE001
        return False, "截图 base64 解码失败"
    if len(raw) > _MAX_IMAGE_BYTES:
        return False, "单张截图超过 4MB，请压缩后再试"
    return True, ""


def build_user_content(text: str, images: list[str] | None = None):
    """组装 user 消息 content：无图=纯文本（回归安全）；有图=OpenAI 多模态数组。

    M15 护栏（DESIGN §4.3①）：图片只进当次调用的 user 消息，history 恒为纯文本，
    原图天然不会出现在后续轮次上下文（防 token 膨胀）。
    """
    imgs = [i for i in (images or []) if i]
    if not imgs:
        return text
    parts: list[dict] = [{"type": "text", "text": text or "请解析攻略截图并生成行程"}]
    for url in imgs:
        parts.append({"type": "image_url", "image_url": {"url": url}})
    return parts


# ---------------- LLM 流式调用 ----------------


def _extract_delta(chunk: dict) -> tuple[str, str]:
    """从流式 chunk 提取文本，返回 (thinking, content) 两部分（各自累计）。

    - delta.reasoning_content  -> thinking（思考链，走 thinking 事件）
    - delta.content            -> content（正文，走 delta 事件）
    二者分离：思考链不再混入正文气泡。
    """
    delta = None
    if isinstance(chunk, dict):
        delta = chunk.get("delta")  # 兼容非标准：顶层直接带 delta
        if not delta:
            try:
                delta = chunk["choices"][0].get("delta", {})
            except (KeyError, IndexError, TypeError):
                delta = None
    if not isinstance(delta, dict):
        return ("", "")
    thinking = delta.get("reasoning_content") or ""
    content = delta.get("content") or ""
    return (thinking, content)


async def _stream_llm(
    cfg: dict, system: str, user_text: str, history: list[HistoryItem],
    images: list[str] | None = None,
):
    """调用 LLM 并 yield 文本增量。

    优先 SSE 流式；若端点忽略 stream（返回普通 JSON 而非 SSE，常见于部分免费/聚合网关），
    自动回退到一次性非流式响应。兼容 content / reasoning_content 两种取文本方式。
    images 非空时（M15）user 消息为 OpenAI 多模态数组（文本 + 图片 data URL）。
    """
    messages: list[dict] = [{"role": "system", "content": system}]
    for h in history[-8:]:  # 护栏：只保留最近 8 轮
        messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": build_user_content(user_text, images)})

    payload = {"model": cfg["model"], "messages": messages, "temperature": 0.4, "stream": True}

    async with httpx.AsyncClient(timeout=180) as client:
        try:
            async with client.stream(
                "POST",
                _endpoint(cfg["base_url"]) + "/chat/completions",
                headers={"Authorization": "Bearer " + cfg["api_key"]},
                json=payload,
            ) as resp:
                resp.raise_for_status()
                got_any = False
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        got_any = True
                        return
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    thinking, content = _extract_delta(chunk)
                    if thinking:
                        got_any = True
                        yield ("thinking", thinking)
                    if content:
                        got_any = True
                        yield ("content", content)
                # 流结束但一行 data 都没有 → 端点可能忽略了 stream，回退非流式
                if not got_any:
                    nresp = await client.post(
                        _endpoint(cfg["base_url"]) + "/chat/completions",
                        headers={"Authorization": "Bearer " + cfg["api_key"]},
                        json={**payload, "stream": False},
                    )
                    if nresp.status_code >= 400:
                        # 带上响应体片段：网关拒绝图片/参数的原因都在 body，_short_err 需要它做视觉判定
                        raise RuntimeError(f"{nresp.status_code}: {nresp.text[:300]}")
                    raw = nresp.text
                    try:
                        thinking, content = _non_stream_parts(json.loads(raw))
                    except json.JSONDecodeError:
                        # 响应体不是合法 JSON（部分免费网关透传上游 HTML/错误页）。
                        # 把原始体当文本交给调用方，失败信息能落到 reply 而非静默兜底。
                        content, thinking = raw, ""
                    if thinking:
                        yield ("thinking", thinking)
                    if content:
                        yield ("content", content)
        except httpx.HTTPStatusError as e:
            # 流式通路报 4xx/5xx（部分网关不支持 stream），回退一次非流式
            if e.response is not None and e.response.status_code in (400, 404, 405, 422):
                nresp = await client.post(
                    _endpoint(cfg["base_url"]) + "/chat/completions",
                    headers={"Authorization": "Bearer " + cfg["api_key"]},
                    json={**payload, "stream": False},
                )
                if nresp.status_code >= 400:
                    raise RuntimeError(f"{nresp.status_code}: {nresp.text[:300]}")
                raw = nresp.text
                try:
                    thinking, content = _non_stream_parts(json.loads(raw))
                except json.JSONDecodeError:
                    content, thinking = raw, ""
                if thinking:
                    yield ("thinking", thinking)
                if content:
                    yield ("content", content)
                return
            raise


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


def _visible_reply(full: str) -> str:
    """从当前累计的 content 里提取「应显示给用户的纯净正文段」。

    兼容模型是否输出 <<<REPLY>>>/<<<JSON>>> 标记：
    - 有 <<<REPLY>>>/<<<JSON>>>：取二者之间的人工叙述段
    - 只有 <<<JSON>>>：取其前的人工叙述段
    - 无任何标记：全文（去掉思考链标记后）当叙述
    实时下发用，保证正文能边生成边滚动。
    """
    if "<<<JSON>>>" in full:
        head = full.split("<<<JSON>>>", 1)[0]
    else:
        head = full
    if "<<<REPLY>>>" in head:
        head = head.split("<<<REPLY>>>", 1)[1]
    # 流式期间避免标记前缀闪现：若尾部是标记的不完整前缀（如 "<<<REP"），先扣住不发，
    # 等标记凑齐或被后续字符否定后再下发。
    for mark in ("<<<REPLY>>>", "<<<JSON>>>"):
        for k in range(len(mark) - 1, 0, -1):
            if head.endswith(mark[:k]):
                return head[:-k]
    return head


async def _resolve_cfg(request: Request) -> tuple[dict, bool]:
    """BYOK 解析 + 预检（无 key 抛 HTTP 400，发生在流开始前）。返回 (cfg, is_user_key)。"""
    overrides = llm_overrides(request)
    if overrides and overrides.get("api_key"):
        # BYOK 只填了 API Key、漏填 Base URL 时，base_url/model 回落到服务器当前生效配置。
        # 否则空 base_url 会让 httpx 抛 "Request URL is missing an 'http://' or 'https://' protocol"，
        # 对用户是一句不可读的报错（设置面板允许只填 Key 就保存）。
        if not overrides.get("base_url"):
            from ..engine.admin_config import resolve_active

            server_cfg, _ = resolve_active()
            if server_cfg:
                overrides["base_url"] = (server_cfg.get("base_url") or "").strip().rstrip("/")
                overrides["model"] = overrides.get("model") or (server_cfg.get("model") or "")
        if not overrides.get("base_url"):
            raise HTTPException(
                status_code=400,
                detail="BYOK 缺少 Base URL：请在「模型设置」补全 Base URL，或清空 API Key 改用服务器配置",
            )
        return overrides, True
    from ..engine.planner import _llm_config

    cfg = _llm_config()
    if cfg is None:
        # BYOK / 环境变量 / .env 免费供应商都没配置 → 明确提示（服务器放一份 .env 即可用免费源）
        raise HTTPException(
            status_code=400,
            detail="未配置 LLM：请在「模型设置」填入 API Key，或在服务器 .env 配置 ITERTRIP_FREE_API_KEY",
        )
    return cfg, False


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# 网关拒绝图片输入时错误体常见字样（与 api/llm.py 视觉探测同一判定口径）
_VISION_ERR_MARKS = ("image", "vision", "multimodal", "visual", "图片", "图像")


def _short_err(e: Exception, has_images: bool = False) -> str:
    s = str(e)
    if "429" in s:
        return "被供应商限流（429），key 有效但请稍后再试"
    if "401" in s or "Unauthorized" in s:
        return "鉴权失败（401）：请检查 API Key 是否正确"
    # M15：带图请求被 4xx 拒绝且错误体含视觉字样 → 前端据此回写 vision=false 置灰入口
    if has_images and any(m in s.lower() for m in _VISION_ERR_MARKS):
        return "[vision-unsupported] 当前模型不支持图片输入：请更换 VLM 模型，或在「设置」重新测试连接"
    if "404" in s:
        return "接口不存在（404）：请检查 Base URL 与模型名"
    if "Connect" in s or "timed out" in s or "timeout" in s.lower():
        return "网络连接失败：请检查 Base URL 是否可达"
    return s[:200]


# ---------------- M18 记忆库：检索注入 + 攻略入库（均 best-effort，失败只记日志） ----------------

_BG_TASKS: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    """后台任务：入库不阻塞响应流。create_task 只有弱引用，需自持强引用防 GC。"""
    task = asyncio.create_task(coro)
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)


async def _memory_reference(traveler: str, prompt: str) -> str:
    """检索【记忆参考】块；未开启 / 无档案 / 库空 / 依赖缺失时返回 ""（静默降级）。"""
    if not traveler or not prompt.strip():
        return ""
    from ..engine import memory_ingest, memory_store

    if not memory_store.enabled():
        return ""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(memory_ingest.build_reference, traveler, prompt), timeout=30
        )
    except Exception as e:  # noqa: BLE001 记忆是增强能力，异常绝不中断对话
        print(f"[memory] 检索跳过：{e}")
        return ""


async def _memory_ingest_bg(traveler: str, route: RouteJSON) -> None:
    """把成功生成的攻略切分入库（后台任务；首轮含模型加载，故不阻塞响应）。"""
    from ..engine import memory_ingest, memory_store

    if not traveler or not memory_store.enabled():
        return
    try:
        n = await asyncio.wait_for(asyncio.to_thread(memory_ingest.ingest_route, traveler, route), timeout=180)
        if n:
            print(f"[memory] 攻略入库 {n} 条（traveler={traveler[:8]}）")
    except Exception as e:  # noqa: BLE001
        print(f"[memory] 入库跳过：{e}")


@router.post("/api/chat")
async def chat(req: ChatRequest, request: Request) -> StreamingResponse:
    edit_mode = req.route is not None
    # M15 截图预检（放在 LLM 配置解析之前：校验错误优先于「未配置」提示）
    if req.images:
        if edit_mode:
            raise HTTPException(status_code=400, detail="改路线暂不支持图片输入：请用文字描述修改要求")
        if len(req.images) > _MAX_IMAGES:
            raise HTTPException(status_code=400, detail=f"截图最多 {_MAX_IMAGES} 张，请分次发送")
        for img in req.images:
            ok, err = _check_image(img)
            if not ok:
                raise HTTPException(status_code=400, detail=err)
    cfg, is_user_key = await _resolve_cfg(request)
    traveler = _traveler_id(request)

    async def gen():
        yield _sse("stage", {
            "stage": "understand",
            "label": "正在读取攻略并规划路线…" if not edit_mode else "正在分析当前路线…",
        })

        # M18：提取模式检索长期记忆，注入 user payload 尾部（编辑模式不注入：上下文已含完整 route）
        mem_ref = "" if edit_mode else await _memory_reference(traveler, req.prompt)
        if mem_ref:
            hits = sum(1 for ln in mem_ref.splitlines() if ln.startswith("["))
            yield _sse("stage", {"stage": "memory", "label": f"参考了 {hits} 条你过往的攻略记忆…"})

        base_payload = (
            f"current_route：\n{json.dumps(req.route, ensure_ascii=False)}\n\n用户要求：{req.prompt}"
            if edit_mode else (req.prompt + ("\n\n" + mem_ref if mem_ref else ""))
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
            # 阶段轮播文案：让「正在读取攻略并规划路线…」动起来，覆盖模型首个 token 前的等待窗口。
            # 后台真实调用模型，主流程并发轮播前置步骤；一旦收到真实内容（thinking/delta）即用真实内容接管。
            _STEPS = (
                ["正在理解你的需求…", "正在提取景点…", "正在排行程…", "正在生成路线…"]
                if not edit_mode
                else ["正在分析当前路线…", "正在理解你的改动…", "正在调整行程…"]
            )
            queue: asyncio.Queue = asyncio.Queue()

            async def _producer():
                try:
                    async for kind, piece in _stream_llm(cfg, system, payload, req.history, req.images or None):
                        await queue.put((kind, piece, False))
                except Exception as e:  # noqa: BLE001
                    await queue.put(("__error__", str(e), True))
                finally:
                    await queue.put(("__done__", "", True))

            producer_task = asyncio.create_task(_producer())
            try:
                step_i = 0
                started = False
                while True:
                    try:
                        kind, piece, is_terminal = await asyncio.wait_for(queue.get(), timeout=0.9)
                    except asyncio.TimeoutError:
                        # 超时未拿到内容 → 轮播前置步骤，保持界面有动效。
                        # 修复前：到最后一个 label 后停更，界面看似卡死在“规划路线”；
                        # 修复后：循环播放，保证无思维链的慢模型等待期也有持续反馈。
                        if not started:
                            label = _STEPS[step_i % len(_STEPS)]
                            yield _sse("stage", {"stage": "thinking-steps", "label": label})
                            step_i += 1
                        continue
                    if is_terminal:
                        if kind == "__error__":
                            raise RuntimeError(piece)
                        break
                    started = True
                    if kind == "thinking":
                        # 思考链实时下发到 thinking 通道（前端淡色小字滚动，不混入正文）
                        yield _sse("thinking", {"thinking": piece})
                        continue
                    full += piece
                    # 实时下发纯净正文段（增量），兼容模型是否输出 <<<REPLY>>>/<<<JSON>>> 标记。
                    # 用 _visible_reply 实时算「该给用户看的叙述」，避免依赖标记存在才能滚动。
                    visible = _visible_reply(full)
                    if len(visible) > sent:
                        yield _sse("delta", {"text": visible[sent:]})
                        sent = len(visible)
            except Exception as e:
                yield _sse("error", {"detail": f"LLM 调用失败：{_short_err(e, has_images=bool(req.images))}"})
                return
            finally:
                producer_task.cancel()

            reply_text, json_part = _split_reply_json(full)
            if not json_part:
                # 无 <<<JSON>>> 标记：可能模型没遵协议，直接把 JSON 混在正文里（免费模型常见）。
                # 先尝试从全文兜底提取 JSON；挖到了就当作结构化结果，挖不到才当纯叙述（追问/闲聊）。
                try:
                    data = _extract_json(full)
                    # reply 只保留 JSON 起点之前的纯叙述，避免把结构化 JSON 带进 reply 气泡
                    js = full.find("{")
                    if js > 0:
                        clean = full[:js].strip()
                        if clean:
                            reply_text = clean
                    parse_err = ""
                    break
                except (ValueError, json.JSONDecodeError):
                    data = None
                    break  # 纯叙述/追问/闲聊，合法路径
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
                yield _sse("reply", {
                    "reply": str(data.get("reply") or reply_text or "能再描述一下吗？"),
                    "intent": "chitchat",
                    "route": None,
                    "questions": data.get("questions") or [],
                })
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

                    filled = await _enrich_coordinates(route, route.trip.destination, overrides=cfg if is_user_key else None, traveler=traveler)
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
            # M18：响应发完后再后台入库（首轮含 embedding 模型加载，不占用本次响应时间）
            _spawn(_memory_ingest_bg(traveler, route))
            return

        # ---- 改路线模式 ----
        yield _sse("stage", {"stage": "done", "label": "完成"})
        if data is None:
            yield _sse("reply", {"reply": reply_text or "我在呢，想怎么改？", "intent": "chitchat", "route": None})
            return
        if not data.get("changed"):
            # 坐标修正请求被模型以 changed=false 口头道歉糊弄时，自动用后端 geocode 兜底真改坐标
            coord_hint = any(k in req.prompt for k in ("坐标", "位置不对", "非洲", "海里", "错", "不对", "偏"))
            if coord_hint:
                try:
                    from ..engine.planner import _enrich_coordinates
                    from ..engine.schema import RouteJSON as _RJ
                    _tmp = _RJ.model_validate(req.route)
                    need_fix = [p for d in _tmp.days for p in d.places if p.name and p.name.strip() and p.name.strip() in req.prompt]
                    # 也支持“水巷口辣汤饭的位置不对”这类包含名称的提示：只要 prompt 里出现该地名就纳入
                    if not need_fix:
                        for d in _tmp.days:
                            for p in d.places:
                                if p.name and p.name.strip() and p.name.strip() in req.prompt:
                                    need_fix.append(p)
                    # 兜底：用户只说“位置不对”未点名，修正所有可疑坐标（0,0 或远离目的地的异常点）
                    if not need_fix and coord_hint:
                        for d in _tmp.days:
                            for p in d.places:
                                if p.lat == 0 and p.lng == 0:
                                    need_fix.append(p)
                                elif p.lat is not None and (p.lat < -30 or p.lat > 60 or p.lng < 70 or p.lng > 140):
                                    # 粗略判定“在非洲”等离谱坐标（中国境内大致 18-54N, 73-135E）
                                    need_fix.append(p)
                    fixed = 0
                    for p in need_fix:
                        # 强制重算一次坐标（即使已有坐标也以 LLM/geocode 为准纠正）
                        from ..engine.coordinates import geocode as _geocode
                        res = await _geocode(p.name, _tmp.trip.destination, llm_overrides=cfg if is_user_key else None, traveler=traveler)
                        if res["lat"] is not None:
                            p.lat = res["lat"]
                            p.lng = res["lng"]
                            fixed += 1
                    if fixed:
                        route_obj = _tmp
                        yield _sse("reply", {
                            "reply": str(data.get("reply") or reply_text or "已修正坐标。") + f"（已通过坐标服务修正 {fixed} 个地点）",
                            "intent": "route_edit",
                            "route": route_obj.model_dump(),
                        })
                        return
                except Exception as _e:
                    print(f"[chat] 坐标修正兜底失败: {_e}")
            qs = data.get("questions") or []
            yield _sse("reply", {
                "reply": str(data.get("reply") or reply_text or "好的。"),
                "intent": "chitchat",
                "route": None,
                "questions": qs if qs else None,
            })
            return
        # changed=true：先把 LLM 新写/改动的坐标从 WGS84 转 GCJ-02（全链路统一 GCJ-02）。
        # 与旧路线同名同值的坐标是回显的 GCJ-02，跳过以防双重偏移；差异坐标才视为 WGS84 转换。
        try:
            from ..engine.schema import RouteJSON as _RJ0

            _new = _RJ0.model_validate(data["__route"])
            _old_days = _RJ0.model_validate(req.route).days
            _old_map = {p.name: (p.lat, p.lng) for d in _old_days for p in d.places}
            _old_hotel = {d.hotel.name: (d.hotel.lat, d.hotel.lng) for d in _old_days if d.hotel}
            for d in _new.days:
                for p in d.places:
                    o = _old_map.get(p.name)
                    echoed = o is not None and o[0] is not None and abs(o[0] - p.lat) < 1e-6 and abs(o[1] - p.lng) < 1e-6
                    if not echoed and p.lat and p.lng:
                        p.lat, p.lng = wgs84_to_gcj02(p.lat, p.lng)
                h = d.hotel
                if h is not None and h.lat and h.lng:
                    oh = _old_hotel.get(h.name)
                    echoed_h = oh is not None and oh[0] is not None and abs(oh[0] - h.lat) < 1e-6 and abs(oh[1] - h.lng) < 1e-6
                    if not echoed_h:
                        h.lat, h.lng = wgs84_to_gcj02(h.lat, h.lng)
            data["__route"] = _new.model_dump()
        except Exception as _e0:
            print(f"[chat] 新坐标 GCJ-02 转换失败(忽略): {_e0}")
        # changed=true：若仍有 0,0 坐标，尝试后端补全
        try:
            from ..engine.planner import _enrich_coordinates
            from ..engine.schema import RouteJSON as _RJ2
            _route_obj = _RJ2.model_validate(data["__route"])
            miss = sum(1 for d in _route_obj.days for p in d.places if p.lat == 0 and p.lng == 0)
            if miss:
                filled = await _enrich_coordinates(_route_obj, _route_obj.trip.destination, overrides=cfg if is_user_key else None, traveler=traveler)
                if filled:
                    data["__route"] = _route_obj.model_dump()
        except Exception as _e2:
            print(f"[chat] 改路线坐标补全失败(忽略): {_e2}")
        # 口头说改但坐标未动的二次校验：若 changed=true 且用户提及某地名但该地坐标未变，强制 geocode 纠正
        try:
            from ..engine.coordinates import geocode as _geocode2
            from ..engine.schema import RouteJSON as _RJ3
            _new = _RJ3.model_validate(data["__route"])
            _old = _RJ3.model_validate(req.route)
            old_map = {p.name: (p.lat, p.lng) for d in _old.days for p in d.places}
            for d in _new.days:
                for p in d.places:
                    if p.name and p.name in req.prompt:
                        o = old_map.get(p.name)
                        if o and abs(o[0] - p.lat) < 1e-6 and abs(o[1] - p.lng) < 1e-6:
                            res = await _geocode2(p.name, _new.trip.destination, llm_overrides=cfg if is_user_key else None, traveler=traveler)
                            if res["lat"] is not None:
                                p.lat = res["lat"]
                                p.lng = res["lng"]
            data["__route"] = _new.model_dump()
        except Exception as _e3:
            print(f"[chat] 坐标二次校验失败(忽略): {_e3}")
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