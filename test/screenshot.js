/**
 * 截屏测试：在真实 Chrome 里加载仿真智慧树页面，注入油猴脚本，截图 + 断言
 *
 * 覆盖：
 *  T1 播放页  — 脚本注入、版本识别、倍速设置、静音、面板渲染、续播记录
 *  T2 弹题页  — 弹题识别、题目采集、答题（题库+LLM 双通道打桩）、回填、关闭
 *  T3 作业页  — 题目批量采集、批量作答
 *
 * 产物：test/screenshots/*.png
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(__dirname, 'screenshots');
const SCRIPT = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

fs.mkdirSync(SHOT_DIR, { recursive: true });

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (extra ? ' → ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `得到 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
}

/**
 * 把油猴脚本包装成可在页面里 eval 的形式（打桩 GM_* API）
 *
 * 关键：GM_setValue 的存储对象挂在 window 上并对外可见，
 * 断言时才能读到脚本写进去的续播记录。
 */
function buildInjectableScript() {
  const raw = fs.readFileSync(SCRIPT, 'utf8');
  // 去掉油猴脚本头
  const body = raw.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/, '');
  return `
(function(){
  window.__SHOT_LOGS__ = [];
  // 用原生 setter 写，避免被页面其它脚本的 defineProperty 干扰
  var _store = Object.create(null);
  Object.defineProperty(window, '__SHOT_STORE__', {
    get: function(){ return _store; },
    configurable: true
  });
  window.GM_setValue = function(k, v){ _store[k] = v; };
  window.GM_getValue = function(k, d){ return _store[k] !== undefined ? _store[k] : d; };
  window.GM_deleteValue = function(k){ delete _store[k]; };
  // 打桩网络层：题库与 LLM 都返回预设答案
  window.GM_xmlhttpRequest = function(opts) {
    window.__SHOT_LOGS__.push('[net] ' + opts.method + ' ' + opts.url);
    let respText = '{}';
    let status = 200;
    if (opts.url.includes('/adapter-service/search')) {
      // 题库：命中第一题答案 A
      respText = JSON.stringify({ code: 200, data: { answers: ['A'], from: 'mock-bank' } });
    } else if (opts.url.includes('/chat/completions')) {
      // LLM：返回 A
      respText = JSON.stringify({ choices: [{ message: { content: 'A' } }] });
    } else {
      status = 404; respText = '{}';
    }
    setTimeout(function() {
      if (opts.onload) opts.onload({ status: status, responseText: respText });
    }, 30);
  };
  try {
    ${body}
  } catch (e) {
    window.__SHOT_ERROR__ = e.message + ' | ' + (e.stack || '').split('\\n')[1];
  }
})();
`;
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('智慧树助手')) console.log('    [页面] ' + t.slice(0, 120));
  });
  page.on('pageerror', (e) => console.log('    [页面错误] ' + e.message));
  return page;
}

