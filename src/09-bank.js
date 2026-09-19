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

  /**
   * 同类故障 30 秒内只报一次。
   *
   * 为什么必须节流：服务商挂掉时主循环每 2 秒一轮，一道错题就刷一条，
   * 几十轮下来控制台全被同一句话淹没，反而看不到其它更有用的信息。
   * 另外日志本身绝不允许反过来炸主流程，故 fn 外层套 try。
   */
  const _diagAt = Object.create(null);
  function _throttled(key, fn) {
    const now = Date.now();
    if (_diagAt[key] && now - _diagAt[key] < 30000) return;
    _diagAt[key] = now;
    try { fn(); } catch (e) { /* 日志失败不得冒泡 */ }
  }

  /**
   * 失败类型枚举。
   *
   * 【2026-09-19 第⑤层修复】旧实现把所有失败压成 `{ok:false, status:0}`，
   * 于是「网络不通」「请求超时」「服务商返回 HTML 错误页」「余额不足」
   * 这四种完全不同的故障，在用户面板上都显示同一句「请求失败」——
   * 用户既不知道该改什么，也无从自查。
   * 现在按成因分类，调用方据此生成可操作的中文提示。
   */
  const FAIL = {
    OK: 'ok',
    TIMEOUT: 'timeout',       // 到点没回来（网络慢 / 服务卡死）
    NETWORK: 'network',       // 根本没发出去（跨域被拦 / DNS / 断网 / localhost 没起）
    HTTP: 'http',             // 服务端明确回了非 2xx
    EMPTY: 'empty',           // 2xx 但响应体是空的
    NON_JSON: 'non-json',     // 2xx 但不是 JSON（多半是 HTML 错误页 / 门户页）
  };

  /** 统一请求（返回 Promise<{ok, status, text, kind, detail}>）
   *
   * 新增字段全部可选，旧调用方只读 {ok,status,text} 不受影响。
   */
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
            onload: (res) => done({
              ok: res.status >= 200 && res.status < 300,
              status: res.status,
              text: res.responseText,
              kind: res.status >= 200 && res.status < 300 ? FAIL.OK : FAIL.HTTP,
              detail: '',
            }),
            // 超时与网络错误过去都返回 status=0，调用方完全无法区分，
            // 现在拆成两类：超时多半要调大超时时间，网络错误多半要检查地址/跨域。
            ontimeout: () => done({
              ok: false, status: 0, text: '',
              kind: FAIL.TIMEOUT,
              detail: '请求超过 ' + timeout + 'ms 未返回',
            }),
            onerror: () => done({
              ok: false, status: 0, text: '',
              kind: FAIL.NETWORK,
              detail: '连接未建立（跨域被拦截 / 地址不可达 / 服务未启动）',
            }),
          });
        } catch (e) {
          done({
            ok: false, status: 0, text: '',
            kind: FAIL.NETWORK,
            detail: '发起失败：' + e.message,
          });
        }
      });
    }

    // 降级 fetch
    return new Promise((resolve) => {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; if (ctrl) ctrl.abort(); }, timeout);
      fetch(url, { method, headers, body: data, signal: ctrl ? ctrl.signal : undefined })
        .then((r) => r.text().then((text) => ({
          ok: r.ok, status: r.status, text,
          kind: r.ok ? FAIL.OK : FAIL.HTTP,
          detail: '',
        })))
        .then((r) => { clearTimeout(timer); resolve(r); })
        .catch((e) => {
          clearTimeout(timer);
          // AbortError 只可能是我们自己的超时定时器触发的，据此拆出 TIMEOUT
          const kind = timedOut ? FAIL.TIMEOUT : FAIL.NETWORK;
          resolve({
            ok: false, status: 0, text: '',
            kind,
            detail: timedOut ? '请求超过 ' + timeout + 'ms 未返回' : ('发起失败：' + e.message),
          });
        });
    });
  }

  /**
   * 从 HTML 片段里抠出 <title>，用于让用户知道"到底是谁返回了这一页"。
   * 抠不到就返回空串，不抛异常。
   */
  function extractHtmlTitle(text) {
    const m = String(text || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m ? m[1].trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  }

  /**
   * ★ 响应体诊断：把「一次失败的 HTTP 调用」翻译成人能看懂的中文 + 可操作建议。
   *
   * 这是本次修复的核心。过去 provider 返回网关 502 页 / 代理拦截页 / 门户首页时，
   * 下游 JSON.parse 只会抛一句「返回非 JSON」，用户无从判断是 Key 错、地址错还是网络错，
   * 只能反复重试——正是幻觉税（arxiv 2509.14583 所述约 40% 算力被这类无效重试吃掉）的现实版本。
   *
   * @param {string} label  调用点名称，如 '大模型' / '题库'
   * @param {object} res    request() 的返回值
   * @param {string} url    请求地址（用于生成建议）
   * @returns {{code:string, msg:string, hint:string}}
   */
  function diagnose(label, res, url) {
    const r = res || {};
    const text = String(r.text || '');
    const host = (function () {
      try { return new URL(url).host; } catch (e) { return String(url || '').slice(0, 40); }
    }());
    // HTML 判据：以 '<' 开头，或前 200 字符里出现 <!DOCTYPE / <html
    const head = text.slice(0, 200).toLowerCase();
    const looksHtml = /^\s*</.test(text) || head.includes('<!doctype') || head.includes('<html');

    switch (r.kind) {
      case FAIL.TIMEOUT:
        return {
          code: 'TIMEOUT',
          msg: label + '请求超时（' + host + ' 未在限定时间内响应）',
          hint: '多半是网络慢或对方服务繁忙。可在设置里调大超时时间后重试；若持续超时，换一个可用的 API 地址。',
        };
      case FAIL.NETWORK:
        return {
          code: 'NETWORK',
          msg: label + '连不上（' + host + '）' + (r.detail ? '：' + r.detail : ''),
          hint: '检查：① 网络是否正常；② 地址是否写对（本地题库要先把 TikuAdapter 跑起来）；③ 油猴是否已授权跨域。',
        };
      case FAIL.HTTP: {
        const s = Number(r.status);
        let hint = '对方返回了 HTTP ' + s + '。';
        if (s === 401 || s === 403) hint += '多半是 API Key 无效、过期或没权限——请在设置里重新填写并检查有无多余空格。';
        else if (s === 402) hint += '账户余额不足，请先充值。';
        else if (s === 404) hint += '接口路径不存在——请检查 API 地址是否少了 /v1 之类的前缀。';
        else if (s === 429) hint += '请求过于频繁被限流，稍等片刻会自动重试。';
        else if (s >= 500) hint += '对方服务器内部错误，属于服务端故障，稍后重试通常能恢复。';
        // 非 2xx 且响应体是 HTML：说明根本没打到 API，被网关/代理/门户页截胡了
        if (looksHtml) {
          const title = extractHtmlTitle(text);
          return {
            code: 'HTTP_HTML',
            msg: label + '返回了 HTML 页面而不是数据（HTTP ' + s + (title ? '，页面标题「' + title + '」' : '') + '）',
            hint: '这通常说明请求被网关或代理页面拦下了，而不是打到了真正的 API 接口。'
              + '请检查 API 地址是否填成了网站首页（应形如 https://api.deepseek.com，不要带 /chat/completions，脚本会自动拼接）。',
          };
        }
        return { code: 'HTTP_' + s, msg: label + '请求被拒绝（HTTP ' + s + '）', hint };
      }
      case FAIL.OK:
      default: {
        if (!text.trim()) {
          return {
            code: 'EMPTY',
            msg: label + '返回了空内容',
            hint: '对方返回了 200 但响应体是空的，通常是服务端异常，稍后重试即可。',
          };
        }
        if (looksHtml) {
          const title = extractHtmlTitle(text);
          return {
            code: 'NON_JSON_HTML',
            msg: label + '返回了 HTML 页面而不是 JSON 数据' + (title ? '（页面标题「' + title + '」）' : ''),
            hint: '地址很可能填的是网站首页或被代理页拦下了，没打到真正的 API 接口。'
              + '请改成形如 https://api.deepseek.com 的接口根地址（脚本会自动拼接 /chat/completions），不要填带页面 UI 的网址。',
          };
        }
        return {
          code: 'NON_JSON',
          msg: label + '返回的不是合法 JSON',
          hint: '把返回内容的前 100 字：' + text.slice(0, 100),
        };
      }
    }
  }

  /** 判断是否解析成功；失败时抛带可操作信息的 Error */
  function parseJsonOrThrow(label, res, url) {
    const r = res || {};
    if (!r.ok || !r.text) {
      const d = diagnose(label, r, url);
      const err = new Error(d.msg);
      err.code = d.code;
      err.hint = d.hint;
      throw err;
    }
    try {
      return JSON.parse(r.text);
    } catch (e) {
      const d = diagnose(label, r, url);
      const err = new Error(d.msg);
      err.code = d.code;
      err.hint = d.hint;
      throw err;
    }
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
    diagnose,
    parseJsonOrThrow,
    extractHtmlTitle,
    FAIL,

    /** 搜索答案，返回 {answer, from, raw} 或 null */
    async search(question, options, type) {
      const cfg = ZHS.config;
      if (!cfg.bankEnabled) return null;
      if (!question && (!options || !options.length)) return null;

      // ★ 地址为空时不能照旧拼成 '/adapter-service/search' 发出去：
      // 相对路径会打到当前网课站点上，拿到一串 HTML，下游却只报一句"返回非 JSON"，
      // 用户完全看不出是「自己没填地址」。这里直接短路并给出明确指引。
      const rawUrl = String(cfg.bankUrl || '').trim();
      if (!rawUrl) {
        _throttled('bank-empty', function () {
          ZHS.Log.warn('题库未配置地址，已跳过查询。请在设置里填写题库地址（形如 http://127.0.0.1:8060）。');
        });
        return null;
      }
      const url = rawUrl.replace(/\/$/, '') + '/adapter-service/search';
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
        const d = diagnose('题库', res, url);
        // 过去这条是 debug 级，用户看不见；失败原因必须进面板，否则"题库查不到"永远是黑盒。
        _throttled('bank-' + d.code, function () {
          ZHS.Log.warn(d.msg + '｜' + d.hint);
        });
        return null;
      }

      let json;
      try { json = JSON.parse(res.text); } catch (e) {
        const d = diagnose('题库', res, url);
        _throttled('bank-' + d.code, function () {
          ZHS.Log.warn(d.msg + '｜' + d.hint);
        });
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
