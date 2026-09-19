/**
 * 题目采集层：从三种场景抽取结构化题目
 *
 * 场景 A：课中弹题   #playTopic-dialog
 * 场景 B：共享课作业  .subject_node
 * 场景 C：hike 作业/考试  .q_main
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod08_questions) return;
  ZHS.__mod08_questions = true;
  const U = ZHS.Util;

  /** 内部题型枚举 */
  const TYPE = {
    SINGLE: 'single',       // 单选
    MULTIPLE: 'multiple',   // 多选
    JUDGEMENT: 'judgement', // 判断
    COMPLETION: 'completion', // 填空
    QA: 'qa',               // 简答
    UNKNOWN: 'unknown',
  };

  /** 题库 API 的 type 编码：0单选 1多选 2填空 3判断 4问答 */
  const BANK_TYPE = {
    [TYPE.SINGLE]: 0,
    [TYPE.MULTIPLE]: 1,
    [TYPE.COMPLETION]: 2,
    [TYPE.JUDGEMENT]: 3,
    [TYPE.QA]: 4,
    [TYPE.UNKNOWN]: 0,
  };

  /** 文本 → 内部题型 */
  function guessType(text, options) {
    const t = String(text || '');
    if (t.includes('多选')) return TYPE.MULTIPLE;
    if (t.includes('单选')) return TYPE.SINGLE;
    if (t.includes('判断')) return TYPE.JUDGEMENT;
    if (t.includes('填空')) return TYPE.COMPLETION;
    if (t.includes('简答') || t.includes('问答')) return TYPE.QA;

    // 从选项文本推断：只有"对/错"就是判断题
    if (options && options.length === 2) {
      const joined = options.join('');
      if (/^(对|正确|是|T|True)/i.test(joined) && /(错|错误|否|F|False)/i.test(joined)) {
        return TYPE.JUDGEMENT;
      }
    }
    // 选项 4 个以上且文本以 A. B. 开头 → 单选兜底
    if (options && options.length >= 2) return TYPE.SINGLE;
    return TYPE.UNKNOWN;
  }

  /** 安全取元素文本：优先 innerText，降级 textContent（jsdom 不实现 innerText） */
  function readText(el) {
    if (!el) return '';
    const t = el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent;
    return U.normText(t || '');
  }

  /** 图片延迟加载处理：智慧树把真实地址放 data-src */
  function hydrateImages(root) {
    if (!root) return;
    const imgs = root.querySelectorAll('img');
    for (const img of imgs) {
      if (img.dataset && img.dataset.src && !img.src) {
        img.src = img.dataset.src;
      } else if (img.dataset && img.dataset.src && img.src !== img.dataset.src) {
        img.src = img.dataset.src;
      }
    }
  }

  /** 判断元素内是否有图片（用于决定要不要 OCR） */
  function hasImage(root) {
    if (!root) return false;
    return root.querySelectorAll('img').length > 0;
  }

  /**
   * 场景 A：课中弹题
   * 结构：#playTopic-dialog 内 .el-pager .number 分页
   */
  /**
   * 弹题容器选择器（单一真源取自 ZHS.Const，字面量兜底防加载顺序异常）。
   * 必须与 src/05-scheduler.js 的守卫 2 判据逐字一致，否则会出现
   * 「调度器认为有弹题 / 答题器找不到容器」或反过来的错位，脚本对弹窗毫无反应。
   */
  const DIALOG_SELECTORS = (ZHS.Const && ZHS.Const.QUESTION_SELECTORS)
    || '#playTopic-dialog, [class*="topic-dialog"], .el-dialog__wrapper .el-dialog';

  /** 选项类元素（用于判断一个弹窗「是不是题」） */
  const OPTION_FEATURE_SELECTORS = '.el-radio, .el-checkbox, [role="radio"], [role="option"],'
    + ' .option-item, .choice-item, .answer-option, ul li';
  /** 题干类元素（同上） */
  const TITLE_FEATURE_SELECTORS = '.topic-title, .topic-content, .question-topic,'
    + ' .el-dialog__title, .topic-question';

  /**
   * 选项文本识别正则（方案 A，round-19 P1 修复）。
   *
   * 旧正则 `^([abAB][.、,:：)]?\s|...)` 里的 `\s` **不在 `?` 可选范围内**，
   * 即「A/B 后面必须再跟一个空白」才算匹配。实际后果：`"A"`、`"A."`、`"A.对"`、
   * `"A、对"` 全部落空 → 按钮式弹窗读不到选项 → 又只能乱猜（P1 复现）。
   *
   * 现在拆成四类分支（任一命中即算选项样文本）：
   *   ① `[abAB][分隔符]?\s*$`   —— 单独一个 A/B，可带分隔符、可带尾随空白（"A" / "A." / "A、"）
   *   ② `[abAB][分隔符]\s*\S`   —— A/B + 分隔符 + 任意内容（"A.对" / "A、对" / "A. 说法"）
   *   ③ `[abAB](?!字母)[空白或标点][^字母数字]\s*(?![A-Za-z])\S` —— A/B + 分隔符 + 非拉丁开头内容
   *                              覆盖 "A 说法"/"A、对"；"A group"/"A 组" 因内容以拉丁字母开头被排除
   *   ④ 关键字：对/错/正确/错误/是/否/√/× 收尾或开头（判断题常见）
   *
   * 误报控制（实测已验证，见 CHANGELOG）：`"Apple"` / `"About"` / `"A组"` / `"A货"` / `"AB"`
   * 均**不匹配** —— 因为 A/B 之后要么是行尾/分隔符，要么必须是空白+非字母数字，
   * 直接跟字母/汉字（"A组"）不满足任何一个分支。
   */
  const OPTION_TEXT_RE = new RegExp(
    '^(?:[abAB][.、,:：)）]?\\s*$'                       // ① 纯 A/B（可带分隔符与尾空白）
    + '|[abAB](?![\\p{L}])[.、,:：)）]\\s*\\S'            // ② A/B + 分隔符 + 内容
    + '|[abAB](?![\\p{L}])[.、,:：)）]?[^\\p{L}\\p{N}]\\s*(?![a-zA-Z])\\S' // ③ A/B + 空白/标点 + 非拉丁字母内容（"A 说法"，排除 "A group"）
    + '|对$|错$|正确|错误|是$|否$|√|×)',                 // ④ 判断类关键字
    'u'
  );

  /** 操作词：这些同款成组的按钮是页脚操作栏，不是选项（供结构对称判据排除） */
  const ACTION_WORDS = ['关闭', '确定', '提交', '取消', '我知道了', '知道了', '继续学习',
    '下一题', '上一题', '确认', '返回', '提交答案'];

  /**
   * 导航/流程词：**无论如何都不可能是选项**，混进选项组必须逐个摘掉。
   * 与 ACTION_WORDS 的区别：ACTION_WORDS 里的「确定/关闭」在极少数真题里可能正好是选项文本
   * （见测试⑩「确定 / 不正确」），而「上一题/下一题/继续学习」永远只可能是导航控件 ——
   * 一旦它们出现在选项组里，要么是混入（摘掉即可），要么整组就是导航条（摘完剩 0/1 → 弃用）。
   */
  const NAV_WORDS = ['上一题', '下一题', '继续学习', '返回', '我知道了', '知道了', '提交答案'];

  /**
   * 题目**元信息标签**正则（round-23 新增）—— 整组命中即弃用。
   *
   * 为什么需要：题干之后紧跟的往往是「题型 / 分值 / 难度」这类元信息，且它们
   * **同父、同 tag、同 class**（如 `<div class="tag">单选题</div><div class="tag">2分</div>`），
   * 满足结构对称判据 → 会被方案 B/C/D 当成选项组。实测：0.6.25 方案 D 主路径短路时，
   * 这种组会**顶掉真正的选项**（返回 `["单选题","2分"]`），把元信息当答案送去解题。
   * 判据放在 `_cleanGroup`（B/C/D 共用管线），三条通道一起受益。
   */
  const META_RE = /^(单选题|多选题|判断题|填空题|简答题|选择题|不定项选择题|\d+\s*分|难度[:：]?.*|【.*】)$/;

  /** 方案 C 结构对称自动发现的深度上限：只扫 scope 下 ≤ N 层的节点，控制主循环开销 */
  const AUTO_MAX_DEPTH = 6;

  /** 深度触顶日志只打一次（避免每轮刷屏） */
  let _depthWarned = false;

  /**
   * 组件噪声黑名单（方案 C 兜底判据）—— 命中即整组弃用。
   *
   * 为什么还要这条兜底：分页器 / 步骤条 / 选项卡 / 面包屑 / 视频控制条
   * 天生就是「同父 + 同 tag + 同 class + 数量 3~4」的整齐对称结构，
   * 在方案 C（全树猜测）里会压过只有 2 项的真选项。
   *
   * 【round-22 P1① 修正 —— 只顾自身，不再爬祖先链】
   * 旧实现从元素自身一路爬到 40 层祖先，逐个 className 匹配。实测致命后果：
   * 弹题弹窗极度可能**嵌在播放器容器（`video-js` / `prism-player`）内部**，
   * 于是一旦祖先里有 `video-js`，弹窗内**所有真选项**都被判成噪声 → `texts=[]` → 全平台弹题读不到。
   * 同理，选项自身 class 恰好叫 `el-menu-item` 也会被误杀。
   * 现在方案 D（题干锚定）用**位置先验**排除噪声，黑名单只需兜「元素自己就长得像导航件」，
   * 所以**只看元素自身的 className**，不再爬祖先链 —— 把「祖先是不是播放器」这种事交给位置判据。
   *
   * 匹配方式：对元素自身 className 做**分词精确匹配**
   * （`(' '+cls+' ').includes(' '+name+' ')`）—— 比子串安全，`el-step` 不会误伤 `el-stepper`。
   */
  const NOISE_CLASSES = ['el-pager', 'el-step', 'el-steps', 'el-tabs__item', 'el-tabs__nav',
    'el-breadcrumb', 'el-rate', 'el-menu', 'el-menu-item', 'el-pagination', 'el-carousel',
    'el-collapse-item', 'el-timeline-item', 'vjs-control-bar', 'vjs-control', 'prism-player',
    'video-js', 'dplayer', 'artplayer', 'plyr__controls', 'courseware-menu'];

  /** 元素**自身**的 className 命中噪声名单 → true（只看自身，不爬祖先，见上方 P1① 说明） */
  function inNoiseContainer(el) {
    if (!el) return false;
    const cls = el.className;
    if (typeof cls !== 'string' || !cls) return false;
    const padded = ' ' + cls.split(/\s+/).filter(Boolean).join(' ') + ' ';
    for (let i = 0; i < NOISE_CLASSES.length; i++) {
      if (padded.indexOf(' ' + NOISE_CLASSES[i] + ' ') >= 0) return true;
    }
    return false;
  }

  /**
   * 判断题符号白名单（供 `looksLikeNoiseTexts` 与 `isSingleNoiseToken` 共用）。
   * 与 `OPTION_TEXT_RE` 第 ④ 分支保持一致：这几个符号是判断题的合法选项。
   */
  const JUDGE_SYMBOLS = ['√', '×', '✓', '✗'];

  /**
   * 内容形状过滤 —— 判断一组文本「像不像答案」。
   * 传入已摘除噪声成员后的文本数组，返回 true 表示该组**应当弃用**：
   *   - 组内**全部**为纯数字 `/^\d+$/` → 是分页器（1/2/3）
   *   - 组内**全部**为纯符号 `/^[^\p{L}\p{N}]+$/u` 且**不含判断题符号** → 是图标组（‹ › × …）
   *
   * 【round-22 P1④ 修正】判断题选项「√ / ×」本身也是纯符号，若一律按符号组否决，
   * 会与 `OPTION_TEXT_RE`（第 ④ 分支明确收 √ ×）以及 `isSingleNoiseToken`（已白名单放行）矛盾。
   * 因此这里先把判断题符号排除出「符号组」判定：一组全是 √/× 时**不**判噪声。
   */
  function looksLikeNoiseTexts(texts) {
    if (!texts.length) return true;
    if (texts.every((t) => /^\d+$/.test(t))) return true;                 // 全数字 → 分页器
    const allSymbol = texts.every((t) => /^[^\p{L}\p{N}]+$/u.test(t));
    const anyJudge = texts.some((t) => JUDGE_SYMBOLS.indexOf(t) >= 0);
    if (allSymbol && !anyJudge) return true;                             // 全符号且非判断题符 → 图标组
    return false;
  }

  /**
   * 成员级噪声 token 判定（方案 C 兜底判据的成员级补充）。
   *
   * 为什么不能简单用 `text.length <= 1` 一刀切（round-22 性能用例回归教训）：
   * 「甲」「乙」这类**单个汉字**是极常见的合法选项文本，长度也是 1；
   * 用长度一刀切会把它误判成噪声 → `_autoSiblings` 整组读空 → 性能/真题双双失败。
   * 真正该挡的是**形状**而非长度。
   *
   * 【round-22 P1④ 修正 —— 与 `OPTION_TEXT_RE` 保持一致】
   *  `OPTION_TEXT_RE` 第 ④ 分支明确把 `√ | ×` 当选项（判断题专用），
   *  而本函数原先返回 `true`（判噪声）→ **两条判据自相矛盾**：真选项「√/×」被自己人杀掉。
   *  现在加判断题符号白名单 `√ × ✓ ✗`，明确放行。
   * 【round-22 P1④ 修正 —— 删掉单数字分支】
   *  「组内全是纯数字」已由 `looksLikeNoiseTexts` 在**组级**挡掉；成员级再挡「单数字」属重复过严，
   *  会把「选项组 = ["1","说法二"]」这种真题误杀（测 25）。故删除 `/^\d$/` 分支。
   *  保留「单符号」弃用（「?」「›」这种确实不是选项）。
   *
   * @param {string} text 已 trim 的文本
   * @returns {boolean} true 表示该成员是噪声 token，应导致本组不可用
   */
  function isSingleNoiseToken(text) {
    if (!text) return true;
    if (JUDGE_SYMBOLS.indexOf(text) >= 0) return false;   // 判断题符号 → 合法选项
    if (text.length !== 1) return false;
    if (/^[^\p{L}\p{N}]$/u.test(text)) return true;       // 单符号（非判断题符） → 图标
    return false;                                         // 单字母/单汉字/单数字 → 合法选项
  }

  /**
   * 选项组打分（方案 C 兜底判据）—— 分高者胜，取代旧的「谁长谁赢」。
   *
   * 为什么必须换掉「长度优先」：任何 3~4 项对称结构（分页器/步骤条/选项卡/面包屑/控制条）
   * 天生比 2 项真选项长，长度优先等于「噪声必胜」。
   *
   * 【round-22 P1② 修正 —— 权重单调化，前缀奖励绝不可能超过项数基数差】
   * 旧权重 `2项=100 / 3项=30 / 4项=10，前缀每个+40`：实测
   * `[3项带 A./B./C. 前缀] = 30 + 120 = 150` **盖过** `[2项真选项] = 100 + 0 = 100`
   * → 点了面包屑上的「A. 首页」。根因是**前缀奖励能压过项数基数**。
   * 现改为（2 项必须绝对优先，因为 A/B 单选是主场景）：
   *   - 项数基数：2 项 = 1000 / 3 项 = 300 / 4 项 = 100
   *   - 前缀奖励：每个 +10，**最多计 2 个**（上限 +20）
   *   - 文本长度：lenSum / 100（弱信号）
   *   - **不再用 depth 当 tie-break**（深度是噪声的帮凶：越深的噪声越占优）
   *
   * 单调性约束（测 21 断言）：`2项无前缀最小分 1000` **>** `4项满前缀最大分 100+20+len/100`。
   * 4 项文本最多 4×200=800 字符 → len/100 ≤ 8 → 上限 128 < 1000 ✓。
   *
   * @param {string[]} texts 组内（已清洗）文本
   * @param {number} depth 该组相对 scope 的深度（保留入参兼容调用方，不再参与打分）
   * @returns {number} 得分
   */
  function scoreOptionGroup(texts, depth) { // eslint-disable-line no-unused-vars
    const n = texts.length;
    let score = 0;
    if (n === 2) score += 1000;
    else if (n === 3) score += 300;
    else score += 100;
    let prefixed = 0;
    for (const t of texts) if (OPTION_TEXT_RE.test(t)) prefixed++;
    score += Math.min(prefixed, 2) * 10;   // 上限 +20，永远压不过 2 项基数 1000
    let lenSum = 0;
    for (const t of texts) lenSum += Math.min(t.length, 200);
    score += lenSum / 100;
    return score;
  }

  /**
   * 父节点身份分配器（用于分组键）。
   *
   * 为什么不能用 `indexOf(p)` 当父身份：`indexOf(p)` 是「父在它自己的父里的下标」。
   * 两个完全无关的容器，只要各自都是其父的第 0 个子，下标就都是 0 → 分组键相同 → 被并成一组
   * （跨父串组，P1）。用 WeakMap 给每个父节点分配全局唯一序号，才是真正的「父身份」。
   * WeakMap 在元素被回收时自动释放，reset 时无需清理。
   */
  const _parentSeq = new WeakMap();
  let _parentSeqCounter = 0;
  function parentIdOf(el) {
    if (!el || (typeof el !== 'object' && typeof el !== 'function')) return 0;
    let v = _parentSeq.get(el);
    if (v === undefined) { v = ++_parentSeqCounter; _parentSeq.set(el, v); }
    return v;
  }

  /**
   * 内联样式可见性：只查 `style` 属性，**不调 getComputedStyle**。
   *
   * 为什么不调 getComputedStyle：jsdom 没有布局引擎，getComputedStyle 拿不到
   * 由样式表级联出来的 display:none，会给出错误答案；而平台真实关闭弹窗时
   * 往往是把 display:none 直接写在 inline style 上（Element UI 的 wrapper 就是这样）。
   * 只查 inline style 在两种环境里行为一致。
   *
   * 检查范围：元素自身 + 整条祖先链。因为 Element UI 关闭时隐藏的是
   * `.el-dialog__wrapper`（.el-dialog 的父节点），只查元素自身会漏判 → 误报「弹窗关不掉」。
   */
  function hasInlineHidden(el) {
    let node = el;
    while (node && node.style) {
      const display = node.style.display;
      const vis = node.style.visibility;
      if (display === 'none' || vis === 'hidden') return true;
      node = node.parentElement;
    }
    return false;
  }

  /** 元素是否「结构可见」且未通过 inline style 隐藏 */
  function visibleForDialog(el) {
    if (!el) return false;
    if (!U.isStructurallyVisible(el)) return false;
    return !hasInlineHidden(el);
  }

  /**
   * 给一个弹窗容器打「题目特征」分（分越高越像一道题）。
   *   3 = 同时有题干 + 选项（最像题）
   *   2 = 只有选项
   *   1 = 只有题干
   *   0 = 都不是（公告/提示/设置窗之类）
   */
  function questionScore(el) {
    const hasOpt = !!el.querySelector(OPTION_FEATURE_SELECTORS);
    const hasTitle = !!el.querySelector(TITLE_FEATURE_SELECTORS);
    if (hasOpt && hasTitle) return 3;
    if (hasOpt) return 2;
    if (hasTitle) return 1;
    return 0;
  }

  const DialogQuestions = {
    /**
     * 弹题容器（考虑 iframe 情况）。
     *
     * 【2026-09-19 修正】不再「取第一个匹配的 .el-dialog」——
     * 真实页面里设置窗/公告/提示弹窗同样用 .el-dialog，谁排在前面谁被选中：
     * 拿到设置窗 → 题干读成"设置"、选项读到设置项；更糟的是 present() 返回 false
     * 而调度器守卫（扫全量选择器）返回 true → 两侧判据错位，误报「请手动选 A 或 B」
     * 并暂停视频空跑。现改为遍历全部候选，选「题目特征分最高」的那个；
     * 分数相同取文档序第一个（多个都是题时取第一个，行为可预期）。
     */
    root() {
      const candidates = Array.from(document.querySelectorAll(DIALOG_SELECTORS))
        .filter((el) => visibleForDialog(el));
      let best = null;
      let bestScore = -1;
      for (const el of candidates) {
        const s = questionScore(el);
        if (s > bestScore) { best = el; bestScore = s; }
      }
      // 有明确「像题」的候选就返回它；一个都不是题（全是公告/设置窗）则整体判无弹题，
      // 绝不能退回「随便拿一个弹窗」——那正是错位的根源。
      if (best && bestScore > 0) return best;
      if (best) return null;

      // 关键坑：弹题可能渲染在 iframe 里
      const iframe = document.getElementById('tmDialog_iframe');
      if (iframe) {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          const inner = doc && doc.querySelector('#playTopic-dialog, .topic-title, ul');
          if (inner) return doc;
        } catch (e) {
          ZHS.Log.debug('弹题 iframe 跨域，无法访问');
        }
      }
      return null;
    },

    /**
     * 是否出现弹题。
     *
     * 判据必须与调度器的守卫对齐：守卫用 `hasStructurallyVisible(QUESTION_SELECTORS)`
     * 扫**全量**匹配元素，所以这里也要「存在任一『像题的』可见弹窗即 true」，
     * 不能只看第一个（否则多弹窗并存时守卫放行、答题器却说没有，判据错位）。
     */
    present() {
      const list = Array.from(document.querySelectorAll(DIALOG_SELECTORS))
        .filter((el) => visibleForDialog(el));
      return list.some((el) => questionScore(el) > 0);
    },

    /**
     * 采集所有分页的题目
     * 返回 [{ title, options[], type, pageIndex, elements }]
     */
    collect() {
      const root = this.root();
      if (!root) return [];

      const pages = Array.from(root.querySelectorAll('.el-pager .number'));
      const results = [];

      // 题干（弹题通常所有分页共享一个题干区，或每页一个）。
      // 【2026-09-19】必须复用 readCurrent 的题干/选项读取逻辑：
      // collect() 的 title 被 Answerer 拿去当**去重签名**（handleDialog 里
      // `JSON.stringify(snapshot.map(s => s.title))`），若这里读不到 Element UI 弹窗的题面，
      // 每一道 .el-dialog 题都会产出同一个空签名 '[""]' —— 结果是「答完第一道 A/B 弹题后，
      // 后续任意弹题都被当成已作答跳过」，用户侧表现就是「只有第一道题会答」。
      // 因此这里改为调用 readCurrent，保证与真正作答时读到的题面完全一致。
      const cur = this.readCurrent(root);
      const sharedTitle = (cur && cur.title) || '';
      const sharedOptEls = (cur && cur.elementList) || [];
      const sharedOpts = (cur && cur.options) || [];

      if (pages.length) {
        // 有分页：逐页收集（注意：这里只读文本，切换分页由答题器负责）
        pages.forEach((p, i) => {
          results.push({
            title: sharedTitle,
            options: [],
            type: TYPE.UNKNOWN,
            pageIndex: i,
            totalPages: pages.length,
            elements: { page: p, root },
            raw: '',
          });
        });
      } else {
        // 无分页：单题
        results.push({
          title: sharedTitle,
          options: sharedOpts,
          type: guessType(sharedTitle, sharedOpts),
          pageIndex: 0,
          totalPages: 1,
          elements: { page: null, root },
          elementList: sharedOptEls,
          raw: '',
        });
      }
      return results;
    },

    /**
     * 去重 + 归属净化：从原始命中列表里挑出「真正的同级选项」，丢掉两种噪声。
     *
     * 背景（2026-09-19 用户报「脚本没有在答这种题，只是乱点」）：
     * 旧选择器 `... .el-radio, .radio > label, ...` 里 `.el-radio` 与 `.radio > label`
     * 会**同时命中同一个选项**（Element UI 的 .el-radio 外层就是 label）→ 列表变成 [A,B,A,B]，
     * 按答案算出的索引会点到错误位置甚至同一项点两次（可能把已选中项点成取消）。
     *
     * 去重规则（两步）：
     *  1. 包含关系：若 el 被同批另一个元素 contains，说明 el 是那个元素的子孙/宿主，
     *     只保留更外层/更完整的那个，丢 el。
     *  2. 文本去重：同批里出现完全相同的文本，只保留第一个（纯属选择器重叠产生的重影）。
     */
    _dedupeOptions(list) {
      const noNested = list.filter((el) => !list.some((other) => other !== el && other.contains(el)));
      const seen = new Set();
      return noNested.filter((el) => {
        const t = readText(this._textHost(el));
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      });
    },

    /**
     * 取「该选项的文字应该从哪儿读」。
     * Element UI 的 .el-radio 外层 label 里除了选项文字，还可能夹带按钮 / 角标等杂项文本，
     * 因此有 `.el-radio__label` / `.el-checkbox__label` 子节点时优先取它，否则退回整个元素。
     *
     * 【2026-09-19 修正】优先取 `__label` 前必须**校验它有非空文本**。
     * 有些平台结构里 `__label` 节点存在但内容为空（文字被放在兄弟节点），
     * 此时 `querySelector(...) || el` 会因为节点存在而选中它 → 选项文本全变空字符串
     * → 再被文本去重合并成 1 个 → 选项数从 2 变 1、索引错位、无法作答。
     * 所以取到 `__label` 后要复查文本，为空就退回整个元素。
     */
    _textHost(el) {
      if (!el || !el.querySelector) return el;
      const label = el.querySelector('.el-radio__label, .el-checkbox__label');
      if (label && readText(label)) return label;
      return el;
    },

    /**
     * 只读暴露宽口径正则，供测试直接断言其边界（不经过 readOptions 的对称兜底通道）。
     * 为什么需要：32q 要锁死「\s 不能改回必需」这件事，若走 readOptions，
     * 「Apple」会被方案B 的结构对称通道捡回来，正则本身的误报/漏报就测不出来了。
     */
    _optionTextRe() {
      return new RegExp(OPTION_TEXT_RE.source, 'u');
    },

    /**
     * 只读暴露打分函数，供测试直接断言权重单调性（测 21）。
     * 为什么不通过 readOptions 间接测：打分是纯函数，直测才能锁死
     * 「前缀奖励永远压不过项数基数」这条约束本身，而不是靠某个 DOM 巧合。
     */
    _scoreOptionGroup(texts, depth) {
      return scoreOptionGroup(texts, depth);
    },

    /**
     * 找题干元素（方案 D 的锚点）。选择器与 `readCurrent` 保持一致，抽成独立方法避免两处漂移。
     * @returns {Element|null}
     */
    _findTitleEl(r) {
      if (!r || !r.querySelector) return null;
      try {
        return r.querySelector(
          '.el-dialog__body .question-topic, .el-dialog__body .topic-content,'
          + ' .topic-title, .topic-content, .topic-question'
        );
      } catch (e) { return null; }
    },

    /**
     * 【方案 D · 题干锚定】—— 用**位置先验**读选项，替代方案 C 的全树猜测。
     *
     * 为什么必须新增这条通道（round-22 收敛决策）：
     * 五轮下来（0.6.19→0.6.24）方案 C 每加一层判据就冒一个新洞，根因是它在做
     * **「全树无差别猜测」**——扫描整棵子树找「长得整齐的兄弟组」，没有任何位置先验。
     * 噪声和选项在全树范围内是**平权**的，只能靠越来越长的黑名单碰运气。
     * 但真实页面里**选项的位置是固定的**：题干（`titleEl`）读到了 → 选项就在
     * **同一题目容器内、题干之后**。
     *
     * 【round-23 修正 —— 主路径不得短路】
     * 旧实现「逐层向上，**第一圈命中就 return**」有个致命漏洞：`_siblingsAfter` 只在
     * 「同一父节点的直接兄弟」里选组，而题干与噪声常常同父（如
     * `<div class="wrap"><div class="q-title">…</div><div class="it">A. 上一节回顾</div><div class="it">B. 下一节预告</div></div>`
     * 外面才套真选项容器）。此时第一圈就命中噪声并 return → **离题干近的噪声永远赢**，
     * 哪怕它明显不像选项。方案 D 因此比方案 C 更危险（C 至少在全树里打分选优）。
     * **修法**：主路径**逐层收集**所有候选组（不 return），与退化路径的候选一起
     * **统一打分选优**；层级只作**极轻量 tie-break**（`- up * 0.1`，最大 0.5），
     * 永远不可能翻转 `scoreOptionGroup` 的项数差（2 项 1000 vs 3 项 300）。
     *
     * 算法：
     *   1. `titleEl` 为空 → 返回 `[]`（交给方案 A/B/C）。
     *   2. 主路径：从 `titleEl.parentElement` 起逐层向上最多 5 层，每层用
     *      `_siblingsAfter` 取该层「题干之后的对称组」→ **push 进候选池**（带层级 up）。
     *   3. 退化路径：`scope` 内「题干之后的子树」按「父+tag+class」分组 → 同样 push 进池。
     *   4. **独立容器优先（round-23 第二步）**：候选里「非题干行」（组父 ≠ 题干父）的若存在，
     *      整批优先于「题干行」候选 —— 真选项有专属容器，噪声只会与题干同处一行（详见函数内注释）。
     *   5. 统一打分：`score(total) = scoreOptionGroup(texts, 0) - up * 0.1`，取最高分。
     *
     * @param {Element} scope   弹窗容器
     * @param {Element} titleEl 题干元素（可为 null）
     * @returns {Element[]} 选项元素组；无则 []
     */
    _anchoredOptions(scope, titleEl) {
      if (!scope || !titleEl) return [];
      const MAX_UP = 5;
      // 候选池：{ els, up, ownRow }
      //   up     —— 离题干的层数（越小越近），仅作**极轻量** tie-break
      //   ownRow —— 该组与题干**同父**（即「题干所在那一行」的兄弟组）
      const cands = [];

      // ---- 主路径：逐层向上**收集**（不短路），每层取该层最优对称组 ----
      let node = titleEl.parentElement;
      let up = 0;
      while (node && node !== scope.parentElement && up <= MAX_UP) {
        const found = this._siblingsAfter(node, titleEl);   // 内部已对本层候选打分
        if (found.length >= 2) {
          // 主路径的每一组，父节点都是题干当前层的父 → 与题干同父（ownRow = true）
          cands.push({ els: found, up, ownRow: node === titleEl.parentElement });
        }
        node = node.parentElement;
        up++;
      }

      // ---- 退化路径：题干之后的子树里找对称组（同样进候选池）----
      // 为什么需要：真实布局里选项常被包在「题干之后的某个容器」（如 `.opt-list`）里，
      // 与题干并不同父，主路径在同层找不到（该容器本身只有 1 个，凑不成组）。
      if (scope.querySelectorAll) {
        const after = [];
        let seen = false;
        try {
          for (const el of scope.querySelectorAll('*')) {
            if (el === titleEl) { seen = true; continue; }
            if (seen && !titleEl.contains(el) && !el.contains(titleEl)) after.push(el);
          }
        } catch (e) { /* 选择器异常 → 放弃退化路径 */ }
        const byKey = new Map();
        for (const el of after) {
          const p = el.parentElement;
          if (!p) continue;
          const gk = parentIdOf(p) + '|' + el.tagName + '\u0001' + (el.className || '');
          if (!byKey.has(gk)) byKey.set(gk, []);
          byKey.get(gk).push(el);
        }
        for (const g of byKey.values()) {
          const cleaned = this._cleanGroup(g);
          // 退化路径：组父节点若恰是题干同父，也算「题干行」；否则是独立选项容器
          if (cleaned.length >= 2) {
            const gp = cleaned[0] && cleaned[0].parentElement;
            cands.push({ els: cleaned, up: MAX_UP + 1, ownRow: gp === titleEl.parentElement });
          }
        }
      }

      // ---- round-23 第二步：独立选项容器优先于「题干行」 ----
      // 「题干行」= 与题干同父的兄弟组。它既可能是真选项（`<div class="topic-title">…</div>
      // <div class="opt-item">甲</div><div class="opt-item">乙</div>` 直接并列），
      // 也可能是**混在题干行里的噪声**（题干 + `A. 上一节课程回顾` + `B. 下一节课程预告`）。
      // 二者的**内容分完全相同**（都 2 项），而噪声常带 A./B. 前缀+更长文本 → 内容分反而更高，
      // `up` 的 0.1 级 tie-break（≤0.5）根本压不住（实测差 20.14，见 ㉖）。
      // 关键结构先验：**真选项有自己专属的容器**（`.opt-list` / `.wrap2`…），噪声只会与题干同处一行。
      // 因此：只要存在「非题干行」的候选组（≥2 项），就**优先取它**，把题干行的候选整批排除。
      // 只在没有任何独立容器候选时才退回题干行 —— 这既修 ㉖（噪声被排除），
      // 又不影响「题干与选项直接并列」的合法布局（此时不存在独立容器候选，仍走题干行）。
      const offRow = cands.filter((c) => !c.ownRow);
      const pool = offRow.length ? offRow : cands;

      // ---- 统一打分选优：分数为主，层级为**极轻量** tie-break ----
      let best = [];
      let bestScore = -Infinity;
      for (const c of pool) {
        const texts = c.els.map((el) => readText(this._textHost(el)));
        // 层级奖励 ≤ 0.5（5 层 × 0.1），永远不可能翻转项数差（2项 1000 vs 3项 300）
        const score = scoreOptionGroup(texts, 0) - c.up * 0.1;
        if (score > bestScore) { best = c.els; bestScore = score; }
      }
      return best.length >= 2 ? best : [];
    },

    /**
     * 在 `parent.children` 中找「位于 `anchor` 之后、同 tag + 同 class」的一组兄弟（≥2）。
     * 多个候选组时用**打分制**取最优（避免文档序靠前的噪声组先把真选项挤掉）。
     *
     * 【round-23 位置约束】候选组必须**整体位于题干之后**（DOM 序）——
     * `kids.slice(ai + 1)` 已保证这一点（只取 anchor 之后的兄弟）；若某组跨越了 anchor
     * 之前的位置（题干在容器中间），它不会出现在 `rest` 里，天然被排除。
     *
     * @returns {Element[]} 清洗后的选项组；无则 []
     */
    _siblingsAfter(parent, anchor) {
      if (!parent || !parent.children) return [];
      const kids = Array.from(parent.children);
      const ai = kids.indexOf(anchor);
      if (ai < 0) return [];
      // 只看 anchor 之后的兄弟（从 anchor 的下一个开始）—— 保证「题干之后」的位置约束
      const rest = kids.slice(ai + 1);
      const groups = new Map();
      for (const el of rest) {
        const gk = el.tagName + '\u0001' + (el.className || '');
        if (!groups.has(gk)) groups.set(gk, []);
        groups.get(gk).push(el);
      }
      let best = [];
      let bestScore = -Infinity;
      for (const g of groups.values()) {
        if (g.length < 2) continue;
        const cleaned = this._cleanGroup(g);
        if (cleaned.length < 2) continue;
        const texts = cleaned.map((el) => readText(this._textHost(el)));
        const score = scoreOptionGroup(texts, 0);
        if (score > bestScore) { best = cleaned; bestScore = score; }
      }
      return best;
    },

    /**
     * 组清洗（方案 B/C/D 共用的统一过滤管线）—— 把一组候选元素过一遍所有否决规则，
     * 返回可用的选项元素；不合格返回 []。集中一处避免三条通道各写一份、判据漂移。
     *
     * 规则（按顺序）：
     *   1. 数量必须是 2~4；
     *   2. 噪声黑名单（元素**自身** class，见 `inNoiseContainer` 的 P1① 说明）；
     *   3. 成员文本非空、长度 ≤ 200、非单噪声 token；
     *   4. 逐个摘除 NAV_WORDS 成员；
     *   5. **摘完不足 2 → 回退为不摘**，但**页脚按钮组仍必须否决**（P1③：回退只针对
     *      「摘完不足 2」，不豁免「全是按钮 + 全是操作词」——否则页脚 [上一题][下一题]
     *      会被送去解题、真点「上一题」切页/交卷，比读空更糟）；
     *   6. 整组命中「题目元信息」（`META_RE`：题型/分值/难度）→ 否决（round-23，防「单选题/2分」顶掉选项）；
     *   7. 内容形状（全数字/全符号）否决；
     *   8. 文本集合 size ≥ 2（排斥布局重复）。
     *
     * @param {Element[]} g 同父同 tag 同 class 的候选组
     * @returns {Element[]} 去重后的可用选项；不合格 []
     */
    _cleanGroup(g) {
      if (!g || !g.length) return [];
      if (g.length < 2 || g.length > 4) return [];
      // 噪声黑名单（只查自身 class）
      for (const el of g) { if (inNoiseContainer(el)) return []; }
      // 成员文本校验
      for (const el of g) {
        const t = readText(this._textHost(el));
        if (!t || t.length > 200 || isSingleNoiseToken(t)) return [];
      }
      // 成员级摘除 NAV 词 + 回退
      let kept = g.filter((el) => NAV_WORDS.indexOf(readText(this._textHost(el))) < 0);
      let fellBack = false;
      if (kept.length < 2) {
        // 回退：不摘导航词（真题选项可能就叫「返回」）；但页脚按钮组仍必须否决（P1③）
        const allBtn = g.every((el) => el.tagName === 'BUTTON'
          || (el.getAttribute && el.getAttribute('role') === 'button'));
        const allAct = g.every((el) => ACTION_WORDS.indexOf(readText(this._textHost(el))) >= 0);
        if (allBtn && allAct) return [];
        kept = g.slice();
        fellBack = true;
      }
      const texts = kept.map((el) => readText(this._textHost(el)));
      // 「剩余全操作词」否决**只在未回退时**生效：回退场景本就是「摘完不足 2」，
      // 若再用这条否决，真题「返回/继续学习」（两词都 ∈ ACTION_WORDS）会被误杀
      // （测 ⑯ 回归）。回退场景的页脚按钮防护已由上面的 `allBtn && allAct` 单独承担。
      if (!fellBack && texts.every((t) => ACTION_WORDS.indexOf(t) >= 0)) return []; // 页脚按钮组
      if (texts.every((t) => META_RE.test(t))) return [];              // 题目元信息标签组（题型/分值/难度）
      if (looksLikeNoiseTexts(texts)) return [];                       // 全数字/全符号
      if (new Set(texts).size < 2) return [];                          // 布局重复
      return this._dedupeOptions(kept);
    },

    /**
     * 独立读选项：返回 { elements, texts }，**不依赖 readCurrent().options 是否为空**。
     *
     * 为什么必须单独暴露这一个入口（P1 修复的核心）：
     * 进入 `_tryNonStandardAB` 的条件是「readCurrent().options 为空」，而它内部第一段
     * 真作答要求「选项 >= 2」——两者互斥，导致真作答成了永不执行的死代码。
     * 根因在于把「标准选择器读不到选项」等同于「这题没有选项」。
     * 事实上「按钮式 A/B 弹窗」（选项是 button / div，没有 .el-radio）标准选择器读不到，
     * 但它**有选项**，完全应该能读题、能作答。
     * 所以这里提供一条更宽的独立读取通道：标准选择器读不到时，再用宽口径选择器兜一层。
     */
    readOptions(root) {
      const r = root || this.root();
      if (!r || !r.querySelectorAll) return { elements: [], texts: [] };

      // 第一优先：复用标准通道（含 .el-radio / .el-checkbox 的专属 + 兜底选择器）
      let els = this._readOptionEls(r);

      // ===== 方案优先级重排（round-22 收敛决策）=====
      //   标准读 → 方案 D（题干锚定，最高优先，有位置先验）
      //          → 方案 A（文本正则，有内容先验）
      //          → 方案 B（结构对称，限定在 A 的候选内）
      //          → 方案 C（全树猜测，最后兜底）
      // 核心变化：**D 有结果（≥2）就直接返回，不再跑 A/B/C** —— 位置先验一旦成立，
      // 它的结论比任何黑名单/打分都可靠，也让噪声只能靠位置被排除，不再靠碰运气。
      if (els.length < 2) {
        const scope = r.querySelector('div.el-dialog__body') || r;
        const titleEl = this._findTitleEl(r);
        const anchored = this._anchoredOptions(scope, titleEl);
        if (anchored.length >= 2) {
          return {
            elements: anchored,
            texts: anchored.map((o) => readText(this._textHost(o))),
          };
        }
      }

      // 第二优先：宽口径兜底 —— 覆盖「按钮式 / div 式」的 A/B 题。
      // 限定在 body 内，避免把页脚按钮也当成选项。
      if (els.length < 2) {
        const WIDE = 'button, .btn, [role="button"], .option, .option-item, .choice,'
          + ' .choice-item, .answer-option, .topic-item, .el-radio, .el-checkbox, label, li';
        const scope = r.querySelector('div.el-dialog__body') || r;
        const candidates = Array.from(scope.querySelectorAll(WIDE));

        // 通道 ①：文本前缀匹配（方案 A）。
        // 必须同时排掉操作词（关闭/提交/上一题/下一题…）：文本通道同样会捞到页脚按钮，
        // 若只按正则过滤，「下一题」这类不带 A/B 前缀的虽不中，但「关闭」等若变形也可能漏网。
        const byText = candidates.filter((el) => {
          const t = readText(this._textHost(el));
          return OPTION_TEXT_RE.test(t) && ACTION_WORDS.indexOf(t) < 0;
        });
        let picked = this._dedupeOptions(byText);

        // 通道 ②：结构对称白名单（方案 B）—— 兜「选项一/选项二」这类无 A/B 关键字、
        // 也无「对/错」关键字的长句选项。
        // 为什么这条判据可靠：A/B 二选一弹窗的选项天然同父、同标签、同 class，
        // 且数量恰好 2（或 2~4 个多选）；而弹窗里的页脚按钮/正文段落不具备这种对称性。
        // 只在文本通道颗粒无收时才启用，避免与通道 ① 打架。
        if (picked.length < 2) {
          const sym = this._symmetricOptions(candidates);
          if (sym.length >= 2) picked = sym;
        }

        // 通道 ③：结构对称**自动发现**（方案 C）—— 不依赖 class 白名单，最后兜底。
        // ①② 都建立在 `candidates`（WIDE 选择器产物）之上，而自定义 class 的
        // div/span/p 选项 WIDE 命中为 0 → ①② 同时空转。此通道直接从 scope 子树
        // 按「同父 + 同 tag + 数量 2~4」自动发现选项组，补上这块盲区。
        // 注意：方案 C 仅作**最后兜底**，单独存进 `auto`，不与 A/B 混为一谈。
        let auto = [];
        if (picked.length < 2) {
          auto = this._autoSiblings(scope);
        }

        // 合并规则：D 已在上面优先返回；这里再判 C（兜底）与 A/B（正向判据优先）。
        if (picked.length < 2 && auto.length >= 2) els = auto;
        else if (picked.length > els.length) els = picked;
      }

      return {
        elements: els,
        texts: els.map((o) => readText(this._textHost(o))),
      };
    },

    /**
     * 结构对称选项识别（方案 B）。
     *
     * 判据：同一父节点下、同 tagName、同 className 的一组元素，数量在 [2,4] 之间。
     * 这组元素在 A/B 弹窗里就是选项列表；在普通弹窗里（页脚按钮一两个、
     * 正文段落各不相同）很难同时满足「同父 + 同标签 + 同 class + 数量 2~4」。
     *
     * 额外收紧：候选文本必须非空，且不能是"关闭/确定/提交/取消"这类操作词
     * （页脚常见两个同款 button，正好也是同父同标签同 class——不排除会误当成选项）。
     */
    _symmetricOptions(candidates) {
      const groups = new Map();
      for (const el of candidates) {
        const p = el.parentElement;
        if (!p) continue;
        const t = readText(this._textHost(el));
        if (!t) continue;
        // 用父节点**身份**（WeakMap 全局唯一序号）分组，而不是 `indexOf(p)`：
        // 后者是「父在其父中的下标」，两个无关容器各为其父第 0 子时会串成一族（P1）。
        const gk = parentIdOf(p) + '|' + el.tagName + '\u0001' + (el.className || '');
        if (!groups.has(gk)) groups.set(gk, []);
        groups.get(gk).push(el);
      }
      let best = [];
      for (const g of groups.values()) {
        // 统一过滤管线（含噪声黑名单、NAV 摘除 + 回退、页脚按钮组否决、形状否决）
        const cleaned = this._cleanGroup(g);
        if (cleaned.length >= 2 && cleaned.length > best.length) best = cleaned;
      }
      return best;
    },

    /**
     * 结构对称**自动发现**（方案 C）—— 不依赖任何 class 白名单。
     *
     * 为什么必须再加这一条通道（round-20 真 P1）：
     * 方案 A（文本正则）与方案 B（`_symmetricOptions`）**共用同一个 `candidates`**，
     * 而 `candidates` 由 `WIDE` 选择器（`button/.btn/.option/.choice-item/label/li…`）产出。
     * 实测：只要选项是「纯 div / span / p + 自定义 class」（如 `.opt-item`、`.answer-item`、
     * `.xx-option`、裸 `<p>甲</p><p>乙</p>`），`WIDE` 命中 **0** → 两条通道同时空转 → 读不到选项
     * → `solve=0` → 又只乱猜。这正是用户报障「有的题目你没答」的真实成因。
     *
     * 判据：在 scope 子树内，找「同一父节点 + 同 tagName + 同 className + 子元素数量 2~4」的兄弟组；
     * 每组再过滤：父节点**不含直接文本节点**（排除题干/标题容器）、
     * 每个子元素文本非空、文本长度 ≤ 200（排除整段题干）、
     * **逐个摘除操作词成员**（关闭/提交/上一题/下一题…）后剩余 ≥2、
     * 剩余文本集合 size ≥ 2（排斥布局重复）、
     * 且子元素内**不含嵌套块级元素**（`div/section/article/ul/table/dl`，排斥题干容器）。
     *
     * **正向判据（round-21 新增，专治「分页器顶掉真选项」）**：
     *   ① 噪声容器黑名单 `inNoiseContainer`（分页器/步骤条/选项卡/面包屑/控制条…）→ 整组弃用；
     *   ② 内容形状 `looksLikeNoiseTexts`（全数字=分页器 / 全符号=图标组）→ 整组弃用；
     *   ③ **打分制** `scoreOptionGroup`：按「像不像答案」打分（2 项 >3 项 >4 项，A./B. 前缀加分，
     *      文本像人话加分，深度 tie-break），取代旧的「谁长谁赢」——后者等于「噪声必胜」。
     *
     * 性能：只对 `scope` 子树按 `children` 分组做**一趟**遍历（O(节点数)），不做全树两两比较；
     * 深度上限 `AUTO_MAX_DEPTH` 层，避免超深 DOM 拖慢主循环（触顶会打一条一次性告警）。
     *
     * @returns {Element[]} 综合评分最高的一组元素；无则 []
     */
    _autoSiblings(scope) {
      if (!scope || !scope.querySelectorAll) return [];
      const BLOCK = { DIV: 1, SECTION: 1, ARTICLE: 1, UL: 1, OL: 1, TABLE: 1, DL: 1, FORM: 1 };
      const nodes = [scope];
      let overDepth = 0; // 触顶被跳过的节点数（用于一次性告警）
      try {
        for (const el of scope.querySelectorAll('*')) {
          let d = 0;
          let p = el.parentElement;
          while (p && p !== scope) { d++; p = p.parentElement; if (d > AUTO_MAX_DEPTH) break; }
          if (d <= AUTO_MAX_DEPTH) nodes.push(el);
          else overDepth++;
        }
      } catch (e) { /* 某些环境选择器异常 → 退化为只用 scope */ }

      // 深度触顶告警（只打一次）：选项埋得比 AUTO_MAX_DEPTH 还深时方案 C 会静默失效，
      // 留一条日志便于线上排查「某些弹窗读不到选项」是否因深度不够。
      if (overDepth > 0 && !_depthWarned && ZHS.Log && ZHS.Log.warn) {
        _depthWarned = true;
        ZHS.Log.warn('方案C 遍历触顶：有 ' + overDepth + ' 个节点深度 > ' + AUTO_MAX_DEPTH
          + '，已跳过；若某些弹窗读不到选项，可上调 AUTO_MAX_DEPTH');
      }

      let best = [];
      let bestScore = -Infinity; // 打分制：分高者胜（取代旧「谁长谁赢」）
      for (const parent of nodes) {
        // 以 parent 为「同一父节点」，按其 children 的「tagName + className」分组。
        // 用 class 一起分组（而非只按 tag）是为了处理「选项与题干容器平级」的布局：
        // 如 `<div class="q-title">题干</div><div class="xx-option">甲</div><div class="xx-option">乙</div>`
        // —— 若只按 tag=DIV 分组，q-title 会混进来凑成 3 个不同 class 的元素组被整体否掉；
        // 按 tag+class 分组后，两个 .xx-option 自成一组（数量 2、class 一致）→ 正确识别。
        const byKey = new Map();
        for (const ch of parent.children) {
          const key = ch.tagName + '\u0001' + (ch.className || '');
          if (!byKey.has(key)) byKey.set(key, []);
          byKey.get(key).push(ch);
        }
        for (const [, group] of byKey) {
          if (group.length < 2 || group.length > 4) continue;
          // 父节点自身含「直接文本」（非空白文本节点）→ 是题干/标题容器，不是选项列表容器。
          // 为什么需要：负例④「以下哪项不是 <span>TCP</span> <span>UDP</span> <span>HTTP</span> 的特点？」
          // 里 `.kw` 三个 span 同父同标签数量 3，会盖过真正的 2 个选项；而它们的父节点
          // 夹着大段直接文本，正是题干特征。真正的选项列表容器只包着选项，几乎没有裸文本。
          let hasDirectText = false;
          for (const node of parent.childNodes) {
            if (node.nodeType === 3 && node.nodeValue && node.nodeValue.trim()) { hasDirectText = true; break; }
          }
          if (hasDirectText) continue;
          // 子元素不得内含嵌套块级元素（题干容器典型特征）
          let blocked = false;
          for (const el of group) {
            for (const cc of el.children) { if (BLOCK[cc.tagName]) { blocked = true; break; } }
            if (blocked) break;
          }
          if (blocked) continue;
          // 统一过滤管线（含噪声黑名单、NAV 摘除 + 回退、页脚按钮组否决、形状否决）
          const cleaned = this._cleanGroup(group);
          if (cleaned.length < 2) continue;
          const texts = cleaned.map((el) => readText(this._textHost(el)));
          // 计算该组深度（以 scope 为基准）—— 仅作入参保留，打分函数已不使用（见 scoreOptionGroup 说明）
          let depth = 0;
          let pp = parent;
          while (pp && pp !== scope) { depth++; pp = pp.parentElement; }
          // 打分制：取代旧的「谁长谁赢」——按「像不像答案」打分，分高者胜。
          const score = scoreOptionGroup(texts, depth);
          if (score > bestScore) { best = cleaned; bestScore = score; }
        }
      }
      return best;
    },

    /** 读取当前分页的完整题目（切页后调用） */
    readCurrent(root) {
      const r = root || this.root();
      if (!r) return null;
      // 题干：优先 Element UI 弹窗内的题面（.el-dialog__body 里），再退回标准弹题选择器。
      // 说明：不用 `.el-dialog__title`——那是「弹窗标题」（如"课中答题"），
      // 真正的题目文字在 body 里；标题只能作最后兜底线索，不能当题干送去求解。
      const titleEl = r.querySelector(
        '.el-dialog__body .question-topic, .el-dialog__body .topic-content,'
        + ' .topic-title, .topic-content, .topic-question'
      );
      let title = readText(titleEl);
      const { elements: optionEls, texts: options } = this.readOptions(r);

      if (!title) {
        const elTitle = r.querySelector && r.querySelector('.el-dialog__title');
        if (elTitle) {
          const t = readText(elTitle);
          // 过滤掉 Element UI 自带的「标题 + 关闭按钮」按钮文字（如 "课中答题" 本身是有用线索，保留）
          if (t) title = t;
        }
      }

      const typeText = readText(r.querySelector('.topic-type, .subject_type'));
      return {
        title,
        options,
        type: guessType(typeText + ' ' + title, options),
        elementList: optionEls,
        node: r,   // 供 Filler.fill 在弹题容器内定位输入框，避免填空题退化到整页 document
      };
    },

    /**
     * 按「Element UI 专属优先、标准结构兜底」的次序读选项元素。
     * 主选择器专属 .el-dialog__body 范围内，避免把弹窗页脚的空 div 之类当选项；
     * 一旦主选择器有结果就不再叠加兜底选择器（叠加会重新引入 [A,B,A,B] 重影）。
     */
    _readOptionEls(r) {
      // 用 `div.el-dialog__body` 而不是裸 `.el-dialog__body`：测试环境里
      // `#playTopic-dialog` 这类纯 div 容器也被 present()/祖先判定视为 Element UI 弹窗，
      // 需要排除，否则标准弹题的选项会被主选择器误命中。真实 Element UI 的 body 就是 div。
      const main = Array.from(
        r.querySelectorAll('div.el-dialog__body .el-radio, div.el-dialog__body .el-checkbox')
      );
      if (main.length) return this._dedupeOptions(main);
      const FALLBACK = 'ul .topic-item, .topic .radio ul > li, .answerOption label,'
        + ' .radio > label, .checkbox > label, .el-radio, .el-checkbox';
      return this._dedupeOptions(Array.from(r.querySelectorAll(FALLBACK)));
    },

    /** 关闭弹题 */
    close() {
      const r = this.root();
      if (!r) return false;

      // 按优先级找关闭按钮（智慧树弹题的关闭控件在多个位置出现过）
      const CANDIDATES = [
        '.close-btn',
        '.el-dialog__close',
        '.close',
        '.topic-close',
        '.popbtn_cancel',
        'button[class*="close"]',
        '.btn-cancel',
      ];

      for (const sel of CANDIDATES) {
        let btn = null;
        try { btn = r.querySelector ? r.querySelector(sel) : null; } catch (e) { /* 越界忽略 */ }
        // 【P2 修复 · round-19】去掉全局兜底 `document.querySelector(sel)`。
        //
        // 原意是应对「root 是 document（iframe 场景）」——但那种情况下 r 本身就是 document，
        // 上面的 `r.querySelector(sel)` 已经在 document 上查过了，根本不需要这一步。
        // 而在正常页面里这行会**越界**：弹窗内没有 `.el-dialog__close` 时，
        // 它会去全局找，点到**另一个弹窗/页面**上的同名关闭控件（实测被误点 1 次）。
        // 现在只在「root 是 document」时允许查 document（语义等价于原意，不再越界）；
        // 非 document 的 root 额外允许在它所属的 `.el-dialog__wrapper` 内查找——
        // 因为关闭按钮有时挂在 wrapper 上而非 .el-dialog 内部，但仍限定在同一弹窗范围内。
        if (!btn && r === document) {
          try { btn = document.querySelector(sel); } catch (e) { /* 忽略 */ }
        }
        if (!btn && r !== document && r.closest) {
          const wrapper = r.closest('.el-dialog__wrapper');
          if (wrapper && wrapper !== r) {
            try { btn = wrapper.querySelector(sel); } catch (e) { /* 忽略 */ }
          }
        }
        if (btn) {
          try {
            btn.click();
            ZHS.Log.info('已点击关闭按钮：' + sel);
            return true;
          } catch (e) {
            ZHS.Log.debug('关闭按钮点击异常：' + e.message);
          }
        }
      }

      // 兜底 1：从弹题容器往上找「关闭/确定/提交/我知道了」文本按钮
      //
      // 【2026-09-19 修正】两点：
      //  ① 文本读取改用 U.normText(el.innerText ?? el.textContent)：jsdom 里
      //     `innerText` 恒为 undefined，旧写法 `el.innerText || el.textContent || ''` 中的
      //     排序分支 `(a.innerText || '').length` 会把所有候选都算成长度 0 →
      //     排序随机化 → 可能点到「正文里的空 div」而不是真正的关闭按钮。
      //  ② 只接受**文本非空**的元素：空文本的 div 只是布局容器，点它没有任何意义。
      //  ③ 必须优先真正的可点控件（button/a），并把「包住该控件的容器」剔除。
      //     实测事故：`.el-dialog__footer`（DIV）与它内部的 `<button>关闭</button>` 文本都是"关闭"，
      //     旧代码按文本长度排序时两者并列（都是 2），DIV 排在前面被选中 →
      //     点击落在**容器**上（不冒泡到按钮的 click 处理器）→ 弹窗关不掉。
      const textOf = (el) => U.normText(
        el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent
      );
      const scope = (r.querySelectorAll ? r : document);
      const CLOSE_WORDS = ['关闭', '确定', '提交', '我知道了', '知道了', '继续学习'];
      let btns = Array.from(scope.querySelectorAll('button, a, span, div'))
        .filter((el) => CLOSE_WORDS.indexOf(textOf(el)) >= 0);

      // 优先取真控件（button/a）；没有时再退化到 span/div
      const interactive = btns.filter((el) => {
        const tag = el.tagName;
        return tag === 'BUTTON' || tag === 'A';
      });
      if (interactive.length) {
        // 候选中若某个元素「包含了另一个候选」，说明它是外层容器，剔除（避免点到容器）
        const innermost = interactive.filter(
          (el) => !interactive.some((o) => o !== el && el.contains(o))
        );
        btns = innermost.length ? innermost : interactive;
      } else {
        // 只有 span/div 时同样剔除「包住其他候选」的外层容器
        const innermost = btns.filter((el) => !btns.some((o) => o !== el && el.contains(o)));
        if (innermost.length) btns = innermost;
      }

      if (btns.length) {
        // 文本最短的优先（最贴近按钮本体，避免点到包住按钮的外层容器）
        btns.sort((a, b) => textOf(a).length - textOf(b).length);
        try {
          btns[0].click();
          ZHS.Log.info('已点击文本关闭按钮：' + textOf(btns[0])
            + '（' + btns[0].tagName + '）');
          return true;
        } catch (e) { /* 继续兜底 */ }
      }

      // 兜底 2：Esc
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      ZHS.Log.debug('未找到关闭按钮，已派发 Esc');
      return false;
    },

    /** 弹题是否仍存在 */
    stillPresent() {
      return this.present();
    },
  };

  /**
   * 场景 B：共享课作业页（.subject_node）
   */
  const HomeworkQuestions = {
    present() {
      return !!document.querySelector('.subject_node, .question-topic');
    },

    /** 采集所有题目 */
    collect() {
      const nodes = Array.from(document.querySelectorAll('.subject_node'));
      if (!nodes.length) {
        // 兜底：.question-topic 直接作为题目
        const topics = Array.from(document.querySelectorAll('.question-topic'));
        return topics.map((t, i) => this._fromTopic(t, i));
      }
      return nodes.map((n, i) => this._fromNode(n, i));
    },

    _fromNode(node, index) {
      hydrateImages(node);

      const titleEl = node.querySelector('.question-topic, .subject_title, .topic-title');
      let title = readText(titleEl);
      // 图片在题干里但无文字 → 标记需要 OCR
      const needOcr = !title && hasImage(node);

      const typeText = readText(node.querySelector('.subject_type, .question-type'));

      const optionEls = Array.from(node.querySelectorAll('.nodeLab, .label.clearfix, label'));
      const options = optionEls.map((o) => {
        const txt = readText(o);
        // 去掉开头的 "A. " 之类前缀（保留原始，回填需要）
        return txt;
      });

      return {
        title,
        options,
        type: guessType(typeText, options),
        index,
        needOcr,
        elementList: optionEls,
        node,
        raw: readText(node).slice(0, 500),
      };
    },

    _fromTopic(topicEl, index) {
      hydrateImages(topicEl);
      const node = topicEl.closest('.subject_node') || topicEl.parentElement;
      const title = readText(topicEl);
      const optionEls = node ? Array.from(node.querySelectorAll('label, .nodeLab')) : [];
      const options = optionEls.map((o) => readText(o));
      return {
        title,
        options,
        type: guessType(title, options),
        index,
        needOcr: false,
        elementList: optionEls,
        node,
        raw: title,
      };
    },

    /** 下一题按钮 */
    nextButton() {
      return document.querySelector('.next-topic.next-t, .next-topic');
    },
  };

  /**
   * 场景 C：hike 作业/考试（.q_main）
   */
  const HikeQuestions = {
    present() {
      return !!document.querySelector('.q_main, .question-topic');
    },

    collect() {
      const root = document.querySelector('.q_main') || document;
      const nodes = Array.from(root.querySelectorAll('.question-topic, .question-item'));
      return nodes.map((n, i) => {
        const container = n.closest('.question-item, .q_item, .question') || n.parentElement;
        hydrateImages(n);
        const title = readText(n);
        const typeText = container ? ((container.querySelector('.question_score, .question-type') || {}).textContent || '') : '';
        const optionEls = container ? Array.from(container.querySelectorAll('label')) : [];
        const options = optionEls.map((o) => readText(o));
        return {
          title,
          options,
          type: guessType(typeText + ' ' + title, options),
          index: i,
          needOcr: false,
          elementList: optionEls,
          node: container,
          raw: title,
        };
      });
    },
  };

  const Questions = {
    TYPE,
    BANK_TYPE,
    guessType,
    hydrateImages,
    hasImage,
    Dialog: DialogQuestions,
    Homework: HomeworkQuestions,
    Hike: HikeQuestions,

    /** 自动判断当前是什么场景 */
    scene() {
      if (DialogQuestions.present()) return 'dialog';
      if (/dohomework|doexamination/.test(location.href)) return 'homework';
      if (/answer-homework|answer-exam/.test(location.href)) return 'hike';
      if (HomeworkQuestions.present()) return 'homework';
      if (HikeQuestions.present()) return 'hike';
      return null;
    },

    /** 按场景采集 */
    collect() {
      const s = this.scene();
      if (s === 'dialog') return DialogQuestions.collect();
      if (s === 'homework') return HomeworkQuestions.collect();
      if (s === 'hike') return HikeQuestions.collect();
      return [];
    },
  };

  ZHS.Questions = Questions;
})();
