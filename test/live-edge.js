/**
 * 真实站点端到端测试 —— 连接本机 Edge（复用你已有的登录态）
 *
 * 思路：
 *   Edge 的 User Data 目录里已经存着你的智慧树登录 cookie。
 *   直接用该目录启动一个带 --remote-debugging-port 的 Edge 实例，
 *   再让 puppeteer 通过 connect() 接管它 —— 无需重新登录。
 *
 * 用法：
 *   node test/live-edge.js check     先检查能否连上 / 是否已登录
 *   node test/live-edge.js recon     侦察真实 DOM 结构
 *   node test/live-edge.js e2e       端到端全流程测试
 *   node test/live-edge.js answer    真实答题链路专项测试（造模拟弹题，走全链路）
 *
 * 注意：默认用独立 profile（.edge-debug-profile），首次需手动登录一次，
 *       之后登录态会留在该 profile 里，无需重复登录，也不会动你的日常 Edge。
 *       若要复用日常 Edge 登录态：设 ZHS_USE_DAILY_PROFILE=1（需先完全退出日常 Edge）。
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'reference', 'live');
const SHOTS = path.join(ROOT, 'test', 'live-screenshots');
const SCRIPT = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// profile 选择：
//   默认用独立的调试 profile（干净，但需要登录一次）
//   设 ZHS_USE_DAILY_PROFILE=1 则直接指向你日常的 Edge 用户配置（登录态复用）
const DAILY_PROFILE = 'C:\\Users\\Administrator\\AppData\\Local\\Microsoft\\Edge\\User Data';
const DEBUG_PROFILE = path.join(ROOT, '.edge-debug-profile');
const USE_DAILY = process.env.ZHS_USE_DAILY_PROFILE === '1';
const PROFILE_DIR = USE_DAILY ? DAILY_PROFILE : DEBUG_PROFILE;
const PORT = Number(process.env.ZHS_DEBUG_PORT) || 9222;

const TARGET = process.env.ZHS_URL
  || 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=4e5f5b5c4c5b4859454a585958435f475a';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const MODE = process.argv[2] || 'check';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 检查调试端口是否已就绪 */
async function portReady() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/** 启动调试用 Edge 实例 */
async function launchDebugEdge() {
  const ready = await portReady();
  if (ready) {
    console.log('>>> 调试端口已就绪：' + ready.Browser);
    return;
  }

  console.log('>>> 启动调试用 Edge 实例（端口 ' + PORT + '）...');
  console.log('    可执行文件：' + EDGE);
  console.log('    Profile   ：' + PROFILE_DIR + (USE_DAILY ? '   [日常配置，登录态复用]' : '   [独立配置]'));

  const child = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--autoplay-policy=no-user-gesture-required',
    '--start-maximized',
    'about:blank',
  ], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // 等端口起来
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const v = await portReady();
    if (v) {
      console.log('>>> 已就绪：' + v.Browser + '  (' + (i + 1) + 's)');
      return;
    }
  }
  throw new Error('调试端口 30 秒未就绪。请确认 Edge 已完全退出后重试。');
}

/** 连接调试端口 */
async function connect() {
  const browserURL = `http://127.0.0.1:${PORT}`;
  const browser = await puppeteer.connect({
    browserURL,
    defaultViewport: null,
  });
  return browser;
}

/** 找或新建目标页 */
async function getPage(browser) {
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes('zhihuishu'));
  if (!page) page = pages[0] || await browser.newPage();
  return page;
}

async function shot(page, name) {
  const f = path.join(SHOTS, name);
  await page.screenshot({ path: f, fullPage: false });
  console.log('    → 截图: ' + name);
  return f;
}

