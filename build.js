#!/usr/bin/env node
/**
 * 构建脚本：把 src/*.js 按序拼装成单个油猴脚本
 * 用法：node build.js
 *
 * 拼装规则收敛在 tools/lib/bundle.js（单一真源），本文件只负责写盘。
 * 校验产物是否过期请用 node tools/check-dist-fresh.js。
 */
const fs = require('fs');
const path = require('path');
const { bundle, assertIifeBoundaries } = require('./tools/lib/bundle');

const { content, body, files, version, out } = bundle();

if (!assertIifeBoundaries(files, body, console)) process.exit(1);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, content, 'utf8');

const size = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`构建完成: dist/zhihuishu-helper.user.js  (${size} KB, ${files.length} 模块, v${version})`);
files.forEach((f) => console.log('  + ' + f));
