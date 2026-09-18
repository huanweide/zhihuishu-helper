/**
 * studyvideoh5「旧版结构 + 干扰项」端到端自测
 *
 * 背景（2026-09-18）：这是用户实际在用的页面的危险形态 ——
 * 侧边栏存在零星几个 .file-item（新版 Vue 目录用的类名），而真目录是 .clearfix.video。
 * 旧实现「候选里第一个 querySelector 命中就当选」会被侧栏抢走识别权：
 *   选中 hike → 目录只认到 3 个推荐位 → findNext 那 3 个 → 点下去当然没反应。
 * 这就是用户说的「功能全无用 / 点了下一节也没用」。
 *
 * 新的 detect() 用评分选举（能找到 current_play 的加 100 分），应当自动选回 legacy。
 *
 * 本用例同时验证 clickAndVerify：点完要轮询验收目标真的拿到了 current_play。
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
  console.log('studyvideoh5 旧版结构 + 干扰项 · 端到端自测（真实 Chrome / 真实 dist）\n');

  const b = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });

  const url = 'file:///' + path.join(ROOT, 'test', 'fixtures', 'studyvideoh5-legacy.html').replace(/\\/g, '/');
  await p.goto(url, { waitUntil: 'domcontentloaded' });

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

  // 第一轮：识别 + 目录 + 状态
  const r1 = await p.evaluate(() => {
    const C = window.ZHS.Catalog;
    const items = C.items();
    return {
      adapter: window.ZHS.state.siteVersion,
      total: items.length,
      titles: items.map((e) => C.itemTitle(e)),
      statuses: items.map((e) => C.statusOf(e)),
      curTitle: (function () { const c = C.current(); return c ? C.itemTitle(c) : null; })(),
      err: window.__E2E_ERR__ || null,
    };
  });

  // 第二轮：findNext + clickAndVerify（夹具的切换有 300ms 延迟，正好验证轮询等待）
  const r2 = await p.evaluate(async () => {
    const C = window.ZHS.Catalog;
    const cur = C.current();
    const next = C.findNext(cur);
    const nextTitle = next ? C.itemTitle(next) : null;
    let verified = null, verifyErr = null;
    try { verified = await C.clickAndVerify(next, { timeout: 3000, tries: 2 }); }
    catch (e) { verifyErr = e.message; }
    return {
      nextTitle,
      verified, verifyErr,
      curAfter: (function () { const c = C.current(); return c ? C.itemTitle(c) : null; })(),
      clickedSelf: window.__lastClickIsSelf === true,
      switchCount: window.__switchCount,
    };
  });

  await b.close();

  const idx = (t) => r1.titles.indexOf(t);

  ok('① dist 注入无运行时错误', r1.err === null, r1.err || '');
  ok('② 识别为 legacy（没被侧栏 .file-item 抢走）', r1.adapter === 'legacy', '得到 ' + r1.adapter);
  ok('③ 目录取到 5 个真课时', r1.total === 5, '得到 ' + r1.total);
  ok('④itemTitle 取到课时名而非纯序号', r1.titles.every((t) => !/^[\d.\s]*$/.test(t)), JSON.stringify(r1.titles));
  ok('⑤ .time_icofinish 识别为已完成', r1.statuses[idx('映射与函数')] === 'done', JSON.stringify(r1.statuses));
  ok('⑥ 100% 进度条目识别为已完成', r1.statuses[idx('导数概念')] === 'done', JSON.stringify(r1.statuses));
  ok('⑦ 当前项按 current_play 定位正确', r1.curTitle === '数列的极限', '得到 ' + JSON.stringify(r1.curTitle));
  ok('⑧ findNext 命中下一未完成节', r2.nextTitle === '函数的极限', '得到 ' + JSON.stringify(r2.nextTitle));
  ok('⑨ clickAndVerify 返回已确认切换', r2.verified === true, '得到 ' + r2.verified + (r2.verifyErr ? ' err=' + r2.verifyErr : ''));
  ok('⑩ 当前项真的挪到了目标节', r2.curAfter === '函数的极限', '得到 ' + JSON.stringify(r2.curAfter));
  ok('⑪ 点的是条目本体（不是内部 span）', r2.clickedSelf === true, '得到 ' + r2.clickedSelf);
  ok('⑫ 页面只被切换了 1 次（没乱点）', r2.switchCount === 1, '得到 ' + r2.switchCount);

  console.log('   [目录]', JSON.stringify(r1.titles));
  console.log('   [状态]', JSON.stringify(r1.statuses));

  console.log('\n========================================');
  console.log('结果：通过 ' + pass + ' / 失败 ' + fail);
  if (fail > 0) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('全部通过：干扰项存在时仍能认对页面、キチンと点到下一节。');
})().catch((e) => { console.error('自测异常：', e); process.exit(2); });
