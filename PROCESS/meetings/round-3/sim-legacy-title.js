/** B 套课时名读取路径核查：li 内同时有 #lessonOrder / .catalogue_title(章节名) / .time(课时名) 时读谁 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const ROOT = path.join(__dirname, '..', '..', '..');

const html = `<!DOCTYPE html><html><body><ul>
<li class="clearfix video"><span id="lessonOrder">1.1</span><span class="catalogue_title">第一章 函数与极限</span><span class="time">映射与函数</span><div class="progress-num">0%</div></li>
<li class="clearfix video current_play"><span id="lessonOrder">1.2</span><span class="catalogue_title">第一章 函数与极限</span><span class="time">数列的极限</span><div class="progress-num">60%</div></li>
<li class="clearfix video"><span id="lessonOrder">1.3</span><span class="catalogue_title">第一章 函数与极限</span><span class="time">函数的极限</span><div class="progress-num">0%</div></li>
<li class="clearfix video"><span id="lessonOrder">2.1</span><span class="catalogue_title">第二章 导数</span><span class="time">导数概念</span><div class="progress-num">0%</div></li>
</ul></body></html>`;

const dom = new JSDOM(html, { url: 'https://studyvideoh5.zhihuishu.com/stuStudy', runScripts: 'outside-only' });
const win = dom.window;
win.GM_setValue = () => {}; win.GM_getValue = (k, d) => d; win.GM_deleteValue = () => {}; win.GM_listValues = () => [];
win.console = { log() {}, warn() {}, error() {}, debug() {} };
for (const f of ['00-config.js', '01-util.js', '02-adapter.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), dom.getInternalVMContext(), { filename: f });
}
const C = win.ZHS.Catalog;
C.redetect();
console.log('adapter =', C.adapter.name);
C.items().forEach((el) => console.log('  itemTitle ->', JSON.stringify(C.itemTitle(el))));
const cur = C.current();
console.log('current =', JSON.stringify(C.itemTitle(cur)), ' next =', JSON.stringify(C.itemTitle(C.findNext(cur))));
console.log('findByName("函数的极限") ->', JSON.stringify(C.itemTitle(C.findByName('函数的极限'))));
