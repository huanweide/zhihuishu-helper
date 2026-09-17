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
// @description  智慧树自动播放 + 断点续播 + AI 自动答题
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
// ==/UserScript==
`;

// 按文件名排序拼装（00-config, 01-util, 02-adapter, ...）
const files = fs.readdirSync(SRC)
  .filter((f) => f.endsWith('.js'))
  .sort();

let body = '';
for (const f of files) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8');
  body += `\n/* ===== ${f} ===== */\n` + code.trim() + '\n';
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, HEADER + '\n' + body, 'utf8');

const size = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`构建完成: dist/zhihuishu-helper.user.js  (${size} KB, ${files.length} 模块, v${VER})`);
files.forEach((f) => console.log('  + ' + f));
