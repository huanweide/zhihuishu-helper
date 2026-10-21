# 测试资产质量审查（round-3）

> 审查对象：提交 74ac103 的测试资产（test/run.js 245 项、tools/e2e-real.js 16 项、tools/e2e-h5.js 8 项、tools/e2e-studyvideoh5.js 12 项、tools/check-dist-fresh.js）
> 结论一句话：**245 项里真正能失败的约 150 项；但最致命的不是断言写歪，而是「整条播放链路零覆盖」——所有 e2e 都在开局把主循环关掉，只测静态目录识别。**

---

## 一、恒真 / 空气断言（重点 1）

### 1.1 常量 true，永远不可能红

| 位置 | 内容 | 判定 |
|---|---|---|
| `test/run.js:465` | `ok('缓存可清空', true)` | 断言字面量 `true`，`S.clearCache()` 就算抛错被吞也绿 |
| `test/run.js:1046` | `ok('产物存在', true)` | 包在 `if (fs.existsSync(distPath))`（`run.js:1044`）内，能执行到就必然为真；**dist 不存在时整组 33 静默跳过，只打印「未构建」，`fail` 不 +1** |

`run.js:1044` 的 `existsSync` 守卫是比断言本身更严重的问题：产物缺失这条最该红的场景，被设计成「不测」。

### 1.2 字符串存在性断言：只证明 dist 里有这几个字

`test/run.js:1059-1074` 共 16 条全是 `src.includes(...)`，不触发任何一次函数调用：

- `run.js:1059-1062`（`@name` / `@grant GM_setValue` / `@grant GM_xmlhttpRequest` / `@connect localhost`）——脚本头静态文本，改构建模板才会变，**与 src 逻辑正确性无关**；真正该验的是「油猴给没给这些 grant」，而这在 jsdom 里根本测不到。
- `run.js:1066` `includes('wisdom') && ... && includes('polymas')`——6 个页面名只要注释里出现过就绿。
- `run.js:1067-1068` `includes('#playTopic-dialog')` / `includes('.subject_node')`——选择器在源码里存在 ≠ 在真实页面上命中。
- `run.js:1070-1073` `includes('function normalize')` / `statusOf` / `finishAll` / `closeDialogAndResume`——**连「有没有被调用过」都没验证**，纯噪声。
- `run.js:1074` `includes("'use strict'")`——IIFE 包裹检测靠搜字符串，任何文件加一行就绿。

唯一有实质价值的是 `run.js:1051-1058` 的内容级比对（`bundle().content === dist 原文`），这条确实能挡住「漏 build」，值得保留。

### 1.3 存在性断言（`typeof x === 'function'`）：全文件 10 条

`run.js:285-288`（start/gotoNext/tick）、`run.js:461-462`（solve/solveAll）、`run.js:497-498`（handleDialog/handleHomework）等。只证明函数挂上了，**不证明它会跑、不证明跑对了**。典型：`run.js:287` 断言 `typeof S.tick === 'function'`，而 `Scheduler.tick`（`src/05-scheduler.js:197`）是整套自动化的主心骨，**245 项里没有任何一条真正执行过 `tick()`**。

### 1.4 把 jsdom 的缺陷当成期望值（反向断言）

`test/run.js:118`：
```js
// 可见性（jsdom 无布局，rect 全 0 → 判定不可见，这是预期行为）
eq('hasVisible 对零尺寸元素返回 false', U.hasVisible('#a'), false);
```
`Util.isVisible`（`src/01-util.js:53-61`）要求 `rect.width > 0 && rect.height > 0`。jsdom 无布局全返回 0，所以必然 false；**真实 Chrome 里 `<div id="a">` 有尺寸，应返回 true**。这条断言把「环境缺陷」固化成了期望，一旦有人在真实浏览器补一条同名断言会立刻冲突。更实际的危害：src 里所有依赖 `isVisible` 的点击前置判断，在单测中全部走「不可见」分支，`test/run.js` 从未验证过「可见分支」的代码。

