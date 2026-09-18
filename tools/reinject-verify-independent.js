/**
 * 独立验证：dist 产物多次注入的重入守卫是否真的生效
 *
 * 与 tools/reinject-check.js 完全独立编写：
 *  - 不复用其任何函数/断言
 *  - 自己包一层 setInterval/setTimeout 计数（不依赖产物暴露的内部计数器）
 *  - 自己做 E 反向测试（破坏守卫 → 必须出现定时器叠加），用来证明检测方法本身有效
 *
 * 只读：不改 src/ 与 dist/ 里任何业务代码。产物在内存里做字符串替换。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');
const PKG_VERSION = require(path.join(ROOT, 'package.json')).version;

// ---------- 工具：统计 ----------
const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass, actual, expected });
  console.log((pass ? '  PASS ' : '  FAIL ') + name
    + ' → 实际=' + JSON.stringify(actual) + ' 期望=' + JSON.stringify(expected));
  return pass;
}

/**
 * 在全新 window 里注入 dist 产物 N 次，统计定时器与异常。
 * @param {string} code  要注入的 JS（默认 dist 原文；E 阶段传被改坏的副本）
 * @param {number} times 注入次数
 */
function inject(code, times) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=abc123',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window;

  // 平台 API 桩：产物里 00-config / 04-resume 会用到
  const store = {};
  win.GM_setValue = (k, v) => { store[k] = v; };
  win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);

  // ---- 自己拦 setInterval / setTimeout（在注入前就装好）----
  const intervals = [];   // 每次 setInterval 记一笔
  const timeouts = [];
  const origSetInterval = win.setInterval.bind(win);
  const origSetTimeout = win.setTimeout.bind(win);
  win.setInterval = function (fn, ms) {
    intervals.push(ms);
    return origSetInterval(fn, ms);
  };
  win.setTimeout = function (fn, ms) {
    timeouts.push(ms);
    return origSetTimeout(fn, ms);
  };

  const errors = [];
  const perInject = [];
  for (let i = 1; i <= times; i++) {
    const before = intervals.length;
    try {
      vm.runInContext(code, dom.getInternalVMContext(), { filename: 'dist-inject#' + i });
    } catch (e) {
      errors.push({ round: i, message: e && e.message });
    }
    perInject.push(intervals.length - before);
  }

  // 让 boot() 的异步链条跑一会儿，然后统计
  return new Promise((resolve) => {
    setTimeout(() => {
      const out = {
        intervalCounts: perInject,                       // 每次注入新增的 interval 数
        intervalMs: intervals.slice(),                   // 全部 interval 的间隔
        timeoutCount: timeouts.length,
        errors,
        helperFlag: win.__ZHS_HELPER__,
        version: win.ZHS && win.ZHS.version,
        panelCount: win.document.querySelectorAll('#zhs-helper-panel').length,
        refreshTimers: intervals.filter((ms) => ms === 1500).length,   // 06-panel 的 refresh
        examTimers: intervals.filter((ms) => ms === 3000).length,      // 06c-exam 的 tick
        navTimers: intervals.filter((ms) => ms === 2000).length,       // 05-scheduler 主循环
        setTimeoutMs: timeouts.slice(0, 40),
      };
      try { win.close(); } catch (e) { /* ignore */ }
      resolve(out);
    }, 600);
  });
}

