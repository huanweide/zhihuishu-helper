/**
 * 调度层：主循环 + 弹窗守卫
 *
 * 每 2 秒跑一次：守卫检查 → 保活播放 → 结束判断 → 下一节
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  const U = ZHS.Util;

  // 需要用户手动处理才能继续的遮挡层（验证码）
  const VERIFY_SELECTORS = '.yidun_popup, .yidun_modal, [id^="tcaptcha_transform"]';
  // 弹题遮挡层
  const QUESTION_SELECTORS = '#playTopic-dialog, .topic-title';
  // 其他阻塞弹窗
  const BLOCK_SELECTORS = '.ss2077-custom-dialog';

  const LOOP_INTERVAL = 2000;   // 主循环间隔
  const END_SETTLE_MS = 3000;   // 结束后等平台上报进度的时间

  const Scheduler = {
    _timer: null,
    _busy: false,
    _navigating: false,

    start() {
      if (this._timer) return;
      ZHS.state.running = true;
      this._timer = setInterval(() => this.tick(), LOOP_INTERVAL);
      ZHS.Log.info('主循环已启动');
    },

    stop() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      ZHS.state.running = false;
      ZHS.Log.info('主循环已停止');
    },

    /** 单次循环 */
    async tick() {
      if (this._busy) return;      // 防重入
      this._busy = true;
      try {
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
        await U.waitUntilHidden(VERIFY_SELECTORS);
        ZHS.state.pausedByGuard = false;
        ZHS.Log.info('验证已通过，继续运行');
        return;
      }

      // ===== 守卫 2：弹题 → 暂停并交给答题模块 =====
      if (cfg.guardOverlays && U.hasStructurallyVisible(QUESTION_SELECTORS)) {
        if (video && !video.paused) video.pause();
        if (cfg.autoAnswer && ZHS.Answerer) {
          await ZHS.Answerer.handleDialog();
          // 答完后等弹窗关闭再继续
          await U.waitUntilHidden(QUESTION_SELECTORS, 30000);
          ZHS.Log.debug('弹题已处理，恢复播放');
        } else {
          ZHS.Log.debug('检测到弹题遮挡，等待答题模块处理');
          if (ZHS.panel) ZHS.panel.alert('检测到课中弹题，未开启自动答题', 'warn');
        }
        return;
      }

      // ===== 守卫 3：其他阻塞弹窗 → 尝试关闭 =====
      if (cfg.guardOverlays && U.hasStructurallyVisible(BLOCK_SELECTORS)) {
        const btn = document.querySelector('.ss2077-custom-dialog .close, .ss2077-custom-dialog .btn');
        if (btn) {
          btn.click();
          ZHS.Log.debug('已关闭阻塞弹窗');
        }
        return;
      }

      // ===== 无视频（文档/PPT 节点）→ 直接下一节 =====
      if (!video) {
        if (cfg.autoNext) await this.gotoNext('当前节点无视频');
        return;
      }

      // ===== 正常保活 =====
      ZHS.Player.checkStall(video);

      if (cfg.autoPlay) {
        ZHS.Player.setSpeed(video, cfg.speed);
        if (cfg.mute) ZHS.Player.mute(video);
        await ZHS.Player.ensurePlaying(video);
      }

      // ===== 结束判断 =====
      if (ZHS.Player.atEnd(video)) {
        if (cfg.autoNext) await this.onLessonEnd(video);
      }
    },

    /** 课时结束处理：校验平台进度再决定下一节 */
    async onLessonEnd(video) {
      if (this._navigating) return;
      this._navigating = true;
      try {
        await U.sleep(END_SETTLE_MS);       // 等平台上报

        const cur = ZHS.Catalog.current();
        const progress = cur ? ZHS.Catalog.progressOf(cur) : 0;

        if (progress >= 100) {
          ZHS.Log.info('本课时已完成（平台记录 ' + progress + '%），切换下一节');
          ZHS.Player.resetRetry();
          await this.gotoNext('本课时已完成');
          return;
        }

        // 进度没满 → 回退重播
        const retried = await ZHS.Player.retryFromPlatformProgress(video, progress);
        if (!retried) {
          ZHS.Log.warn('重试次数用尽，强制切换下一节');
          await this.gotoNext('进度同步失败，跳过');
        }
      } finally {
        this._navigating = false;
      }
    },

    /** 切换下一节 */
    async gotoNext(reason) {
      if (this._navigating && reason !== '本课时已完成') return;

      const cfg = ZHS.config;
      const cur = ZHS.Catalog.current();
      const next = ZHS.Catalog.findNext(cur);

      if (!next) {
        ZHS.Log.info('已是最后一节，全部课程完成');
        if (ZHS.panel) ZHS.panel.alert('全部课时已完成', 'info');
        this.stop();
        return;
      }

      // 人类化随机延迟
      const delay = 1 + Math.random() * (cfg.nextDelayMax - cfg.nextDelayMin) + cfg.nextDelayMin;
      ZHS.Log.info('即将切换到「' + ZHS.Catalog.itemTitle(next) + '」，等待 ' + Math.round(delay) + ' 秒');

      await U.sleep(delay * 1000);

      // 记录新课时标识，供续播使用
      ZHS.state.lessonKey = ZHS.Catalog.itemTitle(next);
      ZHS.Catalog.click(next);

      // 重置状态
      ZHS.Player.resetRetry();
      ZHS.Resume.reset();
      if (ZHS.Answerer) ZHS.Answerer.reset();
      ZHS.state.videoEl = null;

      await U.sleep(3000);
      this._rebindAfterNav();
    },

    /** 切课后重新绑定 video */
    async _rebindAfterNav() {
      const video = await U.waitFor('video', 20000);
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
