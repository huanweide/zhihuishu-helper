#!/usr/bin/env node
/**
 * 校验安装引导页（dist/install.html）里内嵌的脚本是否完整可用
 *
 * 为什么需要这个：安装页把整个油猴脚本内嵌进 <script type="text/plain">，
 * 一旦转义写错（比如 `</script>` 没处理好），页面看着正常，
 * 但用户点安装装进去的是残缺脚本 —— 必须机器校验，不能靠肉眼看。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'dist', 'install.html');
const USERJS = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); pass++; }
  else { console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); fail++; }
}

console.log('=== 安装页完整性校验 ===');

if (!fs.existsSync(HTML)) {
  console.log('  ✗ dist/install.html 不存在，请先运行 node tools/make-install-page.js');
  process.exit(1);
}
if (!fs.existsSync(USERJS)) {
  console.log('  ✗ dist/zhihuishu-helper.user.js 不存在，请先运行 node build.js');
  process.exit(1);
}

const html = fs.readFileSync(HTML, 'utf8');
const orig = fs.readFileSync(USERJS, 'utf8');

ok('安装页存在', true);
ok('安装页含基本 HTML 结构', /<!DOCTYPE html>/i.test(html) && /<\/html>/i.test(html));

// 1. 提取内嵌脚本
const m = html.match(/<script type="text\/plain" id="userscript">([\s\S]*?)<\/script>/);
ok('能提取到内嵌脚本块', !!m);
if (!m) { console.log('\n无法继续校验'); process.exit(1); }

let code = m[1];
// 2. 还原转义：写入时把 </script> 变成了 <\/script>
code = code.replace(/<\\\/script>/gi, '</script>');

// 3. 内容与源产物比对
ok('内嵌脚本长度与产物一致', code.length === orig.length,
  '内嵌 ' + code.length + ' vs 产物 ' + orig.length);
ok('内嵌脚本内容与产物完全一致', code === orig, '内容有差异');

// 4. 语法可解析
const tmp = path.join(ROOT, '.verify-install-tmp.js');
fs.writeFileSync(tmp, code, 'utf8');
let syntaxOk = true;
let syntaxErr = '';
try {
  require('child_process').execSync('node --check "' + tmp + '"', { stdio: 'pipe' });
} catch (e) {
  syntaxOk = false;
  syntaxErr = String(e.stderr || e.message).slice(0, 200);
}
fs.unlinkSync(tmp);
ok('内嵌脚本语法可解析', syntaxOk, syntaxErr);

// 5. 关键头部信息齐全（装进去必须是完整脚本，不能缺头）
ok('内嵌脚本含 ==UserScript== 头', code.includes('// ==UserScript=='));
ok('内嵌脚本含 @version', /\/\/ @version\s+\d+\.\d+\.\d+/.test(code));
ok('内嵌脚本含 polymas 匹配', code.includes('polymas.com'));

// 6. 页面交互元素齐全
ok('有安装按钮', html.includes('id="install"'));
ok('有复制备选按钮', html.includes('id="copy"'));
ok('有状态提示区', html.includes('id="status"'));

console.log('\n' + '='.repeat(42));
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('安装页有问题，请勿交付');
  process.exit(1);
} else {
  console.log('安装页校验通过 ✓');
  process.exit(0);
}
