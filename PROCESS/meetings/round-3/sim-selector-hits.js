/** 逐字段命中核查：A/B 两套的每一个选择器，在两套 DOM 里各命中的节点数 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..', '..');

const ADAPTERS = {
  hike: { item: '.file-item', active: '.file-item.active', finish: '.icon-finish', title: 'span[title]',
    progress: '.rate', container: '.el-tree', courseTitle: '.course-name', locked: '.el-icon-lock, [class*="lock"]' },
  legacy: { item: '.clearfix.video', active: '.clearfix.video.current_play', finish: '.time_icofinish',
    title: '#lessonOrder, .catalogue_title', progress: '.progress-num', container: '.clearfix',
    courseTitle: '.source-name', locked: '[class*="lock"]' },
};

const FIX = {
  'A套 real-h5.html': path.join(ROOT, 'test/fixtures/real-h5.html'),
  'B套 studyvideoh5-legacy.html': path.join(ROOT, 'test/fixtures/studyvideoh5-legacy.html'),
};

for (const [fname, fpath] of Object.entries(FIX)) {
  const dom = new JSDOM(fs.readFileSync(fpath, 'utf8'), { url: 'https://studyvideoh5.zhihuishu.com/stuStudy' });
  const d = dom.window.document;
  console.log('=== ' + fname + ' ===');
  for (const [an, ad] of Object.entries(ADAPTERS)) {
    console.log('  [' + an + ']');
    for (const [k, sel] of Object.entries(ad)) {
      let n = -1, sample = '';
      try {
        const els = Array.from(d.querySelectorAll(sel));
        n = els.length;
        sample = els.length ? '「' + String(els[0].textContent || '').trim().slice(0, 24) + '」' : '';
      } catch (e) { sample = '选择器非法: ' + e.message.slice(0, 40); }
      console.log('    ' + k.padEnd(12) + sel.padEnd(34) + ' 命中 ' + n + ' ' + sample);
    }
  }
  console.log('');
}
