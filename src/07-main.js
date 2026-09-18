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

  async function bootOnce() {
    ZHS.Log.info('=== 初始化开始 ===');

    // 0. 面板最先挂载：后续任何一步炸了，用户至少能看见脚本存在
    //    （原来排在第 3 步，且整条链无 try/catch → 前一步出错就永远看不到面板）
    if (ZHS.panel) {
      try { ZHS.panel.mount(); }
      catch (e) { ZHS.Log.warn('面板挂载失败：' + e.message); }
    } else {
      // 挂不上必须说出来。静默跳过的话，用户眼里就是「装了跟没装一样」。
      ZHS.Log.error('面板模块不可用（ZHS.panel 未定义），界面不会显示；核心逻辑仍会继续尝试');
    }

    // 1. 识别页面版本
    ZHS.Catalog.redetect();

    // 2. 课程标识
    ZHS.state.courseId = ZHS.Catalog.getCourseId();
    ZHS.Log.info('课程 ID：' + ZHS.state.courseId);

    // 3. 面板先挂载：不等视频，进来就能看到界面。
    //    以前写在 waitFor 之后，在作业页 / 尚未进入播放页时要干等 30 秒才出面板，
    //    用户会误以为脚本没装上（BUG-UX-2）。
    if (ZHS.panel) ZHS.panel.mount();

    // 4. 等视频出现（有些页面懒加载）
    const video = await U.waitFor('video', 30000);
    if (!video) {
      ZHS.Log.warn('30 秒内未找到视频元素，可能不在播放页');
      if (ZHS.panel) {
        ZHS.panel.alert('未检测到视频，可能尚未进入播放页；面板可正常使用，进播放页后会自动开始', 'warn', 10000);
      }
      return;
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
    ZHS.Log.info('=== 初始化完成 ===');
  }

  /** SPA 路由变化监听：DOM 重建后重新初始化 */
  function watchSpa() {
    const onDomChange = U.debounce(() => {
      // 视频元素被替换 → 重新绑定，但不重启整套流程
      const v = document.querySelector('video');
      if (v && v !== ZHS.state.videoEl) {
        ZHS.Log.debug('检测到视频元素变化，重新绑定');
        ZHS.state.videoEl = v;
        const cur = ZHS.Catalog.current();
        if (cur) ZHS.state.lessonKey = ZHS.Catalog.itemTitle(cur);
        ZHS.Resume.bindVideo(v, ZHS.state.courseId, ZHS.state.lessonKey);
      }
      // 页面还没初始化但出现视频 → 补启动（含启动失败后的重试，受次数上限约束）
      if (!initialized && bootTries < BOOT_MAX_TRIES && v) boot();
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
