# 智慧树网课助手 —— 第三方机制拆解说明（面向维护者）

> 拆解对象：`C:\Users\Administrator\WorkBuddy\2026-09-17-21-07-36\zhihuishu-helper`
> 当前版本：`package.json` → `0.6.2`；源码 `src/` 16 个模块，共 6591 行
> 拆解方式：**只读通读 + grep 交叉验证**，未修改 `src/` 下任何文件，未执行 `node build.js`
> 用户报的故障：装上脚本后「自动跳转下一集」不生效、手动点「下一节」按钮也没反应、整体像没装一样

## 0. 阅读前的三条约定

1. **每条结论都带 `文件:行号`**，行号对应本文撰写时的工作区状态。
2. 结论按证据强度分三级标注：
   - **【确定】** —— 源码里能直接读出来，或能用 grep / 时间戳证伪。
   - **【看起来】** —— 逻辑上成立，但需要真实页面 DOM 才能坐实，源码里证不了。
   - **【无法判定】** —— 依赖平台线上行为，本地读码拿不到证据。
3. **一个必须先看的事实**：`src/` 下三个文件当前是**未提交的改动**（`git status` 显示 `M src/02-adapter.js`、`M src/03-player.js`、`M src/05-scheduler.js`，合计 +226 / -42 行）。而 `dist/zhihuishu-helper.user.js` 的构建时间是 **22:16**，这三个文件的修改时间是 **23:24 / 23:25 / 23:26**。也就是说——

   **【确定】产物比源码旧，且缺口正好是这三处修复。**

   验证方式（grep 计数，dist 中命中数为 0 即代表该段代码不在产物里）：

   | 标记 | 在 `src/` | 在 `dist/zhihuishu-helper.user.js` |
   |---|---|---|
   | `scoreAdapter`（02-adapter 新评分选举） | 有（02-adapter.js:195） | **0** |
   | `hostBonus`（02-adapter 域名加分） | 有（02-adapter.js:169） | **0** |
   | `clickAndVerify`（05-scheduler 点击验收） | 有（02-adapter.js:594） | **0** |
   | `NAV_COOLDOWN_MS` / `END_SETTLE_MS`（旧代码就有） | 有 | 2 / 2 |

   这一条会贯穿全文：下面第 4 节里很多「作者已经修好了」的点，**用户手上跑的那份可能根本没有**。

---

## 1. 整体运行机制：从注入到跳下一节

### 1.1 装配方式（先讲清楚，后面很多问题根在这）

`build.js` 把 `src/*.js` 按文件名字典序拼成一个文件（`build.js:40-42`），拼完后在最外层**再套一个 IIFE**（`build.js:67`：`` `(function () {\n'use strict';\n${body}\n})();` ``）。

于是最终产物是「一个大 IIFE 里平铺 16 个小 IIFE」。模块之间没有任何 `import/require`，全部靠 `window.ZHS` 这个全局命名空间互调（`00-config.js:280` 处 `window.ZHS = ZHS`）。

这个结构有两个必须记住的后果：

- **加载顺序 = 文件名顺序**。`00` → `01` → `02` → … → `13`。`07-main.js`（主入口）排在 `06-panel.js`、`06b-course-hub.js`、`06c-exam.js` **后面**，所以这些模块的自启动代码（如 `06b-course-hub.js:768-770` 的 1500ms 延时自启动、`06-panel.js:1339` 的 1500ms 刷新定时器）都跑在 `boot()` 之前。
- **任何一个模块顶层抛异常，后面所有模块都不会加载**。因为它们都是同一条执行流上的语句。`00-config.js` 里就专门防过这类事（`00-config.js:166-169`：怕 `JSON.parse` 出非对象值让 `saved.configRev` 抛 `TypeError`，"进而中断整份脚本"）。

### 1.2 主链路（文字版流程图）

