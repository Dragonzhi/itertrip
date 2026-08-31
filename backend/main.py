"""IterTrip API 入口。启动：uvicorn backend.main:app --reload"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import export, plan

app = FastAPI(
    title="IterTrip API",
    version="0.1.0",
    description="AI 旅行规划系统 —— 规划引擎同时服务 Web 前端与 Hana Skill 两个入口",
)

# 前端本地开发（Vite 默认 5173）与同机联调需要跨域，开发期全放行
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(plan.router)
app.include_router(export.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "itertrip-api", "version": "0.1.0"}