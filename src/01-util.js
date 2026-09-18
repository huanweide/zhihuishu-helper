/**
 * 通用工具函数：DOM 等待、可见性检测、节流、随机延迟
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod01_util) return;
  ZHS.__mod01_util = true;

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

    /**
     * 结构可见性：只排除 display:none / visibility:hidden / opacity:0，
     * 不要求有尺寸。
     *
     * 为什么要两个判定：
     *  - isVisible 用于「必须真能点到」的场景（比如按钮）
     *  - isStructurallyVisible 用于「元素存在即算出现」的场景（比如弹题容器），
     *    因为智慧树有些容器在特定布局下尺寸暂时为 0，但内容已经渲染好了，
     *    用 isVisible 会误判成"没出现"，导致弹题漏处理。
     */
    isStructurallyVisible(el) {
      if (!el) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const opacity = Number.parseFloat(style.opacity || '1');
      if (!(opacity > 0.05)) return false;
      return true;
    },

    /** 选择器组中是否有任一结构可见元素 */
    hasStructurallyVisible(selector) {
      const list = document.querySelectorAll(selector);
      for (const el of list) {
        if (Util.isStructurallyVisible(el)) return true;
      }
      return false;
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

    /**
     * 跨「同域 iframe」查找 video 元素
     *
     * 智慧树部分页面（尤其新形态/微前端容器）会把播放器嵌在 iframe 里，
     * 顶层 document.querySelector('video') 永远落空 → 脚本判定「无视频」→ 整体不启动，
     * 表现正是用户说的「功能全无用」。
     * 顶层找不到时，递归遍历 iframe 的 contentDocument 找 video；跨域 iframe（取不到）
     * 直接跳过——拿不到控制权就别硬来，至少顶层视频路径不受影响。
     */
    findVideoInIframes(doc) {
      doc = doc || document;
      try {
        const frames = doc.querySelectorAll('iframe');
        for (const f of frames) {
          let idoc = null;
          try { idoc = f.contentDocument || (f.contentWindow && f.contentWindow.document); } catch (e) { idoc = null; }
          if (!idoc) continue;
          const v = idoc.querySelector('video');
          if (v) return v;
          const nested = Util.findVideoInIframes(idoc);   // 嵌套 iframe 递归一层
          if (nested) return nested;
        }
      } catch (e) { /* 安全策略禁止访问 iframe，忽略 */ }
      return null;
    },

    /** 等待选择器组全部不可见（结构判定） */
    async waitUntilHidden(selector, timeoutMs = 600000, interval = 500) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!Util.hasStructurallyVisible(selector)) return true;
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