```
油猴按 @match 注入（build.js:20-22：*.zhihuishu.com / *.polymas.com / *.zhihuishu.cn）
  │  @run-at document-idle（build.js:31）
  ▼
00-config.js 建立 window.ZHS（配置 + 日志 + state）
  ▼
01-util.js 挂 ZHS.Util（waitFor / isVisible / throttle / normText…）
  ▼
02-adapter.js 挂 ZHS.Catalog（目录读写 API）      ← 此时还没探测页面版本，惰性
03-player.js 挂 ZHS.Player                        ← 视频控制
04-resume.js 挂 ZHS.Resume                        ← 断点续播
05-scheduler.js 挂 ZHS.Scheduler                  ← 只挂对象，不启动
06-panel.js 挂 ZHS.panel + 起 1500ms 刷新定时器（06-panel.js:1339/1341）
06b-course-hub.js 挂 ZHS.CourseHub + 1500ms 后 onPageReady()（06b:768-770）
06c-exam.js 挂 ZHS.Exam + 2000ms 后起 3000ms 轮询（06c:787-796）
  ▼
07-main.js  ── DOMContentLoaded ──▶ boot()（07-main.js:15）
  │
  ├─(1) ZHS.Catalog.redetect()        → 02-adapter.js:295 → detect() 评分选举（02-adapter.js:263）
  ├─(2) state.courseId = getCourseId()（02-adapter.js:298-308，读 URL 参数 / hash）
  ├─(3) ZHS.panel.mount()             ← 故意放在等视频之前（07-main.js:28-31 注释：BUG-UX-2）
  ├─(4) await U.waitFor('video', 30000)（07-main.js:34）
  │      └─ 30 秒等不到 → 告警 + **直接 return，Scheduler 永不启动**（07-main.js:35-41）
  ├─(5) await ZHS.Resume.restore()    → 04-resume.js:224（读记录 → findByName → click → seek）
  ├─(6) state.lessonKey = 当前课时标题（07-main.js:49-50）
  └─(7) ZHS.Scheduler.start()         → 05-scheduler.js:61
  ▼
主循环 setInterval 2 秒一轮（05-scheduler.js:75）→ tick() → _tickInner()（05-scheduler.js:197/212）
  │
  │  每轮依次过四道守卫，命中任意一道就 return（本轮不再往下走）：
  ├─ 守卫① 验证码 .yidun_popup 等（05-scheduler.js:217）→ 暂停 + 最多等 120 秒（:227）
  ├─ 守卫② 弹题 #playTopic-dialog（05-scheduler.js:247）→ 暂停 + 交给 13-answerer.js
  ├─ 守卫③ 其他阻塞弹窗 .ss2077-custom-dialog（05-scheduler.js:319）→ 点一下关闭
  └─ 守卫④ 无 video 连续 ≥3 轮（05-scheduler.js:330-340）→ 当文档节点，gotoNext
  │
  ├─ 保活：checkStall（:343）→ setSpeed/mute/ensurePlaying（:345-349）
  │
  ├─ 冷却闸门：距上次切课 <15 秒 → 直接 return（05-scheduler.js:355-357）
  │
  └─ Player.atEnd(video)?（03-player.js:39）→ onLessonEnd()（05-scheduler.js:372）
        │ 先 sleep 8 秒等平台打勾（:376）
        ├─ isFinished(cur)（平台对勾）→ 跳下一节（:384-389）
        ├─ progress ≥ 95%          → 跳下一节（:394-399）
        ├─ progress ≤ 0            → 跳下一节（:402-407，宁可跳也不重播）
        ├─ progress < 90%          → 回退重播最多 2 次（:411-418）
        └─ 其余                     → 跳下一节（:422）
  ▼
gotoNext(reason)（05-scheduler.js:433）
  ├─ cur = Catalog.current()（02-adapter.js:344）
  ├─ bd  = Catalog.breakdown()（02-adapter.js:469）
  ├─ next = skipFinished===false ? _nextInOrder(cur) : Catalog.findNext(cur)（:453-455）
  ├─ next === null →
  │     ├─ bd.total === 0  → 告警「未识别到课程目录」+ stop()（:458-462）
  │     ├─ bd.undone === 0 → 若开了自动跳课 → markCourseDone + stop + returnToHub()（:466-473）
  │     └─ 否则            → 告警「定位失败」+ stop()（:476-481）
  ├─ 随机延迟 3~9 秒（:489-493，手动触发跳过）
  ├─ 停止复查：用户中途点了停止就取消（:501-504）
  ├─ state.lessonKey = 目标标题（:508）
  ├─ ★ Catalog.clickAndVerify(next)（02-adapter.js:594）← 2026-09-18 新增的「点了必须验收」
  │     └─ 失败 → _navFailCount++，累计 5 次 → stop()（:514-527）
  └─ 成功 → _navCount++ / _lastNavAt = now / 清空 videoEl（:531-541）
        └─ sleep 3 秒 → _rebindAfterNav()（:543-544）→ 重等 video 20 秒（:626-637）
```

### 1.3 跨课程那一层（`06b-course-hub.js`）

