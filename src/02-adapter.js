/**
 * 适配层：自动识别智慧树页面版本，提供统一的目录访问接口
 *
 * 智慧树有 5 套并存的页面结构（wisdom / fusion / hike / legacy / card2025），
 * 本模块把它们统一成同一组方法，上层业务代码无需关心版本差异。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod02_adapter) return;
  ZHS.__mod02_adapter = true;
  const U = ZHS.Util;

  /**
   * 目录适配器定义
   * - item       章节条目选择器
   * - active     当前项选择器
   * - finish     完成标识选择器（存在即已完成）
   * - title      课时名选择器
   * - progress   进度值选择器（可选）
   * - progressAttr 进度属性名（有则读属性，无则读文本）
   */
  const ADAPTERS = {
    wisdom: {
      name: 'wisdom',
      label: '智慧版共享课',
      item: '.child-info.hasvideo',
      active: '.child-info.hasvideo.current',
      finish: '.child-check',
      title: '.child-name',
      progress: '[role="progressbar"][aria-valuenow]',
      progressAttr: 'aria-valuenow',
      container: '.chapter-tree-74',
      courseTitle: '.course-name',
      locked: '.lock-icon, .icon-lock, [class*="lock"]',
    },
    fusion: {
      name: 'fusion',
      label: 'AI助教翻转课',
      item: '.chapter-content-second',
      active: '.chapter-content-second.current',
      finish: '.finish-icon',
      title: '.item-name',
      container: '.chapter-content',
      courseTitle: '.course-name',
      locked: '[class*="lock"]',
    },
    hike: {
      name: 'hike',
      label: '新形态课',
      item: '.file-item',
      active: '.file-item.active',
      activeClass: 'active',
      finish: '.icon-finish',
      title: 'span[title]',
      progress: '.rate',
      container: '.el-tree',
      courseTitle: '.course-name',
      locked: '.el-icon-lock, [class*="lock"]',
    },
    legacy: {
      name: 'legacy',
      label: '旧版共享课',
      item: '.clearfix.video',
      active: '.clearfix.video.current_play',
      finish: '.time_icofinish',
      // 旧版共享课的课时名：OCS getChapterName 用 .catalogue_title，
      // 老页面里还写作 <span id="lessonOrder">。两个都写，命中谁算谁。
      title: '#lessonOrder, .catalogue_title',
      progress: '.progress-num',
      container: '.clearfix',
      courseTitle: '.source-name',
      locked: '[class*="lock"]',
    },
    card2025: {
      name: 'card2025',
      label: '2025新版卡片式',
      item: '[class*="card-container"]',
      active: '[class*="card-container"].active',
      finish: '.finished-icon',
      title: '.video-title, .common-text',
      container: '.section-item-collapse-info',
      courseTitle: '.header-title-wrap',
      locked: '[class*="lock"]',
    },
    // polymas 系（智慧树新形态教学中心，Vue3 + Aliplayer）
    polymas: {
      name: 'polymas',
      label: '智慧树·AI课程中心',
      item: '[class*="course-node"], [class*="chapter-item"], .catalog-item, [class*="lesson-item"]',
      active: '[class*="course-node"].active, [class*="chapter-item"].active, .catalog-item.active, [class*="lesson-item"].active',
      activeClass: 'active',
      // 【2026-09-19 修正】原来是裸通配 `[class*="done"]`，而 isFinished 的第 1 层
      // 是「命中即完成」、不设任何形态约束。polymas 一旦当选，外层容器
      // （lesson-done-wrap / study-finish-box 之类）会让整目录瞬间全判完成 → allDone 停摆。
      // 这里收紧成图标型元素，把误伤堵在源头。
      finish: 'i[class*="finish"], i[class*="done"], i[class*="complete"], span[class*="finish"], span[class*="done"], [class*="finish-icon"], [class*="done-icon"], .is-finish, .is-done',
      title: '[class*="title"], span[title]',
      progress: '[class*="progress"], [role="progressbar"]',
      container: '#main',
      courseTitle: '[class*="course-name"], [class*="title"]',
      locked: '[class*="lock"], [class*="disabled"]',
    },
  };

  /**
   * 通用兜底扫描器（适配器选择器全部落空时启用）
   *
   * 思路：不猜具体类名，而是从「结构特征」反推哪些元素像课程目录条目：
   *   1. 兄弟节点成群（≥3 个同构兄弟）→ 像列表
   *   2. 每个节点里有可读文本（课时名）
   *   3. 节点不是纯容器（自身文本占比不能太低，太高则是大容器）
   *   4. 优先取「文本长度适中（2~60 字）」且可点击的节点
   *
   * 这样即使 polymas 改版换类名，也能捞到目录。
   */
  function sniffItems() {
    const out = [];
    const seen = new Set();

    // 候选容器：页面上所有元素，按「子元素数量」筛出像列表的
    const all = document.querySelectorAll('div, li, a');
    const groups = new Map();   // key = 父节点，value = 子节点数组

    for (const el of all) {
      const parent = el.parentElement;
      if (!parent) continue;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(el);
    }

    for (const [, kids] of groups) {
      if (kids.length < 3) continue;                 // 少于 3 个不成列表
      // 同构判定：标签名 + class 主体一致
      const sig = (el) => el.tagName + '|' + String(el.className || '').split(/\s+/).slice(0, 2).join('.');
      const sigs = new Set(kids.map(sig));
      if (sigs.size > 2) continue;                   // 结构太杂，不像同级列表

      for (const el of kids) {
        if (seen.has(el)) continue;
        const txt = U.normText(el.innerText || el.textContent);
        if (!txt) continue;
        if (txt.length < 2 || txt.length > 80) continue;   // 太短不可能是课时名，太长是大容器
        // 排除明显是导航/表单的
        if (/登录|注册|首页|我的|设置|退出/.test(txt) && txt.length < 8) continue;
        seen.add(el);
        out.push(el);
      }
    }

    // 按 DOM 顺序返回，保证「下一节」的方向正确
    return out.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  /**
   * 域名权重提示（不再是「一锤定音」的硬路由）
   *
   * 【2026-09-18 二次修正】我一度把 studyvideoh5 的 hike（.file-item）置顶，
   * 依据是 GreasyFork 上一个脚本 gf558335；但更权威的 OCS（ocsjs-zhs.ts:81/139/825）
   * 明确写着 StudyVideoH5 用的是 .clearfix.video（legacy），
   * 而 .file-item 只出现在「校内课 xnk-study」（同文件 1520/1551 行）。
   * gf558335 的 @match 是全站通配 *://*.zhihuishu.com/*，它在校内课能跑，
   * 不代表 studyvideoh5 也是这套结构——这条证据我当时误归属了。
   *
   * 根子上的问题是：**按域名硬写优先级这件事本身就不可靠**，平台随时改版，
   * 昨天的答案今天就变成坑（用户反馈「功能全无用」正是这么来的）。
   * 所以这里降级为「加分项」，真正拍板交给 detect() 的评分选举：
   * 谁命中得多、谁能定位到「当前项」，谁上。
   */
  function hostBonus(name) {
    const host = location.hostname;
    if (host.includes('polymas.com')) return name === 'polymas' ? 5 : 0;
    if (host === 'hike.zhihuishu.com') return name === 'hike' ? 5 : 0;
    if (host.includes('fusioncourseh5')) return name === 'fusion' ? 5 : 0;
    if (host.includes('studywisdomh5')) return name === 'card2025' ? 5 : 0;
    if (host.includes('studyplush5')) return name === 'wisdom' ? 5 : 0;
    // studyvideoh5：给 legacy（ocsjs 权威）与 wisdom（Autovisor 默认兜底）加分。
    // 【2026-09-18 三次修正】这里原本给 hike 也加 3 分，但 Autovisor 是独立于 ocsjs 的
    // 第二个信源，它在 modules/lesson_navigation.py:84-85 把 .file-item 硬锁在 hike 域
    // （`if "hike.zhihuishu.com" in course_url: return (HIKE_CATALOG,)`，单元素元组），
    // studyvideoh5 走 :88 的 (WISDOM, LEGACY, FUSION) 兜底，hike 压根不在候选里。
    // 两个独立项目在同一件事上结论一致 → 给 hike 加分是错的。
    // 注意：hike 拿 0 分但**不退出候选池**，仍参与评分选举 —— 万一将来真改版成 el-tree，
    // 评分照样能把它选上来，不会静默失效。这才叫"不赌，也不封闭"。
    if (host.includes('studyvideoh5')) return (name === 'legacy' || name === 'wisdom') ? 3 : 0;
    return name === 'wisdom' ? 2 : 0;
  }

  /** 候选池：顺序只作同分时的稳定 tie-break，不再代表优先级 */
  function candidates() {
    return [ADAPTERS.legacy, ADAPTERS.hike, ADAPTERS.wisdom, ADAPTERS.fusion, ADAPTERS.card2025, ADAPTERS.polymas];
  }

  /**
   * 给一套适配器打分，越高越像「当前页面真正的目录」
   * 评分维度（按可信度从强到弱）：
   *   1. 能定位到「当前项」（active / current_play）——+100，这种组合只有真目录才有，
   *      正是它防住了「某套选择器碰巧在页面别处存在 → 抢占识别」的老 bug
   *   2. 命中专属容器（.el-tree / .chapter-tree-74 等）——+20，页面骨架对得上
   *   3. 命中条目数（30 封顶）——每条 +1
   *   4. 条目能读出课时名——每条 +2，防止命中一堆空壳节点
   */
  function scoreAdapter(ad) {
    let list = [];
    try { list = Array.from(document.querySelectorAll(ad.item)); } catch (e) { return -1; }
    if (!list.length) return 0;

    let score = Math.min(list.length, 30);
    // 1. 能找到「当前项」是最强信号，但有两个前提，否则会翻车：
    //    (a) active 元素必须是本套 item 命中的节点之一 —— 页面别处一个 .active 不该给它加满分
    //    (b) 该节点要真的可见 —— 上一段残留的、display:none 的旧容器不该拿满分
    //    （旧写法用全页 querySelector 找 active，两套 DOM 并存时公式会塌缩成「只比谁节点多」）
    try {
      if (ad.active) {
        const actives = Array.from(document.querySelectorAll(ad.active));
        const inList = actives.filter((a) => list.some((el) => el === a || el.contains(a)));
        if (inList.some((a) => U.isVisible(a))) score += 100;
        else if (inList.length) score += 40;   // 命中但不可见：降权，不作数
      }
    } catch (e) { /* 选择器兼容 */ }
    try { if (ad.container && document.querySelector(ad.container)) score += 20; } catch (e) { /* 选择器兼容 */ }

    let titled = 0;
    for (const el of list.slice(0, 30)) {
      const t = U.normText(el.innerText || el.textContent);
      if (t && t.length >= 2 && t.length <= 80) titled++;
    }
    score += titled * 2;
    score += hostBonus(ad.name);
    return score;
  }

  /** 轮询等待条件成立（SPA 异步切换的通用等待器） */
  async function waitUntil(fn, timeoutMs, interval) {
    const deadline = Date.now() + timeoutMs;
    interval = interval || 150;
    while (Date.now() < deadline) {
      let hit = false;
      try { hit = !!fn(); } catch (e) { hit = false; }
      if (hit) return true;
      await U.sleep(interval);
    }
    return false;
  }

  /**
   * 自动展开折叠的目录树 ——【2026-09-18 实地修正】
   * 痛点：新版页面目录是 el-tree，章节默认折叠时目标课时根本不在 DOM 里，
   * 于是「点了也没用」：脚本找不到下一节，即便找到也点不动一个不存在的节点。
   * 这里在每次取目录之前，把没展开的章节全部点开。
   */
  const expandTreeOnce = U.throttle(function () {
    let opened = 0;
    try {
      document.querySelectorAll('.el-tree-node__expand-icon:not(.is-leaf)').forEach((icon) => {
        const expanded = icon.classList.contains('expanded')
          || icon.getAttribute('aria-expanded') === 'true';
        if (!expanded) { icon.click(); opened++; }
      });
    } catch (e) { /* 展开失败不影响主流程 */ }
    if (opened > 0) ZHS.Log.info('已自动展开 ' + opened + ' 个折叠章节');
    return opened;
  }, 2000);

  /**
   * 条目状态枚举
   *   done   已完成
   *   undone 未完成（可点，需要看）
   *   locked 未解锁（点不了，前置没完成）
   *   na     不是可播放条目（纯目录/章节标题）
   */
  const STATUS = { DONE: 'done', UNDONE: 'undone', LOCKED: 'locked', NA: 'na' };

  /**
   * 探测当前页面用哪套适配器
   *
   * 【2026-09-18 修正】原来是「候选里第一个 querySelector 命中 1 个就算成功」，
   * 这是导致用户「功能全无用」的直接原因之一：任何一套选择器只要碰巧在页面别处
   * 存在一两个同名节点，就会抢占成功，真目录被顶掉，后续全部操作打在空气上。
   * 现在改为评分选举：全部候选各打一次分，取最高且 >0 者。
   */
  function detect() {
    let best = null;
    let bestScore = 0;
    const detail = [];
    for (const ad of candidates()) {
      const s = scoreAdapter(ad);
      if (s > 0) detail.push(ad.name + '=' + s);
      if (s > bestScore) { bestScore = s; best = ad; }
    }
    if (best) {
      ZHS.state.siteVersion = best.name;
      ZHS.Log.info('页面版本识别为：' + best.label + ' (' + best.name + ')，评分 ' + bestScore
        + (detail.length > 1 ? '；候选评分 ' + detail.join(' / ') : ''));
      return best;
    }
    ZHS.state.siteVersion = 'unknown';
    ZHS.Log.warn('未能识别页面版本，将使用通用兜底策略');
    return ADAPTERS.wisdom; // 兜底
  }

  /**
   * 目录操作 API
   */
  const Catalog = {
    _ad: null,

    get adapter() {
      if (!this._ad) this._ad = detect();
      return this._ad;
    },

    /** 强制重新探测（SPA 切页后调用） */
    redetect() { this._ad = null; return this.adapter; },

    /** 课程唯一标识 */
    getCourseId() {
      // 路径解析优先：polymas AI 课程学习页形如 /AIstudent/{courseId}/{lessonId}?key=…
      // 此前只查 query/hash，学习页恒返回 'unknown-course'，导致断点 key 串台、去重失效（round-7 H2）
      const pm = location.pathname.match(/\/AIstudent\/([^/?#]+)/);
      if (pm && pm[1]) return pm[1];
      return U.pick(
        {
          a: U.getUrlParam('recruitAndCourseId'),
          b: U.getUrlParam('courseId'),
          c: U.getUrlParam('recruitId'),
        },
        ['a', 'b', 'c'],
        null
      ) || (location.hash.match(/courseId[=\/](\w+)/) || [])[1]
      // round-12：URL 全空时的兜底链——优先用课程中心进入时记录的真实课程 id（hubKey），
      // 再退而求其次读 DOM 上的 data-course-id；避免长期返回 'unknown-course' 导致断点串台、自动跳课去重失效。
      || (ZHS.state && ZHS.state.hubKey) || (function () {
        const el = document.querySelector('[data-course-id]');
        return el ? el.getAttribute('data-course-id') : null;
      })() || 'unknown-course';
    },

    /** 课程名 */
    getCourseName() {
      const el = document.querySelector(this.adapter.courseTitle);
      return el ? U.normText(el.innerText || el.textContent) : '';
    },

    /** 所有章节条目 */
    items() {
      expandTreeOnce(); // 先把折叠章节展开，否则折叠中的课时不在 DOM 里，取不到也点不到
      const list = Array.from(document.querySelectorAll(this.adapter.item));
      // hike 版过滤掉目录树中间节点（有子节点的不是叶子）
      if (this.adapter.name === 'hike') {
        return list.filter((el) => {
          const node = el.closest('.el-tree-node');
          if (!node) return true;
          const children = node.querySelector('.el-tree-node__children');
          return !children || children.children.length === 0;
        });
      }
      // 预设选择器全落空 → 启用通用兜底扫描（应对平台改版/新域名）
      if (!list.length) {
        const sniffed = sniffItems();
        if (sniffed.length) {
          if (!this._sniffed) {
            this._sniffed = true;
            ZHS.Log.warn('预设选择器未命中，已启用结构兜底扫描，捞到 ' + sniffed.length + ' 个候选条目');
          }
          return sniffed;
        }
      }
      return list;
    },

    /** 当前播放的条目 */
    current() {
      const ad = this.adapter;
      // round-15【D3】：active 查询必须限定在目录容器内。
      // 原先用 document.querySelector(ad.active) 全局查，只要页面别处（播放器控制条、
      // 顶部导航、其他 tab）恰有带 active/current 类且标题文本又碰巧等于目标节的元素，
      // 就会把「当前播放项」判成它 —— 于是 nowIsTarget()/_stillOnFrom() 全部跟着错，
      // 「假成功」从另一侧回流（切错节也判成功、完成计数虚增）。
      let cur = null;
      try {
        const scope = (ad.container && document.querySelector(ad.container)) || document;
        cur = scope.querySelector(ad.active);
      } catch (e) { /* 选择器兼容：失败则回落全局 */ }
      if (!cur) {
        try { cur = document.querySelector(ad.active); } catch (e) { /* 选择器兼容 */ }
      }
      // round-15【D3 强化】：命中的元素必须确实是目录条目之一，否则不算「当前播放项」。
      // 这挡住「页面别处有同名 active 元素」的最后一种漏网情形。
      if (cur) {
        const list = this.items();
        const isItem = list.some((el) => el === cur || el.contains(cur) || cur.contains(el));
        if (isItem) return cur;
      }
      // 兜底：用 lessonKey 文本匹配
      const key = ZHS.state.lessonKey;
      if (key) {
        return this.items().find((el) => this.itemTitle(el) === key) || null;
      }
      return null;
    },

    /** 取条目名称 */
    itemTitle(el) {
      if (!el) return '';
      const ad = this.adapter;
      const readTxt = (n) => {
        if (!n) return '';
        const attr = n.getAttribute && n.getAttribute('title');
        if (attr) return U.normText(attr);
        return U.normText(n.innerText || n.textContent);
      };
      // 纯序号（如 legacy 的 #lessonOrder 只写了 "1.2"）不算课时名
      const onlyNumber = (s) => !s || /^[\d.\s]*$/.test(s);

      const t = readTxt(el.querySelector(ad.title));
      if (!onlyNumber(t)) return t;

      // 回退：在通用课时名容器里找第一个像名字的文本
      const FALLBACK = '.catalogue_title, .video-name, .item-name, .child-name, .file-name, .time, [class*="title"], span[title]';
      try {
        for (const n of Array.from(el.querySelectorAll(FALLBACK))) {
          const s = readTxt(n);
          if (!onlyNumber(s) && s.length >= 2) return s;
        }
      } catch (e) { /* 忽略 */ }
      return U.normText(el.innerText || el.textContent).slice(0, 80);
    },

    /**
     * 条目是否已完成
     * 完成判定的「金标准」是平台在章节列表（用户侧栏/右侧栏）打的完成标记（对勾/已完成图标）。
     * 仅靠视频进度条判断会出问题：视频放完但平台进度条还停在 99% 时，会误判「没看完」→ 重播而非跳节。
     * 所以优先级：专属完成标记 > 通用完成标记（覆盖各版本 class 变体）> 文本"已完成/已学完" > 进度 100%。
     */
    isFinished(el) {
      if (!el) return false;
      const ad = this.adapter;
      try {
        // 1. 适配器专属完成标记（如 wisdom 的 .child-check / legacy 的 .time_icofinish）
        if (ad.finish && el.querySelector(ad.finish)) return true;
        // 1b. 标记打在 el 自身（1 @346 只有 querySelector 版本）
        if (ad.finish && el.matches && el.matches(ad.finish)) return true;
      } catch (e) { /* 选择器兼容 */ }
      // 2. 条目自身带完成态 class（如 .file-item.done）
      try {
        if (/\b(done|finished|completed|is-finish|is-finished|study-done|learned)\b/i.test(String(el.className || ''))) return true;
      } catch (e) { /* 忽略 */ }
      // 3. 通用完成标记：必须是「图标型」节点才认
      //    【2026-09-18 修正】原来只要子树里任一元素 class 含 finish/done/complete 就算完成。
      //    太宽了：外层容器常叫 "lesson-done-wrap" / "study-finish-box"，一命中就把整条目判成已完成，
      //    后果是 findNext 找不到「未完成」的节 → 直接弹「全部看完」白屏停止。
      //    现在限定两种才算：标签是图标类，或该节点本身就是叶子（没有子元素）。
      try {
        const BADGE = '[class*="finish"], [class*="done"], [class*="complete"], [class*="learned"], [class*="studied"], [class*="checkmark"], [class*="is-finish"]';
        for (const n of Array.from(el.querySelectorAll(BADGE))) {
          const tag = String(n.tagName || '').toLowerCase();
          if (/^(i|span|em|img|svg|b|strong)$/.test(tag)) return true;
          if (!n.firstElementChild) return true;   // 空壳容器，可能就是那个勾
        }
      } catch (e) { /* 选择器兼容 */ }
      // 3. 子元素文本兜底（有时完成标记是「已学完」三个字而非图标）
      // 【2026-09-18 修正】原来是 `/…|100\s*%/` 包含匹配 + 单独的「进度>=100 也算完成」：
      // 「100% 学习完成」这种进度说明也会命中，下一节的 100% 也会被误判为已完成；
      // 但视频看完时平台侧常常仍停在 99%，以 100 为门槛会直接卡住不跳。
      // 故改为：只认独立文本 /^(\d{1,3})%$/，且阈值取 FINISH_PCT —— 由平台自己的低位值决定，不是拍脑袋。
      const FINISH_PCT = 98;
      const t = U.normText(el.innerText || el.textContent);
      if (/(已完成|已学完|已学习|学完|已看完)/.test(t)) return true;
      if (!ad.progress) {
        // 该套适配器没有进度选择器 → 只能靠文本百分比（取紧凑纯进度文本）
        const m = t.match(/^\s*(\d{1,3})\s*%\s*$/);
        if (m && Number(m[1]) >= FINISH_PCT) return true;
        return false;
      }
      const pct = this._readProgress(el);
      return pct >= FINISH_PCT;
    },

    /** 纯读进度值（不做完成态判断，避免与 isFinished 相互递归） */
    _readProgress(el) {
      const ad = this.adapter;
      if (!el || !ad.progress) return 0;
      let p = null;
      try { p = el.querySelector(ad.progress); } catch (e) { return 0; }
      if (!p) return 0;
      let raw = ad.progressAttr ? p.getAttribute(ad.progressAttr) : (p.innerText || p.textContent);
      raw = String(raw || '0').replace('%', '').trim();
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    },

    /** 条目是否未解锁 */
    isLocked(el) {
      if (!el) return false;
      const ad = this.adapter;
      // 1. 元素自身或内部有锁图标
      if (ad.locked) {
        try {
          if (el.matches && el.matches(ad.locked)) return true;
          if (el.querySelector(ad.locked)) return true;
        } catch (e) { /* 忽略非法选择器 */ }
      }
      // 2. disabled / 不可点 属性
      if (el.getAttribute) {
        if (el.getAttribute('disabled') != null) return true;
        if (el.getAttribute('aria-disabled') === 'true') return true;
        if (el.getAttribute('data-locked') === 'true') return true;
      }
      // 3. 样式：pointer-events:none 或 明显的禁用态类名
      try {
        const cls = String(el.className || '');
        if (/\b(disabled|is-disabled|lock|locked|forbid|no-permission)\b/i.test(cls)) return true;
      } catch (e) { /* 忽略 */ }
      // 4. 文本兜底
      const txt = U.normText(el.innerText || el.textContent);
      if (/未解锁|不可学习|暂无权限/.test(txt)) return true;
      return false;
    },

    /**
     * 三态判定
     * @returns 'done' | 'undone' | 'locked' | 'na'
     */
    statusOf(el) {
      if (!el) return STATUS.NA;
      if (this.isFinished(el)) return STATUS.DONE;
      if (this.isLocked(el)) return STATUS.LOCKED;
      // 有标题且能点到 → 未完成
      const t = this.itemTitle(el);
      if (!t) return STATUS.NA;
      return STATUS.UNDONE;
    },

    /**
     * 全量扫描：给每个条目打状态（面板/报告用）
     * @returns [{ index, title, status, progress, element }]
     */
    scan() {
      return this.items().map((el, i) => ({
        index: i,
        title: this.itemTitle(el),
        status: this.statusOf(el),
        progress: this.progressOf(el),
        element: el,
      }));
    },

    /** 统计三态数量 */
    breakdown() {
      this.ensureCatalogLoaded();   // 补全虚拟滚动目录，避免漏算未完成节而误判「全部看完」
      const list = this.scan();
      const out = { total: 0, done: 0, undone: 0, locked: 0, na: 0 };
      for (const it of list) {
        out.total++;
        out[it.status] = (out[it.status] || 0) + 1;
      }
      out.percent = out.total ? Math.round((out.done / out.total) * 100) : 0;
      out.allDone = out.total > 0 && out.undone === 0;
      return out;
    },

    /** 条目进度百分比 0-100（优先读真实进度条，已完成直接 100） */
    progressOf(el) {
      if (!el) return 0;
      if (this.isFinished(el)) return 100;
      return this._readProgress(el);
    },

    /**
     * 找下一个「未完成且未锁」的条目
     * 策略：当前位置往后找 → 找不到则从头补漏
     * 跳过 done（已完成）和 locked（未解锁，点了也没用）
     */
    findNext(fromEl) {
      // 第一轮：基于「当前已渲染的 DOM 快照」查找
      let all = this.items();
      if (!all.length) return null;

      const pickable = (el) => this.statusOf(el) === STATUS.UNDONE;

      let startIdx = 0;
      if (fromEl) {
        const i = all.indexOf(fromEl);
        if (i >= 0) startIdx = i + 1;
      }
      // 1. 当前之后
      for (let i = startIdx; i < all.length; i++) {
        if (pickable(all[i])) return all[i];
      }
      // 2. 从头补漏（前面可能有跳过的）
      for (let i = 0; i < Math.min(startIdx, all.length); i++) {
        if (pickable(all[i])) return all[i];
      }

      // 【round-5 修复 · 对应「不能跳转下一集」候选根因】
      // 第一轮没找到 → 目录可能是「虚拟滚动」，后面的未完成课时根本还没渲染进 DOM。
      // 主动触发懒加载把目录补全，再按同样逻辑找一次。
      this.ensureCatalogLoaded();
      all = this.items();
      if (fromEl) {
        const i = all.indexOf(fromEl);
        if (i >= 0) startIdx = i + 1;
      }
      for (let i = startIdx; i < all.length; i++) {
        if (pickable(all[i])) return all[i];
      }
      for (let i = 0; i < Math.min(startIdx, all.length); i++) {
        if (pickable(all[i])) return all[i];
      }
      return null;
    },

    /** 所有待学条目（未完成 + 未锁） */
    pending() {
      return this.items().filter((el) => this.statusOf(el) === STATUS.UNDONE);
    },

    /** 找指定名称的条目 */
    findByName(key) {
      if (!key) return null;
      const all = this.items();
      // 精确匹配优先
      let hit = all.find((el) => this.itemTitle(el) === key);
      if (hit) return hit;
      // 包含匹配兜底
      hit = all.find((el) => this.itemTitle(el).includes(key) || key.includes(this.itemTitle(el)));
      return hit || null;
    },

    /**
     * 条目是否处于「当前播放」状态
     * 不单看适配器的 active 选择器（平台一改版就失效），而是三层判定：
     *   1. 元素自身 class 出现 active / current_play / current / is-active / selected
     *   2. 元素匹配适配器 active 选择器
     *   3. 页面上唯一的「当前项」就是它（或互为包含关系）
     */
    hasActive(el) {
      if (!el) return false;
      const ad = this.adapter;
      let rawClass = '';
      try {
        rawClass = String((el.className && el.className.baseVal !== undefined) ? el.className.baseVal : (el.className || ''));
      } catch (e) { rawClass = ''; }
      const cls = rawClass.split(/\s+/);
      // 1. 本套专属的「当前项」标记（如 legacy 的 current_play、hike 的 active）
      if (ad.activeClass && cls.indexOf(ad.activeClass) >= 0) return true;
      // 2. 通用词兜底（Element UI 的 is-current / 播放器 playing 等）
      if (cls.some((c) => /^(active|current_play|current-play|current|is-active|is-current|selected|playing)$/i.test(c))) {
        return true;
      }
      try { if (ad.active && el.matches && el.matches(ad.active)) return true; } catch (e) { /* 选择器兼容 */ }
      try {
        // round-14【P4】：限定在目录容器内查询，而不是整个 document。
        // 原先 document.querySelector(ad.active) 会命中页面别处任意带 active 的容器
        // （如播放器控制条、其他 tab），只要与 el 存在祖先/包含关系就误判为「当前项」，
        // 造成「0 毫秒假成功」。收窄到 adapter.container 内可基本消除这类误判。
        const scope = (ad.container && document.querySelector(ad.container)) || document;
        const cur = ad.active ? scope.querySelector(ad.active) : null;
        if (cur && (cur === el || el.contains(cur) || cur.contains(el))) return true;
      } catch (e) { /* 选择器兼容 */ }
      return false;
    },

    /**
     * 点击条目（真正触发切换）
     *
     * 【2026-09-18 修正】原来「优先点内部 a / span[title]」这一步是错的：
     * Vue 的点击监听绑在目录条目本体（.file-item / .clearfix.video）上，
     * 点内部一个纯展示用的 span/a 不等于点条目，于是「点了没反应」。
     * 成熟实现（OCS 的 StudyVideoH5 条目点击）都是直接点条目本体。
     * 另外补一步 scrollIntoView：部分页面条目不在视口内时不响应点击。
     */
    click(el) {
      if (!el) return false;
      try {
        if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (e) { /* 滚动失败不影响点击 */ }
      try {
        el.click();
        return true;
      } catch (e) {
        try {
          const inner = el.querySelector('a, .child-name, .item-name, .file-name, span[title]');
          if (inner) { inner.click(); return true; }
        } catch (e2) { /* 放弃 */ }
        ZHS.Log.error('点击章节失败：', e.message);
        return false;
      }
    },

    /**
     * 点击并校验是否真的切过去了
     *
     * 智慧树点目录是 SPA 异步切换，active class 往往晚几百毫秒才落到 DOM，
     * 所以轮询等「目标条目拿到 active」；一直没动静就再点一次
     * （首次点击常被遮罩层/播放器吞掉），两次都不动才判失败。
     * SPA 重渲染还可能把节点换掉（detach），失败后按标题重新定位再点。
     *
     * @returns {Promise<boolean>} 是否确认已切换
     */
    async clickAndVerify(el, opt) {
      opt = opt || {};
      const timeout = opt.timeout || 3000;
      const tries = opt.tries || 2;
      const fromKey = opt.fromKey || null;   // round-14：切换前的课时标识，用第二信号比对
      if (!el) return false;

      const titleKey = this.itemTitle(el);
      let target = el;
      // round-15【D1】：预先记下目标与「切换前那一节」在目录里的索引，供 nowIsTarget 做身份比对
      const _idxOf = (node) => {
        try {
          if (!node) return -1;
          const list = this.items();
          return list.findIndex((it) => it === node || it.contains(node) || node.contains(it));
        } catch (e) { return -1; }
      };
      const fromIdx = fromKey ? _idxOf(this.items().find((it) => this.itemTitle(it) === fromKey)) : -1;

      /**
       * round-14【P4】第二信号：目标条目拿到 active 只是「间接信号」，会双向误判 ——
       *   · 平台不打 active（改版/异步慢）→ 假失败：白等 9s、重复点、凑齐 5 次硬停；
       *   · 页面别处恰有带 active 的容器（全局 querySelector 命中）→ 假成功：0 毫秒判过、完成计数虚增。
       * 这里补一个独立判据：点完之后「目录里当前播放的那一项」必须确实等于目标项。
       * 判据强度取「或」：只要 currentTitle 明确等于目标标题，就算成功（不依赖 active class）。
       */
      const nowIsTarget = () => {
        try {
          const cur = this.current();
          if (!cur) return false;
          // round-15【D1】：优先用「元素身份 / 目录索引」判断，而不是纯标题文本比对。
          // 智慧树「习题讲解」「章节测验」这类同名节很常见：纯标题比对时，
          // 只要第一节被设为 current，目标是第二节也会判成「已切到第二节」→ 假成功、
          // 切错节、完成计数虚增。改用索引比对后可根治。
          const list = this.items();
          const curIdx = list.findIndex((it) => it === cur || it.contains(cur) || cur.contains(it));
          const tgtIdx = list.findIndex((it) => it === target || it.contains(target) || target.contains(it));
          if (curIdx >= 0 && tgtIdx >= 0) {
            if (curIdx === tgtIdx) return true;     // 索引一致 → 确实切到目标
            // 索引不一致且当前项就是切换前那一节 → 明确没切（即便标题同名也不误判）
            if (fromIdx >= 0 && curIdx === fromIdx && curIdx !== tgtIdx) return false;
            return false;                            // 当前项既不是目标也不是原节 → 未切到目标
          }
          // 索引取不到（SPA 换节点/items 未识别）→ 回落标题比对兜底
          const curKey = this.itemTitle(cur);
          if (!curKey) return false;
          if (fromKey && curKey === fromKey && curKey !== titleKey) return false;
          return curKey === titleKey;
        } catch (e) { return false; }
      };

      /**
       * round-16【P4】第三信号：页面级「确实切走了」痕迹。
       * 老限制：某些平台版本/改版后「目录条目根本不打 active 类」，也没有可用的
       * current 标记 —— 此时前两个信号（索引身份 / active）全部判不出来，
       * 于是「明明切过去了」也被判失败 → 白等 9s + 重复点 + 凑齐 5 次硬停，
       * 而这正是触发「瞬时故障停机 → 自愈 → 立刻又停」死循环的源头。
       * 这里补一个与目录 DOM 无关的独立证据：视频源（src）或播放器区标题发生变化，
       * 说明页面确实换了一集。点击前先快照，点击后比对。
       */
      const pageMark = () => {
        try {
          const v = document.querySelector('video');
          const src = v ? String(v.currentSrc || v.src || '') : '';
          // 播放器区标题（常见于标题栏/章节名展示区）
          let titleTxt = '';
          try {
            const tEl = document.querySelector('.video-title, .chapter-name, .current-chapter, .play-title, .catalogue-name');
            titleTxt = tEl ? String(tEl.textContent || '').replace(/\s+/g, '') : '';
          } catch (e) { titleTxt = ''; }
          return src + '||' + titleTxt;
        } catch (e) { return ''; }
      };
      const markBefore = pageMark();
      let markChanged = false;
      const pageSwitched = () => {
        try {
          const now = pageMark();
          if (now && markBefore && now !== markBefore) markChanged = true;
          if (!markChanged) return false;
          // 保护：页面标记变化必须伴随「已离开切换前那一节」，否则可能只是
          // 广告/预加载/自适应码率导致 video.src 抖动，不能当成切换成功。
          // 目录索引/标题任一能证明「已不在原节」即可放行；都判不出来时保守返回 false。
          if (fromKey) {
            const cur = this.current();
            const curKey = cur ? this.itemTitle(cur) : '';
            if (curKey && curKey === fromKey) return false;   // 还在原节 → 不算切换
          } else {
            const cur = this.current();
            if (cur) {
              const curKey = this.itemTitle(cur);
              // 无 fromKey 时至少要求「当前项标题等于目标标题」才认
              if (curKey && curKey !== titleKey) return false;
            }
          }
          return markChanged;
        } catch (e) { return false; }
      };

      for (let i = 0; i < tries; i++) {
        // 点击前先确认还没切过去：若上次点击其实已生效（active 只是晚几拍才落到 DOM），
        // 直接判成功即可，避免「重复点击当前节 → 平台重新加载本节」的怪象。
        // round-14：只有「目标已是当前项」才算已生效；仅凭 active 不算（防假成功）。
        if (nowIsTarget()) return true;
        this.click(target);
        // round-15【D2】判据修正：原先写的是 `hasActive(target) && !_stillOnFrom(...)`，
        // 其中 _stillOnFrom 在 fromKey 为空时**恒返回 false**，于是整条判据退化成
        // 「只要目标拿到 active 就算成功」= 第二信号完全失效，假成功/假失败的老问题回流。
        // 现在改成「第二信号（nowIsTarget，基于目录索引的身份比对）为真才算成功」，
        // active 只在第二信号无法判定（目录未识别）时才作为兜底。
        // round-16【P4】：再叠第三信号 pageSwitched —— 视频源/播放器标题变了也算切成功，
        // 治好「平台不给 active 就永远判失败」的老限制。
        if (await waitUntil(
          () => nowIsTarget() || this._activeOnlyFallback(target, fromKey) || pageSwitched(),
          i === 0 ? timeout : timeout * 2, 150
        )) return true;
        if (nowIsTarget() || pageSwitched()) return true;
        // 节点被 SPA 换掉 → 按标题重定位
        if (!target.isConnected) {
          const again = this.findByName(titleKey);
          if (!again) return false;
          target = again;
        } else {
          // 同 DOM 节点还在但不是 active，可能点击被遮罩吞掉。下一轮再点前先尝试
          // 按标题重定位（万一 SPA 静默换过节点但 isConnected 仍是 true）。
          const again = this.findByName(titleKey);
          if (again && again !== target) target = again;
        }
      }
      ZHS.Log.warn('点击「' + titleKey + '」' + tries + ' 次仍未见页面切换');
      return false;
    },

    /**
     * round-15【D2】：active 兜底判据 —— 仅在「目录索引完全不可用」时才允许依赖 active。
     *
     * 为什么需要兜底：某些页面 items() 识别不到（改版/未进播放页），此时基于索引的
     * nowIsTarget 恒为 false，若只认它就会「明明切过去了却判失败」→ 白等 + 重复点 + 硬停。
     * 但兜底必须比原来严格：光有 active 不够，还得确认「当前项已不是切换前那一节」，
     * 否则回绕/同名节场景仍会假成功。
     */
    _activeOnlyFallback(target, fromKey) {
      try {
        if (!target || !this.hasActive(target)) return false;
        // 目录索引可用时不许走兜底（交给更可靠的 nowIsTarget 判定）
        const list = this.items();
        const tgtIdx = list.findIndex((it) => it === target || it.contains(target) || target.contains(it));
        if (tgtIdx >= 0) return false;
        // 有 fromKey 时必须确认已离开原节
        if (fromKey) {
          const cur = this.current();
          if (cur) {
            const curKey = this.itemTitle(cur);
            if (curKey && curKey === fromKey) return false;
          }
        }
        return true;
      } catch (e) { return false; }
    },

    /**
     * round-14【P4 辅助】：判定「是否仍停在切换前那一节」。
     * 用第二信号（当前项标题）做交叉校验，避免仅凭 active 判成功。
     * 场景：目标条目拿到 active，但当前项其实还是 fromKey（回绕/误判）→ 不能算成功。
     */
    _stillOnFrom(fromKey, targetKey) {
      if (!fromKey) return false;
      try {
        const cur = this.current();
        if (!cur) return false;
        const curKey = this.itemTitle(cur);
        return !!curKey && curKey === fromKey && curKey !== targetKey;
      } catch (e) { return false; }
    },

    /** 全部章节完成度统计 */
    /**
     * 列出当前页面里「可滚动且内容溢出」的目录容器
     * 优先用适配器的 container 选择器，否则用一组常见目录滚动容器兜底。
     * jsdom / 无布局环境下 scrollHeight、clientHeight 均为 0，不会命中任何容器，安全降级。
     */
    _scrollContainers() {
      const sel = (this.adapter && this.adapter.container)
        || '.catalog-scroll, .video-catalog-scroll, .el-scrollbar__wrap, [class*="catalog"], [class*="Catalog"], .chapter-list, .course-catalog';
      return Array.from(document.querySelectorAll(sel))
        .filter((el) => el.scrollHeight > el.clientHeight + 4);
    },

    /**
     * 触发目录的虚拟滚动/懒加载，把「还没滚到视口、不在 DOM 里」的课时加载出来。
     *
     * 【round-5 修复 · 对应「不能跳转下一集」候选根因】
     * 之前 findNext / breakdown 只基于「当前已渲染的 DOM 快照」查找。智慧树部分课程
     * 目录是虚拟滚动：未滚动到的课时根本不在 DOM 里，于是 findNext 永远找不到后面的
     * 未完成节，表现就是「点了下一节也没用 / 不能自动跳下一集」。
     *
     * 做法：对可滚动容器反复滚到底部，触发平台分批渲染；每滚一次重新统计条目数，
     * 直到不再增长（到底或静态目录）为止。用 _catalogLoaded / _loadAttempts 双重闸门，
     * 避免异步渲染漏抓后永久关闭补全，也防止无限抖动。
     */
    ensureCatalogLoaded() {
      if (this._catalogLoaded) return;
      this._loadAttempts = (this._loadAttempts || 0) + 1;
      if (this._loadAttempts > 6) { this._catalogLoaded = true; return; }  // 安全上限，避免死循环
      const boxes = this._scrollContainers();
      let grew = false;
      for (const box of boxes) {
        let guard = 0;
        while (guard++ < 60) {
          const before = this.items().length;
          // 往复滚动，制造多次 scroll 事件以触发分批异步渲染
          try {
            box.scrollTop = box.scrollHeight;
            box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight - 1);
            box.scrollTop = box.scrollHeight;
          } catch (e) { /* 某些环境 scrollTop 只读，忽略 */ }
          const after = this.items().length;
          if (after > before) grew = true;
          else break;  // 不再增长 → 到底或静态，停止本轮
        }
      }
      if (grew) ZHS.Log.info('虚拟滚动目录已触发懒加载，目录条目已补全');
      // 本轮仍有增长 → 保持未锁定，下次 findNext/breakdown 会继续补全；
      // 不再增长 → 标记完成，停止滚动。
      this._catalogLoaded = !grew;
    },

    /** 切课 / SPA 重载后清空目录加载缓存，下一门课重新触发懒加载 */
    resetCatalogCache() {
      this._catalogLoaded = false;
      this._loadAttempts = 0;
      this._sniffed = false;
    },

    stats() {
      this.ensureCatalogLoaded();   // 补全虚拟滚动目录，进度统计才准确
      const all = this.items();
      const done = all.filter((el) => this.isFinished(el)).length;
      return { total: all.length, done, percent: all.length ? Math.round((done / all.length) * 100) : 0 };
    },
  };

  ZHS.Catalog = Catalog;
  ZHS.STATUS = STATUS;
})();
