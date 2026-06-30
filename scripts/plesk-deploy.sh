#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"

export NODE_ENV="${NODE_ENV:-production}"

if [[ -z "${NODE_BIN_DIR:-}" ]] && [[ -f "$APP_ROOT/.nvmrc" ]]; then
  NODE_MAJOR="$(tr -d '[:space:]' < "$APP_ROOT/.nvmrc" | cut -d. -f1)"
  PLESK_NODE_BIN="/opt/plesk/node/${NODE_MAJOR}/bin"

  if [[ -x "$PLESK_NODE_BIN/node" ]]; then
    NODE_BIN_DIR="$PLESK_NODE_BIN"
  fi
fi

if [[ -n "${NODE_BIN_DIR:-}" ]]; then
  export PATH="$NODE_BIN_DIR:$PATH"
fi

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "$HOME/.nvm/nvm.sh"
  nvm use --silent >/dev/null 2>&1 || true
fi

if ! command -v yarn >/dev/null 2>&1; then
  corepack enable
fi

yarn install --frozen-lockfile
yarn prisma generate

case "${DEPLOY_DATABASE_MODE:-migrate}" in
  migrate)
    if [[ -d prisma/migrations ]] && find prisma/migrations -mindepth 1 -maxdepth 1 -type d | read -r _; then
      yarn prisma migrate deploy
    else
      echo "No Prisma migrations found. Skipping database migration."
      echo "Set DEPLOY_DATABASE_MODE=push on the Plesk app env if this project intentionally uses prisma db push."
    fi
    ;;
  push)
    yarn prisma db push
    ;;
  skip)
    echo "Skipping database update."
    ;;
  *)
    echo "Unsupported DEPLOY_DATABASE_MODE=${DEPLOY_DATABASE_MODE}. Use migrate, push, or skip." >&2
    exit 1
    ;;
esac

yarn build
yarn install --frozen-lockfile --production=true --ignore-scripts

mkdir -p tmp

if [[ -n "${APP_PM2_NAME:-}" ]] && command -v pm2 >/dev/null 2>&1; then
  pm2 reload "$APP_PM2_NAME" --update-env
else
  touch tmp/restart.txt
fi
