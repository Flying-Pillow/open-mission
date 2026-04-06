@echo off
setlocal
for /f "delims=" %%i in ('git -C "%CD%" rev-parse --show-toplevel 2^>nul') do set "REPO_ROOT=%%i"
if not defined REPO_ROOT set "REPO_ROOT=%~dp0..\.."
set "MISSION_DAEMON_COMMAND=%REPO_ROOT%\missiond.cmd"
set "HMR_MODE=0"
set "TMUX_MODE=%MISSION_TMUX_MODE%"

:parse_wrapper_flags
if "%~1"=="--hmr" (
	set "HMR_MODE=1"
	shift
	goto parse_wrapper_flags
)
if "%~1"=="--tmux" (
	set "TMUX_MODE=force"
	shift
	goto parse_wrapper_flags
)
if "%~1"=="--no-tmux" (
	set "TMUX_MODE=off"
	shift
	goto parse_wrapper_flags
)

if /i "%TMUX_MODE%"=="force" (
	echo mission: tmux launch is not supported by mission.cmd. Use WSL or run mission --no-tmux on Windows. 1>&2
	exit /b 1
)

if "%HMR_MODE%"=="1" (
	call pnpm --dir "%~dp0" exec tsx watch src/index.ts %*
) else (
	call pnpm --dir "%~dp0" exec tsx src/index.ts %*
)
