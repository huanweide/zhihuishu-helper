/**
 * 双套 DOM 覆盖核查（只读，不改 src/）
 *
 * 目的：验证 src/02-adapter.js 的 ADAPTERS 能否同时吃下 studyvideoh5 的两套目录 DOM：
 *   A 套（现代 Vue）：.el-tree / .file-item / .file-item.active / .icon-finish / span[title] / .rate / .el-icon-lock
 *   B 套（legacy）  ：.clearfix.video / .clearfix.video.current_play / .time_icofinish / .progress-num / #lessonOrder
 *
 * 做法：jsdom 造 5 个场景，加载 00-config + 01-util + 02-adapter（不加载后续业务模块，
 * 避免定时器副作用），读 detect() 的评分日志 + Catalog 实际行为。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'src');
const URL_STUDYVIDEOH5 = 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=abc123';

function makeEnv(html, url) {
  const dom = new JSDOM(html, { url: url || URL_STUDYVIDEOH5, pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  const logs = [];
  win.console = Object.assign({}, win.console, {
    log: (...a) => logs.push(a.map(String).join(' ')),
    warn: (...a) => logs.push(a.map(String).join(' ')),
    error: (...a) => logs.push(a.map(String).join(' ')),
  });
  win.GM_setValue = () => {};
  win.GM_getValue = (k, d) => d;
  win.GM_deleteValue = () => {};
  win.GM_listValues = () => [];
  for (const f of ['00-config.js', '01-util.js', '02-adapter.js']) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), dom.getInternalVMContext(), { filename: f });
  }
  return { dom, win, logs };
}

function detectInfo(env) {
  env.win.ZHS.Catalog.redetect();
  const ad = env.win.ZHS.Catalog.adapter;
  const line = env.logs.filter((l) => l.includes('页面版本识别为')).pop() || '(no log)';
  return { name: ad.name, line: line.replace('[智慧树助手] ', '') };
}

// ---------- DOM 构件 ----------
function domA(n, withActive) { // A 套：.el-tree + n 个 .file-item
  let s = '<div class="course-name">课程A</div><div class="el-tree">';
  for (let i = 1; i <= n; i++) {
    const cls = withActive && i === 2 ? 'file-item active' : 'file-item';
    const fin = i === 1 ? '<i class="icon-finish"></i>' : '';
    const lock = i === n ? '<i class="el-icon-lock"></i>' : '';
    s += `<div class="el-tree-node"><div class="el-tree-node__content"><div class="${cls}">`
      + `<span class="file-name"><span title="${i}.0 课时${i}">${i}.0 课时${i}</span></span>`
      + `${fin}${lock}<span class="rate">${i === 1 ? 100 : 0}%</span></div></div></div>`;
  }
  return s + '</div>';
}
function domB(n, withCurrent) { // B 套：n 个 li.clearfix.video
  let s = '<div class="source-name">课程B</div><div class="catalogue_list"><ul>';
  for (let i = 1; i <= n; i++) {
    const cls = withCurrent && i === 2 ? 'clearfix video current_play' : 'clearfix video';
    const fin = i === 1 ? '<i class="time_icofinish"></i>' : '';
    s += `<li class="${cls}"><span id="lessonOrder">1.${i}</span>`
      + `<span class="time">课时${i}名称</span>${fin}<div class="progress-num">${i === 1 ? 100 : 0}%</div></li>`;
  }
  return s + '</ul></div>';
}
const body = (inner) => `<!DOCTYPE html><html><body>${inner}<video id="v"></video></body></html>`;

// ---------- 场景 ----------
const scenarios = [
  ['S1 纯 A 套（5 条，1 条 active）', body(domA(5, true))],
  ['S2 纯 B 套（5 条，1 条 current_play）', body(domB(5, true))],
  ['S3 A 真(5,active) + B 残留(5,无 current_play)', body(domA(5, true) + domB(5, false))],
  ['S4 B 真(5,current_play) + A 残留(5,无 active)', body(domB(5, true) + domA(5, false))],
  ['S5 B 真(5,current_play) + A 残留(20,无 active) —— 残留节点更多', body(domB(5, true) + domA(20, false))],
  ['S6 A 真(5,active) + B 残留(20,current_play) —— 旧容器仍带 current_play', body(domA(5, true) + domB(20, true))],
  ['S7 A 真(5,active) + B 残留(20,无 current_play)', body(domA(5, true) + domB(20, false))],
  ['S8 A 真(5,active) + B 残留(5,current_play) 但残留容器 display:none（已隐藏、点不动）',
    body(domA(5, true) + '<div style="display:none">' + domB(5, true) + '</div>')],
  ['S9 A 真但章节折叠(仅 2 条露出,active) + B 残留(3,current_play)',
    body(domA(2, true) + domB(3, true))],
];
const fixtures = [
  ['F1 仓库夹具 real-h5.html（A 套真身）', fs.readFileSync(path.join(ROOT, 'test/fixtures/real-h5.html'), 'utf8')],
  ['F2 仓库夹具 studyvideoh5-legacy.html（B 套 + 侧栏 3 个 .file-item 干扰）',
    fs.readFileSync(path.join(ROOT, 'test/fixtures/studyvideoh5-legacy.html'), 'utf8')],
];

console.log('========== 一、评分选举：各场景当选者与得分明细 ==========\n');
for (const [label, html] of scenarios.concat(fixtures)) {
  const env = makeEnv(html);
  const r = detectInfo(env);
  console.log(label);
  console.log('   当选: ' + r.name);
  console.log('   日志: ' + r.line);
  console.log('');
}

console.log('\n========== 二、当选后目录行为（是否真的吃得下） ==========\n');
for (const [label, html] of scenarios.concat(fixtures)) {
  const env = makeEnv(html);
  const C = env.win.ZHS.Catalog;
  C.redetect();
  const items = C.items();
  const scan = items.map((el) => ({
    t: C.itemTitle(el),
    s: C.statusOf(el),
    p: C.progressOf(el),
  }));
  const cur = C.current();
  const next = C.findNext(cur);
  console.log(label);
  console.log('   adapter=' + C.adapter.name + '  条目数=' + items.length);
  console.log('   current=' + (cur ? C.itemTitle(cur) : 'null'));
  console.log('   next=' + (next ? C.itemTitle(next) : 'null'));
  console.log('   明细: ' + JSON.stringify(scan, null, 0));
  console.log('');
}
