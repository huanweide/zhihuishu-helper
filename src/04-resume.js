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
    _bound: false,
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
     */
    bindVideo(video, courseId, lessonKey) {
      if (!video || !courseId) return;
      this._saveThrottled = U.throttle(() => {
        if (video.paused) return;
        if (!ZHS.config.resume) return;
        this.save(courseId, lessonKey, video.currentTime, video.duration);
      }, Number(ZHS.config.saveIntervalMs) || 5000);

      if (this._bound && this._boundVideo === video) return;
      this._boundVideo = video;
      this._bound = true;

      video.addEventListener('timeupdate', () => {
        if (this._saveThrottled) this._saveThrottled();
      });
      video.addEventListener('pause', () => {
        // 暂停时立刻存一次，防止关页面丢进度
        if (ZHS.config.resume) {
          this.save(courseId, lessonKey, video.currentTime, video.duration);
        }
      });
      ZHS.Log.debug('已绑定进度记录到视频');
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
