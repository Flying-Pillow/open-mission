@echo off
setlocal
for /f "delims=" %%i in ('git -C "%CD%" rev-parse --show-toplevel 2^>nul') do set "REPO_ROOT=%%i"
if not defined REPO_ROOT set "REPO_ROOT=%~dp0..\.."
set "MISSION_DAEMON_COMMAND=%REPO_ROOT%\missiond.cmd"
set "HMR_MODE=0"

:parse_wrapper_flags
if "%~1"=="--hmr" (
	set "HMR_MODE=1"
	shift
	goto parse_wrapper_flags
)

if "%HMR_MODE%"=="1" (
	call pnpm --dir "%~dp0" exec tsx watch src/index.ts %*
) else (
	call pnpm --dir "%~dp0" exec tsx src/index.ts %*
)