// ============================================================
// 模式：discover —— 自动发现账号下的在学课程
// ============================================================
async function doDiscover() {
  await launchDebugEdge();
  const browser = await connect();
  const page = await getPage(browser);

  console.log('\n>>> 打开智慧树学生首页');
  await page.goto('https://onlineweb.zhihuishu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(9000);

  await shot(page, 'edge-discover-01-首页.png');

  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));

    // 收集所有看起来像「课程链接」的 a 标签
    const links = qa('a[href]')
      .map((a) => ({ href: a.href, text: (a.innerText || '').replace(/\s+/g, ' ').trim() }))
      .filter((l) => /course|study|learn|stuStudy|recruit/i.test(l.href) || /课|学习/.test(l.text))
      .slice(0, 40);

    return {
      url: location.href,
      title: document.title,
      needLogin: location.hostname.includes('login'),
      bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
      courseLinks: links,
      // 常见的课程卡片容器
      cards: qa('[class*="course-card"], [class*="courseCard"], [class*="course-item"], .my-course, [class*="courseList"]').length,
    };
  });

  console.log('\n=== 学生首页侦察 ===');
  console.log('URL  : ' + info.url);
  console.log('标题 : ' + info.title);
  console.log('需登录: ' + info.needLogin);
  console.log('课程卡片容器数: ' + info.cards);
  console.log('\n正文前 600 字：\n' + info.bodyHead);

  console.log('\n候选课程链接 ' + info.courseLinks.length + ' 条：');
  info.courseLinks.forEach((l, i) => {
    console.log('  [' + i + '] ' + l.text.slice(0, 30).padEnd(32) + ' ' + l.href.slice(0, 110));
  });

  browser.disconnect();
}

// ============================================================
// 模式：check
// ============================================================
async function doCheck() {
  await launchDebugEdge();
  const browser = await connect();
  const page = await getPage(browser);

  console.log('\n>>> 打开课程页，检测登录态');
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(9000);

  const st = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));
    return {
      url: location.href,
      host: location.hostname,
      title: document.title,
      needLogin: location.hostname.includes('login'),
      hasChapterTree: !!q('.chapter-tree-74, .chapter-content, .el-tree, [class*="card-container"]'),
      childInfo: qa('.child-info').length,
      video: qa('video').length,
      courseName: (q('.course-name') || {}).innerText || null,
      bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 250),
    };
  });

  console.log('\n=== 登录态检测 ===');
  console.log(JSON.stringify(st, null, 2));

  await shot(page, 'edge-01-状态.png');

  if (st.needLogin) {
    console.log('\n!!! 该 profile 未登录智慧树。');
    console.log('    请在刚打开的 Edge 窗口里手动登录一次（登录态会留在这个 profile 里）。');
    console.log('    登录完成后重新跑：node test/live-edge.js check');
  } else if (st.hasChapterTree && st.video > 0) {
    console.log('\n>>> 已登录且页面结构正常，可以做 recon / e2e 了');
  } else if (st.hasChapterTree) {
    console.log('\n>>> 已登录，但没找到 video（可能是文档节点或还没加载）');
  } else {
    console.log('\n>>> 已登录，但页面结构不是预期的播放页，看 recon 详情');
  }

  // 不关闭浏览器，留给人工处理
  console.log('\n>>> Edge 窗口保持打开（调试端口 ' + PORT + '）。');
  browser.disconnect();   // 断开 puppeteer，不关浏览器
}

