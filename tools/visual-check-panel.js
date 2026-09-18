/**
 * 面板视觉验证（临时工具，非项目测试套件）
 *
 * 目的：本轮改了 CSS 令牌/间距/字号，jsdom 只能验证 DOM 与类名，
 * 看不出「排版是否协调」。这里用真实 Chrome + 项目自带的仿真页面
 * (test/fixture-player.html) 渲染，然后截图 + 量关键几何数据：
 *   1. 面板三个 tab 的观感
 *   2. 200% 缩放时是否溢出视口（用户提到「放大界面」）
 *   3. 暗色主题下面板底色是否真的变了
 *   4. 真实 Fullscreen API 下 host 是否被迁进全屏元素（核心修复的现场验证）
 *
 * 用法：node tools/visual-check-panel.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SCRIPT = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');
const OUT = path.join(__dirname, 'visual-out');
const FIXTURE = path.join(ROOT, 'test', 'fixture-player.html');

fs.mkdirSync(OUT, { recursive: true });

/** 与 test/screenshot.js 相同的注入方式：去掉油猴头 + 打桩 GM_* API */
function buildInjectableScript() {
  const raw = fs.readFileSync(SCRIPT, 'utf8');
  const body = raw.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '');
  return `
(function(){
  var _store = Object.create(null);
  window.GM_setValue = function(k, v){ _store[k] = v; };
  window.GM_getValue = function(k, d){ return _store[k] !== undefined ? _store[k] : d; };
  window.GM_deleteValue = function(k){ delete _store[k]; };
  window.GM_xmlhttpRequest = function(opts){
    setTimeout(function(){ if (opts.onload) opts.onload({ status: 404, responseText: '{}' }); }, 20);
  };
  try { ${body} } catch (e) { window.__VIS_ERROR__ = e.message; console.log('注入异常: ' + e.message); }
})();
`;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
      '--autoplay-policy=no-user-gesture-required'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('console', (m) => {
      const t = m.text();
      if (t.includes('智慧树助手') && /面板|全屏|挂载|迁移/.test(t)) console.log('    [页面] ' + t.slice(0, 140));
    });
    page.on('pageerror', (e) => console.log('    [页面错误] ' + e.message));

    const url = 'file:///' + FIXTURE.replace(/\\/g, '/') + '?recruitAndCourseId=visual001';
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(buildInjectableScript());
    await new Promise((r) => setTimeout(r, 1500));

    const mounted = await page.evaluate(() => !!document.getElementById('zhs-helper-panel'));
    console.log('\n面板已挂载：' + mounted);
    if (!mounted) {
      console.log('注入失败，错误：' + await page.evaluate(() => window.__VIS_ERROR__));
      await browser.close();
      return;
    }

    const goto = async (tab) => {
      await page.evaluate((t) => {
        const sr = document.getElementById('zhs-helper-panel').shadowRoot;
        sr.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
        sr.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t));
      }, tab);
      await new Promise((r) => setTimeout(r, 300));
    };

    console.log('\n--- 截图：三个 tab ---');
    await goto('home');
    await page.screenshot({ path: path.join(OUT, '01-状态页.png') });
    console.log('  → 01-状态页.png');
    await goto('log');
    await page.evaluate(() => {
      window.ZHS.Log.info('演示日志：面板已迁移到全屏元素内');
      window.ZHS.Log.warn('演示日志：全屏下悬浮窗不可见（示例警告）');
      window.ZHS.Log.error('演示日志：模拟一条错误');
      const sr = document.getElementById('zhs-helper-panel').shadowRoot;
      window.ZHS.panel._renderLogs(sr.querySelector('.wrap'));
    });
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: path.join(OUT, '02-日志页.png') });
    console.log('  → 02-日志页.png');
    await goto('cfg');
    await page.screenshot({ path: path.join(OUT, '03-设置页.png') });
    console.log('  → 03-设置页.png');

    // ---- 几何量测：面板是否贴合右下角、有没有溢出 ----
    console.log('\n--- 几何数据（1x） ---');
    console.log(JSON.stringify(await page.evaluate(() => {
      const host = document.getElementById('zhs-helper-panel');
      const wrap = host.shadowRoot.querySelector('.wrap');
      const panel = host.shadowRoot.querySelector('.panel');
      const body = host.shadowRoot.querySelector('.body');
      const cs = getComputedStyle(wrap);
      const r = panel.getBoundingClientRect();
      return {
        wrapRight: cs.right, wrapBottom: cs.bottom, wrapPosition: cs.position,
        panel: { w: Math.round(r.width), h: Math.round(r.height),
          rightGap: Math.round(window.innerWidth - r.right), bottomGap: Math.round(window.innerHeight - r.bottom) },
        bodyMaxHeight: getComputedStyle(body).maxHeight,
        viewport: { w: window.innerWidth, h: window.innerHeight },
      };
    }), null, 2));

    // ---- 200% 缩放 ----
    console.log('\n--- 缩放 200% ---');
    await page.evaluate(() => { document.body.style.zoom = '2'; });
    await new Promise((r) => setTimeout(r, 500));
    console.log(JSON.stringify(await page.evaluate(() => {
      const panel = document.getElementById('zhs-helper-panel').shadowRoot.querySelector('.panel');
      const r = panel.getBoundingClientRect();
      return {
        panel: { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
        viewportH: window.innerHeight,
        overflowsBottom: r.bottom > window.innerHeight,
        overflowsLeft: r.left < 0,
      };
    }), null, 2));
    await page.screenshot({ path: path.join(OUT, '04-缩放200.png') });

    // ---- 小视口（模拟笔记本半屏 / 高缩放） ----
    await page.evaluate(() => { document.body.style.zoom = '1'; });
    await page.setViewport({ width: 1000, height: 420 });
    await new Promise((r) => setTimeout(r, 500));
    console.log('\n--- 小视口 1000x420 ---');
    console.log(JSON.stringify(await page.evaluate(() => {
      const panel = document.getElementById('zhs-helper-panel').shadowRoot.querySelector('.panel');
      const body = document.getElementById('zhs-helper-panel').shadowRoot.querySelector('.body');
      const r = panel.getBoundingClientRect();
      return {
        panel: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
        bodyMaxHeight: getComputedStyle(body).maxHeight,
        viewportH: window.innerHeight,
        overflowsBottom: r.bottom > window.innerHeight,
      };
    }), null, 2));
    await page.screenshot({ path: path.join(OUT, '05-小视口.png') });
    await page.setViewport({ width: 1440, height: 900 });

    // ---- 暗色主题 ----
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await new Promise((r) => setTimeout(r, 500));
    console.log('\n--- 暗色主题 ---');
    console.log(JSON.stringify(await page.evaluate(() => {
      const sr = document.getElementById('zhs-helper-panel').shadowRoot;
      const panel = sr.querySelector('.panel');
      const body = sr.querySelector('.body');
      const head = sr.querySelector('.head');
      const foot = sr.querySelector('.foot');
      const tabs = sr.querySelector('.tabs');
      const inp = sr.querySelector('.inp');
      const hostCs = getComputedStyle(document.getElementById('zhs-helper-panel'));
      return {
        darkMediaMatches: window.matchMedia('(prefers-color-scheme: dark)').matches,
        tokenN0: hostCs.getPropertyValue('--zhs-n-0').trim(),
        tokenPri600: hostCs.getPropertyValue('--zhs-pri-600').trim(),
        panelBg: getComputedStyle(panel).backgroundColor,
        panelColor: getComputedStyle(panel).color,
        headBg: getComputedStyle(head).backgroundImage.slice(0, 60),
        tabsBg: getComputedStyle(tabs).backgroundColor,
        bodyBg: getComputedStyle(body).backgroundColor,
        bodyColor: getComputedStyle(body).color,
        footBg: getComputedStyle(foot).backgroundColor,
        rowLabelColor: getComputedStyle(sr.querySelector('.row label')).color,
        inputBg: inp ? getComputedStyle(inp).backgroundColor : null,
        inputColor: inp ? getComputedStyle(inp).color : null,
      };
    }), null, 2));
    await page.screenshot({ path: path.join(OUT, '06-暗色主题.png') });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    // ---- 核心：真实 Fullscreen API ----
    console.log('\n--- 真实 Fullscreen API 验证 ---');
    // 先在页面里自行挂一个探针，确认浏览器到底有没有派发 fullscreenchange，
    // 以便区分「浏览器没派发」和「我们的监听没生效」这两种完全不同的故障。
    await page.evaluate(() => {
      window.__FS_EVENTS__ = [];
      document.addEventListener('fullscreenchange', () => {
        window.__FS_EVENTS__.push('fullscreenchange@' + Date.now());
      });
      window.__FS_PROBE__ = {
        boundDocs: window.ZHS.panel._fsBoundDocs ? window.ZHS.panel._fsBoundDocs.length : -1,
        hasDoc: !!(window.ZHS.panel._fsBoundDocs
          && window.ZHS.panel._fsBoundDocs.indexOf(document) >= 0),
      };
    });
    console.log('监听注册情况：' + JSON.stringify(await page.evaluate(() => window.__FS_PROBE__)));

    // 给面板方法打一层追踪：记录 _onFullscreenChange 的进入/退出以及关键分支判断，
    // 用来区分「事件没进到我们的处理器」和「进去了但判空返回了」。
    await page.evaluate(() => {
      const P = window.ZHS.panel;
      window.__FS_TRACE__ = [];
      const orig = P._onFullscreenChange.bind(P);
      P._onFullscreenChange = function () {
        window.__FS_TRACE__.push('enter: root=' + !!this._root + ' fsEl=' +
          (this._fsElement() ? (this._fsElement().id || this._fsElement().className) : 'null'));
        try { return orig(); } finally {
          window.__FS_TRACE__.push('exit: parent=' +
            (P._root && P._root.parentNode ? (P._root.parentNode.className || P._root.parentNode.nodeName) : 'null') +
            ' state=' + P._fsState);
        }
      };
    });

    const fsOk = await page.evaluate(async () => {
      const v = document.getElementById('testVideo');
      const shell = v.closest('.player') || v.parentElement;
      window.__FS_TARGET__ = shell.className || shell.tagName;
      try {
        await shell.requestFullscreen();
        return { ok: true, target: shell.className || shell.tagName };
      } catch (e) { return { ok: false, err: e.message }; }
    });
    console.log('requestFullscreen('.concat(fsOk.target || '-', '): ', JSON.stringify(fsOk)));
    await new Promise((r) => setTimeout(r, 1000));

    const fullscreenState = await page.evaluate(() => {
      const host = document.getElementById('zhs-helper-panel');
      const fse = document.fullscreenElement;
      const panel = host.shadowRoot.querySelector('.panel');
      const r = panel.getBoundingClientRect();
      return {
        fsEventsSeen: window.__FS_EVENTS__,
        fsTrace: window.__FS_TRACE__,
        fullscreenElement: fse ? (fse.id || fse.className || fse.tagName) : null,
        hostParent: host.parentNode ? (host.parentNode.id || host.parentNode.className || host.parentNode.tagName) : null,
        hostInsideFullscreenElement: !!(fse && fse.contains(host)),
        hostParentIsHtml: host.parentNode === document.documentElement,
        panelSize: { w: Math.round(r.width), h: Math.round(r.height) },
        fsState: window.ZHS.panel._fsState,
      };
    });
    console.log(JSON.stringify(fullscreenState, null, 2));
    await page.screenshot({ path: path.join(OUT, '07-全屏中.png') });

    // ---- <video> 全屏（最容易出问题的一种） ----
    await page.evaluate(() => { if (document.fullscreenElement) document.exitFullscreen(); });
    await new Promise((r) => setTimeout(r, 700));
    await page.evaluate(() => {
      const v = document.getElementById('testVideo');
      v.requestFullscreen().catch((e) => { window.__FS_ERR2__ = e.message; });
    });
    await new Promise((r) => setTimeout(r, 1000));
    console.log('\n--- <video> 全屏 ---');
    console.log(JSON.stringify(await page.evaluate(() => {
      const host = document.getElementById('zhs-helper-panel');
      const fse = document.fullscreenElement;
      const panel = host.shadowRoot.querySelector('.panel');
      const r = panel.getBoundingClientRect();
      return {
        fsErr: window.__FS_ERR2__ || null,
        fsEventsSeen: window.__FS_EVENTS__.length,
        fullscreenElement: fse ? (fse.id || fse.tagName) : null,
        hostParent: host.parentNode ? (host.parentNode.id || host.parentNode.className || host.parentNode.tagName) : null,
        hostParentTag: host.parentNode ? host.parentNode.tagName : null,
        attachedToVideoItself: host.parentNode && host.parentNode.tagName === 'VIDEO',
        panelSize: { w: Math.round(r.width), h: Math.round(r.height) },
        fsState: window.ZHS.panel._fsState,
      };
    }), null, 2));
    await page.screenshot({ path: path.join(OUT, '08-video全屏.png') });

    // 退出全屏 → 回迁
    await page.evaluate(() => { if (document.fullscreenElement) document.exitFullscreen(); });
    await new Promise((r) => setTimeout(r, 700));
    console.log('\n--- 退出全屏后 ---');
    console.log(JSON.stringify(await page.evaluate(() => {
      const host = document.getElementById('zhs-helper-panel');
      return {
        hostParentIsHtml: host.parentNode === document.documentElement,
        fsState: window.ZHS.panel._fsState,
        visible: host.getBoundingClientRect().width > 0,
      };
    }), null, 2));
    await page.screenshot({ path: path.join(OUT, '09-退出全屏后.png') });

    console.log('\n截图与数据输出目录：' + OUT);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('异常：' + e.message); console.error(e.stack); process.exit(1); });
