/**
 * 续播层：断点记录与恢复
 *
 * 存储用 GM_setValue（跨 iframe/页面共享，持久化到磁盘），
 * 无 GM 环境降级到 localStorage。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod04_resume) return;
  ZHS.__mod04_resume = true;
  const U = ZHS.Util;

  const STORE_KEY = 'zhs-helper-resume';
  const hasGM = typeof GM_setValue === 'function' && typeof GM_getValue === 'function';

  function readStore() {
    try {
      const raw = hasGM ? GM_getValue(STORE_KEY, null) : localStorage.getItem(STORE_KEY);
      if (!raw) return { courses: {} };
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!obj || typeof obj !== 'object') return { courses: {} };
      if (!obj.courses) obj.courses = {};
      return obj;
    } catch (e) {
      ZHS.Log.warn('续播记录损坏，已重置');
      return { courses: {} };
    }
  }

  function writeStore(store) {
    try {
      const raw = JSON.stringify(store);
      if (hasGM) GM_setValue(STORE_KEY, raw);
      else localStorage.setItem(STORE_KEY, raw);
      return true;
    } catch (e) {
      ZHS.Log.warn('续播记录写入失败：' + e.message);
      return false;
    }
  }

  const Resume = {
    _saveThrottled: null,
    _boundVideo: null,      // 当前绑定的 video 元素
    _bindId: -1,            // 绑定序号：防止旧监听器写入
    _bindSeq: 0,            // 自增计数器
    _lastDuration: 0,       // 上次记录的时长，用于换源时的比例换算
    _onTimeUpdate: null,
    _onPause: null,
    _onUnload: null,
    _restored: false,

    /** 保存当前进度（节流由调用方控制） */
    save(courseId, lessonKey, time, duration) {
      if (!courseId || !lessonKey) return;
      if (!Number.isFinite(time) || time < 5) return;   // 前 5 秒不值得记
      // 已接近结尾则不记（下次应从头或跳过）
      if (Number.isFinite(duration) && duration > 0 && time > duration - 10) return;

      const store = readStore();
      store.courses[courseId] = {
        lessonKey: lessonKey,
        time: Math.round(time * 10) / 10,
        duration: Number.isFinite(duration) ? Math.round(duration) : null,
        updatedAt: Date.now(),
        siteVersion: ZHS.state.siteVersion || 'unknown',
      };
      writeStore(store);
    },

    /** 读取某课程的记录（含过期清理） */
    load(courseId) {
      if (!courseId) return null;
      const store = readStore();
      const rec = store.courses[courseId];
      if (!rec) return null;
      const days = Number(ZHS.config.resumeExpireDays) || 7;
      const ageDays = (Date.now() - (rec.updatedAt || 0)) / 86400000;
      if (ageDays > days) {
        ZHS.Log.info('续播记录已过期（' + Math.round(ageDays) + ' 天），忽略');
        delete store.courses[courseId];
        writeStore(store);
        return null;
      }
      return rec;
    },

    /** 清除某课程记录 */
    clear(courseId) {
      const store = readStore();
      if (store.courses[courseId]) {
        delete store.courses[courseId];
        writeStore(store);
        ZHS.Log.info('已清除本课程的续播记录');
      }
    },

    /** 清空所有记录 */
    clearAll() {
      writeStore({ courses: {} });
      ZHS.Log.info('已清空全部续播记录');
    },

    /** 列出所有记录（面板用） */
    list() {
      const store = readStore();
      return Object.entries(store.courses).map(([id, rec]) => Object.assign({ courseId: id }, rec));
    },

    /**
     * 绑定 video：监听 timeupdate 定期保存
     *
     * 踩坑记录（真 bug，截屏测试抓出）：
     *   早期版本把「构造节流函数」写在「已绑定就返回」这条守卫**之前**，
     *   而 07-main 里 bindVideo 会被调用两次 —— 第二次调用虽然什么都没绑，
     *   却把 this._saveThrottled 覆盖成了一个**没被任何事件触发的**新函数，
     *   于是已经挂上的 timeupdate 监听器指向了那个死函数，进度永远存不下来。
     *
     * 现在的做法：
     *   1. 守卫放最前面，重复调用立即返回，不产生任何副作用
     *   2. 每次绑定存一个绑定 id，监听器回调只认「当前这一次」的绑定
     *   3. 顺带支持 duration 变化时的按比例换算（换清晰度/换视频源场景）
     */
    bindVideo(video, courseId, lessonKey) {
      if (!video || !courseId) return false;

      // 守卫前置：同一 video + 同一课程 + 同一课时 → 无需重绑（保留进度记录，避免重复绑定覆盖节流函数）
      if (this._boundVideo === video && this._boundCourse === courseId && this._boundLesson === lessonKey) return true;

      // 解绑旧的：视频元素被换掉，或 SPA 复用同一节点但切了课/切了节（闭包里的课程/课时标识需刷新）
      this._detach();
      this._lastDuration = 0;   // 切课/切节：清零旧时长，避免把旧课的时长比例套到新课算出错误恢复位置

      const bindId = ++this._bindSeq;
      this._boundVideo = video;
      this._bindId = bindId;

      const saveNow = (reason) => {
        if (bindId !== this._bindId) return;      // 已被后来的绑定取代
        if (!ZHS.config.resume) return;
        if (video.paused) return;
        const t = video.currentTime;
        const d = video.duration;
        if (!Number.isFinite(t) || t < 5) return;
        // duration 变了（换清晰度/换源）→ 把已记录的时间按比例换算，避免续播跳错位置
        let saveT = t;
        let saveD = d;
        if (Number.isFinite(d) && d > 0 && this._lastDuration > 0 && Math.abs(d - this._lastDuration) > 5) {
          const ratio = t / d;
          saveT = Math.round(ratio * this._lastDuration * 10) / 10;
          saveD = this._lastDuration;
          ZHS.Log.info('视频时长变化（' + Math.round(this._lastDuration) + 's → ' + Math.round(d)
            + 's），进度换算后记录为 ' + Math.round(saveT) + 's');
        }
        if (Number.isFinite(d) && d > 0) this._lastDuration = d;
        this.save(courseId, lessonKey, saveT, saveD);
      };

      this._saveThrottled = U.throttle(() => saveNow('timeupdate'),
        Number(ZHS.config.saveIntervalMs) || 5000);

      this._onTimeUpdate = () => { this._saveThrottled(); };
      this._onPause = () => {
        // 暂停时立刻存一次，防止关页面丢进度（绕过节流，直接算）
        if (bindId !== this._bindId) return;
        if (!ZHS.config.resume) return;
        const t = video.currentTime;
        if (!Number.isFinite(t) || t < 5) return;
        this.save(courseId, lessonKey, t, video.duration);
      };
      this._onUnload = () => {
        if (bindId !== this._bindId) return;
        if (!ZHS.config.resume) return;
        const t = video.currentTime;
        if (!Number.isFinite(t) || t < 5) return;
        this.save(courseId, lessonKey, t, video.duration);
      };

      video.addEventListener('timeupdate', this._onTimeUpdate);
      video.addEventListener('pause', this._onPause);
      // 关页面/切后台时兜底存一次
      try {
        window.addEventListener('pagehide', this._onUnload);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') this._onUnload();
        });
      } catch (e) { /* 忽略 */ }

      this._boundCourse = courseId;
      this._boundLesson = lessonKey;
      ZHS.Log.debug('已绑定进度记录到视频（bind#' + bindId + '，课程 ' + courseId + ' / 节 ' + lessonKey + '）');
      return true;
    },

    /** 解绑当前 video 上的监听 */
    _detach() {
      const v = this._boundVideo;
      if (!v) return;
      try {
        if (this._onTimeUpdate) v.removeEventListener('timeupdate', this._onTimeUpdate);
        if (this._onPause) v.removeEventListener('pause', this._onPause);
        if (this._onUnload) window.removeEventListener('pagehide', this._onUnload);
      } catch (e) { /* 忽略 */ }
      this._boundVideo = null;
      this._bindId = -1;
      this._boundCourse = null;
      this._boundLesson = null;
      this._saveThrottled = null;
    },

    /** 手动落盘一次（供面板/调试用） */
    flush() {
      const v = this._boundVideo;
      if (!v) return false;
      const t = v.currentTime;
      if (!Number.isFinite(t) || t < 5) return false;
      this.save(ZHS.state.courseId, ZHS.state.lessonKey, t, v.duration);
      return true;
    },

    /**
     * 恢复流程：
     * 1. 读记录 → 2. 定位课时 → 3. 等待 video → 4. seek 到记录点
     * 返回是否执行了恢复
     */
    async restore(courseId) {
      if (!ZHS.config.resume) return false;
      if (this._restored) return false;

      const rec = this.load(courseId);
      if (!rec || !rec.lessonKey) {
        ZHS.Log.info('没有可恢复的进度记录，从头开始');
        return false;
      }

      ZHS.Log.info('发现续播记录：' + rec.lessonKey + ' @ ' + Math.round(rec.time) + 's');

      // 定位并切到该课时
      const target = ZHS.Catalog.findByName(rec.lessonKey);
      if (!target) {
        ZHS.Log.warn('记录中的课时已不存在（' + rec.lessonKey + '），忽略记录');
        this.clear(courseId);
        return false;
      }

      const currentTitle = ZHS.Catalog.itemTitle(ZHS.Catalog.current());
      if (currentTitle === rec.lessonKey) {
        ZHS.Log.info('已在目标课时，直接恢复播放位置');
      } else {
        ZHS.Log.info('正在切换到：' + rec.lessonKey);
        ZHS.Catalog.click(target);
        await U.sleep(3000);   // 等切课加载
      }

      // 等 video 就绪
      const video = await U.waitFor('video', 20000);
      if (!video) {
        ZHS.Log.warn('未等到视频元素，恢复中断');
        return false;
      }

      // 等元数据加载
      await this._waitMetadata(video, 20000);

      const rewind = Number(ZHS.config.resumeRewind) || 2;
      const targetTime = Math.max(0, rec.time - rewind);

      // duration 变了（换了清晰度/新版视频），按比例换算
      let finalTime = targetTime;
      if (rec.duration && Number.isFinite(video.duration) && video.duration > 0
          && Math.abs(video.duration - rec.duration) > 5) {
        finalTime = (rec.time / rec.duration) * video.duration;
        ZHS.Log.info('视频时长变化，按比例换算恢复点：' + Math.round(finalTime) + 's');
      }

      await ZHS.Player.seekTo(video, finalTime);
      this._restored = true;
      ZHS.Log.info('已恢复到 ' + Math.round(finalTime) + 's 继续播放');
      return true;
    },

    /** 等待 video 元数据 */
    _waitMetadata(video, timeoutMs) {
      return new Promise((resolve) => {
        if (Number.isFinite(video.duration) && video.duration > 0) return resolve(true);
        const deadline = Date.now() + timeoutMs;
        const check = () => {
          if (Number.isFinite(video.duration) && video.duration > 0) return resolve(true);
          if (Date.now() > deadline) return resolve(false);
          setTimeout(check, 300);
        };
        video.addEventListener('loadedmetadata', () => resolve(true), { once: true });
        check();
      });
    },

    reset() { this._restored = false; },
  };

  ZHS.Resume = Resume;
})();
