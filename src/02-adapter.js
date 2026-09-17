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
    },
  };

  /** 按域名推断候选适配器顺序 */
  function candidates() {
    const host = location.hostname;
    if (host === 'hike.zhihuishu.com') return [ADAPTERS.hike];
    if (host.includes('fusioncourseh5')) return [ADAPTERS.fusion, ADAPTERS.wisdom, ADAPTERS.legacy];
    if (host.includes('studywisdomh5')) return [ADAPTERS.card2025, ADAPTERS.fusion];
    if (host.includes('studyplush5')) return [ADAPTERS.wisdom, ADAPTERS.card2025];
    // studyvideoh5 及其他 → 智慧版优先，旧版兜底
    return [ADAPTERS.wisdom, ADAPTERS.legacy, ADAPTERS.fusion, ADAPTERS.card2025];
  }

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

    /** 条目是否已完成 */
    isFinished(el) {
      if (!el) return false;
      try {
        if (el.querySelector(this.adapter.finish)) return true;
      } catch (e) { /* 选择器兼容 */ }
      // 文本兜底
      const txt = U.normText(el.innerText || el.textContent);
      return txt.includes('已完成') || txt.includes('已学完');
    },

    /** 条目进度百分比 0-100 */
    progressOf(el) {
      if (!el) return 0;
      if (this.isFinished(el)) return 100;
      const ad = this.adapter;
      if (!ad.progress) return 0;
      const p = el.querySelector(ad.progress);
      if (!p) return 0;
      let raw = ad.progressAttr ? p.getAttribute(ad.progressAttr) : (p.innerText || p.textContent);
      raw = String(raw || '0').replace('%', '').trim();
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    },

    /** 找下一个未完成的条目 */
    findNext(fromEl) {
      const all = this.items();
      if (!all.length) return null;
      let startIdx = 0;
      if (fromEl) {
        const i = all.indexOf(fromEl);
        if (i >= 0) startIdx = i + 1;
      }
      // 优先当前项之后第一个未完成的
      for (let i = startIdx; i < all.length; i++) {
        if (!this.isFinished(all[i])) return all[i];
      }
      // 从头找（补漏）
      for (let i = 0; i < all.length; i++) {
        if (!this.isFinished(all[i])) return all[i];
      }
      return null;
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
})();
