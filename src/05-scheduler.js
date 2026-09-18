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
  const QUESTION_SELECTORS = '#playTopic-dialog';
  // 其他阻塞弹窗
  const BLOCK_SELECTORS = '.ss2077-custom-dialog';

  const LOOP_INTERVAL = 2000;   // 主循环间隔
  const END_SETTLE_MS = 3000;   // 结束后等平台上报进度的时间
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
      if (this._timer) return;
      if (this._halted && !manual) {
        ZHS.Log.debug('此前已判定停止，自动启动被忽略（如需重跑请手动点「启动」）');
        return;
      }
      this._halted = false;
      ZHS.state.running = true;
      ZHS.state.startedAt = Date.now();   // 每次启动重置计时
      this._navCount = 0;
      this._navFailKey = null;
      this._navFailCount = 0;
      this._completedThisRun = 0;         // 停止条件：本次运行完成节数
      this._timer = setInterval(() => this.tick(), LOOP_INTERVAL);
      ZHS.Log.info('主循环已启动');
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

    stop() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      ZHS.state.running = false;
      // 标记「本轮已判定停机」：阻止页面初始化流程里的自动 start() 把它重新拉起。
      // 用户手动点「启动」时可以越过（见 start(opts.manual)）。
      this._halted = true;
      ZHS.Log.info('主循环已停止');
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

        if (progress <= 0) {
          // 读不到平台进度（条目未识别 / 进度选择器失配）→ 信任视频已放完，直接切下一节。
          // 绝不重播：用户核心诉求「看完就下一集」，回退重播只应在明确读到 1~99% 时发生。
          ZHS.Log.warn('平台进度未确认（读到 ' + progress + '%），按视频已放完处理，切换下一节');
          ZHS.Player.resetRetry();
          await this.gotoNext('视频播放完毕');
          return;
        }

        // 1~99：确实只看了一部分 → 回退到记录点重播
        const retried = await ZHS.Player.retryFromPlatformProgress(video, progress);
        if (!retried) {
          ZHS.Log.warn('重试次数用尽，强制切换下一节');
          ZHS.Player.resetRetry();
          await this.gotoNext('进度同步失败，跳过');
        }
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
      const cur = ZHS.Catalog.current();
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
            this.stop();
          } else if (bd.undone === 0) {
            // 真正全看完：先看是否要「自动跳课」回课程中心找下一门，
            // 没开开关（或不在学习页 / 模块缺失）就保持原有「出总结并停止」行为。
            const hub = ZHS.CourseHub;
            const canHop = cfg.autoCourseHop && hub && !hub.isHubPage();
            if (canHop) {
              hub.markCourseDone(ZHS.state.courseId);
              ZHS.Log.info('[课程中心] 本课程已全部学完，准备返回课程中心寻找下一门课');
              this.stop();
              hub.returnToHub();
            } else {
              await this.finishAll(reason);
            }
          } else {
            // 有未完成但找不到（状态识别可能有偏差），停手让人看
            ZHS.Log.warn('还有 ' + bd.undone + ' 节未完成，但无法定位到可点击节点（可能被锁定或选择器不匹配）');
            if (ZHS.panel) ZHS.panel.alert('还有 ' + bd.undone + ' 节未完成但定位失败，请检查目录', 'warn');
            this.stop();
          }
          return;
        }

        // 「同目标反复点」检测：记录每次切换目标标识；若与上次失败目标相同则累计，
        // 不同则清零。健康站点点完下一节会前移 → 目标变化 → 计数归零，不会误停；
        // 只有「点了没动、next 恒同节」才让计数收敛到 SAME_NAV_MAX → 判失败停手。
        const _targetKey = cat.itemTitle(next);
        if (_targetKey === this._navFailKey) {
          this._navFailCount++;
        } else {
          this._navFailKey = _targetKey;
          this._navFailCount = 1;
        }
        if (this._navFailCount >= SAME_NAV_MAX) {
          ZHS.Log.error('连续 ' + this._navFailCount + ' 次切换目标都是「' + _targetKey + '」且未能前进（疑似平台改版/按钮无反应），已停止自动跳转');
          if (ZHS.panel) ZHS.panel.alert('切课失败：连续 ' + this._navFailCount + ' 次点击「' + _targetKey + '」无效，已停止自动跳转，请手动切换', 'error', 15000);
          this.stop();
          return;
        }

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

        // 记录新课时标识，供续播使用
        ZHS.state.lessonKey = cat.itemTitle(next);
        cat.click(next);
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
