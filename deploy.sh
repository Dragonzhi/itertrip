#!/usr/bin/env bash
# IterTrip 服务器部署（Ubuntu + systemd，单进程 C-1 形态：API 与前端同源跑在 8100）
#
# 用法：
#   ./deploy.sh                 拉取 origin/main → 按变更重建前端/装依赖 → 重启 → 健康检查
#   ./deploy.sh --no-pull       不拉代码，只按本地当前状态重建并重启（本地改好、直接上线时用）
#   ./deploy.sh --force         即使没有新提交也重建前端并重启
#   ./deploy.sh --dry-run       只打印将要做什么，不动代码不动服务
#
# 环境变量：
#   ITERTRIP_SERVICE     systemd 单元名，默认 itertrip
#   ITERTRIP_PORT        后端端口，默认 8100
#   ITERTRIP_BRANCH      分支，默认 main
#   ITERTRIP_PUBLIC_URL  额外校验的公网地址，例如 https://dragonzhi.xyz/itertrip/
#
# 已知现实：本机到 GitHub 常只有 20~30 KB/s，一次 fetch 可能几分钟。
# 因此 fetch 默认给 10 分钟超时并重试 3 次，失败会明确报错而不是悄悄继续。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

SERVICE="${ITERTRIP_SERVICE:-itertrip}"
PORT="${ITERTRIP_PORT:-8100}"
BRANCH="${ITERTRIP_BRANCH:-main}"
PUBLIC_URL="${ITERTRIP_PUBLIC_URL:-}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

DO_PULL=1
FORCE=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    --force)   FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$arg（用 --help 看用法）" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ---------- 0. 前置检查 ----------
[ -d .git ] || die "$ROOT 不是 git 仓库"
git rev-parse --verify -q HEAD >/dev/null || die "仓库没有任何提交"
systemctl list-unit-files "$SERVICE.service" >/dev/null 2>&1 || warn "找不到 systemd 单元 $SERVICE.service（重启会失败，可用 ITERTRIP_SERVICE 覆盖）"

OLD_HEAD="$(git rev-parse HEAD)"
log "当前 HEAD：$(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
log "目标：${BRANCH}｜服务：${SERVICE}｜端口：${PORT}｜目录：${ROOT}"

# ---------- 1. 拉取 ----------
if [ "$DO_PULL" = 1 ]; then
  step "1/5 拉取 origin/${BRANCH}"
  OK=0
  for attempt in 1 2 3; do
    log "fetch 第 ${attempt}/3 次（单次最多 10 分钟）"
    if timeout 600 git fetch --progress origin "$BRANCH" 2>&1 | tr '\r' '\n' | grep -Ev '^(remote: )?(Counting|Compressing|Enumerating|Total)' | tail -3; then
      OK=1; break
    fi
    warn "fetch 未完成，可能是网络太慢；重试"
    sleep 3
  done
  [ "$OK" = 1 ] || die "fetch 失败三次，网络到 GitHub 不通或过慢。可稍后重试，或用 --no-pull 跳过拉取"
  git rev-parse --verify -q "origin/${BRANCH}" >/dev/null || die "取不到 origin/${BRANCH}"
else
  step "1/5 跳过拉取（--no-pull）"
fi

TARGET="origin/${BRANCH}"
NEW_HEAD="$(git rev-parse "$TARGET")"

# 工作区脏检查：ff 合并需要干净的工作区
DIRTY="$(git status --porcelain --untracked-files=no)"
if [ -n "$DIRTY" ]; then
  warn "工作区有未提交改动："
  echo "$DIRTY" | sed 's/^/    /'
  if [ "$NEW_HEAD" != "$OLD_HEAD" ]; then
    die "有本地改动且远端有新提交，不能快进合并。请先 commit/stash，或用 --no-pull 只做重建重启"
  fi
  warn "远端没有新提交，继续（本地改动会一起生效）"
fi

# ---------- 2. 快进合并 ----------
if [ "$NEW_HEAD" != "$OLD_HEAD" ]; then
  step "2/5 快进合并 ${OLD_HEAD:0:7} → ${NEW_HEAD:0:7}"
  AHEAD="$(git rev-list --count "$NEW_HEAD..$OLD_HEAD")"
  [ "$AHEAD" = 0 ] || die "本地有 $AHEAD 个远端没有的提交，不是快进关系，脚本不替你处理。请自行 rebase/merge"
  git log --oneline "$OLD_HEAD..$NEW_HEAD" | head -20 | sed 's/^/    /'
  if [ "$DRY_RUN" = 0 ]; then
    git merge --ff-only "$TARGET" >/dev/null || die "快进合并失败"
    log "已合并"
  fi
else
  step "2/5 远端无新提交（$(git rev-parse --short HEAD)）"
fi

# ---------- 3. 判断需要重建什么 ----------
if [ "$NEW_HEAD" != "$OLD_HEAD" ]; then
  CHANGED="$(git diff --name-only "$OLD_HEAD" "$NEW_HEAD")"
else
  CHANGED=""
fi
changed() { echo "$CHANGED" | grep -qE "$1"; }

