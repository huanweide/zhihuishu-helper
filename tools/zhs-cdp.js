/**
 * zhs-cdp.js —— 从 Edge 的 DevToolsActivePort 读出 CDP WebSocket 端点。
 *
 * 用途：playwright-cli 接管「已运行且已登录」的 Edge 时，需要这个 ws URL。
 *   playwright-cli attach --cdp=<ws> zhs
 *
 * 前置（Chrome 136+ 默认 profile 必做，否则调试端口被静默忽略）：
 *   在 Edge 内打开 edge://inspect → 左侧 Remote debugging → 勾
 *   「Allow remote debugging for this browser instance」。
 *   之后 Edge 会在 user-data-dir 下写 DevToolsActivePort 文件。
 *
 * 用法：
 *   node zhs-cdp.js [user-data-dir]
 *   成功 → 只输出一行 ws://127.0.0.1:<port>/devtools/browser/<uuid>
 *   失败 → 输出以 NO_DEBUG: 开头的错误信息到 stderr，并以 exit 2 退出。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_UDB = path.join(
  process.env.LOCALAPPDATA || '',
  'Microsoft', 'Edge', 'User Data'
);
const udb = process.argv[2] || DEFAULT_UDB;
const file = path.join(udb, 'DevToolsActivePort');

try {
  if (!fs.existsSync(file)) {
    throw new Error('找不到 ' + file + '\n请先按前置步骤在 Edge 内启用远程调试（edge://inspect）。');
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const port = (lines[0] || '').trim();
  const uuid = (lines[1] || '').trim();
  if (!/^\d+$/.test(port) || !uuid) {
    throw new Error('DevToolsActivePort 内容异常：port=' + port + ' uuid=' + uuid);
  }
  process.stdout.write('ws://127.0.0.1:' + port + '/devtools/browser/' + uuid + '\n');
} catch (e) {
  process.stderr.write('NO_DEBUG: ' + e.message + '\n');
  process.exit(2);
}
