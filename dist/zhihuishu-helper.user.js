// ==UserScript==
// @name         智慧树网课助手
// @namespace    https://github.com/huanweide/zhihuishu-helper
// @version      0.6.17
// @description  智慧树自动播放 + 断点续播 + AI 自动答题 + 全自动看完收尾
// @author       ReTri
// 带子域与裸域都写上：只写通配子域匹配不到 https://zhihuishu.com/ 本身，
// 漏了裸域就会出现「脚本装了、日志也不打、页面毫无动静」的假失效。
// 注意：本段是模板字符串内部，注释里不要出现反引号，否则会提前闭合字符串。
// @match        *://*.zhihuishu.com/*
// @match        *://zhihuishu.com/*
// @match        *://*.polymas.com/*
// @match        *://polymas.com/*
// @match        *://*.zhihuishu.cn/*
// @match        *://zhihuishu.cn/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// @connect      api.deepseek.com
// @connect      *
// @run-at       document-idle
// @license      MIT
// @supportURL   https://github.com/huanweide/zhihuishu-helper/issues
// 分发地址刻意选 jsdelivr 而不是 raw.githubusercontent.com：
// 实测 master 上已经是新版本时，raw 的 CDN 仍可能回吐上一个版本（2026-09 观察到
// raw 停在 0.6.3、jsdelivr 已是 0.6.4），油猴「检查更新」就会拿到旧脚本，
// 表现为「我明明修好了、用户那边还是老样子」。jsdelivr 对同一 tag/分支的回源更及时，
// 且支持 https://purge.jsdelivr.net 主动清缓存。
// @updateURL    https://cdn.jsdelivr.net/gh/huanweide/zhihuishu-helper@master/dist/zhihuishu-helper.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/huanweide/zhihuishu-helper@master/dist/zhihuishu-helper.user.js
// ==/UserScript==

(function () {
'use strict';

/* ===== 构建注入 ===== */
window.__ZHS_BUILD__ = window.__ZHS_BUILD__ || {};
window.__ZHS_BUILD__.version = "0.6.17";

/* ===== 00-config.js ===== */
/**
 * 智慧树网课助手 —— 全局配置与共享状态
 *
 * 所有模块共享一个 ZHS 命名空间对象，避免污染页面全局。
 */
(function () {
  'use strict';

  // 重入守卫：同一页面只跑一个实例，避免定时器/监听器叠加。
  //
  // 【2026-09-19 修正】原来这里是**无声** return。用户反馈「装了 27 次都没用、面板都没有」：
  // 若油猴里残留了多份副本（反复导入很容易留下），第一份跑起来就上锁，
  // 之后装的新版本全部静默退出 —— 谁先跑谁生效，跟版本号无关，用户完全看不到发生了什么。
  // 现在仍然只跑一个实例（这是对的），但要把「为什么没生效」在控制台说清楚。
  if (window.__ZHS_HELPER__) {
    try {
      const prev = window.__ZHS_HELPER_VERSION__;
      console.warn('[智慧树助手] 检测到页面已有脚本实例'
        + (prev ? '（版本 ' + prev + '）' : '')
        + '，本次注入已退出。若你重复安装了多份，请在油猴里删掉多余副本，只保留一份。');
    } catch (e) { /* 连控制台都不可用时，绝不能因此中断脚本 */ }
    return;
  }

  // ============ 默认配置 ============
  const DEFAULTS = {
    // F1 自动播放
    autoPlay: true,
    autoNext: true,
    skipFinished: true,  // 自动跳过已完成/未解锁节点
    speed: 1.5,          // 倍速，硬上限 1.8
    mute: true,          // 静音
    nextDelayMin: 2,     // 切课随机延迟下限（秒），模拟人类
    nextDelayMax: 8,     // 切课随机延迟上限（秒）

    // F2 断点续播
    resume: true,
    resumeRewind: 2,     // 恢复时回退秒数（保险）
    resumeExpireDays: 7, // 记录过期天数
    saveIntervalMs: 5000,// 进度写入节流间隔

    // F3 AI 答题
    autoAnswer: true,    // 默认开：用户要求「开启自动就是全部自动」，答题不需人工
    answerMode: 'both',  // bank | llm | both
    bankUrl: 'http://localhost:8060',
    bankEnabled: true,
    llmEnabled: true,
    llmBaseUrl: 'https://api.deepseek.com',
    llmKey: '',
    llmModel: 'deepseek-chat',
    voteTimes: 3,        // LLM 投票次数
    answerDelay: 3,      // 答题前延迟（秒）
    answerDialog: true,  // 课中弹题自动答
    answerHomework: false,// 作业页自动答（谨慎，默认关）
    autoCloseDialog: true,// 答完自动关闭弹题（N4）

    // ---- 在线作业 / 在线考试（守株待兔模式，见 src/06c-exam.js）----
    // 用户明确要求：默认关闭，且【绝不自动跳转】到作业/考试页。
    // 只有用户自己点进作答页（dohomework / doexamination）时才会工作。
    autoExam: false,        // 默认关：自动答题（作业/考试）
    examChapterFrom: 0,     // 起始章节，0 = 不限
    examChapterTo: 0,       // 结束章节，0 = 不限
    examSubmit: true,       // 答完是否自动提交（受 autoExam 总开关约束）
    examSubmitDelay: 5,     // 提交前等待秒数（给用户反悔机会）

    // 没配 LLM Key / 题库查不到时，是否随机蒙一个答案。
    // 默认【关】：弹题大多计入平时分且很多课程不允许回退重做，
    // 漏答还能回来手工作答，蒙错答却改不回来——宁可漏，不可错。
    gatedRandom: false,

    // 通用
    debug: true,         // 控制台详细日志
    panelVisible: true,  // 悬浮面板
    guardOverlays: true, // 弹窗守卫

    // 全屏适配降级开关：进入全屏后脚本会先把悬浮面板「迁移」进全屏元素内部，
    // 这样全屏看课时面板依然可见。只有迁移失败（极个别播放器不让挂）时，
    // 本开关才起作用。
    // 默认【false】：绝不擅自把用户从全屏里弹出来 —— 那体验极差。
    // 用户主动打开后才允许「挂不上就自动退出全屏」。
    exitFullscreenOnPanel: false,

    // 课程中心调度
    autoCourseHop: true,  // 自动跳课：本课学完 → 回课程中心选下一门
    autoCoursePick: true, // 自动选课：在课程中心自动点进未看完的课

    // 自动停止（用户需求 1）
    stopMode: 'none',    // none 不限 | minutes 按累计观看时长 | lessons 按完成节数
    stopMinutes: 120,    // 累计观看多少分钟后自动停止
    stopLessons: 10,     // 完成多少节后自动停止
  };

  // ============ 配置读写（GM 优先，降级 localStorage）============
  const hasGM = typeof GM_setValue === 'function' && typeof GM_getValue === 'function';

  /**
   * 需要「布尔归一化」的配置字段。
   * 起因：配置可能被脏数据写成字符串（GM 直写 / 老版本遗留 / 手工改存储），
   * 而 `!"false"` 恒为 false —— 会把用户以为关掉的开关【偷偷打开】。
   * 后者若发生在 autoExam（自动答题）上，等于在不知情下替用户答题，不可接受。
   * 归一策略（失败侧优先/保守）：
   *   - 布尔 → 原样
   *   - 数字 → 非 0 为 true
   *   - 字符串 → 仅 'true' / '1' 视为 true，其余（含 'yes'/'on'/'no'/'false'/'0' 等）一律 false
   *     （保守：宁可把开关当关，也不误开）
   *   - undefined / null → 由调用方保留默认值（不覆盖）
   *   - 其它类型（对象/数组）→ false
   */
  const BOOL_KEYS = [
    'autoPlay', 'autoNext', 'skipFinished', 'mute', 'resume',
    'autoExam', 'examSubmit', 'autoCourseHop', 'autoCoursePick',
    'exitFullscreenOnPanel', 'autoAnswer', 'bankEnabled', 'llmEnabled',
    'answerDialog', 'answerHomework', 'autoCloseDialog', 'gatedRandom',
    'debug', 'panelVisible', 'guardOverlays',
  ];

  /** 单值布尔归一化；undefined/null 返回 undefined（表示「不覆盖」） */
  function toBool(v) {
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      return s === 'true' || s === '1';
    }
    return false;
  }

  /** 对配置对象里的布尔字段做原地归一化（undefined/null 保留原值） */
  function normalizeBools(cfg) {
    for (const k of BOOL_KEYS) {
      const n = toBool(cfg[k]);
      if (n !== undefined) cfg[k] = n;
    }
    return cfg;
  }

  /** 非负整数夹逼（章节范围等），非法值退化 0 */
  function clampInt(v, max) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, max == null ? 999 : max);
  }

  /**
   * 配置迁移：老用户本地存的配置会压住新版本的默认值，
   * 导致「代码改了默认但用户端不生效」。
   * 每次重要默认值变更就把 CONFIG_REV +1，并把变更项写进 FORCE_UPGRADE。
   */
  const CONFIG_REV = 5;
  const FORCE_UPGRADE = {
    autoAnswer: true,     // v0.3.0：全自动要求，默认开启
    gatedRandom: false,   // v0.3.1：默认不再随机蒙答案（蒙错不可逆），宁漏勿错
    autoCourseHop: true,  // v0.5.x：课程中心调度新功能，默认开，老用户也强制升级拿到
    autoCoursePick: true, // v0.5.x：同上
    // 注意：autoExam 故意【不】放进 FORCE_UPGRADE。
    // 它的承诺是「默认关闭」，强推会把老用户的 configRev 升级顺便改成 true，
    // 等于偷偷打开了自动答题 —— 破坏承诺，也会让用户在不知情下被代答。
  };

  /** 原始写入（不经过 getConfig，避免迁移递归） */
  function store(obj) {
    try {
      const raw = JSON.stringify(obj);
      if (hasGM) GM_setValue('zhs-helper-config', raw);
      else localStorage.setItem('zhs-helper-config', raw);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getConfig() {
    let saved = {};
    try {
      const raw = hasGM ? GM_getValue('zhs-helper-config', null)
                        : localStorage.getItem('zhs-helper-config');
      if (raw) saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) { /* 配置损坏则用默认 */ }
    // 兜底：JSON.parse 可能产出 null / 数字 / 字符串 / 数组等非对象值
    // （例如历史脏数据里存了字面量字符串 "null"）。此类值会让下面的
    // saved.configRev 抛 TypeError，进而中断整份脚本。统一退化回空对象。
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};

    const cfg = Object.assign({}, DEFAULTS, saved);

    // 跨版本迁移：把重要变更项强制拉到新默认，并写回（只跑一次）
    if (Number(saved.configRev || 0) < CONFIG_REV) {
      for (const key of Object.keys(FORCE_UPGRADE)) cfg[key] = FORCE_UPGRADE[key];
      cfg.configRev = CONFIG_REV;
      store(cfg);
    }

    // 布尔归一化：把存储里的脏值（字符串 "false"/"no" 等）规整成真布尔。
    // 必须在返回前统一做，因为 get config() 每次读取都会走到这里，
    // 保证「直写存储」与「走 setConfig」两条路径拿到的都是干净布尔。
    normalizeBools(cfg);
    // 章节范围夹逼：与 06c-exam.js 的 clampCh 对齐，防止越权范围。
    cfg.examChapterFrom = clampInt(cfg.examChapterFrom, 999);
    cfg.examChapterTo = clampInt(cfg.examChapterTo, 999);
    return cfg;
  }

  function saveConfig(patch) {
    // 过滤 undefined/null：避免 patch 里显式的 undefined 覆盖掉默认值
    const clean = {};
    if (patch && typeof patch === 'object') {
      for (const k of Object.keys(patch)) {
        if (patch[k] !== undefined && patch[k] !== null) clean[k] = patch[k];
      }
    }
    const next = Object.assign(getConfig(), clean);
    // 倍速硬夹逼
    next.speed = Math.min(Math.max(Number(next.speed) || 1, 0.5), 1.8);
    // 布尔归一化 + 章节夹逼：直写 API 也要设防（面板走 floor，API/GM 直写不设防）
    normalizeBools(next);
    next.examChapterFrom = clampInt(next.examChapterFrom, 999);
    next.examChapterTo = clampInt(next.examChapterTo, 999);
    next.configRev = CONFIG_REV;
    store(next);
    return next;
  }

  // ============ 日志 ============
  const LOG_BUFFER = [];       // 面板日志显示用，最多 200 条
  const MAX_LOG = 200;

  const Log = {
    _push(level, args) {
      const line = args.map((a) => {
        if (a instanceof Error) return a.message;
        if (typeof a === 'object') { try { return JSON.stringify(a); } catch (e) { return String(a); } }
        return String(a);
      }).join(' ');
      const entry = { t: Date.now(), level, text: line };
      // 面板缓冲只保留 info/warn/error；debug 仅进控制台，不占 200 条缓冲。
      // 起因：课程中心等模块的常规 debug 日志会刷爆缓冲，把真告警挤掉。
      // 注意：需要「面板可查」的关键排查线索必须用 info，不能用 debug。
      if (level !== 'debug') {
        LOG_BUFFER.push(entry);
        if (LOG_BUFFER.length > MAX_LOG) LOG_BUFFER.shift();
      }
      const tag = '[智慧树助手]';
      if (level === 'error') console.error(tag, ...args);
      else if (level === 'warn') console.warn(tag, ...args);
      else if (level === 'debug') { if (ZHS.config.debug) console.log(tag, ...args); }
      else console.log(tag, ...args);
      // 通知面板刷新
      if (ZHS.panel && ZHS.panel.onLog) ZHS.panel.onLog(entry);
    },
    info(...a) { this._push('info', a); },
    warn(...a) { this._push('warn', a); },
    error(...a) { this._push('error', a); },
    debug(...a) { this._push('debug', a); },
    all() { return LOG_BUFFER.slice(); },
    clear() { LOG_BUFFER.length = 0; },
  };

  // ============ 运行时状态 ============
  const state = {
    siteVersion: null,     // wisdom | fusion | hike | legacy | unknown
    courseId: null,        // recruitAndCourseId
    lessonKey: null,       // 当前课时标识
    videoEl: null,         // 当前 video 元素
    running: false,        // 主循环是否运行
    answeredCount: 0,      // 已答题数
    pausedByGuard: false,  // 是否因守卫暂停
    startedAt: Date.now(),
  };

  window.__ZHS_HELPER__ = true;
  // 记下版本：页面里若已有实例，守卫处要靠它告诉用户「你装的到底是哪个版本在跑」
  window.__ZHS_HELPER_VERSION__ = (window.__ZHS_BUILD__ && window.__ZHS_BUILD__.version) || 'unknown';

  const ZHS = {
    // 版本号只认 package.json（build.js 注入到 window.__ZHS_BUILD__.version）。
    // 此处不再硬编码，避免与 package.json 漂移（历史遗留的 '0.3.0' 就是这么来的）。
    // 注意：必须读 window.__ZHS_BUILD__，不能用裸标识符 __ZHS_VERSION__。
    // 历史坑：build.js 曾声明 `const __ZHS_VERSION__`，而本模块在独立 IIFE 里，
    // 作用域上根本看不到外层 IIFE 的 const —— typeof 判断因此永远走 '0.0.0' 分支。
    version: (() => {
      try {
        const b = window.__ZHS_BUILD__;
        if (b && typeof b.version === 'string' && b.version) return b.version;
      } catch (e) { /* 忽略 */ }
      return '0.0.0';
    })(),
    DEFAULTS,
    get config() { return getConfig(); },
    setConfig: saveConfig,
    Log,
    state,
    LOG_BUFFER,
  };

  window.ZHS = ZHS;
  Log.info('助手已注入 v' + ZHS.version);
})();

/* ===== 01-util.js ===== */
/**
 * 通用工具函数：DOM 等待、可见性检测、节流、随机延迟
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod01_util) return;
  ZHS.__mod01_util = true;

  const Util = {
    /** 睡眠 */
    sleep(ms) { return new Promise((r) => setTimeout(r, ms)); },

    /** 随机延迟 [min, max] 秒 → 毫秒 */
    randomDelay(minSec, maxSec) {
      const min = Math.max(0, Number(minSec) || 0) * 1000;
      const max = Math.max(min, (Number(maxSec) || 0) * 1000);
      return Util.sleep(min + Math.random() * (max - min));
    },

    /** 节流：立即执行首次，之后间隔 ms 执行 */
    throttle(fn, ms) {
      let last = 0;
      let timer = null;
      return function (...args) {
        const now = Date.now();
        const remain = ms - (now - last);
        if (remain <= 0) {
          last = now;
          fn.apply(this, args);
        } else if (!timer) {
          timer = setTimeout(() => {
            last = Date.now();
            timer = null;
            fn.apply(this, args);
          }, remain);
        }
      };
    },

    /** 防抖 */
    debounce(fn, ms) {
      let timer = null;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
      };
    },

    /** 元素是否真实可见（宽高 > 0 且不透明度 > 0.05） */
    isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const opacity = Number.parseFloat(style.opacity || '1');
      if (!(opacity > 0.05)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },

    /**
     * 结构可见性：只排除 display:none / visibility:hidden / opacity:0，
     * 不要求有尺寸。
     *
     * 为什么要两个判定：
     *  - isVisible 用于「必须真能点到」的场景（比如按钮）
     *  - isStructurallyVisible 用于「元素存在即算出现」的场景（比如弹题容器），
     *    因为智慧树有些容器在特定布局下尺寸暂时为 0，但内容已经渲染好了，
     *    用 isVisible 会误判成"没出现"，导致弹题漏处理。
     */
    isStructurallyVisible(el) {
      if (!el) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const opacity = Number.parseFloat(style.opacity || '1');
      if (!(opacity > 0.05)) return false;
      return true;
    },

    /** 选择器组中是否有任一结构可见元素 */
    hasStructurallyVisible(selector) {
      const list = document.querySelectorAll(selector);
      for (const el of list) {
        if (Util.isStructurallyVisible(el)) return true;
      }
      return false;
    },

    /** 选择器组中是否有任一可见元素 */
    hasVisible(selector) {
      const list = document.querySelectorAll(selector);
      for (const el of list) {
        if (Util.isVisible(el)) return true;
      }
      return false;
    },

    /** 等待元素出现 */
    async waitFor(selector, timeoutMs = 20000, interval = 300) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const el = document.querySelector(selector);
        if (el) return el;
        await Util.sleep(interval);
      }
      return null;
    },

    /**
     * 跨「同域 iframe」查找 video 元素
     *
     * 智慧树部分页面（尤其新形态/微前端容器）会把播放器嵌在 iframe 里，
     * 顶层 document.querySelector('video') 永远落空 → 脚本判定「无视频」→ 整体不启动，
     * 表现正是用户说的「功能全无用」。
     * 顶层找不到时，递归遍历 iframe 的 contentDocument 找 video；跨域 iframe（取不到）
     * 直接跳过——拿不到控制权就别硬来，至少顶层视频路径不受影响。
     */
    findVideoInIframes(doc) {
      doc = doc || document;
      try {
        const frames = doc.querySelectorAll('iframe');
        for (const f of frames) {
          let idoc = null;
          try { idoc = f.contentDocument || (f.contentWindow && f.contentWindow.document); } catch (e) { idoc = null; }
          if (!idoc) continue;
          const v = idoc.querySelector('video');
          if (v) return v;
          const nested = Util.findVideoInIframes(idoc);   // 嵌套 iframe 递归一层
          if (nested) return nested;
        }
      } catch (e) { /* 安全策略禁止访问 iframe，忽略 */ }
      return null;
    },

    /** 等待选择器组全部不可见（结构判定） */
    async waitUntilHidden(selector, timeoutMs = 600000, interval = 500) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!Util.hasStructurallyVisible(selector)) return true;
        await Util.sleep(interval);
      }
      return false;
    },

    /** 安全取值：带默认值 */
    pick(obj, keys, fallback) {
      for (const k of keys) {
        if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
      }
      return fallback;
    },

    /** 从 URL 提取参数 */
    getUrlParam(name) {
      try {
        const u = new URL(location.href);
        return u.searchParams.get(name);
      } catch (e) {
        const m = location.search.match(new RegExp('[?&]' + name + '=([^&]+)'));
        return m ? decodeURIComponent(m[1]) : null;
      }
    },

    /** 文本归一化（去多余空白） */
    normText(s) {
      return String(s || '').replace(/\s+/g, ' ').trim();
    },

    /** 在元素内按文本查找子元素 */
    findByText(root, selector, keywords) {
      const list = (root || document).querySelectorAll(selector);
      const kws = Array.isArray(keywords) ? keywords : [keywords];
      for (const el of list) {
        const t = Util.normText(el.innerText || el.textContent);
        if (kws.some((k) => t.includes(k))) return el;
      }
      return null;
    },
  };

  ZHS.Util = Util;
})();

