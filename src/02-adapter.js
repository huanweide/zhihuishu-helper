/**
 * 适配层：自动识别智慧树页面版本，提供统一的目录访问接口
 *
 * 智慧树有 5 套并存的页面结构（wisdom / fusion / hike / legacy / card2025），
 * 本模块把它们统一成同一组方法，上层业务代码无需关心版本差异。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod02_adapter) return;
  ZHS.__mod02_adapter = true;
  const U = ZHS.Util;

  /**
   * 目录适配器定义
   * - item       章节条目选择器
   * - active     当前项选择器
   * - finish     完成标识选择器（存在即已完成）
   * - title      课时名选择器
   * - progress   进度值选择器（可选）
   * - progressAttr 进度属性名（有则读属性，无则读文本）
   */
  const ADAPTERS = {
    wisdom: {
      name: 'wisdom',
      label: '智慧版共享课',
      item: '.child-info.hasvideo',
      active: '.child-info.hasvideo.current',
      finish: '.child-check',
      title: '.child-name',
      progress: '[role="progressbar"][aria-valuenow]',
      progressAttr: 'aria-valuenow',
      container: '.chapter-tree-74',
      courseTitle: '.course-name',
      locked: '.lock-icon, .icon-lock, [class*="lock"]',
    },
    fusion: {
      name: 'fusion',
      label: 'AI助教翻转课',
      item: '.chapter-content-second',
      active: '.chapter-content-second.current',
      finish: '.finish-icon',
      title: '.item-name',
      container: '.chapter-content',
      courseTitle: '.course-name',
      locked: '[class*="lock"]',
    },
    hike: {
      name: 'hike',
      label: '新形态课',
      item: '.file-item',
      active: '.file-item.active',
      finish: '.icon-finish',
      title: 'span[title]',
      progress: '.rate',
      container: '.el-tree',
      courseTitle: '.course-name',
      locked: '.el-icon-lock, [class*="lock"]',
    },
    legacy: {
      name: 'legacy',
      label: '旧版共享课',
      item: '.clearfix.video',
      active: '.clearfix.video.current_play',
      finish: '.time_icofinish',
      title: '#lessonOrder',
      progress: '.progress-num',
      container: '.clearfix',
      courseTitle: '.source-name',
      locked: '[class*="lock"]',
    },
    card2025: {
      name: 'card2025',
      label: '2025新版卡片式',
      item: '[class*="card-container"]',
      active: '[class*="card-container"].active',
      finish: '.finished-icon',
      title: '.video-title, .common-text',
      container: '.section-item-collapse-info',
      courseTitle: '.header-title-wrap',
      locked: '[class*="lock"]',
    },
    // polymas 系（智慧树新形态教学中心，Vue3 + Aliplayer）
    polymas: {
      name: 'polymas',
      label: '智慧树·AI课程中心',
      item: '[class*="course-node"], [class*="chapter-item"], .catalog-item, [class*="lesson-item"]',
      active: '[class*="course-node"].active, [class*="chapter-item"].active, .catalog-item.active, [class*="lesson-item"].active',
      finish: '[class*="finish"], [class*="complete"], [class*="done"]',
      title: '[class*="title"], span[title]',
      progress: '[class*="progress"], [role="progressbar"]',
      container: '#main',
      courseTitle: '[class*="course-name"], [class*="title"]',
      locked: '[class*="lock"], [class*="disabled"]',
    },
  };

  /**
   * 通用兜底扫描器（适配器选择器全部落空时启用）
   *
   * 思路：不猜具体类名，而是从「结构特征」反推哪些元素像课程目录条目：
   *   1. 兄弟节点成群（≥3 个同构兄弟）→ 像列表
   *   2. 每个节点里有可读文本（课时名）
   *   3. 节点不是纯容器（自身文本占比不能太低，太高则是大容器）
   *   4. 优先取「文本长度适中（2~60 字）」且可点击的节点
   *
   * 这样即使 polymas 改版换类名，也能捞到目录。
   */
  function sniffItems() {
    const out = [];
    const seen = new Set();

    // 候选容器：页面上所有元素，按「子元素数量」筛出像列表的
    const all = document.querySelectorAll('div, li, a');
    const groups = new Map();   // key = 父节点，value = 子节点数组

    for (const el of all) {
      const parent = el.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(el);
    }

    for (const [, kids] of groups) {
      if (kids.length < 3) continue;                 // 少于 3 个不成列表
      // 同构判定：标签名 + class 主体一致
      const sig = (el) => el.tagName + '|' + String(el.className || '').split(/\s+/).slice(0, 2).join('.');
      const sigs = new Set(kids.map(sig));
      if (sigs.size > 2) continue;                   // 结构太杂，不像同级列表

      for (const el of kids) {
        if (seen.has(el)) continue;
        const txt = U.normText(el.innerText || el.textContent);
        if (!txt) continue;
        if (txt.length < 2 || txt.length > 80) continue;   // 太短不可能是课时名，太长是大容器
        // 排除明显是导航/表单的
        if (/登录|注册|首页|我的|设置|退出/.test(txt) && txt.length < 8) continue;
        seen.add(el);
        out.push(el);
      }
    }

    // 按 DOM 顺序返回，保证「下一节」的方向正确
    return out.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function candidates() {
    const host = location.hostname;
    if (host.includes('polymas.com')) return [ADAPTERS.polymas, ADAPTERS.hike, ADAPTERS.wisdom];
    if (host === 'hike.zhihuishu.com') return [ADAPTERS.hike, ADAPTERS.polymas];
    if (host.includes('fusioncourseh5')) return [ADAPTERS.fusion, ADAPTERS.wisdom, ADAPTERS.legacy];
    if (host.includes('studywisdomh5')) return [ADAPTERS.card2025, ADAPTERS.fusion];
    if (host.includes('studyplush5')) return [ADAPTERS.wisdom, ADAPTERS.card2025];
    // studyvideoh5（旧共享课学习页）→ 按侦察 VERSION_MAP 优先 legacy 结构（.clearfix.video / .time_icofinish），
    // wisdom（.child-info.hasvideo / .child-check）兜底。两者完成标记都走 isFinished 的通用兜底，
    // 无论平台用哪套 class 都能识别右侧栏对勾/完成标记。
    if (host.includes('studyvideoh5')) return [ADAPTERS.legacy, ADAPTERS.wisdom, ADAPTERS.fusion, ADAPTERS.card2025, ADAPTERS.polymas];
    // 其它域名 → 智慧版优先，旧版兜底
    return [ADAPTERS.wisdom, ADAPTERS.legacy, ADAPTERS.fusion, ADAPTERS.card2025, ADAPTERS.polymas];
  }

  /**
   * 条目状态枚举
   *   done   已完成
   *   undone 未完成（可点，需要看）
   *   locked 未解锁（点不了，前置没完成）
   *   na     不是可播放条目（纯目录/章节标题）
   */
  const STATUS = { DONE: 'done', UNDONE: 'undone', LOCKED: 'locked', NA: 'na' };

  /** 探测当前页面用哪套适配器 */
  function detect() {
    for (const ad of candidates()) {
      if (document.querySelector(ad.item)) {
        ZHS.state.siteVersion = ad.name;
        ZHS.Log.info('页面版本识别为：' + ad.label + ' (' + ad.name + ')');
        return ad;
      }
    }
    ZHS.state.siteVersion = 'unknown';
    ZHS.Log.warn('未能识别页面版本，将使用通用兜底策略');
    return ADAPTERS.wisdom; // 兜底
  }

  /**
   * 目录操作 API
   */
  const Catalog = {
    _ad: null,

    get adapter() {
      if (!this._ad) this._ad = detect();
      return this._ad;
    },

    /** 强制重新探测（SPA 切页后调用） */
    redetect() { this._ad = null; return this.adapter; },

    /** 课程唯一标识 */
    getCourseId() {
      return U.pick(
        {
          a: U.getUrlParam('recruitAndCourseId'),
          b: U.getUrlParam('courseId'),
          c: U.getUrlParam('recruitId'),
        },
        ['a', 'b', 'c'],
        null
      ) || (location.hash.match(/courseId[=\/](\w+)/) || [])[1] || 'unknown-course';
    },

    /** 课程名 */
    getCourseName() {
      const el = document.querySelector(this.adapter.courseTitle);
      return el ? U.normText(el.innerText || el.textContent) : '';
    },

    /** 所有章节条目 */
    items() {
      const list = Array.from(document.querySelectorAll(this.adapter.item));
      // hike 版过滤掉目录树中间节点（有子节点的不是叶子）
      if (this.adapter.name === 'hike') {
        return list.filter((el) => {
          const node = el.closest('.el-tree-node');
          if (!node) return true;
          const children = node.querySelector('.el-tree-node__children');
          return !children || children.children.length === 0;
        });
      }
      // 预设选择器全落空 → 启用通用兜底扫描（应对平台改版/新域名）
      if (!list.length) {
        const sniffed = sniffItems();
        if (sniffed.length) {
          if (!this._sniffed) {
            this._sniffed = true;
            ZHS.Log.warn('预设选择器未命中，已启用结构兜底扫描，捞到 ' + sniffed.length + ' 个候选条目');
          }
          return sniffed;
        }
      }
      return list;
    },

    /** 当前播放入的条目 */
    current() {
      const cur = document.querySelector(this.adapter.active);
      if (cur) return cur;
      // 兜底：用 lessonKey 文本匹配
      const key = ZHS.state.lessonKey;
      if (key) {
        return this.items().find((el) => this.itemTitle(el) === key) || null;
      }
      return null;
    },

    /** 取条目名称 */
    itemTitle(el) {
      if (!el) return '';
      const t = el.querySelector(this.adapter.title);
      if (t) {
        const attr = t.getAttribute('title');
        if (attr) return U.normText(attr);
        return U.normText(t.innerText || t.textContent);
      }
      // hike 版的 span[title]
      const span = el.querySelector('span[title]');
      if (span) return U.normText(span.getAttribute('title'));
      return U.normText(el.innerText || el.textContent).slice(0, 80);
    },

    /**
     * 条目是否已完成
     * 完成判定的「金标准」是平台在章节列表（用户侧栏/右侧栏）打的完成标记（对勾/已完成图标）。
     * 仅靠视频进度条判断会出问题：视频放完但平台进度条还停在 99% 时，会误判「没看完」→ 重播而非跳节。
     * 所以优先级：专属完成标记 > 通用完成标记（覆盖各版本 class 变体）> 文本"已完成/已学完" > 进度 100%。
     */
    isFinished(el) {
      if (!el) return false;
      const ad = this.adapter;
      try {
        // 1. 适配器专属完成标记（如 wisdom 的 .child-check / legacy 的 .time_icofinish）
        if (ad.finish && el.querySelector(ad.finish)) return true;
      } catch (e) { /* 选择器兼容 */ }
      // 2. 通用完成标记：各版本对勾/完成图标的 class 变体（finish/done/complete/learned/studied/checkmark 等）
      try {
        if (el.querySelector('[class*="finish"], [class*="done"], [class*="complete"], [class*="learned"], [class*="studied"], [class*="checkmark"], [class*="is-finish"]')) {
          return true;
        }
      } catch (e) { /* 选择器兼容 */ }
      // 3. 子元素文本兜底（有时完成标记是「已学完」三个字而非图标）
      const txt = U.normText(el.innerText || el.textContent);
      if (/(已完成|已学完|已学习|学完|已看完|已学|100\s*%)/.test(txt)) return true;
      // 4. 进度条达到 100% 也算完成（部分页面没有完成图标）
      // 注意：这里直接读进度值，不能调 progressOf（它会反向调 isFinished，形成死递归）
      if (ad.progress && this._readProgress(el) >= 100) return true;
      return false;
    },

    /** 纯读进度值（不做完成态判断，避免与 isFinished 相互递归） */
    _readProgress(el) {
      const ad = this.adapter;
      if (!el || !ad.progress) return 0;
      let p = null;
      try { p = el.querySelector(ad.progress); } catch (e) { return 0; }
      if (!p) return 0;
      let raw = ad.progressAttr ? p.getAttribute(ad.progressAttr) : (p.innerText || p.textContent);
      raw = String(raw || '0').replace('%', '').trim();
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    },

    /** 条目是否未解锁 */
    isLocked(el) {
      if (!el) return false;
      const ad = this.adapter;
      // 1. 元素自身或内部有锁图标
      if (ad.locked) {
        try {
          if (el.matches && el.matches(ad.locked)) return true;
          if (el.querySelector(ad.locked)) return true;
        } catch (e) { /* 忽略非法选择器 */ }
      }
      // 2. disabled / 不可点 属性
      if (el.getAttribute) {
        if (el.getAttribute('disabled') != null) return true;
        if (el.getAttribute('aria-disabled') === 'true') return true;
        if (el.getAttribute('data-locked') === 'true') return true;
      }
      // 3. 样式：pointer-events:none 或 明显的禁用态类名
      try {
        const cls = String(el.className || '');
        if (/\b(disabled|is-disabled|lock|locked|forbid|no-permission)\b/i.test(cls)) return true;
      } catch (e) { /* 忽略 */ }
      // 4. 文本兜底
      const txt = U.normText(el.innerText || el.textContent);
      if (/未解锁|不可学习|暂无权限/.test(txt)) return true;
      return false;
    },

    /**
     * 三态判定
     * @returns 'done' | 'undone' | 'locked' | 'na'
     */
    statusOf(el) {
      if (!el) return STATUS.NA;
      if (this.isFinished(el)) return STATUS.DONE;
      if (this.isLocked(el)) return STATUS.LOCKED;
      // 有标题且能点到 → 未完成
      const t = this.itemTitle(el);
      if (!t) return STATUS.NA;
      return STATUS.UNDONE;
    },

    /**
     * 全量扫描：给每个条目打状态（面板/报告用）
     * @returns [{ index, title, status, progress, element }]
     */
    scan() {
      return this.items().map((el, i) => ({
        index: i,
        title: this.itemTitle(el),
        status: this.statusOf(el),
        progress: this.progressOf(el),
        element: el,
      }));
    },

    /** 统计三态数量 */
    breakdown() {
      const list = this.scan();
      const out = { total: 0, done: 0, undone: 0, locked: 0, na: 0 };
      for (const it of list) {
        out.total++;
        out[it.status] = (out[it.status] || 0) + 1;
      }
      out.percent = out.total ? Math.round((out.done / out.total) * 100) : 0;
      out.allDone = out.total > 0 && out.undone === 0;
      return out;
    },

    /** 条目进度百分比 0-100（优先读真实进度条，已完成直接 100） */
    progressOf(el) {
      if (!el) return 0;
      if (this.isFinished(el)) return 100;
      return this._readProgress(el);
    },

    /**
     * 找下一个「未完成且未锁」的条目
     * 策略：当前位置往后找 → 找不到则从头补漏
     * 跳过 done（已完成）和 locked（未解锁，点了也没用）
     */
    findNext(fromEl) {
      const all = this.items();
      if (!all.length) return null;

      const pickable = (el) => this.statusOf(el) === STATUS.UNDONE;

      let startIdx = 0;
      if (fromEl) {
        const i = all.indexOf(fromEl);
        if (i >= 0) startIdx = i + 1;
      }
      // 1. 当前之后
      for (let i = startIdx; i < all.length; i++) {
        if (pickable(all[i])) return all[i];
      }
      // 2. 从头补漏（前面可能有跳过的）
      for (let i = 0; i < Math.min(startIdx, all.length); i++) {
        if (pickable(all[i])) return all[i];
      }
      return null;
    },

    /** 所有待学条目（未完成 + 未锁） */
    pending() {
      return this.items().filter((el) => this.statusOf(el) === STATUS.UNDONE);
    },

    /** 找指定名称的条目 */
    findByName(key) {
      if (!key) return null;
      const all = this.items();
      // 精确匹配优先
      let hit = all.find((el) => this.itemTitle(el) === key);
      if (hit) return hit;
      // 包含匹配兜底
      hit = all.find((el) => this.itemTitle(el).includes(key) || key.includes(this.itemTitle(el)));
      return hit || null;
    },

    /** 点击条目（真正触发切换） */
    click(el) {
      if (!el) return false;
      // 智慧树用 a 标签承载跳转，优先点内部可点击元素
      const clickable = el.querySelector('a, .child-name, .item-name, .file-name, span[title]') || el;
      try {
        clickable.click();
        return true;
      } catch (e) {
        ZHS.Log.error('点击章节失败：', e.message);
        return false;
      }
    },

    /** 全部章节完成度统计 */
    stats() {
      const all = this.items();
      const done = all.filter((el) => this.isFinished(el)).length;
      return { total: all.length, done, percent: all.length ? Math.round((done / all.length) * 100) : 0 };
    },
  };

  ZHS.Catalog = Catalog;
  ZHS.STATUS = STATUS;
})();
