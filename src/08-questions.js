/**
 * 题目采集层：从三种场景抽取结构化题目
 *
 * 场景 A：课中弹题   #playTopic-dialog
 * 场景 B：共享课作业  .subject_node
 * 场景 C：hike 作业/考试  .q_main
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod08_questions) return;
  ZHS.__mod08_questions = true;
  const U = ZHS.Util;

  /** 内部题型枚举 */
  const TYPE = {
    SINGLE: 'single',       // 单选
    MULTIPLE: 'multiple',   // 多选
    JUDGEMENT: 'judgement', // 判断
    COMPLETION: 'completion', // 填空
    QA: 'qa',               // 简答
    UNKNOWN: 'unknown',
  };

  /** 题库 API 的 type 编码：0单选 1多选 2填空 3判断 4问答 */
  const BANK_TYPE = {
    [TYPE.SINGLE]: 0,
    [TYPE.MULTIPLE]: 1,
    [TYPE.COMPLETION]: 2,
    [TYPE.JUDGEMENT]: 3,
    [TYPE.QA]: 4,
    [TYPE.UNKNOWN]: 0,
  };

  /** 文本 → 内部题型 */
  function guessType(text, options) {
    const t = String(text || '');
    if (t.includes('多选')) return TYPE.MULTIPLE;
    if (t.includes('单选')) return TYPE.SINGLE;
    if (t.includes('判断')) return TYPE.JUDGEMENT;
    if (t.includes('填空')) return TYPE.COMPLETION;
    if (t.includes('简答') || t.includes('问答')) return TYPE.QA;

    // 从选项文本推断：只有"对/错"就是判断题
    if (options && options.length === 2) {
      const joined = options.join('');
      if (/^(对|正确|是|T|True)/i.test(joined) && /(错|错误|否|F|False)/i.test(joined)) {
        return TYPE.JUDGEMENT;
      }
    }
    // 选项 4 个以上且文本以 A. B. 开头 → 单选兜底
    if (options && options.length >= 2) return TYPE.SINGLE;
    return TYPE.UNKNOWN;
  }

  /** 安全取元素文本：优先 innerText，降级 textContent（jsdom 不实现 innerText） */
  function readText(el) {
    if (!el) return '';
    const t = el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent;
    return U.normText(t || '');
  }

  /** 图片延迟加载处理：智慧树把真实地址放 data-src */
  function hydrateImages(root) {
    if (!root) return;
    const imgs = root.querySelectorAll('img');
    for (const img of imgs) {
      if (img.dataset && img.dataset.src && !img.src) {
        img.src = img.dataset.src;
      } else if (img.dataset && img.dataset.src && img.src !== img.dataset.src) {
        img.src = img.dataset.src;
      }
    }
  }

  /** 判断元素内是否有图片（用于决定要不要 OCR） */
  function hasImage(root) {
    if (!root) return false;
    return root.querySelectorAll('img').length > 0;
  }

  /**
   * 场景 A：课中弹题
   * 结构：#playTopic-dialog 内 .el-pager .number 分页
   */
  const DialogQuestions = {
    /** 弹题容器（考虑 iframe 情况） */
    root() {
      let r = document.querySelector('#playTopic-dialog');
      if (r && U.isStructurallyVisible(r)) return r;
      // 关键坑：弹题可能渲染在 iframe 里
      const iframe = document.getElementById('tmDialog_iframe');
      if (iframe) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          const inner = doc && doc.querySelector('#playTopic-dialog, .topic-title, ul');
          if (inner) return doc;
        } catch (e) {
          ZHS.Log.debug('弹题 iframe 跨域，无法访问');
        }
      }
      return null;
    },

    /** 是否出现弹题 */
    present() {
      const r = this.root();
      if (!r) return false;
      return !!r.querySelector('.topic-item, .topic-title, ul li');
    },

    /**
     * 采集所有分页的题目
     * 返回 [{ title, options[], type, pageIndex, elements }]
     */
    collect() {
      const root = this.root();
      if (!root) return [];

      const pages = Array.from(root.querySelectorAll('.el-pager .number'));
      const results = [];

      // 题干（弹题通常所有分页共享一个题干区，或每页一个）
      const titleEl = root.querySelector('.topic-title, .topic-content, .topic-question');
      const sharedTitle = readText(titleEl);

      if (pages.length) {
        // 有分页：逐页收集（注意：这里只读文本，切换分页由答题器负责）
        pages.forEach((p, i) => {
          results.push({
            title: sharedTitle,
            options: [],
            type: TYPE.UNKNOWN,
            pageIndex: i,
            totalPages: pages.length,
            elements: { page: p, root },
            raw: '',
          });
        });
      } else {
        // 无分页：单题
        const options = Array.from(root.querySelectorAll('ul .topic-item, .topic .radio ul > li'));
        results.push({
          title: sharedTitle,
          options: options.map((o) => readText(o)),
          type: guessType(sharedTitle, options.map((o) => readText(o))),
          pageIndex: 0,
          totalPages: 1,
          elements: { page: null, root },
          raw: '',
        });
      }
      return results;
    },

    /** 读取当前分页的完整题目（切页后调用） */
    readCurrent(root) {
      const r = root || this.root();
      if (!r) return null;
      const titleEl = r.querySelector('.topic-title, .topic-content, .topic-question');
      const title = readText(titleEl);
      // 选项：优先 ul .topic-item，兜底 radio 列表
      let optionEls = Array.from(r.querySelectorAll('ul .topic-item'));
      if (!optionEls.length) {
        optionEls = Array.from(r.querySelectorAll('.topic .radio ul > li'));
      }
      const options = optionEls.map((o) => readText(o));
      const typeText = readText(r.querySelector('.topic-type, .subject_type'));
      return {
        title,
        options,
        type: guessType(typeText + ' ' + title, options),
        elementList: optionEls,
      };
    },

    /** 关闭弹题 */
    close() {
      const r = this.root();
      if (!r) return false;

      // 按优先级找关闭按钮（智慧树弹题的关闭控件在多个位置出现过）
      const CANDIDATES = [
        '#playTopic-dialog .close-btn',
        '#playTopic-dialog .el-dialog__close',
        '#playTopic-dialog .close',
        '#playTopic-dialog .topic-close',
        '.close-btn',
        '.el-dialog__close',
        '.topic-close',
      ];

      for (const sel of CANDIDATES) {
        let btn = null;
        try { btn = r.querySelector ? r.querySelector(sel) : null; } catch (e) { /* 越界忽略 */ }
        // root 可能是 document（iframe 场景），此时从全局找
        if (!btn && r !== document) {
          try { btn = document.querySelector(sel); } catch (e) { /* 忽略 */ }
        }
        if (btn) {
          try {
            btn.click();
            ZHS.Log.info('已点击关闭按钮：' + sel);
            return true;
          } catch (e) {
            ZHS.Log.debug('关闭按钮点击异常：' + e.message);
          }
        }
      }

      // 兜底 1：从弹题容器往上找「关闭/确定/提交/我知道了」文本按钮
      const scope = (r.querySelectorAll ? r : document);
      const btns = Array.from(scope.querySelectorAll('button, a, span, div'))
        .filter((el) => {
          const t = U.normText(el.innerText || el.textContent || '');
          return t === '关闭' || t === '确定' || t === '提交' || t === '我知道了' || t === '知道了' || t === '继续学习';
        });
      if (btns.length) {
        // 优先最内层（文本最短的）
        btns.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
        try {
          btns[0].click();
          ZHS.Log.info('已点击文本关闭按钮：' + U.normText(btns[0].innerText || ''));
          return true;
        } catch (e) { /* 继续兜底 */ }
      }

      // 兜底 2：Esc
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      ZHS.Log.debug('未找到关闭按钮，已派发 Esc');
      return false;
    },

    /** 弹题是否仍存在 */
    stillPresent() {
      return this.present();
    },
  };

  /**
   * 场景 B：共享课作业页（.subject_node）
   */
  const HomeworkQuestions = {
    present() {
      return !!document.querySelector('.subject_node, .question-topic');
    },

    /** 采集所有题目 */
    collect() {
      const nodes = Array.from(document.querySelectorAll('.subject_node'));
      if (!nodes.length) {
        // 兜底：.question-topic 直接作为题目
        const topics = Array.from(document.querySelectorAll('.question-topic'));
        return topics.map((t, i) => this._fromTopic(t, i));
      }
      return nodes.map((n, i) => this._fromNode(n, i));
    },

    _fromNode(node, index) {
      hydrateImages(node);

      const titleEl = node.querySelector('.question-topic, .subject_title, .topic-title');
      let title = readText(titleEl);
      // 图片在题干里但无文字 → 标记需要 OCR
      const needOcr = !title && hasImage(node);

      const typeText = readText(node.querySelector('.subject_type, .question-type'));

      const optionEls = Array.from(node.querySelectorAll('.nodeLab, .label.clearfix, label'));
      const options = optionEls.map((o) => {
        const txt = readText(o);
        // 去掉开头的 "A. " 之类前缀（保留原始，回填需要）
        return txt;
      });

      return {
        title,
        options,
        type: guessType(typeText, options),
        index,
        needOcr,
        elementList: optionEls,
        node,
        raw: readText(node).slice(0, 500),
      };
    },

    _fromTopic(topicEl, index) {
      hydrateImages(topicEl);
      const node = topicEl.closest('.subject_node') || topicEl.parentElement;
      const title = readText(topicEl);
      const optionEls = node ? Array.from(node.querySelectorAll('label, .nodeLab')) : [];
      const options = optionEls.map((o) => readText(o));
      return {
        title,
        options,
        type: guessType(title, options),
        index,
        needOcr: false,
        elementList: optionEls,
        node,
        raw: title,
      };
    },

    /** 下一题按钮 */
    nextButton() {
      return document.querySelector('.next-topic.next-t, .next-topic');
    },
  };

  /**
   * 场景 C：hike 作业/考试（.q_main）
   */
  const HikeQuestions = {
    present() {
      return !!document.querySelector('.q_main, .question-topic');
    },

    collect() {
      const root = document.querySelector('.q_main') || document;
      const nodes = Array.from(root.querySelectorAll('.question-topic, .question-item'));
      return nodes.map((n, i) => {
        const container = n.closest('.question-item, .q_item, .question') || n.parentElement;
        hydrateImages(n);
        const title = readText(n);
        const typeText = container ? ((container.querySelector('.question_score, .question-type') || {}).textContent || '') : '';
        const optionEls = container ? Array.from(container.querySelectorAll('label')) : [];
        const options = optionEls.map((o) => readText(o));
        return {
          title,
          options,
          type: guessType(typeText + ' ' + title, options),
          index: i,
          needOcr: false,
          elementList: optionEls,
          node: container,
          raw: title,
        };
      });
    },
  };

  const Questions = {
    TYPE,
    BANK_TYPE,
    guessType,
    hydrateImages,
    hasImage,
    Dialog: DialogQuestions,
    Homework: HomeworkQuestions,
    Hike: HikeQuestions,

    /** 自动判断当前是什么场景 */
    scene() {
      if (DialogQuestions.present()) return 'dialog';
      if (/dohomework|doexamination/.test(location.href)) return 'homework';
      if (/answer-homework|answer-exam/.test(location.href)) return 'hike';
      if (HomeworkQuestions.present()) return 'homework';
      if (HikeQuestions.present()) return 'hike';
      return null;
    },

    /** 按场景采集 */
    collect() {
      const s = this.scene();
      if (s === 'dialog') return DialogQuestions.collect();
      if (s === 'homework') return HomeworkQuestions.collect();
      if (s === 'hike') return HikeQuestions.collect();
      return [];
    },
  };

  ZHS.Questions = Questions;
})();
