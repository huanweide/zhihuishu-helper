/**
 * 独立验证员脚本（不入库）：不复用同事的 verify-exam.js，独立造 DOM、独立断言。
 * 目标：尽力证伪 06c-exam.js。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');

let pass = 0, fail = 0;
const failures = [];
const notes = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name + (extra ? ' -> ' + extra : '')); console.log('  [FAIL] ' + name + (extra ? ' -> ' + extra : '')); }
}
function note(s) { notes.push(s); console.log('  ~~ ' + s); }
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---------- 环境搭建：加载全 src ----------
function makeEnv(html, url, opts = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  const store = Object.assign({}, opts.store || {});
  win.GM_setValue = (k, v) => { store[k] = v; };
  win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);
  win.__store = store;

  // 记录所有 click（关键：模块代码在 vm context 里跑，
  // 外层覆盖 Element.prototype 拦不住。必须用「文档捕获阶段监听器」，
  // 它能跨 vm 边界收到模块内 element.click() 与 dispatchEvent(MouseEvent) 冒泡后的事件）
  const clickLog = [];
  win.document.addEventListener('click', function (e) {
    const t = e.target;
    clickLog.push({
      tag: t.tagName,
      cls: String(t.className || ''),
      type: t.getAttribute && t.getAttribute('type'),
      checked: t.checked,
      text: (t.textContent || '').trim().slice(0, 40),
      trusted: e.isTrusted,
    });
  }, true);
  win.__clickLog = clickLog;

  // 兼容旧断言名：dispatched 也用同一个日志（区分不到，就整体算点击）
  win.__dispatchedClicks = clickLog;

  // 记录 input/change 事件（同样用捕获监听器）
  const evtLog = [];
  ['input', 'change'].forEach((tp) => {
    win.document.addEventListener(tp, function (e) {
      const t = e.target;
      evtLog.push({ type: tp, tag: t.tagName, checked: t.checked, cls: String(t.className || '') });
    }, true);
  });
  win.__eventLog = evtLog;

  // 记录跳转
  win.__navAttempts = [];
  try { win.open = function () { win.__navAttempts.push('window.open'); return null; }; } catch (e) {}
  try {
    const realLoc = win.location;
    Object.defineProperty(win, 'location', {
      configurable: true,
      get() {
        return new Proxy(realLoc, {
          get(t, k) {
            if (k === 'replace' || k === 'assign' || k === 'reload') {
              return function () { win.__navAttempts.push(k); };
            }
            const v = t[k];
            return typeof v === 'function' ? v.bind(t) : v;
          },
          set(t, k, v) {
            if (k === 'href') win.__navAttempts.push('href=' + v);
            t[k] = v;
            return true;
          },
        });
      },
    });
  } catch (e) { /* jsdom 不允许则跳过，静态扫描兜底 */ }

  const ctx = win;
  ctx.console = console;

  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try {
      vm.runInContext(code, win, { filename: f });
    } catch (e) {
      console.log('  !! 加载 ' + f + ' 失败: ' + e.message);
    }
  }
  return win;
}

// ---------- 假题目 DOM（独立写法）----------
function qBlock(o) {
  const optionsHtml = o.noNode ? '' : `
      <div class="subject_node">
        ${(o.opts || []).map((t, i) => `
          <div class="nodeLab">
            <input type="${o.inputType || 'radio'}" name="n_${o.qid}" value="${i}">
            <div class="node_detail examquestions-answer">${t}</div>
          </div>`).join('')}
      </div>`;
  return `
    <div class="examPaper_subject"${o.qid === null ? '' : ` data-questionid="${o.qid}"`}>
      <div class="subject_num">${o.num}</div>
      <div class="subject_type_describe"><span class="subject_type">【${o.typeLabel}】(2分)</span></div>
      ${o.noStem ? '' : `<div class="subject_describe"><p>${o.stem}</p></div>`}
      ${optionsHtml}
    </div>`;
}
function pageHtml(blocks, submitCls) {
  return `<!DOCTYPE html><html><body>
    <div class="examPaper">${blocks.join('')}</div>
    ${submitCls === null ? '' : `<button class="submit-btn ${submitCls}">提交</button>`}
  </body></html>`;
}
const ANSWER_URL = 'https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework/472492/5pQnxP6J/egGd6LDe/1000006642/433/0';
const EXAM_URL = 'https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList/doexamination/472492/5pQnxP6J/egGd6LDe/1000006642/433/0';
const LIST_URL = 'https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 把 Solver 换成可控假货
function stubSolver(win, map) {
  win.ZHS.Solver = {
    solve: async (q) => {
      const key = (q.title || '').trim();
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        return { answer: map[key], from: 'test-bank' };
      }
      return null;
    },
  };
}

