'use strict';
/**
 * zhs-cli.js —— 智慧树助手外置命令行（用户只登录一次调试 Edge，CLI 反复接管）
 *
 * 子命令：
 *   start    启动固定 profile 的调试 Edge（含登录态，9222 端口，直开课程页）
 *   connect  列出可接管的 Edge 标签页
 *   diag     注入诊断探针 + CDP 网络监听，穷举切课策略并截获后端 API，输出报告 JSON
 *   run      [实验] 把 dist 主脚本 eval 进页面，接管播放（需页面已登录课程页）
 *
 * 用法：
 *   node tools/zhs-cli.js start
 *   node tools/zhs-cli.js connect
 *   node tools/zhs-cli.js diag [--url=课程URL]
 *   node tools/zhs-cli.js run   [--url=课程URL]
 *
 * 前置：先 start 打开调试 Edge 并登录一次；之后 connect/diag/run 反复复用，无需再登录。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { CdpConnection, findWsFromUdd } = require('./zhs-probe');
const { pageDiagSource } = require('./diag-probe');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = process.env.ZHS_EDGE_PROFILE || 'C:\\Users\\Administrator\\zhs_edge_profile';
const PORT = 9222;
const COURSE = process.env.ZHS_COURSE
  || 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=4e5f5858465a4859454a585958425d415c';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 端口是否真在监听（过滤 Edge 已关闭但 DevToolsActivePort 文件残留的死端口）
async function portAlive(port) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const r = await fetch('http://127.0.0.1:' + port + '/json/version', { signal: ac.signal });
    clearTimeout(t);
    return r.ok;
  } catch (e) { return false; }
}

// 只返回「确实在监听」的调试端点（避免连死端口导致 CDP 调用卡死）
async function findWs() {
  if (process.env.ZHS_WS) return process.env.ZHS_WS;
  const cands = [
    path.join(PROFILE, 'DevToolsActivePort'),
    process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\User Data',
    process.env.USERPROFILE + '\\zhs_edge_profile',
  ].filter(Boolean);
  for (const c of cands) {
    const w = findWsFromUdd(c);
    if (!w) continue;
    const m = /:(\d+)\//.exec(w);
    const port = m ? m[1] : null;
    if (port && await portAlive(port)) return w;
  }
  return null;
}

async function cmdStart() {
  if (await findWs()) {
    console.log('✓ 调试 Edge 已在运行（profile 锁定）。如需重启请先完全关闭 Edge。');
    return;
  }
  const args = [
    '--remote-debugging-port=' + PORT,
    '--user-data-dir="' + PROFILE + '"',
    '--no-first-run', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
    '--start-maximized', COURSE,
  ].join(' ');
  const cmd = 'start "" "' + EDGE + '" ' + args;
  console.log('启动调试 Edge（profile=' + PROFILE + '）...');
  try {
    spawn('cmd', ['/c', cmd], { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  } catch (e) {
    console.error('✗ 启动失败: ' + e.message);
    process.exit(1);
  }
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (findWs()) {
      console.log('✓ 已就绪（' + (i + 1) + 's）。请在该窗口登录智慧树（登录态存进 profile，之后无需再登录）。');
      return;
    }
  }
  console.error('✗ 30s 内端口未就绪。确认所有 Edge 已退出后重试。');
  process.exit(1);
}

async function cmdConnect() {
  const ws = await findWs();
  if (!ws) { console.error('✗ 找不到调试 Edge。先跑：node tools/zhs-cli.js start'); process.exit(2); }
  const conn = new CdpConnection(ws);
  try {
    const targets = await conn.callT('Target.getTargets', {}, null, 12000);
    const pages = (targets.targetInfos || []).filter((t) => t.type === 'page' && t.url && t.url !== 'about:blank');
    console.log('=== 可接管标签页 ' + pages.length + ' 个 ===');
    pages.forEach((p, i) => console.log('  [' + i + '] ' + (p.title || '(无标题)').slice(0, 40) + '  |  ' + p.url.slice(0, 100)));
  } finally {
    conn.close();
  }
}

async function cmdDiag(url) {
  const ws = await findWs();
  if (!ws) { console.error('✗ 找不到调试 Edge。先跑：node tools/zhs-cli.js start'); process.exit(2); }
  const conn = new CdpConnection(ws);
  let targetSession = null;
  const guard = setTimeout(() => { console.error('✗ 诊断超时(90s)'); process.exit(9); }, 90000);

  try {
    let targets = await conn.callT('Target.getTargets', {}, null, 12000);
    let pages = (targets.targetInfos || []).filter((t) => t.type === 'page' && t.url && t.url !== 'about:blank');
    let page = pages.find((t) => /zhihuishu/i.test(t.url || ''));
    if (!page) {
      if (url) {
        const created = await conn.callT('Target.createTarget', { url }, null, 15000);
        page = { targetId: created.targetId, url };
        await sleep(4000);
      } else {
        console.error('✗ 没有智慧树页面。用 --url=课程地址 或先在调试 Edge 打开课程页');
        process.exit(3);
      }
    }
    const attached = await conn.callT('Target.attachToTarget', { targetId: page.targetId, flatten: true }, null, 12000);
    targetSession = attached.sessionId;
    if (!targetSession) { console.error('✗ attach 失败'); process.exit(6); }

    // 后端 API 截获（CDP Network 域，协议级、零页面污染）
    const apis = [];
    conn.ws.on('message', (data) => {
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      if (!m.sessionId || m.sessionId !== targetSession) return;
      if (m.method === 'Network.requestWillBeSent') {
        const u = m.params.request.url;
        if (/zhihuishu|onlinestudy|studyvideoh|mooc|zhihuishu\.com/i.test(u)) {
          apis.push({ method: m.params.request.method, url: u.slice(0, 220), type: m.params.type || '' });
        }
      } else if (m.method === 'Network.responseReceived') {
        const u = m.params.response.url;
        const ex = apis.find((a) => a.url === u);
        if (ex) ex.status = m.params.response.status;
      }
    });
    await conn.callT('Network.enable', {}, targetSession, 12000).catch(() => {});
    await conn.callT('Runtime.enable', {}, targetSession, 12000).catch(() => {});

    console.log('注入诊断探针，穷举切课策略中（约 8s）...');
    const diag = await conn.callT('Runtime.evaluate',
      { expression: pageDiagSource, returnByValue: true, awaitPromise: true },
      targetSession, 30000);
    if (diag.exceptionDetails) {
      console.error('✗ 页内诊断抛异常: ' + JSON.stringify(diag.exceptionDetails).slice(0, 400));
      process.exit(7);
    }
    const data = diag.result.value;

    await sleep(6000); // 等网络采集
    data.apis = apis.slice(0, 60);

    const outFile = path.join(__dirname, 'zhs-diag.last.json');
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8');
    printSummary(data);
    console.log('\n已写入: ' + outFile);
  } finally {
    if (targetSession) { try { await conn.callT('Network.disable', {}, targetSession, 5000); } catch (e) { /* ignore */ } }
    conn.close();
    clearTimeout(guard);
  }
}

