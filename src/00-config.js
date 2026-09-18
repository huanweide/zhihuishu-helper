/**
 * 智慧树网课助手 —— 全局配置与共享状态
 *
 * 所有模块共享一个 ZHS 命名空间对象，避免污染页面全局。
 */
(function () {
  'use strict';

  if (window.__ZHS_HELPER__) return;

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

    const cfg = Object.assign({}, DEFAULTS, saved);

    // 跨版本迁移：把重要变更项强制拉到新默认，并写回（只跑一次）
    if (Number(saved.configRev || 0) < CONFIG_REV) {
      for (const key of Object.keys(FORCE_UPGRADE)) cfg[key] = FORCE_UPGRADE[key];
      cfg.configRev = CONFIG_REV;
      store(cfg);
    }
    return cfg;
  }

  function saveConfig(patch) {
    const next = Object.assign(getConfig(), patch || {});
    // 倍速硬夹逼
    next.speed = Math.min(Math.max(Number(next.speed) || 1, 0.5), 1.8);
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
      LOG_BUFFER.push(entry);
      if (LOG_BUFFER.length > MAX_LOG) LOG_BUFFER.shift();
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

  const ZHS = {
    // 版本号只认 package.json（build.js 会注入 __ZHS_VERSION__）。
    // 此处不再硬编码，避免与 package.json 漂移（历史遗留的 '0.3.0' 就是这么来的）。
    version: (typeof __ZHS_VERSION__ !== 'undefined' ? __ZHS_VERSION__ : '0.0.0'),
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
