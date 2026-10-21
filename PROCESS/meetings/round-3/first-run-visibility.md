# Round-3 · 新手可见性审查（first-run visibility）

> 审查对象：`src/06-panel.js`、`src/07-main.js`、`src/00-config.js`，基线提交 `74ac103`（v0.6.3）。
> 只审查 + 提 patch，**未修改任何文件**。
> 结论先行：面板本身"挂得上、看得见"，但**首屏缺少"我装上了"的证据链**——折叠态只剩 44px 圆点、非播放页要静默等 30 秒、安装页还在分发旧版。

---

## 1. 面板创建后是否立即可见？

### 现状

| 点 | 位置 | 结论 |
|---|---|---|
| mount 时机 | `src/07-main.js:31` | ✅ 在 `boot()` 同步段、`waitFor('video')` 之前，不等视频。注释 28-30 已修过 BUG-UX-2 |
| 默认展开 | `src/06-panel.js:684` `<div class="panel show">` + `151-153` `.panel{display:none}/.panel.show{display:block}` | ✅ 默认可见 |
| 自动收起 | `src/06-panel.js:366-370` | 仅 `panelVisible===false` 时收起，默认 `true`（`00-config.js:59`）→ 无 autoHide |
| 无延迟/无入口依赖 | — | ✅ 不需要点任何入口 |

**但有一处会让"看得见"退化成"看不见"：**

- **`src/06-panel.js:144-147` `.mini{…display:flex…}` 且 `683` 无初始隐藏 → mini 圆点永远显示。** `.wrap` 是块级容器，mini 与 panel 上下并排：展开态是「44px 蓝圆 + 330px 面板」叠在一起；`_bind` 831-837 折叠只 `remove('show')`、展开只 `add('show')`，**从不隐藏 mini**。
- 真正致命的是**折叠态**：整个脚本的存在感只剩右下角一个 44px 小圆点，和智慧树自带的悬浮客服/播放器控件混在一起 → 用户原话"面板都没有、完全看不到"最可能的来源。
- 次生风险：`07-main.js:22-26`（`redetect()` / `getCourseId()`）跑在 mount 之前且**无 try/catch**，异常会直接中断 boot，面板永不挂载且无任何报错。

### 建议 patch

1. **mini 与 panel 互斥**（`06-panel.js`）：`144` 改为 `.mini{…display:none…}`，新增 `.mini.on{display:flex}`；`831-834` fold 分支改为 `$('.mini').classList.add('on')`；`835-837` mini.onclick 改为 `panel.classList.add('show'); this.classList.remove('on')`；`366-370` 的 `panelVisible===false` 分支同步 `mini.classList.add('on')`。
2. **mount 提到最前**（`07-main.js:15-31`）：`boot()` 第一行就 `try{ ZHS.panel && ZHS.panel.mount(); }catch(e){}`，再把 22-26 包进 try/catch，catch 里 `ZHS.panel.alert('初始化异常：'+e.message,'error',15000)`。保证"面板永远先于任何业务逻辑出现"。
3. **首屏自带存在证据**（`06-panel.js:698 / 1043-1053`）：首次引导 `#zhs-guide` 默认 `display:none`，建议默认展开，并把首行文案改成「看到这个面板 = 脚本已生效」，点「我知道了」后写入 `zhs-onboarded` 收起。

---

## 2. z-index / position / 显示位置会被盖住吗？

### 现状

- `src/06-panel.js:126`：`position:fixed; right:16px; bottom:16px; z-index:2147483647` —— 已是 int32 上限，常规页面元素压不过它。
- host 挂在 `document.documentElement`（`360`），`host.style.cssText='all:initial'`（`348`）→ host 为 static/inline，**不创建层叠上下文**，`.wrap` 参与根层叠上下文并位于 DOM 末尾，正常。

**真实风险不在 z-index，而在三处：**