只在「本课程全学完」时被 `05-scheduler.js:466-473` 触发，链路是：

```
gotoNext 发现 bd.undone === 0
  → canHop = cfg.autoCourseHop && hub && !hub.isHubPage()（05-scheduler.js:467）
  → hub.markCourseDone(courseId)（06b:526）写进 doneCourses
  → this.stop()
  → hub.returnToHub()（06b:556）→ setIntent(courseId, '', 'auto-hop')（06b:566 写「授权凭证」）
  → location.href = HUB_URL（06b:569，硬编码 hike-teaching-center.polymas.com）
        ▼ 新页面（油猴按 @match 自动注入）
  → 1500ms 后 CourseHub.onPageReady()（06b:768-770）
  → isStudentPage() ? settleIntentOnStudentPage()（认领意图）
                     : 读 intent → **立刻 clearIntent()**（06b:724-726，"纸条用完就撕"）
  → 仅当 intent.via === 'auto-hop' 才 runOnHub()（06b:734-742）
  → collectCards() 边滚边收（虚拟滚动，06b:185）→ pickNext()（06b:353）
  → enterCourse()（06b:414）：先写 intent 再点卡片 → 平台 window.open 新标签
```

---

## 2. 页面结构适配机制：6 套适配器是怎么工作的

### 2.1 机制本体

`ADAPTERS`（`02-adapter.js:25-98`）是一张**静态选择器表**，每套页面给 7 个字段：`item`（条目）/ `active`（当前项）/ `finish`（完成标记）/ `title`（标题）/ `progress`（进度）/ `container`（容器）/ `locked`（锁定）。

`Catalog`（`02-adapter.js:286-622`）把这 6 套差异封装成一组与版本无关的方法：`items()` / `current()` / `isFinished()` / `statusOf()` / `findNext()` / `click()` / `hasActive()`。上层（`05-scheduler.js`、`04-resume.js`、`06-panel.js`）一律只调 `Catalog.*`，不碰选择器。

**识别过程（2026-09-18 改过，见 `git diff`）**：

- 旧版（`git diff` 里被删掉的那段）：`candidates()` 按域名返回一个**有序数组**，`detect()` 从头遍历，**第一个 `querySelector(ad.item)` 命中就算成功**。
- 新版：`candidates()`（`02-adapter.js:182-184`）返回固定顺序（只作同分 tie-break），`scoreAdapter()`（`02-adapter.js:195-212`）给每套打分，`detect()`（`02-adapter.js:263-281`）取最高分者。

打分规则（`02-adapter.js:195-212`）：

| 维度 | 分值 | 行号 |
|---|---|---|
| 能定位到「当前项」（`ad.active` 命中） | **+100** | :201 |
| 命中专属容器（`ad.container`） | +20 | :202 |
| 条目数 | 每条 +1，**30 封顶** | :200 |
| 条目能读出标题（文本长 2~80） | 每条 +2 | :205-209 |
| 域名加分 `hostBonus()` | 0 / 2 / 3 / 5 | :210 + :169-179 |

全部 0 分 → `siteVersion = 'unknown'`，**兜底返回 `ADAPTERS.wisdom`**（`02-adapter.js:278-280`）。

### 2.2 两道兜底

1. **展开折叠树**：`expandTreeOnce()`（`02-adapter.js:233-244`），每次 `items()` 前先把 `.el-tree-node__expand-icon:not(.is-leaf)` 里没展开的全点开（节流 2 秒）。理由写在注释里：折叠中的课时根本不在 DOM 里，取不到也点不到。
2. **结构兜底扫描**：`sniffItems()`（`02-adapter.js:111-152`），当所有预设 `item` 选择器都落空时启用（`02-adapter.js:330-339`）。它不认类名，只按「结构特征」捞：父子分组后，同构兄弟 ≥3 个、标签名+class 前两段的签名不超过 2 种、文本长度 2~80、排除「登录/注册/首页/我的/设置/退出」。

### 2.3 什么情况下会认错

按可能性从高到低：

**(a) `active` 全落空时，选举退化成「比谁的选择器更宽泛」——【看起来】**

