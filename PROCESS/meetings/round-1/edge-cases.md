# 异常与容错走查报告（edge-cases · round-1）

> 走查对象：`C:\Users\Administrator\WorkBuddy\2026-09-17-21-07-36\zhihuishu-helper`
> 代码基准：工作区 `src/` 当前版本 **v0.3.0**（`src/00-config.js:124`），含本轮对 `00-config.js`、`05-scheduler.js` 的未提交改动
> 走查方式：静态读码 + jsdom 复现（不改动任何项目文件）
> 结论一句话：用户说的「停住」**能定位到具体代码路径**，根因是**弹题关闭失败后签名永不清除 → 永不重试**，叠加**视频已暂停 + 主循环空转**；另有 11 条次生卡死/静默失效路径。

> ⚠️ **时效说明**：走查期间 `src/` 正在被并行修改（`00-config.js`、`05-scheduler.js`、`06-panel.js`、`13-answerer.js` 均已变更）。本报告的编号结论在我复核时点成立；**第七章是我在最新代码上的二次复核**，请优先看第七章。

---

## 一、结论速览

| 编号 | 严重度 | 一句话 | 是否就是用户说的「停住」 |
|---|---|---|---|
| BUG-EC-1 | **P0 致命** | 弹题关闭失败后 `_lastDialogSig` 不清空 → 退避结束后仍被「签名未变」挡住 → **永不重试** | ✅ **主因** |
| BUG-EC-2 | **P0 致命** | 老用户配置里残留 `autoAnswer:false`，新默认值救不回来 → 弹题永久停手 | ✅ 强候选 |
| BUG-EC-0 | **P0 交付** | 打包产物 `dist/` 还是旧版，本轮修复用户根本装不到 | —（但决定修复能否生效） |
| BUG-EC-3 | P1 | 守卫2 误触发（`.topic-title` 复用）→ 视频暂停且**零告警** | 候选 |
| BUG-EC-4 | P1 | 退避 30~180 秒 + 主循环被 15 秒 wait 阻塞 = 用户视角「卡死几分钟」 | ✅ 放大现象 |
| BUG-EC-5 | P1 | 守卫1 的 `waitUntilHidden` 没传超时，默认 **600 秒**，一次 tick 卡 10 分钟 | 候选 |
| BUG-EC-6 | P1 | 守卫3 关不掉时每 2 秒空转，无计数/无告警/无放弃 | 候选 |
| BUG-EC-7 | P1 | 答题把网络 IO 放进主循环 await，单题最长阻塞约 **102 秒** | 放大现象 |
| BUG-EC-8 | P2 | 判断题在弹题路径被静默跳过（不点任何选项） | 静默失效 |
| BUG-EC-9 | P2 | 无选项时 Solver 返回 null → 不作答直接关弹题 | 静默失效 |
| BUG-EC-10 | P2 | 切课点击不生效 → 反复点同一条目，无重试上限 | 死循环（不推进） |
| BUG-EC-11 | P2 | `waitUntilHidden(...,15000)` 返回 false 后无任何后续动作 | 空转 |
| BUG-EC-12 | P3 | iframe 弹题：检测与处理两套选择器不一致 | 漏处理 |

**本轮已修好、不用再动的（我核对过逻辑）**：`gotoNext` 的重入吞调用（现在用 `owned` 锁归属，`05-scheduler.js:263-273`）、`_rebindAfterNav` 未 await（现在已 await，`:328`）、平台进度读到 0 时不再重播（`:237-244`）。这三条我原本怀疑是死锁，现在确认已解决。

---

## 二、用户「停住」的根因链（先讲人话）

脚本的主循环是**每 2 秒跑一次**的（`05-scheduler.js:19 LOOP_INTERVAL = 2000`），每次跑的时候先看屏幕上有没有「挡路的东西」，顺序是：验证码 → **弹题** → 其他弹窗。

碰到弹题时（`05-scheduler.js:169-188`）会做三件事：
1. **先把视频暂停**（`:170`）；
2. 交给答题器去答 + 关闭（`:173`）；
3. `return` —— **本次循环到此结束，播放、切课、保活统统不做**（`:187`）。

也就是说：**只要弹题还在屏幕上，视频就永远是暂停的，主循环就永远只做「看看弹题还在不在」这一件事。** 这本身不是 bug（弹题挡着确实该停），问题在于「弹题一旦处理失败，就再也没有第二次机会」——下面就是那条断掉的路。

---

## 三、逐条发现

### [BUG-EC-1] 弹题关闭失败后，签名永不清除 → 退避形同虚设 → 永久卡死

**证据**
- `src/13-answerer.js:38` `this._lastDialogSig = sig;` —— 处理**之前**就把签名写死了
- `src/13-answerer.js:92` `this._lastDialogSig = '';` —— **只有关闭成功**才清空
- `src/13-answerer.js:102-107` 失败路径只做 `this._failCount++` 和设置 `_cooldownUntil`，**不清签名**
- `src/13-answerer.js:34-37` `if (sig && sig === this._lastDialogSig) { ...return; }` —— 下一轮进来直接被挡
- `src/13-answerer.js:44-47` 若 `_answerDialog` 抛异常，`finally` 只清 `_running`，**签名同样留着**
- `src/05-scheduler.js:170` 视频已暂停；`:187` 直接 return

**卡死场景链**
弹题出现 → 视频暂停 → 作答成功 → 点关闭没生效（比如按钮选择器没命中）→ 3 次重试共约 4.2 秒 → 进入退避 30 秒 → **退避期间 handleDialog 被 `_cooldownUntil` 挡住**（`:22-26`）→ 退避结束后进来，被 **签名相同** 挡住（`:34`）→ 弹题一直在、视频一直暂停、主循环每轮再做一次 15 秒的 `waitUntilHidden`（`:180`）→ **无限循环，用户看到的就是彻底停住**。且日志里会反复出现「弹题签名未变，跳过重复处理」，看起来像"脚本在正常工作"，极具迷惑性。

