(function () {
  'use strict';
  const ZHS = window.ZHS = window.ZHS || {};
  const U = ZHS.Util;

  /**
   * round-35：导航策略链（取代单一「合成点击下一节」通道）
   *
   * 背景：智慧树反作弊把 isTrusted=false 的 MouseEvent 判成脚本并踢人（round-26 还确认
   * seek 拖进度会触发腾讯 Turing 滑块）。原 gotoNext 唯一点击通道是
   * Catalog.click → el.click()/realClick（全合成事件），正是被检测的根。
   *
   * 本模块把「跳到未学习节」拆成一篮子策略，按「隐蔽度」从高到低尝试，任一成功即收：
   *   ① spa      —— 直接调 SPA 内部方法（Vue $emit / React onClick / 播放器 load），零 DOM 事件，最隐蔽
   *   ② url      —— URL/hash 深链，浏览器原生导航（智慧树多数不支持，失败自动回落）
   *   ③ humanClick —— 拟人化合成点击（最后兜底，仍合成但最难被判脚本）
   *
   * 验收原则：①/② 这类「无点击」策略本身不派发事件，必须用「目录当前项是否真的变成目标项」
   * 来验收（_waitSwitched），绝不能靠 clickAndVerify（那会反过来再点一次，把①/② 的意义抹掉）。
   * 只有③ 才走 clickAndVerify 去点击+验收。
   */
  const Nav = {
    lastStrategy: null,
    lastError: null,
    _fromKey: null,

    /**
     * 跳转到目标目录条目（未学习节）。
     * @param {Element} el 目标条目
     * @param {object} [opt] { fromKey, timeout, humanOnly }
     * @returns {Promise<boolean>} 是否成功切过去
     */
    async jumpTo(el, opt) {
      opt = opt || {};
      this._fromKey = opt.fromKey || null;
      if (!el) return false;
      const cat = ZHS.Catalog;

      // 先试「无点击」策略：spa → url
      if (!opt.humanOnly) {
        for (const name of ['spa', 'url']) {
          try {
            const fired = await (name === 'spa' ? this._viaSpa(el) : this._viaUrl(el));
            if (!fired) continue;                         // 该策略不适用（如没找到 SPA 句柄）→ 试下一个
            if (await this._waitSwitched(el, opt.fromKey, opt.timeout || 2500)) {
              this.lastStrategy = name;
              ZHS.Log.info('[Nav] 策略『' + name + '』跳转成功并验收');
              return true;
            }
          } catch (e) {
            this.lastError = name + ': ' + e.message;
            ZHS.Log.debug('[Nav] 策略『' + name + '』异常：' + e.message);
          }
        }
      }

      // 策略③：平台原生下一节/继续按钮（仅 gotoNext 场景允许）
      if (opt.allowNativeNext) {
        try {
          const fired = await this._viaNativeNext();
          if (fired && await this._waitSwitched(el, opt.fromKey, opt.timeout || 2500)) {
            this.lastStrategy = 'nativeNext';
            ZHS.Log.info('[Nav] 策略『nativeNext』跳转成功并验收');
            return true;
          }
        } catch (e) {
          this.lastError = 'nativeNext: ' + e.message;
        }
      }

      // 回落：拟人化点击（唯一会派发事件的策略）
      try {
        const ok = (cat && cat.clickAndVerify)
          ? await cat.clickAndVerify(el, { timeout: opt.timeout || 3000, tries: 2, fromKey: opt.fromKey })
          : this._legacyClick(el);
        if (ok) { this.lastStrategy = 'humanClick'; return true; }
      } catch (e) {
        this.lastError = 'humanClick: ' + e.message;
      }
      ZHS.Log.warn('[Nav] 所有跳转策略均失败（lastError=' + (this.lastError || 'n/a') + '）');
      return false;
    },

    /**
     * 策略③：平台原生「下一节/下一集/继续学习」按钮（round-36，用户明确要求「用平台本身的按钮指令」）。
     * 只在 gotoNext 场景开启（opt.allowNativeNext）——它按「下一节」推进，不保证等于任意指定目标 el，
     * 但 gotoNext 的 next 本就是下一节，语义吻合；其它场景（续播定位到指定节）不启用，交给验收兜底。
     */
    async _viaNativeNext() {
      const kw = /下一节|下一集|下一课时|下一个|继续学习|继续播放|继续课程|继 *续/;
      const visible = (elm) => {
        try { const s = getComputedStyle(elm); return s.display !== 'none' && s.visibility !== 'hidden'; }
        catch (e) { return true; }
      };
      const els = Array.from(document.querySelectorAll('button,[role="button"],a,li,div,span,i')).filter((elm) => {
        const t = (elm.textContent || '').replace(/\s+/g, '').trim();
        if (!t || t.length > 10 || !kw.test(t)) return false;
        return visible(elm);
      });
      if (!els.length) return false;
      els.sort((a, b) => (b.tagName === 'BUTTON' ? 1 : 0) - (a.tagName === 'BUTTON' ? 1 : 0));  // 按钮类优先
      const btn = els[0];
      const fire = U.realClickHuman || ((x) => { x.click(); return true; });
      return fire(btn);
    },

    /**
     * 验收：目录当前项是否已变成目标项（不派发任何事件）。
     * 逻辑等价于 Catalog.clickAndVerify 内部的 nowIsTarget：用元素身份/目录索引比对，
     * 标题同名也能靠索引区分；都没法判断时回落标题比对。
     */
    async _waitSwitched(el, fromKey, ms) {
      const cat = ZHS.Catalog;
      if (!cat || !cat.items || !cat.current) return false;
      const deadline = Date.now() + (ms || 2500);
      const step = () => {
        try {
          const list = cat.items();
          const cur = cat.current();
          if (!cur) return false;
          const _idx = (n) => list.findIndex((it) => it === n || it.contains(n) || (n && n.contains && n.contains(it)));
          const curIdx = _idx(cur);
          const tgtIdx = _idx(el);
          if (curIdx >= 0 && tgtIdx >= 0) {
            if (curIdx === tgtIdx) return true;
            if (fromKey && curIdx === _idx(cat.findByName(fromKey)) && curIdx !== tgtIdx) return false;
            return false;
          }
          const ck = cat.itemTitle(cur), tk = cat.itemTitle(el);
          if (!ck) return false;
          if (fromKey && ck === fromKey && ck !== tk) return false;
          return ck === tk;
        } catch (e) { return false; }
      };
      while (Date.now() < deadline) {
        if (step()) return true;
        if (U && U.sleep) await U.sleep(150); else await new Promise((r) => setTimeout(r, 150));
      }
      return step();
    },

    /** 策略①：SPA 内部方法直调（无合成事件，最隐蔽） */
    async _viaSpa(el) {
      if (!el) return false;

      // —— Vue2/3 组件实例：直接触发其 click 处理函数（绕开 DOM 事件分发）——
      const vm = el.__vue__ || el.__vueParentComponent;
      if (vm) {
        const ctx = vm.ctx || vm.proxy || vm;
        // 直接 emit click：Vue 会把事件交给组件绑定的 @click 处理器，等价于真实点击但无 DOM 事件
        if (typeof vm.$emit === 'function') {
          try { vm.$emit('click', { currentTarget: el, target: el, preventDefault() {}, stopPropagation() {} }); return true; }
          catch (e) { /* 忽略，继续尝试其它 */ }
        }
        const m = ['select', 'onClick', 'handleClick', 'goToLesson', 'playLesson', 'clickItem', 'onItemClick'];
        for (const name of m) {
          const fn = ctx && ctx[name];
          if (typeof fn === 'function') {
            try { fn.call(ctx, { currentTarget: el, target: el }); return true; } catch (e) { /* 忽略 */ }
          }
        }
      }

      // —— React fiber：直接调 props.onClick ——
      const fiber = this._reactFiber(el);
      if (fiber) {
        const props = (fiber.memoizedProps) || (fiber.stateNode && fiber.stateNode.props) || {};
        if (typeof props.onClick === 'function') {
          try {
            props.onClick({ currentTarget: el, target: el, preventDefault() {}, stopPropagation() {} });
            return true;
          } catch (e) { /* 忽略 */ }
        }
      }

      // —— 全局播放器对象（部分播放器 SDK 暴露 load(lessonId)）——
      const player = window.__player || window.player || (window.videojs && window.videojs.getPlayers && window.videojs.getPlayers());
      if (player && typeof player.load === 'function') {
        const id = this._lessonId(el);
        if (id) { try { player.load(id); return true; } catch (e) { /* 忽略 */ } }
      }
      return false;   // 没有可用句柄 → 交给 url / humanClick
    },

    /** 策略②：URL / hash 深链（浏览器原生导航；智慧树多数不支持，失败自动回落） */
    async _viaUrl(el) {
      const href = this._lessonHref(el);
      if (!href) return false;
      try {
        if (href.charAt(0) === '#') {
          if (location.hash !== href) location.hash = href;
        } else if (/^https?:/i.test(href)) {
          location.assign(href);
        } else {
          location.assign(new URL(href, location.href).href);
        }
        return true;
      } catch (e) { return false; }
    },

    /** 兜底（无 clickAndVerify 时）：裸 click */
    _legacyClick(el) {
      try { if (el.scrollIntoView) el.scrollIntoView({ block: 'center' }); } catch (e) {}
      try { el.click(); return true; } catch (e) { return false; }
    },

    // —— 辅助：从元素抽取课时 id / href / SPA 句柄 ——
    _lessonId(el) {
      if (!el || !el.getAttribute) return null;
      for (const a of ['data-lesson-id', 'data-id', 'data-course-id', 'data-vid', 'data-lessonid', 'lessonid']) {
        const v = el.getAttribute(a);
        if (v) return v;
      }
      const link = (el.querySelector && el.querySelector('a[href]'));
      if (link) {
        const m = String(link.getAttribute('href') || '').match(/id=([^&]+)/);
        if (m) return m[1];
      }
      return null;
    },
    _lessonHref(el) {
      const a = (el.querySelector && el.querySelector('a[href]'));
      if (a) { const h = a.getAttribute('href'); if (h && h !== '#' && !/^javascript:/i.test(h)) return h; }
      const v = this._lessonId(el);
      return v ? ('#lesson-' + v) : null;
    },
    _reactFiber(el) {
      for (const k of Object.keys(el)) {
        if (/^__reactFiber\$/.test(k) || /^__reactInternalInstance\$/.test(k)) return el[k];
      }
      return null;
    },
  };

  ZHS.Nav = Nav;
})();
