/**
 * 播放层：视频控制（静音、倍速、防暂停、进度回退重试）
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod03_player) return;
  ZHS.__mod03_player = true;
  const U = ZHS.Util;

  // 结尾判定阈值：播放到 99.5% 就算结束
  const END_RATIO = 0.995;
  // 播放卡死阈值：120 秒 currentTime 不推进就判定卡住
  const STALL_MS = 120000;
  // 进度对账容差：播放器超前平台记录超过这个秒数就拉回（Autovisor learn_lesson 同值）
  const SYNC_LEAD_SECONDS = 15;

  const Player = {
    _lastTime: -1,
    _lastActiveAt: Date.now(),
    _retryCount: 0,
    _syncedKey: null,        // 已对过账的课时标识（避免同一节内反复 seek）
    // round-45：拟人化随机暂停状态。
    // _humanPauseUntil = 本次「模拟离座」的截止时间戳（0 = 不在暂停期）；
    // _humanPauseLastMs 记录上一次暂停了多久（恢复播报用）；
    // _humanPauseResumeLogged 保证「回来了」只播报一次。
    _humanPauseUntil: 0,
    _humanPauseLastMs: 0,
    _humanPauseResumeLogged: true,

    /** 取当前 video 元素（缓存 + 校验是否还在文档里；顶层找不到再查同域 iframe） */
    video() {
      const cached = ZHS.state.videoEl;
      if (cached && document.contains(cached)) return cached;
      let v = document.querySelector('video');
      if (!v && ZHS.Util.findVideoInIframes) v = ZHS.Util.findVideoInIframes(document);
      if (v) ZHS.state.videoEl = v;
      return v;
    },

    /** duration 是否有效 */
    hasValidDuration(v) {
      if (!v) return false;
      return Number.isFinite(v.duration) && v.duration > 0;
    },

    /** 是否播放到结尾 */
    atEnd(v) {
      if (!v) return false;
      if (v.ended) return true;
      if (!this.hasValidDuration(v)) return false;
      return v.currentTime / v.duration >= END_RATIO;
    },

    /** 当前进度百分比 */
    percent(v) {
      if (!this.hasValidDuration(v)) return 0;
      return Math.min(100, Math.round((v.currentTime / v.duration) * 100));
    },

    /**
     * 静音（温和交互层 P3 · docs/31 D2）
     *
     * L1：点击平台静音按钮（.volumeBox 等），让页面自己的代码切静音；
     * L3：按钮不可用或点击未生效才直改 volume=0（volume 比 muted 属性稳，
     *     平台会重置 muted——回落保留此已知最稳路径，能力不缩水）。
     * 已静音时直接返回（切换键语义：再点会取消静音）。
     */
    async mute(v) {
      if (!v) return;
      try {
        if (v.muted || v.volume === 0) return;   // 已静音：绝不点切换键
        // L1：点击静音按钮（播放器壳内优先）
        const host = (v.closest && v.closest(
          '.prism-player, .video-js, .txp-wrapper, .txp-video-container, .player, .playBox, .video-container'
        )) || document;
        const SELS = ['.volumeBox', '.prism-volume', '.vjs-mute-control', '[class*="muteBtn"]', '[class*="mute-btn"]'];
        let clicked = false;
        for (const s of SELS) {
          let btn = null;
          try { btn = host.querySelector(s); } catch (e2) { /* 单选择器失败不影响其它 */ }
          if (btn && this._visible(btn)) {
            const fire = U.realClickHuman || U.realClick || ((x) => { x.click(); return true; });
            if (fire(btn)) { clicked = true; break; }
          }
        }
        // 验收：0.9s 内轮询确认页面真的切了静音
        if (clicked) {
          const deadline = Date.now() + 900;
          while (Date.now() < deadline) {
            if (v.muted || v.volume === 0) {
              ZHS.Log.debug('已通过平台静音按钮静音');
              return;
            }
            if (U.sleep) await U.sleep(150); else await new Promise((r) => setTimeout(r, 150));
          }
          ZHS.Log.debug('静音按钮点击未生效，降级直接设置 volume=0');
        }
        // L3 兜底：volume=0 比 muted 属性更稳，平台会重置 muted
        v.volume = 0;
        v.muted = true;
        const box = document.querySelector('.volumeBox');
        if (box) box.classList.add('volumeNone');
      } catch (e) { /* 忽略 */ }
    },

    /**
     * 设置倍速（温和交互层 P1 · docs/31-温和交互层升级方案.md D1）
     *
     * L1：hover 展开平台倍速菜单 → 拟真点击目标档位项，让页面自己的代码改
     *     playbackRate 并同步 UI——脚本不直改属性、不手改 span（旧实现直改后
     *     手动同步 .speedBox span，自造了「播放器内部≠界面」的检测点）。
     * L3：菜单点不到（CSS :hover 展开 JS 合成不了 / 跨域 iframe / 改版）才
     *     回落直改 + 同步 UI（能力不缩水），并打日志说明降级原因。
     *
     * 硬上限 1.5 —— 与 00-config.js 的配置钳位保持同一数值。
     */
    async setSpeed(v, speed) {
      if (!v) return;
      const s = Math.min(Math.max(Number(speed) || 1, 0.5), 1.5);
      try {
        if (Math.abs(v.playbackRate - s) > 0.01) {
          if (!(await this._clickSpeedMenuItem(v, s))) {
            // L3 回落：直改 + 同步 UI（菜单不可用时与旧行为一致）
            v.playbackRate = s;
            const span = document.querySelector('.speedBox span');
            if (span) span.innerText = 'X ' + s;
            ZHS.Log.debug('倍速菜单未生效，已降级直改 playbackRate=' + s);
          }
        }
      } catch (e) { /* 忽略 */ }
    },

    /**
     * L1 温和路径：点击平台倍速菜单项（温和交互层 P1）
     *
     * 选择器依据 docs/01-侦察报告：`.speedBox` / `.speedList [rate="1.5"]` /
     * `.speedTab15`（1.5 档独立 tab）。已知坑（docs/03-踩坑记录）：部分版本
     * rate 属性 "1" 与 "1.0" 双写——用 parseFloat 归一化匹配，天然兼容。
     *
     * CSS :hover 伪类展开的菜单 JS 合成不了（浏览器安全限制），此时如实返回
     * false 交给 L3 回落；JS 监听 mouseenter/mauseover 展开的版本则可正常触发。
     *
     * @returns {Promise<boolean>} 是否走通了菜单点击且页面真的改了速率
     */
    async _clickSpeedMenuItem(v, target) {
      try {
        const box = document.querySelector('.speedBox');
        const list = document.querySelector('.speedList');
        if (!box && !list) return false;

        // ① 拟人 hover：mousemove → mouseover/mouseenter 派发到控制栏与倍速盒，
        //   触发页面自己的「hover 展开菜单」逻辑（JS 监听型）
        const ev = (el, type) => {
          try {
            const r = el.getBoundingClientRect();
            el.dispatchEvent(new MouseEvent(type, {
              bubbles: true, cancelable: true, view: window,
              clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
            }));
          } catch (e2) { /* 忽略单个事件失败 */ }
        };
        const bar = document.querySelector('.controlsBar');
        for (const el of [bar, box, list]) {
          if (!el) continue;
          ev(el, 'mousemove');
          ev(el, 'mouseover');
          ev(el, 'mouseenter');
        }
        // 拟人反应时间：等页面 JS 展开菜单
        if (U.sleep) await U.sleep(150 + Math.round(Math.random() * 250));

        // ② 菜单可见性：getComputedStyle 判定（jsdom/真机一致；不依赖 offsetParent）
        if (!list) return false;
        try {
          const cs = getComputedStyle(list);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        } catch (e2) { /* 读不到样式时按可见处理，继续尝试点击 */ }

        // ③ 找目标档位项：rate 属性匹配（parseFloat 归一化，兼容 "1"/"1.0"）→ 文本数字兜底
        const items = Array.from(list.querySelectorAll('[rate], li'));
        const num = (el) => {
          const attr = el.getAttribute && el.getAttribute('rate');
          if (attr) return parseFloat(attr);
          const t = (el.textContent || '').replace(/[^0-9.]/g, '');
          return parseFloat(t);
        };
        const item = items.find((el) => Number.isFinite(num(el)) && Math.abs(num(el) - target) < 0.001);
        if (!item) return false;

        // ④ 拟真点击菜单项（真机教训：裸 click() 在智慧树目录上曾整页跳门户）
        const fire = U.realClickHuman || U.realClick || ((x) => { x.click(); return true; });
        if (!fire(item)) return false;

        // ⑤ 验收：读 playbackRate 确认页面真的改了（1.2s 内轮询，页面 handler 可能异步）
        const deadline = Date.now() + 1200;
        while (Date.now() < deadline) {
          if (Math.abs(v.playbackRate - target) < 0.01) {
            ZHS.Log.debug('倍速已通过平台菜单点击生效：' + target);
            return true;
          }
          if (U.sleep) await U.sleep(150); else await new Promise((r) => setTimeout(r, 150));
        }
        return false;
      } catch (e) {
        return false;
      }
    },

    /**
     * 确保播放：暂停且未结束 → 尝试恢复
     * 返回是否触发了播放
     *
     * 温和交互层 P2（docs/31）：优先点击播放器自带的播放按钮（UI 层，页面自己的
     * 代码恢复播放），验收 1.2s 内真的播起来；按钮不存在或点了没反应才降级裸
     * v.play() 兜底——能力不缩水，降级打日志可审计。
     */
    async ensurePlaying(v) {
      if (!v || v.ended) return false;
      // round-45：拟人化暂停期内绝不唤醒 —— 这是「模拟真人离开」，
      // 唤醒它等于把最像人的一段节奏亲手毁掉。到期由下一轮自然恢复。
      if (this.isHumanPausing()) return false;
      if (!v.paused) { this._markActive(v); return false; }
      if (!this.hasValidDuration(v) && v.currentTime === 0) {
        // 还没加载元数据，等一等
        return false;
      }
      try {
        await this.mute(v);                 // 必须静音才能绕过自动播放策略（P3 温和化）
        // P2：L1 点击播放器播放按钮 → 验收真的播了
        if (this.clickPlayButton(v)) {
          const deadline = Date.now() + 1200;
          while (Date.now() < deadline) {
            if (!v.paused) {
              ZHS.Log.debug('已通过播放器播放按钮恢复播放');
              return true;
            }
            if (U.sleep) await U.sleep(150); else await new Promise((r) => setTimeout(r, 150));
          }
          ZHS.Log.debug('播放按钮点击未生效，降级直接调用 play()');
        }
        // L3 兜底：裸 play
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
        ZHS.Log.debug('检测到暂停，已尝试恢复播放');
        return true;
      } catch (e) {
        ZHS.Log.debug('恢复播放失败：' + e.message);
        return false;
      }
    },

    /** 元素可见性（getComputedStyle 判定；jsdom 与真机行为一致，不依赖布局的 offsetParent） */
    _visible(el) {
      try {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      } catch (e) { /* 读不到样式按可见处理 */ }
      return true;
    },

    /**
     * 点击播放器的真实「播放」按钮（round-50，对应「再次选择播放」）。
     *
     * 为什么需要：智慧树部分课程用 prism-player / video.js / 腾讯云 txp 这类自定义播放器，
     * 弹题关闭后直接调裸 video.play() 常被播放器内部状态拦截（或要求真实用户手势），
     * 表现为「视频没真播起来、却已记成已恢复」。点击控件自身的播放按钮能绕开这个拦截，
     * 让「检测在不在播放 → 没播就再点一次」闭环成立。
     *
     * 安全约束：
     *   · 仅当 video 处于暂停态才点（播放按钮是切换键，已播放时点击反而暂停）；
     *   · 全程防御性 try/catch + 存在性/可见性判断，找不到按钮就静默返回 false，
     *     交给裸 video.play() 兜底，绝不让本函数抛错影响主流程；
     *   · 跨域 iframe 内的播放按钮 querySelector 取不到，此时本函数自然返回 false，
     *     由裸 video.play() 在同一 iframe 内兜底（跨域则无解，与旧行为一致）。
     *
     * @returns {boolean} 是否找到了可见播放按钮并点击
     */
    clickPlayButton(v) {
      if (!v || !v.paused) return false;   // 已在播或非法 → 不点（避免切换成暂停）
      return this._clickPlayToggle(v);
    },

    /**
     * 播放/暂停切换键点击（无 paused 守卫的内核）。
     * 温和交互层 P4：maybeHumanPause「模拟离座」时播放中点它 = 点暂停键，最像真人。
     * 可见性用 getComputedStyle 判定（jsdom 无布局，offsetParent 恒 null 会误杀）。
     * @returns {boolean} 是否找到可见切换键并点击
     */
    _clickPlayToggle(v) {
      try {
        // 播放器容器优先级：video 的祖先播放器壳 > document
        const host = (v.closest && v.closest(
          '.prism-player, .video-js, .txp-wrapper, .txp-video-container, .player, .playBox, .video-container, .prism-player-wraper'
        )) || document;
        const SELS = [
          '.prism-play-btn', '.prism-big-play-btn',                 // 阿里云 / Polyv prism
          '.vjs-play-control', '.vjs-big-play-button',              // video.js
          '.txp-button-play', '.txp_play',                          // 腾讯云 txp
          '[class*="playBtn"]', '[class*="play-btn"]', '[class*="playButton"]',
          'button[aria-label*="播放"]', 'button[title*="播放"]',
          '.play-button', '.btn-play',                              // 通用
        ];
        const fire = U.realClickHuman || U.realClick || ((x) => { x.click(); return true; });
        for (const s of SELS) {
          try {
            const btns = host.querySelectorAll(s);
            for (const b of btns) {
              // 只点可见按钮（big-play 在已播态常被隐藏，点了无效）
              if (b && this._visible(b)) {
                fire(b);
                ZHS.Log.debug('已点击播放器播放/暂停切换键：' + s);
                return true;
              }
            }
          } catch (e) { /* 单选择器失败不影响其它 */ }
        }
        // 文本兜底：容器内唯一的「播放 / 开始 / ▶」按钮
        try {
          const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, '');
          const byText = Array.from(host.querySelectorAll(
            'button, [role="button"], .el-button, .btn, [class*="play"]'
          )).find((b) => /^(播放|开始|▶|►)$/.test(txt(b)) && this._visible(b));
          if (byText) { fire(byText); ZHS.Log.debug('已点击播放按钮（文本匹配）'); return true; }
        } catch (e) { /* 忽略 */ }
        return false;
      } catch (e) {
        ZHS.Log.debug('clickPlayButton 异常：' + e.message);
        return false;
      }
    },

    /** 检查是否卡死（currentTime 长时间不推进） */
    checkStall(v) {
      if (!v) return false;
      if (v.paused) return false;
      if (v.currentTime > this._lastTime + 0.25) {
        this._lastTime = v.currentTime;
        this._lastActiveAt = Date.now();
        return false;
      }
      const idle = Date.now() - this._lastActiveAt;
      if (idle >= STALL_MS) {
        ZHS.Log.warn('视频 ' + Math.round(idle / 1000) + ' 秒未推进，尝试唤醒');
        this._lastActiveAt = Date.now();
        try { v.play(); } catch (e) { /* 忽略 */ }
        return true;
      }
      return false;
    },

    /**
     * 播放器进度对账（2026-10-06 新增，参考 Autovisor learn_lesson 的「进度对齐」）
     *
     * 为什么需要：平台按「已学百分比」异步上报。播放器如果跑在平台记录的前面太多，
     * 中途一旦断线、弹验证、弹题，超出记录的那一段就等于白播——平台不认。
     * 极端情形是人机验证没通过时进度直接作废归零，此时播放器还傻跑在前面。
     *
     * 对账策略（照抄 Autovisor 的克制做法，**不是**持续对账）：
     *   · 同一节课只对一次账，避免反复干预造成卡顿/花屏；
     *     （round-26：这里曾经真的 seek 拉回播放位置，真机证明 seek 会触发
     *       腾讯滑块验证码，现已去掉，见函数内注释）
     *   · 平台进度读不到（0%）时不干预——刚打开一节时进度天然是 0，
     *     一拉回就会变成「重播开头 20 秒」的死循环；这种情况交给调度器的
     *     0% 停滞守卫（ZERO_PROGRESS_GIVEUP_MS）去停手交人；
     *   · 验证/弹题结束后由调度器调 resetSync() 清标记，恢复时重新对一次账。
     *
     * @returns {boolean} 是否真的拉回过
     */
    syncToCatalog(v, lessonKey) {
      if (!v || !lessonKey || this._syncedKey === lessonKey) return false;
      if (!Number.isFinite(v.duration) || v.duration <= 0) return false;
      // round-48：暂停期（含拟人暂停 / 弹题暂停 / AI 随堂练习暂停）不比对进度。
      // 契约：暂停态进度比对无意义，且可能埋下「将来有人加『落后也 seek 拉回』逻辑
      // 却在暂停期触发 → 命中腾讯 Turing 滑块」的回归隐患（见本文件上方 round-26 铁律）。
      // 提前 return 把「暂停期不干预播放位置」显式钉死，与 checkStall 的 paused 早退一致。
      if (v.paused) return false;
      const cur = ZHS.Catalog && ZHS.Catalog.current ? ZHS.Catalog.current() : null;
      if (!cur) return false;
      const pct = ZHS.Catalog.progressOf(cur);
      this._syncedKey = lessonKey;   // 无论是否拉回，本节不再重复对账
      if (!(pct > 0)) return false;
      const expected = Math.floor(v.duration * pct / 100);
      if (v.currentTime > expected + SYNC_LEAD_SECONDS) {
        // 【2026-10-19 round-26 修订】这里原先是 `v.currentTime = expected`（seek 拉回）。
        //
        // 真机结论：智慧树把「异常 seek / 拖进度条」当作脚本特征 —— 一 seek 就弹
        // 腾讯 Turing 滑块验证码（turing.captcha.gtimg.com 跨域 iframe，脚本解不了）。
        // 这正是用户反馈的「有的下一集被检测成脚本、跳转不支持」的根因。
        //
        // 所以这里改为只告警、绝不干预播放位置；真正的进度补齐走
        // 「播完后重新加载本节」这条无 seek 路径（见 retryFromPlatformProgress）。
        ZHS.Log.warn('播放器进度超前平台记录（播放器 ' + Math.round(v.currentTime)
          + 's / 平台 ' + pct + '% ≈ ' + expected + 's）。按真机结论不 seek'
          + '（seek 会触发滑块验证码），进度补齐交由播完后的「重新加载本节」处理。');
      }
      return false;
    },

    /** 清空对账标记：验证/弹题结束后需要重新对一次账 */
    resetSync() {
      this._syncedKey = null;
    },

    _markActive(v) {
      if (v && v.currentTime > this._lastTime + 0.25) {
        this._lastTime = v.currentTime;
        this._lastActiveAt = Date.now();
      }
    },

    /**
     * 跳转到指定秒数并播放。
     *
     * ⚠️【round-26 铁律】这是全脚本**唯一**会产生 seek 的入口，**仅供用户手动操作**
     * （例如面板上的「跳到某处」）。自动化链路 —— 进度对账、回退重播、断点续播 ——
     * 一律不得调用：真机证明任何 seek 都会触发腾讯 Turing 滑块验证码，
     * 而验证码一旦弹出，脚本解不了、进度还会作废。改动前请先看本文件上方的说明。
     */
    async seekTo(v, seconds) {
      if (!v || !Number.isFinite(seconds)) return false;
      try {
        v.currentTime = Math.max(0, seconds);
        v.play();
        return true;
      } catch (e) {
        ZHS.Log.warn('跳转失败：' + e.message);
        return false;
      }
    },

    /**
     * 进度不同步处理：视频放完但平台记录 <100%
     *
     * 【2026-10-19 round-26 重写：彻底去掉 seek】
     *
     * 旧实现：把 video.currentTime 拉回平台记录点重播。
     * 真机结论：智慧树把「异常 seek / 拖进度条」当作脚本特征 —— 一 seek 就弹出
     * 腾讯 Turing 滑块验证码（turing.captcha.gtimg.com 跨域 iframe，脚本解不了）。
     * 这正是用户反馈的「有的下一集被检测成脚本、跳转不支持」的根因。
     *
     * 新实现走人类的做法：**重新点一次本节标题**。真机实测（2.25 节）：点未完成
     * 小节的标题后，平台会按它自己记录的进度把视频定位到断点加载（474/622）——
     * 全程不产生任何 seek 事件，却一样达到「从平台记录点续播补齐」的效果。
     * 最多重试 2 次，仍不同步就交回上层跳下一节（不卡死）。
     */
    async retryFromPlatformProgress(v, platformPercent) {
      if (this._retryCount >= 2) {
        ZHS.Log.warn('进度不同步已重试 2 次仍失败，跳过本课时');
        this._retryCount = 0;
        return false;
      }
      // 0% 不在这里硬撑：多半是安全验证没过（此时进度一律作废，重播也没用），
      // 交给调度器的「0% 停滞守卫」去停手交人。
      if (!(platformPercent > 0) || platformPercent >= 100) return false;

      const Catalog = ZHS.Catalog;
      const cur = Catalog && Catalog.current ? Catalog.current() : null;
      if (!cur || !Catalog.click) {
        ZHS.Log.warn('定位不到当前课时，无法按平台进度重播，放弃本课时');
        return false;
      }
      ZHS.Log.warn('视频已结束但平台仅记录 ' + platformPercent
        + '%，重新加载本节按平台进度续播（第 ' + (this._retryCount + 1) + ' 次，不 seek）');
      try { await ZHS.Nav.jumpTo(cur); } catch (e) { /* 跳转失败下一轮还会再判 */ }
      this._retryCount++;
      await U.sleep(3000);   // 等平台重新加载并把视频定位到它的记录点
      return true;
    },

    resetRetry() { this._retryCount = 0; },

    /** 是否处于「模拟真人离座」暂停期 */
    isHumanPausing() {
      return this._humanPauseUntil > 0 && Date.now() < this._humanPauseUntil;
    },

    /**
     * 拟人化随机暂停（round-45，听课程拟人节奏的核心一环）
     *
     * 依据：pjm314159/zhs（协议逆向参考实现的官方客户端复刻）播放循环每轮有
     * 0.25% 概率随机暂停 60 秒。真人看课本来就会中途离开，而机器挂机最显著的
     * 特征就是「匀速不停」——补上与官方客户端同款的随机暂停，能把挂机特征
     * 进一步拉向真人在看。
     *
     * 调用方（调度器主循环）每 2 秒调一次；本方法自己掷骰子，命中才暂停。
     * 安全约束：
     *   · 只在「正在播放」时触发（暂停中 / 已结束 / 无视频不触发）；
     *   · 刚开播 10 秒内不暂停（真人也不会一坐下就走开）；
     *   · 暂停期间 ensurePlaying 不唤醒、checkStall 不判卡死（paused 早退）、
     *     学习时长不计（v.paused 天然不计），到期由主循环自然恢复播放；
     *   · 切课冷却（NAV_COOLDOWN_MS）由调用方的调用位置保证 —— 冷却期内
     *     主循环在到达本方法之前就 return 了。
     *
     * @returns {boolean} 是否本次触发了暂停
     */
    maybeHumanPause(video) {
      const cfg = ZHS.config;
      if (!cfg.humanPause) return false;
      const now = Date.now();

      // 暂停到期：播报一次「回来了」（实际恢复由 ensurePlaying 负责）
      //
      // 【round-46 修订】播报加「视频确实处于暂停」守卫。
      // 端到端对账发现的交叉缺陷：暂停期内若弹题插入，_handleDialog 答完弹题后
      // 会把视频恢复播放（video.play()），而 _humanPauseUntil 尚未到期。到期时
      // 若无条件播报「模拟离座结束，恢复播放」，就是一条**假播报**——视频早就
      // 在播了，「离座」期间实际在处理弹题，语义全错。因此只有视频确实还暂停着
      // （即这次暂停真的是「模拟离座」造成的）才播报；视频已在播则静默清零状态。
      // （弹题路径上的 resetHumanPause 是主修复，这里是双保险。）
      if (this._humanPauseUntil && now >= this._humanPauseUntil) {
        if (!this._humanPauseResumeLogged && video && video.paused) {
          this._humanPauseResumeLogged = true;
          ZHS.Log.info('模拟离座结束（暂停约 ' + Math.round(this._humanPauseLastMs / 1000) + ' 秒），恢复播放');
        }
        this._humanPauseUntil = 0;
        return false;
      }
      if (this._humanPauseUntil) return false;        // 暂停中，不重复触发
      if (!video || video.paused || video.ended) return false;
      if (!this.hasValidDuration(video)) return false;
      if (video.currentTime < 10) return false;       // 刚开播不暂停

      const chance = Number(cfg.humanPauseChance);
      if (!(chance > 0) || Math.random() >= chance) return false;

      const min = Math.max(5, Number(cfg.humanPauseMinSec) || 30);
      const max = Math.max(min, Number(cfg.humanPauseMaxSec) || 90);
      const dur = Math.round(min + Math.random() * (max - min));
      this._humanPauseLastMs = dur * 1000;
      this._humanPauseUntil = now + dur * 1000;
      this._humanPauseResumeLogged = false;
      // 温和交互层 P4（docs/31 D5）：真人「离座」是点暂停键再走——优先点播放器的
      // 播放/暂停切换键（播放中点它 = 暂停，页面自己的代码改状态）；找不到按钮才
      // 裸 video.pause() 兜底，行为不变。
      if (!this._clickPlayToggle(video)) {
        try { video.pause(); } catch (e) { /* 暂停失败不影响主流程 */ }
      }
      ZHS.Log.info('拟人化随机暂停：模拟真人中途离开，暂停 ' + dur + ' 秒后自动恢复'
        + '（平台官方客户端同款节奏，降低挂机特征）');
      return true;
    },

    /** 清除拟人暂停状态（切课/停机时调用，避免旧节的状态带到新节） */
    resetHumanPause() {
      this._humanPauseUntil = 0;
      this._humanPauseResumeLogged = true;
    },
  };

  ZHS.Player = Player;
})();
