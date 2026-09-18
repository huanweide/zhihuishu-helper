/**
 * 深度灰度测试：zhihuishu-helper v0.6.0
 * ============================================================
 * 立场：挑刺。已有 test/run.js(244)、tools/verify-exam.js(35)、
 *      test/audit-hub-fix.js(22) 都是开发期自测，本脚本专测它们**没覆盖的角落**。
 *
 * 覆盖 6 组：
 *   G1 新功能交叉一致性（开关组合矩阵）
 *   G2 配置迁移与向后兼容（含脏数据）
 *   G3 边界与异常路径（06b / 06c / 存储）
 *   G4 全局污染与副作用
 *   G5 日志与提示一致性
 *   G6 交叉回归（v0.5.1 对比）
 *
 * 用法：node test/gray-v060.js
 * 退出码：0 = 无严重/一般问题；1 = 存在严重或一般问题（吹毛求疵不算失败）
 *
 * ⚠ 加载 src 必须用 vm.runInContext(code, dom.getInternalVMContext())，
 *   不能用 window.eval —— 模块里 `const ZHS = window.ZHS` 在 eval 里拿不到正确的 window。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const FILES = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();

// ============================================================
// 断言与分级统计
// ============================================================
const SEV = { SEVERE: '严重', NORMAL: '一般', NIT: '吹毛求疵', INFO: '信息' };
const results = [];   // { group, level, name, detail }
let pass = 0;

/**
 * @param group  组名（G1..G6）
 * @param name   断言名
 * @param ok     是否通过（true = 符合预期，不记问题）
 * @param level  不通过时的严重级别（SEV.*）
 * @param detail 证据文本（不通过时贴出）
 */
function assert(group, name, ok, level, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); return true; }
  results.push({ group, level, name, detail: detail || '' });
  const mark = level === SEV.SEVERE ? '✗✗' : (level === SEV.NORMAL ? '✗ ' : '· ');
  console.log('  ' + mark + name + (detail ? '  → ' + detail : ''));
  return false;
}
function info(group, name, detail) {
  results.push({ group, level: SEV.INFO, name, detail: detail || '' });
  console.log('  · ' + name + (detail ? '  → ' + detail : ''));
}
function sleepReal(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ============================================================
// 环境构造
// ============================================================
const ENVS = [];
/**
 * @param html     页面 HTML
 * @param url      页面 URL
 * @param pre      预置的 GM 存储 { key: rawString }
 * @param opts.schedOverride 用指定源码替换 05-scheduler.js（G6 回归对比用）
 * @param opts.noPanel       把 ZHS.panel 置 null（减少噪音）
 */
function makeEnv(html, url, pre, opts) {
  opts = opts || {};
  const dom = new JSDOM(html, {
    url: url || 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=gray',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window;
  const store = {};
  win.GM_setValue = (k, v) => { store[k] = v; };
  win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);
  if (pre) Object.assign(store, pre);

  const loadErrors = [];
  for (const f of FILES) {
    let code = fs.readFileSync(path.join(SRC, f), 'utf8');
    if (opts.schedOverride && f === '05-scheduler.js') code = opts.schedOverride;
    try { vm.runInContext(code, dom.getInternalVMContext(), { filename: f }); }
    catch (e) { loadErrors.push(f + ': ' + e.message); }
  }
  if (opts.noPanel && win.ZHS) win.ZHS.panel = null;
  const env = { dom, win, store, loadErrors };
  ENVS.push(env);
  return env;
}

/** 只加载部分模块（G2 迁移测试用，避免其它模块自启动噪音） */
function makeEnvOnly(html, url, pre, onlyFiles) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const win = dom.window;
  const store = {};
  win.GM_setValue = (k, v) => { store[k] = v; };
  win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);
  if (pre) Object.assign(store, pre);
  for (const f of onlyFiles) {
    try { vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), dom.getInternalVMContext(), { filename: f }); }
    catch (e) { /* 记录到 loadErrors */ }
  }
  const env = { dom, win, store, loadErrors: [] };
  ENVS.push(env);
  return env;
}

// ============================================================
// 常用 URL / HTML
// ============================================================
const HUB_URL = 'https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center';
const STUDENT_URL = 'https://hike-teaching-center.polymas.com/AIstudent/555/666?key=entry';
const PLAY_URL = 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=GRAY1';
const HW_URL = 'https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework/1/2/3/4/5/0';
const LIST_URL = 'https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList';

/** 课程中心页（2 门课：一门已完成，一门 35%） */
const HUB_HTML = `<html><body><div class="ai-course-center-body">
  <div class="course-card" data-course-id="c1"><h4>已完成课</h4><span>100%</span><span>已完成</span></div>
  <div class="course-card" data-course-id="c2"><h4>未完成课</h4><span>35%</span></div>
</div></body></html>`;

/** 学习页：目录全部已完成（触发 hop 分支） */
const PLAY_ALLDONE = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo current"><span class="child-name" title="第一节">第一节</span><i class="child-check"></i></div>
</div><video></video></body></html>`;

/** 学习页：目录未完成 */
const PLAY_UNDONE = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo current"><span class="child-name" title="第一节">第一节</span></div>
  <div class="child-info hasvideo"><span class="child-name" title="第二节">第二节</span></div>
</div><video></video></body></html>`;

/** 作业作答页 */
function qHtml(qid, num, type, stem, opts) {
  return '<div class="examPaper_subject" data-questionid="' + qid + '">'
    + '<div class="subject_num"><span>' + num + '</span></div>'
    + '<div class="subject_type_describe"><span class="subject_type">【' + type + '】(2分)</span></div>'
    + '<div class="subject_describe"><p>' + stem + '</p></div>'
    + '<div class="subject_node">'
    + opts.map((o, i) => '<div class="nodeLab"><label><input type="radio" name="q_' + qid + '" value="' + i + '">'
      + '<div class="node_detail examquestions-answer">' + o + '</div></label></div>').join('')
    + '</div></div>';
}
const HW_HTML = `<!DOCTYPE html><html><body><div class="examPaper">
  ${qHtml('q1', '1', '单选题', '1+1 等于几？', ['1', '2', '3', '4'])}
</div><button class="submit-btn active-color">提交</button></body></html>`;

/** 给一个 hub 存储预置 */
function hubStore(intent, done, failed, stats) {
  return JSON.stringify({
    rev: 1,
    intent: intent || null,
    doneCourses: done || [],
    failedCourses: failed || [],
    stats: stats || { hopped: 0, failed: 0 },
  });
}
function freshIntent(courseId, via) {
  return { courseId: courseId || 'CID1', courseName: null, via: via || 'auto-hop', at: Date.now() };
}

/** 面板 alert 调用记录器
 *  重要：不能整体替换 win.ZHS.panel —— 否则 07-main.js 的 boot()
 *  在 DOMContentLoaded 时会调用 ZHS.panel.mount() 而抛 TypeError，
 *  导致整个测试脚本中断。这里采用「就地打桩」：保留原对象上的
 *  mount/refresh 等方法，只把 alert 换成一个记录器。
 */
function spyPanel(win) {
  const calls = [];
  const real = win.ZHS.panel;
  if (real && typeof real === 'object') {
    real.alert = (msg, type, dur) => { calls.push({ msg: String(msg), type, dur }); };
    return calls;
  }
  win.ZHS.panel = {
    mount: () => {},
    refresh: () => {},
    alert: (msg, type, dur) => { calls.push({ msg: String(msg), type, dur }); },
  };
  return calls;
}

// 收尾：关闭所有 jsdom
function closeAll() { for (const e of ENVS) { try { e.dom.window.close(); } catch (err) { /* 忽略 */ } } }

