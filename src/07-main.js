/**
 * 主入口：初始化 + SPA 监听
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod07_main) return;
  ZHS.__mod07_main = true;
  const U = ZHS.Util;

  let initialized = false;
  let bootTries = 0;
  const BOOT_MAX_TRIES = 3;

  /**
   * round-14：面板外兜底提示条。
   *
   * 背景：面板是脚本唯一的可见界面。一旦 ZHS.panel 缺失或 mount 失败，
   * 原代码只写一行 ZHS.Log.error —— 而日志恰恰是写进「面板自己的日志缓冲」里的，
   * 面板正是此刻看不见的那个东西，等于零提示；普通用户也不会开 F12。
   * 结果就是「脚本在后台照常跑，用户一个界面元素都看不到」= 用户报的「装了跟没装一样」。
   *
   * 这里直接在页面根节点挂一条固定定位的红条，不依赖面板、不依赖 Shadow DOM，
   * 只用最朴素的 DOM 操作，尽可能在任何环境下都能显示出来。
   */
  function showPanelMissingNotice(detail) {
    try {
      if (document.getElementById('zhs-panel-missing-notice')) return;   // 去重
      const bar = document.createElement('div');
      bar.id = 'zhs-panel-missing-notice';
      bar.setAttribute('style',
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;'
        + 'background:#e74c3c;color:#fff;font-size:13px;line-height:1.7;'
        + 'padding:8px 14px;text-align:center;font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;'
        + 'box-shadow:0 2px 8px rgba(0,0,0,.25)');
      bar.textContent = '智慧树助手：脚本正在后台运行，但控制面板初始化失败'
        + (detail ? '（' + detail + '）' : '')
        + '。请刷新页面重试；若仍不显示，可在控制台执行 zhs.boot()。';
      // 点一下可关闭，不打扰用户
      bar.addEventListener('click', () => { try { bar.remove(); } catch (e) { /* 忽略 */ } });
      (document.body || document.documentElement).appendChild(bar);
      ZHS.Log.warn('已显示面板外兜底提示条（面板不可用）');
    } catch (e) { /* 连兜底条都挂不上，只能留在日志里 */ }
  }

  /**
   * 启动外壳：负责「失败要能看得见，且允许重试」
   *
   * 【2026-09-19 修正】原来的 boot() 第一句就是 `initialized = true`。
   * 这意味着只要中间任何一步抛异常（新版页面对抗、某个 DOM 访问越界、
   * 平台改版导致选择器非法……），boot 会中断在半路，但 initialized 已经置真，
   * 于是 watchSpa() 里那条「页面还没初始化但出现视频 → 补启动」的自愈通道永久失效。
   * 后果正是用户反馈的那句：**装了 27 次，面板都没有，跟没装一样** ——
   * 脚本其实跑了，只是跑一半死在没人看得见的地方。
   *
   * 现在改成三件事：
   *   1. 成功跑完才算初始化完成（initialized 移到末尾）
   *   2. 失败要看得见：先把面板挂上再报错，用户至少知道脚本在
   *   3. 允许重试（最多 3 次），失败后交给 watchSpa 在 DOM 稳定时再来
   */
  async function boot() {
    if (initialized || bootTries >= BOOT_MAX_TRIES) return;
    bootTries++;
    try {
      await bootOnce();
      initialized = true;
    } catch (e) {
      const msg = (e && e.message) || String(e);
      initialized = false;   // 认账只在成功时做，这里保持「未初始化」才能被自愈通道救回
      // 区分「还没进播放页（等自愈）」与「真出错」：前者用 info 不刷红，避免误导用户以为坏了
      if (msg === 'NO_VIDEO_YET') {
        ZHS.Log.info('尚未进入播放页（无视频元素），进入课程后自动启动');
      } else {
        ZHS.Log.error('初始化失败（第 ' + bootTries + '/' + BOOT_MAX_TRIES + ' 次）：' + msg);
        try {
          if (ZHS.panel) {
            ZHS.panel.mount();
            ZHS.panel.alert('脚本启动异常：' + msg + '。可刷新页面重试，或在控制台执行 zhs.boot()', 'error', 15000);
          }
        } catch (e2) { /* 连面板都挂不上，只能留在日志里 */ }
        if (bootTries < BOOT_MAX_TRIES) ZHS.Log.info('将在页面 DOM 变化后自动重试启动');
      }
    }
  }

  async function bootOnce() {
    ZHS.Log.info('=== 初始化开始 ===');

    // 0. 面板最先挂载：后续任何一步炸了，用户至少能看见脚本存在
    //    （原来排在第 3 步，且整条链无 try/catch → 前一步出错就永远看不到面板）
    if (ZHS.panel) {
      try { ZHS.panel.mount(); }
      catch (e) {
        ZHS.Log.warn('面板挂载失败：' + e.message);
        showPanelMissingNotice('挂载异常');
      }
    } else {
      // 挂不上必须说出来。静默跳过的话，用户眼里就是「装了跟没装一样」。
      ZHS.Log.error('面板模块不可用（ZHS.panel 未定义），界面不会显示；核心逻辑仍会继续尝试');
      showPanelMissingNotice('模块未就绪');
    }

    // 1. 识别页面版本
    ZHS.Catalog.redetect();

    // 2. 课程标识
    ZHS.state.courseId = ZHS.Catalog.getCourseId();
    ZHS.Log.info('课程 ID：' + ZHS.state.courseId);

    // 3. 面板先挂载：不等视频，进来就能看到界面。
    //    以前写在 waitFor 之后，在作业页 / 尚未进入播放页时要干等 30 秒才出面板，
    //    用户会误以为脚本没装上（BUG-UX-2）。
    //    注意：此处必须 try/catch 包裹——若面板挂载持续失败（如模板改坏），
    //    裸调用会把异常抛给 bootOnce → 被 boot 记成「初始化失败」→ Scheduler 永不启动，
    //    整脚本（含核心逻辑）都不跑，正是「装了但功能全无用」的直接成因（round-7 面板①）。
    if (ZHS.panel) {
      try { ZHS.panel.mount(); } catch (e) { ZHS.Log.warn('面板二次挂载失败：' + e.message); }
    }

    // 4. 等视频出现（有些页面懒加载）
    let video = await U.waitFor('video', 30000);
    if (!video && ZHS.Util.findVideoInIframes) video = ZHS.Util.findVideoInIframes(document);
    if (!video) {
      ZHS.Log.warn('30 秒内未找到视频元素（含 iframe 兜底），可能不在播放页');
      if (ZHS.panel) {
        ZHS.panel.alert('未检测到视频，可能尚未进入播放页；面板可正常使用，进播放页后会自动开始', 'warn', 10000);
      }
      // 抛出而非 return：让 boot() 捕获后保持 initialized=false，
      // 这样从「课程中心页 → 点进课程页出现 video」时，watchSpa 能重新拉起初始化。
      // 若直接 return，bootOnce 判为「成功返回」，boot() 会把 initialized 误置 true，
      // 自愈通道永久失效，表现正是用户说的「装了但进了课程页毫无动静」。
      throw new Error('NO_VIDEO_YET');
    }
    ZHS.state.videoEl = video;
    ZHS.Log.info('视频元素已就绪，时长 ' + Math.round(video.duration || 0) + 's');

    // 5. 尝试断点恢复
    await ZHS.Resume.restore(ZHS.state.courseId);

    // 6. 当前课时标识 + 绑定进度记录
    const cur = ZHS.Catalog.current();
    ZHS.state.lessonKey = cur ? ZHS.Catalog.itemTitle(cur) : ZHS.Catalog.itemTitle(ZHS.Catalog.items()[0]);
    ZHS.Log.info('当前课时：' + ZHS.state.lessonKey);
    ZHS.Resume.bindVideo(video, ZHS.state.courseId, ZHS.state.lessonKey);

    // 7. 开跑
    ZHS.Scheduler.start();

    const stats = ZHS.Catalog.stats();
    ZHS.Log.info('课程进度：' + stats.done + '/' + stats.total + ' (' + stats.percent + '%)');
    // 成功初始化后给一个明确提示，让用户确信「脚本装上了、在干活」（回应面板首跑可见性）
    if (ZHS.panel) ZHS.panel.alert('智慧树助手已就绪，开始自动学习', 'info', 4000);
    ZHS.Log.info('=== 初始化完成 ===');
  }

  /** SPA 路由变化监听：DOM 重建后重新初始化 */
  function watchSpa() {
    const onDomChange = U.debounce(() => {
      // 切课检测：courseId 变了（SPA 不刷新页面直接换课）→ 重置目录缓存与断点上下文，
      // 否则会残留旧课程的 courseId/lessonKey，导致 gotoNext 跳错节或把进度记到别的课。
      const newCourseId = ZHS.Catalog.getCourseId();
      if (newCourseId && newCourseId !== 'unknown-course' && newCourseId !== ZHS.state.courseId) {
        ZHS.Catalog.resetCatalogCache();
        ZHS.state.courseId = newCourseId;
        ZHS.Log.info('检测到切换课程，已重置目录缓存与断点上下文 → ' + newCourseId);
      }
      // 当前课时变化（同课程内切章节，或切课后）同步 state，避免 gotoNext 用旧 lessonKey 定位错节
      const cur = ZHS.Catalog.current();
      const newLessonKey = cur ? ZHS.Catalog.itemTitle(cur) : null;
      if (newLessonKey && newLessonKey !== ZHS.state.lessonKey) {
        ZHS.state.lessonKey = newLessonKey;
        ZHS.Log.debug('当前课时更新：' + newLessonKey);
      }

      // 视频元素被替换 → 重新绑定，但不重启整套流程
      const v = document.querySelector('video');
      if (v && v !== ZHS.state.videoEl) {
        ZHS.Log.debug('检测到视频元素变化，重新绑定');
        ZHS.state.videoEl = v;
        bootTries = 0; // round-11：视频重新出现时重置 boot 名额，避免 SPA 切集后永久失活
        if (newLessonKey) ZHS.state.lessonKey = newLessonKey;
        ZHS.Resume.bindVideo(v, ZHS.state.courseId, ZHS.state.lessonKey);
      }
      // 页面还没初始化但出现视频 → 补启动（含启动失败后的重试，受次数上限约束）
      if (!initialized && bootTries < BOOT_MAX_TRIES && v) boot();
      // round-14：瞬时故障（目录临时读不到 / 节点临时定位不到 / 连点无反应）导致的停机，
      // 在视频恢复后允许受限自愈重启；用户主动停 / 达标停不受影响（内部有原因判定与冷却/次数上限）
      if (ZHS.Scheduler && ZHS.Scheduler.tryResumeAfterTransientStop) {
        ZHS.Scheduler.tryResumeAfterTransientStop();
      }
    }, 1000);

    try {
      const obs = new MutationObserver(onDomChange);
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      ZHS.Log.debug('MutationObserver 启动失败：' + e.message);
    }
  }

  // ===== 启动时机 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { boot(); watchSpa(); });
  } else {
    boot();
    watchSpa();
  }

  // 暴露手动控制
  window.zhs = {
    boot,
    start: () => ZHS.Scheduler.start({ manual: true }),
    stop: () => ZHS.Scheduler.stop(),
    config: (p) => ZHS.setConfig(p),
    next: () => ZHS.Scheduler.gotoNext('手动', { manual: true }),
    clearResume: () => ZHS.Resume.clear(ZHS.state.courseId),
    logs: () => ZHS.Log.all(),
    stats: () => ZHS.Catalog.stats(),
  };
})();
