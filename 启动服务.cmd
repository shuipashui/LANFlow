@echo off
chcp 65001 >nul
title LANFlow
set "NODE_EXE="
where node.exe >nul 2>&1
if not errorlevel 1 set "NODE_EXE=node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo Node.js not found. Please install Node.js 20 or later.
  echo https://nodejs.org/
  pause
  exit /b 1
)

set "PORT=4173"
if not defined LANFLOW_OPEN_BROWSER set "LANFLOW_OPEN_BROWSER=1"
"%NODE_EXE%" "%~dp0src\server.js"
if errorlevel 1 (
  echo.
  echo Failed to start LANFlow. See the error above.
  pause
)
