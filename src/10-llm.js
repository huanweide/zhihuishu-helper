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

  /** 构建答题 Prompt（来自已验证有效的实践，稍作强化） */
  function buildPrompt(question, options, type) {
    const typeHint = {
      single: '如果题目为单选题，请从选项中选择一个正确的答案，并仅输出该选项（A、B、C或D），不提供任何额外解释。',
      multiple: '如果题目为多选题，请选择所有正确的选项，并仅输出所有正确选项的字母，用\',\'分隔（如A,C），按字母顺序排列，不提供任何额外解释。',
      judgement: '如果题目为判断题，请分析题目并仅输出 "对" 或 "错"，不提供任何额外解释。',
      completion: '如果题目为填空题，请仅输出填空的答案内容，不提供任何额外解释。',
      qa: '如果题目为简答题，请简洁作答，不提供额外解释。',
      unknown: '请判断题目的类型（单选/多选/判断/填空），按对应规则仅输出答案（单选如B、多选如A,C、判断输出对或错），不提供任何额外解释。',
    }[type] || '请仅输出答案，不提供任何额外解释。';

    const optionText = (options && options.length)
      ? '\n\n选项：\n' + options.map((o, i) => String.fromCharCode(65 + i) + '. ' + o).join('\n')
      : '';

    return `请仔细阅读以下题目并思考分析，根据题目类型，严格按照以下要求作答：

${typeHint}
请遵循以上规则直接给出你的答案。

题目：
${question}${optionText}

你的答案：`;
  }

  // 单次 LLM 调用超时（毫秒）。
  // 原来是 30 秒，配合 vote() 的最多 3 次重试 = 最坏 90 秒，
  // 这段时间主循环（2 秒一轮）被 await 死死堵住 → 弹题一出现整个脚本就像卡死。
  const CALL_TIMEOUT_MS = 15000;
  // 一道题的作答总预算（毫秒）。超时后放弃后续投票，用已有结果 or 直接认输。
  const ANSWER_BUDGET_MS = 25000;

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
      temperature: 0.3,
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

  /**
   * 多次生成投票取众数
   * 提前收敛：某答案出现 2 次就返回
   */
  async function vote(question, options, type, times) {
    const n = Math.max(1, Math.min(Number(times) || 3, 5));
    const votes = {};
    let lastErr = null;
    // 总预算闸门：哪怕每次调用都没超时，3 次串起来也可能拖到 45 秒，
    // 这段时间主循环是被 await 堵死的。到点就收工，用已有票或直接认输。
    const deadline = Date.now() + ANSWER_BUDGET_MS;

    for (let i = 0; i < n; i++) {
      if (Date.now() >= deadline && i > 0) {
        ZHS.Log.warn('LLM 作答超出总预算 ' + ANSWER_BUDGET_MS + 'ms，停止后续投票');
        break;
      }
      try {
        const raw = await callOnce(question, options, type);
        const ans = ZHS.Bank.normalize(raw);
        if (!ans) continue;
        votes[ans] = (votes[ans] || 0) + 1;
        ZHS.Log.debug('LLM 第 ' + (i + 1) + ' 次输出：' + raw.slice(0, 40) + ' → ' + ans);

        // 提前收敛：已过半
        if (votes[ans] >= Math.ceil(n / 2)) {
          ZHS.Log.info('LLM 投票收敛于第 ' + (i + 1) + ' 次：' + ans);
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

    const entries = Object.entries(votes);
    if (!entries.length) {
      if (lastErr) throw lastErr;
      return '';
    }
    entries.sort((a, b) => b[1] - a[1]);
    ZHS.Log.info('LLM 投票结果：' + entries[0][0] + '（' + entries[0][1] + '/' + n + ' 票）');
    return entries[0][0];
  }

  const LLM = {
    buildPrompt,
    callOnce,
    vote,

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
