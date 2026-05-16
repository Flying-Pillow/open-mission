#!/bin/bash
set -euo pipefail

cd /open-mission

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export OPEN_MISSION_REPOSITORY_ROOT="${OPEN_MISSION_REPOSITORY_ROOT:-/open-mission}"
export OPEN_MISSION_DAEMON_RUNTIME_MODE="${OPEN_MISSION_DAEMON_RUNTIME_MODE:-source}"

until [[ -d /open-mission/node_modules/.pnpm ]]; do
  echo "Waiting for pnpm workspace dependencies to be installed..."
  sleep 2
done

exec pnpm dev