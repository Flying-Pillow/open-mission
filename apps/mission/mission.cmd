@echo off
setlocal
set "MISSION_DAEMON_COMMAND=%~dp0missiond.cmd"
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
