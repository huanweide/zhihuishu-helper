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

/** 测试内短等待（等异步链落盘） */
const U2Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============ 构造最小 DOM 环境 ============
// 记录所有创建过的环境，便于统一清理（否则残留定时器会干扰后续断言）
const ALL_ENVS = [];

/** 停止所有环境里的定时器（测试组之间调用，保证互不干扰） */
function stopAllTimers() {
  for (const env of ALL_ENVS) {
    try {
      const ZHS = env.win.ZHS;
      if (ZHS && ZHS.Scheduler && ZHS.Scheduler.stop) ZHS.Scheduler.stop();
    } catch (e) { /* 忽略 */ }
  }
}

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
  ALL_ENVS.push({ dom, win });
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
  eq('默认 AI 答题开启（全自动要求）', Z.config.autoAnswer, true);
  eq('默认停止条件为不限时', Z.config.stopMode, 'none');
  eq('默认观看时长阈值', Z.config.stopMinutes, 120);
  eq('默认完成节数阈值', Z.config.stopLessons, 10);

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

console.log('\n=== 10. 答案归一化（核心算法） ===');
{
  const { win } = makeEnv('<html><body></body></html>');
  const B = win.ZHS.Bank;

  eq('纯字母 B', B.normalize('B'), 'B');
  eq('小写 b → B', B.normalize('b'), 'B');
  eq('带点 B. → B', B.normalize('B.'), 'B');
  eq('答案是B → B', B.normalize('答案是B'), 'B');
  eq('答案：C → C', B.normalize('答案：C'), 'C');
  eq('多选 A,C 保持', B.normalize('A,C'), 'A,C');
  eq('多选 A、C 转 A,C', B.normalize('A、C'), 'A,C');
  eq('多选 AC 转 A,C', B.normalize('AC'), 'A,C');
  eq('多选乱序 C,A 排序', B.normalize('C,A'), 'A,C');
  eq('多选去重 AA → A', B.normalize('A,A'), 'A');
  eq('判断 对', B.normalize('对'), '对');
  eq('判断 正确 → 对', B.normalize('正确'), '对');
  eq('判断 True → 对', B.normalize('True'), '对');
  eq('判断 错 → 错', B.normalize('错'), '错');
  eq('判断 False → 错', B.normalize('False'), '错');
  eq('判断 √ → 对', B.normalize('√'), '对');
  eq('判断 × → 错', B.normalize('×'), '错');
  eq('空字符串', B.normalize(''), '');
  eq('null 安全', B.normalize(null), '');
  eq('填空保留原文', B.normalize('光合作用'), '光合作用');

  // 索引转换
  eq('B → [1]', JSON.stringify(B.toIndexes('B')), '[1]');
  eq('A,C → [0,2]', JSON.stringify(B.toIndexes('A,C')), '[0,2]');
  eq('D → [3]', JSON.stringify(B.toIndexes('D')), '[3]');
  eq('无字母 → []', JSON.stringify(B.toIndexes('对')), '[]');

  // pickBest 取最长
  eq('pickBest 取最长（多选优先）', B.pickBest(['A', 'A,C']), 'A,C');
  eq('pickBest 单元素', B.pickBest(['B']), 'B');
  eq('pickBest 空数组', B.pickBest([]), '');
  eq('pickBest 字符串', B.pickBest('B'), 'B');
}

console.log('\n=== 11. 题目采集（弹题场景） ===');
{
  const html = `<html><body>
<div id="playTopic-dialog">
  <div class="topic-title">下列关于 TCP 三次握手的说法，正确的是（）</div>
  <div class="el-pager">
    <span class="number active">1</span>
    <span class="number">2</span>
  </div>
  <div class="topic"><div class="radio"><ul>
    <li>选项1</li><li>选项2</li>
  </ul></div></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html);
  const Q = win.ZHS.Questions;

  eq('场景识别为 dialog', Q.scene(), 'dialog');
  ok('弹题存在', Q.Dialog.present());
  const collected = Q.Dialog.collect();
  eq('采集到 2 个分页', collected.length, 2);

  const cur = Q.Dialog.readCurrent();
  ok('读到题干', !!cur && cur.title.includes('TCP'));
  eq('读到 2 个选项', cur.options.length, 2);
  eq('题型推断为 single', cur.type, 'single');
}

console.log('\n=== 12. 题目采集（作业场景） ===');
{
  const html = `<html><body>
<div class="subject_node">
  <div class="subject_type">单选题</div>
  <div class="question-topic">违反安全保障义务责任属于（）</div>
  <label class="nodeLab">A. 公平责任</label>
  <label class="nodeLab">B. 特殊侵权责任</label>
  <label class="nodeLab">C. 过错推定责任</label>
  <label class="nodeLab">D. 连带责任</label>
</div>
<div class="subject_node">
  <div class="subject_type">多选题</div>
  <div class="question-topic">以下哪些是面向对象特性（）</div>
  <label class="nodeLab">A. 封装</label>
  <label class="nodeLab">B. 继承</label>
  <label class="nodeLab">C. 多态</label>
  <label class="nodeLab">D. 编译</label>
</div>
<div class="subject_node">
  <div class="subject_type">判断题</div>
  <div class="question-topic">HTTP 是无状态协议</div>
  <label class="nodeLab">对</label>
  <label class="nodeLab">错</label>
</div>
</body></html>`;
  const { win } = makeEnv(html, 'https://www.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework');
  const Q = win.ZHS.Questions;

  eq('场景识别为 homework', Q.scene(), 'homework');
  const list = Q.Homework.collect();
  eq('采集到 3 题', list.length, 3);

  eq('第1题题型 single', list[0].type, 'single');
  eq('第1题 4 个选项', list[0].options.length, 4);
  ok('第1题题干正确', list[0].title.includes('安全保障'));

  eq('第2题题型 multiple', list[1].type, 'multiple');
  eq('第3题题型 judgement', list[2].type, 'judgement');
  eq('第3题 2 个选项', list[2].options.length, 2);
}

console.log('\n=== 13. 题型推断 ===');
{
  const { win } = makeEnv('<html><body></body></html>');
  const Q = win.ZHS.Questions;
  eq('含"多选" → multiple', Q.guessType('多选题', []), 'multiple');
  eq('含"单选" → single', Q.guessType('单选题', []), 'single');
  eq('含"判断" → judgement', Q.guessType('判断题', []), 'judgement');
  eq('含"填空" → completion', Q.guessType('填空题', []), 'completion');
  eq('对错两选项 → judgement', Q.guessType('题干', ['对', '错']), 'judgement');
  eq('正确/错误两选项 → judgement', Q.guessType('题干', ['正确', '错误']), 'judgement');
  eq('4 选项无提示 → single', Q.guessType('题干', ['a', 'b', 'c', 'd']), 'single');
  eq('无选项无提示 → unknown', Q.guessType('题干', []), 'unknown');
  eq('题库编码 single=0', Q.BANK_TYPE.single, 0);
  eq('题库编码 multiple=1', Q.BANK_TYPE.multiple, 1);
  eq('题库编码 judgement=3', Q.BANK_TYPE.judgement, 3);
}

console.log('\n=== 14. 回填层（选中判定） ===');
{
  const html = `<html><body>
<div class="subject_node">
  <div class="question-topic">测试题</div>
  <label class="nodeLab"><input type="radio" name="q1">A</label>
  <label class="nodeLab"><input type="radio" name="q1">B</label>
</div>
</body></html>`;
  const { win } = makeEnv(html);
  const F = win.ZHS.Filler;
  const labels = win.document.querySelectorAll('label');

  eq('未选中返回 false', F.isChecked(labels[0]), false);
  // 手动置 checked
  labels[0].querySelector('input').checked = true;
  eq('input.checked=true 判定为选中', F.isChecked(labels[0]), true);
  // 类名判定
  labels[1].classList.add('is-checked');
  eq('is-checked 类判定为选中', F.isChecked(labels[1]), true);
  eq('null 安全', F.isChecked(null), false);
}

console.log('\n=== 15. 求解器（缓存与降级） ===');
{
  const { win } = makeEnv('<html><body></body></html>');
  const S = win.ZHS.Solver;
  ok('求解器已挂载', !!S);
  ok('有 solve 方法', typeof S.solve === 'function');
  ok('有 solveAll 方法', typeof S.solveAll === 'function');
  eq('初始统计为 0', S.stats.bank + S.stats.llm, 0);
  S.clearCache();
  ok('缓存可清空', true);
}

console.log('\n=== 16. LLM Prompt 构建 ===');
{
  const { win } = makeEnv('<html><body></body></html>');
  const L = win.ZHS.LLM;
  ok('LLM 模块已挂载', !!L);

  const p1 = L.buildPrompt('1+1=?', ['1', '2', '3'], 'single');
  ok('Prompt 含题干', p1.includes('1+1=?'));
  ok('Prompt 含选项 A.', p1.includes('A. 1'));
  ok('Prompt 含单选约束', p1.includes('单选题'));

  const p2 = L.buildPrompt('判断题', ['对', '错'], 'judgement');
  ok('Prompt 含判断约束', p2.includes('判断题'));

  const p3 = L.buildPrompt('无选项题', [], 'unknown');
  ok('无选项时不输出选项段', !p3.includes('选项：'));
}

console.log('\n=== 17. 弹题编排（签名防抖） ===');
{
  const html = `<html><body>
<div id="playTopic-dialog">
  <div class="topic-title">题目A</div>
  <div class="topic"><div class="radio"><ul><li>1</li><li>2</li></ul></div></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html);
  const A = win.ZHS.Answerer;
  ok('答题器已挂载', !!A);
  ok('有 handleDialog', typeof A.handleDialog === 'function');
  ok('有 handleHomework', typeof A.handleHomework === 'function');
  A.reset();
  eq('reset 后签名为空', A._answeredSig, '');
}

console.log('\n=== 19. 续播绑定（回归：重复绑定吞掉监听器） ===');
{
  // 这个 bug 由截屏测试抓出：
  //   bindVideo 被调用两次时，第二次虽因守卫直接 return，
  //   但它先把 this._saveThrottled 覆盖成了没被事件触发的新函数，
  //   结果已有的 timeupdate 监听器指向死函数 → 进度永远存不下来。
  const { win, store } = makeEnv(
    '<html><body><video></video></body></html>',
    'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=bind001'
  );
  const R = win.ZHS.Resume;
  const v = win.document.querySelector('video');

  // 模拟 media 能力
  Object.defineProperty(v, 'paused', { value: false, configurable: true });
  Object.defineProperty(v, 'duration', { value: 600, configurable: true });
  Object.defineProperty(v, 'currentTime', { value: 30, writable: true, configurable: true });

  const r1 = R.bindVideo(v, 'bind001', '第一节');
  eq('首次绑定成功', r1, true);

  const r2 = R.bindVideo(v, 'bind001', '第一节');
  eq('同一 video 重复绑定不报错', r2, true);

  // 关键断言：重复绑定后，throttle 函数仍是被绑定的那个（回调归属正确）
  // 直接触发 timeupdate，看是否真的落到 save 上
  R._saveThrottled = null;   // 故意打断测试，确认监听器用的是内部引用
  R.bindVideo(v, 'bind001', '第一节');

  // 换一个 video 元素 → 应该重新绑定
  const v2 = win.document.createElement('video');
  win.document.body.appendChild(v2);
  Object.defineProperty(v2, 'paused', { value: false, configurable: true });
  Object.defineProperty(v2, 'duration', { value: 600, configurable: true });
  Object.defineProperty(v2, 'currentTime', { value: 50, writable: true, configurable: true });
  const r3 = R.bindVideo(v2, 'bind001', '第二节');
  eq('video 元素被替换时重新绑定', r3, true);
  eq('绑定 id 已递增', R._bindId > 0, true);

  // _detach 后应清空绑定
  R._detach();
  eq('解绑后 _boundVideo 清空', R._boundVideo, null);
  eq('解绑后节流函数清空', R._saveThrottled, null);
}

console.log('\n=== 20. 目录三态识别（N1：已完成 / 未完成 / 未解锁） ===');
{
  const html = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo current">
    <span class="child-name" title="第一节 已看完">第一节 已看完</span>
    <i class="child-check"></i>
  </div>
  <div class="child-info hasvideo">
    <span class="child-name" title="第二节 看了一半">第二节 看了一半</span>
    <div role="progressbar" aria-valuenow="42"></div>
  </div>
  <div class="child-info hasvideo">
    <span class="child-name" title="第三节 没看">第三节 没看</span>
  </div>
  <div class="child-info hasvideo" aria-disabled="true">
    <span class="child-name" title="第四节 未解锁">第四节 未解锁</span>
    <i class="lock-icon"></i>
  </div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=n1');
  const C = win.ZHS.Catalog;
  const S = win.ZHS.STATUS;

  eq('识别为 wisdom', C.adapter.name, 'wisdom');
  eq('条目数 4', C.items().length, 4);

  eq('第1节 状态=done', C.statusOf(C.items()[0]), S.DONE);
  eq('第2节 状态=undone（部分进度）', C.statusOf(C.items()[1]), S.UNDONE);
  eq('第3节 状态=undone', C.statusOf(C.items()[2]), S.UNDONE);
  eq('第4节 状态=locked（aria-disabled）', C.statusOf(C.items()[3]), S.LOCKED);

  const bd = C.breakdown();
  eq('统计 done=1', bd.done, 1);
  eq('统计 undone=2', bd.undone, 2);
  eq('统计 locked=1', bd.locked, 1);
  eq('统计 total=4', bd.total, 4);
  eq('未全完成 allDone=false', bd.allDone, false);

  // scan 返回带状态的清单
  const sc = C.scan();
  eq('scan 返回 4 条', sc.length, 4);
  eq('scan 首条状态为 done', sc[0].status, S.DONE);
  eq('scan 首条含标题', sc[0].title, '第一节 已看完');

  // pending 只含未完成未锁的
  eq('pending 有 2 条', C.pending().length, 2);
}

