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

  // round-45：模糊匹配阈值与最短题干长度。
  // 90% 是「改几个字/换标点」与「另一道题」之间的经验分界；题干短于 8 字
  // （归一化后）不模糊 —— 太短的题随便差两个字相似度就很高，容易张冠李戴。
  const FUZZY_THRESHOLD = 0.9;
  const FUZZY_MIN_LEN = 8;

  /**
   * round-45：模糊缓存匹配 —— 题干改几个字/换标点时复用已答过的答案。
   *
   * 背景（GitHub 生态调研结论）：题库/LLM 都是按次收费或限速的，而智慧树
   * 同一道题常以「换行/全半角/标点差异」的变体重复出现，精确缓存永远命不中，
   * 于是同一道题被反复请求。模糊匹配把这类变体收敛到一次请求。
   *
   * 安全约束（误命中代价 = 答错题，比多打一次请求严重得多）：
   *   · 选项串必须逐字相同（options 参与判等）—— 题干像但选项不同，是另一道题；
   *   · 相似度 ≥ 90% 且取最高分那一条的答案；
   *   · 归一化题干短于 8 字不模糊；
   *   · 总开关 fuzzyCache 关闭时完全不扫描。
   *
   * @returns {{r:object, score:number}|null}
   */
  function cacheFuzzy(question, options) {
    if (!ZHS.config.fuzzyCache) return null;
    const nq = U.normQuestion(question);
    if (nq.length < FUZZY_MIN_LEN) return null;
    const optKey = (options || []).join('|').slice(0, 200);
    let best = null;
    let bestScore = 0;
    for (const entry of CACHE.values()) {
      if (entry.o !== optKey) continue;              // 选项不一致 → 另一道题，绝不复用
      const score = U.similarity(nq, U.normQuestion(entry.q));
      if (score > bestScore) { bestScore = score; best = entry; }
    }
    if (best && bestScore >= FUZZY_THRESHOLD) {
      return { r: best.r, score: bestScore };
    }
    return null;
  }

  /**
   * v0.6.64：比较两个答案是否「一致」。答案可能是字母（A / A,C）或判定词（对/错）。
   * 用于 LLM 低置信时与离线启发式做第二意见交叉验证。
   * 字母答案按集合比较（A,C 与 C,A 视为一致）。
   */
  function _sameAnswer(a, b) {
    const norm = (s) => String(s == null ? '' : s).replace(/[\s,，、;；]/g, '').toUpperCase();
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const sa = na.split('').sort().join('');
    const sb = nb.split('').sort().join('');
    return sa === sb;
  }

  const Solver = {
    stats: { bank: 0, llm: 0, cache: 0, fuzzy: 0, heuristic: 0, random: 0, skipped: 0, fail: 0 },

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

      // M8 统计埋点：统一出口包装，成功/跳过/失败都记一笔。
      // 用可选调用 —— 统计模块未加载、或统计内部抛错，都绝不能影响答题主流程。
      const done = (r) => {
        try { if (ZHS.Stats) ZHS.Stats.record(question, r); } catch (e) { /* 统计失败不影响答题 */ }
        return r;
      };

      // 0. 命中缓存
      const key = cacheKey(question, options);
      const cached = cacheGet(key);
      if (cached) {
        ZHS.Log.info('答案命中缓存：' + cached.r.answer);
        this.stats.cache++;
        return cached.r;
      }

      // 0.5 round-45：模糊命中缓存（题干变体：改字/换标点/多空格）→ 复用答案，
      //     少打一次题库/模型请求。选项不一致不会误命中（见 cacheFuzzy 约束）。
      const fz = cacheFuzzy(question, options);
      if (fz) {
        ZHS.Log.info('答案模糊命中缓存（题干相似度 ' + Math.round(fz.score * 100) + '%），复用：' + fz.r.answer);
        this.stats.fuzzy++;
        // 顺便按新题干精确缓存一份，后续同变体直接精确命中，不再扫描。
        // 注意与精确命中保持一致：不走 done()（Stats.record）——
        // 这道题的「首次作答」在第一次 solve 时已经记过账了，此处只是复用。
        cacheSet(key, { q: question, o: (options || []).join('|').slice(0, 200), t: type, r: fz.r });
        return fz.r;
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
          // round-44：主观题（填空/问答，无选项）用单次生成 ask 而非 vote——
          // vote 的「多次投票取众数」对文本答案失效（每次生成都不同，票数都是 1，
          // 收敛不了又白费 3 次调用）；选择题才需要投票提稳。
          const isSubjective = (type === ZHS.Questions.TYPE.COMPLETION
            || type === ZHS.Questions.TYPE.QA) && !options.length;
          const ans = (isSubjective && ZHS.LLM.ask)
            ? await ZHS.LLM.ask(question, type)
            : await ZHS.LLM.vote(question, options, type, cfg.voteTimes);
          if (ans) {
            // v0.6.64：读投票置信（全票一致=high / 过半=medium / 分裂=low）。
            // 桩替换 vote() 时（单测）_lastMeta 不会被更新，置信停在 'none'——
            // 此时保持旧的 'medium' 默认，保证测试与既有调用方行为不变。
            const meta = (!isSubjective && ZHS.LLM.getLastVoteMeta) ? ZHS.LLM.getLastVoteMeta() : null;
            let confidence = (meta && meta.confidence && meta.confidence !== 'none')
              ? meta.confidence
              : 'medium';
            // 低置信交叉验证：LLM 票型分裂（没把握）时，用离线启发式做第二意见。
            //   · 两者一致 → 提升为 medium（两个独立信号互相印证，比单边分裂票可信）。
            //   · 不一致 → 仍采用 LLM（它是有依据的推理，不是瞎选），但保持 low 并告警，
            //     提醒用户提交前复核。
            // 关键：绝不因此引入随机兜底——「永不瞎选」由 gatedRandom(默认关) 把守，此处不动。
            if (meta && confidence === 'low' && options.length
              && ZHS.Heuristic && cfg.heuristicFallback !== false) {
              try {
                const h = ZHS.Heuristic.solve({ title: question, options, type });
                if (h && h.answer && _sameAnswer(h.answer, ans)) {
                  confidence = 'medium';
                  ZHS.Log.info('LLM 低置信但与离线启发式结论一致，置信提升为 medium：' + ans);
                } else if (h && h.answer) {
                  ZHS.Log.warn('LLM 低置信（票型分裂）且与启发式不一致（LLM=' + ans
                    + ' / 启发式=' + h.answer + '），仍采用 LLM，请提交前复核');
                }
              } catch (e) { /* 交叉验证失败不影响主流程 */ }
            }
            result = { answer: ans, from: 'llm', confidence, voteMeta: meta || null };
            this.stats.llm++;
          }
        } catch (e) {
          // ★ 关键：这里过去只打 e.message，把网络层/LLM 层挂的 e.hint 丢掉了，
          // 用户在真实答题路径上依旧只看到「请求失败」四个字。
          logChannelFail('LLM 求解失败', e);
        }
      }

      // 3. 通道 C：离线启发式（round-30 新增）
      //
      // 为什么必须补这一层，又为什么必须排在题库/LLM **之后**：
      //   用户确认的平台行为是「弹题随机弹出、必须答完才能关闭」——
      //   于是「答不上」的代价不是漏一题，而是**弹窗关不掉、挂机就此中断**。
      //   而题库要自建服务、LLM 要 API Key，两者都缺席是绝大多数用户的常态，
      //   旧实现在这时直接跳过 → 一题未答 → 卡死在这一节。
      //   启发式零外部依赖，至少能把「必卡死」变成「大概率答上并继续」。
      //   但它只是统计推断，质量低于题库/LLM，故只在它们都没结果时才出场，
      //   避免拉低已经配好通道的用户本来的答题质量。
      if (!result && options.length && ZHS.Heuristic && cfg.heuristicFallback !== false) {
        try {
          const h = ZHS.Heuristic.solve({ title: question, options, type });
          if (h && h.answer) {
            result = { answer: h.answer, from: 'heuristic', confidence: 'low' };
            this.stats.heuristic++;
            ZHS.Log.info('离线启发式给出答案 ' + h.answer + '（' + (h.reason || '') + '）');
          }
        } catch (e) {
          logChannelFail('启发式求解异常', e);
        }
      }

      // 4. 所有通道都没有时：
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
          return done(null);
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
        return done(null);
      }

      cacheSet(key, { q: question, o: (options || []).join('|').slice(0, 200), t: type, r: result });
      return done(result);
    },

    /** 批量求解（顺序，避免打爆接口） */
    async solveAll(list) {
      const out = [];
      for (const q of list) {
        // eslint-disable-next-line no-await-in-loop
        const r = await this.solve(q);
        out.push(Object.assign({}, q, { result: r }));
        // round-58：题间随机间隔（取配置区间 + 抖动），避免「匀速刷题」机器特征
        const cfg = ZHS.config;
        const min = Number(cfg.answerDelayMin || 2);
        const max = Number(cfg.answerDelayMax || 6);
        await U.sleep((min + Math.random() * (max - min)) * 1000);
      }
      return out;
    },
  };

  ZHS.Solver = Solver;
})();