async function cmdRun(url) {
  const ws = await findWs();
  if (!ws) { console.error('✗ 找不到调试 Edge。先跑：node tools/zhs-cli.js start'); process.exit(2); }
  const conn = new CdpConnection(ws);
  let targetSession = null;
  try {
    let targets = await conn.callT('Target.getTargets', {}, null, 12000);
    let pages = (targets.targetInfos || []).filter((t) => t.type === 'page' && t.url && t.url !== 'about:blank');
    let page = pages.find((t) => /zhihuishu/i.test(t.url || ''));
    if (!page) {
      if (!url) { console.error('✗ 没有智慧树页面。用 --url=课程地址'); process.exit(3); }
      const c = await conn.callT('Target.createTarget', { url }, null, 15000);
      page = { targetId: c.targetId };
      await sleep(4000);
    }
    const at = await conn.callT('Target.attachToTarget', { targetId: page.targetId, flatten: true }, null, 12000);
    targetSession = at.sessionId;
    await conn.callT('Runtime.enable', {}, targetSession, 12000).catch(() => {});

    const distPath = path.join(__dirname, '..', 'dist', 'zhihuishu-helper.user.js');
    if (!fs.existsSync(distPath)) { console.error('✗ 找不到 dist 构建产物，先 node build.js'); process.exit(4); }
    const dist = fs.readFileSync(distPath, 'utf8');
    // 剥离 ==UserScript== 元数据块后整体 eval（页面没有 TM 的 GM_* API，脚本若依赖需后续 shim）
    const body = dist.replace(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==\s*/, '');
    console.log('注入主脚本到页面（实验性，依赖 GM_* 时可能报错）...');
    const r = await conn.callT('Runtime.evaluate', { expression: body, returnByValue: true }, targetSession, 30000);
    if (r && r.exceptionDetails) console.error('⚠ 注入抛异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    else console.log('✓ 主脚本已注入，查看页面状态面板/控制台确认运行');
  } finally {
    conn.close();
  }
}

function printSummary(d) {
  console.log('\n──────── 诊断摘要 ────────');
  console.log('URL      : ' + (d.url || '').slice(0, 110));
  console.log('标题     : ' + (d.title || '').slice(0, 50));
  console.log('框架     : ' + JSON.stringify(d.framework || {}));
  console.log('适配器   : ' + (d.adapter ? d.adapter.name + '  (container=' + d.adapter.container + ', items=' + d.adapter.items + ')' : 'null（未识别/兜底）'));
  console.log('目录候选 : ' + d.itemCount + ' 个');
  (d.items || []).slice(0, 12).forEach((it) => {
    console.log('   [' + it.i + '] ' + (it.isCurrent ? '▶' : ' ') + ' <' + it.tag + '> ' + (it.text || '').slice(0, 28)
      + '  href=' + (it.href || '-').slice(0, 50) + (it.doneMark ? '  [done]' : ''));
  });
  if (d.items && d.items.length > 12) console.log('   …另有 ' + (d.items.length - 12) + ' 节');
  console.log('视频     : ' + JSON.stringify(d.video || null));
  console.log('原生按钮 : ' + (d.nativeButtons || []).map((b) => b.text).join(' | '));
  console.log('iframe   : ' + (d.iframes || []).map((f) => f.src.slice(0, 50)).join(' | '));

  console.log('\n── 切课策略穷举（当前节 → 下一候选）──');
  if (d.strategiesNote) console.log('   ' + d.strategiesNote);
  (d.strategies || []).forEach((s) => {
    console.log('   ' + (s.didSwitch ? '✅' : '❌') + ' ' + s.name + (s.err ? '  错误:' + s.err.slice(0, 50) : ''));
    if (s.didSwitch) console.log('        before.video=' + (s.before.video || '').slice(0, 40) + '  after.tgtCls=' + (s.after.tgtCls || '').slice(0, 40));
  });

  console.log('\n── 后端 API（' + (d.apis || []).length + ' 条，含 zhihuishu）──');
  (d.apis || []).slice(0, 20).forEach((a) => {
    console.log('   [' + (a.status || '-') + '] ' + a.method + ' ' + (a.url || '').slice(0, 100));
  });
}

// ── 入口 ──
const argv = process.argv.slice(2);
const cmd = argv[0];
const url = (argv.find((a) => a.startsWith('--url=')) || '').slice(6);
(async () => {
  if (cmd === 'start') return cmdStart();
  if (cmd === 'connect') return cmdConnect();
  if (cmd === 'diag') return cmdDiag(url);
  if (cmd === 'run') return cmdRun(url);
  console.log('用法: node tools/zhs-cli.js <start|connect|diag|run> [--url=课程URL]');
  process.exit(0);
})().catch((e) => { console.error('✗ ' + (e && e.message ? e.message : e)); process.exit(1); });
