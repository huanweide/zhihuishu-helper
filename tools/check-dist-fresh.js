#!/usr/bin/env node
/**
 * dist 新鲜度门禁（内容级比对）
 * 用法：node tools/check-dist-fresh.js
 *
 * 背景 —— 2026-09-18 事故，值得记下来：
 *   那天改了 src/02-adapter.js（23:26）、05-scheduler.js（23:25）、03-player.js（23:25），
 *   却忘了重建 dist。dist 停留在 22:16，grep clickAndVerify / scoreAdapter 计数全是 **0**。
 *   而用户是通过 @updateURL 直接从 GitHub raw 装脚本的 —— 也就是说，
 *   我这边所有修复，用户浏览器里一行都没上，表现就是「改了半天，功能还是全无用」。
 *
 * 教训：「改完记得 build」这种靠自觉的事一定会漏，必须做成机器可判定的门禁。
 *
 * 做法：不比 mtime（touch 一下就骗过去了），直接把 src/*.js 重新拼装一遍，
 * 与磁盘上的 dist 逐字节比对。任何一个字节不同 → exit 1。
 * 拼装规则复用 tools/lib/bundle.js，与本文件不会产生逻辑漂移。
 */
const fs = require('fs');
const path = require('path');
const { bundle } = require('./lib/bundle');

const { content: expected, files, version, out } = bundle();

if (!fs.existsSync(out)) {
  console.error('[failure] dist 不存在：' + out + '\n请先运行 node build.js');
  process.exit(1);
}

const actual = fs.readFileSync(out, 'utf8');

if (actual === expected) {
  console.log('[ok] dist 与 src 一致（' + files.length + ' 模块, v' + version + '）');
  process.exit(0);
}

// 不一致时给出「人类可读」的差异定位，而不是丢一堵墙的 diff
console.error('[failure] dist 产物已过期，与 src 不一致。\n');

const sig = [
  'clickAndVerify', 'scoreAdapter', 'hostBonus', 'hasActive', 'expandTreeOnce',
];
const drifted = sig.filter((s) => expected.includes(s) && !actual.includes(s));
if (drifted.length) {
  console.error('  src 里有、dist 里没有的关键符号：' + drifted.join(', ')
    + '\n  → 这说明你刚写的修复还没进用户浏览器，属于「改了等于没改」。\n');
}

// 找第一个不同的位置
let i = 0;
const max = Math.min(actual.length, expected.length);
while (i < max && actual[i] === expected[i]) i++;
console.error('  首次差异位置：第 ' + i + ' 个字符附近');
console.error('  dist 片段: ' + JSON.stringify(actual.slice(Math.max(0, i - 60), i + 60)));
console.error('  期望片段: ' + JSON.stringify(expected.slice(Math.max(0, i - 60), i + 60)));
console.error('\n修复：node build.js');
process.exit(1);
