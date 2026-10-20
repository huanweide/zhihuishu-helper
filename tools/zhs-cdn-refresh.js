#!/usr/bin/env node
'use strict';

/**
 * tools/zhs-cdn-refresh.js —— zhihuishu-helper 发版收尾：purge jsDelivr @master 并用
 * 「浏览器 UA」校验（用户视角），保证 @updateURL（@master）始终服务最新版。
 *
 * 为什么必须有它（2026-10-20 实测教训）：
 *   jsDelivr 按请求头把缓存分到不同 cache class。裸 curl（默认 UA）常命中较新的一份，
 *   而浏览器 UA 命中另一份 —— 曾出现「curl 读到 0.6.41 / 浏览器 UA 读到 0.6.35」的分叉，
 *   用户 Edge/Tampermonkey 因此一直拿到旧版，表现为「明明 push 了却没更新」。
 *   必须主动 purge @master，并用浏览器 UA 复核，才算真的更新到用户侧。
 *
 * 用法（仓库根目录，push 之后跑）：
 *   node tools/zhs-cdn-refresh.js
 * 退出码：0 = @master 已服务本地 @version；1 = 仍是旧版（改用固定 commit 地址应急）。
 */

const fs = require('fs');
const path = require('path');

const root = __dirname.endsWith('tools') ? path.join(__dirname, '..') : __dirname;
const SCRIPT = path.join(root, 'dist', 'zhihuishu-helper.user.js');
const REPO = 'huanweide/zhihuishu-helper';
const REF = 'master';
const MAIN_URL = `https://cdn.jsdelivr.net/gh/${REPO}@${REF}/dist/zhihuishu-helper.user.js`;
const PURGE_URL = `https://purge.jsdelivr.net/gh/${REPO}@${REF}/dist/zhihuishu-helper.user.js`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function localVersion() {
  const m = fs.readFileSync(SCRIPT, 'utf8').match(/@version\s+([\d.]+)/);
  if (!m) throw new Error('dist 脚本没读到 @version，先跑 node build.js');
  return m[1];
}

// 浏览器 UA + 无缓存头 + cache-bust：模拟用户 Edge 的强拉，避免被默认 UA 的 cache class 骗过
async function cdnVersion() {
  const res = await fetch(MAIN_URL + '?t=' + Date.now(), {
    headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache' },
  });
  if (!res.ok) throw new Error('CDN HTTP ' + res.status);
  const txt = await res.text();
  const m = txt.match(/@version\s+([\d.]+)/);
  return { version: m ? m[1] : '(未读到)', bytes: Buffer.byteLength(txt, 'utf8') };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const want = localVersion();
  console.log('本地 dist @version = ' + want);

  // 已是最新 → 不 purge（避免无谓触发 jsDelivr 限流），直接收工
  try {
    const now = await cdnVersion();
    if (now.version === want) {
      console.log(`✅ @master 已服务 ${want}（浏览器 UA 复核，${now.bytes} 字节），无需 purge`);
      process.exit(0);
    }
    console.log(`当前 @master（浏览器 UA）= ${now.version}，需 purge 刷新`);
  } catch (e) {
    console.log('首次校验抓取失败，仍尝试 purge：' + e.message);
  }

  // purge（限流时如实报错，提示改用固定 commit 地址应急）
  console.log('purge jsDelivr @master ...');
  try {
    const p = await fetch(PURGE_URL, { cache: 'no-store' });
    const j = await p.json().catch(() => null);
    const info = j && j.paths && j.paths[`/gh/${REPO}@${REF}/dist/zhihuishu-helper.user.js`];
    if (info && info.throttled) {
      console.log(`⚠️ purge 被限流（重置约 ${info.throttledReset}s）。别再连点。`);
      console.log('要立刻用新版，装固定 commit 地址：'
        + ` https://cdn.jsdelivr.net/gh/${REPO}@<commit-sha>/dist/zhihuishu-helper.user.js`);
      process.exit(1);
    }
    console.log('  purge 状态 = ' + (j && j.status ? j.status : 'HTTP ' + p.status));
  } catch (e) {
    console.log('  purge 请求失败（缓存最终会自愈）：' + e.message);
  }

  // purge 非瞬时广播到所有边缘节点，轮询等一致（浏览器 UA 视角）
  const MAX_TRY = 15, WAIT_MS = 8000;
  for (let i = 0; i < MAX_TRY; i++) {
    let got;
    try { got = await cdnVersion(); } catch (e) { got = { version: '(抓取失败: ' + e.message + ')' }; }
    if (got.version === want) {
      console.log(`✅ @master 已服务 ${want}（浏览器 UA 复核）`);
      process.exit(0);
    }
    console.log(`  第 ${i + 1}/${MAX_TRY} 次：浏览器UA读到 ${got.version}，等 ${WAIT_MS / 1000}s`);
    await sleep(WAIT_MS);
  }
  console.log(`⚠️ purge 已提交，但浏览器 UA 仍读到旧版（${want} 未全网生效），通常几分钟内收敛。`);
  console.log(`  要立刻拿到新版：https://cdn.jsdelivr.net/gh/${REPO}@<commit-sha>/dist/zhihuishu-helper.user.js`);
  process.exit(1);
}

main().catch((e) => { console.error('异常：' + e.message); process.exit(1); });
