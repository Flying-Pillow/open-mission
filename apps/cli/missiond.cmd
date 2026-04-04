@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "SOURCE_ENTRY=%SCRIPT_DIR%src\daemon.ts"
set "BUILD_ENTRY=%SCRIPT_DIR%build\daemon.js"

if not "%MISSION_REPO_ROOT%"=="" (
	set "REPO_ROOT=%MISSION_REPO_ROOT%"
) else (
	for /f "usebackq delims=" %%i in (`git -C "%CD%" rev-parse --show-toplevel 2^>nul`) do set "REPO_ROOT=%%i"
	if "%REPO_ROOT%"=="" set "REPO_ROOT=%CD%"
)

if /i "%MISSION_DAEMON_LAUNCH_MODE%"=="source" if exist "%SOURCE_ENTRY%" (
	set "MISSION_REPO_ROOT=%REPO_ROOT%"
	call pnpm --dir "%SCRIPT_DIR%" exec tsx "%SOURCE_ENTRY%" %*
	exit /b %ERRORLEVEL%
)

if exist "%BUILD_ENTRY%" (
	set "MISSION_REPO_ROOT=%REPO_ROOT%"
	call node "%BUILD_ENTRY%" %*
	exit /b %ERRORLEVEL%
)

if exist "%SOURCE_ENTRY%" (
	set "MISSION_REPO_ROOT=%REPO_ROOT%"
	call pnpm --dir "%SCRIPT_DIR%" exec tsx "%SOURCE_ENTRY%" %*
	exit /b %ERRORLEVEL%
)

echo missiond: no daemon entrypoint found. Build the CLI package first. 1>&2
exit /b 1
