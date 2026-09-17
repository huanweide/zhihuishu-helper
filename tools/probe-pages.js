const puppeteer = require('puppeteer-core');
(async () => {
  try {
    const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
    const pages = await b.pages();
    console.log('=== 标签页 ' + pages.length + ' 个 ===');
    for (const p of pages) {
      console.log('  · ' + (await p.title() || '(无标题)').slice(0, 40) + '  |  ' + p.url().slice(0, 90));
    }
    b.disconnect();
  } catch (e) {
    console.error('连接失败: ' + e.message);
  }
})();
