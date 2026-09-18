#!/usr/bin/env node
/**
 * 拼装逻辑单一真源（SSOT）
 *
 * 为什么要有这个文件：dist 产物必须能被「从 src 重算」出来，才能机器判定它新不新。
 * 若 build.js 里写一份、校验脚本里再抄一份，两份逻辑迟早漂移 —— 那校验就失去意义。
 * 所以拼装规则只在这里定义，build.js 与 check-dist-fresh.js 都引用本模块。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');
const PKG = require(path.join(ROOT, 'package.json'));

function header() {
  const VER = PKG.version;
  return `// ==UserScript==
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
// @updateURL    https://raw.githubusercontent.com/huanweide/zhihuishu-helper/master/dist/zhihuishu-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/huanweide/zhihuishu-helper/master/dist/zhihuishu-helper.user.js
// ==/UserScript==
`;
}

/**
 * 【构建产物结构】—— 每个模块各自一个 IIFE，不是把所有模块塞进一个大 IIFE。
 *
 * 为什么不能用「一个大外层 IIFE 包住全部模块」：
 *   各模块内部写的是 `(function () { 'use strict'; ...
 *   if (window.__ZHS_HELPER__) return;  ... })();`
 *   那个 `return` 只能退出**它自己所在的函数**。一旦模块被内联进外层大 IIFE，
 *   顶层 return 就变成了「退出外层函数」——02~13 全部模块（含面板 1500ms 定时器、
 *   06c 的 3000ms 轮询）在二次注入时会重复挂载，SPA 里定时器一路翻倍。
 *   所以必须保证：每个模块的 IIFE 边界原样保留，守卫才能真正拦住后续模块。
 *
 * 变量冲突（`Identifier '__ZHS_VERSION__' has already been declared`）改用
 * 「全局命名空间 + 幂等写入」解决：版本写进 window.__ZHS_BUILD__，不再声明顶层 const。
 */
function bundle() {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  const NS = 'window.__ZHS_BUILD__ = window.__ZHS_BUILD__ || {};';
  let body = `\n/* ===== 构建注入 ===== */\n${NS}\nwindow.__ZHS_BUILD__.version = ${JSON.stringify(PKG.version)};\n`;
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    body += `\n/* ===== ${f} ===== */\n` + code.trim() + '\n';
  }
  const wrapped = `(function () {\n'use strict';\n${body}\n})();\n`;
  return { content: header() + '\n' + wrapped, body, files, version: PKG.version, out: OUT };
}

/** 构建期自检：模块数与 IIFE 数必须匹配，防止误删模块边界导致重入守卫失效 */
function assertIifeBoundaries(files, body, stream) {
  const innerIifeCount = (body.match(/^\(function \(\) \{/gm) || []).length;
  if (innerIifeCount < files.length) {
    (stream || console).error(
      `构建自检失败：期望至少 ${files.length} 个模块级 IIFE，实际 ${innerIifeCount} 个。\n`
      + '模块边界被破坏会导致重入守卫失效（定时器叠加），请检查 src/*.js 是否保留了 (function () { ... })(); 包裹。'
    );
    return false;
  }
  return true;
}

module.exports = { ROOT, SRC, OUT, bundle, assertIifeBoundaries };
