@echo off
REM 智慧树网课 —— 用 playwright-cli 接管已运行的 Edge，开启实时监测面板
REM 前置（Chrome 136+ 默认 profile 必做）：Edge 内打开 edge://inspect
REM   → 左侧 Remote debugging → 勾 「Allow remote debugging for this browser instance」
REM 用法：zhs-monitor.cmd [user-data-dir]
setlocal
set "UDB=%LOCALAPPDATA%\Microsoft\Edge\User Data"
if not "%~1"=="" set "UDB=%~1"

for /f "usebackq delims=" %%u in (`node "%~dp0zhs-cdp.js" "%UDB%"`) do set "WS=%%u"

if defined WS if "%WS:~0,2%"=="ws" (
  echo [attach] %WS%
  call npx -y @playwright/cli attach --cdp=%WS% zhs
  echo [show] 实时面板已启动，浏览器访问下方输出的 localhost URL 即可看画面
  call npx -y @playwright/cli -s=zhs show --port 0
) else (
  echo 无法获取 CDP 端点：%WS%
  echo 请确认：1) Edge 正在运行  2) edge://inspect 已勾选 Allow remote debugging
)
endlocal
