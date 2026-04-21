#!/bin/bash
set -euo pipefail

state_dir="${MISSION_VIRTUAL_DESKTOP_DIR:-/tmp/mission-virtual-desktop}"

if [[ ! -d "${state_dir}" ]]; then
  echo "Mission virtual desktop is already stopped."
  exit 0
fi

stop_service() {
  local name="$1"
  local pid_file="${state_dir}/${name}.pid"
  if [[ ! -f "${pid_file}" ]]; then
    return
  fi

  local pid
  pid="$(cat "${pid_file}")"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${pid_file}"
}

stop_service novnc
stop_service x11vnc
stop_service fluxbox
stop_service xvfb

rm -rf "${state_dir}"

echo "Mission virtual desktop stopped."