/* ===== 02-adapter.js ===== */
/**
 * 适配层：自动识别智慧树页面版本，提供统一的目录访问接口
 *
 * 智慧树有 5 套并存的页面结构（wisdom / fusion / hike / legacy / card2025），
 * 本模块把它们统一成同一组方法，上层业务代码无需关心版本差异。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod02_adapter) return;
  ZHS.__mod02_adapter = true;
  const U = ZHS.Util;

  /**
   * 目录适配器定义
   * - item       章节条目选择器
   * - active     当前项选择器
   * - finish     完成标识选择器（存在即已完成）
   * - title      课时名选择器
   * - progress   进度值选择器（可选）
   * - progressAttr 进度属性名（有则读属性，无则读文本）
   */
  const ADAPTERS = {
    wisdom: {
      name: 'wisdom',
      label: '智慧版共享课',
      item: '.child-info.hasvideo',
      active: '.child-info.hasvideo.current',
      finish: '.child-check',
      title: '.child-name',
      progress: '[role="progressbar"][aria-valuenow]',
      progressAttr: 'aria-valuenow',
      container: '.chapter-tree-74',
      courseTitle: '.course-name',
      locked: '.lock-icon, .icon-lock, [class*="lock"]',
    },
    fusion: {
      name: 'fusion',
      label: 'AI助教翻转课',
      item: '.chapter-content-second',
      active: '.chapter-content-second.current',
      finish: '.finish-icon',
      title: '.item-name',
      container: '.chapter-content',
      courseTitle: '.course-name',
      locked: '[class*="lock"]',
    },
    hike: {
      name: 'hike',
      label: '新形态课',
      item: '.file-item',
      active: '.file-item.active',
      activeClass: 'active',
      finish: '.icon-finish',
      title: 'span[title]',
      progress: '.rate',
      container: '.el-tree',
      courseTitle: '.course-name',
      locked: '.el-icon-lock, [class*="lock"]',
    },
    legacy: {
      name: 'legacy',
      label: '旧版共享课',
      item: '.clearfix.video',
      active: '.clearfix.video.current_play',
      finish: '.time_icofinish',
      // 旧版共享课的课时名：OCS getChapterName 用 .catalogue_title，
      // 老页面里还写作 <span id="lessonOrder">。两个都写，命中谁算谁。
      title: '#lessonOrder, .catalogue_title',
      progress: '.progress-num',
      container: '.clearfix',
      courseTitle: '.source-name',
      locked: '[class*="lock"]',
    },
    card2025: {
      name: 'card2025',
      label: '2025新版卡片式',
      item: '[class*="card-container"]',
      active: '[class*="card-container"].active',
      finish: '.finished-icon',
      title: '.video-title, .common-text',
      container: '.section-item-collapse-info',
      courseTitle: '.header-title-wrap',
      locked: '[class*="lock"]',
    },
    // polymas 系（智慧树新形态教学中心，Vue3 + Aliplayer）
    polymas: {
      name: 'polymas',
      label: '智慧树·AI课程中心',
      item: '[class*="course-node"], [class*="chapter-item"], .catalog-item, [class*="lesson-item"]',
      active: '[class*="course-node"].active, [class*="chapter-item"].active, .catalog-item.active, [class*="lesson-item"].active',
      activeClass: 'active',
      // 【2026-09-19 修正】原来是裸通配 `[class*="done"]`，而 isFinished 的第 1 层
      // 是「命中即完成」、不设任何形态约束。polymas 一旦当选，外层容器
      // （lesson-done-wrap / study-finish-box 之类）会让整目录瞬间全判完成 → allDone 停摆。
      // 这里收紧成图标型元素，把误伤堵在源头。
      finish: 'i[class*="finish"], i[class*="done"], i[class*="complete"], span[class*="finish"], span[class*="done"], [class*="finish-icon"], [class*="done-icon"], .is-finish, .is-done',
      title: '[class*="title"], span[title]',
      progress: '[class*="progress"], [role="progressbar"]',
      container: '#main',
      courseTitle: '[class*="course-name"], [class*="title"]',
      locked: '[class*="lock"], [class*="disabled"]',
    },
  };

  /**
   * 通用兜底扫描器（适配器选择器全部落空时启用）
   *
   * 思路：不猜具体类名，而是从「结构特征」反推哪些元素像课程目录条目：
   *   1. 兄弟节点成群（≥3 个同构兄弟）→ 像列表
   *   2. 每个节点里有可读文本（课时名）
   *   3. 节点不是纯容器（自身文本占比不能太低，太高则是大容器）
   *   4. 优先取「文本长度适中（2~60 字）」且可点击的节点
   *
   * 这样即使 polymas 改版换类名，也能捞到目录。
   */
  function sniffItems() {
    const out = [];
    const seen = new Set();

    // 候选容器：页面上所有元素，按「子元素数量」筛出像列表的
    const all = document.querySelectorAll('div, li, a');
    const groups = new Map();   // key = 父节点，value = 子节点数组

    for (const el of all) {
      const parent = el.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(el);
    }

    for (const [, kids] of groups) {
      if (kids.length < 3) continue;                 // 少于 3 个不成列表
      // 同构判定：标签名 + class 主体一致
      const sig = (el) => el.tagName + '|' + String(el.className || '').split(/\s+/).slice(0, 2).join('.');
      const sigs = new Set(kids.map(sig));
      if (sigs.size > 2) continue;                   // 结构太杂，不像同级列表

      for (const el of kids) {
        if (seen.has(el)) continue;
        const txt = U.normText(el.innerText || el.textContent);
        if (!txt) continue;
        if (txt.length < 2 || txt.length > 80) continue;   // 太短不可能是课时名，太长是大容器
        // 排除明显是导航/表单的
        if (/登录|注册|首页|我的|设置|退出/.test(txt) && txt.length < 8) continue;
        seen.add(el);
        out.push(el);
      }
    }

    // 按 DOM 顺序返回，保证「下一节」的方向正确
    return out.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  /**
   * 域名权重提示（不再是「一锤定音」的硬路由）
   *
   * 【2026-09-18 二次修正】我一度把 studyvideoh5 的 hike（.file-item）置顶，
   * 依据是 GreasyFork 上一个脚本 gf558335；但更权威的 OCS（ocsjs-zhs.ts:81/139/825）
   * 明确写着 StudyVideoH5 用的是 .clearfix.video（legacy），
   * 而 .file-item 只出现在「校内课 xnk-study」（同文件 1520/1551 行）。
   * gf558335 的 @match 是全站通配 *://*.zhihuishu.com/*，它在校内课能跑，
   * 不代表 studyvideoh5 也是这套结构——这条证据我当时误归属了。
   *
   * 根子上的问题是：**按域名硬写优先级这件事本身就不可靠**，平台随时改版，
   * 昨天的答案今天就变成坑（用户反馈「功能全无用」正是这么来的）。
   * 所以这里降级为「加分项」，真正拍板交给 detect() 的评分选举：
   * 谁命中得多、谁能定位到「当前项」，谁上。
   */
  function hostBonus(name) {
    const host = location.hostname;
    if (host.includes('polymas.com')) return name === 'polymas' ? 5 : 0;
    if (host === 'hike.zhihuishu.com') return name === 'hike' ? 5 : 0;
    if (host.includes('fusioncourseh5')) return name === 'fusion' ? 5 : 0;
    if (host.includes('studywisdomh5')) return name === 'card2025' ? 5 : 0;
    if (host.includes('studyplush5')) return name === 'wisdom' ? 5 : 0;
    // studyvideoh5：给 legacy（ocsjs 权威）与 wisdom（Autovisor 默认兜底）加分。
    // 【2026-09-18 三次修正】这里原本给 hike 也加 3 分，但 Autovisor 是独立于 ocsjs 的
    // 第二个信源，它在 modules/lesson_navigation.py:84-85 把 .file-item 硬锁在 hike 域
    // （`if "hike.zhihuishu.com" in course_url: return (HIKE_CATALOG,)`，单元素元组），
    // studyvideoh5 走 :88 的 (WISDOM, LEGACY, FUSION) 兜底，hike 压根不在候选里。
    // 两个独立项目在同一件事上结论一致 → 给 hike 加分是错的。
    // 注意：hike 拿 0 分但**不退出候选池**，仍参与评分选举 —— 万一将来真改版成 el-tree，
    // 评分照样能把它选上来，不会静默失效。这才叫"不赌，也不封闭"。
    if (host.includes('studyvideoh5')) return (name === 'legacy' || name === 'wisdom') ? 3 : 0;
    return name === 'wisdom' ? 2 : 0;
  }

  /** 候选池：顺序只作同分时的稳定 tie-break，不再代表优先级 */
  function candidates() {
    return [ADAPTERS.legacy, ADAPTERS.hike, ADAPTERS.wisdom, ADAPTERS.fusion, ADAPTERS.card2025, ADAPTERS.polymas];
  }

  /**
   * 给一套适配器打分，越高越像「当前页面真正的目录」
   * 评分维度（按可信度从强到弱）：
   *   1. 能定位到「当前项」（active / current_play）——+100，这种组合只有真目录才有，
   *      正是它防住了「某套选择器碰巧在页面别处存在 → 抢占识别」的老 bug
   *   2. 命中专属容器（.el-tree / .chapter-tree-74 等）——+20，页面骨架对得上
   *   3. 命中条目数（30 封顶）——每条 +1
   *   4. 条目能读出课时名——每条 +2，防止命中一堆空壳节点
   */
  function scoreAdapter(ad) {
    let list = [];
    try { list = Array.from(document.querySelectorAll(ad.item)); } catch (e) { return -1; }
    if (!list.length) return 0;

    let score = Math.min(list.length, 30);
    // 1. 能找到「当前项」是最强信号，但有两个前提，否则会翻车：
    //    (a) active 元素必须是本套 item 命中的节点之一 —— 页面别处一个 .active 不该给它加满分
    //    (b) 该节点要真的可见 —— 上一段残留的、display:none 的旧容器不该拿满分
    //    （旧写法用全页 querySelector 找 active，两套 DOM 并存时公式会塌缩成「只比谁节点多」）
    try {
      if (ad.active) {
        const actives = Array.from(document.querySelectorAll(ad.active));
        const inList = actives.filter((a) => list.some((el) => el === a || el.contains(a)));
        if (inList.some((a) => U.isVisible(a))) score += 100;
        else if (inList.length) score += 40;   // 命中但不可见：降权，不作数
      }
    } catch (e) { /* 选择器兼容 */ }
    try { if (ad.container && document.querySelector(ad.container)) score += 20; } catch (e) { /* 选择器兼容 */ }

    let titled = 0;
    for (const el of list.slice(0, 30)) {
      const t = U.normText(el.innerText || el.textContent);
      if (t && t.length >= 2 && t.length <= 80) titled++;
    }
    score += titled * 2;
    score += hostBonus(ad.name);
    return score;
  }

  /** 轮询等待条件成立（SPA 异步切换的通用等待器） */
  async function waitUntil(fn, timeoutMs, interval) {
    const deadline = Date.now() + timeoutMs;
    interval = interval || 150;
    while (Date.now() < deadline) {
      let hit = false;
      try { hit = !!fn(); } catch (e) { hit = false; }
      if (hit) return true;
      await U.sleep(interval);
    }
    return false;
  }

  /**
   * 自动展开折叠的目录树 ——【2026-09-18 实地修正】
   * 痛点：新版页面目录是 el-tree，章节默认折叠时目标课时根本不在 DOM 里，
   * 于是「点了也没用」：脚本找不到下一节，即便找到也点不动一个不存在的节点。
   * 这里在每次取目录之前，把没展开的章节全部点开。
   */
  const expandTreeOnce = U.throttle(function () {
    let opened = 0;
    try {
      document.querySelectorAll('.el-tree-node__expand-icon:not(.is-leaf)').forEach((icon) => {
        const expanded = icon.classList.contains('expanded')
          || icon.getAttribute('aria-expanded') === 'true';
        if (!expanded) { icon.click(); opened++; }
      });
    } catch (e) { /* 展开失败不影响主流程 */ }
    if (opened > 0) ZHS.Log.info('已自动展开 ' + opened + ' 个折叠章节');
    return opened;
  }, 2000);

  /**
   * 条目状态枚举
   *   done   已完成
   *   undone 未完成（可点，需要看）
   *   locked 未解锁（点不了，前置没完成）
   *   na     不是可播放条目（纯目录/章节标题）
   */
  const STATUS = { DONE: 'done', UNDONE: 'undone', LOCKED: 'locked', NA: 'na' };

  /**
   * 探测当前页面用哪套适配器
   *
   * 【2026-09-18 修正】原来是「候选里第一个 querySelector 命中 1 个就算成功」，
   * 这是导致用户「功能全无用」的直接原因之一：任何一套选择器只要碰巧在页面别处
   * 存在一两个同名节点，就会抢占成功，真目录被顶掉，后续全部操作打在空气上。
   * 现在改为评分选举：全部候选各打一次分，取最高且 >0 者。
   */
  function detect() {
    let best = null;
    let bestScore = 0;
    const detail = [];
    for (const ad of candidates()) {
      const s = scoreAdapter(ad);
      if (s > 0) detail.push(ad.name + '=' + s);
      if (s > bestScore) { bestScore = s; best = ad; }
    }
    if (best) {
      ZHS.state.siteVersion = best.name;
      ZHS.Log.info('页面版本识别为：' + best.label + ' (' + best.name + ')，评分 ' + bestScore
        + (detail.length > 1 ? '；候选评分 ' + detail.join(' / ') : ''));
      return best;
    }
    ZHS.state.siteVersion = 'unknown';
    ZHS.Log.warn('未能识别页面版本，将使用通用兜底策略');
    return ADAPTERS.wisdom; // 兜底
  }

  /**
   * 目录操作 API
   */
  const Catalog = {
    _ad: null,

    get adapter() {
      if (!this._ad) this._ad = detect();
      return this._ad;
    },

    /** 强制重新探测（SPA 切页后调用） */
    redetect() { this._ad = null; return this.adapter; },

    /** 课程唯一标识 */
    getCourseId() {
      // 路径解析优先：polymas AI 课程学习页形如 /AIstudent/{courseId}/{lessonId}?key=…
      // 此前只查 query/hash，学习页恒返回 'unknown-course'，导致断点 key 串台、去重失效（round-7 H2）
      const pm = location.pathname.match(/\/AIstudent\/([^/?#]+)/);
      if (pm && pm[1]) return pm[1];
      return U.pick(
        {
          a: U.getUrlParam('recruitAndCourseId'),
          b: U.getUrlParam('courseId'),
          c: U.getUrlParam('recruitId'),
        },
        ['a', 'b', 'c'],
        null
      ) || (location.hash.match(/courseId[=\/](\w+)/) || [])[1]
      // round-12：URL 全空时的兜底链——优先用课程中心进入时记录的真实课程 id（hubKey），
      // 再退而求其次读 DOM 上的 data-course-id；避免长期返回 'unknown-course' 导致断点串台、自动跳课去重失效。
      || (ZHS.state && ZHS.state.hubKey) || (function () {
        const el = document.querySelector('[data-course-id]');
        return el ? el.getAttribute('data-course-id') : null;
      })() || 'unknown-course';
    },

    /** 课程名 */
    getCourseName() {
      const el = document.querySelector(this.adapter.courseTitle);
      return el ? U.normText(el.innerText || el.textContent) : '';
    },

    /** 所有章节条目 */
    items() {
      expandTreeOnce(); // 先把折叠章节展开，否则折叠中的课时不在 DOM 里，取不到也点不到
      const list = Array.from(document.querySelectorAll(this.adapter.item));
      // hike 版过滤掉目录树中间节点（有子节点的不是叶子）
      if (this.adapter.name === 'hike') {
        return list.filter((el) => {
          const node = el.closest('.el-tree-node');
          if (!node) return true;
          const children = node.querySelector('.el-tree-node__children');
          return !children || children.children.length === 0;
        });
      }
      // 预设选择器全落空 → 启用通用兜底扫描（应对平台改版/新域名）
      if (!list.length) {
        const sniffed = sniffItems();
        if (sniffed.length) {
          if (!this._sniffed) {
            this._sniffed = true;
            ZHS.Log.warn('预设选择器未命中，已启用结构兜底扫描，捞到 ' + sniffed.length + ' 个候选条目');
          }
          return sniffed;
        }
      }
      return list;
    },

    /** 当前播放的条目 */
    current() {
      const ad = this.adapter;
      // round-15【D3】：active 查询必须限定在目录容器内。
      // 原先用 document.querySelector(ad.active) 全局查，只要页面别处（播放器控制条、
      // 顶部导航、其他 tab）恰有带 active/current 类且标题文本又碰巧等于目标节的元素，
      // 就会把「当前播放项」判成它 —— 于是 nowIsTarget()/_stillOnFrom() 全部跟着错，
      // 「假成功」从另一侧回流（切错节也判成功、完成计数虚增）。
      let cur = null;
      try {
        const scope = (ad.container && document.querySelector(ad.container)) || document;
        cur = scope.querySelector(ad.active);
      } catch (e) { /* 选择器兼容：失败则回落全局 */ }
      if (!cur) {
        try { cur = document.querySelector(ad.active); } catch (e) { /* 选择器兼容 */ }
      }
      // round-15【D3 强化】：命中的元素必须确实是目录条目之一，否则不算「当前播放项」。
      // 这挡住「页面别处有同名 active 元素」的最后一种漏网情形。
      if (cur) {
        const list = this.items();
        const isItem = list.some((el) => el === cur || el.contains(cur) || cur.contains(el));
        if (isItem) return cur;
      }
      // 兜底：用 lessonKey 文本匹配
      const key = ZHS.state.lessonKey;
      if (key) {
        return this.items().find((el) => this.itemTitle(el) === key) || null;
      }
      return null;
    },

    /** 取条目名称 */
    itemTitle(el) {
      if (!el) return '';
      const ad = this.adapter;
      const readTxt = (n) => {
        if (!n) return '';
        const attr = n.getAttribute && n.getAttribute('title');
        if (attr) return U.normText(attr);
        return U.normText(n.innerText || n.textContent);
      };
      // 纯序号（如 legacy 的 #lessonOrder 只写了 "1.2"）不算课时名
      const onlyNumber = (s) => !s || /^[\d.\s]*$/.test(s);

      const t = readTxt(el.querySelector(ad.title));
      if (!onlyNumber(t)) return t;

      // 回退：在通用课时名容器里找第一个像名字的文本
      const FALLBACK = '.catalogue_title, .video-name, .item-name, .child-name, .file-name, .time, [class*="title"], span[title]';
      try {
        for (const n of Array.from(el.querySelectorAll(FALLBACK))) {
          const s = readTxt(n);
          if (!onlyNumber(s) && s.length >= 2) return s;
        }
      } catch (e) { /* 忽略 */ }
      return U.normText(el.innerText || el.textContent).slice(0, 80);
    },

    /**
     * 条目是否已完成
     * 完成判定的「金标准」是平台在章节列表（用户侧栏/右侧栏）打的完成标记（对勾/已完成图标）。
     * 仅靠视频进度条判断会出问题：视频放完但平台进度条还停在 99% 时，会误判「没看完」→ 重播而非跳节。
     * 所以优先级：专属完成标记 > 通用完成标记（覆盖各版本 class 变体）> 文本"已完成/已学完" > 进度 100%。
     */
    isFinished(el) {
      if (!el) return false;
      const ad = this.adapter;
      try {
        // 1. 适配器专属完成标记（如 wisdom 的 .child-check / legacy 的 .time_icofinish）
        if (ad.finish && el.querySelector(ad.finish)) return true;
        // 1b. 标记打在 el 自身（1 @346 只有 querySelector 版本）
        if (ad.finish && el.matches && el.matches(ad.finish)) return true;
      } catch (e) { /* 选择器兼容 */ }
      // 2. 条目自身带完成态 class（如 .file-item.done）
      try {
        if (/\b(done|finished|completed|is-finish|is-finished|study-done|learned)\b/i.test(String(el.className || ''))) return true;
      } catch (e) { /* 忽略 */ }
      // 3. 通用完成标记：必须是「图标型」节点才认
      //    【2026-09-18 修正】原来只要子树里任一元素 class 含 finish/done/complete 就算完成。
      //    太宽了：外层容器常叫 "lesson-done-wrap" / "study-finish-box"，一命中就把整条目判成已完成，
      //    后果是 findNext 找不到「未完成」的节 → 直接弹「全部看完」白屏停止。
      //    现在限定两种才算：标签是图标类，或该节点本身就是叶子（没有子元素）。
      try {
        const BADGE = '[class*="finish"], [class*="done"], [class*="complete"], [class*="learned"], [class*="studied"], [class*="checkmark"], [class*="is-finish"]';
        for (const n of Array.from(el.querySelectorAll(BADGE))) {
          const tag = String(n.tagName || '').toLowerCase();
          if (/^(i|span|em|img|svg|b|strong)$/.test(tag)) return true;
          if (!n.firstElementChild) return true;   // 空壳容器，可能就是那个勾
        }
      } catch (e) { /* 选择器兼容 */ }
      // 3. 子元素文本兜底（有时完成标记是「已学完」三个字而非图标）
      // 【2026-09-18 修正】原来是 `/…|100\s*%/` 包含匹配 + 单独的「进度>=100 也算完成」：
      // 「100% 学习完成」这种进度说明也会命中，下一节的 100% 也会被误判为已完成；
      // 但视频看完时平台侧常常仍停在 99%，以 100 为门槛会直接卡住不跳。
      // 故改为：只认独立文本 /^(\d{1,3})%$/，且阈值取 FINISH_PCT —— 由平台自己的低位值决定，不是拍脑袋。
      const FINISH_PCT = 98;
      const t = U.normText(el.innerText || el.textContent);
      if (/(已完成|已学完|已学习|学完|已看完)/.test(t)) return true;
      if (!ad.progress) {
        // 该套适配器没有进度选择器 → 只能靠文本百分比（取紧凑纯进度文本）
        const m = t.match(/^\s*(\d{1,3})\s*%\s*$/);
        if (m && Number(m[1]) >= FINISH_PCT) return true;
        return false;
      }
      const pct = this._readProgress(el);
      return pct >= FINISH_PCT;
    },

    /** 纯读进度值（不做完成态判断，避免与 isFinished 相互递归） */
    _readProgress(el) {
      const ad = this.adapter;
      if (!el || !ad.progress) return 0;
      let p = null;
      try { p = el.querySelector(ad.progress); } catch (e) { return 0; }
      if (!p) return 0;
      let raw = ad.progressAttr ? p.getAttribute(ad.progressAttr) : (p.innerText || p.textContent);
      raw = String(raw || '0').replace('%', '').trim();
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    },

    /** 条目是否未解锁 */
    isLocked(el) {
      if (!el) return false;
      const ad = this.adapter;
      // 1. 元素自身或内部有锁图标
      if (ad.locked) {
        try {
          if (el.matches && el.matches(ad.locked)) return true;
          if (el.querySelector(ad.locked)) return true;
        } catch (e) { /* 忽略非法选择器 */ }
      }
      // 2. disabled / 不可点 属性
      if (el.getAttribute) {
        if (el.getAttribute('disabled') != null) return true;
        if (el.getAttribute('aria-disabled') === 'true') return true;
        if (el.getAttribute('data-locked') === 'true') return true;
      }
      // 3. 样式：pointer-events:none 或 明显的禁用态类名
      try {
        const cls = String(el.className || '');
        if (/\b(disabled|is-disabled|lock|locked|forbid|no-permission)\b/i.test(cls)) return true;
      } catch (e) { /* 忽略 */ }
      // 4. 文本兜底
      const txt = U.normText(el.innerText || el.textContent);
      if (/未解锁|不可学习|暂无权限/.test(txt)) return true;
      return false;
    },

    /**
     * 三态判定
     * @returns 'done' | 'undone' | 'locked' | 'na'
     */
    statusOf(el) {
      if (!el) return STATUS.NA;
      if (this.isFinished(el)) return STATUS.DONE;
      if (this.isLocked(el)) return STATUS.LOCKED;
      // 有标题且能点到 → 未完成
      const t = this.itemTitle(el);
      if (!t) return STATUS.NA;
      return STATUS.UNDONE;
    },

    /**
     * 全量扫描：给每个条目打状态（面板/报告用）
     * @returns [{ index, title, status, progress, element }]
     */
    scan() {
      return this.items().map((el, i) => ({
        index: i,
        title: this.itemTitle(el),
        status: this.statusOf(el),
        progress: this.progressOf(el),
        element: el,
      }));
    },

    /** 统计三态数量 */
    breakdown() {
      this.ensureCatalogLoaded();   // 补全虚拟滚动目录，避免漏算未完成节而误判「全部看完」
      const list = this.scan();
      const out = { total: 0, done: 0, undone: 0, locked: 0, na: 0 };
      for (const it of list) {
        out.total++;
        out[it.status] = (out[it.status] || 0) + 1;
      }
      out.percent = out.total ? Math.round((out.done / out.total) * 100) : 0;
      out.allDone = out.total > 0 && out.undone === 0;
      return out;
    },

    /** 条目进度百分比 0-100（优先读真实进度条，已完成直接 100） */
    progressOf(el) {
      if (!el) return 0;
      if (this.isFinished(el)) return 100;
      return this._readProgress(el);
    },

    /**
     * 找下一个「未完成且未锁」的条目
     * 策略：当前位置往后找 → 找不到则从头补漏
     * 跳过 done（已完成）和 locked（未解锁，点了也没用）
     */
    findNext(fromEl) {
      // 第一轮：基于「当前已渲染的 DOM 快照」查找
      let all = this.items();
      if (!all.length) return null;

      const pickable = (el) => this.statusOf(el) === STATUS.UNDONE;

      let startIdx = 0;
      if (fromEl) {
        const i = all.indexOf(fromEl);
        if (i >= 0) startIdx = i + 1;
      }
      // 1. 当前之后
      for (let i = startIdx; i < all.length; i++) {
        if (pickable(all[i])) return all[i];
      }
      // 2. 从头补漏（前面可能有跳过的）
      for (let i = 0; i < Math.min(startIdx, all.length); i++) {
        if (pickable(all[i])) return all[i];
      }

      // 【round-5 修复 · 对应「不能跳转下一集」候选根因】
      // 第一轮没找到 → 目录可能是「虚拟滚动」，后面的未完成课时根本还没渲染进 DOM。
      // 主动触发懒加载把目录补全，再按同样逻辑找一次。
      this.ensureCatalogLoaded();
      all = this.items();
      if (fromEl) {
        const i = all.indexOf(fromEl);
        if (i >= 0) startIdx = i + 1;
      }
      for (let i = startIdx; i < all.length; i++) {
        if (pickable(all[i])) return all[i];
      }
      for (let i = 0; i < Math.min(startIdx, all.length); i++) {
        if (pickable(all[i])) return all[i];
      }
      return null;
    },

    /** 所有待学条目（未完成 + 未锁） */
    pending() {
      return this.items().filter((el) => this.statusOf(el) === STATUS.UNDONE);
    },

    /** 找指定名称的条目 */
    findByName(key) {
      if (!key) return null;
      const all = this.items();
      // 精确匹配优先
      let hit = all.find((el) => this.itemTitle(el) === key);
      if (hit) return hit;
      // 包含匹配兜底
      hit = all.find((el) => this.itemTitle(el).includes(key) || key.includes(this.itemTitle(el)));
      return hit || null;
    },

    /**
     * 条目是否处于「当前播放」状态
     * 不单看适配器的 active 选择器（平台一改版就失效），而是三层判定：
     *   1. 元素自身 class 出现 active / current_play / current / is-active / selected
     *   2. 元素匹配适配器 active 选择器
     *   3. 页面上唯一的「当前项」就是它（或互为包含关系）
     */
    hasActive(el) {
      if (!el) return false;
      const ad = this.adapter;
      let rawClass = '';
      try {
        rawClass = String((el.className && el.className.baseVal !== undefined) ? el.className.baseVal : (el.className || ''));
      } catch (e) { rawClass = ''; }
      const cls = rawClass.split(/\s+/);
      // 1. 本套专属的「当前项」标记（如 legacy 的 current_play、hike 的 active）
      if (ad.activeClass && cls.indexOf(ad.activeClass) >= 0) return true;
      // 2. 通用词兜底（Element UI 的 is-current / 播放器 playing 等）
      if (cls.some((c) => /^(active|current_play|current-play|current|is-active|is-current|selected|playing)$/i.test(c))) {
        return true;
      }
      try { if (ad.active && el.matches && el.matches(ad.active)) return true; } catch (e) { /* 选择器兼容 */ }
      try {
        // round-14【P4】：限定在目录容器内查询，而不是整个 document。
        // 原先 document.querySelector(ad.active) 会命中页面别处任意带 active 的容器
        // （如播放器控制条、其他 tab），只要与 el 存在祖先/包含关系就误判为「当前项」，
        // 造成「0 毫秒假成功」。收窄到 adapter.container 内可基本消除这类误判。
        const scope = (ad.container && document.querySelector(ad.container)) || document;
        const cur = ad.active ? scope.querySelector(ad.active) : null;
        if (cur && (cur === el || el.contains(cur) || cur.contains(el))) return true;
      } catch (e) { /* 选择器兼容 */ }
      return false;
    },

    /**
     * 点击条目（真正触发切换）
     *
     * 【2026-09-18 修正】原来「优先点内部 a / span[title]」这一步是错的：
     * Vue 的点击监听绑在目录条目本体（.file-item / .clearfix.video）上，
     * 点内部一个纯展示用的 span/a 不等于点条目，于是「点了没反应」。
     * 成熟实现（OCS 的 StudyVideoH5 条目点击）都是直接点条目本体。
     * 另外补一步 scrollIntoView：部分页面条目不在视口内时不响应点击。
     */
    click(el) {
      if (!el) return false;
      try {
        if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (e) { /* 滚动失败不影响点击 */ }
      try {
        el.click();
        return true;
      } catch (e) {
        try {
          const inner = el.querySelector('a, .child-name, .item-name, .file-name, span[title]');
          if (inner) { inner.click(); return true; }
        } catch (e2) { /* 放弃 */ }
        ZHS.Log.error('点击章节失败：', e.message);
        return false;
      }
    },

    /**
     * 点击并校验是否真的切过去了
     *
     * 智慧树点目录是 SPA 异步切换，active class 往往晚几百毫秒才落到 DOM，
     * 所以轮询等「目标条目拿到 active」；一直没动静就再点一次
     * （首次点击常被遮罩层/播放器吞掉），两次都不动才判失败。
     * SPA 重渲染还可能把节点换掉（detach），失败后按标题重新定位再点。
     *
     * @returns {Promise<boolean>} 是否确认已切换
     */
    async clickAndVerify(el, opt) {
      opt = opt || {};
      const timeout = opt.timeout || 3000;
      const tries = opt.tries || 2;
      const fromKey = opt.fromKey || null;   // round-14：切换前的课时标识，用第二信号比对
      if (!el) return false;

      const titleKey = this.itemTitle(el);
      let target = el;
      // round-15【D1】：预先记下目标与「切换前那一节」在目录里的索引，供 nowIsTarget 做身份比对
      const _idxOf = (node) => {
        try {
          if (!node) return -1;
          const list = this.items();
          return list.findIndex((it) => it === node || it.contains(node) || node.contains(it));
        } catch (e) { return -1; }
      };
      const fromIdx = fromKey ? _idxOf(this.items().find((it) => this.itemTitle(it) === fromKey)) : -1;

      /**
       * round-14【P4】第二信号：目标条目拿到 active 只是「间接信号」，会双向误判 ——
       *   · 平台不打 active（改版/异步慢）→ 假失败：白等 9s、重复点、凑齐 5 次硬停；
       *   · 页面别处恰有带 active 的容器（全局 querySelector 命中）→ 假成功：0 毫秒判过、完成计数虚增。
       * 这里补一个独立判据：点完之后「目录里当前播放的那一项」必须确实等于目标项。
       * 判据强度取「或」：只要 currentTitle 明确等于目标标题，就算成功（不依赖 active class）。
       */
      const nowIsTarget = () => {
        try {
          const cur = this.current();
          if (!cur) return false;
          // round-15【D1】：优先用「元素身份 / 目录索引」判断，而不是纯标题文本比对。
          // 智慧树「习题讲解」「章节测验」这类同名节很常见：纯标题比对时，
          // 只要第一节被设为 current，目标是第二节也会判成「已切到第二节」→ 假成功、
          // 切错节、完成计数虚增。改用索引比对后可根治。
          const list = this.items();
          const curIdx = list.findIndex((it) => it === cur || it.contains(cur) || cur.contains(it));
          const tgtIdx = list.findIndex((it) => it === target || it.contains(target) || target.contains(it));
          if (curIdx >= 0 && tgtIdx >= 0) {
            if (curIdx === tgtIdx) return true;     // 索引一致 → 确实切到目标
            // 索引不一致且当前项就是切换前那一节 → 明确没切（即便标题同名也不误判）
            if (fromIdx >= 0 && curIdx === fromIdx && curIdx !== tgtIdx) return false;
            return false;                            // 当前项既不是目标也不是原节 → 未切到目标
          }
          // 索引取不到（SPA 换节点/items 未识别）→ 回落标题比对兜底
          const curKey = this.itemTitle(cur);
          if (!curKey) return false;
          if (fromKey && curKey === fromKey && curKey !== titleKey) return false;
          return curKey === titleKey;
        } catch (e) { return false; }
      };

      for (let i = 0; i < tries; i++) {
        // 点击前先确认还没切过去：若上次点击其实已生效（active 只是晚几拍才落到 DOM），
        // 直接判成功即可，避免「重复点击当前节 → 平台重新加载本节」的怪象。
        // round-14：只有「目标已是当前项」才算已生效；仅凭 active 不算（防假成功）。
        if (nowIsTarget()) return true;
        this.click(target);
        // round-15【D2】判据修正：原先写的是 `hasActive(target) && !_stillOnFrom(...)`，
        // 其中 _stillOnFrom 在 fromKey 为空时**恒返回 false**，于是整条判据退化成
        // 「只要目标拿到 active 就算成功」= 第二信号完全失效，假成功/假失败的老问题回流。
        // 现在改成「第二信号（nowIsTarget，基于目录索引的身份比对）为真才算成功」，
        // active 只在第二信号无法判定（目录未识别）时才作为兜底。
        if (await waitUntil(
          () => nowIsTarget() || this._activeOnlyFallback(target, fromKey),
          i === 0 ? timeout : timeout * 2, 150
        )) return true;
        if (nowIsTarget()) return true;
        // 节点被 SPA 换掉 → 按标题重定位
        if (!target.isConnected) {
          const again = this.findByName(titleKey);
          if (!again) return false;
          target = again;
        } else {
          // 同 DOM 节点还在但不是 active，可能点击被遮罩吞掉。下一轮再点前先尝试
          // 按标题重定位（万一 SPA 静默换过节点但 isConnected 仍是 true）。
          const again = this.findByName(titleKey);
          if (again && again !== target) target = again;
        }
      }
      ZHS.Log.warn('点击「' + titleKey + '」' + tries + ' 次仍未见页面切换');
      return false;
    },

    /**
     * round-15【D2】：active 兜底判据 —— 仅在「目录索引完全不可用」时才允许依赖 active。
     *
     * 为什么需要兜底：某些页面 items() 识别不到（改版/未进播放页），此时基于索引的
     * nowIsTarget 恒为 false，若只认它就会「明明切过去了却判失败」→ 白等 + 重复点 + 硬停。
     * 但兜底必须比原来严格：光有 active 不够，还得确认「当前项已不是切换前那一节」，
     * 否则回绕/同名节场景仍会假成功。
     */
    _activeOnlyFallback(target, fromKey) {
      try {
        if (!target || !this.hasActive(target)) return false;
        // 目录索引可用时不许走兜底（交给更可靠的 nowIsTarget 判定）
        const list = this.items();
        const tgtIdx = list.findIndex((it) => it === target || it.contains(target) || target.contains(it));
        if (tgtIdx >= 0) return false;
        // 有 fromKey 时必须确认已离开原节
        if (fromKey) {
          const cur = this.current();
          if (cur) {
            const curKey = this.itemTitle(cur);
            if (curKey && curKey === fromKey) return false;
          }
        }
        return true;
      } catch (e) { return false; }
    },

    /**
     * round-14【P4 辅助】：判定「是否仍停在切换前那一节」。
     * 用第二信号（当前项标题）做交叉校验，避免仅凭 active 判成功。
     * 场景：目标条目拿到 active，但当前项其实还是 fromKey（回绕/误判）→ 不能算成功。
     */
    _stillOnFrom(fromKey, targetKey) {
      if (!fromKey) return false;
      try {
        const cur = this.current();
        if (!cur) return false;
        const curKey = this.itemTitle(cur);
        return !!curKey && curKey === fromKey && curKey !== targetKey;
      } catch (e) { return false; }
    },

    /** 全部章节完成度统计 */
    /**
     * 列出当前页面里「可滚动且内容溢出」的目录容器
     * 优先用适配器的 container 选择器，否则用一组常见目录滚动容器兜底。
     * jsdom / 无布局环境下 scrollHeight、clientHeight 均为 0，不会命中任何容器，安全降级。
     */
    _scrollContainers() {
      const sel = (this.adapter && this.adapter.container)
        || '.catalog-scroll, .video-catalog-scroll, .el-scrollbar__wrap, [class*="catalog"], [class*="Catalog"], .chapter-list, .course-catalog';
      return Array.from(document.querySelectorAll(sel))
        .filter((el) => el.scrollHeight > el.clientHeight + 4);
    },

    /**
     * 触发目录的虚拟滚动/懒加载，把「还没滚到视口、不在 DOM 里」的课时加载出来。
     *
     * 【round-5 修复 · 对应「不能跳转下一集」候选根因】
     * 之前 findNext / breakdown 只基于「当前已渲染的 DOM 快照」查找。智慧树部分课程
     * 目录是虚拟滚动：未滚动到的课时根本不在 DOM 里，于是 findNext 永远找不到后面的
     * 未完成节，表现就是「点了下一节也没用 / 不能自动跳下一集」。
     *
     * 做法：对可滚动容器反复滚到底部，触发平台分批渲染；每滚一次重新统计条目数，
     * 直到不再增长（到底或静态目录）为止。用 _catalogLoaded / _loadAttempts 双重闸门，
     * 避免异步渲染漏抓后永久关闭补全，也防止无限抖动。
     */
    ensureCatalogLoaded() {
      if (this._catalogLoaded) return;
      this._loadAttempts = (this._loadAttempts || 0) + 1;
      if (this._loadAttempts > 6) { this._catalogLoaded = true; return; }  // 安全上限，避免死循环
      const boxes = this._scrollContainers();
      let grew = false;
      for (const box of boxes) {
        let guard = 0;
        while (guard++ < 60) {
          const before = this.items().length;
          // 往复滚动，制造多次 scroll 事件以触发分批异步渲染
          try {
            box.scrollTop = box.scrollHeight;
            box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight - 1);
            box.scrollTop = box.scrollHeight;
          } catch (e) { /* 某些环境 scrollTop 只读，忽略 */ }
          const after = this.items().length;
          if (after > before) grew = true;
          else break;  // 不再增长 → 到底或静态，停止本轮
        }
      }
      if (grew) ZHS.Log.info('虚拟滚动目录已触发懒加载，目录条目已补全');
      // 本轮仍有增长 → 保持未锁定，下次 findNext/breakdown 会继续补全；
      // 不再增长 → 标记完成，停止滚动。
      this._catalogLoaded = !grew;
    },

    /** 切课 / SPA 重载后清空目录加载缓存，下一门课重新触发懒加载 */
    resetCatalogCache() {
      this._catalogLoaded = false;
      this._loadAttempts = 0;
      this._sniffed = false;
    },

    stats() {
      this.ensureCatalogLoaded();   // 补全虚拟滚动目录，进度统计才准确
      const all = this.items();
      const done = all.filter((el) => this.isFinished(el)).length;
      return { total: all.length, done, percent: all.length ? Math.round((done / all.length) * 100) : 0 };
    },
  };

  ZHS.Catalog = Catalog;
  ZHS.STATUS = STATUS;
})();

/* ===== 03-player.js ===== */
/**
 * 播放层：视频控制（静音、倍速、防暂停、进度回退重试）
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod03_player) return;
  ZHS.__mod03_player = true;
  const U = ZHS.Util;

  // 结尾判定阈值：播放到 99.5% 就算结束
  const END_RATIO = 0.995;
  // 播放卡死阈值：120 秒 currentTime 不推进就判定卡住
  const STALL_MS = 120000;

  const Player = {
    _lastTime: -1,
    _lastActiveAt: Date.now(),
    _retryCount: 0,

    /** 取当前 video 元素（缓存 + 校验是否还在文档里；顶层找不到再查同域 iframe） */
    video() {
      const cached = ZHS.state.videoEl;
      if (cached && document.contains(cached)) return cached;
      let v = document.querySelector('video');
      if (!v && ZHS.Util.findVideoInIframes) v = ZHS.Util.findVideoInIframes(document);
      if (v) ZHS.state.videoEl = v;
      return v;
    },

    /** duration 是否有效 */
    hasValidDuration(v) {
      if (!v) return false;
      return Number.isFinite(v.duration) && v.duration > 0;
    },

    /** 是否播放到结尾 */
    atEnd(v) {
      if (!v) return false;
      if (v.ended) return true;
      if (!this.hasValidDuration(v)) return false;
      return v.currentTime / v.duration >= END_RATIO;
    },

    /** 当前进度百分比 */
    percent(v) {
      if (!this.hasValidDuration(v)) return 0;
      return Math.min(100, Math.round((v.currentTime / v.duration) * 100));
    },

    /** 静音（volume=0 比 muted 属性更稳，平台会重置 muted） */
    mute(v) {
      if (!v) return;
      try {
        v.volume = 0;
        v.muted = true;
        const box = document.querySelector('.volumeBox');
        if (box) box.classList.add('volumeNone');
      } catch (e) { /* 忽略 */ }
    },

    /** 设置倍速（硬上限 1.8） */
    setSpeed(v, speed) {
      if (!v) return;
      const s = Math.min(Math.max(Number(speed) || 1, 0.5), 1.8);
      try {
        if (Math.abs(v.playbackRate - s) > 0.01) v.playbackRate = s;
        // 同步 UI，避免平台检测播放器倍速与界面不一致
        const span = document.querySelector('.speedBox span');
        if (span) span.innerText = 'X ' + s;
      } catch (e) { /* 忽略 */ }
    },

    /**
     * 确保播放：暂停且未结束 → 尝试恢复
     * 返回是否触发了播放
     */
    async ensurePlaying(v) {
      if (!v || v.ended) return false;
      if (!v.paused) { this._markActive(v); return false; }
      if (!this.hasValidDuration(v) && v.currentTime === 0) {
        // 还没加载元数据，等一等
        return false;
      }
      try {
        this.mute(v);                       // 必须静音才能绕过自动播放策略
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
        ZHS.Log.debug('检测到暂停，已尝试恢复播放');
        return true;
      } catch (e) {
        ZHS.Log.debug('恢复播放失败：' + e.message);
        return false;
      }
    },

    /** 检查是否卡死（currentTime 长时间不推进） */
    checkStall(v) {
      if (!v) return false;
      if (v.paused) return false;
      if (v.currentTime > this._lastTime + 0.25) {
        this._lastTime = v.currentTime;
        this._lastActiveAt = Date.now();
        return false;
      }
      const idle = Date.now() - this._lastActiveAt;
      if (idle >= STALL_MS) {
        ZHS.Log.warn('视频 ' + Math.round(idle / 1000) + ' 秒未推进，尝试唤醒');
        this._lastActiveAt = Date.now();
        try { v.play(); } catch (e) { /* 忽略 */ }
        return true;
      }
      return false;
    },

    _markActive(v) {
      if (v && v.currentTime > this._lastTime + 0.25) {
        this._lastTime = v.currentTime;
        this._lastActiveAt = Date.now();
      }
    },

    /** 跳转到指定秒数并播放 */
    async seekTo(v, seconds) {
      if (!v || !Number.isFinite(seconds)) return false;
      try {
        v.currentTime = Math.max(0, seconds);
        v.play();
        return true;
      } catch (e) {
        ZHS.Log.warn('跳转失败：' + e.message);
        return false;
      }
    },

    /**
     * 进度不同步处理：视频放完但平台记录 <100%
     * 回退到平台记录点重播，最多重试 2 次
     */
    async retryFromPlatformProgress(v, platformPercent) {
      if (this._retryCount >= 2) {
        ZHS.Log.warn('进度不同步已重试 2 次仍失败，跳过本课时');
        this._retryCount = 0;
        return false;
      }
      if (!this.hasValidDuration(v)) return false;
      const target = (platformPercent / 100) * v.duration;
      // 【2026-09-18 修正】原来写成 Math.max(0, target - 5)：
      // 当平台记录为 0% 时 back 会变成 0，等于整节从头重播 → 用户被死死卡在这一节，
      // 表现出来就是「永远跳不到下一集」。现在三道闸：
      //   1. 目标点本身 <= 0（平台压根没记录）→ 回退没有意义，直接放弃，交回上层跳下一节
      //   2. 回退 5 秒，但不得早于全片末尾 5 秒之前（避免一退退回开头）
      //   3. 结果必须落在有效区间内
      if (!(target > 0)) {
        ZHS.Log.warn('平台记录为 ' + platformPercent + '%，回退点无效，放弃重播直接跳下一节');
        return false;
      }
      const tailFloor = Math.max(0, v.duration - 5);
      const back = Math.min(Math.max(0, target - 5), tailFloor);
      if (!Number.isFinite(back) || back < 0 || back > v.duration) return false;
      ZHS.Log.warn(
        '视频已结束但平台仅记录 ' + platformPercent + '%，回退到 ' +
        Math.round(back) + 's 重试（第 ' + (this._retryCount + 1) + ' 次）'
      );
      await this.seekTo(v, back);
      this._retryCount++;
      await U.sleep(1000);
      return true;
    },

    resetRetry() { this._retryCount = 0; },
  };

  ZHS.Player = Player;
})();

/* ===== 04-resume.js ===== */
/**
 * 续播层：断点记录与恢复
 *
 * 存储用 GM_setValue（跨 iframe/页面共享，持久化到磁盘），
 * 无 GM 环境降级到 localStorage。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod04_resume) return;
  ZHS.__mod04_resume = true;
  const U = ZHS.Util;

  const STORE_KEY = 'zhs-helper-resume';
  const hasGM = typeof GM_setValue === 'function' && typeof GM_getValue === 'function';

  function readStore() {
    try {
      const raw = hasGM ? GM_getValue(STORE_KEY, null) : localStorage.getItem(STORE_KEY);
      if (!raw) return { courses: {} };
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!obj || typeof obj !== 'object') return { courses: {} };
      if (!obj.courses) obj.courses = {};
      return obj;
    } catch (e) {
      ZHS.Log.warn('续播记录损坏，已重置');
      return { courses: {} };
    }
  }

  function writeStore(store) {
    try {
      const raw = JSON.stringify(store);
      if (hasGM) GM_setValue(STORE_KEY, raw);
      else localStorage.setItem(STORE_KEY, raw);
      return true;
    } catch (e) {
      ZHS.Log.warn('续播记录写入失败：' + e.message);
      return false;
    }
  }

  const Resume = {
    _saveThrottled: null,
    _boundVideo: null,      // 当前绑定的 video 元素
    _bindId: -1,            // 绑定序号：防止旧监听器写入
    _bindSeq: 0,            // 自增计数器
    _lastDuration: 0,       // 上次记录的时长，用于换源时的比例换算
    _onTimeUpdate: null,
    _onPause: null,
    _onUnload: null,
    _restored: false,

    /** 保存当前进度（节流由调用方控制） */
    save(courseId, lessonKey, time, duration) {
      if (!courseId || !lessonKey) return;
      if (!Number.isFinite(time) || time < 5) return;   // 前 5 秒不值得记
      // 已接近结尾则不记（下次应从头或跳过）
      if (Number.isFinite(duration) && duration > 0 && time > duration - 10) return;

      const store = readStore();
      store.courses[courseId] = {
        lessonKey: lessonKey,
        time: Math.round(time * 10) / 10,
        duration: Number.isFinite(duration) ? Math.round(duration) : null,
        updatedAt: Date.now(),
        siteVersion: ZHS.state.siteVersion || 'unknown',
      };
      writeStore(store);
    },

    /** 读取某课程的记录（含过期清理） */
    load(courseId) {
      if (!courseId) return null;
      const store = readStore();
      const rec = store.courses[courseId];
      if (!rec) return null;
      const days = Number(ZHS.config.resumeExpireDays) || 7;
      const ageDays = (Date.now() - (rec.updatedAt || 0)) / 86400000;
      if (ageDays > days) {
        ZHS.Log.info('续播记录已过期（' + Math.round(ageDays) + ' 天），忽略');
        delete store.courses[courseId];
        writeStore(store);
        return null;
      }
      return rec;
    },

    /** 清除某课程记录 */
    clear(courseId) {
      const store = readStore();
      if (store.courses[courseId]) {
        delete store.courses[courseId];
        writeStore(store);
        ZHS.Log.info('已清除本课程的续播记录');
      }
    },

    /** 清空所有记录 */
    clearAll() {
      writeStore({ courses: {} });
      ZHS.Log.info('已清空全部续播记录');
    },

    /** 列出所有记录（面板用） */
    list() {
      const store = readStore();
      return Object.entries(store.courses).map(([id, rec]) => Object.assign({ courseId: id }, rec));
    },

    /**
     * 绑定 video：监听 timeupdate 定期保存
     *
     * 踩坑记录（真 bug，截屏测试抓出）：
     *   早期版本把「构造节流函数」写在「已绑定就返回」这条守卫**之前**，
     *   而 07-main 里 bindVideo 会被调用两次 —— 第二次调用虽然什么都没绑，
     *   却把 this._saveThrottled 覆盖成了一个**没被任何事件触发的**新函数，
     *   于是已经挂上的 timeupdate 监听器指向了那个死函数，进度永远存不下来。
     *
     * 现在的做法：
     *   1. 守卫放最前面，重复调用立即返回，不产生任何副作用
     *   2. 每次绑定存一个绑定 id，监听器回调只认「当前这一次」的绑定
     *   3. 顺带支持 duration 变化时的按比例换算（换清晰度/换视频源场景）
     */
    bindVideo(video, courseId, lessonKey) {
      if (!video || !courseId) return false;

      // 守卫前置：同一 video + 同一课程 + 同一课时 → 无需重绑（保留进度记录，避免重复绑定覆盖节流函数）
      if (this._boundVideo === video && this._boundCourse === courseId && this._boundLesson === lessonKey) return true;

      // 解绑旧的：视频元素被换掉，或 SPA 复用同一节点但切了课/切了节（闭包里的课程/课时标识需刷新）
      this._detach();
      this._lastDuration = 0;   // 切课/切节：清零旧时长，避免把旧课的时长比例套到新课算出错误恢复位置

      const bindId = ++this._bindSeq;
      this._boundVideo = video;
      this._bindId = bindId;

      const saveNow = (reason) => {
        if (bindId !== this._bindId) return;      // 已被后来的绑定取代
        if (!ZHS.config.resume) return;
        if (video.paused) return;
        const t = video.currentTime;
        const d = video.duration;
        if (!Number.isFinite(t) || t < 5) return;
        // duration 变了（换清晰度/换源）→ 把已记录的时间按比例换算，避免续播跳错位置
        let saveT = t;
        let saveD = d;
        if (Number.isFinite(d) && d > 0 && this._lastDuration > 0 && Math.abs(d - this._lastDuration) > 5) {
          const ratio = t / d;
          saveT = Math.round(ratio * this._lastDuration * 10) / 10;
          saveD = this._lastDuration;
          ZHS.Log.info('视频时长变化（' + Math.round(this._lastDuration) + 's → ' + Math.round(d)
            + 's），进度换算后记录为 ' + Math.round(saveT) + 's');
        }
        if (Number.isFinite(d) && d > 0) this._lastDuration = d;
        this.save(courseId, lessonKey, saveT, saveD);
      };

      this._saveThrottled = U.throttle(() => saveNow('timeupdate'),
        Number(ZHS.config.saveIntervalMs) || 5000);

      this._onTimeUpdate = () => { this._saveThrottled(); };
      this._onPause = () => {
        // 暂停时立刻存一次，防止关页面丢进度（绕过节流，直接算）
        if (bindId !== this._bindId) return;
        if (!ZHS.config.resume) return;
        const t = video.currentTime;
        if (!Number.isFinite(t) || t < 5) return;
        this.save(courseId, lessonKey, t, video.duration);
      };
      this._onUnload = () => {
        if (bindId !== this._bindId) return;
        if (!ZHS.config.resume) return;
        const t = video.currentTime;
        if (!Number.isFinite(t) || t < 5) return;
        this.save(courseId, lessonKey, t, video.duration);
      };

      video.addEventListener('timeupdate', this._onTimeUpdate);
      video.addEventListener('pause', this._onPause);
      // 关页面/切后台时兜底存一次
      try {
        window.addEventListener('pagehide', this._onUnload);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') this._onUnload();
        });
      } catch (e) { /* 忽略 */ }

      this._boundCourse = courseId;
      this._boundLesson = lessonKey;
      ZHS.Log.debug('已绑定进度记录到视频（bind#' + bindId + '，课程 ' + courseId + ' / 节 ' + lessonKey + '）');
      return true;
    },

    /** 解绑当前 video 上的监听 */
    _detach() {
      const v = this._boundVideo;
      if (!v) return;
      try {
        if (this._onTimeUpdate) v.removeEventListener('timeupdate', this._onTimeUpdate);
        if (this._onPause) v.removeEventListener('pause', this._onPause);
        if (this._onUnload) window.removeEventListener('pagehide', this._onUnload);
      } catch (e) { /* 忽略 */ }
      this._boundVideo = null;
      this._bindId = -1;
      this._boundCourse = null;
      this._boundLesson = null;
      this._saveThrottled = null;
    },

    /** 手动落盘一次（供面板/调试用） */
    flush() {
      const v = this._boundVideo;
      if (!v) return false;
      const t = v.currentTime;
      if (!Number.isFinite(t) || t < 5) return false;
      this.save(ZHS.state.courseId, ZHS.state.lessonKey, t, v.duration);
      return true;
    },

    /**
     * 恢复流程：
     * 1. 读记录 → 2. 定位课时 → 3. 等待 video → 4. seek 到记录点
     * 返回是否执行了恢复
     */
    async restore(courseId) {
      if (!ZHS.config.resume) return false;
      if (this._restored) return false;

      const rec = this.load(courseId);
      if (!rec || !rec.lessonKey) {
        ZHS.Log.info('没有可恢复的进度记录，从头开始');
        return false;
      }

      ZHS.Log.info('发现续播记录：' + rec.lessonKey + ' @ ' + Math.round(rec.time) + 's');

      // 定位并切到该课时
      const target = ZHS.Catalog.findByName(rec.lessonKey);
      if (!target) {
        ZHS.Log.warn('记录中的课时已不存在（' + rec.lessonKey + '），忽略记录');
        this.clear(courseId);
        return false;
      }

      const currentTitle = ZHS.Catalog.itemTitle(ZHS.Catalog.current());
      if (currentTitle === rec.lessonKey) {
        ZHS.Log.info('已在目标课时，直接恢复播放位置');
      } else {
        ZHS.Log.info('正在切换到：' + rec.lessonKey);
        ZHS.Catalog.click(target);
        await U.sleep(3000);   // 等切课加载
      }

      // 等 video 就绪
      const video = await U.waitFor('video', 20000);
      if (!video) {
        ZHS.Log.warn('未等到视频元素，恢复中断');
        return false;
      }

      // 等元数据加载
      await this._waitMetadata(video, 20000);

      const rewind = Number(ZHS.config.resumeRewind) || 2;
      const targetTime = Math.max(0, rec.time - rewind);

      // duration 变了（换了清晰度/新版视频），按比例换算
      let finalTime = targetTime;
      if (rec.duration && Number.isFinite(video.duration) && video.duration > 0
          && Math.abs(video.duration - rec.duration) > 5) {
        finalTime = (rec.time / rec.duration) * video.duration;
        ZHS.Log.info('视频时长变化，按比例换算恢复点：' + Math.round(finalTime) + 's');
      }

      await ZHS.Player.seekTo(video, finalTime);
      this._restored = true;
      ZHS.Log.info('已恢复到 ' + Math.round(finalTime) + 's 继续播放');
      return true;
    },

    /** 等待 video 元数据 */
    _waitMetadata(video, timeoutMs) {
      return new Promise((resolve) => {
        if (Number.isFinite(video.duration) && video.duration > 0) return resolve(true);
        const deadline = Date.now() + timeoutMs;
        const check = () => {
          if (Number.isFinite(video.duration) && video.duration > 0) return resolve(true);
          if (Date.now() > deadline) return resolve(false);
          setTimeout(check, 300);
        };
        video.addEventListener('loadedmetadata', () => resolve(true), { once: true });
        check();
      });
    },

    reset() { this._restored = false; },
  };

  ZHS.Resume = Resume;
})();