### 1.5 声称测 bug、实际没断言（伪装成回归测试的空气）

`test/run.js:504-547`（第 19 组）注释写明要回归「重复绑定吞掉监听器」的 bug，但：
- `run.js:530` `R._saveThrottled = null;` 注释说「故意打断测试，确认监听器用的是内部引用」——**打断之后没有任何一条断言**。
- 全组 5 条断言（523/526/540/541/545/546）验的是 `bindVideo` 返回值、`_bindId > 0`、`_detach` 清空字段。
- **从未触发 `timeupdate` 验证进度真的存进了 `store`**。也就是说，这个 bug 今天复发，这组测试一条都不会红。

### 1.6 弱化断言：二选一即绿

`test/run.js:1000-1004`：
```js
ok('手动触发后：要么作答、要么明确告知未作答',
   answered || /没有可用答题通道|未能识别到题目/.test(logText), ...);
```
「什么都不做 + 打一条日志」就能通过。面板「答题」按钮点了没反应，正是用户投诉的形态之一，这条断言恰恰放行了它。

### 1.7 异步等待：已修好，无遗漏

`run.js:639/719/874/920/933/968` 定义 6 个 async IIFE，`run.js:1042` 的 `Promise.all` 全部等待，无漏网。这一项**没问题**。

### 1.8 门禁未接入

`tools/check-dist-fresh.js`（exit 1 语义完整）**不在 `npm test` 里**——`package.json:9` 的 `test` 只有 `node test/run.js`。它只在 `check:dist`（package.json:8）/ `test:all`（:11）/ `release`（:14）被调用。由于 `run.js:1052-1058` 已内联等价比对，日常不漏；但 `run.js:1044` 的 existsSync 守卫意味着**「dist 整个没了」时 `npm test` 仍然全绿**，而 `check-dist-fresh.js:24-27` 会正确 exit 1。

---

## 二、夹具失真（重点 2）

### 2.1 最根本的问题：仓库里根本没有真实播放页 DOM

`reference/live/rendered-stuStudy.html`（410KB）`<title>` 是「登录中心」，类名全是 `el-input / el-overlay / yidun_input`（易盾验证码），`<video>` 只有一个 `alivideo...loginvideo...mp4` 的背景视频（`rendered-stuStudy.html:11`）。`reference/live/stuStudy.html`、`probe.html`、`hike.html` 同为登录页快照。

→ 四个夹具注释里写的「与真实结构完全一致」（如 `test/fixtures/real-wisdom.html:14` 称「与 docs/01-侦察报告.md 2.2 节完全一致」），**证据链是「文档转述」而非「抓样比对」，无法证伪**。本轮与 round-2 的结论一致：夹具能证明「代码与夹具自洽」，不能证明「夹具=真实页面」。

### 2.2 逐项差异