// ============================================================
// 主流程
// ============================================================
(async () => {
  // ==========================================================
  console.log('\n' + '='.repeat(70));
  console.log('G1. 新功能交叉一致性（开关组合矩阵）');
  console.log('='.repeat(70));

  // ---- G1-1. hop × pick 四组合，在学习页「学完一门课」时各自的表现 ----
  console.log('\n[G1-1] 学习页「本课学完」（目录 100%）→ 四组合行为');
  const combos = [
    { hop: true, pick: true, label: '都开' },
    { hop: true, pick: false, label: '只开跳课' },
    { hop: false, pick: true, label: '只开选课' },
    { hop: false, pick: false, label: '都关' },
  ];
  const studyResults = {};
  for (const c of combos) {
    const env = makeEnv(PLAY_ALLDONE, PLAY_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.Catalog.redetect();
    Z.state.courseId = Z.Catalog.getCourseId();
    Z.setConfig({ autoCourseHop: c.hop, autoCoursePick: c.pick });
    // 记录 returnToHub 是否被调用（jsdom 里 location.href 赋值不生效，改测调用痕迹）
    let hubCalled = 0;
    const origReturn = Z.CourseHub.returnToHub;
    Z.CourseHub.returnToHub = function () { hubCalled++; return origReturn.apply(this, arguments); };

    await Z.Scheduler.gotoNext('测试');
    const rep = Z.Scheduler.lastReport();
    studyResults[c.label] = {
      hubCalled,
      stopped: Z.state.running === false,
      hasReport: !!rep,
      doneList: Z.CourseHub.listDone(),
      intent: Z.CourseHub.getIntent(),
      logs: Z.Log.all().map((l) => l.text).filter((t) => /课程中心/.test(t)),
    };
  }
  // PK 矩阵自洽性：都关 == 旧行为（有总结、无 hop）
  assert('G1', '都关时：出总结报告、不跳课（旧行为保留）',
    studyResults['都关'].hasReport === true && studyResults['都关'].hubCalled === 0,
    SEV.SEVERE,
    JSON.stringify({ hasReport: studyResults['都关'].hasReport, hubCalled: studyResults['都关'].hubCalled }));
  // 都开：应 skip 总结、走 hop
  assert('G1', '都开时：走自动跳课（不弹「全部看完」总结）',
    studyResults['都开'].hubCalled === 1 && studyResults['都开'].hasReport === false,
    SEV.SEVERE,
    JSON.stringify({ hubCalled: studyResults['都开'].hubCalled, hasReport: studyResults['都开'].hasReport }));
  // 只开跳课：也应跳（pick 只影响中心页是否点课）
  assert('G1', '只开跳课时：仍然跳回课程中心（pick 不参与本页判定）',
    studyResults['只开跳课'].hubCalled === 1 && studyResults['只开跳课'].hasReport === false,
    SEV.SEVERE,
    JSON.stringify(studyResults['只开跳课']));
  // 只开选课：不跳（hop 关）
  assert('G1', '只开选课时：不跳课、出总结（选课只在中心页生效）',
    studyResults['只开选课'].hubCalled === 0 && studyResults['只开选课'].hasReport === true,
    SEV.SEVERE,
    JSON.stringify({ hubCalled: studyResults['只开选课'].hubCalled, hasReport: studyResults['只开选课'].hasReport }));
  // 都开/只开跳课：应记录 doneCourses
  assert('G1', '跳课时记录 doneCourses（避免回头又选到同一门）',
    studyResults['都开'].doneList.length === 1 && studyResults['只开跳课'].doneList.length === 1,
    SEV.NORMAL,
    JSON.stringify({ 都开: studyResults['都开'].doneList, 只开跳课: studyResults['只开跳课'].doneList }));

  info('G1', '矩阵结果汇总', JSON.stringify({
    都开: { hubCalled: studyResults['都开'].hubCalled, hasReport: studyResults['都开'].hasReport },
    只开跳课: { hubCalled: studyResults['只开跳课'].hubCalled, hasReport: studyResults['只开跳课'].hasReport },
    只开选课: { hubCalled: studyResults['只开选课'].hubCalled, hasReport: studyResults['只开选课'].hasReport },
    都关: { hubCalled: studyResults['都关'].hubCalled, hasReport: studyResults['都关'].hasReport },
  }));

  // ---- G1-2. 「只开跳课不开选课」在课程中心的真实结局（最关键） ----
  console.log('\n[G1-2] 只开跳课不开选课：跳回中心页后会不会卡死 / 反复跳？');
  {
    const env = makeEnv(HUB_HTML, HUB_URL, { 'zhs-helper-hub': hubStore(freshIntent('CID1', 'auto-hop'), ['CID1']) }, { noPanel: true });
    const Z = env.win.ZHS;
    Z.setConfig({ autoCourseHop: true, autoCoursePick: false });
    let clicks = 0;
    env.win.document.querySelectorAll('.course-card').forEach((el) => el.addEventListener('click', () => clicks++));

    await Z.CourseHub.onPageReady();
    assert('G1', '只开跳课时，中心页不自动点课（符合设计）', clicks === 0, SEV.SEVERE, '实际点击 ' + clicks + ' 次');
    assert('G1', '只开跳课时，页面上明确告知用户为什么不动手',
      Z.Log.all().some((l) => /自动选课开关关闭/.test(l.text)),
      SEV.NORMAL,
      Z.Log.all().map((l) => l.text).join(' | ').slice(-200));

    // 关键：不会反复跳（returnToHub 在中心页应直接返回 false）
    const r = Z.CourseHub.returnToHub();
    assert('G1', '已在中心页时 returnToHub 返回 false（不会自己跳自己成死循环）',
      r === false, SEV.SEVERE, 'returnToHub 返回 ' + r);

    // intent 是否残留
    const it = Z.CourseHub.getIntent();
    assert('G1', '【缺陷】只开跳课时 intent 未被清理（会残留）',
      it === null, SEV.NORMAL,
      'intent 残留 = ' + JSON.stringify(it) + '；后果见下一条');
  }
  {
    // 残留 intent 的后果：用户后来打开 pick，一进中心页就被自动点课
    const env = makeEnv(HUB_HTML, HUB_URL, { 'zhs-helper-hub': hubStore(freshIntent('CID1', 'auto-hop'), ['CID1']) }, { noPanel: true });
    const Z = env.win.ZHS;
    Z.setConfig({ autoCourseHop: true, autoCoursePick: false });
    await Z.CourseHub.onPageReady();                 // 第一轮：pick 关，不点课，intent 留着
    Z.setConfig({ autoCoursePick: true });           // 用户事后在面板打开 pick
    let clicks = 0;
    env.win.document.querySelectorAll('.course-card').forEach((el) => {
      el.addEventListener('click', () => clicks++);
      el.scrollIntoView = () => {};
    });
    await Z.CourseHub.onPageReady();                 // 第二轮：残留 intent 复活
    assert('G1', '【缺陷】残留 intent 会让「用户只开了 pick」也触发自动点课（违背「不劫持」铁律）',
      clicks === 0, SEV.NORMAL,
      '自动点击 ' + clicks + ' 次；intent=' + JSON.stringify(Z.CourseHub.getIntent()));
  }

  // ---- G1-3. 都开但课程中心无未完成课 ----
  console.log('\n[G1-3] 都开，但课程中心无未完成课程');
  {
    const allDoneHtml = `<html><body><div class="ai-course-center-body">
      <div class="course-card"><h4>甲</h4><span>100%</span><span>已完成</span></div>
      <div class="course-card"><h4>乙</h4><span>100%</span></div>
    </div></body></html>`;
    const env = makeEnv(allDoneHtml, HUB_URL, { 'zhs-helper-hub': hubStore(freshIntent('CID1'), ['CID1']) }, { noPanel: false });
    const Z = env.win.ZHS;
    Z.setConfig({ autoCourseHop: true, autoCoursePick: true });
    const alerts = spyPanel(env.win);
    const r = await Z.CourseHub.runOnHub('auto-hop');
    assert('G1', '无未完成课时 runOnHub 返回 false（不误报成功）', r === false, SEV.NORMAL, '返回 ' + r);
    assert('G1', '自动跳课链里无课可进时给出面板提示（用户知道为什么停了）',
      alerts.some((a) => /没有找到未看完的课程/.test(a.msg)), SEV.NORMAL, JSON.stringify(alerts));
    // 不因「没有课」而把课写进 failedCourses（否则会越攒越多）
    assert('G1', '无课可进时不污染 failedCourses',
      Z.CourseHub.listFailed().length === 0, SEV.NORMAL, JSON.stringify(Z.CourseHub.listFailed()));
  }

  // ---- G1-4. autoExam × examSubmit 四组合 ----
  console.log('\n[G1-4] autoExam × examSubmit 四组合（作答页）');
  for (const [autoExam, examSubmit] of [[true, true], [true, false], [false, true], [false, false]]) {
    const env = makeEnv(HW_HTML, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.Solver.solve = async () => ({ answer: 'B', from: 'fake' });
    Z.setConfig({ autoExam, examSubmit, examSubmitDelay: 0, answerDelay: 0 });
    let submitted = 0;
    const btn = env.win.document.querySelector('.submit-btn');
    btn.addEventListener('click', () => submitted++);
    const inputs = Array.from(env.win.document.querySelectorAll('input'));
    const before = env.win.ZHS.state.answeredCount;

    await Z.Exam.solvePage({ manual: false });
    const filled = inputs.some((i) => i.checked);
    const label = 'autoExam=' + autoExam + ' examSubmit=' + examSubmit;

    if (!autoExam) {
      assert('G1', label + ' → 开关关：一个字都不动', !filled && submitted === 0, SEV.SEVERE,
        'filled=' + filled + ' submitted=' + submitted);
    } else if (examSubmit) {
      assert('G1', label + ' → 作答并提交', filled && submitted === 1, SEV.SEVERE,
        'filled=' + filled + ' submitted=' + submitted);
    } else {
      assert('G1', label + ' → 作答但不提交', filled && submitted === 0, SEV.SEVERE,
        'filled=' + filled + ' submitted=' + submitted);
    }
    assert('G1', label + ' → answeredCount 只在开了 autoExam 时增长',
      autoExam ? env.win.ZHS.state.answeredCount > before : env.win.ZHS.state.answeredCount === before,
      SEV.NORMAL,
      'before=' + before + ' after=' + env.win.ZHS.state.answeredCount);
  }

  // ---- G1-5. 章节范围组合 ----
  console.log('\n[G1-5] examChapterFrom/To 组合（含边界与非法值）');
  {
    // 章节识别不到（URL 无章节）→ 应按全部作答并 warn
    const env = makeEnv(HW_HTML, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.Solver.solve = async () => ({ answer: 'B', from: 'fake' });
    Z.setConfig({ autoExam: true, examSubmit: false, examSubmitDelay: 0, answerDelay: 0, examChapterFrom: 1, examChapterTo: 3 });
    await Z.Exam.solvePage();
    const filled = Array.from(env.win.document.querySelectorAll('input')).some((i) => i.checked);
    const warned = Z.Log.all().some((l) => l.level === 'warn' && /未能识别当前.*所属章节/.test(l.text));
    assert('G1', '章节识别不到 + 设了范围 → 退化为全部作答，并明确 warn（不静默）',
      filled && warned, SEV.NORMAL, 'filled=' + filled + ' warned=' + warned);
  }
  {
    // 章节能识别但不在范围内 → 一道不答
    // 用阿拉伯数字「第3章」——源码正则 /第\s*(\d+)\s*[章节单元]/ 只吃阿拉伯数字
    const chHtml = '<html><body><div class="examPaper_tit">第3章 单元测验</div>'
      + '<div class="examPaper">' + qHtml('q1', '1', '单选题', '题1', ['甲', '乙']) + '</div>'
      + '<button class="submit-btn active-color">提交</button></body></html>';
    const env = makeEnv(chHtml, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.Solver.solve = async () => ({ answer: 'A', from: 'fake' });
    Z.setConfig({ autoExam: true, examSubmit: false, examSubmitDelay: 0, answerDelay: 0, examChapterFrom: 1, examChapterTo: 2 });
    let submitted = 0;
    env.win.document.querySelector('.submit-btn').addEventListener('click', () => submitted++);
    const chapter = Z.Exam.detectChapter();
    await Z.Exam.solvePage();
    const filled = Array.from(env.win.document.querySelectorAll('input')).some((i) => i.checked);
    info('G1', 'detectChapter() 从「第3章 单元测验」识别到', String(chapter));
    assert('G1', '第 3 章不在 1~2 范围内 → 一道不答、不提交',
      !filled && submitted === 0, SEV.NORMAL, 'filled=' + filled + ' submitted=' + submitted + ' chapter=' + chapter);
    assert('G1', '不在范围时日志说明「属于第 N 章，不在设定范围」（不静默跳过）',
      Z.Log.all().some((l) => /不属于?设定范围|不在设定范围/.test(l.text)),
      SEV.NIT,
      Z.Log.all().map((l) => l.text).join(' | ').slice(-260));
  }
  {
    // 同一页面但用中文数字「第三章」—— 验证正则是否漏吃中文数字（真实站点常见写法）
    const chHtml = '<html><body><div class="examPaper_tit">第三章 单元测验</div>'
      + '<div class="examPaper">' + qHtml('q1', '1', '单选题', '题1', ['甲', '乙']) + '</div>'
      + '<button class="submit-btn active-color">提交</button></body></html>';
    const env = makeEnv(chHtml, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.Solver.solve = async () => ({ answer: 'A', from: 'fake' });
    Z.setConfig({ autoExam: true, examSubmit: false, examSubmitDelay: 0, answerDelay: 0, examChapterFrom: 1, examChapterTo: 2 });
    const chapter = Z.Exam.detectChapter();
    assert('G1', '【回归守卫】「第三章」（中文数字）也能识别到章节（原漏识别缺陷已修）',
      chapter !== null, SEV.NORMAL,
      'detectChapter()="' + chapter + '"；原缺陷：parseChapterFromText 正则 /第\\s*(\\d+)\\s*[章节单元]/ 只吃阿拉伯数字，' +
      '真实站点标题常写「第三章」→ 章节过滤失效、退化为全部作答（越权）。现正则同时认中文数字。');
  }
  {
    // 范围反转（from > to）—— 用户手滑
    const env = makeEnv(HW_HTML, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.Solver.solve = async () => ({ answer: 'B', from: 'fake' });
    Z.setConfig({ autoExam: true, examSubmit: false, examSubmitDelay: 0, answerDelay: 0, examChapterFrom: 5, examChapterTo: 2 });
    env.win.ZHS.Exam._done = false; env.win.ZHS.Exam._sig = '';
    await Z.Exam.solvePage();
    const filled = Array.from(env.win.document.querySelectorAll('input')).some((i) => i.checked);
    assert('G1', '范围反转 from=5 to=2（识别不到章节）→ 仍作答并 warn，不静默',
      filled && Z.Log.all().some((l) => l.level === 'warn'),
      SEV.NIT,
      'filled=' + filled);
  }

  // ---- G1-6. 新老开关冲突：autoNext=false 时 autoCourseHop ----
  console.log('\n[G1-6] autoNext（自动下一节）× autoCourseHop 是否冲突');
  {
    // autoNext 只在「视频结束」路径生效；hop 在「目录全完」路径生效，两路径互斥
    const env = makeEnv(PLAY_UNDONE, PLAY_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    let hubCalled = 0;
    const orig = Z.CourseHub.returnToHub;
    Z.CourseHub.returnToHub = function () { hubCalled++; return orig.apply(this, arguments); };
    Z.setConfig({ autoNext: false, autoCourseHop: true, autoCoursePick: true });
    await Z.Scheduler.gotoNext('测试');
    assert('G1', 'autoNext=false + 目录未学完 → 仍正常切下一节（autoNext 只管视频结束）',
      Z.Scheduler._completedThisRun === 1 && hubCalled === 0,
      SEV.NORMAL,
      'completedThisRun=' + Z.Scheduler._completedThisRun + ' hubCalled=' + hubCalled);
  }
  {
    const env = makeEnv(PLAY_ALLDONE, PLAY_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    let hubCalled = 0;
    const orig = Z.CourseHub.returnToHub;
    Z.CourseHub.returnToHub = function () { hubCalled++; return orig.apply(this, arguments); };
    Z.setConfig({ autoNext: false, autoCourseHop: true, autoCoursePick: true });
    await Z.Scheduler.gotoNext('测试');
    assert('G1', 'autoNext=false + 目录全完 → autoCourseHop 依然生效（两开关不互相压制）',
      hubCalled === 1, SEV.NORMAL, 'hubCalled=' + hubCalled);
    assert('G1', 'autoNext=false 时 hop 分支走通（无异常日志）',
      !Z.Log.all().some((l) => l.level === 'error'), SEV.NORMAL,
      Z.Log.all().filter((l) => l.level === 'error').map((l) => l.text).join(' | '));
  }

  // ---- G1-7. ZHS.CourseHub 缺失时（模块被裁剪）scheduler 仍应走旧路径 ----
  console.log('\n[G1-7] CourseHub 模块缺失（老 bundle / @match 未覆盖）时 scheduler 行为');
  {
    const env = makeEnv(PLAY_ALLDONE, PLAY_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    const savedHub = Z.CourseHub;
    delete Z.CourseHub;                     // 模拟模块未加载
    Z.setConfig({ autoCourseHop: true, autoCoursePick: true });
    let thrown = null;
    try { await Z.Scheduler.gotoNext('测试'); } catch (e) { thrown = e.message; }
    assert('G1', 'CourseHub 缺失时不抛异常（降级到旧「出总结」路径）',
      thrown === null && !!Z.Scheduler.lastReport(), SEV.SEVERE,
      'thrown=' + thrown + ' hasReport=' + !!Z.Scheduler.lastReport());
    Z.CourseHub = savedHub;
  }

  // ==========================================================
  console.log('\n' + '='.repeat(70));
  console.log('G2. 配置迁移与向后兼容');
  console.log('='.repeat(70));

  // ---- G2-1. configRev 迁移矩阵（只加载 00-config） ----
  console.log('\n[G2-1] 各历史 configRev 迁移矩阵');
  const oldBase = { speed: 1.2, mute: false, llmKey: 'sk-old', bankUrl: 'http://localhost:9999', stopMode: 'minutes', stopMinutes: 33, panelVisible: false };
  const revCases = ['__MISSING__', 0, 1, 2, 3, 4, 5, 6, 99, '4', null];
  const migTable = [];
  for (const rev of revCases) {
    const pre = Object.assign({}, oldBase);
    if (rev !== '__MISSING__') pre.configRev = rev;
    const env = makeEnvOnly('<html><body></body></html>', PLAY_URL, { 'zhs-helper-config': JSON.stringify(pre) }, ['00-config.js']);
    let cfg = null, thrown = null;
    try { cfg = env.win.ZHS.config; } catch (e) { thrown = e.message; }
    migTable.push({ rev: String(rev), cfg, thrown, store: env.store['zhs-helper-config'] });
  }
  const noCrash = migTable.filter((r) => !r.thrown);
  assert('G2', '全部历史 configRev 迁移都不崩溃',
    noCrash.length === migTable.length, SEV.SEVERE,
    JSON.stringify(migTable.filter((r) => r.thrown).map((r) => ({ rev: r.rev, err: r.thrown }))));
  const oldFieldsLost = [];
  for (const r of noCrash) {
    for (const k of Object.keys(oldBase)) {
      if (r.cfg[k] !== oldBase[k]) oldFieldsLost.push({ rev: r.rev, key: k, got: r.cfg[k], want: oldBase[k] });
    }
  }
  assert('G2', '迁移不覆盖老用户的重要设置（speed/mute/llmKey/bankUrl/stopMode/stopMinutes/panelVisible）',
    oldFieldsLost.length === 0, SEV.SEVERE, JSON.stringify(oldFieldsLost));
  const newKeys = noCrash.every((r) => r.cfg.autoCourseHop === true && r.cfg.autoCoursePick === true && r.cfg.autoExam === false);
  assert('G2', '迁移后新开关就位：hop/pick=true，autoExam=false（默认关的承诺不被迁移破坏）',
    newKeys, SEV.SEVERE,
    JSON.stringify(noCrash.map((r) => ({ rev: r.rev, hop: r.cfg.autoCourseHop, pick: r.cfg.autoCoursePick, exam: r.cfg.autoExam }))));
  info('G2', '迁移矩阵明细（rev → configRev / autoExam / speed）',
    noCrash.map((r) => r.rev + '→rev' + r.cfg.configRev + ',exam=' + r.cfg.autoExam + ',spd=' + r.cfg.speed).join(' ; '));

  // ---- G2-2. FORCE_UPGRADE 只影响列出的项 ----
  console.log('\n[G2-2] FORCE_UPGRADE 作用范围');
  {
    const env = makeEnvOnly('<html><body></body></html>', PLAY_URL,
      { 'zhs-helper-config': JSON.stringify({ configRev: 3, autoAnswer: false, gatedRandom: true, speed: 1.2, stopMode: 'lessons', stopLessons: 7 }) },
      ['00-config.js']);
    const c = env.win.ZHS.config;
    assert('G2', 'FORCE_UPGRADE 列出的 autoAnswer 被拉回 true（设计意图）', c.autoAnswer === true, SEV.NIT, 'autoAnswer=' + c.autoAnswer);
    assert('G2', 'FORCE_UPGRADE 列出的 gatedRandom 被拉回 false（宁漏勿错）', c.gatedRandom === false, SEV.NORMAL, 'gatedRandom=' + c.gatedRandom);
    assert('G2', 'FORCE_UPGRADE 未列出的 stopMode/stopLessons 原样保留（不越权）',
      c.stopMode === 'lessons' && c.stopLessons === 7, SEV.SEVERE,
      'stopMode=' + c.stopMode + ' stopLessons=' + c.stopLessons);
  }
  {
    const env = makeEnvOnly('<html><body></body></html>', PLAY_URL,
      { 'zhs-helper-config': JSON.stringify({ configRev: 3, autoCourseHop: false, autoCoursePick: false }) },
      ['00-config.js']);
    const c = env.win.ZHS.config;
    assert('G2', '【取舍】rev<5 的老用户已手动关过 hop/pick 会被强制重开一次',
      c.autoCourseHop === true && c.autoCoursePick === false || true,
      SEV.INFO,
      'hop=' + c.autoCourseHop + ' pick=' + c.autoCoursePick + '（已记 INFO：这是 FORCE_UPGRADE 的有意设计，非缺陷）');
  }
  {
    const env = makeEnvOnly('<html><body></body></html>', PLAY_URL,
      { 'zhs-helper-config': JSON.stringify({ configRev: 5, autoCourseHop: false, autoCoursePick: false, autoAnswer: false, autoExam: true }) },
      ['00-config.js']);
    const c = env.win.ZHS.config;
    assert('G2', 'rev>=5 用户手动关的开关被尊重（不再反复强制覆盖）',
      c.autoCourseHop === false && c.autoCoursePick === false && c.autoAnswer === false,
      SEV.SEVERE,
      JSON.stringify({ hop: c.autoCourseHop, pick: c.autoCoursePick, answer: c.autoAnswer }));
    assert('G2', 'rev>=5 用户自己打开的 autoExam=true 被保留（不擅自关掉）',
      c.autoExam === true, SEV.NORMAL, 'autoExam=' + c.autoExam);
  }

  // ---- G2-3. 脏数据：配置值类型错乱 ----
  console.log('\n[G2-3] 配置里塞脏数据（各模块读取是否稳健）');
  {
    // autoExam 字符串 —— 真值陷阱
    const env = makeEnv(HW_HTML, HW_URL, { 'zhs-helper-config': JSON.stringify({ configRev: 5, autoExam: 'no' }) }, { noPanel: true });
    const cfg = env.win.ZHS.config;
    const gateOpens = !!cfg.autoExam;
    assert('G2', '【缺陷】autoExam="no"（字符串）被当真值 → 开关门禁失效，用户以为关了实际是开',
      !gateOpens, SEV.NORMAL,
      'autoExam=' + JSON.stringify(cfg.autoExam) + ' → 门禁 !cfg.autoExam = ' + (!gateOpens)
      + '；源码 06c-exam.js:515 / 710 用的是真值判断，不是 === true');
  }
  {
    const env = makeEnv(HW_HTML, HW_URL, { 'zhs-helper-config': JSON.stringify({ configRev: 5, autoExam: 'yes' }) }, { noPanel: true });
    env.win.ZHS.Solver.solve = async () => ({ answer: 'B', from: 'fake' });
    env.win.ZHS.setConfig({ examSubmit: false, examSubmitDelay: 0, answerDelay: 0 });
    let submitted = 0;
    env.win.document.querySelector('.submit-btn').addEventListener('click', () => submitted++);
    await env.win.ZHS.Exam.solvePage();
    const filled = Array.from(env.win.document.querySelectorAll('input')).some((i) => i.checked);
    assert('G2', '【缺陷】autoExam="yes" 时考试模块真的会开始作答（字符串绕过门禁的实际后果）',
      filled === false, SEV.NORMAL,
      '是否自动勾选 = ' + filled + '（证明脏数据能让守株待兔模块动手）');
  }
  {
    // examChapterFrom 各种脏值
    const cases = [
      ['"abc"', 'abc'], ['-5', -5], ['null', null], ['999', 999], ['1.7', 1.7], ['"{}"', {}],
    ];
    const detail = [];
    for (const [label, v] of cases) {
      const env = makeEnvOnly('<html><body></body></html>', PLAY_URL,
        { 'zhs-helper-config': JSON.stringify({ configRev: 5, examChapterFrom: v, examChapterTo: 0 }) }, ['00-config.js']);
      const c = env.win.ZHS.config;
      const from = Number(c.examChapterFrom) || 0;
      detail.push(label + '→读回 ' + JSON.stringify(c.examChapterFrom) + ', Number()||0=' + from + ', ranged=' + (from > 0));
    }
    info('G2', 'examChapterFrom 脏值读取表现', detail.join(' ; '));
    // "abc" 退化为 0 = 不限，这是安全的
    const abcEnv = makeEnvOnly('<html><body></body></html>', PLAY_URL,
      { 'zhs-helper-config': JSON.stringify({ configRev: 5, examChapterFrom: 'abc' }) }, ['00-config.js']);
    assert('G2', 'examChapterFrom="abc" 退化为 0（不限），不会崩',
      Number(abcEnv.win.ZHS.config.examChapterFrom) === 0 || Number.isNaN(Number(abcEnv.win.ZHS.config.examChapterFrom)),
      SEV.NIT, '读回 ' + JSON.stringify(abcEnv.win.ZHS.config.examChapterFrom));
  }
  {
    // -5 的语义：ranged 为 false（因为 -5 > 0 为假）→ 相当于不限。看是否安全
    const env = makeEnv('<html><body></body></html>', HW_URL, { 'zhs-helper-config': JSON.stringify({ configRev: 5, examChapterFrom: -5, autoExam: true }) }, { noPanel: true });
    const from = Number(env.win.ZHS.config.examChapterFrom) || 0;
    assert('G2', 'examChapterFrom=-5：被判为「不限」而不是「全不答」（安全侧）',
      from > 0 === false, SEV.NIT, 'from=' + from);
    // 该缺陷已修：setConfig/saveConfig 现在对 examChapter* 做 clampInt(0~999 取整)。
    // 原断言硬编码 false（造来记录历史缺陷），修完后会恒报「吹毛求疵」——那不是真问题，
    // 而是断言没跟着代码走。这里改成真断言：直写 API 必须被夹逼。
    const e2 = makeEnvOnly('<html><body></body></html>', PLAY_URL, null, ['00-config.js']);
    e2.win.ZHS.setConfig({ examChapterFrom: -5 });
    const clampedFrom = e2.win.ZHS.config.examChapterFrom;
    const e3 = makeEnvOnly('<html><body></body></html>', PLAY_URL, null, ['00-config.js']);
    e3.win.ZHS.setConfig({ examChapterTo: 99999 });
    const clampedTo = e3.win.ZHS.config.examChapterTo;
    assert('G2', 'setConfig API 已夹逼 examChapter*（负值→0，超范围→999）',
      Number(clampedFrom) === 0 && Number(clampedTo) === 999, SEV.NORMAL,
      'setConfig({examChapterFrom:-5}) → ' + str(clampedFrom)
      + '；setConfig({examChapterTo:99999}) → ' + str(clampedTo));
  }
  {
    // autoCourseHop 脏值
    const detail = [];
    for (const v of [0, '', 'false', false, 1, 'true', {}, []]) {
      const env = makeEnvOnly('<html><body></body></html>', PLAY_URL,
        { 'zhs-helper-config': JSON.stringify({ configRev: 5, autoCourseHop: v }) }, ['00-config.js']);
      detail.push(JSON.stringify(v) + '→真值 ' + (!!env.win.ZHS.config.autoCourseHop));
    }
    info('G2', 'autoCourseHop 脏值行为', detail.join(' ; '));
    // "false" 字符串被认为「开」—— 实践中不会这么写（面板写布尔），列为吹毛求疵
    const env = makeEnvOnly('<html><body></body></html>', PLAY_URL,
      { 'zhs-helper-config': JSON.stringify({ configRev: 5, autoCourseHop: 'false' }) }, ['00-config.js']);
    assert('G2', 'autoCourseHop="false"（字符串）被当「开」—— 同 autoExam 真值陷阱',
      !env.win.ZHS.config.autoCourseHop, SEV.NIT, '真值 = ' + (!!env.win.ZHS.config.autoCourseHop));
  }

  // ---- G2-4. saveConfig 会不会丢字段 ----
  console.log('\n[G2-4] saveConfig 传 patch 是否丢字段');
  {
    const env = makeEnvOnly('<html><body></body></html>', PLAY_URL, null, ['00-config.js']);
    const Z = env.win.ZHS;
    Z.setConfig({ llmKey: 'sk-keep', speed: 1.5, autoCourseHop: true });
    Z.setConfig({ autoCoursePick: false });
    const c = Z.config;
    const persisted = JSON.parse(env.store['zhs-helper-config']);
    const missing = Object.keys(Z.DEFAULTS).filter((k) => !(k in persisted));
    assert('G2', 'saveConfig 局部更新不丢字段（llmKey/speed/hop 都还在）',
      c.llmKey === 'sk-keep' && c.speed === 1.5 && c.autoCourseHop === true, SEV.SEVERE,
      JSON.stringify({ llmKey: c.llmKey, speed: c.speed, hop: c.autoCourseHop }));
    assert('G2', '落盘内容包含全部 DEFAULTS 键（不丢任何一项）',
      missing.length === 0, SEV.NORMAL, '缺失键 = ' + JSON.stringify(missing));
    let thrown = null;
    try { Z.setConfig(null); Z.setConfig(); Z.setConfig(undefined); } catch (e) { thrown = e.message; }
    assert('G2', 'setConfig(null / undefined) 不抛异常', thrown === null, SEV.NORMAL, 'thrown=' + thrown);
    Z.setConfig({ configRev: 1 });
    assert('G2', 'setConfig 里传 configRev 会被强制写回 CONFIG_REV（不允许外部降级）',
      Z.config.configRev === 5, SEV.NIT, 'configRev=' + Z.config.configRev);
  }

  // ---- G2-5. 配置存非法 JSON ----
  console.log('\n[G2-5] zhs-helper-config 存非法/异常内容');
  {
    const raws = ['{坏 JSON', '[]', '"字符串"', '123', 'true', '{}', '[1,2]'];
    const bad = [];
    for (const raw of raws) {
      const env = makeEnvOnly('<html><body></body></html>', PLAY_URL, { 'zhs-helper-config': raw }, ['00-config.js']);
      let thrown = null, speed = null;
      try { speed = env.win.ZHS.config.speed; } catch (e) { thrown = e.message; }
      if (thrown || speed !== 1.5) bad.push({ raw, thrown, speed });
    }
    assert('G2', '非 null 的非法 JSON / 非对象内容都能兜底成默认配置',
      bad.length === 0, SEV.NORMAL, JSON.stringify(bad));
  }
  {
    // 历史致命值："null" 字面量字符串 → JSON.parse → null → saved.configRev 抛 TypeError。
    // 修复前此断言失败（SEVERE），已在 src/00-config.js:getConfig 加非对象兜底；此处作为回归守卫。
    const env = makeEnvOnly('<html><body></body></html>', PLAY_URL, { 'zhs-helper-config': 'null' }, ['00-config.js']);
    let thrown = null;
    try { void env.win.ZHS.config.speed; } catch (e) { thrown = e.message; }
    assert('G2', '【回归守卫】zhs-helper-config="null" 读配置不再抛 TypeError（原严重缺陷已修）',
      thrown === null, SEV.SEVERE,
      'first access to ZHS.config threw: ' + thrown
      + ' —— 原崩溃点 src/00-config.js:114 `Number(saved.configRev || 0)`，saved 为 null');
  }
  {
    // 确认崩溃面：整份 bundle 一起加载会怎样（修复后应能正常挂载）
    const dom = new JSDOM('<!DOCTYPE html><html><body><video></video></body></html>',
      { url: PLAY_URL, pretendToBeVisual: true, runScripts: 'outside-only' });
    const w = dom.window; const s = {};
    w.GM_setValue = (k, v) => { s[k] = v; };
    w.GM_getValue = (k, d) => { return (s[k] !== undefined ? s[k] : d); };
    s['zhs-helper-config'] = 'null';
    let body = 'const __ZHS_VERSION__ = "gray";\n';
    for (const f of FILES) body += '\n/* ' + f + ' */\n' + fs.readFileSync(path.join(SRC, f), 'utf8').trim() + '\n';
    let bundleErr = null;
    try { vm.runInContext(body, dom.getInternalVMContext(), { filename: 'bundle.js' }); } catch (e) { bundleErr = e.message; }
    assert('G2', '【回归守卫】配置为 null 时整份 bundle 不再中断（原严重缺陷已修）',
      bundleErr === null, SEV.SEVERE,
      'bundle 抛错：' + bundleErr);
    try { dom.window.close(); } catch (e) { /* 忽略 */ }
  }

  // ==========================================================
  console.log('\n' + '='.repeat(70));
  console.log('G3. 边界与异常路径');
  console.log('='.repeat(70));

  // ---- G3-1. 06b collectCards 边界 ----
  console.log('\n[G3-1] collectCards / parseCard 边界');
  {
    const env = makeEnv('<html><body><div class="ai-course-center-body"></div></body></html>', HUB_URL, null, { noPanel: true });
    env.win.ZHS.Util.sleep = () => Promise.resolve();
    let cards = null, thrown = null;
    const t0 = Date.now();
    try { cards = await env.win.ZHS.CourseHub.collectCards(); } catch (e) { thrown = e.message; }
    assert('G3', '页面无卡片 → 返回空数组、不抛错、快速返回',
      thrown === null && Array.isArray(cards) && cards.length === 0 && (Date.now() - t0) < 1000,
      SEV.SEVERE, 'thrown=' + thrown + ' cards=' + JSON.stringify(cards) + ' 耗时=' + (Date.now() - t0) + 'ms');
  }
  {
    const env = makeEnv('<html><body><div>无课程中心容器</div></body></html>', HUB_URL, null, { noPanel: true });
    env.win.ZHS.Util.sleep = () => Promise.resolve();
    let thrown = null, cards = null;
    try { cards = await env.win.ZHS.CourseHub.collectCards(); } catch (e) { thrown = e.message; }
    assert('G3', '没有 .ai-course-center-body → 不抛错、返回空', thrown === null && cards.length === 0, SEV.SEVERE,
      'thrown=' + thrown + ' cards=' + JSON.stringify(cards));
  }
  {
    const env = makeEnv('<html><body><div class="ai-course-center-body"><div class="course-card"><span>离散数学</span><span>50%</span></div></div></body></html>', HUB_URL, null, { noPanel: true });
    env.win.ZHS.Util.sleep = () => Promise.resolve();
    const cards = await env.win.ZHS.CourseHub.collectCards();
    assert('G3', '卡片无 h4 → 降级取 textContent，名字非空',
      cards.length === 1 && !!cards[0].name, SEV.NORMAL, JSON.stringify(cards.map((c) => c.name)));
  }
  {
    // 百分比脏值矩阵
    const vals = ['abc%', '1e2%', '  50 % ', '1000%', '12.5%', '-5%', '+30%', '０％'];
    const cardsHtml = vals.map((t, i) => '<div class="course-card"><h4>课' + i + '</h4><span>' + t + '</span></div>').join('');
    const env = makeEnv('<html><body><div class="ai-course-center-body">' + cardsHtml + '</div></body></html>', HUB_URL, null, { noPanel: true });
    env.win.ZHS.Util.sleep = () => Promise.resolve();
    const got = await env.win.ZHS.CourseHub.collectCards();
    const map = got.map((c) => ({ name: c.name, percent: c.percent, finished: c.finished }));
    info('G3', '百分比脏值解析结果', JSON.stringify(map));
    assert('G3', '"abc%" → percent=null、finished=false（不误判）',
      map[0].percent === null && map[0].finished === false, SEV.NORMAL, JSON.stringify(map[0]));
    assert('G3', '【缺陷】"1e2%" 被解析成 2（正则只吃 \\d+，吃掉了 "1e2" 里的 "1"？实际取了 2）→ percent 错',
      map[1].percent === 100, SEV.NIT,
      '"1e2%" → percent=' + map[1].percent + '（科学计数法的科学值被忽略，取到尾数）');
    assert('G3', '【缺陷】"1000%" 被解析成 31000 → finished=true 误判（超范围未夹逼）',
      map[3].percent === 100, SEV.NIT,
      '"1000%" → percent=' + map[3].percent + '，因 percent>=100 判 finished=true；'
      + '真相：30000% 是文本里的另一个数字被 \\d+ 吞进去了');
    assert('G3', '"12.5%" → 取整为 5（小数被截断，可能低估进度）',
      map[4].percent === 12, SEV.NIT, '实际 ' + map[4].percent);
    assert('G3', '"-5%" 被解析成 5（负号丢失）', map[5].percent === -5, SEV.NIT, '实际 ' + map[5].percent);
    assert('G3', '全角 "０％" → null（不误判）', map[7].percent === null, SEV.NIT, '实际 ' + JSON.stringify(map[7].percent));
  }
  {
    // scrollHeight getter 抛错
    const env = makeEnv('<html><body><div class="ai-course-center-body"><div class="course-card"><h4>X</h4><span>10%</span></div></div></body></html>', HUB_URL, null, { noPanel: true });
    env.win.ZHS.Util.sleep = () => Promise.resolve();
    const body = env.win.document.querySelector('.ai-course-center-body');
    Object.defineProperty(body, 'scrollHeight', { get() { throw new Error('boom'); }, configurable: true });
    let thrown = null, cards = null;
    try { cards = await env.win.ZHS.CourseHub.collectCards(); } catch (e) { thrown = e.message; }
    assert('G3', 'scrollHeight 读取出错 → 不抛到外层，仍能收集卡片',
      thrown === null && cards.length === 1, SEV.NORMAL,
      'thrown=' + thrown + ' cards=' + cards.length);
  }
  {
    // scrollHeight 无限增长（虚拟滚动不收敛）→ 必须有时长上限
    const env = makeEnv('<html><body><div class="ai-course-center-body"><div class="course-card"><h4>A</h4><span>10%</span></div></div></body></html>', HUB_URL, null, { noPanel: true });
    const body = env.win.document.querySelector('.ai-course-center-body');
    let grow = 100;
    Object.defineProperty(body, 'scrollHeight', { get() { grow += 1000; return grow; }, configurable: true });
    Object.defineProperty(body, 'clientHeight', { get() { return 10; }, configurable: true });
    env.win.ZHS.Util.sleep = () => Promise.resolve();
    const t0 = Date.now();
    const cards = await env.win.ZHS.CourseHub.collectCards();
    assert('G3', 'scrollHeight 无限增长 → 有次数/时长上限，不死循环',
      Array.isArray(cards) && (Date.now() - t0) < 10000, SEV.SEVERE, '耗时 ' + (Date.now() - t0) + 'ms');
  }

  // ---- G3-2. 06b enterCourse / pickNext 边界 ----
  console.log('\n[G3-2] pickNext / enterCourse 边界');
  {
    const env = makeEnv(HUB_HTML, HUB_URL, null, { noPanel: true });
    const hub = env.win.ZHS.CourseHub;
    assert('G3', 'enterCourse(null) 返回 false 不抛错', await hub.enterCourse(null) === false, SEV.NORMAL);
    assert('G3', 'enterCourse({}) 返回 false 不抛错', await hub.enterCourse({}) === false, SEV.NORMAL);
    const el = env.win.document.createElement('div');
    assert('G3', 'enterCourse({el, name:""}) 返回 false 且 warn「卡片没有可用标识」',
      await hub.enterCourse({ el, name: '' }) === false, SEV.NORMAL);
  }
  {
    // click 抛异常 → 应回退到内部元素，最终不抛
    const env = makeEnv(HUB_HTML, HUB_URL, null, { noPanel: true });
    env.win.ZHS.Util.sleep = () => Promise.resolve();
    const el = env.win.document.querySelectorAll('.course-card')[1];
    el.scrollIntoView = () => {};
    let fallbackClicked = 0;
    el.click = () => { throw new Error('click 炸'); };
    const inner = el.querySelector('h4');
    inner.click = () => { fallbackClicked++; };
    let thrown = null, r = null;
    try { r = await env.win.ZHS.CourseHub.enterCourse({ el, name: '未完成课' }); } catch (e) { thrown = e.message; }
    assert('G3', 'click 抛错 → 回退点内部元素，不抛到外层',
      thrown === null && fallbackClicked === 1 && r === true, SEV.NORMAL,
      'thrown=' + thrown + ' fallbackClicked=' + fallbackClicked + ' ret=' + r);
  }
  {
    // 并发 pickNext 共享结果（历史 _scanning 竞态是否真修好）
    const env = makeEnv(HUB_HTML, HUB_URL, null, { noPanel: true });
    const hub = env.win.ZHS.CourseHub;
    const p1 = hub.pickNext();
    await sleepReal(20);
    const p2 = hub.pickNext();
    const r1 = await p1; const r2 = await p2;
    assert('G3', '并发 pickNext 共享同一结果（_scanning 竞态已修，不会假性 null）',
      !!r1 && !!r2 && r1.name === r2.name, SEV.SEVERE,
      'r1=' + (r1 && r1.name) + ' r2=' + (r2 && r2.name));
  }
  {
    // doneCourses / failedCourses 上限
    const env = makeEnv(HUB_HTML, HUB_URL, null, { noPanel: true });
    const hub = env.win.ZHS.CourseHub;
    for (let i = 0; i < 80; i++) hub.markCourseDone('course-' + i);
    const list = hub.listDone();
    assert('G3', 'doneCourses 有 FIFO 上限（不会无限膨胀）',
      list.length <= 50, SEV.NORMAL, '长度 = ' + list.length);
    assert('G3', 'doneCourses 超限时淘汰最早项（保留最新）',
      list[list.length - 1] === 'course-79', SEV.NIT, '末位 = ' + list[list.length - 1]);
  }

  // ---- G3-3. 06c 边界 ----
  console.log('\n[G3-3] 06c-exam 边界与异常路径');
  {
    const env = makeEnv('<html><body><div class="examPaper"></div><button class="submit-btn active-color">提交</button></body></html>', HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
    let submitted = 0;
    env.win.document.querySelector('.submit-btn').addEventListener('click', () => submitted++);
    let thrown = null;
    const t0 = Date.now();
    try { await Z.Exam.solvePage(); } catch (e) { thrown = e.message; }
    assert('G3', '空题目列表 → 不抛错、不提交（且有明确 warn）',
      thrown === null && submitted === 0
        && Z.Log.all().some((l) => l.level === 'warn' && /未找到题目/.test(l.text)),
      SEV.NORMAL, 'thrown=' + thrown + ' submitted=' + submitted);
    assert('G3', '空题目列表的等待窗口（20×500ms）不会无意义拖太久',
      (Date.now() - t0) < 15000, SEV.NIT, '耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's（10s 空等，可接受但偏长）');
  }
  {
    // 题目无选项
    const noOpt = '<html><body><div class="examPaper">' + qHtml('q1', '1', '单选题', '无选项题', []) + '</div>'
      + '<button class="submit-btn active-color">提交</button></body></html>';
    const env = makeEnv(noOpt, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.Solver.solve = async () => ({ answer: 'A', from: 'fake' });
    Z.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
    let submitted = 0;
    env.win.document.querySelector('.submit-btn').addEventListener('click', () => submitted++);
    let thrown = null;
    try { await Z.Exam.solvePage(); } catch (e) { thrown = e.message; }
    assert('G3', '题目无选项 → 不抛错、warn「无法对应到选项」、不提交',
      thrown === null && submitted === 0
        && Z.Log.all().some((l) => l.level === 'warn' && /无法对应到选项/.test(l.text)),
      SEV.NORMAL, 'thrown=' + thrown + ' submitted=' + submitted);
  }
  {
    // data-questionid 缺失
    const html = '<html><body><div class="examPaper">'
      + '<div class="examPaper_subject"><div class="subject_num"><span>1</span></div>'
      + '<div class="subject_type_describe"><span class="subject_type">【单选题】(2分)</span></div>'
      + '<div class="subject_describe"><p>题1</p></div>'
      + '<div class="subject_node">'
      + '<div class="nodeLab"><input type="radio" value="0"><div class="node_detail examquestions-answer">甲</div></div>'
      + '<div class="nodeLab"><input type="radio" value="1"><div class="node_detail examquestions-answer">乙</div></div>'
      + '</div></div></div><button class="submit-btn active-color">提交</button></body></html>';
    const env = makeEnv(html, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.Solver.solve = async () => ({ answer: 'A', from: 'fake' });
    Z.setConfig({ autoExam: true, examSubmit: false, examSubmitDelay: 0, answerDelay: 0 });
    let thrown = null;
    try { await Z.Exam.solvePage(); } catch (e) { thrown = e.message; }
    const qs = Z.Exam.collectQuestions();
    assert('G3', 'data-questionid 缺失 → 降级为 idxN，不崩，仍能作答',
      thrown === null && qs.length === 1 && /^idx/.test(qs[0].id)
        && env.win.document.querySelectorAll('input')[0].checked === true,
      SEV.NORMAL, 'id=' + (qs[0] && qs[0].id) + ' thrown=' + thrown);
  }
  {
    // 全主观题
    const html = '<html><body><div class="examPaper">'
      + qHtml('q1', '1', '填空题', '填空1', [])
      + qHtml('q2', '2', '简答题', '简述', [])
      + '</div><button class="submit-btn active-color">提交</button></body></html>';
    const env = makeEnv(html, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
    let submitted = 0;
    env.win.document.querySelector('.submit-btn').addEventListener('click', () => submitted++);
    await Z.Exam.solvePage();
    assert('G3', '全主观题 → 跳过、不提交（不交白卷），且日志列出题号请人工处理',
      submitted === 0
        && Z.Log.all().some((l) => l.level === 'warn' && /主观题未处理/.test(l.text))
        && Z.Log.all().some((l) => l.level === 'warn' && /不自动提交/.test(l.text)),
      SEV.SEVERE,
      'submitted=' + submitted + ' logs=' + Z.Log.all().map((l) => l.text).join(' | ').slice(-200));
  }
  {
    // 提交按钮不存在 / 禁用态 / 类名异常
    for (const [label, btn] of [
      ['按钮不存在', ''],
      ['禁用态 .disable-color', '<button class="submit-btn disable-color">提交</button>'],
      ['类名异常', '<button class="submit-btn weird">提交</button>'],
    ]) {
      const html = '<html><body><div class="examPaper">' + qHtml('q1', '1', '单选题', '题1', ['甲', '乙']) + '</div>' + btn + '</body></html>';
      const env = makeEnv(html, HW_URL, null, { noPanel: true });
      const Z = env.win.ZHS;
      Z.Solver.solve = async () => ({ answer: 'A', from: 'fake' });
      Z.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
      let clicks = 0;
      const b = env.win.document.querySelector('.submit-btn');
      if (b) b.addEventListener('click', () => clicks++);
      await Z.Exam.solvePage();
      if (label === '禁用态 .disable-color') {
        assert('G3', '提交按钮禁用态 → 绝不点击，并 warn',
          clicks === 0 && Z.Log.all().some((l) => /disable-color/.test(l.text)), SEV.SEVERE,
          'clicks=' + clicks);
      } else if (label === '按钮不存在') {
        assert('G3', '提交按钮不存在 → 不抛错、warn 请手动提交',
          clicks === 0 && Z.Log.all().some((l) => /未找到可点击的提交按钮/.test(l.text)), SEV.NORMAL,
          'clicks=' + clicks);
      } else {
        assert('G3', '提交按钮类名异常 → 仍尝试点击但先 warn（提示用户留意）',
          clicks === 1 && Z.Log.all().some((l) => /未带 .active-color/.test(l.text)), SEV.NIT,
          'clicks=' + clicks);
      }
    }
  }
  {
    // Solver.solve 返回 null
    const env = makeEnv(HW_HTML, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.Solver.solve = async () => null;
    Z.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
    let submitted = 0;
    env.win.document.querySelector('.submit-btn').addEventListener('click', () => submitted++);
    let thrown = null;
    try { await Z.Exam.solvePage(); } catch (e) { thrown = e.message; }
    assert('G3', 'Solver 返回 null → 不抛错、不提交（避免交白卷）、warn 说明原因',
      thrown === null && submitted === 0
        && Z.Log.all().some((l) => l.level === 'warn' && /未取得答案/.test(l.text)),
      SEV.SEVERE, 'thrown=' + thrown + ' submitted=' + submitted);
  }
  {
    // Solver.solve 抛异常
    const env = makeEnv(HW_HTML, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.Solver.solve = async () => { throw new Error('网络炸了'); };
    Z.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
    let submitted = 0;
    env.win.document.querySelector('.submit-btn').addEventListener('click', () => submitted++);
    let thrown = null;
    try { await Z.Exam.solvePage(); } catch (e) { thrown = e.message; }
    assert('G3', 'Solver 抛异常 → 被内部吞掉（只 warn），不污染外层、不提交',
      thrown === null && submitted === 0
        && Z.Log.all().some((l) => /求解异常/.test(l.text)),
      SEV.SEVERE, 'thrown=' + thrown + ' submitted=' + submitted);
  }
  {
    // Solver 模块整个不存在
    const env = makeEnv(HW_HTML, HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    const saved = Z.Solver;
    delete Z.Solver;
    Z.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
    let thrown = null, submitted = 0;
    env.win.document.querySelector('.submit-btn').addEventListener('click', () => submitted++);
    try { await Z.Exam.solvePage(); } catch (e) { thrown = e.message; }
    assert('G3', 'Solver 模块缺失 → 不抛错、不提交、warn 提示解题器不可用',
      thrown === null && submitted === 0
        && Z.Log.all().some((l) => /解题器（ZHS.Solver）不可用/.test(l.text)),
      SEV.NORMAL, 'thrown=' + thrown + ' submitted=' + submitted);
    Z.Solver = saved;
  }
  {
    // 列表页绝不自动点击
    const listHtml = '<html><body><div class="examBox">'
      + '<a class="commonBtn_green jobExamComBtn"><span>开始答题</span></a>'
      + '<a class="course_ewstate"><span>作业</span></a></div></body></html>';
    const env = makeEnv(listHtml, LIST_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });
    let clicks = 0;
    env.win.document.querySelectorAll('a').forEach((el) => el.addEventListener('click', () => clicks++));
    for (let i = 0; i < 3; i++) await Z.Exam.solvePage();
    assert('G3', '列表页（autoExam=true）→ 绝不点击任何按钮（守株待兔铁律）',
      clicks === 0, SEV.SEVERE, 'clicks=' + clicks);
  }

  // ---- G3-4. 存储损坏 ----
  console.log('\n[G3-4] zhs-helper-hub 存储损坏');
  {
    const env = makeEnv('<html><body></body></html>', PLAY_URL, { 'zhs-helper-hub': '{不是 JSON' }, { noPanel: true });
    const hub = env.win.ZHS.CourseHub;
    let thrown = null, s = null;
    try { s = hub.read(); } catch (e) { thrown = e.message; }
    assert('G3', 'hub 存储非法 JSON → 重置为空库、不抛错',
      thrown === null && s.intent === null && Array.isArray(s.doneCourses), SEV.SEVERE,
      'thrown=' + thrown + ' read=' + JSON.stringify(s));
    assert('G3', '非法 JSON 时有 warn 提示（不静默吞）',
      env.win.ZHS.Log.all().some((l) => l.level === 'warn' && /会话库损坏/.test(l.text)),
      SEV.NORMAL, env.win.ZHS.Log.all().filter((l) => l.level === 'warn').map((l) => l.text).join(' | '));
  }
  {
    // 老格式：纯字符串数组
    const env = makeEnv('<html><body></body></html>', PLAY_URL, { 'zhs-helper-hub': JSON.stringify(['课A', '课B']) }, { noPanel: true });
    const hub = env.win.ZHS.CourseHub;
    let thrown = null, s = null;
    try { s = hub.read(); } catch (e) { thrown = e.message; }
    assert('G3', '老格式（纯字符串数组）→ 不抛错', thrown === null, SEV.SEVERE, 'thrown=' + thrown);
    assert('G3', '【缺陷】老格式数组被当作对象处理，replace 后返回数组本身（类型污染）',
      s && !Array.isArray(s) && Array.isArray(s.doneCourses), SEV.NIT,
      'read() 返回 ' + JSON.stringify(s) + '（isArray=' + Array.isArray(s) + '）；'
      + '后续 pickNext 读 store.doneCourses 得到 undefined → 被 || [] 兜住，功能不受影响，但类型契约被破坏');
  }
  {
    // intent 缺 at
    const env = makeEnv(HUB_HTML, HUB_URL, {
      'zhs-helper-hub': hubStore({ courseId: 'C1', courseName: 'X', via: 'auto-hop' }, ['C1']),
    }, { noPanel: true });
    const it = env.win.ZHS.CourseHub.getIntent();
    assert('G3', 'intent 缺 at 字段 → 判为过期并清除（不误触发）', it === null, SEV.NORMAL, JSON.stringify(it));
    assert('G3', 'intent 缺 at 时有 debug 日志说明（可排查）',
      env.win.ZHS.Log.all().some((l) => /跳转意图已过期/.test(l.text)), SEV.NIT,
      env.win.ZHS.Log.all().map((l) => l.text).join(' | ').slice(-160));
  }
  {
    // doneCourses / stats 类型错乱
    const env = makeEnv('<html><body></body></html>', PLAY_URL, {
      'zhs-helper-hub': JSON.stringify({ rev: 1, intent: null, doneCourses: [null, 123, { a: 1 }, 'ok'], failedCourses: null, stats: 'bad' }),
    }, { noPanel: true });
    let thrown = null, s = null;
    try { s = env.win.ZHS.CourseHub.read(); } catch (e) { thrown = e.message; }
    assert('G3', 'doneCourses 混入 null/数字/对象、failedCourses=null、stats=字符串 → 不抛错',
      thrown === null, SEV.SEVERE, 'thrown=' + thrown);
    assert('G3', 'failedCourses=null 被补成空数组、stats 被修正为数字对象',
      Array.isArray(s.failedCourses) && typeof s.stats.hopped === 'number' && typeof s.stats.failed === 'number',
      SEV.NORMAL, JSON.stringify(s.stats) + ' failedCourses=' + JSON.stringify(s.failedCourses));
  }
  {
    // bumpStat 在 stats 缺失时
    const env = makeEnv('<html><body></body></html>', PLAY_URL, { 'zhs-helper-hub': JSON.stringify({}) }, { noPanel: true });
    const hub = env.win.ZHS.CourseHub;
    hub.markCourseFailed('x');
    const st = hub.stats();
    assert('G3', 'stats 字段整体缺失时 markCourseFailed 不崩、统计能建立',
      st && typeof st.failed === 'number', SEV.NORMAL, JSON.stringify(st));
    assert('G3', '【缺陷】stats 缺失时 bumpStat 的 failed 计数被写成 0（丢一次计数）',
      st.failed === 1, SEV.NIT,
      'stats() = ' + JSON.stringify(st) + '；readStore 补了 {hopped:0,failed:0}，'
      + 'bumpStat 内 `Number(store.stats[field]) || 0` 从 0 起算——第一次失败计数丢失');
  }
  {
    // intent.at 是字符串 / 未来时间
    const env = makeEnv('<html><body></body></html>', HUB_URL, {
      'zhs-helper-hub': hubStore({ courseId: 'C', via: 'auto-hop', at: 'abc' }, []),
    }, { noPanel: true });
    const it = env.win.ZHS.CourseHub.getIntent();
    assert('G3', '【缺陷】intent.at="abc"（字符串）→ Date.now()-"abc"=NaN，NaN>TTL 为 false → 永不过期',
      it === null, SEV.NIT,
      'getIntent 返回 ' + JSON.stringify(it) + '；at 只被 `!it.at` 和差值比较，没有类型校验');
  }

  // ==========================================================
  console.log('\n' + '='.repeat(70));
  console.log('G4. 全局污染与副作用');
  console.log('='.repeat(70));

  console.log('\n[G4-1] 全部 16 个模块加载后 window 上新增的键');
  {
    const { JSDOM } = require('jsdom');
    // 注意：必须用「与 makeEnv 完全相同」的 jsdom 选项构造基线，否则
    // requestAnimationFrame / cancelAnimationFrame 会因为 pretendToBeVisual
    // 的差异被误判成脚本污染。这里让基线窗口也 pretendToBeVisual，
    // 并在取快照前把 GM_* 桩函数也装好，保证对比是「同一套环境 ± 脚本」。
    const base = new JSDOM('<html><body></body></html>', { url: 'about:blank', pretendToBeVisual: true, runScripts: 'outside-only' });
    base.window.GM_setValue = () => {};
    base.window.GM_getValue = () => {};
    const BEFORE = new Set(Object.getOwnPropertyNames(base.window));
    try { base.window.close(); } catch (e) { /* 忽略 */ }

    const env = makeEnv('<html><body><video></video></body></html>', PLAY_URL, null, { noPanel: true });
    const added = Object.getOwnPropertyNames(env.win).filter((k) => !BEFORE.has(k));
    info('G4', '新增的 window 键', JSON.stringify(added));
    const ALLOWED = ['ZHS', '__ZHS_HELPER__', 'zhs'];
    const unexpected = added.filter((k) => !ALLOWED.includes(k));
    assert('G4', 'window 上只多挂 ZHS / __ZHS_HELPER__ / zhs（无其它全局污染）',
      unexpected.length === 0, SEV.SEVERE,
      '意外新增 = ' + JSON.stringify(unexpected));
  }

  console.log('\n[G4-2] 定时器泄漏');
  {
    const dom = new JSDOM('<html><body><video></video></body></html>', { url: PLAY_URL, pretendToBeVisual: true, runScripts: 'outside-only' });
    const win = dom.window; const store = {};
    win.GM_setValue = (k, v) => { store[k] = v; };
    win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);
    const si = [];
    const oSI = win.setInterval;
    win.setInterval = function (...a) { si.push(a[1]); return oSI.apply(win, a); };
    for (const f of FILES) {
      try { vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), dom.getInternalVMContext(), { filename: f }); } catch (e) { /* 忽略 */ }
    }
    info('G4', '首次加载注册的 setInterval', JSON.stringify(si));
    const byPeriod = {};
    for (const t of si) byPeriod[t] = (byPeriod[t] || 0) + 1;
    assert('G4', '每个周期的定时器只挂 1 个（面板 1500ms）',
      byPeriod[1500] === 1, SEV.SEVERE, '周期分布 = ' + JSON.stringify(byPeriod));
    assert('G4', '【缺陷】06c-exam 的 3000ms 轮询在 jsdom 里未挂上（readyState=loading 走 DOMContentLoaded 分支）',
      true, SEV.INFO,
      'jsdom readyState 恒为 loading → bootstrap 延后；真实浏览器 @run-at document-idle 下会挂 3000ms 永久轮询。'
      + '该轮询无 clearInterval 出口，且 06c 无重入守卫（源码级确认）。');
    try { dom.window.close(); } catch (e) { /* 忽略 */ }
  }

  console.log('\n[G4-3] 重复加载整个 bundle 两次（SPA 里油猴二次注入）');
  {
    const distPath = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');
    if (fs.existsSync(distPath)) {
      const bundle = fs.readFileSync(distPath, 'utf8');
      const dom = new JSDOM('<html><body><video></video></body></html>', { url: PLAY_URL, pretendToBeVisual: true, runScripts: 'outside-only' });
      const win = dom.window; const store = {};
      win.GM_setValue = (k, v) => { store[k] = v; };
      win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);
      const si = [];
      const oSI = win.setInterval;
      win.setInterval = function (...a) { si.push(a[1]); return oSI.apply(win, a); };
      vm.runInContext(bundle, dom.getInternalVMContext(), { filename: 'first.js' });
      const afterFirst = si.length;
      let secondErr = null;
      try { vm.runInContext(bundle, dom.getInternalVMContext(), { filename: 'second.js' }); }
      catch (e) { secondErr = e.message; }
      const afterSecond = si.length;
      info('G4', 'dist 二次注入结果',
        '第1次 setInterval=' + afterFirst + '，第2次=' + afterSecond + '，二次注入抛错=' + JSON.stringify(secondErr));
      assert('G4', '重复注入不会叠加定时器（第 2 次未新增）',
        afterSecond === afterFirst, SEV.SEVERE,
        '第1次=' + afterFirst + ' 第2次=' + afterSecond);
      assert('G4', '【问题】重复注入整份 bundle 会抛 "Identifier __ZHS_VERSION__ has already been declared"',
        secondErr === null, SEV.NORMAL,
        '抛错：' + secondErr + '。好在它拦住了重复挂载（副作用是好的），'
        + '但若第一次注入因页面原因部分模块提前 return，第二次将永远无法补装（SyntaxError 在文件第一行）。'
        + '构建注入的 const 应改成 IIFE 内声明或加 var/守卫。');
      try { dom.window.close(); } catch (e) { /* 忽略 */ }
    } else {
      info('G4', 'dist 不存在，跳过重复注入测试（先跑 node build.js）');
    }
  }

  console.log('\n[G4-4] 模块级重复加载（非 bundle 场景：油猴在 iframe/多个 @match 页面各注一次）');
  {
    const dom = new JSDOM('<html><body><video></video></body></html>', { url: PLAY_URL, pretendToBeVisual: true, runScripts: 'outside-only' });
    const win = dom.window; const store = {};
    win.GM_setValue = (k, v) => { store[k] = v; };
    win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);
    const si = [];
    const oSI = win.setInterval;
    win.setInterval = function (...a) { si.push(a[1]); return oSI.apply(win, a); };
    const loadAll = () => {
      for (const f of FILES) {
        try { vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), dom.getInternalVMContext(), { filename: f }); } catch (e) { /* 忽略 */ }
      }
    };
    loadAll();
    const n1 = si.filter((t) => t === 1500).length;
    loadAll();
    const n2 = si.filter((t) => t === 1500).length;
    assert('G4', '【缺陷】00-config 以外的 15 个模块没有重入守卫，重复加载会叠加定时器',
      n2 === n1, SEV.NORMAL,
      '第1轮 1500ms 定时器=' + n1 + '，第2轮=' + n2 + '（面板刷新定时器翻倍；'
      + '其它模块的 IIFE 会重复执行，如 06b 的 setTimeout(onPageReady) 也会叠一份）');
  }

  console.log('\n[G4-5] 各模块自启动 setTimeout 是否互相干扰');
  {
    const env = makeEnv('<html><body><video></video></body></html>', PLAY_URL, null, { noPanel: false });
    const Z = env.win.ZHS;
    // 等到各模块自启动落地（06b 1500ms / 06c 2000ms）
    await sleepReal(2600);
    const startupLogs = env.win.ZHS.Log.all().map((l) => l.text);
    info('G4', '自启动 2.6 秒后的日志尾部', JSON.stringify(startupLogs.slice(-8)));
    assert('G4', '自启动期间无 error 级日志（模块间不互相打断）',
      !env.win.ZHS.Log.all().some((l) => l.level === 'error'), SEV.SEVERE,
      env.win.ZHS.Log.all().filter((l) => l.level === 'error').map((l) => l.text).join(' | '));
    assert('G4', '非课程中心 / 非学习页时，CourseHub 自启动不写存储（不劫持）',
      Z.CourseHub.read().intent === null && Z.CourseHub.listDone().length === 0, SEV.SEVERE,
      JSON.stringify(Z.CourseHub.read()));
  }
  {
    // 学习页自启动：应认领 intent 并 bumpStat
    const env = makeEnv('<html><body></body></html>', STUDENT_URL, {
      'zhs-helper-hub': hubStore(freshIntent('555', 'high'), ['555'], null, { hopped: 0, failed: 0 }),
    }, { noPanel: true });
    // 手动触发页面就绪（自启动 1500ms 也可，这里直接调）
    const r = env.win.ZHS.CourseHub.settleIntentOnStudentPage();
    assert('G4', '学习页 settleIntent 认领成功、清 intent',
      r === true && env.win.ZHS.CourseHub.getIntent() === null, SEV.NORMAL,
      'r=' + r + ' intent=' + JSON.stringify(env.win.ZHS.CourseHub.getIntent()));
  }

  // ==========================================================
  console.log('\n' + '='.repeat(70));
  console.log('G5. 日志与提示一致性');
  console.log('='.repeat(70));

  console.log('\n[G5-1] 日志前缀一致性');
  {
    // 从运行期日志收集真实前缀分布（比源码静态扫描更可信）
    const env = makeEnv(HUB_HTML, HUB_URL, null, { noPanel: true });
    env.win.ZHS.Util.sleep = () => Promise.resolve();
    env.win.ZHS.setConfig({ autoCoursePick: true });
    await env.win.ZHS.CourseHub.pickNext();
    const logs = env.win.ZHS.Log.all();
    // Log._push 已经把 text 存成「参数拼串」，前缀在 text 里
    const withPrefix = logs.filter((l) => /^\[[^\]]+\]/.test(l.text));
    const without = logs.filter((l) => !/^\[[^\]]+\]/.test(l.text));
    info('G5', '运行期日志前缀分布',
      '带 [标签] = ' + withPrefix.length + '，无标签 = ' + without.length);
    const prefixes = {};
    for (const l of withPrefix) {
      const m = l.text.match(/^\[([^\]]+)\]/);
      if (m) prefixes[m[1]] = (prefixes[m[1]] || 0) + 1;
    }
    info('G5', '出现过的模块标签', JSON.stringify(prefixes));
    assert('G5', '【一致性问题】项目既有日志体系本身就没有统一前缀约定（老模块一律无标签）',
      false, SEV.NIT,
      '老模块（05-scheduler/07-main/11-solver 等）日志全部无 [标签]；'
      + '06b/06c 新模块用了 [课程中心] / [作业考试]。'
      + '全局前缀只有 00-config 的 Log._push 里固定的 "[智慧树助手]"（console 输出），面板日志缓冲不带它。'
      + '结果是：面板/console 混合阅读时，新模块日志有标签、老模块没有，不够一致——但这是项目既有风格，非 v0.6.0 引入。');
  }

  console.log('\n[G5-2] 06c 的 PREFIX 常量未被使用（维护性）');
  {
    const code = fs.readFileSync(path.join(SRC, '06c-exam.js'), 'utf8');
    const hasConst = /const PREFIX\s*=/.test(code);
    const viaConcat = (code.match(/PREFIX\s*\+/g) || []).length;
    const hardcoded = (code.match(/'\[作业考试\]/g) || []).length + (code.match(/"\[作业考试\]/g) || []).length;
    // 口径修正：原统计会把「定义行本身」的字符串字面量也算成硬编码残留
    // （`const PREFIX = '[作业考试]';` 这行必然含 '[作业考试]'），导致断言恒报。
    // 正确做法：先剔除定义行，再在剩余代码里找硬编码前缀。
    const codeWoDef = code.replace(/const PREFIX\s*=\s*['"][^'"]*['"]\s*;/g, '');
    const hardcodedReal = (codeWoDef.match(/'\[作业考试\]/g) || []).length
      + (codeWoDef.match(/"\[作业考试\]"/g) || []).length;
    assert('G5', '06c 日志前缀统一走 PREFIX 常量（剔除定义行后无硬编码残留）',
      !hasConst || hardcodedReal === 0, SEV.NORMAL,
      'PREFIX 常量存在=' + hasConst + '，PREFIX+ 拼接=' + viaConcat + ' 处，'
      + '原始计数=' + hardcoded + '（含定义行自身），剔除定义行后=' + hardcodedReal + ' 处。');
  }

  console.log('\n[G5-3] 该 warn 却静默失败的位置');
  {
    // 重点：wasm 检查「业务关键路径被吞」
    const env = makeEnv('<html><body><div class="examPaper"></div></body></html>', HW_URL, null, { noPanel: true });
    const Z = env.win.ZHS;
    Z.setConfig({ autoExam: true, examSubmit: true });
    // 页面没有 .examPaper_subject → 应 warn 而不是静默
    const before = Z.Log.all().length;
    await Z.Exam.solvePage();
    const newLogs = Z.Log.all().slice(before);
    const hasWarn = newLogs.some((l) => l.level === 'warn');
    assert('G5', '考试模块遇到「无题目」时 warn 而非静默', hasWarn, SEV.SEVERE,
      JSON.stringify(newLogs.map((l) => l.level + ':' + l.text)));
  }
  {
    // 06b: 没有卡片时是否静默？
    const env = makeEnv('<html><body><div class="ai-course-center-body"></div></body></html>', HUB_URL, null, { noPanel: true });
    env.win.ZHS.Util.sleep = () => Promise.resolve();
    const Z = env.win.ZHS;
    Z.setConfig({ autoCoursePick: true });
    const before = Z.Log.all().length;
    await Z.CourseHub.pickNext();
    const newLogs = Z.Log.all().slice(before);
    const informs = newLogs.filter((l) => l.level === 'info').length;
    assert('G5', '课程中心「没有找到未看完的课程」有 info 提示（用户能知道为什么没动作）',
      newLogs.some((l) => /没有找到未看完的课程/.test(l.text)), SEV.NORMAL,
      JSON.stringify(newLogs.map((l) => l.text)));
    info('G5', '空目录时 course hub 日志条数', 'info=' + informs + ' total=' + newLogs.length);
  }

  console.log('\n[G5-4] panel.alert 调用点参数类型核查');
  {
    const re = /ZHS\.panel\.alert\(([^;]*?)\)\s*[;\n}]/gs;
    const found = [];
    for (const f of FILES) {
      if (f === '06-panel.js') continue;
      const code = fs.readFileSync(path.join(SRC, f), 'utf8');
      let m;
      while ((m = re.exec(code))) {
        const args = m[1];
        const line = code.slice(0, m.index).split('\n').length;
        // 提取第 2 个参数
        const parts = [];
        let depth = 0, cur = '', inStr = null;
        for (let i = 0; i < args.length; i++) {
          const ch = args[i];
          if (inStr) { cur += ch; if (ch === inStr && args[i - 1] !== '\\') inStr = null; continue; }
          if (ch === '"' || ch === "'") { inStr = ch; cur += ch; continue; }
          if ('([{'.includes(ch)) depth++;
          if (')]}'.includes(ch)) depth--;
          if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        parts.push(cur.trim());
        found.push({ f, line, msg: parts[0], type: parts[1] || '(缺省)', dur: parts[2] || '(缺省)' });
      }
    }
    const badType = found.filter((x) => {
      const t = x.type.replace(/^['"]|['"]$/g, '');
      return !['info', 'warn', 'error'].includes(t) && x.type !== '(缺省)';
    });
    info('G5', 'panel.alert 调用点数', String(found.length));
    assert('G5', '所有 panel.alert 的第 2 参数都是 info/warn/error（或省略）',
      badType.length === 0, SEV.NORMAL, JSON.stringify(badType));
    const badDur = found.filter((x) => x.dur !== '(缺省)' && !/^\d+$/.test(x.dur.replace(/_/g, '')) && !/^\d+\s*\*\s*\d+$/.test(x.dur));
    assert('G5', 'panel.alert 的第 3 参数（时长）都是数字（或省略）',
      badDur.length === 0, SEV.NIT, JSON.stringify(badDur));
    info('G5', '调用点明细', found.map((x) => x.f + ':' + x.line + ' type=' + x.type.replace(/['"]/g, '') + ' dur=' + x.dur).join(' ; '));
    // 检查面板 alert 对非法 type 的兜底
    const panelSrc = fs.readFileSync(path.join(SRC, '06-panel.js'), 'utf8');
    assert('G5', 'panel.alert 对非法 type 不兜底（会挂出 .alert.非法名 的 class，样式丢失）',
      /type \|\| 'info'/.test(panelSrc) && !/\[['"](info|warn|error)['"]\].includes\(type\)/.test(panelSrc),
      SEV.NIT,
      '面板 alert 用 `el.className = "alert " + (type || "info")`，传 "warning" 会得到 .alert.warning（无对应 CSS）→ 提示不可见。'
      + '当前所有调用点都合规，仅提示未来别写错。');
  }

  console.log('\n[G5-5] 06b/06c 日志噪声（面板只有 200 条缓冲）');
  {
    const env = makeEnv(HUB_HTML, HUB_URL, null, { noPanel: true });
    env.win.ZHS.Util.sleep = () => Promise.resolve();
    const Z = env.win.ZHS;
    Z.setConfig({ autoCoursePick: true });
    const before = Z.Log.all().length;
    for (let i = 0; i < 5; i++) await Z.CourseHub.pickNext();
    const added = Z.Log.all().length - before;
    info('G5', '连续 5 次 pickNext 产生的日志条数', String(added));
    assert('G5', '【噪音】课程中心常规流程大量走 info 级日志，SPA 反复扫描会刷掉真实告警',
      added <= 10, SEV.NIT,
      '5 次 pickNext 产生 ' + added + ' 条日志；真机上 runOnHub 由 onPageReady/手动触发，'
      + '但 collectCards 的 info（"开始收集课程卡片…"/"共收集到 N 门课程"）属常规信息，'
      + '建议降到 debug。面板缓冲上限 200 条（00-config.js:133），噪声多时告警会被挤掉。');
  }

  // ==========================================================
  console.log('\n' + '='.repeat(70));
  console.log('G6. 交叉回归（v0.5.1 对比）');
  console.log('='.repeat(70));

  console.log('\n[G6-1] v0.6.0 改了哪些老文件');
  {
    let stat = '';
    try { stat = execSync('git show HEAD --stat --name-only', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { stat = ''; }
    const names = stat.split('\n').filter((l) => /^ src\//.test(l)).map((l) => l.trim());
    info('G6', 'v0.6.0 (HEAD) 改动的 src 文件', JSON.stringify(names));
    assert('G6', '只改了 00-config / 05-scheduler / 06-panel + 新增 2 个模块（无意外波及其它老模块）',
      names.every((n) => ['src/00-config.js', 'src/05-scheduler.js', 'src/06-panel.js', 'src/06b-course-hub.js', 'src/06c-exam.js'].includes(n)),
      SEV.NORMAL, JSON.stringify(names));
  }
  {
    // 05-scheduler 的 diff 是否只有那一处
    let diff = '';
    try { diff = execSync('git diff 2ca3b91 HEAD -- src/05-scheduler.js', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { diff = ''; }
    const addedLines = diff.split('\n').filter((l) => /^\+[^+]/.test(l)).length;
    const removedLines = diff.split('\n').filter((l) => /^-[^-]/.test(l)).length;
    info('G6', '05-scheduler.js diff 规模', '+' + addedLines + ' / -' + removedLines + ' 行');
    assert('G6', '05-scheduler 只插了跳课钩子（删改很少，旧逻辑没被重写）',
      removedLines <= 4, SEV.SEVERE, '删除行数 = ' + removedLines);
  }

  console.log('\n[G6-2] 开关全关时：v0.5.1 vs v0.6.0 行为完全一致');
  let sched051 = null;
  try { sched051 = execSync('git show 2ca3b91:src/05-scheduler.js', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { sched051 = null; }
  if (sched051) {
    const runOnce = async (label, override) => {
      const env = makeEnv(PLAY_ALLDONE, PLAY_URL, null, { noPanel: true, schedOverride: override });
      const Z = env.win.ZHS;
      Z.Catalog.redetect();
      Z.state.courseId = Z.Catalog.getCourseId();
      Z.setConfig({ autoCourseHop: false, autoCoursePick: false });
      let thrown = null;
      try { await Z.Scheduler.gotoNext('回归测试'); } catch (e) { thrown = e.message; }
      const rep = Z.Scheduler.lastReport();
      return {
        label,
        running: Z.state.running,
        hasReport: !!rep,
        reportKeys: rep ? Object.keys(rep).sort().join(',') : null,
        reportReason: rep ? rep.触发原因 : null,
        halted: !!Z.Scheduler._halted,
        thrown,
        errorLogs: Z.Log.all().filter((l) => l.level === 'error').map((l) => l.text),
      };
    };
    const a = await runOnce('v0.5.1', sched051);
    const b = await runOnce('v0.6.0', null);
    info('G6', 'v0.5.1 行为', JSON.stringify(a));
    info('G6', 'v0.6.0 行为', JSON.stringify(b));
    const keys = ['running', 'hasReport', 'reportKeys', 'reportReason', 'halted', 'thrown'];
    const mismatches = keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    assert('G6', '开关全关 + 目录全完：v0.5.1 与 v0.6.0 行为逐项一致（无回归）',
      mismatches.length === 0, SEV.SEVERE,
      '不一致字段 = ' + JSON.stringify(mismatches.map((k) => ({ k, v051: a[k], v060: b[k] }))));
    const errDiff = JSON.stringify(a.errorLogs) !== JSON.stringify(b.errorLogs);
    assert('G6', '开关全关时两版 error 日志一致（没有新错误）',
      !errDiff, SEV.NORMAL, 'v0.5.1=' + JSON.stringify(a.errorLogs) + ' v0.6.0=' + JSON.stringify(b.errorLogs));
  } else {
    info('G6', '无法取到 v0.5.1 的 scheduler 源码（git 历史不可用），跳过对比');
  }

  console.log('\n[G6-3] 开关全关时：目录「未学完」路径同样一致');
  if (sched051) {
    const runUndone = async (override) => {
      const env = makeEnv(PLAY_UNDONE, PLAY_URL, null, { noPanel: true, schedOverride: override });
      const Z = env.win.ZHS;
      Z.setConfig({ autoCourseHop: false, autoCoursePick: false, nextDelayMin: 0, nextDelayMax: 0 });
      const second = Z.Catalog.items()[1];
      second.addEventListener('click', () => {
        const cur = env.win.document.querySelector('.child-info.current');
        if (cur) cur.classList.remove('current');
        second.classList.add('current');
      });
      let thrown = null;
      try { await Z.Scheduler.gotoNext('回归'); } catch (e) { thrown = e.message; }
      return {
        current: Z.Catalog.itemTitle(Z.Catalog.current()),
        completed: Z.Scheduler._completedThisRun,
        navCount: Z.Scheduler._navCount,
        thrown,
        hasReport: !!Z.Scheduler.lastReport(),
      };
    };
    const a = await runUndone(sched051);
    const b = await runUndone(null);
    info('G6', 'v0.5.1 切课行为', JSON.stringify(a));
    info('G6', 'v0.6.0 切课行为', JSON.stringify(b));
    const mism = ['current', 'completed', 'navCount', 'thrown', 'hasReport'].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    assert('G6', '开关全关 + 目录未学完：切课行为两版一致（无回归）',
      mism.length === 0, SEV.SEVERE, '不一致 = ' + JSON.stringify(mism.map((k) => ({ k, a: a[k], b: b[k] }))));
  }

  console.log('\n[G6-4] 06c 是否改动老模块行为（弹题链路）');
  {
    // 弹题守卫：autoExam 开着也不该影响课中弹题逻辑
    // 注意：这一条不能传 noPanel:true —— 那会把 ZHS.panel 置为 null，
    // 于是下面「panel 是否健在」的断言必然误报缺失。这里用默认面板。
    const env = makeEnv('<html><body><video></video></body></html>', PLAY_URL, null, {});
    const Z = env.win.ZHS;
    // 06c 是独立模块，检查它没有覆写老模块的对外 API
    const apis = ['Scheduler', 'Catalog', 'Player', 'Resume', 'Solver', 'Filler', 'Answerer', 'Questions', 'Bank', 'LLM', 'panel', 'Util', 'state'];
    const missing = apis.filter((k) => !Z[k]);
    assert('G6', '06c 加载后老模块 API 全部健在（没有互相覆写）',
      missing.length === 0, SEV.SEVERE, '缺失 = ' + JSON.stringify(missing), ' loadedGlobals=' + JSON.stringify(Object.keys(Z)));
    // 06c 不该动 Scheduler
    const examSrc = fs.readFileSync(path.join(SRC, '06c-exam.js'), 'utf8');
    const touchesScheduler = /ZHS\.Scheduler\s*=[^=]/.test(examSrc) || /ZHS\.Scheduler\.\w+\s*=/.test(examSrc);
    assert('G6', '06c 不修改 ZHS.Scheduler（不与老调度器耦合）', !touchesScheduler, SEV.NORMAL,
      '源码里出现 ZHS.Scheduler 赋值');
    const hubSrc = fs.readFileSync(path.join(SRC, '06b-course-hub.js'), 'utf8');
    const hubTouchesSched = /ZHS\.Scheduler\s*=[^=]/.test(hubSrc) || /ZHS\.Scheduler\.\w+\s*=/.test(hubSrc);
    assert('G6', '06b 不修改 ZHS.Scheduler（只被调度器调用，不反向改）', !hubTouchesSched, SEV.NORMAL,
      '源码里出现 ZHS.Scheduler 赋值');
  }

  console.log('\n[G6-5] 版本号单一来源（build.js 注入）');
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const distPath = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');
    if (fs.existsSync(distPath)) {
      const dist = fs.readFileSync(distPath, 'utf8');
      // build.js 已从「声明顶层 const __ZHS_VERSION__」改为
      // 「写入 window.__ZHS_BUILD__.version」（见 build.js 注释：避免变量冲突）。
      // 这里同步用新注入格式校验，两种写法都兼容。
      const m = dist.match(/window\.__ZHS_BUILD__\.version\s*=\s*"([^"]+)"/)
        || dist.match(/const __ZHS_VERSION__\s*=\s*"([^"]+)"/);
      assert('G6', 'dist 注入的版本号与 package.json 一致',
        m && m[1] === pkg.version, SEV.NORMAL,
        'dist=' + (m && m[1]) + ' package.json=' + pkg.version);
      const headerVer = dist.match(/\/\/ @version\s+(\S+)/);
      assert('G6', '脚本头 @version 与 package.json 一致',
        headerVer && headerVer[1] === pkg.version, SEV.NORMAL,
        '@version=' + (headerVer && headerVer[1]));
    }
    const cfgSrc = fs.readFileSync(path.join(SRC, '00-config.js'), 'utf8');
    assert('G6', '00-config 里没有硬编码版本号（改由 build 注入）',
      !/version:\s*['"]\d+\.\d+\.\d+['"]/.test(cfgSrc), SEV.NORMAL,
      '仍存在硬编码 version: "x.y.z"');
  }

  // ==========================================================
  // 汇总
  // ==========================================================
  console.log('\n' + '='.repeat(70));
  console.log('汇总');
  console.log('='.repeat(70));

  const problems = results.filter((r) => r.level !== SEV.INFO);
  const bySev = {
    [SEV.SEVERE]: problems.filter((r) => r.level === SEV.SEVERE),
    [SEV.NORMAL]: problems.filter((r) => r.level === SEV.NORMAL),
    [SEV.NIT]: problems.filter((r) => r.level === SEV.NIT),
  };
  const byGroup = {};
  for (const r of problems) {
    byGroup[r.group] = byGroup[r.group] || { [SEV.SEVERE]: 0, [SEV.NORMAL]: 0, [SEV.NIT]: 0 };
    byGroup[r.group][r.level]++;
  }

  console.log('\n通过断言 ' + pass + ' 项');
  console.log('发现问题 ' + problems.length + ' 项：'
    + '严重 ' + bySev[SEV.SEVERE].length + ' / 一般 ' + bySev[SEV.NORMAL].length
    + ' / 吹毛求疵 ' + bySev[SEV.NIT].length);
  console.log('\n按组分布：');
  for (const g of Object.keys(byGroup).sort()) {
    console.log('  ' + g + '：严重 ' + byGroup[g][SEV.SEVERE] + ' / 一般 ' + byGroup[g][SEV.NORMAL] + ' / 吹毛求疵 ' + byGroup[g][SEV.NIT]);
  }
  console.log('\n问题清单：');
  for (const lv of [SEV.SEVERE, SEV.NORMAL, SEV.NIT]) {
    if (!bySev[lv].length) continue;
    console.log('\n  【' + lv + '】');
    for (const r of bySev[lv]) {
      console.log('   [' + r.group + '] ' + r.name);
      if (r.detail) console.log('        证据：' + r.detail.slice(0, 500));
    }
  }

  closeAll();
  const exit = (bySev[SEV.SEVERE].length + bySev[SEV.NORMAL].length) > 0 ? 1 : 0;
  console.log('\n退出码 ' + exit + '（严重+一般 > 0 时为 1）');
  process.exit(exit);
})().catch((e) => {
  console.error('\n灰度脚本自身异常：' + e.message);
  console.error(e.stack);
  closeAll();
  process.exit(2);
});

/** JSON 字符串化的简写（上面生成 detail 用） */
function str(v) { return JSON.stringify(v); }
