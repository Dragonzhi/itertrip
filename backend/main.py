"""IterTrip API 入口。

启动：uvicorn backend.main:app --reload
单进程整站（C-1）：先 `npm run build` 生成 frontend/dist，再启动本服务，
http://127.0.0.1:8100/ 即完整 Web 应用（API + 前端同源，无 CORS）。
"""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api import admin, chat, export, geocode, llm, plan, search

app = FastAPI(
    title="IterTrip API",
    version="0.1.0",
    description="把旅游攻略变成可以动手改、可以带走的地图 —— 独立 Web 应用（DESIGN.md v1.0）",
)

# CORS：生产用 ITERTRIP_CORS_ORIGINS 逗号分隔白名单；未配置时全放行（开发期/开放 API）
_cors = os.environ.get("ITERTRIP_CORS_ORIGINS", "").strip()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors.split(",") if o.strip()] or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(plan.router)
app.include_router(geocode.router)
app.include_router(search.router)
app.include_router(export.router)
app.include_router(chat.router)
app.include_router(llm.router)
app.include_router(admin.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "itertrip-api", "version": "0.1.0"}


# ---------------- 单进程整站（C-1）：托管 frontend/dist ----------------
# 存在 dist 时：/assets 走静态文件，其余非 API 路径回退 index.html（SPA）。
# 不存在 dist 时：仅 API 模式（开发态，前端走 Vite 5173）。
_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if _DIST.is_dir() and (_DIST / "index.html").is_file():
    assets = _DIST / "assets"
    if assets.is_dir():
        # 子路径 /itertrip/assets/** 由 Nginx 剥前缀后以 /assets 到达，需同时挂载 /itertrip/assets 兼容直连
        app.mount("/assets", StaticFiles(directory=assets), name="assets")
        app.mount("/itertrip/assets", StaticFiles(directory=assets), name="assets-itertrip")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        """非 API 路径一律回退 index.html；带扩展名的静态资源找不到时返回 404。"""
        # 兼容子路径：剥掉 itertrip/ 前缀再判定
        stripped = full_path.removeprefix("itertrip/").removeprefix("itertrip")
        if stripped.startswith("api/") or full_path.startswith("api/"):
            return FileResponse(_DIST / "index.html", status_code=404)  # 保险：API 404 不回 SPA
        # 子路径直连时 index.html 仍在 _DIST 根
        candidate = _DIST / stripped if stripped else _DIST / full_path
        if stripped and (_DIST / stripped).is_file():
            return FileResponse(_DIST / stripped)
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")