# Mission Airport Native

Mission Airport Native is the Tauri desktop host for the Airport surface.

## Linux development

Validate the Linux native toolchain first:

```sh
pnpm --dir apps/airport/native run doctor:linux
```

On Debian or Ubuntu, the required system packages are:

```sh
sudo apt update
sudo apt install build-essential curl wget file libssl-dev \
  libgtk-3-dev libsoup-3.0-dev libwebkit2gtk-4.1-dev \
  libxdo-dev libayatana-appindicator3-dev librsvg2-dev
```

Start the Linux native host from the repository root:

```sh
pnpm --dir apps/airport/native run dev
```

`tauri dev` requires a Linux desktop session. If neither `DISPLAY` nor `WAYLAND_DISPLAY` is set, the native host will fail before GTK can initialize.

For headless launch in CI or inside the dev container, use Xvfb:

```sh
pnpm --dir apps/airport/native run dev:xvfb
```

For a visible desktop session inside the dev container, start the virtual desktop and then launch the native host against it:

```sh
bash scripts/start-virtual-linux-desktop.sh
DISPLAY=${MISSION_VIRTUAL_DISPLAY:-:99} pnpm --dir apps/airport/native run dev
```

The noVNC desktop is served at `http://localhost:6080/vnc.html`, and raw VNC is exposed on `localhost:5900`.

## Linux builds

Build the Linux desktop artifacts from the repository root:

```sh
pnpm --dir apps/airport/native run build
```

On Linux, Tauri now emits `deb` and `AppImage` bundles through the Linux-specific Tauri config override at `src-tauri/tauri.linux.conf.json`.

## macOS builds

Build the macOS desktop artifacts from the native package:

```sh
pnpm --dir /Users/ronb/mission/apps/airport/native run build
```

On macOS, the native app now bundles an embedded Node runtime plus the Airport web app's SvelteKit `adapter-node` output, then serves that local web server through Tauri's localhost path in production.

The packaged outputs land under `src-tauri/target/release/bundle/`, including:

- `macos/Mission Airport.app`
- `dmg/Mission Airport_0.1.0-alpha.0_x64.dmg`

## Dev container note

The Mission dev container now includes both the Linux system libraries needed to compile the Tauri host and the Xvfb/Fluxbox/x11vnc/noVNC stack needed for virtual Linux desktop sessions. Use `pnpm --dir apps/airport/native run dev:xvfb` for headless runs and `bash scripts/start-virtual-linux-desktop.sh` plus `DISPLAY=${MISSION_VIRTUAL_DISPLAY:-:99} pnpm --dir apps/airport/native run dev` when you want to see and interact with the window remotely.