/* ===== 05-scheduler.js ===== */
/**
 * 调度层：主循环 + 弹窗守卫
 *
 * 每 2 秒跑一次：守卫检查 → 保活播放 → 结束判断 → 下一节
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod05_scheduler) return;
  ZHS.__mod05_scheduler = true;
  const U = ZHS.Util;

  // 需要用户手动处理才能继续的遮挡层（验证码）
  const VERIFY_SELECTORS = '.yidun_popup, .yidun_modal, [id^="tcaptcha_transform"]';
  // 弹题遮挡层
  // 弹题遮挡层。
  // 必须严格限定在弹题容器内，不能用裸的 .topic-title：
  // 作业页同样有 .topic-title，裸选择器会在作业页被误判成「弹题」，
  // 于是先暂停视频、再试图关窗，最后还要耗掉一轮 await 才放行。
  const QUESTION_SELECTORS = '#playTopic-dialog, [class*="topic-dialog"]';
  // 其他阻塞弹窗
  const BLOCK_SELECTORS = '.ss2077-custom-dialog';

  const LOOP_INTERVAL = 2000;   // 主循环间隔
  const END_SETTLE_MS = 8000;   // 结束后等平台打勾+上报进度的时间（拉长：对勾/进度常异步延迟，过短会读不到完成态→误判重播）
  // 切课冷却：刚切完课时页面里可能还是旧的 video 元素（还在 ended 态），
  // 若不设闸会立刻再次判定「已结束」→ 疯狂连跳、一节课都看不完。
  // 这是 playback-flow 走查实测复现的致命 bug（BUG-PB-4）。
  const NAV_COOLDOWN_MS = 15000;
  // 平台异步上报等待：读到 0% 时先复查一次再决定切（避免丢学时）
  const PROGRESS_RECHECK_MS = 10000;

  // ===== 守卫预算上限 =====
  // 三条守卫此前都是「无上限 await」，任何一个卡住都会把 2 秒一轮的主循环吊死。
  // 统一设上限：宁可放行走下一轮重试，也不能永久阻塞。
  const VERIFY_WAIT_MAX_MS = 2 * 60 * 1000;      // 验证码：给人足够时间操作，但不能无限期暂停视频
  const QUESTION_WAIT_MAX_MS = 3000;             // 弹题自动关闭失败后：短等放行，别吊住主循环
  const DIALOG_BUDGET_MS = 25 * 1000;          // 单轮弹题作答预算
  const BLOCK_GUARD_MAX_TICKS = 15;            // 阻塞弹窗连续点不掉的轮数上限
  // 切课点击「点了没动」检测：连点同一目标 N 次仍未前进则判失败停手（根治静默死循环）
  const SAME_NAV_MAX = 5;
  // round-15【C2】：本轮「不同坏节点轮流失败」的累计上限（全局兜底）。
  // 只靠 SAME_NAV_MAX 时，5 个不同的坏节点轮着失败永远凑不满同一目标计数 → 无声空转。
  const NAV_FAIL_TOTAL_MAX = 8;

  const Scheduler = {
    _timer: null,
    _busy: false,
    _navigating: false,
    _navCount: 0,          // 本次已切换课时数
    _lastNavAt: 0,         // 最近一次切课时间戳（冷却闸门用）

    /**
     * 启动主循环
     * @param opts.manual 手动触发（用户点「启动」按钮）：允许越过 _halted 重新开跑
     *
     * _halted 的由来：脚本自己判定「不能再跑」时会停机（目录没识别到、
     * 达到停止条件、全部看完）。此时若不做标记，页面初始化流程里的
     * Scheduler.start() 会紧接着把它重新拉起来——结果就是：
     * 「目录都没认出来，脚本还在那空转」以及「设了 30 分钟自动停，照样停不住」。
     */
    start(opts) {
      const manual = !!(opts && opts.manual);
      // round-15【A2】：resume = 瞬时故障自愈后的恢复启动，区别于「全新一轮启动」。
      // 恢复启动绝不能清零 startedAt / _completedThisRun / _navCount，
      // 否则会连锁引发两个老毛病复发：
      //   ①「设了看 N 节就停」——计数被清 0 后永远凑不够阈值，停止条件形同虚设；
      //   ②总结报告里的「总耗时 / 切换课时数」只统计自愈之后的一段，明显少算。
      const resume = !!(opts && opts.resume);
      if (this._timer) return;
      if (this._halted && !manual) {
        ZHS.Log.debug('此前已判定停止，自动启动被忽略（如需重跑请手动点「启动」）');
        return;
      }
      this._halted = false;
      ZHS.state.running = true;
      if (resume) {
        ZHS.Log.info('主循环已恢复（保留本轮计时与完成计数）');
      } else {
        ZHS.state.startedAt = Date.now();   // 每次「全新」启动才重置计时
        this._navCount = 0;
        this._navFailKey = null;
        this._navFailCount = 0;
        this._navFailTotal = 0;             // round-15【C2】：本轮累计切课失败
        this._completedThisRun = 0;         // 停止条件：本次运行完成节数
      }
      // round-15【A1】：自愈名额只在「全新一轮启动」时重置（含用户手动点「启动」）。
      // 原先 _transientReloads 全仓库只增不减，用满 3 次后即便用户手动重启也救不回来，
      // 第 4 次故障起永久失去自愈能力。手动启动 = 用户明确要求重来，理应重新给名额。
      if (!resume) this._transientReloads = 0;
      this._timer = setInterval(() => this.tick(), LOOP_INTERVAL);
      if (!resume) ZHS.Log.info('主循环已启动');
      this.preflight();                   // 启动即做一次全量体检（N1）
    },

    /**
     * 停止条件检查（用户需求 1）：
     *   stopMode = 'minutes' → 累计运行 N 分钟后自动停止
     *   stopMode = 'lessons' → 完成 N 节后自动停止（切课即计 1 节）
     *   达标走 finishAll 弹总结，给明确完成提示
     */
    _checkStopCondition() {
      const cfg = ZHS.config;
      if (!cfg.stopMode || cfg.stopMode === 'none') return;

      if (cfg.stopMode === 'minutes') {
        const min = Math.max(1, Number(cfg.stopMinutes) || 0);
        const elapsedMin = (Date.now() - (ZHS.state.startedAt || Date.now())) / 60000;
        if (elapsedMin >= min) {
          this._stopByCondition(
            '已达到设定的观看时长 ' + min + ' 分钟',
            '累计观看 ' + Math.floor(elapsedMin) + ' 分钟'
          );
        }
        return;
      }

      if (cfg.stopMode === 'lessons') {
        const n = Math.max(1, Number(cfg.stopLessons) || 0);
        const done = this._completedThisRun || 0;
        if (done >= n) {
          this._stopByCondition(
            '已达到设定的完成节数 ' + n + ' 节',
            '本次运行已完成 ' + done + ' 节'
          );
        }
      }
    },

    /** 达标停止：只触发一次（防重复） */
    _stopByCondition(title, detail) {
      if (this._stopFired) return;
      this._stopFired = true;
      ZHS.Log.info('=== ' + title + ' ===');
      ZHS.Log.info(detail);
      this.finishAll(title + '（' + detail + '）').finally(() => {
        this._stopFired = false;   // 停止后复位，下次启动可再用
      });
    },

    /**
     * 启动预检（N1 需求）：全量扫描目录三态，报告还剩多少没看完
     * 目的：开跑前就让用户看到「哪些已完成、哪些没看完、哪些未解锁」
     */
    preflight() {
      try {
        const cat = ZHS.Catalog;
        const bd = cat.breakdown();

        if (!bd.total) {
          ZHS.Log.warn('目录未识别到任何可学习节点，请确认已进入课程播放页');
          if (ZHS.panel) ZHS.panel.alert('未识别到课程目录，请先进入具体课程', 'warn');
          return bd;
        }

        ZHS.Log.info('=== 课程体检 ===');
        ZHS.Log.info('共 ' + bd.total + ' 个节点：已完成 ' + bd.done
          + ' / 未看完 ' + bd.undone + ' / 未解锁 ' + bd.locked
          + '（完成度 ' + bd.percent + '%）');

        if (bd.allDone) {
          ZHS.Log.info('课程已全部看完，无需播放');
          if (ZHS.panel) ZHS.panel.alert('检测到课程已全部看完', 'info');
          return bd;
        }

        // 列出待学清单，便于用户核对
        const todo = cat.pending().map((el) => cat.itemTitle(el)).filter(Boolean);
        todo.slice(0, 10).forEach((t, i) => ZHS.Log.info('  待学 ' + (i + 1) + '：' + t));
        if (todo.length > 10) ZHS.Log.info('  …另有 ' + (todo.length - 10) + ' 节');

        if (ZHS.panel) {
          ZHS.panel.alert('检测到 ' + bd.undone + ' 节未看完，开始自动学习', 'info');
        }
        return bd;
      } catch (e) {
        ZHS.Log.error('预检失败：' + (e && e.message));
        return null;
      }
    },

    /**
     * 停机
     * @param why 停机原因分类（round-14）：
     *   'user'      —— 用户主动点「停止」（默认值，签名不变 → 既有调用点行为完全不变）
     *   'condition' —— 达到停止条件 / 全部看完（正当结束，不该被自动拉起）
     *   'transient' —— 瞬时故障被迫停机（目录临时读不到、节点临时定位不到、连点无反应）
     *
     * 为什么要分类：原先所有停机都打同一个 _halted=true，导致「目录刚好没读出来」
     * 这种亚秒级抖动的被迫停机，也被当成「任务结束」永久封死 —— 视频恢复了、
     * 页面正常了也永远不再动，正是用户报的「中途停了就永远不动」。
     * 现在只有 user / condition 才封死；transient 允许在受限条件下自愈重启。
     */
    stop(why) {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      ZHS.state.running = false;
      const reason = why || 'user';
      this._haltReason = reason;
      // 只有「用户停 / 达标停」才彻底封死；瞬时故障停允许 tryResumeAfterTransientStop 救回
      this._halted = (reason !== 'transient');
      if (reason === 'transient') this._transientStoppedAt = Date.now();
      ZHS.Log.info('主循环已停止' + (reason === 'transient' ? '（瞬时故障，将在条件恢复后尝试自愈）' : ''));
    },

    /**
     * 瞬时故障停机后的受限自愈（round-14）：
     * 仅当「上一次停机原因是 transient」+ 过了冷却期 + 未超次数上限 + 视频元素就绪时，
     * 才走 start({manual:true}) 把主循环拉起来。
     *
     * 安全边界（关键）：用户主动停 / 达标停 → _haltReason 不是 'transient'，
     * 本方法直接返回 false，绝不会把「用户要求停的脚本」偷偷拉起来。
     */
    tryResumeAfterTransientStop() {
      if (this._timer) return false;                             // 已在跑
      if (this._haltReason !== 'transient') return false;        // 非瞬时故障停 → 不救
      const TRANSIENT_COOLDOWN_MS = 60000;                       // 冷却 60s，防高频空转
      const TRANSIENT_MAX = 3;                                   // 本轮最多自愈 3 次
      if (Date.now() - (this._transientStoppedAt || 0) < TRANSIENT_COOLDOWN_MS) return false;
      if ((this._transientReloads || 0) >= TRANSIENT_MAX) {
        ZHS.Log.warn('瞬时故障已连续自愈 ' + TRANSIENT_MAX + ' 次仍未恢复，停止自动重试，请手动点「启动」');
        if (ZHS.panel) ZHS.panel.alert('自动恢复多次未成功，已停止重试；请确认网络/页面正常后手动点「启动」', 'warn', 15000);
        return false;
      }
      const v = ZHS.state.videoEl || document.querySelector('video');
      if (!v) return false;                                      // 视频还没回来，再等 DOM 变化
      this._transientReloads = (this._transientReloads || 0) + 1;
      ZHS.Log.info('检测到瞬时故障停机，视频已恢复，尝试自动重启（第 ' + this._transientReloads + ' 次）');
      // round-15【A2】：必须传 resume:true —— 这是「故障后的续跑」而非「新一轮」，
      // 不能让 start 把已完成节数 / 开始时间 / 切换课时的统计清零。
      this.start({ manual: true, resume: true });
      return true;
    },

    /**
     * 给一个异步动作套「总预算」：到点就返回 false，不再死等。
     * 守卫里所有外部调用（作答、关弹窗）都必须过这一层——
     * 否则一个没响应的 promise 就能把整个调度器吊死。
     */
    async _withBudget(promise, ms, label) {
      let timer = null;
      const guard = new Promise((resolve) => {
        timer = setTimeout(() => resolve('__ZHS_TIMEOUT__'), ms);
      });
      try {
        const r = await Promise.race([promise, guard]);
        return r !== '__ZHS_TIMEOUT__';
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    /** 单次循环 */
    async tick() {
      if (this._busy) return;      // 防重入
      this._busy = true;
      try {
        // 停止条件优先于一切业务（达标立即停，不再看视频）
        this._checkStopCondition();
        if (!ZHS.state.running) return;   // _stopByCondition 已停止
        await this._tickInner();
      } catch (e) {
        ZHS.Log.error('主循环异常：' + (e && e.message));
      } finally {
        this._busy = false;
      }
    },

    async _tickInner() {
      const cfg = ZHS.config;
      const video = ZHS.Player.video();

      // ===== 守卫 1：验证码 → 停手等用户 =====
      if (cfg.guardOverlays && U.hasStructurallyVisible(VERIFY_SELECTORS)) {
        if (video && !video.paused) video.pause();
        if (!ZHS.state.pausedByGuard) {
          ZHS.state.pausedByGuard = true;
          ZHS.Log.warn('检测到安全验证，请手动完成后脚本自动继续');
          if (ZHS.panel) ZHS.panel.alert('检测到安全验证，请手动完成', 'warn');
        }
        // 必须设上限。原来是无参 await，如果用户一直不处理（或关不掉），
        // 这个 await 会把 2 秒一轮的主循环永久吊死——表面看就是「脚本卡住了」。
        // 上限给得足够宽（10 分钟，够人做完验证码），超时后放行让下个 tick 重新判断。
        const cleared = await U.waitUntilHidden(VERIFY_SELECTORS, VERIFY_WAIT_MAX_MS);
        if (!cleared) {
          ZHS.Log.warn('安全验证等待超过 ' + (VERIFY_WAIT_MAX_MS / 1000) + ' 秒仍未消失，先放行主循环');
          if (ZHS.panel) ZHS.panel.alert('安全验证仍在，脚本已放行（不会卡住），处理完后会自动继续', 'warn', 10000);
        }
        ZHS.state.pausedByGuard = false;
        ZHS.Log.info('验证已处理，继续运行');
        return;
      }

      // ===== 守卫 2：弹题 → 暂停并交给答题模块 =====
      // 铁律（修订）：平台不允许关闭未作答的弹题。能答就答、答上了才关；
      // 答不上就交给人工并安静等待，绝不「关不掉 → 退避 → 再关」无限骚扰。
      // 二次校验：必须有真实的弹题容器（Dialog.present 会找可操作根节点），
      // 单靠选择器在一些页面会把普通 DOM 误判成弹题。
      // 弹窗已消失（人工答完/平台收走）→ 复位待人工标记
      if (ZHS.Answerer && ZHS.Answerer._pendingHuman && !ZHS.Questions.Dialog.present()) {
        ZHS.Answerer._pendingHuman = false;
        ZHS.Log.info('弹题已由人工处理，恢复自动流程');
      }
      if (cfg.guardOverlays && ZHS.Questions.Dialog.present()
          && U.hasStructurallyVisible(QUESTION_SELECTORS)) {
        if (video && !video.paused) video.pause();
        if (ZHS.config.autoAnswer && cfg.answerDialog && ZHS.Answerer) {
          if (ZHS.Answerer._pendingHuman) {
            // 待人工期：本题没答上/关不掉，用户正在手动作答。安静等待，
            // 不强关（平台会拒绝）、不告警刷屏。弹窗消失后下一轮自动复位。
            ZHS.Log.debug('弹题等待人工作答中，脚本保持暂停');
          } else if (Date.now() < (ZHS.Answerer._cooldownUntil || 0)) {
            // 退避期内：不作答，直接关弹窗恢复播放，保证不卡死
            await ZHS.Answerer.forceCloseDialog();
          } else {
            // Answerer 内部已含「作答 → 成功才关闭 → 恢复播放；没答上转人工」完整链路，
            // 但它可能调 LLM（网络慢/超时），必须套总预算：
            // 宁可这道题不答，也不能让主循环一直吊在这儿。
            const done = await this._withBudget(
              ZHS.Answerer.handleDialog(), DIALOG_BUDGET_MS, '弹题作答'
            );
            if (!done) {
              ZHS.Log.warn('弹题作答超时（>' + (DIALOG_BUDGET_MS / 1000) + ' 秒），交由人工处理');
              if (ZHS.panel) ZHS.panel.alert('弹题作答超时，请手动选择答案后关闭弹窗', 'warn', 8000);
              ZHS.Answerer._pendingHuman = true;
            }
            if (ZHS.Answerer._pendingHuman) {
              // 转人工：等用户答完，不做任何关闭尝试
              ZHS.Log.debug('弹题已转人工，等待作答');
            } else if (ZHS.Questions.Dialog.stillPresent()) {
              // 作答了但弹窗还在：给一次短观察窗，关不掉就计数告警（不硬关）
              await U.waitUntilHidden(QUESTION_SELECTORS, QUESTION_WAIT_MAX_MS);
              if (ZHS.Questions.Dialog.stillPresent()) {
                this._dialogCloseFails = (this._dialogCloseFails || 0) + 1;
                ZHS.Log.warn('弹题未能自动关闭（第 ' + this._dialogCloseFails + ' 次）。可能是脚本无法自动关闭的弹窗类型，请手动点掉后脚本会继续重试。');
                if (this._dialogCloseFails >= 3) {
                  this._dialogCloseFails = 0;
                  if (ZHS.panel) {
                    ZHS.panel.alert('弹题连续关不掉，请手动点掉后脚本会继续', 'warn', 10000);
                  }
                }
              } else {
                this._dialogCloseFails = 0;
              }
            }
          }
        } else {
          // 未开启自动答题：不作答。平台不允许关闭未作答弹窗，
          // 尝试一次关闭（部分提示型弹窗可以关），关不掉就明确提示等人工，绝不循环硬关。
          ZHS.Questions.Dialog.close();
          await U.sleep(800);
          if (ZHS.Questions.Dialog.stillPresent()) {
            if (!this._dialogHumanNotified) {
              this._dialogHumanNotified = true;
              ZHS.Log.warn('弹题需手动作答（未开启自动答题且平台不允许关闭未作答弹窗）');
              if (ZHS.panel) {
                ZHS.panel.alert('弹题需要你手动作答：选择答案后即可关闭；或在设置页开启「自动答题」', 'warn', 10000);
              }
            } else {
              ZHS.Log.debug('弹题仍在等待人工作答');
            }
          } else {
            this._dialogHumanNotified = false;
            if (video && video.paused) {
              const p = video.play();
              if (p && p.catch) p.catch(() => {});
              ZHS.Log.info('弹题已关闭（未开启自动答题），恢复播放');
            }
          }
        }
        return;
      }
      this._dialogHumanNotified = false;

      // ===== 守卫 3：其他阻塞弹窗 → 尝试关闭 =====
      if (cfg.guardOverlays && U.hasStructurallyVisible(BLOCK_SELECTORS)) {
        const btn = document.querySelector('.ss2077-custom-dialog .close, .ss2077-custom-dialog .btn');
        if (btn) {
          btn.click();
          ZHS.Log.debug('已关闭阻塞弹窗');
        }
        return;
      }

      // ===== 无视频：先等加载，连续多个 tick 仍无才判为文档节点切下一节 =====
      // 防止刚启动视频未加载就误切课
      if (!video) {
        this._noVideoTicks = (this._noVideoTicks || 0) + 1;
        if (this._noVideoTicks === 3) {
          ZHS.Log.debug('连续 ' + this._noVideoTicks + ' 次未检测到视频，按文档/PPT 节点处理');
        }
        if (this._noVideoTicks >= 3) {
          if (cfg.autoNext) await this.gotoNext('当前节点无视频');
          this._noVideoTicks = 0;
        }
        return;
      }
      this._noVideoTicks = 0;
      // ===== 正常保活 =====
      ZHS.Player.checkStall(video);

      if (cfg.autoPlay) {
        ZHS.Player.setSpeed(video, cfg.speed);
        if (cfg.mute) ZHS.Player.mute(video);
        await ZHS.Player.ensurePlaying(video);
      }

      // ===== 结束判断 =====
      // 冷却闸门：刚切完课的一段时间内不做结束判定。
      // 否则页面里可能还残留上一节的旧 video（仍是 ended 态），会立刻再次
      // 命中「已结束」→ 12 秒跳一节、一节课都看不完（走查实测BUG-PB-4）。
      if (this._lastNavAt && Date.now() - this._lastNavAt < NAV_COOLDOWN_MS) {
        return;
      }

      if (ZHS.Player.atEnd(video)) {
        if (cfg.autoNext) await this.onLessonEnd(video);
      }
    },

    /**
     * 课时结束处理：以「右侧栏完成标记」为金标准决定下一节
     *
     * 设计铁律（用户核心诉求）：平台在章节列表打的完成标记（对勾）才是真实「看没看完」的信号。
     * 视频放完、且平台已记录完成 → 立即跳下一节；绝不默认回退重播。
     * 只有「进度明显偏低（<90%）且右侧栏仍无完成标记」才重播兜底（最多 2 次，由 Player 内部计数），
     * 其余情况一律跳下一节，彻底消除「看完重看一遍」的体验。
     */
    async onLessonEnd(video) {
      if (this._navigating) return;
      this._navigating = true;
      try {
        // 用本轮播放的课时标题找回当前节 DOM（不依赖 .current 类——视频放完后该类可能已转移到下一节）
        const locateCur = () => (ZHS.state.lessonKey
          ? (ZHS.Catalog.findByName(ZHS.state.lessonKey) || ZHS.Catalog.current())
          : ZHS.Catalog.current());

        // 【2026-09-18 修正】原先是「闷头 sleep 8 秒再读一次」的固定等待，两头不讨好：
        // 平台快的 200ms 就把勾打好了（白等 7.8 秒 × 每一节），慢的 8 秒还没就绪（照样读不到）。
        // 改成轮询：一看到「完成标记 或 进度够高」立刻往下走，最多等 END_SETTLE_MS 这个上限。
        const settleDeadline = Date.now() + END_SETTLE_MS;
        let cur = locateCur();
        while (Date.now() < settleDeadline) {
          cur = locateCur();
          if (cur && (ZHS.Catalog.isFinished(cur) || ZHS.Catalog.progressOf(cur) >= 95)) break;
          await U.sleep(300);
        }

        // 1. 金标准：右侧栏完成标记（对勾/已完成图标/已学完文字）
        if (cur && ZHS.Catalog.isFinished(cur)) {
          ZHS.Log.info('本课时已完成（右侧栏已记录完成标记），切换下一节');
          ZHS.Player.resetRetry();
          await this.gotoNext('本课时已完成');
          return;
        }

        const progress = cur ? ZHS.Catalog.progressOf(cur) : 0;

        // 2. 平台进度接近完成（>=95%）→ 视作已完成，跳
        if (progress >= 95) {
          ZHS.Log.info('本课时平台记录 ' + progress + '%，判定已完成，切换下一节');
          ZHS.Player.resetRetry();
          await this.gotoNext('本课时已完成');
          return;
        }

        // 3. 读不到进度（<=0）→ 信任视频已放完，直接跳（绝不重播）
        if (progress <= 0) {
          ZHS.Log.warn('平台进度未确认（读到 ' + progress + '%），按视频已放完处理，切换下一节');
          ZHS.Player.resetRetry();
          await this.gotoNext('视频播放完毕');
          return;
        }

        // 4. 仅当进度明显偏低（1~89%）且右侧栏无完成标记时，才重播兜底（最多 2 次）
        //    这是平台进度确实没同步才需要的补救；其余一律跳，避免「重看一遍」。
        if (progress < 90) {
          const retried = await ZHS.Player.retryFromPlatformProgress(video, progress);
          if (retried) {
            ZHS.Log.warn('进度仅 ' + progress + '% 且未完成记录，回退重播补齐（平台进度未同步）');
            return;   // 重播中，下一轮 atEnd 会再次进入本函数
          }
          ZHS.Log.warn('重播次数用尽仍不同步，直接跳下一节（不卡死）');
        }

        // 5. 兜底：任何未命中上述分支的情况，都跳下一节，绝不重播
        ZHS.Player.resetRetry();
        await this.gotoNext('课时结束，切换下一节');
      } finally {
        this._navigating = false;
      }
    },

    /**
     * 切换下一节
     * @param reason 触发原因（日志用）
     * @param opts.manual 手动触发：跳过随机延迟、被重入挡下时给出提示而不是静默
     */
    async gotoNext(reason, opts) {
      const manual = !!(opts && opts.manual);
      // 锁归属：调用方（onLessonEnd）已持锁则复用；空闲时本函数持锁。
      // 手动触发遇忙要提示，不能静默吞掉。
      const owned = !this._navigating;
      if (!owned && manual) {
        ZHS.Log.warn('正在切换课时中，请稍候');
        if (ZHS.panel) ZHS.panel.alert('正在切换课时中，请稍候', 'warn');
        return;
      }
      if (owned) this._navigating = true;

      const cfg = ZHS.config;
      // 优先用本轮课时标识 lessonKey 定位当前节（与 onLessonEnd 的 locateCur 保持一致）：
      // 视频放完后平台的 .current / active 类可能已经转移到下一节，若这里仍用
      // Catalog.current() 会拿错起点，导致 findNext 跳过已就绪的下一节。
      const cur = ZHS.state.lessonKey
        ? (ZHS.Catalog.findByName(ZHS.state.lessonKey) || ZHS.Catalog.current())
        : ZHS.Catalog.current();
      const cat = ZHS.Catalog;

      try {
        // 先看全目录还剩多少没完成
        const bd = cat.breakdown();
        // skipFinished 关闭时：不主动跳课，按顺序走（已完成也停一下，便于人工核对）
        const next = cfg.skipFinished === false
          ? this._nextInOrder(cur, cat)
          : cat.findNext(cur);

        if (!next) {
          if (bd.total === 0) {
            // 目录都没识别到：绝不能弹「全部看完」的假总结
            ZHS.Log.warn('未识别到课程目录，无法切换。请确认已进入课程播放页');
            if (ZHS.panel) ZHS.panel.alert('未识别到课程目录，请先进入具体课程的播放页', 'error');
            // round-14：目录临时读不到属瞬时故障（SPA 重渲染/懒加载瞬间），允许自愈，不永久封死
            this.stop('transient');
          } else if (bd.undone === 0) {
            // 真正全看完：先看是否要「自动跳课」回课程中心找下一门，
            // 没开开关（或不在学习页 / 模块缺失）就保持原有「出总结并停止」行为。
            const hub = ZHS.CourseHub;
            const canHop = cfg.autoCourseHop && hub && !hub.isHubPage();
            if (canHop) {
              hub.markCourseDone(ZHS.state.courseId);
              ZHS.Log.info('[课程中心] 本课程已全部学完，准备返回课程中心寻找下一门课');
              // round-15【A4】：本课程学完回课程中心属「正当结束」，用 'condition' 与瞬时故障区分
              this.stop('condition');
              hub.returnToHub();
            } else {
              await this.finishAll(reason);
            }
          } else {
            // 有未完成但找不到（状态识别可能有偏差），停手让人看
            ZHS.Log.warn('还有 ' + bd.undone + ' 节未完成，但无法定位到可点击节点（可能被锁定或选择器不匹配）');
            if (ZHS.panel) ZHS.panel.alert('还有 ' + bd.undone + ' 节未完成但定位失败，请检查目录', 'warn');
            // round-14：定位失败多为懒加载/虚拟滚动的瞬时态，允许自愈
            this.stop('transient');
          }
          return;
        }

        // （「同目标反复点」的失败计数原先放在这里 —— 2026-09-18 修正后已下移到点击校验之后，
        //   理由：点击前自增会把「还没点」也算成一次失败，且目标一变就清零，
        //   反而把「点了没动」这件真正要抓的事掩盖掉。详见下方 clickAndVerify 分支。）
        // 人类化随机延迟（手动触发跳过，点了就要动）
        if (!manual) {
          const delay = 1 + Math.random() * (cfg.nextDelayMax - cfg.nextDelayMin) + cfg.nextDelayMin;
          ZHS.Log.info('即将切换到「' + cat.itemTitle(next) + '」，等待 ' + Math.round(delay) + ' 秒'
            + '（剩余未完成 ' + bd.undone + ' 节）');
          await U.sleep(delay * 1000);
        } else {
          ZHS.Log.info('手动切换到「' + cat.itemTitle(next) + '」');
        }

        // 停止闸门（BUG-UX-6）：随机延迟可能长达十几秒，期间用户点了「停止」，
        // 若不复查就照样点下去，会出现「明明停了页面还在跳」。
        // 手动触发例外——用户刚点过按钮，就是要跳。
        if (!ZHS.state.running && !manual) {
          ZHS.Log.info('运行已停止，取消本次跳转');
          return;
        }

        // 记录新课时标识，供续播使用。
        // round-14【P1 关键修正】：改「点击前就写」为「点击成功后写」。
        // 原先这里在点击前就把 lessonKey 改成目标节，一旦点击失败（下面的 !switched 分支）
        // 又不回滚，就会把「下一节的进度」记到「本来那一节」的标题上（Resume.bindVideo 用错键），
        // 下一轮 Catalog 的完成判定也会打错节点，进而从错位置往后 findNext → 静默跳过整节课。
        // 这是唯一的「写错数据」级缺陷：宁可暂时用旧键，也绝不能把进度记到错的节上。
        const _targetKey = cat.itemTitle(next);
        const _prevKey = ZHS.state.lessonKey;   // 备份，失败时回滚用

        // 【2026-09-18 关键修正】原来这里是「点一下就走」，点没点中没人管 ——
        // 这正是用户报的「点了下一节也没用」。现在点完必须验收：
        // 轮询等目标条目拿到 active（SPA 异步，可能晚几百毫秒），没拿到就再点一次。
        // round-14【P4】：clickAndVerify 内部已加「当前节必须真的从旧节变成新节」的第二信号校验。
        const switched = await cat.clickAndVerify(next, { timeout: 3000, tries: 2, fromKey: _prevKey });
        if (!switched) {
          // round-14【P1】：点击失败 → 课时标识必须回滚，绝不让「记错节」发生
          ZHS.state.lessonKey = _prevKey;
          // round-15【C2】：原判据「同一目标才累加、目标一变就清零」有软死循环漏洞 ——
          // 若目录里有 5 个不同的坏节点轮流失败，计数永远凑不满 5，于是既不停机也不前进，
          // 无声空转。现在改为双计数：同目标连续失败（快速止损）+ 本轮累计失败（全局兜底）。
          this._navFailCount = (_targetKey === this._navFailKey ? this._navFailCount : 0) + 1;
          this._navFailKey = _targetKey;
          this._navFailTotal = (this._navFailTotal || 0) + 1;
          const hitSame = this._navFailCount >= SAME_NAV_MAX;
          const hitTotal = this._navFailTotal >= NAV_FAIL_TOTAL_MAX;
          ZHS.Log.warn('点击「' + _targetKey + '」后未检测到切换（同目标 ' + this._navFailCount
            + ' 次 / 本轮累计 ' + this._navFailTotal + ' 次），已回滚课时标识');
          if (hitSame || hitTotal) {
            const _why = hitSame
              ? '连续 ' + this._navFailCount + ' 次点击「' + _targetKey + '」都无反应'
              : '本轮累计 ' + this._navFailTotal + ' 次切课失败（多个节点轮番点击无反应）';
            ZHS.Log.error(_why + '（疑似平台改版或目录节点不可点），已停止自动跳转');
            if (ZHS.panel) ZHS.panel.alert('切课失败：' + _why + '，已停止自动跳转，请手动切换', 'error', 15000);
            // round-14：平台响应慢时也可能凑齐连点次数，属瞬时故障，允许冷却后自愈重试
            this.stop('transient');
            return;
          }
          if (ZHS.panel) ZHS.panel.alert('切换「' + _targetKey + '」未生效，正在重试…', 'warn', 6000);
          this._lastNavAt = Date.now();
          // round-14【P5】：失败分支的 rebind 缩短为 5 秒。原先走默认 20 秒，
          // 比 15 秒冷却闸门还长 → 闸门失效、BUG-PB-4（12 秒跳一节）复发，
          // 且单轮主线程被 _busy 独占近 29 秒，期间弹题守卫/保活全停摆。
          await this._rebindAfterNav(5000);
          return;
        }

        // round-14【P1】：确认切换成功后才写新课时标识（此时记进度才是对的）
        ZHS.state.lessonKey = _targetKey;

        // 确实切过去了 → 失败计数清零（含 round-15 新增的本轮累计失败）
        this._navFailCount = 0;
        this._navFailTotal = 0;
        this._navFailKey = null;
        this._navCount++;
        this._completedThisRun = (this._completedThisRun || 0) + 1;   // 停止条件：完成节数
        this._lastNavAt = Date.now();   // 打时间戳：闸门据此屏蔽旧 video 的残留 ended 态

        // 重置状态
        ZHS.Player.resetRetry();
        ZHS.Resume.reset();
        if (ZHS.Answerer) ZHS.Answerer.reset();
        ZHS.state.videoEl = null;

        await U.sleep(3000);
        await this._rebindAfterNav();
      } finally {
        if (owned) this._navigating = false;
      }
    },

    /**
     * 顺序推进：不看完成态，直接取当前项的下一个（skipFinished=false 时用）
     */
    _nextInOrder(cur, cat) {
      const all = cat.items();
      if (!all.length) return null;
      let startIdx = 0;
      if (cur) {
        const i = all.indexOf(cur);
        if (i >= 0) startIdx = i + 1;
      }
      // 未解锁的跳过（点了也没用）
      for (let i = startIdx; i < all.length; i++) {
        if (cat.statusOf(all[i]) !== ZHS.STATUS.LOCKED) return all[i];
      }
      return null;
    },

    /**
     * 全部看完 → 生成总结报告，弹出结论，停止运行
     */
    async finishAll(reason) {
      const cat = ZHS.Catalog;
      const bd = cat.breakdown();
      const raw = ZHS.Solver ? ZHS.Solver.stats : {};
      const st = {
        bank: raw.bank || 0, llm: raw.llm || 0, cache: raw.cache || 0,
        random: raw.random || 0, skipped: raw.skipped || 0, fail: raw.fail || 0,
      };
      const elapsedMs = Date.now() - (ZHS.state.startedAt || Date.now());
      const mins = Math.floor(elapsedMs / 60000);
      const secs = Math.floor((elapsedMs % 60000) / 1000);

      const report = {
        触发原因: reason || '全部完成',
        课程名: cat.getCourseName() || '(未识别)',
        页面版本: cat.adapter.label || ZHS.state.siteVersion,
        总节点: bd.total,
        已完成: bd.done,
        未完成: bd.undone,
        未解锁: bd.locked,
        完成度: bd.percent + '%',
        本次切换课时数: this._navCount,
        本次完成节数: this._completedThisRun || 0,
        已答题数: ZHS.state.answeredCount,
        答题通道: '题库 ' + st.bank + ' / LLM ' + st.llm + ' / 缓存 ' + st.cache
          + ' / 随机 ' + st.random + ' / 未作答 ' + st.skipped + ' / 失败 ' + st.fail,
        漏答题数: st.skipped,
        总耗时: mins + ' 分 ' + secs + ' 秒',
        结束时间: new Date().toLocaleString('zh-CN'),
      };

      // 标题不能撒谎（BUG-UX-15）：达标停止 / 未看完就停 都不能硬说「全部看完」。
      // 面板 showReport 早已按这个口径动态判定，日志此前却写死了，两边说法打架。
      const headline = Number(report.未完成) === 0 && Number(report.总节点) > 0
        ? '=== 全部课程已看完 ==='
        : '=== 运行已结束（仍有 ' + report.未完成 + ' 节未完成）===';
      ZHS.Log.info(headline);
      Object.keys(report).forEach((k) => ZHS.Log.info('  ' + k + '：' + report[k]));

      // 控制台结构化输出（不用 console.table：在部分无头/受限环境里它会挂起）
      try {
        const lines = Object.keys(report).map((k) => k + ': ' + report[k]).join('\n');
        console.log('[智慧树助手·总结]\n' + lines);
      } catch (e) { /* 忽略 */ }

      ZHS.state.lastReport = report;
      // round-15【A4】：finishAll 是「任务达标/全部完成」的正当结束，标 'condition' 彻底封死，
      // 绝不能被瞬时故障自愈逻辑误判为可恢复。
      this.stop('condition');

      if (ZHS.panel) ZHS.panel.showReport(report);
    },

    /** 取最近一次总结报告 */
    lastReport() { return ZHS.state.lastReport || null; },

    /** 切课后重新绑定 video */
    async _rebindAfterNav(waitMs) {
      // round-14【P5】：允许调用方指定等待时长。失败分支传 5000，避免 20 秒等待
      // 超过 15 秒冷却闸门，导致闸门失效 + 主线程被 _busy 独占期间弹题守卫停摆。
      let video = await U.waitFor('video', waitMs || 20000);
      if (!video && ZHS.Util.findVideoInIframes) video = ZHS.Util.findVideoInIframes(document);
      if (!video) {
        ZHS.Log.warn('切课后未找到视频元素');
        return;
      }
      ZHS.state.videoEl = video;
      const courseId = ZHS.state.courseId;
      const lessonKey = ZHS.state.lessonKey;
      ZHS.Resume.bindVideo(video, courseId, lessonKey);
      ZHS.Log.info('已切换并重新绑定：' + lessonKey);
    },
  };

  ZHS.Scheduler = Scheduler;
})();