**实测（jsdom 复现，3 轮主循环）**
```
第1轮：本轮占用 20761ms，退避剩余 15s，_lastDialogSig="[\"关不掉的题\"]"
第2轮：本轮占用 15331ms，退避剩余 -15s，_lastDialogSig="[\"关不掉的题\"]"   ← 退避已结束
第3轮：本轮占用 15310ms，退避剩余 -15s，_lastDialogSig="[\"关不掉的题\"]"   ← 仍然没重试
Solver.solve 调用次数 = 0（第 2 轮起）
```
**关键**：第 1 轮就吃掉主循环 20.7 秒，之后每轮 15.3 秒，且**再也不会重新答题**。

**建议修法（按兜底优先级）**
1. **失败即清签名**：`closeDialogAndResume` 返回 false 时立刻 `this._lastDialogSig = ''`，让退避真的能重试。这是最小改动、收益最大的一条。
2. **异常也清**：`handleDialog` 的 `catch` 里同样清空签名，避免一次 DOM 报错就永久锁死。
3. **给失败上限**：`_failCount >= 3`（约 3 轮退避后）不再挣扎，做二选一兜底 —— ① `gotoNext` 直接跳过本节（用户诉求是「看完就下一集」），或 ② `stop()` + 面板红色告警「弹题无法自动关闭，请手动点掉」。**不能停在"既不动也不说"的状态。**
4. 退避期间不要 `await waitUntilHidden(15000)` 阻塞主循环（见 BUG-EC-4）。

---

### [BUG-EC-2] 老配置残留 `autoAnswer:false`，新默认值救不回来 → 弹题永久停手

**证据**
- `src/00-config.js:29` `autoAnswer: true,` —— 本轮已把默认改成开
- `src/00-config.js:59` `return Object.assign({}, DEFAULTS, saved);` —— **已存盘的配置优先于新默认值**
- `src/05-scheduler.js:183-186` 未开自动答题时的 else 分支：只打一条 `debug` 日志 + 面板提示，然后 `return`
- `src/05-scheduler.js:170` 视频**已经先被暂停了**

**卡死场景链**
老用户（装过 0.2.x）的 `GM_setValue('zhs-helper-config')` 里存着 `autoAnswer:false` → 升级到 0.3.0 后 `Object.assign` 让旧值胜出 → 弹题出现 → 视频被暂停 → 每次循环只走 else 分支 → **永久停住**。用户完全不知道为什么，因为面板提示只有一句「未开启自动答题」，而视频是黑的。

**实测**
```
新装默认 autoAnswer = true
老配置残留后 autoAnswer = false   ← DEFAULTS 改了也救不回来
```

**建议修法（按兜底优先级）**
1. **配置版本迁移**：存一个 `configVersion`，升级时把「本次上调过默认值的键」强制刷成新默认（至少要迁移 `autoAnswer` / `autoCloseDialog`）。
2. **else 分支也要兜底**：没开自动答题时，**不要暂停视频**（直接让用户看，或者按平台逻辑继续播），至少不能"暂停 + 什么也不做"。更贴合用户诉求的做法是：给 10 秒倒计时，倒计时内没人工处理就自动点掉弹题继续播（弹题不答通常也能继续）。
3. 把这条提示从 `debug` 提到 `warn` 并常驻面板，别让用户看不出来。

---

### [BUG-EC-0] 打包产物没重新构建，本轮修复用户装不到

**证据**
- `dist/zhihuishu-helper.user.js:52` 仍是 `autoAnswer: false`
- `grep -c "stopMode" dist/zhihuishu-helper.user.js` → **0 次**；`_completedThisRun` 也搜不到
- 说明：本轮对 `src/00-config.js`、`src/05-scheduler.js` 的改动**尚未 `node build.js`**

**影响**：用户从 `install.html` 安装的是 `dist/` 里的旧脚本，所以「autoAnswer 默认开」「停止条件」「gotoNext 重入修复」这些**现在全都还没生效**。用户反馈的「停住」很可能就是在旧版上发生的。

**建议**：改完先 `node build.js && node test/run.js`，并把 `dist` 的构建时间/版本号写进总结，避免"改了但没交付"。

---

### [BUG-EC-3] 守卫2 误触发：`.topic-title` 被作业页复用 → 视频暂停且零告警

**证据**
- `src/05-scheduler.js:15` `QUESTION_SELECTORS = '#playTopic-dialog, .topic-title'`
- `src/08-questions.js:123` 弹题题干用 `.topic-title`；**但** `:261` 作业页题干也用 `.topic-title` —— 同一个类名两套场景
- `src/13-answerer.js:28-29` `const root = ZHS.Questions.Dialog.root(); if (!root) return;` —— 拿不到容器就**静默返回**
- `src/05-scheduler.js:174` `stillPresent()` 此时为 false，不会进 15 秒等待，tick 直接 return

**卡死场景链**
页面里存在任何非弹题的 `.topic-title`（作业区残留、隐藏的题目模板等）→ 守卫2 命中 → **视频被暂停** → `handleDialog` 拿不到 root 直接返回 → 日志只有一条 `debug`（`05-scheduler.js:184`）→ 每 2 秒重复一次，**永远不放开**。

**实测**
```
守卫2 触发 = true
Dialog.root() = null        （→ handleDialog 第29行直接 return）
Dialog.stillPresent() = false（→ 不会进 15s 等待，tick 直接 return）
视频被暂停 = true            （→ 没有任何 warn 以上日志，静默卡住）
```

**建议修法（按兜底优先级）**
1. **判定口径统一**：守卫2 改用 `ZHS.Questions.Dialog.present()`（它会查 iframe，且与采集层同源），不要用裸选择器。
2. **`root()` 为 null 时不要暂停**：拿不到容器 == 不是弹题，应当放行主循环。
3. 加 `Log.warn` + 面板告警，别让"静默暂停"存在。

---

### [BUG-EC-4] 退避 30~180 秒 + 主循环被 15 秒 wait 阻塞 = 用户视角「卡死几分钟」

**证据**
- `src/13-answerer.js:103` `const backoff = Math.min(30 * this._failCount, 180);` —— 30s → 60s → … 上限 180s
- `src/05-scheduler.js:180` `await U.waitUntilHidden(QUESTION_SELECTORS, 15000);` —— 每轮再阻塞 15 秒
- `src/05-scheduler.js:136` `if (this._busy) return;` —— 主循环单线程，被 await 期间什么都不干

