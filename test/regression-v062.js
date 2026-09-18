/**
 * 回归测试 v0.6.2：修复「看完不跳下一集 / 重播」与「自动答题卡死」
 *
 * 核心用户痛点：平台在章节列表（右侧栏）打的完成标记（对勾）才是真实「看没看完」的信号，
 * 脚本此前依赖视频进度条（1~99% 时回退重播），导致看完一节反而重看一遍。
 * 本测试锁定：① studyvideoh5 归 legacy 适配器 ② isFinished 识别通用完成标记
 * ③ 已完成节即便进度 99% 也跳下一节、绝不重播。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

function makeEnv(html, url) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html, {
    url: url || 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=abc123',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window;
  const store = {};
  win.GM_setValue = (k, v) => { store[k] = v; };
  win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);
  const SRC = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try { vm.runInContext(code, dom.getInternalVMContext(), { filename: f }); }
    catch (e) { console.log('  [加载 ' + f + ' 出错] ' + e.message); }
  }
  return { dom, win, store };
}

// 章节列表：第一节已打完对勾（legacy 的 .time_icofinish），第二节未完成
const HTML = `
<div class="chapter-tree-74">
  <div class="clearfix video current_play" id="sec1">
    <span class="child-name" title="第一节">第一节</span>
    <i class="time_icofinish"></i>
  </div>
  <div class="clearfix video" id="sec2">
    <span class="child-name" title="第二节">第二节</span>
    <i class="progress-num">99%</i>
  </div>
</div>
<video></video>
`;

(async () => {
  const { win } = makeEnv(HTML);
  const ZHS = win.ZHS;

  // 1. studyvideoh5 归 legacy 适配器优先
  ZHS.Catalog.redetect();
  ok('studyvideoh5 识别为 legacy 适配器', ZHS.state.siteVersion === 'legacy', '得到 ' + ZHS.state.siteVersion);

  // 2. isFinished 识别右侧栏对勾（通用完成标记兜底）
  const sec1 = win.document.getElementById('sec1');
  ok('右侧栏对勾(.time_icofinish)被识别为已完成', ZHS.Catalog.isFinished(sec1) === true);

  // 构造一个带通用 class 变体的完成标记，验证兜底覆盖
  const el2 = win.document.createElement('div');
  el2.innerHTML = '<span class="catalog-item-done">已学完</span>';
  ok('通用完成文字「已学完」被识别为已完成', ZHS.Catalog.isFinished(el2) === true);

  // 3. 核心回归：已完成节即便进度 99% 也跳下一节、绝不重播
  let retryCalled = false, navCalled = false;
  const origRetry = ZHS.Player.retryFromPlatformProgress;
  ZHS.Player.retryFromPlatformProgress = async () => { retryCalled = true; return false; };
  ZHS.Scheduler.gotoNext = async () => { navCalled = true; }; // 只记录，不真正导航

  const v = win.document.querySelector('video');
  // jsdom 的 HTMLMediaElement 把 ended/paused 等设为只读 getter，必须用 defineProperty 覆盖实例属性
  for (const [k, val] of Object.entries({
    ended: true, paused: false, currentTime: 100, duration: 100, play: () => Promise.resolve(),
  })) {
    Object.defineProperty(v, k, { value: val, writable: true, configurable: true });
  }
  ZHS.state.lessonKey = '第一节';
  ZHS.state.running = true;
  ZHS.Catalog.redetect();

  await ZHS.Scheduler.onLessonEnd(v);

  ok('已完成节不触发重播（retryFromPlatformProgress 未调用）', retryCalled === false);
  ok('已完成节触发跳下一节（gotoNext 被调用）', navCalled === true);

  ZHS.Player.retryFromPlatformProgress = origRetry;

  // 4. 反例：未完成且进度 50% 时仍走重播兜底（保留平台进度未同步的补救）
  retryCalled = false; navCalled = false;
  ZHS.Player.retryFromPlatformProgress = async () => { retryCalled = true; return true; };
  ZHS.Scheduler.gotoNext = async () => { navCalled = true; };
  const sec2 = win.document.getElementById('sec2');
  ZHS.state.lessonKey = '第二节';
  // sec2 无完成标记，进度 50%（progress-num 不含 %，强制设 50）
  sec2.querySelector('.progress-num').textContent = '50';
  await ZHS.Scheduler.onLessonEnd(v);
  ok('低进度未完成任务触发重播兜底（retryFromPlatformProgress 被调用）', retryCalled === true);

  console.log('\n==================================================');
  console.log('回归测试 v0.6.2：通过 ' + pass + ' / 失败 ' + fail);
  if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
  console.log('全部通过 ✓');
  process.exit(0);
})();
