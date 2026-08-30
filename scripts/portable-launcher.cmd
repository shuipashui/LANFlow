@echo off
chcp 65001 >nul
title LANFlow
set "APP_DIR=%~dp0"
if not defined PORT set "PORT=4173"
set "LANFLOW_DATA_DIR=%APP_DIR%data"
if not defined LANFLOW_OPEN_BROWSER set "LANFLOW_OPEN_BROWSER=1"

if not exist "%APP_DIR%runtime\node.exe" (
  echo 运行文件不完整：缺少 runtime\node.exe
  pause
  exit /b 1
)

"%APP_DIR%runtime\node.exe" "%APP_DIR%src\server.js"

if errorlevel 1 (
  echo.
  echo 服务启动失败，请查看上方错误信息。
  pause
)
