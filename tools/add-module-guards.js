#!/usr/bin/env node
/**
 * 一次性脚本：给所有模块补「模块级重入守卫」。
 *
 * 背景：v0.6.0 的构建方式曾把所有模块塞进一个大外层 IIFE，导致模块自身的
 * `if (window.__ZHS_HELPER__) return;` 只退出外层函数，后续模块照常重复执行，
 * SPA 二次注入时面板 1500ms 定时器、06c 的 3000ms 轮询都会翻倍。
 *
 * 现在 build.js 已改回「每个模块独立 IIFE」，但只有 00-config 有守卫，
 * 其余模块缺守卫仍会在二次注入时重复挂 timer / listener。
 *
 * 覆盖范围：src/ 下除 00-config.js 外的**全部**模块，共 16 个——
 *   含 01~13 十三个编号模块 + 06b-course-hub.js + 06c-exam.js。
 *   （注意 06b / 06c 不在「01 到 13」这个区间说法里，写统计数字时别漏。）
 *
 * 做法：在每个模块 IIFE 的 `if (!ZHS || !ZHS.Util) return;` 之后插入
 *   `if (ZHS.__modXX) return;  ZHS.__modXX = true;`
 * 幂等：已存在守卫的模块跳过。
 *
 * 用法：node tools/add-module-guards.js [--dry]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const DRY = process.argv.includes('--dry');

// 00-config.js 是引导模块，自己用的是 window.__ZHS_HELPER__ 全局守卫，不参与
const SKIP = new Set(['00-config.js']);

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
const report = [];

for (const f of files) {
  if (SKIP.has(f)) { report.push([f, 'skip', '引导模块（用 __ZHS_HELPER__ 全局守卫）']); continue; }
  const p = path.join(SRC, f);
  let code = fs.readFileSync(p, 'utf8');

  const modKey = '__mod' + f.replace(/\.js$/, '').replace(/[^0-9a-zA-Z]/g, '_');
  if (code.includes(`ZHS.${modKey}`)) { report.push([f, 'skip', '已有守卫']); continue; }

  // 定位模块头：`if (!ZHS || !ZHS.Util) return;` 或 `if (!ZHS) return;`
  const guardRe = /^( +)(if \(!ZHS(?:\s*\|\|\s*!ZHS\.Util)?\) return;)$/m;
  const m = code.match(guardRe);
  if (!m) { report.push([f, 'FAIL', '未找到标准模块头 `if (!ZHS...) return;`']); continue; }

  const indent = m[1];
  const injected = m[0]
    + '\n' + indent + '// 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加'
    + '\n' + indent + `if (ZHS.${modKey}) return;`
    + '\n' + indent + `ZHS.${modKey} = true;`;

  code = code.replace(guardRe, injected);
  if (!DRY) fs.writeFileSync(p, code, 'utf8');
  report.push([f, DRY ? 'would-add' : 'added', modKey]);
}

console.log('\n模块重入守卫' + (DRY ? '（预演，未写盘）' : '') + '：');
let added = 0; let failed = 0;
for (const [f, status, extra] of report) {
  console.log(`  ${status === 'added' || status === 'would-add' ? '✓' : status === 'FAIL' ? '✗' : '-'} ${f.padEnd(22)} ${status.padEnd(10)} ${extra}`);
  if (status === 'added' || status === 'would-add') added++;
  if (status === 'FAIL') failed++;
}
console.log(`\n共 ${added} 个模块补上守卫，${failed} 个失败`);
process.exit(failed > 0 ? 1 : 0);
