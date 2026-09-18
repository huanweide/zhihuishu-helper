/**
 * 网络层：题库 API 客户端
 *
 * 对接 TikuAdapter 标准协议：
 *   POST {bankUrl}/adapter-service/search
 *   body: { question, options[], type }   type: 0单选 1多选 2填空 3判断 4问答
 *   resp: { code, data: { answers: [...], from } }
 *
 * 油猴环境用 GM_xmlhttpRequest 绕 CORS；无 GM 时降级 fetch。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod09_bank) return;
  ZHS.__mod09_bank = true;
  const U = ZHS.Util;

  const hasGMXhr = typeof GM_xmlhttpRequest === 'function';

  /** 统一请求（返回 Promise<{ok, status, text}>） */
  function request(opts) {
    const { url, method = 'GET', headers = {}, data = null, timeout = 15000 } = opts;

    if (hasGMXhr) {
      return new Promise((resolve) => {
        let settled = false;
        const done = (r) => { if (!settled) { settled = true; resolve(r); } };
        try {
          GM_xmlhttpRequest({
            url,
            method,
            headers,
            data,
            timeout,
            onload: (res) => done({ ok: res.status >= 200 && res.status < 300, status: res.status, text: res.responseText }),
            onerror: () => done({ ok: false, status: 0, text: '' }),
            ontimeout: () => done({ ok: false, status: 0, text: '' }),
          });
        } catch (e) {
          done({ ok: false, status: 0, text: '', error: e.message });
        }
      });
    }

    // 降级 fetch
    return new Promise((resolve) => {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, timeout);
      fetch(url, { method, headers, body: data, signal: ctrl ? ctrl.signal : undefined })
        .then((r) => r.text().then((text) => ({ ok: r.ok, status: r.status, text })))
        .then((r) => { clearTimeout(timer); resolve(r); })
        .catch((e) => { clearTimeout(timer); resolve({ ok: false, status: 0, text: '', error: e.message }); });
    });
  }

  /**
   * 答案归一化：把模型/题库的各种输出统一成标准形式
   *  'B' / 'b' / 'B.' / '答案是A' → 'A'
   *  'A,C' / 'ACD' / 'A、C' → 'A,C'
   *  '对' / '正确' / 'True' → '对'
   */
  function normalize(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return '';

    // 判断题
    if (/^(对|正确|是|true|t|√|✓)$/i.test(s)) return '对';
    if (/^(错|错误|否|false|f|×|✗)$/i.test(s)) return '错';
    // 文本里含判定词（如"答案是：正确"）
    if (/(正确|对)/.test(s) && !/[A-D]/.test(s) && s.length <= 6) return '对';
    if (/(错误|错)/.test(s) && !/[A-D]/.test(s) && s.length <= 6) return '错';

    // 提取所有 A-D 字母
    const upper = s.toUpperCase();
    const letters = upper.match(/[A-D]/g);
    if (letters && letters.length) {
      // 只有当去掉字母和分隔符后没别的内容，才认定是纯选项答案
      const residue = upper.replace(/[\s,A-D、,，.。:：;；/|()（）[\]【】]/g, '');
      if (residue === '' || residue.length <= 2) {
        const uniq = Array.from(new Set(letters)).sort();
        return uniq.join(',');
      }
      // 否则取最后一个字母（"答案是 B" 这类）
      if (letters.length === 1) return letters[0];
    }

    return s;    // 填空题/简答：原文返回
  }

  /** 'B' → 1 ; 'A,C' → [0,2] */
  function toIndexes(answer) {
    if (!answer) return [];
    const letters = String(answer).toUpperCase().match(/[A-D]/g);
    if (!letters) return [];
    return Array.from(new Set(letters)).map((l) => l.charCodeAt(0) - 65).sort((a, b) => a - b);
  }

  /** 答案列表 ['B'] → 'B' */
  function pickBest(answers) {
    if (!answers) return '';
    const arr = Array.isArray(answers) ? answers : [answers];
    const cleaned = arr.map((a) => normalize(a)).filter(Boolean);
    if (!cleaned.length) return '';
    // 取最长的那个（多选答案通常更长，更能命中）
    cleaned.sort((a, b) => b.length - a.length);
    return cleaned[0];
  }

  const Bank = {
    normalize,
    toIndexes,
    pickBest,
    request,

    /** 搜索答案，返回 {answer, from, raw} 或 null */
    async search(question, options, type) {
      const cfg = ZHS.config;
      if (!cfg.bankEnabled) return null;
      if (!question && (!options || !options.length)) return null;

      const url = String(cfg.bankUrl || '').replace(/\/$/, '') + '/adapter-service/search';
      const payload = {
        question: String(question || '').slice(0, 500),
        options: (options || []).slice(0, 10),
        type: ZHS.Questions.BANK_TYPE[type] != null ? ZHS.Questions.BANK_TYPE[type] : 0,
      };

      const res = await request({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
        timeout: 12000,
      });

      if (!res.ok || !res.text) {
        ZHS.Log.debug('题库无响应（status=' + res.status + '）');
        return null;
      }

      let json;
      try { json = JSON.parse(res.text); } catch (e) {
        ZHS.Log.debug('题库返回非 JSON');
        return null;
      }

      // 兼容多种返回结构
      const data = json.data || json.result || json;
      let answers = null;
      let from = '';
      if (data) {
        answers = data.answers || data.answer || data.data;
        from = data.from || data.source || '';
        // 有的题库返回 [{answer: 'B'}]
        if (Array.isArray(answers) && answers.length && typeof answers[0] === 'object') {
          answers = answers.map((a) => a.answer || a.value || '').filter(Boolean);
        }
      }
      if (!answers || (Array.isArray(answers) && !answers.length)) {
        ZHS.Log.debug('题库未命中');
        return null;
      }

      const answer = pickBest(answers);
      if (!answer) return null;

      ZHS.Log.info('题库命中：' + answer + (from ? '（来源 ' + from + '）' : ''));
      return { answer, from, raw: answers };
    },

    /** 健康检查 */
    async ping() {
      const cfg = ZHS.config;
      const url = String(cfg.bankUrl || '').replace(/\/$/, '') + '/';
      const res = await request({ url, method: 'GET', timeout: 5000 });
      return res.ok;
    },
  };

  ZHS.Bank = Bank;
})();
