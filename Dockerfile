# IterTrip API —— FastAPI 后端镜像
FROM python:3.12-slim

WORKDIR /app

# 先装依赖，利用层缓存
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# 拷贝后端代码 + 模板（export 需要）
COPY backend /app/backend

ENV PORT=8787
EXPOSE 8787

# Railway/容器平台注入 PORT
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8787}"]