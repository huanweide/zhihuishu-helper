/**
 * 答题编排层：把「采集 → 求解 → 回填」串成完整流程
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  const U = ZHS.Util;

  const Answerer = {
    _running: false,
    _lastDialogSig: '',
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
        return;
      }

      // 防止同一份弹题重复处理（用题干+选项拼接作签名）。
      // 手动触发例外：用户主动点了「答题」按钮，即使签名没变也必须重试，
      // 否则按钮看起来就是「点了没反应」。
      const snapshot = ZHS.Questions.Dialog.collect();
      const sig = JSON.stringify(snapshot.map((s) => s.title)).slice(0, 200);
      if (!manual && sig && sig === this._lastDialogSig) {
        ZHS.Log.debug('弹题签名未变，跳过重复处理');
        return;
      }
      this._lastDialogSig = sig;

      this._running = true;
      try {
        const before = ZHS.state.answeredCount;
        ZHS.Log.info('检测到课中弹题，开始自动作答' + (manual ? '（手动触发）' : ''));
        await this._answerDialog(root);

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

    async _answerDialog(root) {
      const pages = Array.from(root.querySelectorAll('.el-pager .number'));
      let anyAnswered = false;

      if (!pages.length) {
        // 单页弹题
        anyAnswered = await this._solveCurrentPage(root);
      } else {
        // 多页：逐页切换作答
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          if (!page.classList.contains('active')) {
            page.click();
            await U.sleep(600);
          }
          const pageAnswered = await this._solveCurrentPage(root);
          anyAnswered = anyAnswered || pageAnswered;
        }
      }

      await U.sleep(500);

      // N4：按配置决定是否自动关闭弹题
      if (ZHS.config.autoCloseDialog === false) {
        ZHS.Log.info('已作答完成（自动关闭已关闭，请手动关闭弹题）');
        this._lastDialogSig = '';
        return;
      }

      // 核心修复（平台规则：未作答的弹题不能关闭）：
      // 只有本题**实际作答成功**（选项真的被选中）才尝试自动关闭；
      // 没答上就硬关只会被平台弹「未作答的弹题不能关闭」拒绝，
      // 然后脚本陷入「关不掉 → 退避 → 再关」的死循环骚扰。
      // 没答上时正确做法：保留弹窗交给用户手动作答，脚本安静等待。
      if (!anyAnswered) {
        // 区分「无通道（无法自检）」与「有通道但选项点击未生效」：
        // 用户意图「若无法做简单自检则不强制关闭，默认视为已作答」。
        // 故无通道 / 点击后环境无法自检选中态时，按「默认视为已作答」尝试关闭，
        // 把"答没答"的最终裁决权交还给平台（平台拒绝未作答会回弹，由退避兜底防死循环）；
        // 只有「明确有通道、点击也执行了、但选项就是选不中」才转人工，避免瞎蒙错答。
        if (this._noChannelThisRound || this._noSelfCheck) {
          ZHS.Log.warn('无可用答题通道或无法自检选中态，按"默认视为已作答"尝试关闭弹窗（平台拒绝未作答将退避重试）');
          await this.closeDialogAndResume();
        } else {
          this._pendingHuman = true;
          ZHS.Log.warn('本题有通道但选项点击未生效，平台不允许关闭未作答弹窗，已交由人工处理');
          if (ZHS.panel) {
            ZHS.panel.alert('这题有通道但没选上：请手动选择答案，弹窗会保留等你作答（作答后可正常关闭）', 'warn', 10000);
          }
        }
        return;
      }
      await this.closeDialogAndResume();
    },

    /**
     * 关闭弹题并恢复播放（N4 需求）
     * 策略：点关闭 → 校验是否真关了 → 没关就重试（最多 3 次，每次间隔递增）
     */
    async closeDialogAndResume() {
      const Q = ZHS.Questions.Dialog;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const ok = Q.close();
        await U.sleep(700 * attempt);

        if (!Q.stillPresent()) {
          ZHS.Log.info('弹题已关闭' + (attempt > 1 ? '（第 ' + attempt + ' 次尝试）' : ''));
          this._lastDialogSig = '';   // 重置，允许下次处理新弹题
          this._failCount = 0;
          this._cooldownUntil = 0;
          this._pendingHuman = false;
          this._resumePlay();
          return true;
        }
        ZHS.Log.warn('弹题关闭失败，重试第 ' + attempt + ' 次');
      }

      // 3 次都失败 → 转人工。平台大概率是因为「未作答」拒绝关闭，
      // 继续退避重试只会无限循环骚扰（每次都弹「N 秒后重试」）。
      // 正确做法：明确告知用户手动作答，脚本安静等待，弹窗消失后自动复位。
      this._failCount++;
      this._cooldownUntil = Date.now() + 30 * 1000;   // 退避 30s，防关不掉的弹窗反复骚扰
      this._lastDialogSig = '';
      this._pendingHuman = true;
      ZHS.Log.warn('弹题自动关闭失败（累计 ' + this._failCount + ' 次），已转人工：请手动作答或关闭弹窗');
      if (ZHS.panel) {
        ZHS.panel.alert('弹窗关不掉？多半是还没作答——请手动选好答案，脚本会继续等你', 'warn', 10000);
      }
      return false;
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
      this._lastDialogSig = '';
      this._failCount = 0;
      this._cooldownUntil = 0;
      this._pendingHuman = false;
    },
  };

  ZHS.Answerer = Answerer;
})();