/* ===== 06-panel.js ===== */
/**
 * 悬浮控制面板（Shadow DOM 隔离样式）
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod06_panel) return;
  ZHS.__mod06_panel = true;
  // round-14【先发布后初始化】：守卫一旦上锁，本模块就再也不会被二次注入重新执行。
  // 但 ZHS.panel 原本要等到模块第 1300+ 行（跨过巨型 base64 图片、整段 CSS 模板、
  // Panel 对象字面量）才赋值 —— 中间任何一步抛异常（页面框架给 DOM API 打补丁、
  // 扩展干扰、模板插值取值异常……）就会形成「守卫已上锁 + ZHS.panel 永久 undefined」
  // 的不一致状态，面板永远无法自愈，而脚本却在跑 → 用户眼里就是「装了跟没装一样」。
  // 这里先在守卫后立即可靠地占位，末尾再用 Object.assign 把真正的 Panel 填进去。
  if (!ZHS.panel) ZHS.panel = {};
  const U = ZHS.Util;
  const ZHS_QR_B64 = "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eD5V165dH3300ZkzZ27ZsiUhIeHtt98+dOiQzWbjBj6Nx9cggoKC7rrrLm8OCHcxbN++fdSoUenp6atXr96yZcv48eODg4N5ANqcOXM6d+7cvXv3W265pWXLlj/99FNJScnkyZPtdvvy5ct5WDAfjf/rDW7mLzt16nTDDTdwx7XXe8wj10pLS+fMmePxeB599NGuXbsCwE8//XT69Gke4Tlt2jRCyBtvvJGZmTly5EivfrJ3796xY8fys+j1+tmzZ7dq1WrkyJF9+vTBGO/Zs+fQoUP9+vXr1avXnDlz4uPjb775Zo3H1w68moDZbH7vvfd8P3rnnXdycnKmTJkycODA5OTkwsLCPn36tG7d+s0331y3bt3QoUOff/75G2644d577wWAU6dOFRcXv/nmmxcuXPjmm2/AJ7yTG0O8Wyv+R6dOnebMmQOXxHswxs6cOTNt2rTBgwd7y2IsWrTo+++/B4DY2FheASMxMXHYsGFeHs+bN0+v1586dSopKQkA+KIxYsSIUaNGjR49evTo0dxtvn///o4dO4qimJWVNWbMGI3H1w4mT57crVu32bNnl5SUjB8/XhAERVE6duz45JNPcoq/8cYby5cvnzZtWmhoKI9/eOWVV4KCgr788suMjAwv/xRFiYqKkiQpMjJywYIFPKanY8dOAHD33Xf36tWLK8EAEB8fv3DhwvT09MuuCZ988okkSYyxqKgorx/kscce4woGxlhRFIvFsmjRIt/M56effrpz586hoaE2m+3FF1/0eDwLFixITU1ljH355Zc///zzrbfeOnXq1K+++opPnusn/ek6ihOSJKl379779u3z7vOGDx/+008/vfHGG8899xwAmEym/fv3t2rVSlXVw4cPd+rUadiwYWvWrPEV6kOGDKmoqNi5c6fFYrk0GdtXEjNQMBJ9JDQDQL6VX3yH5UEUAOBwOLp27cqNcTqdDiHEAzmee+65N954Y+PGjf379weAysrKDh06hIeHHzhwgKv+TzzxxAcffLBt27ZevXr17t17+/btANCzZ88NGzYYjUYtTuiaCqX/6quviouL+/fvHxQUtHnz5qNHj6anpzc2NgLARx99NGjQoISEBIfDceutt548eRIAtm/fnpWVpSgKD2cTBOGFF17o2rWrlxmMMUAKAAWEGBO8TAUAhBhjym93GKkAFAABE5qFj/pyWhTF77//XlEUnU5XVFQ0dOjQIUOGvPvuu4888sgdd9wxa9asBx98kBASGBi4ePFinlX1008/TZ8+/d577z1z5syLL774wAMPvPrqq5999pmqqjqd7jopKXQd8VgUxeTk5MDAQO6LzsrKqq+vd7vd3FUmiqLBYLhw4YLNZrPZbKqqpqSkWK3WEydO+Pn5BQcHl5WVKYrC05u9RU8AABi+WLb0qskXjFz9MC7RdTqdVzORZfn06dOxsbHnzp0LCwuLjIzU6/VWq7WioiIwMDAtLY2rHFar9dSpU/X19SaTqbCw8OTJk7Is+/v7R0VFgVY39lpFcHDwzp07f/rpJwDo1avX4cOHp06dCgAPPvhgRkZGx44db7rpptmzZx8+fHjv3r3vvvsuADz88MOHDx/msRD333//6NGjHQ7H7+9hE5UpVRVFVRWGAAETAQgA4xz1eGRFYZT+y4lGmzdv7tKly2effQYA//znP7du3RoZGSlJkjfXg+vWc+bMadu27ZEjRwDgrrvu6tKlS319PWh+6WsMhw4dKikp4UVYBgwY4PF4fv7555CQkK5du2ZnZw8ZMoQnX+zYsaOqqiogICAkJAQAuMuNy2Ne+iQzM9PrUr6cFQIopaqseDzMZDZwUwbBWFKU/Pw8g8GQnJx8dbHtdrv37Nkjy3L//v2NRuOoUaNKSkoOHjzIg0C4lB02bBiv81JfX79nz56ysrJhw4adOXPm7Nmz3N6XnZ2dmJh4XVVjuV54/OGHHy5evJibtPLz82tqakaPHj1o0KA1a9aMGTNm7NixgiA4HI4OHToUFBQoiuKNr/ea1fjf77zzTt++fZvVWWvaxiEKjDQ2OCVZcTjsfn7+ISH+KpNEQUdVRZU8gsn0h4mfHo/noYcestvteXl5MTExq1atWrFixbhx47xVkPV6/eeff87//vXXX4cNG3bzzTf/9NNPTzzxxPvvv8/Nf2+//Xbv3r0vd5Eaj//H0a1bt4aGhh07dvAiEvx5c4LyWPgdO3YUFBT07Nmza9eu/v7+9fX1OTk5RUVF48aNo5SuWLGCFxDaunUrY+yGG264pIQhctiUgrPFhYW1HolEhIeJekddgysuPkhVFaSqIYHBUdExGOOrx+7wkDdVVXkAsXcXeOzYseXLl3fr1i04OHjTpk0OhwMhVF1dffPNN/fq1Qsh1LZt27Fjx3Iv99GjRxsaGniRLo3H1xSmTJly9913t2/fvqioSK/Xm0wmbn/wmjJeffXVDRs25OXl8W3WmTNnxo4d27dv382bN8+cOfPWW2/lR77yyiurV6/esWOHT4U1BgCKotY31AcE424xqUcOVeSfqUxNi7PWyTUGl9tl1WFwO22WQEeAUf9n7Cq86oV3twcA33zzzTfffJOTkxMXF/f444/n5+cDQOvWrffv38+NxHfdddddd93F52eXLl2OHDnyeyVe4zFcO6FCjz32WFlZ2UsvvdTQ0KDT6QoKCl588cVevXoNGDDg7rvv7tKly9dff82DMBFCL7zwAveAcAl65513pqenL1q06Lf1GkkAAmWqylBNrUNFYmxckEhYVIz/mbO1eQWVgQGC3d5QWnq6oqIkMjI4PjlRVYFRRghG+IoVPjHGjY2Nzz77bERExIMPPtiqVatZs2bxy9i2bdu6detqa2vNZvN9993XunVrURSPHz/+7bffEkIQQhMnTkxMTHzggQeKiopeffXVhISEO++8U+urcO1AlmWM8eTJk6uqqnhNKoPBcOrUqdzc3KeeemrAgAHjx4+XJCk7O5tXdmvVqtXx48f5ms7Vj4kTJ/bv35+XSvGa0lQFnG5adKHm1MnzkkxbZ8S1aZMgScTtUeus5xutskknHTy41+5oGDlysJ+/5WTuSVHUJScn2mzWgEALIQJj1Ddrn/tEGhsb33zzzbi4uPvvv79NmzZt2rThn/bv33/z5s0AEBERMW3aNB63eeTIkddeew0uRqImJyffd999NpstICAgOzv7jjvu0OTxtYOPPvooJyeHMWYymVatWlVfXz9lyhRO0DVr1uTn53MPc3l5uTfKx+128/y28ePHd+jQoVWrVowxb+AbACAQJEl2Op2q6ug/oGNxWUVJYVlERGh5WYNBbzh15oTLXi65G2WJ6nTE6XI6HE5VhfLyYp1Od+FCYWZWhizJCGFv/jPfxs2ZM8dmsyGEGhsbb7vtNk7x2267jbvT+WH19fV333232WzGGJeUlHCXniAI3h4LPASUewQ1Hl87OHLkyOrVqwVBiIuL+/TTT+vq6oKCgmw2G09rKyws5EJRp9MFBARwP0htbS1jzGw2p6enJycn89pqFovF5XJxcjAASlWjXkxOivD3FyQl5Hx+w86dRTXVjaGBYenx8dt3nNYbjE5PA9EL/gGB54vKf/wx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wnvX9KlTp27fvp2/r9PpCgsLs7KyevbsuXfvXl4C2et2JoSsXbuWx74NGDDg8OHDH330UZcuXXjx+iVLliQmJnotG+PHj+/fvz9PruYK61133ZWWlrZy5coTJ05MnDixb9++n3766bx58+bMmcNpV15eTint0KGDt1MvALz//vtz586tra01GAwY48DAQG+0ND/Rk08+OWnSJH6RCxYskCSJu821OPprEElJSS1atDh+/Dj41OEMDQ2NiYkxm82+tgiMMXcpp6SkwCUulbS0NLvdfvDgQUKIXq8vLS3ljcB0Ot2hQ4dqa2sppZIkcbOdIAhWq7WkpISXTblw4YKqqgcPHjxz5sy5c+fS09O5sY87rhFCXLHhyUuEkMbGxkOHDtXX14eEhFitVkrpkSNH6uvrudmurq7u3LlzABAeHt6iRYszZ87Y7XaMMSEkMzNTk8dwTZaOBYDq6up+/fp544YZY9OmTZs1a5ZvyLkkSfHx8Vu2bPFNu2i2qysqKho+fHhDQwOvBOfdk02aNIkH1jU0NNxwww2yLEuSxO0V3nlSXl7ev39/79YNAO6///7Jkyd7m+hwZp85c6Zly5br16/fvn37888/f/Dgwb59++bk5IwfPx5j7Ha7fUfgduKnnnpq06ZNfDIcOXKEF4DTeHxtwm63ez3AnLWX6xTNAgICamtrt23blpWV1apVqx07dpSVld14441hYWE//fTTyZMn6+vro6OjO3fufPjwYd7bGQB69+5tsVg2bNjgcrlkWU5OTu7QoYOvG2X9+vUej2fgwIF80Y+Ojl62bBnXkrt27cotgy6Xa8WKFXa7fcKECYWFhXv27Dl69OiKFSuys7NDQkLWrl0rSdLgwYN5oc4LFy7s3bt3375933777blz5/hPux5yS693HjdTGa8ksURR3LNnz2233fbiiy/OmjXrlVde2bhxIy96OWHCBKfTCQADBw6cP3/+tGnT5syZAxfjP1u1atWiRQvOpyFDhvBIIC8yMzPr6upWrFjBFd/169cPGTKEf7Rw4cJ77rkHACorK2+99dbw8PDKysqffvpp5MiRy5cvX758+fbt22+44Ya0tLTa2trFixfzevTffffdLbfcsnTp0qVLlzZbfDQeawBZllu1avX6669LkvTMM8/wSoGff/55Tk7OK6+8cuHChQ8//JAbd/m/Y8aM6dmzZ2ho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u+22kydPbty4sV27dn369NF4/H/BY0zamOK3NuYy/DvCGSg54ihbXXX4rrg+BgkEAY7Zz394fuMPtQftqguLBGNM4fIkvljoWMkyx+mvIK0VRQkLC5syZcq6desuXLjA3ywpKVm3bl1YWBhnnsvlkiRp2LBhI0eO5Lzcvn374sWLjUZjSkqKrw0hPj4eAOx2e7OzDBo0yLttuhKusp3Kysq68847P/vss/nz5z/11FMGg8H70Q8//LBu3br09PQ77rjjsjK1ZcuWM2fOTEhIqKqqavZRSEjIPffc8+KLLy5atCgjI6NZHIjG43/TodfBHIswMFB9n6QiMKzK31buvim6Yym4F5/f8U3x7gK1EotExAJmoLKrN2FVELBO5rgrGQp69+7dunXrkJCQ1atX++6idDqdd6H/5ZdfvvzySy/DMjIyYmNjjx071rNnzz9pG96+ffuV7G687ZAgCDfccEN4ePiVtOeRI0eeOXMmJycnICDggQce4CrKjz/+uHDhwuDg4ClTplzFZscjfi47Qzp06HDzzTcvXbr0q6++evzxx/+3tAvhb1ntGPqHZHUqSd6nFovUN0iSMAH2OM7ecXRug+w4bC9SRUEQmzzR2Fv8/opCTsk2tegdlnnZ4qr80XIG+JoXGGOMsZCQkNDQUAAICAjgqvOePXsiIyOTkpIyMzOPHj3atWvXq6gKvmfZsWPHhg0beERoM08yP5fRaMzMzGymMzTTLh555BG73f7DDz8AwMiRI3NycpYtW8Zp3a5du39zW4LQzTffXFtb261bN02v+D+AiiDSEPyPyBuPFHytitTbdIp3ylARbG84SQlGelFgv5UApOgPKoGLqu7xyH4xxhD2R62zfUWRLMu+zGaMYYzXrl27ZcuWoUOH3nnnnbm5uQih3bt39+7du5n9+Erqb1BQ0IwZM7h7BS6J8Ny2bdsfGmiDgoKeffbZt956a82aNbt3725oaIiJiXnggQc6der0/2PfDQkJeeaZZzR7xf+RfkxBRXhkTOe1jae+q98vYlB/33mK6kRBJURGHkH5E9YPhhiTKR0W1H5EVBeR4j8MVvW1+NbU1Iii6FVDFUVxu93r16/v16/fXXfdtXnz5nPnznXp0uXIkSMbN24cPXr0n6ERQighIeGyq39gYOCfyWyQZbmyspI75GprazHGycnJiYmJ123u1t80voIAhOgsb6XeUna0bo+cTxD+XcMiBgpWFfxn22hKoHQXkt9OGxss+v9LBVwVRTl58mRERASPOwOAyMhIi8XSr1+/+++/32q1fv311wkJCdOmTXvnnXe++uqrzMzM1NTUP7XmXCFo+NJYn2aor6/fu3fvhg0b8vLyPB5PYmJi+/bt9+3bt23btmPHjvXo0WPIkCEtWrT42zosrsc802Rj5KLMyQ/kfrHZc1okAvrXu/wyYIqi9hCSP219X7oxjiH2L3W8OnToUH5+/vDhw3kMJwB07dr1/fffj46OJoTMmzfParVOmzYtJCTk9ttvf+GFFxYtWvTiiy/62hCuEtF2Wbl72dhLVVVramqOHz++a9euvLy8qqoqQkhSUtLw4cO7d+8eHBw8ZsyY9evX//zzz6tXr968eXNcXFynTp06deqUlJRkMBj+/I5NlmWeyMQYczgcR44c4SJf4/H/34YPQWpA9NK2DzyS980P1l91qigR9ue2LFRQgKoeWTTeHdTzpeTRCX4RCrpCvOYVGhK6XK4ff/zRZDINHTrUVyVITExkjC1fvjwnJ2fUqFHcl5uVlTVixIivvvpqyZIl991331WoQyl1OBxvvfXWpfHE3MzXzI9ts9k++uijEydOVFRUAEBwcHD//v379OmTmZnJ3eCMsfDw8IkTJ/bv3//AgQObN2/Oy8s7efLkd999FxsbGxUVNWHChEtXCb6nbPZmQUHB7Nmz+ZrgdDpra2sNBsPfNjbof4bHvPVWlDH4kei+66wHnSIRqEKBMWD48k33gAFgVcGKIun1rfzSp4f3HxXd2SzoGTDhT8sVnl9pMBjuvffexsZGrnc2k1slJSXp6ekTJ070UvaWW245c+YM9wX60kVRFF8tIjIyMiUlxePxeDyey+rHUVFR3shjADAajQ0NDQ6Ho2/fvu3bt8/MzOSW6UtD3qKjo0eOHDlw4MDTp0+fPn364MGDZ86cqaqquueeey4lsU6nu3QiGY1Gg8HgdDq5BycpKalnz57Ngi5Ay5f+t/Fh4S9PFi3VM50DKcHYRBCqV5wKkwFhQBg1/QoKoCIQwwVLr8C0YSFt+wRlxIvBkoDFf6UWC2Ps0KFDNputR48eV/IeM8asVmt9fX0zildVVQUEBPiyUJKkXbt2mUymzp07c8K53e7LysJmNg3fQU6dOmUymeLi4v4lm67H4ykuLq6rq+vYsWOzL3o8npKSEkEQYmNjfTVpVVVdLpd3YoiieNlFQ+PxvwNZlW89MvcH16FwyTQmstuEqG7+2Hii/uw5uaqKqjWSy0OoQcWhgjFMp0sSQjsEp6eYI3WY8NazWsEKbZ/3t0CD7DxnLRnt1/ofaYMGhrVDKgCCNgEJvJMhVYAyhjHCxGtJBoaYCgwhhLX+MqDVYfl7wEPlQ/UFmQFxFmKCpmbJDCFAFAECdrGPOWrqWs0Yj3MHIFqXJI3HGjSAVjdWgwaNxxo0aDzWoPFYgwaNxxo0aDzWoEHjsQaNxxo0aDzWoEHjsQYNGo81aNB4rOFawf8Dbcey/9nzuWYAAAAASUVORK5CYII=";

  /**
   * 面板主题样式
   *
   * 设计原则（本轮美化）：收敛，而不是花哨。
   *   1. 所有颜色先落地成 CSS 变量（设计令牌），业务类只引用 var(--zhs-*)，
   *      色值不再散落在几十条规则里 —— 以后改主题只改这一处。
   *   2. 间距统一走 4px 基准的倍数（4/8/12/16），同类元素间距必然一致。
   *   3. 字号只保留 6 档且用途固定：10 辅助 / 11 正文 / 12 强调 / 13 标题 /
   *      14 面板基准 / 15 品牌字。
   *   4. 圆角只保留 3 档：12 大容器 / 8 卡片 / 6 小控件（胶囊开关单独算）。
   *   5. 所有 flex 子项显式 min-width:0 / flex-shrink:0，防止中文长标签把
   *      输入框挤出面板（浏览器缩放 150%/200% 时最容易复现）。
   *
   * 注意：class 名与 DOM 结构全部保持不变 —— 07-main/13-answerer 等模块
   * 以及本文件的 _bind()/refresh() 都靠这些 class 名定位元素。
   *
   * JS 里需要读色值的少数几处不要硬编码，统一用 <模块>._color(name) 取运行时值，
   * 避免「CSS 改了、JS 没跟着改」的隐性不一致。
   */
  const CSS = `
/* ===== 设计令牌（唯一的色值出口）=====
   蓝色按 300→700 分档，数值越小越深；下面的 300/400/500/600 分别对应
   「浅底 / 主色 / 悬停色 / 深色」。 */
:host {
  all: initial;
  /* 主色（蓝） */
  --zhs-pri-300: #B5D4F4;
  --zhs-pri-300d: #D2E6FA;
  --zhs-pri-400: #185FA5;
  --zhs-pri-400d: #134B85;
  --zhs-pri-500: #2480D6;
  --zhs-pri-600: #1E6FBF;
  --zhs-pri-700: #14508F;
  --zhs-pri-ink: #0C447C;
  --zhs-pri-ink2: #042C53;
  --zhs-pri-bg: #E6F1FB;
  --zhs-pri-bg2: #F3F8FE;
  /* 成功（绿） */
  --zhs-ok-300: #5DCAA5;
  --zhs-ok-400: #1D9E75;
  --zhs-ok-500: #27C08D;
  --zhs-ok-bg: #E1F5EE;
  --zhs-ok-ink: #085041;
  --zhs-ok-ink2: #0C4A2F;
  /* 警告（暖黄） */
  --zhs-warn-bg: #FAEEDA;
  --zhs-warn-ink: #854F0B;
  --zhs-warn-ink2: #412402;
  /* 危险（红） */
  --zhs-danger-400: #A32D2D;
  --zhs-danger-bg: #FCEBEB;
  --zhs-danger-ink: #501313;
  /* 品牌（渐变，仅品牌字样与赞助按钮，不参与功能色） */
  --zhs-brand-a: #FFD56B;
  --zhs-brand-b: #FF8A3D;
  --zhs-brand-c: #FF7EB3;
  --zhs-brand-d: #FF5277;
  --zhs-brand-c2: #FF6BA3;
  --zhs-brand-d2: #F23E66;
  /* 中性（暖灰，8 档） */
  --zhs-n-0: #FFFFFF;
  --zhs-n-50: #FBFBF9;
  --zhs-n-100: #F7F6F2;
  --zhs-n-150: #F1EFE8;
  --zhs-n-200: #EDEBE4;
  --zhs-n-250: #D3D1C7;
  --zhs-n-600: #888780;
  --zhs-n-700: #5F5E5A;
  --zhs-n-800: #444441;
  --zhs-n-900: #2C2C2A;
  /* 描边与阴影 */
  --zhs-line: rgba(0,0,0,.12);
  --zhs-line-soft: rgba(0,0,0,.08);
  --zhs-line-strong: rgba(0,0,0,.18);
  --zhs-sh-sm: 0 1px 2px rgba(0,0,0,.2);
  --zhs-sh-md: 0 2px 8px rgba(0,0,0,.1);
  --zhs-sh-lg: 0 8px 32px rgba(0,0,0,.18);
  /* 间距（4px 基准） */
  --zhs-s1: 4px;
  --zhs-s2: 8px;
  --zhs-s3: 12px;
  --zhs-s4: 16px;
  /* 圆角（3 档 + 胶囊） */
  --zhs-r-lg: 12px;
  --zhs-r-md: 8px;
  --zhs-r-sm: 6px;
}

.about { padding: var(--zhs-s3); border-top: 1px dashed var(--zhs-line); background: var(--zhs-n-50); }
.about-head { display: flex; align-items: center; gap: var(--zhs-s2); margin-bottom: var(--zhs-s2); }
.retri { font-weight: 800; font-size: 15px; letter-spacing: .5px;
  background: linear-gradient(135deg,var(--zhs-brand-a),var(--zhs-brand-b)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.about-sub { font-size: 10px; color: var(--zhs-n-600); }
.about-link { display: block; padding: var(--zhs-s2) var(--zhs-s3); margin: var(--zhs-s1) 0; border-radius: var(--zhs-r-md);
  background: var(--zhs-pri-bg); color: var(--zhs-pri-ink2); text-decoration: none; font-size: 11px; font-weight: 600; }
.about-link:hover { background: var(--zhs-pri-300d); }
.about-sponsor { width: 100%; padding: var(--zhs-s2) var(--zhs-s3); margin: var(--zhs-s1) 0; border: none; border-radius: var(--zhs-r-md);
  background: linear-gradient(135deg,var(--zhs-brand-c),var(--zhs-brand-d)); color: var(--zhs-n-0); cursor: pointer; font-size: 13px; font-weight: 700; }
.about-sponsor:hover { background: linear-gradient(135deg,var(--zhs-brand-c2),var(--zhs-brand-d2)); }
.qr-box { text-align: center; padding: var(--zhs-s2) 0 var(--zhs-s1); }
.qr-box img { width: 180px; height: auto; border: 1px solid var(--zhs-line); border-radius: var(--zhs-r-md); }
.qr-box div { font-size: 10px; color: var(--zhs-n-600); margin-top: var(--zhs-s1); }
.sf-box { margin-top: var(--zhs-s2); }
.invite-code { width: 100%; display: flex; align-items: center; justify-content: center; gap: var(--zhs-s1);
  padding: var(--zhs-s2) var(--zhs-s3); margin: var(--zhs-s1) 0 0; border: 1px dashed var(--zhs-pri-300); border-radius: var(--zhs-r-md);
  background: var(--zhs-pri-bg2); color: var(--zhs-pri-400); cursor: pointer; font-size: 11px; font-weight: 600; }
.invite-code:hover { background: var(--zhs-pri-bg); border-style: solid; }
.invite-code b { font-family: ui-monospace, Consolas, monospace; font-size: 12px; letter-spacing: .5px; color: var(--zhs-pri-ink); }
.invite-code .copy-tip { font-size: 10px; font-weight: 400; color: var(--zhs-n-600); }
.invite-code.copied { background: var(--zhs-ok-bg); border-color: var(--zhs-ok-300); color: var(--zhs-ok-ink); }
.invite-code.copied .copy-tip { color: var(--zhs-ok-400); }

.wrap { position: fixed; right: var(--zhs-s4); bottom: var(--zhs-s4); z-index: 2147483647;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 14px; }
/* 盒模型统一成 border-box，否则 padding 会叠加到 width:330px 上，
   计算面板总高时永远对不上（也影响下面 --zhs-body-max 的取值）。 */
.wrap, .wrap *, .wrap *::before, .wrap *::after { box-sizing: border-box; }
/* 面板高度自适应：视口不够高时按比例收窄可滚动区，保证头部/标签页/底部按钮栏
   三段始终可见，绝不会被视口裁掉。
   算法：360px 是可滚动区上限；视口最多分 42% 给它；
   再减去除可滚动区以外的固定高度（头部 43 + 标签页 36 + 底部按钮 86 + 外边距 32）。 */
.wrap {
  --zhs-body-max: 320px;              /* 兜底值：不支持 min() 的老内核 */
  --zhs-body-max: max(120px, min(320px, 42vh - 120px));
}
@media (min-height: 821px) { .wrap { --zhs-body-max: 360px; } }
@media (max-height: 720px) { .wrap { --zhs-body-max: 220px; } }
@media (max-height: 560px) { .wrap { --zhs-body-max: 150px; } }
@media (max-height: 430px) { .wrap { --zhs-body-max: 110px; } }

.mini { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, var(--zhs-pri-600), var(--zhs-pri-700));
  color: var(--zhs-n-0); display: flex; align-items: center; justify-content: center; cursor: pointer;
  border: none; font-size: 15px; font-weight: 600; box-shadow: 0 3px 12px rgba(24,95,165,.35);
  transition: transform .12s, box-shadow .12s; }
.mini:hover { transform: scale(1.08); box-shadow: 0 4px 16px rgba(24,95,165,.5); }
.mini:active { transform: scale(.95); }

.panel { width: 330px; background: var(--zhs-n-0); border: 1px solid var(--zhs-line); border-radius: var(--zhs-r-lg);
  overflow: hidden; box-shadow: var(--zhs-sh-lg); display: none; }
.panel.show { display: block; }

.head { padding: var(--zhs-s3) var(--zhs-s3); background: linear-gradient(135deg, var(--zhs-pri-600), var(--zhs-pri-700));
  display: flex; align-items: center; justify-content: space-between; gap: var(--zhs-s2); }
.head b { font-size: 14px; font-weight: 600; color: var(--zhs-n-0); letter-spacing: .3px;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head .btns { flex-shrink: 0; }
.head .btns button { background: rgba(255,255,255,.15); border: none; cursor: pointer; color: var(--zhs-n-0);
  font-size: 14px; line-height: 1.2; padding: var(--zhs-s1) var(--zhs-s2); border-radius: var(--zhs-r-sm); transition: background .12s; }
.head .btns button:hover { background: rgba(255,255,255,.28); }

.tabs { display: flex; border-bottom: 1px solid var(--zhs-line); background: var(--zhs-n-0); }
.tabs button { flex: 1; padding: var(--zhs-s2) 0; border: none; background: none; cursor: pointer;
  font-size: 13px; color: var(--zhs-n-700); border-bottom: 2px solid transparent; transition: color .12s; }
.tabs button:hover { color: var(--zhs-pri-400); }
.tabs button.on { color: var(--zhs-pri-400); border-bottom-color: var(--zhs-pri-400); font-weight: 600; }

.body { padding: var(--zhs-s3); max-height: var(--zhs-body-max); overflow-y: auto;
  color: var(--zhs-n-900); }   /* 显式给文字色：.wrap 上只有 font-size，颜色靠继承，
                                  页面里若有「全局把文字设成黑色」的样式，
                                  暗色主题下就会变成黑字黑底、内容看不见。
                                  注：CSS 注释里不能出现反引号，会提前结束模板串。 */
.body .pane { display: none; }
.body .pane.on { display: block; }
/* .row / .report 等行内设了字的元素同理：颜色一律显式声明，不依赖继承 */
/* 状态页课程进度条 */
.cprog-bar { height: 6px; border-radius: 3px; background: var(--zhs-n-200); overflow: hidden; margin: var(--zhs-s2) 0 var(--zhs-s3); }
.cprog-bar > i { display: block; height: 100%; width: 0;
  background: linear-gradient(90deg, var(--zhs-ok-400), var(--zhs-ok-500)); border-radius: 3px; transition: width .4s; }

.row { display: flex; align-items: center; justify-content: space-between; gap: var(--zhs-s2); padding: var(--zhs-s1) 0; }
.row label { color: var(--zhs-n-900); min-width: 0; }
.row .val { color: var(--zhs-n-600); font-size: 11px; flex-shrink: 0; }
/* 开关/输入框不能被长中文标签挤变形 */
.row .sw { flex: 0 0 auto; }
.row > .inp, .row > input, .row > select { flex-shrink: 0; }

.kv { display: flex; justify-content: space-between; gap: var(--zhs-s2); padding: var(--zhs-s1) 0; border-bottom: 1px dashed var(--zhs-line-soft); }
.kv span:first-child { color: var(--zhs-n-700); min-width: 0; }
.kv span:last-child { color: var(--zhs-n-900); font-weight: 500; flex-shrink: 0;
  max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.sw { width: 36px; height: 19px; border-radius: 10px; background: var(--zhs-n-250); position: relative;
  cursor: pointer; border: none; transition: background .15s; flex: 0 0 auto; }
.sw.on { background: var(--zhs-ok-400); }
.sw:disabled { opacity: .45; cursor: not-allowed; }
.sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px;
  border-radius: 50%; background: var(--zhs-n-0); transition: left .15s; box-shadow: var(--zhs-sh-sm); }
.sw.on::after { left: 19px; }

.logs { font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.6; }
.logs div { padding: 1px 0; word-break: break-all; color: var(--zhs-n-800); }
.logs .warn { color: var(--zhs-warn-ink); }
.logs .error { color: var(--zhs-danger-400); }

.alert { margin: 0 var(--zhs-s3) var(--zhs-s2); padding: var(--zhs-s2) var(--zhs-s2); border-radius: var(--zhs-r-sm); font-size: 11px; display: none; }
.alert.warn { background: var(--zhs-warn-bg); color: var(--zhs-warn-ink2); display: block; }
.alert.info { background: var(--zhs-pri-bg); color: var(--zhs-pri-ink2); display: block; }
.alert.error { background: var(--zhs-danger-bg); color: var(--zhs-danger-ink); display: block; }

/* 底部按钮：保持「四个按钮一行」的原布局（不改成 2×2）。
   注：曾试过 grid 2×2，实测在 border-box 下反而把可滚动区挤塌，
   而且一行四键更省纵向空间 —— 能用就不折腾。 */
.foot { padding: var(--zhs-s2) var(--zhs-s3); border-top: 1px solid var(--zhs-line);
  background: var(--zhs-n-100); display: flex; gap: var(--zhs-s1); }
.foot button { flex: 1; min-width: 0; padding: var(--zhs-s2) 0; border: 1px solid rgba(0,0,0,.15); border-radius: var(--zhs-r-sm);
  background: var(--zhs-n-0); cursor: pointer; font-size: 11px; color: var(--zhs-n-900); font-weight: 500;
  transition: background .12s, transform .08s, opacity .12s; }
.foot button:hover:not(:disabled) { background: var(--zhs-n-150); }
.foot button:active:not(:disabled) { transform: scale(.96); }
.foot button:disabled { opacity: .55; cursor: not-allowed; }
.foot button.pri { background: linear-gradient(135deg, var(--zhs-pri-600), var(--zhs-pri-700)); color: var(--zhs-n-0); border-color: var(--zhs-pri-700); }
.foot button.pri:hover:not(:disabled) { background: linear-gradient(135deg, var(--zhs-pri-500), var(--zhs-pri-400d)); }
.foot button.pri:disabled { background: var(--zhs-pri-300); border-color: var(--zhs-pri-300); }
.foot button.loading { position: relative; color: transparent !important; pointer-events: none; }
.foot button.loading::after { content: ""; position: absolute; left: 50%; top: 50%;
  width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.4); border-top-color: var(--zhs-n-0); animation: zhs-spin .7s linear infinite; }
.foot button.loading.btn-plain::after { border-color: rgba(0,0,0,.15); border-top-color: var(--zhs-n-700); }
@keyframes zhs-spin { to { transform: rotate(360deg); } }

.inp { width: 152px; max-width: 152px; font-size: 11px; padding: var(--zhs-s1) var(--zhs-s2); border: 1px solid var(--zhs-line-strong);
  border-radius: var(--zhs-r-sm); background: var(--zhs-n-0); color: var(--zhs-n-900); transition: border .12s, box-shadow .12s; }
.inp:focus { outline: none; border-color: var(--zhs-pri-600); box-shadow: 0 0 0 2px rgba(30,111,191,.15); }
.sel-inp { width: 110px; }
.mini-btn { font-size: 10px; padding: var(--zhs-s1) var(--zhs-s2); border: 1px solid var(--zhs-line-strong);
  border-radius: var(--zhs-r-sm); background: var(--zhs-n-0); cursor: pointer; color: var(--zhs-n-900);
  transition: background .12s, opacity .12s; }
.mini-btn:hover:not(:disabled) { background: var(--zhs-n-150); }
.mini-btn:disabled { opacity: .55; cursor: not-allowed; }
.mini-btn.ok { background: var(--zhs-ok-bg); border-color: var(--zhs-ok-400); color: var(--zhs-ok-ink2); }
.mini-btn.bad { background: var(--zhs-danger-bg); border-color: var(--zhs-danger-400); color: var(--zhs-danger-ink); }

.hint { font-size: 10px; color: var(--zhs-n-600); padding: var(--zhs-s1) 0 var(--zhs-s2); line-height: 1.6; min-width: 0; overflow-wrap: anywhere; }
.sec-title { margin: var(--zhs-s3) 0 var(--zhs-s1); font-size: 12px; font-weight: 600; color: var(--zhs-pri-400); }

/* 首次使用引导卡 */
.guide { margin: 0 0 var(--zhs-s3); padding: var(--zhs-s3); border-radius: var(--zhs-r-md); background: var(--zhs-pri-bg);
  border: 1px solid var(--zhs-pri-300); }
.guide h4 { margin: 0 0 var(--zhs-s2); font-size: 13px; color: var(--zhs-pri-ink2); }
.guide ol { margin: 0 0 var(--zhs-s3); padding-left: 18px; color: var(--zhs-pri-ink2); font-size: 11px; line-height: 1.8; }
.guide button { width: 100%; padding: var(--zhs-s2) 0; font-size: 11px; border: none; border-radius: var(--zhs-r-sm);
  background: var(--zhs-pri-400); color: var(--zhs-n-0); cursor: pointer; font-weight: 500; }
.guide button:hover { background: var(--zhs-pri-400d); }

/* 完成总结弹层 */
.report { margin: 0 var(--zhs-s3) var(--zhs-s2); padding: var(--zhs-s3); border-radius: var(--zhs-r-md); background: var(--zhs-pri-bg);
  border: 1px solid var(--zhs-pri-300); display: none; }
.report.show { display: block; }
.report h4 { margin: 0 0 var(--zhs-s2); font-size: 13px; color: var(--zhs-pri-ink2); font-weight: 600; }
.report .line { display: flex; justify-content: space-between; gap: var(--zhs-s2); font-size: 11px; padding: 2px 0; color: var(--zhs-pri-ink2); }
.report .line b { font-weight: 600; flex-shrink: 0; }
.report .line span:first-child { color: var(--zhs-pri-400); min-width: 0; }
.report .close-rp { margin-top: var(--zhs-s2); width: 100%; padding: var(--zhs-s1) 0; font-size: 10px;
  border: 1px solid var(--zhs-pri-400); background: var(--zhs-n-0); color: var(--zhs-pri-400); border-radius: var(--zhs-r-sm); cursor: pointer; }

/* 暗色主题跟随（不引入 class，纯媒体查询 —— JS 侧零改动、零风险）
   只覆盖会影响观感的中性色令牌，品牌蓝/绿保持原样，视觉基调不变。
   注意：这里的色值【必须】以 var() 定义引用已有的基础令牌来做派生，
   所以下面这组值本身是新值，但它们同样只出现在「令牌定义区」，
   业务规则（.row/.panel/.foot …）里依旧一个裸色值都没有。 */
@media (prefers-color-scheme: dark) {
  :host {
    --zhs-line: rgba(255,255,255,.14);
    --zhs-line-soft: rgba(255,255,255,.1);
    --zhs-line-strong: rgba(255,255,255,.22);
    --zhs-sh-lg: 0 8px 32px rgba(0,0,0,.6);
    --zhs-sh-md: 0 2px 8px rgba(0,0,0,.4);
    --zhs-sh-sm: 0 1px 2px rgba(0,0,0,.5);
    /* 暖灰阶整体反转：n-0 是「面板底色」，暗色下变成深底 */
    --zhs-n-0: #14140F;
    --zhs-n-50: #17170F;
    --zhs-n-100: #1B1B15;
    --zhs-n-150: #21211A;
    --zhs-n-200: #2A2A22;
    --zhs-n-250: #4A4A40;
    --zhs-n-600: #9C9B93;
    --zhs-n-700: #B2B1A9;
    --zhs-n-800: #D8D6CE;
    --zhs-n-900: #F2F0EA;
    /* 语义底色压暗、文字色提亮，保证对比度 */
    --zhs-pri-bg: #16293C;
    --zhs-pri-bg2: #12202E;
    --zhs-pri-ink: #CFE3F8;
    --zhs-pri-ink2: #E2EEFB;
    --zhs-ok-bg: #12291F;
    --zhs-ok-ink: #B7EBD8;
    --zhs-ok-ink2: #C9F1E2;
    --zhs-warn-bg: #362712;
    --zhs-warn-ink: #F0C079;
    --zhs-warn-ink2: #F6D9AC;
    --zhs-danger-bg: #33191A;
    --zhs-danger-ink: #F3B9B9;
  }
  /* 暗色下描边不能再叠白线，否则发灰发脏 */
  .inp, .foot button, .mini-btn { border-color: var(--zhs-line-strong); }
  .about-link { color: var(--zhs-pri-ink2); }
}
`;

  /**
   * 设计令牌的「静态兜底值」。
   *
   * 用途：JS 里偶尔需要给元素直接设 color（例如状态数字"未看完"变橙）。
   * 优先从 :host 的 CSS 变量读实时值（见 Panel._color），读不到时用这里的兜底。
   *
   * 为什么要单独列一张表、不散落在调用点：
   *   1. 值只在【这一处】出现，改主题时改这里 + CSS 变量定义区即可；
   *   2. 测试可以断言「调用点没有裸色值」，防止以后又有人写死颜色；
   *   3. 名字与 CSS 令牌同名（ok-400 → --zhs-ok-400），一眼能对上。
   */
  const COLOR_FALLBACK = {
    'ok-400': '#1D9E75',
    'warn-ink': '#854F0B',
    'pri-ink2': '#042C53',
  };

  /**
   * 清洗 API Key：去掉全部空白字符。
   * 用户常从网页/文档里复制 Key，容易混进首尾空格或换行——带着空格的 Key
   * 会让请求直接超时或 401，而面板毫无提示，是个纯隐形坑。
   */
  function normKey(s) {
    return String(s || '').replace(/\s+/g, '');
  }

  const Panel = {
    _root: null,
    _shadow: null,
    _tabs: ['home', 'log', 'cfg'],

    mount() {
      if (this._root && document.contains(this._root)) return;
      const host = document.createElement('div');
      host.id = 'zhs-helper-panel';
      host.style.cssText = 'all:initial';
      this._shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = CSS;
      this._shadow.appendChild(style);

      const box = document.createElement('div');
      box.className = 'wrap';
      box.innerHTML = this._html();
      this._shadow.appendChild(box);

      document.documentElement.appendChild(host);
      this._root = host;

      this._bind(box);
      this._bindFullscreen();
      this.refresh();
        // panelVisible=false 时面板默认隐藏（用户仍可点 .mini 唤出）
        if (ZHS.config.panelVisible === false) {
          const _p = box.querySelector('.panel');
          if (_p) _p.classList.remove('show');
        }
      ZHS.Log.debug('控制面板已挂载');
    },

    // ================================================================
    // 全屏适配：为什么必须做迁移，而不是调大 z-index
    //
    // 进入 Fullscreen API 全屏后，浏览器【只渲染全屏元素及其子树】。
    // 面板挂在 document.documentElement 下，不在全屏元素的子树里，
    // 于是被整体隐藏 —— z-index 调到 2147483647 也没用，它压根不参与渲染。
    //
    // 唯一的正解是把承载面板的 host 元素 appendChild 进全屏元素内部。
    // Shadow DOM 是挂在 host 上的，移动 host 不会丢 Shadow 内容；
    // 状态（当前 tab / 开关 / 日志 / 滚动位置）也都活在 DOM 里，一并保留。
    // ================================================================

    /** 记录已绑定过 fullscreenchange 的 document 对象（去重，支持 iframe 多 document） */
    _fsBoundDocs: null,
    /** 全屏状态机：'' 空闲 | 'mounted' 已挂进全屏元素 | 'failed' 挂不进去 */
    _fsState: '',
    /** 挂载失败后的复查定时器 */
    _fsTimer: null,
    /** 全屏期间挂载失败待告知用户的标记（退出全屏后弹提示） */
    _fsFailedNotice: false,

    /**
     * 挑一个能真正承载子元素的容器来挂面板。
     *
     * 坑：document.fullscreenElement 常常就是 <video> 本身，
     * 而 <video> 是替换元素，内部不会渲染任何子节点 —— 挂进去等于没挂。
     * 所以要按顺序找：全屏元素自己 → 它的祖先链 → 兜底回 documentElement。
     *
     * @param {Element|null} el 全屏元素
     * @returns {Element} 面板 host 应该挂到哪里
     */
    _pickMountTarget(el) {
      const canHost = (n) => !!n && n.nodeType === 1
        && n.tagName !== 'VIDEO' && n.tagName !== 'AUDIO' && n.tagName !== 'IFRAME';

      if (!canHost(el)) {
        // 全屏元素是 <video>：从它自己开始往上找（parentElement 依次是
        // 播放器容器 → 布局容器 → …），第一个「非 video/audio/iframe」的祖先即可承载。
        let p = el && el.parentElement;
        while (p && p.nodeType === 1) {
          if (canHost(p)) return p;
          p = p.parentElement;
        }
        // 一路到顶都没找到video以上的容器（video 已直挂 html）：退回 html
        return document.documentElement || null;
      }
      return el;
    },

    /**
     * 全屏元素本身是不是 <video>/<audio>（浏览器原生播放器全屏）。
     *
     * 为什么单独判断：容器全屏（例如 div.player 全屏）时，把面板挂进该 div
     * 就能正常显示；但【对 <video> 调 requestFullscreen】时，Chrome 进入的是
     * 「原生视频全屏」，屏幕上只合成 video 元素自己 —— 哪怕 DOM 上把面板
     * 挂进它的兄弟容器，实测也不渲染（截图验证过，全黑只剩原生控件）。
     * 这是浏览器渲染管线的行为，改 DOM 结构解决不了，必须走降级路径。
     */
    _isNativeMediaFullscreen(el) {
      return !!el && el.nodeType === 1
        && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO');
    },

    /**
     * 把面板 host 迁移到目标容器内。
     * @returns {boolean} 是否迁移成功
     */
    _moveTo(target) {
      if (!this._root || !target || typeof target.appendChild !== 'function') return false;
      try {
        target.appendChild(this._root);
      } catch (e) {
        ZHS.Log.warn('[面板] 迁移到全屏元素失败：' + e.message);
        return false;
      }
      // 确认真的进去了（appendChild 在某些宿主上会被静默拒绝）
      if (this._root.parentNode !== target) return false;
      // 迁移后重新回填一次状态：面板此刻才可能具备真实布局，
      // 刷新一次保证 tab/开关/日志/进度都与后台一致（不会丢状态，只是重画）。
      try { this.refresh(); } catch (e) { /* refresh 失败不影响可见性 */ }
      return true;
    },

    /** 面板此刻是否真的可渲染（宽高都 > 0） */
    _panelLooksVisible() {
      if (!this._root) return false;
      let rect = null;
      try { rect = this._root.getBoundingClientRect(); } catch (e) { return false; }
      if (!rect) return false;
      if (rect.width > 0 && rect.height > 0) return true;
      // Shadow DOM：host 自身是 0×0 也是正常的（子内容撑开），再看宿主是否连接
      const box = this._shadow && this._shadow.querySelector('.wrap');
      if (box) {
        try {
          const r2 = box.getBoundingClientRect();
          if (r2 && r2.width > 0 && r2.height > 0) return true;
        } catch (e) { /* 忽略 */ }
      }
      // jsdom 无布局引擎（所有 rect 恒为 0），此时不把「测不出」当成「不可见」，
      // 否则真实测试环境里会误判成挂载失败。只有确有全屏容器却挂不进去才算失败。
      return !!(this._root.parentNode && this._root.parentNode.nodeType === 1);
    },

    /**
     * 开始监听指定 document 的 fullscreenchange（幂等，支持 iframe）
     *
     * 关键坑（踩过）：绝对【不能】直接写 addEventListener('fullscreenchange', this._onFullscreenChange)。
     * 浏览器把函数当监听器调用时 this 不是 Panel，而是事件目标（或 undefined），
     * 处理器里第一行 this._root 就会抛 TypeError。
     * 表现是「事件确实派发了，但脚本一点反应都没有」—— 测试若只调用
     * panel._onFullscreenChange() 则永远发现不了（那是带着正确 this 调用的）。
     * 所以这里用闭包固定 this，并在测试里以「监听器身份」调用做回归。
     */
    _bindFullscreen() {
      if (!this._fsBoundDocs) this._fsBoundDocs = [];
      const self = this;
      const handler = function () { return self._onFullscreenChange(); };
      const docs = this._fsDocs();
      for (const d of docs) {
        if (this._fsBoundDocs.indexOf(d) >= 0) continue;
        try {
          d.addEventListener('fullscreenchange', handler);
          d.addEventListener('webkitfullscreenchange', handler);
          this._fsBoundDocs.push(d);
        } catch (e) { /* 跨域 iframe 拿不到 document，忽略 */ }
      }
    },

    /** 需要监听的 document 列表：当前页面 + 已注入的同源 iframe */
    _fsDocs() {
      const list = [];
      if (typeof document !== 'undefined' && document) list.push(document);
      try {
        const frames = document.querySelectorAll('iframe');
        for (const f of frames) {
          // 跨域 iframe 访问 contentDocument 会抛错 —— 这种帧里脚本本来也注入不进去
          try { if (f.contentDocument) list.push(f.contentDocument); } catch (e) { /* 跨域忽略 */ }
        }
      } catch (e) { /* 忽略 */ }
      return list;
    },

    /**
     * 当前生效的全屏元素（兼容 webkit 前缀；含 iframe 内文档）
     *
     * 为什么还要做「几何兜底」：
     * 有些浏览器 / 播放器进入全屏时不维护 document.fullscreenElement
     * （旧 webkit 内核、某些内嵌播放器自绘全屏）。这时 API 读出来是 null，
     * 但「面板确实看不见」这件事是真实发生的。所以 API 读不到时，
     * 再找一次「铺满视口最顶层的大容器」，作为候选全屏宿主。
     */
    _fsElement() {
      for (const d of this._fsDocs()) {
        let el = null;
        try {
          el = d.fullscreenElement || d.webkitFullscreenElement
            || d.webkitCurrentFullScreenElement || null;
        } catch (e) { el = null; }
        if (el) return el;
      }
      return this._guessFullscreenContainer();
    },

    /**
     * 几何兜底：猜「铺满视口的全屏容器」。
     * 判据（三条都要满足，避免误伤普通满屏布局）：
     *   1. 它是 <body> 的某一层祖先/自身，且不是 html/body 自己；
     *   2. position 是 fixed 或 absolute（全屏容器几乎都这么写）；
     *   3. 尺寸接近整个视口（≥ 视口的 90%）。
     * 找不到就返回 null（表示「这里没有全屏」）。
     */
    _guessFullscreenContainer() {
      if (typeof document === 'undefined' || !document || !document.body) return null;
      let vw = 0, vh = 0;
      try {
        vw = (window && window.innerWidth) || 0;
        vh = (window && window.innerHeight) || 0;
      } catch (e) { return null; }
      // 视口尺寸读不到（jsdom 等无布局环境）时不猜，避免误判
      if (!vw || !vh) return null;

      let best = null, bestArea = 0;
      const all = document.body.querySelectorAll('div,section,main,article,aside');
      for (const el of all) {
        let cs = null, rect = null;
        try {
          cs = window.getComputedStyle(el);
          rect = el.getBoundingClientRect();
        } catch (e) { continue; }
        if (!cs || !rect) continue;
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        if (rect.width < vw * 0.9 || rect.height < vh * 0.9) continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const area = rect.width * rect.height;
        // 取面积最大的那个（最外层的全屏容器），而不是第一个命中的
        if (area > bestArea) { best = el; bestArea = area; }
      }
      return best;
    },

    /**
     * 全屏状态变化时的真实动作（测试里直接调它，不依赖浏览器派发事件）。
     * 迁移 / 回迁 / 失败兜底都在这里。
     */
    _onFullscreenChange() {
      if (!this._root) return;
      // 顺带补绑 iframe 的 document（iframe 可能是全屏之后才插入的）
      this._bindFullscreen();

      const fsEl = this._fsElement();
      if (!fsEl) {
        // ---- 退出全屏：迁回 html ----
        const wasNative = this._fsState === 'native-media';
        this._fsState = '';
        if (this._fsTimer) { clearTimeout(this._fsTimer); this._fsTimer = null; }
        if (this._root.parentNode !== document.documentElement) {
          this._moveTo(document.documentElement);
          ZHS.Log.info('[面板] 已迁移回页面根节点（退出全屏）');
        }
        // 退出全屏后再把「刚才全屏下助手不可用」这件事告诉用户 ——
        // 全屏时面板看不见，alert 也看不见，只有退出后通知才有意义。
        if (this._fsFailedNotice) {
          this._fsFailedNotice = false;
          this.alert(wasNative
            ? '刚才用的是视频「原生全屏」，浏览器不允许助手面板与视频同时显示；助手仍在后台运行。想要全屏看到面板：改点页面上的全屏按钮，或在设置里开启「全屏挂不上就退全屏」。'
            : '刚才全屏时悬浮窗挂不进去，助手仍在后台运行（已记录）', 'warn', 15000);
          ZHS.Log.warn('[面板] 全屏期间面板不可见，已恢复并记录');
        }
        return;
      }

      // ---- 进入（或切换）全屏 ----
      //
      // 分两种情况，结论完全不同：
      //   (a) 容器全屏（div 全屏）→ 把 host 挂进该容器，面板即可见。这是主路径。
      //   (b) 原生媒体全屏（直接对 <video> 调 requestFullscreen）→ 屏幕只合成
      //       video 自己，挂 DOM 也没用（已用真实 Chrome 截图验证）。
      //       这里仍然把 host 挂到播放器容器内（保证 DOM 归属正确、退出后无残留），
      //       但标记为 native-media，让降级流程来决定要不要自动退全屏。
      const nativeMedia = this._isNativeMediaFullscreen(fsEl);
      const target = this._pickMountTarget(fsEl);
      const moved = this._moveTo(target);

      if (moved && this._root.parentNode !== document.documentElement) {
        this._fsState = nativeMedia ? 'native-media' : 'mounted';
        this._fsFailedNotice = nativeMedia;
        ZHS.Log.info(nativeMedia
          ? '[面板] 检测到 <video> 原生全屏：悬浮窗无法与视频同时显示，已转入降级流程'
          : '[面板] 已迁移到全屏元素内');
        this._scheduleFullscreenCheck();
        return;
      }

      // 连挂都挂不进去 → 进入降级流程
      this._fsState = 'failed';
      this._fsFailedNotice = true;
      ZHS.Log.warn('[面板] 全屏下无法挂载悬浮窗，进入降级模式（后台功能不受影响）');
      this._scheduleFullscreenCheck();
    },

    /**
     * 进入全屏 3 秒后复查。两种情况都需要善后：
     *   - 状态是 native-media：<video> 原生全屏，面板必定看不到，直接走降级
     *   - 其他状态但实测仍不可见：被蒙层盖住等意外情况，也走降级
     */
    _scheduleFullscreenCheck() {
      if (this._fsTimer) { clearTimeout(this._fsTimer); this._fsTimer = null; }
      this._fsTimer = setTimeout(() => {
        this._fsTimer = null;
        if (!this._root) return;
        if (!this._fsElement()) return;           // 已经退出全屏了，无需处理
        if (this._fsState === 'native-media') { this._exitFullscreenFallback(); return; }
        if (this._panelLooksVisible()) return;     // 挂载有效，什么都不做
        this._exitFullscreenFallback();
      }, 3000);
    },

    /**
     * 降级兜底：强制退出全屏。
     *
     * 默认【绝不】替用户退全屏 —— 用户在全屏看课被弹出来是极差体验。
     * 只有用户自己把「全屏挂不上就退全屏」开关打开（默认 false）才执行，
     * 并且退出前也在日志里写明原因。
     *
     * 有一种情况即使用户没开开关也值得提示：<video> 原生全屏下面板 100%
     * 看不到（浏览器渲染层限制，已用真实 Chrome 截图验证）。这时依旧保持
     * 默认「不退全屏」，但会在退出全屏后用 alert 告知用户（见 _onFullscreenChange）。
     */
    _exitFullscreenFallback() {
      if (ZHS.config.exitFullscreenOnPanel !== true) {
        ZHS.Log.info(this._fsState === 'native-media'
          ? '[面板] <video> 原生全屏下悬浮窗无法显示（未开启自动退全屏，助手继续后台运行）'
          : '[面板] 全屏下悬浮窗不可见（未开启自动退全屏，助手继续后台运行）');
        return;
      }
      try {
        const d = (this._fsDocs().find((dd) => {
          try { return !!(dd.fullscreenElement || dd.webkitFullscreenElement); } catch (e) { return false; }
        })) || document;
        if (typeof d.exitFullscreen === 'function') d.exitFullscreen().catch(() => {});
        else if (typeof d.webkitExitFullscreen === 'function') d.webkitExitFullscreen();
        ZHS.Log.info('[面板] 全屏下悬浮窗不可见，已按设置自动退出全屏');
      } catch (e) {
        ZHS.Log.warn('[面板] 自动退出全屏失败：' + e.message);
      }
    },

    _html() {
      return `
<button class="mini" title="智慧树助手">智</button>
<div class="panel show">
  <div class="head">
    <b>智慧树助手 v${ZHS.version}</b>
    <div class="btns"><button class="fold" title="收起">—</button></div>
  </div>
  <div class="tabs">
    <button data-tab="home" class="on">状态</button>
    <button data-tab="log">日志</button>
    <button data-tab="cfg">设置</button>
  </div>
  <div class="alert"></div>
  <div class="report"></div>
  <div class="body">
    <div class="pane on" data-pane="home">
      <div class="guide" id="zhs-guide" style="display:none">
        <h4>第一次用？三步搞定</h4>
        <ol>
          <li>点底部「启动」—— 之后全自动：播放、跳课、答题、切下一集都不用管</li>
          <li>自动答题已默认开启；没填 API Key、题库也查不到时，脚本<b>不作答</b>并弹提示（不瞎蒙，避免错答拉分）</li>
          <li>全部看完会自动弹出总结并停止</li>
        </ol>
        <button class="guide-ok">我知道了，开始用</button>
      </div>
      <div class="kv"><span>运行状态</span><span class="s-run">—</span></div>
      <div class="kv"><span>课程进度</span><span class="s-cprog">—</span></div>
      <div class="cprog-bar"><i></i></div>
      <div class="kv"><span>当前课时</span><span class="s-lesson">—</span></div>
      <div class="kv"><span>视频进度</span><span class="s-vprog">—</span></div>
      <div class="kv"><span>未看完</span><span class="s-undone">—</span></div>
      <div class="kv"><span>未解锁</span><span class="s-locked">—</span></div>
      <div class="kv"><span>本次完成</span><span class="s-done-run">0 节</span></div>
      <div class="kv"><span>已答题数</span><span class="s-ans">0</span></div>
      <div class="kv"><span>本次运行</span><span class="s-uptime">—</span></div>
    </div>
    <div class="pane" data-pane="log">
      <div class="logs"></div>
    </div>
    <div class="pane" data-pane="cfg">
      <div class="row"><label>自动播放</label><button class="sw" data-cfg="autoPlay"></button></div>
      <div class="row"><label>自动下一节</label><button class="sw" data-cfg="autoNext"></button></div>
      <div class="row"><label>跳过已完成</label><button class="sw" data-cfg="skipFinished"></button></div>
      <div class="row"><label>静音</label><button class="sw" data-cfg="mute"></button></div>
      <div class="row"><label>断点续播</label><button class="sw" data-cfg="resume"></button></div>
      <div class="row"><label>倍速</label><input type="range" min="1" max="1.8" step="0.1" data-cfg-num="speed" style="width:100px"><span class="v-speed"></span></div>

      <div class="row"><label>自动跳课</label><button class="sw" data-cfg="autoCourseHop"></button></div>
      <div class="hint">本课学完自动去课程中心找下一门</div>
      <div class="row"><label>自动选课</label><button class="sw" data-cfg="autoCoursePick"></button></div>
      <div class="hint">在课程中心自动进入未学完的课程</div>

      <div class="sec-title">AI 答题</div>
      <div class="row"><label>自动答题</label><button class="sw" data-cfg="autoAnswer"></button></div>
      <div class="row"><label>课中弹题自动答</label><button class="sw" data-cfg="answerDialog"></button></div>
      <div class="row"><label>作业页自动答</label><button class="sw" data-cfg="answerHomework"></button></div>
      <div class="row"><label>自动答题（作业/考试）</label><button class="sw" data-cfg="autoExam"></button></div>
      <div class="hint">默认关闭。仅在你自己点进作业/考试页时生效，不会自动跳转，
        也不会自动进入任何作业或考试。</div>
      <div class="row"><label>答完自动提交</label><button class="sw" data-cfg="examSubmit"></button></div>
      <div class="row"><label>作答章节范围</label>
        <span>
          <input type="number" class="in-exfrom inp" data-cfg="examChapterFrom" min="0" max="200" style="width:56px">
          <span style="font-size:11px;color:var(--zhs-n-700)"> ~ </span>
          <input type="number" class="in-exto inp" data-cfg="examChapterTo" min="0" max="200" style="width:56px">
        </span>
      </div>
      <div class="hint">0 表示不限，如填 1 和 3 表示只答第 1~3 章。<br>
        （当前版本多数入口拿不到章节号，拿不到时会按全部作答并在日志里说明）</div>
      <div class="row"><label>答完自动关闭</label><button class="sw" data-cfg="autoCloseDialog"></button></div>
      <div class="row"><label>题库通道</label><button class="sw" data-cfg="bankEnabled"></button></div>
      <div class="row"><label>LLM 通道</label><button class="sw" data-cfg="llmEnabled"></button></div>
      <div class="hint">默认是「不蒙」：没时可答题通道就留空不答（可事后手工作答）。<br>
        勾选后才会在走投无路时随机选一个，保证流程不卡住。</div>
      <div class="row"><label>无通道时随机兜底</label><button class="sw" data-cfg="gatedRandom"></button></div>
      <div class="row"><label>答题模式</label>
        <select class="sel-mode inp">
          <option value="both">双通道</option>
          <option value="bank">仅题库</option>
          <option value="llm">仅LLM</option>
        </select>
      </div>
      <div class="row"><label>题库地址</label><input type="text" class="in-bank inp" placeholder="http://localhost:8060"></div>
      <div class="row"><label>投票次数</label><input type="number" class="in-vote inp" min="1" max="5" style="width:60px"></div>

      <div class="sec-title">模型接口（OpenAI 兼容）</div>
      <div class="hint">填 Key 后可用任意兼容接口：DeepSeek / 通义 / Kimi / 本地 Ollama 等</div>
      <div class="row"><label>API 地址</label><input type="text" class="in-base inp" placeholder="https://api.deepseek.com"></div>
      <div class="row"><label>模型名</label><input type="text" class="in-model inp" placeholder="deepseek-chat" list="model-list">
        <datalist id="model-list">
          <option value="deepseek-chat"></option>
          <option value="deepseek-reasoner"></option>
          <option value="qwen-plus"></option>
          <option value="moonshot-v1-8k"></option>
        </datalist>
      </div>
      <div class="row"><label>API Key</label><input type="password" class="in-key inp" placeholder="sk-..."></div>
      <div class="row"><label></label>
        <span>
          <button class="mini-btn btn-lmtest">测试连接</button>
          <button class="mini-btn btn-savekey">保存</button>
        </span>
      </div>
      <div class="hint s-keymsg"></div>

      <div class="sec-title">自动停止（达标自动结束并弹总结）</div>
      <div class="row"><label>停止条件</label>
        <select class="sel-stop sel-inp inp">
          <option value="none">不限时</option>
          <option value="minutes">按观看时长</option>
          <option value="lessons">按完成节数</option>
        </select>
      </div>
      <div class="row"><label>观看满（分钟）</label><input type="number" class="in-stopmin inp" min="1" max="1440" style="width:70px"></div>
      <div class="row"><label>完成满（节）</label><input type="number" class="in-stoples inp" min="1" max="200" style="width:70px"></div>

      <div class="row"><label>显示悬浮面板</label><button class="sw" data-cfg="panelVisible"></button></div>
      <div class="hint">关掉后只留右下角小圆钮，点它可重新展开。</div>
      <div class="row"><label>全屏挂不上就退全屏</label><button class="sw" data-cfg="exitFullscreenOnPanel"></button></div>
      <div class="hint">默认关闭。全屏看课助手会主动把悬浮窗挂进播放器，一般无需理会；<br>
        只有个别播放器挂不进去时，开启此开关才会自动退出全屏让面板重现。</div>
      <div class="row"><label>调试日志</label><button class="sw" data-cfg="debug"></button></div>
    </div>
  </div>
  <div class="foot">
    <button class="btn-start pri">启动</button>
    <button class="btn-stop">停止</button>
    <button class="btn-next">下一节</button>
    <button class="btn-answer">答题</button>
  </div>
  <div class="about">
    <div class="about-head"><span class="retri">ReTri</span><span class="about-sub">智慧树助手 · 永久免费</span></div>
    <a class="about-link" href="https://github.com/huanweide/zhihuishu-helper" target="_blank" rel="noopener">⭐ 给作者点个 Star 支持一下</a>
    <button class="about-sponsor">🧋 项目永久免费，给作者点杯奶茶吧</button>
    <div class="qr-box" style="display:none"><img src="data:image/png;base64,${ZHS_QR_B64}" alt="微信收款码"><div>微信扫一扫 · 感谢支持 ♥</div></div>
    <div class="sf-box">
      <div class="sec-title">🔑 还没有 API Key？免费领硅基流动</div>
      <div class="hint">硅基流动是 DeepSeek / 大模型中转站，稳定且价格友好。用下方邀请链接注册，双方都有额度赠送。</div>
      <a class="about-link" href="https://cloud.siliconflow.cn/i/axOmWfWi" target="_blank" rel="noopener">🚀 点击注册（自动带入邀请码）</a>
      <button type="button" class="invite-code" data-code="axOmWfWi" title="点击复制邀请码">邀请码 <b>axOmWfWi</b> <span class="copy-tip">点击复制</span></button>
    </div>
  </div>
</div>`;
    },

    _bind(box) {
      const $ = (s) => box.querySelector(s);

      // 折叠/展开
      $('.fold').onclick = () => {
        $('.panel').classList.remove('show');
        $('.mini').style.display = 'flex';
      };
      $('.mini').onclick = () => {
        $('.panel').classList.add('show');
      };

      // 切换 tab
      box.querySelectorAll('.tabs button').forEach((btn) => {
        btn.onclick = () => {
          box.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('on'));
          box.querySelectorAll('.pane').forEach((p) => p.classList.remove('on'));
          btn.classList.add('on');
          const pane = box.querySelector('.pane[data-pane="' + btn.dataset.tab + '"]');
          if (pane) pane.classList.add('on');
          this.refresh();
        };
      });

      // 开关
      box.querySelectorAll('.sw[data-cfg]').forEach((sw) => {
        sw.onclick = () => {
          const key = sw.dataset.cfg;
          const cur = ZHS.config[key];
          ZHS.setConfig({ [key]: !cur });
          ZHS.Log.info('设置 ' + key + ' = ' + !cur);
          this.refresh();
        };
      });

      // 数值
      const speed = box.querySelector('[data-cfg-num="speed"]');
      if (speed) {
        speed.oninput = () => {
          ZHS.setConfig({ speed: Number(speed.value) });
          this.refresh();
          const v = ZHS.Player.video();
          if (v) ZHS.Player.setSpeed(v, Number(speed.value));
        };
      }

      // 答题模式下拉
      const selMode = box.querySelector('.sel-mode');
      if (selMode) {
        selMode.onchange = () => {
          ZHS.setConfig({ answerMode: selMode.value });
          ZHS.Log.info('答题模式 = ' + selMode.value);
        };
      }

      // 题库地址
      const inBank = box.querySelector('.in-bank');
      if (inBank) {
        inBank.onchange = () => {
          ZHS.setConfig({ bankUrl: inBank.value.trim() });
          ZHS.Log.info('题库地址 = ' + inBank.value.trim());
        };
      }

      // LLM Key
      const inKey = box.querySelector('.in-key');
      if (inKey) {
        inKey.onchange = () => {
          const k = normKey(inKey.value);
          inKey.value = k;
          ZHS.setConfig({ llmKey: k });
          ZHS.Log.info('LLM Key 已' + (k ? '设置' : '清空'));
        };
      }

      // API 地址（BaseURL）
      const inBase = box.querySelector('.in-base');
      if (inBase) {
        inBase.onchange = () => {
          const v = inBase.value.trim() || 'https://api.deepseek.com';
          ZHS.setConfig({ llmBaseUrl: v });
          ZHS.Log.info('API 地址 = ' + v);
        };
      }

      // 模型名
      const inModel = box.querySelector('.in-model');
      if (inModel) {
        inModel.onchange = () => {
          const v = inModel.value.trim() || 'deepseek-chat';
          ZHS.setConfig({ llmModel: v });
          ZHS.Log.info('模型 = ' + v);
        };
      }

      // 测试连接
      const btnTest = box.querySelector('.btn-lmtest');
      if (btnTest) {
        btnTest.onclick = async () => {
          // 先把当前输入落盘，再测
          if (inBase) ZHS.setConfig({ llmBaseUrl: inBase.value.trim() || 'https://api.deepseek.com' });
          if (inModel) ZHS.setConfig({ llmModel: inModel.value.trim() || 'deepseek-chat' });
          if (inKey) ZHS.setConfig({ llmKey: normKey(inKey.value) });

          btnTest.textContent = '测试中…';
          btnTest.className = 'mini-btn btn-lmtest';
          // round-8 B1：test() 抛错必须被捕获，否则未捕获 Promise 拒绝 + 文案卡死在「测试中…」
          try {
            const r = await ZHS.LLM.test();
            btnTest.textContent = r.ok ? '连接正常' : '连接失败';
            btnTest.className = 'mini-btn btn-lmtest ' + (r.ok ? 'ok' : 'bad');
            const msg = box.querySelector('.s-keymsg');
            if (msg) msg.textContent = r.msg;
            ZHS.Log[r.ok ? 'info' : 'warn']('模型连通性：' + r.msg);
          } catch (e) {
            btnTest.textContent = '连接异常';
            btnTest.className = 'mini-btn btn-lmtest bad';
            ZHS.Log.warn('模型连通性测试出错：' + e.message);
          }
        };
      }

      // 保存 Key
      const btnSave = box.querySelector('.btn-savekey');
      if (btnSave) {
        btnSave.onclick = () => {
          if (inBase) ZHS.setConfig({ llmBaseUrl: inBase.value.trim() || 'https://api.deepseek.com' });
          if (inModel) ZHS.setConfig({ llmModel: inModel.value.trim() || 'deepseek-chat' });
          if (inKey) ZHS.setConfig({ llmKey: normKey(inKey.value) });
          this.alert('模型配置已保存', 'info');
          ZHS.Log.info('模型配置已保存：' + ZHS.config.llmModel + ' @ ' + ZHS.config.llmBaseUrl);
        };
      }

      // 总结弹层关闭
      const closeRp = box.querySelector('.close-rp');
      if (closeRp) {
        closeRp.onclick = () => {
          const rp = box.querySelector('.report');
          if (rp) rp.classList.remove('show');
        };
      }

      // 投票次数
      const inVote = box.querySelector('.in-vote');
      if (inVote) {
        inVote.onchange = () => {
          ZHS.setConfig({ voteTimes: Number(inVote.value) });
        };
      }

      // 作业/考试：章节范围数字框
      // 这两个是「整数数值」输入框，沿用项目既有机制（change 事件 + ZHS.setConfig），
      // 没有发明新绑定方式；用 querySelectorAll 是因为面板可能被重新渲染多份。
      box.querySelectorAll('input[data-cfg="examChapterFrom"], input[data-cfg="examChapterTo"]').forEach((inp) => {
        inp.onchange = () => {
          const key = inp.dataset.cfg;
          const n = Math.max(0, Math.floor(Number(inp.value) || 0));
          inp.value = String(n);
          ZHS.setConfig({ [key]: n });
          ZHS.Log.info('作答章节范围：' + (ZHS.config.examChapterFrom || 0) +
            ' ~ ' + (ZHS.config.examChapterTo || 0) + '（0 = 不限）');
        };
      });

      // 底部按钮（带 loading 态：点击即转圈禁用，完成恢复）
      const withLoading = async (btn, fn) => {
        if (btn.classList.contains('loading')) return;
        const orig = btn.textContent;
        btn.classList.add('loading');
        if (!btn.classList.contains('pri')) btn.classList.add('btn-plain');
        btn.disabled = true;
        try {
          await fn();
        } catch (e) {
          ZHS.Log.warn('按钮操作失败：' + e.message);
        } finally {
          btn.classList.remove('loading', 'btn-plain');
          btn.disabled = false;
          btn.textContent = orig;
        }
      };

      // manual: true —— 用户点了按钮，即使之前判定过停机也要能重新开跑
      $('.btn-start').onclick = () => {
        ZHS.Scheduler.start({ manual: true });
        this.alert('已启动：播放、跳课、答题全自动，无需再点任何按钮', 'info');
      };
      $('.btn-stop').onclick = () => {
        ZHS.Scheduler.stop();
        this.alert('已停止', 'info');
      };
      $('.btn-next').onclick = () => withLoading($('.btn-next'), async () => {
        await ZHS.Scheduler.gotoNext('手动', { manual: true });
      });
      $('.btn-answer').onclick = () => withLoading($('.btn-answer'), async () => {
        const scene = ZHS.Questions.scene();
        // 手动触发：绕过 autoAnswer 配置（用户点了就是想答）
        if (scene === 'dialog') await ZHS.Answerer.handleDialog({ manual: true });
        else await ZHS.Answerer.handleHomework({ manual: true });
        this.alert('已触发答题（场景：' + (scene || '未识别') + '）', 'info');
      });

      // 停止条件
      const selStop = box.querySelector('.sel-stop');
      if (selStop) {
        selStop.onchange = () => {
          ZHS.setConfig({ stopMode: selStop.value });
          ZHS.Log.info('停止条件 = ' + selStop.value);
        };
      }
      const inStopMin = box.querySelector('.in-stopmin');
      if (inStopMin) {
        inStopMin.onchange = () => {
          ZHS.setConfig({ stopMinutes: Math.max(1, Number(inStopMin.value) || 120) });
        };
      }
      const inStopLes = box.querySelector('.in-stoples');
      if (inStopLes) {
        inStopLes.onchange = () => {
          ZHS.setConfig({ stopLessons: Math.max(1, Number(inStopLes.value) || 10) });
        };
      }

      // 首次使用引导
      const guide = box.querySelector('#zhs-guide');
      if (guide) {
        const onboarded = this._readFlag('zhs-onboarded');
        guide.style.display = onboarded ? 'none' : 'block';
        const okBtn = guide.querySelector('.guide-ok');
        if (okBtn) {
          okBtn.onclick = () => {
            guide.style.display = 'none';
            this._writeFlag('zhs-onboarded', true);
          };
        }
      }

      // 赞助收款码展开
      const sponsorBtn = box.querySelector('.about-sponsor');
      if (sponsorBtn) {
        sponsorBtn.onclick = () => {
          const qb = box.querySelector('.qr-box');
          if (qb) qb.style.display = qb.style.display === 'none' ? 'block' : 'none';
        };
      }

      // 邀请码一键复制：点一下就把码复制到剪贴板，省得用户手动选中
      const inviteBtn = box.querySelector('.invite-code');
      if (inviteBtn) {
        inviteBtn.onclick = async () => {
          const code = inviteBtn.getAttribute('data-code') || '';
          const tip = inviteBtn.querySelector('.copy-tip');
          let ok = false;
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(code);
              ok = true;
            }
          } catch (e) { ok = false; }
          if (!ok) {
            // 降级：临时 textarea + execCommand（http 页面 / 旧内核）
            try {
              const ta = document.createElement('textarea');
              ta.value = code;
              ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
              document.body.appendChild(ta);
              ta.select();
              ok = document.execCommand('copy');
              document.body.removeChild(ta);
            } catch (e) { ok = false; }
          }
          if (tip) tip.textContent = ok ? '已复制 ✓' : '复制失败，请手动选择';
          inviteBtn.classList.toggle('copied', ok);
          if (ok) {
            setTimeout(() => {
              if (tip) tip.textContent = '点击复制';
              inviteBtn.classList.remove('copied');
            }, 2000);
          }
        };
      }
    },

    /** 读持久化标记（GM 优先，降级 localStorage） */
    _readFlag(key) {
      try {
        const raw = typeof GM_getValue === 'function'
          ? GM_getValue(key, null)
          : localStorage.getItem(key);
        return raw === true || raw === 'true' || raw === '1';
      } catch (e) { return false; }
    },

    /** 写持久化标记 */
    _writeFlag(key, val) {
      try {
        if (typeof GM_setValue === 'function') GM_setValue(key, String(val));
        else localStorage.setItem(key, String(val));
      } catch (e) { /* 静默 */ }
    },

    /**
     * 读设计令牌的运行时色值（JS 里需要给元素直接设色时用）。
     *
     * 为什么不直接写 '#1D9E75'：CSS 用的是 var(--zhs-ok-400)，一旦有人改令牌
     * 而忘了改 JS 里的字面量，就会出现「同一个绿色两种色调」的隐性不一致。
     * 这里统一从 :host 上把变量读回来，CSS 与 JS 永远同源；
     * 读不到（老内核 / 无样式环境）才回落到 COLOR_FALLBACK 里的同名兜底值。
     */
    _color(name) {
      const fallback = COLOR_FALLBACK[name] || '';
      try {
        const el = this._root || (typeof document !== 'undefined' ? document.documentElement : null);
        if (!el) return fallback;
        const v = getComputedStyle(el).getPropertyValue('--zhs-' + name);
        return v && v.trim() ? v.trim() : fallback;
      } catch (e) { return fallback; }
    },

    /**
     * 刷新面板显示。
     *
     * 整体包一层 try：refresh 是「渲染」职责，跑在 1.5 秒的定时器里，
     * 任何一次意外（比如某平台页面的 video 元素被换掉导致取值抛错）
     * 从这里抛出去都会污染定时器调用栈。渲染失败最坏也只是数字不刷新，
     * 绝不能影响主流程，所以这里兜住并只在 debug 日志里留痕。
     */
    refresh() {
      // 自愈：面板宿主被页面脚本移除后，重新挂载，避免静默消失（round-7 面板⑨）
      if (this._root && !document.contains(this._root)) {
        try {
          if (this._root.parentNode) this._root.parentNode.removeChild(this._root);
          this._root = null;
          this._shadow = null;
          // round-8 B3：重挂前清掉全屏状态机残留，避免旧状态误导降级提示/失效 document 绑定
          try {
            this._fsState = '';
            if (this._fsTimer) { clearTimeout(this._fsTimer); this._fsTimer = null; }
            this._fsFailedNotice = false;
            if (this._fsBoundDocs) this._fsBoundDocs = [];
          } catch (e) {}
          this.mount();
        } catch (e) { ZHS.Log.debug('面板自愈重挂失败：' + e.message); }
      }
      try { this._refreshInner(); } catch (e) {
        ZHS.Log.debug('面板刷新异常（已忽略）：' + e.message);
      }
    },

    _refreshInner() {
      if (!this._shadow) return;
      const box = this._shadow.querySelector('.wrap');
      if (!box) return;
      const cfg = ZHS.config;
      const $ = (s) => box.querySelector(s);
      // 状态页元素取不到时直接跳过（面板结构被外部脚本改动等极端情况）
      const setText = (sel, text) => {
        const el = $(sel);
        if (el) el.textContent = text;
      };

      // 状态
      const v = ZHS.Player.video();
      setText('.s-run', ZHS.state.running ? '运行中' : '已停止');
      const st = ZHS.Catalog.stats();
      setText('.s-cprog', st.done + '/' + st.total + ' (' + st.percent + '%)');
      // 课程进度条
      const bar = box.querySelector('.cprog-bar > i');
      if (bar) bar.style.width = st.percent + '%';
      setText('.s-lesson', (ZHS.state.lessonKey || '—').slice(0, 16));
      setText('.s-vprog', v ? (ZHS.Player.percent(v) + '% · ' + Math.round(v.currentTime) + 's') : '—');

      // 三态明细（N1 需求）
      const bd = ZHS.Catalog.breakdown();
      const undoneEl = $('.s-undone');
      if (undoneEl) {
        undoneEl.textContent = bd.undone + ' 节';
        // 色值走设计令牌，别在这里写死字面量（CSS 一改就会不一致）
        undoneEl.style.color = bd.undone === 0 ? this._color('ok-400') : this._color('warn-ink');
      }
      const lockedEl = $('.s-locked');
      if (lockedEl) lockedEl.textContent = bd.locked + ' 节';
      // 本次完成节数（停止条件口径）
      const doneRunEl = $('.s-done-run');
      if (doneRunEl) {
        const n = (ZHS.Scheduler && ZHS.Scheduler._completedThisRun) || 0;
        doneRunEl.textContent = n + ' 节';
      }

      setText('.s-ans', String(ZHS.state.answeredCount));
      const mins = Math.floor((Date.now() - ZHS.state.startedAt) / 60000);
      setText('.s-uptime', mins + ' 分钟');

      // 开关状态
      box.querySelectorAll('.sw[data-cfg]').forEach((sw) => {
        const on = !!cfg[sw.dataset.cfg];
        sw.classList.toggle('on', on);
      });
      const speed = box.querySelector('[data-cfg-num="speed"]');
      if (speed && document.activeElement !== speed) speed.value = String(cfg.speed);
      setText('.v-speed', cfg.speed + 'x');

      // 答题设置回填（避免覆盖用户正在输入的框）
      this._syncInput(box, '.sel-mode', cfg.answerMode);
      this._syncInput(box, '.in-bank', cfg.bankUrl);
      this._syncInput(box, '.in-key', cfg.llmKey);
      this._syncInput(box, '.in-vote', String(cfg.voteTimes));
      this._syncInput(box, '.in-base', cfg.llmBaseUrl);
      this._syncInput(box, '.in-model', cfg.llmModel);
      // 停止条件回填
      this._syncInput(box, '.sel-stop', cfg.stopMode || 'none');
      this._syncInput(box, '.in-stopmin', String(cfg.stopMinutes));
      this._syncInput(box, '.in-stoples', String(cfg.stopLessons));
      // 作业/考试章节范围回填
      this._syncInput(box, '.in-exfrom', String(cfg.examChapterFrom || 0));
      this._syncInput(box, '.in-exto', String(cfg.examChapterTo || 0));
    },

    /**
     * 展示「全部看完」总结报告（N3 需求）
     */
    showReport(report) {
      if (!report) return;
      // 兜底：面板未挂载时先挂载，避免总结报告静默丢失
      if (!this._shadow || !this._root || !document.contains(this._root)) {
        try { this.mount(); } catch (e) { /* 挂载失败则放弃显示 */ }
      }
      if (!this._shadow) return;
      const box = this._shadow.querySelector('.wrap');
      if (!box) return;
      const rp = box.querySelector('.report');
      if (!rp) return;

      const rows = [
        ['课程', report.课程名],
        ['页面版本', report.页面版本],
        ['完成情况', report.已完成 + ' / ' + report.总节点 + '（' + report.完成度 + '）'],
        ['未看完', report.未完成 + ' 节'],
        ['未解锁', report.未解锁 + ' 节'],
        ['本次切换课时', report.本次切换课时数 + ' 次'],
        ['本次完成节数', (report.本次完成节数 || 0) + ' 节'],
        ['已答题数', report.已答题数 + ' 题'],
        ['答题通道', report.答题通道],
        ['总耗时', report.总耗时],
        ['结束时间', report.结束时间],
      ];

      // 标题按真实结果动态判定：不能只有 25% 完成度还写「全部看完」。
      // 也不能漏掉「题目没答」这件事——看完≠答完，得让用户知道还有几题空着（BUG-EC-19）。
      const allDone = Number(report.未完成) === 0 && Number(report.总节点) > 0
        && Number(report.已完成) >= Number(report.总节点);
      const undoneN = Number(report.未完成) || 0;
      const skipN = Number(report.漏答题数) || 0;

      let head, headKey;
      if (allDone && skipN === 0) {
        head = '全部课程已看完';
        headKey = 'pri-ink2';      // 正常达成：品牌深蓝
      } else if (allDone) {
        head = '课程已看完（有 ' + skipN + ' 题未作答）';
        headKey = 'warn-ink';      // 有漏答：提醒色
      } else {
        head = '运行已结束（仍有 ' + undoneN + ' 节未完成'
          + (skipN ? ' · ' + skipN + ' 题漏答' : '') + '）';
        headKey = 'warn-ink';
      }
      const headColor = this._color(headKey);

      rp.innerHTML = '<h4 data-tone="' + headKey + '" style="color:' + headColor + '">' + this._esc(head) + '</h4>'
        + rows.map(([k, v]) => '<div class="line"><span>' + k + '</span><b>' + this._esc(String(v)) + '</b></div>').join('')
        + '<button class="close-rp">知道了</button>';
      rp.classList.add('show');

      const btn = rp.querySelector('.close-rp');
      if (btn) btn.onclick = () => rp.classList.remove('show');

      // 切到状态页让用户看到
      box.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'home'));
      box.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === 'home'));
    },

    /** 只在值不同且未聚焦时同步输入框 */
    _syncInput(box, sel, val) {
      const el = box.querySelector(sel);
      if (!el) return;
      if (el === (this._shadow && this._shadow.activeElement)) return;
      if (String(el.value) !== String(val)) el.value = val;
    },

    /** 日志更新回调 */
    onLog() {
      const box = this._shadow && this._shadow.querySelector('.wrap');
      if (!box) return;
      const pane = box.querySelector('.pane[data-pane="log"]');
      if (!pane || !pane.classList.contains('on')) return;   // 只在日志页刷新
      this._renderLogs(box);
    },

    _renderLogs(box) {
      const el = box.querySelector('.logs');
      if (!el) return;
      const list = ZHS.Log.all().slice(-80);
      el.innerHTML = list.map((e) => {
        const time = new Date(e.t).toTimeString().slice(0, 8);
        const cls = e.level === 'warn' ? 'warn' : (e.level === 'error' ? 'error' : '');
        return '<div class="' + cls + '">' + time + ' ' + this._esc(e.text) + '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
    },

    _esc(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    },

    /**
     * 顶部提示条
     * @param msg 提示文案
     * @param type info | warn | error
     * @param durationMs 显示时长（毫秒），默认 8 秒。
     *   以前签名只有 (msg, type)，调用方传的第 3 个参数会被静默丢弃——
     *   现在显式支持，调用方能控制重要提示停留多久。
     */
    alert(msg, type, durationMs) {
      const box = this._shadow && this._shadow.querySelector('.wrap');
      if (!box) return;
      const el = box.querySelector('.alert');
      if (!el) return;                       // 面板结构异常时不留 TypeError
      el.className = 'alert ' + (type || 'info');
      el.textContent = msg;
      clearTimeout(this._alertTimer);
      const ms = Number(durationMs) > 0 ? Number(durationMs) : 8000;
      this._alertTimer = setTimeout(() => { el.className = 'alert'; }, ms);
    },
  };

  // 面板每 1.5 秒自刷新
  setInterval(() => Panel.refresh(), 1500);

  // round-14：把完整 Panel 填充进模块开头已占位的 ZHS.panel。
  // 用 Object.assign 而非直接赋值：保留占位对象引用，任何早前拿到 ZHS.panel 引用的
  // 代码（以及判空逻辑）都能看到补齐后的方法，不会出现「引用是空对象、赋值后失联」。
  Object.assign(ZHS.panel, Panel);
  ZHS.__panel_ready = true;   // 供 07-main 判定「面板是否真正就绪」，用于兜底提示
})();

