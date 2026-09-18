#!/usr/bin/env node
/**
 * 重入守卫验证：把 dist 产物在同一个 jsdom window 里注入 3 次，
 * 断言定时器数量不增长、面板只挂 1 个、版本号可读、不抛错。
 * 用法：node tools/reinject-check.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');

if (!fs.existsSync(BUNDLE)) {
  console.error('dist 不存在，先跑 node build.js');
  process.exit(2);
}
const bundle = fs.readFileSync(BUNDLE, 'utf8');

const dom = new JSDOM('<html><body><video></video></body></html>', {
  url: 'https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const win = dom.window;
const store = {};
win.GM_setValue = (k, v) => { store[k] = v; };
win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);

const periods = [];
const oSI = win.setInterval;
win.setInterval = function (...a) { periods.push(a[1]); return oSI.apply(win, a); };

let pass = 0; let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
};

const counts = [];
for (let i = 1; i <= 3; i++) {
  let err = null;
  try {
    vm.runInContext(bundle, dom.getInternalVMContext(), { filename: `inject-${i}.js` });
  } catch (e) { err = e.message; }
  counts.push({ round: i, intervals: periods.length, err });
}

win.__ZHS_AFTER__ = {
  patterns: counts.map((c) => c.intervals),
  errors: counts.map((c) => c.err),
};
console.log('注入轮次记录：', JSON.stringify(counts.map((c) => `第${c.round}次 定时器=${c.intervals} 错误=${c.err}`)));

console.log('\n[1] 重复注入不叠加定时器');
// 判定口径要点（曾被写反过，务必区分）：
//   守卫【有效】→ 新增序列形如 [1,0,0]（只有首次注入挂定时器，之后全部被守卫 return 掉）
//   守卫【失效】→ 新增序列形如 [1,1,1]（每次注入都重新挂一遍，这才是 bug）
// 所以断言必须盯「第 2 次起新增为 0」，绝不能写成「各次数量完全相同」——
// 「完全相同」在守卫失效时同样成立，是个会放过 bug 的假断言。
ok('第 2 次注入新增 setInterval 为 0', counts[1].intervals - counts[0].intervals === 0,
  `第1次=${counts[0].intervals} 第2次=${counts[1].intervals}`);
ok('第 3 次注入新增 setInterval 为 0', counts[2].intervals - counts[1].intervals === 0,
  `第2次=${counts[1].intervals} 第3次=${counts[2].intervals}`);
ok('累计定时器数量始终不超过首次注入的量', counts[2].intervals === counts[0].intervals,
  `第1次=${counts[0].intervals} 第3次=${counts[2].intervals}`);

console.log('\n[2] 重复注入不抛错');
ok('第 2 次注入无异常', counts[1].err === null, String(counts[1].err));
ok('第 3 次注入无异常', counts[2].err === null, String(counts[2].err));

console.log('\n[3] 版本号仍可读（不再靠顶层 const）');
ok('window.__ZHS_BUILD__.version 有值', typeof win.__ZHS_BUILD__ === 'object' && /^\d+\.\d+\.\d+$/.test(String(win.__ZHS_BUILD__.version)),
  JSON.stringify(win.__ZHS_BUILD__));
ok('ZHS.version 与构建版本一致（穿越 IIFE 边界）',
  win.ZHS && win.ZHS.version === win.__ZHS_BUILD__.version,
  `ZHS.version=${win.ZHS && win.ZHS.version} build=${win.__ZHS_BUILD__ && win.__ZHS_BUILD__.version}`);

console.log('\n[4] 面板与守卫状态');
const panels = win.document.querySelectorAll('#zhs-helper-panel, [data-zhs-root], .zhs-panel');
ok('页面里助手面板唯一', panels.length <= 1, '实际 ' + panels.length + ' 个');
ok('window.__ZHS_HELPER__ 守卫已置位', win.__ZHS_HELPER__ === true, String(win.__ZHS_HELPER__));

console.log('\n' + '='.repeat(50));
console.log(`重入验证：通过 ${pass} / 失败 ${fail}`);
try { win.close(); } catch (e) { /* 忽略 */ }
process.exit(fail > 0 ? 1 : 0);
