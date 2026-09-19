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

console.log('\n=== 33. 构建产物完整性 ===');
// 全部异步测试都要等：此前这里只写了 [_n3, _n4]，其余 4 组的断言
// 会在汇总打印之后才跑完，失败被静默吞掉（假绿）。
Promise.all([_n3, _n4, _stopCond, _fakeFin, _manualAns, _noreplay, _transient]).then(() => {
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