`+100` 那一条是整套评分里唯一有压倒性权重的信号。它的前提是页面上真的存在「当前项」。但目录刚展开、视频还没开播、或平台压根不用 class 标当前项时，6 套的 `ad.active` 会**同时落空**，此时总分上限变成 `30 + 20 + 60 + 5 = 115`，条目数和标题数主导结果。而 `polymas` 那套（`02-adapter.js:86-97`）用的是 `[class*="course-node"]`、`[class*="chapter-item"]`、`[class*="lesson-item"]`、`[class*="title"]` 这类**子串通配**，在任何页面上比 `.child-info.hasvideo`、`.clearfix.video` 这种精确类名更容易凑到条目数。**【看起来】**它有可能靠宽泛选择器抢到最高分；我无法从源码证明它在真实页面上确实赢过，因为仓库里的 `reference/live/*.html` 抓到的其实是**登录中心页**（`rendered-stuStudy.html` 的 `<title>` 是「登录中心」），拿不到登录后真实目录 DOM 来实测。

**(b) 打分用的是「全页面」而非「目录区域」——【确定】**

`scoreAdapter` 里三处 `querySelectorAll/querySelector`（`02-adapter.js:197/201/202`）都在 `document` 上跑，没有限定在目录容器内。所以「页面别处碰巧有同名节点」依然能贡献分数，只是从旧版的「1 个就赢」变成了「多加分」。旧版那个 bug 的成因作者自己写在 `02-adapter.js:256-262` 的注释里。

**(c) 6 套都是硬编码类名，平台改版即失效——【确定】**

`ADAPTERS` 里没有一个字段是从平台接口拿的，全是字符串常量。失效后走 `sniffItems()`，而 `sniffItems` 的准入条件（≥3 同构兄弟、文本 2~80 字）在真实页面上**最容易捞到的是导航项、Tab 页签、课程卡片这类成组元素，而不是课时列表**。**【看起来】**（无真实 DOM 可证）。一旦捞错，`findNext()`（`02-adapter.js:493-513`）会返回一个根本不是课时的节点，`Catalog.click()`（`02-adapter.js:566-582`）对它 `el.click()` 一次，`clickAndVerify()` 等 3 秒没看到 active 就再点一次，两次都失败 → 上层计数 → 5 次后停机（详见 3.4）。这就是「点了没反应」最典型的形状。

**(d) 完成标记判定过宽，可能把「没看完」判成「已看完」——【看起来】**

`isFinished()` 第 2 步（`02-adapter.js:385`）用的是：

```
[class*="finish"], [class*="done"], [class*="complete"], [class*="learned"],
[class*="studied"], [class*="checkmark"], [class*="is-finish"]
```

这是 v0.6.2 为了「右侧栏对勾类名有出入也能认」专门加的兜底（CHANGELOG `0.6.2` 条目）。代价是**任意后代元素命中即判完成**。若平台在课时节点里放了任何 class 含这些子串的元素（比如容器叫 `lesson-complete-wrapper`），该节会被误判 `done`。后果：`findNext()` 跳过它（`02-adapter.js:497`），`breakdown().undone` 变小，**归零后直接触发 `05-scheduler.js:466-473` 的「本课程学完 → 回课程中心」**。

**(e) 目录缓存没有失效机制——【确定】**

`Catalog._ad` 一旦探测成功就缓存（`02-adapter.js:289-292`），只有显式调 `redetect()`（`02-adapter.js:295`）才清空。全项目只有一处调用 `redetect()`：`07-main.js:22`，即 `boot()` 的开头。而 `boot()` 有 `initialized` 守卫（`07-main.js:13/16`）**只跑一次**。`watchSpa()`（`07-main.js:63-84`）在 DOM 变化后只重新绑定 video，**不重新探测页面版本**。所以 SPA 切到另一套页面结构后，`Catalog` 会一直用旧适配器。

---

## 3. 「跳下一节」到底依赖哪些信号

按链路顺序列出，`★` 表示这一条是**不可靠信号**。

