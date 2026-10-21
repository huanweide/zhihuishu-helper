'use strict';
// 纯只读探针：打印 findWs 选中的 WS + 全部 target（不过滤），用于"看300次"定位当前调试 Edge 真实状态
const { CdpConnection, findWsFromUdd } = require('./zhs-probe');
const path = require('path');
const PROFILE = process.env.ZHS_EDGE_PROFILE || 'C:\\Users\\Administrator\\zhs_edge_profile';

async function main() {
  // 1) 先看 DevToolsActivePort 文件里写的端口（如果存在）
  let filePort = 'N/A';
  try {
    const fp = path.join(PROFILE, 'DevToolsActivePort');
    if (require('fs').existsSync(fp)) {
      const txt = require('fs').readFileSync(fp, 'utf8').trim().split('\n');
      filePort = txt[0] || 'N/A';
    }
  } catch (e) { filePort = 'ERR:' + e.message; }

  // 2) 直接探测 127.0.0.1 / localhost / [::1] 三个端点，看哪个真活着
  const probe = async (host) => {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 1500);
      const r = await fetch('http://' + host + ':9222/json/version', { signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) return host + ' => HTTP ' + r.status;
      const j = await r.json();
      return host + ' => OK ws=' + (j.webSocketDebuggerUrl || '(none)').slice(0, 60);
    } catch (e) { return host + ' => ERR ' + e.message.slice(0, 80); }
  };
  const p127 = await probe('127.0.0.1');
  const ploc = await probe('localhost');
  const p6 = await probe('[::1]');

  // 3) findWs 实际选中的 WS
  let chosen = 'n/a';
  try {
    const { findWs } = require('./zhs-cli-findws-helper');
    chosen = await findWs();
  } catch (e) {
    // findWs 在 zhs-cli.js 内未导出，改为手动复刻兜底逻辑
    chosen = '(zhs-cli 未导出 findWs，见下方 getTargets 实测)';
  }

  // 4) 对 [::1] 真端点建连，列出全部 target（不过滤）
  let targetsReport = 'n/a';
  try {
    const r = await fetch('http://[::1]:9222/json/version');
    const j = await r.json();
    const ws = j.webSocketDebuggerUrl;
    const conn = new CdpConnection(ws);
    const targets = await conn.callT('Target.getTargets', {}, null, 12000);
    targetsReport = (targets.targetInfos || []).map((t, i) =>
      '  [' + i + '] type=' + t.type + '  url=' + (t.url || '').slice(0, 120) + '  title=' + (t.title || '').slice(0, 40)
    ).join('\n');
    conn.close();
  } catch (e) { targetsReport = 'ERR ' + e.message.slice(0, 200); }

  console.log('=== 端口文件 DevToolsActivePort 第一行的端口 ===');
  console.log('  ' + filePort);
  console.log('\n=== 三端点探测 ===');
  console.log('  ' + p127);
  console.log('  ' + ploc);
  console.log('  ' + p6);
  console.log('\n=== findWs 选中(若可探) ===');
  console.log('  ' + chosen);
  console.log('\n=== [::1] 真实实例的全部 target（不过滤） ===');
  console.log(targetsReport);
}
main().catch((e) => { console.error('✗ ' + (e && e.message ? e.message : e)); process.exit(1); });