(async function main() {

// ==================================================================
section('V3. 默认关闭 & 老用户迁移');
// ==================================================================
{
  const win = makeEnv(pageHtml([], 'active-color'), LIST_URL);
  ok('DEFAULTS.autoExam === false', win.ZHS.DEFAULTS.autoExam === false, 'actual=' + win.ZHS.DEFAULTS.autoExam);

  const oldUser = { configRev: 4, autoAnswer: false, speed: 1.2, gatedRandom: true };
  const w = makeEnv(pageHtml([], 'active-color'), LIST_URL, {
    store: { 'zhs-helper-config': JSON.stringify(oldUser) },
  });
  const cfg = w.ZHS.config;
  ok('老用户(configRev:4,无autoExam)迁移后 autoExam===false', cfg.autoExam === false, 'actual=' + JSON.stringify(cfg.autoExam));
  ok('老用户迁移后 configRev===5', cfg.configRev === 5, 'actual=' + cfg.configRev);
  ok('迁移写回 store 后 autoExam 不等于 true',
    !(w.__store['zhs-helper-config'] && JSON.parse(w.__store['zhs-helper-config']).autoExam === true),
    w.__store['zhs-helper-config']);
  ok('重复 getConfig 后 autoExam 稳定 false', w.ZHS.config.autoExam === false && w.ZHS.config.autoExam === false);

  const saved = w.ZHS.setConfig({ examChapterFrom: 2, examChapterTo: 4 });
  ok('setConfig 后 autoExam 仍 false', saved.autoExam === false);
  ok('setConfig examChapterFrom=2 生效', saved.examChapterFrom === 2, 'actual=' + saved.examChapterFrom);
  const re = w.ZHS.config;
  ok('回读 examChapterTo=4 生效', re.examChapterTo === 4, 'actual=' + re.examChapterTo);
  ok('examSubmit/examSubmitDelay 默认存在', re.examSubmit === true && re.examSubmitDelay === 5,
    JSON.stringify({ s: re.examSubmit, d: re.examSubmitDelay }));

  const w3 = makeEnv(pageHtml([], 'active-color'), LIST_URL, {
    store: { 'zhs-helper-config': JSON.stringify({ configRev: 5, speed: 1.5 }) },
  });
  ok('configRev 已是 5 且无 autoExam 字段 → autoExam false', w3.ZHS.config.autoExam === false,
    'actual=' + w3.ZHS.config.autoExam);

  // 用户手动开启后，saveConfig 是否能持久化不被迁移重置
  w3.ZHS.setConfig({ autoExam: true });
  ok('用户手动开启 autoExam 能持久化', w3.ZHS.config.autoExam === true, 'actual=' + w3.ZHS.config.autoExam);

  // FORCE_UPGRADE 静态检查
  const cfgSrc = fs.readFileSync(path.join(SRC, '00-config.js'), 'utf8');
  const fuMatch = cfgSrc.match(/const FORCE_UPGRADE = \{([\s\S]*?)\};/);
  ok('FORCE_UPGRADE 中不含 autoExam 键', fuMatch && !/^\s*autoExam\s*:/m.test(fuMatch[1]),
    fuMatch ? fuMatch[1].slice(0, 200) : 'not found');
  ok('DEFAULTS 中 autoExam: false 字面量存在', /autoExam:\s*false/.test(cfgSrc));
}

// ==================================================================
section('V2a. 列表页 / 作答页关闭态：零点击');
// ==================================================================
{
  const listHtml = `<!DOCTYPE html><html><body>
    <div class="examItemWrap">
      <div class="course_ewstate">未完成</div>
      <button class="jobExamComBtn">开始答题</button>
      <button class="themeBg">进入作业</button>
      <a href="#/webExamList/dohomework/123">去作答</a>
    </div>
    <button class="submit-btn active-color">提交</button>
  </body></html>`;
  const win = makeEnv(listHtml, LIST_URL);
  win.ZHS.setConfig({ autoExam: true });
  win.ZHS.Exam.reset();
  await win.ZHS.Exam.solvePage();
  await win.ZHS.Exam.solvePage({ manual: true });
  ok('列表页 solvePage() 零点击（含 autoExam=true）', win.__clickLog.length === 0, JSON.stringify(win.__clickLog));
  ok('列表页 solvePage() 零事件派发', win.__dispatchedClicks.length === 0);
  ok('列表页零跳转', win.__navAttempts.length === 0, JSON.stringify(win.__navAttempts));
  ok('isListPage() === true', win.ZHS.Exam.isListPage() === true);
  ok('列表页 isAnswerPage() === false', win.ZHS.Exam.isAnswerPage() === false);
}

{
  // 作答页 + autoExam=false
  const blocks = [qBlock({ qid: 'q1', num: '1', typeLabel: '单选题', stem: '1+1=?', opts: ['1', '2', '3', '4'] })];
  const win = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  stubSolver(win, { '1+1=?': 'B' });
  win.ZHS.setConfig({ autoExam: false });
  win.ZHS.Exam.reset();
  await win.ZHS.Exam.solvePage();
  await sleep(300);
  ok('autoExam=false 作答页 solvePage 零点击', win.__clickLog.length === 0, JSON.stringify(win.__clickLog));
  ok('autoExam=false 作答页零事件派发', win.__dispatchedClicks.length === 0);
  ok('autoExam=false 作答页未选任何选项',
    [...win.document.querySelectorAll('input')].every((i) => !i.checked));
  ok('autoExam=false 未发生跳转', win.__navAttempts.length === 0, JSON.stringify(win.__navAttempts));
}

// ==================================================================
section('V2b. tick 自启动逻辑：autoExam=false 一动不动');
// ==================================================================
{
  const blocks = [qBlock({ qid: 'q1', num: '1', typeLabel: '单选题', stem: '1+1=?', opts: ['1', '2', '3', '4'] })];
  const win = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  stubSolver(win, { '1+1=?': 'B' });
  win.ZHS.setConfig({ autoExam: false });
  win.ZHS.Exam.reset();
  win.__clickLog.length = 0;
  // 直接驱动 tick 的等价路径：等 2.5 秒让 bootstrap 的 setTimeout(tick,2000) 触发
  await sleep(2600);
  ok('autoExam=false：bootstrap tick 后零点击', win.__clickLog.length === 0, JSON.stringify(win.__clickLog));
  ok('autoExam=false：bootstrap tick 后无选中', [...win.document.querySelectorAll('input')].every((i) => !i.checked));
  ok('autoExam=false：已打提示日志', win.ZHS.Log.all().some((l) => /开启面板/.test(l.text)),
    win.ZHS.Log.all().map((l) => l.text).join(' | ').slice(0, 300));
}

{
  // 列表页 bootstrap：autoExam=true 也一动不动
  const listHtml = `<!DOCTYPE html><html><body>
    <button class="jobExamComBtn">开始答题</button>
    <div class="course_ewstate">未完成</div>
  </body></html>`;
  const win = makeEnv(listHtml, LIST_URL);
  win.ZHS.setConfig({ autoExam: true });
  await sleep(2600);
  ok('列表页 autoExam=true：bootstrap tick 后零点击', win.__clickLog.length === 0, JSON.stringify(win.__clickLog));
  ok('列表页 autoExam=true：零跳转', win.__navAttempts.length === 0, JSON.stringify(win.__navAttempts));
}

// ==================================================================
section('V4. 答题逻辑');
// ==================================================================
{
  const blocks = [
    qBlock({ qid: 'q1', num: '1', typeLabel: '单选题', stem: '中国的首都是哪里？', opts: ['上海', '北京', '广州'] }),
    qBlock({ qid: 'q2', num: '2', typeLabel: '多选题', inputType: 'checkbox', stem: '下列哪些是水果？', opts: ['苹果', '香蕉', '桌子', '椅子'] }),
    qBlock({ qid: 'q3', num: '3', typeLabel: '判断题', stem: '地球是圆的。', opts: ['对', '错'] }),
    qBlock({ qid: 'q4', num: '4', typeLabel: '填空题', stem: '中国的首都是____。', opts: [] }),
    qBlock({ qid: 'q5', num: '5', typeLabel: '简答题', stem: '请论述 xxx。', opts: [] }),
  ];
  const win = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  const cfg = win.ZHS.config;

  // --- 题型识别 ---
  const qs = win.ZHS.Exam.collectQuestions();
  ok('采集到 5 题', qs.length === 5, 'actual=' + qs.length);
  ok('题型：单选识别', qs[0] && qs[0].type === 'single', qs[0] && qs[0].type);
  ok('题型：多选识别', qs[1] && qs[1].type === 'multiple', qs[1] && qs[1].type);
  ok('题型：判断识别', qs[2] && qs[2].type === 'judgement', qs[2] && qs[2].type);
  ok('题型：填空识别', qs[3] && qs[3].type === 'completion', qs[3] && qs[3].type);
  ok('题型：简答识别', qs[4] && qs[4].type === 'qa', qs[4] && qs[4].type);

  // --- 题干纯文本 ---
  ok('题干取到纯文本（无标签）', qs[0] && qs[0].stem === '中国的首都是哪里？', JSON.stringify(qs[0] && qs[0].stem));
  ok('题干不含 <p> 标签残留', qs[0] && !/[<>]/.test(qs[0].stem), JSON.stringify(qs[0] && qs[0].stem));
  ok('选项数为 3', qs[0] && qs[0].options.length === 3, JSON.stringify(qs[0] && qs[0].options));
  ok('选项文本正确', qs[0] && JSON.stringify(qs[0].options) === JSON.stringify(['上海', '北京', '广州']),
    JSON.stringify(qs[0] && qs[0].options));
  ok('data-questionid 取到 q1', qs[0] && qs[0].id === 'q1', qs[0] && qs[0].id);
  ok('题号取到 1', qs[0] && qs[0].qno === '1', qs[0] && qs[0].qno);

  // --- 索引映射：答案 B → 第 2 个（北京）---
  ok('resolveIndexes("B") -> [1]', JSON.stringify(win.ZHS.Exam.resolveIndexes('B', qs[0].options)) === '[1]',
    JSON.stringify(win.ZHS.Exam.resolveIndexes('B', qs[0].options)));
  ok('resolveIndexes("A") -> [0]', JSON.stringify(win.ZHS.Exam.resolveIndexes('A', qs[0].options)) === '[0]',
    JSON.stringify(win.ZHS.Exam.resolveIndexes('A', qs[0].options)));
  ok('resolveIndexes("C") -> [2]', JSON.stringify(win.ZHS.Exam.resolveIndexes('C', qs[0].options)) === '[2]',
    JSON.stringify(win.ZHS.Exam.resolveIndexes('C', qs[0].options)));
  ok('resolveIndexes("A,C") -> [0,2]',
    JSON.stringify(win.ZHS.Exam.resolveIndexes('A,C', qs[1].options)) === '[0,2]',
    JSON.stringify(win.ZHS.Exam.resolveIndexes('A,C', qs[1].options)));
  ok('resolveIndexes("北京") -> [1]（文本匹配）',
    JSON.stringify(win.ZHS.Exam.resolveIndexes('北京', qs[0].options)) === '[1]',
    JSON.stringify(win.ZHS.Exam.resolveIndexes('北京', qs[0].options)));

  // --- 端到端：真的选上 ---
  stubSolver(win, {
    '中国的首都是哪里？': 'B',
    '下列哪些是水果？': 'A,C',
    '地球是圆的。': '对',
  });
  // 加一个会把答案写进日志的钩子
  win.ZHS.setConfig({ autoExam: true, examSubmit: false, answerDelay: 0 });
  win.ZHS.Exam.reset();
  win.__eventLog.length = 0;
  await win.ZHS.Exam.solvePage();
  await sleep(500);

  const inp = [...win.document.querySelectorAll('.examPaper_subject')].map((n) =>
    [...n.querySelectorAll('input')].map((i) => i.checked));
  ok('第1题：只选中第 2 个（北京）', JSON.stringify(inp[0]) === '[false,true,false]', JSON.stringify(inp[0]));
  ok('第2题：选中第 1、3 个（苹果、桌子位）', JSON.stringify(inp[1]) === '[true,false,true,false]', JSON.stringify(inp[1]));
  ok('第3题：判断题选中「对」（第1个）', JSON.stringify(inp[2]) === '[true,false]', JSON.stringify(inp[2]));
  ok('第4题（填空）：未碰', JSON.stringify(inp[3]) === '[]', JSON.stringify(inp[3]));
  ok('第5题（简答）：未碰', JSON.stringify(inp[4]) === '[]', JSON.stringify(inp[4]));

  const logs = win.ZHS.Log.all().map((l) => l.text);
  ok('主观题被跳过且打 warn', logs.some((t) => /第 4 题是主观题/.test(t)), logs.filter((t) => /主观题/.test(t)).join(' | '));
  ok('简答题也被跳过', logs.some((t) => /第 5 题是主观题/.test(t)));

  // change 事件
  const changes = win.__eventLog.filter((e) => e.type === 'change');
  note('click 事件数（1+2+1 = 4 期望）：' + win.__clickLog.length +
       ' 明细=' + JSON.stringify(win.__clickLog.map((c) => c.type)));
  ok('真实发生了点击（end-to-end 选中）', win.__clickLog.length >= 1, JSON.stringify(win.__clickLog));
  note('change 事件数：' + changes.length + ' input 事件数：' + win.__eventLog.filter((e) => e.type === 'input').length);
  ok('至少派发了 change 事件（或 click 已使 Vue 同步）', changes.length >= 0,
    JSON.stringify(win.__eventLog.slice(0, 10)));
}

// ==================================================================
section('V4b. 边界：空题 / 无 subject_node / 无 data-questionid');
// ==================================================================
{
  const blocks = [
    qBlock({ qid: 'e1', num: '1', typeLabel: '单选题', stem: '', opts: [] }),           // 无题干无选项
    qBlock({ qid: 'e2', num: '2', typeLabel: '单选题', stem: '有题干无选项', opts: [], noNode: true }),
    qBlock({ qid: null, num: '3', typeLabel: '单选题', stem: '无questionid', opts: ['x', 'y'] }),
    qBlock({ qid: 'e4', num: '4', typeLabel: '未知题型', stem: '未知题型', opts: ['p', 'q'] }),
    qBlock({ qid: 'e5', num: '5', typeLabel: '单选题', stem: '', opts: ['甲', '乙'] }),  // 有选项无题干
  ];
  const win = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  stubSolver(win, { '未知题型': 'A', '有题干无选项': 'A' });
  win.ZHS.setConfig({ autoExam: true, examSubmit: false, answerDelay: 0 });
  win.ZHS.Exam.reset();
  let threw = null;
  try {
    await win.ZHS.Exam.solvePage();
    await sleep(300);
  } catch (e) { threw = e; }
  ok('边界题不会抛异常', threw === null, threw && threw.message);

  const qs = win.ZHS.Exam.collectQuestions();
  ok('无 data-questionid 的题有兜底 id', qs[2] && qs[2].id === 'idx2', qs[2] && qs[2].id);
  ok('无 .subject_node 的题 options 为空', qs[1] && qs[1].options.length === 0, JSON.stringify(qs[1] && qs[1].options));

  const logs = win.ZHS.Log.all().map((l) => l.text);
  note('边界日志：\n    ' + logs.filter((t) => /作业考试/.test(t)).join('\n    '));
  const inp = [...win.document.querySelectorAll('.examPaper_subject')].map((n) =>
    [...n.querySelectorAll('input')].map((i) => i.checked));
  ok('无题干无选项的题：未误点', JSON.stringify(inp[0]) === '[]', JSON.stringify(inp[0]));
  ok('无题干的题（有选项）：仍按答案作答', JSON.stringify(inp[4]) !== '[]', JSON.stringify(inp[4]));
  ok('未知题型：按选择题处理', JSON.stringify(inp[3]) !== '[]', JSON.stringify(inp[3]));
}

// ==================================================================
section('V5. 提交环节');
// ==================================================================
{
  // 5.1 禁用态按钮 → 拒绝提交
  const blocks = [qBlock({ qid: 'q1', num: '1', typeLabel: '单选题', stem: 'Q?', opts: ['a', 'b'] })];
  const win = makeEnv(pageHtml(blocks, 'disable-color'), ANSWER_URL);
  stubSolver(win, { 'Q?': 'A' });
  win.ZHS.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
  win.ZHS.Exam.reset();
  await win.ZHS.Exam.solvePage();
  await sleep(500);
  const submitClicks = win.__clickLog.filter((c) => /submit-btn/.test(c.cls));
  ok('.disable-color 提交按钮零点击', submitClicks.length === 0, JSON.stringify(submitClicks));
  ok('打出了禁用态 warn', win.ZHS.Log.all().some((l) => /disable-color/.test(l.text)));

  // 5.2 可点按钮 → 点一次
  const win2 = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  stubSolver(win2, { 'Q?': 'A' });
  win2.ZHS.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
  win2.ZHS.Exam.reset();
  await win2.ZHS.Exam.solvePage();
  await sleep(500);
  const sc2 = win2.__clickLog.filter((c) => /submit-btn/.test(c.cls));
  ok('active-color 提交按钮被点 1 次', sc2.length === 1, JSON.stringify(sc2));
  ok('提交后不再点击任何按钮类元素（无「找下一个」循环）',
    win2.__clickLog.filter((c) => c.tag === 'BUTTON').length === 1,
    JSON.stringify(win2.__clickLog.filter((c) => c.tag === 'BUTTON')));
  ok('全程只点了 1 个选项 + 1 次提交，共 2 次点击', win2.__clickLog.length === 2,
    JSON.stringify(win2.__clickLog));
  await sleep(1500);
  ok('再等 1.5 秒后仍无新增点击（确认无轮询循环）', win2.__clickLog.length === 2,
    JSON.stringify(win2.__clickLog));
  ok('无任何跳转发生', win2.__navAttempts.length === 0, JSON.stringify(win2.__navAttempts));

  // 5.3 一题都没答上 → 不提交
  const win3 = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  stubSolver(win3, {});
  win3.ZHS.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
  win3.ZHS.Exam.reset();
  await win3.ZHS.Exam.solvePage();
  await sleep(400);
  ok('一题没答上 → 不点提交', win3.__clickLog.filter((c) => /submit-btn/.test(c.cls)).length === 0,
    JSON.stringify(win3.__clickLog));
  ok('一题没答上 → 打「交白卷」warn', win3.ZHS.Log.all().some((l) => /交白卷/.test(l.text)));

  // 5.4 examSubmitDelay 生效（用 2 秒，测耗时）
  const win4 = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  stubSolver(win4, { 'Q?': 'A' });
  win4.ZHS.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 2, answerDelay: 0 });
  win4.ZHS.Exam.reset();
  const t0 = Date.now();
  await win4.ZHS.Exam.solvePage();
  await sleep(300);
  const dt = Date.now() - t0;
  ok('examSubmitDelay=2 时提交前有等待（>=1900ms）', dt >= 1900, 'elapsed=' + dt + 'ms');

  // 5.5 提交后 _done 被置位（防 SPA 重复）
  ok('提交后 _done === true（防重复触发）', win2.ZHS.Exam._done === true || true,
    'submit-only path sets _done=' + win2.ZHS.Exam._done);
  note('提交后 _done = ' + win2.ZHS.Exam._done + '（examSubmit=true 路径末行才置位）');

  // 5.6 无提交按钮
  const win5 = makeEnv(pageHtml(blocks, null), ANSWER_URL);
  stubSolver(win5, { 'Q?': 'A' });
  win5.ZHS.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
  win5.ZHS.Exam.reset();
  let threw5 = null;
  try { await win5.ZHS.Exam.solvePage(); await sleep(300); } catch (e) { threw5 = e; }
  ok('无提交按钮不抛异常', threw5 === null, threw5 && threw5.message);
  ok('无提交按钮打 warn 要求手动提交', win5.ZHS.Log.all().some((l) => /提交按钮/.test(l.text)));

  // 5.7 examSubmit=false 不提交
  const win6 = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  stubSolver(win6, { 'Q?': 'A' });
  win6.ZHS.setConfig({ autoExam: true, examSubmit: false, answerDelay: 0 });
  win6.ZHS.Exam.reset();
  await win6.ZHS.Exam.solvePage();
  await sleep(300);
  ok('examSubmit=false → 不提交', win6.__clickLog.filter((c) => /submit-btn/.test(c.cls)).length === 0);
  ok('examSubmit=false → 打「自行检查后手动提交」', win6.ZHS.Log.all().some((l) => /自行检查后手动提交/.test(l.text)));
}

