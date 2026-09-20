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
  // 弹题遮挡层。
  // 必须严格限定在弹题容器内，不能用裸的 .topic-title：
  // 作业页同样有 .topic-title，裸选择器会在作业页被误判成「弹题」，
  // 于是先暂停视频、再试图关窗，最后还要耗掉一轮 await 才放行。
  //
  // 【2026-09-19 修正】选择器改为从 ZHS.Const 共享常量读取（单一真源），
  // 并补上 Element UI 弹窗 `.el-dialog__wrapper .el-dialog`。
  // 原先这里与 src/08-questions.js 的 Dialog.root() 各写一份 `#playTopic-dialog, [class*="topic-dialog"]`，
  // 两份必须逐字一致才不出错：调度器靠它放行守卫 2，答题器靠它找容器。
  // 而 Element UI 的「选对才能关」A/B 弹窗 class 里没有 `topic-dialog` 子串 →
  // 守卫 2 进不去、Dialog.root() 返回 null，脚本对这类弹窗完全无反应（用户报的「脚本没有在答这种题」）。
  // 现在两边同源，且字面量兜底防模块加载顺序异常。
  const QUESTION_SELECTORS = ZHS.Const && ZHS.Const.QUESTION_SELECTORS
    || '#playTopic-dialog, [class*="topic-dialog"], .el-dialog__wrapper .el-dialog';
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

      // round-16【P1/P2 关键修正】：必须区分两类计数器，不能一刀切「保留」或「重置」——
      //   · 成果计数器（startedAt / _navCount / _completedThisRun）：
      //     自愈恢复要**保留**，否则「看 N 节就停」永远凑不够阈值、总结总耗时少算。
      //   · 止损闸门（_navFailKey / _navFailCount / _navFailTotal）：
      //     自愈恢复必须**清零**。它们是「连着失败就停手」的保护计数，一旦带着脏值恢复，
      //     面对同一个坏节点时失败 1 次就立刻再次触发停机 → 60s 冷却后再自愈 → 又停，
      //     名额耗尽后彻底死亡；用户观感正是「自动恢复后马上又停」。
      //     止损闸门衡量的是「本轮这一段的连续失败」，恢复即视为新一段。
      if (resume) {
        this._navFailKey = null;
        this._navFailCount = 0;
        this._navFailTotal = 0;
        ZHS.Log.info('主循环已恢复（保留本轮计时与完成计数，重置止损闸门）');
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
      // round-16【P3】：自愈恢复时静默体检 —— 只打日志、不弹「开始自动学习」提示。
      // 原先每次自愈都重弹一次，配合上面的失败-自愈循环会反复刷屏，反而盖住真实异常。
      this.preflight({ silent: resume });   // 启动即做一次全量体检（N1）
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
    preflight(opts) {
      // round-16【P3】：silent = 自愈恢复场景调用 —— 只写日志、不弹提示。
      // 否则每次瞬时故障自愈都会重弹一遍「检测到 N 节未看完，开始自动学习」，
      // 配合失败-自愈循环会反复刷屏，反而把真正的异常信息淹没掉。
      const silent = !!(opts && opts.silent);
      try {
        const cat = ZHS.Catalog;
        const bd = cat.breakdown();

        if (!bd.total) {
          ZHS.Log.warn('目录未识别到任何可学习节点，请确认已进入课程播放页');
          if (!silent && ZHS.panel) ZHS.panel.alert('未识别到课程目录，请先进入具体课程', 'warn');
          return bd;
        }

        ZHS.Log.info('=== 课程体检 ===');
        ZHS.Log.info('共 ' + bd.total + ' 个节点：已完成 ' + bd.done
          + ' / 未看完 ' + bd.undone + ' / 未解锁 ' + bd.locked
          + '（完成度 ' + bd.percent + '%）');

        if (bd.allDone) {
          ZHS.Log.info('课程已全部看完，无需播放');
          if (!silent && ZHS.panel) ZHS.panel.alert('检测到课程已全部看完', 'info');
          return bd;
        }

        // 列出待学清单，便于用户核对
        const todo = cat.pending().map((el) => cat.itemTitle(el)).filter(Boolean);
        todo.slice(0, 10).forEach((t, i) => ZHS.Log.info('  待学 ' + (i + 1) + '：' + t));
        if (todo.length > 10) ZHS.Log.info('  …另有 ' + (todo.length - 10) + ' 节');

        if (!silent && ZHS.panel) {
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
        // M8 学习时长统计：只在本轮主循环真正在跑、且视频处于播放态时累加。
        // 暂停 / 等待加载 / 弹题阻塞都不计入——习惯分计的是「实际学习时长」，
        // 把空转时间算进去会让面板显示的进度虚高，反而误导用户。
        // 同样用可选调用：统计模块缺失或抛错都不得影响主循环。
        if (ZHS.Stats && ZHS.state && ZHS.state.running) {
          const v = ZHS.Player && ZHS.Player.video && ZHS.Player.video();
          if (v && !v.paused && !v.ended) ZHS.Stats.addStudyTime(LOOP_INTERVAL);
        }

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
              ZHS.Answerer.handleDialog({ manual: false }), DIALOG_BUDGET_MS, '弹题作答'
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
