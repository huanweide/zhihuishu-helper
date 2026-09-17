/**
 * 启动并保持调试 Edge 常驻 —— 用 Windows start 让 Edge 完全脱离父进程
 *
 * 用法：node tools/keep-edge.js
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = path.join(__dirname, '..', '.edge-debug-profile');
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function portReady() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

(async () => {
  const already = await portReady();
  if (already) {
    console.log('调试端口已就绪：' + already.Browser);
    return;
  }

  fs.mkdirSync(PROFILE, { recursive: true });

  // 用 cmd 的 start 启动：进程树完全脱离，Node 退出后 Edge 仍在
  const args = [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir="' + PROFILE + '"',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
    '--start-maximized',
    'https://onlineweb.zhihuishu.com/',
  ].join(' ');

  const cmd = 'start "" "' + EDGE + '" ' + args;
  console.log('启动命令：' + cmd.slice(0, 160) + '…');

  try {
    execSync('cmd /c ' + JSON.stringify(cmd), { stdio: 'ignore', windowsHide: true });
  } catch (e) {
    // start 命令总是返回非零，忽略
  }

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const v = await portReady();
    if (v) {
      console.log('✓ 已就绪：' + v.Browser + '  (' + (i + 1) + 's)');
      console.log('  窗口已打开智慧树，请完成登录（含验证码）');
      return;
    }
  }
  console.error('端口 30 秒未就绪。请确认所有 Edge 已退出后重试。');
  process.exit(1);
})();
