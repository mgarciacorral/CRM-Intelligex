#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-main}"
APP_DIR="/root/CRM"
PM2_NAME="intelligex-crm"

cd "$APP_DIR"

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

npm ci
pm2 start ecosystem.config.cjs --only "$PM2_NAME" >/dev/null 2>&1 || pm2 restart "$PM2_NAME" >/dev/null 2>&1
pm2 save >/dev/null 2>&1 || true

echo "CRM deploy done ($BRANCH)"
