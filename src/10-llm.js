/**
 * LLM 客户端：OpenAI 兼容接口 + 多次生成投票
 *
 * 默认 DeepSeek（https://api.deepseek.com），任何 OpenAI 兼容接口都能用。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
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

  /** 调用一次 LLM */
  async function callOnce(question, options, type) {
    const cfg = ZHS.config;
    if (!cfg.llmKey) throw new Error('未配置 LLM API Key');

    const base = String(cfg.llmBaseUrl || 'https://api.deepseek.com').replace(/\/$/, '');
    const url = base + '/chat/completions';
    const payload = {
      model: cfg.llmModel || 'deepseek-chat',
      messages: [{ role: 'user', content: buildPrompt(question, options, type) }],
      temperature: 0.3,
      max_tokens: 200,
    };

    const res = await ZHS.Bank.request({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.llmKey,
      },
      data: JSON.stringify(payload),
      timeout: 30000,
    });

    if (!res.ok) {
      throw new Error('LLM 请求失败 status=' + res.status + ' ' + String(res.text || '').slice(0, 120));
    }

    let json;
    try { json = JSON.parse(res.text); } catch (e) {
      throw new Error('LLM 返回非 JSON');
    }

    const content = json &&
      json.choices && json.choices[0] &&
      json.choices[0].message && json.choices[0].message.content;
    if (!content) throw new Error('LLM 返回内容为空');
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

    for (let i = 0; i < n; i++) {
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
        ZHS.Log.warn('LLM 第 ' + (i + 1) + ' 次调用失败：' + e.message);
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

    /** 连通性测试 */
    async test() {
      const cfg = ZHS.config;
      if (!cfg.llmKey) return { ok: false, msg: '未配置 API Key' };
      try {
        const r = await callOnce('1+1等于几？只输出数字。', [], 'completion');
        return { ok: true, msg: '连通正常，返回：' + r.slice(0, 20) };
      } catch (e) {
        return { ok: false, msg: e.message };
      }
    },
  };

  ZHS.LLM = LLM;
})();