// ============================================================
// 模式：recon
// ============================================================
async function doRecon() {
  await launchDebugEdge();
  const browser = await connect();
  const page = await getPage(browser);

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(11000);

  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));
    const items = qa('.child-info.hasvideo');
    return {
      url: location.href,
      host: location.hostname,
      title: document.title,
      needLogin: location.hostname.includes('login'),

      // 页面族判别（5 套）
      families: {
        wisdom: !!q('.chapter-tree-74'),
        fusion: !!q('.chapter-content'),
        hike: !!q('.el-tree'),
        legacy: !!q('.clearfix.video'),
        card2025: !!q('[class*="card-container"]'),
      },
      // 各套条目数量
      counts: {
        childInfo: qa('.child-info').length,
        childInfoHasVideo: items.length,
        chapterContentSecond: qa('.chapter-content-second').length,
        fileItem: qa('.file-item').length,
        cardContainer: qa('[class*="card-container"]').length,
      },
      // 视频
      videoCount: qa('video').length,
      videoInfo: (() => {
        const v = q('video');
        if (!v) return null;
        return {
          duration: v.duration,
          currentTime: v.currentTime,
          readyState: v.readyState,
          paused: v.paused,
          playbackRate: v.playbackRate,
          volume: v.volume,
          src: (v.src || v.currentSrc || '').slice(0, 100),
        };
      })(),

      courseName: (q('.course-name') || {}).innerText || null,

      // 前 5 个条目的实际结构
      sampleItems: items.slice(0, 5).map((el) => {
        const pb = el.querySelector('[role="progressbar"]');
        return {
          cls: el.className,
          title: (el.querySelector('.child-name') || {}).title || null,
          text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 50),
          hasCheck: !!el.querySelector('.child-check'),
          checkText: (el.querySelector('.child-check') || {}).innerText || null,
          ariaNow: pb ? pb.getAttribute('aria-valuenow') : null,
          progText: (el.querySelector('.progress-num, .rate, .prog') || {}).innerText || null,
        };
      }),

      // 弹题/iframe
      dialog: !!q('#playTopic-dialog'),
      tmIframe: !!q('#tmDialog_iframe'),
      iframeList: qa('iframe').map((f) => ({ id: f.id, src: (f.src || '').slice(0, 70) })),

      webdriver: navigator.webdriver,
    };
  });

  console.log('\n=== 真实页面结构（Edge） ===');
  console.log(JSON.stringify(info, null, 2));

  await shot(page, 'edge-recon-01-页面全貌.png');

  const html = await page.content();
  fs.writeFileSync(path.join(OUT, 'edge-rendered-recon.html'), html, 'utf8');
  console.log('\n渲染后 HTML: reference/live/edge-rendered-recon.html');

  browser.disconnect();
}

