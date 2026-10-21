# 播放流转走查报告：为什么「看完一集」变成「重播」——以及修完之后的残留风险

> 子代理：playback-flow（播放流转）
> 走查对象：油猴脚本「智慧树助手」视频结束 → 切下一节 全链路
> 代码基线：
> - **v0.2.1** = git HEAD `953c218`（**用户当前正在跑的版本**，dist/zhihuishu-helper.user.js 也是这一版）
> - **v0.3.0** = 23:40 左右从 `zhihuishu-helper/src` 冻结的快照（`05-scheduler.js` md5 `a08a3a84451506cbcd8fe87e232de301`），队友正在并发修改，本报告结论以此快照为准
> 方式：静态读码 + **jsdom 真跑**（不改动项目任何文件，验证脚本放在系统临时目录）
> 结论一句话：**用户看到的「重播」不是播放器行为，是脚本自己把视频 seek 回 0 秒重放的**；v0.2.1 里这条链路有 3 个 bug 叠加，形成「重播 2 次 + 空转 1 次」的无限循环；v0.3.0 已修掉主因，但留下了「连跳」和「学时可能拿不到」两个新风险。

---

## 一、结论速览

| 编号 | 问题 | 影响 | 状态 |
|------|------|------|------|
| BUG-PB-1 | 平台进度「读不到」被当成「0%」 | 必然走重播分支（**主因**） | v0.3.0 已修 |
| BUG-PB-2 | 「重试 2 次后强制切下一节」是**死代码** | 上限形同虚设 → 无限重播 | v0.3.0 已修 |
| BUG-PB-3 | 进度 0% 时回退目标是 **0 秒** | 不是回退一点，是整集从头重播 | v0.3.0 已绕过（不再走到） |
| BUG-PB-4 | 切课后没确认「新课时真的开播」就把旧 video 绑回来 | v0.3.0 下变成**约 12 秒一节连跳，绕目录死循环** | **未修，P0** |
| BUG-PB-5 | 新策略「读到 0 就切」无法区分「读不到」与「平台还没上报」 | 可能**丢学时** | **未修，P0** |
| BUG-PB-6 | atEnd 的 0.995 阈值 / duration 非有限值 / 平台 loop | 提前触发或永不触发 | 未修，P1 |
| BUG-PB-7 | 守卫 2 排在结束判断之前 + 可见性判定漏判 | 弹题残留时主循环走不到结束判断 | 部分修（v0.3.0 会尝试关闭） |
| BUG-PB-8 | 找不到下一节就 `stop()` | 静默停手 | 未修，P2 |
| BUG-PB-9 | 307 项测试**没有一条**覆盖结束→切课链路 | 全绿测试放行了致命 bug | 未修，P2 |

---

## 二、复现方法（可照抄复跑）

