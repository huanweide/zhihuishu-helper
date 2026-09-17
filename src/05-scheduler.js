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
    _navCount: 0,          // 本次已切换课时数

    start() {
      if (this._timer) return;
      ZHS.state.running = true;
      ZHS.state.startedAt = Date.now();   // 每次启动重置计时
      this._navCount = 0;
      this._timer = setInterval(() => this.tick(), LOOP_INTERVAL);
      ZHS.Log.info('主循环已启动');
      this.preflight();                   // 启动即做一次全量体检（N1）
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
          // Answerer 内部已含「作答 → 关闭 → 恢复播放 → 失败退避」完整链路
          await ZHS.Answerer.handleDialog();
          if (ZHS.Questions.Dialog.stillPresent()) {
            if (ZHS.config.autoCloseDialog === false) {
              // 用户主动关闭了自动关弹题：等人工处理，不空转
              ZHS.Log.debug('弹题仍在（自动关闭已关闭），等待手动处理');
            } else {
              // 自动关闭失败：短等，避免长时间阻塞主循环（退避由 Answerer 负责）
              await U.waitUntilHidden(QUESTION_SELECTORS, 15000);
            }
          }
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
      const cat = ZHS.Catalog;

      // 先看全目录还剩多少没完成
      const bd = cat.breakdown();
      // skipFinished 关闭时：不主动跳课，按顺序走（已完成也停一下，便于人工核对）
      const next = cfg.skipFinished === false
        ? this._nextInOrder(cur, cat)
        : cat.findNext(cur);

      if (!next) {
        if (bd.undone === 0) {
          // 真正全看完 → 出总结并停止
          await this.finishAll(reason);
        } else {
          // 有未完成但找不到（状态识别可能有偏差），停手让人看
          ZHS.Log.warn('还有 ' + bd.undone + ' 节未完成，但无法定位到可点击节点（可能被锁定或选择器不匹配）');
          if (ZHS.panel) ZHS.panel.alert('还有 ' + bd.undone + ' 节未完成但定位失败，请检查目录', 'warn');
          this.stop();
        }
        return;
      }

      // 人类化随机延迟
      const delay = 1 + Math.random() * (cfg.nextDelayMax - cfg.nextDelayMin) + cfg.nextDelayMin;
      ZHS.Log.info('即将切换到「' + cat.itemTitle(next) + '」，等待 ' + Math.round(delay) + ' 秒'
        + '（剩余未完成 ' + bd.undone + ' 节）');

      await U.sleep(delay * 1000);

      // 记录新课时标识，供续播使用
      ZHS.state.lessonKey = cat.itemTitle(next);
      cat.click(next);
      this._navCount++;

      // 重置状态
      ZHS.Player.resetRetry();
      ZHS.Resume.reset();
      if (ZHS.Answerer) ZHS.Answerer.reset();
      ZHS.state.videoEl = null;

      await U.sleep(3000);
      this._rebindAfterNav();
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
      const st = ZHS.Solver ? ZHS.Solver.stats : { bank: 0, llm: 0, cache: 0, fail: 0 };
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
        已答题数: ZHS.state.answeredCount,
        答题通道: '题库 ' + st.bank + ' / LLM ' + st.llm + ' / 缓存 ' + st.cache + ' / 失败 ' + st.fail,
        总耗时: mins + ' 分 ' + secs + ' 秒',
        结束时间: new Date().toLocaleString('zh-CN'),
      };

      ZHS.Log.info('=== 全部课程已看完 ===');
      Object.keys(report).forEach((k) => ZHS.Log.info('  ' + k + '：' + report[k]));

      // 控制台结构化输出（不用 console.table：在部分无头/受限环境里它会挂起）
      try {
        const lines = Object.keys(report).map((k) => k + ': ' + report[k]).join('\n');
        console.log('[智慧树助手·总结]\n' + lines);
      } catch (e) { /* 忽略 */ }

      ZHS.state.lastReport = report;
      this.stop();

      if (ZHS.panel) ZHS.panel.showReport(report);
    },

    /** 取最近一次总结报告 */
    lastReport() { return ZHS.state.lastReport || null; },

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
