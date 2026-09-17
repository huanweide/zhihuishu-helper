/**
 * 仿真页面的媒体打桩（仅供截屏测试使用）
 *
 * 为什么需要它：
 *   真实浏览器里，<video> 的 duration 只在真正加载了媒体资源后才有值。
 *   我们测试时不方便塞一个真实 mp4，用 canvas.captureStream() 的话
 *   duration 会是 Infinity（直播流语义），于是：
 *     · playbackRate 赋值被 Chrome 静默忽略（仍是 1）
 *     · atEnd / seek 判定全部失真
 *   所以这里用 defineProperty 打桩出有限时长，并在微任务里派发
 *   loadedmetadata，让「等元数据」的逻辑能正常走下去。
 *
 * 只在测试页面引入，绝不进 dist。
 */
(function () {
  'use strict';

  const DURATION = 300;   // 桩时长 300 秒，够跑「回退重试」等场景

  function stub(video, duration) {
    const dur = Number(duration) || DURATION;

    // duration 必须 writable:false + configurable:true，
    // 否则脚本里 `v.duration = x` 的兜底赋值会抛 TypeError
    Object.defineProperty(video, 'duration', {
      get() { return dur; },
      set() { /* 吃掉赋值，保持桩值 */ },
      configurable: true,
      enumerable: false,
    });

    // currentTime：取值时若已到末尾，钳到 duration 之前，
    // 模拟真实浏览器的行为（不会超过媒体长度）
    let _ct = 0;
    Object.defineProperty(video, 'currentTime', {
      get() { return _ct > dur ? dur : _ct; },
      set(v) {
        const n = Number(v);
        _ct = Number.isFinite(n) ? Math.max(0, n) : 0;
      },
      configurable: true,
      enumerable: false,
    });

    // 时间推进器：真实浏览器里 play() 后 currentTime 自己会涨。
    // 无头环境里桩不会自己涨，所以用一个定时器按 playbackRate 模拟推进，
    // 并派发 timeupdate —— 否则「进度保存 / 断点续播」这类逻辑根本触发不到。
    let _paused = true;
    let _playing = false;
    let _ticker = null;
    const TICK_MS = 250;

    function startTicker() {
      if (_ticker) return;
      let last = Date.now();
      _ticker = setInterval(() => {
        if (!_playing || _paused) { last = Date.now(); return; }
        const now = Date.now();
        const rate = Number(video.playbackRate) || 1;
        _ct = Math.min(dur, _ct + ((now - last) / 1000) * rate);
        last = now;
        video.dispatchEvent(new Event('timeupdate'));
        if (_ct >= dur) {
          video.dispatchEvent(new Event('ended'));
          _playing = false;
          _paused = true;
        }
      }, TICK_MS);
    }
    startTicker();

    Object.defineProperty(video, 'paused', {
      get() { return _paused; },
      configurable: true,
      enumerable: false,
    });
    Object.defineProperty(video, 'ended', {
      get() { return _ct >= dur; },
      configurable: true,
      enumerable: false,
    });

    video.play = function () {
      if (_ct >= dur) return Promise.resolve();
      _paused = false;
      _playing = true;
      video.dispatchEvent(new Event('play'));
      return Promise.resolve();
    };
    video.pause = function () {
      _paused = true;
      _playing = false;
      video.dispatchEvent(new Event('pause'));
    };

    // playbackRate / volume 照常赋值，保证测的是「给没给倍速」这件事本身

    video.__hasSrc = () => true;
    video.__isPlaying = () => _playing;
    video.__rawDuration = () => dur;

    // 元数据已就绪 → 立刻通知，脚本的 _waitMetadata 才能拿到 duration
    Promise.resolve().then(() => {
      video.dispatchEvent(new Event('loadedmetadata'));
      video.dispatchEvent(new Event('durationchange'));
    });

    return video;
  }

  window.__FixtureMedia = { stub, DURATION };
})();
