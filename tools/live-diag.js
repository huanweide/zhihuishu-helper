#!/usr/bin/env node
/**
 * 实地诊断：连接用户 Edge 调试实例(9222)，打开网课页，截图 + 探测真实 DOM
 * 用法: node tools/live-diag.js [课程URL]
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const COURSE_URL = process.argv[2]
  || 'https://studyvideoh3.zhihuishu.com/stuStudy/recruitAndCourseId=a6e57b5cec5b4859454a5b5958435f475a';
const OUT = path.join(__dirname, '..', 'live-shots');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  console.log('connected:', await browser.userAgent());

  // 找已有网课页，没有就新开
  let page = (await browser.pages()).find((p) => p.url().includes('zhihuishu.com'));
  if (!page) {
    page = await browser.newPage();
    console.log('opening course url:', COURSE_URL);
    await page.goto(COURSE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', e.message));
  } else {
    console.log('found existing zhihuishu tab:', page.url());
  }

  await sleep(10000); // 等 SPA 渲染
  await page.screenshot({ path: path.join(OUT, '01-initial.png') });
  console.log('screenshot: 01-initial.png');
  console.log('url_now:', page.url());
  console.log('title:', await page.title());

  const probe = await page.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const iframes = [...document.querySelectorAll('iframe')].map((f) => ({ src: f.src.slice(0, 120), id: f.id, cls: f.className }));
    return {
      hasVideo: !!document.querySelector('video'),
      frames: iframes,
      sels: {
        childInfo: q('.child-info'),
        clearfixVideo: q('.clearfix.video'),
        lessonOrder: q('#lessonOrder'),
        lockIcon: q('[class*=lock]'),
        finishIcon: q('.time_icofinish, .child-check, [class*=finish]'),
        progressbar: q('[role=progressbar]'),
        chapterTree: q('[class*=chapter-tree], [class*=catalogue], [class*=section-list]')
      },
      bodyHead: document.body.innerText.slice(0, 300),
      zhsInjected: !!window.__ZHS_HELPER__
    };
  });
  console.log(JSON.stringify(probe, null, 2));

  await browser.disconnect();
  console.log('done');
})();
