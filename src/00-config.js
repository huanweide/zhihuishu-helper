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
