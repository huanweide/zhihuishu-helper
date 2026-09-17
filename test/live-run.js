/**
 * 真实站点测试 —— 统一入口
 *
 * 用法：
 *   node test/live-run.js login     打开有头浏览器，人工登录（登录态持久化到 .chrome-profile）
 *   node test/live-run.js recon     侦察已登录页面的真实 DOM 结构
 *   node test/live-run.js e2e       端到端全流程测试（注入脚本 + 断言 + 截图）
 *
 * 设计要点：
 *   - 用持久化 userDataDir，登录一次后续复用，不用反复登录
 *   - 脚本通过 addScriptTag 注入（模拟油猴注入时机）
 *   - 真实站点有反自动化措施，注入前清理 webdriver 痕迹
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'reference', 'live');
const SHOTS = path.join(ROOT, 'test', 'live-screenshots');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA = path.join(ROOT, '.chrome-profile');
const SCRIPT = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');

const TARGET = process.env.ZHS_URL
  || 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=4e5f5b5c4c5b4859454a585958435f475a';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const MODE = process.argv[2] || 'login';

/** 启动浏览器（持久化 profile） */
async function launch(headless) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: headless === undefined ? false : headless,
    userDataDir: USER_DATA,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--autoplay-policy=no-user-gesture-required',
      '--start-maximized',
    ],
  });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });
  return { browser, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  const f = path.join(SHOTS, name);
  await page.screenshot({ path: f, fullPage: false });
  console.log('    → 截图: ' + name);
  return f;
}

// ============================================================
// 模式 1：登录
// ============================================================
async function doLogin() {
  const { browser, page } = await launch(false);
  console.log('>>> 打开登录页，请在浏览器窗口里手动完成登录');
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);

  console.log('>>> 登录页已打开。请用你的账号登录（机构/微信/账号/扫码均可）。');
  console.log('>>> 登录成功并进入课程页后，本脚本会自动检测并保存状态。');
  console.log('>>> 最长等待 10 分钟。');

  const deadline = Date.now() + 10 * 60 * 1000;
  let loggedIn = false;
  while (Date.now() < deadline) {
    await sleep(5000);
    try {
      const st = await page.evaluate(() => ({
        url: location.href,
        hasTree: !!document.querySelector('.chapter-tree-74, .chapter-content, .el-tree'),
        hasVideo: !!document.querySelector('video'),
        host: location.hostname,
      }));
      if (st.hasTree || (st.hasVideo && st.host.includes('zhihuishu') && !st.host.includes('login'))) {
        loggedIn = true;
        console.log('\n>>> 检测到已进入课程页！URL: ' + st.url);
        break;
      }
    } catch (e) { /* 页面跳转中，忽略 */ }
  }

  if (loggedIn) {
    await sleep(3000);
    await shot(page, 'login-成功进入课程页.png');
    // 登录态 cookie 会自动留在 profile 目录
    const html = await page.content();
    fs.writeFileSync(path.join(OUT, 'rendered-logged-in.html'), html, 'utf8');
    console.log('>>> 登录态已持久化到 .chrome-profile，后续 recon/e2e 可直接复用');
  } else {
    console.log('\n>>> 超时未检测到课程页。若你已完成登录，请重跑 recon 模式验证。');
    await shot(page, 'login-超时状态.png');
  }

  await browser.close();
}

// ============================================================
// 模式 2：侦察真实 DOM
// ============================================================
async function doRecon() {
  const { browser, page } = await launch(true);
  console.log('>>> 打开目标页（复用已保存的登录态）');
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(10000);

  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));
    return {
      url: location.href,
      host: location.hostname,
      title: document.title,
      needLogin: location.hostname.includes('login'),

      // 页面族判别
      hasChapterTree74: !!q('.chapter-tree-74'),
      hasChapterContent: !!q('.chapter-content'),
      hasElTree: !!q('.el-tree'),
      hasClearfixVideo: !!q('.clearfix.video'),

      // 目录条目
      childInfo: qa('.child-info').length,
      childInfoHasVideo: qa('.child-info.hasvideo').length,
      chapterContentSecond: qa('.chapter-content-second').length,
      fileItem: qa('.file-item').length,
      cardContainer: qa('[class*="card-container"]').length,

      // 视频
      video: qa('video').length,
      videoInfo: (() => {
        const v = q('video');
        if (!v) return null;
        return { duration: v.duration, readyState: v.readyState, src: (v.src || '').slice(0, 80) };
      })(),

      // 课程信息
      courseName: (q('.course-name') || {}).innerText || null,
      courseTitleAlt: (q('.header-title-wrap') || {}).innerText || null,

      // 样例条目结构（前 3 个的 outerHTML 片段）
      sampleItems: qa('.child-info').slice(0, 3).map((el) => ({
        cls: el.className,
        title: (el.querySelector('.child-name') || {}).title || null,
        text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 60),
        hasCheck: !!el.querySelector('.child-check'),
        hasProgress: !!el.querySelector('[role="progressbar"]'),
        progressVal: (el.querySelector('[role="progressbar"]') || {}).getAttribute
          ? el.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') : null,
      })),

      // 弹题容器
      dialog: !!q('#playTopic-dialog'),
      tmDialogIframe: !!q('#tmDialog_iframe'),

      // 反自动化
      webdriver: navigator.webdriver,
      bodyTextHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    };
  });

  console.log('\n=== 真实页面结构 ===');
  console.log(JSON.stringify(info, null, 2));

  await shot(page, 'recon-01-页面全貌.png');

  const html = await page.content();
  fs.writeFileSync(path.join(OUT, 'rendered-recon.html'), html, 'utf8');
  console.log('\n渲染后 HTML 已存: reference/live/rendered-recon.html');

  await browser.close();
}

