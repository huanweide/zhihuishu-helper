'use strict';
// 只读深探：用 node fetch 直连 [::1]:9222/json/list（锁定含智慧树的调试实例），精准定位并直连智慧树页。
const { CdpConnection } = require('./zhs-probe');

async function listTargets() {
  const r = await fetch('http://[::1]:9222/json/list');
  return r.json();
}

const EXPR = `(() => {
  const r = {};
  try { r.hasZHS = !!window.ZHS; r.ZHSkeys = window.ZHS ? Object.keys(window.ZHS) : null; } catch(e){ r.ZHSerr = String(e); }
  try { r.hasTM = typeof window.Tampermonkey; r.hasGM = typeof window.GM_info; r.hasGMapi = typeof window.GM; } catch(e){ r.TMerr = String(e); }
  try {
    r.iframeCount = document.querySelectorAll('iframe').length;
    r.iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({ src: (f.src||'').slice(0,140), id: f.id||'', cls:(f.className||'').toString().slice(0,40) }));
  } catch(e){ r.iframeErr = String(e); }
  const sels = ['.child-info.hasvideo','.chapter-item','.chapter-tree-74','.course-name','[class*=chapter]','[class*=lesson]','[class*=catalog]','.video-title','.play-title','[class*=next]','[class*=Next]','.catalogue-name','.chapter-list','.course-list'];
  r.selCounts = {};
  sels.forEach(s => { try { r.selCounts[s] = document.querySelectorAll(s).length; } catch(e){ r.selCounts[s] = 'ERR'; } });
  try {
    const cap = document.querySelector('iframe[id*=captcha], iframe[src*=captcha]');
    if (cap) { const b = cap.getBoundingClientRect(); r.captcha = { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), left: Math.round(b.left), visible: b.width>0 && b.height>0 }; }
    else r.captcha = 'none';
  } catch(e){ r.capErr = String(e); }
  r.bodyTextLen = (document.body ? document.body.innerText : '').length;
  r.zhsFloat = !!document.getElementById('zhs-helper-root') || !!document.querySelector('[id*=zhs-helper]');
  return r;
})()`;

(async () => {
  const targets = await listTargets();
  const page = (targets || []).find(t => /zhihuishu/i.test(t.url || '') && t.type === 'page');
  if (!page) { console.error('✗ 无智慧树 page target。list 中有: ' + (targets||[]).map(t=>(t.type||'?')+':'+(t.url||'').slice(0,50)).join(' | ')); process.exit(3); }
  console.error('命中 target: ' + page.url.slice(0,80));
  const ws = (page.webSocketDebuggerUrl || '').replace(/localhost/i, '[::1]');
  const conn = new CdpConnection(ws);
  try {
    const r = await conn.callT('Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true }, null, 30000);
    if (r.exceptionDetails) { console.error('✗ 页内异常: ' + JSON.stringify(r.exceptionDetails).slice(0,400)); process.exit(7); }
    console.log(JSON.stringify(r.result.value, null, 2));
  } finally {
    conn.close();
  }
})();
