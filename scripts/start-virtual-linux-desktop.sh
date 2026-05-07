#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "error: the Mission virtual desktop is only supported on Linux." >&2
  exit 1
fi

required_commands=(Xvfb xauth fluxbox x11vnc websockify)
missing_commands=()
for command_name in "${required_commands[@]}"; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    missing_commands+=("${command_name}")
  fi
done

if (( ${#missing_commands[@]} > 0 )) || [[ ! -d /usr/share/novnc ]]; then
  cat >&2 <<'EOF'
error: the virtual desktop dependencies are missing.

Install the Debian or Ubuntu packages with:
  sudo apt update
  sudo apt install xvfb fluxbox x11vnc novnc websockify dbus-x11
EOF
  exit 1
fi

display_value="${MISSION_VIRTUAL_DISPLAY:-:99}"
screen_value="${MISSION_VIRTUAL_SCREEN:-1440x900x24}"
state_dir="${MISSION_VIRTUAL_DESKTOP_DIR:-/tmp/mission-virtual-desktop}"
vnc_port="${MISSION_VNC_PORT:-5900}"
novnc_port="${MISSION_NOVNC_PORT:-6080}"

mkdir -p "${state_dir}/logs"

cleanup_stale_pidfile() {
  local pid_file="$1"
  if [[ ! -f "${pid_file}" ]]; then
    return
  fi

  local pid
  pid="$(cat "${pid_file}")"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
    return
  fi

  rm -f "${pid_file}"
}

start_service() {
  local name="$1"
  local pid_file="${state_dir}/${name}.pid"
  local log_file="${state_dir}/logs/${name}.log"
  shift

  cleanup_stale_pidfile "${pid_file}"
  if [[ -f "${pid_file}" ]]; then
    echo "${name} is already running on ${display_value}."
    return
  fi

  nohup "$@" >"${log_file}" 2>&1 &
  local pid=$!
  echo "${pid}" >"${pid_file}"
  sleep 1
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    echo "error: failed to start ${name}. See ${log_file}." >&2
    exit 1
  fi
}

export DISPLAY="${display_value}"
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export NO_AT_BRIDGE="${NO_AT_BRIDGE:-1}"

start_service xvfb Xvfb "${display_value}" -screen 0 "${screen_value}" -ac +extension RANDR -nolisten tcp
start_service fluxbox fluxbox
start_service x11vnc x11vnc -display "${display_value}" -rfbport "${vnc_port}" -forever -shared -nopw
start_service novnc websockify --web /usr/share/novnc/ "${novnc_port}" "127.0.0.1:${vnc_port}"

cat <<EOF
Mission virtual desktop is ready.
DISPLAY=${display_value}
VNC:    localhost:${vnc_port}
noVNC:  http://localhost:${novnc_port}/vnc.html

Use this display for visible Tauri runs:
  DISPLAY=${display_value} pnpm --dir apps/airport/native run dev
EOF