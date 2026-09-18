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

    /** 取当前 video 元素（缓存 + 校验是否还在文档里） */
    video() {
      const cached = ZHS.state.videoEl;
      if (cached && document.contains(cached)) return cached;
      const v = document.querySelector('video');
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