**卡死场景链**
退避期间用户看到的是：弹题还在、视频不动、面板不动。**最长 3 分钟**。而且退避结束后还因为 BUG-EC-1 不重试 —— 所以这 3 分钟是白等的。

**建议修法（按兜底优先级）**
1. 退避降到 **10~15 秒起步、上限 60 秒**，且**最多 2 轮**就走强制兜底（跳过本节 / 停手告警）。
2. 调度层别用 15 秒阻塞等待，改成 `await U.sleep(1000)` 后返回，把"等"交给下一轮循环，主循环才不会被单只弹题绑死。
3. 退避期间面板要显示倒计时 + 「若持续失败请手动点掉」的**持续**提示（现在是 8 秒后自动消失，`06-panel.js:483`）。

---

### [BUG-EC-5] 守卫1 没传超时，默认 600 秒 → 一次 tick 卡 10 分钟

**证据**
- `src/05-scheduler.js:162` `await U.waitUntilHidden(VERIFY_SELECTORS);` —— **没有第二个参数**
- `src/01-util.js:109` `async waitUntilHidden(selector, timeoutMs = 600000, interval = 500)`

**卡死场景链**
页面上只要有一个"结构可见"的 `.yidun_popup` 残留（比如验证码弹窗关闭后容器没销毁、或风控脚本留了个空壳）→ tick 在这个 `await` 里停 **10 分钟**，期间 `_busy` 一直为 true → 播放、切课、面板状态全部冻结。用户会认为"脚本崩了"。

**建议修法（按兜底优先级）**
1. 显式传 `120000`（2 分钟）；超时后强制 `ensurePlaying` 恢复 + 面板告警「疑似安全验证残留，已强行继续」。
2. 加"重试计数"：连续 3 次进入守卫1 仍未解除 → `stop()` 并提示用户手动处理，别无限耗着。
3. 判定收紧：只认真正有尺寸的可见元素（`U.isVisible`）而不是结构可见，降低误判。

---

### [BUG-EC-6] 守卫3 关不掉时每 2 秒空转，无计数/无告警/无放弃

**证据**
- `src/05-scheduler.js:190-198`：找不到 `.ss2077-custom-dialog .close, .ss2077-custom-dialog .btn` 就什么都不做，直接 `return`

**实测**
```
命中 BLOCK_SELECTORS = true
能找到关闭按钮 = false
→ 什么都不做，tick 直接 return；每 2 秒一次，无退避、无告警、无上限
```

**卡死场景链**
某个不可关闭的自定义弹窗常驻 → 视频不播、不切课、不提示 → 永久停住。

**建议修法（按兜底优先级）**
1. 加 `_blockFail` 计数：连续 3 次点不掉 → `Log.warn` + 面板告警 + 尝试**按 Esc / 点遮罩 / 强制 `gotoNext`**。
2. 实在关不掉也要在 N 次后 `stop()` 并明确告诉用户"卡在哪个弹窗"，不要沉默。
3. 与守卫2 一样，别用 2 秒空转，加退避。

---

### [BUG-EC-7] 答题把网络 IO 放进主循环 await → 单题最长阻塞约 102 秒

**证据**
- `src/09-bank.js:132` 题库请求 `timeout: 12000`
- `src/10-llm.js:60` LLM 单次 `timeout: 30000`
- `src/10-llm.js:84` `const n = Math.max(1, Math.min(Number(times) || 3, 5));` —— 默认 3 次、上限 5 次
- `src/10-llm.js:106` 连续失败 2 次才 break（所以最坏 2×30s=60s 失败路径；成功但票不收敛最坏 3×30s=90s）
- `src/11-solver.js:59 / :72` 两个 await 都在 `solve()` 里
- `src/13-answerer.js:137` → `src/05-scheduler.js:173` → 主循环 await 链

**卡死场景链**
弹题出现 → 视频暂停 → 题库 12 秒没响应 → LLM 3 次各 30 秒 → 主循环在这 **约 102 秒**里什么都不做。多页弹题（`13-answerer.js:59-66`）还会**逐页串行**，页数越多越久。用户看到的是"弹题出来后卡了一两分钟"。

**建议修法（按兜底优先级）**
1. 给 `Solver.solve` 加**总时限**（`Promise.race`，建议 20 秒），超时立刻走随机兜底 —— **不管怎样都要把题答了、把弹题关掉**，这符合用户「答完答对关闭继续」的诉求。
2. 题库超时降到 5 秒、LLM 单次降到 12 秒；`voteTimes` 默认降到 2。
3. 答题期间在面板上显示「正在求解（题库/LLM）」，让用户知道没死。

---

### [BUG-EC-8] 判断题在弹题路径被静默跳过（一个选项都不点）

**证据**
- `src/13-answerer.js:145` `const idxs = ZHS.Bank.toIndexes(result.answer);`
- `src/13-answerer.js:146-156` `if (idxs.length) { ...点选项... }`
- `src/13-answerer.js:157` `else if (q.type === 'completion' || q.type === 'qa')` —— **只兜了填空/简答**
- 判断题答案是「对」/「错」，`src/09-bank.js:92` `toIndexes` 只认 `[A-D]` → 返回 `[]`
- 判断题的文本匹配逻辑写在 `src/12-filler.js:113-130`，但**弹题路径根本不走 Filler**

**实测**：`toIndexes('对') = []` → `idxs.length` 为 0，且 `type==='judgement'` 进不了 else if → **不点任何选项，然后照样关弹题**。

**建议修法（按兜底优先级）**
1. 弹题路径统一改走 `ZHS.Filler.fill()`（它已经正确处理 judgement/single/multiple/completion/qa 全类型）。
2. 或在 `_solveCurrentPage` 增加 judgement 分支：按文本匹配「对/错」，兜底用索引 0/1。
3. 无论如何，**如果一个选项都没点上，日志要 `warn`**，不要静默。

---

### [BUG-EC-9] 无选项时 Solver 返回 null → 弹题不作答直接关掉（静默丢题）