/* ===== 06b-course-hub.js ===== */
/**
 * 课程中心调度：自动选课 + 自动跳课
 *
 * 解决的问题：
 *   1. 自动选课 —— 在课程中心页自动找到「未看完」的课程并点进去
 *   2. 自动跳课 —— 当前课程全部学完后，自动回课程中心找下一门继续
 *
 * 跨页机制：
 *   油猴 match 覆盖 *://*.polymas.com/*，新标签页会自动注入本脚本；
 *   GM 存储跨标签页/跨子域共享，所以用 intent（跳转意图）串起两页。
 *
 * 存储用 GM_setValue（跨页共享），无 GM 环境降级到 localStorage，
 * 与 04-resume.js 的读写范式保持一致。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod06b_course_hub) return;
  ZHS.__mod06b_course_hub = true;
  const U = ZHS.Util;

  const STORE_KEY = 'zhs-helper-hub';
  const hasGM = typeof GM_setValue === 'function' && typeof GM_getValue === 'function';

  // 课程中心页地址（自动跳课从这里出发，也回到这里）
  const HUB_URL = 'https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center';
  // 课程学习页路径前缀（进入课程后 URL 形如 {BASE}/AIstudent/{courseId}/{classId}?key=entry）
  const STUDENT_PATH = '/AIstudent/';

  const INTENT_TTL = 10 * 60 * 1000;   // 跳转意图有效期：10 分钟
  const LIST_MAX = 50;                 // doneCourses / failedCourses 各自上限（FIFO 淘汰）

  // 防重入标志：MutationObserver 可能反复触发扫描，同轮内不重复收集
  let _scanning = false;
  let _scanPromise = null;      // in-flight 扫描 Promise，供并发调用共享结果

  // ============ 会话库读写（照 04-resume.js 范式）============

  function emptyStore() {
    return {
      rev: 1,
      intent: null,
      doneCourses: [],
      failedCourses: [],
      stats: { hopped: 0, failed: 0 },
    };
  }

  function readStore() {
    try {
      const raw = hasGM ? GM_getValue(STORE_KEY, null) : localStorage.getItem(STORE_KEY);
      if (!raw) return emptyStore();
      let obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // 老格式兼容：历史版本曾把「已完成课程」直接存成纯字符串数组。
      // 若原样返回数组，后续 store.doneCourses 取到 undefined（靠 || [] 兜住），
      // 功能虽不崩，但 read() 的类型契约被破坏（返回数组而非对象）。这里统一转成对象。
      if (Array.isArray(obj)) {
        obj = { rev: 1, intent: null, doneCourses: obj.slice(), failedCourses: [], stats: { hopped: 0, failed: 0 } };
      }
      if (!obj || typeof obj !== 'object') return emptyStore();
      // 逐字段兜底，防止老版本/损坏数据让后续逻辑崩掉
      if (!Array.isArray(obj.doneCourses)) obj.doneCourses = [];
      if (!Array.isArray(obj.failedCourses)) obj.failedCourses = [];
      if (!obj.stats || typeof obj.stats !== 'object') obj.stats = { hopped: 0, failed: 0 };
      if (typeof obj.stats.hopped !== 'number') obj.stats.hopped = 0;
      if (typeof obj.stats.failed !== 'number') obj.stats.failed = 0;
      obj.rev = 1;
      return obj;
    } catch (e) {
      ZHS.Log.warn('课程中心会话库损坏，已重置');
      return emptyStore();
    }
  }

  function writeStore(store) {
    try {
      const raw = JSON.stringify(store);
      if (hasGM) GM_setValue(STORE_KEY, raw);
      else localStorage.setItem(STORE_KEY, raw);
      return true;
    } catch (e) {
      ZHS.Log.warn('课程中心会话库写入失败：' + e.message);
      return false;
    }
  }

  /** FIFO 入列：超出上限时丢最早的，避免列表无限膨胀 */
  function pushList(arr, val) {
    if (!val) return;
    const i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1);   // 已存在则移到队尾（刷新位置）
    arr.push(val);
    while (arr.length > LIST_MAX) arr.shift();
  }

  // ============ 页面判定 ============

  /** 是否在课程中心页 */
  function isHubPage() {
    try {
      // round-8 M4：pathname / search / hash 任一含课程中心标识即判定命中，抗 query/hash 路由与大小写变化
      const p = (location.pathname || '').toLowerCase();
      const s = ((location.search || '') + (location.hash || '')).toLowerCase();
      return p.includes('ai-course-center') || s.includes('ai-course-center');
    } catch (e) {
      return false;
    }
  }

  /** 是否在课程学习页 */
  function isStudentPage() {
    try {
      return location.pathname.includes(STUDENT_PATH);
    } catch (e) {
      return false;
    }
  }

  // ============ 意图读写 ============

  /**
   * 写跳转意图（点击卡片前必须先写，新标签页靠它认领）
   *
   * via 记录本次意图的来源，是「能不能自动点课」的授权凭证：
   *   'auto-hop' —— 来自「上一门课学完后自动跳转」，说明用户已授权自动跳课链 → 可自动选课
   *   'manual'   —— 用户手动触发
   * 只有 via === 'auto-hop' 时，课程中心页才会自动选课（见 onPageReady）。
   * 普通「用户自己打开课程中心」不写 intent，因此不会被自动点课。
   */
  function setIntent(courseId, courseName, via) {
    const store = readStore();
    store.intent = {
      courseId: courseId || courseName || null,
      courseName: courseName || null,
      via: via || 'manual',
      at: Date.now(),
    };
    writeStore(store);
    return store.intent;
  }

  /** 读未过期的跳转意图；过期的顺手清掉 */
  function getIntent() {
    const store = readStore();
    const it = store.intent;
    if (!it) return null;
    // at 必须是有限数字，否则视为过期。
    // 起因：at 被写成字符串 "abc" 时，Date.now() - "abc" = NaN，
    // 而 `NaN > TTL` 恒为 false → 旧判断永远「不过期」，脏意图会长期残留、
    // 一旦用户后来打开自动选课就会用陈旧意图劫持点击。
    const at = Number(it.at);
    if (!Number.isFinite(at) || (Date.now() - at) > INTENT_TTL) {
      // 用 info：debug 已不进面板缓冲，而「意图过期」是排查
      // 「为什么没自动选课」的关键线索，必须留在面板可查。
      ZHS.Log.info('课程中心跳转意图已过期，忽略');
      store.intent = null;
      writeStore(store);
      return null;
    }
    return it;
  }

  /** 清除跳转意图 */
  function clearIntent() {
    const store = readStore();
    if (!store.intent) return false;
    store.intent = null;
    writeStore(store);
    return true;
  }

  // ============ 课程卡片收集（处理虚拟滚动）============

  /**
   * 收集课程卡片。
   *
   * 难点：课程中心是虚拟滚动，卡片只有滚到可视区才补渲，
   * 所以必须「边滚边收」。滚动容器就是页面主体，
   * 做法是：先记原位 → 反复滚到底收集 → 直到 scrollHeight 不再增长或超上限 → 恢复原位。
   *
   * 【防卡死】除了「最多 30 轮」，还必须有**总时长上限**。
   * 某些环境（无头/无布局引擎）scrollHeight 恒为 0，导致「到底了没」永远判不出来，
   * 只能靠次数上限兜底 —— 30 轮 × 300ms ≈ 9 秒，用户会以为脚本卡住。
   * 现在超时（默认 4 秒）即停，并且一旦确认高度不再变化就提前收工。
   */
  async function collectCards() {
    const found = [];
    const startedAt = Date.now();
    const MAX_MS = 4000;        // 总时长硬上限，防 scrollHeight 恒 0 时空转
    const ROUND_MS = 300;       // 每轮等平台补渲

    // 找滚动容器：优先文档主体，找不到就退化为 window
    const scroller = findScroller();

    const originTop = scroller ? scroller.scrollTop : 0;
    let lastHeight = -1;
    let stable = 0;

    try {
      for (let i = 0; i < 30; i++) {   // 次数上限 30，防死循环
        if (Date.now() - startedAt > MAX_MS) {
          ZHS.Log.debug('[课程中心] 滚动收集达到时长上限，提前结束（已收 ' + found.length + ' 张）');
          break;
        }

        const curHeight = scroller ? scroller.scrollHeight : document.documentElement.scrollHeight;
        if (scroller) scroller.scrollTop = curHeight;   // 滚到底触发补渲
        else window.scrollTo(0, curHeight);

        await U.sleep(ROUND_MS);   // 等平台补渲

        collectInto(found);

        const newHeight = scroller ? scroller.scrollHeight : document.documentElement.scrollHeight;
        // 高度读不出来（恒 0 / NaN）→ 无法判断是否到底，直接收工，避免空转
        if (!newHeight) {
          ZHS.Log.debug('[课程中心] 滚动高度不可读，跳过虚拟滚动收集（当前页面可能无需滚动）');
          break;
        }
        if (newHeight === curHeight && newHeight === lastHeight) {
          stable++;
          if (stable >= 2) break;   // 连续两轮高度不变 → 到底了
        } else {
          stable = 0;
        }
        lastHeight = newHeight;
      }
    } catch (e) {
      ZHS.Log.warn('滚动收集课程卡片出错：' + e.message);
    } finally {
      // 恢复原位，不打扰用户
      try {
        if (scroller) scroller.scrollTop = originTop;
        else window.scrollTo(0, originTop);
      } catch (e) { /* 忽略 */ }
    }

    // 回到顶部后再补收一次，防止一开始顶部有漏网
    collectInto(found);
    return found;
  }

  /** 依次尝试多个选择器，返回第一个命中的单元素（带兜底，抗平台改类名） */
  function qsFirst(sels) {
    for (const s of sels) {
      try { const el = document.querySelector(s); if (el) return el; } catch (e) {}
    }
    return null;
  }
  /** 依次尝试多个选择器，合并返回所有命中（去重，抗平台改类名） */
  function qsaAll(sels) {
    const out = [];
    for (const s of sels) {
      try {
        const els = document.querySelectorAll(s);
        for (const el of els) if (out.indexOf(el) < 0) out.push(el);
      } catch (e) {}
    }
    return out;
  }

  /** 找虚拟滚动的容器 */
  function findScroller() {
    try {
      const body = qsFirst(['.ai-course-center-body', '[class*="course-center"]']);
      if (body) {
        // 自身可滚就用自己，否则向上找可滚祖先
        if (body.scrollHeight > body.clientHeight) return body;
        let p = body.parentElement;
        while (p && p !== document.body) {
          if (p.scrollHeight > p.clientHeight) return p;
          p = p.parentElement;
        }
      }
      const de = document.documentElement;
      if (de && de.scrollHeight > de.clientHeight) return de;
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /** 把当前 DOM 里的卡片解析后并入结果（按元素去重） */
  function collectInto(found) {
    let cards = [];
    try {
      cards = qsaAll(['.ai-course-center-body div.course-card', '[class*="course-card"]', '[class*="courseCard"]']);
    } catch (e) {
      ZHS.Log.warn('课程卡片选择器匹配失败：' + e.message);
      return;
    }
    for (const el of cards) {
      if (found.some((c) => c.el === el)) continue;   // 去重
      const parsed = parseCard(el);
      if (parsed) found.push(parsed);
    }
  }

  /** 解析单张卡片 → { el, name, percent, finished } */
  function parseCard(el) {
    if (!el) return null;
    let name = '';
    try {
      const h4 = el.querySelector('h4');
      name = U.normText(h4 ? (h4.innerText || h4.textContent) : '');
      if (!name) name = U.normText(el.textContent).slice(0, 60);   // 降级
    } catch (e) {
      name = '';
    }

    let percent = null;
    let text = '';
    try {
      text = U.normText(el.textContent);
      // 百分比解析：优先在「自身文本含 %」的最小元素上解析，
      // 避免整卡 textContent 拼接把相邻数字吞进来（如 "课4" + "12.5%" = "课412.5%"，
      // 直接在合并文本上匹配会得到 412.5）。逐个候选元素单独解析，取第一个命中。
      // 修复四个毛病：
      //   1. 支持小数与科学计数法（"12.5%"→12，"1e2%"→100），不再只吃 \d+
      //   2. 保留正负号（"-5%"→-5）
      //   3. 正则锚定 `%` 前的数字 token，不跨界吞数字
      //   4. 上限夹逼到 100（"1000%"→100，避免 finished 误判）
      const RE = /([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*%/i;
      const cands = [];
      try {
        const nodes = el.querySelectorAll('*');
        for (const n of nodes) {
          const t = U.normText(n.textContent);
          if (t.indexOf('%') >= 0) cands.push(t);
        }
      } catch (e) { /* 忽略 */ }
      cands.push(text);   // 兜底：整卡文本
      for (const t of cands) {
        const m = t.match(RE);
        if (m) {
          const n = Number(m[1]);
          if (Number.isFinite(n)) { percent = Math.min(100, Math.floor(n)); break; }
        }
      }
    } catch (e) { /* 忽略 */ }

    // 完成阈值与目录 isFinished（FINISH_PCT=98）对齐：
    // 否则 98~99% 卡住的课程在中心页仍判「未完成」→ 被反复重新进入，形成「中心页↔该课」死循环（round-7 H3）
    const finished = (percent !== null && percent >= 98)
      || text.includes('已完成') || text.includes('已学完');

    return { el, name, percent, finished };
  }

  /** 从卡片元素上尽量挖出课程标识（data 属性 / vue 实例） */
  function cardIdentity(el) {
    if (!el) return null;
    try {
      for (const attr of ['data-course-id', 'data-courseid', 'data-id', 'data-key', 'id']) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v) return String(v);
      }
      // Vue 实例上常见的字段
      const vm = el.__vue__ || (el.parentElement && el.parentElement.__vue__);
      if (vm) {
        const c = vm.course || vm.courseInfo || vm.data || vm.item;
        const id = c && (c.courseId || c.courseid || c.id || c.recruitAndCourseId);
        if (id) return String(id);
        if (vm.courseId) return String(vm.courseId);
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  // ============ 选择下一门课 ============

  /**
   * 挑选下一门未看完的课。
   * 过滤：已 done、已 failed、finished === true。
   * @returns 卡片对象，或 null（没有可进的课）
   */
  async function pickNext() {
    if (!ZHS.config.autoCoursePick) {
      ZHS.Log.debug('自动选课开关关闭，跳过');
      return null;
    }

    // 防重入：MutationObserver 可能反复触发，同一轮不重复扫描。
    // 关键：第二次调用不能立即返回 null —— 那会被上层误判成「没有未看完的课程」
    // 并弹出误导提示。正确做法是 await 第一轮的 in-flight Promise，共享同一结果。
    if (_scanning) {
      ZHS.Log.debug('已有扫描进行中，等待其完成后共享结果');
      try { return await _scanPromise; } catch (e) { return null; }
    }
    _scanning = true;
    let _resolveScan;
    _scanPromise = new Promise((r) => { _resolveScan = r; });

    const store = readStore();
    try {
      ZHS.Log.debug('[课程中心] 开始收集课程卡片…');
      const cards = await collectCards();
      ZHS.Log.debug('[课程中心] 共收集到 ' + cards.length + ' 门课程');

      const done = store.doneCourses || [];
      const failed = store.failedCourses || [];

      for (const c of cards) {
        if (c.finished) continue;
        const id = cardIdentity(c.el);
        const key = id || c.name;
        if (!key) continue;
        if (done.includes(key)) continue;
        if (failed.includes(key)) continue;
        ZHS.Log.info('[课程中心] 选中未看完课程：' + (c.name || key)
          + (c.percent !== null ? '（' + c.percent + '%）' : ''));
        if (_resolveScan) _resolveScan(c);
        return c;
      }

      ZHS.Log.info('[课程中心] 没有找到未看完的课程');
      if (_resolveScan) _resolveScan(null);
      return null;
    } catch (e) {
      ZHS.Log.warn('[课程中心] 挑选课程出错：' + e.message);
      if (_resolveScan) _resolveScan(null);
      return null;
    } finally {
      _scanning = false;   // 释放防重入标志
      _scanPromise = null;
    }
  }

  // ============ 进入课程 ============

  /**
   * 进入指定课程卡片。
   *
   * 卡片内没有 a[href]，整卡可点，点击后平台自己调 window.open() 新开标签。
   * 因此必须【先写 intent 再点】，否则新标签页不认领。
   * 若 window.open 被浏览器拦截，800ms 内没跳转则尝试直接 location.href 兜底。
   */
  async function enterCourse(card) {
    if (!card || !card.el) {
      ZHS.Log.warn('[课程中心] 进入课程失败：卡片为空');
      return false;
    }
    const id = cardIdentity(card.el) || card.name;
    if (!id) {
      ZHS.Log.warn('[课程中心] 卡片没有可用标识，无法记录意图');
      return false;
    }

    // 1. 先写 intent（新标签页靠它认领这次跳转）
    setIntent(id, card.name, card.via || 'manual');
    ZHS.Log.info('[课程中心] 准备进入课程：' + (card.name || id));

    // 2. 点击卡片
    //
    // 【稳健性】不能把「可见性检测失败」当成「不能点」。
    // U.isVisible() 依赖 offsetParent 等布局信息，在无布局环境（含部分虚拟滚动容器、
    // 无头/嵌入式浏览器）会误报 false。此时若直接放弃点击，功能就废了。
    // 策略：可见就当可点直接点；不可见先尝试滚入视口，仍失败则【照样点一次】，
    // 点不通再由 catch 判定为真失败。
    let clicked = false;
    try {
      const visible = (() => {
        try { return U.isVisible(card.el); } catch (e) { return true; }
      })();

      if (!visible) {
        try {
          card.el.scrollIntoView({ block: 'center' });
          await U.sleep(200);
        } catch (e) {
          ZHS.Log.debug('[课程中心] scrollIntoView 不可用，直接尝试点击');
        }
      }

      card.el.click();
      clicked = true;
    } catch (e) {
      // 第一次点击失败 → 再试一次内部更具体的可点元素
      ZHS.Log.warn('[课程中心] 直接点击卡片出错（' + e.message + '），尝试内部元素');
      try {
        const inner = card.el.querySelector('h4, [class*="btn"], a, button') || card.el;
        inner.click();
        clicked = true;
      } catch (e2) {
        ZHS.Log.warn('[课程中心] 点击卡片仍失败：' + e2.message);
      }
    }
    // 3. 判定结果
    //
    // 【重要纠错】不能用 `isHubPage()` 判断「跳转成功与否」：
    // 卡片点击走 window.open 开【新标签】，当前页永远还停在课程中心，
    // 所以 isHubPage() 恒为 true —— 早先版本因此恒返回 false，
    // 上层收到 false 就 markCourseFailed，把一门本来能学的课永久拉黑。
    //
    // 正确语义：click 未抛异常 + intent 已写入 = 已成功发出进入请求 → 返回 true。
    // 「到底进没进去」的唯一可信信号是学习页那边的 settleIntentOnStudentPage() 回写，
    // 不在这里猜。宁可返回 true（不动），也不误判成 false（误拉黑）。
    if (!clicked) {
      ZHS.Log.warn('[课程中心] 卡片点击未生效（元素不可点），本次进入放弃。不拉黑该课程，稍后可重试');
      clearIntent();
      return false;
    }

    // 已发出进入请求。不再做兜底 location.href 跳转 ——
    // 那会与平台的 window.open 叠加，开出两个学习页标签（宁可少开，不可多开）。
    ZHS.Log.info('[课程中心] 已点击卡片，等待新标签页接管（由学习页回写确认）');
    bumpStat('hopped');
    // round-8 M2：记录待确认跳转，防「点击后新标签没起来」导致该课永远不学也不失败（由看门狗清理）
    try {
      const st = readStore();
      st.pendingHop = { courseId: id, at: Date.now(), settled: false };
      writeStore(st);
    } catch (e) {}
    return true;
  }

  /** 尽力从卡片推导学习页 URL（保留：供日志提示 / 手动排查用，不再用于自动跳转） */
  function deriveCourseUrl(el) {
    if (!el) return null;
    try {
      // a) 卡片内直接有链接
      const a = el.querySelector('a[href]');
      if (a && a.href) return a.href;
      // b) 任意子元素带 href / data-* 属性
      const cands = [el].concat(Array.from(el.querySelectorAll('*')));
      for (const node of cands) {
        for (const attr of ['data-href', 'data-url', 'href', 'data-course-url']) {
          const v = node.getAttribute && node.getAttribute(attr);
          if (v && /^https?:|^\//.test(v) && !/ai-course-center/.test(v)) return v;
        }
      }
      // c) Vue 实例上的路由跳转参数
      const vm = el.__vue__ || (el.parentElement && el.parentElement.__vue__);
      if (vm) {
        const c = vm.course || vm.courseInfo || vm.data || vm.item;
        const courseId = c && (c.courseId || c.courseid || c.recruitAndCourseId || c.id);
        const classId = c && (c.classId || c.classid);
        if (courseId && classId) {
          return location.origin + STUDENT_PATH + courseId + '/' + classId + '?key=entry';
        }
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  // ============ 统计 / 状态回写 ============

  function bumpStat(field) {
    const store = readStore();
    if (!store.stats) store.stats = { hopped: 0, failed: 0 };
    store.stats[field] = (Number(store.stats[field]) || 0) + 1;
    writeStore(store);
  }

  /** 把某课程记为「已全部学完」 */
  function markCourseDone(courseId) {
    // round-8 H1：与课程中心 pickNext 读键（cardIdentity）同源，避免「写用 id / 读用另一 id」导致去重失效
    const key = courseId
      || (ZHS.state && ZHS.state.hubKey)
      || (ZHS.state && ZHS.state.courseId);
    if (!key) {
      ZHS.Log.warn('[课程中心] markCourseDone 缺少课程标识，忽略');
      return false;
    }
    const store = readStore();
    pushList(store.doneCourses, String(key));
    writeStore(store);
    ZHS.Log.info('[课程中心] 已记录完成课程：' + key);
    return true;
  }

  /** 把某课程记为「进入失败」，防止下次再选它形成死循环 */
  function markCourseFailed(courseId) {
    // round-8 H1：与 markCourseDone 同源，优先用进入时记录的卡片标识
    const key = courseId
      || (ZHS.state && ZHS.state.hubKey)
      || (ZHS.state && ZHS.state.courseId);
    if (!key) return false;
    const store = readStore();
    pushList(store.failedCourses, String(key));
    writeStore(store);
    bumpStat('failed');
    return true;
  }

  /**
   * 跳转回课程中心。
   * 由 05-scheduler 在「本课程全学完」时调用。
   *
   * 关键：这里会写一个 via='auto-hop' 的 intent，作为「用户已授权自动跳课」的凭证。
   * 课程中心页只有看到这个凭证才会自动选课（见 onPageReady），
   * 从而区分「学完自动跳下一门」与「用户自己打开课程中心看一眼」两种情形。
   */
  function returnToHub() {
    if (!ZHS.config.autoCourseHop) {
      ZHS.Log.debug('自动跳课开关关闭，不返回课程中心');
      return false;
    }
    if (isHubPage()) {
      ZHS.Log.debug('已在课程中心页，无需跳转');
      return false;
    }
    // 写入授权凭证：说明这次回中心是「学完自动跳课」驱动的，可以自动选下一门
    setIntent(ZHS.state && ZHS.state.courseId, '', 'auto-hop');
    ZHS.Log.info('[课程中心] 正在返回课程中心寻找下一门课…');
    try {
      location.href = HUB_URL;
      return true;
    } catch (e) {
      ZHS.Log.warn('[课程中心] 返回课程中心失败：' + e.message);
      return false;
    }
  }

  /**
   * 学习页回写闭环：进入课程学习页时，若存在未过期 intent 说明跳转成功，
   * 清除 intent 并打日志。
   */
  function settleIntentOnStudentPage() {
    if (!isStudentPage()) return false;
    const it = getIntent();
    if (!it) return false;
    // round-8 H1：把进入时记录的卡片标识（与 pickNext 读键同源）存到 state，供 markCourseDone/Failed 写入去重键
    try { ZHS.state.hubKey = it.courseId || null; } catch (e) {}
    // round-8 M2：标记待确认跳转已落地，解除看门狗
    try {
      const st = readStore();
      if (st.pendingHop && st.pendingHop.courseId === (it.courseId || '')) {
        st.pendingHop.settled = true;
        writeStore(st);
      }
    } catch (e) {}
    clearIntent();
    ZHS.Log.info('[课程中心] 已进入课程：' + (it.courseName || it.courseId || '未知'));
    bumpStat('hopped');
    return true;
  }

  // ============ 课程中心页主流程 ============

  async function runOnHub(via) {
    if (!isHubPage()) return false;
    // round-8 M2：清理卡住的待确认跳转（超过 5 分钟未 settled → 视为进入失败，移出待学防死循环）
    try {
      const st = readStore();
      if (st.pendingHop && !st.pendingHop.settled
        && Date.now() - (st.pendingHop.at || 0) > 5 * 60 * 1000) {
        ZHS.Log.warn('[课程中心] 检测到卡住的进入请求（' + st.pendingHop.courseId + '），标记为进入失败');
        markCourseFailed(st.pendingHop.courseId);
        st.pendingHop = null;
        writeStore(st);
      }
    } catch (e) {}

    // 等待课程卡片渲染出来（页面可能异步出数据）
    const first = await waitForCards(15000);
    if (!first) {
      ZHS.Log.warn('[课程中心] 未等到课程卡片，跳过自动选课');
      return false;
    }

    const next = await pickNext();
    if (!next) {
      // 没有可进的课 → 出总结
      const store = readStore();
      ZHS.Log.info('[课程中心] 所有课程已无未看完项，本次调度结束'
        + '（已记录完成 ' + (store.doneCourses || []).length + ' 门）');
      // 只在「自动跳课链」里才提示，避免用户随手打开页面就被弹窗打扰
      if (via === 'auto-hop' && ZHS.panel) {
        ZHS.panel.alert('课程中心：没有找到未看完的课程，已停止自动选课', 'info', 8000);
      }
      return false;
    }

    // 把本次授权来源带到卡片上，enterCourse 据此写入 intent.via
    next.via = via || 'manual';
    const ok = await enterCourse(next);
    if (!ok) {
      // 进入失败（卡片不可点 / intent 写不进）→ 记 failed，避免下次继续选它死循环。
      // 注意：enterCourse 已不再把「判定不了」当成失败，所以这里进来的都是真失败。
      const id = cardIdentity(next.el) || next.name;
      markCourseFailed(id);
      ZHS.Log.warn('[课程中心] 进入课程失败，已加入失败名单：' + (next.name || id));
    }
    return ok;
  }

  /** 等第一张课程卡片出现 */
  async function waitForCards(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const el = qsFirst(['.ai-course-center-body div.course-card', '[class*="course-card"]']);
        if (el) return el;
      } catch (e) { /* 忽略 */ }
      await U.sleep(300);
    }
    return null;
  }

  // ============ 对外接口 ============

  const CourseHub = {
    STORE_KEY,
    HUB_URL,
    isHubPage,
    isStudentPage,

    // 存储
    read: readStore,
    write: writeStore,
    reset() {
      writeStore(emptyStore());
      ZHS.Log.info('[课程中心] 会话库已重置');
    },
    listDone() { return readStore().doneCourses || []; },
    listFailed() { return readStore().failedCourses || []; },
    stats() { return readStore().stats || { hopped: 0, failed: 0 }; },

    // 意图
    setIntent,
    getIntent,
    clearIntent,

    // 卡片
    collectCards,
    parseCard,

    // 流程
    pickNext,
    enterCourse,
    markCourseDone,
    markCourseFailed,
    returnToHub,
    settleIntentOnStudentPage,
    runOnHub,

    /** 启动：根据当前页面决定行为 */
    async start() {
      try {
        if (isHubPage()) {
          await runOnHub();
        } else if (isStudentPage()) {
          settleIntentOnStudentPage();
        }
      } catch (e) {
        ZHS.Log.warn('[课程中心] 启动出错：' + e.message);
      }
    },

    /**
     * 页面加载时的安全入口（替代原来的无条件自启动）。
     *
     * 【设计铁律】自动选课绝不能「打开页面就悄悄发生」。
     * 过去版本在这里无条件 start()，导致用户只是打开课程中心看一眼，
     * 1.5 秒后课就被点了、还开出新标签 —— 这是劫持用户操作，不可接受。
     *
     * 现在只有两种情形才会真正动手：
     *   A. 跳课链闭环：存在有效 intent 且来源是「上一门课学完后自动跳转」
     *      （intent.via === 'auto-hop'）→ 说明用户已授权「学完自动跳下一门」这条链
     *   B. 用户在面板上手动触发（走 triggerManual()）
     * 其余情况一律只打日志，绝不动手。
     */
    async onPageReady() {
      try {
        if (isStudentPage()) {
          // 学习页：认领 intent（这是「跳转成功」的唯一可信信号）
          settleIntentOnStudentPage();
          return;
        }
        if (!isHubPage()) return;

        // 【关键】先读意图，读完立即消费掉 —— 无论后面走哪条分支。
        //
        // 早先版本把这个读取放在「选课开关开启」判断【之后】，导致：
        // 用户只开「自动跳课」不开「自动选课」时，跳回课程中心后直接从开关分支 return，
        // intent 永远没被清除、留在存储里成为「僵尸意图」。等用户后来某天打开
        // 「自动选课」，一进课程中心就会被这个陈旧意图触发自动点课 ——
        // 严重违背「用户没主动授权时绝不劫持操作」的铁律。
        //
        // 现在改为：只要进到课程中心页，先把意图读出来并立刻消费（清除），
        // 再根据开关与意图来源决定是否动手。纸条用完就撕，绝不留到下次。
        const it = getIntent();
        const fromAutoHop = !!(it && it.via === 'auto-hop');
        if (it) clearIntent();

        if (!ZHS.config.autoCoursePick) {
          // 用 info：这是用户「为什么没自动选课」的直接答案，必须留在面板可见。
          ZHS.Log.info('[课程中心] 自动选课开关关闭，不动作（已消费跳转意图，避免残留）');
          return;
        }

        if (!fromAutoHop) {
          // 用户只是打开了课程中心 —— 只提示，不点课
          ZHS.Log.info('[课程中心] 已进入课程中心页。如需自动选择未学完课程，请在面板点击「找下一门课」'
            + '（或由「自动跳课」在学完一门课后自动触发）');
          return;
        }

        ZHS.Log.info('[课程中心] 检测到自动跳课意图（上一门课已学完），开始选择下一门课');
        await runOnHub('auto-hop');
      } catch (e) {
        ZHS.Log.warn('[课程中心] 页面就绪处理出错：' + e.message);
      }
    },

    /** 用户手动触发：在面板点「找下一门课」时调用 */
    async triggerManual() {
      if (!ZHS.config.autoCoursePick) {
        ZHS.Log.warn('[课程中心] 自动选课开关已关闭，请先开启');
        if (ZHS.panel) ZHS.panel.alert('请先开启「自动选课」开关', 'warn');
        return false;
      }
      if (!isHubPage()) {
        ZHS.Log.warn('[课程中心] 当前不在课程中心页，无法选课');
        if (ZHS.panel) ZHS.panel.alert('请先进入课程中心页面', 'warn');
        return false;
      }
      return await runOnHub('manual');
    },
  };

  ZHS.CourseHub = CourseHub;

  // 自启动改为「安全入口」：只做认领与提示，不会在用户没授权时点课。
  // 参见 onPageReady() 的设计铁律说明。
  try {
    setTimeout(() => { ZHS.CourseHub.onPageReady(); }, 1500);
  } catch (e) { /* 忽略 */ }
  ZHS.Log.debug('[课程中心] 调度模块已加载');
})();

/* ===== 06c-exam.js ===== */
/**
 * 智慧树「在线作业 / 在线考试」作答页 —— 守株待兔式自动答题
 *
 * ============ 设计原则（源自用户原话，务必理解后再改）============
 *
 * 用户要的是「我不主动去找作业，但当我点进去时你帮我答完」：
 *
 *   用户自己点进作业/考试作答页
 *        ↓
 *   脚本发现「在作答页」且在允许的章节范围内
 *        ↓
 *   自动逐题拿答案 → 填进页面 → （可选）点提交
 *        ↓
 *   停下。不跳下一个任务、不回列表页、不循环。
 *
 * ============ 绝对禁止的行为（见下方 FORBIDDEN，改动时勿越界）============
 *   ❌ 不调用 location.href / location.replace 跳转到任何作业/考试页
 *   ❌ 不在列表页自动点击「开始答题 / 进入作业」
 *   ❌ 不做「答完一个自动找下一个」的循环
 *   ❌ 不自动点进任何 dohomework / doexamination 链接
 *
 * 原因：自动跳转会被平台识别为异常行为，且用户明确说「配置剔除自动进入」。
 *       「主动出击」是用户明确否掉的方案，不要自作聪明加回来。
 *
 * ============ 页面事实（来自 PROCESS/meetings/round-2/review-worker-20.md）============
 *   作答页 URL： #/webExamList/dohomework/{...} 或 #/webExamList/doexamination/{...}
 *   列表页 URL： #/webExamList（不含上面两者）
 *   题目块：     .examPaper_subject[data-questionid]
 *   题型标签：   .subject_type_describe .subject_type    文案形如「【单选题】(2分)」
 *   题干：       .subject_describe                        （innerHTML 注入）
 *   选项：       .subject_node > .nodeLab
 *   选项勾选框： .nodeLab input                            （radio/checkbox + v-model）
 *   选项文本：   .nodeLab .node_detail.examquestions-answer（innerHTML 注入）
 *   提交按钮：   button.submit-btn  （可点 .active-color / 禁用 .disable-color）
 *
 * ⚠️ 全套选择器来自「官方 SPA 打包产物反编译」，非登录态运行时实测。
 *    运行时可能多出 data-v-xxxx 作用域属性（不影响 class 选择器）。
 *    因此每一处 DOM 操作都做了空值容错，任何一步失败只 warn 不抛异常。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod06c_exam) return;
  ZHS.__mod06c_exam = true;
  const U = ZHS.Util;

  // ============ 禁止事项清单（写进代码，防止后来者误加功能）============
  const FORBIDDEN = [
    '不跳转：本模块永不调用 location.href / location.replace / window.open',
    '不点击列表页：本模块永不点击 .jobExamComBtn / .course_ewstate / 任何 dohomework 链接',
    '不循环：答完当前页即停止，不寻找下一个作业/考试',
  ];

  const PREFIX = '[作业考试]';

  // ============ 页面判定 ============

  /** 当前是否在作业/考试「作答页」（dohomework / doexamination） */
  function isAnswerPage() {
    try {
      const h = String(location.hash || '');
      return /dohomework|doexamination/.test(h);
    } catch (e) {
      return false;
    }
  }

  /** 当前是否在作业/考试「列表页」（webExamList 且不含作答页关键字） */
  function isListPage() {
    try {
      const h = String(location.hash || '');
      if (!/webExamList/.test(h)) return false;
      return !/dohomework|doexamination/.test(h);
    } catch (e) {
      return false;
    }
  }

  /** 当前是作业还是考试（用于日志语义；两者 DOM 结构一致） */
  function examKind() {
    try {
      const h = String(location.hash || '');
      if (/doexamination/.test(h)) return '考试';
      if (/dohomework/.test(h)) return '作业';
    } catch (e) { /* 忽略 */ }
    return '作业/考试';
  }

  // ============ 章节范围过滤 ============
  //
  // 现状（如实说明）：作答页 URL 只有 recruitId/stuExamId/examId/courseId/schoolId，
  // 不含章节号；页面 DOM 也没有章节锚点。所以「按章节作答」目前只能在
  // 「能从 URL 或页面文字解析出章节号」时生效。
  //
  // 解析优先级：
  //   1. URL 查询参数 chapterNum / chapter / chapterId（部分入口会带）
  //   2. hash 段末（少数入口把章节拼在 hash 里）
  //   3. 页面标题/面包屑里的「第 N 章」
  // 全部拿不到 → 返回 null，调用方退化为「全部作答」并明确告知用户。

  const CHAPTER_SELECTORS = [
    '.examPaper_tit',
    '.examPaper_title',
    '.examPaper-head',
    '.subject_stem_title',
    '.crumbs',
    '.breadcrumb',
  ];

  /** 中文数字 → 阿拉伯数字（只处理 1~99 的常见写法，够章节用） */
  function cnNum(s) {
    const D = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!s) return null;
    if (s === '十') return 10;
    let n = 0;
    if (s.includes('十')) {
      const [a, b] = s.split('十');
      n = (a ? D[a] || 0 : 1) * 10 + (b ? D[b] || 0 : 0);
    } else {
      n = D[s];
      if (n === undefined) return null;
    }
    return n;
  }

  /** 从文本里抽「第 N 章」「第N章」（阿拉伯数字与中文数字都认）里的 N */
  function parseChapterFromText(text) {
    const t = String(text || '');
    // 先认阿拉伯数字
    let m = t.match(/第\s*(\d+)\s*[章节单元]/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    // 再认中文数字（真实站点标题常写「第三章」）
    m = t.match(/第\s*([一二三四五六七八九十零]{1,3})\s*[章节单元]/);
    if (m) {
      const n = cnNum(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  /** 解析当前作业/考试所属章节号；拿不到返回 null */
  function detectChapter() {
    // 1. URL 查询参数
    for (const key of ['chapterNum', 'chapter', 'chapterId', 'chapterNo']) {
      const v = U.getUrlParam(key);
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }

    // 2. hash 段末（形如 .../dohomework/{recruitId}/.../{schoolId}/{meetCourseType}）
    //    参数位不是章节，这里只在明确出现 chapter 字样时尝试
    try {
      const h = decodeURIComponent(String(location.hash || ''));
      const m = h.match(/chapter[^/]*?(\d+)/i);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      const t = parseChapterFromText(h);
      if (t) return t;
    } catch (e) { /* 忽略 */ }

    // 3. 页面可见文字（标题 / 面包屑）
    for (const sel of CHAPTER_SELECTORS) {
      let el = null;
      try { el = document.querySelector(sel); } catch (e) { el = null; }
      if (!el) continue;
      const n = parseChapterFromText(U.normText(el.innerText || el.textContent || ''));
      if (n) return n;
    }

    return null;
  }

  /**
   * 章节范围判断
   * @param {number|null} chapterNum 当前章节号；null = 未能识别
   * @param {number} from 起始章节（0 = 不限）
   * @param {number} to   结束章节（0 = 不限）
   * @returns {boolean}
   */
  function inChapterRange(chapterNum, from, to) {
    const lo = Number(from) || 0;
    const hi = Number(to) || 0;
    // 两端都是 0 → 不限
    if (lo === 0 && hi === 0) return true;
    // 未能识别章节 → 不拦（宁可多答，不可漏答；调用方会打日志告知）
    if (chapterNum == null) return true;
    if (lo > 0 && chapterNum < lo) return false;
    if (hi > 0 && chapterNum > hi) return false;
    return true;
  }

  // ============ 题目解析 ============

  const QTYPE = {
    SINGLE: 'single',
    MULTIPLE: 'multiple',
    JUDGEMENT: 'judgement',
    COMPLETION: 'completion',
    QA: 'qa',
    UNKNOWN: 'unknown',
  };

  /** 题型文案 → 内部题型（对照 review-worker-20 的【单选题】(2分) 格式） */
  function parseType(text) {
    const t = String(text || '');
    if (t.includes('多选')) return QTYPE.MULTIPLE;
    if (t.includes('单选')) return QTYPE.SINGLE;
    if (t.includes('判断')) return QTYPE.JUDGEMENT;
    if (t.includes('填空')) return QTYPE.COMPLETION;
    if (t.includes('简答') || t.includes('问答') || t.includes('论述')) return QTYPE.QA;
    return QTYPE.UNKNOWN;
  }

  /** 元素 HTML 里可能带 img，把 data-src 提到 src（复用 08-questions 的做法） */
  function hydrateImages(root) {
    if (!root) return;
    try {
      if (ZHS.Questions && ZHS.Questions.hydrateImages) {
        ZHS.Questions.hydrateImages(root);
        return;
      }
      root.querySelectorAll('img').forEach((img) => {
        if (img.dataset && img.dataset.src && img.src !== img.dataset.src) img.src = img.dataset.src;
      });
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 采集页面上的全部题目
   * @returns {Array<{id, type, stem, options, optionEls, node, index}>}
   */
  function collectQuestions() {
    const out = [];
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll('.examPaper_subject'));
    } catch (e) {
      ZHS.Log.warn(PREFIX + ' 题目选择器查询失败：' + e.message);
      return out;
    }

    nodes.forEach((node, index) => {
      try {
        hydrateImages(node);

        // 题干（.subject_describe 是 innerHTML 注入，取 textContent）
        const stemEl = node.querySelector('.subject_describe');
        const stem = U.normText(stemEl ? (stemEl.textContent || '') : '') ||
          U.normText(node.textContent || '').slice(0, 300);

        // 题型：优先看 .subject_type 的「【单选题】(2分)」
        let typeText = '';
        const typeEl = node.querySelector('.subject_type_describe .subject_type') ||
          node.querySelector('.subject_type');
        if (typeEl) typeText = U.normText(typeEl.textContent || '');
        const type = parseType(typeText);

        // 选项
        const optionEls = Array.from(node.querySelectorAll('.subject_node > .nodeLab'));
        const options = optionEls.map((lab) => {
          const txt = lab.querySelector('.node_detail.examquestions-answer') ||
            lab.querySelector('.node_detail');
          return U.normText(txt ? (txt.textContent || '') : (lab.textContent || ''));
        });

        out.push({
          id: (node.dataset && node.dataset.questionid) || ('idx' + index),
          qno: U.normText((node.querySelector('.subject_num') || {}).textContent || '') || String(index + 1),
          type,
          typeText,
          stem,
          options,
          optionEls,
          node,
          index,
        });
      } catch (e) {
        ZHS.Log.warn(PREFIX + ' 第 ' + (index + 1) + ' 题解析失败：' + e.message);
      }
    });

    return out;
  }

  // ============ 答案获取（复用现有双通道：题库 → LLM）============

  /**
   * 取答案
   * 复用 ZHS.Solver.solve({title, options, type})，它内部已实现
   * 「题库优先（ZHS.Bank.search）→ LLM 兜底（ZHS.LLM.vote）→ 按 gatedRandom 决定是否蒙」。
   * @returns {Promise<{answer, from}|null>}
   */
  async function askAnswer(q) {
    if (!ZHS.Solver || typeof ZHS.Solver.solve !== 'function') {
      ZHS.Log.warn(PREFIX + ' 解题器（ZHS.Solver）不可用，无法取答案');
      return null;
    }
    try {
      const r = await ZHS.Solver.solve({
        title: q.stem,
        options: q.options,
        type: q.type,
      });
      return r || null;
    } catch (e) {
      ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题求解异常：' + (e && e.message));
      return null;
    }
  }

  // ============ 答案回填 ============

  /** 判断选项是否已选中（复用 ZHS.Filler.isChecked，兜底自己实现） */
  function optionChecked(el) {
    try {
      if (ZHS.Filler && typeof ZHS.Filler.isChecked === 'function') return ZHS.Filler.isChecked(el);
    } catch (e) { /* 落到兜底 */ }
    const input = el && el.querySelector && el.querySelector('input');
    return !!(input && input.checked);
  }

  /**
   * 勾选一个选项
   *
   * 关键点：智慧树用 Vue 的 v-model="checkboxVal" 绑在 .nodeLab input 上。
   * 直接改 input.checked 不会触发 Vue 更新，必须补发 change / input 事件；
   * 优先直接 click()（最贴近真人操作，Vue 自己能收到）。
   */
  async function checkOption(el) {
    if (!el) return false;
    if (optionChecked(el)) {
      ZHS.Log.debug(PREFIX + ' 选项已选中，跳过（防取消）');
      return true;
    }

    const input = el.querySelector('input');

    // 1. 优先点 input：Vue 的 v-model 在 input 上，click 会自动同步数据
    if (input) {
      try { input.click(); } catch (e) {
        try {
          input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } catch (e2) { /* 忽略 */ }
      }
      await U.sleep(220);
      if (input.checked) return true;
    }

    // 2. 点整块 .nodeLab（外层 label 有点击代理）
    try { el.click(); } catch (e) { /* 忽略 */ }
    await U.sleep(220);
    if (optionChecked(el)) return true;

    // 3. 兜底：直接改 checked + 补发事件（让 v-model 收到）
    if (input) {
      try {
        input.checked = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await U.sleep(120);
        if (input.checked) return true;
      } catch (e) { /* 忽略 */ }
    }

    ZHS.Log.warn(PREFIX + ' 选项点击后仍未选中');
    return false;
  }

  /** 把答案文本与选项文本做模糊匹配，返回选项索引；匹配不上返回 -1 */
  function matchOptionByText(answer, options) {
    const a = U.normText(answer);
    if (!a || !options || !options.length) return -1;

    const norm = (s) => U.normText(s)
      .replace(/^[A-Da-d][.、．)）:：]?\s*/, '')   // 去掉「A. 」这类前缀再比
      .replace(/[\s,，。.、;；:：]/g, '');

    const na = norm(a);

    // 完全相等
    for (let i = 0; i < options.length; i++) {
      if (norm(options[i]) === na) return i;
    }
    // 互相包含
    for (let i = 0; i < options.length; i++) {
      const no = norm(options[i]);
      if (!no) continue;
      if (no.includes(na) || na.includes(no)) return i;
    }
    return -1;
  }

  /**
   * 解析答案 → 选项索引数组
   * 两种策略都试：① A/B/C/D 字母 → 索引  ② 答案文本包含匹配
   */
  function resolveIndexes(answer, options) {
    // ① 字母
    let idxs = [];
    try {
      if (ZHS.Bank && typeof ZHS.Bank.toIndexes === 'function') idxs = ZHS.Bank.toIndexes(answer) || [];
    } catch (e) { idxs = []; }

    if (idxs.length) {
      const valid = idxs.filter((i) => i >= 0 && i < options.length);
      if (valid.length) return valid;
    }

    // ② 文本包含匹配（答案可能是「正确」「北京」这类）
    const i = matchOptionByText(answer, options);
    if (i >= 0) return [i];

    return [];
  }

  /**
   * 回填一道选择题 / 判断题
   * @returns {Promise<boolean>} 是否真的选上了
   */
  async function fillChoice(q, answer) {
    const idxs = resolveIndexes(answer, q.options);
    if (!idxs.length) {
      ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题答案「' + String(answer).slice(0, 30) +
        '」无法对应到选项（共 ' + q.options.length + ' 个），跳过');
      return false;
    }

    let done = 0;
    for (const i of idxs) {
      const el = q.optionEls[i];
      if (!el) continue;
      // eslint-disable-next-line no-await-in-loop
      const okOne = await checkOption(el);
      if (okOne) done++;
    }
    if (done > 0) return true;

    ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题选项全部点击失败');
    return false;
  }

  /**
   * 回填判断题
   * 判断题 DOM 同样是 .nodeLab 选项（通常两个：对 / 错），
   * 先按「对/错」文本匹配，匹配不到再用索引兜底（0=对，1=错）。
   */
  async function fillJudgement(q, answer) {
    const ans = String(answer || '').trim();
    const isTrue = /^(对|正确|是|√|✓|true|t)$/i.test(ans);
    const isFalse = /^(错|错误|否|×|✗|false|f)$/i.test(ans);

    if (!isTrue && !isFalse) {
      // 不是标准判定词，退回通用匹配
      return fillChoice(q, answer);
    }

    // 1. 文本匹配
    for (let i = 0; i < q.optionEls.length; i++) {
      const t = U.normText(q.options[i]);
      if (isTrue && /^(对|正确|是|√|✓|true|t)/i.test(t)) {
        return checkOption(q.optionEls[i]);
      }
      if (isFalse && /^(错|错误|否|×|✗|false|f)/i.test(t)) {
        return checkOption(q.optionEls[i]);
      }
    }
    // 2. 索引兜底
    const idx = isTrue ? 0 : 1;
    if (q.optionEls[idx]) return checkOption(q.optionEls[idx]);

    ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题判断题未能定位选项');
    return false;
  }

  // ============ 提交 ============

  /** 找到可点的提交按钮（必须先确认不是 disable-color） */
  function findSubmitButton() {
    let btn = null;
    try { btn = document.querySelector('button.submit-btn'); } catch (e) { btn = null; }
    if (!btn) return null;

    const cls = btn.className || '';
    if (/disable-color/.test(cls)) {
      ZHS.Log.warn(PREFIX + ' 提交按钮处于禁用态（.disable-color），不点击');
      return null;
    }
    if (!/active-color/.test(cls)) {
      // 类名可能随版本变化；没有明确禁用才允许点
      ZHS.Log.warn(PREFIX + ' 提交按钮未带 .active-color，类名为「' + cls + '」，仍尝试点击（请留意结果）');
    }
    return btn;
  }

  /** 等待若干秒（给用户反悔机会），面板可看到倒计时日志 */
  async function waitBeforeSubmit(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    if (total <= 0) return;
    ZHS.Log.info(PREFIX + ' ' + total + ' 秒后自动提交（想反悔请尽快点「停止」或手动操作页面）');
    for (let i = total; i > 0; i--) {
      // eslint-disable-next-line no-await-in-loop
      await U.sleep(1000);
      if (i <= 3 || i % 5 === 0) ZHS.Log.debug(PREFIX + ' 距提交还有 ' + i + ' 秒');
    }
  }

  // ============ 主流程 ============

  const Exam = {
    isAnswerPage,
    isListPage,
    examKind,
    detectChapter,
    inChapterRange,
    collectQuestions,
    parseType,
    resolveIndexes,
    _running: false,
    _done: false,        // 本页是否已处理过（防 SPA 重复触发）
    _sig: '',            // 本页处理签名（URL + 题目数），变了才重新处理

    /**
     * 作答当前页
     * @param opts.manual 面板「答题」按钮手动触发：跳过 autoExam 开关
     */
    async solvePage(opts) {
      const manual = !!(opts && opts.manual);
      const cfg = ZHS.config;

      // —— 门禁 1：必须在作答页 ——
      if (!isAnswerPage()) {
        if (manual) ZHS.Log.warn(PREFIX + ' 当前不在作业/考试作答页，无需作答');
        return;
      }

      // —— 门禁 2：总开关（手动触发绕过）——
      // 【严格判断】必须用 !== true，不能用 !cfg.autoExam。
      // 这是个「默认关闭」的安全开关：一旦存储被写入脏值（如字符串 "no"、"false"、"0"），
      // `!"no"` 为 false，会把自动答题【偷偷打开】—— 在考试场景下这是不可接受的。
      // 只有明确等于 true 才放行。
      if (!manual && cfg.autoExam !== true) return;

      if (this._running) {
        ZHS.Log.debug(PREFIX + ' 作答流程进行中，跳过重复触发');
        return;
      }

      const kind = examKind();

      // —— 章节识别 ——
      const chapter = detectChapter();
      // 【数值夹逼】范围必须是非负整数。直接改存储/调 API 写入 -5 或 999 时，
      // 负数会被当成「不限」，造成意外的越权范围。统一夹到 0~999 的整数。
      const clampCh = (v) => {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.min(n, 999);
      };
      const from = clampCh(cfg.examChapterFrom);
      const to = clampCh(cfg.examChapterTo);
      const ranged = from > 0 || to > 0;

      if (ranged) {
        if (chapter == null) {
          ZHS.Log.warn(PREFIX + ' 未能识别当前' + kind + '所属章节（URL 与页面均无章节信息），按全部作答。' +
            '如需精确按章节，请把章节范围改回 0');
        } else if (!inChapterRange(chapter, from, to)) {
          ZHS.Log.info(PREFIX + ' 当前' + kind + '属于第 ' + chapter + ' 章，不在设定范围（' +
            (from || '不限') + '~' + (to || '不限') + '）内，本次不作答');
          return;
        } else {
          ZHS.Log.info(PREFIX + ' 当前' + kind + '属于第 ' + chapter + ' 章，在设定范围内，开始作答');
        }
      }

      this._running = true;
      const t0 = Date.now();
      try {
        ZHS.Log.info(PREFIX + ' 检测到' + kind + '作答页，开始自动作答（守株待兔模式：答完即停，不会跳转其它任务）');

        // 等题目渲染出来（Vue 是异步渲染的）
        let questions = collectQuestions();
        for (let i = 0; i < 20 && !questions.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          await U.sleep(500);
          questions = collectQuestions();
        }

        if (!questions.length) {
          ZHS.Log.warn(PREFIX + ' 未找到题目（.examPaper_subject 为空），可能页面结构变化或尚未加载完成');
          return;
        }

        ZHS.Log.info(PREFIX + ' 共 ' + questions.length + ' 题');

        const skippedTypes = [];
        const failed = [];       // 未答上的题号
        let answered = 0;
        let subjective = 0;

        for (const q of questions) {
          // —— 主观题（填空/简答/问答）：跳过，不瞎填 ——
          if (q.type === QTYPE.COMPLETION || q.type === QTYPE.QA) {
            subjective++;
            skippedTypes.push(q.qno + '(' + q.typeText + ')');
            ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题是主观题（' + (q.typeText || '填空/问答') +
              '），自动作答不处理，请手动完成');
            continue;
          }

          if (!q.stem && !q.options.length) {
            ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题既无题干也无选项，跳过');
            failed.push(q.qno);
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const result = await askAnswer(q);
          if (!result || !result.answer) {
            ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题未取得答案，跳过（未配置 LLM Key 或题库未命中）');
            failed.push(q.qno);
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          let okOne = false;
          if (q.type === QTYPE.JUDGEMENT) {
            // eslint-disable-next-line no-await-in-loop
            okOne = await fillJudgement(q, result.answer);
          } else {
            // eslint-disable-next-line no-await-in-loop
            okOne = await fillChoice(q, result.answer);
          }

          if (okOne) {
            answered++;
            ZHS.state.answeredCount++;
            ZHS.Log.info(PREFIX + ' 第 ' + q.qno + ' 题已作答：' + String(result.answer).slice(0, 40) +
              '（来源 ' + (result.from || '未知') + '）');
          } else {
            failed.push(q.qno);
            ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题回填失败：答案 ' + String(result.answer).slice(0, 40));
          }

          // 每题之间的间隔（复用现有 answerDelay 配置）
          const d = Number(cfg.answerDelay) || 0;
          // eslint-disable-next-line no-await-in-loop
          if (d > 0) await U.sleep(d * 1000);
        }

        // —— 结果小结 ——
        const cost = ((Date.now() - t0) / 1000).toFixed(1);
        ZHS.Log.info(PREFIX + ' 作答完成：成功 ' + answered + ' / ' + questions.length +
          ' 题，耗时 ' + cost + ' 秒');

        if (subjective > 0) {
          ZHS.Log.warn(PREFIX + ' 有 ' + subjective + ' 道主观题未处理（题号：' +
            skippedTypes.join('、') + '），请手动作答');
        }
        if (failed.length) {
          ZHS.Log.warn(PREFIX + ' 以下题号未答上：' + failed.join('、') + '（建议手动补答）');
        }

        // —— 提交 ——
        // 注意：这里【只提交当前这一页】，绝不跳转、绝不寻找下一个任务。
        if (!cfg.examSubmit) {
          ZHS.Log.info(PREFIX + ' 「答完自动提交」已关闭，答案已填入页面，请自行检查后手动提交');
          if (ZHS.panel) ZHS.panel.alert(kind + '已作答 ' + answered + ' 题，请手动检查后提交', 'info', 8000);
          return;
        }

        if (answered === 0) {
          ZHS.Log.warn(PREFIX + ' 一题都没答上，不自动提交（避免交白卷）');
          if (ZHS.panel) ZHS.panel.alert('该' + kind + '一题都没答上，已跳过自动提交，请手动处理', 'warn', 10000);
          return;
        }

        await waitBeforeSubmit(cfg.examSubmitDelay);

        const btn = findSubmitButton();
        if (!btn) {
          ZHS.Log.warn(PREFIX + ' 未找到可点击的提交按钮，请手动点「提交」');
          if (ZHS.panel) ZHS.panel.alert('未找到提交按钮，请手动提交', 'warn', 8000);
          return;
        }

        try {
          btn.click();
          ZHS.Log.info(PREFIX + ' 已点击「提交」按钮');
        } catch (e) {
          try {
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            ZHS.Log.info(PREFIX + ' 已派发提交点击事件');
          } catch (e2) {
            ZHS.Log.warn(PREFIX + ' 提交点击失败：' + e2.message);
            return;
          }
        }

        await U.sleep(1200);
        ZHS.Log.info(PREFIX + ' 流程结束。本模块到此为止：不跳转、不寻找下一个作业/考试');
        if (ZHS.panel) {
          ZHS.panel.alert(kind + '自动作答并提交完成（' + answered + ' 题）。' +
            (failed.length ? '有 ' + failed.length + ' 题未答上，请检查。' : ''), 'info', 10000);
        }

        // 标记本页处理完，防止 SPA 反复触发
        this._done = true;
        this._sig = location.hash + '|' + questions.length;
      } catch (e) {
        // 任何异常都不外溢，只记录，保证不打断页面其它功能
        ZHS.Log.error(PREFIX + ' 作答流程异常：' + (e && e.message));
      } finally {
        this._running = false;
      }
    },

    /** 重置「本页已处理」标记（切页后调用） */
    reset() {
      this._done = false;
      this._sig = '';
    },

    /** 对外暴露禁止事项，方便测试断言 */
    FORBIDDEN,
  };

  ZHS.Exam = Exam;

  // ============ 自启动（严格安全）============
  //
  // 安全要求（前车之鉴：06b-course-hub 会主动跳转，本模块【禁止】任何跳转动作）：
  //   · 只在「作答页」做检测
  //   · 只有 autoExam === true 才真正作答
  //   · 在「列表页」仅打一条 debug 日志，绝不点击任何东西
  //   · 开关关闭时行为与改动前【完全一致】

  function tick() {
    try {
      if (isAnswerPage()) {
        const cfg = ZHS.config;

        // 严格判断：只有明确 true 才作答。脏值（"no"/"false"/0）一律视为关闭，
        // 不能让「默认关闭」的安全开关被非布尔值绕过（见 solvePage 门禁 2 的说明）。
        if (cfg.autoExam !== true) {
          // 关闭态：只提示一次，什么都不做
          if (!Exam._notified) {
            Exam._notified = true;
            ZHS.Log.info(PREFIX + ' 检测到' + examKind() + '作答页。开启面板「自动答题（作业/考试）」后，' +
              '脚本会在你自己点进来时自动作答并提交；脚本不会自动跳转到本页');
          }
          return;
        }

        // 已处理过且 URL 没变 → 不重复（SPA 的 MutationObserver / 定时器会反复触发）
        const sig = location.hash;
        if (Exam._done && Exam._sig && Exam._sig.indexOf(sig) === 0) return;

        // 防重入 + 定时器兜底：solvePage 内部也有 _running 保护
        if (!Exam._running) Exam.solvePage();
        return;
      }

      if (isListPage()) {
        // 列表页：只记录，绝无自动点击（这是用户明确要求的「守株待兔」）
        if (!Exam._listNotified) {
          Exam._listNotified = true;
          ZHS.Log.debug(PREFIX + ' 当前是作业/考试列表页。本模块不会自动进入任何作业或考试，' +
            '请自行点进想作答的那一个');
        }
      }
    } catch (e) {
      ZHS.Log.debug(PREFIX + ' 检测异常：' + (e && e.message));
    }
  }

  // 页面加载后先等平台渲染，再轮询检测。
  // 用轮询而不用 MutationObserver：SPA 路由切换（hash 变化）不产生 DOM mutation 时
  // MutationObserver 收不到，轮询更稳，且开销极低（3 秒一次，几乎全是字符串判断）。
  function bootstrap() {
    setTimeout(tick, 2000);
    setInterval(tick, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  ZHS.Log.debug(PREFIX + ' 模块已加载（守株待兔模式：只在作答页工作，永不自动跳转）');
})();

/* ===== 07-main.js ===== */
/**
 * 主入口：初始化 + SPA 监听
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod07_main) return;
  ZHS.__mod07_main = true;
  const U = ZHS.Util;

  let initialized = false;
  let bootTries = 0;
  const BOOT_MAX_TRIES = 3;

  /**
   * round-14：面板外兜底提示条。
   *
   * 背景：面板是脚本唯一的可见界面。一旦 ZHS.panel 缺失或 mount 失败，
   * 原代码只写一行 ZHS.Log.error —— 而日志恰恰是写进「面板自己的日志缓冲」里的，
   * 面板正是此刻看不见的那个东西，等于零提示；普通用户也不会开 F12。
   * 结果就是「脚本在后台照常跑，用户一个界面元素都看不到」= 用户报的「装了跟没装一样」。
   *
   * 这里直接在页面根节点挂一条固定定位的红条，不依赖面板、不依赖 Shadow DOM，
   * 只用最朴素的 DOM 操作，尽可能在任何环境下都能显示出来。
   */
  function showPanelMissingNotice(detail) {
    try {
      if (document.getElementById('zhs-panel-missing-notice')) return;   // 去重
      const bar = document.createElement('div');
      bar.id = 'zhs-panel-missing-notice';
      bar.setAttribute('style',
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;'
        + 'background:#e74c3c;color:#fff;font-size:13px;line-height:1.7;'
        + 'padding:8px 14px;text-align:center;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;'
        + 'box-shadow:0 2px 8px rgba(0,0,0,.25)');
      bar.textContent = '智慧树助手：脚本正在后台运行，但控制面板初始化失败'
        + (detail ? '（' + detail + '）' : '')
        + '。请刷新页面重试；若仍不显示，可在控制台执行 zhs.boot()。';
      // 点一下可关闭，不打扰用户
      bar.addEventListener('click', () => { try { bar.remove(); } catch (e) { /* 忽略 */ } });
      (document.body || document.documentElement).appendChild(bar);
      ZHS.Log.warn('已显示面板外兜底提示条（面板不可用）');
    } catch (e) { /* 连兜底条都挂不上，只能留在日志里 */ }
  }

  /**
   * 启动外壳：负责「失败要能看得见，且允许重试」
   *
   * 【2026-09-19 修正】原来的 boot() 第一句就是 `initialized = true`。
   * 这意味着只要中间任何一步抛异常（新版页面对抗、某个 DOM 访问越界、
   * 平台改版导致选择器非法……），boot 会中断在半路，但 initialized 已经置真，
   * 于是 watchSpa() 里那条「页面还没初始化但出现视频 → 补启动」的自愈通道永久失效。
   * 后果正是用户反馈的那句：**装了 27 次，面板都没有，跟没装一样** ——
   * 脚本其实跑了，只是跑一半死在没人看得见的地方。
   *
   * 现在改成三件事：
   *   1. 成功跑完才算初始化完成（initialized 移到末尾）
   *   2. 失败要看得见：先把面板挂上再报错，用户至少知道脚本在
   *   3. 允许重试（最多 3 次），失败后交给 watchSpa 在 DOM 稳定时再来
   */
  async function boot() {
    if (initialized || bootTries >= BOOT_MAX_TRIES) return;
    bootTries++;
    try {
      await bootOnce();
      initialized = true;
    } catch (e) {
      const msg = (e && e.message) || String(e);
      initialized = false;   // 认账只在成功时做，这里保持「未初始化」才能被自愈通道救回
      // 区分「还没进播放页（等自愈）」与「真出错」：前者用 info 不刷红，避免误导用户以为坏了
      if (msg === 'NO_VIDEO_YET') {
        ZHS.Log.info('尚未进入播放页（无视频元素），进入课程后自动启动');
      } else {
        ZHS.Log.error('初始化失败（第 ' + bootTries + '/' + BOOT_MAX_TRIES + ' 次）：' + msg);
        try {
          if (ZHS.panel) {
            ZHS.panel.mount();
            ZHS.panel.alert('脚本启动异常：' + msg + '。可刷新页面重试，或在控制台执行 zhs.boot()', 'error', 15000);
          }
        } catch (e2) { /* 连面板都挂不上，只能留在日志里 */ }
        if (bootTries < BOOT_MAX_TRIES) ZHS.Log.info('将在页面 DOM 变化后自动重试启动');
      }
    }
  }

  async function bootOnce() {
    ZHS.Log.info('=== 初始化开始 ===');

    // 0. 面板最先挂载：后续任何一步炸了，用户至少能看见脚本存在
    //    （原来排在第 3 步，且整条链无 try/catch → 前一步出错就永远看不到面板）
    // round-15【B】：判据不能只看 `ZHS.panel` 是否为真 —— round-14 改成「先发布空对象占位」
    // 后，即使面板模块体后半段抛异常，ZHS.panel 也是个 truthy 的空对象 {}，
    // 于是这里会进 true 分支去调不存在的 mount()，抛 TypeError，
    // 结果把「面板模块本身加载失败」的真实原因掩盖成「mount is not a function」，排查被带偏。
    // 正确判据：既要有对象，也要 mount 真的是函数（即 __panel_ready 已置位）。
    const panelUsable = !!(ZHS.panel && typeof ZHS.panel.mount === 'function');
    if (panelUsable) {
      try { ZHS.panel.mount(); }
      catch (e) {
        ZHS.Log.warn('面板挂载失败：' + e.message);
        showPanelMissingNotice('挂载异常：' + (e && e.message ? e.message : '未知'));
      }
    } else {
      // 挂不上必须说出来。静默跳过的话，用户眼里就是「装了跟没装一样」。
      ZHS.Log.error('面板模块不可用（ZHS.panel 未就绪或 mount 缺失，__panel_ready='
        + String(ZHS.__panel_ready) + '），界面不会显示；核心逻辑仍会继续尝试');
      showPanelMissingNotice(ZHS.panel ? '模块加载中断（未完成初始化）' : '模块未加载');
    }

    // 1. 识别页面版本
    ZHS.Catalog.redetect();

    // 2. 课程标识
    ZHS.state.courseId = ZHS.Catalog.getCourseId();
    ZHS.Log.info('课程 ID：' + ZHS.state.courseId);

    // 3. 面板先挂载：不等视频，进来就能看到界面。
    //    以前写在 waitFor 之后，在作业页 / 尚未进入播放页时要干等 30 秒才出面板，
    //    用户会误以为脚本没装上（BUG-UX-2）。
    //    注意：此处必须 try/catch 包裹——若面板挂载持续失败（如模板改坏），
    //    裸调用会把异常抛给 bootOnce → 被 boot 记成「初始化失败」→ Scheduler 永不启动，
    //    整脚本（含核心逻辑）都不跑，正是「装了但功能全无用」的直接成因（round-7 面板①）。
    if (ZHS.panel) {
      try { ZHS.panel.mount(); } catch (e) { ZHS.Log.warn('面板二次挂载失败：' + e.message); }
    }

    // 4. 等视频出现（有些页面懒加载）
    let video = await U.waitFor('video', 30000);
    if (!video && ZHS.Util.findVideoInIframes) video = ZHS.Util.findVideoInIframes(document);
    if (!video) {
      ZHS.Log.warn('30 秒内未找到视频元素（含 iframe 兜底），可能不在播放页');
      if (ZHS.panel) {
        ZHS.panel.alert('未检测到视频，可能尚未进入播放页；面板可正常使用，进播放页后会自动开始', 'warn', 10000);
      }
      // 抛出而非 return：让 boot() 捕获后保持 initialized=false，
      // 这样从「课程中心页 → 点进课程页出现 video」时，watchSpa 能重新拉起初始化。
      // 若直接 return，bootOnce 判为「成功返回」，boot() 会把 initialized 误置 true，
      // 自愈通道永久失效，表现正是用户说的「装了但进了课程页毫无动静」。
      throw new Error('NO_VIDEO_YET');
    }
    ZHS.state.videoEl = video;
    ZHS.Log.info('视频元素已就绪，时长 ' + Math.round(video.duration || 0) + 's');

    // 5. 尝试断点恢复
    await ZHS.Resume.restore(ZHS.state.courseId);

    // 6. 当前课时标识 + 绑定进度记录
    const cur = ZHS.Catalog.current();
    ZHS.state.lessonKey = cur ? ZHS.Catalog.itemTitle(cur) : ZHS.Catalog.itemTitle(ZHS.Catalog.items()[0]);
    ZHS.Log.info('当前课时：' + ZHS.state.lessonKey);
    ZHS.Resume.bindVideo(video, ZHS.state.courseId, ZHS.state.lessonKey);

    // 7. 开跑
    ZHS.Scheduler.start();

    const stats = ZHS.Catalog.stats();
    ZHS.Log.info('课程进度：' + stats.done + '/' + stats.total + ' (' + stats.percent + '%)');
    // 成功初始化后给一个明确提示，让用户确信「脚本装上了、在干活」（回应面板首跑可见性）
    if (ZHS.panel) ZHS.panel.alert('智慧树助手已就绪，开始自动学习', 'info', 4000);
    ZHS.Log.info('=== 初始化完成 ===');
  }

  /** SPA 路由变化监听：DOM 重建后重新初始化 */
  function watchSpa() {
    const onDomChange = U.debounce(() => {
      // 切课检测：courseId 变了（SPA 不刷新页面直接换课）→ 重置目录缓存与断点上下文，
      // 否则会残留旧课程的 courseId/lessonKey，导致 gotoNext 跳错节或把进度记到别的课。
      const newCourseId = ZHS.Catalog.getCourseId();
      if (newCourseId && newCourseId !== 'unknown-course' && newCourseId !== ZHS.state.courseId) {
        ZHS.Catalog.resetCatalogCache();
        ZHS.state.courseId = newCourseId;
        ZHS.Log.info('检测到切换课程，已重置目录缓存与断点上下文 → ' + newCourseId);
      }
      // 当前课时变化（同课程内切章节，或切课后）同步 state，避免 gotoNext 用旧 lessonKey 定位错节
      const cur = ZHS.Catalog.current();
      const newLessonKey = cur ? ZHS.Catalog.itemTitle(cur) : null;
      if (newLessonKey && newLessonKey !== ZHS.state.lessonKey) {
        ZHS.state.lessonKey = newLessonKey;
        ZHS.Log.debug('当前课时更新：' + newLessonKey);
      }

      // 视频元素被替换 → 重新绑定，但不重启整套流程
      const v = document.querySelector('video');
      if (v && v !== ZHS.state.videoEl) {
        ZHS.Log.debug('检测到视频元素变化，重新绑定');
        ZHS.state.videoEl = v;
        bootTries = 0; // round-11：视频重新出现时重置 boot 名额，避免 SPA 切集后永久失活
        if (newLessonKey) ZHS.state.lessonKey = newLessonKey;
        ZHS.Resume.bindVideo(v, ZHS.state.courseId, ZHS.state.lessonKey);
      }
      // 页面还没初始化但出现视频 → 补启动（含启动失败后的重试，受次数上限约束）
      if (!initialized && bootTries < BOOT_MAX_TRIES && v) boot();
      // round-14：瞬时故障（目录临时读不到 / 节点临时定位不到 / 连点无反应）导致的停机，
      // 在视频恢复后允许受限自愈重启；用户主动停 / 达标停不受影响（内部有原因判定与冷却/次数上限）
      if (ZHS.Scheduler && ZHS.Scheduler.tryResumeAfterTransientStop) {
        ZHS.Scheduler.tryResumeAfterTransientStop();
      }
    }, 1000);

    try {
      const obs = new MutationObserver(onDomChange);
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      ZHS.Log.debug('MutationObserver 启动失败：' + e.message);
    }
  }

  // ===== 启动时机 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { boot(); watchSpa(); });
  } else {
    boot();
    watchSpa();
  }

  // 暴露手动控制
  window.zhs = {
    boot,
    start: () => ZHS.Scheduler.start({ manual: true }),
    stop: () => ZHS.Scheduler.stop(),
    config: (p) => ZHS.setConfig(p),
    next: () => ZHS.Scheduler.gotoNext('手动', { manual: true }),
    clearResume: () => ZHS.Resume.clear(ZHS.state.courseId),
    logs: () => ZHS.Log.all(),
    stats: () => ZHS.Catalog.stats(),
  };
})();

/* ===== 08-questions.js ===== */
/**
 * 题目采集层：从三种场景抽取结构化题目
 *
 * 场景 A：课中弹题   #playTopic-dialog
 * 场景 B：共享课作业  .subject_node
 * 场景 C：hike 作业/考试  .q_main
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod08_questions) return;
  ZHS.__mod08_questions = true;
  const U = ZHS.Util;

  /** 内部题型枚举 */
  const TYPE = {
    SINGLE: 'single',       // 单选
    MULTIPLE: 'multiple',   // 多选
    JUDGEMENT: 'judgement', // 判断
    COMPLETION: 'completion', // 填空
    QA: 'qa',               // 简答
    UNKNOWN: 'unknown',
  };

  /** 题库 API 的 type 编码：0单选 1多选 2填空 3判断 4问答 */
  const BANK_TYPE = {
    [TYPE.SINGLE]: 0,
    [TYPE.MULTIPLE]: 1,
    [TYPE.COMPLETION]: 2,
    [TYPE.JUDGEMENT]: 3,
    [TYPE.QA]: 4,
    [TYPE.UNKNOWN]: 0,
  };

  /** 文本 → 内部题型 */
  function guessType(text, options) {
    const t = String(text || '');
    if (t.includes('多选')) return TYPE.MULTIPLE;
    if (t.includes('单选')) return TYPE.SINGLE;
    if (t.includes('判断')) return TYPE.JUDGEMENT;
    if (t.includes('填空')) return TYPE.COMPLETION;
    if (t.includes('简答') || t.includes('问答')) return TYPE.QA;

    // 从选项文本推断：只有"对/错"就是判断题
    if (options && options.length === 2) {
      const joined = options.join('');
      if (/^(对|正确|是|T|True)/i.test(joined) && /(错|错误|否|F|False)/i.test(joined)) {
        return TYPE.JUDGEMENT;
      }
    }
    // 选项 4 个以上且文本以 A. B. 开头 → 单选兜底
    if (options && options.length >= 2) return TYPE.SINGLE;
    return TYPE.UNKNOWN;
  }

  /** 安全取元素文本：优先 innerText，降级 textContent（jsdom 不实现 innerText） */
  function readText(el) {
    if (!el) return '';
    const t = el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent;
    return U.normText(t || '');
  }

  /** 图片延迟加载处理：智慧树把真实地址放 data-src */
  function hydrateImages(root) {
    if (!root) return;
    const imgs = root.querySelectorAll('img');
    for (const img of imgs) {
      if (img.dataset && img.dataset.src && !img.src) {
        img.src = img.dataset.src;
      } else if (img.dataset && img.dataset.src && img.src !== img.dataset.src) {
        img.src = img.dataset.src;
      }
    }
  }

  /** 判断元素内是否有图片（用于决定要不要 OCR） */
  function hasImage(root) {
    if (!root) return false;
    return root.querySelectorAll('img').length > 0;
  }

  /**
   * 场景 A：课中弹题
   * 结构：#playTopic-dialog 内 .el-pager .number 分页
   */
  const DialogQuestions = {
    /** 弹题容器（考虑 iframe 情况） */
    root() {
      let r = document.querySelector('#playTopic-dialog, [class*="topic-dialog"]');
      if (r && U.isStructurallyVisible(r)) return r;
      // 关键坑：弹题可能渲染在 iframe 里
      const iframe = document.getElementById('tmDialog_iframe');
      if (iframe) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          const inner = doc && doc.querySelector('#playTopic-dialog, .topic-title, ul');
          if (inner) return doc;
        } catch (e) {
          ZHS.Log.debug('弹题 iframe 跨域，无法访问');
        }
      }
      return null;
    },

    /** 是否出现弹题 */
    present() {
      const r = this.root();
      if (!r) return false;
      return !!r.querySelector('.topic-item, .topic-title, ul li');
    },

    /**
     * 采集所有分页的题目
     * 返回 [{ title, options[], type, pageIndex, elements }]
     */
    collect() {
      const root = this.root();
      if (!root) return [];

      const pages = Array.from(root.querySelectorAll('.el-pager .number'));
      const results = [];

      // 题干（弹题通常所有分页共享一个题干区，或每页一个）
      const titleEl = root.querySelector('.topic-title, .topic-content, .topic-question');
      const sharedTitle = readText(titleEl);

      if (pages.length) {
        // 有分页：逐页收集（注意：这里只读文本，切换分页由答题器负责）
        pages.forEach((p, i) => {
          results.push({
            title: sharedTitle,
            options: [],
            type: TYPE.UNKNOWN,
            pageIndex: i,
            totalPages: pages.length,
            elements: { page: p, root },
            raw: '',
          });
        });
      } else {
        // 无分页：单题
        const options = Array.from(root.querySelectorAll('ul .topic-item, .topic .radio ul > li'));
        results.push({
          title: sharedTitle,
          options: options.map((o) => readText(o)),
          type: guessType(sharedTitle, options.map((o) => readText(o))),
          pageIndex: 0,
          totalPages: 1,
          elements: { page: null, root },
          raw: '',
        });
      }
      return results;
    },

    /** 读取当前分页的完整题目（切页后调用） */
    readCurrent(root) {
      const r = root || this.root();
      if (!r) return null;
      const titleEl = r.querySelector('.topic-title, .topic-content, .topic-question');
      const title = readText(titleEl);
      // 选项：覆盖主文档与 iframe 变体的多种选择器（含 Element UI 的 el-radio/el-checkbox）
      let optionEls = Array.from(r.querySelectorAll('ul .topic-item, .topic .radio ul > li, .answerOption label, .el-radio, .el-checkbox, .radio > label, .checkbox > label'));
      const options = optionEls.map((o) => readText(o));
      const typeText = readText(r.querySelector('.topic-type, .subject_type'));
      return {
        title,
        options,
        type: guessType(typeText + ' ' + title, options),
        elementList: optionEls,
        node: r,   // 供 Filler.fill 在弹题容器内定位输入框，避免填空题退化到整页 document
      };
    },

    /** 关闭弹题 */
    close() {
      const r = this.root();
      if (!r) return false;

      // 按优先级找关闭按钮（智慧树弹题的关闭控件在多个位置出现过）
      const CANDIDATES = [
        '.close-btn',
        '.el-dialog__close',
        '.close',
        '.topic-close',
        '.popbtn_cancel',
        'button[class*="close"]',
        '.btn-cancel',
      ];

      for (const sel of CANDIDATES) {
        let btn = null;
        try { btn = r.querySelector ? r.querySelector(sel) : null; } catch (e) { /* 越界忽略 */ }
        // root 可能是 document（iframe 场景），此时从全局找
        if (!btn && r !== document) {
          try { btn = document.querySelector(sel); } catch (e) { /* 忽略 */ }
        }
        if (btn) {
          try {
            btn.click();
            ZHS.Log.info('已点击关闭按钮：' + sel);
            return true;
          } catch (e) {
            ZHS.Log.debug('关闭按钮点击异常：' + e.message);
          }
        }
      }

      // 兜底 1：从弹题容器往上找「关闭/确定/提交/我知道了」文本按钮
      const scope = (r.querySelectorAll ? r : document);
      const btns = Array.from(scope.querySelectorAll('button, a, span, div'))
        .filter((el) => {
          const t = U.normText(el.innerText || el.textContent || '');
          return t === '关闭' || t === '确定' || t === '提交' || t === '我知道了' || t === '知道了' || t === '继续学习';
        });
      if (btns.length) {
        // 优先最内层（文本最短的）
        btns.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length);
        try {
          btns[0].click();
          ZHS.Log.info('已点击文本关闭按钮：' + U.normText(btns[0].innerText || ''));
          return true;
        } catch (e) { /* 继续兜底 */ }
      }

      // 兜底 2：Esc
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      ZHS.Log.debug('未找到关闭按钮，已派发 Esc');
      return false;
    },

    /** 弹题是否仍存在 */
    stillPresent() {
      return this.present();
    },
  };

  /**
   * 场景 B：共享课作业页（.subject_node）
   */
  const HomeworkQuestions = {
    present() {
      return !!document.querySelector('.subject_node, .question-topic');
    },

    /** 采集所有题目 */
    collect() {
      const nodes = Array.from(document.querySelectorAll('.subject_node'));
      if (!nodes.length) {
        // 兜底：.question-topic 直接作为题目
        const topics = Array.from(document.querySelectorAll('.question-topic'));
        return topics.map((t, i) => this._fromTopic(t, i));
      }
      return nodes.map((n, i) => this._fromNode(n, i));
    },

    _fromNode(node, index) {
      hydrateImages(node);

      const titleEl = node.querySelector('.question-topic, .subject_title, .topic-title');
      let title = readText(titleEl);
      // 图片在题干里但无文字 → 标记需要 OCR
      const needOcr = !title && hasImage(node);

      const typeText = readText(node.querySelector('.subject_type, .question-type'));

      const optionEls = Array.from(node.querySelectorAll('.nodeLab, .label.clearfix, label'));
      const options = optionEls.map((o) => {
        const txt = readText(o);
        // 去掉开头的 "A. " 之类前缀（保留原始，回填需要）
        return txt;
      });

      return {
        title,
        options,
        type: guessType(typeText, options),
        index,
        needOcr,
        elementList: optionEls,
        node,
        raw: readText(node).slice(0, 500),
      };
    },

    _fromTopic(topicEl, index) {
      hydrateImages(topicEl);
      const node = topicEl.closest('.subject_node') || topicEl.parentElement;
      const title = readText(topicEl);
      const optionEls = node ? Array.from(node.querySelectorAll('label, .nodeLab')) : [];
      const options = optionEls.map((o) => readText(o));
      return {
        title,
        options,
        type: guessType(title, options),
        index,
        needOcr: false,
        elementList: optionEls,
        node,
        raw: title,
      };
    },

    /** 下一题按钮 */
    nextButton() {
      return document.querySelector('.next-topic.next-t, .next-topic');
    },
  };

  /**
   * 场景 C：hike 作业/考试（.q_main）
   */
  const HikeQuestions = {
    present() {
      return !!document.querySelector('.q_main, .question-topic');
    },

    collect() {
      const root = document.querySelector('.q_main') || document;
      const nodes = Array.from(root.querySelectorAll('.question-topic, .question-item'));
      return nodes.map((n, i) => {
        const container = n.closest('.question-item, .q_item, .question') || n.parentElement;
        hydrateImages(n);
        const title = readText(n);
        const typeText = container ? ((container.querySelector('.question_score, .question-type') || {}).textContent || '') : '';
        const optionEls = container ? Array.from(container.querySelectorAll('label')) : [];
        const options = optionEls.map((o) => readText(o));
        return {
          title,
          options,
          type: guessType(typeText + ' ' + title, options),
          index: i,
          needOcr: false,
          elementList: optionEls,
          node: container,
          raw: title,
        };
      });
    },
  };

  const Questions = {
    TYPE,
    BANK_TYPE,
    guessType,
    hydrateImages,
    hasImage,
    Dialog: DialogQuestions,
    Homework: HomeworkQuestions,
    Hike: HikeQuestions,

    /** 自动判断当前是什么场景 */
    scene() {
      if (DialogQuestions.present()) return 'dialog';
      if (/dohomework|doexamination/.test(location.href)) return 'homework';
      if (/answer-homework|answer-exam/.test(location.href)) return 'hike';
      if (HomeworkQuestions.present()) return 'homework';
      if (HikeQuestions.present()) return 'hike';
      return null;
    },

    /** 按场景采集 */
    collect() {
      const s = this.scene();
      if (s === 'dialog') return DialogQuestions.collect();
      if (s === 'homework') return HomeworkQuestions.collect();
      if (s === 'hike') return HikeQuestions.collect();
      return [];
    },
  };

  ZHS.Questions = Questions;
})();