我在系统临时目录 `C:\Users\Administrator\AppData\Local\Temp\zhs-pb\` 下做了三件事（项目目录零改动）：

1. `orig/` = 从 git HEAD 导出的 v0.2.1 源码（`git show HEAD:src/05-scheduler.js` 等）；
2. `v030/` = 当前开发版源码快照；
3. `probe2.js` / `probe3.js`：用 jsdom 加载两份源码，注入一张假的智慧树目录（`.child-info.hasvideo` × 5 + 一个假 `video` 元素），**手动驱动 `Scheduler._tickInner()`**，把 `Util.sleep` 换成虚拟时钟快进，逐轮记录「重播 / 切课 / 空转」。

复跑命令：

```bash
cd C:/Users/Administrator/AppData/Local/Temp/zhs-pb
node probe2.js    # 对比 v0.2.1 与 v0.3.0：进度读不到时会怎样
node probe3.js    # 量化 v0.3.0 的两个副作用：连跳 / 目录识别失败
```

### 2.1 关键运行证据（v0.2.1 = 用户当前版本）

场景：目录里**没有** `[role=progressbar]` 元素（模拟真实站上进度选择器失配 / 进度条不在条目内）。

```
===== [v0.2.1(用户当前)] 条目内无进度元素（平台进度读不到→0） =====
轮次  重试计数   结果              累计切课
1     '0→1'     '回退重播至 0s'    0
2     '1→2'     '回退重播至 0s'    0
3     '2→0'     '无动作（卡住）'   0
4     '0→1'     '回退重播至 0s'    0
5     '1→2'     '回退重播至 0s'    0
6     '2→0'     '无动作（卡住）'   0
...（10 轮）
统计：重播 7 次 / 切课 0 次 / 空转 3 次
```

**这就是用户主诉**：一集放完 → 从头重播 → 再从头重播 → 卡一下 → 再重播……**永远切不走**。

### 2.2 同一场景在 v0.3.0 的表现

```
===== [v0.3.0(开发中快照)] 条目内无进度元素（平台进度读不到→0） =====
1  '0→0'  '切到「1.2 方法」'  1
2  '0→0'  '切到「1.3 案例」'  2
...
统计：重播 0 次 / 切课 5 次 / 空转 0 次
```

主因已修：不再重播，正常往后切。

---

## 三、逐个发现

### [BUG-PB-1] 「读不到平台进度」被静默当成「进度 0%」，直接喂给重播分支 ★主因

**证据**

- `src/02-adapter.js:287-298` `_readProgress()`：选择器没命中就 `return 0`，属性解析失败也 `return 0`；
- `src/02-adapter.js:370-374` `progressOf()`：`if (!el) return 0;` → `isFinished` 为假 → `_readProgress`，一路 0；
- `src/05-scheduler.js`（v0.2.1:178-193）：`const progress = cur ? progressOf(cur) : 0;` → `if (progress >= 100) 切课 else 重播`；
- 选择器本身存疑：我方侦察报告 `docs/01-侦察报告.md:50` 把 `[role='progressbar'][aria-valuenow]` 标注为**「进度条（课程级）」**，而代码是 `el.querySelector(ad.progress)`，即**在 `.child-info` 条目内部找**。如果真实站点上这个进度条是课程级（挂在头部/侧栏，不在条目里），那么每个条目都会读到 0 —— 这正是用户现场的情况。

**根因链**
真实站 progress 选择器失配 → `_readProgress` 静默返回 0 → `0 < 100` → 判定「平台没记满」→ 回退重播。`0` 在这里同时表示「真的 0%」和「完全读不到」，**两种语义被混为一谈**，而后者在真实页面上才是常态。

**建议修法**

1. `_readProgress` 返回值区分「读不到」：找不到元素/解析失败返回 `null`（或 `-1`），只有真正读到数字才返回 0~100；
2. `onLessonEnd` 按三态决策：`100` → 切；`1~99` → 回退重播；`null/0` → 走「未确认」分支（见 BUG-PB-5）；
3. 补选择器兜底：条目内找不到时，向上一级容器找（`el.closest('.child-info')` 的父节点），或读文本里的 `xx%`。

---

### [BUG-PB-2] 「重试 2 次后强制切下一节」是死代码，上限形同虚设 ★放大器

**证据**

- `src/03-player.js:139-143`：
  ```js
  if (this._retryCount >= 2) {
    ZHS.Log.warn('进度不同步已重试 2 次仍失败，跳过本课时');
    this._retryCount = 0;   // ← 到顶后归零
    return false;
  }
  ```
- `src/05-scheduler.js`（v0.2.1:190-193）：
  ```js
  if (!retried) {
    ZHS.Log.warn('重试次数用尽，强制切换下一节');
    await this.gotoNext('进度同步失败，跳过');   // ← 永远不会生效
  }
  ```
- `src/05-scheduler.js`（v0.2.1:201）：
  ```js
  async gotoNext(reason) {
    if (this._navigating && reason !== '本课时已完成') return;   // ← 直接 return
  ```
  `onLessonEnd` 一进来就把 `this._navigating = true`（v0.2.1:174），而 `'进度同步失败，跳过' !== '本课时已完成'`，于是**这条切课指令被静默吞掉**，日志却打印了"强制切换下一节"。

**根因链**
计数到顶 → 归零 + return false → gotoNext 被重入守卫挡掉 → 什么都没发生 → 下一轮 `_retryCount` 又是 0 → 又能重播 2 次 → 无限循环。
实测：10 轮里 **7 次重播 + 3 次空转 + 0 次切课**，与用户"只看第一集"的现象完全吻合。

**建议修法**（v0.3.0 已采用，确认有效）

- `gotoNext` 改成"锁归属"模式：调用方已持锁就复用，不再按 reason 字符串放行（v0.3.0 `05-scheduler.js:281-287`）；
- 「重试次数用尽」分支必须真正可达，并保留 `resetRetry()`。

---

### [BUG-PB-3] 进度读到 0% 时，"回退重试"实际是「从头重播整集」

**证据** `src/03-player.js:144-152`：

```js
const target = (platformPercent / 100) * v.duration;   // 0% → 0
const back = Math.max(0, target - 5);                 // max(0, -5) = 0
await this.seekTo(v, back);                            // currentTime = 0
```

**根因链**
设计意图是"回退到平台记录点再补看几秒"（比如 80% → 回到 75% 处）。但当 `platformPercent = 0`（尤其是"读不到"导致的 0），回退目标就是 **0 秒** —— 用户看到的是**整集从头开始重播**，而不是"补看尾巴"。这就是用户说的"重播"。

**建议修法**
- 只有读到 `1~99` 才允许 seek 回去；
- 且回退量应有下限保护：`back = Math.max(0, Math.min(target - 5, v.duration - 30))` 之类，避免小数值把人踢回片头。

---

### [BUG-PB-4] 切课后不确认「新课时真的开播」，会把旧 video 绑回来 → v0.3.0 下变成连跳 ★P0 残留

**证据**

- `src/05-scheduler.js:339-342`（v0.3.0）：
  ```js
  ZHS.state.videoEl = null;
  await U.sleep(3000);
  await this._rebindAfterNav();
  ```
- `src/05-scheduler.js:413-424` `_rebindAfterNav()`：`U.waitFor('video', 20000)` —— **页面里本来就有一个 video**，所以第一次查询就命中，返回的是**切课前的那个旧元素**；
- `src/03-player.js:21-27` `video()`：缓存为空时 `document.querySelector('video')`，同样拿旧元素；
- `src/05-scheduler.js:229-231` `_tickInner`：`atEnd(video)` 对旧视频恒为 true（它还在结尾态）。

**运行时证据**（probe3，模拟"切课后新视频 30 秒才真正开始播"，即播放器复用 video 元素 + 加载慢）：

```
===== [v0.3.0] X：切课后新视频 30 秒才真正开始播 =====
轮次  虚拟时刻  视频位置  结果
1     15s      600s     切到「1.2 方法」
2     24s      600s     切到「1.3 案例」
3     38s      600s     切到「1.4 小结」
4     51s      600s     切到「1.5 作业」
5     61s      600s     切到「1.1 导论」   ← 绕回开头
6     73s      600s     切到「1.2 方法」
7     84s      600s     切到「1.3 案例」
8     97s      600s     切到「1.4 小结」
点过序列：1.2 → 1.3 → 1.4 → 1.5 → 1.1 → 1.2 → 1.3 → 1.4
```

**根因链**
切课 → 3 秒后把**旧 video** 重新绑成当前视频 → 下一轮 `atEnd(旧视频)=true` → `onLessonEnd` → 新课时进度读到 0 → 按新策略"直接切" → 再切一节……**每节约 12 秒被跳过，视频一秒没看**，绕完整目录后从头再来，**永不停止**（`finishAll` 也永远触发不了，因为 undone 始终 > 0）。
在 v0.2.1 里同一缺陷表现为"重播上一集"；策略改成"读到 0 就切"之后，它换了个马甲变成"疯狂跳课"。

**建议修法**

1. 切课后加**闸门**：记录 `_lastNavAt` 与切课前的 `video.src`；在 `_tickInner` 的结束判断前加一道：
   - `Date.now() - _lastNavAt < 15000` → 跳过结束判断；
   - 或更严谨：`video.currentSrc === _lastNavSrc && video.readyState < 2` → 视为"还没换源"，跳过结束判断；
2. `_rebindAfterNav` 要**等换源而不是等元素**：轮询到 `video.src !== oldSrc`（或 `duration` 变化 / `currentTime < 5`）才算切成功，超时（20s）则记一条 warn 并停手，不要静默继续；
3. 连续两次切到同一个 `lessonKey` → 判定切课失败，停手并弹提示。

---

### [BUG-PB-5] 新策略「读到 0 就切」无法区分「读不到」与「平台还没上报」→ 可能丢学时 ★P0 残留

**证据** `src/05-scheduler.js:251-258`（v0.3.0 已落地的新分支）：

```js
if (progress <= 0) {
  ZHS.Log.warn('平台进度未确认（读到 ' + progress + '%），按视频已放完处理，切换下一节');
  ZHS.Player.resetRetry();
  await this.gotoNext('视频播放完毕');
  return;
}
```

**根因链 / 副作用**
这个改法**方向正确**（消灭无限重播，符合用户"看完就下一集"的核心诉求），但它把两种完全不同的情况合并了：

- A：目录/进度选择器失配 → 永远读不到 → 切，正确；
- B：平台上报延迟（我方踩坑记录 `docs/03-踩坑记录.md:44-58` 与侦察报告 `docs/01-侦察报告.md:238` 都明确写了"视频放完但平台只记录 80%"这种**异步上报**现象）→ 此刻 `.child-check` 还没出现、`aria-valuenow` 还是 0 → 直接切 → **这一节的学时可能不计**。

注意 `progressOf` 里 `isFinished()` 已经包含了 `.child-check` 判定（`02-adapter.js:272-284`），所以"读到 0"其实意味着"**条目找得到、完成图标没出现、进度值也没有**"—— 这更像是 B（还没上报），而不是 A（条目都没找到）。也就是说误切风险并不低。

**建议修法（保留新策略，加一层保险）**

1. **复查窗口**：`progress <= 0` 时不马上切，先 `sleep 8~15 秒`再读一次（平台上报通常在这个量级完成），仍是 0 才切；
2. **区分 A / B**：如果 `cur === null`（连当前条目都定位不到）→ 属于 A，直接切；如果 `cur` 存在但读不到进度值 → 属于 B，走复查；
3. **可观测**：新增配置 `trustVideoEnd`（默认 true），并把"本次运行未确认进度就切了 N 节"写进 `finishAll` 总结报告，让用户能自查学时；
4. 保守替代：B 情况下允许"回退重播 1 次"而不是 0 次——重播尾巴（回到 90% 处）代价远小于整集重播，也远小于丢学时。

---

### [BUG-PB-6] atEnd 的三个边界：提前触发 / 永不触发 / 平台 loop

**证据** `src/03-player.js:11, 36-41`：

```js
const END_RATIO = 0.995;
atEnd(v) {
  if (!v) return false;
  if (v.ended) return true;
  if (!this.hasValidDuration(v)) return false;
  return v.currentTime / v.duration >= END_RATIO;
}
```

**根因链**

1. **提前触发**：0.5% 的余量在长视频上是可观的（20 分钟视频 = 6 秒），若平台要求真正播到尾，`atEnd` 会在还剩几秒时就判定结束；叠加 `END_SETTLE_MS = 3000`（`05-scheduler.js:20`）通常够用，但慢网络下不够。
2. **永不触发**：`hasValidDuration` 要求 `Number.isFinite(duration) && duration > 0`。HLS/动态源把 `duration` 报成 `Infinity` 或元数据未加载时是 `NaN` → `atEnd` 永远 false → **永远不切下一节**（表现为卡死而非重播）。
3. **平台 loop**：若播放器自带循环（`video.loop` 或脚本自动 seek 回 0），`ended` **永远不会置位**（循环播放不触发 ended 事件），但 `currentTime/duration >= 0.995` 每一轮都会命中一次 → 每轮都触发 `onLessonEnd`；此时若读到进度 <100，脚本再 seek 回 0，与平台自身循环叠加，用户看到的就是"**反复重播**"。

**建议修法**

- 结束判定以 `ended` 为主，ratio 为辅，并要求"连续 2 次 tick 都满足 ratio"再认定结束；
- `duration` 非有限值时改用 `video.seekable.end(0)` 或等待 `durationchange`，超时后按"人工确认"处理；
- 检测到 `video.loop === true` 时主动关掉（`v.loop = false`），否则 ended 语义失效。

---

### [BUG-PB-7] 守卫 2 排在结束判断之前，且"结构可见"会漏判隐藏容器里的元素

**证据**

- `src/05-scheduler.js:15`：`const QUESTION_SELECTORS = '#playTopic-dialog, .topic-title';`
- `src/05-scheduler.js:168-202`：守卫 2 命中后 `return`，**结束判断（229 行）根本走不到**；
- `src/01-util.js:70-77` `isStructurallyVisible()`：只看自身 `display / visibility / opacity`。
  **关键**：`display:none` 不会改变子元素的 computed display。实测（jsdom，与浏览器语义一致）：
  ```
  父 #dlg display = none
  子 .topic-title display = "block" | visibility = "visible" | opacity = "1"
  按 isStructurallyVisible 判定为可见 = true → 守卫 2 会拦截
  ```
  也就是说，只要平台把弹题容器留在 DOM 里用 `display:none` 藏起来（Vue 常见写法），`.topic-title` 就会被判定为"存在且可见"。

**根因链**
弹题残留 → 每 2 秒 tick 都在守卫 2 处 `return` → 不保活、不结束判断、不切课 → **完全停摆**。
v0.2.1 里 `autoAnswer` 默认 `false`（`00-config.js:29`），走 else 分支只打日志，**永远出不来**。
v0.3.0 已改为"未开自动答题也主动关弹窗"（`05-scheduler.js:189-200`），且 `autoAnswer` 默认改为 `true`，风险大幅降低；但只要关闭失败，仍会 `return`，结束判断继续被推迟。

**建议修法**

- `isStructurallyVisible` 增加"是否真的在渲染树里"的判定：`el.offsetParent !== null || el.getClientRects().length > 0`（对 `position:fixed` 元素做例外处理）；
- 守卫 2 连续命中 N 次（比如 10 次 = 20 秒）后强制降级：不再阻塞结束判断，只打日志；
- 弹题选择器去掉过于宽泛的 `.topic-title`（它在作业页也用作题干，`08-questions.js:261`），只保留 `#playTopic-dialog`。

---

### [BUG-PB-8] 找不到下一节就 `stop()` 静默停手

**证据** `src/05-scheduler.js:310-315`：`还有 N 节未完成，但无法定位到可点击节点` → `this.stop()`。
**根因链**：目录识别偏差（比如所有条目都被判成 done/locked）→ 明明有未看完的课，脚本却直接停。
**建议修法**：停之前先 `Catalog.redetect()` 重试一次；仍失败再停，并把"目录快照前 5 条 + 各自状态"打进日志，方便用户反馈。

---

### [BUG-PB-9] 307 项全绿，但没有一条覆盖「结束 → 切课」链路

**证据**：`test/run.js` 全文检索 `onLessonEnd` / `retryFromPlatformProgress` / `_retryCount` / `_navigating` → **0 命中**；对调度层只有 3 条断言（`test/run.js:279-284`：`start` / `gotoNext` / `tick` 方法存在）。播放层只测了 `atEnd` 的纯函数边界（`test/run.js:216-220`），**没有测"atEnd 为真之后发生什么"**。

**根因链**：最容易出事的是"跨模块的时序与状态机"（锁、计数、进度读取），而测试只覆盖了纯函数 → 这个能让整条主线瘫痪的 bug 带着全绿测试上线。

**建议修法**：补 3 组集成用例（我用的 harness 可以直接改造成用例）：
1. 进度读不到（无 progressbar）→ 期望：切下一节，**不得**出现 `currentTime` 被拉回 0；
2. 进度读不到 + 重试上限 → 期望：最多 2 次重播后必须切走（`_navCount` 必须 +1）；
3. 切课后 video 元素复用且仍 ended → 期望：`_navCount` 在 15 秒内最多 +1（验证 BUG-PB-4 的闸门）。

---

## 四、对「ended 时信任视频结尾」策略的整体评估（team-lead 指定项）

策略原文：*progress 读到 0 或 current 为 null 时直接切下一节，只有读到 1~99 才回退重播；重播最多 2 次后强制切。*

**结论：策略本身正确，建议采纳；但必须配两个补丁才能上线。**

| 维度 | 评价 |
|------|------|
| 消灭主诉 | ✅ 实测有效：v0.2.1「重播 7 次 / 切课 0 次」→ v0.3.0「重播 0 次 / 切课 5 次」 |
| 重播上限 2 次 | ✅ 有效（配合 gotoNext 锁改造后，第 3 次能真正切走） |
| 误切风险（丢学时） | ⚠️ 真实存在：平台上报延迟时读到 0 会被当成"已看完"。建议加 8~15 秒复查 + `trustVideoEnd` 开关 + 总结报告计数 |
| 连跳风险 | ⚠️ 真实存在且更严重：见 BUG-PB-4，切课后必须确认新视频开播，否则约 12 秒跳一节、绕目录死循环 |
| 目录识别失败（cur=null） | ⚠️ `findNext(null)` 从头找第一个未完成，可能反复点第一集；建议"连续两次切到同一 lessonKey 就停手报警" |
| 用户可感知性 | ⚠️ 目前只有一行 warn 日志。建议面板状态区加一行"本节平台进度：未确认/xx%"，让用户能自己判断要不要回头补 |

**推荐的最终判定表**

| 读到的 progress | 含义 | 动作 |
|-----------------|------|------|
| `>= 100` 或 `.child-check` 出现 | 平台已记完成 | 立即切下一节 |
| `1 ~ 99` | 平台记了一部分 | 回退到 `progress% - 5s` 重播，累计 2 次后强制切 |
| `0`（条目找得到，值读不到/为 0） | 疑似上报延迟 | **等 8~15 秒复查一次**；仍为 0 则切，并计入"未确认即切"计数 |
| `cur === null` | 目录都没识别到 | 用 lessonKey 兜底；兜底也失败则切第一个未完成项，并打 warn（**不要** stop） |

---

## 五、与续播层（04-resume.js）的交互排查（team-lead 指定项）

结论：**续播不是本次"重播"的原因**，但有一处会被 BUG-PB-4 连带污染：

- `04-resume.js:58`：`time > duration - 10` 时不记录进度 —— 结尾 10 秒不写库，**设计正确**，不会把"结尾"当成续播点；
- `04-resume.js:124-128` `bindVideo()`：同一 video 重复绑定直接 return。切课后若 `_rebindAfterNav` 把**旧 video** 绑回来（BUG-PB-4），则 `_boundVideo === video` 成立 → **不会重新绑定**，续播记录会继续以**旧课时名**写入 → 下次打开会恢复到错误的课时/位置。
  → 修 BUG-PB-4 时同步确认：`gotoNext` 里 `ZHS.Resume.reset()`（`05-scheduler.js:337`）只重置了 `_restored` 标志，建议同时 `ZHS.Resume._detach()` 或在确认换源后再 `bindVideo`。
- `04-resume.js:221-223` `restore()`：`_restored` 一次性标志，只在 boot 跑一次，不参与结束判定，无冲突。

---

## 六、给其他子代理的提示

- **edge-cases**：请在真机/真页面上确认两件事 —— ① `.child-info.hasvideo` 条目内部到底有没有 `[role=progressbar][aria-valuenow]`（我方侦察报告标的是"课程级"）；② 切课后 `<video>` 元素是复用还是替换（决定 BUG-PB-4 是否致命）。
- **first-run**：用户第一次跑如果开着"未确认即切"，可能一上来连跳；建议首启引导里说明"平台进度未确认时会跳过，可在设置里关掉 `trustVideoEnd`"。
- **ux-walkthrough**：面板建议加一行"本节平台进度：xx% / 未确认"，否则用户无法判断学时是否到手。

## 七、附：本次只读诊断用到的临时文件（未写入项目）

```
C:\Users\Administrator\AppData\Local\Temp\zhs-pb\orig\     # v0.2.1 源码（git HEAD）
C:\Users\Administrator\AppData\Local\Temp\zhs-pb\v030\     # v0.3.0 源码快照
C:\Users\Administrator\AppData\Local\Temp\zhs-pb\probe2.js # 新旧对比：重播 vs 切课
C:\Users\Administrator\AppData\Local\Temp\zhs-pb\probe3.js # 连跳 / 目录识别失败场景
```

> 备注：诊断过程中 `src/05-scheduler.js`、`src/00-config.js`、`src/13-answerer.js`、`src/06-panel.js` 被队友并发修改（23:37~23:44 期间至少 3 次），本报告所有 v0.3.0 结论均基于 23:40 冻结的快照；若队友又改了这些行，请以最新代码重新核对行号。