| # | 信号 | 取值位置 | 可靠性 | 说明 |
|---|---|---|---|---|
| 1 | `@match` 命中 | `build.js:20-22` | 中 | 只覆盖 3 个域名；`hike-teaching-center.polymas.com` 能覆盖，但平台若上到新域名就完全不注入 |
| 2 | 页面存在 `<video>` | `07-main.js:34` | 中★ | 等不到就 `return`，**主循环永不启动**（`07-main.js:35-41`）。若视频在 iframe 里，`document.querySelector('video')` 永远为 null |
| 3 | `location.hostname` | `02-adapter.js:169-179` | 中 | 作者已从「硬路由」降级为「加分项」，最高只给 5 分 |
| 4 | 各套 `item` 选择器命中数 | `02-adapter.js:197-200` | **低★** | 在 `document` 全页面统计，非目录节点也计分 |
| 5 | 各套 `active` 命中（+100） | `02-adapter.js:201` | **关键但脆★** | 唯一的压倒性信号；一旦全落空，选举退化成比宽度（见 2.3a） |
| 6 | 各套 `container` 命中（+20） | `02-adapter.js:202` | 低 | `legacy` 的 container 是 `.clearfix`（`02-adapter.js:70`），这是个通用清除浮动类，几乎处处命中 |
| 7 | 条目文本长度 2~80 | `02-adapter.js:205-208` | 低 | 只防「空壳节点」，不防「捞错节点」 |
| 8 | `sniffItems()` 结构兜底 | `02-adapter.js:111-152` | **最低★** | 极易捞到导航/页签/卡片而非课时 |
| 9 | `video.duration` 有限且 > 0 | `03-player.js:33-36` | 中★ | `atEnd()` 在 `duration` 为 `NaN`/`Infinity` 时（`:42`）**直接返回 false**，只有 `v.ended` 为 true 才认结束。若播放器不置 `ended`，就永远判「没看完」 |
| 10 | 平台完成标记（对勾/文字/100%） | `02-adapter.js:376-396` | **金标准但有宽度问题★** | 见 2.3d |
| 11 | 平台进度 `_readProgress()` | `02-adapter.js:399-410` | 中★ | 读 DOM 文本或 `aria-valuenow`；读不到返回 0，而 0 会被 `onLessonEnd` 的第 3 分支当成「已放完」直接跳（`05-scheduler.js:402-407`） |
| 12 | `hasActive()` class 白名单 | `02-adapter.js:539-555` | **低★** | 点击后的验收只认 `active / current_play / current-play / current / is-active / selected / playing` 这 7 个词（`:546`），外加适配器 `active` 选择器。平台用别的词就**判失败** |
| 13 | `state.lessonKey`（标题文本） | `00-config.js:249`、`05-scheduler.js:508` | 中 | SPA 重渲染后靠 `findByName()`（`02-adapter.js:521-530`）重定位，标题有微小差异就定位不到 |

### 3.1 三个时间闸门（都会让「跳」被推迟）

| 闸门 | 值 | 位置 | 作用 |
|---|---|---|---|
| `END_SETTLE_MS` | 8 秒 | `05-scheduler.js:27`，用于 `:376` | 判定结束后先睡 8 秒等平台打勾 |
| `NAV_COOLDOWN_MS` | 15 秒 | `05-scheduler.js:31`，用于 `:355-357` | 刚切完课不做结束判定，防旧 video 的 `ended` 态导致连跳 |
| 随机延迟 | 3~9 秒 | `05-scheduler.js:490` | 拟人；手动触发跳过（`05-scheduler.js:494-496`） |

所以「视频放完 → 真正跳走」最快也要 **8 + 3 ≈ 11 秒**，慢的时候 8 + 9 = 17 秒；切完课之后还有 15 秒冷却不做判定。

### 3.2 两个**声明了但没接上**的闸门——【确定】

- `PROGRESS_RECHECK_MS = 10000`（`05-scheduler.js:33`，注释写"读到 0% 时先复查一次再决定切"）—— 全项目 grep 只有这一处声明，**没有任何地方使用**。
- `BLOCK_GUARD_MAX_TICKS = 15`（`05-scheduler.js:41`，注释写"阻塞弹窗连续点不掉的轮数上限"）—— 同样**只有声明，守卫③（`05-scheduler.js:319-326`）里没有引用**。

这两条是设计上写了、实现上漏了的闸门。

### 3.3 一层额外的风险：`autoCourseHop` 默认开

`00-config.js:70` 里 `autoCourseHop: true`，且它在 `FORCE_UPGRADE`（`00-config.js:137-141`）里被强制推给老用户。于是 `gotoNext` 里 `bd.undone === 0` 的分支（`05-scheduler.js:466-473`）会**直接把页面导航到课程中心**（`06b-course-hub.js:569` 的 `location.href = HUB_URL`）。

也就是说：**只要目录被误判成「全看完了」，用户点「下一节」的后果不是「没反应」，而是页面跳走**。这条和「手动点下一节也没反应」的观感冲突，所以更可能的情况是走 `bd.total === 0` 分支（`05-scheduler.js:458-462`）——弹 error + `stop()`。

### 3.4 失败即停机的机制

`gotoNext` 里 `clickAndVerify` 返回 false 时（`05-scheduler.js:514-527`）：

