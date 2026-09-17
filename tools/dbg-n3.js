const path=require('path');
const {JSDOM}=require('jsdom');
const fs=require('fs');
const vm=require('vm');
const SRC=path.join(__dirname,'..','dist','zhihuishu-helper.user.js');
const code=fs.readFileSync(SRC,'utf8');
const dom=new JSDOM(`<html><body><div class="course-name">C</div>
<div class="chapter-tree-74">
<div class="child-info hasvideo"><span class="child-name" title="A">A</span><i class="child-check"></i></div>
<div class="child-info hasvideo"><span class="child-name" title="B">B</span><i class="child-check"></i></div>
</div><video></video></body></html>`,
{url:'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=n3',runScripts:'outside-only'});
const win=dom.window;
win.GM_setValue=()=>{};win.GM_getValue=(k,d)=>d;win.GM_deleteValue=()=>{};
win.GM_xmlhttpRequest=()=>{};
vm.runInContext(code,dom.getInternalVMContext());
const S=win.ZHS.Scheduler, ZHS=win.ZHS;
setTimeout(()=>{
  console.log('初始化后 running =', ZHS.state.running, ' timer =', S._timer ? '有' : '无');
  S.finishAll('t').then(()=>{
    console.log('finishAll 后 running =', ZHS.state.running, ' timer =', S._timer ? '有' : '无');
    process.exit(0);
  });
}, 800);