async function shot(page, name) {
  const file = path.join(SHOT_DIR, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log('    → 截图: ' + name);
  return file;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--mute-audio',
    ],
  });

  try {
    // ============================================================
    console.log('\n=== T1 播放页（仿真） ===');
    {
      const page = await newPage(browser);
      const url = 'file:///' + path.join(__dirname, 'fixture-player.html').replace(/\\/g, '/')
        + '?recruitAndCourseId=4e5f5b5c4c5b4859454a585958435f475a';
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 800));

      await shot(page, 'T1-01-页面初始.png');

      // 注入脚本
      await page.evaluate(buildInjectableScript());
      await new Promise((r) => setTimeout(r, 2500));

      const err = await page.evaluate(() => window.__SHOT_ERROR__ || null);
      ok('脚本无注入错误', !err, err);

      const hasZhs = await page.evaluate(() => !!window.ZHS);
      ok('ZHS 命名空间存在', hasZhs);

      const ver = await page.evaluate(() => window.ZHS && window.ZHS.state.siteVersion);
      eq('识别为 wisdom 版', ver, 'wisdom');

      const courseId = await page.evaluate(() => window.ZHS && window.ZHS.state.courseId);
      eq('课程 ID 正确', courseId, '4e5f5b5c4c5b4859454a585958435f475a');

      const lesson = await page.evaluate(() => window.ZHS && window.ZHS.state.lessonKey);
      ok('当前课时已识别', !!lesson && lesson.includes('1.2'), lesson);

      // 目录采集
      const items = await page.evaluate(() => window.ZHS.Catalog.items().length);
      eq('采集到 5 个章节', items, 5);

      const stats = await page.evaluate(() => window.ZHS.Catalog.stats());
      eq('已完成 1 个', stats.done, 1);
      eq('总数 5', stats.total, 5);

      const next = await page.evaluate(() => {
        const n = window.ZHS.Catalog.findNext(window.ZHS.Catalog.current());
        return n ? window.ZHS.Catalog.itemTitle(n) : null;
      });
      eq('下一节 = 1.3 分层模型', next, '1.3 分层模型');

      // 播放控制
      await new Promise((r) => setTimeout(r, 1500));
      const rate = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? v.playbackRate : null;
      });
      ok('倍速已设为 1.5', Math.abs(rate - 1.5) < 0.01, String(rate));

      const volume = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? v.volume : null;
      });
      eq('音量已静音为 0', volume, 0);

      const playing = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? !v.paused : null;
      });
      ok('视频处于播放状态（未被平台暂停策略卡住）', playing === true, String(playing));

      await shot(page, 'T1-02-脚本生效.png');

      // 面板渲染
      const panelExists = await page.evaluate(() => !!document.getElementById('zhs-helper-panel'));
      ok('悬浮面板已挂载', panelExists);

      const panelHasShadow = await page.evaluate(() => {
        const h = document.getElementById('zhs-helper-panel');
        return !!(h && h.shadowRoot);
      });
      ok('面板使用 Shadow DOM 隔离', panelHasShadow);

      // 等视频跑过 5 秒（续播记录的前 5 秒守卫），再让面板刷新
      // 打桩媒体按 playbackRate 推进，1.5x 下约 4 秒过线
      await new Promise((r) => setTimeout(r, 5000));
      await shot(page, 'T1-03-控制面板.png');

      // 面板内容快照：读各字段而不是整段 textContent
      // （整段 textContent 含 <style> 里的 CSS 文本，会误判）
      const fields = await page.evaluate(() => {
        const h = document.getElementById('zhs-helper-panel');
        if (!h || !h.shadowRoot) return null;
        const q = (s) => {
          const el = h.shadowRoot.querySelector(s);
          return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
        };
        return {
          run: q('.s-run'),
          ver: q('.s-ver'),
          lesson: q('.s-lesson'),
          vprog: q('.s-vprog'),
          cprog: q('.s-cprog'),
          ans: q('.s-ans'),
        };
      });
      ok('面板已渲染出字段', !!fields && fields.run !== null);
      eq('面板显示运行状态', fields && fields.run, '运行中');
      eq('面板显示页面版本', fields && fields.ver, 'wisdom');
      ok('面板显示当前课时', !!(fields && fields.lesson && fields.lesson.includes('1.2')), fields && fields.lesson);
      ok('面板显示课程完成度 1/5', !!(fields && fields.cprog && /^1\/5/.test(fields.cprog)), fields && fields.cprog);
      ok('面板视频进度为数字', !!(fields && fields.vprog && /\d+%/.test(fields.vprog)), fields && fields.vprog);

      // 续播记录
      const resumeStore = await page.evaluate(() => {
        const raw = window.__SHOT_STORE__ && window.__SHOT_STORE__['zhs-helper-resume'];
        if (raw) return raw;
        // 兜底：脚本可能降级写到 localStorage
        return window.localStorage.getItem('zhs-helper-resume');
      });
      ok('续播记录已写入 GM 存储', !!resumeStore, '存储键：' + Object.keys(await page.evaluate(() => window.__SHOT_STORE__ || {})).join(','));

      if (resumeStore) {
        const parsed = JSON.parse(resumeStore);
        const rec = parsed.courses['4e5f5b5c4c5b4859454a585958435f475a'];
        ok('记录含当前课时', !!rec && rec.lessonKey === '1.2 网络协议基础', JSON.stringify(rec));
        ok('记录含播放时间', !!rec && typeof rec.time === 'number');
      }

      // 切到日志页截图
      await page.evaluate(() => {
        const h = document.getElementById('zhs-helper-panel');
        const btns = h.shadowRoot.querySelectorAll('.tabs button');
        if (btns[1]) btns[1].click();
      });
      await new Promise((r) => setTimeout(r, 800));
      await shot(page, 'T1-04-日志页.png');

      // 切到设置页截图
      await page.evaluate(() => {
        const h = document.getElementById('zhs-helper-panel');
        const btns = h.shadowRoot.querySelectorAll('.tabs button');
        if (btns[2]) btns[2].click();
      });
      await new Promise((r) => setTimeout(r, 800));
      await shot(page, 'T1-05-设置页.png');

      const cfgText = await page.evaluate(() => {
        const h = document.getElementById('zhs-helper-panel');
        return h.shadowRoot.textContent.replace(/\s+/g, ' ');
      });
      ok('设置页含答题开关', cfgText.includes('AI 自动答题'));
      ok('设置页含题库地址', cfgText.includes('题库地址'));
      ok('设置页含 LLM Key', cfgText.includes('LLM Key'));

      await page.close();
    }

    // ============================================================
    console.log('\n=== T2 弹题页（仿真） ===');
    {
      const page = await newPage(browser);
      const url = 'file:///' + path.join(__dirname, 'fixture-dialog.html').replace(/\\/g, '/')
        + '?recruitAndCourseId=test-dialog-001';
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 600));

      await shot(page, 'T2-01-弹题出现.png');

      await page.evaluate(buildInjectableScript());
      await new Promise((r) => setTimeout(r, 1200));

      // 开启自动答题
      await page.evaluate(() => {
        window.ZHS.setConfig({ autoAnswer: true, answerMode: 'both', bankEnabled: true, llmEnabled: true, llmKey: 'sk-test', answerDelay: 0 });
      });

      const scene = await page.evaluate(() => window.ZHS.Questions.scene());
      eq('场景识别为 dialog', scene, 'dialog');

      const present = await page.evaluate(() => window.ZHS.Questions.Dialog.present());
      ok('弹题被检出', present);

      const collected = await page.evaluate(() => window.ZHS.Questions.Dialog.collect().length);
      eq('采集到 2 个分页', collected, 2);

      const cur = await page.evaluate(() => {
        const q = window.ZHS.Questions.Dialog.readCurrent();
        return { title: q.title, options: q.options.length, type: q.type };
      });
      ok('读到题干（含 TCP）', cur.title.includes('TCP'), cur.title.slice(0, 30));
      eq('读到 4 个选项', cur.options, 4);
      eq('题型 single', cur.type, 'single');

      // 触发自动答题
      await page.evaluate(() => window.ZHS.Answerer.handleDialog());
      await new Promise((r) => setTimeout(r, 4000));

      await shot(page, 'T2-02-自动答题后.png');

      const answered = await page.evaluate(() => window.ZHS.state.answeredCount);
      ok('已作答计数 > 0', answered > 0, String(answered));

      const picked = await page.evaluate(() => document.querySelectorAll('.topic .radio ul li.picked').length);
      ok('页面上有选项被选中', picked > 0, String(picked));

      const dialogHidden = await page.evaluate(() => {
        const d = document.getElementById('playTopic-dialog');
        return !d || d.style.display === 'none';
      });
      ok('弹题已关闭', dialogHidden);

      const netLogs = await page.evaluate(() => window.__SHOT_LOGS__.filter((l) => l.includes('net')));
      ok('调用了题库接口', netLogs.some((l) => l.includes('/adapter-service/search')), JSON.stringify(netLogs));

      const solverStats = await page.evaluate(() => window.ZHS.Solver.stats);
      ok('题库通道命中', solverStats.bank > 0, JSON.stringify(solverStats));

      await page.close();
    }

    // ============================================================
    console.log('\n=== T3 作业页（仿真） ===');
    {
      const page = await newPage(browser);

      // 动态构造作业页 DOM
      await page.goto('about:blank');
      await page.setContent(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px;background:#f5f5f5">
        <h2 style="font-size:16px">共享课作业（仿真）</h2>
        <div class="subject_node" style="background:#fff;padding:16px;margin-bottom:12px;border-radius:6px">
          <div class="subject_type" style="font-size:12px;color:#888">单选题</div>
          <div class="question-topic" style="margin:8px 0;font-size:14px">违反安全保障义务责任属于（）</div>
          <label class="nodeLab" style="display:block;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px"><input type="radio" name="q1">A. 公平责任</label>
          <label class="nodeLab" style="display:block;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px"><input type="radio" name="q1">B. 特殊侵权责任</label>
          <label class="nodeLab" style="display:block;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px"><input type="radio" name="q1">C. 过错推定责任</label>
          <label class="nodeLab" style="display:block;padding:8px;border:1px solid #ddd;border-radius:4px"><input type="radio" name="q1">D. 连带责任</label>
        </div>
        <div class="subject_node" style="background:#fff;padding:16px;margin-bottom:12px;border-radius:6px">
          <div class="subject_type" style="font-size:12px;color:#888">多选题</div>
          <div class="question-topic" style="margin:8px 0;font-size:14px">面向对象的三大特性包括（）</div>
          <label class="nodeLab" style="display:block;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px"><input type="checkbox" name="q2">A. 封装</label>
          <label class="nodeLab" style="display:block;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px"><input type="checkbox" name="q2">B. 继承</label>
          <label class="nodeLab" style="display:block;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px"><input type="checkbox" name="q2">C. 多态</label>
          <label class="nodeLab" style="display:block;padding:8px;border:1px solid #ddd;border-radius:4px"><input type="checkbox" name="q2">D. 编译</label>
        </div>
        <div class="subject_node" style="background:#fff;padding:16px;border-radius:6px">
          <div class="subject_type" style="font-size:12px;color:#888">判断题</div>
          <div class="question-topic" style="margin:8px 0;font-size:14px">HTTP 是无状态协议</div>
          <label class="nodeLab" style="display:block;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px"><input type="radio" name="q3">对</label>
          <label class="nodeLab" style="display:block;padding:8px;border:1px solid #ddd;border-radius:4px"><input type="radio" name="q3">错</label>
        </div>
        <div id="result" style="margin-top:16px;padding:12px;background:#eaf7f2;border-radius:6px;font-size:13px">等待作答…</div>
      </body></html>`);
      await new Promise((r) => setTimeout(r, 500));

      await shot(page, 'T3-01-作业页.png');

      await page.evaluate(buildInjectableScript());
      await new Promise((r) => setTimeout(r, 1200));

      // 作业页需要手动触发（默认 answerHomework=false）
      await page.evaluate(() => {
        window.ZHS.setConfig({ autoAnswer: true, answerHomework: true, answerMode: 'both', bankEnabled: true, llmEnabled: true, llmKey: 'sk-test', answerDelay: 0 });
      });

      const scene = await page.evaluate(() => window.ZHS.Questions.scene());
      eq('场景识别为 homework', scene, 'homework');

      const list = await page.evaluate(() => {
        return window.ZHS.Questions.Homework.collect().map((q) => ({ type: q.type, n: q.options.length, title: q.title.slice(0, 20) }));
      });
      eq('采集到 3 题', list.length, 3);
      eq('第1题 single', list[0].type, 'single');
      eq('第2题 multiple', list[1].type, 'multiple');
      eq('第3题 judgement', list[2].type, 'judgement');

      // 触发批量作答
      await page.evaluate(() => window.ZHS.Answerer.handleHomework());
      await new Promise((r) => setTimeout(r, 5000));

      await shot(page, 'T3-02-自动作答后.png');

      const checkedState = await page.evaluate(() => {
        const nodes = document.querySelectorAll('.subject_node');
        return Array.from(nodes).map((n) => {
          const inputs = n.querySelectorAll('input');
          return Array.from(inputs).filter((i) => i.checked).length;
        });
      });
      ok('第1题已选 1 项', checkedState[0] === 1, JSON.stringify(checkedState));
      ok('第2题已选至少 1 项', checkedState[1] >= 1, JSON.stringify(checkedState));
      ok('第3题已选 1 项', checkedState[2] === 1, JSON.stringify(checkedState));

      const total = await page.evaluate(() => window.ZHS.state.answeredCount);
      ok('总作答数 >= 3', total >= 3, String(total));

      await page.close();
    }

    // ============================================================
    console.log('\n=== T4 断点续播（跨页面恢复） ===');
    {
      const page = await newPage(browser);
      const url = 'file:///' + path.join(__dirname, 'fixture-player.html').replace(/\\/g, '/')
        + '?recruitAndCourseId=resume-test-999';
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 600));

      // 第一次：注入 + 预置续播记录
      await page.evaluate(buildInjectableScript());
      await new Promise((r) => setTimeout(r, 1500));

      await page.evaluate(() => {
        // 手动写一条记录，指向"1.3 分层模型" @ 45s / 总时长 60s
        // 注意：仿真视频桩时长为 300s，与记录里的 60s 不等，
        // 会触发「按比例换算」分支 → 45/60*300 = 225s，这是预期行为
        window.ZHS.Resume.save('resume-test-999', '1.3 分层模型', 45, 60);
        window.ZHS.Resume.reset();
      });

      const saved = await page.evaluate(() => {
        const s = window.__SHOT_STORE__['zhs-helper-resume'];
        return JSON.parse(s).courses['resume-test-999'];
      });
      eq('记录已写入', saved.lessonKey, '1.3 分层模型');
      eq('记录时间 45s', saved.time, 45);

      await shot(page, 'T4-01-记录已存.png');

      // 恢复
      const restored = await page.evaluate(async () => {
        const r = await window.ZHS.Resume.restore('resume-test-999');
        return r;
      });
      await new Promise((r) => setTimeout(r, 2500));

      await shot(page, 'T4-02-恢复后.png');

      const curLesson = await page.evaluate(() => {
        const c = window.ZHS.Catalog.current();
        return c ? window.ZHS.Catalog.itemTitle(c) : null;
      });
      ok('恢复到日志中记录的课时 1.3 分层模型', curLesson === '1.3 分层模型', String(curLesson));

      // 播放位置的形态：打桩媒体下 currentTime 是可控的真实值；
      // 若走真实 mp4，seek 在 headless 里可能被丢弃 → 只断言「拿到了合法位置」
      const probe = await page.evaluate(() => {
        const v = document.querySelector('video');
        const meta = v && v.__rawDuration ? { mode: 'stub', dur: v.__rawDuration() } : { mode: 'real' };
        return { t: v ? v.currentTime : -1, meta };
      });
      if (probe.meta.mode === 'stub') {
        // 记录 45s/60s，桩时长 300s → 按比例换算 225s；
        // 若时长一致则是 45-2=43s。两种都算恢复成功。
        // 打桩媒体会继续按倍速推进，容差给宽一点
        const expectedRatio = (45 / 60) * probe.meta.dur;
        const okRatio = probe.t >= expectedRatio - 5 && probe.t <= expectedRatio + 15;
        const okDirect = probe.t >= 42 && probe.t <= 55;
        ok('播放位置恢复正确（比例换算或直接定位）',
          okRatio || okDirect,
          't=' + probe.t.toFixed(1) + 's 比例换算期望≈' + expectedRatio.toFixed(0) + 's');
      } else {
        ok('播放位置为合法值', probe.t >= 0, String(probe.t));
        console.log('    （真实 mp4 模式下 headless 可能丢弃 seek，仅做合法值检查）');
      }

      const resumeLogs = await page.evaluate(() =>
        window.ZHS.Log.all().filter((e) => /续播|恢复|切换/.test(e.text)).map((e) => e.text)
      );
      ok('日志记录了恢复流程', resumeLogs.length > 0, JSON.stringify(resumeLogs.slice(-3)));
      console.log('    [恢复日志] ' + resumeLogs.slice(-3).join(' | '));

      await page.close();
    }

  } finally {
    await browser.close();
  }

  console.log('\n' + '='.repeat(52));
  console.log(`截屏测试：通过 ${pass} / 失败 ${fail}`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
  }
  const shots = fs.readdirSync(SHOT_DIR).filter((f) => f.endsWith('.png'));
  console.log(`\n生成截图 ${shots.length} 张 → test/screenshots/`);
  shots.sort().forEach((f) => console.log('  · ' + f));

  process.exit(fail ? 1 : 0);
})();