| # | 夹具形态 | 真实形态（证据） | 掩盖的 bug |
|---|---|---|---|
| 1 | 4 个夹具 `<video>` 全在主文档（`real-wisdom.html:43`、`real-h5.html:76`、`real-legacy.html:42`、`studyvideoh5-legacy.html:64`） | 弹题/播放器存在 iframe 形态，src 有专门分支：`src/08-questions.js:94-97` 读 `#tmDialog_iframe.contentDocument`；`reference/zhs-assistant/main.js:37` 亦用 `tmDialog_iframe.contentWindow` | **iframe 分支零覆盖**。真实页面弹题若在 iframe 内，`root()` 返回 iframe doc，后续所有 `document.querySelector` 语义不同，整条答题链路未测 |
| 2 | `studyvideoh5-legacy.html:20` `video { display: none; }`，且该夹具**未加载 `fixture-media.js`**（另 3 个都加载了，见 `real-wisdom.html:44-46`） | 真实播放器可见且可播 | 该夹具下 video 无 src、无 duration 桩、被 CSS 隐藏，`Player` 全部逻辑实际不可运行；`e2e-studyvideoh5.js` 的 12 项与播放行为完全无关 |
| 3 | 目录一次性静态渲染，2~5 个平铺节点 | 真实为 Vue/Element UI 异步渲染 + 折叠 + 懒加载 | 「脚本注入早于目录渲染」这一真实失败模式无覆盖。`expandTreeOnce`（`src/02-adapter.js:244`）只在 `e2e-h5.js:103` 间接验过一次 |
| 4 | 完成标记只有 `.child-check` / `.time_icofinish` / `.icon-finish` 三种，进度用 `aria-valuenow="45"` / `100%` 文本 | 无法从仓库素材证实当前平台用什么标记（无登录态抓样） | 平台一改类名，4 个夹具与 src 一起失效，测试仍全绿 |
| 5 | 无遮挡层 | 真实有易盾验证码：src 有专门守卫 `src/05-scheduler.js:16` `VERIFY_SELECTORS = '.yidun_popup, .yidun_modal, [id^="tcaptcha_transform"]'`，`:217`、`:227` 会暂停等待 | **验证码守卫零测试**。真实环境下这一守卫会 `await` 最长 2 分钟（`05-scheduler.js:28` `VERIFY_WAIT_MAX_MS`），处理错了就是「脚本装了但卡住不动」 |
| 6 | `file:///` 加载（`e2e-real.js:41`、`e2e-h5.js:44`、`e2e-studyvideoh5.js:41`） | 真实为 https + 油猴注入 | hostname 分支永不生效：`src/02-adapter.js:173` `hostBonus()` 在 file:// 下 `location.hostname` 为空，评分选举的域名加分项**在全部 36 项 e2e 中从未参与**；`@match`、`@grant`、CSP、跨域 XHR 也全部绕开 |

### 2.3 夹具可信度

**4/10**。能验证目录识别与点击链路的自洽性，但播放行为、iframe、验证码、异步渲染四项真实环境的核心形态全部缺失；且「真实性」依据是文档而非抓样。

---

## 三、jsdom 掩盖了什么（重点 3）

`test/run.js:44-71` 的 `makeEnv` 用 `new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' })`。

### 3.1 失真 API 清单

| API | src 位置 | jsdom 行为 | 真实 Chrome | 影响 |
|---|---|---|---|---|
| `getComputedStyle` | `src/01-util.js:55`、`:75`、`src/06-panel.js:560`、`:1133` | 只返回内联/默认样式，级联与样式表基本不生效 | 完整级联 | `isStructurallyVisible`（`01-util.js:73-80`）判定失真，弹题存在性判断在单测里不可信 |
| `getBoundingClientRect` | `src/01-util.js:59`、`src/06-panel.js:461`、`:468`、`:561` | 恒为全 0 | 真实尺寸 | `isVisible` 恒 false（见 1.4）；面板定位 `06-panel.js:461` 恒走 fallback |
| `attachShadow` / shadow DOM | `src/06-panel.js:349` | jsdom 支持有限 | 完整 | `run.js:823` `host.shadowRoot.querySelector('.report')` 在 jsdom 下能过，不代表真实浏览器一致 |
| `MutationObserver` | `src/07-main.js:79` | 存在但 jsdom 触发时机与 Chrome 不同 | 微任务批量触发 | `watchSpa()`（`07-main.js:63-84`）的「视频元素被替换→重新绑定」无测试 |
| `video.play()` Promise | `src/03-player.js:88-89`、`:111` | jsdom 的 `play()` 直接抛「Not implemented」 | 返回 Promise，可被 autoplay 策略 reject | `ensurePlaying`（`03-player.js:79-96`）在 jsdom 恒走 catch，真实行为完全未验 |
| `playbackRate` | `src/03-player.js:68` | jsdom 可赋值但不生效 | Chrome 生效，但无 src/直播流时被静默忽略 | **倍速是否真的生效，零断言** |
| `scrollIntoView` | `src/02-adapter.js:618` | jsdom 为 no-op | 真实滚动 | 「条目不在视口内点不动」的补救（`02-adapter.js:613-618`）未验 |
| iframe `contentDocument` | `src/08-questions.js:97`、`src/06-panel.js:510` | 夹具无 iframe，**分支从不进入** | 真实可能进入 | 见 2.2-1 |

