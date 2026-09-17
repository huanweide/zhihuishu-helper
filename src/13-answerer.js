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

    /** 弹题处理（课中） */
    async handleDialog() {
      if (this._running) return;
      if (!ZHS.config.autoAnswer) return;

      // 退避期内不重试（防止关闭失败导致死循环作答）
      if (Date.now() < this._cooldownUntil) {
        ZHS.Log.debug('弹题处理处于退避期，跳过（还剩 '
          + Math.ceil((this._cooldownUntil - Date.now()) / 1000) + ' 秒）');
        return;
      }

      const root = ZHS.Questions.Dialog.root();
      if (!root) return;

      // 防止同一份弹题重复处理（用题干+选项拼接作签名）
      const snapshot = ZHS.Questions.Dialog.collect();
      const sig = JSON.stringify(snapshot.map((s) => s.title)).slice(0, 200);
      if (sig && sig === this._lastDialogSig) {
        ZHS.Log.debug('弹题签名未变，跳过重复处理');
        return;
      }
      this._lastDialogSig = sig;

      this._running = true;
      try {
        ZHS.Log.info('检测到课中弹题，开始自动作答');
        await this._answerDialog(root);
      } catch (e) {
        ZHS.Log.error('弹题处理失败：' + (e && e.message));
      } finally {
        this._running = false;
      }
    },

    async _answerDialog(root) {
      const pages = Array.from(root.querySelectorAll('.el-pager .number'));

      if (!pages.length) {
        // 单页弹题
        await this._solveCurrentPage(root);
      } else {
        // 多页：逐页切换作答
        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];
          if (!page.classList.contains('active')) {
            page.click();
            await U.sleep(600);
          }
          await this._solveCurrentPage(root);
        }
      }

      await U.sleep(500);

      // N4：按配置决定是否自动关闭弹题
      if (ZHS.config.autoCloseDialog === false) {
        ZHS.Log.info('已作答完成（自动关闭已关闭，请手动关闭弹题）');
        this._lastDialogSig = '';
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
          this._resumePlay();
          return true;
        }
        ZHS.Log.warn('弹题关闭失败，重试第 ' + attempt + ' 次');
      }

      // 3 次都失败 → 进入退避，避免死循环反复作答同一题
      this._failCount++;
      const backoff = Math.min(30 * this._failCount, 180);   // 30s → 60s → ... 上限 3 分钟
      this._cooldownUntil = Date.now() + backoff * 1000;
      ZHS.Log.warn('弹题自动关闭失败（累计 ' + this._failCount + ' 次），退避 ' + backoff + ' 秒后重试');
      if (ZHS.panel) ZHS.panel.alert('弹题关闭失败，' + backoff + ' 秒后重试；若持续失败请手动点掉', 'warn');
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

    async _solveCurrentPage(root) {
      const q = ZHS.Questions.Dialog.readCurrent(root);
      if (!q || !q.options.length) {
        ZHS.Log.debug('当前分页无选项，跳过');
        return;
      }

      ZHS.Log.info('弹题：' + (q.title || '(无题干)').slice(0, 60) + ' 选项 ' + q.options.length + ' 个');

      const result = await ZHS.Solver.solve({
        title: q.title,
        options: q.options,
        type: q.type,
      });
      if (!result) return;

      // 弹题的选项按钮在 .topic .radio ul > li，按索引点击
      const idxs = ZHS.Bank.toIndexes(result.answer);
      if (idxs.length) {
        for (const idx of idxs) {
          const flex = q.elementList[idx] ||
            root.querySelector('.topic .radio ul > li:nth-child(' + (idx + 1) + ')');
          if (flex) {
            flex.click();
            ZHS.state.answeredCount++;
            ZHS.Log.info('已作答：' + result.answer + '（来源 ' + result.from + '）');
            await U.sleep(600);
          }
        }
      } else if (q.type === 'completion' || q.type === 'qa') {
        const ok = await ZHS.Filler.fill(
          { type: q.type, elementList: q.elementList, node: root },
          result
        );
        if (ok.ok) {
          ZHS.state.answeredCount++;
          ZHS.Log.info('已作答（文本）：' + result.answer);
        }
      }
    },

    /** 作业/考试页处理 */
    async handleHomework() {
      if (!ZHS.config.autoAnswer || !ZHS.config.answerHomework) return;
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
    },
  };

  ZHS.Answerer = Answerer;
})();
