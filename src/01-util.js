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

    /**
     * 腾讯 Turing 滑块验证码是否「真的弹出来拦人」了（激活态）。
     *
     * 【为什么不能裸用选择器 —— 真机踩过的坑】
     * turing.captcha.gtimg.com 的 iframe 在智慧树视频页是**常驻**的：
     * 休眠态就是一个 300×150 的占位框，computed style 仍然是 display:block /
     * visibility:visible / opacity:1。所以
     *   hasStructurallyVisible('iframe[src*=turing]')
     * 会**永久命中** → 守卫 1 一直拦截 → 脚本彻底停机。这是把「常驻占位」
     * 当成「正在拦人」的典型误判。
     *
     * 真机实测：只有真正弹出来拦人时，它才会变成「居中、覆盖视口大半的
     * fixed/absolute 浮层」，并且页面上出现可见文案
     * 「安全验证 / 拖动下方滑块完成拼图」。所以判据取这两条（或关系）：
     *   ① iframe 的祖先链里出现覆盖视口（宽 > 50% 且 高 > 40%）的 fixed/absolute 浮层
     *   ② 页面上出现可见的「拖动下方滑块 / 安全验证」文本（只查叶子节点）
     */
    turingActive() {
      try {
        const f = document.querySelector('iframe[src*="turing"], iframe[src*="captcha.gtimg.com"]');
        if (f) {
          let n = f;
          for (let i = 0; i < 8 && n; i++) {
            const cs = getComputedStyle(n);
            const r = n.getBoundingClientRect();
            const covers = (r.width > window.innerWidth * 0.5)
              && (r.height > window.innerHeight * 0.4);
            // r.width/height 为 0 = 拿不到真实布局（如 jsdom / 元素尚未排版）。
            // 有布局时用「覆盖视口」这个强判据；没有布局信息时退化为只看定位方式，
            // 否则测试环境里永远判不出拦截态（真踩过）。
            const sized = r.width > 0 && r.height > 0;
            if ((cs.position === 'fixed' || cs.position === 'absolute')
                && cs.display !== 'none' && (covers || !sized)) return true;
            n = n.parentElement;
          }
        }
      } catch (e) { /* 跨域/取不到样式一律当作没拦截 */ }

      try {
        const all = document.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
          const el = all[i];
          if (el.children.length !== 0) continue;        // 只看叶子，避免父容器整段文本误命中
          if (!Util.isStructurallyVisible(el)) continue; // 不可见（display:none 等）跳过
          const tx = Util.normText(el.textContent);
          if (tx && /拖动下方滑块|安全验证|请完成验证/.test(tx)) return true;
        }
      } catch (e) { /* 忽略 */ }
      return false;
    },

    /**
     * 拟真点击：派发带坐标的 mousedown → mouseup → click 三连。
     *
     * 为什么不用 el.click()：真机实测（round-26）在智慧树目录上，
     * 裸 click() 出现过整页跳到 www.zhihuishu.com 门户首页的情况；
     * 而把带坐标的鼠标三连派发到小节标题 .catalogue_title 上，
     * 稳定表现为「页内换 video 源、URL 始终不变」。
     * 三连更接近人类操作序列，也更容易被 Vue 的监听器正确接收。
     */
    realClick(el) {
      if (!el) return false;
      try {
        if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (e) { /* 滚动失败不影响点击 */ }
      try {
        const r = el.getBoundingClientRect();
        const o = {
          bubbles: true, cancelable: true, view: window,
          clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
        };
        el.dispatchEvent(new MouseEvent('mousedown', o));
        el.dispatchEvent(new MouseEvent('mouseup', o));
        el.dispatchEvent(new MouseEvent('click', o));
        return true;
      } catch (e) {
        try { el.click(); return true; } catch (e2) { return false; }
      }
    },

    /**
     * 拟人化点击（round-35）：比 realClick 更接近人类操作序列。
     *
     * 仍是合成事件（页面 JS 无法产生 isTrusted=true 的事件），但智慧树反作弊主要
     * 识别「瞬时、零位移、固定坐标」的机器点击。这里补上：随机起点 → 沿路径多步
     * mousemove → 悬停 → 带微抖动的坐标点下 → 前后随机微延迟，把指纹从「机器」拉向「人」。
     * 仅作为 Nav 策略③ 的最后兜底，不进主路径。
     */
    realClickHuman(el) {
      if (!el) return false;
      try { if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
      const r = el.getBoundingClientRect();
      if (!r || r.width === 0 || r.height === 0) { return Util.realClick(el); }
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const jit = () => (Math.random() - 0.5) * 4;          // ±2px 抖动
      const ev = (type, x, y) => {
        try {
          el.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window,
            clientX: x, clientY: y, screenX: x, screenY: y,
          }));
        } catch (e) { /* 忽略 */ }
      };
      const move = (x, y) => {
        try {
          document.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true, cancelable: true, view: window, clientX: x, clientY: y,
          }));
        } catch (e) { /* 忽略 */ }
      };
      // 随机起点 → 沿直线插值到元素中心（6 步）
      let sx = cx + (Math.random() - 0.5) * 120;
      let sy = cy + (Math.random() - 0.5) * 120;
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        move(sx + (cx - sx) * t, sy + (cy - sy) * t);
      }
      move(cx, cy);
      ev('mouseover', cx, cy);
      ev('mousedown', cx + jit(), cy + jit());
      ev('mouseup', cx + jit(), cy + jit());
      ev('click', cx + jit(), cy + jit());
      return true;
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

  /**
   * 共享常量（单一真源）。
   *
   * 为什么要抽出来：弹题容器的选择器此前在 src/05-scheduler.js 与 src/08-questions.js
   * 各写了一份字面量。两份只要有一处改动没同步，就会出现：
   *   调度器守卫判定「这是弹题」→ 答题模块却找不到容器（或反过来），
   *   表现是弹窗明明在屏幕上、脚本却完全不处理（2026-09-19 用户报的「脚本没有在答这种题」）。
   * 现在统一从这里取，两边都用 `ZHS.Const.QUESTION_SELECTORS || '<兜底字面量>'` 兜底取值——
   * 兜底字面量是为了防模块加载顺序异常（例如本模块被重入守卫提前 return），
   * 拿不到常量时至少还能用默认串工作，而不是整个答题链路静默失效。
   *
   * 选择器说明：
   *  - `#playTopic-dialog` / `[class*="topic-dialog"]`：智慧树标准课中弹题容器。
   *  - `.el-dialog__wrapper .el-dialog`：Element UI 弹窗（「选对才能关」的 A/B 简单答题就是这种），
   *    它的 class 里不含 `topic-dialog` 子串，只写前两个选择器会完全匹配不到。
   */
  ZHS.Const = ZHS.Const || {};
  ZHS.Const.QUESTION_SELECTORS =
    '#playTopic-dialog, [class*="topic-dialog"], .el-dialog__wrapper .el-dialog';

  /**
   * 平台「视为已完成」的进度阈值（单一真源）。
   *
   * 为什么是 91：竞品 fuckZHS 的实测配置 end_thre = 0.91，其原话注释是
   * 「智慧树把高于一定百分比的进度视为完成，0.91 保险一点」。
   * 智慧树的进度记录常停在 91~99% 就不再上报，门槛定高了会把「已完成」判成「未完成」。
   *
   * 历史问题：本项目原先 02-adapter.js 写 98、05-scheduler.js 写 95、06b-course-hub.js 写 98，
   * 三处各自为政；只要有一处更严，就会出现「目录说完成了、调度器说没完成」的打架，
   * 表现为课时被反复回退重播。现在统一从这里取，
   * 各处用 `(ZHS.Const && ZHS.Const.FINISH_PCT) || 91` 兜底（防模块加载顺序异常）。
   */
  ZHS.Const.FINISH_PCT = 91;
})();
