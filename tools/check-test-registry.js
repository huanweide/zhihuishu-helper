#!/usr/bin/env node
/**
 * 测试组登记门禁（第 ⑥ 条）
 *
 * test/run.js 的约定（文件内 2747 / 2813 / 2870 行有同样说明）：
 *   ① 异步测试组必须写成 async IIFE；
 *   ② **必须登记进末尾 Promise.all 或就地 await**。
 *
 * 漏登记的后果比看起来严重得多：
 *   - 断言在汇总打印之后才跑完 → 通过数随机器调度漂移（实测本地 721 / CI 717）；
 *   - 更糟的是失败也不进 fail 计数、exit code 不变红 —— **假绿**。
 *     项目四大红线之一「绝不 seek」的验证组（_retryNoSeek）就曾这样漏登记，
 *     等于这条红线从来没被门禁真正验证过。
 *
 * 所以这条不能靠自觉，交给机器静态扫。
 *
 * 用法：
 *   node tools/check-test-registry.js                 # 扫 test/run.js
 *   node tools/check-test-registry.js <path>          # 扫指定文件（用于回验历史版本）
 */

const fs = require('fs');
const path = require('path');

const target = process.argv[2] || path.resolve(__dirname, '..', 'test', 'run.js');
const src = fs.readFileSync(target, 'utf8');

// ① 所有 async IIFE 测试组的变量名
const defRe = /const\s+(_[A-Za-z0-9_]+)\s*=\s*\(?\s*async/g;
const names = [];
let m;
while ((m = defRe.exec(src)) !== null) names.push({ name: m[1], line: src.slice(0, m.index).split('\n').length });

// ② Promise.all([...]) 里登记的名字
let allText = '';
const allRe = /Promise\.all\(\[([\s\S]*?)\]\)/g;
while ((m = allRe.exec(src)) !== null) allText += m[1] + ',';

// ③ 就地 await 的名字
const awaited = new Set();
const awaitRe = /await\s+(_[A-Za-z0-9_]+)/g;
while ((m = awaitRe.exec(src)) !== null) awaited.add(m[1]);

const missing = names.filter(({ name }) => {
  if (awaited.has(name)) return false;
  return !new RegExp('(^|[^A-Za-z0-9_])' + name + '([^A-Za-z0-9_]|$)').test(allText);
});

console.log(`[tests] ${path.basename(target)}：异步测试组 ${names.length} 个，已登记 ${names.length - missing.length} 个`);

if (missing.length) {
  console.error('\n[✗] 以下异步测试组既不在 Promise.all 里、也没有 await —— 断言会漏计或假绿：');
  for (const { name, line } of missing) {
    console.error(`  - ${name}（定义于第 ${line} 行）`);
    console.error(`      修法：把它加进末尾 Promise.all([...])，或在定义后就地 \`await ${name};\``);
  }
  process.exit(1);
}
console.log('[ok] 全部异步测试组均已登记，无漏计/假绿风险');
