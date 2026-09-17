/**
 * 通用工具函数：DOM 等待、可见性检测、节流、随机延迟
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS) return;

  const Util = {
    /** 睡眠 */
    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },

    /** 随机延迟 [min, max] 秒 → 毫秒 */
    randomDelay(minSec, maxSec) {
      const min = Math.max(0, Number(minSec) || 0) * 1000;
      const max = Math.max(min, (Number(maxSec) || 0) * 1000);
      return Util.sleep(min + Math.random() * (max - min));
    },

    /** 节流：立即执行首次，之后间隔 ms 执行 */
    throttle(fn, ms) {
      let last = 0;
      let timer = null;
      return function (...args) {
        const now = Date.now();
        const remain = ms - (now - last);
        if (remain <= 0) {
          last = now;
          fn.apply(this, args);
        } else if (!timer) {
          timer = setTimeout(() => {
            last = Date.now();
            timer = null;
            fn.apply(this, args);
          }, remain);
        }
      };
    },

    /** 防抖 */
    debounce(fn, ms) {
      let timer = null;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
      };
    },

    /** 元素是否真实可见（宽高 > 0 且不透明度 > 0.05） */
    isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const opacity = Number.parseFloat(style.opacity || '1');
      if (!(opacity > 0.05)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    /** 选择器组中是否有任一可见元素 */
    hasVisible(selector) {
      const list = document.querySelectorAll(selector);
      for (const el of list) {
        if (Util.isVisible(el)) return true;
      }
      return false;
    },

    /** 等待元素出现 */
    async waitFor(selector, timeoutMs = 20000, interval = 300) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const el = document.querySelector(selector);
        if (el) return el;
        await Util.sleep(interval);
      }
      return null;
    },

    /** 等待选择器组全部不可见 */
    async waitUntilHidden(selector, timeoutMs = 600000, interval = 500) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!Util.hasVisible(selector)) return true;
        await Util.sleep(interval);
      }
      return false;
    },

    /** 安全取值：带默认值 */
    pick(obj, keys, fallback) {
      for (const k of keys) {
        if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
      }
      return fallback;
    },

    /** 从 URL 提取参数 */
    getUrlParam(name) {
      try {
        const u = new URL(location.href);
        return u.searchParams.get(name);
      } catch (e) {
        const m = location.search.match(new RegExp('[?&]' + name + '=([^&]+)'));
        return m ? decodeURIComponent(m[1]) : null;
      }
    },

    /** 文本归一化（去多余空白） */
    normText(s) {
      return String(s || '').replace(/\s+/g, ' ').trim();
    },

    /** 在元素内按文本查找子元素 */
    findByText(root, selector, keywords) {
      const list = (root || document).querySelectorAll(selector);
      const kws = Array.isArray(keywords) ? keywords : [keywords];
      for (const el of list) {
        const t = Util.normText(el.innerText || el.textContent);
        if (kws.some((k) => t.includes(k))) return el;
      }
      return null;
    },
  };

  ZHS.Util = Util;
})();