```
_navFailCount++  →  ≥ SAME_NAV_MAX(5)  →  Log.error + panel.alert + this.stop()
```

`stop()`（`05-scheduler.js:166-176`）会置 `_halted = true`。此后：
- **自动**：`start()` 在 `_halted` 且非 manual 时直接忽略（`05-scheduler.js:64-67`），主循环不会自己起来。
- **手动**：`gotoNext()` **不检查 `_halted`**，所以面板「下一节」还能再调，但每次都会重新走一遍失败路径、重新 `stop()`。用户看到的就是「点了没反应 / 弹个提示就没了」。

**这就是「整体像没装一样」最可能的收敛形态**：前 5 次失败之后，脚本彻底不动了，只剩面板 1500ms 的刷新定时器还在转。

---

## 4. 最可能让「自动跳下一集失效」的 3 个根因（按可能性排序）

### 根因 ①：用户手上跑的产物是**旧构建**，三个修复全都不在里面 ——【确定】

**证据**：
- `dist/zhihuishu-helper.user.js` 修改时间 **22:16**；`src/02-adapter.js` **23:24**、`src/05-scheduler.js` **23:25**、`src/03-player.js` **23:26**。
- `git status`：`M src/02-adapter.js`、`M src/03-player.js`、`M src/05-scheduler.js`（+226 / -42 行未提交）。
- dist 中 `clickAndVerify` / `scoreAdapter` / `hostBonus` 的 grep 计数均为 **0**。

**为什么它能解释用户报的全部三个现象**：旧代码里 `gotoNext` 是 `cat.click(next); ` 一条语句（`git diff` 中被替换掉的那行），**点完就走、不验收**；而失败计数是**在点击之前**自增的（`git diff` 中被删除的 `:483-500` 段），注释里作者自己也写了问题：*"点击前自增会把「还没点」也算成一次失败，且目标一变就清零"*。旧代码一旦点击不生效，`Catalog.current()` 拿不到新项 → `findNext` 恒返回同一节 → 计数收敛到 5 → `stop()`，之后自动跳课全死、手动点也只是重复失败。

同时，旧 `retryFromPlatformProgress`（`git diff` 中被替换的 `03-player.js` 那一行 `const back = Math.max(0, target - 5);`）在平台记录 0% 时 `back = 0`，**等于把视频退回片头整节重播**。作者在替换它的注释里（`03-player.js:149-154`）明确写了：*"用户被死死卡在这一节，表现出来就是「永远跳不到下一集」"*。这句和用户报的现象一字不差。

**置信度**：产物陈旧是**确定**的；「因此用户跑的是旧逻辑」是**确定**的（时间戳 + grep）；「旧逻辑必然导致该现象」是**看起来**（需要用户在真机上确认装的是哪个文件）。

### 根因 ②：目录 / 当前项定位信号全部是「猜 DOM」，`active` 一旦落空整条链就散 ——【确定】

**证据链**：
- `detect()` 的评分里唯一压倒性信号是 `ad.active` 命中 +100（`02-adapter.js:201`）。
- `findNext(cur)`（`02-adapter.js:493-513`）用 `all.indexOf(fromEl)` 定位当前位置；`fromEl` 来自 `Catalog.current()`（`02-adapter.js:344-353`），它先 `querySelector(ad.active)`，取不到才退化成按 `state.lessonKey` 文本匹配。
- **两者取不到** → `startIdx = 0`（`02-adapter.js:499-503`）→ 永远从第 1 节开始找 → 若第 1 节因 `isFinished`/`isLocked` 被判为不可点，就会反复把同一个第 1 节当目标 → `_navFailKey` 恒等 → 5 次停机。
- 目录取不到时先走 `expandTreeOnce()`（`02-adapter.js:318`），再走 `sniffItems()`（`02-adapter.js:331`），后者捞错的概率很高（2.3c）。
- `05-scheduler.js:458-462`：`bd.total === 0` → 弹「未识别到课程目录」+ `stop()`。

**为什么它是最结构性的一条**：整条跳课链没有任何一个信号来自平台接口（没有 XHR 拦截、没有读 `window.__INITIAL_STATE__` 之类），全是 DOM 文本/类名的模式匹配。平台改一次版，链路从第 2 步就断了，后面保活、结束判定、点击验收写得再好也没用。

**置信度**：「链路完全依赖 DOM 猜测」是**确定**的；「本次故障就是它触发的」是**看起来**（缺真实 DOM 证据）。

