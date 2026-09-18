#!/usr/bin/env node
/**
 * 实地测试：连接用户 Edge 调试实例(9222)，在真实网课页面注入真实 dist，
 * 验证「自动跳转下一集」是否真的工作。全程截图留证。
 *
 * 用法: node tools/live-test.js [课程URL]
 */
const puppeteer = require('puppeteer-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = path.join(ROOT, '.edge-debug-profile');
const COURSE_URL = process.argv[2]
  || 'https://studyvideoh5.zhihuishu.com/stuStudy/recruitAndCourseId=a6e57b5cec5b4859454a5b5958435f475a';
const OUT = path.join(ROOT, 'live-shots');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpReady() {
  try {
    const r = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function ensureEdge() {
  if (await cdpReady()) { console.log('[edge] CDP 9222 已就绪'); return; }
  console.log('[edge] CDP 不通，分离启动 Edge 调试实例…');
  const child = spawn(EDGE, [
    '--user-data-dir=' + PROFILE,
    '--remote-debugging-port=9222',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    // 本机系统 DNS 已损坏（全部超时），用户平时靠浏览器 DoH 解析，这里显式启用阿里 DoH
    '--enable-features=DnsOverHttps',
    '--dns-over-https-mode=secure',
    '--dns-over-https-templates=https://223.5.5.5/dns-query',
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (await cdpReady()) { console.log('[edge] CDP 就绪 (等了 ' + (i + 1) + 's)'); return; }
  }
  throw new Error('Edge CDP 30s 未就绪');
}

(async () => {
  await ensureEdge();
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  console.log('[connect] ok, UA =', (await browser.userAgent()).slice(0, 80));

  // 找已有网课页，没有就新开
  let page = (await browser.pages()).find((p) => p.url().includes('zhihuishu.com'));
  if (!page) {
    page = await browser.newPage();
    console.log('[page] 打开课程页:', COURSE_URL);
    await page.goto(COURSE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', e.message));
  } else {
    console.log('[page] 复用已有网课标签页:', page.url().slice(0, 100));
  }

  await sleep(12000); // 等 SPA 渲染
  await page.screenshot({ path: path.join(OUT, '01-initial.png') });
  console.log('[shot] 01-initial.png');
  console.log('[page] url_now =', page.url());
  console.log('[page] title =', await page.title());

  // ---- 第一步：真实 DOM 探测 ----
  const probe = await page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    return {
      hasVideo: !!document.querySelector('video'),
      videoCount: q('video'),
      iframeCount: q('iframe'),
      sels: {
        childInfo: q('.child-info'),
        childInfoHasvideo: q('.child-info.hasvideo'),
        clearfixVideo: q('.clearfix.video'),
        lessonOrder: q('#lessonOrder'),
        lockIcon: q('[class*=lock]'),
        finishIcon: q('.time_icofinish, .child-check, [class*=finish]'),
        progressbar: q('[role=progressbar]'),
        portalledPanel: q('[class*=catalogue], [class*=chapter], [class*=section]'),
      },
      bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 260),
    };
  });
  console.log('[probe]', JSON.stringify(probe, null, 2));

  // ---- 第二步：注入 GM 桩 + 真实 dist ----
  const distRaw = fs.readFileSync(path.join(ROOT, 'dist', 'zhihuishu-helper.user.js'), 'utf8');
  const distBody = distRaw.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '');

  await page.evaluate(() => {
    if (window.__GM_STUBBED__) return;
    window.__GM_STUBBED__ = true;
    const memKey = '__ZHS_GM_STORE__';
    const s = (window[memKey] = window[memKey] || {});
    window.GM_setValue = (k, v) => { s[k] = v; };
    window.GM_getValue = (k, d) => (s[k] !== undefined ? s[k] : d);
    window.GM_deleteValue = (k) => { delete s[k]; };
    window.GM_listValues = () => Object.keys(s);
    window.GM_xmlhttpRequest = (o) => setTimeout(() => o.onload && o.onload({ status: 200, responseText: '{}' }), 20);
    window.__LIVE_ERR__ = '';
    window.addEventListener('error', (e) => { window.__LIVE_ERR__ += (e.message || '') + ';'; });
  });
  await page.addScriptTag({ content: distBody });
  console.log('[inject] dist 已注入');

  // ---- 第三步：等 ZHS 就绪并读取识别结果 ----
  let zhsReady = false;
  try {
    await page.waitForFunction('window.ZHS && window.ZHS.Catalog && window.ZHS.Catalog.items().length > 0', { timeout: 15000 });
    zhsReady = true;
  } catch { console.log('[inject] ZHS 15s 未识别到目录条目'); }

  await page.screenshot({ path: path.join(OUT, '02-after-inject.png') });
  console.log('[shot] 02-after-inject.png');

  const state1 = await page.evaluate(() => {
    if (!window.ZHS || !window.ZHS.Catalog) return { zhsReady: false, err: window.__LIVE_ERR__ };
    const Z = window.ZHS, C = Z.Catalog;
    const items = C.items();
    const cur = C.current();
    return {
      zhsReady: true,
      err: window.__LIVE_ERR__ || null,
      adapter: Z.state && Z.state.siteVersion,
      total: items.length,
      breakdown: C.breakdown ? C.breakdown() : null,
      curTitle: cur ? C.itemTitle(cur) : null,
      pending: C.pending ? C.pending().length : null,
      running: Z.state && Z.state.running,
      panelVisible: !!(document.querySelector('#zhs-panel') || document.querySelector('[class*=zhs-panel]')),
    };
  });
  console.log('[zhs-state]', JSON.stringify(state1, null, 2));

  // ---- 第四步：验证真实点击跳转（下一节未完成） ----
  if (state1.zhsReady && state1.total > 0) {
    const clickRes = await page.evaluate(async () => {
      const C = window.ZHS.Catalog;
      const cur = C.current();
      const next = C.findNext(cur);
      if (!next) return { next: null };
      const nextTitle = C.itemTitle(next);
      const before = C.itemTitle(C.current());
      try { C.click(next); } catch (e) { return { next: nextTitle, err: e.message, before }; }
      await new Promise((r) => setTimeout(r, 3000));
      const after = C.current() ? C.itemTitle(C.current()) : null;
      return { next: nextTitle, before, after, url: location.href.slice(0, 120) };
    });
    console.log('[click-test]', JSON.stringify(clickRes, null, 2));
    await sleep(4000);
    await page.screenshot({ path: path.join(OUT, '03-after-click.png') });
    console.log('[shot] 03-after-click.png');
  }

  console.log('\n===== 实地测试结束（浏览器实例保留运行） =====');
  await browser.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('live-test 异常:', e);
  process.exit(2);
});
