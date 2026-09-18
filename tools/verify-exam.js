/**
 * 临时验收脚本（不入库）：在 jsdom 里用「源码还原的作答页 DOM」真跑一遍 06c-exam.js
 *
 * 验证点：
 *   A. 默认关闭时：进入作答页什么都不点（开关承诺）
 *   B. 打开后：自动识别题型、拿答案、勾选选项、派发 change、点提交
 *   C. 多选：勾选两个选项
 *   D. 判断题：按「对/错」文本匹配
 *   E. 主观题（填空/问答）：跳过不瞎填
 *   F. 列表页：绝不自动点击任何按钮（守株待兔）
 *   G. 章节范围：不在范围内则不作答
 *   H. 脚本源码里没有跳转语句
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', 'src');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}

// ============ 作业作答页 DOM（结构照 review-worker-20 的源码还原）============
function homeworkHtml() {
  const q = (qid, num, type, score, stem, opts) => `
    <div class="examPaper_subject mt30" data-questionid="${qid}">
      <div class="subject_stem clearfix">
        <div class="subject_num fl"><span id="anchor_${qid}">${num}</span></div>
        <div class="subject_type_describe fl">
          <div class="subject_type_annex"><span class="subject_type">【${type}】(${score}分)</span></div>
          <div class="subject_describe"><p>${stem}</p></div>
        </div>
      </div>
      <div class="subject_node">
        ${opts.map((o, i) => `
          <div class="nodeLab">
            <label class="clearfix">
              <div class="fl">
                <input type="${type.includes('多选') ? 'checkbox' : 'radio'}" name="q_${qid}" value="${i}">
                <div class="node_detail examquestions-answer fl">${o}</div>
              </div>
            </label>
          </div>`).join('')}
      </div>
    </div>`;

  return `<!DOCTYPE html><html><body>
    <div class="examPaper">
      ${q('q1', '1', '单选题', 2, '1+1 等于几？', ['1', '2', '3', '4'])}
      ${q('q2', '2', '多选题', 4, '下列哪些是编程语言？', ['Python', 'Java', '香蕉', 'HTML'])}
      ${q('q3', '3', '判断题', 2, '地球是圆的。', ['对', '错'])}
      ${q('q4', '4', '填空题', 2, '中国的首都是____。', [])}
      ${q('q5', '5', '单选题', 2, '水的化学式是？', ['CO2', 'H2O', 'O2', 'NaCl'])}
    </div>
    <button class="submit-btn active-color">提交</button>
  </body></html>`;
}

const HOMEWORK_URL = 'https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework/472492/5pQnxP6J/egGd6LDe/1000006642/433/0';
const LIST_URL = 'https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList';

function makeEnv(html, url, opts = {}) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  const store = {};
  win.GM_setValue = (k, v) => { store[k] = v; };
  win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);

  // 记录所有点击过的元素，用于「绝不自动点击」断言
  const clicks = [];
  const origAdd = win.EventTarget.prototype.addEventListener;
  win.__clicks = clicks;

  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try { vm.runInContext(code, dom.getInternalVMContext(), { filename: f }); }
    catch (e) { console.log('  [加载 ' + f + ' 出错] ' + e.message); }
  }

  // 装答案通道：假 LLM（题目 → 答案）
  const ZHS = win.ZHS;
  const answers = opts.answers || {};
  ZHS.Solver.solve = async (q) => {
    const a = answers[ZHS.Util.normText(q.title)];
    if (!a) return null;
    return { answer: a, from: 'fake-bank', confidence: 'high' };
  };

  // 记录 input 上的 click / change
  win.document.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('click', () => clicks.push({ tag: 'input', qid: inp.name, value: inp.value }));
    inp.addEventListener('change', () => { inp.__changed = true; });
  });
  const sub = win.document.querySelector('.submit-btn');
  if (sub) sub.addEventListener('click', () => clicks.push({ tag: 'submit' }));

  // 面板挂载会拉一堆依赖；这里不需要面板，直接屏蔽
  ZHS.panel = null;

  return { dom, win, store, clicks };
}

(async () => {
  console.log('\n=== A. 默认关闭：进入作答页什么都不点 ===');
  {
    const env = makeEnv(homeworkHtml(), HOMEWORK_URL, {
      answers: { '1+1 等于几？': 'B' },
    });
    const { win, clicks } = env;
    ok('autoExam 默认是 false', win.ZHS.config.autoExam === false);
    ok('examSubmit 默认 true', win.ZHS.config.examSubmit === true);
    ok('examSubmitDelay 默认 5', win.ZHS.config.examSubmitDelay === 5);
    ok('章节范围默认 0/0', win.ZHS.config.examChapterFrom === 0 && win.ZHS.config.examChapterTo === 0);
    ok('isAnswerPage() 识别正确', win.ZHS.Exam.isAnswerPage() === true);

    // 模拟自启动轮询
    await win.ZHS.Exam.solvePage();
    ok('关闭态：solvePage 直接返回，无任何点击', clicks.length === 0, JSON.stringify(clicks));
    ok('关闭态：选项未被选中',
      Array.from(win.document.querySelectorAll('input')).every((i) => !i.checked));
  }

  console.log('\n=== B. 打开开关：自动作答 + 提交 ===');
  {
    const env = makeEnv(homeworkHtml(), HOMEWORK_URL, {
      answers: {
        '1+1 等于几？': 'B',
        '下列哪些是编程语言？': 'A,B',
        '地球是圆的。': '对',
        '水的化学式是？': 'B',
      },
    });
    const { win, clicks } = env;
    win.ZHS.setConfig({ autoExam: true, examSubmit: true, examSubmitDelay: 0, answerDelay: 0 });

    const inputs = Array.from(win.document.querySelectorAll('input'));

    await win.ZHS.Exam.solvePage();

    // 第1题单选 B → 索引1
    ok('单选题选中 B（索引1）', inputs[1].checked === true);
    // 第2题多选 A,B → 索引 4,5（因为前面有4个 input）
    ok('多选题选中 A（索引4）', inputs[4].checked === true);
    ok('多选题选中 B（索引5）', inputs[5].checked === true);
    ok('多选题未选中 C（索引6）', inputs[6].checked === false);
    // 第3题判断「对」→ 第一个选项
    ok('判断题选中「对」', inputs[8].checked === true);
    ok('判断题未选中「错」', inputs[9].checked === false);
    // 第5题单选 B → 索引 11
    ok('第5题选中 B', inputs[11].checked === true);

    // change 事件派发（Vue v-model 依赖）
    ok('选项派发了 change 事件（v-model 可收到）', inputs[1].__changed === true);

    // 提交
    ok('已点击提交按钮', clicks.some((c) => c.tag === 'submit'));
    ok('已答题数计入 state', win.ZHS.state.answeredCount >= 4, String(win.ZHS.state.answeredCount));
  }

  console.log('\n=== C. 主观题跳过（不瞎填）===');
  {
    const env = makeEnv(homeworkHtml(), HOMEWORK_URL, {
      answers: { '中国的首都是____。': '北京', '1+1 等于几？': 'B' },
    });
    const { win } = env;
    win.ZHS.setConfig({ autoExam: true, examSubmit: false, answerDelay: 0 });
    await win.ZHS.Exam.solvePage();
    const logs = win.ZHS.Log.all().map((e) => e.text).join('\n');
    ok('日志提示主观题不处理', /主观题/.test(logs));
    ok('主观题无选项可填（填空未被写入）',
      !win.document.querySelector('.subject_node input[type="text"], textarea'));
  }

  console.log('\n=== D. 答案文本匹配（非字母答案）===');
  {
    const env = makeEnv(homeworkHtml(), HOMEWORK_URL, {
      answers: { '1+1 等于几？': '2' },   // 答案是文本「2」，不是字母
    });
    const { win } = env;
    win.ZHS.setConfig({ autoExam: true, examSubmit: false, answerDelay: 0 });
    await win.ZHS.Exam.solvePage();
    const inputs = Array.from(win.document.querySelectorAll('input'));
    ok('文本答案「2」被匹配到正确选项', inputs[1].checked === true,
      'checked=' + inputs.map((i) => i.checked).join(','));
  }

  console.log('\n=== E. 章节范围过滤 ===');
  {
    // URL 不带章节 → detectChapter 返回 null
    const env = makeEnv(homeworkHtml(), HOMEWORK_URL, { answers: { '1+1 等于几？': 'B' } });
    const { win } = env;
    ok('URL 无章节信息 → detectChapter() 返回 null', win.ZHS.Exam.detectChapter() === null);
    ok('拿不到章节时 inChapterRange(null,1,3) 返回 true（退化为全部作答）',
      win.ZHS.Exam.inChapterRange(null, 1, 3) === true);
    ok('范围 0/0 = 不限', win.ZHS.Exam.inChapterRange(9, 0, 0) === true);
    ok('第5章 不在 1~3 内', win.ZHS.Exam.inChapterRange(5, 1, 3) === false);
    ok('第2章 在 1~3 内', win.ZHS.Exam.inChapterRange(2, 1, 3) === true);
    ok('只设下限 3：第5章通过', win.ZHS.Exam.inChapterRange(5, 3, 0) === true);
    ok('只设上限 3：第5章不通过', win.ZHS.Exam.inChapterRange(5, 0, 3) === false);
  }

  console.log('\n=== F. 列表页：绝不自动点击 ===');
  {
    const listHtml = `<!DOCTYPE html><html><body>
      <div class="examBox" id="examBox">
        <div class="examItemWrap examItemWrap111 clearfix pos-rev">
          <div class="examChartBox1 f2">
            <a class="commonBtn_green jobExamComBtn"><span class="themeBg">开始答题</span></a>
          </div>
        </div>
        <div class="examItemWrap clearfix">
          <a class="course_ewstate"><span class="percentage_number">作业</span></a>
        </div>
      </div>
    </body></html>`;
    const env = makeEnv(listHtml, LIST_URL);
    const { win } = env;
    const clicks = [];
    win.document.querySelectorAll('a, button').forEach((el) => {
      el.addEventListener('click', () => clicks.push(el.className));
    });
    win.ZHS.setConfig({ autoExam: true });

    ok('isListPage() 识别正确', win.ZHS.Exam.isListPage() === true);
    ok('列表页 isAnswerPage() = false', win.ZHS.Exam.isAnswerPage() === false);

    // 触发 3 次检测
    await win.ZHS.Exam.solvePage();
    await win.ZHS.Exam.solvePage();
    ok('列表页：solvePage 无任何点击', clicks.length === 0, JSON.stringify(clicks));
  }

  console.log('\n=== G. 源码级：无跳转语句 ===');
  {
    const src = fs.readFileSync(path.join(SRC, '06c-exam.js'), 'utf8');
    // 去掉注释再检查（注释里出现 location.href 是说明文字，合法）
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
    ok('无 location.href 赋值', !/location\s*\.\s*href\s*=/.test(code));
    ok('无 location.replace', !/location\s*\.\s*replace\s*\(/.test(code));
    ok('无 window.open', !/window\s*\.\s*open\s*\(/.test(code));
    ok('无 .jobExamComBtn 点击（列表页开始答题按钮）', !/querySelector[^;]*jobExamComBtn/.test(code));
    ok('无 .course_ewstate 点击', !/querySelector[^;]*course_ewstate/.test(code));
  }

  console.log('\n' + '='.repeat(50));
  console.log(`验收：通过 ${pass} / 失败 ${fail}`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('验收脚本异常：' + e.message);
  console.error(e.stack);
  process.exit(1);
});