### 根因 ③：点击后的验收白名单太窄 + 「5 次即停机」的兜底太狠 ——【看起来】

**证据链**：
- `clickAndVerify()`（`02-adapter.js:594-614`）点完必须等目标拿到 active，拿不到就再点一次，两次都失败返回 false。
- 验收函数 `hasActive()`（`02-adapter.js:539-555`）只认三类：① 自身 class 在 `active / current_play / current-play / current / is-active / selected / playing` 这 7 个词里（`:546`）；② 匹配 `ad.active` 选择器（`:549`）；③ 页面唯一当前项就是它（`:551-552`）。
- 返回 false 后 `05-scheduler.js:514-527`：计数 → 5 次 → `this.stop()`。

**风险形状**：这是一次**把「点了就走」改对了的修正**（方向完全正确），但它把「切课成功与否」的唯一判据压在一个 7 词白名单上。如果平台用 `is-current` / `cur` / `on` / `router-link-active` 之类标记当前项，就会**实际切成功了却判失败**，累计 5 次后彻底停机。这比旧代码「点了就走」更糟：旧代码最多是跳错，新代码是直接停手。

同理，`_navigating` 锁（`05-scheduler.js:443/546`）在 `onLessonEnd` 执行期间（含 8 秒 `END_SETTLE` + 最长 9 秒随机延迟）一直为 true，此时用户手动点「下一节」会被 `:438-442` 挡下，只弹一句「正在切换课时中，请稍候」。这也是一种「点了没反应」。

**置信度**：**看起来**。我无法从源码证实平台当前用什么 class 标当前项；仓库里 `reference/live/` 抓到的 HTML 是登录页，没有真实目录 DOM。

---

## 5. 读完觉得写得挺好、值得原样保留的地方

按「值钱程度」排：

1. **`_withBudget()`（`05-scheduler.js:183-194`）** —— 给所有外部异步动作（作答、关弹窗）统一套总预算，`Promise.race` 超时就返回 false。注释把动机写透了：*"一个没响应的 promise 就能把整个调度器吊死"*。守卫①②③全部走这一层。这是这类常驻脚本最容易翻车的地方，作者防住了。

2. **「点了必须验收」+ 节点被 SPA 换掉后按标题重定位（`02-adapter.js:594-614`）** —— `clickAndVerify` 里 `if (!target.isConnected)` 之后 `findByName(titleKey)` 再点（`:606-610`），考虑到了 Vue 重渲染会 detach 节点。方向是对的，只是验收白名单要放宽（见根因③）。

3. **`expandTreeOnce()`（`02-adapter.js:233-244`）** —— 取目录前先把折叠章节点开，配 2 秒节流。这条直击「折叠中的课时不在 DOM 里」这个真实痛点，而且是很多同类脚本没有的。

4. **`onPageReady()` 的「纸条用完就撕」（`06b-course-hub.js:705-746`）** —— 进课程中心先 `getIntent()` 再**无条件** `clearIntent()`（`:724-726`），然后才判断要不要动手。把「读凭证」和「消费凭证」解耦，杜绝僵尸意图。注释里把旧版「开关判断放在读意图之后 → 意图永远清不掉」的坑写得很清楚。

5. **`enterCourse()` 的「宁可返回 true 也不误判 false」（`06b-course-hub.js:466-484`）** —— 明确写了不能用 `isHubPage()` 判断跳转成功与否（因为 window.open 开新标签，当前页恒在中心页），并给出理由：*"宁可返回 true（不动），也不误判成 false（误拉黑）"*。这种对「失败侧代价不对称」的考量很专业。

6. **`toBool()` 的保守归一（`00-config.js:104-113`）** —— 仅 `'true'`/`'1'` 及非 0 数字为真，其余一律假，理由是 `!"false"` 恒为 false 会把用户以为关掉的开关偷偷打开。而且 `autoExam` 故意**不**放进 `FORCE_UPGRADE`（`00-config.js:142-145`），因为强推等于偷偷打开自动答题。安全侧的取舍做得很干净。

7. **`retryFromPlatformProgress()` 的三道闸（`03-player.js:155-161`）** —— `target <= 0` 直接放弃、`tailFloor` 防止一退退回片头、结果必须落在有效区间。三条都是针对「回退重播」这个具体 bug 的，注释把旧写法为什么错写明白了。

