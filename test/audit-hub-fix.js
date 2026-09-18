/**
 * 独立审计：课程中心「不再劫持用户点击」修复验证
 *
 * 背景：早先版本 06b-course-hub.js 有无条件自启动，用户只要打开课程中心页，
 * 1.5 秒后课就被点了、还开出新标签 —— 属于劫持用户操作。
 * 本脚本证明修复后该行为已消失，且「自动跳课链」仍然能用。
 *
 * 运行：node test/audit-hub-fix.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let pass = 0, fail = 0;
const results = [];

function ok(name, cond, extra) {
  if (cond) { pass++; results.push('  ✓ ' + name); }
  else { fail++; results.push('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

function section(t) { results.push('\n' + t); }

// ---------- 构造沙箱环境 ----------
function makeEnv(url, bodyHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>' + (bodyHtml || '') + '</body></html>',
    { url: url, pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;

  // 记录所有点击（用文档级捕获监听器，能真实拦到 window.open / element.click）
  const clicks = [];
  window.document.addEventListener('click', (e) => {
    const t = e.target;
    clicks.push({
      tag: t && t.tagName,
      cls: t && String(t.className || ''),
      text: (t && (t.innerText || t.textContent) || '').trim().slice(0, 30),
    });
  }, true);

  // 拦截 window.open，记录被打开的 URL
  const opened = [];
  window.open = function (u) { opened.push(String(u)); return null; };

  // 拦截 location 赋值（jsdom 下 href setter 不可直接改，用 defineProperty 兜）
  const navs = [];
  try {
    const orig = window.location.href;
    Object.defineProperty(window.location, 'href', {
      configurable: true,
      get() { return orig; },
      set(v) { navs.push(String(v)); },
    });
  } catch (e) { /* jsdom 版本差异，忽略 */ }

  // 简易 GM 存储
  const store = {};
  window.GM_getValue = (k, d) => (k in store ? store[k] : d);
  window.GM_setValue = (k, v) => { store[k] = v; };

  window.__clicks = clicks;
  window.__opened = opened;
  window.__navs = navs;
  window.__store = store;

  // 按顺序加载 src（与 build.js 一致的字典序）
  // 注意：必须走 jsdom 的内部 VM context，否则模块里的 window 解析不到
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try {
      vm.runInContext(code, dom.getInternalVMContext(), { filename: f });
    } catch (e) {
      console.log('  [加载 ' + f + ' 出错] ' + e.message);
    }
  }
  return { dom, window, clicks, opened, navs, store };
}

const HUB_URL = 'https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center';
const HUB_CARDS = `
<div class="ai-course-center-body">
  <div class="course-card"><h4>线性代数</h4><span>100%</span><span>已完成</span></div>
  <div class="course-card"><h4>高等数学</h4><span>35%</span></div>
  <div class="course-card"><h4>大学物理</h4><span>0%</span></div>
</div>`;