### 3.2 GM 桩不全 → 整条路径被跳过而非「通过」

`test/run.js:55-56` 只桩了 `GM_setValue` / `GM_getValue`。src 中所有 GM 调用都有 `typeof` 守卫（`src/00-config.js:80`、`src/04-resume.js:17`、`src/06-panel.js:1105`、`src/06b-course-hub.js:25`、`src/09-bank.js:20`），于是单测中：

- `GM_xmlhttpRequest` 未桩 → `src/09-bank.js:31` 的题库请求**整条降级跳过**，`Bank` 的真实请求/解析/超时路径 0 覆盖；
- `GM_addStyle`、`GM_registerMenuCommand`、`GM_notification` 在 src 中未出现，说明面板样式是内联注入——这部分只能在真实浏览器验。

即：**这些代码不是「测过了通过」，而是「根本没跑」**。

### 3.3 状态泄漏

`stopAllTimers`（`run.js:35-42`）只调 `ZHS.Scheduler.stop()`，清的是 `Scheduler._timer`；但 `src/04-resume.js:186` 的 `visibilitychange` 监听、`src/07-main.js:79` 的 MutationObserver、以及 `fixture-media.js:56` 的 250ms ticker 都未清理。`run.js:638` 靠 `stopAllTimers()` + 第 22 组开头「等 600ms」来规避，**属于用 sleeps 掩盖泄漏，而非隔离**。

---

## 四、高风险缺口：「脚本装了但完全不动」（重点 4）

**结论：这一失败模式没有任何一条测试用例。**

证据：

1. **三个 e2e 全部在开局主动关掉主循环**：
   - `tools/e2e-real.js:62-63`：`ZHS.Scheduler.stop(); ZHS.state.running = false;`，注释写明「避免 watch 干扰受控验证」。
   - 于是 16 项断言测的全是 `Catalog.items() / statusOf() / findNext() / click()` 这些**纯静态读 DOM**，没有任何一项验证「脚本自己会动」。
   - 反过来说：**把 `Scheduler.start()` 整段删掉，3 个 e2e 全部照绿。**

2. **没有任何断言观察「可见行为」**：36 项 e2e + 245 项单测中，无一条检查
   - `video.playbackRate` 是否被改成配置值（`src/03-player.js:64` `setSpeed` 零覆盖）；
   - `video.paused` 是否被置 false（`src/03-player.js:79` `ensurePlaying` 零覆盖）；
   - `video.currentTime` 是否推进（`src/03-player.js:99` `checkStall` 零覆盖）；
   - 面板是否真的挂载（`src/07-main.js:31` `panel.mount()` 零覆盖）；
   - 注入后 N 秒内日志是否有输出。

3. **`Scheduler.tick()`（`src/05-scheduler.js:197`）从未被执行**：它是 2 秒一轮的主循环，内含保活播放（`:336`、`:360`）、切课（`:442` `gotoNext`）、结束判定（`:372` `onLessonEnd`）、停止条件（`:202`）。唯一相关的 `run.js:960` 只直接调了一次 `onLessonEnd`，绕开了 tick 的守卫与调度。

4. **`retryFromPlatformProgress`（`src/03-player.js:141-170`）零覆盖**：这是 09-18 修过的致命 bug（「永远跳不到下一集」），代码里三道闸（`:155`、`:159-160`、`:161`）全是手工推演，没有一条断言验证 `platformPercent=0` 时确实返回 false 而不重播整节。

5. **注入失败路径零覆盖**：`@match` 不匹配、`GM_*` 未授权、`boot()` 抛异常、30 秒等不到 video（`src/07-main.js:34-41`）这四种「装了等于没装」的形态，均无测试。

