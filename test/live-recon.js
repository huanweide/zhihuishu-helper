/**
 * 真实站点接入测试（阶段 1）：侦察登录态与页面实际结构
 *
 * 目的：在真实浏览器里打开智慧树播放页，
 *  1. 判断是否已登录
 *  2. 记录未登录时被引导到哪
 *  3. 若已登录，dump 真实 DOM 结构，核对我们的选择器假设
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'reference', 'live');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA = path.join(ROOT, '.chrome-profile');   // 持久化 profile，登录态能留存

const TARGET = 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=4e5f5b5c4c5b4859454a585958435f475a';

fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,                       // 有头模式：登录/验证码需要人工可见
    userDataDir: USER_DATA,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
    ],
  });

  const page = (await browser.pages())[0] || await browser.newPage();

  // 反自动化痕迹清理（真实站点会查 navigator.webdriver）
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  console.log('>>> 打开:', TARGET);
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 给 SPA 时间渲染
  await new Promise((r) => setTimeout(r, 8000));

  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      url: location.href,
      title: document.title,
      // 登录态痕迹
      hasLoginBtn: !!q('.login-btn, [class*="login"], .sign-in'),
      bodyTextHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
      // 关键结构是否存在
      video: !!q('video'),
      videoCount: document.querySelectorAll('video').length,
      chapterTree: !!q('.chapter-tree-74'),
      childInfo: document.querySelectorAll('.child-info').length,
      childInfoHasVideo: document.querySelectorAll('.child-info.hasvideo').length,
      courseName: (q('.course-name') || {}).innerText || null,
      // 登录相关
      cookies: document.cookie.length,
      localStorageKeys: Object.keys(localStorage).slice(0, 25),
    };
  });

  console.log('\n=== 页面信息 ===');
  console.log(JSON.stringify(info, null, 2));

  // 全页截图
  const shot = path.join(OUT, 'live-01-初始状态.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('\n截图:', shot);

  // 存一份渲染后的 HTML（SPA 渲染完的 DOM，比 curl 拿到的有价值得多）
  const html = await page.content();
  const htmlPath = path.join(OUT, 'rendered-stuStudy.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('渲染后 HTML:', htmlPath, (html.length / 1024).toFixed(1) + ' KB');

  // 浏览器保持打开，等人工处理登录/验证码
  console.log('\n>>> 浏览器保持打开。如需登录请手动操作，完成后按 Ctrl+C 结束本阶段。');
  console.log('>>> 或等待 120 秒自动关闭。');
  await new Promise((r) => setTimeout(r, 120000));

  // 二次快照（人工操作后的状态）
  const info2 = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    return {
      url: location.href,
      video: !!q('video'),
      chapterTree: !!q('.chapter-tree-74'),
      childInfo: document.querySelectorAll('.child-info').length,
      courseName: (q('.course-name') || {}).innerText || null,
      bodyTextHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    };
  });
  console.log('\n=== 120 秒后状态 ===');
  console.log(JSON.stringify(info2, null, 2));
  await page.screenshot({ path: path.join(OUT, 'live-02-人工操作后.png') });

  const html2 = await page.content();
  fs.writeFileSync(path.join(OUT, 'rendered-after.html'), html2, 'utf8');

  await browser.close();
  console.log('\n完成。');
})();
