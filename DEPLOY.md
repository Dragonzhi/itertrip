# IterTrip · 部署指南

> **当前主形态：本地优先。** `start.ps1` 单进程整站（见第〇章）即完整产品，日常使用/演示用这一个就够。
> 以下云部署章节保留为将来可选路径（HF Spaces / Railway / Vercel），账号操作按本文逐步进行即可。

## 架构

```
Vercel/Cloudflare Pages (React 静态站)
        │  fetch VITE_API_BASE
        ▼
Railway / fly.io (FastAPI 容器)  ──►  LLM API (环境变量 key)
```

## 〇、零部署单进程方案（C-1 · 最快上手）

**一条命令把整站跑起来**（API + 前端同源，无 CORS、无跨域、断网也能演示）：

```powershell
powershell -ExecutionPolicy Bypass -File start.ps1          # 首次自动构建前端
powershell -ExecutionPolicy Bypass -File start.ps1 -Rebuild # 改了前端代码后强制重建
```

- 本机访问：`http://127.0.0.1:8100`
- 手机真机（同一 Wi-Fi）：启动时打印的 `http://<局域网IP>:8100`
- 接入真实 LLM：先设 `ITERTRIP_LLM_API_KEY` 再运行脚本

原理：`backend/main.py` 检测到 `frontend/dist` 时自动挂载静态资源并 SPA 回退，单进程 = API + Web 应用。这也意味着任何能跑 Python 容器的平台（含 Hugging Face Spaces）都能用现有 `Dockerfile` 直接部署整站——不需要前后端分离部署。

## 一、后端部署（Railway，推荐）

仓库已包含：`Dockerfile`、`railway.json`（Dockerfile 构建 + /api/health 健康检查）。

1. 登录 [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → 选本仓库
2. Railway 识别 `railway.json` 自动用 Dockerfile 构建；无需其他配置
3. 部署完成后在 **Variables** 添加：
   | 变量 | 必填 | 说明 |
   | --- | --- | --- |
   | `ITERTRIP_LLM_API_KEY` | 推荐 | DeepSeek/OpenAI 兼容 key；不配则 /api/plan 走 mock |
   | `ITERTRIP_LLM_BASE_URL` | 可选 | 默认 https://api.deepseek.com |
   | `ITERTRIP_LLM_MODEL` | 可选 | 默认 deepseek-chat |
   | `ITERTRIP_SEARCH_API_KEY` | 可选 | Tavily 兼容 key，启用 geocode 兜底 + 抓价 |
   | `ITERTRIP_CORS_ORIGINS` | 推荐 | 前端域名，如 `https://itertrip.vercel.app`（逗号分隔多个） |
4. **Settings → Networking → Generate Domain**，得到形如 `https://xxx.up.railway.app` 的地址
5. 验证：浏览器打开 `https://xxx.up.railway.app/api/health` 应返回 `{"status":"ok",...}`

> fly.io 替代：仓库含 `Procfile`（`web: uvicorn backend.main:app --host 0.0.0.0 --port $PORT`），`fly launch` 后同样设上述变量。

## 二、前端部署（Vercel，推荐）

仓库已在 `frontend/` 含 `vercel.json` 与 `.env.example`。

1. 登录 [vercel.com](https://vercel.com) → **Add New → Project** → 导入本仓库
2. **Root Directory** 设为 `frontend`（Vercel 会读取 vercel.json：`npm run build` → `dist`）
3. **Environment Variables** 添加：
   | 变量 | 值 |
   | --- | --- |
   | `VITE_API_BASE` | 后端地址，如 `https://xxx.up.railway.app`（不带尾斜杠） |
4. Deploy → 得到 `https://itertrip-xxx.vercel.app`
5. 回到 Railway 把 `ITERTRIP_CORS_ORIGINS` 加上这个前端域名（重新部署后端生效）

> Cloudflare Pages 替代：Framework preset 选 **Vite**，构建命令 `npm run build`，输出目录 `dist`，环境变量同 `VITE_API_BASE`。

## 三、本地生产构建自测

```bash
# 后端
.venv\Scripts\python.exe -m uvicorn backend.main:app --port 8100

# 前端（另开终端）
cd frontend
npm run build          # tsc + vite build → dist/
npx vite preview --port 4173   # 预览生产构建（记得配 VITE_API_BASE 重新 build）
```

## 四、环境变量汇总

| 变量 | 位置 | 作用 |
| --- | --- | --- |
| `ITERTRIP_LLM_API_KEY` | 后端 | LLM 规划 + LLM geocode（缺省 mock/城市表降级） |
| `ITERTRIP_LLM_BASE_URL` | 后端 | 默认 DeepSeek，可换 OpenAI/本地 |
| `ITERTRIP_LLM_MODEL` | 后端 | 默认 deepseek-chat |
| `ITERTRIP_SEARCH_API_KEY` | 后端 | 搜索兜底（geocode + 抓价） |
| `ITERTRIP_SEARCH_BASE_URL` | 后端 | 默认 https://api.tavily.com |
| `ITERTRIP_ROLLINGO_BASE_URL` | 后端 | RollingGo 价格源（可选） |
| `ITERTRIP_CORS_ORIGINS` | 后端 | 生产前端域名白名单 |
| `VITE_API_BASE` | 前端 | 后端 API 地址（构建时注入） |

## 五、密钥安全红线

- 所有 key 只走平台 Variables/Secrets，**不进 git**（`.gitignore` 已拦 `.env`）
- 提交前自检：`git grep -i "api_key|bearer" -- . ':!*.md'`