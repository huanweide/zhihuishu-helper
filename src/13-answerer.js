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
    _countedSig: '',        // round-17：本轮已计入 answeredCount 的弹窗签名
                            // （标准链路先答一次、A/B 兜底再答一次会重复计数，同一个弹窗只许计一次）
    _skippedSigs: null,     // 无通道已跳过的弹题签名集合
    _lastSkipWarnAt: 0,     // 跳过告警节流时间戳
    _failCount: 0,          // 同一弹题连续处理失败次数
    _cooldownUntil: 0,      // 退避截止时间戳
    _pendingHuman: false,   // 本题未答上/关不掉 → 等人工，期间不再自动关闭和反复告警
    _lastSolvedIdxs: [],    // round-37：本题求解出的答案选项索引，未选中时供 _ensureAnsweredThenClose 优先重试

    /**
     * 弹题处理（课中）
     * @param opts.manual 手动触发（面板「答题」按钮）：绕过 autoAnswer 配置，用户点了就答
     */
    async handleDialog(opts) {
      const manual = !!(opts && opts.manual);
      if (this._running) return;
      // 手动模式绕过配置；自动模式要求两个开关都为真：
      //   autoAnswer    = AI 答题总开关
      //   answerDialog  = 「课中弹题自动答」子开关
      // 为什么两个都要查：调用方（调度器守卫 2）虽然已做双重校验，但本函数是 public API
      // （面板「答题」按钮也能直接调用）。只查总开关的话，任何新增调用点都会绕开子开关，
      // 在用户明确关掉「课中弹题自动答」的情况下仍然替他答题。
      if (!manual && (!ZHS.config.autoAnswer || !ZHS.config.answerDialog)) return;

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

      // round-39b：AI 助教随堂练习弹题分流（Root Cause：此前它命中 QUESTION_SELECTORS 被
      // 守卫 2 交给本 Answerer 的 isChecked 门控流，而 AI 弹窗选中态常不可见 → 永远"选不中"）。
      // 现改走 ocsjs 同款简单处理器：选一项→提交→关闭→以「弹窗消失」验收，绝不依赖选中态。
      if (this._isAiExercise(root)) {
        await this._handleAiExercise(root);
        return;
      }

      // 防止同一份弹题重复处理（用题干+选项拼接作签名）。
      // 手动触发例外：用户主动点了「答题」按钮，即使签名没变也必须重试，
      // 否则按钮看起来就是「点了没反应」。
      //
      // 【P2-2 修复 · 2026-09-19】签名必须**叠加选项文本**。
      // 起因：无标准题面的弹窗（题面靠 .el-dialog__title 这类固定文案兜底，例如"课中答题"），
      // 同一课程内多道题的标题完全一样 → 签名全相同 → 第二道起被 `sig === _answeredSig`
      // 误判「已作答完成」跳过，用户看到「只有第一道会答」。
      // 选项文本能区分同一标题下的不同题（题干+选项一起构成题的指纹），故纳入签名。
      const snapshot = ZHS.Questions.Dialog.collect();
      const sig = JSON.stringify(snapshot.map(
        (s) => (s.title || '') + '|' + ((s.options || []).join(','))
      )).slice(0, 200);
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
        // round-37：严格遵守「没答完不能关闭」。不再一来自检不过就硬关（硬关只会被平台
        // 拒绝 → 关不掉死循环）。改为：逐个尝试选项（优先已求解答案），每步代码等待 +
        // isChecked 自检，**确认选中后才等待+关闭**；逐个都选不中则转人工保留弹窗。
        await this._ensureAnsweredThenClose(root, sig, this._lastSolvedIdxs || []);
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
     * 处理「非标准 A/B 简单答题」弹窗（标准题面/选项一段都识别不到时的最后兜底）。
     *
     * 用户诉求（2026-09-19 原话）：「猜两次可以，问题是脚本没有在答这种题——它只是乱点；
     * 如果你能检测出题目、能答出来，那就答对再关。」
     * 因此本函数改成两段式，**先真求解，求不出来才猜**：
     *
     *   第一段（优先）：Dialog.readCurrent 读题干+选项 → Solver.solve（题库/LLM）
     *                  → 按答案索引点击 → Filler.isChecked 自检选中态
     *                  → 自检通过才作答成功计数 → 关闭弹窗。
     *   第二段（兜底）：第一段任何一步失败（读不到题、求解返回 null、自检不过）
     *                  都落到这里 —— 扫文本前缀找 A/B 选项，随机选一个点掉试关，
     *                  失败再换另一个（最多 2 轮，「猜两次」），两轮都关不掉才放弃转人工。
     *
     * 为什么要自检：平台规则是「未作答的弹题不能关闭」，脚本若自以为答完了去硬关，
     * 只会被平台拒绝，再陷入「关不掉 → 退避 → 再关」的死循环骚扰用户。
     * 宁可明确转人工，也不假装答上了。
     */
    async _tryNonStandardAB(root, sig) {
      ZHS.Log.info('识别到非标准 A/B 简单答题弹窗，先尝试真作答（题库/LLM），失败再猜 A/B');

      // 读取选项：**必须用 Dialog.readOptions 独立读，不能复用 readCurrent().options**。
      //
      // 【P1 死代码修复 · 2026-09-19】进入本函数的条件是「readCurrent().options 为空」，
      // 而旧代码第一段的入口条件却是「options.length >= 2」——两者**互斥**，
      // 导致第一段（真求解作答）永远不执行，用户要的「能答就答对再关」形同虚设，
      // 只剩乱猜（实测 Solver.solve 调用次数 = 0）。
      // 根因是把「标准选择器读不到选项」错当成「这题没有选项」：
      // 按钮式/div 式 A/B 题（选项是 button，没有 .el-radio）标准选择器读不到，
      // 但它确实有选项、确实可作答。readOptions 提供更宽的独立通道，读不到再降级。
      const ro = (ZHS.Questions.Dialog.readOptions && ZHS.Questions.Dialog.readOptions(root))
        || { elements: [], texts: [] };
      const optEls = ro.elements || [];
      const optTexts = ro.texts || [];

      // 题干兜底链：标准题面 → .el-dialog__title（弹窗标题）→ body 整段文本。
      // 只要拿到任一非空题面就可以交给 Solver 去匹配，总好过完全不读题。
      const q = ZHS.Questions.Dialog.readCurrent(root);
      let title = q && q.title ? String(q.title).trim() : '';
      if (!title) {
        // 【P2 修复 · round-22】root 本身可能是 null（调用方未传/弹窗已消失），
        // 必须先判 root 再判 root.querySelector —— 与上面 :282 readCurrent(root) 的容忍度一致
        // （readCurrent 内部 `if (!r) return null` 不崩，这里若不判 root 就会 TypeError）。
        const b = root && root.querySelector
          && (root.querySelector('.el-dialog__title') || root.querySelector('.el-dialog__body'));
        if (b) title = (U.normText(b.textContent || '') || '').trim();
      }

      // ===== 第一段：真求解（优先，能答对就答对再关） =====
      // 入口条件与「进入本函数的原因」自洽：不再看 readCurrent().options，
      // 而是看「独立读到的选项 >= 2」+「拿到题面」。
      if (title && optTexts.length >= 2) {
        try {
          ZHS.Log.info('A/B 弹窗题干：' + title.slice(0, 60) + '（选项 ' + optTexts.length + ' 个）');
          const result = await ZHS.Solver.solve({ title, options: optTexts, type: q ? q.type : 'unknown' });
          if (result && result.answer) {
            const idxs = ZHS.Bank.toIndexes(result.answer);
            let answered = false;
            for (const idx of idxs) {
              const el = optEls[idx];
              if (!el) continue;   // 索引越界守卫：取不到就跳过该索引，不崩
              // Filler.clickOption：内含 .el-radio__input 内层点击 + input.checked 兜底 + 重试。
              // 返回值的意义：完成「点击动作」并尽量确认选中态。
              // eslint-disable-next-line no-await-in-loop
              const clicked = await ZHS.Filler.clickOption(el);
              // eslint-disable-next-line no-await-in-loop
              await U.sleep(600);
              // 判据只认 isChecked（自检真实选中态）——clicked 仅用于日志：
              // `(clicked || isChecked) && isChecked` 在布尔代数上等价于 isChecked，clicked 被短路，
              // 写成这样容易让读者误以为 clicked 也参与判定，故显式分开写。
              const checked = ZHS.Filler.isChecked(el);
              if (checked) {
                answered = true;
              } else {
                ZHS.Log.debug('A/B 弹窗选项点击后未选中（clicked=' + clicked + '），尝试二次点击');
                // 点完仍检不到选中态，再点一次（Element UI 的 label 偶发需要二次点击）
                // eslint-disable-next-line no-await-in-loop
                try { el.click(); } catch (e) { /* 忽略 */ }
                // eslint-disable-next-line no-await-in-loop
                await U.sleep(400);
                if (ZHS.Filler.isChecked(el)) answered = true;
              }
            }
            if (answered) {
              // 防重复计数：同一个弹窗可能先被标准链路答过一次（_solveCurrentPage），
              // 关闭失败后又落到这里再答一次；answeredCount 是给用户看「答了几道题」的，
              // 同一弹窗计两次会让总结报告虚高。用签名去重，只计第一次。
              if (sig !== this._countedSig) {
                this._countedSig = sig || '';
                ZHS.state.answeredCount++;
              }
              ZHS.Log.info('已作答（A/B 弹窗）：' + result.answer + '（来源 ' + result.from + '）');
              const ok = await this.closeDialogAndResume();
              if (ok) {
                this._answeredSig = sig || '';
                return;
              }
              ZHS.Log.warn('A/B 弹窗已作答但关闭失败，转入随机猜的兜底流程');
            } else {
              ZHS.Log.warn('A/B 弹窗答案已求出（' + result.answer + '）但点击未生效，不硬关，转入随机猜');
            }
          } else {
            ZHS.Log.info('A/B 弹窗无可用答题通道（题库查不到且未配置 LLM Key），转入随机猜');
          }
        } catch (e) {
          ZHS.Log.warn('A/B 弹窗真作答异常（' + (e && e.message) + '），转入随机猜');
        }
      } else {
        ZHS.Log.debug('A/B 弹窗题干或选项读不到（题面「' + title.slice(0, 30)
          + '」/ 选项 ' + optTexts.length + ' 个），跳过真作答，直接随机猜');
      }

      // ===== 第二段：无通道兜底 —— 逐个试选项，确认选中/作答后才关（round-37） =====
      // 用户诉求（原话）：「如果没有密钥答不出来，则随机选择 ABCD 答案都来一次，然后等待一会再关闭；
      // 没答完不能采取关闭」。所以这里：随机把选项逐个点一次（每步代码等待），用 isChecked 自检
      // 真实选中态；只有确认选中后才等待+关闭；逐个都选不上时遵守「没答完不关」，转人工，
      // 绝不硬关（硬关只会被平台拒绝 → 关不掉死循环骚扰）。
      const optSel = '.el-radio, .el-checkbox, [role="radio"], [role="option"],'
        + ' .option-item, .choice-item, .answer-option, .option-btn, .option, .choice, .item-topic';
      const allOpts = optEls.length >= 2 ? optEls : Array.from(root.querySelectorAll(optSel));
      let opts = allOpts.filter((el) => {
        const t = (el.textContent || '').replace(/\s+/g, '').toLowerCase();
        return /^([abcd][.、:：]?|是|否|对|错|正确|错误|√|×)/.test(t);
      });
      if (!opts.length) opts = allOpts.slice(0, 4);   // 退一步：取前若干选项元素
      if (!opts.length) {
        if (this._giveUpSigs) this._giveUpSigs.add(sig);
        this._pendingHuman = true;
        if (ZHS.panel) ZHS.panel.alert('检测到要作答才能关的题，但自动找不到选项，请手动选一个', 'warn', 10000);
        ZHS.Log.warn('A/B 兜底找不到选项元素，放弃自动处理，提示用户手动选');
        return;
      }

      // ★ 2026-10-24 修正：瞎蒙受 gatedRandom 统一控制（与 11-solver 频道 D 一致）。
      // 用户要求「各种情况不要瞎选答案、不瞎蒙」——无答案时不再默认随机猜，
      // 而是遵守「没答完不关」转人工，把选择权交还用户（瞎蒙错答会拉分，且部分课程不可回退）。
      // 只有显式开启 gatedRandom（逃生舱，保证流程不卡死）才保留随机猜。
      if (!ZHS.config.gatedRandom) {
        ZHS.Log.warn('无通道兜底：按配置不瞎蒙，放弃随机猜，转人工保留弹窗');
        if (this._giveUpSigs) this._giveUpSigs.add(sig);
        this._pendingHuman = true;
        if (ZHS.panel) ZHS.panel.alert('本题无可用答题通道，按「不瞎蒙」设置已跳过随机作答；请配置大模型密钥或手动选一个', 'warn', 12000);
        this._resumePlay();
        return;
      }

      // 随机打乱，逐个试（"ABCD 都来一次"，仅 gatedRandom 开启时）
      const orderIdx = opts.map((_, i) => i);
      for (let i = orderIdx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const tmp = orderIdx[i]; orderIdx[i] = orderIdx[j]; orderIdx[j] = tmp; }
      let selected = false; let selectedIdx = -1;
      for (let r = 0; r < orderIdx.length; r++) {
        const oi = orderIdx[r];
        const pick = opts[oi];
        ZHS.Log.info('无通道兜底：试第 ' + (r + 1) + '/' + orderIdx.length + ' 个选项');
        try { await ZHS.Filler.clickOption(pick); }
        catch (e) { try { pick.click(); } catch (e2) { /* 忽略 */ } }
        await U.sleep(700);   // 每步代码等待，等平台反应
        if (ZHS.Filler.isChecked(pick)) { selected = true; selectedIdx = oi; ZHS.Log.info('选项 ' + (oi + 1) + ' 已确认选中'); break; }
      }

      if (!selected) {
        // 逐个试完仍检测不到选中态（可能是需真实点击的控件 / 环境无法自检）——
        // 严格遵守「没答完不能关」：不硬关，转人工，避免关不掉的死循环。
        if (this._giveUpSigs) this._giveUpSigs.add(sig);
        this._pendingHuman = true;
        try { if (ZHS.Filler && ZHS.Filler.dumpDiag) ZHS.Filler.dumpDiag(root, opts); } catch (e) { /* 忽略 */ }
        if (ZHS.panel) ZHS.panel.alert('这题要选中才能关，但自动点选没生效（可能是需真实点击的控件），请手动选一个', 'warn', 12000);
        ZHS.Log.warn('无通道兜底逐个试选项均未确认选中，遵守「没答完不关」，转人工');
        this._resumePlay();
        return;
      }

      // 已确认选中 → 等待一会让平台登记作答，再关
      await U.sleep(1200);
      ZHS.Log.info('无通道兜底已选中选项 ' + (selectedIdx + 1) + '，等待后关闭弹窗');
      const ok = await this.closeDialogAndResume({ noChannel: true });
      if (ok) { this._answeredSig = sig || ''; ZHS.Log.info('无通道兜底选中后成功关闭，恢复播放'); return; }

      // 选中了却关不掉 → 转人工
      if (this._giveUpSigs) this._giveUpSigs.add(sig);
      this._pendingHuman = true;
      if (ZHS.panel) ZHS.panel.alert('已选中答案但弹窗仍关不掉，请手动点关闭', 'warn', 10000);
      ZHS.Log.warn('无通道兜底已选中但关闭失败，转人工');
      this._resumePlay();
    },

    /**
     * round-37：确保「至少一个选项被真实选中」后才关闭（严格遵守「没答完不能关闭」）。
     * 逐个尝试选项（优先已求解答案 prefer），每步代码等待 + isChecked 自检；
     * 确认选中 → 等待一会让平台登记 → 关闭；逐个都选不中 → 转人工保留弹窗，绝不硬关。
     * @returns {Promise<boolean>} 是否已选中并成功关闭
     */
    async _ensureAnsweredThenClose(root, sig, prefer) {
      const Q = ZHS.Questions.Dialog;
      let els = [];
      try {
        const ro = Q.readOptions && Q.readOptions(root);
        if (ro && ro.elements && ro.elements.length >= 2) els = ro.elements.slice();
      } catch (e) { /* 忽略 */ }
      if (els.length < 2) {
        try { const q = Q.readCurrent(root); if (q && q.elementList && q.elementList.length) els = q.elementList.slice(); } catch (e) { /* 忽略 */ }
      }
      if (els.length < 2) {
        try {
          els = Array.from(root.querySelectorAll('.el-radio, .el-checkbox, [role="radio"], [role="option"], .option, .choice, .option-item, .choice-item, .item-topic'));
        } catch (e) { /* 忽略 */ }
      }
      if (els.length < 2) {
        this._pendingHuman = true;
        if (ZHS.panel) ZHS.panel.alert('这题要作答才能关，但自动找不到选项，请手动选一个', 'warn', 10000);
        ZHS.Log.warn('_ensureAnsweredThenClose 找不到选项元素，转人工');
        return false;
      }

      // 排序：优先已求解答案索引；其余选项仅在 gatedRandom 开启时才纳入尝试序列，
      // 否则只试已求解答案——没有正确答案绝不瞎蒙，统一转人工（遵守「没答完不关」）。
      const all = els.map((_, i) => i);
      const pref = (prefer || []).filter((i) => i >= 0 && i < els.length);
      const rest = ZHS.config.gatedRandom
        ? all.filter((i) => pref.indexOf(i) < 0)
        : [];
      const seq = pref.concat(rest);

      for (const i of seq) {
        const el = els[i];
        if (!el) continue;
        ZHS.Log.info('确保作答：尝试选项 ' + (i + 1) + '/' + els.length);
        try { await ZHS.Filler.clickOption(el); }
        catch (e) { try { el.click(); } catch (e2) { /* 忽略 */ } }
        await U.sleep(700);
        if (ZHS.Filler.isChecked(el)) {
          ZHS.Log.info('选项 ' + (i + 1) + ' 已确认选中，等待平台登记后关闭');
          await U.sleep(1200);
          const ok = await this.closeDialogAndResume({ noChannel: true });
          if (ok) { this._answeredSig = sig || ''; return true; }
          this._pendingHuman = true;
          if (ZHS.panel) ZHS.panel.alert('已选中答案但弹窗仍关不掉，请手动点关闭', 'warn', 10000);
          return false;
        }
      }

      // 逐个都选不中 → 遵守「没答完不关」，转人工
      this._pendingHuman = true;
      try { if (ZHS.Filler && ZHS.Filler.dumpDiag) ZHS.Filler.dumpDiag(root, els); } catch (e) { /* 诊断失败不影响主流程 */ }
      if (ZHS.panel) ZHS.panel.alert('这题要选中才能关，但自动点选没生效（可能是需真实点击的控件），请手动选一个', 'warn', 12000);
      ZHS.Log.warn('逐个选项均未确认选中，遵守「没答完不关」，转人工');
      this._resumePlay();
      return false;
    },

    /**
     * round-39b：当前 root（或页面）是否是 AI 助教随堂练习弹题（双变体）。
     */
    _isAiExercise(root) {
      try {
        if (root && root.matches && root.matches('.ai-test-question-wrapper, .ai-class-exercise-dialog')) return true;
        const scope = (root && root.querySelector) ? root : document;
        return !!scope.querySelector('.ai-test-question-wrapper, .ai-class-exercise-dialog');
      } catch (e) { return false; }
    },

    /** round-39b：AI 弹窗盒子是否仍可见（含祖先链 inline 隐藏判定，Element UI 藏 wrapper） */
    _aiBoxVisible(box) {
      try {
        if (!box || !document.contains(box)) return false;
        let n = box;
        while (n && n.style) {
          if (n.style.display === 'none' || n.style.visibility === 'hidden') return false;
          n = n.parentElement;
        }
        return U.isStructurallyVisible ? U.isStructurallyVisible(box) : true;
      } catch (e) { return false; }
    },

    /**
     * round-39b：AI 助教随堂练习弹题统一处理器（ocsjs 原厂 grounding）。
     * 双变体：.ai-test-question-wrapper（选项 .options .option，提交 .submit-btn .submits，关 .close-box）；
     *         .ai-class-exercise-dialog（选项 .ques-list .item .option / .option，提交 .el-dialog__footer .el-button，关 .header-icon）。
     * 流程：选一项（内嵌答案→求解→第一个）→ 点提交 → 点关闭 → 以「弹窗是否消失」验收 → 恢复播放。
     * 关键：**不依赖 isChecked**（AI 弹窗选中态常不可见），成功判据 = 弹窗关掉没。
     */
    async _handleAiExercise(root) {
      const video = ZHS.Player && ZHS.Player.video();
      if (video && !video.paused) { try { video.pause(); } catch (e) {} }
      let box = null;
      try {
        box = (root && root.querySelector)
          ? (root.querySelector('.ai-test-question-wrapper, .ai-class-exercise-dialog') || root)
          : document.querySelector('.ai-test-question-wrapper, .ai-class-exercise-dialog');
      } catch (e) { box = root || null; }
      if (!box) return;

      // 1) 选哪项：内嵌答案 > 求解(LLM/题库/启发式) > 第一个
      let idx = 0;
      try {
        let ans = null;
        try { ans = ZHS.Questions.Dialog.answerFromDom(); } catch (e) { ans = null; }
        if (!ans) {
          const q = ZHS.Questions.Dialog.readCurrent(box);
          if (q && q.options && q.options.length) {
            const r = await ZHS.Solver.solve({ title: q.title, options: q.options, type: q.type });
            if (r && r.answer) ans = r.answer;
          }
        }
        if (ans) { const ii = ZHS.Bank.toIndexes(ans); if (ii.length) idx = ii[0]; }
      } catch (e) { /* 求解失败用第一个 */ }

      // 2) 选项元素（双变体选择器优先，宽松回退）
      let opts = Array.from(box.querySelectorAll('.options .option, .ques-list .item .option, .option'));
      if (opts.length < 2) {
        const more = Array.from(box.querySelectorAll('.option, [role="option"], .option-item, .choice-item'));
        opts = opts.concat(more.filter((el) => opts.indexOf(el) < 0));
      }
      if (!opts.length) {
        ZHS.Log.warn('AI 随堂练习没找到选项元素，转人工');
        this._pendingHuman = true;
        if (ZHS.panel) ZHS.panel.alert('AI 随堂练习没识别到选项，请手动选一个', 'warn', 8000);
        return;
      }
      const pick = opts[Math.min(idx, opts.length - 1)] || opts[0];
      try { pick.click(); } catch (e) {}
      ZHS.Log.info('AI 随堂练习：已选第 ' + (opts.indexOf(pick) + 1) + '/' + opts.length + ' 项');
      await U.sleep(800);

      // 3) 提交（双变体 + 文本兜底）
      let submit = null;
      try {
        submit = box.querySelector('.submit-btn .submits, .el-dialog__footer button.el-button, .el-dialog__footer .el-button.btn, .submit-btn, .btn.submit');
      } catch (e) {}
      if (!submit) {
        try {
          submit = Array.from(box.querySelectorAll('button, .el-button, .btn'))
            .find((b) => /^(提交|确定|确认|提交答案)$/.test((b.textContent || '').replace(/\s+/g, ''))) || null;
        } catch (e) {}
      }
      if (submit) { try { submit.click(); ZHS.Log.info('AI 随堂练习：已点提交'); } catch (e) {} }
      await U.sleep(800);

      // 4) 关闭（提交后仍在才关）
      if (this._aiBoxVisible(box)) {
        let closeBtn = null;
        try {
          closeBtn = box.querySelector('.close-box, .header-icon, .el-dialog__close, .close-btn')
            || (box.closest('.el-dialog__wrapper') || box).querySelector('.close-box, .header-icon, .el-dialog__close, .close-btn');
        } catch (e) {}
        if (!closeBtn) {
          try {
            closeBtn = Array.from(box.querySelectorAll('button, .el-button, .btn, [class*="close"]'))
              .find((b) => /^(关闭|我知道了)$/.test((b.textContent || '').replace(/\s+/g, ''))) || null;
          } catch (e) {}
        }
        if (closeBtn) { try { closeBtn.click(); ZHS.Log.info('AI 随堂练习：已点关闭'); } catch (e) {} }
        await U.sleep(600);
      }

      // 5) 验收（弹窗消失）+ 恢复
      const gone = !this._aiBoxVisible(box);
      ZHS.Log.info(gone ? 'AI 随堂练习已处理并关闭' : 'AI 随堂练习已提交（弹窗仍在，下轮再判）');
      if (ZHS.Player) ZHS.Player.resetSync();
      ZHS.state.dialogActive = false;
      ZHS.state.dialogPhase = 'answered';
      if (video && video.paused && !video.ended) {
        // round-46：AI 弹窗处理完恢复播放，同样 resetHumanPause（与 _resumePlay 同理，
        // 弹题干预 = 「模拟离座」计划作废，避免跨干预继续计时导致到期假播报）
        if (ZHS.Player && ZHS.Player.resetHumanPause) ZHS.Player.resetHumanPause();
        try { video.muted = true; const p = video.play(); if (p && p.catch) p.catch(() => {}); ZHS.Log.info('AI 随堂练习后已恢复播放'); } catch (e) {}
      }
    },

    /**
     * round-39（ocsjs 原厂 grounding）：点 AI 助教弹窗的「提交/确定」按钮（若存在）。
     * 仅当页面上存在 AI 弹窗（.ai-test-question-wrapper / .ai-class-exercise-dialog）时才动，
     * 且限定在该弹窗作用域内点击——经典 #playTopic-dialog 选完直接关（ocsjs 即如此），不提交。
     * 原厂选择器：StudyPlusH5=.submit-btn .submits；WishdomH5=.el-dialog__footer .el-button.btn。
     */
    async _clickSubmitIfAny() {
      let box = null;
      try { box = document.querySelector('.ai-test-question-wrapper, .ai-class-exercise-dialog'); } catch (e) { return false; }
      if (!box) return false;
      const vis = (b) => { try { return b.offsetParent !== null || b.offsetWidth > 0; } catch (e) { return true; } };
      const SELS = ['.submit-btn .submits', '.el-dialog__footer .el-button.btn', '.submit-btn', '.btn.submit', '.confirm-btn', '.submit'];
      for (const s of SELS) {
        try {
          const btn = box.querySelector(s);
          if (btn && vis(btn)) { btn.click(); await U.sleep(500); ZHS.Log.info('已点击提交按钮：' + s); return true; }
        } catch (e) { /* 忽略 */ }
      }
      // 文本兜底（限定在 AI 弹窗内，且不含"下一题/关闭"，避免误推进）
      try {
        const txt = (el) => U.normText(el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent);
        const byText = Array.from(box.querySelectorAll('button, .el-button, .btn, [class*="submit"], [class*="confirm"], [class*="sure"]'))
          .filter((b) => /^(提交|确定|确认|提交答案)$/.test(txt(b)) && vis(b));
        if (byText.length) { byText[byText.length - 1].click(); await U.sleep(500); ZHS.Log.info('已点击提交按钮（文本匹配）'); return true; }
      } catch (e) { /* 忽略 */ }
      return false;
    },

    /**
     * 关闭弹题并恢复播放（N4 需求）
     * 策略：点关闭 → 校验是否真关了 → 没关就重试（最多 3 次，每次间隔递增）
     */
    async closeDialogAndResume(opts) {
      const noChannel = !!(opts && opts.noChannel);
      // round-39（ocsjs 原厂实现）：AI 助教弹窗流程是「选完选项 → 先点提交 → 再关」。
      // 漏了提交，平台会以「未提交答案」拒绝关闭 → 关不掉死循环（这正是用户实测的根因之一）。
      await this._clickSubmitIfAny();
      // round-50：给出时间 —— 答完题后平台需要一点时间登记作答，太早点 X 关闭
      // 会被平台以「未作答」拒绝（关不掉又回到死循环）。提交（若有）后先 settle 再关，
      // 对应用户在听课页要求的「给出时间 → 点击 X → 继续听课」顺序。
      await U.sleep(400);
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

    /**
     * 恢复播放（弹题处理完后）—— round-50 强化为「检测 → 播放 → 复检 → 没播就再点」闭环。
     *
     * 旧实现只做 `if (v.paused) v.play()` 且 play() 的 reject 被静默吞掉，
     * 视频没真播起来却被记成「已恢复播放」，表现就是用户报的「答完题、关掉弹窗，
     * 视频不接着放」。现改为严格顺序：
     *   ① resetHumanPause（弹题 = 切课级干预，幽灵态清掉，避免 ensurePlaying 被挡）
     *   ② 静音 + 倍速（平台会重置 muted，先静音绕过自动播放策略）
     *   ③ 给出时间：弹窗刚关，播放器 UI 与 video 状态需短暂同步，先 settle
     *   ④ 检测在不在播放：尝试「点真实播放按钮 + 裸 video.play() 兜底」，等一下再读 v.paused 复检
     *   ⑤ 没真播起来 → 按用户要求「再次选择播放」并复检，最多重试 3 次
     *   ⑥ 只有确认 !v.paused 才记「已恢复播放」；多次仍不行则交主循环 ensurePlaying 保活，不假报。
     */
    async _resumePlay() {
      try {
        if (ZHS.Player && ZHS.Player.resetHumanPause) ZHS.Player.resetHumanPause();
        const v = ZHS.Player && ZHS.Player.video();
        if (!v) return;
        const cfg = ZHS.config;
        if (cfg.mute) ZHS.Player.mute(v);
        ZHS.Player.setSpeed(v, cfg.speed);
        if (v.ended) { ZHS.Log.debug('弹题关闭后视频已结束，跳过恢复播放'); return; }

        // ③ 给出时间：弹窗刚关闭，播放器 UI 与 video 状态需要一点时间同步。
        //    立刻读 v.paused / 调 play() 可能仍停在弹题暂停态，或播放器内部状态拦截 play()。
        const tryResumeOnce = async () => {
          if (!v.paused) return true;                  // 已在播，无需动作
          // 先点真实播放按钮（自定义播放器常忽略裸 video.play()）
          if (ZHS.Player && ZHS.Player.clickPlayButton) ZHS.Player.clickPlayButton(v);
          // 再补一次裸 video.play() 兜底（已静音，绕过自动播放策略）
          if (v.paused) {
            const p = v.play();
            if (p && typeof p.catch === 'function') {
              try { await p; } catch (e) { ZHS.Log.debug('video.play() 被拒绝：' + e.message); }
            }
          }
          await U.sleep(700);
          return !v.paused;                            // ④ 复检：真的播起来才算
        };

        // ③ 先 settle，让播放器 UI 同步
        await U.sleep(300);

        // 第一轮
        if (await tryResumeOnce()) { ZHS.Log.info('弹题关闭后已恢复播放'); return; }

        // ⑤ 没真播起来 → 按用户要求「再次选择播放」并复检，最多重试 3 次
        for (let i = 1; i <= 3; i++) {
          ZHS.Log.warn('弹题关闭后视频未真正播放（第 ' + i + ' 次重试），再次点击播放');
          if (await tryResumeOnce()) { ZHS.Log.info('弹题关闭后经重试已恢复播放'); return; }
        }
        // ⑥ 多次仍不行：不假报「已恢复」，交主循环 ensurePlaying 保活（每 2 秒一轮）
        ZHS.Log.warn('弹题关闭后多次尝试仍未能恢复播放，交由主循环保活');
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
      this._lastSolvedIdxs = idxs.slice();   // round-37：记下求解答案索引，未选中时供逐个重试
      if (idxs.length) {
        for (const idx of idxs) {
          const flex = q.elementList[idx] ||
            root.querySelector('.topic .radio ul > li:nth-child(' + (idx + 1) + ')');
          if (flex) {
            // 改走 Filler.clickOption（round-37 已强化为多子目标 × 多点击方式 + 选中自检）。
            await ZHS.Filler.clickOption(flex);
            await U.sleep(600);
            // 自检：点击后确认选项真的处于选中态。没选中就再点一次整元素兜底
            if (!ZHS.Filler.isChecked(flex)) {
              try { flex.click(); } catch (e) { /* 忽略 */ }
              await U.sleep(500);
            }
            if (ZHS.Filler.isChecked(flex)) {
              answered = true;
              ZHS.state.answeredCount++;
              ZHS.Log.info('已作答：' + result.answer + '（来源 ' + result.from + '）');
            } else {
              // round-37：不再自欺「按默认视为已作答」。本题标记为未答上，
              // 由上层按「没答完不能关闭」逐个重试选项，确认选中后才关。
              this._noSelfCheck = true;
              ZHS.Log.warn('选项点击后仍未确认选中（本题记未答上，后续按「没答完不关」逐个重试）');
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
      this._countedSig = '';          // round-17：切课后重开计数闸门，新弹题可正常计数
    },
  };

  ZHS.Answerer = Answerer;
})();
