#!/bin/bash
set -euo pipefail

require_display=0

if [[ "${1:-}" == "--require-display" ]]; then
  require_display=1
fi

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "error: Linux native environment checks must be run on Linux." >&2
  exit 1
fi

missing_commands=()
for command_name in node pnpm cargo rustc pkg-config; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    missing_commands+=("$command_name")
  fi
done

if (( ${#missing_commands[@]} > 0 )); then
  printf 'error: missing required commands: %s\n' "${missing_commands[*]}" >&2
  exit 1
fi

missing_packages=()
for package_name in gtk+-3.0 libsoup-3.0 webkit2gtk-4.1; do
  if ! pkg-config --exists "$package_name"; then
    missing_packages+=("$package_name")
  fi
done

if (( ${#missing_packages[@]} > 0 )); then
  printf 'error: missing required Linux native packages: %s\n' "${missing_packages[*]}" >&2
  cat >&2 <<'EOF'
Install the Debian or Ubuntu prerequisites with:
  sudo apt update
  sudo apt install build-essential curl wget file libssl-dev \
    libgtk-3-dev libsoup-3.0-dev libwebkit2gtk-4.1-dev \
    libxdo-dev libayatana-appindicator3-dev librsvg2-dev
EOF
  exit 1
fi

if [[ ! -f "/usr/include/xdo.h" ]] || ! find /usr/lib /usr/lib64 /usr/lib/x86_64-linux-gnu -name 'libxdo.so*' -print -quit 2>/dev/null | grep -q .; then
  cat >&2 <<'EOF'
error: libxdo development files are missing.

Install the Debian or Ubuntu package with:
  sudo apt update
  sudo apt install libxdo-dev
EOF
  exit 1
fi

if (( require_display == 1 )) && [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  cat >&2 <<'EOF'
error: no Linux display session detected.

Tauri can compile headlessly, but `tauri dev` needs a desktop session through either DISPLAY or WAYLAND_DISPLAY.
If you are inside the Mission dev container, build checks can run there, but the GUI host must run on a Linux desktop session or through explicit display forwarding.
EOF
  exit 1
fi

echo "Linux native toolchain prerequisites are available."

if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  echo "No DISPLAY or WAYLAND_DISPLAY detected. Build and check flows can run, but GUI launch requires a Linux desktop session."
fi