1. **视觉淹没**：智慧树播放页右下角正是播放器控件/弹题区，330px 面板压在播放器上方，用户会以为那是页面自带 UI。
2. **全屏彻底不可见**：`00-config.js:67` `exitFullscreenOnPanel:false`（默认正确，不擅自弹用户出全屏），`06-panel.js:432-435` 判定原生 `<video>` 全屏时面板不渲染；此刻**脚本还在正常跑，但用户什么也看不到**。`_fsFailedNotice`（`393`）只在**退出全屏后**才提示，全屏期间零反馈。
3. **无 iframe 守卫**：脚本头无 `@noframes`（`dist/zhihuishu-helper.user.js:1-20`），src 中也没有 `window.top !== window.self` 判断（全仓仅 `08-questions.js:97` 读 iframe document）。若页面把播放器放进 iframe，面板会挂进 iframe 被裁掉 = "看不到"。

### 建议 patch

1. `06-panel.js:126` 加 `max-width: calc(100vw - 32px)`，避免浏览器缩放 150%/200% 时被推出视口。
2. `06-panel.js:344-372` `mount()` 末尾调用已有的 `_panelLooksVisible()`（`457-475`）自检：返回 false 且 `panelVisible !== false` 时 `Log.warn('面板未渲染，可能被遮挡或挂在 iframe 内')`，并对用户 `alert('看不到面板？请退出全屏 / 回到主页面，右下角「智」圆点可唤出面板','warn',15000)`。
3. `06-panel.js:360` 之前加帧判断：`if (window.top !== window.self && !/studyvideoh5|fusioncourseh5/.test(location.href)) return;`（或脚本头补 `@noframes`）。
4. 全屏期间补提示：`_onFullscreenChange` 挂载失败分支（`06-panel.js:432` 附近）即使不退出全屏，也写一条 `Log.info` + 面板 alert「面板在全屏下不可见，退出全屏即可看到（脚本仍在后台运行）」，不要等到退出后才说。

---

## 3. 启动时有没有"自我介绍"式 Console 日志？

### 现状

- **有**：`00-config.js:281` `Log.info('助手已注入 v' + ZHS.version)` → 控制台 `[智慧树助手] 助手已注入 v0.6.3`；`07-main.js:19/26/43/59` 另有初始化、课程 ID、课时、进度日志。
- **但不够**：这是一条普通 info，淹没在 `debug:true`（`00-config.js:58`）产生的一堆日志里；且**没告诉用户"看哪里、看不到怎么办"**，也没打印当前 hostname（用户无法据此判断"这个页面到底注没注入"）。

### 建议 patch（`00-config.js:281` 原地替换）

```js
Log.info('智慧树助手 v' + ZHS.version + ' 已注入｜当前页 ' + location.hostname
  + '｜面板在页面右下角（收起时是蓝底「智」圆点）');
console.log('%c智慧树助手 v' + ZHS.version + ' 已启动',
  'color:#fff;background:#185FA5;padding:2px 6px;border-radius:4px',
  '看不到面板？确认本行日志出现 = 脚本在跑；再去右下角找面板或「智」圆点');
```
并把 `07-main.js:19` 的 `=== 初始化开始 ===` 改成 `Log.info('boot 开始｜URL=' + location.href)`，用户一眼能对上"我人在哪一页"。

---

## 4. 检测到"不是播放页"时有没有明确提示？

### 现状（本条是最弱的一环）

- `07-main.js:34-40`：先 `await U.waitFor('video', 30000)`，**等满 30 秒**没找到 video 才 `alert(...,'warn',10000)`。
- 也就是说停在首页 / 课程列表 / 登录页时：**前 30 秒面板上全是"—"、零提示**；30 秒后才蹦一条 10 秒就消失的顶部条。
- 面板正文没有任何常驻的"当前不在播放页"标识（`06-panel.js:707` `.s-run` 恒显示"—"）；`05-scheduler.js:136` 的"未识别到课程目录"只在 scheduler 起来后才可能触发，非播放页根本走不到。

### 建议 patch

1. `07-main.js:22` 之后立刻判页面类型（复用 `location.href`，与 `02-adapter.js:174-189` 的域名口径一致）：
   ```js
   const isPlay = /studyvideoh5|fusioncourseh5|studyplush5|studywisdomh5|polymas\.com|hike\.zhihuishu/.test(location.href)
                  || !!document.querySelector('video');
   if (!isPlay) ZHS.panel.alert('当前不在课程播放页：' + location.pathname +
     '｜请进入具体课程的播放页，脚本会自动开始', 'warn', 0);
   ```
