/**
 * 求解层：双通道编排（题库优先 → LLM 兜底）
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod11_solver) return;
  ZHS.__mod11_solver = true;
  const U = ZHS.Util;

  // 本次运行内的答案缓存：题干 → 答案，避免重复请求
  const CACHE = new Map();
  const MAX_CACHE = 500;

  // 「无可用答题通道」提示的节流间隔（毫秒）。
  // 作业页可能一次跑 20 题，每题弹一次提示会把面板刷爆、
  // 而且后一条会挤掉前一条，用户反而啥也看不清。60 秒最多提示一次。
  const NO_CHANNEL_ALERT_COOLDOWN_MS = 60000;
  let noChannelAlertAt = 0;

  /**
   * 通道异常日志（带节流 + 透传解决方案）。
   *
   * 【2026-09-20 修复 · round-24 漏网】上一轮在网络层和 LLM 层都挂上了 `e.hint`
   * （可操作的解决建议），但这里 catch 时只取了 `e.message` —— **hint 在求解层断裂**：
   * 面板「测试连接」那条路能看到建议，而用户真正刷题时的答题路径却看不到。
   * 只验证其中一条路是假判据，故本轮补上透传。
   *
   * 节流原因：作业页一次可能连跑 20 题，同一个故障刷 20 遍会把面板挤空，
   * 后一条顶掉前一条，用户反而一条也看不清。同类故障 30 秒最多报一次。
   */
  const _errAt = Object.create(null);
  function logChannelFail(kind, e) {
    const err = e || {};
    const key = kind + '|' + (err.code || '') + '|' + (err.message || '');
    const now = Date.now();
    if (_errAt[key] && now - _errAt[key] < 30000) return;
    _errAt[key] = now;
    const hint = err.hint ? '｜建议：' + err.hint : '';
    ZHS.Log.warn(kind + '：' + (err.message || '未知错误') + hint);
  }

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
    stats: { bank: 0, llm: 0, cache: 0, random: 0, skipped: 0, fail: 0 },

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
          // 过去是 debug 级：题库挂了用户完全不知情，只看到「题没答上」。
          // 提级到 warn 并走统一失败日志（含节流 + 解决方案透传）。
          logChannelFail('题库查询异常', e);
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
          // ★ 关键：这里过去只打 e.message，把网络层/LLM 层挂的 e.hint 丢掉了，
          // 用户在真实答题路径上依旧只看到「请求失败」四个字。
          logChannelFail('LLM 求解失败', e);
        }
      }

      // 3. 无可用通道时：
      //    默认【不蒙】——瞎选答案会污染成绩且部分课程不允许回退重做，
      //    宁可漏答（可事后补答）也不主动制造错答。
      //    用户显式开启 gatedRandom 才允许兜底蒙一个（保证流程不卡住）。
      if (!result && options.length) {
        if (!cfg.gatedRandom) {
          this.stats.skipped++;
          ZHS.Log.warn('无可用答题通道，按配置跳过本题（未配置 LLM Key / 题库不可用时发生）');
          // 节流：60 秒内最多提示一次，避免作业页连续跳题时刷屏
          const now = Date.now();
          if (now - noChannelAlertAt > NO_CHANNEL_ALERT_COOLDOWN_MS) {
            noChannelAlertAt = now;
            if (ZHS.panel) {
              ZHS.panel.alert('未配置答题通道，已跳过多题未作答。请在设置页配置大模型密钥并点「保存」，或关闭「自动答题」', 'warn', 10000);
            }
          }
          return null;
        }
        const idx = Math.floor(Math.random() * options.length);
        const letter = String.fromCharCode(65 + idx);
        result = { answer: letter, from: 'random', confidence: 'low' };
        this.stats.random++;
        ZHS.Log.warn('已启用「随机兜底」，本次为随机选择 ' + letter);
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
