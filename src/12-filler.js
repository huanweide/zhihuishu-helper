/**
 * 回填层：把答案填进页面控件，并校验是否真的填上
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod12_filler) return;
  ZHS.__mod12_filler = true;
  const U = ZHS.Util;

  const SEL_CLASSES = ['is-checked', 'checked', 'active', 'selected', 'choosed', 'chosen', 'current', 'highlight', 'picked'];

  function hasSelClass(el) {
    try {
      if (!el.classList) return false;
      for (const c of el.classList) { if (SEL_CLASSES.indexOf(String(c).toLowerCase()) >= 0) return true; }
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /** 严格选中判定（仅用于「已选中则跳过点击」的防取消守卫，避免被样式类误判） */
  function isClearlyChecked(el) {
    if (!el) return false;
    try {
      if (el.getAttribute && el.getAttribute('aria-checked') === 'true') return true;
      const input = el.querySelector ? el.querySelector('input') : (el.matches && el.matches('input') ? el : null);
      if (input && input.checked) return true;
      if (el.classList && (el.classList.contains('is-checked') || el.classList.contains('checked'))) return true;
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /** 宽口径选中判定（用于点击后自检：选中态可能表现为 aria/类名/子 input/子节点标记） */
  function isChecked(el) {
    if (!el) return false;
    try {
      if (isClearlyChecked(el)) return true;
      if (el.getAttribute) {
        if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true') return true;
      }
      if (hasSelClass(el)) return true;
      const p = el.closest && el.closest('.is-checked,.checked,.active,.selected,.choosed,.chosen,.current,.highlight');
      if (p) return true;
      if (el.querySelector) {
        const marked = el.querySelector('.is-checked,.checked,.active,.selected,.choosed,.chosen,.current,.highlight,[aria-checked="true"]');
        if (marked) return true;
      }
    } catch (e) { /* 忽略 */ }
    return false;
  }

  /**
   * 点击一个选项并确认选中（round-37：大幅强化，修「选项点击后仍未选中」）。
   * 对 AI助教/按钮式/div 式选项：逐个候选子目标 × 多种点击方式尝试，每步后自检 isChecked，
   * 一旦选中即收手；最后再上 input.checked 强制兜底。已明确选中的则跳过（防取消）。
   */
  async function clickOption(el) {
    if (!el) return false;
    if (isClearlyChecked(el)) {
      ZHS.Log.debug('选项已选中，跳过点击（防取消）');
      return true;
    }
    const sleep = (ms) => U.sleep(ms);
    const fireOne = async (t) => {
      if (!t) return false;
      try { if (U.realClickHuman) U.realClickHuman(t); else t.click(); } catch (e) { /* 忽略 */ }
      await sleep(160);
      if (isChecked(el)) return true;
      try { t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); } catch (e) { /* 忽略 */ }
      await sleep(120);
      return isChecked(el);
    };

    // 候选点击目标：从「最可能带处理器」到宽兜底
    const cands = [];
    const add = (s) => { try { const c = el.querySelector(s); if (c && cands.indexOf(c) < 0) cands.push(c); } catch (e) {} };
    add('.el-radio__input:not(.is-checked)');
    add('.el-checkbox__input:not(.is-checked)');
    add('.el-radio__inner'); add('.el-checkbox__inner');
    add('[class*="radio"]'); add('[class*="check"]'); add('[class*="circle"]'); add('[class*="icon"]');
    add('label'); add('input'); add('span'); add('a'); add('i');
    cands.push(el);   // 最后点本体

    for (const t of cands) {
      // eslint-disable-next-line no-await-in-loop
      if (await fireOne(t)) return true;
    }

    // 强制兜底：直接置 input.checked + 派发事件
    const input = el.querySelector ? el.querySelector('input') : (el.matches && el.matches('input') ? el : null);
    if (input) {
      try {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        try { if (input.click) input.click(); } catch (e) { /* 忽略 */ }
        await sleep(150);
        if (input.checked || isChecked(el)) return true;
      } catch (e) { /* 忽略 */ }
    }

    ZHS.Log.warn('选项点击后仍未选中');
    return false;
  }

  /** 填文本（填空/简答） */
  async function fillText(el, text) {
    if (!el) return false;
    const input = el.querySelector
      ? (el.querySelector('textarea, input[type="text"]') || (el.matches && el.matches('textarea, input[type="text"]') ? el : null))
      : null;
    if (!input) {
      ZHS.Log.warn('未找到可填写的输入框');
      return false;
    }
    try {
      input.focus();
      input.value = String(text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
      await U.sleep(150);
      return input.value === String(text);
    } catch (e) {
      ZHS.Log.warn('填写失败：' + e.message);
      return false;
    }
  }

  const Filler = {
    isChecked,
    /**
     * 点击一个选项（对外暴露）。
     * 原先 clickOption 只在模块内部使用，13-answerer.js 的 A/B 兜底路径
     * 只能用裸 `el.click()` —— 而 Element UI 的 .el-radio 外层 label 被点常常不生效，
     * 需要点内层 .el-radio__input + input.checked 兜底。统一走这里，避免两套点击逻辑漂移。
     */
    clickOption,

    /**
     * 按答案回填一道题
     * @returns { ok, filled, total }
     */
    async fill(q, result) {
      if (!result || !result.answer) return { ok: false, filled: 0, total: 0 };

      const type = q.type || ZHS.Questions.TYPE.UNKNOWN;
      const answer = result.answer;
      const list = q.elementList || [];

      // --- 判断 / 单选 / 多选：点选项 ---
      if (type === 'judgement') {
        // 按文本匹配 "对"/"错"
        let hit = null;
        for (const el of list) {
          const t = U.normText(el.innerText || el.textContent);
          if (answer === '对' && /^(对|正确|是|√|T\b|True)/i.test(t)) { hit = el; break; }
          if (answer === '错' && /^(错|错误|否|×|F\b|False)/i.test(t)) { hit = el; break; }
        }
        if (!hit) {
          // 兜底：索引 0=对，1=错
          hit = list[answer === '对' ? 0 : 1] || null;
        }
        if (hit) {
          const ok = await clickOption(hit);
          return { ok, filled: ok ? 1 : 0, total: 1 };
        }
        return { ok: false, filled: 0, total: 1 };
      }

      if (type === 'single' || type === 'multiple' || type === 'unknown') {
        const idxs = ZHS.Bank.toIndexes(answer);
        if (!idxs.length) {
          ZHS.Log.warn('答案无法转成选项索引：' + answer);
          return { ok: false, filled: 0, total: list.length };
        }
        let filled = 0;
        for (const i of idxs) {
          const el = list[i];
          if (!el) continue;
          // eslint-disable-next-line no-await-in-loop
          const ok = await clickOption(el);
          if (ok) filled++;
        }
        return { ok: filled > 0, filled, total: idxs.length };
      }

      // --- 填空 / 简答：填文本 ---
      if (type === 'completion' || type === 'qa') {
        const container = q.node || (list.length ? list[0].closest('.subject_node, .question-item') : null) || document;
        const ok = await fillText(container, answer);
        return { ok, filled: ok ? 1 : 0, total: 1 };
      }

      return { ok: false, filled: 0, total: 0 };
    },
  };

  ZHS.Filler = Filler;
})();
