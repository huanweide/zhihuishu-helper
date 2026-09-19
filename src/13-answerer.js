/**
 * 答题编排层：把「采集 → 求解 → 回填」串成完整流程
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod13_answerer) return;
  ZHS.__mod13_answerer = true;
  const U = ZHS.Util;

  const Answerer = {
    _running: false,
    _answeredSig: '',       // 已成功作答完成的弹题签名（去重跳过用）
    _noSelfCheckSig: '',    // round-10 A3：上一轮判定「点击未生效/无法自检」的题签名
    _noSelfCheckUntil: 0,   // round-10 A3：该判定的节流截止时间
    _giveUpSigs: null,      // round-13：已放弃处理的弹窗签名集合（关不掉/非标准答题），避免每轮死磕关闭刷屏
    _skippedSigs: null,     // 无通道已跳过的弹题签名集合
    _lastSkipWarnAt: 0,     // 跳过告警节流时间戳
    _failCount: 0,          // 同一弹题连续处理失败次数
    _cooldownUntil: 0,      // 退避截止时间戳
    _pendingHuman: false,   // 本题未答上/关不掉 → 等人工，期间不再自动关闭和反复告警

    /**
     * 弹题处理（课中）
     * @param opts.manual 手动触发（面板「答题」按钮）：绕过 autoAnswer 配置，用户点了就答
     */
    async handleDialog(opts) {
      const manual = !!(opts && opts.manual);
      if (this._running) return;
      if (!manual && !ZHS.config.autoAnswer) return;   // 手动模式绕过配置

      // 退避期内不重试作答（防止关闭失败导致死循环作答）。
      // 但退避 ≠ 卡死：主循环会走 forceCloseDialog() 直接关弹窗恢复播放。
      if (!manual && Date.now() < this._cooldownUntil) {
        ZHS.Log.debug('弹题处理处于退避期，跳过作答（还剩 '
          + Math.ceil((this._cooldownUntil - Date.now()) / 1000) + ' 秒）');
        return;
      }

      const root = ZHS.Questions.Dialog.root();
      if (!root) {
        // 弹窗已消失（人工答完/平台收走）→ 复位待人工标记，让下一道题正常走流程
        this._pendingHuman = false;
        // round-8 A1：弹窗消失即解除退避，否则退避期内新弹题会被跳过且不答（旧题卡死新题）
        this._cooldownUntil = 0;
        if (this._giveUpSigs) this._giveUpSigs = new Set(); // round-13：弹窗消失，重置放弃集合，下一题可正常处理
        return;
      }

      // 防止同一份弹题重复处理（用题干+选项拼接作签名）。
      // 手动触发例外：用户主动点了「答题」按钮，即使签名没变也必须重试，
      // 否则按钮看起来就是「点了没反应」。
      const snapshot = ZHS.Questions.Dialog.collect();
      const sig = JSON.stringify(snapshot.map((s) => s.title)).slice(0, 200);
      // round-13：本题已放弃处理（非标准 A/B 简单答题，自动随机选都没猜对）。
      // 直接跳过，不再每轮死磕关闭刷屏；弹窗消失后（handleDialog 的 !root 分支）会自动清空放弃集合。
      if (this._giveUpSigs && this._giveUpSigs.has(sig)) {
        ZHS.Log.debug('本题已放弃处理（非标准 A/B 答题，自动未猜对），跳过检测');
        return;
      }
      // 已成功作答完成的弹题才去重跳过；无通道/未答上的弹题仍需每轮重试关闭（避免卡死）
      if (!manual && sig && sig === this._answeredSig) {
        ZHS.Log.debug('弹题已作答完成，跳过重复处理');
        return;
      }
      this._running = true;
      try {
        const before = ZHS.state.answeredCount;
        ZHS.Log.info('检测到课中弹题，开始自动作答' + (manual ? '（手动触发）' : ''));
        await this._answerDialog(root, sig);

        // 用户手动点了「答题」却一题都没答——最常见的原因是没有可用答题通道
        // （未填 API Key / 题库查不到）。此时按策略不该瞎蒙，但必须给用户反馈，
        // 否则按钮看起来就是「点了没反应」。
        if (manual && ZHS.state.answeredCount === before) {
          const skipped = ZHS.Solver && Number(ZHS.Solver.stats.skipped) > 0;
          const reason = skipped
            ? '没有可用答题通道（未配置大模型密钥，或题库查不到）'
            : '未能识别到题目或选项';
          ZHS.Log.warn('手动答题未产生作答：' + reason);
          if (ZHS.panel) {
            ZHS.panel.alert(
              reason + '，已跳过本题未作答（瞎蒙会错答拉分）。'
              + '请在设置页填写大模型 API Key 并点「保存」。',
              'warn', 10000
            );
          }
        }
      } catch (e) {
        ZHS.Log.error('弹题处理失败：' + (e && e.message));
      } finally {
        this._running = false;
      }
    },

    /**
     * 退避期兜底（用户需求：「不要停住」）：
     * 不作答，直接尝试关闭弹窗并恢复播放，保证流程永不卡死。
     * 由调度器守卫在退避期内调用。
     */
    async forceCloseDialog() {
      const Q = ZHS.Questions.Dialog;
      if (!Q.stillPresent()) return true;
      const ok = Q.close();
      await U.sleep(700);
      if (!Q.stillPresent()) {
        ZHS.Log.info('退避期内已直接关闭弹题，恢复播放');
        this._resumePlay();
        return true;
      }
      return false;
    },

    async _answerDialog(root, sig) {
      // 每次处理新弹题都重置「无通道/无法自检」标记，避免上一题的状态污染本题
      this._noChannelThisRound = false;
      this._noSelfCheck = false;

      // round-13：识别「非标准 A/B 简单答题」弹窗（如 .el-dialog 容器，标准题面/选项均识别不到）。
      // 这类弹窗是「选对才能关」的简单 A/B 题，平台不按标准课中弹题结构渲染，
      // 强行点 .el-dialog__close 三次全失败、刷屏卡死。直接走随机选 A/B 专用逻辑，不进标准求解。
      const qSnap = (ZHS.Questions.Dialog.readCurrent && ZHS.Questions.Dialog.readCurrent(root)) || null;
      const nonStandardOpts = (qSnap && qSnap.options) || [];
      if (!nonStandardOpts.length) {
        await this._tryNonStandardAB(root, sig);
        return;
      }

      // round-10 A3：上一轮已判定本题「点击未生效/无法自检」，在节流期内直接尝试关闭恢复，
      // 跳过 ZHS.Solver.solve 重复重作答，避免反复求解刷屏；节流到期后再恢复重试。
      if (sig && sig === this._noSelfCheckSig && Date.now() < this._noSelfCheckUntil) {
        ZHS.Log.info('本题已判定无法自检，节流期内直接尝试关闭并恢复播放（跳过重复重作答）');
        const ok = await this.closeDialogAndResume({ noChannel: true });
        if (!ok) { this._resumePlay(); this._throttledSkipWarn(sig); }
        return;
      }
      const pages = Array.from(root.querySelectorAll('.el-pager .number'));
      let anyAnswered = false;
      let allAnswered = false;   // round-9 A2：多页弹题需全部页都答上才算完整完成

      if (!pages.length) {
        // 单页弹题
        anyAnswered = await this._solveCurrentPage(root);
        allAnswered = anyAnswered;
      } else {
        // 多页：逐页切换作答
        let every = true;
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          if (!page.classList.contains('active')) {
            page.click();
            await U.sleep(600);
          }
          const pageAnswered = await this._solveCurrentPage(root);
          anyAnswered = anyAnswered || pageAnswered;
          if (!pageAnswered) every = false;   // round-9 A2：任一页未答上 → 整体未完成
        }
        allAnswered = every;
      }

      await U.sleep(500);

      // N4：按配置决定是否自动关闭弹题
      if (ZHS.config.autoCloseDialog === false) {
        ZHS.Log.info('已作答完成（自动关闭已关闭，请手动关闭弹题）');
        this._answeredSig = sig || '';   // 标记已作答，避免下一轮因签名变化反复点击取消已选项
        return;
      }

      // 核心修复（平台规则：未作答的弹题不能关闭）：
      // 只有本题**实际作答成功**（选项真的被选中）才尝试自动关闭；
      // 没答上就硬关只会被平台弹「未作答的弹题不能关闭」拒绝，
      // 然后脚本陷入「关不掉 → 退避 → 再关」的死循环骚扰。
      // 没答上时正确做法：保留弹窗交给用户手动作答，脚本安静等待。
      if (!anyAnswered) {
        // 区分「无通道（无法自检）」与「有通道但选项点击未生效」：
        // 无通道 / 点击后环境无法自检选中态 → 按"默认视为已作答"尝试关闭弹窗，
        // 平台拒绝未作答会回弹；此时【不转人工卡死】，恢复播放并继续，
        // 下一轮主循环仍会重试关闭（节流告警），符合用户「不要停住」要求。
        // 只有「明确有通道、点击也执行了、但选项就是选不中」才转人工。
        if (this._noChannelThisRound || this._noSelfCheck) {
          // round-10 A3：记录本题为「无法自检/无通道」，下一轮节流跳过重复重作答
          this._noSelfCheckSig = sig || '';
          this._noSelfCheckUntil = Date.now() + 30000;
          const ok = await this.closeDialogAndResume({ noChannel: true });
          if (ok) {
            this._answeredSig = sig || '';
            if (this._skippedSigs) this._skippedSigs.delete(sig || '');
          } else {
            // 平台禁止关闭未作答弹窗：不暂停、不卡死，恢复播放并继续，稍后重试
            this._resumePlay();
            this._throttledSkipWarn(sig);
          }
        } else {
          this._pendingHuman = true;
          ZHS.Log.warn('本题有通道但选项点击未生效，平台不允许关闭未作答弹窗，已交由人工处理');
          if (ZHS.panel) {
            ZHS.panel.alert('这题有通道但没选上：请手动选择答案，弹窗会保留等你作答（作答后可正常关闭）', 'warn', 10000);
          }
        }
        return;
      }
      // round-9 A2：多页弹题若只有部分页答上，不标记完整完成，避免剩余页被永久跳过。
      // 无通道/无法自检 → 尝试关闭已答页并恢复播放，下一轮回来补答剩余页（不置 _answeredSig）；
      // 有通道但部分页点不上 → 转人工保留弹窗补全。
      if (!allAnswered) {
        if (this._noChannelThisRound || this._noSelfCheck) {
          // round-10 A3：记录本题为「无法自检/无通道」，下一轮节流跳过重复重作答
          this._noSelfCheckSig = sig || '';
          this._noSelfCheckUntil = Date.now() + 30000;
          const ok = await this.closeDialogAndResume({ noChannel: true });
          if (!ok) { this._resumePlay(); this._throttledSkipWarn(sig); }
          // 注意：不置 _answeredSig，下一轮 handleDialog 回来继续补答剩余页
        } else {
          this._pendingHuman = true;
          ZHS.Log.warn('多页弹题部分页未答上，已交由人工处理');
          if (ZHS.panel) {
            ZHS.panel.alert('这题有多页，部分还没选上：请手动补全剩余页，弹窗保留等你作答', 'warn', 10000);
          }
        }
        return;
      }
      this._answeredSig = sig || '';   // 标记已作答完成（全部页都已答上），后续轮次去重跳过
      await this.closeDialogAndResume();
    },

    /**
     * round-13：处理「非标准 A/B 简单答题」弹窗（标准题面/选项识别不到，如 .el-dialog 容器）。
     * 策略：在弹窗内按 A/B 文本或通用选项结构随机选一个点击一次 → 尝试关闭；
     * 选对就关掉恢复播放；选错（需选对才能关）或结构不符导致关不掉 → 放弃本题，
     * 加入 _giveUpSigs（后续轮次跳过，不再刷屏），并面板提示用户手动选 A 或 B。
     */
    async _tryNonStandardAB(root, sig) {
      ZHS.Log.info('round-13：识别到非标准 A/B 简单答题（标准选项识别不到），尝试随机选 A/B');
      // 在弹窗内查找看起来像 A/B 选项的可点击元素（兜底多种结构）
      const optSel = 'li, label, .el-radio, .el-checkbox, [role="radio"], [role="option"], .option-item, .choice-item, .answer-option';
      let opts = Array.from(root.querySelectorAll(optSel)).filter((el) => {
        const t = (el.textContent || '').replace(/\s+/g, '').toLowerCase();
        return /^([ab][.、:：]?|是|否|对|错|正确|错误|√|×)/.test(t);
      });
      if (!opts.length) {
        // 退一步：直接取弹窗内前两个可点选项（不强制 A/B 文本）
        opts = Array.from(root.querySelectorAll(optSel)).slice(0, 2);
      }
      if (!opts.length) {
        // 连选项元素都找不到 → 直接放弃，提示用户手动选
        if (this._giveUpSigs) this._giveUpSigs.add(sig);
        this._pendingHuman = true;
        if (ZHS.panel) ZHS.panel.alert('检测到选对才能关的简单 A/B 题，但自动找不到选项，请手动选 A 或 B', 'warn', 10000);
        ZHS.Log.warn('round-13：非标准 A/B 答题找不到选项元素，放弃自动处理，提示用户手动选');
        return;
      }
      // 随机选 A 或 B 之一点一次
      const idx = opts.length > 1 ? (Math.random() < 0.5 ? 0 : 1) : 0;
      const pick = opts[idx];
      try { pick.click(); } catch (e) { /* 点击异常不影响后续关闭尝试 */ }
      await U.sleep(400);
      const ok = await this.closeDialogAndResume({ noChannel: true });
      if (ok) {
        this._answeredSig = sig || '';
        ZHS.Log.info('round-13：随机选 A/B 成功关闭弹窗，恢复播放');
      } else {
        // 选错（需选对才能关）或结构不符 → 放弃本题，提示用户手动选 A 或 B
        if (this._giveUpSigs) this._giveUpSigs.add(sig);
        this._pendingHuman = true;
        if (ZHS.panel) ZHS.panel.alert('这是选对才能关的简单 A/B 题，自动没猜对，请手动选 A 或 B', 'warn', 10000);
        ZHS.Log.warn('round-13：随机选 A/B 仍未关闭（需选对才能关），放弃自动处理，提示用户手动选');
        this._resumePlay();
      }
    },

    /**
     * 关闭弹题并恢复播放（N4 需求）
     * 策略：点关闭 → 校验是否真关了 → 没关就重试（最多 3 次，每次间隔递增）
     */
    async closeDialogAndResume(opts) {
      const noChannel = !!(opts && opts.noChannel);
      const Q = ZHS.Questions.Dialog;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const ok = Q.close();
        await U.sleep(700 * attempt);

        if (!Q.stillPresent()) {
          ZHS.Log.info('弹题已关闭' + (attempt > 1 ? '（第 ' + attempt + ' 次尝试）' : ''));
          this._failCount = 0;
          this._cooldownUntil = 0;
          this._pendingHuman = false;
          this._resumePlay();
          return true;
        }
        ZHS.Log.warn('弹题关闭失败，重试第 ' + attempt + ' 次');
      }

      this._failCount++;
      // 无通道场景：不转人工卡死主循环，交由调用方（_answerDialog）恢复播放并继续重试。
      if (noChannel) return false;

      // 有通道场景（明确需要人工）：平台大概率是因为「未作答」拒绝关闭，
      // 退避 30s 防反复骚扰，明确告知用户手动作答，脚本安静等待，弹窗消失后自动复位。
      this._cooldownUntil = Date.now() + 30 * 1000;   // 退避 30s，防关不掉的弹窗反复骚扰
      this._pendingHuman = true;
      ZHS.Log.warn('弹题自动关闭失败（累计 ' + this._failCount + ' 次），已转人工：请手动作答或关闭弹窗');
      if (ZHS.panel) {
        ZHS.panel.alert('弹窗关不掉？多半是还没作答——请手动选好答案，脚本会继续等你', 'warn', 10000);
      }
      return false;
    },

    /** 无通道时跳过弹题的节流告警：每 30s 最多提示一次，避免刷屏 */
    _throttledSkipWarn(sig) {
      const now = Date.now();
      if (this._lastSkipWarnAt && now - this._lastSkipWarnAt < 30000) return;
      this._lastSkipWarnAt = now;
      if (!this._skippedSigs) this._skippedSigs = new Set();
      if (sig) this._skippedSigs.add(sig);
      ZHS.Log.warn('本题无答题通道（未配置大模型密钥或题库查不到），平台又不许关闭未作答弹题，已尝试跳过并继续播放；配置密钥后可在设置页开启自动答题');
      if (ZHS.panel) {
        ZHS.panel.alert('本题无答题通道，已尝试跳过并继续播放；如需自动作答请在设置页填写大模型 API Key', 'warn', 10000);
      }
    },

    /** 恢复播放（弹题处理完后） */
    _resumePlay() {
      try {
        const v = ZHS.Player && ZHS.Player.video();
        if (!v) return;
        const cfg = ZHS.config;
        if (cfg.mute) ZHS.Player.mute(v);
        ZHS.Player.setSpeed(v, cfg.speed);
        if (v.paused) {
          const p = v.play();
          if (p && p.catch) p.catch(() => { /* 自动播放策略拦截，忽略 */ });
          ZHS.Log.info('弹题关闭后已恢复播放');
        }
      } catch (e) {
        ZHS.Log.debug('恢复播放异常：' + e.message);
      }
    },

    /**
     * 求解并作答当前分页
     * @returns {boolean} 是否**实际作答成功**（选项真的被选中，经 isChecked 自检）
     */
    async _solveCurrentPage(root) {
      const q = ZHS.Questions.Dialog.readCurrent(root);
      if (!q || !q.options.length) {
        ZHS.Log.debug('当前分页无选项，跳过');
        return false;
      }

      ZHS.Log.info('弹题：' + (q.title || '(无题干)').slice(0, 60) + ' 选项 ' + q.options.length + ' 个');

      const result = await ZHS.Solver.solve({
        title: q.title,
        options: q.options,
        type: q.type,
      });
      if (!result) { this._noChannelThisRound = true; return false; }

      let answered = false;
      // 弹题的选项按钮在 .topic .radio ul > li，按索引点击
      const idxs = ZHS.Bank.toIndexes(result.answer);
      if (idxs.length) {
        for (const idx of idxs) {
          const flex = q.elementList[idx] ||
            root.querySelector('.topic .radio ul > li:nth-child(' + (idx + 1) + ')');
          if (flex) {
            flex.click();
            await U.sleep(600);
            // 自检：点击后确认选项真的处于选中态。查不到选中就当作没答上
            // （宁可交给人工，也不能让脚本以为答完了去关一个平台不认的弹窗）
            if (ZHS.Filler.isChecked(flex)) {
              answered = true;
              ZHS.state.answeredCount++;
              ZHS.Log.info('已作答：' + result.answer + '（来源 ' + result.from + '）');
            } else {
              this._noSelfCheck = true;
              ZHS.Log.warn('选项点击后未检测到选中态（环境无法自检），按默认视为已作答处理');
            }
          }
        }
      } else if (q.type === 'completion' || q.type === 'qa' || q.type === 'judgement') {
        const ok = await ZHS.Filler.fill(
          { type: q.type, elementList: q.elementList, node: root },
          result
        );
        if (ok.ok) {
          answered = true;
          ZHS.state.answeredCount++;
          ZHS.Log.info('已作答（文本）：' + result.answer);
        }
      }
      return answered;
    },

    /**
     * 作业/考试页处理
     * @param opts.manual 手动触发：绕过 autoAnswer / answerHomework 配置
     */
    async handleHomework(opts) {
      const manual = !!(opts && opts.manual);
      if (!manual && (!ZHS.config.autoAnswer || !ZHS.config.answerHomework)) return;
      if (this._running) return;

      const scene = ZHS.Questions.scene();
      if (scene !== 'homework' && scene !== 'hike') return;

      const list = ZHS.Questions.collect();
      if (!list.length) return;

      const unanswered = list.filter((q) => !this._isAnswered(q));
      if (!unanswered.length) {
        ZHS.Log.info('作业页所有题目都已作答');
        return;
      }

      this._running = true;
      try {
        ZHS.Log.info('作业页共 ' + list.length + ' 题，待答 ' + unanswered.length + ' 题');
        for (const q of unanswered) {
          // eslint-disable-next-line no-await-in-loop
          const result = await ZHS.Solver.solve(q);
          if (!result) continue;
          // eslint-disable-next-line no-await-in-loop
          const filled = await ZHS.Filler.fill(q, result);
          if (filled.ok) {
            ZHS.state.answeredCount++;
            ZHS.Log.info('第 ' + (q.index + 1) + ' 题已作答：' + result.answer + '（' + result.from + '）');
          } else {
            ZHS.Log.warn('第 ' + (q.index + 1) + ' 题回填失败');
          }
          const d = Number(ZHS.config.answerDelay) || 0;
          // eslint-disable-next-line no-await-in-loop
          if (d > 0) await U.sleep(d * 1000);
        }
        ZHS.Log.info('作业页作答完成');
      } finally {
        this._running = false;
      }
    },

    /** 判断题目是否已作答 */
    _isAnswered(q) {
      const list = q.elementList || [];
      if (!list.length) {
        // 填空题：看输入框有没有值
        const node = q.node || document;
        const ta = node.querySelector && node.querySelector('textarea, input[type="text"]');
        return !!(ta && ta.value && ta.value.trim());
      }
      return list.some((el) => ZHS.Filler.isChecked(el));
    },

    /** 重置弹题签名（切课后调用） */
    reset() {
      this._answeredSig = '';
      this._noSelfCheckSig = '';
      this._noSelfCheckUntil = 0;
      this._skippedSigs = new Set();
      this._lastSkipWarnAt = 0;
      this._failCount = 0;
      this._cooldownUntil = 0;
      this._pendingHuman = false;
      this._giveUpSigs = new Set();   // round-13：已放弃的非标准弹窗签名集合
    },
  };

  ZHS.Answerer = Answerer;
})();
