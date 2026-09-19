/**
 * 课程中心调度：自动选课 + 自动跳课
 *
 * 解决的问题：
 *   1. 自动选课 —— 在课程中心页自动找到「未看完」的课程并点进去
 *   2. 自动跳课 —— 当前课程全部学完后，自动回课程中心找下一门继续
 *
 * 跨页机制：
 *   油猴 match 覆盖 *://*.polymas.com/*，新标签页会自动注入本脚本；
 *   GM 存储跨标签页/跨子域共享，所以用 intent（跳转意图）串起两页。
 *
 * 存储用 GM_setValue（跨页共享），无 GM 环境降级到 localStorage，
 * 与 04-resume.js 的读写范式保持一致。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod06b_course_hub) return;
  ZHS.__mod06b_course_hub = true;
  const U = ZHS.Util;

  const STORE_KEY = 'zhs-helper-hub';
  const hasGM = typeof GM_setValue === 'function' && typeof GM_getValue === 'function';

  // 课程中心页地址（自动跳课从这里出发，也回到这里）
  const HUB_URL = 'https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center';
  // 课程学习页路径前缀（进入课程后 URL 形如 {BASE}/AIstudent/{courseId}/{classId}?key=entry）
  const STUDENT_PATH = '/AIstudent/';

  const INTENT_TTL = 10 * 60 * 1000;   // 跳转意图有效期：10 分钟
  const LIST_MAX = 50;                 // doneCourses / failedCourses 各自上限（FIFO 淘汰）

  // 防重入标志：MutationObserver 可能反复触发扫描，同轮内不重复收集
  let _scanning = false;
  let _scanPromise = null;      // in-flight 扫描 Promise，供并发调用共享结果

  // ============ 会话库读写（照 04-resume.js 范式）============

  function emptyStore() {
    return {
      rev: 1,
      intent: null,
      doneCourses: [],
      failedCourses: [],
      stats: { hopped: 0, failed: 0 },
    };
  }

  function readStore() {
    try {
      const raw = hasGM ? GM_getValue(STORE_KEY, null) : localStorage.getItem(STORE_KEY);
      if (!raw) return emptyStore();
      let obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      // 老格式兼容：历史版本曾把「已完成课程」直接存成纯字符串数组。
      // 若原样返回数组，后续 store.doneCourses 取到 undefined（靠 || [] 兜住），
      // 功能虽不崩，但 read() 的类型契约被破坏（返回数组而非对象）。这里统一转成对象。
      if (Array.isArray(obj)) {
        obj = { rev: 1, intent: null, doneCourses: obj.slice(), failedCourses: [], stats: { hopped: 0, failed: 0 } };
      }
      if (!obj || typeof obj !== 'object') return emptyStore();
      // 逐字段兜底，防止老版本/损坏数据让后续逻辑崩掉
      if (!Array.isArray(obj.doneCourses)) obj.doneCourses = [];
      if (!Array.isArray(obj.failedCourses)) obj.failedCourses = [];
      if (!obj.stats || typeof obj.stats !== 'object') obj.stats = { hopped: 0, failed: 0 };
      if (typeof obj.stats.hopped !== 'number') obj.stats.hopped = 0;
      if (typeof obj.stats.failed !== 'number') obj.stats.failed = 0;
      obj.rev = 1;
      return obj;
    } catch (e) {
      ZHS.Log.warn('课程中心会话库损坏，已重置');
      return emptyStore();
    }
  }

  function writeStore(store) {
    try {
      const raw = JSON.stringify(store);
      if (hasGM) GM_setValue(STORE_KEY, raw);
      else localStorage.setItem(STORE_KEY, raw);
      return true;
    } catch (e) {
      ZHS.Log.warn('课程中心会话库写入失败：' + e.message);
      return false;
    }
  }

  /** FIFO 入列：超出上限时丢最早的，避免列表无限膨胀 */
  function pushList(arr, val) {
    if (!val) return;
    const i = arr.indexOf(val);
    if (i >= 0) arr.splice(i, 1);   // 已存在则移到队尾（刷新位置）
    arr.push(val);
    while (arr.length > LIST_MAX) arr.shift();
  }

  // ============ 页面判定 ============

  /** 是否在课程中心页 */
  function isHubPage() {
    try {
      // round-8 M4：pathname / search / hash 任一含课程中心标识即判定命中，抗 query/hash 路由与大小写变化
      const p = (location.pathname || '').toLowerCase();
      const s = ((location.search || '') + (location.hash || '')).toLowerCase();
      return p.includes('ai-course-center') || s.includes('ai-course-center');
    } catch (e) {
      return false;
    }
  }

  /** 是否在课程学习页 */
  function isStudentPage() {
    try {
      return location.pathname.includes(STUDENT_PATH);
    } catch (e) {
      return false;
    }
  }

  // ============ 意图读写 ============

  /**
   * 写跳转意图（点击卡片前必须先写，新标签页靠它认领）
   *
   * via 记录本次意图的来源，是「能不能自动点课」的授权凭证：
   *   'auto-hop' —— 来自「上一门课学完后自动跳转」，说明用户已授权自动跳课链 → 可自动选课
   *   'manual'   —— 用户手动触发
   * 只有 via === 'auto-hop' 时，课程中心页才会自动选课（见 onPageReady）。
   * 普通「用户自己打开课程中心」不写 intent，因此不会被自动点课。
   */
  function setIntent(courseId, courseName, via) {
    const store = readStore();
    store.intent = {
      courseId: courseId || courseName || null,
      courseName: courseName || null,
      via: via || 'manual',
      at: Date.now(),
    };
    writeStore(store);
    return store.intent;
  }

  /** 读未过期的跳转意图；过期的顺手清掉 */
  function getIntent() {
    const store = readStore();
    const it = store.intent;
    if (!it) return null;
    // at 必须是有限数字，否则视为过期。
    // 起因：at 被写成字符串 "abc" 时，Date.now() - "abc" = NaN，
    // 而 `NaN > TTL` 恒为 false → 旧判断永远「不过期」，脏意图会长期残留、
    // 一旦用户后来打开自动选课就会用陈旧意图劫持点击。
    const at = Number(it.at);
    if (!Number.isFinite(at) || (Date.now() - at) > INTENT_TTL) {
      // 用 info：debug 已不进面板缓冲，而「意图过期」是排查
      // 「为什么没自动选课」的关键线索，必须留在面板可查。
      ZHS.Log.info('课程中心跳转意图已过期，忽略');
      store.intent = null;
      writeStore(store);
      return null;
    }
    return it;
  }

  /** 清除跳转意图 */
  function clearIntent() {
    const store = readStore();
    if (!store.intent) return false;
    store.intent = null;
    writeStore(store);
    return true;
  }

  // ============ 课程卡片收集（处理虚拟滚动）============

  /**
   * 收集课程卡片。
   *
   * 难点：课程中心是虚拟滚动，卡片只有滚到可视区才补渲，
   * 所以必须「边滚边收」。滚动容器就是页面主体，
   * 做法是：先记原位 → 反复滚到底收集 → 直到 scrollHeight 不再增长或超上限 → 恢复原位。
   *
   * 【防卡死】除了「最多 30 轮」，还必须有**总时长上限**。
   * 某些环境（无头/无布局引擎）scrollHeight 恒为 0，导致「到底了没」永远判不出来，
   * 只能靠次数上限兜底 —— 30 轮 × 300ms ≈ 9 秒，用户会以为脚本卡住。
   * 现在超时（默认 4 秒）即停，并且一旦确认高度不再变化就提前收工。
   */
  async function collectCards() {
    const found = [];
    const startedAt = Date.now();
    const MAX_MS = 4000;        // 总时长硬上限，防 scrollHeight 恒 0 时空转
    const ROUND_MS = 300;       // 每轮等平台补渲

    // 找滚动容器：优先文档主体，找不到就退化为 window
    const scroller = findScroller();

    const originTop = scroller ? scroller.scrollTop : 0;
    let lastHeight = -1;
    let stable = 0;

    try {
      for (let i = 0; i < 30; i++) {   // 次数上限 30，防死循环
        if (Date.now() - startedAt > MAX_MS) {
          ZHS.Log.debug('[课程中心] 滚动收集达到时长上限，提前结束（已收 ' + found.length + ' 张）');
          break;
        }

        const curHeight = scroller ? scroller.scrollHeight : document.documentElement.scrollHeight;
        if (scroller) scroller.scrollTop = curHeight;   // 滚到底触发补渲
        else window.scrollTo(0, curHeight);

        await U.sleep(ROUND_MS);   // 等平台补渲

        collectInto(found);

        const newHeight = scroller ? scroller.scrollHeight : document.documentElement.scrollHeight;
        // 高度读不出来（恒 0 / NaN）→ 无法判断是否到底，直接收工，避免空转
        if (!newHeight) {
          ZHS.Log.debug('[课程中心] 滚动高度不可读，跳过虚拟滚动收集（当前页面可能无需滚动）');
          break;
        }
        if (newHeight === curHeight && newHeight === lastHeight) {
          stable++;
          if (stable >= 2) break;   // 连续两轮高度不变 → 到底了
        } else {
          stable = 0;
        }
        lastHeight = newHeight;
      }
    } catch (e) {
      ZHS.Log.warn('滚动收集课程卡片出错：' + e.message);
    } finally {
      // 恢复原位，不打扰用户
      try {
        if (scroller) scroller.scrollTop = originTop;
        else window.scrollTo(0, originTop);
      } catch (e) { /* 忽略 */ }
    }

    // 回到顶部后再补收一次，防止一开始顶部有漏网
    collectInto(found);
    return found;
  }

  /** 依次尝试多个选择器，返回第一个命中的单元素（带兜底，抗平台改类名） */
  function qsFirst(sels) {
    for (const s of sels) {
      try { const el = document.querySelector(s); if (el) return el; } catch (e) {}
    }
    return null;
  }
  /** 依次尝试多个选择器，合并返回所有命中（去重，抗平台改类名） */
  function qsaAll(sels) {
    const out = [];
    for (const s of sels) {
      try {
        const els = document.querySelectorAll(s);
        for (const el of els) if (out.indexOf(el) < 0) out.push(el);
      } catch (e) {}
    }
    return out;
  }

  /** 找虚拟滚动的容器 */
  function findScroller() {
    try {
      const body = qsFirst(['.ai-course-center-body', '[class*="course-center"]']);
      if (body) {
        // 自身可滚就用自己，否则向上找可滚祖先
        if (body.scrollHeight > body.clientHeight) return body;
        let p = body.parentElement;
        while (p && p !== document.body) {
          if (p.scrollHeight > p.clientHeight) return p;
          p = p.parentElement;
        }
      }
      const de = document.documentElement;
      if (de && de.scrollHeight > de.clientHeight) return de;
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /** 把当前 DOM 里的卡片解析后并入结果（按元素去重） */
  function collectInto(found) {
    let cards = [];
    try {
      cards = qsaAll(['.ai-course-center-body div.course-card', '[class*="course-card"]', '[class*="courseCard"]']);
    } catch (e) {
      ZHS.Log.warn('课程卡片选择器匹配失败：' + e.message);
      return;
    }
    for (const el of cards) {
      if (found.some((c) => c.el === el)) continue;   // 去重
      const parsed = parseCard(el);
      if (parsed) found.push(parsed);
    }
  }

  /** 解析单张卡片 → { el, name, percent, finished } */
  function parseCard(el) {
    if (!el) return null;
    let name = '';
    try {
      const h4 = el.querySelector('h4');
      name = U.normText(h4 ? (h4.innerText || h4.textContent) : '');
      if (!name) name = U.normText(el.textContent).slice(0, 60);   // 降级
    } catch (e) {
      name = '';
    }

    let percent = null;
    let text = '';
    try {
      text = U.normText(el.textContent);
      // 百分比解析：优先在「自身文本含 %」的最小元素上解析，
      // 避免整卡 textContent 拼接把相邻数字吞进来（如 "课4" + "12.5%" = "课412.5%"，
      // 直接在合并文本上匹配会得到 412.5）。逐个候选元素单独解析，取第一个命中。
      // 修复四个毛病：
      //   1. 支持小数与科学计数法（"12.5%"→12，"1e2%"→100），不再只吃 \d+
      //   2. 保留正负号（"-5%"→-5）
      //   3. 正则锚定 `%` 前的数字 token，不跨界吞数字
      //   4. 上限夹逼到 100（"1000%"→100，避免 finished 误判）
      const RE = /([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*%/i;
      const cands = [];
      try {
        const nodes = el.querySelectorAll('*');
        for (const n of nodes) {
          const t = U.normText(n.textContent);
          if (t.indexOf('%') >= 0) cands.push(t);
        }
      } catch (e) { /* 忽略 */ }
      cands.push(text);   // 兜底：整卡文本
      for (const t of cands) {
        const m = t.match(RE);
        if (m) {
          const n = Number(m[1]);
          if (Number.isFinite(n)) { percent = Math.min(100, Math.floor(n)); break; }
        }
      }
    } catch (e) { /* 忽略 */ }

    // 完成阈值与目录 isFinished（FINISH_PCT=98）对齐：
    // 否则 98~99% 卡住的课程在中心页仍判「未完成」→ 被反复重新进入，形成「中心页↔该课」死循环（round-7 H3）
    const finished = (percent !== null && percent >= 98)
      || text.includes('已完成') || text.includes('已学完');

    return { el, name, percent, finished };
  }

  /** 从卡片元素上尽量挖出课程标识（data 属性 / vue 实例） */
  function cardIdentity(el) {
    if (!el) return null;
    try {
      for (const attr of ['data-course-id', 'data-courseid', 'data-id', 'data-key', 'id']) {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v) return String(v);
      }
      // Vue 实例上常见的字段
      const vm = el.__vue__ || (el.parentElement && el.parentElement.__vue__);
      if (vm) {
        const c = vm.course || vm.courseInfo || vm.data || vm.item;
        const id = c && (c.courseId || c.courseid || c.id || c.recruitAndCourseId);
        if (id) return String(id);
        if (vm.courseId) return String(vm.courseId);
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  // ============ 选择下一门课 ============

  /**
   * 挑选下一门未看完的课。
   * 过滤：已 done、已 failed、finished === true。
   * @returns 卡片对象，或 null（没有可进的课）
   */
  async function pickNext() {
    if (!ZHS.config.autoCoursePick) {
      ZHS.Log.debug('自动选课开关关闭，跳过');
      return null;
    }

    // 防重入：MutationObserver 可能反复触发，同一轮不重复扫描。
    // 关键：第二次调用不能立即返回 null —— 那会被上层误判成「没有未看完的课程」
    // 并弹出误导提示。正确做法是 await 第一轮的 in-flight Promise，共享同一结果。
    if (_scanning) {
      ZHS.Log.debug('已有扫描进行中，等待其完成后共享结果');
      try { return await _scanPromise; } catch (e) { return null; }
    }
    _scanning = true;
    let _resolveScan;
    _scanPromise = new Promise((r) => { _resolveScan = r; });

    const store = readStore();
    try {
      ZHS.Log.debug('[课程中心] 开始收集课程卡片…');
      const cards = await collectCards();
      ZHS.Log.debug('[课程中心] 共收集到 ' + cards.length + ' 门课程');

      const done = store.doneCourses || [];
      const failed = store.failedCourses || [];

      for (const c of cards) {
        if (c.finished) continue;
        const id = cardIdentity(c.el);
        const key = id || c.name;
        if (!key) continue;
        if (done.includes(key)) continue;
        if (failed.includes(key)) continue;
        ZHS.Log.info('[课程中心] 选中未看完课程：' + (c.name || key)
          + (c.percent !== null ? '（' + c.percent + '%）' : ''));
        if (_resolveScan) _resolveScan(c);
        return c;
      }

      ZHS.Log.info('[课程中心] 没有找到未看完的课程');
      if (_resolveScan) _resolveScan(null);
      return null;
    } catch (e) {
      ZHS.Log.warn('[课程中心] 挑选课程出错：' + e.message);
      if (_resolveScan) _resolveScan(null);
      return null;
    } finally {
      _scanning = false;   // 释放防重入标志
      _scanPromise = null;
    }
  }

  // ============ 进入课程 ============

  /**
   * 进入指定课程卡片。
   *
   * 卡片内没有 a[href]，整卡可点，点击后平台自己调 window.open() 新开标签。
   * 因此必须【先写 intent 再点】，否则新标签页不认领。
   * 若 window.open 被浏览器拦截，800ms 内没跳转则尝试直接 location.href 兜底。
   */
  async function enterCourse(card) {
    if (!card || !card.el) {
      ZHS.Log.warn('[课程中心] 进入课程失败：卡片为空');
      return false;
    }
    const id = cardIdentity(card.el) || card.name;
    if (!id) {
      ZHS.Log.warn('[课程中心] 卡片没有可用标识，无法记录意图');
      return false;
    }

    // 1. 先写 intent（新标签页靠它认领这次跳转）
    setIntent(id, card.name, card.via || 'manual');
    ZHS.Log.info('[课程中心] 准备进入课程：' + (card.name || id));

    // 2. 点击卡片
    //
    // 【稳健性】不能把「可见性检测失败」当成「不能点」。
    // U.isVisible() 依赖 offsetParent 等布局信息，在无布局环境（含部分虚拟滚动容器、
    // 无头/嵌入式浏览器）会误报 false。此时若直接放弃点击，功能就废了。
    // 策略：可见就当可点直接点；不可见先尝试滚入视口，仍失败则【照样点一次】，
    // 点不通再由 catch 判定为真失败。
    let clicked = false;
    try {
      const visible = (() => {
        try { return U.isVisible(card.el); } catch (e) { return true; }
      })();

      if (!visible) {
        try {
          card.el.scrollIntoView({ block: 'center' });
          await U.sleep(200);
        } catch (e) {
          ZHS.Log.debug('[课程中心] scrollIntoView 不可用，直接尝试点击');
        }
      }

      card.el.click();
      clicked = true;
    } catch (e) {
      // 第一次点击失败 → 再试一次内部更具体的可点元素
      ZHS.Log.warn('[课程中心] 直接点击卡片出错（' + e.message + '），尝试内部元素');
      try {
        const inner = card.el.querySelector('h4, [class*="btn"], a, button') || card.el;
        inner.click();
        clicked = true;
      } catch (e2) {
        ZHS.Log.warn('[课程中心] 点击卡片仍失败：' + e2.message);
      }
    }
    // 3. 判定结果
    //
    // 【重要纠错】不能用 `isHubPage()` 判断「跳转成功与否」：
    // 卡片点击走 window.open 开【新标签】，当前页永远还停在课程中心，
    // 所以 isHubPage() 恒为 true —— 早先版本因此恒返回 false，
    // 上层收到 false 就 markCourseFailed，把一门本来能学的课永久拉黑。
    //
    // 正确语义：click 未抛异常 + intent 已写入 = 已成功发出进入请求 → 返回 true。
    // 「到底进没进去」的唯一可信信号是学习页那边的 settleIntentOnStudentPage() 回写，
    // 不在这里猜。宁可返回 true（不动），也不误判成 false（误拉黑）。
    if (!clicked) {
      ZHS.Log.warn('[课程中心] 卡片点击未生效（元素不可点），本次进入放弃。不拉黑该课程，稍后可重试');
      clearIntent();
      return false;
    }

    // 已发出进入请求。不再做兜底 location.href 跳转 ——
    // 那会与平台的 window.open 叠加，开出两个学习页标签（宁可少开，不可多开）。
    ZHS.Log.info('[课程中心] 已点击卡片，等待新标签页接管（由学习页回写确认）');
    bumpStat('hopped');
    // round-8 M2：记录待确认跳转，防「点击后新标签没起来」导致该课永远不学也不失败（由看门狗清理）
    try {
      const st = readStore();
      st.pendingHop = { courseId: id, at: Date.now(), settled: false };
      writeStore(st);
    } catch (e) {}
    return true;
  }

  /** 尽力从卡片推导学习页 URL（保留：供日志提示 / 手动排查用，不再用于自动跳转） */
  function deriveCourseUrl(el) {
    if (!el) return null;
    try {
      // a) 卡片内直接有链接
      const a = el.querySelector('a[href]');
      if (a && a.href) return a.href;
      // b) 任意子元素带 href / data-* 属性
      const cands = [el].concat(Array.from(el.querySelectorAll('*')));
      for (const node of cands) {
        for (const attr of ['data-href', 'data-url', 'href', 'data-course-url']) {
          const v = node.getAttribute && node.getAttribute(attr);
          if (v && /^https?:|^\//.test(v) && !/ai-course-center/.test(v)) return v;
        }
      }
      // c) Vue 实例上的路由跳转参数
      const vm = el.__vue__ || (el.parentElement && el.parentElement.__vue__);
      if (vm) {
        const c = vm.course || vm.courseInfo || vm.data || vm.item;
        const courseId = c && (c.courseId || c.courseid || c.recruitAndCourseId || c.id);
        const classId = c && (c.classId || c.classid);
        if (courseId && classId) {
          return location.origin + STUDENT_PATH + courseId + '/' + classId + '?key=entry';
        }
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  // ============ 统计 / 状态回写 ============

  function bumpStat(field) {
    const store = readStore();
    if (!store.stats) store.stats = { hopped: 0, failed: 0 };
    store.stats[field] = (Number(store.stats[field]) || 0) + 1;
    writeStore(store);
  }

  /** 把某课程记为「已全部学完」 */
  function markCourseDone(courseId) {
    // round-8 H1：与课程中心 pickNext 读键（cardIdentity）同源，避免「写用 id / 读用另一 id」导致去重失效
    const key = courseId
      || (ZHS.state && ZHS.state.hubKey)
      || (ZHS.state && ZHS.state.courseId);
    if (!key) {
      ZHS.Log.warn('[课程中心] markCourseDone 缺少课程标识，忽略');
      return false;
    }
    const store = readStore();
    pushList(store.doneCourses, String(key));
    writeStore(store);
    ZHS.Log.info('[课程中心] 已记录完成课程：' + key);
    return true;
  }

  /** 把某课程记为「进入失败」，防止下次再选它形成死循环 */
  function markCourseFailed(courseId) {
    // round-8 H1：与 markCourseDone 同源，优先用进入时记录的卡片标识
    const key = courseId
      || (ZHS.state && ZHS.state.hubKey)
      || (ZHS.state && ZHS.state.courseId);
    if (!key) return false;
    const store = readStore();
    pushList(store.failedCourses, String(key));
    writeStore(store);
    bumpStat('failed');
    return true;
  }

  /**
   * 跳转回课程中心。
   * 由 05-scheduler 在「本课程全学完」时调用。
   *
   * 关键：这里会写一个 via='auto-hop' 的 intent，作为「用户已授权自动跳课」的凭证。
   * 课程中心页只有看到这个凭证才会自动选课（见 onPageReady），
   * 从而区分「学完自动跳下一门」与「用户自己打开课程中心看一眼」两种情形。
   */
  function returnToHub() {
    if (!ZHS.config.autoCourseHop) {
      ZHS.Log.debug('自动跳课开关关闭，不返回课程中心');
      return false;
    }
    if (isHubPage()) {
      ZHS.Log.debug('已在课程中心页，无需跳转');
      return false;
    }
    // 写入授权凭证：说明这次回中心是「学完自动跳课」驱动的，可以自动选下一门
    setIntent(ZHS.state && ZHS.state.courseId, '', 'auto-hop');
    ZHS.Log.info('[课程中心] 正在返回课程中心寻找下一门课…');
    try {
      location.href = HUB_URL;
      return true;
    } catch (e) {
      ZHS.Log.warn('[课程中心] 返回课程中心失败：' + e.message);
      return false;
    }
  }

  /**
   * 学习页回写闭环：进入课程学习页时，若存在未过期 intent 说明跳转成功，
   * 清除 intent 并打日志。
   */
  function settleIntentOnStudentPage() {
    if (!isStudentPage()) return false;
    const it = getIntent();
    if (!it) return false;
    // round-8 H1：把进入时记录的卡片标识（与 pickNext 读键同源）存到 state，供 markCourseDone/Failed 写入去重键
    try { ZHS.state.hubKey = it.courseId || null; } catch (e) {}
    // round-8 M2：标记待确认跳转已落地，解除看门狗
    try {
      const st = readStore();
      if (st.pendingHop && st.pendingHop.courseId === (it.courseId || '')) {
        st.pendingHop.settled = true;
        writeStore(st);
      }
    } catch (e) {}
    clearIntent();
    ZHS.Log.info('[课程中心] 已进入课程：' + (it.courseName || it.courseId || '未知'));
    bumpStat('hopped');
    return true;
  }

  // ============ 课程中心页主流程 ============

  async function runOnHub(via) {
    if (!isHubPage()) return false;
    // round-8 M2：清理卡住的待确认跳转（超过 5 分钟未 settled → 视为进入失败，移出待学防死循环）
    try {
      const st = readStore();
      if (st.pendingHop && !st.pendingHop.settled
        && Date.now() - (st.pendingHop.at || 0) > 5 * 60 * 1000) {
        ZHS.Log.warn('[课程中心] 检测到卡住的进入请求（' + st.pendingHop.courseId + '），标记为进入失败');
        markCourseFailed(st.pendingHop.courseId);
        st.pendingHop = null;
        writeStore(st);
      }
    } catch (e) {}

    // 等待课程卡片渲染出来（页面可能异步出数据）
    const first = await waitForCards(15000);
    if (!first) {
      ZHS.Log.warn('[课程中心] 未等到课程卡片，跳过自动选课');
      return false;
    }

    const next = await pickNext();
    if (!next) {
      // 没有可进的课 → 出总结
      const store = readStore();
      ZHS.Log.info('[课程中心] 所有课程已无未看完项，本次调度结束'
        + '（已记录完成 ' + (store.doneCourses || []).length + ' 门）');
      // 只在「自动跳课链」里才提示，避免用户随手打开页面就被弹窗打扰
      if (via === 'auto-hop' && ZHS.panel) {
        ZHS.panel.alert('课程中心：没有找到未看完的课程，已停止自动选课', 'info', 8000);
      }
      return false;
    }

    // 把本次授权来源带到卡片上，enterCourse 据此写入 intent.via
    next.via = via || 'manual';
    const ok = await enterCourse(next);
    if (!ok) {
      // 进入失败（卡片不可点 / intent 写不进）→ 记 failed，避免下次继续选它死循环。
      // 注意：enterCourse 已不再把「判定不了」当成失败，所以这里进来的都是真失败。
      const id = cardIdentity(next.el) || next.name;
      markCourseFailed(id);
      ZHS.Log.warn('[课程中心] 进入课程失败，已加入失败名单：' + (next.name || id));
    }
    return ok;
  }

  /** 等第一张课程卡片出现 */
  async function waitForCards(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const el = qsFirst(['.ai-course-center-body div.course-card', '[class*="course-card"]']);
        if (el) return el;
      } catch (e) { /* 忽略 */ }
      await U.sleep(300);
    }
    return null;
  }

  // ============ 对外接口 ============

  const CourseHub = {
    STORE_KEY,
    HUB_URL,
    isHubPage,
    isStudentPage,

    // 存储
    read: readStore,
    write: writeStore,
    reset() {
      writeStore(emptyStore());
      ZHS.Log.info('[课程中心] 会话库已重置');
    },
    listDone() { return readStore().doneCourses || []; },
    listFailed() { return readStore().failedCourses || []; },
    stats() { return readStore().stats || { hopped: 0, failed: 0 }; },

    // 意图
    setIntent,
    getIntent,
    clearIntent,

    // 卡片
    collectCards,
    parseCard,

    // 流程
    pickNext,
    enterCourse,
    markCourseDone,
    markCourseFailed,
    returnToHub,
    settleIntentOnStudentPage,
    runOnHub,

    /** 启动：根据当前页面决定行为 */
    async start() {
      try {
        if (isHubPage()) {
          await runOnHub();
        } else if (isStudentPage()) {
          settleIntentOnStudentPage();
        }
      } catch (e) {
        ZHS.Log.warn('[课程中心] 启动出错：' + e.message);
      }
    },

    /**
     * 页面加载时的安全入口（替代原来的无条件自启动）。
     *
     * 【设计铁律】自动选课绝不能「打开页面就悄悄发生」。
     * 过去版本在这里无条件 start()，导致用户只是打开课程中心看一眼，
     * 1.5 秒后课就被点了、还开出新标签 —— 这是劫持用户操作，不可接受。
     *
     * 现在只有两种情形才会真正动手：
     *   A. 跳课链闭环：存在有效 intent 且来源是「上一门课学完后自动跳转」
     *      （intent.via === 'auto-hop'）→ 说明用户已授权「学完自动跳下一门」这条链
     *   B. 用户在面板上手动触发（走 triggerManual()）
     * 其余情况一律只打日志，绝不动手。
     */
    async onPageReady() {
      try {
        if (isStudentPage()) {
          // 学习页：认领 intent（这是「跳转成功」的唯一可信信号）
          settleIntentOnStudentPage();
          return;
        }
        if (!isHubPage()) return;

        // 【关键】先读意图，读完立即消费掉 —— 无论后面走哪条分支。
        //
        // 早先版本把这个读取放在「选课开关开启」判断【之后】，导致：
        // 用户只开「自动跳课」不开「自动选课」时，跳回课程中心后直接从开关分支 return，
        // intent 永远没被清除、留在存储里成为「僵尸意图」。等用户后来某天打开
        // 「自动选课」，一进课程中心就会被这个陈旧意图触发自动点课 ——
        // 严重违背「用户没主动授权时绝不劫持操作」的铁律。
        //
        // 现在改为：只要进到课程中心页，先把意图读出来并立刻消费（清除），
        // 再根据开关与意图来源决定是否动手。纸条用完就撕，绝不留到下次。
        const it = getIntent();
        const fromAutoHop = !!(it && it.via === 'auto-hop');
        if (it) clearIntent();

        if (!ZHS.config.autoCoursePick) {
          // 用 info：这是用户「为什么没自动选课」的直接答案，必须留在面板可见。
          ZHS.Log.info('[课程中心] 自动选课开关关闭，不动作（已消费跳转意图，避免残留）');
          return;
        }

        if (!fromAutoHop) {
          // 用户只是打开了课程中心 —— 只提示，不点课
          ZHS.Log.info('[课程中心] 已进入课程中心页。如需自动选择未学完课程，请在面板点击「找下一门课」'
            + '（或由「自动跳课」在学完一门课后自动触发）');
          return;
        }

        ZHS.Log.info('[课程中心] 检测到自动跳课意图（上一门课已学完），开始选择下一门课');
        await runOnHub('auto-hop');
      } catch (e) {
        ZHS.Log.warn('[课程中心] 页面就绪处理出错：' + e.message);
      }
    },

    /** 用户手动触发：在面板点「找下一门课」时调用 */
    async triggerManual() {
      if (!ZHS.config.autoCoursePick) {
        ZHS.Log.warn('[课程中心] 自动选课开关已关闭，请先开启');
        if (ZHS.panel) ZHS.panel.alert('请先开启「自动选课」开关', 'warn');
        return false;
      }
      if (!isHubPage()) {
        ZHS.Log.warn('[课程中心] 当前不在课程中心页，无法选课');
        if (ZHS.panel) ZHS.panel.alert('请先进入课程中心页面', 'warn');
        return false;
      }
      return await runOnHub('manual');
    },
  };

  ZHS.CourseHub = CourseHub;

  // 自启动改为「安全入口」：只做认领与提示，不会在用户没授权时点课。
  // 参见 onPageReady() 的设计铁律说明。
  try {
    setTimeout(() => { ZHS.CourseHub.onPageReady(); }, 1500);
  } catch (e) { /* 忽略 */ }
  ZHS.Log.debug('[课程中心] 调度模块已加载');
})();