**证据**
- `src/11-solver.js:83` `if (!result && options.length)` —— 随机兜底**要求有选项**
- `src/11-solver.js:90-94` 否则 `stats.fail++` 并 `return null`
- `src/13-answerer.js:142` `if (!result) return;` —— 直接放弃本题
- `src/08-questions.js:162-166` 采集不到选项元素时 `options` 为空（图片题/结构改版常见）

**实测**
```
solve({title:'填空题', options:[], type:'completion'}) → null
solve({title:'',      options:[], type:'unknown'})    → null
```

**建议修法（按兜底优先级）**
1. 无选项时也要有兜底动作：单选题可以按"选项数未知"跳过作答，但必须 `Log.warn('本题未采集到选项，已跳过')` 并在总结里计入失败数（现在 `stats.fail` 记了但没人看）。
2. **绝不能因为求解失败就不关弹题** —— 目前 `_solveCurrentPage` 的 `return` 只跳过本题，后面仍会 `closeDialogAndResume`，这点是对的，要保持。
3. 采集层补兜底：选项选择器加 `.topic-item` 之外的常见类名（如 `.el-radio`、`.option-item`），降低采集失败率。

---

### [BUG-EC-10] 切课点击不生效 → 反复点同一条目，无重试上限

**证据**
- `src/05-scheduler.js:399-410` `_rebindAfterNav`：`waitFor('video', 20000)` 失败**只打一条 warn 就 return**，不复位、不上报
- `src/05-scheduler.js:200-203` 无视频时 `gotoNext('当前节点无视频')`
- `gotoNext`（`:263-332`）**没有任何失败计数**，`cat.click(next)`（`:317`）也不校验点击是否真的生效

**实测**（模拟 SPA 没切成功，连续 3 次 gotoNext）
```
Catalog.click 调用次数 = 3   ← 每次都点同一个目标
（无停止条件、无告警，只有找不到 next 时才会 stop）
```

**卡死场景链**
点了目录但页面没切（SPA 路由没变 / 点了不可点元素）→ `_rebindAfterNav` 20 秒后失败 → 下一轮发现还是没视频 → 再点同一个 → **循环，每轮约 5~11 秒**，既不推进也不停手。

**建议修法（按兜底优先级）**
1. 加 `_navFail` 计数，连续 3 次切课失败 → `stop()` + 面板告警「切换课时失败，请手动点下一节」。
2. 点击后校验：`ZHS.Catalog.current()` 是否变化 / `lessonKey` 是否变化，没变就换下一个目标或直接停手。
3. `_rebindAfterNav` 失败时主动 `gotoNext` 一次（而不是等下一轮），缩短空转。

---

### [BUG-EC-11] `waitUntilHidden(..., 15000)` 返回 false 后被完全忽略

**证据**
- `src/05-scheduler.js:180-182` 调用后**没接收返回值**，`:187` 直接 return

**卡死场景链**
15 秒等完弹题还在 → 什么都不记 → 下一轮重来 → 无限。和 BUG-EC-1 叠加后就是永久卡死。

**建议修法（按兜底优先级）**
1. 接住返回值，`false` 时 `_dialogWaitFail++`；达到 2~3 次就走强制兜底（`gotoNext` 跳过 / `stop` + 告警）。
2. 15 秒改成 3~5 秒，别让单轮循环占这么久。

---

### [BUG-EC-12] iframe 弹题：检测与处理用了两套口径（P3）

**证据**
- `src/05-scheduler.js:15` 守卫判定只在**主文档**里查 `#playTopic-dialog, .topic-title`
- `src/08-questions.js:87-101` `Dialog.root()` 会降级去查 `#tmDialog_iframe` 里的文档

**后果**：弹题若真渲染在 iframe 里，守卫**根本不会触发**（视频继续播、题不答）；反之主文档里有个残留的 `.topic-title` 就会误触发（BUG-EC-3）。两头不讨好。

**建议修法**：守卫2 判定统一调用 `ZHS.Questions.Dialog.present()`，一处定义、两处复用。

---

## 四、兜底优先级总表（修的时候按这个顺序）

| 优先级 | 动作 | 为什么先做 |
|---|---|---|
| **P0-1** | 重新 `node build.js`（BUG-EC-0） | 否则改了也交付不到用户手上 |
| **P0-2** | 关闭失败/异常时清空 `_lastDialogSig` + 失败 3 次强制兜底（BUG-EC-1） | 直接消除用户看到的「停住」 |
| **P0-3** | 配置版本迁移 `autoAnswer`（BUG-EC-2） | 老用户群发失效 |
| **P1-1** | 守卫判定统一用 `Dialog.present()`，root 为 null 不暂停（BUG-EC-3） | 消除静默暂停 |
| **P1-2** | 守卫1 显式超时 120s + 守卫3 失败计数（BUG-EC-5/6） | 消除长阻塞与空转 |
| **P1-3** | `Solver.solve` 加 20 秒总时限，超时走随机兜底（BUG-EC-7） | 「答完就关」优先于「答对」 |
| **P1-4** | 退避降到 ≤60s、最多 2 轮；调度层 15s wait 改 1~2s（BUG-EC-4/11） | 缩短卡顿观感 |
| **P2** | 弹题路径统一走 Filler（BUG-EC-8）、无选项兜底告警（BUG-EC-9）、切课失败计数（BUG-EC-10） | 消除静默失效与不推进 |

**贯穿原则（对应用户那句「答题本身就是答完答对关闭继续的过程，不要停住」）**：
任何一条失败路径，最终都必须落到**两个出口之一**——① 继续往下走（跳过本题/本节），② 明确停手并告诉用户为什么。**绝不允许"既不走也不说"**。当前代码里 BUG-EC-1/2/3/6/11 都属于第三类。

---

## 五、复现方法（可复现，不改项目文件）

验证脚本写在系统临时目录（**没有污染项目**）：
`C:\Users\Administrator\AppData\Local\Temp\zhs-ec-verify\verify.js`、`verify2.js`、`verify3.js`