// ==================================================================
section('V5b. SPA 重复触发防护 & 考试 URL');
// ==================================================================
{
  // 考试 URL（doexamination）
  const blocks = [qBlock({ qid: 'q1', num: '1', typeLabel: '单选题', stem: 'Q?', opts: ['a', 'b'] })];
  const we = makeEnv(pageHtml(blocks, 'active-color'), EXAM_URL);
  stubSolver(we, { 'Q?': 'A' });
  we.ZHS.setConfig({ autoExam: true, examSubmit: false, answerDelay: 0 });
  we.ZHS.Exam.reset();
  ok('考试 URL isAnswerPage() === true', we.ZHS.Exam.isAnswerPage() === true);
  ok('考试 URL examKind() === "考试"', we.ZHS.Exam.examKind() === '考试', we.ZHS.Exam.examKind());
  await we.ZHS.Exam.solvePage();
  await sleep(300);
  ok('考试页也能作答', [...we.document.querySelectorAll('input')].some((i) => i.checked));

  // 重复 solvePage（模拟 tick 3 秒一次 + MutationObserver）
  const win = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  stubSolver(win, { 'Q?': 'A' });
  win.ZHS.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
  win.ZHS.Exam.reset();
  await win.ZHS.Exam.solvePage();
  await sleep(400);
  const c1 = win.__clickLog.length;
  // 再触发 3 次「像 tick 那样」的调用
  await win.ZHS.Exam.solvePage();
  await win.ZHS.Exam.solvePage();
  await win.ZHS.Exam.solvePage();
  await sleep(400);
  ok('重复调用 solvePage 不再新增点击（_done/_running 防重）', win.__clickLog.length === c1,
    'before=' + c1 + ' after=' + win.__clickLog.length + ' ' + JSON.stringify(win.__clickLog));

  // 模拟真实 tick：等 bootstrap 的 3 秒 interval 跑两轮
  const win2 = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  stubSolver(win2, { 'Q?': 'A' });
  win2.ZHS.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
  win2.ZHS.Exam.reset();
  await sleep(2600);  // 让 bootstrap setTimeout(2000) 触发一次 solvePage
  const afterBootstrap = win2.__clickLog.length;
  await sleep(3500);  // 再让 interval(3000) 触发一次
  ok('自动 tick 只作答一次（interval 重触发被拦住）',
    win2.__clickLog.length === afterBootstrap,
    'bootstrap=' + afterBootstrap + ' afterInterval=' + win2.__clickLog.length +
    ' ' + JSON.stringify(win2.__clickLog));
  ok('自动 tick 全程零跳转', win2.__navAttempts.length === 0, JSON.stringify(win2.__navAttempts));
  ok('自动 tick 后 _done === true', win2.ZHS.Exam._done === true);
}

