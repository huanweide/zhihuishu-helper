#!/usr/bin/env node
/**
 * 文档一致性门禁（第 ⑤ 条）
 *
 * 修的是「版本号/测试数漂移」这类反复复发的文档失真：
 * package.json 升了版本，CHANGELOG 写了，但 README / README_EN / PROJECT_MAP /
 * CONTRIBUTING / PR 模板还停在上一版 —— 实测已犯过两次（v0.6.65 漏改 677→706、
 * v0.6.66 漏改 717→721）。手工同步靠自觉，所以交给机器。
 *
 * 用法：
 *   node tools/check-docs-consistency.js              # 只查版本一致 + 文档内测试数是否自相矛盾
 *   node tools/check-docs-consistency.js --tests 721  # 再校验文档里的测试数 == 721
 *
 * CI 里把 test/run.js 实跑出来的数字喂进来，README 上的数字就再也不会漂。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION = require(path.join(ROOT, 'package.json')).version;

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// —— ① 版本号四件套（项目既定口径）：这些文件必须提到当前版本 ——
// CONTRIBUTING.md 不在此列：贡献指南讲的是流程，不需要跟着版本号走。
const VERSION_FILES = [
  'README.md',
  'README_EN.md',
  'docs/PROJECT_MAP.md',
  'CHANGELOG.md',
];

// —— ② 首屏文档严禁残留旧版本号（历史陈述留在 docs/ 里，不进这条严检） ——
const STRICT_NO_STALE = ['README.md', 'README_EN.md'];

// —— ③ 测试数出现的位置（只取「当前状态」陈述，不含 docs/40 的历史演进表） ——
const TEST_COUNT_PATTERNS = [
  ['README.md', /通过\s+(\d+)\s*\/\s*失败/g],
  ['README.md', /(\d+)\s*项逻辑单测/g],
  ['README_EN.md', /passed\s+(\d+)\s*\/\s*failed/g],
  ['README_EN.md', /(\d+)\s+logic tests/g],
  ['docs/PROJECT_MAP.md', /(\d+)\s*通过\s*\/\s*0\s*失败/g],
  ['CONTRIBUTING.md', /当前\s+(\d+)\s*(?:断言|通过)/g],
  ['.github/PULL_REQUEST_TEMPLATE.md', /当前基线：(\d+)\s*通过/g],
];

const errors = [];
const warns = [];

// ① 版本一致性
for (const f of VERSION_FILES) {
  let text;
  try {
    text = read(f);
  } catch (e) {
    errors.push(`${f} 读取失败：${e.message}`);
    continue;
  }
  const anchor = f === 'CHANGELOG.md' ? `## [${VERSION}]` : VERSION;
  if (!text.includes(anchor)) {
    errors.push(`${f} 未提及当前版本 ${VERSION}（期望出现 "${anchor}"）`);
  }
}

// ② 首屏无旧版本残留
const staleRe = /0\.6\.\d+/g;
for (const f of STRICT_NO_STALE) {
  let text;
  try {
    text = read(f);
  } catch (e) {
    continue;
  }
  const found = [...new Set(text.match(staleRe) || [])];
  const stale = found.filter((v) => v !== VERSION);
  if (stale.length) {
    errors.push(`${f} 残留旧版本号 ${stale.join(', ')}（当前 ${VERSION}）`);
  }
}

// ③ 测试数：文档内部是否自相矛盾
const hits = [];
for (const [f, re] of TEST_COUNT_PATTERNS) {
  let text;
  try {
    text = read(f);
  } catch (e) {
    warns.push(`${f} 读取失败，跳过测试数检查`);
    continue;
  }
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) hits.push({ file: f, n: Number(m[1]) });
}
const uniq = [...new Set(hits.map((h) => h.n))];
if (uniq.length > 1) {
  errors.push(
    `文档内测试数自相矛盾：${uniq.join(' vs ')}\n` +
      hits.map((h) => `    ${h.file}: ${h.n}`).join('\n')
  );
}

// ④ 可选：与实跑数字对齐
const idx = process.argv.indexOf('--tests');
if (idx !== -1) {
  const actual = Number(process.argv[idx + 1]);
  if (!Number.isFinite(actual)) {
    errors.push(`--tests 需要一个数字，收到 "${process.argv[idx + 1]}"`);
  } else {
    const bad = hits.filter((h) => h.n !== actual);
    if (bad.length) {
      errors.push(
        `文档测试数与实跑 ${actual} 不符：\n` +
          bad.map((h) => `    ${h.file}: ${h.n} ≠ ${actual}`).join('\n')
      );
    }
  }
}

// —— 输出 ——
console.log(`[docs] 当前版本 ${VERSION}，测试数命中 ${hits.length} 处（${uniq.join(',') || '无'}）`);
for (const w of warns) console.log(`[warn] ${w}`);

if (errors.length) {
  console.error('\n[✗] 文档一致性检查未通过：');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('[ok] 文档一致：版本号五件套 + 测试数无漂移');
