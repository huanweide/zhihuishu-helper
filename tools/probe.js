/**
 * 一次性诊断脚本：看 GM 存储与视频桩在真实 Chrome 里的实际状态
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');

(async () => {
  const b = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  p.on('console', (m) => {
    const t = m.text();
    if (t.includes('智慧树助手') || t.includes('probe')) console.log('[页] ' + t.slice(0, 140));
  });
  const url = 'file:///' + path.join(ROOT, 'test', 'fixture-player.html').replace(/\\/g, '/')
    + '?recruitAndCourseId=probe-777';
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 800));

  const raw = fs.readFileSync(path.join(ROOT, 'dist', 'zhihuishu-helper.user.js'), 'utf8');
  const body = raw.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '');

  await p.evaluate(`(function(){
    window.__SHOT_LOGS__ = [];
    var _store = Object.create(null);
    Object.defineProperty(window, '__SHOT_STORE__', { get: function(){ return _store; }, configurable: true });
    window.GM_setValue = function(k, v){ _store[k] = v; console.log('probe setValue ' + k); };
    window.GM_getValue = function(k, d){ return _store[k] !== undefined ? _store[k] : d; };
    window.GM_xmlhttpRequest = function(o){ setTimeout(function(){ o.onload && o.onload({ status: 200, responseText: '{}' }); }, 30); };
    try { ${body} } catch(e){ window.__SHOT_ERROR__ = e.message + '|' + (e.stack||'').split('\\n')[1]; }
  })();`);

  await new Promise((r) => setTimeout(r, 9000));

  const d = await p.evaluate(() => ({
    err: window.__SHOT_ERROR__ || null,
    hasGMset: typeof GM_setValue,
    storeKeys: Object.keys(window.__SHOT_STORE__ || {}),
    video: (() => {
      const v = document.querySelector('video');
      if (!v) return null;
      return {
        t: v.currentTime, dur: v.duration, raw: v.__rawDuration ? v.__rawDuration() : null,
        isStub: !!v.__rawDuration, rate: v.playbackRate, vol: v.volume, paused: v.paused,
      };
    })(),
    resumeCfg: window.ZHS ? window.ZHS.config.resume : null,
    lesson: window.ZHS ? window.ZHS.state.lessonKey : null,
    cid: window.ZHS ? window.ZHS.state.courseId : null,
    logs: window.ZHS ? window.ZHS.Log.all().map((e) => e.text).slice(-10) : [],
  }));
  console.log(JSON.stringify(d, null, 2));
  await b.close();
})();
