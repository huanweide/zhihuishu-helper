@echo off
REM 智慧树调试 Edge 启动器（固定 profile，登录态只存一次）
REM 若已有一个调试实例在跑，先关掉它（只关用本 profile 的，不动你的正常 Edge）
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*zhs_edge_profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" 2>nul
timeout /t 1 >nul
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir=C:\Users\Administrator\zhs_edge_profile --no-first-run --no-default-browser-check --disable-blink-features=AutomationControlled --autoplay-policy=no-user-gesture-required --start-maximized "https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=4e5f5858465a4859454a585958425d415c"
echo 调试 Edge 已启动。请在弹出的窗口里登录智慧树，进入那门切不动的"Windows版"课程并停在某节课上。