运行方式（在项目根目录）：
```bash
NODE_PATH="<项目>/node_modules" node <脚本路径> "<项目>/src"
```
脚本用 `jsdom` 加载 `src/` 全部模块，直接调用 `Scheduler` / `Answerer` / `Solver` 的真实代码路径，上面的每一条「实测」都是这些脚本的真实输出。

手工复现（浏览器控制台）也很快：
1. 打开 `test/fixture-dialog.html`，装脚本；
2. 把 `.close-btn` 的点击处理注释掉（模拟关不掉）；
3. 看控制台：会出现「弹题自动关闭失败……退避 30 秒后重试」，等 30 秒后**不会**出现第二次「开始自动作答」—— 这就是 BUG-EC-1。

---

## 六、附：本轮核对过、确认没问题的项

- LLM `GM_xmlhttpRequest` 的 `onerror` / `ontimeout` 都有处理（`src/09-bank.js:35-36`），不会挂死 Promise；`settled` 标志防重复 resolve（`:25-26`），这块是对的。
- 题库 fetch 降级路径有 `AbortController` 超时（`src/09-bank.js:46-51`），不会泄漏。
- `tick()` 的 `_busy` 防重入（`:136`）+ `try/finally` 复位（`:145-147`），不会并发叠加。
- `Solver` 的缓存淘汰（`:19-26`）、`Bank.normalize` 的归一化（`:61-87`）经单测覆盖，未见异常分支。
- 本轮新增的停止条件 `_checkStopCondition`（`:45-71`）只在 `stopMode !== 'none'` 时生效，默认不触发，不会误停。

（只读诊断，未修改任何项目文件。）

---

## 七、补充：对「最新代码」的二次复核（写完报告后 src 又被改了，重新验一遍）

复核对象：`05-scheduler.js` 守卫2（现 `:168-203`）、`13-answerer.js`（新增 `forceCloseDialog`）、面板「答题」按钮改手动触发。

### 7.1 已修好的（不用再管）
- **BUG-EC-2 的"永久停手"分支已修**：未开自动答题时，守卫2 不再只打日志，而是 `ZHS.Questions.Dialog.close()` + 恢复播放（`05-scheduler.js:196-203`）。
- **手动答题按钮**现在绕过 `autoAnswer` / 退避（`13-answerer.js:18-20`、`06-panel.js:419`），用户点「答题」不会再被静默吞掉。
- **退避期内不再干等**：调度器改调 `forceCloseDialog()`（`05-scheduler.js:175`），不作答、直接关弹窗恢复播放。

### 7.2 仍然成立的（必须继续修）
**BUG-EC-1 核心未修**：`13-answerer.js:125-129` 的失败路径**依然不清空 `_lastDialogSig`**（只有 `:97` 和 `:115` 两处成功路径才清）。后果：退避结束后 `handleDialog` 仍被 `:39` 的"签名未变"挡住 → **再也不会重新作答**。

按**当前**守卫2 真实结构复现（4 轮）：
```
第1轮[正常→handleDialog] 耗时20748ms | 弹题还在=true | 累计作答=1 | 退避剩余=15s | sig="[\"关不掉的题\"]"
第2轮[正常→handleDialog] 耗时15328ms | 弹题还在=true | 累计作答=1 | 退避剩余=-15s | sig=同上
第3轮[正常→handleDialog] 耗时15325ms | 弹题还在=true | 累计作答=1 | 退避剩余=-15s | sig=同上
第4轮[正常→handleDialog] 耗时15337ms | 弹题还在=true | 累计作答=1 | 退避剩余=-31s | sig=同上
→ 视频 paused = true
```
即：**只答了一次，之后永久停在弹题上、视频一直暂停、每轮再阻塞 15 秒**。

### 7.3 新增的一条风险（forceCloseDialog 本身）
`13-answerer.js:61-72`：`Q.close()` 只试 **1 次**、无计数、无放弃。若关闭按钮点不动（正是 BUG-EC-1 触发的前提），退避期内会**每 2 秒点一次、持续 30~180 秒**（约 15~90 次），且退避结束后又回到 7.2 的死路。

**建议补一刀（最小改动，按优先级）**：
1. `closeDialogAndResume` 失败时（`:125` 之前）加 `this._lastDialogSig = '';`，让"退避 → 重试"这个设计真正闭环。
2. `forceCloseDialog` 加失败计数：连续 5 次关不掉 → 强制 `gotoNext` 跳过本节或 `stop()` + 红色告警，别无限点。
3. 调度层 `:180` 的 `waitUntilHidden(..., 15000)` 改成 2~3 秒短等，别让单只弹题占满整轮循环。

### 7.4 顺带确认
- BUG-EC-0（dist 未重新构建）在我复核时**仍未执行**（`dist/` 里搜不到 `stopMode` / `_completedThisRun` / `forceCloseDialog`）。
- BUG-EC-3（守卫2 误触发 `.topic-title`）、BUG-EC-5（守卫1 默认 600 秒）、BUG-EC-6（守卫3 无兜底）在最新代码里**都还没动**，仍按原优先级处理。

---

## 八、并入 ux-walkthrough 同步的边界分支（我已逐条交叉验证）

来源：`ux-walkthrough`  teammate 的交互走查；下面每一条我都用 grep + jsdom 复核过，并补了 2 条新发现（13、15）。

### [BUG-EC-13·P1·新] 随机兜底不入任何统计 → 总结报告显示「失败 0」，实际全是瞎答
- `src/11-solver.js:83-88`：随机兜底直接 `return { answer: letter, from: 'random', confidence: 'low' }`，**不加 `stats.random`、也不加 `stats.fail`**
- `src/05-scheduler.js:375` 报告文案只有 `题库 / LLM / 缓存 / 失败` 四项

**实测**
```
solve#1 → {"answer":"C","from":"random","confidence":"low"}
solve#2 → {"answer":"A","from":"random","confidence":"low"}
solve#3 → {"answer":"B","from":"random","confidence":"low"}
Solver.stats = {"bank":0,"llm":0,"cache":0,"fail":0}
总结报告文案 = "题库 0 / LLM 0 / 缓存 0 / 失败 0"   ← 全是瞎答，报告却说 0 失败
```
**为什么重要**：用户以为自动答题在正常跑，实际命中率≈抛硬币，而总结报告还在"报喜"。这跟用户「答完**答对**」的诉求直接冲突。

