/**
 * 等你手动登录：每 8 秒轮询一次，检测到进入课程页就自动继续
 */
const puppeteer = require('puppeteer-core');
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_WAIT = Number(process.env.ZHS_LOGIN_WAIT_SEC || 600);

(async () => {
  let b;
  try {
    b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  } catch (e) {
    console.error('连不上调试端口 ' + PORT + '，请先跑 node test/live-edge.js check');
    process.exit(1);
  }
  const pages = await b.pages();
  const page = pages.find((p) => p.url().includes('zhihuishu')) || pages[0];
  console.log('监听页面: ' + page.url().slice(0, 80));
  console.log('>>> 请在那个 Edge 窗口里完成登录（含验证码）。最长等待 ' + (MAX_WAIT / 60) + ' 分钟…\n');

  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < MAX_WAIT) {
    await sleep(8000);
    let st;
    try {
      st = await page.evaluate(() => ({
        host: location.hostname,
        needLogin: location.hostname.includes('login'),
        hasVideo: !!document.querySelector('video'),
        hasTree: !!document.querySelector('.chapter-tree-74, .chapter-content, .el-tree, [class*="card-container"]'),
        title: document.title,
      }));
    } catch (e) { continue; }

    const sec = Math.round((Date.now() - t0) / 1000);
    if (!st.needLogin) {
      console.log('[' + sec + 's] ✓ 已登录！host=' + st.host + '  视频=' + st.hasVideo + '  目录=' + st.hasTree);
      if (st.hasTree || st.hasVideo) {
        console.log('\n>>> 可以跑端到端了：node test/live-edge.js e2e');
        break;
      }
      console.log('     （已登录但还没进入课程页，继续等…）');
    } else {
      console.log('[' + sec + 's] 仍在登录页：' + st.title);
    }
  }
  b.disconnect();
})();