8. **`bindVideo()` 的 `bindId` 防串台（`04-resume.js:127-141`）** —— 用绑定序号让监听器只认「当前这一次」的绑定，修的是「重复调用覆盖了节流函数导致进度永远存不下来」这个极隐蔽的 bug，注释里有完整复现过程。

9. **`build.js` 的构建自检（`build.js:69-78`）** —— 模块级 IIFE 数少于模块数就 `exit(1)`。这是因为 0.6.1 出过「把模块内联进大 IIFE → 顶层 `return` 语义变了 → 重入守卫全部失效」的结构性事故（CHANGELOG `0.6.1`），作者把教训固化成了构建期断言。同类项目很少见。

10. **`finishAll()` 的标题不撒谎（`05-scheduler.js:602-606`）** —— 按 `未完成` 是否为 0 动态决定写「全部课程已看完」还是「运行已结束（仍有 N 节未完成）」，并注明这是修 BUG-UX-15。

11. **`isFinished()` 注释里点破递归风险（`02-adapter.js:393`）** —— 第 4 步特意直读 `_readProgress()` 而不调 `progressOf()`，一句注释避免了 `isFinished ↔ progressOf` 的死递归。这种注释很值钱。

---

## 6. 附：顺手记下的疑点（都标了强度，未经真机验证）

| # | 位置 | 疑点 | 强度 |
|---|---|---|---|
| 1 | `05-scheduler.js:33` / `:41` | `PROGRESS_RECHECK_MS`、`BLOCK_GUARD_MAX_TICKS` 声明后未使用，两个闸门没接上 | 确定 |
| 2 | `08-questions.js:111` | `present()` 的判定里有裸的 `ul li`——任何列表都能命中；且 `root()`（`:94-103`）会 fallback 到 `#tmDialog_iframe`，不校验弹窗是否真的在显示。若页面上存在常驻的 `tmDialog_iframe`，`present()` 可能恒为 true，进而让 `_pendingHuman` 在 `05-scheduler.js:243` 永远复位不了 | 看起来 |
| 3 | `02-adapter.js:70` | `legacy.container = '.clearfix'`，这是个通用清除浮动类名，容器 +20 分几乎白送 | 确定 |
| 4 | `07-main.js:63-84` | `watchSpa()` 只重绑 video，不调 `Catalog.redetect()`；SPA 跨版本切页后适配器不会更新 | 确定 |
| 5 | `05-scheduler.js:330-340` | 无 video 连续 3 轮就 `gotoNext`（:336）。若视频在 iframe 里，会周期性触发跳课 | 看起来 |
| 6 | `06-panel.js:1339` | 面板 1500ms 刷新定时器在模块顶层无条件启动，且 `ZHS.panel = Panel` 在它**之后**（:1341）才赋值。若 `refresh()` 内部依赖 `ZHS.panel` 之外的东西出问题，定时器会一直抛 | 看起来 |
| 7 | `02-adapter.js:546` | `hasActive` 判定时读 `el.className.baseVal`（SVG 场景）后直接 `split(/\s+/)`；若 `className` 是对象但无 `baseVal`（罕见），会走进 `String(object)` 得到 `[object SVGAnimatedString]` | 确定（代码路径存在），但实际触发概率低 |
| 8 | `06b-course-hub.js:28` | `HUB_URL` 硬编码 `hike-teaching-center.polymas.com`，平台换域名即失效 | 确定 |
| 9 | `00-config.js:70` | `autoCourseHop` 默认 true 且被 FORCE_UPGRADE 强推，配合 `05-scheduler.js:466-473` 会在「目录误判为全完成」时直接把用户导航走 | 确定（机制），是否发生取决于目录识别 |

---

## 7. 维护者排查建议（不改动代码的前提下）

1. **先确认产物**：`grep -c clickAndVerify dist/zhihuishu-helper.user.js`，为 0 说明用户装的是旧构建，先 `node build.js` 再说别的。这是本文唯一一条「不改代码就能立刻验证」的排查动作。
2. **拿到真实目录 DOM**：仓库里 `reference/live/*.html` 抓到的都是登录中心页（`rendered-stuStudy.html` 的 `<title>` 为「登录中心」），**没有任何一份登录后真实目录 DOM**。第 2 节里所有标【看起来】的结论，都卡在这一份证据上。
3. **看日志里的识别结果**：新版 `detect()` 会打一行「页面版本识别为：X（x），评分 N；候选评分 a=1 / b=2 …」（`02-adapter.js:274-275`），这行是判断根因②最快的依据。若日志里没有这行，说明跑的是旧构建（回到第 1 条）。
