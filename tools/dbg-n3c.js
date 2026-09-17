// 用 run.js 完全相同的 makeEnv，但只跑第22组逻辑
const path=require('path');const fs=require('fs');const vm=require('vm');
let pass=0,fail=0;const failures=[];
function ok(n,c,e){if(c){pass++;}else{fail++;failures.push(n+' → '+e);console.log('  ✗ '+n+' → '+e);}}
function makeEnv(html,url){
  const {JSDOM}=require('jsdom');
  const dom=new JSDOM(html,{url:url||'https://x',pretendToBeVisual:true,runScripts:'outside-only'});
  const win=dom.window;
  const store={};win.GM_setValue=(k,v)=>{store[k]=v;};win.GM_getValue=(k,d)=>(store[k]!==undefined?store[k]:d);
  const SRC=path.join(__dirname,'..','src');
  fs.readdirSync(SRC).filter(f=>f.endsWith('.js')).sort().forEach(f=>{
    vm.runInContext(fs.readFileSync(path.join(SRC,f),'utf8'),dom.getInternalVMContext(),{filename:f});
  });
  return {dom,win,store};
}
const html=`<html><body><div class="course-name">测试课程</div>
<div class="chapter-tree-74">
<div class="child-info hasvideo"><span class="child-name" title="A">A</span><i class="child-check"></i></div>
<div class="child-info hasvideo"><span class="child-name" title="B">B</span><i class="child-check"></i></div>
</div><video></video></body></html>`;
const {win}=makeEnv(html,'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=n3');
const S=win.ZHS.Scheduler,ZHS=win.ZHS;
ZHS.state.answeredCount=7;ZHS.state.startedAt=Date.now()-125000;S._navCount=3;
S.stop();ZHS.state.running=true;S._timer=setInterval(()=>{},100000);
S.finishAll('测试触发').then(()=>{
  ok('finishAll 把运行态关掉',ZHS.state.running===false,String(ZHS.state.running));
  ok('finishAll 清掉了定时器',S._timer===null,String(S._timer?'有':'无'));
  console.log('通过 '+pass+' / 失败 '+fail);
  process.exit(0);
});
