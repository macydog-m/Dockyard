@echo off
chcp 65001 >nul
setlocal
title Dockyard - 开发启动

rem Prefer the project's portable Node 24 without changing the global PATH.
if exist "%~dp0.local\node24\node.exe" set "PATH=%~dp0.local\node24;%PATH%"

pushd "%~dp0"
if errorlevel 1 (
  echo 无法进入项目目录。
  pause
  exit /b 1
)

where node.exe >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请安装 Node.js 24 后重新双击本文件。
  goto failed
)

node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) === 24 ? 0 : 1)"
if errorlevel 1 (
  echo 本项目需要 Node.js 24，请调整版本后重试。
  goto failed
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm。请检查 Node.js 安装。
  goto failed
)

if /i "%~1"=="--check" (
  node.exe --version
  call npm.cmd --version
  if errorlevel 1 goto failed
  goto success
)

if not exist "node_modules\" (
  echo 首次启动，正在安装项目依赖，请保持网络连接...
  call npm.cmd ci
  if errorlevel 1 goto failed
)

set "ELECTRON_RUN_AS_NODE="
if /i "%~1"=="--build-only" (
  call npm.cmd run desktop:build
  if errorlevel 1 goto failed
  goto success
)

echo 正在构建并启动 Dockyard 开发版...
echo 开发数据保存在：%CD%\.local\dev-data
echo 修改代码后，点击应用的“更多 → 重启软件”即可重新构建并启动。
echo.
call npm.cmd run desktop -- --data-dir "%CD%\.local\dev-data"
if errorlevel 1 goto failed

:success
popd
endlocal
exit /b 0

:failed
echo.
echo 启动失败，请查看上方错误信息。
pause
popd
endlocal
exit /b 1
