/**
 * 独立验证：06b-course-hub.js（课程中心调度）
 * 由验证员独立编写，不依赖同事的临时脚本。
 *
 * 环境：jsdom + vm，按 src 字典序全部加载（与 test/run.js 同法），
 *      但只针对 CourseHub 相关逻辑断言。
 *
 * 用法：node test/verify-course-hub.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); console.log('  XX  ' + name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, `得到 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`); }

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 环境构造 ----------
const ENVS = [];
function makeEnv(html, url) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html, {
    url: url || 'https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window;
  const store = {};
  win.GM_setValue = (k, v) => { store[k] = v; };
  win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);

  const SRC = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  const loadErrors = [];
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try { vm.runInContext(code, dom.getInternalVMContext(), { filename: f }); }
    catch (e) { loadErrors.push(f + ': ' + e.message); }
  }
  ENVS.push({ dom, win });
  return { dom, win, store, loadErrors };
}

// 卡片 DOM 构造（模拟同事给的假课程中心）
const HUB_URL = 'https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center';
const STUDENT_URL = 'https://hike-teaching-center.polymas.com/AIstudent/555/666?key=entry';

function cardHtml(name, extra) {
  return `<div class="course-card"><h4>${name}</h4>${extra || ''}</div>`;
}

async function main() {
  console.log('\n### A. 模块加载与自启动安全性 ###');
  {
    // A1: 在「非课程中心、非学习页」的中性页加载，不应有任何副作用
    const { win, loadErrors } = makeEnv('<html><body><div id="x">普通页面</div></body></html>',
      'https://www.zhihuishu.com/random/page');
    ok('模块全部加载无错', loadErrors.length === 0, loadErrors.join(' | '));
    ok('ZHS.CourseHub 已挂载', !!win.ZHS.CourseHub);
    const hub = win.ZHS.CourseHub;
    ok('导出 collectCards/pickNext/enterCourse', typeof hub.collectCards === 'function'
      && typeof hub.pickNext === 'function' && typeof hub.enterCourse === 'function');
    eq('中性页 isHubPage=false', hub.isHubPage(), false);
    eq('中性页 isStudentPage=false', hub.isStudentPage(), false);
    // 等自启动 setTimeout(1500) 触发
    await sleepReal(1800);
    const st = hub.read();
    eq('中性页自启动后 intent 仍为 null（未乱写）', st.intent, null);
    eq('中性页自启动后 doneCourses 为空', st.doneCourses.length, 0);
    eq('中性页自启动后 failedCourses 为空', st.failedCourses.length, 0);
  }

  console.log('\n### B. collectCards / parseCard 解析 ###');
  const hubHtml = `<html><body><div class="ai-course-center-body">
      ${cardHtml('线性代数', '<span>100%</span><span>已完成</span>')}
      ${cardHtml('高等数学', '<span>35%</span>')}
      ${cardHtml('大学物理', '<span>0%</span>')}
    </div></body></html>`;
  {
    const { win } = makeEnv(hubHtml, HUB_URL);
    const hub = win.ZHS.CourseHub;
    const cards = await hub.collectCards();
    eq('collectCards 收集到 3 张卡', cards.length, 3);
    const names = cards.map((c) => c.name);
    ok('卡片名称解析正确', names[0] === '线性代数' && names[1] === '高等数学' && names[2] === '大学物理',
      JSON.stringify(names));
    eq('线性代数 percent=100', cards[0].percent, 100);
    eq('线性代数 finished=true', cards[0].finished, true);
    eq('高等数学 percent=35', cards[1].percent, 35);
    eq('高等数学 finished=false', cards[1].finished, false);
    eq('大学物理 percent=0', cards[2].percent, 0);
    eq('大学物理 finished=false', cards[2].finished, false);
  }

  console.log('\n### C. pickNext 选择逻辑 ###');
  {
    const { win } = makeEnv(hubHtml, HUB_URL);
    const hub = win.ZHS.CourseHub;
    const n1 = await hub.pickNext();
    ok('pickNext 跳过已完成的线性代数，选中高等数学', n1 && n1.name === '高等数学',
      n1 ? n1.name : String(n1));

    // 标记高等数学 done → 应选大学物理
    hub.markCourseDone('高等数学');
    const n2 = await hub.pickNext();
    ok('标记高等数学 done 后选中大学物理', n2 && n2.name === '大学物理', n2 ? n2.name : String(n2));

    // 标记大学物理 failed → 应返回 null
    hub.markCourseFailed('大学物理');
    const n3 = await hub.pickNext();
    eq('标记大学物理 failed 后返回 null（无课可进）', n3, null);
  }

  console.log('\n### D. 开关行为 ###');
  {
    const { win } = makeEnv(hubHtml, HUB_URL);
    const hub = win.ZHS.CourseHub;
    win.ZHS.setConfig({ autoCoursePick: false });
    const n = await hub.pickNext();
    eq('autoCoursePick=false 时 pickNext 返回 null', n, null);

    // returnToHub 开关
    win.ZHS.setConfig({ autoCourseHop: false });
    eq('autoCourseHop=false 时 returnToHub 返回 false', hub.returnToHub(), false);
  }

  console.log('\n### E. enterCourse 写 intent + click ###');
  {
    const { win } = makeEnv(hubHtml, HUB_URL);
    const hub = win.ZHS.CourseHub;
    // 给第一张非完成卡挂 click 记录 + 伪造可见
    const el = win.document.querySelectorAll('.course-card')[1]; // 高等数学
    let clicked = 0;
    el.click = () => { clicked++; };
    // jsdom 无布局 → isVisible 恒 false，会走 scrollIntoView 分支。补一个 scrollIntoView 防抛错。
    el.scrollIntoView = () => {};
    const card = { el, name: '高等数学', percent: 35, finished: false };
    // 包一层计时：enterCourse 内含 sleep(800)
    const okRet = await hub.enterCourse(card);
    ok('enterCourse 调用了 click', clicked >= 1, 'clicked=' + clicked);
    const st = hub.read();
    ok('enterCourse 写了 intent', !!st.intent, JSON.stringify(st.intent));
    eq('intent.courseId = 高等数学', st.intent && st.intent.courseId, '高等数学');
    console.log('     [信息] enterCourse 返回值 =', okRet, '（jsdom 里 isHubPage 仍为 true，故返回 false 属预期）');
  }

  console.log('\n### F. intent 过期逻辑 ###');
  {
    const { win } = makeEnv(hubHtml, HUB_URL);
    const hub = win.ZHS.CourseHub;
    hub.setIntent('c1', '课程一');
    ok('刚写入的 intent 可读', !!hub.getIntent());
    // 回拨 11 分钟
    const st = hub.read();
    st.intent.at = Date.now() - 11 * 60 * 1000;
    hub.write(st);
    eq('回拨 11 分钟后 getIntent 返回 null（过期）', hub.getIntent(), null);
    // 回拨 9 分钟（未过期）
    const st2 = hub.read();
    st2.intent = { courseId: 'c2', courseName: '课程二', at: Date.now() - 9 * 60 * 1000 };
    hub.write(st2);
    ok('回拨 9 分钟后 getIntent 仍有效', !!hub.getIntent());
  }

  console.log('\n### G. 学习页 settleIntent 闭环 ###');
  {
    const { win } = makeEnv('<html><body></body></html>', STUDENT_URL);
    const hub = win.ZHS.CourseHub;
    eq('学习页 isStudentPage=true', hub.isStudentPage(), true);
    hub.setIntent('555', '高等数学');
    const before = hub.stats().hopped;
    const r = hub.settleIntentOnStudentPage();
    eq('settleIntentOnStudentPage 返回 true', r, true);
    eq('intent 已清除', hub.getIntent(), null);
    eq('hopped 统计 +1', hub.stats().hopped, before + 1);
  }

  console.log('\n### H. 无课程中心 DOM 的容错 ###');
  {
    // H1: 有 .ai-course-center-body 但没有卡片
    const { win } = makeEnv('<html><body><div class="ai-course-center-body"></div></body></html>', HUB_URL);
    const hub = win.ZHS.CourseHub;
    let cards, thrown = null;
    try { cards = await hub.collectCards(); } catch (e) { thrown = e; }
    ok('空课程中心 collectCards 不抛异常', !thrown, thrown && thrown.message);
    eq('空课程中心 collectCards 返回空数组', Array.isArray(cards) && cards.length, 0);
    let n, thrown2 = null;
    try { n = await hub.pickNext(); } catch (e) { thrown2 = e; }
    ok('空课程中心 pickNext 不抛异常', !thrown2, thrown2 && thrown2.message);
    eq('空课程中心 pickNext 返回 null', n, null);
  }
  {
    // H2: 完全没有 .ai-course-center-body
    const { win } = makeEnv('<html><body><div>无课程中心</div></body></html>', HUB_URL);
    const hub = win.ZHS.CourseHub;
    let thrown = null, cards;
    try { cards = await hub.collectCards(); } catch (e) { thrown = e; }
    ok('无容器时 collectCards 不抛异常', !thrown, thrown && thrown.message);
    eq('无容器时 collectCards 返回空数组', Array.isArray(cards) && cards.length, 0);
    let thrown2 = null, n;
    try { n = await hub.pickNext(); } catch (e) { thrown2 = e; }
    ok('无容器时 pickNext 不抛异常', !thrown2, thrown2 && thrown2.message);
    eq('无容器时 pickNext 返回 null', n, null);
  }

  console.log('\n### I. parseCard 边界 ###');
  {
    const { win } = makeEnv('<html><body></body></html>', HUB_URL);
    const hub = win.ZHS.CourseHub;
    const D = win.document;
    // null / undefined
    eq('parseCard(null) 返回 null', hub.parseCard(null), null);
    eq('parseCard(undefined) 返回 null', hub.parseCard(undefined), null);
    // 空元素
    const empty = D.createElement('div');
    const r1 = hub.parseCard(empty);
    ok('空元素 parseCard 不崩（返回对象或 null）', r1 === null || typeof r1 === 'object', String(r1));
    // 无 h4 的卡片，应降级用 textContent
    const noH4 = D.createElement('div');
    noH4.innerHTML = '<span>离散数学</span><span>50%</span>';
    const r2 = hub.parseCard(noH4);
    ok('无 h4 时降级取名非空', r2 && !!r2.name, r2 && JSON.stringify(r2.name));
    eq('无 h4 时 percent 解析为 50', r2 && r2.percent, 50);
    // 文本 "已完成" 无百分比
    const finishTxt = D.createElement('div');
    finishTxt.innerHTML = '<h4>英语</h4><span>已完成</span>';
    const r3 = hub.parseCard(finishTxt);
    eq('只有「已完成」无百分比 → finished=true', r3 && r3.finished, true);
    eq('只有「已完成」时 percent=null', r3 && r3.percent, null);
    // "abc%"
    const abc = D.createElement('div');
    abc.innerHTML = '<h4>化学</h4><span>abc%</span>';
    const r4 = hub.parseCard(abc);
    eq('"abc%" → percent=null', r4 && r4.percent, null);
    eq('"abc%" → finished=false', r4 && r4.finished, false);
    // "100" 无百分号
    const noPct = D.createElement('div');
    noPct.innerHTML = '<h4>生物</h4><span>100</span>';
    const r5 = hub.parseCard(noPct);
    eq('"100" 无百分号 → percent=null', r5 && r5.percent, null);
    eq('"100" 无百分号 → finished=false', r5 && r5.finished, false);
    // 边界：99% 未完成
    const n99 = D.createElement('div');
    n99.innerHTML = '<h4>地理</h4><span>99%</span>';
    const r6 = hub.parseCard(n99);
    eq('99% → finished=false', r6 && r6.finished, false);
    // 0% 不出错
    const n0 = D.createElement('div');
    n0.innerHTML = '<h4>历史</h4><span>0%</span>';
    const r7 = hub.parseCard(n0);
    eq('0% → percent=0', r7 && r7.percent, 0);
  }

  console.log('\n### J. collectCards 滚动安全上限 ###');
  {
    // 关键：容器 scrollHeight 每次读都变大，模拟虚拟滚动永不收敛。
    // 若循环有安全上限，应在有限时间内返回，不应死循环。
    const { win } = makeEnv(`<html><body><div class="ai-course-center-body">
        ${cardHtml('课程A', '<span>10%</span>')}
      </div></body></html>`, HUB_URL);
    const hub = win.ZHS.CourseHub;
    const body = win.document.querySelector('.ai-course-center-body');
    let grow = 100;
    Object.defineProperty(body, 'scrollHeight', { get() { grow += 1000; return grow; }, configurable: true });
    Object.defineProperty(body, 'clientHeight', { get() { return 10; }, configurable: true });
    // 把 U.sleep 换成极短，避免 30*300ms 太慢（只验证有上限，不测真实时序）
    win.ZHS.Util.sleep = () => Promise.resolve();
    const t0 = Date.now();
    const cards = await hub.collectCards();
    const dt = Date.now() - t0;
    ok('scrollHeight 无限增长时 collectCards 仍能返回（有上限）', Array.isArray(cards));
    ok('未卡死（耗时 < 10s）', dt < 10000, dt + 'ms');
    eq('仍能收集到那 1 张卡', cards.length, 1);
  }

  console.log('\n### K. 配置迁移：老用户 3 → 4 ###');
  {
    const { win, store } = makeEnv('<html><body></body></html>', HUB_URL);
    // 模拟老用户：预置 configRev=3，无新字段
    const oldCfg = { configRev: 3, speed: 1.2, mute: false, bankUrl: 'http://localhost:9999',
      autoPlay: false, llmKey: 'sk-old-key', stopMode: 'minutes', stopMinutes: 33 };
    store['zhs-helper-config'] = JSON.stringify(oldCfg);
    // 触发一次 getConfig —— 但模块已在加载时读过一次配置，这里直接再读
    const cfg = win.ZHS.config;
    eq('迁移后 autoCourseHop=true', cfg.autoCourseHop, true);
    eq('迁移后 autoCoursePick=true', cfg.autoCoursePick, true);
    eq('迁移后 configRev=5', cfg.configRev, 5);
    // 老字段不丢
    eq('老字段 speed 保留', cfg.speed, 1.2);
    eq('老字段 mute 保留', cfg.mute, false);
    eq('老字段 bankUrl 保留', cfg.bankUrl, 'http://localhost:9999');
    eq('老字段 llmKey 保留', cfg.llmKey, 'sk-old-key');
    eq('老字段 stopMode 保留', cfg.stopMode, 'minutes');
    eq('老字段 stopMinutes 保留', cfg.stopMinutes, 33);
    // 写回后的存储里也要有
    const persisted = JSON.parse(store['zhs-helper-config']);
    eq('落盘的 configRev=5', persisted.configRev, 5);
    eq('落盘的 autoCourseHop=true', persisted.autoCourseHop, true);
    eq('落盘的 llmKey 未丢', persisted.llmKey, 'sk-old-key');
  }

  console.log('\n### L. 已完成用户不会被反复迁移降级（手动关过开关要尊重）###');
  {
    const { win, store } = makeEnv('<html><body></body></html>', HUB_URL);
    // 用户已经是 rev5（当前版本），且手动把 autoCourseHop/autoCoursePick 关了
    store['zhs-helper-config'] = JSON.stringify({ configRev: 5, autoCourseHop: false, autoCoursePick: false, speed: 1.5 });
    const cfg = win.ZHS.config;
    eq('rev5 用户手动关的 autoCourseHop 被尊重（仍 false）', cfg.autoCourseHop, false);
    eq('rev5 用户手动关的 autoCoursePick 被尊重（仍 false）', cfg.autoCoursePick, false);
  }

  console.log('\n### M. saveConfig 不丢字段 ###');
  {
    const { win } = makeEnv('<html><body></body></html>', HUB_URL);
    const Z = win.ZHS;
    Z.setConfig({ autoCourseHop: true, autoCoursePick: true });
    Z.setConfig({ autoCoursePick: false });
    const cfg = Z.config;
    eq('saveConfig 后 autoCourseHop 仍在', cfg.autoCourseHop, true);
    eq('saveConfig 后 autoCoursePick 已关', cfg.autoCoursePick, false);
    eq('saveConfig 后 configRev=5', cfg.configRev, 5);
    eq('saveConfig 后 speed 未丢', cfg.speed, 1.5);
  }

  console.log('\n### N. 死循环防护：failedCourses 真能拦住反复选到进入失败的课 ###');
  {
    const { win } = makeEnv(hubHtml, HUB_URL);
    const hub = win.ZHS.CourseHub;
    // v0.6.0 后 enterCourse 不再返回 false（点击成功即视为已发出进入请求，
    //   成功与否由学习页 settleIntentOnStudentPage 回写判定），故"进入失败"走这里：
    // 直接模拟「学习页回写判定进入失败」→ markCourseFailed 写入黑名单，
    // 验证 pickNext 会跳过它、改选下一门，避免反复选同一门死循环。
    hub.markCourseFailed('高等数学');
    let n2 = await hub.pickNext();
    // 防 CourseHub.start() 自启动的 runOnHub 扫描竞态（_scanning 期间 pickNext 返回 null），等待后重试一次
    if (!n2) { await sleepReal(1200); n2 = await hub.pickNext(); }
    ok('标记高等数学失败后，pickNext 跳过它改选大学物理', n2 && n2.name === '大学物理',
      n2 ? n2.name : String(n2));
    hub.markCourseFailed('大学物理');
    const n3 = await hub.pickNext();
    eq('两门都失败后返回 null（不会无限重试）', n3, null);
  }

  console.log('\n### O. 全局副作用检查 ###');
  {
    const { win } = makeEnv(hubHtml, HUB_URL);
    // 记录模块加载时是否动了 window.open / location 之类
    ok('未覆盖 window.open', typeof win.open === 'function' && !win.open.__zhsPatched,
      'window.open=' + String(win.open).slice(0, 40));
    // CourseHub 暴露面是否最小（不应暴露到 window 顶层额外全局）
    const extraGlobals = ['CourseHub', 'collectCards', 'pickNext'];
    const leaked = extraGlobals.filter((k) => typeof win[k] !== 'undefined');
    eq('未泄漏到 window 顶层', leaked.length, 0, leaked.join(','));
    ok('仅挂载在 ZHS 命名空间下', !!win.ZHS.CourseHub);
  }

  console.log('\n### P. 关键缺陷的回归守护（防止回退）###');
  {
    // P1: v0.6.0 修复 _scanning 竞态——并发 pickNext 共享同一 in-flight 扫描 Promise，不再返回假性 null
    const { win } = makeEnv(hubHtml, HUB_URL);
    const hub = win.ZHS.CourseHub;
    const p1 = hub.pickNext();
    await sleepReal(50);
    const p2 = await hub.pickNext();
    const r1 = await p1;
    ok('P1 守护：并发 pickNext 不再返回假性 null（共享扫描结果，两次同门）',
      !!p2 && !!r1 && p2.name === r1.name,
      'first=' + (r1 && r1.name) + ' second=' + (p2 && p2.name));
  }
  {
    // P2: v0.6.0 修复——enterCourse 不再用 isHubPage() 判成功（新标签跳转当前页仍停中心页，
    //   旧逻辑因此恒返 false 误拉黑能学的课）。点击未抛异常 + intent 已写 = 已发出进入请求 → 返回 true。
    const { win } = makeEnv(hubHtml, HUB_URL);
    const hub = win.ZHS.CourseHub;
    const el = win.document.querySelectorAll('.course-card')[1];
    el.scrollIntoView = () => {};
    let opened = false;
    win.open = () => { opened = true; return {}; };
    el.click = () => { win.open('https://x'); };   // 平台开新标签，当前页不导航
    const r = await hub.enterCourse({ el, name: '高等数学', percent: 35, finished: false });
    ok('P2 守护：成功点开新标签后 enterCourse 返回 true（不再误判失败）',
      opened === true && r === true, 'opened=' + opened + ' ret=' + r);
  }
  {
    // P3: doneCourses 键命名空间不一致 —— 学习页写 recruitAndCourseId，卡片键是 data-course-id
    const { win } = makeEnv(hubHtml, HUB_URL);
    const hub = win.ZHS.CourseHub;
    hub.markCourseDone('9001');   // 模拟学习页 ZHS.state.courseId
    const n = await hub.pickNext();
    ok('P3 复现：doneCourses 用数字 id 记录时，卡片仍会被选中（键不同源）',
      !!n, 'pickNext=' + (n ? n.name : String(n)));
  }

  // ---------- 收尾 ----------
  for (const { dom } of ENVS) { try { dom.window.close(); } catch (e) {} }
  console.log('\n==================================================');
  console.log(`独立验证 通过 ${pass} / 失败 ${fail}`);
  if (fail) { console.log('失败项：'); fails.forEach((f) => console.log('  - ' + f)); }
  else console.log('全部通过');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('验证脚本自身出错：', e); process.exit(2); });