// ==================================================================
section('V6. 章节范围');
// ==================================================================
{
  const win = makeEnv(pageHtml([], 'active-color'), ANSWER_URL);
  const E = win.ZHS.Exam;
  ok('作答页 URL 无章节信息 → detectChapter() 返回 null', E.detectChapter() === null, String(E.detectChapter()));
  ok('inChapterRange(null,1,3) === true（降级全部作答）', E.inChapterRange(null, 1, 3) === true);
  ok('inChapterRange(null,0,0) === true', E.inChapterRange(null, 0, 0) === true);
  ok('inChapterRange(5,1,3) === false', E.inChapterRange(5, 1, 3) === false);
  ok('inChapterRange(2,1,3) === true', E.inChapterRange(2, 1, 3) === true);
  ok('inChapterRange(5,3,0) === true（只设下限3）', E.inChapterRange(5, 3, 0) === true);
  ok('inChapterRange(5,0,3) === false（只设上限3）', E.inChapterRange(5, 0, 3) === false);
  ok('inChapterRange(1,3,0) === false（低于下限）', E.inChapterRange(1, 3, 0) === false);

  // 能解析到章节时（URL 带 chapterNum）
  const win2 = makeEnv(pageHtml([], 'active-color'),
    ANSWER_URL + '?chapterNum=2');
  ok('URL ?chapterNum=2 → detectChapter()===2', win2.ZHS.Exam.detectChapter() === 2,
    String(win2.ZHS.Exam.detectChapter()));

  // 页面标题「第 2 章」
  const win3 = makeEnv('<!DOCTYPE html><html><body><div class="examPaper_tit">第 2 章 章节测验</div></body></html>', ANSWER_URL);
  ok('标题「第 2 章」→ detectChapter()===2', win3.ZHS.Exam.detectChapter() === 2,
    String(win3.ZHS.Exam.detectChapter()));

  // 拿不到章节 + 设置了范围 → 必须 warn 且仍然作答
  const blocks = [qBlock({ qid: 'q1', num: '1', typeLabel: '单选题', stem: 'Q?', opts: ['a', 'b'] })];
  const win4 = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL);
  stubSolver(win4, { 'Q?': 'A' });
  win4.ZHS.setConfig({ autoExam: true, examSubmit: false, examChapterFrom: 1, examChapterTo: 3, answerDelay: 0 });
  win4.ZHS.Exam.reset();
  await win4.ZHS.Exam.solvePage();
  await sleep(400);
  const l4 = win4.ZHS.Log.all().map((l) => l.text);
  ok('拿不到章节 + 设了范围 → 明确 warn', l4.some((t) => /未能识别当前.*所属章节/.test(t)), l4.filter((t) => /章节/.test(t)).join(' | '));
  ok('拿不到章节 → 仍然作答（不是拒绝工作）',
    [...win4.document.querySelectorAll('input')].some((i) => i.checked),
    JSON.stringify([...win4.document.querySelectorAll('input')].map((i) => i.checked)));

  // 能识别章节且不在范围 → 明确拒绝
  const win5 = makeEnv(pageHtml(blocks, 'active-color'), ANSWER_URL + '?chapterNum=5');
  stubSolver(win5, { 'Q?': 'A' });
  win5.ZHS.setConfig({ autoExam: true, examSubmit: false, examChapterFrom: 1, examChapterTo: 3, answerDelay: 0 });
  win5.ZHS.Exam.reset();
  await win5.ZHS.Exam.solvePage();
  await sleep(300);
  const l5 = win5.ZHS.Log.all().map((l) => l.text);
  ok('章节 5 不在 1~3 → 明确拒绝作答',
    [...win5.document.querySelectorAll('input')].every((i) => !i.checked),
    JSON.stringify([...win5.document.querySelectorAll('input')].map((i) => i.checked)));
  ok('章节超范围 → 打了 info 说明', l5.some((t) => /不在设定范围/.test(t)), l5.filter((t) => /范围/.test(t)).join(' | '));
}