(async () => {
  const raw = fs.readFileSync(DIST, 'utf8');

  console.log('\n===== C. dist 产物注入 4 次 =====');
  const c = await inject(raw, 4);
  console.log('  每次注入新增 interval 数：' + JSON.stringify(c.intervalCounts));
  console.log('  interval 间隔分布：' + JSON.stringify(c.intervalMs));
  console.log('  setTimeout 调用数：' + c.timeoutCount);
  console.log('  异常：' + JSON.stringify(c.errors));
  console.log('  __ZHS_HELPER__ = ' + c.helperFlag + ' / ZHS.version = ' + c.version
    + ' / 面板数 = ' + c.panelCount);
  console.log('  分项：1500ms(panel)=' + c.refreshTimers
    + '  3000ms(exam)=' + c.examTimers + '  2000ms(scheduler)=' + c.navTimers);

  // 4 次注入，「累计新增」的 interval 总数必须与只注入 1 次时相同。
  // 注意：若守卫生效，第 2/3/4 次注入不会新增任何 interval（每次新增为 0），
  // 所以正确的断言是「总数不随注入次数增长」，而不是「每次新增数都相等」。
  const counts = c.intervalCounts;
  const totalAfter4 = counts.reduce((a, b) => a + b, 0);
  check('C1 累计 interval 数不随注入次数增长（第2~4次新增均为0）',
    { total: totalAfter4, laterRounds: counts.slice(1) },
    { total: counts[0], laterRounds: [0, 0, 0] });
  check('C2 4 次注入均无异常', c.errors, []);
  check('C3 window.__ZHS_HELPER__ === true', c.helperFlag, true);
  check('C4 ZHS.version === package.json version (' + PKG_VERSION + ')', c.version, PKG_VERSION);
  const panelOk = c.panelCount === 0 || c.panelCount === 1;
  check('C5 助手面板数量为 0 或 1', panelOk, true);

  // 额外：guard 生效与否的直接证据 —— 面板 refresh interval 不应随注入次数增长
  check('C6 panel refresh(1500ms) interval 只有 1 个（未叠加）', c.refreshTimers <= 1, true);

  console.log('\n===== E. 反向测试：故意破坏 06-panel 的守卫 =====');
  const GUARD = 'if (ZHS.__mod06_panel) return;';
  if (raw.indexOf(GUARD) === -1) {
    console.log('  !! 未在产物中找到守卫原文 "' + GUARD + '"，反向测试无法执行');
    results.push({ name: 'E0 找到守卫原文', pass: false, actual: 'not found', expected: GUARD });
  } else {
    const broken = raw.split(GUARD).join('if (false) return;   /* 故意破坏守卫 */');
    console.log('  已把 "' + GUARD + '" 替换为 "if (false) return;"');
    const e = await inject(broken, 2);
    console.log('  每次注入新增 interval 数：' + JSON.stringify(e.intervalCounts));
    console.log('  interval 间隔分布：' + JSON.stringify(e.intervalMs));
    console.log('  异常：' + JSON.stringify(e.errors));
    console.log('  分项：1500ms(panel)=' + e.refreshTimers
      + '  3000ms(exam)=' + e.examTimers + '  2000ms(scheduler)=' + e.navTimers);

    // 破坏守卫后：第 2 次注入必须仍然新增 interval（叠加），证明检测有效
    const grew = e.intervalCounts.length >= 2
      && e.intervalCounts[1] > 0;
    check('E1 破坏守卫后第 2 次注入确实新增了定时器（检测方法有效）', grew, true);
    const panelGrew = e.refreshTimers > c.refreshTimers;
    check('E2 破坏守卫后面板 refresh interval 出现叠加', panelGrew, true);

    if (!grew || !panelGrew) {
      console.log('  !! 反向测试未观察到叠加 —— 说明检测方法可能无效，需报告');
    } else {
      console.log('  ^^ 反向测试通过：同一注入方式下，守卫正常=无叠加 / 守卫被破坏=有叠加，检测方法可信');
    }

    // 对照组展示：守卫有效版 vs 破坏版 的 1500ms interval 数
    console.log('\n  对照：守卫有效时 1500ms interval = ' + c.refreshTimers
      + ' 个；守卫被破坏时 = ' + e.refreshTimers + ' 个');
  }

  console.log('\n===== 汇总 =====');
  const failed = results.filter((r) => !r.pass);
  results.forEach((r) => console.log('  [' + (r.pass ? 'PASS' : 'FAIL') + '] ' + r.name));
  console.log('\n  总计 ' + results.length + ' 项，失败 ' + failed.length + ' 项');
  if (failed.length) {
    console.log('  失败明细：');
    failed.forEach((r) => console.log('   - ' + r.name
      + '：实际=' + JSON.stringify(r.actual) + '，期望=' + JSON.stringify(r.expected)));
  }
  process.exit(failed.length ? 1 : 0);
})();
