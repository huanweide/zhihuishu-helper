/**
 * 在场感知模块（round-58 · 人类化与防检测核心基座）
 *
 * 解决的根问题（用户原话）：「用户不切换不答下一道题」——
 * 你坐在电脑前，脚本就该让权：不抢答、不抢切课、不抢跳下一节；
 * 你切走/挂机（标签隐藏或长时间不动），脚本再接管自动推进。
 *
 * 为什么是反检测的第一道关：
 * 风控识别「机器」最稳的信号之一，就是「页面在自动答题/切课，而用户明明在焦点里」。
 * 真人在场却由脚本代劳，是最扎眼的自动化指纹。把「在场=让权」焊死后，
 * 脚本只在你离开时才动 —— 这与「挂机托管」的真实使用场景完全一致，反而最不像机器。
 *
 * 判定口径（可配置）：
 *   isUserPresent() = yieldToUser 开 且 标签页聚焦 且 近 userIdleSec 秒内有任何活动。
 *   隐藏标签页 / 静默超时 → 视为离场（挂机/切走），脚本恢复自动。
 *
 * 注意：本模块只做「感知」，不做「动作」。所有让权/接管决策都由调度器与答题器读它。
 * 监听是 passive、全 passive，绝不阻塞页面事件。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免监听器叠加
  if (ZHS.__mod15_presence) return;
  ZHS.__mod15_presence = true;

  let _lastActivityAt = Date.now();
  let _focused = true;
  let _bound = false;

  function markActivity() { _lastActivityAt = Date.now(); }
  function onVisibility() {
    _focused = !document.hidden;
    if (_focused) markActivity();   // 切回标签即视为一次活动（用户在看）
  }
  function onFocus() { _focused = true; markActivity(); }
  function onBlur() { _focused = false; }

  function bind() {
    if (_bound) return;
    _bound = true;
    // 用户「在场」的任何活动都算：鼠标移动/点击、键盘、滚动、滚轮、触摸。
    // 这些是真人看课时必然零星发生的动作；脚本自动答题则几乎零交互 —— 形成可区分指纹。
    const evs = ['mousemove', 'mousedown', 'keydown', 'click', 'scroll', 'wheel', 'touchstart', 'touchmove'];
    for (const e of evs) {
      try { window.addEventListener(e, markActivity, { passive: true }); } catch (_) { /* 忽略 */ }
    }
    try { document.addEventListener('visibilitychange', onVisibility); } catch (_) { /* 忽略 */ }
    try { window.addEventListener('focus', onFocus); } catch (_) { /* 忽略 */ }
    try { window.addEventListener('blur', onBlur); } catch (_) { /* 忽略 */ }
    // 初始聚焦态：以当前页面是否可见为准
    try { _focused = !document.hidden; } catch (_) { _focused = true; }
  }

  const Presence = {
    /** 绑定监听（调度器 start 时调用一次，幂等） */
    bind,

    /** 最近一次用户活动时刻（ms） */
    get lastActivityAt() { return _lastActivityAt; },
    /** 标签页当前是否聚焦 */
    get focused() { return _focused; },

    /**
     * 用户是否「在场」：脚本应让权（不代劳）。
     * @returns {boolean}
     */
    isUserPresent() {
      const cfg = ZHS.config;
      if (!cfg.yieldToUser) return false;            // 开关关 → 永不让权（全程自动，老行为）
      if (!_focused) return false;                   // 切到别的标签/窗口 → 离场（挂机接管）
      const idleMs = Date.now() - _lastActivityAt;
      const idleSec = Number(cfg.userIdleSec) || 90;
      if (idleMs >= idleSec * 1000) return false;    // 静默超时 → 视为离场（人走开了）
      return true;
    },

    /** 是否处于「让权」态（在场且开关开）——调度器/答题器统一问这个 */
    shouldYield() { return this.isUserPresent(); },

    /** 调试快照（面板/排查用） */
    snapshot() {
      return {
        focused: _focused,
        idleSec: Math.round((Date.now() - _lastActivityAt) / 1000),
        present: this.isUserPresent(),
      };
    },
  };

  ZHS.Presence = Presence;
})();