NEED_FRONTEND=0; NEED_NPM_CI=0; NEED_PIP=0; NEED_RESTART=0
changed '^frontend/'                      && NEED_FRONTEND=1
changed '^shared/'                        && NEED_FRONTEND=1
changed '^frontend/package(-lock)?\.json$' && NEED_NPM_CI=1
changed '^backend/requirements\.txt$'     && NEED_PIP=1
changed '^(backend/|shared/|frontend/)'   && NEED_RESTART=1
[ ! -d frontend/node_modules ]             && { NEED_NPM_CI=1; NEED_FRONTEND=1; }
[ ! -f frontend/dist/index.html ]          && NEED_FRONTEND=1
if [ "$FORCE" = 1 ]; then NEED_FRONTEND=1; NEED_RESTART=1; fi
if [ "$NEW_HEAD" = "$OLD_HEAD" ] && [ "$FORCE" = 0 ]; then
  log "没有新提交，也没有 --force：不重建、不重启。完成。"
  exit 0
fi

log "计划：前端重建=$NEED_FRONTEND（重装依赖=$NEED_NPM_CI）｜后端依赖=$NEED_PIP｜重启=$NEED_RESTART"
[ "$DRY_RUN" = 0 ] || { log "--dry-run：到此为止"; exit 0; }

# ---------- 4. 构建前端 ----------
if [ "$NEED_FRONTEND" = 1 ]; then
  step "3/5 构建前端"
  command -v npm >/dev/null || die "找不到 npm（需要 Node 18+）"
  (
    cd frontend || exit 1
    if [ "$NEED_NPM_CI" = 1 ]; then
      log "依赖有变动，npm ci"
      npm ci --no-audit --no-fund || exit 1
    fi
    log "npm run build（tsc -b && vite build）"
    npm run build || exit 1
  ) || die "前端构建失败，服务未重启（旧版本仍在跑）"
  [ -f frontend/dist/index.html ] || die "构建后仍没有 frontend/dist/index.html"
  # 后端从 frontend/dist 提供静态资源，产物换了就一定要重启进程
  NEED_RESTART=1
  log "构建产物：$(cd frontend/dist && find assets -type f -printf '%f ' 2>/dev/null | head -c 200)"
else
  step "3/5 前端无改动，跳过构建"
fi

# ---------- 5. 后端依赖 ----------
if [ "$NEED_PIP" = 1 ]; then
  step "4/5 安装后端依赖"
  PIP_ARGS=(install -r backend/requirements.txt --quiet)
  # Ubuntu 24.04 起 pip 受 PEP 668 保护，系统 Python 需要显式放行
  if ls /usr/lib/python3*/EXTERNALLY-MANAGED >/dev/null 2>&1; then
    PIP_ARGS+=(--break-system-packages)
  fi
  python3 -m pip "${PIP_ARGS[@]}" || die "pip 安装失败，服务未重启"
  NEED_RESTART=1
else
  step "4/5 后端依赖无改动，跳过安装"
fi

# ---------- 6. 重启 ----------
if [ "$NEED_RESTART" = 1 ]; then
  step "5/5 重启 ${SERVICE}"
  RESTARTED=0
  if sudo -n true 2>/dev/null && sudo -n systemctl restart "$SERVICE" 2>/dev/null; then
    RESTARTED=1; log "已用 sudo systemctl restart 重启"
  elif systemctl restart "$SERVICE" 2>/dev/null; then
    RESTARTED=1; log "已用 systemctl restart 重启"
  else
    # 最后手段：干掉主进程，靠单元里的 Restart=always 让 systemd 拉起来。
    # 这样不需要 root，但要求单元带 Restart=always（itertrip.service 如此）。
    PID="$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null)"
    if [ -n "$PID" ] && [ "$PID" != 0 ]; then
      log "无重启权限，改为结束主进程 $PID，由 Restart=always 自动拉起"
      kill "$PID" 2>/dev/null || die "结束进程 $PID 失败"
      RESTARTED=1
    else
      die "重启失败：既无 systemctl 权限，也拿不到主进程 PID"
    fi
  fi
  [ "$RESTARTED" = 1 ] || die "重启失败"
else
  step "5/5 无需重启（后端未变）"
fi

# ---------- 7. 健康检查 ----------
if [ "$NEED_RESTART" = 1 ]; then
  log "等待服务就绪（最多 60 秒）…"
  HEALTH_BODY=""
  for _ in $(seq 1 60); do
    HEALTH_BODY="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null)" && break
    sleep 1
  done
  [ -n "$HEALTH_BODY" ] || die "健康检查失败：$HEALTH_URL 无响应。看日志：journalctl -u $SERVICE -n 50 --no-pager"
  echo "$HEALTH_BODY" | grep -q '"ok"' || die "健康检查返回异常：$HEALTH_BODY"
  log "健康检查通过：$HEALTH_BODY"

  PAGE_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${PORT}/")"
  [ "$PAGE_CODE" = 200 ] || die "本地首页返回 $PAGE_CODE，前端静态资源可能没挂上"
  log "本地首页 200"

  if [ -n "$PUBLIC_URL" ]; then
    PUB_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$PUBLIC_URL")"
    [ "$PUB_CODE" = 200 ] && log "公网 $PUBLIC_URL 200" || warn "公网 $PUBLIC_URL 返回 $PUB_CODE，检查 Nginx 反代"
  fi
fi

printf '\n'
log "完成：$(git rev-parse --short "$OLD_HEAD") → $(git rev-parse --short HEAD)（$(git log -1 --pretty=%s)）"
if [ -z "$CHANGED" ] && [ "$FORCE" = 1 ]; then
  log "本次为 --force 重建重启，代码未变"
else
  log "涉及 $(echo "$CHANGED" | grep -c . ) 个文件"
fi
