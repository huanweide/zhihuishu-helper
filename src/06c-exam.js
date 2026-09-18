/**
 * 智慧树「在线作业 / 在线考试」作答页 —— 守株待兔式自动答题
 *
 * ============ 设计原则（源自用户原话，务必理解后再改）============
 *
 * 用户要的是「我不主动去找作业，但当我点进去时你帮我答完」：
 *
 *   用户自己点进作业/考试作答页
 *        ↓
 *   脚本发现「在作答页」且在允许的章节范围内
 *        ↓
 *   自动逐题拿答案 → 填进页面 → （可选）点提交
 *        ↓
 *   停下。不跳下一个任务、不回列表页、不循环。
 *
 * ============ 绝对禁止的行为（见下方 FORBIDDEN，改动时勿越界）============
 *   ❌ 不调用 location.href / location.replace 跳转到任何作业/考试页
 *   ❌ 不在列表页自动点击「开始答题 / 进入作业」
 *   ❌ 不做「答完一个自动找下一个」的循环
 *   ❌ 不自动点进任何 dohomework / doexamination 链接
 *
 * 原因：自动跳转会被平台识别为异常行为，且用户明确说「配置剔除自动进入」。
 *       「主动出击」是用户明确否掉的方案，不要自作聪明加回来。
 *
 * ============ 页面事实（来自 PROCESS/meetings/round-2/review-worker-20.md）============
 *   作答页 URL： #/webExamList/dohomework/{...} 或 #/webExamList/doexamination/{...}
 *   列表页 URL： #/webExamList（不含上面两者）
 *   题目块：     .examPaper_subject[data-questionid]
 *   题型标签：   .subject_type_describe .subject_type    文案形如「【单选题】(2分)」
 *   题干：       .subject_describe                        （innerHTML 注入）
 *   选项：       .subject_node > .nodeLab
 *   选项勾选框： .nodeLab input                            （radio/checkbox + v-model）
 *   选项文本：   .nodeLab .node_detail.examquestions-answer（innerHTML 注入）
 *   提交按钮：   button.submit-btn  （可点 .active-color / 禁用 .disable-color）
 *
 * ⚠️ 全套选择器来自「官方 SPA 打包产物反编译」，非登录态运行时实测。
 *    运行时可能多出 data-v-xxxx 作用域属性（不影响 class 选择器）。
 *    因此每一处 DOM 操作都做了空值容错，任何一步失败只 warn 不抛异常。
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod06c_exam) return;
  ZHS.__mod06c_exam = true;
  const U = ZHS.Util;

  // ============ 禁止事项清单（写进代码，防止后来者误加功能）============
  const FORBIDDEN = [
    '不跳转：本模块永不调用 location.href / location.replace / window.open',
    '不点击列表页：本模块永不点击 .jobExamComBtn / .course_ewstate / 任何 dohomework 链接',
    '不循环：答完当前页即停止，不寻找下一个作业/考试',
  ];

  const PREFIX = '[作业考试]';

  // ============ 页面判定 ============

  /** 当前是否在作业/考试「作答页」（dohomework / doexamination） */
  function isAnswerPage() {
    try {
      const h = String(location.hash || '');
      return /dohomework|doexamination/.test(h);
    } catch (e) {
      return false;
    }
  }

  /** 当前是否在作业/考试「列表页」（webExamList 且不含作答页关键字） */
  function isListPage() {
    try {
      const h = String(location.hash || '');
      if (!/webExamList/.test(h)) return false;
      return !/dohomework|doexamination/.test(h);
    } catch (e) {
      return false;
    }
  }

  /** 当前是作业还是考试（用于日志语义；两者 DOM 结构一致） */
  function examKind() {
    try {
      const h = String(location.hash || '');
      if (/doexamination/.test(h)) return '考试';
      if (/dohomework/.test(h)) return '作业';
    } catch (e) { /* 忽略 */ }
    return '作业/考试';
  }

  // ============ 章节范围过滤 ============
  //
  // 现状（如实说明）：作答页 URL 只有 recruitId/stuExamId/examId/courseId/schoolId，
  // 不含章节号；页面 DOM 也没有章节锚点。所以「按章节作答」目前只能在
  // 「能从 URL 或页面文字解析出章节号」时生效。
  //
  // 解析优先级：
  //   1. URL 查询参数 chapterNum / chapter / chapterId（部分入口会带）
  //   2. hash 段末（少数入口把章节拼在 hash 里）
  //   3. 页面标题/面包屑里的「第 N 章」
  // 全部拿不到 → 返回 null，调用方退化为「全部作答」并明确告知用户。

  const CHAPTER_SELECTORS = [
    '.examPaper_tit',
    '.examPaper_title',
    '.examPaper-head',
    '.subject_stem_title',
    '.crumbs',
    '.breadcrumb',
  ];

  /** 中文数字 → 阿拉伯数字（只处理 1~99 的常见写法，够章节用） */
  function cnNum(s) {
    const D = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    if (!s) return null;
    if (s === '十') return 10;
    let n = 0;
    if (s.includes('十')) {
      const [a, b] = s.split('十');
      n = (a ? D[a] || 0 : 1) * 10 + (b ? D[b] || 0 : 0);
    } else {
      n = D[s];
      if (n === undefined) return null;
    }
    return n;
  }

  /** 从文本里抽「第 N 章」「第N章」（阿拉伯数字与中文数字都认）里的 N */
  function parseChapterFromText(text) {
    const t = String(text || '');
    // 先认阿拉伯数字
    let m = t.match(/第\s*(\d+)\s*[章节单元]/);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    // 再认中文数字（真实站点标题常写「第三章」）
    m = t.match(/第\s*([一二三四五六七八九十零]{1,3})\s*[章节单元]/);
    if (m) {
      const n = cnNum(m[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  /** 解析当前作业/考试所属章节号；拿不到返回 null */
  function detectChapter() {
    // 1. URL 查询参数
    for (const key of ['chapterNum', 'chapter', 'chapterId', 'chapterNo']) {
      const v = U.getUrlParam(key);
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }

    // 2. hash 段末（形如 .../dohomework/{recruitId}/.../{schoolId}/{meetCourseType}）
    //    参数位不是章节，这里只在明确出现 chapter 字样时尝试
    try {
      const h = decodeURIComponent(String(location.hash || ''));
      const m = h.match(/chapter[^/]*?(\d+)/i);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) return n;
      }
      const t = parseChapterFromText(h);
      if (t) return t;
    } catch (e) { /* 忽略 */ }

    // 3. 页面可见文字（标题 / 面包屑）
    for (const sel of CHAPTER_SELECTORS) {
      let el = null;
      try { el = document.querySelector(sel); } catch (e) { el = null; }
      if (!el) continue;
      const n = parseChapterFromText(U.normText(el.innerText || el.textContent || ''));
      if (n) return n;
    }

    return null;
  }

  /**
   * 章节范围判断
   * @param {number|null} chapterNum 当前章节号；null = 未能识别
   * @param {number} from 起始章节（0 = 不限）
   * @param {number} to   结束章节（0 = 不限）
   * @returns {boolean}
   */
  function inChapterRange(chapterNum, from, to) {
    const lo = Number(from) || 0;
    const hi = Number(to) || 0;
    // 两端都是 0 → 不限
    if (lo === 0 && hi === 0) return true;
    // 未能识别章节 → 不拦（宁可多答，不可漏答；调用方会打日志告知）
    if (chapterNum == null) return true;
    if (lo > 0 && chapterNum < lo) return false;
    if (hi > 0 && chapterNum > hi) return false;
    return true;
  }

  // ============ 题目解析 ============

  const QTYPE = {
    SINGLE: 'single',
    MULTIPLE: 'multiple',
    JUDGEMENT: 'judgement',
    COMPLETION: 'completion',
    QA: 'qa',
    UNKNOWN: 'unknown',
  };

  /** 题型文案 → 内部题型（对照 review-worker-20 的【单选题】(2分) 格式） */
  function parseType(text) {
    const t = String(text || '');
    if (t.includes('多选')) return QTYPE.MULTIPLE;
    if (t.includes('单选')) return QTYPE.SINGLE;
    if (t.includes('判断')) return QTYPE.JUDGEMENT;
    if (t.includes('填空')) return QTYPE.COMPLETION;
    if (t.includes('简答') || t.includes('问答') || t.includes('论述')) return QTYPE.QA;
    return QTYPE.UNKNOWN;
  }

  /** 元素 HTML 里可能带 img，把 data-src 提到 src（复用 08-questions 的做法） */
  function hydrateImages(root) {
    if (!root) return;
    try {
      if (ZHS.Questions && ZHS.Questions.hydrateImages) {
        ZHS.Questions.hydrateImages(root);
        return;
      }
      root.querySelectorAll('img').forEach((img) => {
        if (img.dataset && img.dataset.src && img.src !== img.dataset.src) img.src = img.dataset.src;
      });
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 采集页面上的全部题目
   * @returns {Array<{id, type, stem, options, optionEls, node, index}>}
   */
  function collectQuestions() {
    const out = [];
    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll('.examPaper_subject'));
    } catch (e) {
      ZHS.Log.warn(PREFIX + ' 题目选择器查询失败：' + e.message);
      return out;
    }

    nodes.forEach((node, index) => {
      try {
        hydrateImages(node);

        // 题干（.subject_describe 是 innerHTML 注入，取 textContent）
        const stemEl = node.querySelector('.subject_describe');
        const stem = U.normText(stemEl ? (stemEl.textContent || '') : '') ||
          U.normText(node.textContent || '').slice(0, 300);

        // 题型：优先看 .subject_type 的「【单选题】(2分)」
        let typeText = '';
        const typeEl = node.querySelector('.subject_type_describe .subject_type') ||
          node.querySelector('.subject_type');
        if (typeEl) typeText = U.normText(typeEl.textContent || '');
        const type = parseType(typeText);

        // 选项
        const optionEls = Array.from(node.querySelectorAll('.subject_node > .nodeLab'));
        const options = optionEls.map((lab) => {
          const txt = lab.querySelector('.node_detail.examquestions-answer') ||
            lab.querySelector('.node_detail');
          return U.normText(txt ? (txt.textContent || '') : (lab.textContent || ''));
        });

        out.push({
          id: (node.dataset && node.dataset.questionid) || ('idx' + index),
          qno: U.normText((node.querySelector('.subject_num') || {}).textContent || '') || String(index + 1),
          type,
          typeText,
          stem,
          options,
          optionEls,
          node,
          index,
        });
      } catch (e) {
        ZHS.Log.warn(PREFIX + ' 第 ' + (index + 1) + ' 题解析失败：' + e.message);
      }
    });

    return out;
  }

  // ============ 答案获取（复用现有双通道：题库 → LLM）============

  /**
   * 取答案
   * 复用 ZHS.Solver.solve({title, options, type})，它内部已实现
   * 「题库优先（ZHS.Bank.search）→ LLM 兜底（ZHS.LLM.vote）→ 按 gatedRandom 决定是否蒙」。
   * @returns {Promise<{answer, from}|null>}
   */
  async function askAnswer(q) {
    if (!ZHS.Solver || typeof ZHS.Solver.solve !== 'function') {
      ZHS.Log.warn(PREFIX + ' 解题器（ZHS.Solver）不可用，无法取答案');
      return null;
    }
    try {
      const r = await ZHS.Solver.solve({
        title: q.stem,
        options: q.options,
        type: q.type,
      });
      return r || null;
    } catch (e) {
      ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题求解异常：' + (e && e.message));
      return null;
    }
  }

  // ============ 答案回填 ============

  /** 判断选项是否已选中（复用 ZHS.Filler.isChecked，兜底自己实现） */
  function optionChecked(el) {
    try {
      if (ZHS.Filler && typeof ZHS.Filler.isChecked === 'function') return ZHS.Filler.isChecked(el);
    } catch (e) { /* 落到兜底 */ }
    const input = el && el.querySelector && el.querySelector('input');
    return !!(input && input.checked);
  }

  /**
   * 勾选一个选项
   *
   * 关键点：智慧树用 Vue 的 v-model="checkboxVal" 绑在 .nodeLab input 上。
   * 直接改 input.checked 不会触发 Vue 更新，必须补发 change / input 事件；
   * 优先直接 click()（最贴近真人操作，Vue 自己能收到）。
   */
  async function checkOption(el) {
    if (!el) return false;
    if (optionChecked(el)) {
      ZHS.Log.debug(PREFIX + ' 选项已选中，跳过（防取消）');
      return true;
    }

    const input = el.querySelector('input');

    // 1. 优先点 input：Vue 的 v-model 在 input 上，click 会自动同步数据
    if (input) {
      try { input.click(); } catch (e) {
        try {
          input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } catch (e2) { /* 忽略 */ }
      }
      await U.sleep(220);
      if (input.checked) return true;
    }

    // 2. 点整块 .nodeLab（外层 label 有点击代理）
    try { el.click(); } catch (e) { /* 忽略 */ }
    await U.sleep(220);
    if (optionChecked(el)) return true;

    // 3. 兜底：直接改 checked + 补发事件（让 v-model 收到）
    if (input) {
      try {
        input.checked = true;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await U.sleep(120);
        if (input.checked) return true;
      } catch (e) { /* 忽略 */ }
    }

    ZHS.Log.warn(PREFIX + ' 选项点击后仍未选中');
    return false;
  }

  /** 把答案文本与选项文本做模糊匹配，返回选项索引；匹配不上返回 -1 */
  function matchOptionByText(answer, options) {
    const a = U.normText(answer);
    if (!a || !options || !options.length) return -1;

    const norm = (s) => U.normText(s)
      .replace(/^[A-Da-d][.、．)）:：]?\s*/, '')   // 去掉「A. 」这类前缀再比
      .replace(/[\s,，。.、;；:：]/g, '');

    const na = norm(a);

    // 完全相等
    for (let i = 0; i < options.length; i++) {
      if (norm(options[i]) === na) return i;
    }
    // 互相包含
    for (let i = 0; i < options.length; i++) {
      const no = norm(options[i]);
      if (!no) continue;
      if (no.includes(na) || na.includes(no)) return i;
    }
    return -1;
  }

  /**
   * 解析答案 → 选项索引数组
   * 两种策略都试：① A/B/C/D 字母 → 索引  ② 答案文本包含匹配
   */
  function resolveIndexes(answer, options) {
    // ① 字母
    let idxs = [];
    try {
      if (ZHS.Bank && typeof ZHS.Bank.toIndexes === 'function') idxs = ZHS.Bank.toIndexes(answer) || [];
    } catch (e) { idxs = []; }

    if (idxs.length) {
      const valid = idxs.filter((i) => i >= 0 && i < options.length);
      if (valid.length) return valid;
    }

    // ② 文本包含匹配（答案可能是「正确」「北京」这类）
    const i = matchOptionByText(answer, options);
    if (i >= 0) return [i];

    return [];
  }

  /**
   * 回填一道选择题 / 判断题
   * @returns {Promise<boolean>} 是否真的选上了
   */
  async function fillChoice(q, answer) {
    const idxs = resolveIndexes(answer, q.options);
    if (!idxs.length) {
      ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题答案「' + String(answer).slice(0, 30) +
        '」无法对应到选项（共 ' + q.options.length + ' 个），跳过');
      return false;
    }

    let done = 0;
    for (const i of idxs) {
      const el = q.optionEls[i];
      if (!el) continue;
      // eslint-disable-next-line no-await-in-loop
      const okOne = await checkOption(el);
      if (okOne) done++;
    }
    if (done > 0) return true;

    ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题选项全部点击失败');
    return false;
  }

  /**
   * 回填判断题
   * 判断题 DOM 同样是 .nodeLab 选项（通常两个：对 / 错），
   * 先按「对/错」文本匹配，匹配不到再用索引兜底（0=对，1=错）。
   */
  async function fillJudgement(q, answer) {
    const ans = String(answer || '').trim();
    const isTrue = /^(对|正确|是|√|✓|true|t)$/i.test(ans);
    const isFalse = /^(错|错误|否|×|✗|false|f)$/i.test(ans);

    if (!isTrue && !isFalse) {
      // 不是标准判定词，退回通用匹配
      return fillChoice(q, answer);
    }

    // 1. 文本匹配
    for (let i = 0; i < q.optionEls.length; i++) {
      const t = U.normText(q.options[i]);
      if (isTrue && /^(对|正确|是|√|✓|true|t)/i.test(t)) {
        return checkOption(q.optionEls[i]);
      }
      if (isFalse && /^(错|错误|否|×|✗|false|f)/i.test(t)) {
        return checkOption(q.optionEls[i]);
      }
    }
    // 2. 索引兜底
    const idx = isTrue ? 0 : 1;
    if (q.optionEls[idx]) return checkOption(q.optionEls[idx]);

    ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题判断题未能定位选项');
    return false;
  }

  // ============ 提交 ============

  /** 找到可点的提交按钮（必须先确认不是 disable-color） */
  function findSubmitButton() {
    let btn = null;
    try { btn = document.querySelector('button.submit-btn'); } catch (e) { btn = null; }
    if (!btn) return null;

    const cls = btn.className || '';
    if (/disable-color/.test(cls)) {
      ZHS.Log.warn(PREFIX + ' 提交按钮处于禁用态（.disable-color），不点击');
      return null;
    }
    if (!/active-color/.test(cls)) {
      // 类名可能随版本变化；没有明确禁用才允许点
      ZHS.Log.warn(PREFIX + ' 提交按钮未带 .active-color，类名为「' + cls + '」，仍尝试点击（请留意结果）');
    }
    return btn;
  }

  /** 等待若干秒（给用户反悔机会），面板可看到倒计时日志 */
  async function waitBeforeSubmit(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    if (total <= 0) return;
    ZHS.Log.info(PREFIX + ' ' + total + ' 秒后自动提交（想反悔请尽快点「停止」或手动操作页面）');
    for (let i = total; i > 0; i--) {
      // eslint-disable-next-line no-await-in-loop
      await U.sleep(1000);
      if (i <= 3 || i % 5 === 0) ZHS.Log.debug(PREFIX + ' 距提交还有 ' + i + ' 秒');
    }
  }

  // ============ 主流程 ============

  const Exam = {
    isAnswerPage,
    isListPage,
    examKind,
    detectChapter,
    inChapterRange,
    collectQuestions,
    parseType,
    resolveIndexes,
    _running: false,
    _done: false,        // 本页是否已处理过（防 SPA 重复触发）
    _sig: '',            // 本页处理签名（URL + 题目数），变了才重新处理

    /**
     * 作答当前页
     * @param opts.manual 面板「答题」按钮手动触发：跳过 autoExam 开关
     */
    async solvePage(opts) {
      const manual = !!(opts && opts.manual);
      const cfg = ZHS.config;

      // —— 门禁 1：必须在作答页 ——
      if (!isAnswerPage()) {
        if (manual) ZHS.Log.warn(PREFIX + ' 当前不在作业/考试作答页，无需作答');
        return;
      }

      // —— 门禁 2：总开关（手动触发绕过）——
      // 【严格判断】必须用 !== true，不能用 !cfg.autoExam。
      // 这是个「默认关闭」的安全开关：一旦存储被写入脏值（如字符串 "no"、"false"、"0"），
      // `!"no"` 为 false，会把自动答题【偷偷打开】—— 在考试场景下这是不可接受的。
      // 只有明确等于 true 才放行。
      if (!manual && cfg.autoExam !== true) return;

      if (this._running) {
        ZHS.Log.debug(PREFIX + ' 作答流程进行中，跳过重复触发');
        return;
      }

      const kind = examKind();

      // —— 章节识别 ——
      const chapter = detectChapter();
      // 【数值夹逼】范围必须是非负整数。直接改存储/调 API 写入 -5 或 999 时，
      // 负数会被当成「不限」，造成意外的越权范围。统一夹到 0~999 的整数。
      const clampCh = (v) => {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.min(n, 999);
      };
      const from = clampCh(cfg.examChapterFrom);
      const to = clampCh(cfg.examChapterTo);
      const ranged = from > 0 || to > 0;

      if (ranged) {
        if (chapter == null) {
          ZHS.Log.warn(PREFIX + ' 未能识别当前' + kind + '所属章节（URL 与页面均无章节信息），按全部作答。' +
            '如需精确按章节，请把章节范围改回 0');
        } else if (!inChapterRange(chapter, from, to)) {
          ZHS.Log.info(PREFIX + ' 当前' + kind + '属于第 ' + chapter + ' 章，不在设定范围（' +
            (from || '不限') + '~' + (to || '不限') + '）内，本次不作答');
          return;
        } else {
          ZHS.Log.info(PREFIX + ' 当前' + kind + '属于第 ' + chapter + ' 章，在设定范围内，开始作答');
        }
      }

      this._running = true;
      const t0 = Date.now();
      try {
        ZHS.Log.info(PREFIX + ' 检测到' + kind + '作答页，开始自动作答（守株待兔模式：答完即停，不会跳转其它任务）');

        // 等题目渲染出来（Vue 是异步渲染的）
        let questions = collectQuestions();
        for (let i = 0; i < 20 && !questions.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          await U.sleep(500);
          questions = collectQuestions();
        }

        if (!questions.length) {
          ZHS.Log.warn(PREFIX + ' 未找到题目（.examPaper_subject 为空），可能页面结构变化或尚未加载完成');
          return;
        }

        ZHS.Log.info(PREFIX + ' 共 ' + questions.length + ' 题');

        const skippedTypes = [];
        const failed = [];       // 未答上的题号
        let answered = 0;
        let subjective = 0;

        for (const q of questions) {
          // —— 主观题（填空/简答/问答）：跳过，不瞎填 ——
          if (q.type === QTYPE.COMPLETION || q.type === QTYPE.QA) {
            subjective++;
            skippedTypes.push(q.qno + '(' + q.typeText + ')');
            ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题是主观题（' + (q.typeText || '填空/问答') +
              '），自动作答不处理，请手动完成');
            continue;
          }

          if (!q.stem && !q.options.length) {
            ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题既无题干也无选项，跳过');
            failed.push(q.qno);
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const result = await askAnswer(q);
          if (!result || !result.answer) {
            ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题未取得答案，跳过（未配置 LLM Key 或题库未命中）');
            failed.push(q.qno);
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          let okOne = false;
          if (q.type === QTYPE.JUDGEMENT) {
            // eslint-disable-next-line no-await-in-loop
            okOne = await fillJudgement(q, result.answer);
          } else {
            // eslint-disable-next-line no-await-in-loop
            okOne = await fillChoice(q, result.answer);
          }

          if (okOne) {
            answered++;
            ZHS.state.answeredCount++;
            ZHS.Log.info(PREFIX + ' 第 ' + q.qno + ' 题已作答：' + String(result.answer).slice(0, 40) +
              '（来源 ' + (result.from || '未知') + '）');
          } else {
            failed.push(q.qno);
            ZHS.Log.warn(PREFIX + ' 第 ' + q.qno + ' 题回填失败：答案 ' + String(result.answer).slice(0, 40));
          }

          // 每题之间的间隔（复用现有 answerDelay 配置）
          const d = Number(cfg.answerDelay) || 0;
          // eslint-disable-next-line no-await-in-loop
          if (d > 0) await U.sleep(d * 1000);
        }

        // —— 结果小结 ——
        const cost = ((Date.now() - t0) / 1000).toFixed(1);
        ZHS.Log.info(PREFIX + ' 作答完成：成功 ' + answered + ' / ' + questions.length +
          ' 题，耗时 ' + cost + ' 秒');

        if (subjective > 0) {
          ZHS.Log.warn(PREFIX + ' 有 ' + subjective + ' 道主观题未处理（题号：' +
            skippedTypes.join('、') + '），请手动作答');
        }
        if (failed.length) {
          ZHS.Log.warn(PREFIX + ' 以下题号未答上：' + failed.join('、') + '（建议手动补答）');
        }

        // —— 提交 ——
        // 注意：这里【只提交当前这一页】，绝不跳转、绝不寻找下一个任务。
        if (!cfg.examSubmit) {
          ZHS.Log.info(PREFIX + ' 「答完自动提交」已关闭，答案已填入页面，请自行检查后手动提交');
          if (ZHS.panel) ZHS.panel.alert(kind + '已作答 ' + answered + ' 题，请手动检查后提交', 'info', 8000);
          return;
        }

        if (answered === 0) {
          ZHS.Log.warn(PREFIX + ' 一题都没答上，不自动提交（避免交白卷）');
          if (ZHS.panel) ZHS.panel.alert('该' + kind + '一题都没答上，已跳过自动提交，请手动处理', 'warn', 10000);
          return;
        }

        await waitBeforeSubmit(cfg.examSubmitDelay);

        const btn = findSubmitButton();
        if (!btn) {
          ZHS.Log.warn(PREFIX + ' 未找到可点击的提交按钮，请手动点「提交」');
          if (ZHS.panel) ZHS.panel.alert('未找到提交按钮，请手动提交', 'warn', 8000);
          return;
        }

        try {
          btn.click();
          ZHS.Log.info(PREFIX + ' 已点击「提交」按钮');
        } catch (e) {
          try {
            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            ZHS.Log.info(PREFIX + ' 已派发提交点击事件');
          } catch (e2) {
            ZHS.Log.warn(PREFIX + ' 提交点击失败：' + e2.message);
            return;
          }
        }

        await U.sleep(1200);
        ZHS.Log.info(PREFIX + ' 流程结束。本模块到此为止：不跳转、不寻找下一个作业/考试');
        if (ZHS.panel) {
          ZHS.panel.alert(kind + '自动作答并提交完成（' + answered + ' 题）。' +
            (failed.length ? '有 ' + failed.length + ' 题未答上，请检查。' : ''), 'info', 10000);
        }

        // 标记本页处理完，防止 SPA 反复触发
        this._done = true;
        this._sig = location.hash + '|' + questions.length;
      } catch (e) {
        // 任何异常都不外溢，只记录，保证不打断页面其它功能
        ZHS.Log.error(PREFIX + ' 作答流程异常：' + (e && e.message));
      } finally {
        this._running = false;
      }
    },

    /** 重置「本页已处理」标记（切页后调用） */
    reset() {
      this._done = false;
      this._sig = '';
    },

    /** 对外暴露禁止事项，方便测试断言 */
    FORBIDDEN,
  };

  ZHS.Exam = Exam;

  // ============ 自启动（严格安全）============
  //
  // 安全要求（前车之鉴：06b-course-hub 会主动跳转，本模块【禁止】任何跳转动作）：
  //   · 只在「作答页」做检测
  //   · 只有 autoExam === true 才真正作答
  //   · 在「列表页」仅打一条 debug 日志，绝不点击任何东西
  //   · 开关关闭时行为与改动前【完全一致】

  function tick() {
    try {
      if (isAnswerPage()) {
        const cfg = ZHS.config;

        // 严格判断：只有明确 true 才作答。脏值（"no"/"false"/0）一律视为关闭，
        // 不能让「默认关闭」的安全开关被非布尔值绕过（见 solvePage 门禁 2 的说明）。
        if (cfg.autoExam !== true) {
          // 关闭态：只提示一次，什么都不做
          if (!Exam._notified) {
            Exam._notified = true;
            ZHS.Log.info(PREFIX + ' 检测到' + examKind() + '作答页。开启面板「自动答题（作业/考试）」后，' +
              '脚本会在你自己点进来时自动作答并提交；脚本不会自动跳转到本页');
          }
          return;
        }

        // 已处理过且 URL 没变 → 不重复（SPA 的 MutationObserver / 定时器会反复触发）
        const sig = location.hash;
        if (Exam._done && Exam._sig && Exam._sig.indexOf(sig) === 0) return;

        // 防重入 + 定时器兜底：solvePage 内部也有 _running 保护
        if (!Exam._running) Exam.solvePage();
        return;
      }

      if (isListPage()) {
        // 列表页：只记录，绝无自动点击（这是用户明确要求的「守株待兔」）
        if (!Exam._listNotified) {
          Exam._listNotified = true;
          ZHS.Log.debug(PREFIX + ' 当前是作业/考试列表页。本模块不会自动进入任何作业或考试，' +
            '请自行点进想作答的那一个');
        }
      }
    } catch (e) {
      ZHS.Log.debug(PREFIX + ' 检测异常：' + (e && e.message));
    }
  }

  // 页面加载后先等平台渲染，再轮询检测。
  // 用轮询而不用 MutationObserver：SPA 路由切换（hash 变化）不产生 DOM mutation 时
  // MutationObserver 收不到，轮询更稳，且开销极低（3 秒一次，几乎全是字符串判断）。
  function bootstrap() {
    setTimeout(tick, 2000);
    setInterval(tick, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  ZHS.Log.debug(PREFIX + ' 模块已加载（守株待兔模式：只在作答页工作，永不自动跳转）');
})();
