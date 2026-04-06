@echo off
setlocal
for /f "delims=" %%i in ('git -C "%CD%" rev-parse --show-toplevel 2^>nul') do set "REPO_ROOT=%%i"
if not defined REPO_ROOT set "REPO_ROOT=%~dp0..\.."
set "MISSION_DAEMON_COMMAND=%REPO_ROOT%\missiond.cmd"

if "%~1"=="--hmr" (
	shift
	call pnpm --dir "%~dp0" exec tsx watch src/index.ts %*
) else (
	call pnpm --dir "%~dp0" exec tsx src/index.ts %*
)