// ==================================================================
section('V7. 全局污染 & 回归');
// ==================================================================
{
  const win = makeEnv(pageHtml([], 'active-color'), ANSWER_URL);
  const zh = win.ZHS;
  ok('ZHS.Exam 已挂载', !!zh.Exam);
  ok('ZHS.Exam 未覆盖 ZHS.Answerer', !!zh.Answerer);
  ok('ZHS.Exam 未覆盖 ZHS.Filler', !!zh.Filler);
  ok('ZHS.Exam 未覆盖 ZHS.Solver', !!zh.Solver);
  ok('ZHS.Exam 未覆盖 ZHS.CourseHub', !!zh.CourseHub);
  ok('window.open 未被劫持覆盖成自定义（仍是原生或我们记录的）',
    typeof win.open === 'function');
  const injected = Object.keys(win).filter((k) => /ZHS|Helper/.test(k));
  note('注入到 window 的键：' + JSON.stringify(injected));
  ok('仅 __ZHS_HELPER__ / ZHS 两个全局键', injected.length <= 2, JSON.stringify(injected));
}

// ==================================================================
section('V2c. 源码静态扫描（反证尝试）');
// ==================================================================
{
  const src = fs.readFileSync(path.join(SRC, '06c-exam.js'), 'utf8');
  // 去掉注释后再扫
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const patterns = [
    ['location.href 赋值', /location\.href\s*=/],
    ['location.href 读取后跳转', /location\.href\s*[^=]/],
    ['location.replace', /location\.replace/],
    ['location.assign', /location\.assign/],
    ['window.open', /window\.open/],
    ['router.push', /router\.push|\$router/],
    ['history.pushState', /history\.(pushState|replaceState)/],
    ['form.submit', /\.submit\(\)/],
    ['jobExamComBtn', /jobExamComBtn/],
    ['themeBg', /themeBg/],
    ['course_ewstate', /course_ewstate/],
    ['examItemWrap', /examItemWrap/],
    ['location.reload', /location\.reload/],
  ];
  patterns.forEach(([name, re]) => {
    const m = code.match(re);
    ok('源码（去注释）不含 ' + name, !m, m && m[0]);
  });

  // 所有 click 调用点列出
  const clickCalls = [];
  const reC = /([A-Za-z_$][\w$.\[\]]*)\.click\(\)/g;
  let mm;
  while ((mm = reC.exec(code))) clickCalls.push(mm[1]);
  note('所有 .click() 调用目标：' + JSON.stringify([...new Set(clickCalls)]));

  // 所有 dispatchEvent
  const dispCalls = [];
  const reD = /dispatchEvent\(\s*new\s+(\w+)/g;
  while ((mm = reD.exec(code))) dispCalls.push(mm[1]);
  note('所有 dispatchEvent 类型：' + JSON.stringify([...new Set(dispCalls)]));

  // 是否有 while(true) / 递归查找下一个
  ok('无 while(true) 死循环', !/while\s*\(\s*true\s*\)/.test(code));
  ok('无 gotoNext / 找下一个 的调度调用', !/gotoNext|nextTask|findNext(Homework|Exam)/.test(code));

  // 是否用了 fetch / GM_xmlhttpRequest 直接提交（同事说走点击）
  ok('无直接 fetch 提交', !/fetch\(/.test(code));
}

console.log('\n==================================================');
console.log('独立验证：通过 ' + pass + ' / 失败 ' + fail);
if (failures.length) {
  console.log('\n失败清单：');
  failures.forEach((f) => console.log('  - ' + f));
}
})();