**建议修法（按兜底优先级）**
1. `stats` 增加 `random` 计数，报告增加「随机 N 题」字段（不撒谎优先）。
2. 随机兜底时把日志从 `warn` 提到面板常驻告警：「未配置 LLM Key 且题库无响应，正在随机作答」。
3. 提供 `randomFallback` 开关（默认开，保证不卡住；想要准确度的用户可关 → 关掉时求解失败就跳过不答，绝不瞎填）。

### [BUG-EC-14·P2] 两个摆设配置：`answerDialog`、`panelVisible` 零消费点
- `src/00-config.js:39 answerDialog`、`src/00-config.js:45 panelVisible`
- 全 `src/` 搜索：除定义处外**无任何读取点**（命中的 `_answerDialog` 只是 `13-answerer.js:74` 的同名方法）

**后果**：用户以为关掉「课中弹题自动答」能只关弹题答题，实际无效（守卫2 只看 `autoAnswer`）；「悬浮面板可见」开关也无效。
**建议**：要么接上（守卫2 判定改成 `cfg.autoAnswer && cfg.answerDialog`），要么从配置与文档里删掉，别留"看起来能配、实际没用"的开关。

### [BUG-EC-15·P2·新] 作业页自动答题路径**完全不可达**
- `src/13-answerer.js:196-198` `handleHomework(opts)`：非 manual 时要求 `autoAnswer && answerHomework`
- 但 `src/00-config.js:40` `answerHomework: false`，而 `src/06-panel.js` 的设置页**没有 `data-cfg="answerHomework"` 开关**（现有开关只有 autoPlay / autoNext / skipFinished / mute / resume / autoAnswer / autoCloseDialog / bankEnabled / llmEnabled / debug）
- 且 `handleHomework` 的**唯一调用点**是面板手动按钮 `src/06-panel.js:420`，且传了 `{ manual: true }`

**实测**：`handleHomework` 全部调用点 = `["handleHomework({ manual: true })", "handleHomework(opts)"]` → **主循环里没有任何自动调用点**。
**后果**：作业页答题目前只能靠用户手动点「答题」按钮（手动模式绕过配置，反而能用）；自动模式永远走不到。
**建议**：① 面板补一个「作业页自动答」开关；② 若确实要默认关闭，至少在设置页写明"此功能需在作业页手动点『答题』"；③ 决定保留自动的话，需要在主循环/SPA 路由里加调用点。

### [BUG-EC-16·P3] 面板倍速滑条的输入焦点守卫失效
- `src/06-panel.js:524` `if (speed && document.activeElement !== speed) speed.value = ...`
- 面板挂在 Shadow DOM 里，`document.activeElement` 取到的是宿主元素 `DIV#zhs-helper-panel`，**恒不等于 speed**，守卫形同虚设 → 用户正在拖滑条时会被每 1.5 秒的 `refresh()`（`:488 setInterval`）回写覆盖
- 同文件 `:592` 的 `_syncInput` 用的是 `this._shadow.activeElement`，**这才是正确写法**

**建议**：`:524` 改成 `this._shadow && this._shadow.activeElement !== speed`（或直接复用 `_syncInput`）。

### [BUG-EC-17·P3] 配置写入失败是静默 catch
- `src/00-config.js:62-72` `saveConfig` 的 `GM_setValue/localStorage` 写入失败被 `catch(e) { /* 静默失败 */ }` 吞掉
- `getConfig` 解析失败也只是回落到 DEFAULTS（`:58`）

**后果**：用户改了设置（比如填了 LLM Key），保存实际失败却毫无提示，下一次打开设置全没了 —— 会直接导致「我明明配了 Key 为什么还在随机答题」（叠加 BUG-EC-13 就更难排查）。
**建议**：写入失败时 `Log.error` + 面板红色提示；解析失败时保留一份备份键并提示"配置已损坏，已恢复默认"。

> 附：`00-config.js:121` 的 `get config()` 是 getter，每次访问都重新读一次存储并 `JSON.parse`；而 `Log._push`（`:96`）每输出一条日志就访问一次 `ZHS.config.debug`。日志密集时会有额外开销 —— 不算卡死 bug，但如果要优化，缓存一份 + `saveConfig` 时失效即可。

---

## 九、清单（含并入项，共 17 条）—— **状态已过时，以第十章为准**

| 编号 | 严重度 | 状态（截至二次复核） |
|---|---|---|
| BUG-EC-1 | P0 | **未修**（失败路径未清 `_lastDialogSig`） |
| BUG-EC-2 | P0 | 部分修（else 分支已能关闭恢复；配置版本迁移仍未做） |
| BUG-EC-0 | P0 | **未修**（dist 未重新构建） |
| BUG-EC-13 | P1 | 未修（随机兜底零统计，报告不撒谎是底线） |
| BUG-EC-3 / 4 / 5 / 6 / 7 | P1 | 未修（4 部分缓解：退避期改 forceCloseDialog） |
| BUG-EC-8 / 9 / 10 / 11 | P2 | 未修 |
| BUG-EC-14 / 15 | P2 | 未修（摆设配置、作业页答题不可达） |
| BUG-EC-12 / 16 / 17 | P3 | 未修 |

（只读诊断，全程未修改任何项目文件。）

---

## 十、三次复核：v0.3.1 现状（**本章为最终结论，前面的章节仅作证据留档**）

并发修改很密集，我在报告写完后又做了一轮全量复核。以下每条都对着**当前 `src/` 源码**重新确认过（Bash 工具在本会话后期 stdout 异常，改用 Read/Grep 逐行核对）。

### 10.0 ⚠️ 行号漂移说明（先读这段）

本轮复核期间源码**仍在被持续修改**，同一处代码的行号会漂。下表是我在**最后一次核对时刻**取到的行号（已重新锚定）：

