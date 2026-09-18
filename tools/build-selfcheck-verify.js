/**
 * 独立验证（补充）：build.js 自检是否真的会拦住「模块边界被破坏」
 * 手法：临时把某个 src 模块的 IIFE 包裹去掉 → 跑 build.js → 必须 exit(1)。
 * 全程在系统临时目录做，不碰项目 src/dist（复制一份项目结构再动手）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const log = [];
function say(s) { log.push(s); console.log(s); }

// ---- 复制最小项目结构到临时目录 ----
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'zhs-build-verify-'));
fs.mkdirSync(path.join(sandbox, 'src'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'dist'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'build.js'), path.join(sandbox, 'build.js'));
fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(sandbox, 'package.json'));
for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
  if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(sandbox, 'src', f));
}
say('沙箱目录：' + sandbox);

function runBuild(label) {
  try {
    const out = execFileSync(process.execPath, ['build.js'], { cwd: sandbox, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? 'spawn-error' : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// ---- 基线：原样构建必须成功 ----
let r = runBuild('baseline');
say('\n[基线] exit=' + r.code + '  ' + JSON.stringify(r.out.trim().split('\n')[0] || ''));
const baseOk = r.code === 0;

// ---- 破坏：把 01-util.js 的 IIFE 包裹拆掉（模拟“模块边界被破坏”）----
const utilPath = path.join(sandbox, 'src', '01-util.js');
const raw = fs.readFileSync(utilPath, 'utf8');
// 去掉开头 (function () { 与结尾 })();
const broken = raw.replace(/\(function \(\) \{\s*'use strict';/, "'use strict';")
                   .replace(/\}\)\(\);\s*$/, '');
fs.writeFileSync(utilPath, broken, 'utf8');
say('\n[破坏] 已移除 src/01-util.js 的模块级 IIFE 包裹');

r = runBuild('broken');
say('[破坏后] exit=' + r.code);
say('[破坏后] 输出：' + JSON.stringify((r.out || '').trim().split('\n').slice(0, 4).join(' | ')));
const guardFired = r.code === 1;

// ---- 还原 & 复验 ----
fs.writeFileSync(utilPath, raw, 'utf8');
r = runBuild('restored');
say('\n[还原后] exit=' + r.code);
const restoredOk = r.code === 0;

say('\n===== 结论 =====');
say('基线构建成功: ' + baseOk);
say('破坏模块边界后 build.js exit(1)（自检生效）: ' + guardFired);
say('还原后构建恢复成功: ' + restoredOk);

// 统计 DIST 产物结构（用沙箱的 dist，等价于项目 dist）
const distOut = fs.readFileSync(path.join(sandbox, 'dist', 'zhihuishu-helper.user.js'), 'utf8');
const col0Iife = (distOut.match(/^\(function \(\) \{/gm) || []).length;
const modMarkers = (distOut.match(/^\/\* ===== \d\d/gm) || []).length;
const modGuards = (distOut.match(/if \(ZHS\.__mod\w+\) return;/g) || []).length;
const hasVersionConst = /(^|\n)\s*const __ZHS_VERSION__/.test(distOut);
const readsBuildNs = distOut.indexOf('window.__ZHS_BUILD__') !== -1;
say('\n===== 产物统计（沙箱重建结果）=====');
say('列0 缩进的 (function () { 个数: ' + col0Iife);
say('模块标记 /* ===== NN... 个数: ' + modMarkers);
say('模块级重入守卫 if (ZHS.__modX) return; 个数: ' + modGuards);
say('存在顶层 const __ZHS_VERSION__ 声明: ' + hasVersionConst);
say('产物出现 window.__ZHS_BUILD__: ' + readsBuildNs);

fs.writeFileSync(path.join(os.tmpdir(), 'build-verify.log'), log.join('\n'), 'utf8');
process.exit(0);