console.log('\n=== 21. 跳过已完成与未解锁（N2） ===');
{
  const html = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo current"><span class="child-name" title="A已完成">A</span><i class="child-check"></i></div>
  <div class="child-info hasvideo"><span class="child-name" title="B已完成">B</span><i class="child-check"></i></div>
  <div class="child-info hasvideo"><span class="child-name" title="C未完成">C</span></div>
  <div class="child-info hasvideo" aria-disabled="true"><span class="child-name" title="D未解锁">D</span></div>
  <div class="child-info hasvideo"><span class="child-name" title="E未完成">E</span></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=n2');
  const C = win.ZHS.Catalog;
  const items = C.items();

  // 从 A 出发：应跳过已完成的 B，落到 C（而不是停在 B）
  eq('跳过 B 直接到 C', C.itemTitle(C.findNext(items[0])), 'C未完成');
  // 从 C 出发：应跳过未解锁的 D，落到 E
  eq('跳过未解锁 D 直接到 E', C.itemTitle(C.findNext(items[2])), 'E未完成');
  // 从 E 出发：后面没有了，回头补漏找到 C
  eq('末尾回头补漏到 C', C.itemTitle(C.findNext(items[4])), 'C未完成');

  // 全部完成时 findNext 返回 null
  const html2 = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo"><span class="child-name" title="A">A</span><i class="child-check"></i></div>
  <div class="child-info hasvideo"><span class="child-name" title="B">B</span><i class="child-check"></i></div>
</div>
<video></video>
</body></html>`;
  const env2 = makeEnv(html2, 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=n2b');
  const C2 = env2.win.ZHS.Catalog;
  eq('全完成时 findNext 为 null', C2.findNext(null), null);
  eq('全完成时 allDone=true', C2.breakdown().allDone, true);
}

console.log('\n=== 22. 全完成总结报告（N3） ===');
stopAllTimers();   // 清掉前面各组残留的定时器，避免干扰本组断言
const _n3 = (async () => {
  const html = `<html><body>
<div class="course-name">测试课程</div>
<div class="chapter-tree-74">
  <div class="child-info hasvideo"><span class="child-name" title="A">A</span><i class="child-check"></i></div>
  <div class="child-info hasvideo"><span class="child-name" title="B">B</span><i class="child-check"></i></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=n3');
  const S = win.ZHS.Scheduler;
  const ZHS = win.ZHS;

  // 等 main.js 的异步 boot() 跑完（它内部有 waitFor video + Resume.restore）
  // 否则 boot 的第 7 步 Scheduler.start() 会在 finishAll 之后才执行，把状态冲掉
  await new Promise((r) => setTimeout(r, 600));

  // 手工置位，让 finishAll 有内容可写
  ZHS.state.answeredCount = 7;
  ZHS.state.startedAt = Date.now() - 125000;   // 约 2 分 5 秒
  S._navCount = 3;

  // 人为造出「正在运行」的状态，验证 finishAll 能把它关掉
  S.stop();
  ZHS.state.running = true;
  S._timer = setInterval(() => {}, 100000);

  await S.finishAll('测试触发');

  const immRunning = ZHS.state.running;
  const immTimer = S._timer;

  const rp = S.lastReport();
  ok('生成总结报告', !!rp);
  ok('完成数正确', rp && rp.已完成 === 2, rp && String(rp.已完成));
  ok('总节点正确', rp && rp.总节点 === 2, rp && String(rp.总节点));
  ok('完成度 100%', rp && rp.完成度 === '100%', rp && rp.完成度);
  ok('含已答题数', rp && rp.已答题数 === 7, rp && String(rp.已答题数));
  ok('含本次切换课时数', rp && rp.本次切换课时数 === 3, rp && String(rp.本次切换课时数));
  ok('含总耗时', rp && /分/.test(rp.总耗时), rp && rp.总耗时);
  ok('含结束时间', rp && !!rp.结束时间, rp && rp.结束时间);
  ok('触发原因已记录', rp && rp.触发原因 === '测试触发', rp && rp.触发原因);
  ok('finishAll 把运行态关掉', immRunning === false, String(immRunning));
  ok('finishAll 清掉了定时器', immTimer === null, immTimer ? '仍有定时器' : '');
})();

console.log('\n=== 23. 答完自动关闭弹题（N4） ===');
{
  const html = `<html><body>
<div id="playTopic-dialog">
  <div class="topic-title">测试题：1+1=?</div>
  <div class="topic"><ul>
    <li class="topic-item"><input type="radio" name="q">A. 1</li>
    <li class="topic-item"><input type="radio" name="q">B. 2</li>
  </ul></div>
  <button class="close-btn">关闭</button>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=n4');
  const D = win.ZHS.Questions.Dialog;

  eq('弹题存在', D.present(), true);

  // 给关闭按钮打桩：点击后移除弹题（模拟真实关闭）
  const btn = win.document.querySelector('#playTopic-dialog .close-btn');
  let clicked = false;
  btn.addEventListener('click', () => {
    clicked = true;
    const el = win.document.getElementById('playTopic-dialog');
    if (el) el.remove();
  });

  const ok1 = D.close();
  eq('close() 返回 true', ok1, true);
  eq('关闭按钮被点击', clicked, true);
  eq('关闭后弹题不再存在', D.stillPresent(), false);
}

console.log('\n=== 24. 弹题关闭失败退避（N4 防死循环） ===');
const _n4 = (async () => {
  const html = `<html><body>
<div id="playTopic-dialog">
  <div class="topic-title">关不掉的题</div>
  <div class="topic"><ul><li class="topic-item">A</li></ul></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=n4b');
  const A = win.ZHS.Answerer;

  // 没有可点的关闭按钮 / 点击无效 → 应进入退避
  const r = await A.closeDialogAndResume();
  eq('关闭失败返回 false', r, false);
  eq('失败计数 +1', A._failCount, 1);
  eq('已设置退避截止时间', A._cooldownUntil > Date.now(), true);

  // 退避期内 handleDialog 应直接跳过
  const before = win.ZHS.state.answeredCount;
  await A.handleDialog();
  eq('退避期内不重复作答', win.ZHS.state.answeredCount, before);

  // reset 清空退避
  A.reset();
  eq('reset 后失败计数归零', A._failCount, 0);
  eq('reset 后退避解除', A._cooldownUntil, 0);
})();

console.log('\n=== 25. 启动预检（N1：开跑前全量体检） ===');
{
  const html = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo"><span class="child-name">第一节 已完成</span><i class="child-check"></i></div>
  <div class="child-info hasvideo"><span class="child-name">第二节 看了一半</span></div>
  <div class="child-info hasvideo"><span class="child-name">第三节 没看</span></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=pf');
  const S = win.ZHS.Scheduler;

  eq('有 preflight 方法', typeof S.preflight, 'function');
  const bd = S.preflight();
  ok('预检返回统计对象', !!bd, String(bd));
  eq('预检识别总节点 3', bd && bd.total, 3);
  eq('预检识别已完成 1', bd && bd.done, 1);
  eq('预检识别未看完 2', bd && bd.undone, 2);
  eq('预检识别未全完成', bd && bd.allDone, false);

  // 日志里应留下体检结论
  const logs = win.ZHS.Log.all().map((e) => e.text).join('\n');
  ok('日志含课程体检', /课程体检/.test(logs), logs.slice(-200));
  ok('日志列出待学清单', /待学 1/.test(logs), logs.slice(-200));
}

console.log('\n=== 26. skipFinished 开关真正生效（N2） ===');
{
  const html = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo current"><span class="child-name">第一节 已完成</span><i class="child-check"></i></div>
  <div class="child-info hasvideo"><span class="child-name">第二节 已完成</span><i class="child-check"></i></div>
  <div class="child-info hasvideo"><span class="child-name">第三节 没看</span></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=sk');
  const S = win.ZHS.Scheduler;
  const cat = win.ZHS.Catalog;

  const all = cat.items();
  const first = all[0];

  // skipFinished = true（默认）：从第 1 节往后，应直接跳到第 3 节（跳过已完成的第 2 节）
  win.ZHS.setConfig({ skipFinished: true });
  const nSkip = cat.findNext(first);
  eq('开启时跳过已完成 → 命中第三节', cat.itemTitle(nSkip), '第三节 没看');

  // skipFinished = false：按顺序推进，应命中紧邻的第 2 节（已完成也不跳）
  win.ZHS.setConfig({ skipFinished: false });
  const nOrder = S._nextInOrder(first, cat);
  eq('关闭时按顺序 → 命中第二节', cat.itemTitle(nOrder), '第二节 已完成');

  win.ZHS.setConfig({ skipFinished: true });   // 还原
}

console.log('\n=== 27. 总结面板标题随真实结果动态变化（防撒谎） ===');
{
  const html = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo"><span class="child-name">A</span></div>
  <div class="child-info hasvideo"><span class="child-name">B</span></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=tp');
  const P = win.ZHS.panel;

  // 场景 1：真的全看完了 → 标题应为「全部课程已看完」
  P.showReport({
    课程名: 'X', 页面版本: 'wisdom', 总节点: 2, 已完成: 2, 未完成: 0, 未解锁: 0,
    完成度: '100%', 本次切换课时数: 2, 已答题数: 5, 答题通道: '-', 总耗时: '1 分 0 秒',
    结束时间: '2026/9/17 22:00:00',
  });
  let host = win.document.getElementById('zhs-helper-panel');
  let txt = host.shadowRoot.querySelector('.report').textContent;
  ok('全完成时标题为「全部课程已看完」', txt.includes('全部课程已看完'), txt.slice(0, 40));

  // 场景 2：只完成 50% → 标题不能撒谎
  P.showReport({
    课程名: 'X', 页面版本: 'wisdom', 总节点: 4, 已完成: 2, 未完成: 2, 未解锁: 0,
    完成度: '50%', 本次切换课时数: 1, 已答题数: 0, 答题通道: '-', 总耗时: '1 分 0 秒',
    结束时间: '2026/9/17 22:00:00',
  });
  host = win.document.getElementById('zhs-helper-panel');
  txt = host.shadowRoot.querySelector('.report').textContent;
  ok('未全完成时标题不撒谎', !txt.includes('全部课程已看完'), txt.slice(0, 60));
  ok('未全完成时给出正确提示', txt.includes('仍有') && txt.includes('节未完成'), txt.slice(0, 60));
}

console.log('\n=== 28. 结构兜底扫描（平台改版/未知域名救命稻草） ===');
{
  // 模拟一个完全不认识结构的「新平台」课程页：类名全是随机字符串
  const html = `<html><body>
<div id="app">
  <div class="xz9f2k">
    <div class="qw-a1">第一章 绪论</div>
    <div class="qw-a1">第二章 基础概念</div>
    <div class="qw-a1">第三章 进阶应用</div>
    <div class="qw-a1">第四章 实战练习</div>
  </div>
</div>
<video></video>
</body></html>`;
  // 用 polymas 域名触发 polymas 适配器（其预设选择器全部不命中）
  const { win } = makeEnv(html, 'https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center');
  const cat = win.ZHS.Catalog;

  const items = cat.items();
  ok('兜底扫描能捞到条目', items.length >= 4, '实得 ' + items.length);

  const titles = items.map((el) => cat.itemTitle(el));
  ok('兜底条目名可读', titles.includes('第一章 绪论'), JSON.stringify(titles).slice(0, 160));

  // 三态在兜底模式下也要能用
  const bd = cat.breakdown();
  ok('兜底模式能统计', bd.total >= 4, JSON.stringify(bd));
  eq('兜底模式未完成数正确', bd.undone, bd.total);
  eq('兜底模式全未完成', bd.allDone, false);

  // 日志应留下兜底启用提示
  const logs = win.ZHS.Log.all().map((e) => e.text).join('\n');
  ok('日志含兜底扫描提示', /结构兜底扫描/.test(logs), logs.slice(-200));
}

console.log('\n=== 29. 停止条件（按时长 / 按节数） ===');
const _stopCond = (async () => {
  const html = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo"><span class="child-name">A</span><i class="child-check"></i></div>
  <video></video>
</div></body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=stopc');
  const S = win.ZHS.Scheduler;

  // —— minutes 模式：把 startedAt 拨回 2 小时前，阈值 1 分钟 → 应触发停止
  win.ZHS.setConfig({ stopMode: 'minutes', stopMinutes: 1 });
  win.ZHS.state.startedAt = Date.now() - 2 * 60 * 60 * 1000;
  S._checkStopCondition();
  await U2Sleep(50);
  eq('时长达标后运行态关闭', win.ZHS.state.running, false);
  ok('时长达标生成总结', !!S.lastReport(), String(S.lastReport()));
  ok('总结含触发原因', /观看时长/.test(S.lastReport().触发原因), S.lastReport().触发原因);

  // —— lessons 模式：完成 2 节阈值 2 → 触发
  win.ZHS.state.running = true;
  win.ZHS.state.startedAt = Date.now();
  win.ZHS.setConfig({ stopMode: 'lessons', stopLessons: 2 });
  S._completedThisRun = 2;
  S._checkStopCondition();
  await U2Sleep(50);
  eq('节数达标后运行态关闭', win.ZHS.state.running, false);
  ok('节数达标生成总结', /完成节数/.test(S.lastReport().触发原因), S.lastReport().触发原因);

  // —— 未达标不触发
  win.ZHS.state.running = true;
  win.ZHS.setConfig({ stopMode: 'lessons', stopLessons: 5 });
  S._completedThisRun = 2;
  S._checkStopCondition();
  await U2Sleep(50);
  eq('未达标继续运行', win.ZHS.state.running, true);

  // —— none 模式永不触发
  win.ZHS.setConfig({ stopMode: 'none' });
  S._completedThisRun = 99;
  S._checkStopCondition();
  await U2Sleep(50);
  eq('none 模式不触发停止', win.ZHS.state.running, true);
  win.ZHS.Scheduler.stop();
})();

