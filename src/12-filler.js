/**
 * 回填层：把答案填进页面控件，并校验是否真的填上
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  const U = ZHS.Util;

  /** 判断选项元素是否处于选中态 */
  function isChecked(el) {
    if (!el) return false;
    // 1. 元素自身带 is-checked / checked 类
    if (el.classList && (el.classList.contains('is-checked') || el.classList.contains('checked') || el.classList.contains('active'))) {
      return true;
    }
    // 2. 内部 input
    const input = el.querySelector && el.querySelector('input');
    if (input && input.checked) return true;
    // 3. 祖先有 is-checked
    const p = el.closest && el.closest('.is-checked, .checked');
    if (p) return true;
    return false;
  }

  /** 点击一个选项（多重兜底，且避免重复点击导致取消） */
  async function clickOption(el) {
    if (!el) return false;
    if (isChecked(el)) {
      ZHS.Log.debug('选项已选中，跳过点击（防取消）');
      return true;
    }

    // 优先点未选中的内层（ocsjs 的成熟做法）
    const inner = el.querySelector('.el-radio__input:not(.is-checked), .el-checkbox__input:not(.is-checked)');
    const target = inner || el;

    try {
      target.click();
    } catch (e) {
      ZHS.Log.debug('点击异常，改用事件派发：' + e.message);
      try {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } catch (e2) { /* 忽略 */ }
    }

    await U.sleep(200);
    if (isChecked(el)) return true;

    // 兜底 1：点内层可见元素
    const innerVisible = el.querySelector('.el-radio__inner, .el-checkbox__inner, .radio, .checkbox');
    if (innerVisible) {
      try { innerVisible.click(); } catch (e) { /* 忽略 */ }
      await U.sleep(200);
      if (isChecked(el)) return true;
    }

    // 兜底 2：直接改 input.checked + 派发事件
    const input = el.querySelector('input');
    if (input) {
      try {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await U.sleep(100);
        if (input.checked) return true;
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
