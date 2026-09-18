/**
 * 全屏下悬浮面板可见性（专项测试）
 *
 * 背景：用户反馈「全屏之后悬浮窗看不到」。
 * 根因不是样式，而是浏览器渲染规则：进入 Fullscreen API 全屏后，
 * 浏览器【只渲染全屏元素及其子树】。面板原本挂在 documentElement 下，
 * 不在全屏元素的子树里，于是被整体隐藏 —— z-index 调到最大也没用。
 *
 * 修复思路：监听 fullscreenchange，把承载面板的 host 元素 appendChild 进
 * 全屏元素内部；退出全屏时迁回 documentElement。
 *
 * 本文件用 jsdom 覆盖以下场景（jsdom 不实现 Fullscreen API，因此用
 * Object.defineProperty + dispatchEvent 手工模拟浏览器行为）：
 *  1. 进入全屏（容器 div）→ host 的父节点变成该容器
 *  2. webkit 前缀事件同样生效（老内核）
 *  3. 退出全屏 → host 回到 documentElement
 *  4. 全屏元素是 <video> → host 挂到它的父容器，而不是挂进 video 内部
 *  5. video 直挂 html 的极端情况 → 兜底挂回 html，不能抛错
 *  6. 迁移后面板状态保持：当前 tab / 开关状态 / 日志渲染 / 进度条宽度
 *  7. CSS 全屏方案（不触发 Fullscreen API）→ host 不动，面板照常可见
 *  8. 默认绝不擅自退出全屏；开启 exitFullscreenOnPanel 才调用 exitFullscreen
 *  9. 挂载失败后退出全屏 → 给用户 alert 提示（全屏时提示看不见，退出后才可见）
 * 10. 设计令牌收敛检查（本轮美化的可验证部分）
 *
 * 用法：node test/fullscreen-panel.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else {
    fail++;
    failures.push(name + (extra ? ' → ' + extra : ''));
    console.log('  ✗ ' + name + (extra ? ' → ' + extra : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, `得到 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`);
}

/**
 * 取页面根节点下的面板 host。
 * 为什么不直接 getElementById：host 已被迁进全屏容器，
 * 用 getElementById 只能验证「还在文档里」，验证不了「挂在谁下面」。
 */
function findHost(win) {
  return win.document.querySelector('#zhs-helper-panel');
}

/** 面板 host 当前挂在哪个父节点下 */
function hostParent(win) {
  const h = findHost(win);
  return h ? h.parentNode : null;
}

/** 面板 host 的父节点是不是「页面根节点」 */
function isAtRoot(win) {
  return hostParent(win) === win.document.documentElement;
}

/**
 * 把一个元素标记为「当前全屏元素」，并【以真实监听器身份】触发 fullscreenchange。
 *
 * jsdom 没有 Fullscreen API，所以属性这里人工装；但事件派发必须走真实的
 * addEventListener 通道 —— 这是本文件最重要的一条设计：
 *
 *   曾经踩过的坑：addEventListener('fullscreenchange', this._onFullscreenChange)
 *   这种写法丢了 this，浏览器调用时 this 是事件目标 → 处理器第一行就抛错，
 *   表现是「事件派发了但脚本毫无反应」。
 *   如果测试只直接调 panel._onFullscreenChange()（带着正确的 this），
 *   这个 bug 永远测不出来 —— 因为它绕过了注册环节。
 *
 *   所以这里刻意用 dispatchEvent，让浏览器（jsdom）自己按监听器语义调用
 *   我们注册的那个函数，this 就是 undefined/事件目标，真实还原线上行为。
 *
 * 注意：document.addEventListener('fullscreenchange') 在旧版 jsdom 里
 * 不是合法事件类型，因此用 CustomEvent + 直接落在 document 上派发；
 * 若派发失败则退化为「以监听器身份」手动调用（this 置 undefined），
 * 两种方式都能抓到丢 this 的 bug。
 */