| 我前面章节写过的旧行号 | 当前实际行号 | 内容 |
|---|---|---|
| `00-config.js:45`（panelVisible） | **`:49`** | 因 `gatedRandom` 插在前面而漂移（ux-walkthrough 提醒，已确认） |
| `06-panel.js:524`（倍速滑条守卫） | **`:538`** | 同上，已确认 |
| `05-scheduler.js:417-418`（答题通道） | **`:425-426`** | 已确认 |
| `05-scheduler.js:442`（_rebindAfterNav） | **`:450`** | 已确认 |

**结论以"代码行为"为准，行号仅作定位参考**；后续谁再引用请重新 grep 一次。

### 10.1 已经修好的（不用再动）

| 编号 | 修法落点 | 复核依据 |
|---|---|---|
| **BUG-EC-1**（P0，用户「停住」主因） | `13-answerer.js:127` 关闭失败分支加了 `this._lastDialogSig = '';`，注释写明"否则下次被签名未变挡住 → 永远不再重试 → 彻底卡死" | 逐行读到该行，逻辑闭环 |
| **BUG-EC-2**（P0，老配置残留） | `00-config.js:66-99` 引入 `CONFIG_REV = 3` + `FORCE_UPGRADE { autoAnswer:true, gatedRandom:false }`，`getConfig()` 在 `saved.configRev < CONFIG_REV` 时强制拉新默认并写回 | 已确认迁移只跑一次（写回 `configRev`） |
| **BUG-EC-4 的"退避即卡死"** | `05-scheduler.js:180-182` 退避期内改走 `forceCloseDialog()`，不作答、直接关窗恢复播放 | 已确认分支存在 |
| **BUG-EC-13**（P1，报告撒谎） | `05-scheduler.js:425-426` 报告字符串已补 `随机 N / 未作答 N` 两项 | 已确认 |
| **随机兜底策略本身** | 新增 `gatedRandom` 开关（`00-config.js:45` 默认 false；`11-solver.js:86-99`）：无通道时默认**跳过不答**并 `stats.skipped++` + 面板告警，只有显式开启才随机蒙一个（`stats.random++`） | 已确认，且面板有对应开关 `06-panel.js:205` |
| **新手引导文案** | `06-panel.js:171` 已改为「没填 API Key、题库也查不到时，脚本**不作答**并弹提示（不瞎蒙）」 | 已确认，ux-walkthrough 提到的旧文案（"不填也有随机兜底"）**已不存在** |

> 说明：ux-walkthrough 同步给我的两条「v0.3.0 复验」结论（`gatedRandom` 不在 DEFAULTS、引导卡仍承诺随机兜底）在我这一轮复核时**已经被后续提交修掉了**。以我上面的源码行号为准。

### 10.2 仍未修（按优先级，这是真正剩下的活）

| 编号 | 严重度 | 当前证据（行号已对齐最新代码） |
|---|---|---|
| **BUG-EC-0** dist 未重新构建 | **P0** | 本轮所有修复用户仍装不到（见下） |
| **BUG-EC-5** 守卫1 无超时 | P1 | `05-scheduler.js:169` `await U.waitUntilHidden(VERIFY_SELECTORS);` 仍未传 timeout → 默认 600 秒 |
| **BUG-EC-3** 守卫2 误触发 | P1 | `:177` 仍用裸选择器 `'#playTopic-dialog, .topic-title'`；`.topic-title` 与作业页共用（08-questions.js:123/261）→ 命中即暂停且零告警 |
| **BUG-EC-11** 15 秒阻塞 | P1 | `:192` `await U.waitUntilHidden(QUESTION_SELECTORS, 15000)`，返回值仍被丢弃 |
| **BUG-EC-6** 守卫3 无兜底 | P1 | `:212-219` 找不到关闭按钮就什么都不做，直接 return，无计数/无告警 |
| **BUG-EC-7** 网络 IO 阻塞主循环 | P1 | 题库 12s（09-bank.js:132）+ LLM 3×30s（10-llm.js:60/84），单题最长约 102 秒 |
| **BUG-EC-10** 切课失败无上限 | P2 | `_rebindAfterNav`（`:450`）失败仍只 warn；`gotoNext` 无 `_navFail` 计数。已缓解的一半：新增 `_noVideoTicks`（`:224-230`）避免刚启动就误切课 |
| **BUG-EC-8** 判断题静默跳过 | P2 | `13-answerer.js` 弹题路径 `toIndexes('对')=[]`，`else if` 只认 completion/qa |
| **BUG-EC-14** 摆设配置 | P2 | `answerDialog`（00-config.js:39）/ `panelVisible`（:45）仍零消费点 |
| **BUG-EC-15** 作业页自动路径不可达 | P2 | `handleHomework` 唯一调用点仍是 `06-panel.js:420` 的 `{manual:true}`；主循环无自动调用。**手动已可用**（`13-answerer.js:200` 放行），自动仍没有 |
| **BUG-EC-17** 配置写入静默 | P3 | `00-config.js:73-82` `store()` 返回 boolean，但 `:98` / `saveConfig` 调用处忽略返回值 |
| **BUG-EC-16** 倍速滑条守卫失效 | P3 | `06-panel.js:524` 仍是 `document.activeElement !== speed`（正确写法参照 `:592` 的 `_syncInput`） |
| **BUG-EC-12** iframe 弹题口径不一致 | P3 | 守卫只在主文档查，处理层会查 iframe |

**BUG-EC-9 状态更新**：无选项时 `Solver.solve` 现在返回 null 前会 `stats.skipped++` + 面板告警（11-solver.js:86-93 逻辑同样覆盖），不再是"静默丢题"，降为 P3。

### 10.3 建议的收尾顺序

1. **`node build.js`**（P0）—— 否则 10.1 里所有修复用户一个都拿不到，这是当前最大的交付风险。
2. **守卫三件套**：`:169` 传 120000 超时 + 失败计数；`:177` 改用 `Dialog.present()`；`:212` 加计数与告警。这三处是"剩下还能让用户看到停住"的路径。
3. `:192` 的 15 秒 wait 降到 2~3 秒（配合上面的超时改造）。
4. `Solver.solve` 加 20 秒总时限（Promise.race），超时按 `gatedRandom` 策略处理。
5. 其余 P2/P3 按表推进。

### 10.4 并入 ux-walkthrough 回赠的两条（我已独立复核，均成立）

