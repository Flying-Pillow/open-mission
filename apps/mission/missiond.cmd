@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "SOURCE_ENTRY=%SCRIPT_DIR%src\daemon.ts"
set "BUILD_ENTRY=%SCRIPT_DIR%build\daemon.js"

if /i "%MISSION_DAEMON_LAUNCH_MODE%"=="source" if exist "%SOURCE_ENTRY%" (
	call pnpm --dir "%SCRIPT_DIR%" exec tsx "%SOURCE_ENTRY%" %*
	exit /b %ERRORLEVEL%
)

if exist "%BUILD_ENTRY%" (
	call node "%BUILD_ENTRY%" %*
	exit /b %ERRORLEVEL%
)

if exist "%SOURCE_ENTRY%" (
	call pnpm --dir "%SCRIPT_DIR%" exec tsx "%SOURCE_ENTRY%" %*
	exit /b %ERRORLEVEL%
)

echo missiond: no daemon entrypoint found. Build the Mission package first. 1>&2
exit /b 1
