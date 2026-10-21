'use strict';
/**
 * diag-probe.js —— 注入页面内的诊断函数（不依赖主脚本即可跑结构抽取；
 * 若 window.ZHS 存在则额外跑「切课策略穷举」）。
 *
 * 导出 pageDiagSource：可直接用于 CDP Runtime.evaluate
 *   （returnByValue:true, awaitPromise:true 拿结构化结果）。
 *
 * 设计要点（对应「100 个按钮穷举 + 后端数据」需求）：
 *  - struct：页面框架 / 适配器 / 目录候选 / 视频 / 原生按钮 / iframe —— 看清布局真相。
 *  - strategies：对「当前节 → 下一候选」逐一试 S1~S5 切课策略，
 *    每策略测「点击后是否触发切换（URL/标题/class/videoSrc/current() 任一变化）」，
 *    返回 didSwitch 供定位「为什么切不动」。
 *  - 全程只读探测，不改变用户进度（诊断不实际连切 20 节，只测一跳）。
 */

async function pageDiag() {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const Z = (typeof window !== 'undefined') ? window.ZHS : undefined;

  const out = { url: location.href, title: document.title, hasZHS: !!Z, framework: {} };

  try {
    out.framework = {
      vue: !!(window.Vue && window.Vue.version),
      react: !!window.React || Object.keys(window).some((k) => /^__react/.test(k)),
      next: !!window.__NEXT_DATA__, nuxt: !!window.__NUXT__,
      jq: !!window.jQuery, angular: !!window.angular,
    };
  } catch (e) { out.frameworkErr = String(e); }

  try {
    out.iframes = Array.from(document.querySelectorAll('iframe')).slice(0, 12)
      .map((f) => ({ src: (f.src || '').slice(0, 160), id: f.id || '', cls: (f.className || '').toString().slice(0, 50) }));
  } catch (e) { out.iframesErr = String(e); }

  try {
    const ad = (Z && Z.Catalog && Z.Catalog.adapter) || null;
    out.adapter = ad
      ? { name: ad.name, container: ad.container, items: ad.items, title: ad.title, active: ad.active, clickTarget: ad.clickTarget }
      : null;
  } catch (e) { out.adapterErr = String(e); }

  let items = [];
  try {
    if (Z && Z.Catalog && typeof Z.Catalog.items === 'function') items = Z.Catalog.items();
  } catch (e) { out.itemsErr = String(e); }
  out.itemCount = items.length;
  out.items = items.slice(0, 40).map((el, i) => {
    const a = (el.querySelector && el.querySelector('a[href]')) || null;
    let isCur = false;
    try { isCur = !!(Z && Z.Catalog.hasActive && Z.Catalog.hasActive(el)); } catch (e) { /* ignore */ }
    return {
      i,
      tag: el.tagName,
      cls: norm(el.className).slice(0, 140),
      text: norm(el.textContent).slice(0, 40),
      href: a ? String(a.getAttribute('href')).slice(0, 120) : null,
      isCurrent: isCur,
      hasVideo: !!(el.querySelector && el.querySelector('video')),
      doneMark: !!(el.querySelector && el.querySelector('[class*=finish],[class*=done],[class*=complete],[class*=check]')),
    };
  });

  try {
    const v = document.querySelector('video');
    out.video = v
      ? { src: String(v.currentSrc || v.src || '').slice(0, 160), duration: Math.round(v.duration || 0), currentTime: Math.round(v.currentTime || 0), ended: !!v.ended, paused: !!v.paused }
      : null;
  } catch (e) { out.videoErr = String(e); }

  const kw = /下一节|下一集|下一课时|下一个|继续学习|继续播放|开始学习|进入学习|继续课程|播放|继\s*续/;
  out.nativeButtons = [];
  try {
    Array.from(document.querySelectorAll('button,[role="button"],a,li,span,div,i')).forEach((el) => {
      const t = norm(el.textContent);
      if (!t || t.length > 12 || !kw.test(t)) return;
      if (el.offsetParent === null && el.offsetWidth === 0) return;
      out.nativeButtons.push({ tag: el.tagName, cls: norm(el.className).slice(0, 100), text: t, href: el.getAttribute ? el.getAttribute('href') : null });
    });
    out.nativeButtons = out.nativeButtons.slice(0, 30);
  } catch (e) { out.nativeButtonsErr = String(e); }

  // ── 切课策略穷举：当前节 → 下一候选（只读一跳，不改进度）──
  out.strategies = [];
  if (Z && Z.Catalog && typeof Z.Catalog.items === 'function' && items.length) {
    const cur = Z.Catalog.current();
    const curKey = cur ? norm(cur.textContent) : null;
    const idx = items.indexOf(cur);
    const target = items[idx + 1] || items.find((e) => e !== cur);
    if (target) {
      const tgtCls = () => (target.getAttribute('class') || '');
      const curCls = () => (cur ? cur.getAttribute('class') || '' : '');
      const sig = () => ({
        url: location.href,
        title: document.title,
        curCls: curCls(),
        tgtCls: tgtCls(),
        video: (document.querySelector('video') || {}).src || '',
      });
      const switched = () => {
        const now = Z.Catalog.current();
        const nowKey = now ? norm(now.textContent) : null;
        return !!(nowKey && curKey && nowKey !== curKey);
      };
      const strategies = [
        { name: 'S1_clickEl', fn: async () => { target.click(); } },
        { name: 'S2_clickAnchor', fn: async () => { const a = target.querySelector && target.querySelector('a[href]'); if (a) a.click(); else target.click(); } },
        { name: 'S3_nativeNext', fn: async () => { const b = out.nativeButtons.find((x) => /下一|继续|播放|进入/.test(x.text)); if (b) { const el = Array.from(document.querySelectorAll('button,[role=button],a,li,span,div')).find((e) => norm(e.textContent) === b.text && e.offsetParent !== null); if (el) el.click(); } } },
        { name: 'S4_navJump', fn: async () => { if (Z && Z.Nav && Z.Nav.jumpTo) await Z.Nav.jumpTo(target, { timeout: 1500 }); } },
        { name: 'S5_urlNav', fn: async () => { const a = target.querySelector && target.querySelector('a[href]'); if (a) { const h = a.getAttribute('href'); if (h && h.startsWith('#')) location.hash = h; else if (h && /^https?:/.test(h)) location.href = h; } } },
      ];
      for (const s of strategies) {
        const before = sig();
        let err = null;
        try { await s.fn(); } catch (e) { err = String(e && e.message ? e.message : e); }
        await sleep(700);
        const after = sig();
        const didSwitch = switched() || after.url !== before.url || after.title !== before.title || after.tgtCls !== before.tgtCls || after.video !== before.video;
        out.strategies.push({ name: s.name, err, didSwitch, before: { url: before.url.slice(0, 80), title: before.title.slice(0, 40), tgtCls: before.tgtCls.slice(0, 60), video: before.video.slice(0, 60) }, after: { url: after.url.slice(0, 80), title: after.title.slice(0, 40), tgtCls: after.tgtCls.slice(0, 60), video: after.video.slice(0, 60) } });
      }
    } else {
      out.strategiesNote = '无当前项或下一候选，跳过穷举';
    }
  } else {
    out.strategiesNote = '无 ZHS.Catalog，跳过策略穷举（仅结构抽取）';
  }

  return out;
}

module.exports = { pageDiagSource: '(' + pageDiag.toString() + ')()' };
