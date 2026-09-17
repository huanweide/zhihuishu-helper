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
    autoAnswer: false,   // 默认关（需配 Key）
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
    autoCloseDialog: true,// 答完题自动关闭弹题（N4）

    // 通用
    debug: true,         // 控制台详细日志
    panelVisible: true,  // 悬浮面板
    guardOverlays: true, // 弹窗守卫
  };

  // ============ 配置读写（GM 优先，降级 localStorage）============
  const hasGM = typeof GM_setValue === 'function' && typeof GM_getValue === 'function';

  function getConfig() {
    let saved = {};
    try {
      const raw = hasGM ? GM_getValue('zhs-helper-config', null)
                        : localStorage.getItem('zhs-helper-config');
      if (raw) saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) { /* 配置损坏则用默认 */ }
    return Object.assign({}, DEFAULTS, saved);
  }

  function saveConfig(patch) {
    const next = Object.assign(getConfig(), patch || {});
    // 倍速硬夹逼
    next.speed = Math.min(Math.max(Number(next.speed) || 1, 0.5), 1.8);
    try {
      const raw = JSON.stringify(next);
      if (hasGM) GM_setValue('zhs-helper-config', raw);
      else localStorage.setItem('zhs-helper-config', raw);
    } catch (e) { /* 静默失败 */ }
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
    version: '0.2.1',
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