// ============================================================
// 模式 3：端到端测试
// ============================================================
async function doE2E() {
  let pass = 0, fail = 0;
  const failures = [];
  const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
  };

  const { browser, page } = await launch(true);

  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('智慧树助手')) console.log('    [页面] ' + t.slice(0, 150));
  });
  page.on('pageerror', (e) => console.log('    [页面错误] ' + e.message.slice(0, 150)));

  console.log('\n>>> 打开真实课程页');
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(10000);

  const pre = await page.evaluate(() => ({
    host: location.hostname,
    needLogin: location.hostname.includes('login'),
    hasVideo: !!document.querySelector('video'),
  }));

  if (pre.needLogin) {
    console.log('\n!!! 未登录，无法做端到端测试。请先跑：node test/live-run.js login');
    await shot(page, 'e2e-00-未登录.png');
    await browser.close();
    process.exit(2);
  }

  console.log('\n=== E1 脚本注入 ===');
  await shot(page, 'e2e-01-注入前.png');

  // 注入脚本（模拟油猴）
  const raw = fs.readFileSync(SCRIPT, 'utf8');
  const body = raw.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '');
  await page.evaluate(`(function(){
    window.__LIVE_LOGS__ = [];
    var _s = Object.create(null);
    Object.defineProperty(window, '__LIVE_STORE__', { get: function(){ return _s; }, configurable: true });
    window.GM_setValue = function(k,v){ _s[k]=v; };
    window.GM_getValue = function(k,d){ return _s[k]!==undefined?_s[k]:d; };
    window.GM_deleteValue = function(k){ delete _s[k]; };
    window.GM_xmlhttpRequest = function(o){
      window.__LIVE_LOGS__.push('[net] '+o.method+' '+o.url);
      // 真实站点：不拦截题库/LLM，走真网络
      try {
        var xhr = new XMLHttpRequest();
        xhr.open(o.method||'GET', o.url, true);
        Object.keys(o.headers||{}).forEach(function(h){ xhr.setRequestHeader(h, o.headers[h]); });
        xhr.timeout = o.timeout || 15000;
        xhr.onload = function(){ o.onload && o.onload({ status: xhr.status, responseText: xhr.responseText }); };
        xhr.onerror = function(){ o.onerror && o.onerror({}); };
        xhr.ontimeout = function(){ o.ontimeout && o.ontimeout({}); };
        xhr.send(o.data || null);
      } catch(e){ o.onerror && o.onerror({}); }
    };
    try { ${body} } catch(e){ window.__LIVE_ERROR__ = e.message + ' | ' + (e.stack||'').split('\\n')[1]; }
  })();`);

  await sleep(6000);

  const injected = await page.evaluate(() => ({
    err: window.__LIVE_ERROR__ || null,
    hasZHS: !!window.ZHS,
    version: window.ZHS ? window.ZHS.state.siteVersion : null,
    courseId: window.ZHS ? window.ZHS.state.courseId : null,
    lessonKey: window.ZHS ? window.ZHS.state.lessonKey : null,
  }));

  ok('脚本注入无错', !injected.err, injected.err);
  ok('ZHS 命名空间存在', injected.hasZHS);
  ok('页面版本已识别（非 unknown）', injected.version && injected.version !== 'unknown', String(injected.version));
  ok('课程 ID 已取到', !!injected.courseId && injected.courseId !== 'unknown-course', String(injected.courseId));

  console.log('\n=== E2 目录采集 ===');
  const catalog = await page.evaluate(() => {
    const C = window.ZHS.Catalog;
    const items = C.items();
    return {
      count: items.length,
      stats: C.stats(),
      first: items.length ? C.itemTitle(items[0]) : null,
      current: C.current() ? C.itemTitle(C.current()) : null,
      titles: items.slice(0, 8).map((el) => C.itemTitle(el)),
    };
  });
  console.log('    采集结果: ' + JSON.stringify(catalog));
  ok('采集到目录条目', catalog.count > 0, String(catalog.count));
  ok('条目有标题', !!catalog.first, String(catalog.first));
  ok('能定位当前课时', !!catalog.current, String(catalog.current));

  console.log('\n=== E3 播放控制 ===');
  const before = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { rate: v.playbackRate, vol: v.volume, paused: v.paused, t: v.currentTime, dur: v.duration } : null;
  });
  console.log('    控制前: ' + JSON.stringify(before));
  await sleep(8000);
  const after = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { rate: v.playbackRate, vol: v.volume, paused: v.paused, t: v.currentTime, dur: v.duration } : null;
  });
  console.log('    控制后: ' + JSON.stringify(after));

  if (after) {
    ok('倍速已设置（1.5 或平台允许值）', Math.abs(after.rate - 1.5) < 0.3 || after.rate > 1, String(after.rate));
    ok('已静音', after.vol === 0 || Math.abs(after.vol) < 0.01, String(after.vol));
  } else {
    ok('video 元素存在', false, '未找到 video');
  }

  await shot(page, 'e2e-02-脚本生效.png');

  console.log('\n=== E4 悬浮面板 ===');
  const panel = await page.evaluate(() => {
    const h = document.getElementById('zhs-helper-panel');
    if (!h || !h.shadowRoot) return null;
    const q = (s) => { const e = h.shadowRoot.querySelector(s); return e ? e.textContent.trim() : null; };
    return { run: q('.s-run'), ver: q('.s-ver'), lesson: q('.s-lesson'), cprog: q('.s-cprog'), ans: q('.s-ans') };
  });
  console.log('    面板字段: ' + JSON.stringify(panel));
  ok('面板已挂载', !!panel);
  ok('面板显示运行状态', !!(panel && panel.run), panel && panel.run);
  ok('面板显示正确版本', !!(panel && panel.ver && panel.ver !== '未识别'), panel && panel.ver);
  ok('面板显示课程完成度', !!(panel && panel.cprog), panel && panel.cprog);

  await shot(page, 'e2e-03-控制面板.png');

  console.log('\n=== E5 续播记录 ===');
  await sleep(6000);
  const resume = await page.evaluate(() => {
    const raw = window.__LIVE_STORE__ && window.__LIVE_STORE__['zhs-helper-resume'];
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return { parseError: e.message }; }
  });
  console.log('    存储内容: ' + JSON.stringify(resume));
  ok('续播记录已写入', !!resume && !resume.parseError, JSON.stringify(resume));
  if (resume && resume.courses) {
    const keys = Object.keys(resume.courses);
    ok('记录了课程条目', keys.length > 0, JSON.stringify(keys));
    if (keys.length) {
      const rec = resume.courses[keys[0]];
      ok('记录含课时名', !!rec.lessonKey, String(rec.lessonKey));
      ok('记录含播放位置', typeof rec.time === 'number' && rec.time > 0, String(rec.time));
    }
  }

  console.log('\n=== E6 弹题检测（若有） ===');
  const dlg = await page.evaluate(() => {
    if (!window.ZHS || !window.ZHS.Questions) return { noModule: true };
    return {
      scene: window.ZHS.Questions.scene(),
      dialogPresent: window.ZHS.Questions.Dialog.present(),
    };
  });
  console.log('    场景: ' + JSON.stringify(dlg));
  ok('题目场景可判定', !dlg.noModule, JSON.stringify(dlg));

  console.log('\n=== E7 日志回看 ===');
  const logs = await page.evaluate(() => window.ZHS ? window.ZHS.Log.all().map((e) => e.level + '|' + e.text) : []);
  console.log('    最近 12 条日志:');
  logs.slice(-12).forEach((l) => console.log('      ' + l));
  ok('脚本产生了日志', logs.length > 0, String(logs.length));

  const warnAndErr = logs.filter((l) => l.startsWith('warn|') || l.startsWith('error|'));
  console.log('    告警/错误 ' + warnAndErr.length + ' 条');

  console.log('\n=== E8 运行一段时间观察（60 秒） ===');
  const t0 = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { t: v.currentTime, paused: v.paused } : null;
  });
  await sleep(60000);
  const t1 = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { t: v.currentTime, paused: v.paused } : null;
  });
  console.log('    60 秒前: ' + JSON.stringify(t0));
  console.log('    60 秒后: ' + JSON.stringify(t1));
  if (t0 && t1) {
    const advanced = t1.t - t0.t;
    ok('视频持续播放（进度推进 > 10s）', advanced > 10, '推进 ' + advanced.toFixed(1) + 's');
    ok('未被意外暂停', t1.paused === false, String(t1.paused));
  }

  await shot(page, 'e2e-04-运行60秒后.png');

  const finalLogs = await page.evaluate(() => window.ZHS.Log.all().slice(-20).map((e) => e.text));
  console.log('\n    最终日志:');
  finalLogs.forEach((l) => console.log('      ' + l));

  await browser.close();

  console.log('\n' + '='.repeat(52));
  console.log(`真实站点端到端：通过 ${pass} / 失败 ${fail}`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  const shots = fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png'));
  console.log(`\n截图 ${shots.length} 张 → test/live-screenshots/`);
  process.exit(fail ? 1 : 0);
}

// ============================================================
(async () => {
  try {
    if (MODE === 'login') await doLogin();
    else if (MODE === 'recon') await doRecon();
    else if (MODE === 'e2e') await doE2E();
    else {
      console.log('用法: node test/live-run.js [login|recon|e2e]');
      process.exit(1);
    }
  } catch (e) {
    console.error('运行出错：' + e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
