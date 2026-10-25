/**
 * LLM 客户端：OpenAI 兼容接口 + 多次生成投票
 *
 * 默认 DeepSeek（https://api.deepseek.com），任何 OpenAI 兼容接口都能用。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod10_llm) return;
  ZHS.__mod10_llm = true;
  const U = ZHS.Util;

  /**
   * v0.6.64 重写答题 Prompt：逐步推理 + 排除法 + few-shot + 严格单Token输出。
   *
   * 设计目标（用户诉求「提高 LLM 选择正确性、永远不瞎选」）：
   *   · 让模型「先想后答」——要求它依据知识点逐一判断选项对错、排除明显错误项，
   *     再给最终答案。大量实验与本次生态调研都表明：模型被显式要求逐步推理时，
   *     选择题正确率显著高于「直接给答案」。
   *   · 但最终仍只输出答案本身——保 Bank.normalize 可解析（这是硬约束，
   *     一旦模型输出大段分析，normalize 取不到字母就会整题作废）。
   *     所以指令是「先在内心推理，再只输出答案」，思考与输出格式分离。
   *   · few-shot 给一个「输入→输出」样板，进一步锚定输出格式，降低模型自由发挥。
   *
   * 反模式规避：不在 Prompt 里让它「解释为什么」，那会诱发长输出、破坏解析。
   */
  function buildPrompt(question, options, type) {
    const optionText = (options && options.length)
      ? '\n\n选项：\n' + options.map((o, i) => String.fromCharCode(65 + i) + '. ' + o).join('\n')
      : '';

    // 题型专属：label=题型名（进 Prompt，供识别与测试锚定），think=推理引导，out=输出硬格式，ex=few-shot 样板。
    const rules = {
      single: {
        label: '单选题',
        think: '先依据题目涉及的知识点，逐一分析每个选项的对错，排除明显错误或与题干无关的项，再在剩余项中确定唯一正确的答案。',
        out: '最终只输出这一个选项的字母（如 B），严禁输出选项内容、分析过程或任何标点。',
        ex: '例题——题目：下列哪一项是人体最大的器官？\n选项：\nA. 心脏\nB. 皮肤\nC. 肝脏\nD. 肺\n答案：B',
      },
      multiple: {
        label: '多选题',
        think: '逐一判断每个选项是否正确，把所有正确项全部选出（漏选和多选都扣分，拿不准的项要结合题干依据决定，不要全选）。',
        out: '最终只输出所有正确选项的字母，用英文逗号分隔并按字母顺序排列（如 A,C），严禁输出选项内容或分析过程。',
        ex: '例题——题目：以下哪些属于可再生能源？\n选项：\nA. 太阳能\nB. 煤炭\nC. 风能\nD. 石油\n答案：A,C',
      },
      judgement: {
        label: '判断题',
        think: '判断该陈述是否正确，特别注意题干里的绝对化用词（如"一定""所有""完全""唯一"）——这类表述往往是错误信号。',
        out: '最终只输出"对"或"错"两个字之一，严禁输出其他任何内容。',
        ex: '例题——题目：在标准大气压下，纯水的沸点是 100 摄氏度。\n答案：对',
      },
      completion: {
        label: '填空题',
        think: '根据题干与对应知识点，给出填空处最准确、最简洁的答案。',
        out: '最终只输出填空的答案内容本身，不要输出完整句子或分析过程。',
        ex: '',
      },
      qa: {
        label: '简答题',
        think: '根据题干简明扼要地作答，抓住核心要点，不必展开。',
        out: '最终只输出简短的答案内容，不要输出分析过程。',
        ex: '',
      },
      unknown: {
        label: '',
        think: '先判断题型（单选/多选/判断/填空），再按对应规则思考。',
        out: '最终只输出答案：单选输出一个字母（如 B），多选输出逗号分隔字母（如 A,C），判断输出"对"或"错"。严禁输出分析过程。',
        ex: '',
      },
    }[type] || {
      label: '',
      think: '仔细分析题目，依据相关知识点给出最准确的答案。',
      out: '最终只输出答案本身，不要输出分析过程。',
      ex: '',
    };

    const fewShot = rules.ex ? '\n\n' + rules.ex + '\n' : '';
    const labelLine = rules.label ? '题型：' + rules.label + '\n' : '';

    return `你是一位严谨的学科答题专家，请回答下面这道题。

${labelLine}作答要求：
1. ${rules.think}
2. ${rules.out}${fewShot}
请先在内心完成上述推理，然后严格按输出要求，只给出最终答案（不要带"答案"字样）。

题目：
${question}${optionText}

最终答案：`;
  }

  /**
   * v0.6.64：按题型给温度。选择题/判断题要「果断」，低温减少无谓的意见分裂
   * （票型越集中，置信越高）；主观题保留一定创造性，用中温。
   */
  function tempFor(type) {
    return (type === 'completion' || type === 'qa') ? 0.3 : 0.1;
  }

  // 单次 LLM 调用超时（毫秒）。
  // 旧值 15 秒，慢模型 / 高峰期 / 长题干常答不完就超时失败 → 直接 fallback 到启发式或跳过，
  // 表现为「明明配了 Key 还是答不对」。用户明确要求「给出足够时间 LLM 答题、不超时、不瞎蒙」，
  // 这里调到 45 秒，覆盖绝大多数慢响应；再配合下方总预算闸门，仍不会无限拖死主循环。
  const CALL_TIMEOUT_MS = 45000;
  // 一道题的作答总预算（毫秒）。超时后放弃后续投票，用已有结果 or 直接认输。
  // 调到 70 秒：允许单次 45s 超时被截断后仍有余量再试一次（共约 2 次调用），
  // 既不轻易认输瞎蒙，也不像旧版 90s 那样把主循环彻底堵死。
  const ANSWER_BUDGET_MS = 70000;

  // 同类错误去重：投票最多 3 次，同一句诊断刷三遍纯属噪音，
  // 只在「文案发生变化」时才再打一条。
  const _llmDiagAt = Object.create(null);

  /** 调用一次 LLM */
  async function callOnce(question, options, type) {
    const cfg = ZHS.config;
    if (!cfg.llmKey) throw new Error('未配置 LLM API Key');

    const base = String(cfg.llmBaseUrl || 'https://api.deepseek.com').replace(/\/$/, '');
    const url = base + '/chat/completions';

    // ★ 2026-09-19 新增：自动拼接前缀重复拦截。
    // 脚本会自己拼 /chat/completions，用户若照着文档把完整调用地址也填进来，
    // 拼出来就是 .../chat/completions/chat/completions → 必然 404。
    // 过去这条表现为一句冰冷的「请求失败」，用户只会反复重试。这里直接自愈。
    if (/\/chat\/completions$/i.test(base)) {
      ZHS.Log.warn('API 地址不需要带 /chat/completions，脚本会自动拼接；已自动去掉重复后缀');
    }
    const cleanBase = base.replace(/\/chat\/completions$/i, '');
    const finalUrl = cleanBase + '/chat/completions';
    const payload = {
      model: cfg.llmModel || 'deepseek-chat',
      messages: [{ role: 'user', content: buildPrompt(question, options, type) }],
      temperature: tempFor(type),
      max_tokens: 200,
    };

    const res = await ZHS.Bank.request({
      url: finalUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.llmKey,
      },
      data: JSON.stringify(payload),
      timeout: CALL_TIMEOUT_MS,
    });

    // ★ 2026-09-19 核心修复（用户报「API 请求失败」的真根因）：
    // 过去这里只有一句 `!res.ok → throw 'LLM 请求失败 status=..'`，
    // 而当服务端（或网关/代理/门户页）返回 HTML 时，JSON.parse 只抛「LLM 返回非 JSON」——
    // 用户看到的就是这四个字，既不知道是 Key 错、地址错还是网络错，只能反复重试。
    // 现在交给网络层的 diagnose 分类，产出成因 + 可操作建议。
    const json = ZHS.Bank.parseJsonOrThrow('大模型', res, finalUrl);

    const content = json &&
      json.choices && json.choices[0] &&
      json.choices[0].message && json.choices[0].message.content;
    if (!content) {
      const err = new Error('大模型返回内容为空（模型可能不支持当前模型名，或返回被截断）');
      err.code = 'EMPTY_CHOICES';
      err.hint = '请检查设置里的模型名是否与服务商提供的完全一致（如 deepseek-chat / gpt-4o-mini）。';
      throw err;
    }
    return String(content).trim();
  }

  // v0.6.64：最近一次投票的置信元数据（求解层读它做「低置信交叉验证 / 标注请人工检查」）。
  // 为什么用模块属性而非改 vote() 返回值：vote() 的返回契约是「答案字符串」，
  // 单测与多处调用方都依赖它（例如测试里 vote = async () => 'B' 的桩）；
  // 改返回类型会破坏它们。故另开一个只读通道暴露置信。
  const _lastMeta = { confidence: 'none', distribution: [], unanimous: false, n: 0, answer: '' };

  /** 由票型算置信：全票一致=high；过半多数=medium；分裂无多数=low */
  function _confidenceOf(entries, n) {
    if (!entries.length) return 'none';
    const top = entries[0][1];
    if (entries.length === 1) return 'high';
    if (top >= Math.ceil(n / 2)) return 'medium';
    return 'low';
  }

  function _recordMeta(ans, entries, n) {
    _lastMeta.answer = ans || '';
    _lastMeta.distribution = entries.map((e) => ({ answer: e[0], votes: e[1] }));
    _lastMeta.unanimous = entries.length === 1;
    _lastMeta.n = n;
    _lastMeta.confidence = _confidenceOf(entries, n);
    return _lastMeta;
  }

  /**
   * 多次生成投票取众数
   * 提前收敛：某答案出现过半就返回
   *
   * v0.6.64：新增「置信追踪 + 分裂破平局」——
   *   · 旧实现不看票型，1:1:1 三票分裂也照样返回最高票，等于把「没把握」当「有答案」。
   *   · 现在：记录票型置信（high/medium/low）到 _lastMeta；分裂且还有预算时补投一次，
   *     给模型又一次收敛机会，尽量把硬币翻转转成有依据的多数。
   *   · 返回值仍是答案字符串（契约不变，测试桩可用）。
   */
  async function vote(question, options, type, times) {
    const n = Math.max(1, Math.min(Number(times) || 3, 5));
    const votes = {};
    let lastErr = null;
    // 总预算闸门：哪怕每次调用都没超时，3 次串起来也可能拖到 45 秒，
    // 这段时间主循环是被 await 堵死的。到点就收工，用已有票或直接认输。
    const deadline = Date.now() + ANSWER_BUDGET_MS;

    const tally = (raw) => {
      const ans = ZHS.Bank.normalize(raw);
      if (!ans) return null;
      votes[ans] = (votes[ans] || 0) + 1;
      return ans;
    };

    for (let i = 0; i < n; i++) {
      if (Date.now() >= deadline && i > 0) {
        ZHS.Log.warn('LLM 作答超出总预算 ' + ANSWER_BUDGET_MS + 'ms，停止后续投票');
        break;
      }
      try {
        const raw = await callOnce(question, options, type);
        const ans = tally(raw);
        ZHS.Log.debug('LLM 第 ' + (i + 1) + ' 次输出：' + String(raw).slice(0, 40) + (ans ? ' → ' + ans : ''));

        // 提前收敛：已过半
        if (ans && votes[ans] >= Math.ceil(n / 2)) {
          const entries = Object.entries(votes).sort((a, b) => b[1] - a[1]);
          _recordMeta(ans, entries, n);
          ZHS.Log.info('LLM 投票收敛于第 ' + (i + 1) + ' 次：' + ans
            + '（置信 ' + _lastMeta.confidence + '）');
          return ans;
        }
      } catch (e) {
        lastErr = e;
        // ★ 只打印 e.message 时，用户看到的是「大模型返回了 HTML 页面而不是 JSON 数据」，
        // 但不知道该改哪里。hint 才是这份修复真正的产出，必须一起打出来。
        // 同一类故障节流，避免 3 次投票把同一句刷三遍。
        const key = 'llm-' + (e.code || 'err');
        if (_llmDiagAt[key] !== e.message) {
          _llmDiagAt[key] = e.message;
          ZHS.Log.warn('大模型第 ' + (i + 1) + ' 次调用失败：' + e.message
            + (e.hint ? '｜建议：' + e.hint : ''));
        }
      }
      // 连续失败 2 次就放弃
      if (i >= 1 && Object.keys(votes).length === 0 && lastErr) break;
    }

    let entries = Object.entries(votes);
    if (!entries.length) {
      _recordMeta('', [], n);
      if (lastErr) throw lastErr;
      return '';
    }
    entries.sort((a, b) => b[1] - a[1]);

    // v0.6.64 破平局：票型分裂（无过半多数）且预算仍充裕 → 补投一次，再给一次收敛机会。
    const topCount = entries[0][1];
    if (topCount < Math.ceil(n / 2) && Date.now() < deadline - 4000) {
      try {
        ZHS.Log.info('LLM 投票分裂（' + entries.map((e) => e[0] + '×' + e[1]).join(' / ')
          + '），补投一次尝试收敛');
        const raw = await callOnce(question, options, type);
        const ans = tally(raw);
        if (ans) entries = Object.entries(votes).sort((a, b) => b[1] - a[1]);
      } catch (e) {
        lastErr = e;
        const key = 'llm-tie-' + (e.code || 'err');
        if (_llmDiagAt[key] !== e.message) {
          _llmDiagAt[key] = e.message;
          ZHS.Log.warn('破平局补投失败：' + e.message + (e.hint ? '｜建议：' + e.hint : ''));
        }
      }
    }

    const finalAns = entries[0][0];
    const meta = _recordMeta(finalAns, entries, n);
    ZHS.Log.info('LLM 投票结果：' + finalAns + '（' + entries[0][1] + '/' + n + ' 票，置信 '
      + meta.confidence + (meta.unanimous ? '，全票一致' : '') + '）');
    return finalAns;
  }

  const LLM = {
    buildPrompt,
    callOnce,
    vote,
    tempFor,
    /** v0.6.64：读最近一次投票的置信元数据（求解层低置信交叉验证用） */
    getLastVoteMeta() { return _lastMeta; },

    /**
     * round-44：主观题（填空/问答）单次生成——不投票。
     *
     * 为什么主观题不能走 vote：vote 的「多次生成取众数」机制是为选择题设计的，
     * 对文本答案完全失效——填空/问答每次生成的文本几乎不可能逐字相同，票数都是 1，
     * 既收敛不了（`votes[ans] >= ceil(n/2)` 永不满足），又白费最多 3 次调用，
     * 最后只能取任意一次。主观题只需一次高质量生成即可。
     *
     * 返回 normalize 后的原文：Bank.normalize 对填空/问答走「原文返回」分支
     * （09-bank.js L271），不会把答案字母化，保留 LLM 生成的完整文本。
     */
    async ask(question, type) {
      const raw = await callOnce(question, [], type);
      // 主观题不走 normalize：normalize 的字母化逻辑会把「维生素A」这类含单个 A-D
      // 字母的填空/问答答案误转成 'A'（09-bank.js L268 letters.length===1 分支），
      // 破坏文本答案。主观题只需 trim 后的原文。
      return String(raw == null ? '' : raw).trim();
    },

    /** 连通性测试（面板「测试连接」按钮走的就是这里） */
    async test() {
      const cfg = ZHS.config;
      if (!cfg.llmKey) return { ok: false, msg: '未配置 API Key', hint: '请在设置页填写大模型 API Key 并保存。' };
      try {
        const r = await callOnce('1+1等于几？只输出数字。', [], 'completion');
        return { ok: true, msg: '连通正常，返回：' + r.slice(0, 20), hint: '' };
      } catch (e) {
        // ★ 这里过去只有 e.message（"请求失败"四个字），用户试完仍然不知道怎么改。
        // 现在把 hint 一并返回，面板可以直接把解决方案显示给用户。
        return {
          ok: false,
          msg: e.message,
          hint: e.hint || '',
          code: e.code || '',
        };
      }
    },
  };

  ZHS.LLM = LLM;
})();