6. **错误捕获有盲区**：`tools/e2e-real.js:53` 只监听 `window.addEventListener('error')`。src 大量 `async`（`tick`、`gotoNext`、`finishAll` 全是 async），**Promise 拒绝不会触发 window error**，会落进 `unhandledrejection`。所以 `e2e-real.js:108` 的「① dist 注入无运行时错误」对异步崩溃恒为绿。

7. **e2e 资产本身是孤儿**：`package.json:16` 只有 `"e2e": "node tools/e2e-real.js"`。`tools/e2e-h5.js` 与 `tools/e2e-studyvideoh5.js` **未接入任何 npm script**，只能手工跑；且三个脚本都硬编码 `C:\Program Files\Google\Chrome\Application\chrome.exe`（`e2e-real.js:22`、`e2e-h5.js:24`、`e2e-studyvideoh5.js:21`），换机器即失效。

8. **孤儿测试文件**：`test/gray-v060.js`（87KB）、`test/regression-v062.js`、`test/verify-course-hub.js`、`test/audit-hub-fix.js`、`test/live-run.js`、`test/fullscreen-panel.js` 均未被 `package.json` 任何 script 或 `tools/` 引用，等于不存在。

---

## 五、必须补的 5 条测试

### 必补 1 · 「装了必须动」冒烟（最高优先级，堵住失败模式 4）

- **测什么**：注入 dist 后不手工调任何 API、不 stop，观察脚本在真实浏览器里自己产生的可观测副作用。
- **怎么测**：新建 `tools/e2e-boot-smoke.js`（真实 Chrome + `test/fixtures/real-wisdom.html`，video 已由 `fixture-media.js` 打桩 300s）。注入 dist 后**只等** 8 秒（覆盖 2s×4 轮 tick），然后断言：
  1. `document.querySelector('video').playbackRate === 1.5`（默认倍速，验 `03-player.js:64`）；
  2. `video.paused === false`（验 `03-player.js:79`）；
  3. `video.currentTime > 0`（验保活与 `fixture-media` 推进器联动）；
  4. `document.getElementById('zhs-helper-panel')` 存在且 `shadowRoot.textContent` 非空（验 `07-main.js:31`）；
  5. `ZHS.Log.all().length` 在 8 秒内**有增长**（证明 tick 真的在跑，而不是 `setInterval` 挂了个空函数）。
- **为什么必须**：这条是唯一能挡住「`Scheduler.start()` 被删/被 `_halted` 误停/`_timer` 没起来」这类全废故障的测试。

### 必补 2 · `Scheduler.tick()` 单次驱动的端到端行为

- **测什么**：主循环一轮之内应完成「保活 → 判结束 → 切下一节」。
- **怎么测**：在 jsdom 里造 2 节目录 + 打桩 video（`duration=300, currentTime=300, ended=true, paused=true`），`ZHS.state.running = true`，`await Scheduler.tick()`，断言：
  1. 切课发生：`Catalog.current()` 的标题从第一节变为第二节（验 `05-scheduler.js:360 → 372 → 442` 整链）；
  2. 切课冷却生效：紧接着再 `tick()` 一次，不应再次切课（验 `05-scheduler.js:32` `NAV_COOLDOWN_MS`）；
  3. `video.paused` 被置 false（保活分支，验 `05-scheduler.js:336`）。
- **为什么必须**：tick 是 650 行调度器的唯一入口，目前只有一条 `typeof` 断言。

### 必补 3 · `retryFromPlatformProgress` 的三道闸（防「永远跳不到下一集」复发）

- **测什么**：09-18 修过的进度回退 bug。
- **怎么测**：单测直接调 `Player.retryFromPlatformProgress(v, pct)`：
  1. `pct = 0` → 返回 `false` 且 `v.currentTime` **保持 300 不变**（不能退回 0 重播整节，验 `03-player.js:155`）；
  2. `pct = 90`、`duration = 300` → `seekTo` 落到 `min(max(0, 270-5), 295) = 265`，不得落到 0（验 `03-player.js:159-160` 的 tailFloor）；
  3. 连续第 3 次调用 → 返回 `false` 且 `_retryCount` 归零（验 `03-player.js:142-146` 的重试上限）。