// ============================================================
// 模式：e2e
// ============================================================
async function doE2E() {
  let pass = 0, fail = 0;
  const failures = [];
  const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
  };

  await launchDebugEdge();
  const browser = await connect();
  const page = await getPage(browser);

  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('智慧树助手')) console.log('    [页面] ' + t.slice(0, 150));
  });
  page.on('pageerror', (e) => console.log('    [页面错误] ' + e.message.slice(0, 150)));

  console.log('\n>>> 打开真实课程页');
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(11000);

  const pre = await page.evaluate(() => ({
    host: location.hostname,
    needLogin: location.hostname.includes('login'),
    hasVideo: !!document.querySelector('video'),
    hasTree: !!document.querySelector('.chapter-tree-74, .chapter-content, .el-tree'),
  }));

  if (pre.needLogin) {
    console.log('\n!!! 未登录，无法端到端测试。先跑：node test/live-edge.js check 并手动登录');
    await shot(page, 'edge-e2e-00-未登录.png');
    browser.disconnect();
    process.exit(2);
  }

  console.log('\n=== E1 脚本注入 ===');
  await shot(page, 'edge-e2e-01-注入前.png');

  const raw = fs.readFileSync(SCRIPT, 'utf8');
  const body = raw.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==UserScript==/, '');

  await page.evaluate(`(function(){
    window.__LIVE_LOGS__ = [];
    var _s = Object.create(null);
    Object.defineProperty(window, '__LIVE_STORE__', { get: function(){ return _s; }, configurable: true });
    window.GM_setValue = function(k,v){ _s[k]=v; };
    window.GM_getValue = function(k,d){ return _s[k]!==undefined?_s[k]:d; };
    window.GM_deleteValue = function(k){ delete _s[k]; };
    // 真实网络：不拦截，让题库/LLM 走真请求（浏览器上下文里 fetch 也行，
    // 用 XHR 是为了避开部分站点的 CSP 对 fetch 的限制差异）
    window.GM_xmlhttpRequest = function(o){
      window.__LIVE_LOGS__.push('[net] '+(o.method||'GET')+' '+o.url);
      try {
        var xhr = new XMLHttpRequest();
        xhr.open(o.method||'GET', o.url, true);
        Object.keys(o.headers||{}).forEach(function(h){ xhr.setRequestHeader(h, o.headers[h]); });
        xhr.timeout = o.timeout || 15000;
        xhr.onload = function(){ o.onload && o.onload({ status: xhr.status, responseText: xhr.responseText }); };
        xhr.onerror = function(){ o.onerror && o.onerror({}); };
        xhr.ontimeout = function(){ o.ontimeout && o.ontimeout({}); };
        xhr.send(o.data || null);
      } catch(e){ o.onerror && o.onerror({ error: e.message }); }
    };
    try { ${body} } catch(e){ window.__LIVE_ERROR__ = e.message + ' | ' + (e.stack||'').split('\\n')[1]; }
  })();`);

  await sleep(7000);

  const injected = await page.evaluate(() => ({
    err: window.__LIVE_ERROR__ || null,
    hasZHS: !!window.ZHS,
    version: window.ZHS ? window.ZHS.state.siteVersion : null,
    courseId: window.ZHS ? window.ZHS.state.courseId : null,
    lessonKey: window.ZHS ? window.ZHS.state.lessonKey : null,
  }));

  ok('脚本注入无错', !injected.err, injected.err);
  ok('ZHS 命名空间存在', injected.hasZHS);
  ok('页面版本已识别（非 unknown）', !!injected.version && injected.version !== 'unknown', String(injected.version));
  ok('课程 ID 已取到', !!injected.courseId && injected.courseId !== 'unknown-course', String(injected.courseId));

  console.log('\n=== E2 目录采集 ===');
  const catalog = await page.evaluate(() => {
    const C = window.ZHS.Catalog;
    const items = C.items();
    return {
      adapter: C.adapter.name,
      count: items.length,
      stats: C.stats(),
      first: items.length ? C.itemTitle(items[0]) : null,
      current: C.current() ? C.itemTitle(C.current()) : null,
      titles: items.slice(0, 10).map((el) => C.itemTitle(el)),
      finishedFlags: items.slice(0, 10).map((el) => C.isFinished(el)),
    };
  });
  console.log('    ' + JSON.stringify(catalog, null, 2));
  ok('采集到目录条目', catalog.count > 0, String(catalog.count));
  ok('条目有标题', !!catalog.first, String(catalog.first));
  ok('能定位当前课时', !!catalog.current, String(catalog.current));

  console.log('\n=== E3 播放控制 ===');
  const before = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { rate: v.playbackRate, vol: v.volume, paused: v.paused, t: v.currentTime, dur: v.duration } : null;
  });
  console.log('    控制前: ' + JSON.stringify(before));
  await sleep(9000);
  const after = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { rate: v.playbackRate, vol: v.volume, paused: v.paused, t: v.currentTime, dur: v.duration } : null;
  });
  console.log('    控制后: ' + JSON.stringify(after));

  if (after && before) {
    ok('倍速已提升（>1.0）', after.rate > 1.0, String(after.rate));
    ok('已静音', after.vol === 0 || after.vol < 0.01, String(after.vol));
    ok('进度在推进', after.t > before.t, String(before.t) + ' → ' + String(after.t));
  } else {
    ok('video 元素存在', false, '未找到 video');
  }

  await shot(page, 'edge-e2e-02-脚本生效.png');

  console.log('\n=== E4 悬浮面板 ===');
  const panel = await page.evaluate(() => {
    const h = document.getElementById('zhs-helper-panel');
    if (!h || !h.shadowRoot) return null;
    const q = (s) => { const e = h.shadowRoot.querySelector(s); return e ? e.textContent.trim() : null; };
    return { run: q('.s-run'), ver: q('.s-ver'), lesson: q('.s-lesson'), cprog: q('.s-cprog'), ans: q('.s-ans') };
  });
  console.log('    ' + JSON.stringify(panel));
  ok('面板已挂载', !!panel);
  ok('面板显示运行状态', !!(panel && panel.run), panel && panel.run);
  ok('面板显示正确版本', !!(panel && panel.ver && panel.ver !== '未识别'), panel && panel.ver);
  ok('面板显示课程完成度', !!(panel && panel.cprog), panel && panel.cprog);

  await shot(page, 'edge-e2e-03-控制面板.png');

  console.log('\n=== E5 续播记录 ===');
  await sleep(7000);
  const resume = await page.evaluate(() => {
    const raw = window.__LIVE_STORE__ && window.__LIVE_STORE__['zhs-helper-resume'];
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return { parseError: e.message }; }
  });
  console.log('    ' + JSON.stringify(resume));
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

  console.log('\n=== E6 题目场景 ===');
  const dlg = await page.evaluate(() => {
    if (!window.ZHS || !window.ZHS.Questions) return { noModule: true };
    return {
      scene: window.ZHS.Questions.scene(),
      dialogPresent: window.ZHS.Questions.Dialog.present(),
      homeworkPresent: window.ZHS.Questions.Homework.present(),
    };
  });
  console.log('    ' + JSON.stringify(dlg));
  ok('题目场景模块可用', !dlg.noModule);

  console.log('\n=== E7 日志回看 ===');
  const logs = await page.evaluate(() => window.ZHS ? window.ZHS.Log.all().map((e) => e.level + '|' + e.text) : []);
  logs.slice(-15).forEach((l) => console.log('      ' + l));
  ok('脚本产生了日志', logs.length > 0, String(logs.length));

  console.log('\n=== E8 持续运行观察（90 秒） ===');
  const t0 = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { t: v.currentTime, paused: v.paused, rate: v.playbackRate } : null;
  });
  await sleep(90000);
  const t1 = await page.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { t: v.currentTime, paused: v.paused, rate: v.playbackRate } : null;
  });
  console.log('    90 秒前: ' + JSON.stringify(t0));
  console.log('    90 秒后: ' + JSON.stringify(t1));
  if (t0 && t1) {
    const adv = t1.t - t0.t;
    ok('视频持续播放（推进 > 30s）', adv > 30, '推进 ' + adv.toFixed(1) + 's');
    ok('未被意外暂停', t1.paused === false, String(t1.paused));
  }

  await shot(page, 'edge-e2e-04-运行90秒后.png');

  const netLogs = await page.evaluate(() => window.__LIVE_LOGS__ || []);
  console.log('\n    网络请求 ' + netLogs.length + ' 条（最近 5 条）:');
  netLogs.slice(-5).forEach((l) => console.log('      ' + l));

  console.log('\n' + '='.repeat(52));
  console.log(`真实站点端到端（Edge）：通过 ${pass} / 失败 ${fail}`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  const shots = fs.readdirSync(SHOTS).filter((f) => f.startsWith('edge-'));
  console.log(`\n截图 ${shots.length} 张 → test/live-screenshots/`);

  browser.disconnect();
  process.exit(fail ? 1 : 0);
}

