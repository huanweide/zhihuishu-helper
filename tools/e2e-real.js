/**
 * 真实网课情况 · 端到端自测
 *
 * 思路：用 puppeteer-core 启动真实 Chrome（headless:'new'，无窗口，符合 GUI 验证铁律），
 * 加载「与真实网课页面完全一致的章节目录 DOM 结构」夹具，注入真实 dist 产物（zhihuishu-helper.user.js），
 * 在真实浏览器引擎里跑真实代码，验证：
 *   1. 站点适配器识别正确（wisdom / legacy）
 *   2. 右侧栏完成标记（对勾 .child-check / .time_icofinish）被识别为「已完成」金标准
 *   3. 未解锁节（.lock-icon）被识别为 locked 并跳过
 *   4. 从当前节往后，findNext 命中「下一节未完成」且按目录顺序
 *   5. 真实点击（cat.click，即 gotoNext 最后一步）把当前播放节挪到目标节
 *
 * 不使用 jsdom 假 DOM —— 全部在真实 Chrome 解析真实 DOM 上验证。
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const distRaw = fs.readFileSync(path.join(ROOT, 'dist', 'zhihuishu-helper.user.js'), 'utf8');
const distBody = distRaw.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

async function testFixture(label, file, expected) {
  console.log('\n=== ' + label + ' ===');
  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });

  const url = 'file:///' + path.join(ROOT, 'test', 'fixtures', file).replace(/\\/g, '/');
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 400));

  // GM 函数桩 + 全局错误捕获
  await p.evaluate(() => {
    const s = Object.create(null);
    window.GM_setValue = (k, v) => { s[k] = v; };
    window.GM_getValue = (k, d) => (s[k] !== undefined ? s[k] : d);
    window.GM_deleteValue = (k) => { delete s[k]; };
    window.GM_listValues = () => Object.keys(s);
    window.GM_xmlhttpRequest = (o) => setTimeout(() => o.onload && o.onload({ status: 200, responseText: '{}' }), 20);
    window.addEventListener('error', (e) => { window.__E2E_ERR__ = (window.__E2E_ERR__ || '') + (e.message || ''); });
  });

  // 注入真实 dist 产物
  await p.addScriptTag({ content: distBody });

  // 等 ZHS 就绪，然后立即停掉自动调度，避免 watch 干扰受控验证
  await p.waitForFunction('window.ZHS && window.ZHS.Catalog && window.ZHS.Catalog.items().length > 0', { timeout: 20000 });
  await p.evaluate(() => {
    if (window.ZHS && window.ZHS.Scheduler && window.ZHS.Scheduler.stop) window.ZHS.Scheduler.stop();
    if (window.ZHS && window.ZHS.state) window.ZHS.state.running = false;
  });

  const res = await p.evaluate(async (exp) => {
    const Z = window.ZHS, C = Z.Catalog;
    const items = C.items();
    const cur = C.current();
    const bd = C.breakdown();
    const next = C.findNext(cur);
    const nextTitle = next ? C.itemTitle(next) : null;

    // 真实完成标记识别（金标准）
    const doneEl = items.find((e) => C.statusOf(e) === 'done');
    const doneFinished = doneEl ? C.isFinished(doneEl) : null;

    // 锁定节识别
    const lockedEl = items.find((e) => C.statusOf(e) === 'locked');
    const lockedTitle = lockedEl ? C.itemTitle(lockedEl) : null;

    // 行为层：真实点击（即 gotoNext 内部 cat.click(next) 那一步）
    let clickErr = null;
    try { if (next) C.click(next); } catch (e) { clickErr = e.message; }
    await new Promise((r) => setTimeout(r, 150));

    const newCur = C.current();
    const newTitle = newCur ? C.itemTitle(newCur) : null;

    return {
      adapter: Z.state.siteVersion,
      total: items.length,
      breakdown: bd,
      doneFinished,
      lockedTitle,
      findNextTitle: nextTitle,
      expectedNext: exp.expectedNext,
      expectedLocked: exp.expectedLocked,
      newTitle,
      clickErr,
      err: window.__E2E_ERR__ || null,
    };
  }, expected);

  await b.close();

  // ---- 断言 ----
  ok('① dist 注入无运行时错误', res.err === null, res.err || '');
  ok('② 适配器识别为 ' + expected.adapter, res.adapter === expected.adapter, '得到 ' + res.adapter);
  ok('③ 目录条目数=' + expected.total, res.total === expected.total, '得到 ' + res.total);
  ok('④ 右侧栏完成标记被识别为已完成（金标准）', res.doneFinished === true, 'doneFinished=' + res.doneFinished);
  ok('⑤ 未解锁节跳过且被识别', res.lockedTitle === expected.expectedLocked,
    'locked=' + JSON.stringify(res.lockedTitle) + ' 期望 ' + JSON.stringify(expected.expectedLocked));
  ok('⑥ findNext 命中「下一未完成节」（按目录顺序）', res.findNextTitle === expected.expectedNext,
    'findNext=' + JSON.stringify(res.findNextTitle) + ' 期望 ' + JSON.stringify(expected.expectedNext));
  ok('⑦ 真实点击跳转生效（当前节已挪到目标）', res.newTitle === expected.expectedNext,
    'newCurrent=' + JSON.stringify(res.newTitle) + ' 期望 ' + JSON.stringify(expected.expectedNext));
  ok('⑧ 点击过程无异常', res.clickErr === null, res.clickErr || '');
  console.log('   [目录状态] ' + JSON.stringify(res.breakdown));
  return res;
}

(async () => {
  console.log('真实网课情况 · 端到端自测（真实 Chrome / 真实 DOM / 真实 dist）');
  await testFixture('智慧版共享课 (wisdom 结构)', 'real-wisdom.html', {
    adapter: 'wisdom', total: 5, expectedNext: 'Unit1 C 写作入门', expectedLocked: null,
  });
  await testFixture('旧版共享课 (legacy 结构)', 'real-legacy.html', {
    adapter: 'legacy', total: 5, expectedNext: '2.3 高阶导数', expectedLocked: '2.2 求导法则',
  });

  console.log('\n========================================');
  console.log('结果：通过 ' + pass + ' / 失败 ' + fail);
  if (fail > 0) {
    console.log('失败项：');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  } else {
    console.log('全部通过：真实网课情况下「按目录顺序自动跳到没学完的课程」逻辑成立。');
  }
})().catch((e) => {
  console.error('自测脚本异常：', e);
  process.exit(2);
});