- **为什么必须**：这是已被用户实际遭遇过的致命 bug，修复全靠代码注释里的手工推演，零机器验证。

### 必补 4 · iframe 弹题链路（补 2.2-1 的盲区）

- **测什么**：弹题渲染在 iframe 内时，采集链路仍能工作。
- **怎么测**：新建夹具 `test/fixtures/dialog-in-iframe.html`：主文档只有 `<iframe id="tmDialog_iframe" srcdoc="...#playTopic-dialog...">`，内部放题干 + 2 个选项（srcdoc 同源，`contentDocument` 可访问）。真实 Chrome 注入 dist 后断言：
  1. `ZHS.Questions.Dialog.present() === true`（验 `08-questions.js:94-97` 的 iframe 分支真的进入了）；
  2. `Q.Dialog.readCurrent().title` 能取到题干文本；
  3. `Q.Dialog.close()` 后 `stillPresent() === false`。
- **为什么必须**：`src/08-questions.js:94-97` 是专门为 iframe 写的分支，目前 0 覆盖；而 `reference/zhs-assistant/main.js:37` 证明真实平台确实用 `tmDialog_iframe`。

### 必补 5 · 易盾验证码守卫不吊死主循环

- **测什么**：出现 `.yidun_popup` 时脚本应暂停等待、消失后恢复，且不会永久阻塞。
- **怎么测**：真实 Chrome + 夹具里放一个 `.yidun_popup` 元素。`start({manual:true})` 后：
  1. 断言 2 秒内 `video.paused === true` 或日志出现「等待验证」字样（验 `05-scheduler.js:217`）；
  2. 用 `page.evaluate` 在 3 秒后移除该元素，断言 8 秒内 `video.paused === false`（恢复播放）；
  3. **反例**：不移除元素，断言在 `VERIFY_WAIT_MAX_MS`（2 分钟，可临时把阈值改小或注入 `ZHS.config` 覆盖）之后主循环仍在推进（日志条数继续增长），验证「宁可放行也不永久阻塞」（`05-scheduler.js:28`）。
- **为什么必须**：`rendered-stuStudy.html` 里真实存在易盾验证码；守卫写错的表现就是「脚本装了但一动不动」，与失败模式 4 直接同源。

---

## 六、优先级建议

| 优先级 | 项目 | 成本 |
|---|---|---|
| P0 | 必补 1（装了必须动冒烟） | 中 |
| P0 | 必补 2（tick 端到端） | 低 |
| P0 | 删除 `run.js:465`、`:1046` 两条常量 true；把 `run.js:1059-1074` 的 16 条字符串断言精简为「脚本头 4 条 + 内容级比对 1 条」，其余删除 | 低 |
| P1 | 必补 3（retryFromPlatformProgress 三道闸） | 低 |
| P1 | 必补 4（iframe 弹题） | 中 |
| P1 | 把 `e2e-h5.js` / `e2e-studyvideoh5.js` 接进 `npm run e2e`；Chrome 路径改为环境变量 `CHROME_PATH` 兜底 | 低 |
| P1 | 给 `run.js:118` 的 hasVisible 断言改写成「对 display:none 元素返回 false」，不再依赖 jsdom 无布局 | 低 |
| P2 | 必补 5（验证码守卫） | 中 |
| P2 | 三个 e2e 补 `unhandledrejection` 捕获（对齐 `e2e-real.js:53`） | 低 |
| P2 | 清理孤儿测试（`test/gray-v060.js` 等 6 个）或接入 script | 低 |
| P2 | 拿到一份登录后的真实播放页 DOM 抓样，替换「文档转述」作为夹具依据 | 高（需登录态） |
