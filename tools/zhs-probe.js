/**
 * zhs-probe.js —— 只读结构探针（绝不关闭/改动浏览器）
 *
 * 对应需求「点下一节没用 / 用平台本身按钮指令或各种点击手段跳转」：
 * 在用户开着网课的 Edge 上，把页面真实导航结构抽成 JSON，用于逆向
 * 「这个布局到底靠什么切节」——目录项真实标签、有无 <a href>/onclick/data-id、
 * 原生下一节/继续学习按钮、iframe、SPA 框架、video 位置。
 *
 * 实现沿用 zhs-data.js 的直连 CDP 方案（读 DevToolsActivePort → 浏览器级 ws →
 * Target.getTargets → attachToTarget(flatten) → Runtime.evaluate 只读抽取）。
 *
 * 用法：node tools/zhs-probe.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const OUT_FILE = path.join(__dirname, 'zhs-probe.last.json');

function findWsFromUdd(udd) {
  const p = path.join(udd, 'DevToolsActivePort');
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
  const port = (lines[0] || '').trim();
  const p2 = (lines[1] || '').trim();
  if (!port || !p2) return null;
  return 'ws://127.0.0.1:' + port + p2;
}

class CdpConnection {
  constructor(url) {
    this.ws = new WebSocket(url, { perMessageDeflate: false });
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
    });
    this.ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      }
    });
  }
  async call(method, params, sessionId) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params: params || {} };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() { try { this.ws.close(); } catch (e) {} }
  // 单次调用带超时，避免某步卡住拖到整体 guard
  async callT(method, params, sessionId, ms) {
    let t;
    try {
      return await Promise.race([
        this.call(method, params, sessionId),
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error('调用超时: ' + method)), ms || 12000); }),
      ]);
    } finally { clearTimeout(t); }
  }
}

// ── 页内只读抽取：导航结构 ──
function extract() {
  const out = {};
  const Z = (typeof window !== 'undefined') ? window.ZHS : undefined;
  out.url = location.href;
  out.hash = location.hash;
  out.docTitle = (document.title || '').slice(0, 80);

  // 1) SPA 框架
  try {
    out.framework = {
      vue: (window.Vue && window.Vue.version) || null,
      nuxt: !!window.__NUXT__,
      next: !!window.__NEXT_DATA__,
      react: !!window.React || Object.keys(window).some((k) => /^__react/.test(k)),
      jq: !!window.jQuery,
    };
  } catch (e) { out.framework = { err: String(e) }; }

  // 2) iframe（video/目录可能在其中）
  try {
    out.iframes = Array.from(document.querySelectorAll('iframe')).slice(0, 20)
      .map((f) => ({ src: (f.src || '').slice(0, 140), cls: (f.className || '').toString().slice(0, 60) }));
  } catch (e) { out.iframesErr = String(e); }

  // 3) 助手选中的适配器（它到底用什么选择器在点）
  try {
    const ad = (Z && Z.Catalog && Z.Catalog.adapter) || null;
    if (ad) {
      out.adapter = {
        name: ad.name,
        container: ad.container, items: ad.items, title: ad.title,
        active: ad.active, activeClass: ad.activeClass,
        finish: ad.finish, progress: ad.progress, progressAttr: ad.progressAttr,
        locked: ad.locked, clickTarget: ad.clickTarget,
      };
    } else out.adapter = null;
  } catch (e) { out.adapterErr = String(e); }

  // 4) 助手识别的目录项（序列化成描述符，看真实标签/链接/点击目标）
  try {
    if (Z && Z.Catalog && typeof Z.Catalog.items === 'function') {
      const items = Z.Catalog.items();
      out.itemCount = items.length;
      out.items = items.slice(0, 40).map((el, i) => {
        const a = (el.querySelector && el.querySelector('a[href]')) || null;
        const data = {};
        try {
          for (const k of Array.from(el.attributes || [])) {
            if (/^data-/i.test(k.name) || k.name === 'href' || k.name === 'onclick') data[k.name] = String(k.value).slice(0, 80);
          }
        } catch (e) { /* 忽略 */ }
        let isCurrent = false;
        try { isCurrent = !!(Z.Catalog.hasActive && Z.Catalog.hasActive(el)); } catch (e) {}
        return {
          i, tag: el.tagName,
          cls: (el.className || '').toString().slice(0, 140),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
          anchorHref: a ? String(a.getAttribute('href')).slice(0, 100) : null,
          attrs: data,
          isCurrent,
          outer: (el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 200),
        };
      });
    } else { out.items = null; out.itemCount = 0; }
  } catch (e) { out.itemsErr = String(e); }

  // 5) 原生导航按钮（平台自己的"下一节/下一集/继续学习"等）
  try {
    const kw = /下一节|下一集|下一课时|下一个|继续学习|继续播放|开始学习|进入学习|继续课程|播放|继 *续/;
    const seen = new Set();
    out.nativeButtons = [];
    Array.from(document.querySelectorAll('button,[role="button"],a,li,span,div,i')).forEach((el) => {
      const t = (el.textContent || '').replace(/\s+/g, '').trim();
      if (!t || t.length > 10 || !kw.test(t)) return;
      if (el.offsetParent === null && el.offsetWidth === 0) return;   // 不可见
      const key = el.tagName + '|' + (el.className || '').toString().slice(0, 40) + '|' + t;
      if (seen.has(key)) return; seen.add(key);
      out.nativeButtons.push({
        tag: el.tagName, cls: (el.className || '').toString().slice(0, 100),
        text: t, href: el.getAttribute ? el.getAttribute('href') : null,
        title: el.getAttribute ? el.getAttribute('title') : null,
      });
    });
    out.nativeButtons = out.nativeButtons.slice(0, 30);
  } catch (e) { out.nativeButtonsErr = String(e); }

  // 6) video 位置/源
  try {
    const v = document.querySelector('video');
    out.video = v ? {
      src: String(v.currentSrc || v.src || '').slice(0, 140),
      duration: Math.round(v.duration || 0), currentTime: Math.round(v.currentTime || 0),
      ended: !!v.ended, paused: !!v.paused,
    } : null;
  } catch (e) { out.videoErr = String(e); }

  // 7) 目录区里的所有 <a href>（潜在深链）
  try {
    const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 60)
      .map((a) => ({ text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30), href: String(a.getAttribute('href')).slice(0, 100) }))
      .filter((x) => x.text || /lesson|video|study|course|chapter|id=/i.test(x.href));
    out.anchors = anchors.slice(0, 30);
  } catch (e) { out.anchorsErr = String(e); }

  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  let ws = (argv.find((a) => a.startsWith('--ws=')) || '').slice(5);
  const udd = (argv.find((a) => a.startsWith('--udd=')) || '').slice(6);
  if (!ws) {
    const cands = [udd,
      process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\User Data',
      process.env.USERPROFILE + '\\zhs_edge_profile'].filter(Boolean);
    for (const c of cands) { const w = findWsFromUdd(c); if (w) { ws = w; break; } }
  }
  if (!ws) { console.error('✗ 找不到 Edge 远程调试端点'); process.exit(2); }
  console.log('浏览器 CDP: ' + ws);
  const guard = setTimeout(() => { console.error('✗ 超时（60s）'); process.exit(9); }, 60000);
  const conn = new CdpConnection(ws);
  try {
    console.log('step1: getTargets ...');
    const targets = await conn.callT('Target.getTargets', {}, null, 12000);
    const infos = (targets && targets.targetInfos) || [];
    const pages = infos.filter((t) => t.type === 'page' && t.url && t.url !== 'about:blank');
    const zhsPage = pages.find((t) => /zhihuishu/i.test(t.url || '')) || pages[0];
    if (!zhsPage) { console.error('✗ 没有可用页面标签'); process.exit(3); }
    console.log('目标标签: ' + zhsPage.url);
    console.log('step2: attachToTarget ...');
    const attached = await conn.callT('Target.attachToTarget', { targetId: zhsPage.targetId, flatten: true }, null, 12000);
    const sessionId = attached && attached.sessionId;
    if (!sessionId) { console.error('✗ attach 未返回 sessionId'); process.exit(6); }
    console.log('sessionId=ok, step3: Runtime.enable ...');
    await conn.callT('Runtime.enable', {}, sessionId, 12000).catch((e) => console.log('  enable: ' + e.message));
    console.log('step4: Runtime.evaluate ...');
    const result = await conn.callT('Runtime.evaluate', {
      expression: '(' + extract.toString() + ')()', returnByValue: true, awaitPromise: true,
    }, sessionId, 25000);
    if (result && result.exceptionDetails) {
      console.error('✗ 页内抽取抛异常：' + JSON.stringify(result.exceptionDetails).slice(0, 400));
      process.exit(7);
    }
    const data = (result && result.result && result.result.value) || null;
    if (!data) { console.error('✗ 抽取为空：' + JSON.stringify(result).slice(0, 500)); process.exit(5); }
    fs.writeFileSync(OUT_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('\n── 结构探针结果 ──');
    console.log('url: ' + data.url);
    console.log('framework: ' + JSON.stringify(data.framework));
    console.log('adapter: ' + JSON.stringify(data.adapter));
    console.log('itemCount: ' + data.itemCount);
    (data.items || []).slice(0, 20).forEach((it) => {
      console.log('  [' + it.i + '] <' + it.tag + '> cur=' + it.isCurrent + ' href=' + it.anchorHref
        + ' text="' + it.text + '" cls=' + it.cls.slice(0, 50));
    });
    console.log('nativeButtons: ' + JSON.stringify(data.nativeButtons));
    console.log('video: ' + JSON.stringify(data.video));
    console.log('iframes: ' + JSON.stringify(data.iframes));
    console.log('\n已写入: ' + OUT_FILE);
  } finally {
    conn.close();
    clearTimeout(guard);
  }
}

main().catch((e) => { console.error('✗ ' + (e && e.message ? e.message : e)); process.exit(1); });
