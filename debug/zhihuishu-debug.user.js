// ==UserScript==
// @name         智慧树助手·实地诊断探针 (ReTri Debug Probe)
// @namespace    http://tampermonkey.net/
// @version      0.1.0
// @description  进智慧树课程页后：①截获所有后端API ②穷举目录候选生成试切按钮 ③逐档实测切课策略。用于定位「切不动课」根因，数据驱动修复。
// @author       ReTri
// @match        https://www.zhihuishu.com/*
// @match        https://*.zhihuishu.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const TAG = '[ZHS-DBG]';
  const $ = (s, r = document) => (r || document).querySelector(s);
  const $$ = (s, r = document) => Array.from((r || document).querySelectorAll(s));

  /* ============ 全局状态 ============ */
  const STATE = {
    requests: [],          // 截获的后端请求
    capturing: false,
    candidates: [],        // 目录候选元素
    results: [],           // 切课实测结果
    selected: null,        // 当前选中的目标候选
  };

  /* ============ 指纹：切课前后对比用 ============ */
  function fingerprint() {
    const v = $('video');
    const active =
      $('.current,.active,.on,.cur,.selected,.now,.playing,[class*="current"],[class*="active"]');
    return {
      url: location.href,
      title: document.title,
      videoSrc: v ? (v.currentSrc || v.src || '') : '',
      videoTime: v ? Math.round(v.currentTime || 0) : -1,
      activeText: active ? active.textContent.trim().slice(0, 40) : '',
      bodyHead: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 120),
    };
  }
  function fpDiff(a, b) {
    const d = {};
    if (a.url !== b.url) d.url = b.url;
    if (a.title !== b.title) d.title = b.title;
    if (a.videoSrc !== b.videoSrc) d.videoSrc = b.videoSrc.slice(-60);
    if (a.videoTime !== b.videoTime) d.videoTime = b.videoTime;
    if (a.activeText !== b.activeText) d.activeText = b.activeText;
    if (a.bodyHead !== b.bodyHead) d.bodyHeadChanged = true;
    return d;
  }

  /* ============ 1. 后端 API 截获 ============ */
  function installCapture() {
    if (STATE.capturing) return;
    STATE.capturing = true;

    // —— XHR ——
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__dbg = { method: m, url: u, reqBody: null };
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const self = this;
      try { self.__dbg.reqBody = typeof body === 'string' ? body.slice(0, 800) : null; } catch (e) {}
      this.addEventListener('loadend', function () {
        try {
          const resp = (self.responseType === '' || self.responseType === 'text')
            ? (self.responseText || '').slice(0, 2000) : '(binary:' + self.responseType + ')';
          record(self.__dbg.method, self.__dbg.url, self.__dbg.reqBody, self.status, resp);
        } catch (e) {}
      });
      return origSend.apply(this, arguments);
    };

    // —— fetch ——
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = (typeof input === 'string') ? input : (input && input.url) || '';
      const method = (init && init.method) || (input && input.method) || 'GET';
      let reqBody = null;
      if (init && init.body) {
        try { reqBody = (typeof init.body === 'string') ? init.body.slice(0, 800) : JSON.stringify(init.body).slice(0, 800); } catch (e) {}
      }
      return origFetch.apply(this, arguments).then(async (resp) => {
        try {
          const ct = resp.headers.get('content-type') || '';
          let body = '';
          if (/json|text|javascript/.test(ct)) {
            try { body = (await resp.clone().text()).slice(0, 2000); } catch (e) {}
          }
          record(method, url, reqBody, resp.status, body);
        } catch (e) {}
        return resp;
      }).catch((e) => { record(method, url, reqBody, 0, 'FETCH_ERR:' + e.message); throw e; });
    };
    log('✅ 后端API截获已开启（XHR+fetch）');
  }

  function isRelevant(url) {
    if (!/zhihuishu\.com/i.test(url)) return false;
    if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico|mp4|m3u8|json)(\?|$)/i.test(url)) return false;
    // 明显是接口的路径
    return /(api|do|get|list|query|load|play|chapter|lesson|course|video|progress|learn|study|node|catalog|section|recruit|index|info|detail|status)/i.test(url);
  }
  function record(method, url, reqBody, status, resp) {
    if (!isRelevant(url)) return;
    const entry = { t: new Date().toLocaleTimeString(), method, url, reqBody, status, resp };
    STATE.requests.unshift(entry);
    if (STATE.requests.length > 120) STATE.requests.length = 120;
    renderRequests();
  }

  /* ============ 2. 目录候选穷举 ============ */
  function scanCatalog() {
    let found = [];
    // 2.1 已知容器选择器
    const containers = $$('[class*="catalog"],[class*="lesson"],[class*="chapter"],[class*="course-menu"],[class*="play-list"],[id*="catalog"],.course-list,.lesson-list,.chapter-list,.study-list');
    containers.sort((a, b) => b.querySelectorAll('*').length - a.querySelectorAll('*').length);
    for (const c of containers) {
      const kids = Array.from(c.children).filter((k) => (k.textContent || '').trim().length > 0 && k.querySelectorAll('*').length < 30);
      if (kids.length >= 3) { found = kids; break; }
    }
    // 2.2 通用兜底：收集"可点击 + 短文本"的叶子元素，按父分组取最多的一组
    if (!found.length) {
      const leaves = $$('a,li,div,span,button,[role="button"]').filter((el) => {
        const t = (el.textContent || '').replace(/\s+/g, '').trim();
        if (t.length < 2 || t.length > 40) return false;
        const s = getComputedStyle(el);
        if (s.cursor === 'pointer' || el.onclick || el.tagName === 'A' || el.getAttribute('role') === 'button') return true;
        // 有 href 子节点的也算
        if (el.querySelector && el.querySelector('a[href]')) return true;
        return false;
      });
      const groups = {};
      for (const el of leaves) {
        const p = el.parentElement;
        if (!p) continue;
        const key = p;
        (groups[key] = groups[key] || []).push(el);
      }
      let best = null, bestN = 0;
      for (const k in groups) { if (groups[k].length > bestN) { bestN = groups[k].length; best = groups[k]; } }
      if (best && bestN >= 3) found = best;
    }
    // 2.3 去重（同一节点只留一个）
    const seen = new Set();
    found = found.filter((el) => { if (seen.has(el)) return false; seen.add(el); return true; });
    STATE.candidates = found;
    renderCandidates();
    log('🔍 扫描到 ' + found.length + ' 个目录候选');
    return found;
  }

  /* ============ 3. 切课策略实现 ============ */
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function lessonId(el) {
    for (const a of ['data-lesson-id', 'data-id', 'data-course-id', 'data-vid', 'data-lessonid', 'lessonid', 'data-cid']) {
      const v = el.getAttribute && el.getAttribute(a); if (v) return v;
    }
    const link = el.querySelector && el.querySelector('a[href]');
    if (link) { const m = String(link.getAttribute('href') || '').match(/id=([^&]+)/); if (m) return m[1]; }
    return null;
  }
  function lessonHref(el) {
    const a = el.querySelector && el.querySelector('a[href]');
    if (a) { const h = a.getAttribute('href'); if (h && h !== '#' && !/^javascript:/i.test(h)) return h; }
    const id = lessonId(el); return id ? ('#lesson-' + id) : null;
  }
  function reactFiber(el) {
    for (const k of Object.keys(el)) { if (/^__reactFiber\$/.test(k) || /^__reactInternalInstance\$/.test(k)) return el[k]; }
    return null;
  }

  // 每档策略：返回 true 表示"已派发/已触发"，false 表示"不适用"。是否真切走由指纹验收判断。
  const STRATS = {
    'SPA·Vue': (el) => {
      const vm = el.__vue__ || el.__vueParentComponent;
      if (!vm) return false;
      const ev = { currentTarget: el, target: el, preventDefault() {}, stopPropagation() {} };
      if (typeof vm.$emit === 'function') { try { vm.$emit('click', ev); return true; } catch (e) {} }
      const ctx = vm.ctx || vm.proxy || vm;
      for (const n of ['select', 'onClick', 'handleClick', 'goToLesson', 'playLesson', 'clickItem', 'onItemClick']) {
        const fn = ctx && ctx[n];
        if (typeof fn === 'function') { try { fn.call(ctx, ev); return true; } catch (e) {} }
      }
      return false;
    },
    'SPA·React': (el) => {
      const f = reactFiber(el);
      if (!f) return false;
      const props = f.memoizedProps || (f.stateNode && f.stateNode.props) || {};
      if (typeof props.onClick === 'function') {
        try { props.onClick({ currentTarget: el, target: el, preventDefault() {}, stopPropagation() {} }); return true; } catch (e) {}
      }
      return false;
    },
    'URL深链': (el) => {
      const href = lessonHref(el); if (!href) return false;
      try {
        if (href.charAt(0) === '#') { if (location.hash !== href) location.hash = href; }
        else if (/^https?:/i.test(href)) location.assign(href);
        else location.assign(new URL(href, location.href).href);
        return true;
      } catch (e) { return false; }
    },
    '原生下一节': () => {
      const kw = /下一节|下一集|下一课时|下一个|继续学习|继续播放|继续课程|继 *续/;
      const vis = (x) => { try { const s = getComputedStyle(x); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e) { return true; } };
      const els = $$('button,[role="button"],a,li,div,span,i').filter((x) => {
        const t = (x.textContent || '').replace(/\s+/g, '').trim();
        return t && t.length <= 10 && kw.test(t) && vis(x);
      }).sort((a, b) => (b.tagName === 'BUTTON' ? 1 : 0) - (a.tagName === 'BUTTON' ? 1 : 0));
      if (!els.length) return false;
      try { els[0].click(); return true; } catch (e) { return false; }
    },
    '拟人点击': (el) => {
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      try { el.click(); return true; } catch (e) { return false; }
    },
    '穷举子目标': (el) => {
      const targets = [el, ...Array.from(el.querySelectorAll('*')), el.parentElement].filter(Boolean);
      let done = false;
      for (const t of targets) {
        try {
          t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          t.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          if (t.click) try { t.click(); } catch (e) {}
          done = true;
        } catch (e) {}
      }
      return done;
    },
  };

  async function testSwitch(el, label) {
    const before = fingerprint();
    let firedBy = [], passed = null;
    for (const name of Object.keys(STRATS)) {
      try {
        const fired = STRATS[name](el);
        if (!fired) continue;
        firedBy.push(name);
        await sleep(1200);
        const after = fingerprint();
        if (Object.keys(fpDiff(before, after)).length > 0) { passed = name; break; }
      } catch (e) {}
    }
    const after = fingerprint();
    const diff = fpDiff(before, after);
    const ok = !!passed;
    const rec = { label, before: before.url.slice(-50), after: after.url.slice(-50), activeBefore: before.activeText, activeAfter: after.activeText, firedBy, passed, diff };
    STATE.results.unshift(rec);
    renderResults();
    log((ok ? '✅ 命中策略『' + passed + '』' : '❌ 全部策略未切走') + ' — ' + label +
      (passed ? '' : '（已尝试:' + (firedBy.join('/') || '无') + '）'));
    return ok;
  }

  /* ============ 自动穷举全部候选 ============ */
  async function autoExhaust() {
    if (!STATE.candidates.length) scanCatalog();
    log('🚀 自动穷举 ' + STATE.candidates.length + ' 个候选 × ' + Object.keys(STRATS).length + ' 档策略 …');
    for (let i = 0; i < STATE.candidates.length; i++) {
      const el = STATE.candidates[i];
      const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      await testSwitch(el, '#' + (i + 1) + ' ' + txt);
      await sleep(300);
    }
    log('🏁 穷举完成，看下方结果列表哪条命中');
  }

  /* 一键诊断：扫描 → 穷举 → 导出报告（自动复制到剪贴板） */
  async function oneClickDiag() {
    log('🚀 开始一键诊断 …');
    installCapture();
    const found = scanCatalog();
    if (!found.length) { log('⚠ 没扫到目录候选——可能页面还在加载，等 3 秒再试'); await sleep(3000); scanCatalog(); }
    await autoExhaust();
    await sleep(500);
    exportReport();
    log('✅ 一键诊断完成，完整报告已复制到剪贴板，粘给瑞宝宝即可');
  }

  /* ============ UI ============ */
  function buildPanel() {
    const root = document.createElement('div');
    root.id = 'zhs-dbg-panel';
    root.innerHTML = `
      <style>
        #zhs-dbg-panel{position:fixed;top:8px;left:8px;width:380px;max-height:92vh;overflow:auto;z-index:2147483647;
          background:#0d1117;color:#c9d1d9;font:12px/1.5 Consolas,Menlo,monospace;border:1px solid #30363d;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
        #zhs-dbg-panel h3{margin:0;padding:8px 10px;background:#161b22;color:#58a6ff;font-size:13px;position:sticky;top:0;cursor:move;border-bottom:1px solid #30363d}
        #zhs-dbg-panel .sec{padding:8px 10px;border-bottom:1px solid #21262d}
        #zhs-dbg-panel button{background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:4px;padding:4px 7px;margin:2px 2px 2px 0;cursor:pointer;font:12px Consolas,monospace}
        #zhs-dbg-panel button:hover{background:#30363d}
        #zhs-dbg-panel button.primary{background:#238636;border-color:#2ea043;color:#fff}
        #zhs-dbg-panel .log{background:#010409;padding:6px;border-radius:4px;max-height:130px;overflow:auto;white-space:pre-wrap;color:#7ee787}
        #zhs-dbg-panel .cand{display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px dashed #21262d}
        #zhs-dbg-panel .cand .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #zhs-dbg-panel .cand.sel{background:#1f2937}
        #zhs-dbg-panel .req{font-size:11px;padding:2px 0;border-bottom:1px dashed #21262d;word-break:break-all}
        #zhs-dbg-panel .req .m{color:#ff7b72}
        #zhs-dbg-panel .req .u{color:#79c0ff}
        #zhs-dbg-panel .res{font-size:11px;padding:3px 0;border-bottom:1px dashed #21262d}
        #zhs-dbg-panel .res.ok{color:#7ee787}
        #zhs-dbg-panel .res.no{color:#ffa657}
        #zhs-dbg-panel .mini{color:#8b949e;font-size:11px}
        #zhs-dbg-panel textarea{width:100%;height:90px;background:#010409;color:#c9d1d9;border:1px solid #30363d;font:11px Consolas,monospace}
      </style>
      <h3 id="zhs-dbg-h">🛠 智慧树诊断探针 v0.1.0</h3>
      <div class="sec">
        <div class="mini" id="zhs-dbg-fp"></div>
        <button id="dbg-onediag" class="primary">🚀 一键诊断（扫描+穷举+截后端+导报告）</button>
        <button id="dbg-capture">①开启后端截获</button>
        <button id="dbg-scan">②扫描目录候选</button>
        <button id="dbg-auto" class="primary">③自动穷举全部候选</button>
        <button id="dbg-refresh">刷新指纹</button>
      </div>
      <div class="sec">
        <div class="mini">后端API（接口/数据，点复制导出）</div>
        <div id="dbg-reqs"></div>
        <button id="dbg-copyreq">复制API报告</button>
      </div>
      <div class="sec">
        <div class="mini">目录候选（每个"试切"按钮 = 该条目 × 全部策略实测）</div>
        <div id="dbg-cands"></div>
      </div>
      <div class="sec">
        <div class="mini">单档策略实测（对当前选中候选）</div>
        <div id="dbg-strats"></div>
      </div>
      <div class="sec">
        <div class="mini">切课实测结果</div>
        <div id="dbg-results"></div>
        <button id="dbg-export" class="primary">导出完整报告</button>
        <textarea id="dbg-out" placeholder="点"导出完整报告"自动生成可复制文本"></textarea>
      </div>
      <div class="sec">
        <div class="mini">运行日志</div>
        <div class="log" id="dbg-log"></div>
      </div>`;
    document.body.appendChild(root);
    makeDraggable(root, root.querySelector('#zhs-dbg-h'));

    // 事件
    root.querySelector('#dbg-capture').onclick = () => { installCapture(); root.querySelector('#dbg-capture').textContent = '①后端截获: 已开'; };
    root.querySelector('#dbg-scan').onclick = scanCatalog;
    root.querySelector('#dbg-auto').onclick = autoExhaust;
    root.querySelector('#dbg-refresh').onclick = refreshFp;
    root.querySelector('#dbg-copyreq').onclick = copyReqReport;
    root.querySelector('#dbg-export').onclick = exportReport;
    root.querySelector('#dbg-onediag').onclick = oneClickDiag;

    // 单档策略按钮
    const sw = root.querySelector('#dbg-strats');
    for (const name of Object.keys(STRATS)) {
      const b = document.createElement('button');
      b.textContent = name;
      b.onclick = async () => {
        const el = STATE.selected;
        if (!el) { log('⚠ 先点一个目录候选选中它'); return; }
        const before = fingerprint();
        const fired = STRATS[name](el);
        if (!fired) { log('「' + name + '」不适用（无句柄）'); return; }
        await sleep(1300);
        const after = fingerprint();
        const diff = fpDiff(before, after);
        log((Object.keys(diff).length ? '✅ ' : '❌ ') + name + ' → ' + (Object.keys(diff).length ? JSON.stringify(diff) : '未切走'));
      };
      sw.appendChild(b);
    }
    refreshFp();
    log('探针已就绪。步骤：①开截获 → ②扫描 → ③自动穷举。或手动点候选+策略。');
  }

  function makeDraggable(panel, handle) {
    let sx, sy, ox, oy, drag = false;
    handle.addEventListener('mousedown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; const r = panel.getBoundingClientRect(); ox = r.left; oy = r.top; });
    document.addEventListener('mousemove', (e) => { if (!drag) return; panel.style.left = (ox + e.clientX - sx) + 'px'; panel.style.top = (oy + e.clientY - sy) + 'px'; });
    document.addEventListener('mouseup', () => { drag = false; });
  }

  function refreshFp() {
    const f = fingerprint();
    $('#zhs-dbg-fp').textContent = 'URL:' + f.url.slice(-46) + ' | 标题:' + f.title.slice(0, 20) + ' | 视频:' + (f.videoSrc ? '有' : '无') + ' | 激活:' + f.activeText;
  }
  function log(s) {
    const el = $('#dbg-log'); if (!el) return;
    el.textContent = '• ' + s + '\n' + el.textContent;
  }
  function renderRequests() {
    const el = $('#dbg-reqs'); if (!el) return;
    el.innerHTML = STATE.requests.slice(0, 25).map((r) => {
      const u = r.url.length > 80 ? r.url.slice(0, 80) + '…' : r.url;
      return '<div class="req"><span class="m">' + r.method + '</span> <span class="u">' + u + '</span> [' + r.status + ']<br>' +
        (r.resp ? '<span class="mini">resp:' + r.resp.replace(/</g, '&lt;').slice(0, 140) + '</span>' : '') + '</div>';
    }).join('');
  }
  function renderCandidates() {
    const el = $('#dbg-cands'); if (!el) return;
    el.innerHTML = '';
    if (!STATE.candidates.length) { el.innerHTML = '<div class="mini">（先点"扫描目录候选"）</div>'; return; }
    STATE.candidates.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'cand';
      const t = (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26);
      row.innerHTML = '<span class="t">#' + (i + 1) + ' ' + t + '</span>';
      const sel = document.createElement('button'); sel.textContent = '选';
      sel.onclick = () => { STATE.selected = c; $$('#dbg-cands .cand').forEach((x) => x.classList.remove('sel')); row.classList.add('sel'); log('已选中候选 #' + (i + 1)); };
      const tryBtn = document.createElement('button'); tryBtn.textContent = '试切';
      tryBtn.className = 'primary';
      tryBtn.onclick = () => testSwitch(c, '#' + (i + 1) + ' ' + t);
      row.appendChild(sel); row.appendChild(tryBtn);
      el.appendChild(row);
    });
  }
  function renderResults() {
    const el = $('#dbg-results'); if (!el) return;
    el.innerHTML = STATE.results.slice(0, 20).map((r) =>
      '<div class="res ' + (r.passed ? 'ok' : 'no') + '">' +
      (r.passed ? '✅' : '❌') + ' ' + r.label + ' | 激活:' + (r.activeBefore || '-') + '→' + (r.activeAfter || '-') +
      (r.passed ? ' | 命中『' + r.passed + '』' : ' | 试过:' + (r.firedBy.join('/') || '无')) + '</div>'
    ).join('');
  }
  function copyReqReport() {
    const txt = STATE.requests.map((r) =>
      '【' + r.method + ' ' + r.status + '】' + r.url + '\n' + (r.reqBody ? 'REQ:' + r.reqBody + '\n' : '') + 'RESP:' + r.resp + '\n'
    ).join('\n----\n');
    copy(txt); log('已复制 ' + STATE.requests.length + ' 条API到剪贴板');
  }
  function exportReport() {
    const f = fingerprint();
    const api = STATE.requests.map((r) => ({ method: r.method, status: r.status, url: r.url, resp: r.resp }));
    const rep = {
      ts: new Date().toISOString(),
      pageUrl: location.href,
      title: document.title,
      fingerprint: f,
      capturedAPIs: api,
      candidates: STATE.candidates.map((c, i) => ({ i: i + 1, text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), tag: c.tagName, cls: c.className && c.className.toString().slice(0, 60), hasVue: !!(c.__vue__ || c.__vueParentComponent), hasReact: !!reactFiber(c) })),
      switchResults: STATE.results,
    };
    const txt = '==== 智慧树诊断探针报告 ====\n' + JSON.stringify(rep, null, 2);
    copy(txt);
    $('#dbg-out').value = txt;
    log('✅ 完整报告已复制到剪贴板（也显示在下方文本框）');
  }
  function copy(txt) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
      else { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    } catch (e) {}
  }

  /* ============ 启动 ============ */
  function boot() {
    if ($('#zhs-dbg-panel')) return;
    buildPanel();
    // 自动先截获一次，免得漏掉页面初始加载的接口
    installCapture();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 800);
  else document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 800));
})();