/* ===== 09-bank.js ===== */
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

/* ===== 10-llm.js ===== */
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
      timeout: CALL_TIMEOUT_MS,
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

/* ===== 11-solver.js ===== */
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

/* ===== 12-filler.js ===== */
/**
 * 回填层：把答案填进页面控件，并校验是否真的填上
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod12_filler) return;
  ZHS.__mod12_filler = true;
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

/* ===== 13-answerer.js ===== */
/**
 * 答题编排层：把「采集 → 求解 → 回填」串成完整流程
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod13_answerer) return;
  ZHS.__mod13_answerer = true;
  const U = ZHS.Util;

  const Answerer = {
    _running: false,
    _answeredSig: '',       // 已成功作答完成的弹题签名（去重跳过用）
    _noSelfCheckSig: '',    // round-10 A3：上一轮判定「点击未生效/无法自检」的题签名
    _noSelfCheckUntil: 0,   // round-10 A3：该判定的节流截止时间
    _giveUpSigs: null,      // round-13：已放弃处理的弹窗签名集合（关不掉/非标准答题），避免每轮死磕关闭刷屏
    _skippedSigs: null,     // 无通道已跳过的弹题签名集合
    _lastSkipWarnAt: 0,     // 跳过告警节流时间戳
    _failCount: 0,          // 同一弹题连续处理失败次数
    _cooldownUntil: 0,      // 退避截止时间戳
    _pendingHuman: false,   // 本题未答上/关不掉 → 等人工，期间不再自动关闭和反复告警

    /**
     * 弹题处理（课中）
     * @param opts.manual 手动触发（面板「答题」按钮）：绕过 autoAnswer 配置，用户点了就答
     */
    async handleDialog(opts) {
      const manual = !!(opts && opts.manual);
      if (this._running) return;
      if (!manual && !ZHS.config.autoAnswer) return;   // 手动模式绕过配置

      // 退避期内不重试作答（防止关闭失败导致死循环作答）。
      // 但退避 ≠ 卡死：主循环会走 forceCloseDialog() 直接关弹窗恢复播放。
      if (!manual && Date.now() < this._cooldownUntil) {
        ZHS.Log.debug('弹题处理处于退避期，跳过作答（还剩 '
          + Math.ceil((this._cooldownUntil - Date.now()) / 1000) + ' 秒）');
        return;
      }

      const root = ZHS.Questions.Dialog.root();
      if (!root) {
        // 弹窗已消失（人工答完/平台收走）→ 复位待人工标记，让下一道题正常走流程
        this._pendingHuman = false;
        // round-8 A1：弹窗消失即解除退避，否则退避期内新弹题会被跳过且不答（旧题卡死新题）
        this._cooldownUntil = 0;
        if (this._giveUpSigs) this._giveUpSigs = new Set(); // round-13：弹窗消失，重置放弃集合，下一题可正常处理
        return;
      }

      // 防止同一份弹题重复处理（用题干+选项拼接作签名）。
      // 手动触发例外：用户主动点了「答题」按钮，即使签名没变也必须重试，
      // 否则按钮看起来就是「点了没反应」。
      const snapshot = ZHS.Questions.Dialog.collect();
      const sig = JSON.stringify(snapshot.map((s) => s.title)).slice(0, 200);
      // round-13：本题已放弃处理（非标准 A/B 简单答题，自动随机选都没猜对）。
      // 直接跳过，不再每轮死磕关闭刷屏；弹窗消失后（handleDialog 的 !root 分支）会自动清空放弃集合。
      if (this._giveUpSigs && this._giveUpSigs.has(sig)) {
        ZHS.Log.debug('本题已放弃处理（非标准 A/B 答题，自动未猜对），跳过检测');
        return;
      }
      // 已成功作答完成的弹题才去重跳过；无通道/未答上的弹题仍需每轮重试关闭（避免卡死）
      if (!manual && sig && sig === this._answeredSig) {
        ZHS.Log.debug('弹题已作答完成，跳过重复处理');
        return;
      }
      this._running = true;
      try {
        const before = ZHS.state.answeredCount;
        ZHS.Log.info('检测到课中弹题，开始自动作答' + (manual ? '（手动触发）' : ''));
        await this._answerDialog(root, sig);

        // 用户手动点了「答题」却一题都没答——最常见的原因是没有可用答题通道
        // （未填 API Key / 题库查不到）。此时按策略不该瞎蒙，但必须给用户反馈，
        // 否则按钮看起来就是「点了没反应」。
        if (manual && ZHS.state.answeredCount === before) {
          const skipped = ZHS.Solver && Number(ZHS.Solver.stats.skipped) > 0;
          const reason = skipped
            ? '没有可用答题通道（未配置大模型密钥，或题库查不到）'
            : '未能识别到题目或选项';
          ZHS.Log.warn('手动答题未产生作答：' + reason);
          if (ZHS.panel) {
            ZHS.panel.alert(
              reason + '，已跳过本题未作答（瞎蒙会错答拉分）。'
              + '请在设置页填写大模型 API Key 并点「保存」。',
              'warn', 10000
            );
          }
        }
      } catch (e) {
        ZHS.Log.error('弹题处理失败：' + (e && e.message));
      } finally {
        this._running = false;
      }
    },

    /**
     * 退避期兜底（用户需求：「不要停住」）：
     * 不作答，直接尝试关闭弹窗并恢复播放，保证流程永不卡死。
     * 由调度器守卫在退避期内调用。
     */
    async forceCloseDialog() {
      const Q = ZHS.Questions.Dialog;
      if (!Q.stillPresent()) return true;
      const ok = Q.close();
      await U.sleep(700);
      if (!Q.stillPresent()) {
        ZHS.Log.info('退避期内已直接关闭弹题，恢复播放');
        this._resumePlay();
        return true;
      }
      return false;
    },

    async _answerDialog(root, sig) {
      // 每次处理新弹题都重置「无通道/无法自检」标记，避免上一题的状态污染本题
      this._noChannelThisRound = false;
      this._noSelfCheck = false;

      // round-13：识别「非标准 A/B 简单答题」弹窗（如 .el-dialog 容器，标准题面/选项均识别不到）。
      // 这类弹窗是「选对才能关」的简单 A/B 题，平台不按标准课中弹题结构渲染，
      // 强行点 .el-dialog__close 三次全失败、刷屏卡死。直接走随机选 A/B 专用逻辑，不进标准求解。
      const qSnap = (ZHS.Questions.Dialog.readCurrent && ZHS.Questions.Dialog.readCurrent(root)) || null;
      const nonStandardOpts = (qSnap && qSnap.options) || [];
      if (!nonStandardOpts.length) {
        await this._tryNonStandardAB(root, sig);
        return;
      }

      // round-10 A3：上一轮已判定本题「点击未生效/无法自检」，在节流期内直接尝试关闭恢复，
      // 跳过 ZHS.Solver.solve 重复重作答，避免反复求解刷屏；节流到期后再恢复重试。
      if (sig && sig === this._noSelfCheckSig && Date.now() < this._noSelfCheckUntil) {
        ZHS.Log.info('本题已判定无法自检，节流期内直接尝试关闭并恢复播放（跳过重复重作答）');
        const ok = await this.closeDialogAndResume({ noChannel: true });
        if (!ok) { this._resumePlay(); this._throttledSkipWarn(sig); }
        return;
      }
      const pages = Array.from(root.querySelectorAll('.el-pager .number'));
      let anyAnswered = false;
      let allAnswered = false;   // round-9 A2：多页弹题需全部页都答上才算完整完成

      if (!pages.length) {
        // 单页弹题
        anyAnswered = await this._solveCurrentPage(root);
        allAnswered = anyAnswered;
      } else {
        // 多页：逐页切换作答
        let every = true;
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          if (!page.classList.contains('active')) {
            page.click();
            await U.sleep(600);
          }
          const pageAnswered = await this._solveCurrentPage(root);
          anyAnswered = anyAnswered || pageAnswered;
          if (!pageAnswered) every = false;   // round-9 A2：任一页未答上 → 整体未完成
        }
        allAnswered = every;
      }

      await U.sleep(500);

      // N4：按配置决定是否自动关闭弹题
      if (ZHS.config.autoCloseDialog === false) {
        ZHS.Log.info('已作答完成（自动关闭已关闭，请手动关闭弹题）');
        this._answeredSig = sig || '';   // 标记已作答，避免下一轮因签名变化反复点击取消已选项
        return;
      }

      // 核心修复（平台规则：未作答的弹题不能关闭）：
      // 只有本题**实际作答成功**（选项真的被选中）才尝试自动关闭；
      // 没答上就硬关只会被平台弹「未作答的弹题不能关闭」拒绝，
      // 然后脚本陷入「关不掉 → 退避 → 再关」的死循环骚扰。
      // 没答上时正确做法：保留弹窗交给用户手动作答，脚本安静等待。
      if (!anyAnswered) {
        // 区分「无通道（无法自检）」与「有通道但选项点击未生效」：
        // 无通道 / 点击后环境无法自检选中态 → 按"默认视为已作答"尝试关闭弹窗，
        // 平台拒绝未作答会回弹；此时【不转人工卡死】，恢复播放并继续，
        // 下一轮主循环仍会重试关闭（节流告警），符合用户「不要停住」要求。
        // 只有「明确有通道、点击也执行了、但选项就是选不中」才转人工。
        if (this._noChannelThisRound || this._noSelfCheck) {
          // round-10 A3：记录本题为「无法自检/无通道」，下一轮节流跳过重复重作答
          this._noSelfCheckSig = sig || '';
          this._noSelfCheckUntil = Date.now() + 30000;
          const ok = await this.closeDialogAndResume({ noChannel: true });
          if (ok) {
            this._answeredSig = sig || '';
            if (this._skippedSigs) this._skippedSigs.delete(sig || '');
          } else {
            // 平台禁止关闭未作答弹窗：不暂停、不卡死，恢复播放并继续，稍后重试
            this._resumePlay();
            this._throttledSkipWarn(sig);
          }
        } else {
          this._pendingHuman = true;
          ZHS.Log.warn('本题有通道但选项点击未生效，平台不允许关闭未作答弹窗，已交由人工处理');
          if (ZHS.panel) {
            ZHS.panel.alert('这题有通道但没选上：请手动选择答案，弹窗会保留等你作答（作答后可正常关闭）', 'warn', 10000);
          }
        }
        return;
      }
      // round-9 A2：多页弹题若只有部分页答上，不标记完整完成，避免剩余页被永久跳过。
      // 无通道/无法自检 → 尝试关闭已答页并恢复播放，下一轮回来补答剩余页（不置 _answeredSig）；
      // 有通道但部分页点不上 → 转人工保留弹窗补全。
      if (!allAnswered) {
        if (this._noChannelThisRound || this._noSelfCheck) {
          // round-10 A3：记录本题为「无法自检/无通道」，下一轮节流跳过重复重作答
          this._noSelfCheckSig = sig || '';
          this._noSelfCheckUntil = Date.now() + 30000;
          const ok = await this.closeDialogAndResume({ noChannel: true });
          if (!ok) { this._resumePlay(); this._throttledSkipWarn(sig); }
          // 注意：不置 _answeredSig，下一轮 handleDialog 回来继续补答剩余页
        } else {
          this._pendingHuman = true;
          ZHS.Log.warn('多页弹题部分页未答上，已交由人工处理');
          if (ZHS.panel) {
            ZHS.panel.alert('这题有多页，部分还没选上：请手动补全剩余页，弹窗保留等你作答', 'warn', 10000);
          }
        }
        return;
      }
      this._answeredSig = sig || '';   // 标记已作答完成（全部页都已答上），后续轮次去重跳过
      await this.closeDialogAndResume();
    },

    /**
     * round-13：处理「非标准 A/B 简单答题」弹窗（标准题面/选项识别不到，如 .el-dialog 容器）。
     * 策略：在弹窗内按 A/B 文本或通用选项结构随机选一个点击一次 → 尝试关闭；
     * 选对就关掉恢复播放；选错（需选对才能关）或结构不符导致关不掉 → 放弃本题，
     * 加入 _giveUpSigs（后续轮次跳过，不再刷屏），并面板提示用户手动选 A 或 B。
     */
    async _tryNonStandardAB(root, sig) {
      ZHS.Log.info('round-13：识别到非标准 A/B 简单答题（标准选项识别不到），尝试随机选 A/B');
      // 在弹窗内查找看起来像 A/B 选项的可点击元素（兜底多种结构）
      const optSel = 'li, label, .el-radio, .el-checkbox, [role="radio"], [role="option"], .option-item, .choice-item, .answer-option';
      let opts = Array.from(root.querySelectorAll(optSel)).filter((el) => {
        const t = (el.textContent || '').replace(/\s+/g, '').toLowerCase();
        return /^([ab][.、:：]?|是|否|对|错|正确|错误|√|×)/.test(t);
      });
      if (!opts.length) {
        // 退一步：直接取弹窗内前两个可点选项（不强制 A/B 文本）
        opts = Array.from(root.querySelectorAll(optSel)).slice(0, 2);
      }
      if (!opts.length) {
        // 连选项元素都找不到 → 直接放弃，提示用户手动选
        if (this._giveUpSigs) this._giveUpSigs.add(sig);
        this._pendingHuman = true;
        if (ZHS.panel) ZHS.panel.alert('检测到选对才能关的简单 A/B 题，但自动找不到选项，请手动选 A 或 B', 'warn', 10000);
        ZHS.Log.warn('round-13：非标准 A/B 答题找不到选项元素，放弃自动处理，提示用户手动选');
        return;
      }
      // 随机选 A 或 B 之一点一次
      const idx = opts.length > 1 ? (Math.random() < 0.5 ? 0 : 1) : 0;
      const pick = opts[idx];
      try { pick.click(); } catch (e) { /* 点击异常不影响后续关闭尝试 */ }
      await U.sleep(400);
      const ok = await this.closeDialogAndResume({ noChannel: true });
      if (ok) {
        this._answeredSig = sig || '';
        ZHS.Log.info('round-13：随机选 A/B 成功关闭弹窗，恢复播放');
      } else {
        // 选错（需选对才能关）或结构不符 → 放弃本题，提示用户手动选 A 或 B
        if (this._giveUpSigs) this._giveUpSigs.add(sig);
        this._pendingHuman = true;
        if (ZHS.panel) ZHS.panel.alert('这是选对才能关的简单 A/B 题，自动没猜对，请手动选 A 或 B', 'warn', 10000);
        ZHS.Log.warn('round-13：随机选 A/B 仍未关闭（需选对才能关），放弃自动处理，提示用户手动选');
        this._resumePlay();
      }
    },

    /**
     * 关闭弹题并恢复播放（N4 需求）
     * 策略：点关闭 → 校验是否真关了 → 没关就重试（最多 3 次，每次间隔递增）
     */
    async closeDialogAndResume(opts) {
      const noChannel = !!(opts && opts.noChannel);
      const Q = ZHS.Questions.Dialog;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const ok = Q.close();
        await U.sleep(700 * attempt);

        if (!Q.stillPresent()) {
          ZHS.Log.info('弹题已关闭' + (attempt > 1 ? '（第 ' + attempt + ' 次尝试）' : ''));
          this._failCount = 0;
          this._cooldownUntil = 0;
          this._pendingHuman = false;
          this._resumePlay();
          return true;
        }
        ZHS.Log.warn('弹题关闭失败，重试第 ' + attempt + ' 次');
      }

      this._failCount++;
      // 无通道场景：不转人工卡死主循环，交由调用方（_answerDialog）恢复播放并继续重试。
      if (noChannel) return false;

      // 有通道场景（明确需要人工）：平台大概率是因为「未作答」拒绝关闭，
      // 退避 30s 防反复骚扰，明确告知用户手动作答，脚本安静等待，弹窗消失后自动复位。
      this._cooldownUntil = Date.now() + 30 * 1000;   // 退避 30s，防关不掉的弹窗反复骚扰
      this._pendingHuman = true;
      ZHS.Log.warn('弹题自动关闭失败（累计 ' + this._failCount + ' 次），已转人工：请手动作答或关闭弹窗');
      if (ZHS.panel) {
        ZHS.panel.alert('弹窗关不掉？多半是还没作答——请手动选好答案，脚本会继续等你', 'warn', 10000);
      }
      return false;
    },

    /** 无通道时跳过弹题的节流告警：每 30s 最多提示一次，避免刷屏 */
    _throttledSkipWarn(sig) {
      const now = Date.now();
      if (this._lastSkipWarnAt && now - this._lastSkipWarnAt < 30000) return;
      this._lastSkipWarnAt = now;
      if (!this._skippedSigs) this._skippedSigs = new Set();
      if (sig) this._skippedSigs.add(sig);
      ZHS.Log.warn('本题无答题通道（未配置大模型密钥或题库查不到），平台又不许关闭未作答弹题，已尝试跳过并继续播放；配置密钥后可在设置页开启自动答题');
      if (ZHS.panel) {
        ZHS.panel.alert('本题无答题通道，已尝试跳过并继续播放；如需自动作答请在设置页填写大模型 API Key', 'warn', 10000);
      }
    },

    /** 恢复播放（弹题处理完后） */
    _resumePlay() {
      try {
        const v = ZHS.Player && ZHS.Player.video();
        if (!v) return;
        const cfg = ZHS.config;
        if (cfg.mute) ZHS.Player.mute(v);
        ZHS.Player.setSpeed(v, cfg.speed);
        if (v.paused) {
          const p = v.play();
          if (p && p.catch) p.catch(() => { /* 自动播放策略拦截，忽略 */ });
          ZHS.Log.info('弹题关闭后已恢复播放');
        }
      } catch (e) {
        ZHS.Log.debug('恢复播放异常：' + e.message);
      }
    },

    /**
     * 求解并作答当前分页
     * @returns {boolean} 是否**实际作答成功**（选项真的被选中，经 isChecked 自检）
     */
    async _solveCurrentPage(root) {
      const q = ZHS.Questions.Dialog.readCurrent(root);
      if (!q || !q.options.length) {
        ZHS.Log.debug('当前分页无选项，跳过');
        return false;
      }

      ZHS.Log.info('弹题：' + (q.title || '(无题干)').slice(0, 60) + ' 选项 ' + q.options.length + ' 个');

      const result = await ZHS.Solver.solve({
        title: q.title,
        options: q.options,
        type: q.type,
      });
      if (!result) { this._noChannelThisRound = true; return false; }

      let answered = false;
      // 弹题的选项按钮在 .topic .radio ul > li，按索引点击
      const idxs = ZHS.Bank.toIndexes(result.answer);
      if (idxs.length) {
        for (const idx of idxs) {
          const flex = q.elementList[idx] ||
            root.querySelector('.topic .radio ul > li:nth-child(' + (idx + 1) + ')');
          if (flex) {
            flex.click();
            await U.sleep(600);
            // 自检：点击后确认选项真的处于选中态。查不到选中就当作没答上
            // （宁可交给人工，也不能让脚本以为答完了去关一个平台不认的弹窗）
            if (ZHS.Filler.isChecked(flex)) {
              answered = true;
              ZHS.state.answeredCount++;
              ZHS.Log.info('已作答：' + result.answer + '（来源 ' + result.from + '）');
            } else {
              this._noSelfCheck = true;
              ZHS.Log.warn('选项点击后未检测到选中态（环境无法自检），按默认视为已作答处理');
            }
          }
        }
      } else if (q.type === 'completion' || q.type === 'qa' || q.type === 'judgement') {
        const ok = await ZHS.Filler.fill(
          { type: q.type, elementList: q.elementList, node: root },
          result
        );
        if (ok.ok) {
          answered = true;
          ZHS.state.answeredCount++;
          ZHS.Log.info('已作答（文本）：' + result.answer);
        }
      }
      return answered;
    },

    /**
     * 作业/考试页处理
     * @param opts.manual 手动触发：绕过 autoAnswer / answerHomework 配置
     */
    async handleHomework(opts) {
      const manual = !!(opts && opts.manual);
      if (!manual && (!ZHS.config.autoAnswer || !ZHS.config.answerHomework)) return;
      if (this._running) return;

      const scene = ZHS.Questions.scene();
      if (scene !== 'homework' && scene !== 'hike') return;

      const list = ZHS.Questions.collect();
      if (!list.length) return;

      const unanswered = list.filter((q) => !this._isAnswered(q));
      if (!unanswered.length) {
        ZHS.Log.info('作业页所有题目都已作答');
        return;
      }

      this._running = true;
      try {
        ZHS.Log.info('作业页共 ' + list.length + ' 题，待答 ' + unanswered.length + ' 题');
        for (const q of unanswered) {
          // eslint-disable-next-line no-await-in-loop
          const result = await ZHS.Solver.solve(q);
          if (!result) continue;
          // eslint-disable-next-line no-await-in-loop
          const filled = await ZHS.Filler.fill(q, result);
          if (filled.ok) {
            ZHS.state.answeredCount++;
            ZHS.Log.info('第 ' + (q.index + 1) + ' 题已作答：' + result.answer + '（' + result.from + '）');
          } else {
            ZHS.Log.warn('第 ' + (q.index + 1) + ' 题回填失败');
          }
          const d = Number(ZHS.config.answerDelay) || 0;
          // eslint-disable-next-line no-await-in-loop
          if (d > 0) await U.sleep(d * 1000);
        }
        ZHS.Log.info('作业页作答完成');
      } finally {
        this._running = false;
      }
    },

    /** 判断题目是否已作答 */
    _isAnswered(q) {
      const list = q.elementList || [];
      if (!list.length) {
        // 填空题：看输入框有没有值
        const node = q.node || document;
        const ta = node.querySelector && node.querySelector('textarea, input[type="text"]');
        return !!(ta && ta.value && ta.value.trim());
      }
      return list.some((el) => ZHS.Filler.isChecked(el));
    },

    /** 重置弹题签名（切课后调用） */
    reset() {
      this._answeredSig = '';
      this._noSelfCheckSig = '';
      this._noSelfCheckUntil = 0;
      this._skippedSigs = new Set();
      this._lastSkipWarnAt = 0;
      this._failCount = 0;
      this._cooldownUntil = 0;
      this._pendingHuman = false;
      this._giveUpSigs = new Set();   // round-13：已放弃的非标准弹窗签名集合
    },
  };

  ZHS.Answerer = Answerer;
})();

})();
