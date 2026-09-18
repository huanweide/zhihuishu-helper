/**
 * studyvideoh5 真实结构 · 端到端自测
 *
 * 背景（2026-09-18 实地）：真实 studyvideoh5.zhihuishu.com/stuStudy 页面已改用
 * Element UI 目录树，条目选择器是 .file-item（当前项 .file-item.active），
 * 而旧脚本把该域名按 legacy/wisdom 处理，导致「识别不出页面 → 目录瞎认 → 跳不了下一集」。
 *
 * 本用例用真实 Chrome + 真实 dist 产物验证修复是否成立：
 *   ① dist 注入无错
 *   ② 适配器识别为 hike
 *   ③ 折叠章节被自动展开，目录条目数 3 → 5
 *   ④ 完成标记 .icon-finish 识别为已完成
 *   ⑤ 未解锁 .el-icon-lock 识别为 locked 并跳过
 *   ⑥ findNext 按目录顺序命中「下一未完成节」
 *   ⑦ 真实 click 后当前项挪到目标节
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

(async () => {
  console.log('studyvideoh5 真实结构 · 端到端自测（真实 Chrome / 真实 dist）\n');

  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });

  const url = 'file:///' + path.join(ROOT, 'test', 'fixtures', 'real-h5.html').replace(/\\/g, '/');
  await p.goto(url, { waitUntil: 'domcontentloaded' });

  // 注入前：第 2 章折叠，它的子节点还没渲染到 DOM（Node? 0 个），
  // 此时脚本不展开的话，2.1 / 2.2 根本取不到也点不到。
  const before = await p.evaluate(() => ({
    ch2Rendered: document.querySelectorAll('.js-slot .file-item').length,
    visibleAll: document.querySelectorAll('.file-item').length,
  }));
  console.log('   [注入前] 第2章已渲染子节 =', before.ch2Rendered, '；页面全部 .file-item =', before.visibleAll, '（含 2 个章节标题行）');

  await p.evaluate(() => {
    const store = Object.create(null);
    window.GM_setValue = (k, v) => { store[k] = v; };
    window.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);
    window.GM_deleteValue = (k) => { delete store[k]; };
    window.GM_listValues = () => Object.keys(store);
    window.GM_xmlhttpRequest = (o) => setTimeout(() => o.onload && o.onload({ status: 200, responseText: '{}' }), 20);
    window.__E2E_ERR__ = '';
    window.addEventListener('error', (e) => { window.__E2E_ERR__ += (e.message || '') + ';'; });
  });

  await p.addScriptTag({ content: distBody });
  await p.waitForFunction('window.ZHS && window.ZHS.Catalog && window.ZHS.Catalog.items().length > 0', { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800)); // 等自动展开触发后被 items() 重新采集

  const res = await p.evaluate(() => {
    const Z = window.ZHS, C = Z.Catalog;
    const items = C.items();
    const cur = C.current();
    const titles = items.map((e) => C.itemTitle(e));
    const statuses = items.map((e) => C.statusOf(e));
    const next = C.findNext(cur);
    const nextTitle = next ? C.itemTitle(next) : null;
    let clickErr = null;
    try { if (next) C.click(next); } catch (e) { clickErr = e.message; }
    return {
      adapter: Z.state.siteVersion,
      total: items.length,
      titles, statuses,
      curTitle: cur ? C.itemTitle(cur) : null,
      nextTitle,
      err: window.__E2E_ERR__ || null,
      clickErr,
    };
  });

  // 点击后等 DOM 更新再读结果
  await new Promise((r) => setTimeout(r, 500));
  const after = await p.evaluate(() => {
    const C = window.ZHS.Catalog;
    const c = C.current();
    return { curTitle: c ? C.itemTitle(c) : null };
  });

  await b.close();

  ok('① dist 注入无运行时错误', res.err === null, res.err || '');
  ok('② 适配器识别为 hike（新版 el-tree 目录）', res.adapter === 'hike', '得到 ' + res.adapter);
  ok('③ 折叠章节被自动展开（第2章子节 0 → 2，目录 3 → 5）',
    before.ch2Rendered === 0 && res.total === 5,
    '注入前第2章子节=' + before.ch2Rendered + ' 现在目录数=' + res.total);
  ok('④ 完成标记 .icon-finish 被识别为已完成', res.statuses[res.titles.indexOf('1.1 映射与函数')] === 'done',
    JSON.stringify(res.statuses));
  ok('⑤ 未解锁 .el-icon-lock 被识别为 locked', res.statuses[res.titles.indexOf('2.1 导数概念')] === 'locked',
    JSON.stringify(res.statuses));
  ok('⑥ findNext 命中下一未完成节 1.3', res.nextTitle === '1.3 函数的极限', '得到 ' + JSON.stringify(res.nextTitle));
  ok('⑦ 真实点击跳转生效', after.curTitle === '1.3 函数的极限', '当前=' + JSON.stringify(after.curTitle));
  ok('⑧ 点击过程无异常', res.clickErr === null, res.clickErr || '');
  console.log('   [目录]', JSON.stringify(res.titles));
  console.log('   [状态]', JSON.stringify(res.statuses));

  console.log('\n========================================');
  console.log('结果：通过 ' + pass + ' / 失败 ' + fail);
  if (fail > 0) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('全部通过：studyvideoh5 真实结构下「自动展开 + 按序跳到下一未完成节」成立。');
})().catch((e) => { console.error('自测异常：', e); process.exit(2); });
