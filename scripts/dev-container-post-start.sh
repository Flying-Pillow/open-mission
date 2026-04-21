#!/bin/bash
set -euo pipefail

echo "================================================================"
echo "=== Mission dev container post-start                         ==="
echo "================================================================"

cd /mission

export CARGO_HOME="/home/dev/.cargo"
export RUSTUP_HOME="/home/dev/.rustup"
export XDG_CACHE_HOME="/home/dev/.cache"
export LOCAL_BIN_HOME="/home/dev/.local/bin"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export TMPDIR="${XDG_CACHE_HOME}/tmp"
export TEMP="${TMPDIR}"
export TMP="${TMPDIR}"
export PATH="${LOCAL_BIN_HOME}:${CARGO_HOME}/bin:${PATH}"
export DOCKER_HOST="unix:///var/run/docker.sock"

mkdir -p "${CARGO_HOME}" \
         "${RUSTUP_HOME}" \
         "${XDG_CACHE_HOME}" \
         "${LOCAL_BIN_HOME}" \
         "${TMPDIR}"

linux_native_packages_missing=0
if [[ "$(uname -s)" == "Linux" ]] && command -v pkg-config >/dev/null 2>&1; then
  for package_name in gtk+-3.0 libsoup-3.0 webkit2gtk-4.1; do
    if ! pkg-config --exists "${package_name}"; then
      linux_native_packages_missing=1
      break
    fi
  done
fi

if [[ "${linux_native_packages_missing}" -eq 0 ]] && ([[ ! -f /usr/include/xdo.h ]] || ! find /usr/lib /usr/lib64 /usr/lib/x86_64-linux-gnu -name 'libxdo.so*' -print -quit 2>/dev/null | grep -q .); then
  linux_native_packages_missing=1
fi

linux_virtual_desktop_packages_missing=0
for command_name in Xvfb xauth fluxbox x11vnc websockify; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    linux_virtual_desktop_packages_missing=1
    break
  fi
done

if [[ ! -d /usr/share/novnc ]]; then
  linux_virtual_desktop_packages_missing=1
fi

if [[ "${linux_native_packages_missing}" -eq 1 || "${linux_virtual_desktop_packages_missing}" -eq 1 ]] && command -v sudo >/dev/null 2>&1; then
  echo "--- Installing missing Linux native and virtual desktop system packages ---"
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libsoup-3.0-dev \
    libwebkit2gtk-4.1-dev \
    libxdo-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    xvfb \
    xauth \
    fluxbox \
    x11vnc \
    novnc \
    websockify \
    dbus-x11 \
    locales
fi

if command -v sudo >/dev/null 2>&1; then
  sudo chown -R dev:dev "${CARGO_HOME}" "${RUSTUP_HOME}" "${XDG_CACHE_HOME}"
  while IFS= read -r workspace_path; do
    sudo chown -R dev:dev "${workspace_path}"
  done < <(find /mission -maxdepth 3 \( -path '/mission/node_modules' -o -path '/mission/*/node_modules' -o -path '/mission/*/*/node_modules' -o -path '/mission/pnpm-lock.yaml' \) 2>/dev/null | sort)
fi

if [ ! -w "${TMPDIR}" ]; then
  echo "error: TMPDIR is not writable: ${TMPDIR}" >&2
  exit 1
fi

echo "--- Toolchain versions ---"
corepack enable --install-directory "${LOCAL_BIN_HOME}" pnpm
corepack install
pnpm --version
node --version
cargo --version
rustc --version
if command -v starship >/dev/null 2>&1; then
  starship --version
fi

echo "--- Installing pnpm workspace dependencies ---"
pnpm install

echo "--- Building Mission installer packages ---"
pnpm --filter @flying-pillow/mission-core run build
pnpm --filter @flying-pillow/mission run build

echo "--- Bootstrapping Mission through the local installer ---"
node /mission/packages/mission/build/mission.js install --json

if [ -f /mission/apps/airport/native/src-tauri/Cargo.toml ]; then
  echo "--- Prefetching Rust dependencies for the native host ---"
  cargo fetch --manifest-path /mission/apps/airport/native/src-tauri/Cargo.toml
fi

echo "================================================================"
echo "=== Mission dev container ready                              ==="
echo "================================================================"