async function main() {
  results.push('课程中心劫持修复 · 独立审计');
  results.push('='.repeat(50));

  // ---------- A. 默认配置：打开课程中心不该点课 ----------
  section('A. 用户只是打开课程中心（默认配置）');
  {
    const env = makeEnv(HUB_URL, HUB_CARDS);
    const ZHS = env.window.ZHS;
    ok('模块已加载', !!ZHS && !!ZHS.CourseHub);
    ok('autoCoursePick 默认开启', ZHS.config.autoCoursePick === true);

    await ZHS.CourseHub.onPageReady();
    await new Promise((r) => setTimeout(r, 400));

    ok('【核心】未点击任何卡片', env.clicks.length === 0,
      '实际点击 ' + env.clicks.length + ' 次：' + JSON.stringify(env.clicks));
    ok('未打开任何新标签', env.opened.length === 0,
      JSON.stringify(env.opened));
    ok('未发生页面跳转', env.navs.length === 0, JSON.stringify(env.navs));
    ok('未写 intent（无授权凭证）',
      !env.store['zhs-helper-hub'] || !JSON.parse(env.store['zhs-helper-hub']).intent);
  }

  // ---------- B. 模拟"1.5 秒后"的自启动定时器 ----------
  section('B. 页面加载 1.5 秒后的自启动定时器');
  {
    const env = makeEnv(HUB_URL, HUB_CARDS);
    // 手动推进定时器（不等真实 1.5s）
    await new Promise((r) => setTimeout(r, 1800));
    ok('【核心】自启动后仍未点课', env.clicks.length === 0,
      '实际点击 ' + env.clicks.length + ' 次');
    ok('自启动未开新标签', env.opened.length === 0);
  }

  // ---------- C. 自动跳课链：有授权才动手 ----------
  section('C. 自动跳课链（intent.via = auto-hop，已授权）');
  {
    const env = makeEnv(HUB_URL, HUB_CARDS);
    const ZHS = env.window.ZHS;
    // 模拟上一门课学完 → returnToHub 写的授权凭证
    env.store['zhs-helper-hub'] = JSON.stringify({
      rev: 1,
      intent: { courseId: '9001', courseName: '线性代数', via: 'auto-hop', at: Date.now() },
      doneCourses: [{ id: '线性代数', name: '线性代数' }],
      failedCourses: [],
      stats: { hopped: 0, failed: 0 },
    });

    await ZHS.CourseHub.onPageReady();
    await new Promise((r) => setTimeout(r, 1200));

    ok('【核心】有授权时确实尝试进入课程', env.clicks.length > 0,
      '点击 ' + env.clicks.length + ' 次');
    ok('点击的是卡片或卡片内元素',
      env.clicks.every((c) => /course-card|ai-course-center-body/.test(c.cls) || c.tag === 'H4' || c.tag === 'SPAN'),
      JSON.stringify(env.clicks));
  }

  // ---------- D. 关键回归：enterCourse 不再误判失败 ----------
  section('D. enterCourse 返回值语义（不再误拉黑）');
  {
    const env = makeEnv(HUB_URL, HUB_CARDS);
    const ZHS = env.window.ZHS;
    const card = env.window.document.querySelector('.course-card');
    card.click = function () { /* 模拟点击成功但不跳转（新标签场景） */ };

    const r = await ZHS.CourseHub.enterCourse
      ? await ZHS.CourseHub.enterCourse({ el: card, name: '高等数学' })
      : null;

    if (r === null) {
      results.push('  - enterCourse 未对外暴露，跳过本组（检查内部语义）');
    } else {
      ok('【核心】点击成功即返回 true（不因"没跳转"误判失败）', r === true, '返回 ' + r);
    }

    // 反证：失败名单不该被污染
    const hub = env.store['zhs-helper-hub'];
    if (hub) {
      const st = JSON.parse(hub);
      ok('未误把课程加入失败名单',
        !(st.failedCourses || []).some((f) => (f.name || f) === '高等数学'),
        JSON.stringify(st.failedCourses));
    }
  }

  // ---------- E. 源码级红线扫描 ----------
  section('E. 源码红线扫描');
  {
    const src = fs.readFileSync(path.join(SRC, '06b-course-hub.js'), 'utf8');
    // 定位 06b 自己的代码段（它是独立文件）
    ok('无「自动点击开始答题」相关选择器',
      !/jobExamComBtn|course_ewstate|themeBg/.test(src));
    // 自启动必须走 onPageReady 而非 start
    ok('自启动调用的是 onPageReady（安全入口）',
      /CourseHub\.onPageReady\(\)/.test(src) && !/setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{\s*CourseHub\.start\(\)/.test(src));
    ok('onPageReady 在无授权时提前 return',
      /if\s*\(!fromAutoHop\)\s*\{/.test(src));
    // 兜底跳转必须已删除
    const enterBody = src.slice(src.indexOf('async function enterCourse'), src.indexOf('function deriveCourseUrl'));
    ok('enterCourse 内已无 location.href 兜底跳转', !/location\.href\s*=/.test(enterBody));
  }

  // ---------- F. 配置与迁移 ----------
  section('F. 配置与老用户迁移');
  {
    const env = makeEnv(HUB_URL, HUB_CARDS);
    const ZHS = env.window.ZHS;
    // 模拟老用户（configRev=3，无新字段）
    env.store['zhs-helper-config'] = JSON.stringify({ configRev: 3, speed: 1.2, autoAnswer: true });
    const cfg = ZHS.config;
    ok('老用户迁移后 autoCourseHop/autoCoursePick 存在',
      typeof cfg.autoCourseHop === 'boolean' && typeof cfg.autoCoursePick === 'boolean');
    ok('老用户原有配置未丢失（speed=1.2）', cfg.speed === 1.2, String(cfg.speed));
  }

  // ---------- G. 考试模块不越界 ----------
  section('G. 考试模块红线');
  {
    const raw = fs.readFileSync(path.join(SRC, '06c-exam.js'), 'utf8');
    // 先剥掉注释与字符串，只检查真实代码 —— 否则会把「禁用清单」里的
    // location.href / window.open 字样误判成真调用
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')      // 块注释
      .replace(/^\s*\/\/.*$/gm, '')          // 行注释
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")   // 单引号字符串
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')   // 双引号字符串
      .replace(/`(?:[^`\\]|\\.)*`/g, '``');  // 模板串

    ok('考试模块无整页跳转', !/location\.href\s*=|location\.replace|location\.assign/.test(code));
    ok('考试模块无 window.open', !/window\.open/.test(code));

    const cfgSrc = fs.readFileSync(path.join(SRC, '00-config.js'), 'utf8');
    ok('autoExam 默认关闭', /autoExam:\s*false/.test(cfgSrc));
    const fu = cfgSrc.slice(cfgSrc.indexOf('FORCE_UPGRADE'));
    ok('autoExam 未被强制升级（老用户也保持关闭）',
      !/autoExam\s*:/.test(fu.slice(0, fu.indexOf('}'))));
  }

  results.push('\n' + '='.repeat(50));
  results.push('审计：通过 ' + pass + ' / 失败 ' + fail);
  console.log(results.join('\n'));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('审计脚本自身出错：', e);
  process.exit(2);
});
