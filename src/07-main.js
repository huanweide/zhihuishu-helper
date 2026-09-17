/**
 * 主入口：初始化 + SPA 监听
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  const U = ZHS.Util;

  let initialized = false;

  async function boot() {
    if (initialized) return;
    initialized = true;

    ZHS.Log.info('=== 初始化开始 ===');

    // 1. 识别页面版本
    ZHS.Catalog.redetect();

    // 2. 课程标识
    ZHS.state.courseId = ZHS.Catalog.getCourseId();
    ZHS.Log.info('课程 ID：' + ZHS.state.courseId);

    // 3. 等视频出现（有些页面懒加载）
    const video = await U.waitFor('video', 30000);
    if (!video) {
      ZHS.Log.warn('30 秒内未找到视频元素，可能不在播放页');
      if (ZHS.panel) ZHS.panel.mount();  // 面板仍挂载，方便手动操作
      return;
    }
    ZHS.state.videoEl = video;
    ZHS.Log.info('视频元素已就绪，时长 ' + Math.round(video.duration || 0) + 's');

    // 4. 挂载面板
    if (ZHS.panel) ZHS.panel.mount();

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
      // 页面还没初始化但出现视频 → 补启动
      if (!initialized && v) boot();
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
    start: () => ZHS.Scheduler.start(),
    stop: () => ZHS.Scheduler.stop(),
    config: (p) => ZHS.setConfig(p),
    next: () => ZHS.Scheduler.gotoNext('手动'),
    clearResume: () => ZHS.Resume.clear(ZHS.state.courseId),
    logs: () => ZHS.Log.all(),
    stats: () => ZHS.Catalog.stats(),
  };
})();
