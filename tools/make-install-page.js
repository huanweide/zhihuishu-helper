#!/usr/bin/env node
/**
 * 生成一键安装引导页（dist/install.html）
 *
 * 为什么需要：让用户把 116KB 脚本手动复制粘贴进油猴编辑器，体验很差且容易出错。
 * 这个页面把脚本内嵌进去，用户打开点一下就能唤起油猴的安装确认。
 *
 * 用法：node tools/make-install-page.js
 * 校验：node tools/verify-install-page.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USERJS = path.join(ROOT, 'dist', 'zhihuishu-helper.user.js');
const OUT = path.join(ROOT, 'dist', 'install.html');
const pkg = require(path.join(ROOT, 'package.json'));

if (!fs.existsSync(USERJS)) {
  console.error('找不到 dist/zhihuishu-helper.user.js，请先运行 node build.js');
  process.exit(1);
}

const src = fs.readFileSync(USERJS, 'utf8');
// 关键：内嵌到 <script type="text/plain"> 里时必须转义结束标签，
// 否则浏览器会提前闭合脚本块，导致内嵌内容被截断
const esc = src.replace(/<\/script>/gi, '<\\/script>');
const sizeKB = (Buffer.byteLength(src, 'utf8') / 1024).toFixed(0);

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>智慧树网课助手 v${pkg.version} — 安装引导</title>
<style>
  :root { --pri:#185FA5; --ok:#1D9E75; }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 20px; font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
    background:#F7F6F3; color:#2C2C2A; line-height:1.6; }
  .card { max-width:640px; margin:0 auto; background:#fff; border-radius:14px; padding:28px 30px;
    box-shadow:0 4px 24px rgba(0,0,0,.07); border:1px solid rgba(0,0,0,.06); }
  h1 { margin:0 0 6px; font-size:21px; color:var(--pri); }
  .sub { color:#888780; font-size:13px; margin-bottom:22px; }
  .step { display:flex; gap:12px; padding:13px 0; border-bottom:1px dashed rgba(0,0,0,.08); }
  .step:last-of-type { border-bottom:none; }
  .num { flex:0 0 24px; height:24px; border-radius:50%; background:var(--pri); color:#fff;
    display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:600; }
  .step-body b { display:block; margin-bottom:2px; font-size:14px; }
  .step-body span { font-size:13px; color:#5F5E5A; }
  code { background:#F1EFE8; padding:1px 5px; border-radius:3px; font-size:12px; }
  .btn { display:block; width:100%; margin:22px 0 10px; padding:13px; font-size:15px; font-weight:600;
    border:none; border-radius:9px; background:var(--pri); color:#fff; cursor:pointer;
    transition:background .15s, transform .1s; }
  .btn:hover { background:#134B85; }
  .btn:active { transform:scale(.985); }
  .btn.done { background:var(--ok); }
  .status { text-align:center; font-size:13px; min-height:20px; color:#5F5E5A; }
  .note { margin-top:20px; padding:12px 14px; background:#FAEEDA; border-radius:8px;
    font-size:12px; color:#412402; }
  .note b { color:#854F0B; }
  .meta { margin-top:18px; padding-top:14px; border-top:1px solid rgba(0,0,0,.08);
    font-size:12px; color:#888780; display:flex; justify-content:space-between; }
</style>
</head>
<body>
<div class="card">
  <h1>智慧树网课助手 v${pkg.version}</h1>
  <div class="sub">自动播放 · 断点续播 · AI 自动答题 · 全自动闭环</div>

  <div class="step"><div class="num">1</div><div class="step-body">
    <b>确认装了脚本管理器</b>
    <span>Tampermonkey（油猴）或 Violentmonkey（暴力猴）都行，装一个即可。</span>
  </div></div>

  <div class="step"><div class="num">2</div><div class="step-body">
    <b>点下面的按钮安装</b>
    <span>会唤起脚本管理器的安装确认页，点「安装」即可。</span>
  </div></div>

  <div class="step"><div class="num">3</div><div class="step-body">
    <b>打开智慧树验证</b>
    <span>进入任意课程页，右下角出现蓝色圆形 <code>智</code> 按钮就算成功。</span>
  </div></div>

  <button class="btn" id="install">安装到脚本管理器</button>
  <div class="status" id="status"></div>

  <div class="note">
    <b>如果按钮没反应</b>，说明浏览器没把本页面交给脚本管理器处理。
    改用备选方案：点下方按钮复制脚本全文，然后打开脚本管理器面板 →
    <b>「+」新建脚本</b> → 全选粘贴覆盖 → <code>Ctrl+S</code> 保存。
  </div>
  <button class="btn" id="copy" style="background:#5F5E5A">复制脚本全文（备选方案）</button>

  <div class="meta">
    <span>文件大小 ${sizeKB} KB · 单文件零依赖</span>
    <span>by ReTri</span>
  </div>
</div>

<script type="text/plain" id="userscript">${esc}</script>
<script>
(function(){
  var code = document.getElementById('userscript').textContent;
  var statusEl = document.getElementById('status');

  document.getElementById('install').onclick = function(){
    try {
      // 以 blob 打开：脚本管理器会拦截 .user.js 内容并弹出安装确认页
      var blob = new Blob([code], { type: 'text/javascript' });
      var url = URL.createObjectURL(blob);
      statusEl.textContent = '正在唤起安装确认…若没反应请用下方备选方案';
      window.open(url, '_blank');
      setTimeout(function(){ URL.revokeObjectURL(url); }, 30000);
    } catch (e) {
      statusEl.textContent = '唤起失败：' + e.message + '，请用备选方案';
    }
  };

  document.getElementById('copy').onclick = function(){
    var btn = this;
    function done(){
      btn.textContent = '✓ 已复制，去脚本管理器新建脚本粘贴';
      btn.classList.add('done');
      statusEl.textContent = '粘贴后按 Ctrl+S 保存即可';
    }
    function fallback(){
      var ta = document.createElement('textarea');
      ta.value = code; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); }
      catch (e) { statusEl.textContent = '复制失败，请手动全选页面源码'; }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(fallback);
    } else { fallback(); }
  };
})();
</script>
</body>
</html>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log('安装页已生成：dist/install.html');
console.log('  脚本版本：v' + pkg.version);
console.log('  内嵌大小：' + sizeKB + ' KB');
console.log('  校验命令：node tools/verify-install-page.js');
