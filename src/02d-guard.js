/**
 * 全局防卡死看门狗（round-34）
 *
 * 解决「整体无进展、但各单点触发器都没命中」的盲区 —— 这是「希望不要被卡住」的最后一道防线。
 *
 * 现有单点防护（已存在）：
 *   · Player.checkStall        —— 视频 currentTime 120s 不推进 → 唤醒
 *   · ZERO_PROGRESS_GIVEUP_MS  —— 平台进度持续 0% 超 3min → 停手交人
 *   · pendingHop 看门狗        —— 课程中心进入请求 5min 未落地 → 标失败
 *   · tryResumeAfterTransientStop —— DOM 变化后瞬时故障自愈
 *
 * 但仍有盲区：
 *   · 检测层返回空/错目录 → breakdown 误报 allDone → 看似「正常结束」，实则卡在假完成；
 *   · 视频被平台缓冲卡住、currentTime 不前进，但 checkStall 反复唤醒、视频又不是 0% → 两端都不触发；
 *   · SPA 静默把目录节点换掉但 courseId 没变 → adapter 缓存陈旧，findNext 永远指向旧节点。
 *
 * 本模块：心跳每 HEARTBEAT_MS 采样一次「进展指纹」（已完成节数 + 当前视频进度 + currentTime），
 * 指纹无变化即视为停滞。按停滞时长分四级逐级升级，每次升级都刷新基准避免重复升级：
 *   T1（STUCK_T1）：重探测页面版本 + 清目录缓存（重新识别 / 补全虚拟滚动目录）；
 *   T2（STUCK_T2）：强制续播唤醒（Player.ensurePlaying）+ 重新对账；
 *   T3（STUCK_T3）：尝试跳到下一节（Scheduler.gotoNext）；
 *   T4（STUCK_T4）：标记瞬时停摆交人（Scheduler.stop('transient')），绝不静默无限挂起。
 *
 * 设计约束（与测试/工程兼容）：
 *   · 仅在 ZHS.state.running 时续排下一拍；停止后不残留定时器（否则 node 测试进程挂起）。
 *   · 自身绝不抛错影响主流程；所有外部调用 try/catch 包裹。
 *   · 由 Scheduler.start/stop 负责启停（见 05-scheduler.js），不在本模块自启动。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器叠加
  if (ZHS.__mod02d_guard) return;
  ZHS.__mod02d_guard = true;

  const HEARTBEAT_MS = 60000;          // 心跳间隔
  const STUCK_T1 = 4 * 60 * 1000;     // 4 分钟无进展 → 重探测
  const STUCK_T2 = 8 * 60 * 1000;     // 8 分钟 → 唤醒续播
  const STUCK_T3 = 12 * 60 * 1000;    // 12 分钟 → 跳下一节
  const STUCK_T4 = 16 * 60 * 1000;    // 16 分钟 → 交人

  const Guard = {
    _timer: null,
    _lastProgressAt: 0,
    _fp: null,            // 上一次进展指纹
    _tier: 0,             // 已升到的级别（0=未升级），避免同级别重复升级

    start() {
      if (this._timer) return;
      this._lastProgressAt = Date.now();
      this._fp = null;
      this._tier = 0;
      this._loop();
    },

    stop() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    },

    _loop() {
      // 自调度：仅当主循环仍在运行时续排下一拍；停止后不残留定时器
      this._timer = setTimeout(() => {
        try { this._tick(); } catch (e) { /* 看门狗自身绝不能抛错 */ }
        if (ZHS.state && ZHS.state.running) this._loop();
        else this._timer = null;
      }, HEARTBEAT_MS);
    },

    /** 采样进展指纹：已完成节数 + 当前视频进度 + currentTime */
    _sample() {
      let done = -1, pct = -1, cur = -1;
      try {
        const cat = ZHS.Catalog;
        if (cat && cat.stats) done = cat.stats().done;
      } catch (e) { done = -1; }
      try {
        const v = (ZHS.Player && ZHS.Player.video) ? ZHS.Player.video() : null;
        if (v) { pct = ZHS.Player.percent(v); cur = Math.round(v.currentTime || 0); }
      } catch (e) { /* 忽略 */ }
      return done + '#' + pct + '#' + cur;
    },

    _tick() {
      if (!ZHS.state || !ZHS.state.running) return;
      const fp = this._sample();
      const now = Date.now();
      // 指纹变化 → 确有进展，刷新基准并复位升级级别
      if (fp !== this._fp) {
        this._fp = fp;
        this._lastProgressAt = now;
        this._tier = 0;
        return;
      }
      const stuck = now - this._lastProgressAt;
      if (stuck < STUCK_T1) return;     // 还没到第一级，继续观察

      // —— 逐级升级，每级只触发一次（靠 _tier 防重）；升级后给本级别一段观察窗口 ——
      if (this._tier < 1 && stuck >= STUCK_T1) {
        this._tier = 1;
        this._lastProgressAt = now;
        ZHS.Log.warn('[防卡死 T1] 已 ' + Math.round(stuck / 1000) + 's 无进展，重新探测页面版本并清目录缓存');
        try { if (ZHS.Catalog && ZHS.Catalog.redetect) ZHS.Catalog.redetect(); } catch (e) {}
        try { if (ZHS.Catalog && ZHS.Catalog.resetCatalogCache) ZHS.Catalog.resetCatalogCache(); } catch (e) {}
        return;
      }
      if (this._tier < 2 && stuck >= STUCK_T2) {
        this._tier = 2;
        this._lastProgressAt = now;
        ZHS.Log.warn('[防卡死 T2] 已 ' + Math.round(stuck / 1000) + 's 无进展，强制唤醒续播');
        try {
          const v = (ZHS.Player && ZHS.Player.video) ? ZHS.Player.video() : null;
          if (v && ZHS.Player.ensurePlaying) ZHS.Player.ensurePlaying(v);
          if (ZHS.Player && ZHS.Player.resetSync) ZHS.Player.resetSync();
        } catch (e) {}
        return;
      }
      if (this._tier < 3 && stuck >= STUCK_T3) {
        this._tier = 3;
        this._lastProgressAt = now;
        ZHS.Log.warn('[防卡死 T3] 已 ' + Math.round(stuck / 1000) + 's 无进展，尝试跳到下一节');
        try { if (ZHS.Scheduler && ZHS.Scheduler.gotoNext) ZHS.Scheduler.gotoNext('guard', { manual: true }); } catch (e) {}
        return;
      }
      if (this._tier < 4 && stuck >= STUCK_T4) {
        this._tier = 4;
        this._lastProgressAt = now;
        ZHS.Log.error('[防卡死 T4] 已 ' + Math.round(stuck / 1000) + 's 无任何进展，标记瞬时停摆交人处理（不再静默挂起）');
        try { if (ZHS.Scheduler && ZHS.Scheduler.stop) ZHS.Scheduler.stop('transient'); } catch (e) {}
        return;
      }
    },
  };

  ZHS.Guard = Guard;
})();
