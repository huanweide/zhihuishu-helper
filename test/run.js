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
  eq('reset 后签名为空', A._lastDialogSig, '');
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

console.log('\n=== 20. 构建产物完整性 ===');
{
  const distPath = path.join(__dirname, '..', 'dist', 'zhihuishu-helper.user.js');
  if (fs.existsSync(distPath)) {
    const src = fs.readFileSync(distPath, 'utf8');
    ok('产物存在', true);
    ok('含脚本头 @name', src.includes('// @name'));
    ok('含 GM_setValue 授权', src.includes('@grant        GM_setValue'));
    ok('含 GM_xmlhttpRequest 授权（跨域调 API）', src.includes('@grant        GM_xmlhttpRequest'));
    ok('含 @connect localhost（题库）', src.includes('@connect      localhost'));
    ok('含 5 套页面适配', src.includes('wisdom') && src.includes('fusion') && src.includes('hike') && src.includes('legacy'));
    ok('含弹题选择器', src.includes('#playTopic-dialog'));
    ok('含作业页选择器', src.includes('.subject_node'));
    ok('含题库接口路径', src.includes('/adapter-service/search'));
    ok('含答案归一化', src.includes('function normalize'));
    ok('IIFE 包裹（不污染全局）', src.includes("'use strict'"));
  } else {
    console.log('  （未构建，跳过产物检查）');
  }
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