// ============================================================
// 模式：answer —— 真实答题链路专项测试
// ============================================================
/**
 * 思路：真实考试弹题不可控（等半天不一定出现），但答题链路本身必须验证。
 * 做法：在真实智慧树页面上，按平台真实结构「造」一道模拟弹题，
 *       然后驱动脚本走完整链路：采集 → 求解（题库/LLM）→ 回填 → 关闭。
 * 这样验证的是真实 DOM 下的真实链路，而不是 jsdom 打桩。
 */
async function doAnswer() {
  let pass = 0, fail = 0;
  const failures = [];
  const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
  };

  await launchDebugEdge();
  const browser = await connect();
  const page = await getPage(browser);

  page.on('pageerror', (e) => console.log('    [页面错误] ' + e.message.slice(0, 150)));

  console.log('\n>>> 打开真实课程页');
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(11000);

  const pre = await page.evaluate(() => ({
    host: location.hostname,
    needLogin: location.hostname.includes('login'),
  }));
  if (pre.needLogin) {
    console.log('\n!!! 未登录，无法做答题测试。先跑：node test/live-edge.js check 并手动登录');
    await shot(page, 'edge-answer-00-未登录.png');
    browser.disconnect();
    process.exit(2);
  }

  console.log('\n=== A0 注入脚本（含真实网络通道） ===');
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
      window.__LIVE_LOGS__.push('[net] '+(o.method||'GET')+' '+o.url);
      try {
        var xhr = new XMLHttpRequest();
        xhr.open(o.method||'GET', o.url, true);
        Object.keys(o.headers||{}).forEach(function(h){ xhr.setRequestHeader(h, o.headers[h]); });
        xhr.timeout = o.timeout || 15000;
        xhr.onload = function(){ o.onload && o.onload({ status: xhr.status, responseText: xhr.responseText }); };
        xhr.onerror = function(){ o.onerror && o.onerror({}); };
        xhr.ontimeout = function(){ o.ontimeout && o.ontimeout({}); };
        xhr.send(o.data || null);
      } catch(e){ o.onerror && o.onerror({ error: e.message }); }
    };
    try { ${body} } catch(e){ window.__LIVE_ERROR__ = e.message + ' | ' + (e.stack||'').split('\\n')[1]; }
  })();`);

  await sleep(6000);
  const inj = await page.evaluate(() => ({ err: window.__LIVE_ERROR__ || null, hasZHS: !!window.ZHS }));
  ok('脚本注入无错', !inj.err, inj.err);
  ok('ZHS 命名空间就绪', inj.hasZHS);
  if (!inj.hasZHS) { browser.disconnect(); process.exit(1); }

  // 打开自动答题（测试需要）
  await page.evaluate(() => { window.ZHS.setConfig({ autoAnswer: true, answerDialog: true, answerDelay: 0 }); });
  await sleep(800);

  console.log('\n=== A1 归一化层（纯函数，不依赖网络） ===');
  const norm = await page.evaluate(() => {
    const B = window.ZHS.Bank;
    return {
      lower: B.normalize('b'),
      dotted: B.normalize('B.'),
      mixed: B.normalize('答案：B'),
      multi1: B.normalize('AC'),
      multi2: B.normalize('A、C'),
      multi3: B.normalize('A,C'),
      t1: B.normalize('正确'),
      t2: B.normalize('True'),
      t3: B.normalize('√'),
      f1: B.normalize('错误'),
      idx: B.toIndexes('A,C'),
      best: B.pickBest(['B', 'AC', 'A']),
    };
  });
  console.log('    ' + JSON.stringify(norm));
  ok("归一化 'b' → 'B'", norm.lower === 'B', norm.lower);
  ok("归一化 'B.' → 'B'", norm.dotted === 'B', norm.dotted);
  ok("归一化 '答案：B' → 'B'", norm.mixed === 'B', norm.mixed);
  ok("归一化 'AC' → 'A,C'", norm.multi1 === 'A,C', norm.multi1);
  ok("归一化 'A、C' → 'A,C'", norm.multi2 === 'A,C', norm.multi2);
  ok("归一化 '正确' → '对'", norm.t1 === '对', norm.t1);
  ok("归一化 'True' → '对'", norm.t2 === '对', norm.t2);
  ok("归一化 '√' → '对'", norm.t3 === '对', norm.t3);
  ok("归一化 '错误' → '错'", norm.f1 === '错', norm.f1);
  ok("'A,C' → [0,2]", JSON.stringify(norm.idx) === '[0,2]', JSON.stringify(norm.idx));
  ok("pickBest 优先最长", norm.best === 'A,C' || norm.best === 'AC', norm.best);

  console.log('\n=== A2 造模拟弹题（贴合平台真实结构） ===');
  await page.evaluate(() => {
    const old = document.getElementById('playTopic-dialog');
    if (old) old.remove();
    const dlg = document.createElement('div');
    dlg.id = 'playTopic-dialog';
    dlg.style.cssText = 'position:fixed;left:50px;top:120px;width:420px;background:#fff;z-index:99999;padding:14px;border:1px solid #ccc;border-radius:6px;';
    dlg.innerHTML =
      '<div class="topic-title">中国文化源远流长，下列哪个是中国四大发明之一？</div>' +
      '<div class="topic">' +
        '<ul>' +
          '<li class="topic-item"><label><input type="radio" name="t1">A. 地动仪</label></li>' +
          '<li class="topic-item"><label><input type="radio" name="t1">B. 指南针</label></li>' +
          '<li class="topic-item"><label><input type="radio" name="t1">C. 珠算</label></li>' +
          '<li class="topic-item"><label><input type="radio" name="t1">D. 日晷</label></li>' +
        '</ul>' +
      '</div>' +
      '<button class="close-btn">关闭</button>';
    document.body.appendChild(dlg);
  });
  await sleep(500);

  const made = await page.evaluate(() => {
    const Q = window.ZHS.Questions;
    const r = Q.Dialog.root();
    return {
      present: Q.Dialog.present(),
      scene: Q.scene(),
      rootFound: !!r,
      collected: r ? Q.Dialog.collect().length : 0,
      read: (() => { const q = Q.Dialog.readCurrent(r); return q ? { title: q.title.slice(0, 30), opts: q.options.length, type: q.type } : null; })(),
    };
  });
  console.log('    ' + JSON.stringify(made));
  ok('弹题被识别为 present', made.present);
  ok('场景判定为 dialog', made.scene === 'dialog', String(made.scene));
  ok('弹题 root 可定位', made.rootFound);
  ok('采集到题目', made.collected > 0, String(made.collected));
  ok('读到题干', !!(made.read && made.read.title), made.read && made.read.title);
  ok('读到 4 个选项', !!(made.read && made.read.opts === 4), made.read && String(made.read.opts));
  ok('题型推断为单选', !!(made.read && made.read.type === 'single'), made.read && made.read.type);

  await shot(page, 'edge-answer-01-模拟弹题.png');

  console.log('\n=== A3 求解链路（题库 → LLM → 随机兜底） ===');
  const solved = await page.evaluate(async () => {
    const S = window.ZHS.Solver;
    const r = await S.solve({
      title: '中国文化源远流长，下列哪个是中国四大发明之一？',
      options: ['地动仪', '指南针', '珠算', '日晷'],
      type: 'single',
    });
    return { result: r, stats: Object.assign({}, S.stats) };
  });
  console.log('    ' + JSON.stringify(solved));
  ok('求解返回结果', !!solved.result, JSON.stringify(solved.result));
  ok('答案非空', !!(solved.result && solved.result.answer), solved.result && solved.result.answer);
  ok('标注了来源通道', !!(solved.result && solved.result.from), solved.result && solved.result.from);
  ok('答案能转成合法索引', (() => {
    const a = solved.result && solved.result.answer;
    if (!a) return false;
    if (/^[A-D](,[A-D])*$/.test(a)) return true;         // 选择题：必须是 A / A,C 形式
    return a.length > 0 && a.length < 200;               // 填空/简答：非空且不过长
  })(), solved.result && solved.result.answer);

  console.log('\n=== A4 缓存复命（同题第二次应命中缓存） ===');
  const cached = await page.evaluate(async () => {
    const S = window.ZHS.Solver;
    const before = S.stats.cache;
    const r = await S.solve({
      title: '中国文化源远流长，下列哪个是中国四大发明之一？',
      options: ['地动仪', '指南针', '珠算', '日晷'],
      type: 'single',
    });
    return { hit: S.stats.cache > before, answer: r && r.answer, from: r && r.from };
  });
  console.log('    ' + JSON.stringify(cached));
  ok('二次求解命中缓存', cached.hit);

  console.log('\n=== A5 回填链路（点击选项 → 校验选中态） ===');
  const filled = await page.evaluate(async () => {
    const Q = window.ZHS.Questions;
    const F = window.ZHS.Filler;
    const root = Q.Dialog.root();
    const q = Q.Dialog.readCurrent(root);
    const before = q.elementList.map((el) => F.isChecked(el));
    const r = await F.fill(q, { answer: 'B' });
    const after = q.elementList.map((el) => F.isChecked(el));
    return { result: r, before, after };
  });
  console.log('    ' + JSON.stringify(filled));
  ok('回填返回 ok', !!(filled.result && filled.result.ok), JSON.stringify(filled.result));
  ok('选项 B（索引1）已被选中', filled.after[1] === true, JSON.stringify(filled.after));
  ok('其他选项未被误选', filled.after.filter((x, i) => i !== 1 && x).length === 0, JSON.stringify(filled.after));

  await shot(page, 'edge-answer-02-已回填.png');

  console.log('\n=== A6 端到端：Answerer 自动处理弹题 ===');
  const auto = await page.evaluate(async () => {
    // 清掉已选中状态，重新造一题，让 Answerer 从零走一遍
    const old = document.getElementById('playTopic-dialog');
    if (old) old.remove();
    const dlg = document.createElement('div');
    dlg.id = 'playTopic-dialog';
    dlg.style.cssText = 'position:fixed;left:50px;top:120px;width:420px;background:#fff;z-index:99999;padding:14px;border:1px solid #ccc;';
    dlg.innerHTML =
      '<div class="topic-title">水在标准大气压下的沸点是多少摄氏度？</div>' +
      '<div class="topic"><ul>' +
        '<li class="topic-item"><label><input type="radio" name="t2">A. 90</label></li>' +
        '<li class="topic-item"><label><input type="radio" name="t2">B. 100</label></li>' +
        '<li class="topic-item"><label><input type="radio" name="t2">C. 110</label></li>' +
        '<li class="topic-item"><label><input type="radio" name="t2">D. 120</label></li>' +
      '</ul></div>' +
      '<button class="close-btn">关闭</button>';
    document.body.appendChild(dlg);

    const A = window.ZHS.Answerer;
    A.reset();
    const before = window.ZHS.state.answeredCount;
    await A.handleDialog();
    await new Promise((r) => setTimeout(r, 1200));
    const root = window.ZHS.Questions.Dialog.root();
    const els = root ? Array.from(root.querySelectorAll('ul .topic-item')) : [];
    return {
      answeredDelta: window.ZHS.state.answeredCount - before,
      checked: els.map((el) => window.ZHS.Filler.isChecked(el)),
      dialogGone: !document.getElementById('playTopic-dialog'),
    };
  });
  console.log('    ' + JSON.stringify(auto));
  ok('Answerer 处理后有作答计数', auto.answeredDelta > 0, String(auto.answeredDelta));
  ok('某个选项被选中', auto.checked.some(Boolean), JSON.stringify(auto.checked));
  ok('处理后弹题被关闭', auto.dialogGone);

  await shot(page, 'edge-answer-03-自动处理后.png');

  console.log('\n=== A7 答题统计 ===');
  const stats = await page.evaluate(() => Object.assign({}, window.ZHS.Solver.stats));
  console.log('    ' + JSON.stringify(stats));
  ok('统计含通道计数', typeof stats.bank === 'number' && typeof stats.llm === 'number');
  ok('至少有通道成功求解', stats.bank + stats.llm + stats.cache > 0, JSON.stringify(stats));

  console.log('\n=== A8 网络请求留痕 ===');
  const netLogs = await page.evaluate(() => window.__LIVE_LOGS__ || []);
  console.log('    共 ' + netLogs.length + ' 条，最近 8 条：');
  netLogs.slice(-8).forEach((l) => console.log('      ' + l));

  console.log('\n' + '='.repeat(52));
  console.log(`真实答题链路测试：通过 ${pass} / 失败 ${fail}`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
  }

  browser.disconnect();
  process.exit(fail ? 1 : 0);
}

// ============================================================
(async () => {
  try {
    if (MODE === 'check') await doCheck();
    else if (MODE === 'discover') await doDiscover();
    else if (MODE === 'recon') await doRecon();
    else if (MODE === 'e2e') await doE2E();
    else if (MODE === 'answer') await doAnswer();
    else {
      console.log('用法: node test/live-edge.js [check|discover|recon|e2e|answer]');
      process.exit(1);
    }
  } catch (e) {
    console.error('\n运行出错：' + e.message);
    console.error(e.stack);
    process.exit(1);
  }
})();
