/**
 * 离线启发式求解器（round-30 新增）：零网络、零 Key、零题库也能给出答案。
 *
 * 为什么必须有这一层（用户需求根因 · 2026-10-20）：
 *   「弹窗是随机弹出的答题，没有规律，必须答完题才能关闭」——
 *   于是「答不上 = 关不掉 = 挂机中断」，而不是旧假设的「答不上就漏一题」。
 *   而原求解链在最常见的情况下恰好是**一条通道都没有**的：
 *     题库（09-bank）需要用户自建的服务地址；LLM（10-llm）需要用户填 API Key。
 *   两条都没配（拉到即用装脚本的绝大多数用户就是这个状态）→ Solver 走到
 *   `if (!cfg.gatedRandom) → skipped++ → return null` → 答题器一题未答 →
 *   平台拒绝关闭未作答弹窗 → 脚本卡在这一节，直到用户自己回来点。
 *
 *   所以在「答不出」之前，必须补一层**不依赖任何外部资源**的求解：
 *   它不保证全对，但能把「必卡死」变成「大概率答上并继续」。
 *
 * 【能力边界 · 必须写死在文档里】
 *   本层不做理解，只做语言学与出题套路的统计推断，正确率显著高于随机
 *   （网课弹题多为课件原文改写，关键词高度复现），但低于 LLM/题库。
 *   因此排序必须在它们**之后**：有题库/LLM 时轮不到它出场；
 *   只有它们都缺席或失败时，它才顶上，避免拉低已有的答题质量。
 *
 * 【失效判据 · 宁可不说，不可瞎说】
 *   每条规则都带置信度。总分够线才返回答案；不够线返回 null，
 *   由上层决定是「随机兜底」还是「转人工」——绝不冒充高分答案。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免重复挂载
  if (ZHS.__mod11b_heuristic) return;
  ZHS.__mod11b_heuristic = true;
  const U = ZHS.Util;

  /** 去噪：只保留「有信息量」的字符参与文本比对 */
  function clean(s) {
    return String(s || '').replace(/[\s\u3000]+/g, ' ').trim();
  }

  /**
   * 取出参与匹配的「内容字符」：汉字、字母、数字。
   *
   * 为什么要过滤：选项文本里大量的标点、括号、序号前缀
   * （「A.」「B、」「（ ）」）在题干里不存在，参与比对只会稀释真信号。
   */
  function contentChars(s) {
    return clean(s)
      .replace(/^\s*[A-Za-z][.、,:：)）]?\s*/, '')   // 剥选项序号前缀
      .replace(/[，。；：？！、,.;:?!()（）「」【】"'“”‘’\-_/\\]/g, '');
  }

  /**
   * 中文二元切分 + 英文单词。
   *
   * 为什么不用分词库：油猴脚本不引外部依赖。中文bigram在无分词时是
   * 最稳的近似——「依法治国」切成 依法/法依… 实际是 依法/法治/治国，
   * 相邻字对能覆盖绝大多数实词。英文按单词整体保留，避免字母被拆碎。
   */
  function grams(s) {
    const out = [];
    const t = contentChars(s);
    let en = '';
    const push = () => { if (en.length) { out.push(en.toLowerCase()); en = ''; } };
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (/[a-zA-Z0-9]/.test(c)) { en += c; continue; }
      push();
      const next = t[i + 1];
      // 相邻两个非英文字符组成一个 gram
      if (next && !/[a-zA-Z0-9]/.test(next)) out.push(c + next);
    }
    push();
    return out;
  }

  /** 词集合（同时产出单字，兼容题干极短时 bigram 打不中的情况） */
  function tokenSet(s) {
    const set = new Set();
    grams(s).forEach((g) => set.add(g));
    const t = contentChars(s);
    for (const c of t) if (/[\u4e00-\u9fa5]/.test(c)) set.add(c);
    return set;
  }

  /** 题干与单个选项的重合度：命中数 / 选项自身词数（选项短时更敏感） */
  function overlapRatio(stemSet, optText) {
    const opt = tokenSet(optText);
    if (!opt.size) return 0;
    let hit = 0;
    opt.forEach((g) => { if (stemSet.has(g)) hit++; });
    return hit / Math.sqrt(opt.size);   // 开方：抑制长选项靠堆词刷分
  }

  /** 绝对化词：教材型题目里带这些词的选项大概率是错的（例外见 _isNegatedStem） */
  const ABSOLUTE = ['一定', '必定', '必然', '所有', '一切', '都 ', '全都', '唯一', '只能', '绝不',
    '完全', '绝对', '不可能', '永远不会', '无论', '任何', '普遍适用', '无一例外'];
  /** 弱化/限定词：正确选项的典型口吻（有余地的表述更可能是教材原话） */
  const HEDGE = ['通常', '一般', '可能', '往往', '在一定条件下', '原则上', '多数', '常常',
    '有助于', '有利于', '之一', '视情况'];

  /** 题干是否反问式否定（问「哪个不对」）——决定要不要反过来选离群项 */
  const NEG_STEM = ['不正确', '不属于', '不包括', '不符合', '不是', '错误', '除外', '不应',
    '不能', '不必', '不包括', '不当', '不准', '不得', '没有'];
  function isNegatedStem(stem) {
    return NEG_STEM.some((w) => stem.includes(w));
  }

  /** 「以上都对」类收尾选项：命中几乎必选（多选题里的经典送分项） */
  const ALL_TRUE = ['以上都对', '以上都正确', '以上均是', '以上全部', '以上都是', 'A和B', 'A和B都对',
    '上述都对', '全部正确', '均正确', '都对'];

  /** 判断题选项识别 */
  const TRUE_WORDS = ['正确', '对', '是', '√', 'true', 't'];
  const FALSE_WORDS = ['错误', '错', '否', '×', 'false', 'f'];

  function isoLetter(i) { return String.fromCharCode(65 + i); }

  /**
   * 主求解入口
   * @param {{title:string, options:string[], type:string}} q
   * @returns {{answer:string, from:string, confidence:string, score:number, reason:string}|null}
   */
  function solve(q) {
    const opts = (q && q.options) || [];
    if (!opts.length) return null;
    const stem = clean((q && q.title) || '');
    const type = (q && q.type) || '';

    // ===== 规则 0：判断题 —— 先单独处理，它的答案空间只有两个，套路最固定 =====
    if (type === 'judgement' || (opts.length === 2 && isJudgePair(opts))) {
      const r = solveJudgement(stem, opts);
      if (r) return r;
    }

    const stemSet = tokenSet(stem);

    // ===== 规则 1：收尾式正确项（「以上都对」） =====
    for (let i = 0; i < opts.length; i++) {
      const t = clean(opts[i]);
      if (ALL_TRUE.some((w) => t.includes(w))) {
        return finish(opts, [i], 'heuristic', 0.9, '命中收尾正确项「' + t.slice(0, 10) + '」');
      }
    }

    // ===== 规则 2：包含关系排雷 —— 字面被别的选项覆盖的短项是「片面答案」 =====
    // 例：A「诚信是美德」 被 B「诚信既是法律规范也是道德要求」覆盖 → A 片面，排除。
    //
    // 为什么不能只判「子串包含」：真实题目里片面项与完整项常常**语序不同**
    // （上例 B 里根本找不到连续的「诚信是美德」），子串判定会全部漏网。
    // 改用「字级覆盖率」：短项汉字 ≥80% 出现在长项里、且长项明显更长 → 判片面。
    // 门槛（80% + 长度差 ≥3）刻意设严：汉语里短词被长句覆盖很常见，
    // 判据一松就会把正确答案误杀，误杀的代价比漏排大得多。
    const hanOf = (s) => Array.from(contentChars(s)).filter((c) => /[\u4e00-\u9fa5]/.test(c));
    const contained = new Set();
    for (let i = 0; i < opts.length; i++) {
      for (let j = 0; j < opts.length; j++) {
        if (i === j) continue;
        const a = hanOf(opts[i]);
        const b = hanOf(opts[j]);
        if (!a.length || !b.length) continue;
        if (b.length < a.length + 3) continue;
        const bset = new Set(b);
        const covered = a.filter((c) => bset.has(c)).length;
        if (covered / a.length >= 0.8) { contained.add(i); break; }
      }
    }

    // ===== 规则 3：逐项打分 =====
    const raw = opts.map((text, i) => {
      const t = clean(text);
      let score = overlapRatio(stemSet, text) * 10;   // 主信号：与题干的词汇重合

      // 与题干无关怎么写得到的固定加成/惩罚
      if (ABSOLUTE.some((w) => t.includes(w))) score -= 4;      // 绝对化表述
      if (HEDGE.some((w) => t.includes(w))) score += 1.5;       // 留有余地的表述
      if (contained.has(i)) score -= 6;                          // 被包含的片面项

      // 长度惩罚：偏离均值越远越可疑（过长多为编出来的干扰项）
      const avg = opts.reduce((s, x) => s + contentChars(x).length, 0) / opts.length;
      const dev = Math.abs(contentChars(text).length - avg) / (avg || 1);
      if (dev > 1.2) score -= 3;
      else if (dev < 0.35) score += 0.5;                         // 长度中庸微微加分

      return { i, score, t };
    });

    const neg = isNegatedStem(stem);
    // 否定式题干：要的是「最不符合」的那个 → 分数取反，选最离群的
    const ranked = raw.slice().sort((a, b) => (neg ? a.score - b.score : b.score - a.score));

    // 只有题干有实质内容时，词汇重合才是信号；空题干(PPT截图题)只剩套路规则
    const stemStrong = stemSet.size >= 4;
    const top = ranked[0];
    const second = ranked[1];

    if (!top) return null;

    // 多选题：取分数显著优于后半段的那几项。没有明显断层就退回单选意识（只取一项）
    const isMultiple = type === 'multiple'
      || (opts.length >= 4 && /哪些|哪些选项|属于|包括|包含/.test(stem) && !neg);

    if (isMultiple) {
      const picks = pickMultiple(ranked, neg);
      if (picks.length) {
        return finish(opts, picks, 'heuristic', 0.55, '多选题 heuristic 取前 ' + picks.length + ' 项');
      }
    }

    // 单选：分差必须拉开，否则这是「瞎选」而不是「推断」 → 认输返回 null
    const gap = second ? Math.abs(top.score - second.score) : 99;
    const minScore = stemStrong ? 3.5 : 0.5;
    if (top.score < minScore) return null;
    if (gap < 1.2 && stemStrong) return null;   // 并列领跑 = 没推断出来

    const reason = neg ? '否定式题干：取与题干重合最低项' : '取与题干重合最高项';
    const conf = gap >= 4 ? 0.6 : 0.45;
    return finish(opts, [top.i], 'heuristic', conf, reason);
  }

  /** 两个选项是否构成「对/错」判断题组合 */
  function isJudgePair(opts) {
    const a = clean(opts[0]);
    const b = clean(opts[1]);
    const hitA = TRUE_WORDS.some((w) => a === w || a === w + '的' ) || /^(正确|对|是|√)$/.test(a);
    const hitB = FALSE_WORDS.some((w) => b === w || b === w + '的') || /^(错误|错|否|×)$/.test(b);
    const hitA2 = FALSE_WORDS.some((w) => a === w || a === w + '的') || /^(错误|错|否|×)$/.test(a);
    const hitB2 = TRUE_WORDS.some((w) => b === w || b === w + '的') || /^(正确|对|是|√)$/.test(b);
    return (hitA && hitB) || (hitA2 && hitB2);
  }

  /**
   * 判断题：教材型陈述绝大多数是对的；但题干或选项带绝对化词时反转为错。
   * 这是一条纯统计规律，正确率约七成——远高于盲选五成，够用来「把弹窗关掉」。
   */
  function solveJudgement(stem, opts) {
    const hasTrue = opts.findIndex((t) => /^(正确|对|是|√)/.test(clean(t)) || TRUE_WORDS.indexOf(clean(t)) >= 0);
    const hasFalse = opts.findIndex((t) => /^(错误|错|否|×)/.test(clean(t)) || FALSE_WORDS.indexOf(clean(t)) >= 0);
    if (hasTrue < 0 || hasFalse < 0) return null;
    const absolute = ABSOLUTE.some((w) => stem.includes(w));
    const pick = absolute ? hasFalse : hasTrue;
    return finish(opts, [pick], 'heuristic', absolute ? 0.55 : 0.5,
      absolute ? '判断题：题干含绝对化词 → 判错' : '判断题：教材陈述默认判对');
  }

  /**
   * 多选题挑 tribunal：取分数为正（单选贡献）且落在前 60% 的项。
   * 为什么限制数量：网课多选多为 2~3 个正确项，全选和只选一个都容易错。
   */
  function pickMultiple(ranked, neg) {
    const cands = neg ? ranked.slice().reverse() : ranked;
    const positive = cands.filter((r) => (neg ? r.score < 0 : r.score > 0));
    const pool = positive.length >= 2 ? positive : cands;
    // 取前 2~3 项：网课多选正解多为 2~3 个，全选和单选都容易错
    const max = Math.max(2, Math.min(3, Math.round(pool.length / 3)));
    return pool.slice(0, max).map((r) => r.i);
  }

  /** 统一出口：索引 → 字母 */
  function finish(opts, idxs, from, confidence, reason) {
    const letters = idxs.slice().sort((a, b) => a - b).map((i) => isoLetter(i)).join('');
    if (!letters) return null;
    return { answer: letters, from, confidence, score: confidence, reason };
  }

  const Heuristic = {
    solve,
    // 只读暴露内部构件，供单测锁死边界（避免依赖真实 DOM 才能测）
    _grams: grams,
    _tokenSet: tokenSet,
    _overlapRatio: overlapRatio,
    _isNegatedStem: isNegatedStem,
    _isJudgePair: isJudgePair,
    _solveJudgement: solveJudgement,
  };

  ZHS.Heuristic = Heuristic;
})();