function setFullscreenElement(win, el, opts) {
  const opt = opts || {};
  const docs = [win.document];
  try {
    const frames = win.document.querySelectorAll('iframe');
    for (const f of frames) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) { /* 跨域 */ } }
  } catch (e) { /* ignore */ }

  for (const d of docs) {
    const keys = ['fullscreenElement', 'webkitFullscreenElement', 'webkitCurrentFullScreenElement'];
    for (const key of keys) {
      const value = opt.webkitOnly && key === 'fullscreenElement' ? null : el;
      Object.defineProperty(d, key, { value, configurable: true, writable: true });
    }
  }

  if (opt.noEvent) return;

  // 走真实事件通道：让 jsdom 以监听器语义调用注册的函数（this 会丢）
  const evtName = opt.webkitOnly ? 'webkitfullscreenchange' : 'fullscreenchange';
  for (const d of docs) {
    let dispatched = false;
    try {
      const ev = new win.Event(evtName);
      d.dispatchEvent(ev);
      dispatched = true;
    } catch (e) {
      // 老 jsdom 不认识该事件类型：退化为「以监听器身份」调用
      try {
        const ev2 = new win.Event('Event');
        // 直接把事件类型改成目标名（jsdom 允许部分场景）
        Object.defineProperty(ev2, 'type', { value: evtName, configurable: true });
        d.dispatchEvent(ev2);
        dispatched = true;
      } catch (e2) { dispatched = false; }
    }
    if (!dispatched) {
      // 最后兜底：以监听器身份调用（this = undefined），仍能捕获丢 this 的 bug
      const P = win.ZHS && win.ZHS.panel;
      if (P && typeof P._onFullscreenChange === 'function') {
        P._onFullscreenChange.call(undefined);
      }
    }
  }
}

/** 构造一个带 ZHS 全量源码的 jsdom 环境 */
function makeEnv(html, url) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html, {
    url: url || 'https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=fs001',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const win = dom.window;

  const store = {};
  win.GM_setValue = (k, v) => { store[k] = v; };
  win.GM_getValue = (k, d) => (store[k] !== undefined ? store[k] : d);

  const SRC = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    try {
      vm.runInContext(code, dom.getInternalVMContext(), { filename: f });
    } catch (e) {
      console.log('  [加载 ' + f + ' 出错] ' + e.message);
    }
  }
  return { dom, win, store };
}

