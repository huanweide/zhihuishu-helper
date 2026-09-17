/**
 * 求解层：双通道编排（题库优先 → LLM 兜底）
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  const U = ZHS.Util;

  // 本次运行内的答案缓存：题干 → 答案，避免重复请求
  const CACHE = new Map();
  const MAX_CACHE = 500;

  function cacheKey(question, options) {
    return ZHS.Util.normText(question) + '|' + (options || []).join('|').slice(0, 200);
  }

  function cacheGet(k) { return CACHE.get(k) || null; }
  function cacheSet(k, v) {
    if (CACHE.size >= MAX_CACHE) {
      // 简单淘汰：删最早的一个
      const first = CACHE.keys().next().value;
      CACHE.delete(first);
    }
    CACHE.set(k, v);
  }

  const Solver = {
    stats: { bank: 0, llm: 0, cache: 0, fail: 0 },

    /** 清空缓存 */
    clearCache() { CACHE.clear(); },

    /**
     * 主入口：求解一道题
     * @returns { answer, from, confidence }
     */
    async solve(q) {
      const cfg = ZHS.config;
      const question = U.normText(q.title || '');
      const options = q.options || [];
      const type = q.type || ZHS.Questions.TYPE.UNKNOWN;

      // 0. 命中缓存
      const key = cacheKey(question, options);
      const cached = cacheGet(key);
      if (cached) {
        ZHS.Log.info('答案命中缓存：' + cached.answer);
        this.stats.cache++;
        return cached;
      }

      const mode = cfg.answerMode || 'both';
      let result = null;

      // 1. 通道 A：题库
      if ((mode === 'bank' || mode === 'both') && cfg.bankEnabled && question) {
        try {
          const r = await ZHS.Bank.search(question, options, type);
          if (r && r.answer) {
            result = { answer: r.answer, from: 'bank:' + (r.from || 'unknown'), confidence: 'high' };
            this.stats.bank++;
          }
        } catch (e) {
          ZHS.Log.debug('题库查询异常：' + e.message);
        }
      }

      // 2. 通道 B：LLM 兜底
      if (!result && (mode === 'llm' || mode === 'both') && cfg.llmEnabled && cfg.llmKey && question) {
        try {
          const ans = await ZHS.LLM.vote(question, options, type, cfg.voteTimes);
          if (ans) {
            result = { answer: ans, from: 'llm', confidence: 'medium' };
            this.stats.llm++;
          }
        } catch (e) {
          ZHS.Log.warn('LLM 求解失败：' + e.message);
        }
      }

      // 3. 无 LLM Key 时：随机兜底（保证不卡住）
      if (!result && options.length) {
        const idx = Math.floor(Math.random() * options.length);
        const letter = String.fromCharCode(65 + idx);
        result = { answer: letter, from: 'random', confidence: 'low' };
        ZHS.Log.warn('无可用通道，随机选择 ' + letter);
      }

      if (!result) {
        this.stats.fail++;
        ZHS.Log.warn('本题无法求解：' + question.slice(0, 40));
        return null;
      }

      cacheSet(key, result);
      return result;
    },

    /** 批量求解（顺序，避免打爆接口） */
    async solveAll(list) {
      const out = [];
      for (const q of list) {
        // eslint-disable-next-line no-await-in-loop
        const r = await this.solve(q);
        out.push(Object.assign({}, q, { result: r }));
        // 每题之间小延迟，模拟人类思考
        const d = Number(ZHS.config.answerDelay) || 0;
        if (d > 0) await U.sleep(d * 1000 + Math.random() * 1000);
      }
      return out;
    },
  };

  ZHS.Solver = Solver;
})();