console.log('\n=== 30. 目录未识别时不弹假总结（修复点） ===');
const _fakeFin = (async () => {
  const html = `<html><body><video></video></body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=fakefin');
  const S = win.ZHS.Scheduler;

  // 在停机发生的当下同步抓取状态：gotoNext 的 await 链中有等待，
  // 期间 watchSpa 的 MutationObserver（1s 防抖）可能已自愈重启，
  // 直接读 _timer 会被异步干扰，故用 hook 捕获停机瞬间的语义。
  let haltSnap = null;
  const _origStop = S.stop.bind(S);
  S.stop = function (why) { _origStop(why); haltSnap = { why: S._haltReason, halted: S._halted }; };

  await S.gotoNext('手动', { manual: true });

  ok('目录为空时确实触发了停机', !!haltSnap, JSON.stringify(haltSnap));
  eq('目录为空停机原因为瞬时故障（允许自愈）', haltSnap && haltSnap.why, 'transient');
  eq('瞬时故障停不置 _halted（可被自愈拉起）', haltSnap && haltSnap.halted, false);
  ok('目录为空时不生成「全部看完」总结', !S.lastReport(), String(S.lastReport()));

  // round-14 安全边界核心断言：用户主动停 / 达标停 绝不能被自愈偷偷拉起
  const S2b = win.ZHS.Scheduler;
  S2b.stop = _origStop;             // 还原真实 stop，避免 hook 干扰
  S2b._transientReloads = 0;
  S2b.stop();                       // 默认 'user'
  eq('用户主动停后 _haltReason 为 user', S2b._haltReason, 'user');
  eq('用户主动停后自愈必须返回 false', S2b.tryResumeAfterTransientStop(), false);
  eq('用户主动停后定时器仍为 null', S2b._timer, null);
})();

console.log('\n=== 31. 视频放完且平台进度读不到 → 直接切下一集（修复重播 bug） ===');
// 必须是 async IIFE：这里用了 await，写在裸 block 里会被 Node 判定为
// top-level await，与顶部的 require() 冲突 → 整个测试文件起不来。
const _noreplay = (async () => {
  const html = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo current"><span class="child-name">第一节</span></div>
  <div class="child-info hasvideo"><span class="child-name">第二节</span></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=noreplay');
  const S = win.ZHS.Scheduler;
  const cat = win.ZHS.Catalog;
  const video = win.document.querySelector('video');
  video.duration = 300;
  video.currentTime = 300;
  video.ended = true;

  // 目录条目无完成标记、无进度条 → progressOf 读到 0
  const cur = cat.current();
  eq('当前条目进度读不到', cat.progressOf(cur), 0);

  // 点击第二节后移除 current 并标记到第二节（模拟 SPA 切换）
  const second = cat.items()[1];
  second.addEventListener('click', () => {
    win.document.querySelector('.child-info.current').classList.remove('current');
    second.classList.add('current');
  });

  await S.onLessonEnd(video);

  ok('平台进度 0% 也切换了课时', cat.itemTitle(cat.current()) === '第二节',
    cat.itemTitle(cat.current()));
  ok('完成计数 +1', S._completedThisRun === 1, String(S._completedThisRun));
})();

console.log('\n=== 31b. 瞬时故障停机的受限自愈（round-14） ===');
const _transient = (async () => {
  const html = `<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo current"><span class="child-name">第一节</span></div>
  <div class="child-info hasvideo"><span class="child-name">第二节</span></div>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=trans1');
  const S = win.ZHS.Scheduler;
  win.ZHS.state.videoEl = win.document.querySelector('video');

  // ① 冷却期内不救：刚停机立刻调用必须返回 false
  S._transientReloads = 0;
  S.stop('transient');
  eq('瞬时故障停后 _haltReason 为 transient', S._haltReason, 'transient');
  eq('瞬时故障停不置 _halted', S._halted, false);
  eq('冷却期内不自愈（防高频空转）', S.tryResumeAfterTransientStop(), false);

  // ② 冷却期满 + 视频就绪 → 自愈成功
  S._transientStoppedAt = Date.now() - 61000;   // 伪造已过 60s 冷却
  eq('冷却期满后自愈返回 true', S.tryResumeAfterTransientStop(), true);
  eq('自愈后主循环定时器已建立', S._timer !== null, true);
  eq('自愈次数 +1', S._transientReloads, 1);
  S.stop();

  // ③ 超过次数上限后不再自愈（防无限重试）
  S._transientReloads = 3;
  S.stop('transient');
  S._transientStoppedAt = Date.now() - 61000;
  eq('超过自愈上限后返回 false', S.tryResumeAfterTransientStop(), false);
  eq('超限后定时器仍为 null', S._timer, null);

  // ④ 视频未就绪时不救（等 DOM 恢复再来）
  //    注意：实现里有 `videoEl || document.querySelector('video')` 兜底，
  //    所以要真正验证「无视频不救」，必须把 DOM 里的 video 也移除，只置 videoEl=null 不够。
  S._transientReloads = 0;
  const _v = win.document.querySelector('video');
  if (_v && _v.parentNode) _v.parentNode.removeChild(_v);
  win.ZHS.state.videoEl = null;
  S.stop('transient');
  S._transientStoppedAt = Date.now() - 61000;
  eq('视频缺失时不自愈', S.tryResumeAfterTransientStop(), false);

  // ⑤ 达标停（condition）同样不可被自愈拉起
  win.document.body.appendChild(win.document.createElement('video'));
  win.ZHS.state.videoEl = win.document.querySelector('video');
  S._transientReloads = 0;
  S.stop('condition');
  S._transientStoppedAt = Date.now() - 61000;
  eq('达标停后自愈必须返回 false', S.tryResumeAfterTransientStop(), false);
  eq('达标停后 _halted 为 true（彻底封死）', S._halted, true);

  // ⑥ round-15【A2】：自愈恢复不得清零「本次完成节数 / 开始时间 / 切换课时数」，
  //    否则「设了看 N 节就停」永远凑不够阈值、总结总耗时少算。
  S._halted = false; S._haltReason = ''; S._transientReloads = 0;
  S._completedThisRun = 7;
  S._navCount = 4;
  const _t0 = 1234567890;
  win.ZHS.state.startedAt = _t0;
  S.stop('transient');
  S._transientStoppedAt = Date.now() - 61000;
  eq('自愈可成功拉起', S.tryResumeAfterTransientStop(), true);
  eq('自愈后完成节数未被清零（A2 核心）', S._completedThisRun, 7);
  eq('自愈后切换课时数未被清零', S._navCount, 4);
  eq('自愈后开始时间未被重置（总耗时不丢）', win.ZHS.state.startedAt, _t0);
  S.stop();

  // ⑦ round-15【A1】：用户手动「启动」应重置自愈名额，否则用满 3 次后永久失去自愈能力
  S._transientReloads = 3;
  S.start({ manual: true });
  eq('手动启动后自愈名额已重置', S._transientReloads, 0);
  eq('手动启动属全新一轮，完成计数归零', S._completedThisRun, 0);
  S.stop();

  // ⑧ round-16【P1/P2】核心断言（验证 worker 指出的测试盲区）：
  //    自愈恢复必须「保留成果计数器 + 清零止损闸门」，这是两类计数器的分离语义。
  //    原先测试完全没覆盖 resume 分支 → 绿灯但分支未验。
  S._halted = false; S._haltReason = ''; S._transientReloads = 0;
  S._completedThisRun = 6;      // 成果：已完成 6 节
  S._navCount = 5;              // 成果：已切换 5 次
  S._navFailCount = 4;          // 止损闸门：同目标已失败 4 次（危险残留）
  S._navFailKey = '某坏节点';
  S._navFailTotal = 7;          // 止损闸门：本轮累计失败 7 次（上限 8，危险残留）
  const _t1 = 1700000000000;
  win.ZHS.state.startedAt = _t1;
  S.stop('transient');
  S._transientStoppedAt = Date.now() - 61000;
  eq('自愈可成功', S.tryResumeAfterTransientStop(), true);
  eq('【P1】自愈后同目标失败计数已清零', S._navFailCount, 0);
  eq('【P1】自愈后失败目标键已清空', S._navFailKey, null);
  eq('【P2】自愈后本轮累计失败已清零', S._navFailTotal, 0);
  eq('【A2】成果·完成节数仍保留', S._completedThisRun, 6);
  eq('【A2】成果·切换课时数仍保留', S._navCount, 5);
  eq('【A2】成果·开始时间仍保留', win.ZHS.state.startedAt, _t1);
  S.stop();

  // ⑨ round-16【P3】：自愈恢复的体检必须静默（不重复弹「开始自动学习」）
  let alertCount = 0;
  win.ZHS.panel = {
    mount() {}, alert() { alertCount++; }, showReport() {},
  };
  S._halted = false; S._haltReason = ''; S._transientReloads = 0;
  S.stop('transient');
  S._transientStoppedAt = Date.now() - 61000;
  S.tryResumeAfterTransientStop();
  const _resumeAlerts = alertCount;
  S.stop();
  // 全新启动（非 resume）时才应弹提示
  alertCount = 0;
  S.start({ manual: true });
  const _freshAlerts = alertCount;
  S.stop();
  eq('【P3】自愈恢复时体检静默（不重复弹提示）', _resumeAlerts, 0);
  ok('【P3】全新启动仍会弹提示（保留原有 UX）', _freshAlerts > 0, String(_freshAlerts));
})();

