#!/usr/bin/env node
/**
 * 构建脚本：把 src/*.js 按序拼装成单个油猴脚本
 * 用法：node build.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');
const VER = require(path.join(ROOT, 'package.json')).version;

const HEADER = `// ==UserScript==
// @name         智慧树网课助手
// @namespace    https://github.com/huanweide/zhihuishu-helper
// @version      ${VER}
// @description  智慧树自动播放 + 断点续播 + AI 自动答题 + 全自动看完收尾
// @author       ReTri
// @match        *://*.zhihuishu.com/*
// @match        *://*.polymas.com/*
// @match        *://*.zhihuishu.cn/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      127.0.0.1
// @connect      api.deepseek.com
// @connect      *
// @run-at       document-idle
// @license      MIT
// @supportURL   https://github.com/huanweide/zhihuishu-helper/issues
// @updateURL    https://raw.githubusercontent.com/huanweide/zhihuishu-helper/main/dist/zhihuishu-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/huanweide/zhihuishu-helper/main/dist/zhihuishu-helper.user.js
// ==/UserScript==
`;

// 按文件名排序拼装（00-config, 01-util, 02-adapter, ...）
const files = fs.readdirSync(SRC)
  .filter((f) => f.endsWith('.js'))
  .sort();

// 【构建产物结构】—— 每个模块各自一个 IIFE，不是把所有模块塞进一个大 IIFE。
//
// 为什么不能用「一个大外层 IIFE 包住全部模块」：
//   各模块内部写的是 `(function () { 'use strict'; ...
//   if (window.__ZHS_HELPER__) return;  ... })();`
//   那个 `return` 只能退出**它自己所在的函数**。一旦模块被内联进外层大 IIFE，
//   顶层 return 就变成了「退出外层函数」——02~13 全部模块（含面板 1500ms 定时器、
//   06c 的 3000ms 轮询）在二次注入时会重复挂载，SPA 里定时器一路翻倍。
//   所以必须保证：每个模块的 IIFE 边界原样保留，守卫才能真正拦住后续模块。
//
// 变量冲突（`Identifier '__ZHS_VERSION__' has already been declared`）改用
// 「全局命名空间 + 幂等写入」解决：版本写进 window.__ZHS_BUILD__，不再声明顶层 const。
const NS = 'window.__ZHS_BUILD__ = window.__ZHS_BUILD__ || {};';
let body = `\n/* ===== 构建注入 ===== */\n${NS}\nwindow.__ZHS_BUILD__.version = ${JSON.stringify(VER)};\n`;
// 每个模块自带 IIFE，直接平铺——IIFE 边界就是隔离边界，也是守卫能生效的前提
for (const f of files) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  body += `\n/* ===== ${f} ===== */\n` + code.trim() + '\n';
}

// 只在最外层加一次 IIFE 做「防全局污染」的兜底。
// 关键差别：模块自己的 `if (window.__ZHS_HELPER__) return;` 位于**模块自己的 IIFE 内**，
// 因此二次注入时它会逐模块拦停；内联不会让守卫失效。
const wrapped = `(function () {\n'use strict';\n${body}\n})();\n`;

// 构建期自检：模块数与 IIFE 数必须匹配，防止有人误删模块边界导致守卫失效
const moduleCount = files.length;
const innerIifeCount = (body.match(/^\(function \(\) \{/gm) || []).length;
if (innerIifeCount < moduleCount) {
  console.error(
    `构建自检失败：期望至少 ${moduleCount} 个模块级 IIFE，实际 ${innerIifeCount} 个。\n`
    + '模块边界被破坏会导致重入守卫失效（定时器叠加），请检查 src/*.js 是否保留了 (function () { ... })(); 包裹。'
  );
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HEADER + '\n' + wrapped, 'utf8');

const size = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`构建完成: dist/zhihuishu-helper.user.js  (${size} KB, ${files.length} 模块, v${VER})`);
files.forEach((f) => console.log('  + ' + f));