/** 等待宏任务/微任务落盘 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==================================================
(async () => {
  console.log('\n=== FS-1. 进入全屏（普通容器 div）→ 面板挂进容器内部 ===');
  {
    const { win } = makeEnv(`<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo current"><span class="child-name">第一节</span></div>
  <div class="child-info hasvideo"><span class="child-name">第二节</span></div>
</div>
<div id="player-box"><video></video></div>
</body></html>`);

    const P = win.ZHS.panel;
    // main.js 的 boot 是异步的，面板可能还没挂；显式确保挂载
    P.mount();
    const host = findHost(win);
    ok('面板已挂载', !!host);
    ok('初始挂在 documentElement 下', isAtRoot(win), host && host.parentNode && host.parentNode.nodeName);

    // 真实监听器必须已注册（否则浏览器派发 fullscreenchange 也没人接）
    P._bindFullscreen();
    ok('已在 document 上注册 fullscreenchange 监听',
      P._fsBoundDocs.indexOf(win.document) >= 0);

    win.ZHS.Log.clear();
    const box = win.document.getElementById('player-box');
    setFullscreenElement(win, box);

    eq('host 的父节点已变成全屏容器', hostParent(win), box);
    ok('host 不在 documentElement 下了', !isAtRoot(win));
    ok('host 仍在文档中（未被移除）', win.document.contains(host));
    ok('迁移日志已记录', win.ZHS.Log.all().some((e) => e.text.indexOf('已迁移到全屏元素内') >= 0),
      win.ZHS.Log.all().map((e) => e.text).join(' | ').slice(-160));
  }

  console.log('\n=== FS-2. webkit 前缀事件（老内核）同样生效 ===');
  {
    const { win } = makeEnv(`<html><body>
<div id="player-box"><video></video></div>
</body></html>`);
    const P = win.ZHS.panel;
    P.mount();
    const host = findHost(win);
    const box = win.document.getElementById('player-box');

    setFullscreenElement(win, box, { webkitOnly: true });
    eq('webkitfullscreenchange 也能触发迁移', hostParent(win), box);

    // 退出（webkit）
    setFullscreenElement(win, null, { webkitOnly: true });
    ok('webkit 退出全屏后迁回 documentElement', isAtRoot(win));
    ok('host 仍在文档中', win.document.contains(host));
  }

  console.log('\n=== FS-3. 退出全屏 → 面板迁回 documentElement ===');
  {
    const { win } = makeEnv(`<html><body>
<div id="player-box"><video></video></div>
</body></html>`);
    win.ZHS.panel.mount();
    const host = findHost(win);
    const box = win.document.getElementById('player-box');

    setFullscreenElement(win, box);
    eq('进入全屏后挂进容器', hostParent(win), box);

    win.ZHS.Log.clear();
    setFullscreenElement(win, null);
    eq('退出全屏后父节点回到 documentElement', hostParent(win), win.document.documentElement);
    ok('host 仍被文档包含', win.document.contains(host));
    ok('回迁日志已记录',
      win.ZHS.Log.all().some((e) => e.text.indexOf('已迁移回页面根节点') >= 0),
      win.ZHS.Log.all().map((e) => e.text).join(' | ').slice(-160));

    // 迂回：再进一次全屏，必须还能挂（验证状态机没有被上一次跑坏）
    setFullscreenElement(win, box);
    eq('二次进入全屏仍能挂载', hostParent(win), box);
  }

  console.log('\n=== FS-4. 全屏元素是 <video> → 挂到它的父容器，而不是 video 内部 ===');
  {
    const { win } = makeEnv(`<html><body>
<div id="wrap-outer"><div id="stage-a"><div id="ctrl-bar"></div><video id="v1"></video></div></div>
</body></html>`);
    win.ZHS.panel.mount();
    const host = findHost(win);
    const video = win.document.getElementById('v1');
    const stage = win.document.getElementById('stage-a');

    win.ZHS.Log.clear();
    setFullscreenElement(win, video);

    ok('没有把面板挂进 <video> 内部', hostParent(win) !== video);
    eq('挂到了 video 的父容器（播放器容器）', hostParent(win), stage);
    ok('<video> 的 children 里没有面板 host', video.children.length === 0,
      'children=' + video.children.length);
    // 关键：<video> 原生全屏（浏览器只合成 video 自己）下面板必定看不到，
    // 必须被识别成 native-media 交给降级流程，而不能假装成功。
    eq('识别为 native-media（原生媒体全屏）', win.ZHS.panel._fsState, 'native-media');
    ok('已记录待告知用户的标记', win.ZHS.panel._fsFailedNotice === true);
    ok('日志说明了原生全屏的限制',
      win.ZHS.Log.all().some((e) => e.text.indexOf('原生全屏') >= 0),
      win.ZHS.Log.all().map((e) => e.text).join(' | ').slice(-200));

    win.ZHS.Log.clear();
    setFullscreenElement(win, null);
    ok('退出后仍然迁回 documentElement', isAtRoot(win));
    eq('退出后状态机复位', win.ZHS.panel._fsState, '');

    // 父容器本身是 audio/video 的极端情况：一路往上找
    const { win: win2 } = makeEnv(`<html><body>
<div id="outer2"><div id="mid2"><video id="v2"></video></div></div>
</body></html>`);
    win2.ZHS.panel.mount();
    const host2 = findHost(win2);
    const v2 = win2.document.getElementById('v2');
    const mid2 = win2.document.getElementById('mid2');
    setFullscreenElement(win2, v2);
    eq('video 全屏时挂到最近的可承载祖先', hostParent(win2), mid2);
    ok('挂载点不是 video 自己', hostParent(win2) !== v2);
    ok('host 存在且未丢失 ShadowRoot', !!host2.shadowRoot);
  }

  console.log('\n=== FS-4b. 容器（非 video）全屏不算原生媒体全屏 ===');
  {
    const { win } = makeEnv(`<html><body>
<div id="player-box"><video></video></div>
</body></html>`);
    win.ZHS.panel.mount();
    const box = win.document.getElementById('player-box');
    setFullscreenElement(win, box);
    eq('div 全屏 = mounted（面板可正常显示）', win.ZHS.panel._fsState, 'mounted');
    eq('不标记为需要告知用户', win.ZHS.panel._fsFailedNotice, false);
    eq('_isNativeMediaFullscreen(div) 为 false', win.ZHS.panel._isNativeMediaFullscreen(box), false);
    eq('_isNativeMediaFullscreen(video) 为 true',
      win.ZHS.panel._isNativeMediaFullscreen(win.document.querySelector('video')), true);
  }

  console.log('\n=== FS-4c. 原生全屏默认不退，开了开关才退 ===');
  {
    const { win } = makeEnv(`<html><body>
<div id="player-box"><video id="vv"></video></div>
</body></html>`);
    const P = win.ZHS.panel;
    P.mount();
    const box = win.document.getElementById('player-box');
    let exitCalls = 0;
    win.document.exitFullscreen = () => { exitCalls++; return Promise.resolve(); };

    setFullscreenElement(win, win.document.getElementById('vv'));
    eq('进入原生全屏后状态为 native-media', P._fsState, 'native-media');

    // 直接触发降级（真实场景里由 3 秒复查定时器触发，这里不等 3 秒）
    P._exitFullscreenFallback();
    eq('默认不擅自退出用户的全屏', exitCalls, 0);

    win.ZHS.setConfig({ exitFullscreenOnPanel: true });
    P._exitFullscreenFallback();
    eq('用户开启开关后才退出全屏', exitCalls, 1);
    win.ZHS.setConfig({ exitFullscreenOnPanel: false });

    // 退出全屏 → 用户应收到「原生全屏下不可用」的解释
    P._fsFailedNotice = true;
    setFullscreenElement(win, null);
    const wrap = findHost(win).shadowRoot.querySelector('.wrap');
    const alertEl = wrap.querySelector('.alert');
    ok('退出后提示文案解释了原生全屏的限制',
      /原生全屏/.test(alertEl.textContent), alertEl.textContent);
    ok('提示里给了可操作的解决办法',
      /全屏按钮|退全屏/.test(alertEl.textContent), alertEl.textContent);
  }

  console.log('\n=== FS-5. video 直挂 html（无任何容器）→ 兜底挂回 html，不抛错 ===');
  {
    const { win } = makeEnv(`<html><body><video id="lonely"></video></body></html>`);
    win.ZHS.panel.mount();
    const host = findHost(win);
    const video = win.document.getElementById('lonely');

    // 把 video 直接挪到 html 下，模拟「没有播放器容器」的极端结构
    win.document.documentElement.appendChild(video);

    let threw = null;
    try { setFullscreenElement(win, video); } catch (e) { threw = e; }
    ok('迁移过程不抛异常', threw === null, threw && threw.message);
    ok('面板仍有归属节点', !!hostParent(win));
    ok('没有挂进 video', hostParent(win) !== video);
    ok('host 仍在文档中', win.document.contains(host));
  }

  console.log('\n=== FS-6. 迁移后面板状态保持（tab / 开关 / 日志 / 进度） ===');
  {
    const { win } = makeEnv(`<html><body>
<div class="chapter-tree-74">
  <div class="child-info hasvideo"><span class="child-name">A</span><i class="child-check"></i></div>
  <div class="child-info hasvideo"><span class="child-name">B</span></div>
</div>
<div id="player-box"><video></video></div>
</body></html>`);
    const ZHS = win.ZHS;
    const P = ZHS.panel;
    P.mount();

    const host = findHost(win);
    const box = win.document.getElementById('player-box');
    const sr = host.shadowRoot;
    const wrap = sr.querySelector('.wrap');

    // ---- 造状态 1：切到设置页 + 打开某个开关 ----
    wrap.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'cfg'));
    wrap.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === 'cfg'));
    ZHS.setConfig({ mute: true });
    P.refresh();

    const activeTabBefore = wrap.querySelector('.tabs button.on').dataset.tab;
    const muteOnBefore = wrap.querySelector('.sw[data-cfg="mute"]').classList.contains('on');
    const cprogBefore = wrap.querySelector('.cprog-bar > i').style.width;
    eq('迁移前当前 tab = cfg', activeTabBefore, 'cfg');
    eq('迁移前静音开关为开', muteOnBefore, true);

    // 写几条日志并渲染日志页内容（不切页，直接调渲染函数）
    ZHS.Log.info('FS-6 状态保持用例');
    P._renderLogs(wrap);
    const logsHtmlBefore = wrap.querySelector('.logs').innerHTML;
    ok('迁移前日志已渲染', logsHtmlBefore.length > 0);

    // ---- 进入全屏 ----
    setFullscreenElement(win, box);
    eq('host 已迁进全屏容器', hostParent(win), box);

    // 迁移后重新取引用（DOM 没重建，引用本应相同；用相同引用断言「没被重建」）
    const hostAfter = findHost(win);
    eq('host 还是同一个元素（没有重建 Shadow DOM）', hostAfter, host);
    ok('shadowRoot 未丢失', !!hostAfter.shadowRoot);
    eq('shadowRoot 还是同一个', hostAfter.shadowRoot, sr);

    const wrapAfter = hostAfter.shadowRoot.querySelector('.wrap');
    eq('当前 tab 迁移后保持 = cfg', wrapAfter.querySelector('.tabs button.on').dataset.tab, 'cfg');
    eq('对应 pane 仍为显示态',
      wrapAfter.querySelector('.pane.on').dataset.pane, 'cfg');
    eq('静音开关状态保持为开',
      wrapAfter.querySelector('.sw[data-cfg="mute"]').classList.contains('on'), true);
    eq('日志内容迁移后未丢', wrapAfter.querySelector('.logs').innerHTML, logsHtmlBefore);
    eq('进度条宽度保持', wrapAfter.querySelector('.cprog-bar > i').style.width, cprogBefore);
    eq('样式表仍在 Shadow 内', wrapAfter.parentNode.querySelectorAll('style').length >= 1, true);

    // ---- 退出全屏，状态仍要保持 ----
    setFullscreenElement(win, null);
    const wrapBack = findHost(win).shadowRoot.querySelector('.wrap');
    eq('退出全屏后 tab 仍为 cfg', wrapBack.querySelector('.tabs button.on').dataset.tab, 'cfg');
    eq('退出全屏后开关仍为开',
      wrapBack.querySelector('.sw[data-cfg="mute"]').classList.contains('on'), true);
    eq('退出全屏后日志仍在', wrapBack.querySelector('.logs').innerHTML, logsHtmlBefore);
  }

  console.log('\n=== FS-7. CSS 全屏（不触发 Fullscreen API）→ host 不动，保持可见 ===');
  {
    const { win } = makeEnv(`<html><body>
<div id="css-full" style="position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999">
  <video></video>
</div>
</body></html>`);
    win.ZHS.panel.mount();
    const host = findHost(win);

    // 页面把容器撑满视口，但没有调 requestFullscreen → fullscreenElement 仍为 null
    Object.defineProperty(win.document, 'fullscreenElement', { value: null, configurable: true, writable: true });
    let ev = null;
    try { ev = new win.Event('fullscreenchange'); } catch (e) { ev = null; }
    if (ev) win.document.dispatchEvent(ev);

    ok('CSS 全屏下 host 仍挂在 documentElement（不被乱搬）', isAtRoot(win));
    ok('host 仍在文档中（因此照常可见）', win.document.contains(host));
    eq('没有触发迁移状态', win.ZHS.panel._fsState, '');
  }

  console.log('\n=== FS-7b. 几何兜底：API 读不到全屏元素时的候选宿主选择 ===');
  {
    const { win } = makeEnv(`<html><body>
<div id="top-full" style="position:absolute;left:0;top:0;width:100vw;height:100vh"></div>
<div id="small-fixed" style="position:fixed;left:0;top:0;width:40px;height:40px"></div>
<div id="static-full" style="position:static;width:100vw;height:100vh"></div>
</body></html>`);
    const P = win.ZHS.panel;
    P.mount();

    // jsdom 无布局：所有 rect 都是 0，为了测选择逻辑，给候选打上伪造的几何/样式
    const stubBox = (id, pos, w, h) => {
      const el = win.document.getElementById(id);
      el.getBoundingClientRect = () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h });
      const orig = win.getComputedStyle.bind(win);
      win.getComputedStyle = (node, ps) => {
        const real = orig(node, ps);
        if (node === el) {
          return new Proxy(real, {
            get(t, k) { return k === 'position' ? pos : t[k]; },
          });
        }
        return real;
      };
      return el;
    };

    // 视口给个可用尺寸（jsdom 默认 1024x768）
    ok('jsdom 视口可读', win.innerWidth > 0 && win.innerHeight > 0,
      win.innerWidth + 'x' + win.innerHeight);

    const topFull = stubBox('top-full', 'absolute', win.innerWidth, win.innerHeight);
    stubBox('small-fixed', 'fixed', 40, 40);
    stubBox('static-full', 'static', win.innerWidth, win.innerHeight);

    const guess = P._guessFullscreenContainer();
    ok('能猜出铺满视口的定位容器', !!guess, guess && guess.id);
    eq('选中铺满视口的 absolute 容器', guess && guess.id, 'top-full');
    eq('不会误选小尺寸 fixed 元素', guess && guess.id === 'small-fixed', false);
    eq('不会误选 static 的普通满屏元素', guess && guess.id === 'static-full', false);

    // API 读不到时，_fsElement() 应回落到几何兜底结果
    for (const key of ['fullscreenElement', 'webkitFullscreenElement', 'webkitCurrentFullScreenElement']) {
      Object.defineProperty(win.document, key, { value: null, configurable: true, writable: true });
    }
    eq('_fsElement() 在 API 为空时回落到几何候选', P._fsElement(), topFull);

    // 并且真的会把面板挂进去（模拟「老内核对不上 fullscreenElement」的场景）
    P._onFullscreenChange();
    eq('几何兜底模式下 host 已挂进该容器', hostParent(win), topFull);
    eq('状态机标记为已挂载', P._fsState, 'mounted');
  }

  console.log('\n=== FS-7c. 确认「没有全屏」时不会乱搬面板 ===');
  {
    const { win } = makeEnv(`<html><body>
<div id="normal" style="position:static;width:300px;height:200px"></div>
</body></html>`);
    const P = win.ZHS.panel;
    P.mount();
    for (const key of ['fullscreenElement', 'webkitFullscreenElement', 'webkitCurrentFullScreenElement']) {
      Object.defineProperty(win.document, key, { value: null, configurable: true, writable: true });
    }
    eq('几何兜底在无全屏时返回 null', P._guessFullscreenContainer(), null);
    eq('_fsElement() 返回 null', P._fsElement(), null);
    P._onFullscreenChange();
    ok('host 仍挂在 documentElement（没被乱搬）', isAtRoot(win));
    eq('状态机保持空闲', P._fsState, '');
  }

  console.log('\n=== FS-8. 降级开关：默认不退全屏，开了才退 ===');  {
    const { win } = makeEnv(`<html><body>
<div id="player-box"><video></video></div>
</body></html>`);
    win.ZHS.panel.mount();

    let exitCalls = 0;
    Object.defineProperty(win.document, 'fullscreenElement', { value: null, configurable: true, writable: true });
    win.document.exitFullscreen = () => { exitCalls++; return Promise.resolve(); };

    // ---- 默认配置（exitFullscreenOnPanel=false）----
    eq('默认配置 exitFullscreenOnPanel = false', win.ZHS.config.exitFullscreenOnPanel, false);
    win.ZHS.panel._exitFullscreenFallback();
    eq('默认不调用 exitFullscreen', exitCalls, 0);

    // ---- 用户显式打开开关 ----
    win.ZHS.setConfig({ exitFullscreenOnPanel: true });
    // 模拟仍处于全屏（让 _fsDocs 里的 document 有 fullscreenElement）
    const box = win.document.getElementById('player-box');
    setFullscreenElement(win, box, { noEvent: true });
    win.ZHS.panel._exitFullscreenFallback();
    eq('开启开关后才调用 exitFullscreen', exitCalls, 1);

    win.ZHS.setConfig({ exitFullscreenOnPanel: false });   // 还原
  }

  console.log('\n=== FS-9. 挂载失败 → 退出全屏后给用户可感知的提示 ===');
  {
    const { win } = makeEnv(`<html><body>
<div id="bad-box"><video></video></div>
</body></html>`);
    const P = win.ZHS.panel;
    P.mount();
    const host = findHost(win);

    // 把 appendChild 打成「挂不进去」：模拟个别播放器拒绝外部节点
    const box = win.document.getElementById('bad-box');
    const origAppend = box.appendChild.bind(box);
    box.appendChild = function () { throw new Error('拒绝挂载（模拟播放器容器）'); };

    win.ZHS.Log.clear();
    setFullscreenElement(win, box);

    // 这里期望：没有抛错、host 仍在文档里、标记已记下
    ok('挂载失败不抛异常泄漏', win.document.contains(host));
    ok('失败标记已记录（退出全屏后要告知用户）', P._fsFailedNotice === true);
    eq('状态机为 failed', P._fsState, 'failed');
    ok('日志含降级提示',
      win.ZHS.Log.all().some((e) => e.text.indexOf('进入降级模式') >= 0),
      win.ZHS.Log.all().map((e) => e.text).join(' | ').slice(-160));

    // 恢复 appendChild，然后退出全屏 → 应该弹出可见提示
    box.appendChild = origAppend;
    win.ZHS.Log.clear();
    setFullscreenElement(win, null);

    const wrap = findHost(win).shadowRoot.querySelector('.wrap');
    const alertEl = wrap.querySelector('.alert');
    ok('退出全屏后 alert 可见（有内容且带 warn 类）',
      alertEl.textContent.length > 0 && alertEl.className.includes('warn'),
      'text=' + alertEl.textContent + ' cls=' + alertEl.className);
    ok('提示文案说明「刚才全屏下不可用」', /全屏/.test(alertEl.textContent), alertEl.textContent);
    eq('失败标记已消费（只提示一次）', P._fsFailedNotice, false);
  }

  console.log('\n=== FS-10. 设计令牌收敛（美化可验证部分） ===');
  {
    const { win } = makeEnv('<html><body><video></video></body></html>');
    const P = win.ZHS.panel;
    P.mount();
    const sr = findHost(win).shadowRoot;
    const css = sr.querySelector('style').textContent;

    // 令牌必须存在
    for (const token of ['--zhs-pri-600', '--zhs-ok-400', '--zhs-warn-ink', '--zhs-danger-400',
      '--zhs-n-900', '--zhs-r-lg', '--zhs-s3']) {
      ok('令牌已定义 ' + token, css.includes(token + ':'));
    }

    // 业务规则里不应再出现「裸十六进制色值」——色值只允许出现在令牌定义区。
    // 做法：把 `--zhs-xxx: 值;` 这类声明整段挖掉，再看剩下的 CSS 里还有没有 #RRGGBB。
    const withoutTokens = css.replace(/--zhs-[\w-]+\s*:\s*[^;}]+[;}]/g, '');
    const bare = withoutTokens.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
    ok('业务规则里已无裸色值（全部走 var()）', bare.length === 0,
      '残留 ' + bare.length + ' 处：' + bare.slice(0, 8).join(', '));

    // 样式规则里应当普遍使用 var()（收敛的客观指标）
    const varUses = (css.match(/var\(--zhs-/g) || []).length;
    ok('业务规则大量引用设计令牌（var() ≥ 100 处）', varUses >= 100, '实得 ' + varUses);

    // JS 里也不要再写死功能色：refresh 与 showReport 的设色都走 _color()
    const srcPath = path.join(__dirname, '..', 'src', '06-panel.js');
    const srcCode = fs.readFileSync(srcPath, 'utf8');
    const jsSetColor = srcCode.slice(srcCode.indexOf('const bd = ZHS.Catalog.breakdown()'),
      srcCode.indexOf('_syncInput(box, sel, val)'));
    ok('状态数值色值已改为读令牌（_color）', jsSetColor.includes('_color('));
    const jsBare = jsSetColor.match(/#[0-9A-Fa-f]{6}/g) || [];
    ok('状态/报告设色处不再写死色值',
      jsBare.length === 0, jsBare.join(', '));
    ok('兜底色值集中在一张表里（COLOR_FALLBACK）',
      /const COLOR_FALLBACK = \{[\s\S]*?'ok-400'[\s\S]*?'warn-ink'[\s\S]*?'pri-ink2'/.test(srcCode));
    ok('_color() 名称与 CSS 令牌同名（--zhs- + name）',
      srcCode.includes("'--zhs-' + name"));

    // 功能依赖的 class 名与结构必须原样保留（美化不能动 JS 契约）
    const wrap = sr.querySelector('.wrap');
    for (const sel of ['.mini', '.panel', '.head', '.fold', '.tabs', '.body', '.pane',
      '.foot', '.btn-start', '.btn-stop', '.btn-next', '.btn-answer',
      '.alert', '.report', '.logs', '.guide', '.about', '.invite-code',
      '.sw[data-cfg="autoPlay"]', '.inp', '.sel-mode', '.sel-stop', '.sec-title']) {
      ok('关键选择器仍在：' + sel, !!wrap.querySelector(sel));
    }
    ok('tabs 仍是 3 个（状态/日志/设置）', wrap.querySelectorAll('.tabs button').length === 3);
    // 美化前后开关数量必须一致：原 18 个 data-cfg 开关 + 本轮新增的全屏降级开关 = 19
    eq('开关数量为 19（原 18 + 新增全屏降级）',
      wrap.querySelectorAll('.sw[data-cfg]').length, 19);
    ok('新增了全屏降级开关', !!wrap.querySelector('.sw[data-cfg="exitFullscreenOnPanel"]'));
    ok('_color() 能在无布局环境下安全兜底', P._color('ok-400', '#1D9E75').length > 0);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`全屏专项：通过 ${pass} / 失败 ${fail}`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach((f) => console.log('  · ' + f));
    process.exit(1);
  } else {
    console.log('全部通过 ✓');
    process.exit(0);
  }
})().catch((e) => {
  console.error('\n测试异常：' + e.message);
  console.error(e.stack);
  process.exit(1);
});