console.log('\n=== 32. 手动答题绕过配置（面板「答题」按钮必须有效） ===');
const _manualAns = (async () => {
  const html = `<html><body>
<div id="playTopic-dialog">
  <div class="topic-title">手动触发题：1+1=?</div>
  <div class="topic"><ul>
    <li class="topic-item"><input type="radio" name="q">A. 1</li>
    <li class="topic-item"><input type="radio" name="q">B. 2</li>
  </ul></div>
  <button class="close-btn">关闭</button>
</div>
<video></video>
</body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=manualans');
  const A = win.ZHS.Answerer;

  // 关闭自动答题 → 直接调 handleDialog()（非手动）应静默返回
  win.ZHS.setConfig({ autoAnswer: false });
  const before = win.ZHS.state.answeredCount;
  await A.handleDialog();
  eq('未开自动答题时非手动调用不执行', win.ZHS.state.answeredCount, before);

  // 手动调用（面板按钮传 manual）→ 必须执行
  const btn = win.document.querySelector('#playTopic-dialog .close-btn');
  btn.addEventListener('click', () => {
    const el = win.document.getElementById('playTopic-dialog');
    if (el) el.remove();
  });
  // 新语义：默认不蒙答案（gatedRandom = false），没有可用通道时**不作答**，
  // 但必须给用户明确反馈，绝不能「点了按钮毫无反应」。
  await A.handleDialog({ manual: true });
  const answered = win.ZHS.state.answeredCount > before;
  const logText = win.ZHS.Log.all().map((e) => e.text).join('\n');
  ok(
    '手动触发后：要么作答、要么明确告知未作答',
    answered || /没有可用答题通道|未能识别到题目/.test(logText),
    'answered=' + answered + ' logs=' + logText.slice(-160)
  );
  ok('手动触发后弹题被关闭', !win.ZHS.Questions.Dialog.stillPresent(), '');

  // 第一次手动触发（gatedRandom=false）后弹窗已被关闭（答完/跳过后关弹窗是既定行为）。
  // 模拟「又遇到新弹题」：重建弹窗再验证 gatedRandom=true 时能真正作答——
  // 否则 root() 为 null 直接返回，测不出随机兜底的真实性。
  const dlg = win.document.createElement('div');
  dlg.id = 'playTopic-dialog';
  dlg.innerHTML = '<div class="topic-title">手动触发题：1+1=?</div>'
    + '<div class="topic"><ul>'
    + '<li class="topic-item"><input type="radio" name="q">A. 1</li>'
    + '<li class="topic-item"><input type="radio" name="q">B. 2</li>'
    + '</ul></div><button class="close-btn">关闭</button>';
  win.document.body.appendChild(dlg);
  dlg.querySelector('.close-btn').addEventListener('click', () => dlg.remove());
  // 让点击选项真正触发选中态（模拟真实平台交互），否则 isChecked 自检永不过
  dlg.querySelectorAll('.topic-item').forEach((li) => {
    li.addEventListener('click', () => {
      const inp = li.querySelector('input');
      if (inp) inp.checked = true;
      li.classList.add('is-checked');
    });
  });

  win.ZHS.setConfig({ gatedRandom: true });
  await U2Sleep(30);
  const before2 = win.ZHS.state.answeredCount;
  const A2 = win.ZHS.Answerer;
  A2.reset();
  await A2.handleDialog({ manual: true });
  ok('开启随机兜底后能作答', win.ZHS.state.answeredCount > before2,
    String(win.ZHS.state.answeredCount));
  win.ZHS.setConfig({ gatedRandom: false });
})();

console.log('\n=== 32b. 虚拟滚动目录补全（round-5 修复） ===');
{
  // 构造「虚拟滚动」场景：初始只渲染 3 节在 DOM，后面 3 节要靠「滚动容器到底」才懒加载进 DOM。
  const html = `<html><body>
    <div class="chapter-tree-74" id="scrollbox">
      <div class="child-info hasvideo current"><span class="child-name" title="1.1 A">1.1 A</span><i class="child-check"></i></div>
      <div class="child-info hasvideo"><span class="child-name" title="1.2 B">1.2 B</span></div>
      <div class="child-info hasvideo"><span class="child-name" title="1.3 C">1.3 C</span></div>
    </div>
    <video></video>
  </body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=vr1');
  const C = win.ZHS.Catalog;
  eq('识别为 wisdom', C.adapter.name, 'wisdom');
  eq('初始仅渲染 3 节', C.items().length, 3);

  // 把 1.2/1.3 标成已完成，使第一轮 findNext 找不到未完成节 → 触发懒加载补全
  C.items()[1].insertAdjacentHTML('beforeend', '<i class="child-check"></i>');
  C.items()[2].insertAdjacentHTML('beforeend', '<i class="child-check"></i>');

  // 桩：模拟懒加载——容器 scrollTop 被推到底时，向 DOM 注入剩余 3 节
  let injected = false;
  C._scrollContainers = function () {
    return [{
      get scrollHeight() { return 1000; },
      get clientHeight() { return 100; },
      get scrollTop() { return 0; },
      set scrollTop(v) {
        if (!injected) {
          injected = true;
          const tree = win.document.querySelector('.chapter-tree-74');
          ['1.4 D', '1.5 E', '1.6 F'].forEach((t) => {
            const d = win.document.createElement('div');
            d.className = 'child-info hasvideo';
            d.innerHTML = '<span class="child-name" title="' + t + '">' + t + '</span>';
            tree.appendChild(d);
          });
        }
      },
    }];
  };

  // 第一轮（1.1~1.3 都已完成）找不到 → ensureCatalogLoaded 注入后 → 第二轮找到 1.4
  const next = C.findNext(C.current());
  eq('虚拟滚动补全后找到 1.4', C.itemTitle(next), '1.4 D');
  eq('补全后可从 1.4 继续找到 1.5', C.itemTitle(C.findNext(next)), '1.5 E');

  // 切课缓存重置
  C.resetCatalogCache();
  eq('resetCatalogCache 清空加载缓存', C._catalogLoaded, false);
}

console.log('\n=== 32c. ensureCatalogLoaded 安全降级 ===');
{
  const { win } = makeEnv(
    '<html><body><div class="child-info hasvideo current"><span class="child-name" title="x">x</span></div><video></video></body></html>',
    'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=safe'
  );
  const C = win.ZHS.Catalog;
  // 无滚动容器（jsdom 无布局，scrollHeight/clientHeight 恒 0）→ 不应抛错，且应直接标记完成
  let threw = false;
  try { C.ensureCatalogLoaded(); } catch (e) { threw = true; }
  ok('无布局环境下 ensureCatalogLoaded 不抛错', !threw);
  eq('无布局环境直接标记 _catalogLoaded', C._catalogLoaded, true);
}

console.log('\n=== 32d. bindVideo 强制重绑（round-6 修复） ===');
{
  const { win } = makeEnv('<html><body><video></video></body></html>', 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=cA');
  const R = win.ZHS.Resume;
  win.ZHS.setConfig({ resume: true, saveIntervalMs: 1000 });
  const v = win.document.querySelector('video');
  // 第一次绑定到课程 cA / 节 A1
  R.bindVideo(v, 'cA', 'A1');
  // 模拟 SPA 切课：复用同一个 <video> DOM 节点（只换 src），切到课程 cB / 节 B1
  R.bindVideo(v, 'cB', 'B1');
  eq('切课后绑定课程更新为 cB', R._boundCourse, 'cB');
  eq('切课后绑定课时更新为 B1', R._boundLesson, 'B1');
  // 推进进度并触发一次 pause，进度应写到新课程 cB 而非旧课 cA
  v.currentTime = 50; v.duration = 100;
  v.dispatchEvent(new win.Event('pause'));
  const recB = R.load('cB');
  ok('进度记录写入新课程 cB（lessonKey=B1）', !!recB && recB.lessonKey === 'B1');
  const recA = R.load('cA');
  ok('旧课程 cA 未被错误写入', !recA);
}

console.log('\n=== 32e. 弹题选项选择器覆盖（round-6 修复） ===');
{
  const html = `<html><body>
    <div id="playTopic-dialog">
      <div class="topic-title">1+1=?</div>
      <div class="answerOption"><label>A. 2</label></div>
      <div class="answerOption"><label>B. 3</label></div>
      <div class="el-radio"><label>C. 4</label></div>
    </div>
    <video></video>
  </body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=opt1');
  const dlg = win.document.querySelector('#playTopic-dialog');
  const q = win.ZHS.Questions.Dialog.readCurrent(dlg);
  eq('提取到 3 个选项（含 .answerOption / .el-radio）', q.options.length, 3);
  eq('选项文本取 .answerOption label', q.options[0], 'A. 2');
  ok('返回 node 字段（填空题在弹题容器内定位输入框）', !!q.node);
}

console.log('\n=== 32f. 同名节不误判 + 当前项收窄（round-15 D1/D3） ===');
const _dupname = (async () => {
  // 目录里两节同名（智慧树「习题讲解」很常见），第一节是当前项
  const html = `<html><body>
    <div class="chapter-tree-74">
      <div class="child-info hasvideo current"><span class="child-name">习题讲解</span></div>
      <div class="child-info hasvideo"><span class="child-name">习题讲解</span></div>
    </div>
    <video></video>
  </body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?courseId=dup1');
  const cat = win.ZHS.Catalog;
  const list = cat.items();
  eq('识别到 2 个同名节', list.length, 2);

  // 当前项应是第一节（按身份），而不是靠标题撞运气
  const cur = cat.current();
  ok('current() 命中的是第一节（身份而非标题）', cur === list[0],
    cur === list[1] ? '误命中第二节' : String(!!cur));

  // D1 核心：目标=第二节时，不应因为标题同名就判成「已切到」
  const tgt = list[1];
  // 模拟：把第一节重新标为 current（等于没切过去），目标仍是第二节
  list[1].classList.remove('current');
  list[0].classList.add('current');
  // 用 clickAndVerify 的 fromKey 传第一节标题，目标是第二节 → 应判失败（未切）
  const switched = await cat.clickAndVerify(tgt, { timeout: 120, tries: 1, fromKey: '习题讲解' });
  eq('同名节且未真正切换 → 判为失败（不假成功）', switched, false);
})();

console.log('\n=== 32g. Element UI 弹窗识别 + .el-radio 选项读取（round-17 修复） ===');
const _abDialog = (async () => {
  // 用户反馈的弹窗形态：Element UI .el-dialog，「选对才能关」的 A/B 二选一简单题。
  // 关键点：class 里没有 topic-dialog 子串，题干/选项都在 Element UI 自己的结构里。
  // 结构严格照 Element UI 真实 DOM 写：label.el-radio > span.el-radio__input > input.el-radio__original
  //                                             + span.el-radio__label（选项文字）
  const html = `<html><body>
    <div class="el-dialog__wrapper">
      <div class="el-dialog" style="width:520px">
        <div class="el-dialog__header">
          <span class="el-dialog__title">课中答题</span>
          <button class="el-dialog__headerbtn"><i class="el-dialog__close"></i></button>
        </div>
        <div class="el-dialog__body">
          <div class="question-topic">下列说法是否正确：智慧树课程可以倍速播放。</div>
          <label class="el-radio">
            <span class="el-radio__input"><input class="el-radio__original" type="radio" name="ab"></span>
            <span class="el-radio__label">A. 说法正确</span>
          </label>
          <label class="el-radio">
            <span class="el-radio__input"><input class="el-radio__original" type="radio" name="ab"></span>
            <span class="el-radio__label">B. 说法错误</span>
          </label>
        </div>
        <div class="el-dialog__footer">
          <button>关闭</button>
        </div>
      </div>
    </div>
    <video></video>
  </body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=abd1');
  const Z = win.ZHS;
  const D = Z.Questions.Dialog;

  // 1) 识别链路：.el-dialog 容器必须被 root() 命中（修复前返回 null，整条答题链路不可达）
  const elDlg = win.document.querySelector('.el-dialog');
  ok('root() 命中 .el-dialog 容器', D.root() === elDlg,
    D.root() ? '命中了 ' + D.root().className : '返回 null');
  eq('present() 对 Element UI A/B 弹窗返回 true', D.present(), true);
  eq('scene() 返回 dialog', Z.Questions.scene(), 'dialog');
  // 共享常量必须与调度器同源（两处不同步 = 守卫挡掉答题链路）
  eq('ZHS.Const.QUESTION_SELECTORS 含 .el-dialog', /\.el-dialog/.test(Z.Const.QUESTION_SELECTORS), true);

  // 2) 题干与选项读取
  const q = D.readCurrent(elDlg);
  ok('从 .el-dialog__body .question-topic 读到题干', q.title.indexOf('智慧树课程可以倍速播放') >= 0,
    JSON.stringify(q.title));
  eq('选项数量为 2（不重复）', q.options.length, 2, JSON.stringify(q.options));
  eq('选项 A 文本取 .el-radio__label', q.options[0], 'A. 说法正确');
  eq('选项 B 文本取 .el-radio__label', q.options[1], 'B. 说法错误');
  eq('elementList 与 options 一一对应（可按下标点击）', q.elementList.length, 2);
  ok('elementList[0] 是 .el-radio 元素本身', q.elementList[0].classList.contains('el-radio'));
  eq('题型推断为判断/单选（两个选项）', q.type === 'judgement' || q.type === 'single', true);
})();

// 同名选项文本重复出现时（选择器重叠产生重影）必须去重成 2 个，否则索引会点错位置
console.log('\n=== 32h. 选项选择器重叠去重（round-17 修复） ===');
const _abDedupe = (async () => {
  // 旧选择器同时写 `.el-radio` 与 `.radio > label`，且 Element UI 外层 label 自带 .radio 类时，
  // querySelectorAll 会返回 [A,B,A,B]；这里显式构造这种「同一个选项被两条路径命中」的极端 DOM。
  const html = `<html><body>
    <div id="playTopic-dialog">
      <div class="topic-title">下列哪个是正确答案？</div>
      <ul>
        <li class="topic-item">A. 选项一</li>
        <li class="topic-item">B. 选项二</li>
      </ul>
      <div class="el-radio"><label>A. 选项一</label></div>
      <div class="el-radio"><label>B. 选项二</label></div>
    </div>
    <video></video>
  </body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=abd2');
  const q = win.ZHS.Questions.Dialog.readCurrent(win.document.querySelector('#playTopic-dialog'));
  eq('文本去重后只剩 2 个选项', q.options.length, 2, JSON.stringify(q.options));
  eq('保留的是 ul .topic-item 里的 A', q.options[0], 'A. 选项一');
  eq('保留的是 ul .topic-item 里的 B', q.options[1], 'B. 选项二');
  eq('elementList 同步去重', q.elementList.length, 2);
})();

// 回归：collect() 的 title 是作答去重签名，必须能读出 Element UI 弹窗题面。
// 若读空，每道 .el-dialog 题签名都是 '[""]' → 答完第一道后其余弹题全被误判「已作答」跳过。
console.log('\n=== 32i. 弹题去重签名可区分不同题（round-17 回归） ===');
const _abSig = (async () => {
  const mk = (t) => `<html><body>
    <div class="el-dialog__wrapper"><div class="el-dialog"><div class="el-dialog__body">
      <div class="question-topic">${t}</div>
      <label class="el-radio"><span class="el-radio__label">A. 对</span></label>
      <label class="el-radio"><span class="el-radio__label">B. 错</span></label>
    </div></div></div><video></video></body></html>`;
  const e1 = makeEnv(mk('题目一：倍速播放可否'), 'https://studyvideoh5.zhihuishu.com/stuStudy?sig=1');
  const snap1 = e1.win.ZHS.Questions.Dialog.collect();
  ok('collect() 能读出 Element UI 弹窗题面（非空）', !!snap1.length && !!snap1[0].title,
    JSON.stringify(snap1.map((s) => s.title)));
  eq('collect() 同步读出选项', snap1[0].options.length, 2);
  const sig1 = JSON.stringify(snap1.map((s) => s.title)).slice(0, 200);
  const sigEmpty = JSON.stringify(['']);
  ok('签名不是空签名（空签名会让后续弹题被误跳过）', sig1 !== sigEmpty, sig1);

  const e2 = makeEnv(mk('题目二：完全不同的一道题'), 'https://studyvideoh5.zhihuishu.com/stuStudy?sig=2');
  const snap2 = e2.win.ZHS.Questions.Dialog.collect();
  const sig2 = JSON.stringify(snap2.map((s) => s.title)).slice(0, 200);
  ok('两道不同弹题签名不同（第二道不会被当成已作答跳过）', sig1 !== sig2, sig1 + ' vs ' + sig2);
})();

// 回归：handleDialog 的守卫必须同时看「总分开关 autoAnswer」与「课中弹题子开关 answerDialog」。
// 只查总开关时，任何绕开调度器守卫的新调用点都会在用户关掉子开关后仍然自动答题。
//
// 断言口径说明：jsdom 不实现真实 radio 的选中行为，`Filler.isChecked` 在无桩环境下恒 false，
// 因此不能用 answeredCount 判断「有没有进入答题流程」。改用可观测的日志判据：
// 被守卫拦下时**不会**出现「检测到课中弹题，开始自动作答」；越过守卫进入流程时一定会出现。
console.log('\n=== 32j. 弹题自动答题双开关守卫（round-17 回归） ===');
const _abGuard = (async () => {
  const html = `<html><body>
    <div class="el-dialog__wrapper"><div class="el-dialog"><div class="el-dialog__body">
      <div class="question-topic">开关守卫测试题</div>
      <label class="el-radio"><span class="el-radio__label">A. 对</span></label>
      <label class="el-radio"><span class="el-radio__label">B. 错</span></label>
    </div></div></div><video></video></body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?guard=1');
  const Z = win.ZHS;
  Z.setConfig({ bankEnabled: false, llmEnabled: false, debug: false });
  Z.Solver.solve = async () => ({ answer: 'A', from: 'bank:stub' });
  Z.state.running = true;

  const logs = [];
  const oi = Z.Log.info.bind(Z.Log);
  Z.Log.info = (...a) => { logs.push(a.join(' ')); return oi(...a); };
  const entered = () => logs.filter((l) => l.indexOf('开始自动作答') >= 0).length;

  // ① 总开关开、子开关关 → 必须不进入答题流程
  Z.setConfig({ autoAnswer: true, answerDialog: false });
  Z.Answerer._answerDialog = Z.Answerer._answerDialog.bind(Z.Answerer);
  await Z.Answerer.handleDialog({ manual: false });
  eq('answerDialog=false 时不进入作答流程（子开关生效）', entered(), 0);

  // ② 总开关关、子开关开 → 必须不进入答题流程
  Z.setConfig({ autoAnswer: false, answerDialog: true });
  await Z.Answerer.handleDialog({ manual: false });
  eq('autoAnswer=false 时不进入作答流程（总开关生效）', entered(), 0);

  // ③ 两个都开 → 应当进入作答流程
  Z.setConfig({ autoAnswer: true, answerDialog: true });
  Z.Answerer._cooldownUntil = 0;
  await Z.Answerer.handleDialog({ manual: false });
  ok('两个开关都为真时进入作答流程', entered() >= 1, '未进入（守卫拦得过头了）');

  // ④ 手动触发 → 绕过配置（用户点了按钮就要答）
  Z.setConfig({ autoAnswer: false, answerDialog: false });
  Z.Answerer._cooldownUntil = 0;
  Z.Answerer._giveUpSigs = new Set();
  Z.Answerer._answeredSig = '';
  const beforeManual = entered();
  await Z.Answerer.handleDialog({ manual: true });
  ok('manual=true 时绕过两个开关（用户主动点「答题」即作答）',
    entered() > beforeManual, '手动触发被守卫拦下了');
})();

// ★ 核心回归（round-18 P1）：按钮式 A/B 弹窗（选项是 button、无 .el-radio）必须能真正调 Solver.solve。
// 上轮 316/0 全绿却功能未实现，根因就是没有这条断言 —— 进入 _tryNonStandardAB 的条件
// 与第一段入口条件互斥，真求解成了死代码。这条测试专门盯住「solve 有没有被调用」。
//
// 【本条覆盖范围说明（round-19 补充）】本段**直接调用 `_tryNonStandardAB`**，
// 刻意绕过 _answerDialog 的路由层，用于锁死「该函数内部第一段可达」这一件事。
// 「真实入口 handleDialog 下的路由是否正确」由下面 32p / 32q 两段覆盖 —— 两者互补，不要混淆。
console.log('\n=== 32k. A/B 弹窗真求解可达（round-18 P1 死代码回归；直接调用 _tryNonStandardAB） ===');
const _abSolveReachable = (async () => {
  // 关键：选项是 <button>，没有 .el-radio / .el-checkbox → 旧 readCurrent().options 为空，
  // 只有走 _tryNonStandardAB 这条链；且必须由 readOptions 的宽口径通道读出 2 个选项。
  const html = `<html><body>
    <div class="el-dialog__wrapper"><div class="el-dialog">
      <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
      <div class="el-dialog__body">
        <div class="el-dialog__title">按钮AB题</div>
        <button class="option-btn">A. 说法正确</button>
        <button class="option-btn">B. 说法错误</button>
      </div>
      <div class="el-dialog__footer"><button>关闭</button></div>
    </div></div>
    <video></video>
  </body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?absolve=1');
  const Z = win.ZHS;
  Z.setConfig({ bankEnabled: false, llmEnabled: false, debug: false });
  // 停掉主循环：否则调度器守卫会并发调用 handleDialog，把 answeredCount 多加一次
  // （这是测试环境串扰，不是被测逻辑的问题；真实运行时守卫与本题走的是同一把 _running 锁）
  if (Z.Scheduler && Z.Scheduler.stop) Z.Scheduler.stop('user');
  Z.Answerer._running = false;
  Z.state.running = true;

  // 统计 solve 调用次数 + 记录传入的题干/选项
  const solveCalls = [];
  Z.Solver.solve = async (req) => {
    solveCalls.push(req);
    return { answer: 'B', from: 'bank:stub' };
  };
  // 桩：让 button 点击后带 is-checked 类，模拟真实选中自检通过
  const btns = Array.from(win.document.querySelectorAll('.option-btn'));
  for (const b of btns) {
    b.addEventListener('click', function () { this.classList.add('is-checked'); });
  }
  // 桩：选中任一选项后关闭按钮才生效（模拟「选对才能关」）
  win.document.querySelector('.el-dialog__footer button').addEventListener('click', () => {
    if (win.document.querySelector('.option-btn.is-checked')) {
      win.document.querySelector('.el-dialog__wrapper').remove();
    }
  });

  const root = Z.Questions.Dialog.root();
  ok('root() 命中按钮式 A/B 弹窗', !!root, root ? root.className : 'null');

  // readCurrent().options 此时可能为空（按钮不是 .el-radio）——正是 P1 描述的场景
  const rc = Z.Questions.Dialog.readCurrent(root);
  // readOptions 必须能独立读出 2 个选项（这是 P1 修复的关键能力）
  const ro = Z.Questions.Dialog.readOptions(root);
  eq('readOptions 独立读出 2 个按钮选项', ro.texts.length, 2, JSON.stringify(ro.texts));
  ok('readOptions 读出 A/B 文本', /A\./.test(ro.texts[0]) && /B\./.test(ro.texts[1]),
    JSON.stringify(ro.texts));

  Z.Answerer._giveUpSigs = new Set();
  Z.Answerer._countedSig = '';
  const beforeCount = Z.state.answeredCount;
  await Z.Answerer._tryNonStandardAB(root, 'sig-solve');

  // ★ 最关键断言：真求解必须被实际调用（上轮这里是 0）
  ok('★ Solver.solve 被实际调用（≥1 次，P1 死代码已修）', solveCalls.length >= 1,
    'solve 调用次数 = ' + solveCalls.length);
  eq('★ solve 收到的题干非空', !!solveCalls.length && !!solveCalls[0].title, true);
  eq('★ solve 收到的选项数为 2', solveCalls.length ? solveCalls[0].options.length : 0, 2);
  ok('★ 答案 B 被按索引正确点击并自检通过（answeredCount +1）',
    Z.state.answeredCount === beforeCount + 1,
    'answeredCount ' + beforeCount + ' → ' + Z.state.answeredCount);
  ok('★ 选对后弹窗被关闭（不再只能靠猜）',
    !win.document.querySelector('.el-dialog'), '弹窗仍在');
})();

// 多 .el-dialog 并存时必须选中「含题目特征」的那个（round-18 P2-1）
console.log('\n=== 32l. 多弹窗并存选对容器（round-18 P2-1） ===');
const _abMultiDialog = (async () => {
  const html = `<html><body>
    <div class="el-dialog__wrapper"><div class="el-dialog" id="settingsDlg">
      <div class="el-dialog__header"><span class="el-dialog__title">设置</span></div>
      <div class="el-dialog__body"><label>音量</label><label>速度</label></div>
    </div></div>
    <div class="el-dialog__wrapper"><div class="el-dialog" id="topicDlg">
      <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
      <div class="el-dialog__body">
        <div class="question-topic">多选题干</div>
        <label class="el-radio"><span class="el-radio__label">A. 对</span></label>
        <label class="el-radio"><span class="el-radio__label">B. 错</span></label>
      </div>
    </div></div>
    <video></video>
  </body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?multi=1');
  const D = win.ZHS.Questions.Dialog;
  // 设置窗排在前面，但只有第二个含题目特征 → 必须选中第二个
  eq('root() 选中有题目特征的弹窗（跳过设置窗）', D.root() && D.root().id, 'topicDlg');
  eq('present() 对含题弹窗返回 true', D.present(), true);
  const q = D.readCurrent(D.root());
  eq('读到的是题面（不是"设置"）', q.title, '多选题干');
  eq('读到 2 个选项', q.options.length, 2);
})();

// 题干相同、选项不同的两道弹窗，签名必须不同（round-18 P2-2）
console.log('\n=== 32m. 题干相同选项不同 → 签名可区分（round-18 P2-2） ===');
const _abSigWithOptions = (async () => {
  const mk = (optA, optB) => `<html><body>
    <div class="el-dialog__wrapper"><div class="el-dialog">
      <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
      <div class="el-dialog__body">
        <label class="el-radio"><span class="el-radio__label">${optA}</span></label>
        <label class="el-radio"><span class="el-radio__label">${optB}</span></label>
      </div>
    </div></div><video></video></body></html>`;
  const e1 = makeEnv(mk('A. 说法一', 'B. 说法二'), 'https://studyvideoh5.zhihuishu.com/stuStudy?so1=1');
  const e2 = makeEnv(mk('A. 说法三', 'B. 说法四'), 'https://studyvideoh5.zhihuishu.com/stuStudy?so2=1');
  // 复刻 handleDialog 的签名算法（题干 + '|' + 选项文本）
  const mkSig = (w) => {
    const snap = w.ZHS.Questions.Dialog.collect();
    return JSON.stringify(snap.map((s) => (s.title || '') + '|' + ((s.options || []).join(',')))).slice(0, 200);
  };
  const s1 = mkSig(e1.win);
  const s2 = mkSig(e2.win);
  ok('两份弹窗题干相同（都是"课中答题"或同源标题）', true, s1);
  ok('★ 题干相同但选项不同 → 签名不同（第二道不会被误判已作答）', s1 !== s2, s1 + ' vs ' + s2);
  ok('★ 签名包含选项文本', s1.indexOf('说法一') >= 0, s1);
})();

// .el-dialog__wrapper 用 inline display:none 时（Element UI 真实关闭形态）必须判为已关闭
console.log('\n=== 32n. inline display:none 判为已关闭（round-18 P2-3） ===');
const _abWrapperHidden = (async () => {
  const html = `<html><body>
    <div class="el-dialog__wrapper"><div class="el-dialog">
      <div class="el-dialog__body"><div class="question-topic">题面</div>
        <label class="el-radio"><span class="el-radio__label">A. 对</span></label>
        <label class="el-radio"><span class="el-radio__label">B. 错</span></label>
      </div>
    </div></div><video></video></body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?hid=1');
  const D = win.ZHS.Questions.Dialog;
  eq('隐藏前 present() = true', D.present(), true);
  // Element UI 关闭弹窗的真实形态之一：给 wrapper 打 inline display:none
  win.document.querySelector('.el-dialog__wrapper').style.display = 'none';
  eq('★ wrapper inline display:none → present() = false', D.present(), false);
  eq('★ wrapper inline display:none → stillPresent() = false', D.stillPresent(), false);
  eq('★ root() 返回 null（不会拿到已关闭的弹窗）', D.root(), null);

  // visibility:hidden 同样要认
  win.document.querySelector('.el-dialog__wrapper').style.display = '';
  win.document.querySelector('.el-dialog__wrapper').style.visibility = 'hidden';
  eq('wrapper inline visibility:hidden → present() = false', D.present(), false);
})();

// .el-radio__label 存在但为空时，不能产生 [""] 这种空选项（round-18 P3-1）
console.log('\n=== 32o. 空 __label 不产生空选项（round-18 P3-1） ===');
const _abEmptyLabel = (async () => {
  const html = `<html><body>
    <div class="el-dialog__wrapper"><div class="el-dialog">
      <div class="el-dialog__body">
        <div class="question-topic">题面</div>
        <label class="el-radio"><span class="el-radio__input"><input type="radio" name="r"></span>
          <span class="el-radio__label"></span><span class="txt">A. 说法正确</span></label>
        <label class="el-radio"><span class="el-radio__input"><input type="radio" name="r"></span>
          <span class="el-radio__label"></span><span class="txt">B. 说法错误</span></label>
      </div>
    </div></div><video></video></body></html>`;
  const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy=el=1');
  const q = win.ZHS.Questions.Dialog.readCurrent(win.document.querySelector('.el-dialog'));
  eq('★ 选项数仍为 2（不因空 __label 被合并成 1）', q.options.length, 2, JSON.stringify(q.options));
  ok('★ 选项文本非空（退回整个元素取文本）',
    !!q.options[0] && !!q.options[1] && q.options.join('').indexOf('说法') >= 0,
    JSON.stringify(q.options));
  ok('★ 不产生 [""] 空选项', !(q.options.length === 1 && q.options[0] === ''),
    JSON.stringify(q.options));
})();

// ★ round-19 P1 回归（方案 A 正则放宽）：从**真实入口 handleDialog** 发起，
// 覆盖三种上轮读不到选项的形态 —— 纯 A/B、中文序号选项、无关键字长句选项。
// 上轮正则是 `[abAB][分隔符]?\s`（`\s` 必需）→ 这三种 texts=[] → solve=0 → 仍只乱猜。
console.log('\n=== 32p. handleDialog 入口：三种难形态必须真求解（round-19 P1 方案A） ===');
const _abEntryForms = (async () => {
  // 每种形态单独一个环境，统计 handleDialog（真实入口）下的 solve 调用
  const runCase = async (label, optTexts, extraBody) => {
    const btns = optTexts.map((t) => `<button class="opt">${t}</button>`).join('');
    const html = `<html><body>
      <div class="el-dialog__wrapper"><div class="el-dialog">
        <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
        <div class="el-dialog__body"><div class="question-topic">题干</div>${btns}${extraBody || ''}</div>
        <div class="el-dialog__footer"><button>关闭</button></div>
      </div></div><video></video></body></html>`;
    const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?p=' + encodeURIComponent(label));
    const Z = win.ZHS;
    Z.setConfig({ bankEnabled: false, llmEnabled: false, debug: false });
    if (Z.Scheduler && Z.Scheduler.stop) Z.Scheduler.stop('user');   // 防调度器并发污染计数
    Z.Answerer._running = false;
    Z.state.running = true;

    const solveCalls = [];
    Z.Solver.solve = async (req) => { solveCalls.push(req); return { answer: 'B', from: 'stub' }; };
    const optEls = Array.from(win.document.querySelectorAll('.opt'));
    for (const b of optEls) b.addEventListener('click', function () { this.classList.add('is-checked'); });
    win.document.querySelector('.el-dialog__footer button').addEventListener('click', () => {
      if (win.document.querySelector('.opt.is-checked')) win.document.querySelector('.el-dialog__wrapper').remove();
    });

    // 先记录「实际路由」：readCurrent().options 非空 → 走标准链；为空 → 走 _tryNonStandardAB
    const routeOpts = (Z.Questions.Dialog.readCurrent(Z.Questions.Dialog.root()).options || []).length;
    Z.Answerer._giveUpSigs = new Set();
    Z.Answerer._countedSig = '';
    await Z.Answerer.handleDialog({ manual: true });

    const clicked = optEls.map((b) => Z.Filler.isChecked(b));
    return { solveCalls, routeOpts, clicked, closed: !win.document.querySelector('.el-dialog') };
  };

  // ① 纯 A / B（无点号、无空格）—— 上轮实测 readOptions=[] solve=0
  const c1 = await runCase('pureAB', ['A', 'B']);
  eq('① 纯 A/B：solve 被调用 ≥1（handleDialog 入口）', c1.solveCalls.length >= 1, true);
  ok('① 纯 A/B：答案 B 对应元素被点击选中', c1.clicked[1] === true, JSON.stringify(c1.clicked));
  ok('① 纯 A/B：选对后弹窗关闭', c1.closed, '弹窗仍在');
  ok('① 纯 A/B：实际路由 = ' + (c1.routeOpts >= 2 ? '标准链' : '_tryNonStandardAB'), true,
    'readCurrent().options.length=' + c1.routeOpts);

  // ② 中文序号选项（无 A/B 关键字）—— 上轮实测 readOptions=[] solve=0
  const c2 = await runCase('cnOrder', ['选项一', '选项二']);
  eq('② 选项一/选项二：solve 被调用 ≥1（handleDialog 入口）', c2.solveCalls.length >= 1, true);
  ok('② 选项一/选项二：答案 B 对应元素被点击选中', c2.clicked[1] === true, JSON.stringify(c2.clicked));
  ok('② 选项一/选项二：实际路由 = ' + (c2.routeOpts >= 2 ? '标准链' : '_tryNonStandardAB'), true,
    'readCurrent().options.length=' + c2.routeOpts);

  // ③ 无关键字长句选项 —— 上轮实测 readOptions=[] solve=0
  const c3 = await runCase('longText', ['这是一句很长的选项描述甲', '这是一句很长的选项描述乙']);
  eq('③ 长句选项：solve 被调用 ≥1（handleDialog 入口）', c3.solveCalls.length >= 1, true);
  ok('③ 长句选项：答案 B 对应元素被点击选中', c3.clicked[1] === true, JSON.stringify(c3.clicked));
  ok('③ 长句选项：实际路由 = ' + (c3.routeOpts >= 2 ? '标准链' : '_tryNonStandardAB'), true,
    'readCurrent().options.length=' + c3.routeOpts);
})();

// 正则逐串断言（方案 A）：把匹配结果锁进测试，防止将来手滑把 \s 改回必需
console.log('\n=== 32q. 选项文本正则边界（round-19 P1 方案A 逐串） ===');
{
  // 直接从页面里取实际生效的正则（`_optionTextRe()` 是只读暴露）。
  // 注意：**不能**通过 readOptions 反推 —— 那会经过方案B「结构对称」兜底通道，
  // 把 "Apple" 这类非选项文本也捡回来，正则可放宽/漏报就测不出来了。
  const { win } = makeEnv('<html><body><div class="el-dialog__wrapper"><div class="el-dialog"></div></div></body></html>',
    'https://studyvideoh5.zhihuishu.com/stuStudy');
  const RE = win.ZHS.Questions.Dialog._optionTextRe();
  const hit = (t) => RE.test(t);
  // 必须命中（上轮 \s 必需导致前 4 个 false）
  eq('"A" 命中', hit('A'), true);
  eq('"A." 命中', hit('A.'), true);
  eq('"A.对" 命中', hit('A.对'), true);
  eq('"A、对" 命中', hit('A、对'), true);
  eq('"A 说法" 命中', hit('A 说法'), true);
  eq('"A. 说法" 命中（原有形态不回归）', hit('A. 说法'), true);
  // 必须不命中（防误报）
  eq('"Apple" 不命中', hit('Apple'), false);
  eq('"A组" 不命中', hit('A组'), false);
  eq('"AB" 不命中', hit('AB'), false);
}

// ★ round-20 真 P1 回归（方案 C 结构对称自动发现）：自定义 class / 裸 div·span·p 选项
// 根因：方案 A 与方案 B **共用同一个 `candidates`**，而它由 WIDE 选择器产出；
// 只要选项是「纯 div/span/p + 自定义 class」（.opt-item / .answer-item / .xx-option / 裸 <p>），
// WIDE 命中 0 → 两条通道同时空转 → 读不到选项 → solve=0 → 又只乱猜。
// 本段全部从真实入口 `handleDialog` 发起（不直接调 readOptions，避免绕过路由层）。
console.log('\n=== 32r. 自定义 class / 裸元素选项：方案C 结构自动发现（round-20 真P1） ===');
const _abAutoSiblings = (async () => {
  // 让每种形态各自渲染选项 DOM；optsHtml 直接给出选项的 HTML 片段
  const runCase = async (label, optsHtml, titleHtml) => {
    const html = `<html><body>
      <div class="el-dialog__wrapper"><div class="el-dialog">
        <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
        <div class="el-dialog__body">
          <div class="q-title">${titleHtml || '题干'}</div>
          ${optsHtml}
        </div>
        <div class="el-dialog__footer"><button>关闭</button></div>
      </div></div><video></video></body></html>`;
    const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?p=' + encodeURIComponent(label));
    const Z = win.ZHS;
    Z.setConfig({ bankEnabled: false, llmEnabled: false, debug: false });
    if (Z.Scheduler && Z.Scheduler.stop) Z.Scheduler.stop('user');
    Z.Answerer._running = false;
    Z.state.running = true;

    const solveCalls = [];
    Z.Solver.solve = async (req) => { solveCalls.push(req); return { answer: 'B', from: 'stub' }; };

    // ★ 关键：spy 住 Filler.clickOption 的实参 —— 记录「真正被点的是哪几个元素/什么文本」。
    // 必须包住原实现（不是替换），否则点击态挂不上、关闭逻辑失效。
    const clickArgs = [];
    const _origClickOption = Z.Filler.clickOption.bind(Z.Filler);
    Z.Filler.clickOption = function (el) {
      const t = el ? (el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent) : '';
      clickArgs.push(String(t || '').trim());
      return _origClickOption(el);
    };

    // 给「可点击选项元素」挂上点击→选中态（用方案C 会返回的那批元素）
    const r0 = Z.Questions.Dialog.root();
    const D = Z.Questions.Dialog;
    const t0 = Date.now();
    const ro = D.readOptions(r0);
    const costMs = Date.now() - t0;
    const optEls = ro.elements;
    for (const el of optEls) {
      el.addEventListener('click', function () { this.setAttribute('data-checked', '1'); });
    }
    // 关闭按钮：只要有点选中的选项就关
    win.document.querySelector('.el-dialog__footer button').addEventListener('click', () => {
      if (win.document.querySelector('[data-checked]')) win.document.querySelector('.el-dialog__wrapper').remove();
    });

    const routeOpts = (Z.Questions.Dialog.readCurrent(Z.Questions.Dialog.root()).options || []).length;
    Z.Answerer._giveUpSigs = new Set();
    Z.Answerer._countedSig = '';
    await Z.Answerer.handleDialog({ manual: true });

    const clicked = optEls.map((el) => el.getAttribute('data-checked') === '1');
    return { solveCalls, routeOpts, clicked, texts: ro.texts, costMs, clickArgs,
      closed: !win.document.querySelector('.el-dialog') };
  };

  // ① <div class="opt-list"><div class="opt-item">×2  —— 自定义 class div
  const c1 = await runCase('optItem',
    '<div class="opt-list"><div class="opt-item">选项一的内容</div><div class="opt-item">选项二的内容</div></div>');
  eq('① .opt-item：读到 2 个选项', c1.texts.length, 2);
  eq('① .opt-item：solve 被调用 1 次（handleDialog 入口）', c1.solveCalls.length, 1);
  ok('① .opt-item：答案 B 被点选', c1.clicked[1] === true, JSON.stringify(c1.clicked));

  // ② <span class="answer-item">×2 —— 自定义 class span
  const c2 = await runCase('answerItem',
    '<div><span class="answer-item">甲说法</span><span class="answer-item">乙说法</span></div>');
  eq('② .answer-item：读到 2 个选项', c2.texts.length, 2);
  eq('② .answer-item：solve 被调用 1 次', c2.solveCalls.length, 1);

  // ③ 裸 <p>×2 —— 无 class 无白名单
  const c3 = await runCase('plainP',
    '<div><p>说法一</p><p>说法二</p></div>');
  eq('③ 裸 <p>：读到 2 个选项', c3.texts.length, 2);
  eq('③ 裸 <p>：solve 被调用 1 次', c3.solveCalls.length, 1);

  // ④ 负例：题干内的关键词 span 组不得被当选项（父节点含直接文本 → 排除）
  const c4 = await runCase('kwNeg',
    '<div class="opt-list"><div class="opt-item">选项一的内容</div><div class="opt-item">选项二的内容</div></div>',
    '以下哪项不是 <span class="kw">TCP</span> <span class="kw">UDP</span> <span class="kw">HTTP</span> 的特点？');
  eq('④ 负例 题干内 kw 组：仍读到 2 个选项（未被 3 个 kw 顶掉）', c4.texts.length, 2);
  ok('④ 负例：读到的不是 kw 关键词', c4.texts.indexOf('TCP') < 0 && c4.texts.indexOf('UDP') < 0,
    JSON.stringify(c4.texts));

  // ⑤ 负例：页脚按钮组（全操作词）不得被当选项
  const c5 = await runCase('actionNeg',
    '<div><button>关闭</button><button>提交</button></div>');
  eq('⑤ 负例 操作词组：不得被当选项', c5.texts.length, 0);
  eq('⑤ 负例 操作词组：solve 不被调用', c5.solveCalls.length, 0);

  // ⑥ 选项与题干容器「平级」（都是 .el-dialog__body 的直接子 div）—— 自定义 class
  // 这条防的是「只按 tagName 分组」的退化：`<div class="q-title">题干</div>` 会混进
  // 两个 .xx-option 凑成 3 个不同 class 的 DIV，整组被否 → 命中 0。
  // 必须按「tag + class」分组，两个 .xx-option 才自成一组。
  const c6 = await runCase('siblingOpt',
    '<div class="xx-option">甲说法</div><div class="xx-option">乙说法</div>');
  eq('⑥ 平级自定义 class：读到 2 个选项', c6.texts.length, 2);
  eq('⑥ 平级自定义 class：solve 被调用 1 次', c6.solveCalls.length, 1);

  // ⑦ 关键回归（能证伪）：混合组「2 真选项 + 2 导航词」必须只留 2 个真选项，
  //    且 Filler.clickOption 的实参文本不得出现「上一题」「下一题」。
  //    旧代码 `.every(操作词)` 只挡「全员皆操作词」，混合组直接放行 → texts 被污染成 4 项 →
  //    Solver 拿 4 项解题 → clickOption 真点到「下一题」（真实平台会切页/交卷）。
  const c7 = await runCase('mixedNav',
    '<div class="list"><div class="option">选项一</div><div class="option">选项二</div><div class="option">上一题</div><div class="option">下一题</div></div>');
  eq('⑦ 混合组 2选项+2导航词：texts 必须只剩 2 个', c7.texts.length, 2);
  ok('⑦ 混合组：texts 不含 上一题/下一题', c7.texts.indexOf('上一题') < 0 && c7.texts.indexOf('下一题') < 0,
    JSON.stringify(c7.texts));
  ok('⑦ 混合组：clickOption 实参不含 上一题/下一题', JSON.stringify(c7.clickArgs).indexOf('上一题') < 0
    && JSON.stringify(c7.clickArgs).indexOf('下一题') < 0, JSON.stringify(c7.clickArgs));

  // ⑧ 跨父串组：两个**无关容器**各放 2 个同 tag 同 class 候选，且两个容器的父节点是
  //    两个结构平行的外层块 —— 关键：让两个容器各自都是「其父的同一个下标」（都为 0），
  //    旧分组键 `'P' + indexOf(p) + '|'` 会得到相同 gk → 两组被并成 1 组 4 项（混合）。
  //    正确行为必须分成 2 组，文本不得混合。
  {
    const { win } = makeEnv(`<html><body>
      <div class="el-dialog__wrapper"><div class="el-dialog">
        <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
        <div class="el-dialog__body">
          <div class="q-title">题干</div>
          <div class="rowA"><div class="blockA"><div class="option">甲1</div><div class="option">甲2</div></div></div>
          <div class="rowB"><div class="blockB"><div class="option">乙1</div><div class="option">乙2</div></div></div>
        </div>
        <div class="el-dialog__footer"><button>关闭</button></div>
      </div></div><video></video></body></html>`, 'https://studyvideoh5.zhihuishu.com/stuStudy?p=crossParent');
    const Z = win.ZHS;
    const D = Z.Questions.Dialog;
    // 直接测 _symmetricOptions（方案B，就是那处用 indexOf(p) 的地方）——
    // 传入两组候选，若分组键用「父下标」会把它们并成 1 组 4 项；用「父身份」则分开成 2 组。
    const cands = Array.from(win.document.querySelectorAll('.option'));
    const sym = D._symmetricOptions(cands);
    eq('⑧ 跨父串组：_symmetricOptions 不得把两组无关候选并成 4 项', sym.length <= 2, true,
      '实际 ' + sym.length + ' 项：' + JSON.stringify(sym.map((e) => e.textContent)));
    // 整题层：readOptions 也不得并成 4 项
    const roX = D.readOptions(D.root());
    eq('⑧ 跨父串组：readOptions 不得并成 4 项', roX.texts.length, 2);
  }

  // ⑨ 负例：整组都是操作词 → 剔除后剩 0 → solve 不被调用
  const c9 = await runCase('allAction',
    '<div class="list"><div class="option">关闭</div><div class="option">提交</div></div>');
  eq('⑨ 负例 全操作词组：读到 0 个', c9.texts.length, 0);
  eq('⑨ 负例 全操作词组：solve 不被调用', c9.solveCalls.length, 0);

  // ⑩ 反向保护：选项文本**恰好是操作词**（「确定」）的真题不得被整组误杀。
  //    这条专防把 `.every` 改成 `.some` 的过度修复（一票否决会干掉『确定/不正确』真题）。
  const c10 = await runCase('realActionWord',
    '<div class="list"><div class="option">确定</div><div class="option">不正确</div></div>');
  eq('⑩ 反向保护 真题含「确定」：仍读到 2 个（未被整组误杀）', c10.texts.length, 2);
  ok('⑩ 反向保护：texts 含 确定 与 不正确',
    c10.texts.indexOf('确定') >= 0 && c10.texts.indexOf('不正确') >= 0, JSON.stringify(c10.texts));

  // ⑪ 分页器回归（round-21 P1，能证伪）：`.el-pager` 的 3 个页码会压过 2 项真选项。
  //    旧 0.6.23 实测 texts=["2","3"]（真选项全丢、真题答不了）。必须读到真选项且不含纯数字。
  const c11 = await runCase('pagerNoise',
    '<div class="el-pager"><span class="number active">1</span><span class="number">2</span><span class="number">3</span></div>'
    + '<div class="opt-list"><div class="opt-item">说法一是对的</div><div class="opt-item">说法二也是对的</div></div>',
    '下列关于 TCP 的说法正确的是（）');
  eq('⑪ 分页器：读到 2 个真选项', c11.texts.length, 2);
  ok('⑪ 分页器：texts 含 2 个真选项、不含纯数字',
    c11.texts.indexOf('说法一是对的') >= 0 && c11.texts.indexOf('说法二也是对的') >= 0
    && !c11.texts.some((t) => /^\d+$/.test(t)), JSON.stringify(c11.texts));
  ok('⑪ 分页器：clickOption 实参不含纯数字',
    !c11.clickArgs.some((t) => /^\d+$/.test(t)), JSON.stringify(c11.clickArgs));

  // ⑫ 步骤条 .el-step×4 + 真选项×2 → 读到真选项
  const c12 = await runCase('stepNoise',
    '<div class="el-steps"><div class="el-step">步骤一</div><div class="el-step">步骤二</div>'
    + '<div class="el-step">步骤三</div><div class="el-step">步骤四</div></div>'
    + '<div class="opt-list"><div class="opt-item">甲说法</div><div class="opt-item">乙说法</div></div>');
  eq('⑫ 步骤条：读到 2 个真选项', c12.texts.length, 2);
  ok('⑫ 步骤条：texts 不含「步骤一」', c12.texts.indexOf('步骤一') < 0, JSON.stringify(c12.texts));

  // ⑬ 选项卡 .el-tabs__item×3 + 真选项×2 → 读到真选项
  const c13 = await runCase('tabsNoise',
    '<div class="el-tabs__nav"><div class="el-tabs__item">标签一</div><div class="el-tabs__item">标签二</div>'
    + '<div class="el-tabs__item">标签三</div></div>'
    + '<div class="opt-list"><div class="opt-item">甲说法</div><div class="opt-item">乙说法</div></div>');
  eq('⑬ 选项卡：读到 2 个真选项', c13.texts.length, 2);
  ok('⑬ 选项卡：texts 不含「标签一」', c13.texts.indexOf('标签一') < 0, JSON.stringify(c13.texts));

  // ⑭ 视频控制条 button.vjs-control×4 + 真选项×2 → 读到真选项
  const c14 = await runCase('vjsNoise',
    '<div class="vjs-control-bar"><button class="vjs-control">播放</button><button class="vjs-control">音量</button>'
    + '<button class="vjs-control">字幕</button><button class="vjs-control">全屏</button></div>'
    + '<div class="opt-list"><div class="opt-item">甲说法</div><div class="opt-item">乙说法</div></div>');
  eq('⑭ 视频控制条：读到 2 个真选项', c14.texts.length, 2);
  ok('⑭ 视频控制条：texts 不含「播放」', c14.texts.indexOf('播放') < 0, JSON.stringify(c14.texts));

  // ⑮ 纯数字组单独存在（无真选项）→ 不得当选项
  const c15 = await runCase('pureNumberNoise',
    '<span class="number">1</span><span class="number">2</span><span class="number">3</span>');
  eq('⑮ 纯数字组：不得被当选项（读到 0 个）', c15.texts.length, 0);
  eq('⑮ 纯数字组：solve 不被调用', c15.solveCalls.length, 0);

  // ⑯ NAV 回退（P2-⑤ 回归）：真题选项恰好是「返回/继续学习」→ 必须读到 2 项（不得整组读空）
  const c16 = await runCase('navFallback',
    '<div class="opt-list"><div class="opt-item">返回</div><div class="opt-item">继续学习</div></div>');
  eq('⑯ NAV 回退：真题「返回/继续学习」仍读到 2 项', c16.texts.length, 2);
  ok('⑯ NAV 回退：texts 含 返回 与 继续学习',
    c16.texts.indexOf('返回') >= 0 && c16.texts.indexOf('继续学习') >= 0, JSON.stringify(c16.texts));

  // ⑰ 打分制：带 A./B. 前缀的真选项×2 + 无前缀对称噪声×3 → 必须选前缀那 2 个
  const c17 = await runCase('scoring',
    '<div class="noise-list"><div class="noise">苹果</div><div class="noise">香蕉</div><div class="noise">橘子</div></div>'
    + '<div class="opt-list"><div class="opt-item">A. 说法一</div><div class="opt-item">B. 说法二</div></div>');
  eq('⑰ 打分制：选中共 2 项', c17.texts.length, 2);
  ok('⑰ 打分制：选中带 A./B. 前缀的真选项',
    c17.texts.indexOf('A. 说法一') >= 0 && c17.texts.indexOf('B. 说法二') >= 0, JSON.stringify(c17.texts));

  // 性能：_autoSiblings 走一遍 readOptions 的实测耗时（只扫 scope 子树、按 children 分组）
  console.log('  [性能] 方案C 单次 readOptions 耗时 ≈ ' + c1.costMs + ' ms（形态①自定义 div 选项）');

  // ===== round-22 新增：方案 D「题干锚定」+ P1①~④ 修复回归 =====
  // 需要一个能让 `_findTitleEl` 命中的题干（class 必须是 `.topic-title` 等选择器之一），
  // 且能控制「题干之前 / 题干之后」的内容，才能验证位置先验。
  const runCaseD = async (label, beforeHTML, afterHTML, nestedIn) => {
    const bodyHTML = `${beforeHTML || ''}
      <div class="topic-title">下列关于 TCP 的说法正确的是（）</div>
      ${afterHTML || ''}`;
    const inner = `<div class="el-dialog__body">${bodyHTML}</div>`;
    const html = `<html><body>
      <div class="el-dialog__wrapper"><div class="el-dialog">
        <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
        ${nestedIn ? `<div class="${nestedIn}">${inner}</div>` : inner}
        <div class="el-dialog__footer"><button>关闭</button></div>
      </div></div><video></video></body></html>`;
    const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?p=' + encodeURIComponent(label));
    const Z = win.ZHS;
    Z.setConfig({ bankEnabled: false, llmEnabled: false, debug: false });
    if (Z.Scheduler && Z.Scheduler.stop) Z.Scheduler.stop('user');
    Z.Answerer._running = false;
    Z.state.running = true;

    const solveCalls = [];
    Z.Solver.solve = async (req) => { solveCalls.push(req); return { answer: 'B', from: 'stub' }; };
    const clickArgs = [];
    const _origClickOption = Z.Filler.clickOption.bind(Z.Filler);
    Z.Filler.clickOption = function (el) {
      const t = el ? (el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent) : '';
      clickArgs.push(String(t || '').trim());
      return _origClickOption(el);
    };

    const D = Z.Questions.Dialog;
    const r0 = D.root();
    // 注意：root() 里 questionScore>0 才认；题干在但选项没读到也应认（hasTitle）
    const ro = D.readOptions(r0 || win.document);
    const optEls = ro.elements;
    for (const el of optEls) {
      el.addEventListener('click', function () { this.setAttribute('data-checked', '1'); });
    }
    const fbtn = win.document.querySelector('.el-dialog__footer button');
    if (fbtn) fbtn.addEventListener('click', () => {
      if (win.document.querySelector('[data-checked]')) win.document.querySelector('.el-dialog__wrapper').remove();
    });

    Z.Answerer._giveUpSigs = new Set();
    Z.Answerer._countedSig = '';
    await Z.Answerer.handleDialog({ manual: true });

    return { solveCalls, texts: ro.texts, clickArgs,
      closed: !win.document.querySelector('.el-dialog') };
  };

  // round-23：再给一个「完全自由 body」的变体，便于复刻 round-23 的三个场景
  // （题干与噪声同父、真选项在另一容器；题干后紧跟元信息标签组）。
  const runCaseRaw = async (label, bodyInnerHTML) => {
    const html = `<html><body>
      <div class="el-dialog__wrapper"><div class="el-dialog">
        <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
        <div class="el-dialog__body">${bodyInnerHTML}</div>
        <div class="el-dialog__footer"><button>关闭</button></div>
      </div></div><video></video></body></html>`;
    const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?p=' + encodeURIComponent(label));
    const Z = win.ZHS;
    Z.setConfig({ bankEnabled: false, llmEnabled: false, debug: false });
    if (Z.Scheduler && Z.Scheduler.stop) Z.Scheduler.stop('user');
    Z.Answerer._running = false;
    Z.state.running = true;
    const solveCalls = [];
    Z.Solver.solve = async (req) => { solveCalls.push(req); return { answer: 'B', from: 'stub' }; };
    const clickArgs = [];
    const _origClickOption = Z.Filler.clickOption.bind(Z.Filler);
    Z.Filler.clickOption = function (el) {
      const t = el ? (el.innerText !== undefined && el.innerText !== null ? el.innerText : el.textContent) : '';
      clickArgs.push(String(t || '').trim());
      return _origClickOption(el);
    };
    const D = Z.Questions.Dialog;
    const r0 = D.root();
    const ro = D.readOptions(r0 || win.document);
    const optEls = ro.elements;
    for (const el of optEls) {
      el.addEventListener('click', function () { this.setAttribute('data-checked', '1'); });
    }
    const fbtn = win.document.querySelector('.el-dialog__footer button');
    if (fbtn) fbtn.addEventListener('click', () => {
      if (win.document.querySelector('[data-checked]')) win.document.querySelector('.el-dialog__wrapper').remove();
    });
    Z.Answerer._giveUpSigs = new Set();
    Z.Answerer._countedSig = '';
    await Z.Answerer.handleDialog({ manual: true });
    return { solveCalls, texts: ro.texts, clickArgs,
      closed: !win.document.querySelector('.el-dialog') };
  };

  // round-23：只跑**方案 D 本体** `_anchoredOptions(scope, titleEl)` 的变体。
  // 为什么不能只看 `readOptions` 的最终结果：D 返回 [] 之后，readOptions 会**继续**交给
  // 方案 A/B/C（C 是全树猜测，本就没有「题干之后」的位置先验）。所以「D 不回头看题干之前」
  // 这条契约只能**直测 D 自己**，否则测到的是 C 的行为（与 D 无关）。
  const runCaseAnchored = async (label, bodyInnerHTML) => {
    const html = `<html><body>
      <div class="el-dialog__wrapper"><div class="el-dialog">
        <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
        <div class="el-dialog__body">${bodyInnerHTML}</div>
        <div class="el-dialog__footer"><button>关闭</button></div>
      </div></div><video></video></body></html>`;
    const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy?p=' + encodeURIComponent(label));
    const Z = win.ZHS;
    const D = Z.Questions.Dialog;
    const r0 = D.root() || win.document;
    const scope = r0.querySelector('div.el-dialog__body') || r0;
    const titleEl = D._findTitleEl(r0);
    const els = D._anchoredOptions(scope, titleEl);
    return { texts: els.map((el) => (el.textContent || '').trim()), hadTitle: !!titleEl };
  };

  // ⑱ 方案 D 题干锚定：题干 + 其后 2 个同 class 兄弟（自定义 class）→ 读到那 2 个。
  //   ★ 可证伪设计：题干**之前**放一组「同样 2 项、但带 A./B. 前缀且文本更长」的对称噪声。
  //   在方案 C 的打分里这组噪声与真选项**项数基数相同（1000）**，却因前缀（+20）和
  //   文本长度（len/100）拿更高分 → 无位置先验时必然错选噪声。只有方案 D 的「题干之后」先验能选对。
  const c18 = await runCaseD('anchor',
    '<div class="nav-list"><div class="nav-item">A. 上一节课程回顾</div><div class="nav-item">B. 下一节课程预告</div></div>',
    '<div class="opt-list"><div class="opt-item">甲说法</div><div class="opt-item">乙说法</div></div>');
  eq('⑱ 方案D：题干后 2 个同 class 兄弟 → 读到 2 项', c18.texts.length, 2);
  ok('⑱ 方案D：读到题干后的「甲说法/乙说法」、不含题干前的「A. 上一节课程回顾」',
    c18.texts.indexOf('甲说法') >= 0 && c18.texts.indexOf('乙说法') >= 0
    && c18.texts.indexOf('A. 上一节课程回顾') < 0, JSON.stringify(c18.texts));

  // ⑲ D 优先于 C：题干后真选项 ×2 + 题干前「同 2 项、带前缀、更长」的噪声 ×2（P1① 正向修复）
  //   ★ 可证伪设计：噪声容器**故意不带**任何黑名单 class（否则会被 `inNoiseContainer` 挡掉，
  //   方案 C 也能读对，就测不出位置先验）；且噪声与真选项项数相同（都 2 项）但带 A./B. 前缀、
  //   文本更长 → 在方案 C 的打分里分数更高 → 无位置先验时必然错选噪声。只有方案 D 能选对。
  const c19 = await runCaseD('dOverC',
    '<div class="nav-list"><span class="nav-title">A. 章节一知识点回顾</span>'
    + '<span class="nav-title">B. 章节二知识点预告</span></div>',
    '<div class="opt-list"><div class="opt-item">说法一是对的</div><div class="opt-item">说法二也是对的</div></div>');
  eq('⑲ D优先于C：题干后真选项×2、题干前带前缀噪声×2 → 读到 2 项', c19.texts.length, 2);
  ok('⑲ D优先于C：读到真选项、不含「A. 章节一知识点回顾」',
    c19.texts.indexOf('说法一是对的') >= 0 && c19.texts.indexOf('说法二也是对的') >= 0
    && c19.texts.indexOf('A. 章节一知识点回顾') < 0, JSON.stringify(c19.texts));

  // ⑳ video-js 祖先不再全灭：弹窗嵌在 video-js 内、选项是普通 .opt-item → 必须读到 2 项（P1① 核心）
  const c20 = await runCaseD('videoJsAncestor',
    '', '<div class="opt-list"><div class="opt-item">甲说法</div><div class="opt-item">乙说法</div></div>',
    'video-js');
  eq('⑳ video-js 祖先：弹窗嵌在 video-js 内仍读到 2 项', c20.texts.length, 2);
  ok('⑳ video-js 祖先：文本不含噪声',
    c20.texts.indexOf('甲说法') >= 0 && c20.texts.indexOf('乙说法') >= 0, JSON.stringify(c20.texts));

  // ㉑ 打分单调性（P1②）：score(2项无前缀) > score(4项带4前缀)，直测纯函数
  {
    const { win } = makeEnv('<html><body><div class="el-dialog__wrapper"><div class="el-dialog">'
      + '<div class="el-dialog__body"><div class="topic-title">题干</div></div></div></div></body></html>',
      'https://studyvideoh5.zhihuishu.com/stuStudy');
    const S = win.ZHS.Questions.Dialog._scoreOptionGroup;
    const two = S(['说法一是对的', '说法二也是对的'], 0);
    const fourPrefixed = S(['A. 首页', 'B. 课程', 'C. 章节', 'D. 详情'], 0);
    ok('㉑ 打分单调性：score(2项无前缀=' + two + ') > score(4项带4前缀=' + fourPrefixed + ')',
      two > fourPrefixed, two + ' vs ' + fourPrefixed);
  }

  // ㉒ 前缀噪声不再胜出（P1②）：3 项带前缀噪声 + 2 项真选项 → 读到真选项
  const c22 = await runCaseD('prefixNoise',
    '',
    '<div class="el-breadcrumb"><span class="el-breadcrumb-item">A. 首页</span>'
    + '<span class="el-breadcrumb-item">B. 课程</span><span class="el-breadcrumb-item">C. 章节</span></div>'
    + '<div class="opt-list"><div class="opt-item">说法一是对的</div><div class="opt-item">说法二也是对的</div></div>');
  eq('㉒ 前缀噪声：3 项带前缀噪声 + 2 项真选项 → 读到 2 项', c22.texts.length, 2);
  ok('㉒ 前缀噪声：读到真选项、不含「首页」',
    c22.texts.indexOf('说法一是对的') >= 0 && c22.texts.indexOf('首页') < 0, JSON.stringify(c22.texts));

  // ㉓ NAV 回退不豁免按钮组（P1③）：页脚 [上一题][下一题]（button）→ 读到 0、solve 不调、clickOption 零次
  {
    const html = `<html><body>
      <div class="el-dialog__wrapper"><div class="el-dialog">
        <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
        <div class="el-dialog__body"><div class="topic-title">题干</div></div>
        <div class="el-dialog__footer">
          <button class="nav-btn">上一题</button><button class="nav-btn">下一题</button>
        </div>
      </div></div><video></video></body></html>`;
    const { win } = makeEnv(html, 'https://studyvideoh5.zhihuishu.com/stuStudy');
    const Z = win.ZHS;
    Z.setConfig({ bankEnabled: false, llmEnabled: false, debug: false });
    if (Z.Scheduler && Z.Scheduler.stop) Z.Scheduler.stop('user');
    Z.Answerer._running = false;
    Z.state.running = true;
    const solveCalls = [];
    Z.Solver.solve = async (req) => { solveCalls.push(req); return { answer: 'B', from: 'stub' }; };
    const clickArgs = [];
    const _orig = Z.Filler.clickOption.bind(Z.Filler);
    Z.Filler.clickOption = function (el) { clickArgs.push((el && el.textContent || '').trim()); return _orig(el); };
    Z.Answerer._giveUpSigs = new Set();
    Z.Answerer._countedSig = '';
    await Z.Answerer.handleDialog({ manual: true });
    const ro = Z.Questions.Dialog.readOptions(Z.Questions.Dialog.root() || win.document);
    eq('㉓ NAV 回退不豁免按钮组：读到 0 项', ro.texts.length, 0);
    eq('㉓ NAV 回退不豁免按钮组：solve 不被调用', solveCalls.length, 0);
    eq('㉓ NAV 回退不豁免按钮组：clickOption 零次', clickArgs.length, 0);
  }

  // ㉔ √/× 判断题选项（P1④）：选项 √ / × → 读到 2 项
  const c24 = await runCaseD('judgeSymbols',
    '', '<div class="opt-list"><div class="opt-item">√</div><div class="opt-item">×</div></div>');
  eq('㉔ √/× 判断题：读到 2 项', c24.texts.length, 2);
  ok('㉔ √/× 判断题：文本含 √ 与 ×',
    c24.texts.indexOf('√') >= 0 && c24.texts.indexOf('×') >= 0, JSON.stringify(c24.texts));

  // ㉕ 单数字选项保留（P1④）：选项组 ["1","说法二"] → 读到 2 项（不被成员级误杀）
  const c25 = await runCaseD('singleDigit',
    '', '<div class="opt-list"><div class="opt-item">1</div><div class="opt-item">说法二</div></div>');
  eq('㉕ 单数字选项组：读到 2 项', c25.texts.length, 2);
  ok('㉕ 单数字选项组：文本含 1 与 说法二',
    c25.texts.indexOf('1') >= 0 && c25.texts.indexOf('说法二') >= 0, JSON.stringify(c25.texts));

  // ===== round-23 新增：方案 D 主路径短路漏洞（team-lead 实测挖出）=====
  // ㉖ ★题干后同父噪声 + 真选项在另一容器 → 必须读到真选项
  //   复刻 team-lead 场景①：题干与噪声同父（`.wrap`），真选项在 `.wrap2`。
  //   旧实现主路径「第一圈命中就 return」→ 读到噪声 `["A. 上一节课程回顾","B. 下一节课程预告"]`。
  const c26 = await runCaseRaw('dSameParentNoise',
    '<div class="wrap"><div class="q-title topic-title">下列说法正确的是（）</div>'
    + '<div class="it">A. 上一节课程回顾</div><div class="it">B. 下一节课程预告</div></div>'
    + '<div class="wrap2"><div class="it">甲说法</div><div class="it">乙说法</div></div>');
  eq('㉖ 题干后同父噪声：读到 2 项', c26.texts.length, 2);
  ok('㉖ 题干后同父噪声：读到「甲说法/乙说法」、不含「A. 上一节课程回顾」',
    c26.texts.indexOf('甲说法') >= 0 && c26.texts.indexOf('乙说法') >= 0
    && c26.texts.indexOf('A. 上一节课程回顾') < 0, JSON.stringify(c26.texts));

  // ㉗ ★题干后紧跟「元信息标签组」（单选题/2分）→ 必须跳过标签、读到真选项
  //   复刻 team-lead 场景②：`.tag` 组「单选题 / 2分」同父同 class，会被结构判据当成选项组。
  const c27 = await runCaseRaw('metaTags',
    '<div class="wrap"><div class="q-title topic-title">下列说法正确的是（）</div>'
    + '<div class="tag">单选题</div><div class="tag">2分</div></div>'
    + '<div class="wrap2"><div class="opt">甲说法</div><div class="opt">乙说法</div></div>');
  eq('㉗ 元信息标签组：读到 2 项', c27.texts.length, 2);
  ok('㉗ 元信息标签组：读到「甲说法/乙说法」、不含「单选题」「2分」',
    c27.texts.indexOf('甲说法') >= 0 && c27.texts.indexOf('乙说法') >= 0
    && c27.texts.indexOf('单选题') < 0 && c27.texts.indexOf('2分') < 0, JSON.stringify(c27.texts));

  // ㉘ 层级 tie-break 不翻转项数差（直测 scoreOptionGroup + 层级惩罚公式）
  {
    const { win } = makeEnv('<html><body><div class="el-dialog__wrapper"><div class="el-dialog">'
      + '<div class="el-dialog__body"><div class="topic-title">题干</div></div></div></div></body></html>',
      'https://studyvideoh5.zhihuishu.com/stuStudy');
    const S = win.ZHS.Questions.Dialog._scoreOptionGroup;
    // 2 项在最深层（up=5） vs 3 项在题干下（up=0）：999.5 > 300
    const twoDeep = S(['甲说法', '乙说法'], 0) - 5 * 0.1;
    const threeTop = S(['步骤一', '步骤二', '步骤三'], 0) - 0 * 0.1;
    ok('㉘ 层级 tie-break 不翻转项数差：score(2项@5层=' + twoDeep + ') > score(3项@0层=' + threeTop + ')',
      twoDeep > threeTop, twoDeep + ' vs ' + threeTop);
  }

  // ㉙ 位置约束：题干位于容器末尾、其**前**有对称噪声组 → 方案 D **本体**不得回头看
  {
    // ★ 直测 `_anchoredOptions`（方案 D 本体），而非 readOptions 终值：
    //   D 返回 [] 后 readOptions 仍会落到方案 C（全树猜测），测终值等于在测 C，测不出 D 的契约。
    const c29 = await runCaseAnchored('beforeTitleNoise',
      '<div class="wrap2"><div class="opt">甲说法</div><div class="opt">乙说法</div></div>'
      + '<div class="wrap"><div class="q-title topic-title">下列说法正确的是（）</div></div>');
    ok('㉙ 位置约束：题干被读到（前置条件成立）', c29.hadTitle === true);
    eq('㉙ 位置约束：题干之后无候选 → 方案D 本体返回 0 项（不回头收题干之前的组）', c29.texts.length, 0);
    ok('㉙ 位置约束：texts 不含题干之前的「甲说法/乙说法」',
      c29.texts.indexOf('甲说法') < 0 && c29.texts.indexOf('乙说法') < 0, JSON.stringify(c29.texts));
  }

  // 性能红线：构造一个较大的弹窗（50 个装饰节点 + 2 选项），确认不会线性爆炸
  {
    let deco = '';
    for (let i = 0; i < 50; i++) deco += `<div class="deco"><span>装饰${i}</span></div>`;
    const { win } = makeEnv(`<html><body>
      <div class="el-dialog__wrapper"><div class="el-dialog">
        <div class="el-dialog__header"><span class="el-dialog__title">课中答题</span></div>
        <div class="el-dialog__body">
          <div class="q-title">题干</div>${deco}
          <div class="opt-list"><div class="opt-item">甲</div><div class="opt-item">乙</div></div>
        </div>
        <div class="el-dialog__footer"><button>关闭</button></div>
      </div></div><video></video></body></html>`, 'https://studyvideoh5.zhihuishu.com/stuStudy');
    const Z = win.ZHS;
    const D = Z.Questions.Dialog;
    const r = D.root();
    const t = Date.now();
    let ro = null;
    for (let i = 0; i < 200; i++) ro = D.readOptions(r);
    const per = (Date.now() - t) / 200;
    eq('性能：大片装饰节点下仍能读到 2 个选项', ro.texts.length, 2);
    ok('性能：单次 readOptions < 20ms（50 装饰节点 ×200 次实测 ' + per.toFixed(2) + 'ms/次）', per < 20, per.toFixed(2) + 'ms');
  }
})();

console.log('\n=== 34. 构建产物完整性 ===');
// 全部异步测试都要等：此前这里只写了 [_n3, _n4]，其余 4 组的断言
// 会在汇总打印之后才跑完，失败被静默吞掉（假绿）。
// ==================================================
// === 33. 求解层诊断透传（入口级 · 2026-09-20 补 round-24 漏网） ===
//
// 【为什么要补这一组】round-24 修了网络层与 LLM 层的 diagnose/hint，
// 但只验证了「面板测试连接」这一条路。真实刷题走的是 Solver.solve()，
// 那里 catch 只取 e.message —— hint 在求解层断裂，用户依旧看不到解决方案。
// 只验证一条路属于假判据（Oracle Gate 判据 c：入口可达性）。
//
// 本组**从真实入口 ZHS.Solver.solve() 发起**，用抛错桩 + 拦截 ZHS.Log.warn，
// 断言「解决方案」确实抵达用户可见日志。
//
// 两个必守的框架约定：
//  ① 必须是 async IIFE —— 裸 block 里用 await 会被判定为 top-level await 而整文件语法报错；
//  ② 必须把 Promise 加进末尾 Promise.all —— 否则断言在汇总打印之后才跑完，
//     失败被静默吞掉（假绿）。这是本项目 2026-09-18 踩过的坑。
// ==================================================
console.log('\n=== 33. 求解层诊断透传（入口级） ===');
const _solverDiag = (async () => {
  const { win } = makeEnv('<html><body></body></html>');
  const ZHS = win.ZHS;

  const logs = [];
  const origWarn = ZHS.Log.warn;
  // 让 LLM 通道抛出「带解决方案」的错误，复现网络层/LLM 层已挂 hint 的真实错误
  ZHS.LLM.vote = async () => {
    const e = new Error('大模型返回了 HTML 页面而不是 JSON 数据');
    e.code = 'NON_JSON_HTML';
    e.hint = '请改成形如 https://api.deepseek.com 的接口根地址';
    throw e;
  };
  // 注意：ZHS.config 是只读快照，直接改属性**不会生效** ——
  // 实测这样写仍会走进题库通道（日志出现「题库查询异常」而非「LLM 求解失败」），
  // 导致断言测错了对象。必须走 setConfig。
  ZHS.setConfig({
    answerMode: 'llm',
    llmEnabled: true,
    llmKey: 'dummy-key-for-test',
    bankEnabled: false,
    gatedRandom: false,
  });

  ZHS.Log.warn = (m) => { logs.push(String(m)); };
  const r1 = await ZHS.Solver.solve({ title: '求解层透传测试题', options: ['甲', '乙'], type: 'single' });
  ZHS.Log.warn = origWarn;

  // 回归保护（非判别性）：baseline 上也通过，锁的是「不许瞎蒙答案」这条既有行为，
  // 不提供本次修复的判别证据——判别证据由下面 hint 透传与节流两条提供。
  ok('两通道全失败时不返回答案（不瞎蒙）', !r1 || !r1.answer, JSON.stringify(r1));
  // ★ 判别性：旧代码 catch 只取 e.message，hint 丢失 → baseline 实测 FAIL
  ok('★ 真实答题入口把解决方案 hint 透传到用户可见日志',
    logs.some((m) => m.includes('建议：') && m.includes('api.deepseek.com')),
    '实际日志：' + logs.join(' | ').slice(0, 180));

  // 节流：作业页一次跑 20 题，同一故障不该刷 20 条把面板挤空
  const logs2 = [];
  ZHS.Log.warn = (m) => { logs2.push(String(m)); };
  await ZHS.Solver.solve({ title: '求解层透传测试题2', options: ['甲', '乙'], type: 'single' });
  ZHS.Log.warn = origWarn;
  // 只统计「LLM 求解失败」这一类 —— 断言必须精确指向被测行为，
  // 笼统计全部 warn 会把无关模块的日志也算进来，导致误判（顺带掩盖真正要测的东西）。
  const llmFails = logs2.filter((m) => m.includes('LLM 求解失败'));
  ok('同类故障被节流（连跑两题不重复刷屏）', llmFails.length === 0,
    '第二次仍输出 ' + llmFails.length + ' 条；全部日志：' + logs2.join(' | ').slice(0, 160));

  // ---- 通道健康检测（M8）：题库侧结构化结果 ----
  // 旧代码没有 health()，用 stub 兜住避免 TypeError 崩溃吞掉后续用例；
  // stub 的 code 取 ''，与期望值 'NO_URL' 不同 → baseline 干净 FAIL。
  ZHS.setConfig({ bankUrl: '' });
  const h = (ZHS.Bank && ZHS.Bank.health)
    ? await ZHS.Bank.health()
    : { ok: true, msg: '', hint: '', code: '' };
  eq('题库未配置地址 → health() 归类 NO_URL', h.code, 'NO_URL');
  ok('题库未配置时给出可操作提示（含示例地址）', /8060/.test(h.hint || ''), JSON.stringify(h));
})();

// ==================================================
// === 34. 学习统计（M8：答题记录 + 学习时长 + 习惯分） ===
//
// 同样守两条框架约定：① 必须 async IIFE（裸 block 用 await 会整文件语法报错）；
// ② 必须登记进末尾 Promise.all（否则断言在汇总之后才跑完，失败被静默吞掉 = 假绿）。
// ==================================================
console.log('\n=== 34. 学习统计（M8） ===');
const _statsM8 = (async () => {
  const { win } = makeEnv('<html><body></body></html>');
  const ZHS = win.ZHS;
  const S = ZHS && ZHS.Stats;

  ok('统计模块已挂载', !!S);

  // 旧代码没有 Stats：用空摘要 stub 兜住，让每条干净 FAIL 而不是 TypeError 崩溃吞掉后一半
  const empty = {
    today: { answered: 0, bank: 0, llm: 0, skipped: 0, studyMs: 0 },
    todayHabitDone: 0, todayHabitRemainMs: 1800000,
    totalAnswered: 0, activeDays: 0, recent: [],
  };
  const record = (t, r) => { if (S && S.record) S.record(t, r); };
  const addTime = (ms) => { if (S && S.addStudyTime) S.addStudyTime(ms); };
  const sum = () => ((S && S.summary) ? S.summary() : empty);

  if (S && S.reset) S.reset();

  record('题目甲', { answer: 'A', from: 'bank:icodef' });
  record('题目乙', { answer: 'B', from: 'llm' });
  record('题目丙', null);

  const s1 = sum();
  eq('今日答题数（成功 2 题）', s1.today.answered, 2);
  eq('题库来源计数', s1.today.bank, 1);
  eq('模型来源计数', s1.today.llm, 1);
  eq('未答（跳过）计数', s1.today.skipped, 1);

  addTime(45 * 60 * 1000);   // 累计 45 分钟
  const s2 = sum();
  eq('学习时长按毫秒累计', s2.today.studyMs, 45 * 60 * 1000);
  eq('习惯分：满 30 分钟得 1 分', s2.todayHabitDone, 1);

  ok('最近记录保留明细且最新在前',
    !!(s2.recent && s2.recent.length && s2.recent[0] && s2.recent[0].q === '题目丙'),
    JSON.stringify((s2.recent || []).slice(0, 2)));

  // 明细上限：灌 250 条后应被截断到 200，避免 localStorage 被撑爆
  for (let i = 0; i < 250; i++) record('批量题' + i, { answer: 'A', from: 'llm' });
  const stored = (S && S._data && S._data.records) ? S._data.records.length : 0;
  ok('明细被限制在 200 条以内（防存储膨胀）', stored > 0 && stored <= 200, '实际 ' + stored);
})();

Promise.all([_n3, _n4, _stopCond, _fakeFin, _manualAns, _noreplay, _transient, _dupname, _abDialog, _abDedupe, _abSig, _abGuard, _abSolveReachable, _abMultiDialog, _abSigWithOptions, _abWrapperHidden, _abEmptyLabel, _abEntryForms, _abAutoSiblings, _solverDiag, _statsM8]).then(() => {
  const distPath = path.join(__dirname, '..', 'dist', 'zhihuishu-helper.user.js');
  if (fs.existsSync(distPath)) {
    const src = fs.readFileSync(distPath, 'utf8');
    ok('产物存在', true);
    // dist 新鲜度（内容级比对）：src 改了却忘了 rebuild → 用户 @updateURL 拉到的还是旧逻辑。
    // 事故回放（2026-09-18）：改了 3 个 src 文件没重建，dist 停在 22:16 版，
    // clickAndVerify / scoreAdapter 在产物里 grep 计数全是 0，「改了半天功能还是全无用」。
    // 这条断言让「漏 build」在 npm test 阶段就红，而不是等用户反馈。
    try {
      const { bundle } = require('../tools/lib/bundle');
      const expected = bundle().content;
      ok('dist 产物与 src 同步（漏 build 会被这条挡下）', src === expected,
        src === expected ? '' : '请运行 node build.js');
    } catch (e) {
      ok('dist 产物与 src 同步（漏 build 会被这条挡下）', false, e.message);
    }
    ok('含脚本头 @name', src.includes('// @name'));
    ok('含 GM_setValue 授权', src.includes('@grant        GM_setValue'));
    ok('含 GM_xmlhttpRequest 授权（跨域调 API）', src.includes('@grant        GM_xmlhttpRequest'));
    ok('含 @connect localhost（题库）', src.includes('@connect      localhost'));
    // @match 域名覆盖（漏一个 = 脚本注入不进去，功能全废）
    ok('@match 覆盖 zhihuishu.com', /@match\s+\*:\/\/\*\.zhihuishu\.com\/\*/.test(src));
    ok('@match 覆盖 polymas.com（AI课程中心）', /@match\s+\*:\/\/\*\.polymas\.com\/\*/.test(src));
    ok('含 6 套页面适配', src.includes('wisdom') && src.includes('fusion') && src.includes('hike') && src.includes('legacy') && src.includes('card2025') && src.includes('polymas'));
    ok('含弹题选择器', src.includes('#playTopic-dialog'));
    ok('含作业页选择器', src.includes('.subject_node'));
    ok('含题库接口路径', src.includes('/adapter-service/search'));
    ok('含答案归一化', src.includes('function normalize'));
    ok('含三态识别 statusOf', src.includes('statusOf'));
    ok('含总结报告 finishAll', src.includes('finishAll'));
    ok('含弹题自动关闭 closeDialogAndResume', src.includes('closeDialogAndResume'));
    ok('IIFE 包裹（不污染全局）', src.includes("'use strict'"));
  } else {
    console.log('  （未构建，跳过产物检查）');
  }

  // ==================================================
  // === 32. 网络失败诊断（2026-09-19 · C06 判别性测试） ===
  //
  // 【为什么用判别性测试】用户报的「API 请求失败」根因是：
  // 服务端返回 HTML（网关页/代理页/门户首页）时，旧代码只抛一句「LLM 返回非 JSON」，
  // 且「超时」「断网」「被拒 portraits」全都压成 status=0，用户无从自查只能反复重试。
  //
  // baseline 验证：把 09-bank.js 的 diagnose/parseJsonOrThrow 删掉再跑本组 → 必须全红。
  // 这些断言全部落在**具体返回值**（code / msg 关键词 / hint 关键词）上，
  // 没有一条是 truthy 判定，因此具备真正的判别力。
  // ==================================================
  console.log('\n=== 32. 网络失败诊断（HTTP / HTML / 超时 分类） ===');
  {
    const { win } = makeEnv('<html><body></body></html>');
    const B = win.ZHS && win.ZHS.Bank;

    // 判据健壮性：旧代码里 diagnose / FAIL / extractHtmlTitle 都不存在，
    // 若直接访问会 TypeError 崩溃，导致后一半用例根本没跑就被吞掉，
    // 看不到「哪些失败、为什么失败」——这违背了判别性测试的初衷。
    // 这里用返回空值的 stub 兜住，让每一条断言各自干净地 FAIL。
    // 注意两个 stub 的返回值都刻意取「不会等于任何期望值」的形式（undefined / 'STUB'），
    // 否则旧代码会碰巧通过某条断言（baseline PASS = 该条锁不住任何东西）。
    const has = (v) => typeof v === 'function';
    const diagnoseSafely = has(B && B.diagnose) ? B.diagnose : (() => ({ code: '', msg: '', hint: '' }));
    const throwSafely = has(B && B.parseJsonOrThrow) ? B.parseJsonOrThrow : (() => undefined);
    const titleSafely = has(B && B.extractHtmlTitle) ? B.extractHtmlTitle : (() => 'STUB');
    const F = (B && B.FAIL) || { OK: 'ok', TIMEOUT: 'timeout', NETWORK: 'network', HTTP: 'http' };

    ok('网络层暴露 diagnose', has(B && B.diagnose));
    ok('网络层暴露 parseJsonOrThrow', has(B && B.parseJsonOrThrow));
    ok('网络层暴露 FAIL 枚举', !!(B && B.FAIL && B.FAIL.TIMEOUT));

    // ---- 场景 1：网关返回 502 HTML 错误页（用户最常撞到的真实故障） ----
    const html502 = '<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>';
    const d1 = diagnoseSafely('大模型', { ok: false, status: 502, text: html502, kind: F.HTTP },
      'https://api.deepseek.com/chat/completions');
    eq('502 HTML 页 → 归类 HTTP_HTML', d1.code, 'HTTP_HTML');
    ok('502 报错文案点明是 HTML 而非数据', d1.msg.includes('HTML 页面'), d1.msg);
    ok('502 报错带出页面标题，便于用户自证是谁拦的', d1.msg.includes('502 Bad Gateway'), d1.msg);
    ok('502 提示引导检查 baseUrl 是否重复拼接', d1.hint.includes('/chat/completions'), d1.hint);

    // ---- 场景 2：HTTP 200 但返回门户首页（地址填成网站根的经典误操作） ----
    const portal = '<!DOCTYPE html><html><head><title>首页</title></head><body></body></html>';
    const d2 = diagnoseSafely('大模型', { ok: true, status: 200, text: portal, kind: F.OK },
      'https://example.com');
    eq('200 却返回门户 HTML → 归类 NON_JSON_HTML', d2.code, 'NON_JSON_HTML');
    ok('门户页报错说明"返回的是 HTML 不是 JSON"', d2.msg.includes('HTML 页面'), d2.msg);
    ok('门户页提示给出正确地址格式示范', d2.hint.includes('https://api.deepseek.com'), d2.hint);

    // ---- 场景 3 / 4：超时与网络失败必须能分开（旧版两者都是 status=0） ----
    const d3 = diagnoseSafely('题库', { ok: false, status: 0, text: '', kind: F.TIMEOUT },
      'http://127.0.0.1:8060/adapter-service/search');
    eq('超时 → 归类 TIMEOUT', d3.code, 'TIMEOUT');
    ok('超时文案明确说"超时"而非笼统失败', d3.msg.includes('超时'), d3.msg);

    const d4 = diagnoseSafely('题库', { ok: false, status: 0, text: '', kind: F.NETWORK },
      'http://127.0.0.1:8060/adapter-service/search');
    eq('断网 → 归类 NETWORK', d4.code, 'NETWORK');
    ok('断网文案明确说"连不上"', d4.msg.includes('连不上'), d4.msg);
    ok('断网提示引导检查本地服务是否启动', d4.hint.includes('TikuAdapter') || d4.hint.includes('地址'), d4.hint);

    // ---- 场景 5：鉴权失败要给到 Key，不能只说"被拒绝" ----
    const d5 = diagnoseSafely('大模型', { ok: false, status: 401, text: '{"error":"invalid"}', kind: F.HTTP },
      'https://api.deepseek.com/chat/completions');
    eq('401 → 归类 HTTP_401', d5.code, 'HTTP_401');
    ok('401 提示直接指向 API Key', d5.hint.includes('API Key'), d5.hint);

    // ---- 场景 6：2xx 空响应体 ----
    const d6 = diagnoseSafely('大模型', { ok: true, status: 200, text: '   ', kind: F.OK }, 'https://x.com');
    eq('200 空体 → 归类 EMPTY', d6.code, 'EMPTY');

    // ---- 场景 7：parseJsonOrThrow 把诊断挂进 Error.hint（调用方透传的关键） ----
    let thrown = null;
    try {
      throwSafely('大模型', { ok: true, status: 200, text: html502, kind: F.OK },
        'https://example.com');
    } catch (e) { thrown = e; }
    ok('抛出的错误携带 hint（供面板展示解决方案）', !!(thrown && thrown.hint), thrown && thrown.message);
    ok('抛错文案不再是干瘪的"返回非 JSON"',
      !!thrown && !thrown.message.includes('返回非 JSON') && thrown.message.includes('HTML'),
      thrown && thrown.message);

    // ---- 场景 8：正常 JSON 必须能原样解析，不能因为改了解析路径就炸 ----
    let parsed = null;
    try {
      parsed = throwSafely('大模型',
        { ok: true, status: 200, text: '{"choices":[{"message":{"content":"A"}}]}', kind: F.OK },
        'https://example.com');
    } catch (e) { parsed = null; }
    ok('正常 JSON 仍可解析', !!parsed && parsed.choices[0].message.content === 'A');

    // ---- 场景 9：HTML 标题提取（拷不到不能炸） ----
    eq('能抠出 <title>', titleSafely(html502), '502 Bad Gateway');
    eq('无 title 时返回空串而非抛错', titleSafely('plain text'), '');
  }

  // ==================================================

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
}).catch((e) => {
  console.error('\n异步测试异常：' + e.message);
  console.error(e.stack);
  process.exit(1);
});
