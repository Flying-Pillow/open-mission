@echo off
setlocal
for /f "delims=" %%i in ('git -C "%CD%" rev-parse --show-toplevel 2^>nul') do set "MISSION_REPO_ROOT=%%i"
if not defined MISSION_REPO_ROOT set "MISSION_REPO_ROOT=%~dp0..\.."
set "MISSION_DAEMON_COMMAND=%MISSION_REPO_ROOT%\missiond.cmd"

if "%~1"=="--hmr" (
	shift
	call pnpm --dir "%~dp0" exec tsx watch src/index.ts %*
) else (
	call pnpm --dir "%~dp0" exec tsx src/index.ts %*
)