**[BUG-EC-18·P2] `finishAll` 硬编码「全部课程已看完」** —— ✅ **第五轮复核确认已修好**（= ux-walkthrough 的 BUG-UX-15，同一条，请勿重复修）
- 修法落点 `05-scheduler.js:431-436`：改为按 `report.未完成` 动态判定 ——
  `Number(report.未完成) === 0 && Number(report.总节点) > 0 ? '=== 全部课程已看完 ===' : '=== 运行已结束（仍有 N 节未完成）==='`
- 代码注释也写明了动机：「标题不能撒谎（BUG-UX-15）：达标停止 / 未看完就停 都不能硬说『全部看完』」
- 原问题留档：日志说「全部课程已看完」，同一份 report 写着「未完成 2」，面板标题写着「仍有未完成课程」—— 三处口径打架；触发面包括新的停止条件（按时长 / 按节数达标，`_stopByCondition`）走 `finishAll` 的场景
- 附带确认：`06-panel.js:584-586` 的 `allDone` 判定本来就是对的，**矛盾源只在日志那处，别误改面板这里**

**[BUG-EC-19·P3] 报告标题没带漏答数（BUG-EC-13 的小尾巴）**
- 数字已经进 `答题通道`（`:425-426` 含「未作答 N」），但**标题**（`:586`）只看课程完成度，不看答题情况
- 用户扫一眼标题不会知道"有 3 题根本没答"
- 修法：标题或紧邻一行显式带出漏答数，如「运行已结束（仍有未完成课程 · 3 题未作答）」。

**⚠️ 编号碰撞提醒**：我的 **BUG-EC-18 = ux-walkthrough 的 BUG-UX-15**（finishAll 日志口径），**不是**他的 BUG-UX-18（无通道提示刷屏，那条他已确认修好：`11-solver.js:17` 加 `NO_CHANNEL_ALERT_COOLDOWN_MS = 60000` 节流 + `06-panel.js` 的 `alert` 第三参数生效）。两条编号相近但内容无关，别混。

### 10.5 第六轮复核增量（并入 ux-walkthrough 第四轮漂移表后的最终状态）

**又修好 2 条（我这条线上的）：**
- **BUG-EC-19（报告标题不带漏答数）→ ✅ 已修**：`06-panel.js:591-602` 现在按 `allDone && skipN===0 / allDone / 其他` 三分支出标题，含「课程已看完（有 N 题未作答）」和「运行已结束（仍有 N 节未完成 · N 题漏答）」—— 正是我建议的文案。
- **BUG-EC-5（守卫1 无超时）→ 部分修**：`05-scheduler.js:31` 新增 `VERIFY_WAIT_MAX_MS = 10 * 60 * 1000`，`:215` 显式传入，`:217` 超时后 warn 并**放行主循环**（不再是死等）。残留：10 分钟仍偏长，建议降到 2 分钟；另外超时放行前视频是一直暂停的。

**顺带确认已修（ux-walkthrough 报的，与我这边的容错关注点相关）：**
- 停止闸门 `05-scheduler.js:387-388`：`if (!ZHS.state.running && !manual) { Log('运行已停止，取消本次跳转'); ... }` —— 停止后不再点章节
- `_halted` 机制 `:154-164`：`stop()` 置 `_halted=true`，`start(opts.manual)` 可越过（`:52-58`），避免自动流程把已停机的脚本重新拉起
- **残留（不新开编号，挂在 ux 的 BUG-UX-6 下）**：`stop()` 仍只是 `clearInterval + running=false + _halted=true`，**没有真正的 abort 语义**。在途的 `await`（tick 里的 15 秒 wait、`onLessonEnd` 的 3 秒 sleep、`gotoNext` 的随机延迟与 `_rebindAfterNav` 的 20 秒 wait）仍会跑完，只是靠"点击前复查"兜住。若要彻底解决，建议给主循环加一个可取消的 token（`AbortController` 或自增 epoch 号，await 后统一校验）。

**本轮新漂移（补进 10.0 表）：**

| 上一轮行号 | 当前 | 内容 |
|---|---|---|
| `05-scheduler.js:169` | **:215** | 守卫1 waitUntilHidden（已带超时常量） |
| `05-scheduler.js:177` | **:227** | 守卫2 判定（仍未改） |
| `05-scheduler.js:192` | **:224** | 15 秒 wait（仍未改） |
| `05-scheduler.js:212` | **:244** | 守卫3（仍未改） |
| `05-scheduler.js:431-436` | **:467-468** | 动态日志标题 |
| `05-scheduler.js:132-139` | **:154-164** | `stop()` |
| — | **:387-388**（新增） | 停止闸门 |
| `06-panel.js:538` | **:539** | 倍速滑条守卫 |
| `06-panel.js:586` | **:591-602** | 报告标题（已带漏答数） |

**到本轮为止，仍未修的（我这条线上的最终清单）：**
1. **P0 · `dist/` 未重新构建** —— 上面所有修复（含 ux 那 4 条）用户目前都装不到
2. **P1 · `:227` 守卫2 误触发**：仍是裸选择器 `'#playTopic-dialog, .topic-title'`（`:15` 定义），`.topic-title` 与作业页共用 → 命中即暂停且零告警。建议改用 `ZHS.Questions.Dialog.present()`
3. **P1 · `:224`** 15 秒 wait 返回值仍被丢弃，建议降到 2~3 秒 + 接返回值做失败计数
4. **P1 · `:244-251` 守卫3** 关不掉就静默 return，无计数/无告警
5. **P1 · `Solver.solve` 无总时限**（题库 12s + LLM 3×30s ≈ 102 秒阻塞主循环），建议 `Promise.race` 20 秒
6. **P2 · 切课失败无上限**（无 `_navFail`，`_rebindAfterNav` 失败只 warn）
7. **P2/P3**：BUG-EC-8 判断题静默跳过、14 摆设配置（`answerDialog :39` / `panelVisible :49` 本轮 grep 仍零消费点）、15 作业页自动路径不可达、16 滑条守卫（`:539`）、17 配置写入静默、12 iframe 口径

（第六轮复核完成，全程只读，未修改任何项目文件。）