2. `06-panel.js:1333` 支持常驻：`const ms = Number(durationMs); if (ms > 0) { clearTimeout...; setTimeout(...) }` —— 让 `durationMs=0` 表示不自动消失。
3. `06-panel.js:1152` `_refreshInner()` 中：`ZHS.state.siteVersion === 'unknown' || 'unrecognized'` 时把 `.s-run`（`707`）显示成「未识别页面（非播放页）」，别再显示"—"。
4. `07-main.js:34` 把 30s 缩到 8s，或在等待期间每 5s 打一条 info 日志，杜绝"死等"。

---

## 5. `@match` 有没有覆盖不到的停留页？

### 现状

- `tools/lib/bundle.js:25-27` / `dist:7-9` 三条全站通配：`*.zhihuishu.com`、`*.polymas.com`、`*.zhihuishu.cn`，**无 `@include`、无 `@exclude`**。
- 因此登录页（passport）、首页（www）、课程列表页这些子域**都是注入的**——"覆盖不到"在子域层面基本不成立。

**真正的洞是三个：**

1. **裸域不匹配（实锤）**：Chrome/TM 的 match pattern `*.zhihuishu.com` 一般**不含 apex** `zhihuishu.com`、`polymas.com`。用户手敲 `zhihuishu.com` 时脚本完全不注入，**连第 3 条的日志都不会出现**，体感 100% 等于"没装上"。
2. **未知/私有化域名**：校内课、学分课若部署在学校自有域名上，通配三条全落空；`02-adapter.js:174-189` 的 `hostBonus` 也只认这几家。
3. **安装页在分发旧版（P0）**：`dist/install.html:5 / :38 / :75 / :101` 内嵌的是 **v0.6.2**，而 `package.json` 与 `dist/zhihuishu-helper.user.js:4` 已是 **v0.6.3**。也就是说**从安装引导页点"安装"的新手，拿到的是缺 `74ac103`（studyvideoh5 目录识别抢占 → 无法跳转下一节）修复的旧版**。第一次装就装旧版，是这条链上最硬的一处事实问题。

### 建议 patch

1. `tools/lib/bundle.js:25-27` 补三条裸域：`*://zhihuishu.com/*`、`*://polymas.com/*`、`*://zhihuishu.cn/*`；`test/run.js:1064-1065` 同步加断言（那里已有 `@match` 覆盖检查，直接扩）。
2. 兜底可见性：即使某天域名没覆盖，也要让用户能自查——第 3 条日志里打印 `location.hostname`，配合"本行日志出现 = 脚本在跑"的说明。
3. 构建收口：`build.js` 生成 `dist/install.html` 时用**同一份 bundle 文本**重写内嵌脚本 + `<title>`/`@version`/`window.__ZHS_BUILD__.version`，否则每次发版都留下"新手装旧版"这个坑。

---

## 优先级

| 级别 | 问题 | 落点 |
|---|---|---|
| **P0** | 安装页仍发 v0.6.2（缺 74ac103） | `dist/install.html:5/38/75/101` + `build.js` |
| **P0** | 非播放页静默 30 秒才提示 | `src/07-main.js:34-40` |
| **P1** | mini 与 panel 状态不同步，折叠后只剩 44px 圆点 | `src/06-panel.js:144 / 683 / 831-837 / 366-370` |
| **P1** | 无 iframe 守卫，面板可能挂进隐藏 iframe | `src/06-panel.js:360` |
| **P1** | 裸域 `@match` 缺失 | `tools/lib/bundle.js:25-27` |
| **P2** | 全屏期间零反馈 | `src/06-panel.js:432` 附近 |
| **P2** | 启动日志文案缺少"看不到怎么办" | `src/00-config.js:281` |
| **P2** | `boot()` 前段无 try/catch，异常即无面板无提示 | `src/07-main.js:15-26` |

## 一句话结论

面板"挂得上"，但**证明自己存在的证据不够**：折叠成一个小圆点、非播放页静默 30 秒、安装页还发旧版——这三件事任意一件都能让新手得出"没装上"的结论。
