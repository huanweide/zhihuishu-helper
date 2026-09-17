/**
 * 逻辑单测：在不启动真实浏览器的前提下，验证核心逻辑正确性
 *
 * 覆盖：
 *  1. 配置读写（倍速夹逼）
 *  2. 工具函数（节流、可见性、URL 参数）
 *  3. 适配层（4 套页面识别 + 进度解析 + 下一节查找）
 *  4. 播放层（atEnd / percent 边界）
 *  5. 续播层（存储、过期、duration 换算）
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

function eq(name, actual, expected) {
  ok(name, actual === expected, `得到 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
}

// ============ 构造最小 DOM 环境 ============
function makeEnv(html, url) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html, {
    url: url || 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=abc123',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window;

  // ---- 模拟 video 元素能力（jsdom 不实现媒体） ----
  const store = {};
  win.GM_setValue = (k, v) => { store[k] = v; };
  win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);

  // ---- 注入 src ----
  const SRC = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try {
      vm.runInContext(code, dom.getInternalVMContext(), { filename: f });
    } catch (e) {
      console.log('  [加载 ' + f + ' 出错] ' + e.message);
    }
  }
  return { dom, win, store };
}

function setVideo(win, props) {
  const v = win.document.querySelector('video');
  if (!v) return null;
  Object.assign(v, props);
  return v;
}

// ==================================================
console.log('\n=== 1. 配置层 ===');
{
  const { win } = makeEnv('<html><body></body></html>');
  const Z = win.ZHS;
  ok('ZHS 命名空间已建立', !!Z);
  eq('默认倍速 1.5', Z.config.speed, 1.5);
  eq('默认静音开启', Z.config.mute, true);
  eq('默认 AI 答题关闭', Z.config.autoAnswer, false);

  Z.setConfig({ speed: 5 });
  eq('倍速 5 被夹到 1.8', Z.config.speed, 1.8);
  Z.setConfig({ speed: 0.1 });
  eq('倍速 0.1 被夹到 0.5', Z.config.speed, 0.5);
  Z.setConfig({ speed: 1.5, debug: false });
  eq('写入后读回正确', Z.config.speed, 1.5);
  eq('写入 debug=false', Z.config.debug, false);
}

console.log('\n=== 2. 工具层 ===');
{
  const { win } = makeEnv('<html><body><div id="a"></div></body></html>');
  const U = win.ZHS.Util;
  ok('Util 已挂载', !!U);
  eq('normText 去多余空白', U.normText('  a   b  '), 'a b');
  eq('getUrlParam 取值', U.getUrlParam('recruitAndCourseId'), 'abc123');
  eq('getUrlParam 不存在返回 null', U.getUrlParam('nope'), null);

  // 节流
  let n = 0;
  const t = U.throttle(() => n++, 100);
  t(); t(); t();
  eq('节流首次立即执行', n, 1);

  // 可见性（jsdom 无布局，rect 全 0 → 判定不可见，这是预期行为）
  eq('hasVisible 对零尺寸元素返回 false', U.hasVisible('#a'), false);
}

console.log('\n=== 3. 适配层（wisdom 版） ===');
{
  const html = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo current">
    <span class="child-name" title="1.1 课程导论">1.1 课程导论</span>
    <div role="progressbar" aria-valuenow="100"></div>
    <i class="child-check"></i>
  </div>
  <div class="child-info hasvideo">
    <span class="child-name" title="1.2 第二章概述">1.2 第二章概述</span>
    <div role="progressbar" aria-valuenow="45"></div>
  </div>
  <div class="child-info hasvideo">
    <span class="child-name" title="1.3 第三章概述">1.3 第三章概述</span>
  </div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html);
  const C = win.ZHS.Catalog;

  eq('识别为 wisdom', C.adapter.name, 'wisdom');
  eq('条目数 3', C.items().length, 3);

  const items = C.items();
  eq('条目名取自 title 属性', C.itemTitle(items[0]), '1.1 课程导论');
  eq('条目1 已完成（有 child-check）', C.isFinished(items[0]), true);
  eq('条目1 进度 100', C.progressOf(items[0]), 100);
  eq('条目2 未完成', C.isFinished(items[1]), false);
  eq('条目2 进度 45（读 aria-valuenow）', C.progressOf(items[1]), 45);
  eq('条目3 无进度元素 → 0', C.progressOf(items[2]), 0);

  eq('当前项是条目1', C.current(), items[0]);
  eq('下一节 = 条目2', C.itemTitle(C.findNext(C.current())), '1.2 第二章概述');
  eq('按名称查找', C.itemTitle(C.findByName('1.3 第三章概述')), '1.3 第三章概述');

  const st = C.stats();
  eq('统计 total 3', st.total, 3);
  eq('统计 done 1', st.done, 1);
  eq('统计 percent 33', st.percent, 33);
  eq('课程 ID 从 URL 取', C.getCourseId(), 'abc123');
}

console.log('\n=== 4. 适配层（legacy 版） ===');
{
  const html = `<html><body>
<div class="clearfix video current_play">
  <span id="lessonOrder">第1讲 绪论</span>
  <span class="progress-num">100%</span>
  <i class="time_icofinish"></i>
</div>
<div class="clearfix video">
  <span id="lessonOrder">第2讲 方法论</span>
  <span class="progress-num">30%</span>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=x9');
  const C = win.ZHS.Catalog;
  eq('识别为 legacy', C.adapter.name, 'legacy');
  eq('条目数 2', C.items().length, 2);
  eq('当前项名称', C.itemTitle(C.current()), '第1讲 绪论');
  eq('条目1 已完成', C.isFinished(C.items()[0]), true);
  eq('条目2 进度 30（读文本）', C.progressOf(C.items()[1]), 30);
  eq('下一节 = 第2讲', C.itemTitle(C.findNext(C.current())), '第2讲 方法论');
  eq('无 recruitAndCourseId 时用 courseId', C.getCourseId(), 'x9');
}

console.log('\n=== 5. 适配层（hike 版） ===');
{
  const html = `<html><body>
<div class="el-tree">
  <div class="el-tree-node">
    <div class="file-item active"><span title="课时A">课时A</span><i class="icon-finish"></i></div>
    <div class="el-tree-node__children"></div>
  </div>
  <div class="el-tree-node">
    <div class="file-item"><span title="课时B">课时B</span></div>
  </div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://hike.zhihuishu.com/stu/lesson');
  const C = win.ZHS.Catalog;
  eq('识别为 hike', C.adapter.name, 'hike');
  eq('条目数 2（过滤树中间节点）', C.items().length, 2);
  eq('当前项 = 课时A', C.itemTitle(C.current()), '课时A');
  eq('课时A 已完成', C.isFinished(C.items()[0]), true);
  eq('下一节 = 课时B', C.itemTitle(C.findNext(C.current())), '课时B');
}

console.log('\n=== 6. 播放层（边界判定） ===');
{
  const { win } = makeEnv('<html><body><video></video></body></html>');
  const P = win.ZHS.Player;
  const v = win.document.querySelector('video');

  // 模拟 duration / currentTime
  const mk = (ct, dur, ended) => ({ currentTime: ct, duration: dur, ended: !!ended });

  eq('atEnd: 中间不算结束', P.atEnd(mk(50, 100)), false);
  eq('atEnd: 99.5% 算结束', P.atEnd(mk(99.5, 100)), true);
  eq('atEnd: ended 标志优先', P.atEnd(mk(10, 100, true)), true);
  eq('atEnd: duration=NaN 不算结束', P.atEnd(mk(10, NaN)), false);
  eq('atEnd: duration=0 不算结束', P.atEnd(mk(10, 0)), false);

  eq('percent: 50%', P.percent(mk(50, 100)), 50);
  eq('percent: NaN → 0', P.percent(mk(10, NaN)), 0);
  eq('percent: 超界夹到 100', P.percent(mk(200, 100)), 100);

  eq('hasValidDuration: 正常值 true', P.hasValidDuration({ duration: 100 }), true);
  eq('hasValidDuration: Infinity false', P.hasValidDuration({ duration: Infinity }), false);
  eq('hasValidDuration: null false', P.hasValidDuration(null), false);
}

console.log('\n=== 7. 续播层（存储与恢复判断） ===');
{
  const { win, store } = makeEnv('<html><body><video></video></body></html>', 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=c001');
  const R = win.ZHS.Resume;

  R.save('c001', '1.1 课程导论', 372.5, 1200);
  const rec = R.load('c001');
  ok('记录已保存', !!rec);
  eq('lessonKey 正确', rec.lessonKey, '1.1 课程导论');
  eq('time 正确', rec.time, 372.5);
  eq('duration 正确', rec.duration, 1200);

  // 边界：前 5 秒不记
  R.save('c001', '1.2 新课时', 3, 1200);
  eq('前 5 秒不覆盖记录', R.load('c001').lessonKey, '1.1 课程导论');

  // 边界：接近结尾不记
  R.save('c001', '1.3 末尾', 1195, 1200);
  eq('接近结尾不覆盖记录', R.load('c001').lessonKey, '1.1 课程导论');

  // 过期
  const store2 = JSON.parse(store['zhs-helper-resume']);
  store2.courses.c001.updatedAt = Date.now() - 8 * 86400000;
  store['zhs-helper-resume'] = JSON.stringify(store2);
  eq('超过 7 天记录被忽略', R.load('c001'), null);

  // 清除
  R.save('c001', '甲', 100, 1000);
  R.clear('c001');
  eq('清除后读不到', R.load('c001'), null);

  // list
  R.save('cA', '课时A', 50, 500);
  R.save('cB', '课时B', 60, 600);
  eq('list 返回 2 条', R.list().length, 2);
}

console.log('\n=== 8. 调度层（结构与守卫） ===');
{
  const html = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo current"><span class="child-name" title="A">A</span></div>
  <div class="child-info hasvideo"><span class="child-name" title="B">B</span></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html);
  const S = win.ZHS.Scheduler;
  ok('调度器已挂载', !!S);
  ok('有 start 方法', typeof S.start === 'function');
  ok('有 gotoNext 方法', typeof S.gotoNext === 'function');
  ok('有 tick 方法', typeof S.tick === 'function');

  // 不启真实定时器，只验证 findNext 链路
  const next = win.ZHS.Catalog.findNext(win.ZHS.Catalog.current());
  eq('下一节查找链路正常', win.ZHS.Catalog.itemTitle(next), 'B');
}

console.log('\n=== 9. 入口层（API 暴露） ===');
{
  const { win } = makeEnv('<html><body><video></video></body></html>');
  ok('window.zhs 已暴露', !!win.zhs);
  ok('zhs.start 可调用', typeof win.zhs.start === 'function');
  ok('zhs.logs 可调用', typeof win.zhs.logs === 'function');
  ok('zhs.stats 可调用', typeof win.zhs.stats === 'function');
  const logs = win.zhs.logs();
  ok('日志已记录（有初始化痕迹）', logs.length > 0);
}

// ==================================================
console.log('\n' + '='.repeat(50));
console.log(`通过 ${pass} / 失败 ${fail}`);
if (failures.length) {
  console.log('\n失败项：');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
} else {
  console.log('全部通过 ✓');
  process.exit(0);
}
