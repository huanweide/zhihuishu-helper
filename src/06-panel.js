/**
 * 悬浮控制面板（Shadow DOM 隔离样式）
 */
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod06_panel) return;
  ZHS.__mod06_panel = true;
  // round-14【先发布后初始化】：守卫一旦上锁，本模块就再也不会被二次注入重新执行。
  // 但 ZHS.panel 原本要等到模块第 1300+ 行（跨过巨型 base64 图片、整段 CSS 模板、
  // Panel 对象字面量）才赋值 —— 中间任何一步抛异常（页面框架给 DOM API 打补丁、
  // 扩展干扰、模板插值取值异常……）就会形成「守卫已上锁 + ZHS.panel 永久 undefined」
  // 的不一致状态，面板永远无法自愈，而脚本却在跑 → 用户眼里就是「装了跟没装一样」。
  // 这里先在守卫后立即可靠地占位，末尾再用 Object.assign 把真正的 Panel 填进去。
  if (!ZHS.panel) ZHS.panel = {};
  const U = ZHS.Util;
  /**
   * 面板主题样式
   *
   * 设计原则（本轮美化）：收敛，而不是花哨。
   *   1. 所有颜色先落地成 CSS 变量（设计令牌），业务类只引用 var(--zhs-*)，
   *      色值不再散落在几十条规则里 —— 以后改主题只改这一处。
   *   2. 间距统一走 4px 基准的倍数（4/8/12/16），同类元素间距必然一致。
   *   3. 字号只保留 6 档且用途固定：10 辅助 / 11 正文 / 12 强调 / 13 标题 /
   *      14 面板基准 / 15 品牌字。
   *   4. 圆角只保留 3 档：12 大容器 / 8 卡片 / 6 小控件（胶囊开关单独算）。
   *   5. 所有 flex 子项显式 min-width:0 / flex-shrink:0，防止中文长标签把
   *      输入框挤出面板（浏览器缩放 150%/200% 时最容易复现）。
   *
   * 注意：class 名与 DOM 结构全部保持不变 —— 07-main/13-answerer 等模块
   * 以及本文件的 _bind()/refresh() 都靠这些 class 名定位元素。
   *
   * JS 里需要读色值的少数几处不要硬编码，统一用 <模块>._color(name) 取运行时值，
   * 避免「CSS 改了、JS 没跟着改」的隐性不一致。
   */
  const CSS = `
/* ===== 设计令牌（唯一的色值出口）=====
   蓝色按 300→700 分档，数值越小越深；下面的 300/400/500/600 分别对应
   「浅底 / 主色 / 悬停色 / 深色」。 */
:host {
  all: initial;
  /* 主色（蓝） */
  --zhs-pri-300: #B5D4F4;
  --zhs-pri-300d: #D2E6FA;
  --zhs-pri-400: #185FA5;
  --zhs-pri-400d: #134B85;
  --zhs-pri-500: #2480D6;
  --zhs-pri-600: #1E6FBF;
  --zhs-pri-700: #14508F;
  --zhs-pri-ink: #0C447C;
  --zhs-pri-ink2: #042C53;
  --zhs-pri-bg: #E6F1FB;
  --zhs-pri-bg2: #F3F8FE;
  /* 成功（绿） */
  --zhs-ok-300: #5DCAA5;
  --zhs-ok-400: #1D9E75;
  --zhs-ok-500: #27C08D;
  --zhs-ok-bg: #E1F5EE;
  --zhs-ok-ink: #085041;
  --zhs-ok-ink2: #0C4A2F;
  /* 警告（暖黄） */
  --zhs-warn-bg: #FAEEDA;
  --zhs-warn-ink: #854F0B;
  --zhs-warn-ink2: #412402;
  /* 危险（红） */
  --zhs-danger-400: #A32D2D;
  --zhs-danger-bg: #FCEBEB;
  --zhs-danger-ink: #501313;
  /* 品牌（渐变，仅品牌字样，不参与功能色） */
  --zhs-brand-a: #FFD56B;
  --zhs-brand-b: #FF8A3D;
  --zhs-brand-c: #FF7EB3;
  --zhs-brand-d: #FF5277;
  --zhs-brand-c2: #FF6BA3;
  --zhs-brand-d2: #F23E66;
  /* 中性（暖灰，8 档） */
  --zhs-n-0: #FFFFFF;
  --zhs-n-50: #FBFBF9;
  --zhs-n-100: #F7F6F2;
  --zhs-n-150: #F1EFE8;
  --zhs-n-200: #EDEBE4;
  --zhs-n-250: #D3D1C7;
  --zhs-n-600: #888780;
  --zhs-n-700: #5F5E5A;
  --zhs-n-800: #444441;
  --zhs-n-900: #2C2C2A;
  /* 描边与阴影 */
  --zhs-line: rgba(0,0,0,.12);
  --zhs-line-soft: rgba(0,0,0,.08);
  --zhs-line-strong: rgba(0,0,0,.18);
  --zhs-sh-sm: 0 1px 2px rgba(0,0,0,.2);
  --zhs-sh-md: 0 2px 8px rgba(0,0,0,.1);
  --zhs-sh-lg: 0 8px 32px rgba(0,0,0,.18);
  /* 间距（4px 基准） */
  --zhs-s1: 4px;
  --zhs-s2: 8px;
  --zhs-s3: 12px;
  --zhs-s4: 16px;
  /* 圆角（3 档 + 胶囊） */
  --zhs-r-lg: 12px;
  --zhs-r-md: 8px;
  --zhs-r-sm: 6px;
}

.about { padding: var(--zhs-s3); border-top: 1px dashed var(--zhs-line); background: var(--zhs-n-50); }
.about-head { display: flex; align-items: center; gap: var(--zhs-s2); margin-bottom: var(--zhs-s2); }
.retri { font-weight: 800; font-size: 15px; letter-spacing: .5px;
  background: linear-gradient(135deg,var(--zhs-brand-a),var(--zhs-brand-b)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.about-sub { font-size: 10px; color: var(--zhs-n-600); }
.about-link { display: block; padding: var(--zhs-s2) var(--zhs-s3); margin: var(--zhs-s1) 0; border-radius: var(--zhs-r-md);
  background: var(--zhs-pri-bg); color: var(--zhs-pri-ink2); text-decoration: none; font-size: 11px; font-weight: 600; }
.about-link:hover { background: var(--zhs-pri-300d); }
.sf-box { margin-top: var(--zhs-s2); }
.invite-code { width: 100%; display: flex; align-items: center; justify-content: center; gap: var(--zhs-s1);
  padding: var(--zhs-s2) var(--zhs-s3); margin: var(--zhs-s1) 0 0; border: 1px dashed var(--zhs-pri-300); border-radius: var(--zhs-r-md);
  background: var(--zhs-pri-bg2); color: var(--zhs-pri-400); cursor: pointer; font-size: 11px; font-weight: 600; }
.invite-code:hover { background: var(--zhs-pri-bg); border-style: solid; }
.invite-code b { font-family: ui-monospace, Consolas, monospace; font-size: 12px; letter-spacing: .5px; color: var(--zhs-pri-ink); }
.invite-code .copy-tip { font-size: 10px; font-weight: 400; color: var(--zhs-n-600); }
.invite-code.copied { background: var(--zhs-ok-bg); border-color: var(--zhs-ok-300); color: var(--zhs-ok-ink); }
.invite-code.copied .copy-tip { color: var(--zhs-ok-400); }

.wrap { position: fixed; right: var(--zhs-s4); bottom: var(--zhs-s4); z-index: 2147483647;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 14px; }
/* 盒模型统一成 border-box，否则 padding 会叠加到 width:330px 上，
   计算面板总高时永远对不上（也影响下面 --zhs-body-max 的取值）。 */
.wrap, .wrap *, .wrap *::before, .wrap *::after { box-sizing: border-box; }
/* 面板高度自适应：视口不够高时按比例收窄可滚动区，保证头部/标签页/底部按钮栏
   三段始终可见，绝不会被视口裁掉。
   算法：360px 是可滚动区上限；视口最多分 42% 给它；
   再减去除可滚动区以外的固定高度（头部 43 + 标签页 36 + 底部按钮 86 + 外边距 32）。 */
.wrap {
  --zhs-body-max: 320px;              /* 兜底值：不支持 min() 的老内核 */
  --zhs-body-max: max(120px, min(320px, 42vh - 120px));
}
@media (min-height: 821px) { .wrap { --zhs-body-max: 360px; } }
@media (max-height: 720px) { .wrap { --zhs-body-max: 220px; } }
@media (max-height: 560px) { .wrap { --zhs-body-max: 150px; } }
@media (max-height: 430px) { .wrap { --zhs-body-max: 110px; } }

.mini { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, var(--zhs-pri-600), var(--zhs-pri-700));
  color: var(--zhs-n-0); display: flex; align-items: center; justify-content: center; cursor: pointer;
  border: none; font-size: 15px; font-weight: 600; box-shadow: 0 3px 12px rgba(24,95,165,.35);
  transition: transform .12s, box-shadow .12s; }
.mini:hover { transform: scale(1.08); box-shadow: 0 4px 16px rgba(24,95,165,.5); }
.mini:active { transform: scale(.95); }

.panel { width: 330px; background: var(--zhs-n-0); border: 1px solid var(--zhs-line); border-radius: var(--zhs-r-lg);
  overflow: hidden; box-shadow: var(--zhs-sh-lg); display: none; }
.panel.show { display: block; }

.head { padding: var(--zhs-s3) var(--zhs-s3); background: linear-gradient(135deg, var(--zhs-pri-600), var(--zhs-pri-700));
  display: flex; align-items: center; justify-content: space-between; gap: var(--zhs-s2); }
.head b { font-size: 14px; font-weight: 600; color: var(--zhs-n-0); letter-spacing: .3px;
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.head .btns { flex-shrink: 0; }
.head .btns button { background: rgba(255,255,255,.15); border: none; cursor: pointer; color: var(--zhs-n-0);
  font-size: 14px; line-height: 1.2; padding: var(--zhs-s1) var(--zhs-s2); border-radius: var(--zhs-r-sm); transition: background .12s; }
.head .btns button:hover { background: rgba(255,255,255,.28); }

.tabs { display: flex; border-bottom: 1px solid var(--zhs-line); background: var(--zhs-n-0); }
.tabs button { flex: 1; padding: var(--zhs-s2) 0; border: none; background: none; cursor: pointer;
  font-size: 13px; color: var(--zhs-n-700); border-bottom: 2px solid transparent; transition: color .12s; }
.tabs button:hover { color: var(--zhs-pri-400); }
.tabs button.on { color: var(--zhs-pri-400); border-bottom-color: var(--zhs-pri-400); font-weight: 600; }

.body { padding: var(--zhs-s3); max-height: var(--zhs-body-max); overflow-y: auto;
  color: var(--zhs-n-900); }   /* 显式给文字色：.wrap 上只有 font-size，颜色靠继承，
                                  页面里若有「全局把文字设成黑色」的样式，
                                  暗色主题下就会变成黑字黑底、内容看不见。
                                  注：CSS 注释里不能出现反引号，会提前结束模板串。 */
.body .pane { display: none; }
.body .pane.on { display: block; }
/* .row / .report 等行内设了字的元素同理：颜色一律显式声明，不依赖继承 */
/* 状态页课程进度条 */
.cprog-bar { height: 6px; border-radius: 3px; background: var(--zhs-n-200); overflow: hidden; margin: var(--zhs-s2) 0 var(--zhs-s3); }
.cprog-bar > i { display: block; height: 100%; width: 0;
  background: linear-gradient(90deg, var(--zhs-ok-400), var(--zhs-ok-500)); border-radius: 3px; transition: width .4s; }

.row { display: flex; align-items: center; justify-content: space-between; gap: var(--zhs-s2); padding: var(--zhs-s1) 0; }
.row label { color: var(--zhs-n-900); min-width: 0; }
.row .val { color: var(--zhs-n-600); font-size: 11px; flex-shrink: 0; }
/* 开关/输入框不能被长中文标签挤变形 */
.row .sw { flex: 0 0 auto; }
.row > .inp, .row > input, .row > select { flex-shrink: 0; }

.kv { display: flex; justify-content: space-between; gap: var(--zhs-s2); padding: var(--zhs-s1) 0; border-bottom: 1px dashed var(--zhs-line-soft); }
.kv span:first-child { color: var(--zhs-n-700); min-width: 0; }
.kv span:last-child { color: var(--zhs-n-900); font-weight: 500; flex-shrink: 0;
  max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* round-31【弹题实时状态卡】 */
.dlg-card { display: flex; align-items: center; gap: var(--zhs-s2); margin: var(--zhs-s2) 0; padding: var(--zhs-s2) var(--zhs-s3);
  border-radius: var(--zhs-r-sm); font-size: 11px; font-weight: 500; border: 1px solid transparent; }
.dlg-card .dlg-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: var(--zhs-n-400); }
.dlg-card .s-dlg { color: var(--zhs-n-900); }
.dlg-card.s-dlg-none { background: var(--zhs-n-100); border-color: var(--zhs-line); }
.dlg-card.s-dlg-detected { background: var(--zhs-pri-bg); border-color: var(--zhs-pri-300); color: var(--zhs-pri-ink2); }
.dlg-card.s-dlg-detected .dlg-dot { background: var(--zhs-pri-500); }
.dlg-card.s-dlg-answering { background: var(--zhs-warn-bg); border-color: var(--zhs-warn-300, #f0c36d); color: var(--zhs-warn-ink2); }
.dlg-card.s-dlg-answering .dlg-dot { background: var(--zhs-warn-400, #e6a23c); animation: zhs-pulse 1s ease-in-out infinite; }
.dlg-card.s-dlg-answered { background: var(--zhs-ok-bg); border-color: var(--zhs-ok-400); color: var(--zhs-ok-ink2); }
.dlg-card.s-dlg-answered .dlg-dot { background: var(--zhs-ok-500); }
.dlg-card.s-dlg-pending { background: var(--zhs-danger-bg); border-color: var(--zhs-danger-400); color: var(--zhs-danger-ink); }
.dlg-card.s-dlg-pending .dlg-dot { background: var(--zhs-danger-400); animation: zhs-pulse 1.2s ease-in-out infinite; }
@keyframes zhs-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.4); opacity: .5; } }

.sw { width: 36px; height: 19px; border-radius: 10px; background: var(--zhs-n-250); position: relative;
  cursor: pointer; border: none; transition: background .15s; flex: 0 0 auto; }
.sw.on { background: var(--zhs-ok-400); }
.sw:disabled { opacity: .45; cursor: not-allowed; }
.sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 15px; height: 15px;
  border-radius: 50%; background: var(--zhs-n-0); transition: left .15s; box-shadow: var(--zhs-sh-sm); }
.sw.on::after { left: 19px; }

.logs { font-family: ui-monospace, Consolas, monospace; font-size: 11px; line-height: 1.6; }
.logs div { padding: 1px 0; word-break: break-all; color: var(--zhs-n-800); }
.logs .warn { color: var(--zhs-warn-ink); }
.logs .error { color: var(--zhs-danger-400); }

.alert { margin: 0 var(--zhs-s3) var(--zhs-s2); padding: var(--zhs-s2) var(--zhs-s2); border-radius: var(--zhs-r-sm); font-size: 11px; display: none; }
.alert.warn { background: var(--zhs-warn-bg); color: var(--zhs-warn-ink2); display: block; }
.alert.info { background: var(--zhs-pri-bg); color: var(--zhs-pri-ink2); display: block; }
.alert.error { background: var(--zhs-danger-bg); color: var(--zhs-danger-ink); display: block; }

/* 底部按钮：保持「四个按钮一行」的原布局（不改成 2×2）。
   注：曾试过 grid 2×2，实测在 border-box 下反而把可滚动区挤塌，
   而且一行四键更省纵向空间 —— 能用就不折腾。 */
.foot { padding: var(--zhs-s2) var(--zhs-s3); border-top: 1px solid var(--zhs-line);
  background: var(--zhs-n-100); display: flex; gap: var(--zhs-s1); }
.foot button { flex: 1; min-width: 0; padding: var(--zhs-s2) 0; border: 1px solid rgba(0,0,0,.15); border-radius: var(--zhs-r-sm);
  background: var(--zhs-n-0); cursor: pointer; font-size: 11px; color: var(--zhs-n-900); font-weight: 500;
  transition: background .12s, transform .08s, opacity .12s; }
.foot button:hover:not(:disabled) { background: var(--zhs-n-150); }
.foot button:active:not(:disabled) { transform: scale(.96); }
.foot button:disabled { opacity: .55; cursor: not-allowed; }
.foot button.pri { background: linear-gradient(135deg, var(--zhs-pri-600), var(--zhs-pri-700)); color: var(--zhs-n-0); border-color: var(--zhs-pri-700); }
.foot button.pri:hover:not(:disabled) { background: linear-gradient(135deg, var(--zhs-pri-500), var(--zhs-pri-400d)); }
.foot button.pri:disabled { background: var(--zhs-pri-300); border-color: var(--zhs-pri-300); }
.foot button.loading { position: relative; color: transparent !important; pointer-events: none; }
.foot button.loading::after { content: ""; position: absolute; left: 50%; top: 50%;
  width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.4); border-top-color: var(--zhs-n-0); animation: zhs-spin .7s linear infinite; }
.foot button.loading.btn-plain::after { border-color: rgba(0,0,0,.15); border-top-color: var(--zhs-n-700); }
@keyframes zhs-spin { to { transform: rotate(360deg); } }
/* round-50：重新探测目录 —— 主操作区下方的次级恢复型按钮，全宽虚线幽灵态，与主四键视觉层级分明 */
.foot2 { padding: 0 var(--zhs-s3) var(--zhs-s2); }
.foot2 button { width: 100%; padding: var(--zhs-s2) 0; border: 1px dashed var(--zhs-line-strong);
  border-radius: var(--zhs-r-sm); background: transparent; color: var(--zhs-n-600); cursor: pointer;
  font-size: 11px; font-weight: 500; transition: background .15s, color .15s, border-color .15s, transform .08s; }
.foot2 button:hover:not(:disabled) { border-color: var(--zhs-pri-400); color: var(--zhs-pri-600); background: var(--zhs-n-50); }
.foot2 button:active:not(:disabled) { transform: scale(.98); }
.foot2 button:disabled { opacity: .55; cursor: not-allowed; }
.foot2 button.loading { position: relative; color: transparent !important; pointer-events: none; }
.foot2 button.loading::after { content: ""; position: absolute; left: 50%; top: 50%;
  width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%;
  border: 2px solid rgba(0,0,0,.15); border-top-color: var(--zhs-n-700); animation: zhs-spin .7s linear infinite; }

/* v0.6.64 跳到指定课时：输入框 + 按钮一行 */
.foot-jump { display: flex; gap: var(--zhs-s2); padding: 0 var(--zhs-s3) var(--zhs-s2); align-items: center; }
.foot-jump .btn-gotolesson { flex: 0 0 auto; padding: var(--zhs-s1) var(--zhs-s3); font-size: 11px; font-weight: 500;
  border: 1px solid var(--zhs-line-strong); border-radius: var(--zhs-r-sm); background: var(--zhs-n-0);
  color: var(--zhs-n-700); cursor: pointer; transition: background .15s, color .15s, border-color .15s, transform .08s; }
.foot-jump .btn-gotolesson:hover:not(:disabled) { border-color: var(--zhs-pri-400); color: var(--zhs-pri-600); background: var(--zhs-n-50); }
.foot-jump .btn-gotolesson:active:not(:disabled) { transform: scale(.97); }
.foot-jump .btn-gotolesson:disabled { opacity: .55; cursor: not-allowed; }
.foot-jump .btn-gotolesson.loading { position: relative; color: transparent !important; pointer-events: none; }
.foot-jump .btn-gotolesson.loading::after { content: ""; position: absolute; left: 50%; top: 50%;
  width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%;
  border: 2px solid rgba(0,0,0,.15); border-top-color: var(--zhs-n-700); animation: zhs-spin .7s linear infinite; }

.inp { width: 152px; max-width: 152px; font-size: 11px; padding: var(--zhs-s1) var(--zhs-s2); border: 1px solid var(--zhs-line-strong);
  border-radius: var(--zhs-r-sm); background: var(--zhs-n-0); color: var(--zhs-n-900); transition: border .12s, box-shadow .12s; }
.inp:focus { outline: none; border-color: var(--zhs-pri-600); box-shadow: 0 0 0 2px rgba(30,111,191,.15); }
.sel-inp { width: 110px; }
.mini-btn { font-size: 10px; padding: var(--zhs-s1) var(--zhs-s2); border: 1px solid var(--zhs-line-strong);
  border-radius: var(--zhs-r-sm); background: var(--zhs-n-0); cursor: pointer; color: var(--zhs-n-900);
  transition: background .12s, opacity .12s; }
.mini-btn:hover:not(:disabled) { background: var(--zhs-n-150); }
.mini-btn:disabled { opacity: .55; cursor: not-allowed; }
.mini-btn.ok { background: var(--zhs-ok-bg); border-color: var(--zhs-ok-400); color: var(--zhs-ok-ink2); }
.mini-btn.bad { background: var(--zhs-danger-bg); border-color: var(--zhs-danger-400); color: var(--zhs-danger-ink); }

.hint { font-size: 10px; color: var(--zhs-n-600); padding: var(--zhs-s1) 0 var(--zhs-s2); line-height: 1.6; min-width: 0; overflow-wrap: anywhere; }
.sec-title { margin: var(--zhs-s3) 0 var(--zhs-s1); font-size: 12px; font-weight: 600; color: var(--zhs-pri-400); }

/* 首次使用引导卡 */
.guide { margin: 0 0 var(--zhs-s3); padding: var(--zhs-s3); border-radius: var(--zhs-r-md); background: var(--zhs-pri-bg);
  border: 1px solid var(--zhs-pri-300); }
.guide h4 { margin: 0 0 var(--zhs-s2); font-size: 13px; color: var(--zhs-pri-ink2); }
.guide ol { margin: 0 0 var(--zhs-s3); padding-left: 18px; color: var(--zhs-pri-ink2); font-size: 11px; line-height: 1.8; }
.guide button { width: 100%; padding: var(--zhs-s2) 0; font-size: 11px; border: none; border-radius: var(--zhs-r-sm);
  background: var(--zhs-pri-400); color: var(--zhs-n-0); cursor: pointer; font-weight: 500; }
.guide button:hover { background: var(--zhs-pri-400d); }

/* 完成总结弹层 */
.report { margin: 0 var(--zhs-s3) var(--zhs-s2); padding: var(--zhs-s3); border-radius: var(--zhs-r-md); background: var(--zhs-pri-bg);
  border: 1px solid var(--zhs-pri-300); display: none; }
.report.show { display: block; }
.report h4 { margin: 0 0 var(--zhs-s2); font-size: 13px; color: var(--zhs-pri-ink2); font-weight: 600; }
.report .line { display: flex; justify-content: space-between; gap: var(--zhs-s2); font-size: 11px; padding: 2px 0; color: var(--zhs-pri-ink2); }
.report .line b { font-weight: 600; flex-shrink: 0; }
.report .line span:first-child { color: var(--zhs-pri-400); min-width: 0; }
.report .close-rp { margin-top: var(--zhs-s2); width: 100%; padding: var(--zhs-s1) 0; font-size: 10px;
  border: 1px solid var(--zhs-pri-400); background: var(--zhs-n-0); color: var(--zhs-pri-400); border-radius: var(--zhs-r-sm); cursor: pointer; }

/* 暗色主题跟随（不引入 class，纯媒体查询 —— JS 侧零改动、零风险）
   只覆盖会影响观感的中性色令牌，品牌蓝/绿保持原样，视觉基调不变。
   注意：这里的色值【必须】以 var() 定义引用已有的基础令牌来做派生，
   所以下面这组值本身是新值，但它们同样只出现在「令牌定义区」，
   业务规则（.row/.panel/.foot …）里依旧一个裸色值都没有。 */
@media (prefers-color-scheme: dark) {
  :host {
    --zhs-line: rgba(255,255,255,.14);
    --zhs-line-soft: rgba(255,255,255,.1);
    --zhs-line-strong: rgba(255,255,255,.22);
    --zhs-sh-lg: 0 8px 32px rgba(0,0,0,.6);
    --zhs-sh-md: 0 2px 8px rgba(0,0,0,.4);
    --zhs-sh-sm: 0 1px 2px rgba(0,0,0,.5);
    /* 暖灰阶整体反转：n-0 是「面板底色」，暗色下变成深底 */
    --zhs-n-0: #14140F;
    --zhs-n-50: #17170F;
    --zhs-n-100: #1B1B15;
    --zhs-n-150: #21211A;
    --zhs-n-200: #2A2A22;
    --zhs-n-250: #4A4A40;
    --zhs-n-600: #9C9B93;
    --zhs-n-700: #B2B1A9;
    --zhs-n-800: #D8D6CE;
    --zhs-n-900: #F2F0EA;
    /* 语义底色压暗、文字色提亮，保证对比度 */
    --zhs-pri-bg: #16293C;
    --zhs-pri-bg2: #12202E;
    --zhs-pri-ink: #CFE3F8;
    --zhs-pri-ink2: #E2EEFB;
    --zhs-ok-bg: #12291F;
    --zhs-ok-ink: #B7EBD8;
    --zhs-ok-ink2: #C9F1E2;
    --zhs-warn-bg: #362712;
    --zhs-warn-ink: #F0C079;
    --zhs-warn-ink2: #F6D9AC;
    --zhs-danger-bg: #33191A;
    --zhs-danger-ink: #F3B9B9;
  }
  /* 暗色下描边不能再叠白线，否则发灰发脏 */
  .inp, .foot button, .mini-btn { border-color: var(--zhs-line-strong); }
  .about-link { color: var(--zhs-pri-ink2); }
}

/* ===== round-49 深度美化（纯视觉/交互增强，不改功能逻辑与 class 锚点）===== */
/* 头部状态灯：挂在那儿就能一眼看出「脚本活着没」+ 版本徽章 */
.head { display: flex; align-items: center; gap: var(--zhs-s2); position: relative; }
.head b { flex: 1 1 auto; min-width: 0; font-size: 13px; }
.head .status-dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; background: var(--zhs-n-250);
  box-shadow: 0 0 0 3px rgba(255,255,255,.18); transition: background .3s ease, box-shadow .3s ease; }
.head .status-dot.run { background: var(--zhs-ok-500); box-shadow: 0 0 0 3px rgba(39,192,141,.3); animation: zhs-breathe 2s ease-in-out infinite; }
.head .status-dot.busy { background: var(--zhs-warn-400, #e6a23c); box-shadow: 0 0 0 3px rgba(230,162,60,.32); animation: zhs-breathe 1.3s ease-in-out infinite; }
.head .ver { font-size: 10px; font-weight: 600; color: rgba(255,255,255,.85); background: rgba(255,255,255,.16);
  padding: 2px 7px; border-radius: 999px; flex: 0 0 auto; letter-spacing: .3px; }

/* 进度条：渐变填充 + 平滑过渡（进度跳动不再生硬） */
.cprog-bar > i { background: linear-gradient(90deg, var(--zhs-pri-500), var(--zhs-pri-400));
  transition: width .6s cubic-bezier(.4,0,.2,1); }

/* 开关：滑块平滑滑动 + 开态微光晕（点开关不再是瞬移） */
.sw::after { transition: left .2s cubic-bezier(.4,0,.2,1); }
.sw.on { box-shadow: 0 0 0 3px rgba(29,158,117,.18); }

/* 动作按钮：胶囊化 + 悬浮上浮 + 按压下压 + 更立体阴影（更现代、更跟手） */
.foot button { border-radius: 999px; box-shadow: var(--zhs-sh-sm); transition: transform .12s ease, box-shadow .12s ease, background .2s ease; }
.foot button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: var(--zhs-sh-md); }
.foot button:active:not(:disabled) { transform: translateY(1px) scale(.97); }

/* tab 切换淡入（切状态/日志/设置时内容平滑出现，不再硬跳） */
.pane { animation: zhs-fade .22s ease; }
@keyframes zhs-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@keyframes zhs-breathe { 0%,100% { opacity: 1; } 50% { opacity: .45; } }

/* 状态页分组卡片：把平铺 .kv 归到语义组，层次更清晰 */
.card { margin: 0 0 var(--zhs-s2); padding: var(--zhs-s2) var(--zhs-s3); border-radius: var(--zhs-r-md);
  background: var(--zhs-n-50); border: 1px solid var(--zhs-line-soft); }
.card-h { font-size: 11px; font-weight: 600; color: var(--zhs-n-600); margin: 0 0 var(--zhs-s1);
  display: flex; align-items: center; gap: var(--zhs-s1); min-width: 0; }
.card-h::before { content: ""; width: 3px; height: 11px; border-radius: 2px; background: var(--zhs-pri-400); flex: 0 0 auto; }
.card .kv:last-child { border-bottom: none; }
.foot button.stop-armed { background: linear-gradient(135deg, var(--zhs-danger-400), #7a1f1f); color: var(--zhs-n-0); border-color: var(--zhs-danger-400); }
`;

  /**
   * 设计令牌的「静态兜底值」。
   *
   * 用途：JS 里偶尔需要给元素直接设 color（例如状态数字"未看完"变橙）。
   * 优先从 :host 的 CSS 变量读实时值（见 Panel._color），读不到时用这里的兜底。
   *
   * 为什么要单独列一张表、不散落在调用点：
   *   1. 值只在【这一处】出现，改主题时改这里 + CSS 变量定义区即可；
   *   2. 测试可以断言「调用点没有裸色值」，防止以后又有人写死颜色；
   *   3. 名字与 CSS 令牌同名（ok-400 → --zhs-ok-400），一眼能对上。
   */
  const COLOR_FALLBACK = {
    'ok-400': '#1D9E75',
    'warn-ink': '#854F0B',
    'pri-ink2': '#042C53',
  };

  /**
   * 清洗 API Key：去掉全部空白字符。
   * 用户常从网页/文档里复制 Key，容易混进首尾空格或换行——带着空格的 Key
   * 会让请求直接超时或 401，而面板毫无提示，是个纯隐形坑。
   */
  function normKey(s) {
    return String(s || '').replace(/\s+/g, '');
  }

  const Panel = {
    _root: null,
    _shadow: null,
    _tabs: ['home', 'log', 'cfg'],

    mount() {
      if (this._root && document.contains(this._root)) return;
      const host = document.createElement('div');
      host.id = 'zhs-helper-panel';
      host.style.cssText = 'all:initial';
      this._shadow = host.attachShadow({ mode: 'open' });

      const style = document.createElement('style');
      style.textContent = CSS;
      this._shadow.appendChild(style);

      const box = document.createElement('div');
      box.className = 'wrap';
      box.innerHTML = this._html();
      this._shadow.appendChild(box);

      document.documentElement.appendChild(host);
      this._root = host;

      this._bind(box);
      this._bindFullscreen();
      this.refresh();
        // panelVisible=false 时面板默认隐藏（用户仍可点 .mini 唤出）
        if (ZHS.config.panelVisible === false) {
          const _p = box.querySelector('.panel');
          if (_p) _p.classList.remove('show');
        }
      ZHS.Log.debug('控制面板已挂载');
    },

    // ================================================================
    // 全屏适配：为什么必须做迁移，而不是调大 z-index
    //
    // 进入 Fullscreen API 全屏后，浏览器【只渲染全屏元素及其子树】。
    // 面板挂在 document.documentElement 下，不在全屏元素的子树里，
    // 于是被整体隐藏 —— z-index 调到 2147483647 也没用，它压根不参与渲染。
    //
    // 唯一的正解是把承载面板的 host 元素 appendChild 进全屏元素内部。
    // Shadow DOM 是挂在 host 上的，移动 host 不会丢 Shadow 内容；
    // 状态（当前 tab / 开关 / 日志 / 滚动位置）也都活在 DOM 里，一并保留。
    // ================================================================

    /** 记录已绑定过 fullscreenchange 的 document 对象（去重，支持 iframe 多 document） */
    _fsBoundDocs: null,
    /** 全屏状态机：'' 空闲 | 'mounted' 已挂进全屏元素 | 'failed' 挂不进去 */
    _fsState: '',
    /** 挂载失败后的复查定时器 */
    _fsTimer: null,
    /** 全屏期间挂载失败待告知用户的标记（退出全屏后弹提示） */
    _fsFailedNotice: false,

    /**
     * 挑一个能真正承载子元素的容器来挂面板。
     *
     * 坑：document.fullscreenElement 常常就是 <video> 本身，
     * 而 <video> 是替换元素，内部不会渲染任何子节点 —— 挂进去等于没挂。
     * 所以要按顺序找：全屏元素自己 → 它的祖先链 → 兜底回 documentElement。
     *
     * @param {Element|null} el 全屏元素
     * @returns {Element} 面板 host 应该挂到哪里
     */
    _pickMountTarget(el) {
      const canHost = (n) => !!n && n.nodeType === 1
        && n.tagName !== 'VIDEO' && n.tagName !== 'AUDIO' && n.tagName !== 'IFRAME';

      if (!canHost(el)) {
        // 全屏元素是 <video>：从它自己开始往上找（parentElement 依次是
        // 播放器容器 → 布局容器 → …），第一个「非 video/audio/iframe」的祖先即可承载。
        let p = el && el.parentElement;
        while (p && p.nodeType === 1) {
          if (canHost(p)) return p;
          p = p.parentElement;
        }
        // 一路到顶都没找到video以上的容器（video 已直挂 html）：退回 html
        return document.documentElement || null;
      }
      return el;
    },

    /**
     * 全屏元素本身是不是 <video>/<audio>（浏览器原生播放器全屏）。
     *
     * 为什么单独判断：容器全屏（例如 div.player 全屏）时，把面板挂进该 div
     * 就能正常显示；但【对 <video> 调 requestFullscreen】时，Chrome 进入的是
     * 「原生视频全屏」，屏幕上只合成 video 元素自己 —— 哪怕 DOM 上把面板
     * 挂进它的兄弟容器，实测也不渲染（截图验证过，全黑只剩原生控件）。
     * 这是浏览器渲染管线的行为，改 DOM 结构解决不了，必须走降级路径。
     */
    _isNativeMediaFullscreen(el) {
      return !!el && el.nodeType === 1
        && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO');
    },

    /**
     * 把面板 host 迁移到目标容器内。
     * @returns {boolean} 是否迁移成功
     */
    _moveTo(target) {
      if (!this._root || !target || typeof target.appendChild !== 'function') return false;
      try {
        target.appendChild(this._root);
      } catch (e) {
        ZHS.Log.warn('[面板] 迁移到全屏元素失败：' + e.message);
        return false;
      }
      // 确认真的进去了（appendChild 在某些宿主上会被静默拒绝）
      if (this._root.parentNode !== target) return false;
      // 迁移后重新回填一次状态：面板此刻才可能具备真实布局，
      // 刷新一次保证 tab/开关/日志/进度都与后台一致（不会丢状态，只是重画）。
      try { this.refresh(); } catch (e) { /* refresh 失败不影响可见性 */ }
      return true;
    },

    /** 面板此刻是否真的可渲染（宽高都 > 0） */
    _panelLooksVisible() {
      if (!this._root) return false;
      let rect = null;
      try { rect = this._root.getBoundingClientRect(); } catch (e) { return false; }
      if (!rect) return false;
      if (rect.width > 0 && rect.height > 0) return true;
      // Shadow DOM：host 自身是 0×0 也是正常的（子内容撑开），再看宿主是否连接
      const box = this._shadow && this._shadow.querySelector('.wrap');
      if (box) {
        try {
          const r2 = box.getBoundingClientRect();
          if (r2 && r2.width > 0 && r2.height > 0) return true;
        } catch (e) { /* 忽略 */ }
      }
      // jsdom 无布局引擎（所有 rect 恒为 0），此时不把「测不出」当成「不可见」，
      // 否则真实测试环境里会误判成挂载失败。只有确有全屏容器却挂不进去才算失败。
      return !!(this._root.parentNode && this._root.parentNode.nodeType === 1);
    },

    /**
     * 开始监听指定 document 的 fullscreenchange（幂等，支持 iframe）
     *
     * 关键坑（踩过）：绝对【不能】直接写 addEventListener('fullscreenchange', this._onFullscreenChange)。
     * 浏览器把函数当监听器调用时 this 不是 Panel，而是事件目标（或 undefined），
     * 处理器里第一行 this._root 就会抛 TypeError。
     * 表现是「事件确实派发了，但脚本一点反应都没有」—— 测试若只调用
     * panel._onFullscreenChange() 则永远发现不了（那是带着正确 this 调用的）。
     * 所以这里用闭包固定 this，并在测试里以「监听器身份」调用做回归。
     */
    _bindFullscreen() {
      if (!this._fsBoundDocs) this._fsBoundDocs = [];
      const self = this;
      const handler = function () { return self._onFullscreenChange(); };
      const docs = this._fsDocs();
      for (const d of docs) {
        if (this._fsBoundDocs.indexOf(d) >= 0) continue;
        try {
          d.addEventListener('fullscreenchange', handler);
          d.addEventListener('webkitfullscreenchange', handler);
          this._fsBoundDocs.push(d);
        } catch (e) { /* 跨域 iframe 拿不到 document，忽略 */ }
      }
    },

    /** 需要监听的 document 列表：当前页面 + 已注入的同源 iframe */
    _fsDocs() {
      const list = [];
      if (typeof document !== 'undefined' && document) list.push(document);
      try {
        const frames = document.querySelectorAll('iframe');
        for (const f of frames) {
          // 跨域 iframe 访问 contentDocument 会抛错 —— 这种帧里脚本本来也注入不进去
          try { if (f.contentDocument) list.push(f.contentDocument); } catch (e) { /* 跨域忽略 */ }
        }
      } catch (e) { /* 忽略 */ }
      return list;
    },

    /**
     * 当前生效的全屏元素（兼容 webkit 前缀；含 iframe 内文档）
     *
     * 为什么还要做「几何兜底」：
     * 有些浏览器 / 播放器进入全屏时不维护 document.fullscreenElement
     * （旧 webkit 内核、某些内嵌播放器自绘全屏）。这时 API 读出来是 null，
     * 但「面板确实看不见」这件事是真实发生的。所以 API 读不到时，
     * 再找一次「铺满视口最顶层的大容器」，作为候选全屏宿主。
     */
    _fsElement() {
      for (const d of this._fsDocs()) {
        let el = null;
        try {
          el = d.fullscreenElement || d.webkitFullscreenElement
            || d.webkitCurrentFullScreenElement || null;
        } catch (e) { el = null; }
        if (el) return el;
      }
      return this._guessFullscreenContainer();
    },

    /**
     * 几何兜底：猜「铺满视口的全屏容器」。
     * 判据（三条都要满足，避免误伤普通满屏布局）：
     *   1. 它是 <body> 的某一层祖先/自身，且不是 html/body 自己；
     *   2. position 是 fixed 或 absolute（全屏容器几乎都这么写）；
     *   3. 尺寸接近整个视口（≥ 视口的 90%）。
     * 找不到就返回 null（表示「这里没有全屏」）。
     */
    _guessFullscreenContainer() {
      if (typeof document === 'undefined' || !document || !document.body) return null;
      let vw = 0, vh = 0;
      try {
        vw = (window && window.innerWidth) || 0;
        vh = (window && window.innerHeight) || 0;
      } catch (e) { return null; }
      // 视口尺寸读不到（jsdom 等无布局环境）时不猜，避免误判
      if (!vw || !vh) return null;

      let best = null, bestArea = 0;
      const all = document.body.querySelectorAll('div,section,main,article,aside');
      for (const el of all) {
        let cs = null, rect = null;
        try {
          cs = window.getComputedStyle(el);
          rect = el.getBoundingClientRect();
        } catch (e) { continue; }
        if (!cs || !rect) continue;
        if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
        if (rect.width < vw * 0.9 || rect.height < vh * 0.9) continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const area = rect.width * rect.height;
        // 取面积最大的那个（最外层的全屏容器），而不是第一个命中的
        if (area > bestArea) { best = el; bestArea = area; }
      }
      return best;
    },

    /**
     * 全屏状态变化时的真实动作（测试里直接调它，不依赖浏览器派发事件）。
     * 迁移 / 回迁 / 失败兜底都在这里。
     */
    _onFullscreenChange() {
      if (!this._root) return;
      // 顺带补绑 iframe 的 document（iframe 可能是全屏之后才插入的）
      this._bindFullscreen();

      const fsEl = this._fsElement();
      if (!fsEl) {
        // ---- 退出全屏：迁回 html ----
        const wasNative = this._fsState === 'native-media';
        this._fsState = '';
        if (this._fsTimer) { clearTimeout(this._fsTimer); this._fsTimer = null; }
        if (this._root.parentNode !== document.documentElement) {
          this._moveTo(document.documentElement);
          ZHS.Log.info('[面板] 已迁移回页面根节点（退出全屏）');
        }
        // 退出全屏后再把「刚才全屏下助手不可用」这件事告诉用户 ——
        // 全屏时面板看不见，alert 也看不见，只有退出后通知才有意义。
        if (this._fsFailedNotice) {
          this._fsFailedNotice = false;
          this.alert(wasNative
            ? '刚才用的是视频「原生全屏」，浏览器不允许助手面板与视频同时显示；助手仍在后台运行。想要全屏看到面板：改点页面上的全屏按钮，或在设置里开启「全屏挂不上就退全屏」。'
            : '刚才全屏时悬浮窗挂不进去，助手仍在后台运行（已记录）', 'warn', 15000);
          ZHS.Log.warn('[面板] 全屏期间面板不可见，已恢复并记录');
        }
        return;
      }

      // ---- 进入（或切换）全屏 ----
      //
      // 分两种情况，结论完全不同：
      //   (a) 容器全屏（div 全屏）→ 把 host 挂进该容器，面板即可见。这是主路径。
      //   (b) 原生媒体全屏（直接对 <video> 调 requestFullscreen）→ 屏幕只合成
      //       video 自己，挂 DOM 也没用（已用真实 Chrome 截图验证）。
      //       这里仍然把 host 挂到播放器容器内（保证 DOM 归属正确、退出后无残留），
      //       但标记为 native-media，让降级流程来决定要不要自动退全屏。
      const nativeMedia = this._isNativeMediaFullscreen(fsEl);
      const target = this._pickMountTarget(fsEl);
      const moved = this._moveTo(target);

      if (moved && this._root.parentNode !== document.documentElement) {
        this._fsState = nativeMedia ? 'native-media' : 'mounted';
        this._fsFailedNotice = nativeMedia;
        ZHS.Log.info(nativeMedia
          ? '[面板] 检测到 <video> 原生全屏：悬浮窗无法与视频同时显示，已转入降级流程'
          : '[面板] 已迁移到全屏元素内');
        this._scheduleFullscreenCheck();
        return;
      }

      // 连挂都挂不进去 → 进入降级流程
      this._fsState = 'failed';
      this._fsFailedNotice = true;
      ZHS.Log.warn('[面板] 全屏下无法挂载悬浮窗，进入降级模式（后台功能不受影响）');
      this._scheduleFullscreenCheck();
    },

    /**
     * 进入全屏 3 秒后复查。两种情况都需要善后：
     *   - 状态是 native-media：<video> 原生全屏，面板必定看不到，直接走降级
     *   - 其他状态但实测仍不可见：被蒙层盖住等意外情况，也走降级
     */
    _scheduleFullscreenCheck() {
      if (this._fsTimer) { clearTimeout(this._fsTimer); this._fsTimer = null; }
      this._fsTimer = setTimeout(() => {
        this._fsTimer = null;
        if (!this._root) return;
        if (!this._fsElement()) return;           // 已经退出全屏了，无需处理
        if (this._fsState === 'native-media') { this._exitFullscreenFallback(); return; }
        if (this._panelLooksVisible()) return;     // 挂载有效，什么都不做
        this._exitFullscreenFallback();
      }, 3000);
    },

    /**
     * 降级兜底：强制退出全屏。
     *
     * 默认【绝不】替用户退全屏 —— 用户在全屏看课被弹出来是极差体验。
     * 只有用户自己把「全屏挂不上就退全屏」开关打开（默认 false）才执行，
     * 并且退出前也在日志里写明原因。
     *
     * 有一种情况即使用户没开开关也值得提示：<video> 原生全屏下面板 100%
     * 看不到（浏览器渲染层限制，已用真实 Chrome 截图验证）。这时依旧保持
     * 默认「不退全屏」，但会在退出全屏后用 alert 告知用户（见 _onFullscreenChange）。
     */
    _exitFullscreenFallback() {
      if (ZHS.config.exitFullscreenOnPanel !== true) {
        ZHS.Log.info(this._fsState === 'native-media'
          ? '[面板] <video> 原生全屏下悬浮窗无法显示（未开启自动退全屏，助手继续后台运行）'
          : '[面板] 全屏下悬浮窗不可见（未开启自动退全屏，助手继续后台运行）');
        return;
      }
      try {
        const d = (this._fsDocs().find((dd) => {
          try { return !!(dd.fullscreenElement || dd.webkitFullscreenElement); } catch (e) { return false; }
        })) || document;
        if (typeof d.exitFullscreen === 'function') d.exitFullscreen().catch(() => {});
        else if (typeof d.webkitExitFullscreen === 'function') d.webkitExitFullscreen();
        ZHS.Log.info('[面板] 全屏下悬浮窗不可见，已按设置自动退出全屏');
      } catch (e) {
        ZHS.Log.warn('[面板] 自动退出全屏失败：' + e.message);
      }
    },

    _html() {
      return `
<button class="mini" title="智慧树助手">智</button>
<div class="panel show">
  <div class="head">
    <span class="status-dot" id="zhs-status-dot"></span>
    <b>智慧树助手</b>
    <span class="ver">v${ZHS.version}</span>
    <div class="btns"><button class="fold" title="收起">—</button></div>
  </div>
  <div class="tabs">
    <button data-tab="home" class="on">状态</button>
    <button data-tab="log">日志</button>
    <button data-tab="cfg">设置</button>
  </div>
  <div class="alert"></div>
  <div class="report"></div>
  <div class="body">
    <div class="pane on" data-pane="home">
      <div class="guide" id="zhs-guide" style="display:none">
        <h4>第一次用？三步搞定</h4>
        <ol>
          <li>点底部「启动」—— 之后全自动：播放、跳课、答题、切下一集都不用管</li>
          <li>自动答题已默认开启；没填 API Key、题库也查不到时，脚本<b>不作答</b>并弹提示（不瞎蒙，避免错答拉分）</li>
          <li>全部看完会自动弹出总结并停止</li>
        </ol>
        <button class="guide-ok">我知道了，开始用</button>
      </div>
      <div class="card">
        <div class="card-h">播放状态</div>
        <div class="kv"><span>运行状态</span><span class="s-run">—</span></div>
        <div class="kv"><span>当前课时</span><span class="s-lesson">—</span></div>
        <div class="kv"><span>视频进度</span><span class="s-vprog">—</span></div>
        <div class="kv" id="zhs-humanpause-row" style="display:none"><span>拟人离座</span><span class="s-humanpause">—</span></div>
      </div>
      <div class="card">
        <div class="card-h">课程进度</div>
        <div class="kv"><span>课程进度</span><span class="s-cprog">—</span></div>
        <div class="cprog-bar"><i></i></div>
        <div class="kv"><span>未看完</span><span class="s-undone">—</span></div>
        <div class="kv"><span>未解锁</span><span class="s-locked">—</span></div>
        <div class="kv"><span>本次完成</span><span class="s-done-run">0 节</span></div>
      </div>
      <div class="card">
        <div class="card-h">答题与统计</div>
        <div class="kv"><span>已答题数</span><span class="s-ans">0</span></div>
        <div class="dlg-card s-dlg-none" id="zhs-dlg-card">
          <span class="dlg-dot"></span><span class="s-dlg">弹题：空闲</span>
        </div>
        <div class="kv"><span>本次运行</span><span class="s-uptime">—</span></div>
      </div>
    </div>
    <div class="pane" data-pane="log">
      <div class="logs"></div>
    </div>
    <div class="pane" data-pane="cfg">
      <div class="row"><label>自动播放</label><button class="sw" data-cfg="autoPlay"></button></div>
      <div class="row"><label>自动下一节</label><button class="sw" data-cfg="autoNext"></button></div>
      <div class="row"><label>跳过已完成</label><button class="sw" data-cfg="skipFinished"></button></div>
      <div class="row"><label>静音</label><button class="sw" data-cfg="mute"></button></div>
      <div class="row"><label>断点续播</label><button class="sw" data-cfg="resume"></button></div>
      <div class="row"><label>倍速</label><input type="range" min="1" max="1.5" step="0.1" data-cfg-num="speed" style="width:100px"><span class="v-speed"></span></div>
      <div class="row"><label>拟人随机暂停</label><button class="sw" data-cfg="humanPause"></button></div>
      <div class="hint">默认开启。播放中偶尔（平均二十多分钟一次）像真人一样暂停几十秒再继续，
        这是平台官方客户端自身的节奏，能进一步降低「机器挂机」特征。暂停期间不计学习时长。</div>

      <div class="sec-title">人类化与防检测</div>
      <div class="hint">在场感知：你坐在电脑前（标签页聚焦且近期有活动），脚本主动让权——不抢答、不抢切课、不抢跳下一节；你切走或离开超过阈值，脚本再接管自动推进。这是最像「挂机托管」的真实场景，也最不像机器。</div>
      <div class="row"><label>用户在场让权</label><button class="sw" data-cfg="yieldToUser"></button></div>
      <div class="row"><label>离场静默阈值(秒)</label><input type="number" class="inp" data-cfg-num="userIdleSec" min="10" max="600" style="width:72px"></div>
      <div class="hint">最近一次鼠标/键盘活动超过这个秒数，就视为「人走开了」，脚本自动接管。默认 90 秒。</div>

      <div class="row"><label>学完自动进下一门</label><button class="sw" data-cfg="autoCourseHop"></button></div>
      <div class="hint">本课学完自动去课程中心找下一门</div>
      <div class="row"><label>自动选课</label><button class="sw" data-cfg="autoCoursePick"></button></div>
      <div class="hint">在课程中心自动进入未学完的课程</div>
      <div class="row"><label>自动学习</label><button class="sw" data-cfg="autoLearn"></button></div>
      <div class="hint">默认开启。打开课程中心即自动进入未学完的课程开始听，当前课听完自动退出并找下一门（断点续播）。<br>
        关闭则只在「学完自动进下一门」链里自动选课，你手动打开课程中心时不会自动点课。</div>

      <div class="sec-title">AI 答题</div>
      <div class="hint">听课遇到弹题：自动识别 → 题库/LLM 作答 → 提交 → 关闭弹窗 → 自动恢复播放，全程无需手动。答不出时按下方「兜底」策略处理（默认不瞎蒙，交人工）。</div>
      <div class="row"><label>自动答题</label><button class="sw" data-cfg="autoAnswer"></button></div>
      <div class="row"><label>课中弹题自动答</label><button class="sw" data-cfg="answerDialog"></button></div>
      <div class="row"><label>作业页自动答</label><button class="sw" data-cfg="answerHomework"></button></div>
      <div class="row"><label>自动答题（作业/考试）</label><button class="sw" data-cfg="autoExam"></button></div>
      <div class="hint">默认关闭。仅在你自己点进作业/考试页时生效，不会自动跳转，
        也不会自动进入任何作业或考试。</div>
      <div class="row"><label>答完自动提交</label><button class="sw" data-cfg="examSubmit"></button></div>
      <div class="row"><label>作答章节范围</label>
        <span>
          <input type="number" class="in-exfrom inp" data-cfg="examChapterFrom" min="0" max="200" style="width:56px">
          <span style="font-size:11px;color:var(--zhs-n-700)"> ~ </span>
          <input type="number" class="in-exto inp" data-cfg="examChapterTo" min="0" max="200" style="width:56px">
        </span>
      </div>
      <div class="hint">0 表示不限，如填 1 和 3 表示只答第 1~3 章。<br>
        （当前版本多数入口拿不到章节号，拿不到时会按全部作答并在日志里说明）</div>
      <div class="row"><label>答完自动关闭</label><button class="sw" data-cfg="autoCloseDialog"></button></div>
      <div class="row"><label>题库通道</label><button class="sw" data-cfg="bankEnabled"></button></div>
      <div class="row"><label>LLM 通道</label><button class="sw" data-cfg="llmEnabled"></button></div>
      <div class="row"><label>答不出随机猜（逃生舱）</label><button class="sw" data-cfg="gatedRandom"></button></div>
      <div class="hint">答题兜底三档：①题库/LLM 命中 → 直接用；②都没命中且「离线启发式」开着 → 用语言学规则推断（不瞎蒙）；③仍没有 → 本开关决定：<b>关（默认）</b>留空不答交人工，宁可漏答不瞎蒙；<b>开</b>才随机选一个保活。多数课程弹题计入平时分且不可回退，默认关更安全。</div>
      <div class="row"><label>离线启发式兜底</label><button class="sw" data-cfg="heuristicFallback"></button></div>
      <div class="hint">默认开启。查不到题库/没填 Key 时，用内置规则（对话标签、称谓等）推断答案，
        保证弹窗答得上、流程不卡死。关闭后这类题会转为「待人工」交给你手动作答。</div>
      <div class="row"><label>缓存模糊匹配</label><button class="sw" data-cfg="fuzzyCache"></button></div>
      <div class="hint">默认开启。同一道题的题干改几个字或换标点时，按 90% 相似度复用已答过的答案，
        少一次题库/模型请求。选项不一致的题不会误命中。</div>
      <div class="row"><label>答题模式</label>
        <select class="sel-mode inp">
          <option value="both">双通道</option>
          <option value="bank">仅题库</option>
          <option value="llm">仅LLM</option>
        </select>
      </div>
      <div class="row"><label>题库地址</label><input type="text" class="in-bank inp" placeholder="http://localhost:8060"></div>
      <div class="row"><label>LLM 复验次数</label><input type="number" class="in-vote inp" min="1" max="5" style="width:60px"></div>
      <div class="hint">默认 3。同一题让模型独立答多次取多数，降低偶发答错（次数越多越费 Token）。</div>

      <div class="sec-title">模型接口（OpenAI 兼容）</div>
      <div class="hint">填 Key 后可用任意兼容接口：DeepSeek / 通义 / Kimi / 本地 Ollama 等</div>
      <div class="row"><label>API 地址</label><input type="text" class="in-base inp" placeholder="https://api.deepseek.com"></div>
      <div class="row"><label>模型名</label><input type="text" class="in-model inp" placeholder="deepseek-chat" list="model-list">
        <datalist id="model-list">
          <option value="deepseek-chat"></option>
          <option value="deepseek-reasoner"></option>
          <option value="qwen-plus"></option>
          <option value="moonshot-v1-8k"></option>
        </datalist>
      </div>
      <div class="row"><label>API Key</label><input type="password" class="in-key inp" placeholder="sk-..."></div>
      <div class="row"><label></label>
        <span>
          <button class="mini-btn btn-lmtest">测试连接</button>
          <button class="mini-btn btn-savekey">保存</button>
        </span>
      </div>
      <div class="hint s-keymsg"></div>

      <div class="sec-title">通道健康检测</div>
      <div class="hint">一次检测两条答题通道是否正常，异常时直接给出原因和处理建议</div>
      <div class="row"><label></label>
        <span><button class="mini-btn btn-health">立即检测</button></span>
      </div>
      <div class="hint s-health"></div>

      <div class="sec-title">学习记录（M8）</div>
      <div class="hint">统计本次与今日的答题来源分布，以及习惯分进度（平台规则：每天学满 30 分钟得 1 分）</div>
      <div class="hint s-stats"></div>
      <div class="row"><label></label>
        <span>
          <button class="mini-btn btn-refreshstats">刷新</button>
          <button class="mini-btn btn-clearstats">清空记录</button>
        </span>
      </div>

      <div class="sec-title">课程中心（剩余课程）</div>
      <div class="hint">进入课程中心页后，可查看还有多少门课未学完</div>
      <div class="hint s-hub"></div>
      <div class="row"><label></label>
        <span>
          <button class="mini-btn btn-refreshhub">刷新</button>
        </span>
      </div>

      <div class="sec-title">自动停止（达标自动结束并弹总结）</div>
      <div class="row"><label>停止条件</label>
        <select class="sel-stop sel-inp inp">
          <option value="none">不限时</option>
          <option value="minutes">按观看时长</option>
          <option value="lessons">按完成节数</option>
        </select>
      </div>
      <div class="row"><label>观看满（分钟）</label><input type="number" class="in-stopmin inp" min="1" max="1440" style="width:70px"></div>
      <div class="row"><label>完成满（节）</label><input type="number" class="in-stoples inp" min="1" max="200" style="width:70px"></div>

      <div class="row"><label>显示悬浮面板</label><button class="sw" data-cfg="panelVisible"></button></div>
      <div class="hint">关掉后只留右下角小圆钮，点它可重新展开。</div>
      <div class="row"><label>全屏挂不上就退全屏</label><button class="sw" data-cfg="exitFullscreenOnPanel"></button></div>
      <div class="hint">默认关闭。全屏看课助手会主动把悬浮窗挂进播放器，一般无需理会；<br>
        只有个别播放器挂不进去时，开启此开关才会自动退出全屏让面板重现。</div>
      <div class="row"><label>调试日志</label><button class="sw" data-cfg="debug"></button></div>
    </div>
  </div>
  <div class="foot">
    <button class="btn-start pri">启动</button>
    <button class="btn-stop">停止</button>
    <button class="btn-next">下一节</button>
    <button class="btn-answer">答题</button>
  </div>
  <div class="foot2">
    <button class="btn-rescan" title="平台改版或切课后目录识别异常时，强制重新探测适配器并刷新目录（不刷新页面）">重新探测目录</button>
  </div>
  <div class="foot2">
    <button class="btn-findcourse" title="在课程中心页手动触发：立即选一门未学完的课进入（autoLearn 开启时进课程中心本就会自动跑）">🎯 找下一门课</button>
  </div>
  <div class="foot-jump">
    <input type="text" class="inp in-gotolesson" placeholder="课时序号或标题，如 3 / 第三章" style="flex:1;min-width:0;width:auto;max-width:none">
    <button class="btn-gotolesson" title="跳到指定课时：填目录序号（从 1 起）或标题片段">跳到课时</button>
  </div>
  <div class="about">
    <div class="about-head"><span class="retri">ReTri</span><span class="about-sub">智慧树助手 · 永久免费</span></div>
    <a class="about-link" href="https://github.com/huanweide/zhihuishu-helper" target="_blank" rel="noopener">⭐ 给作者点个 Star 支持一下</a>
    <div class="sf-box">
      <div class="sec-title">🔑 还没有 API Key？免费领硅基流动</div>
      <div class="hint">硅基流动是 DeepSeek / 大模型中转站，稳定且价格友好。用下方邀请链接注册，双方都有额度赠送。</div>
      <a class="about-link" href="https://cloud.siliconflow.cn/i/axOmWfWi" target="_blank" rel="noopener">🚀 点击注册（自动带入邀请码）</a>
      <button type="button" class="invite-code" data-code="axOmWfWi" title="点击复制邀请码">邀请码 <b>axOmWfWi</b> <span class="copy-tip">点击复制</span></button>
    </div>
  </div>
</div>`;
    },

    _bind(box) {
      const $ = (s) => box.querySelector(s);

      // 折叠/展开
      $('.fold').onclick = () => {
        $('.panel').classList.remove('show');
        $('.mini').style.display = 'flex';
      };
      $('.mini').onclick = () => {
        $('.panel').classList.add('show');
      };

      // 切换 tab
      box.querySelectorAll('.tabs button').forEach((btn) => {
        btn.onclick = () => {
          box.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('on'));
          box.querySelectorAll('.pane').forEach((p) => p.classList.remove('on'));
          btn.classList.add('on');
          const pane = box.querySelector('.pane[data-pane="' + btn.dataset.tab + '"]');
          if (pane) pane.classList.add('on');
          this.refresh();
        };
      });

      // 开关
      box.querySelectorAll('.sw[data-cfg]').forEach((sw) => {
        sw.onclick = () => {
          const key = sw.dataset.cfg;
          const cur = ZHS.config[key];
          ZHS.setConfig({ [key]: !cur });
          ZHS.Log.info('设置 ' + key + ' = ' + !cur);
          this.refresh();
        };
      });

      // 数值
      const speed = box.querySelector('[data-cfg-num="speed"]');
      if (speed) {
        speed.oninput = () => {
          ZHS.setConfig({ speed: Number(speed.value) });
          this.refresh();
          const v = ZHS.Player.video();
          if (v) ZHS.Player.setSpeed(v, Number(speed.value));
        };
      }

      // 答题模式下拉
      const selMode = box.querySelector('.sel-mode');
      if (selMode) {
        selMode.onchange = () => {
          ZHS.setConfig({ answerMode: selMode.value });
          ZHS.Log.info('答题模式 = ' + selMode.value);
        };
      }

      // 题库地址
      const inBank = box.querySelector('.in-bank');
      if (inBank) {
        inBank.onchange = () => {
          ZHS.setConfig({ bankUrl: inBank.value.trim() });
          ZHS.Log.info('题库地址 = ' + inBank.value.trim());
        };
      }

      // LLM Key
      const inKey = box.querySelector('.in-key');
      if (inKey) {
        inKey.onchange = () => {
          const k = normKey(inKey.value);
          inKey.value = k;
          ZHS.setConfig({ llmKey: k });
          ZHS.Log.info('LLM Key 已' + (k ? '设置' : '清空'));
        };
      }

      // API 地址（BaseURL）
      const inBase = box.querySelector('.in-base');
      if (inBase) {
        inBase.onchange = () => {
          const v = inBase.value.trim() || 'https://api.deepseek.com';
          ZHS.setConfig({ llmBaseUrl: v });
          ZHS.Log.info('API 地址 = ' + v);
        };
      }

      // 模型名
      const inModel = box.querySelector('.in-model');
      if (inModel) {
        inModel.onchange = () => {
          const v = inModel.value.trim() || 'deepseek-chat';
          ZHS.setConfig({ llmModel: v });
          ZHS.Log.info('模型 = ' + v);
        };
      }

      // 测试连接
      const btnTest = box.querySelector('.btn-lmtest');
      if (btnTest) {
        btnTest.onclick = async () => {
          // 先把当前输入落盘，再测
          if (inBase) ZHS.setConfig({ llmBaseUrl: inBase.value.trim() || 'https://api.deepseek.com' });
          if (inModel) ZHS.setConfig({ llmModel: inModel.value.trim() || 'deepseek-chat' });
          if (inKey) ZHS.setConfig({ llmKey: normKey(inKey.value) });

          btnTest.textContent = '测试中…';
          btnTest.className = 'mini-btn btn-lmtest';
          // round-8 B1：test() 抛错必须被捕获，否则未捕获 Promise 拒绝 + 文案卡死在「测试中…」
          try {
            const r = await ZHS.LLM.test();
            btnTest.textContent = r.ok ? '连接正常' : '连接失败';
            btnTest.className = 'mini-btn btn-lmtest ' + (r.ok ? 'ok' : 'bad');
            const msg = box.querySelector('.s-keymsg');
            // ★ 过去失败只显示一句 r.msg（如"请求失败"），用户不知道下一步该做什么。
            // 现在把 hint（解决方案）一并给出；完整信息同时挂到 title 上，
            // 避免面板区域窄导致长文案被截断看不到后半句。
            const full = r.msg + (r.hint ? ' → ' + r.hint : '');
            if (msg) {
              msg.textContent = full;
              if (r.hint) msg.title = full;
            }
            ZHS.Log[r.ok ? 'info' : 'warn']('模型连通性：' + full);
          } catch (e) {
            btnTest.textContent = '连接异常';
            btnTest.className = 'mini-btn btn-lmtest bad';
            ZHS.Log.warn('模型连通性测试出错：' + e.message);
          }
        };
      }

      // 通道健康检测（M8）：一次检测题库 + 模型两条通道
      const btnHealth = box.querySelector('.btn-health');
      if (btnHealth) {
        btnHealth.onclick = async () => {
          const out = box.querySelector('.s-health');
          btnHealth.textContent = '检测中…';
          btnHealth.className = 'mini-btn btn-health';
          try {
            const [bank, llm] = await Promise.all([
              ZHS.Bank.health(),
              ZHS.LLM.test(),
            ]);
            const line = (n, r) => n + '：' + (r.ok ? '正常' : '异常') + '｜' + r.msg
              + (r.hint ? ' → ' + r.hint : '');
            const l1 = line('题库', bank);
            const l2 = line('模型', llm);
            // 完整信息挂 title：面板区域窄，单行放不下两条诊断，鼠标悬停可看全
            if (out) {
              out.textContent = l1 + '　·　' + l2;
              out.title = l1 + '\n' + l2;
            }
            const allOk = !!(bank.ok && llm.ok);
            btnHealth.textContent = allOk ? '全部正常' : '存在异常';
            btnHealth.className = 'mini-btn btn-health ' + (allOk ? 'ok' : 'bad');
            ZHS.Log[(bank.ok && llm.ok) ? 'info' : 'warn']('通道健康检测：' + l1 + ' / ' + l2);
          } catch (e) {
            btnHealth.textContent = '检测出错';
            btnHealth.className = 'mini-btn btn-health bad';
            if (out) out.textContent = '检测过程出错：' + e.message;
            ZHS.Log.warn('通道健康检测出错：' + e.message);
          }
        };
      }

      // 学习记录（M8）：答题来源分布 + 学习时长 + 习惯分进度
      const statsBox = box.querySelector('.s-stats');
      const renderStats = () => {
        if (!statsBox) return;
        if (!ZHS.Stats) { statsBox.textContent = '统计模块未加载'; return; }
        try {
          const s = ZHS.Stats.summary();
          const min = Math.floor((s.today.studyMs || 0) / 60000);
          // 习惯分进度：平台按「每天学满 30 分钟得 1 分」计，这里显示已得与还差多久
          const remainMin = Math.ceil((s.todayHabitRemainMs || 0) / 60000);
          const line1 = '今日：答题 ' + s.today.answered + ' 题'
            + '（题库 ' + s.today.bank + ' / 模型 ' + s.today.llm + ' / 漏答 ' + s.today.skipped + '）';
          const line2 = '今日学习 ' + min + ' 分钟｜习惯分已得 ' + s.todayHabitDone
            + ' 分，下一分还差约 ' + remainMin + ' 分钟';
          const line3 = '累计答题 ' + s.totalAnswered + ' 题，活跃 ' + s.activeDays + ' 天';
          statsBox.textContent = line1 + '　·　' + line2;
          // 明细与累计信息挂 title：面板窄，正文只放最关键的两行，悬停可看全部 + 最近作答
          const recent = (s.recent || []).slice(0, 5)
            .map((r) => '· ' + r.q + ' → ' + (r.a || '（未答）') + '［' + (r.from || '未知') + '］').join('\n');
          statsBox.title = [line1, line2, line3, recent ? '\n最近作答：\n' + recent : ''].join('\n');
        } catch (e) {
          statsBox.textContent = '统计读取失败：' + e.message;
        }
      };
      renderStats();

      const btnRefreshStats = box.querySelector('.btn-refreshstats');
      if (btnRefreshStats) btnRefreshStats.onclick = () => renderStats();

      const btnClearStats = box.querySelector('.btn-clearstats');
      if (btnClearStats) {
        btnClearStats.onclick = () => {
          try { if (ZHS.Stats) ZHS.Stats.reset(); } catch (e) { /* 清空失败不影响使用 */ }
          renderStats();
          ZHS.Log.info('学习记录已清空');
        };
      }

      // 课程中心剩余课程（v0.6.66）：summary() 提供「还剩多少门未学」，仅课程中心页有效
      const hubBox = box.querySelector('.s-hub');
      const renderHub = async () => {
        if (!hubBox) return;
        if (!ZHS.CourseHub || !ZHS.CourseHub.isHubPage) { hubBox.textContent = '课程中心模块未加载'; return; }
        if (!ZHS.CourseHub.isHubPage()) {
          hubBox.textContent = '进入课程中心页后可查看剩余未学课程数';
          return;
        }
        try {
          const s = await ZHS.CourseHub.summary();
          hubBox.textContent = '共 ' + s.total + ' 门｜剩余 ' + s.unfinished + ' 门未学完'
            + (s.finished ? '｜已修完 ' + s.finished + ' 门' : '');
          hubBox.title = '剩余未学：' + s.unfinished + ' 门\n已修完：' + s.finished + ' 门\n已放弃：' + s.failedCount + ' 门';
        } catch (e) {
          hubBox.textContent = '课程中心读取失败：' + e.message;
        }
      };
      renderHub();

      const btnRefreshHub = box.querySelector('.btn-refreshhub');
      if (btnRefreshHub) btnRefreshHub.onclick = () => renderHub();

      // 保存 Key
      const btnSave = box.querySelector('.btn-savekey');
      if (btnSave) {
        btnSave.onclick = () => {
          if (inBase) ZHS.setConfig({ llmBaseUrl: inBase.value.trim() || 'https://api.deepseek.com' });
          if (inModel) ZHS.setConfig({ llmModel: inModel.value.trim() || 'deepseek-chat' });
          if (inKey) ZHS.setConfig({ llmKey: normKey(inKey.value) });
          this.alert('模型配置已保存', 'info');
          ZHS.Log.info('模型配置已保存：' + ZHS.config.llmModel + ' @ ' + ZHS.config.llmBaseUrl);
        };
      }

      // 总结弹层关闭
      const closeRp = box.querySelector('.close-rp');
      if (closeRp) {
        closeRp.onclick = () => {
          const rp = box.querySelector('.report');
          if (rp) rp.classList.remove('show');
        };
      }

      // 投票次数
      const inVote = box.querySelector('.in-vote');
      if (inVote) {
        inVote.onchange = () => {
          ZHS.setConfig({ voteTimes: Number(inVote.value) });
        };
      }

      // 作业/考试：章节范围数字框
      // 这两个是「整数数值」输入框，沿用项目既有机制（change 事件 + ZHS.setConfig），
      // 没有发明新绑定方式；用 querySelectorAll 是因为面板可能被重新渲染多份。
      box.querySelectorAll('input[data-cfg="examChapterFrom"], input[data-cfg="examChapterTo"]').forEach((inp) => {
        inp.onchange = () => {
          const key = inp.dataset.cfg;
          const n = Math.max(0, Math.floor(Number(inp.value) || 0));
          inp.value = String(n);
          ZHS.setConfig({ [key]: n });
          ZHS.Log.info('作答章节范围：' + (ZHS.config.examChapterFrom || 0) +
            ' ~ ' + (ZHS.config.examChapterTo || 0) + '（0 = 不限）');
        };
      });

      // 底部按钮（带 loading 态：点击即转圈禁用，完成恢复）
      const withLoading = async (btn, fn) => {
        if (btn.classList.contains('loading')) return;
        const orig = btn.textContent;
        btn.classList.add('loading');
        if (!btn.classList.contains('pri')) btn.classList.add('btn-plain');
        btn.disabled = true;
        try {
          await fn();
        } catch (e) {
          ZHS.Log.warn('按钮操作失败：' + e.message);
        } finally {
          btn.classList.remove('loading', 'btn-plain');
          btn.disabled = false;
          btn.textContent = orig;
        }
      };

      // manual: true —— 用户点了按钮，即使之前判定过停机也要能重新开跑
      $('.btn-start').onclick = () => {
        ZHS.Scheduler.start({ manual: true });
        this.alert('已启动：播放、跳课、答题全自动，无需再点任何按钮', 'info');
      };
      // round-49：停止两步确认 —— stop 是破坏性操作，误触即中断全部进度，
      // 首次点进入「确认」态（按钮变红 + 提示），3 秒窗口内再点才真停；超时自动复位。
      const stopBtn = $('.btn-stop');
      if (stopBtn) {
        let stopArmed = false, stopTimer = null;
        stopBtn.onclick = () => {
          if (!stopArmed) {
            stopArmed = true;
            const orig = stopBtn.textContent;
            stopBtn.textContent = '确认停止？';
            stopBtn.classList.add('stop-armed');
            this.alert('再点一次「确认停止」即中断全部进度；3 秒内不点自动取消', 'warn', 3200);
            stopTimer = setTimeout(() => {
              stopArmed = false;
              stopBtn.textContent = orig;
              stopBtn.classList.remove('stop-armed');
              stopTimer = null;
            }, 3000);
            return;
          }
          if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
          stopArmed = false;
          stopBtn.textContent = '停止';
          stopBtn.classList.remove('stop-armed');
          ZHS.Scheduler.stop();
          this.alert('已停止', 'info');
        };
      }
      $('.btn-next').onclick = () => withLoading($('.btn-next'), async () => {
        await ZHS.Scheduler.gotoNext('手动', { manual: true });
      });
      $('.btn-answer').onclick = () => withLoading($('.btn-answer'), async () => {
        const scene = ZHS.Questions.scene();
        // 手动触发：绕过 autoAnswer 配置（用户点了就是想答）
        if (scene === 'dialog') await ZHS.Answerer.handleDialog({ manual: true });
        else await ZHS.Answerer.handleHomework({ manual: true });
        this.alert('已触发答题（场景：' + (scene || '未识别') + '）', 'info');
      });

      // round-50：重新探测目录 —— 平台改版 / SPA 切课后适配器可能误判，
      // 提供「不刷新页面」的安全重探测入口。仅重置 Catalog 适配器探测（redetect），
      // 不碰播放状态机 / 调度器 / 进度，纯恢复型操作。
      const rescanBtn = $('.btn-rescan');
      if (rescanBtn) {
        rescanBtn.onclick = () => withLoading(rescanBtn, async () => {
          if (ZHS.Catalog && typeof ZHS.Catalog.redetect === 'function') ZHS.Catalog.redetect();
          let n = 0;
          try { n = (ZHS.Catalog.items && ZHS.Catalog.items().length) || 0; } catch (e) { /* 探测期 items 可能为空 */ }
          this.refresh();
          let adName = 'unknown';
          try { adName = (ZHS.Catalog.adapter && ZHS.Catalog.adapter.name) || 'unknown'; } catch (e) { /* 适配器读取防御 */ }
          this.alert('已重新探测目录：适配器=' + adName + '，识别到 ' + n + ' 个条目', 'info');
        });
      }

      // v0.6.64：找下一门课 —— 在课程中心页手动触发「立即选一门未学完的课进入」。
      // autoLearn 开启时进课程中心本就会自动跑；此按钮供手动补触 / 当前不在自动链时用。
      const findCourseBtn = $('.btn-findcourse');
      if (findCourseBtn) {
        findCourseBtn.onclick = () => withLoading(findCourseBtn, async () => {
          if (ZHS.CourseHub && typeof ZHS.CourseHub.triggerManual === 'function') {
            await ZHS.CourseHub.triggerManual();
          } else {
            this.alert('课程中心调度模块不可用', 'warn');
          }
        });
      }

      // v0.6.64：跳到指定课时 —— 输入目录序号（1 起）或标题片段，手动切到该节。
      // 复用 Scheduler.gotoLesson（内部走 Nav 策略链 + 穷举兜底 + rebind，失败自动回滚）。
      const gotoBtn = $('.btn-gotolesson');
      const gotoInput = $('.in-gotolesson');
      if (gotoBtn && gotoInput) {
        const doJump = () => withLoading(gotoBtn, async () => {
          const raw = String(gotoInput.value || '').trim();
          if (!raw) { this.alert('请先填课时序号或标题', 'warn'); return; }
          // 纯数字按索引，其余按标题子串
          const target = /^\d+$/.test(raw) ? Number(raw) : raw;
          const r = await ZHS.Scheduler.gotoLesson(target, { manual: true });
          this.alert(r && r.ok ? ('已跳到：' + (r.title || raw)) : ('未能跳到：' + raw), r && r.ok ? 'info' : 'warn');
        });
        gotoBtn.onclick = doJump;
        gotoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doJump(); });
      }

      // 停止条件
      const selStop = box.querySelector('.sel-stop');
      if (selStop) {
        selStop.onchange = () => {
          ZHS.setConfig({ stopMode: selStop.value });
          ZHS.Log.info('停止条件 = ' + selStop.value);
        };
      }      const inStopMin = box.querySelector('.in-stopmin');
      if (inStopMin) {
        inStopMin.onchange = () => {
          ZHS.setConfig({ stopMinutes: Math.max(1, Number(inStopMin.value) || 120) });
        };
      }
      const inStopLes = box.querySelector('.in-stoples');
      if (inStopLes) {
        inStopLes.onchange = () => {
          ZHS.setConfig({ stopLessons: Math.max(1, Number(inStopLes.value) || 10) });
        };
      }

      // 首次使用引导
      const guide = box.querySelector('#zhs-guide');
      if (guide) {
        const onboarded = this._readFlag('zhs-onboarded');
        guide.style.display = onboarded ? 'none' : 'block';
        const okBtn = guide.querySelector('.guide-ok');
        if (okBtn) {
          okBtn.onclick = () => {
            guide.style.display = 'none';
            this._writeFlag('zhs-onboarded', true);
          };
        }
      }

      // 邀请码一键复制：点一下就把码复制到剪贴板，省得用户手动选中
      const inviteBtn = box.querySelector('.invite-code');
      if (inviteBtn) {
        inviteBtn.onclick = async () => {
          const code = inviteBtn.getAttribute('data-code') || '';
          const tip = inviteBtn.querySelector('.copy-tip');
          let ok = false;
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(code);
              ok = true;
            }
          } catch (e) { ok = false; }
          if (!ok) {
            // 降级：临时 textarea + execCommand（http 页面 / 旧内核）
            try {
              const ta = document.createElement('textarea');
              ta.value = code;
              ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
              document.body.appendChild(ta);
              ta.select();
              ok = document.execCommand('copy');
              document.body.removeChild(ta);
            } catch (e) { ok = false; }
          }
          if (tip) tip.textContent = ok ? '已复制 ✓' : '复制失败，请手动选择';
          inviteBtn.classList.toggle('copied', ok);
          if (ok) {
            setTimeout(() => {
              if (tip) tip.textContent = '点击复制';
              inviteBtn.classList.remove('copied');
            }, 2000);
          }
        };
      }
    },

    /** 读持久化标记（GM 优先，降级 localStorage） */
    _readFlag(key) {
      try {
        const raw = typeof GM_getValue === 'function'
          ? GM_getValue(key, null)
          : localStorage.getItem(key);
        return raw === true || raw === 'true' || raw === '1';
      } catch (e) { return false; }
    },

    /** 写持久化标记 */
    _writeFlag(key, val) {
      try {
        if (typeof GM_setValue === 'function') GM_setValue(key, String(val));
        else localStorage.setItem(key, String(val));
      } catch (e) { /* 静默 */ }
    },

    /**
     * 读设计令牌的运行时色值（JS 里需要给元素直接设色时用）。
     *
     * 为什么不直接写 '#1D9E75'：CSS 用的是 var(--zhs-ok-400)，一旦有人改令牌
     * 而忘了改 JS 里的字面量，就会出现「同一个绿色两种色调」的隐性不一致。
     * 这里统一从 :host 上把变量读回来，CSS 与 JS 永远同源；
     * 读不到（老内核 / 无样式环境）才回落到 COLOR_FALLBACK 里的同名兜底值。
     */
    _color(name) {
      const fallback = COLOR_FALLBACK[name] || '';
      try {
        const el = this._root || (typeof document !== 'undefined' ? document.documentElement : null);
        if (!el) return fallback;
        const v = getComputedStyle(el).getPropertyValue('--zhs-' + name);
        return v && v.trim() ? v.trim() : fallback;
      } catch (e) { return fallback; }
    },

    /**
     * 刷新面板显示。
     *
     * 整体包一层 try：refresh 是「渲染」职责，跑在 1.5 秒的定时器里，
     * 任何一次意外（比如某平台页面的 video 元素被换掉导致取值抛错）
     * 从这里抛出去都会污染定时器调用栈。渲染失败最坏也只是数字不刷新，
     * 绝不能影响主流程，所以这里兜住并只在 debug 日志里留痕。
     */
    refresh() {
      // 【this 绑定防御 · 2026-10-20 真机实测修】
      //
      // 背景：本模块用 `if (!ZHS.panel) ZHS.panel = {}` 建占位对象，末尾再
      // `Object.assign(ZHS.panel, Panel)` 把方法填进去。于是出现两份对象：
      //   · 挂载走 ZHS.panel.mount()  → this = 占位对象，_root/_shadow 落在它身上；
      //   · 若别处写成 Panel.refresh()  → this = 原 Panel 对象，_shadow 永远 undefined。
      // 后者会让 _refreshInner() 第一行 `if (!this._shadow) return;` 静默早退，
      // 面板所有状态字段与弹题状态卡永久停在挂载瞬间的值，且**没有任何报错**。
      // （实测铁证：.s-uptime 75 秒不涨、状态卡恒为「弹题：空闲」、日志页永远空白。）
      //
      // 这里做一次转发：只要真正持有面板实例的是 ZHS.panel，就转给它执行。
      // 这样任何调用姿势（Panel.refresh / ZHS.panel.refresh）都能真正刷新。
      if (this !== ZHS.panel && ZHS.panel && ZHS.panel._shadow) {
        return ZHS.panel.refresh();
      }
      // 自愈：面板宿主被页面脚本移除后，重新挂载，避免静默消失（round-7 面板⑨）
      if (this._root && !document.contains(this._root)) {
        try {
          if (this._root.parentNode) this._root.parentNode.removeChild(this._root);
          this._root = null;
          this._shadow = null;
          // round-8 B3：重挂前清掉全屏状态机残留，避免旧状态误导降级提示/失效 document 绑定
          try {
            this._fsState = '';
            if (this._fsTimer) { clearTimeout(this._fsTimer); this._fsTimer = null; }
            this._fsFailedNotice = false;
            if (this._fsBoundDocs) this._fsBoundDocs = [];
          } catch (e) {}
          this.mount();
        } catch (e) { ZHS.Log.debug('面板自愈重挂失败：' + e.message); }
      }
      try { this._refreshInner(); } catch (e) {
        ZHS.Log.debug('面板刷新异常（已忽略）：' + e.message);
      }
    },

    _refreshInner() {
      if (!this._shadow) return;
      const box = this._shadow.querySelector('.wrap');
      if (!box) return;

      // round-31【弹题实时状态卡】：必须放在 Player/Catalog 之前更新。
      //
      // 【2026-10-20 真机实测修正】原实现把这段放在 _refreshInner() 最末尾，
      // 注释写着「独立于 Catalog，Catalog 异常也不影响此卡刷新」——但代码位置在末尾，
      // 只要上面 Player.video() / Catalog.stats() / Catalog.breakdown() 任意一处抛异常，
      // 整段 refresh() 就在到达这里之前中断，卡片永远停在「弹题：空闲」。
      // 真机就是被这个坑骗了：日志明明在自动作答，卡片 9 秒内 600 次采样纹丝不动。
      // 放到最前面 = 任何后续异常都影响不到它，注释的承诺才算兑现。
      try {
        const dlgCard = box.querySelector('#zhs-dlg-card');
        if (dlgCard) {
          const phase = ZHS.state.dialogPhase || 'none';
          const phaseText = {
            'none': '弹题：空闲', 'detected': '弹题：检测到',
            'answering': '弹题：作答中', 'answered': '弹题：已答',
            'pending-human': '弹题：待人工',
          }[phase] || '弹题：空闲';
          const suffix = phase === 'pending-human' ? 'pending' : phase;
          dlgCard.className = 'dlg-card s-dlg-' + suffix;
          const dlgText = dlgCard.querySelector('.s-dlg');
          if (dlgText) dlgText.textContent = phaseText;
        }
      } catch (e) { ZHS.Log.debug('弹题状态卡刷新异常：' + (e && e.message)); }

      // round-49：头部状态灯（放在最前，任何后续 Player/Catalog 异常都影响不到它）
      try {
        const dot = box.querySelector('#zhs-status-dot');
        if (dot) {
          const phase = ZHS.state.dialogPhase || 'none';
          const busy = (phase === 'detected' || phase === 'answering' || phase === 'pending-human')
            || !!(ZHS.Player && ZHS.Player.isHumanPausing && ZHS.Player.isHumanPausing());
          dot.className = 'status-dot' + (ZHS.state.running ? (busy ? ' busy' : ' run') : '');
        }
      } catch (e) { ZHS.Log.debug('状态灯刷新异常：' + (e && e.message)); }

      // 日志页：切到该页时必须立刻有内容。
      // 【2026-10-20 真机实测修】_renderLogs 原本只在 onLog() 里被调用，
      // 而 onLog() 又要求「日志页已激活」才渲染 → 切到日志页的那一刻没有任何人渲染，
      // 于是切过去一片空白，只有之后恰好产生一条新日志才会突然显示出来。
      // 这里在每次刷新时补渲染：切页后 1.5 秒内必有内容，且日志随新条目滚动。
      try {
        const logPane = box.querySelector('.pane[data-pane="log"]');
        if (logPane && logPane.classList.contains('on')) this._renderLogs(box);
      } catch (e) { ZHS.Log.debug('日志页渲染异常：' + (e && e.message)); }

      const cfg = ZHS.config;
      const $ = (s) => box.querySelector(s);
      // 状态页元素取不到时直接跳过（面板结构被外部脚本改动等极端情况）
      const setText = (sel, text) => {
        const el = $(sel);
        if (el) el.textContent = text;
      };

      // 状态
      const v = ZHS.Player.video();
      setText('.s-run', ZHS.state.running ? '运行中' : '已停止');
      const st = ZHS.Catalog.stats();
      setText('.s-cprog', st.done + '/' + st.total + ' (' + st.percent + '%)');
      // 课程进度条
      const bar = box.querySelector('.cprog-bar > i');
      if (bar) bar.style.width = st.percent + '%';
      setText('.s-lesson', (ZHS.state.lessonKey || '—').slice(0, 16));
      setText('.s-vprog', v ? (ZHS.Player.percent(v) + '% · ' + Math.round(v.currentTime) + 's') : '—');

      // 三态明细（N1 需求）
      const bd = ZHS.Catalog.breakdown();
      const undoneEl = $('.s-undone');
      if (undoneEl) {
        undoneEl.textContent = bd.undone + ' 节';
        // 色值走设计令牌，别在这里写死字面量（CSS 一改就会不一致）
        undoneEl.style.color = bd.undone === 0 ? this._color('ok-400') : this._color('warn-ink');
      }
      const lockedEl = $('.s-locked');
      if (lockedEl) lockedEl.textContent = bd.locked + ' 节';
      // 本次完成节数（停止条件口径）
      const doneRunEl = $('.s-done-run');
      if (doneRunEl) {
        const n = (ZHS.Scheduler && ZHS.Scheduler._completedThisRun) || 0;
        doneRunEl.textContent = n + ' 节';
      }

      setText('.s-ans', String(ZHS.state.answeredCount));
      const mins = Math.floor((Date.now() - ZHS.state.startedAt) / 60000);
      setText('.s-uptime', mins + ' 分钟');

      // round-45：拟人离座实时状态（暂停期间才显示，避免常态占一行）
      const hpRow = box.querySelector('#zhs-humanpause-row');
      if (hpRow) {
        const pausing = !!(ZHS.Player && ZHS.Player.isHumanPausing && ZHS.Player.isHumanPausing());
        hpRow.style.display = pausing ? '' : 'none';
        if (pausing) {
          const left = Math.max(0, Math.ceil((ZHS.Player._humanPauseUntil - Date.now()) / 1000));
          setText('.s-humanpause', '模拟真人离开中 · 约 ' + left + ' 秒后恢复');
        }
      }

      // round-31【弹题实时状态卡】已上移到 _refreshInner() 开头（见下方），此处不再重复。

      // 开关状态
      box.querySelectorAll('.sw[data-cfg]').forEach((sw) => {
        const on = !!cfg[sw.dataset.cfg];
        sw.classList.toggle('on', on);
      });
      const speed = box.querySelector('[data-cfg-num="speed"]');
      if (speed && document.activeElement !== speed) speed.value = String(cfg.speed);
      setText('.v-speed', cfg.speed + 'x');

      // 答题设置回填（避免覆盖用户正在输入的框）
      this._syncInput(box, '.sel-mode', cfg.answerMode);
      this._syncInput(box, '.in-bank', cfg.bankUrl);
      this._syncInput(box, '.in-key', cfg.llmKey);
      this._syncInput(box, '.in-vote', String(cfg.voteTimes));
      this._syncInput(box, '.in-base', cfg.llmBaseUrl);
      this._syncInput(box, '.in-model', cfg.llmModel);
      // 停止条件回填
      this._syncInput(box, '.sel-stop', cfg.stopMode || 'none');
      this._syncInput(box, '.in-stopmin', String(cfg.stopMinutes));
      this._syncInput(box, '.in-stoples', String(cfg.stopLessons));
      // 作业/考试章节范围回填
      this._syncInput(box, '.in-exfrom', String(cfg.examChapterFrom || 0));
      this._syncInput(box, '.in-exto', String(cfg.examChapterTo || 0));
    },

    /**
     * 展示「全部看完」总结报告（N3 需求）
     */
    showReport(report) {
      if (!report) return;
      // 兜底：面板未挂载时先挂载，避免总结报告静默丢失
      if (!this._shadow || !this._root || !document.contains(this._root)) {
        try { this.mount(); } catch (e) { /* 挂载失败则放弃显示 */ }
      }
      if (!this._shadow) return;
      const box = this._shadow.querySelector('.wrap');
      if (!box) return;
      const rp = box.querySelector('.report');
      if (!rp) return;

      const rows = [
        ['课程', report.课程名],
        ['页面版本', report.页面版本],
        ['完成情况', report.已完成 + ' / ' + report.总节点 + '（' + report.完成度 + '）'],
        ['未看完', report.未完成 + ' 节'],
        ['未解锁', report.未解锁 + ' 节'],
        ['本次切换课时', report.本次切换课时数 + ' 次'],
        ['本次完成节数', (report.本次完成节数 || 0) + ' 节'],
        ['已答题数', report.已答题数 + ' 题'],
        ['答题通道', report.答题通道],
        ['总耗时', report.总耗时],
        ['结束时间', report.结束时间],
      ];

      // 标题按真实结果动态判定：不能只有 25% 完成度还写「全部看完」。
      // 也不能漏掉「题目没答」这件事——看完≠答完，得让用户知道还有几题空着（BUG-EC-19）。
      const allDone = Number(report.未完成) === 0 && Number(report.总节点) > 0
        && Number(report.已完成) >= Number(report.总节点);
      const undoneN = Number(report.未完成) || 0;
      const skipN = Number(report.漏答题数) || 0;

      let head, headKey;
      if (allDone && skipN === 0) {
        head = '全部课程已看完';
        headKey = 'pri-ink2';      // 正常达成：品牌深蓝
      } else if (allDone) {
        head = '课程已看完（有 ' + skipN + ' 题未作答）';
        headKey = 'warn-ink';      // 有漏答：提醒色
      } else {
        head = '运行已结束（仍有 ' + undoneN + ' 节未完成'
          + (skipN ? ' · ' + skipN + ' 题漏答' : '') + '）';
        headKey = 'warn-ink';
      }
      const headColor = this._color(headKey);

      rp.innerHTML = '<h4 data-tone="' + headKey + '" style="color:' + headColor + '">' + this._esc(head) + '</h4>'
        + rows.map(([k, v]) => '<div class="line"><span>' + k + '</span><b>' + this._esc(String(v)) + '</b></div>').join('')
        + '<button class="close-rp">知道了</button>';
      rp.classList.add('show');

      const btn = rp.querySelector('.close-rp');
      if (btn) btn.onclick = () => rp.classList.remove('show');

      // 切到状态页让用户看到
      box.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'home'));
      box.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === 'home'));
    },

    /** 只在值不同且未聚焦时同步输入框 */
    _syncInput(box, sel, val) {
      const el = box.querySelector(sel);
      if (!el) return;
      if (el === (this._shadow && this._shadow.activeElement)) return;
      if (String(el.value) !== String(val)) el.value = val;
    },

    /** 日志更新回调 */
    onLog() {
      const box = this._shadow && this._shadow.querySelector('.wrap');
      if (!box) return;
      const pane = box.querySelector('.pane[data-pane="log"]');
      if (!pane || !pane.classList.contains('on')) return;   // 只在日志页刷新
      this._renderLogs(box);
    },

    _renderLogs(box) {
      const el = box.querySelector('.logs');
      if (!el) return;
      const list = ZHS.Log.all().slice(-80);
      el.innerHTML = list.map((e) => {
        const time = new Date(e.t).toTimeString().slice(0, 8);
        const cls = e.level === 'warn' ? 'warn' : (e.level === 'error' ? 'error' : '');
        return '<div class="' + cls + '">' + time + ' ' + this._esc(e.text) + '</div>';
      }).join('');
      el.scrollTop = el.scrollHeight;
    },

    _esc(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    },

    /**
     * 顶部提示条
     * @param msg 提示文案
     * @param type info | warn | error
     * @param durationMs 显示时长（毫秒），默认 8 秒。
     *   以前签名只有 (msg, type)，调用方传的第 3 个参数会被静默丢弃——
     *   现在显式支持，调用方能控制重要提示停留多久。
     */
    alert(msg, type, durationMs) {
      const box = this._shadow && this._shadow.querySelector('.wrap');
      if (!box) return;
      const el = box.querySelector('.alert');
      if (!el) return;                       // 面板结构异常时不留 TypeError
      el.className = 'alert ' + (type || 'info');
      el.textContent = msg;
      clearTimeout(this._alertTimer);
      const ms = Number(durationMs) > 0 ? Number(durationMs) : 8000;
      this._alertTimer = setTimeout(() => { el.className = 'alert'; }, ms);
    },
  };

  // 面板每 1.5 秒自刷新
  //
  // 【this 绑定铁律 · 2026-10-20 真机实测修】
  // 挂载走的是 ZHS.panel.mount()（this = 占位对象 ZHS.panel），实例字段 _root/_shadow
  // 都落在 ZHS.panel 上；这里若写成 Panel.refresh()，this 就是原 Panel 对象，
  // 它的 _shadow 永远是 undefined → _refreshInner() 第一行静默早退 →
  // 面板状态字段与弹题状态卡永久冻在挂载瞬间（且无任何报错）。
  // 所以定时器必须调 ZHS.panel.refresh()，与 mount 保持同一个对象；
  // refresh() 内部还有一层转发兜底，双保险。
  setInterval(() => {
    try {
      if (ZHS.panel && typeof ZHS.panel.refresh === 'function') ZHS.panel.refresh();
    } catch (e) { /* 面板刷新失败不影响脚本其余部分 */ }
  }, 1500);

  // round-14：把完整 Panel 填充进模块开头已占位的 ZHS.panel。
  // 用 Object.assign 而非直接赋值：保留占位对象引用，任何早前拿到 ZHS.panel 引用的
  // 代码（以及判空逻辑）都能看到补齐后的方法，不会出现「引用是空对象、赋值后失联」。
  Object.assign(ZHS.panel, Panel);
  ZHS.__panel_ready = true;   // 供 07-main 判定「面板是否真正就绪」，用于兜底提示
})();
