# 交互走查报告：智慧树助手悬浮面板「点了没反应」根因定位

> 走查人：ux-walkthrough（交互走查子代理）
> 走查对象：`src/06-panel.js`、`src/05-scheduler.js`、`src/13-answerer.js`、`src/00-config.js`、`src/11-solver.js`、`src/07-main.js`
> **第四版（第四轮复验，复核时刻 2026-09-18 00:11）**：初版针对 v0.2.1；期间源码被其他 teammate 持续修改（现代码内 `version` 为 `0.3.0`，`00-config.js` 已升到 `CONFIG_REV = 3`）。本报告已按**当前源码**逐条复验四轮，每条结论标注「已修复 / 仍存在 / 新增」。
> 性质：**只读诊断，未修改任何源码**
>
> ⚠️ 源码仍在被改动，行号会漂移。以下行号以第四轮复核时刻为准，历次复验已发现 `06-panel.js` 的滑条守卫 383→524→538→539、`全部课程已看完` 418→421→431 等漂移，**引用前请重新 grep**。
>
> **第四轮结论速报**：本轮又确认 4 条已修 —— BUG-UX-2（面板 30 秒延迟）、**BUG-UX-6（停止取消不了在途跳转）**、BUG-UX-15（日志硬编码标题）、BUG-UX-17（`zhs.next()` 缺 manual）。原 P1 已清零，剩余 6 条均为 P2/P3 体验问题，详见**第九章**。

---

## 一、复验结论速览

初版 14 条发现中，**7 条已被修复、7 条仍然存在**，并新增 **5 条** v0.3.0 引入的问题。

| 编号 | 标题 | v0.3.0 状态 |
|---|---|---|
| BUG-UX-1 | 点「启动」2 秒后自动停止 + 弹「全部看完」假总结 | ✅ **已修复** |
| BUG-UX-2 | 无 video 页面面板 30 秒后才出现 | ✅ **已修复**（第四轮实测：无 video 页面 800ms 内面板已在） |
| BUG-UX-3 | 「答题」按钮默认静默无反应、面板谎报"已触发" | ✅ **已修复**（手动绕过配置） |
| BUG-UX-4 | 作业页答题永久不可用（`answerHomework` 无开关） | ✅ **已修复**（手动绕过配置） |
| BUG-UX-5 | 退避期内点「答题」完全静默 | ✅ **已修复** |
| BUG-UX-6 | 点「停止」无法取消在途跳转 | ✅ **已修复**（第四轮实测：延迟期停止，章节点击 0 次；manual 分支按注释属设计取舍） |
| BUG-UX-7 | 「下一节」延迟 3~9 秒 + 被静默吞掉 | ✅ **已修复**（手动跳过延迟 + 有提示） |
| BUG-UX-8 | 底部按钮无即时反馈 | ✅ **已修复**（alert + loading 态） |
| BUG-UX-9 | 倍速滑条 Shadow DOM 守卫失效 | ❌ **仍存在**（实测复现） |
| BUG-UX-10 | 摆设配置 `answerDialog` / `panelVisible` | ❌ **仍存在** |
| BUG-UX-11 | 「调试日志」管不住面板日志 | ❌ **仍存在** |
| BUG-UX-12 | 关掉「自动播放」连带让倍速/静音失效 | ❌ **仍存在** |
| BUG-UX-13 | 投票次数 / 题库地址无反馈无校验 | ❌ **仍存在** |
| BUG-UX-14 | 「测试连接」按钮状态长期残留 | ❌ **仍存在** |
| BUG-UX-15 | 停止条件达标时日志仍写「全部课程已看完」 | ✅ **已修复**（第四轮实测：未完成 3 节 → 日志标题「运行已结束（仍有 3 节未完成）」） |
| BUG-UX-16 | 漏答 / 随机不进总结报告（报告显示"失败 0"） | ✅ **已修复**（第二轮复验确认） |
| BUG-UX-17 | `window.zhs.next()` 未传 manual，行为与面板不一致 | ✅ **已修复**（第四轮实测：`07-main.js:97` 已补 `{ manual: true }`） |
| BUG-UX-18 | 无答题通道时每题弹一次 alert，作业页会刷屏 | ✅ **已修复**（第三轮复验确认） |
| BUG-UX-19 | 首次引导文案「不填也有随机兜底」与实际行为矛盾 | ✅ **已修复**（第二轮复验确认） |
| BUG-UX-20 | 报告标题的"漏答数"分支读错键名，恒为 0（死代码） | ❌ **新增**（第五轮实测：漏答 5 题，标题仍无"5 题漏答"） |

**第二轮复验（应 edge-cases 交叉复核要求）新增的三条实测**：
- BUG-UX-16 已修：`05-scheduler.js:415-416` 报告改为 `题库 / LLM / 缓存 / 随机 N / 未作答 N / 失败`。实测连解 3 题 → 报告输出 `题库 0 / LLM 0 / 缓存 0 / 随机 0 / 未作答 3 / 失败 0`。
- BUG-UX-19 已修：`00-config.js:45` 已把 `gatedRandom: false` 写进 `DEFAULTS`，`:66-70` 升到 `CONFIG_REV = 3` 并把 `gatedRandom` 纳入 `FORCE_UPGRADE` 强制迁移；`06-panel.js:205` 补了「无通道时随机兜底」开关（上方 `:203-204` 有说明文案）；引导第 2 条（`06-panel.js:171`）已改为「…脚本**不作答**并弹提示（不瞎蒙，避免错答拉分）」。实测 DOM 内取到的引导文案与开关均已更新。
- BUG-UX-15 未修：`05-scheduler.js:421` 仍是硬编码 `ZHS.Log.info('=== 全部课程已看完 ===')`。实测 `finishAll` 后日志打出「全部课程已看完」，而同一份报告是「未完成 2 / 总节点 2」，面板标题因 `allDone=false` 显示「运行已结束（仍有未完成课程）」——三处口径不一致。

---

## 二、已修复的 7 条（复验证据）

### BUG-UX-1 ✅ 假总结已修
`05-scheduler.js:324-340` 现在把 `bd.total === 0` 单独拎出来优先判断：
```js
if (!next) {
  if (bd.total === 0) {
    // 目录都没识别到：绝不能弹「全部看完」的假总结
    ZHS.Log.warn('未识别到课程目录，无法切换。请确认已进入课程播放页');
    if (ZHS.panel) ZHS.panel.alert('未识别到课程目录，请先进入具体课程的播放页', 'error');
    this.stop();
  } else if (bd.undone === 0) { await this.finishAll(reason); }
  ...
}
```
**实测**（目录为空、无 video）：点启动后 `state.running=false`，**`lastReport` 为空**（不再产生假总结），日志为 `[warn] 未识别到课程目录，无法切换…`。修复到位。

### BUG-UX-3 / 4 / 5 ✅ 手动触发绕过配置
`06-panel.js:416-421` 传 `{ manual: true }`；`13-answerer.js:23 / :27 / :200` 相应放行：
```js
if (!manual && !ZHS.config.autoAnswer) return;          // 手动绕过 autoAnswer
if (!manual && Date.now() < this._cooldownUntil) { … }  // 手动绕过退避
if (!manual && (!ZHS.config.autoAnswer || !ZHS.config.answerHomework)) return;  // 作业页
```
**实测**：手动 `handleDialog({manual:true})` 日志出现「检测到课中弹题，开始自动作答（手动触发）」，不再静默 return。
顺带 `13-answerer.js:127` 现在会在关闭失败时清空 `_lastDialogSig`，退避结束后不会被"签名未变"卡死。

### BUG-UX-7 ✅ 手动切课不再等待、不再静默
`05-scheduler.js:301-310`：手动遇忙时 `ZHS.panel.alert('正在切换课时中，请稍候', 'warn')`；`:343-350` 手动跳过随机延迟。
**实测**：`_navigating=true` 时手动调用 → 新增 1 条 `[warn] 正在切换课时中，请稍候`（初版是 0 条）。

### BUG-UX-8 ✅ 按钮有反馈了
`06-panel.js:405-421`：启动/停止各带 `alert`；下一节/答题包在 `withLoading()` 里，点击即转圈禁用、完成恢复。

---

## 三、仍然存在的 7 条

### [BUG-UX-2] 无 `<video>` 的页面，面板要等 30 秒才出现（高）
**证据** `src/07-main.js:25-30`（未改动）
```js
const video = await U.waitFor('video', 30000);   // 先死等 30 秒
if (!video) {
  ZHS.Log.warn('30 秒内未找到视频元素，可能不在播放页');
  if (ZHS.panel) ZHS.panel.mount();              // 面板挂载排在等待之后
  return;                                        // 且永远不自动 Scheduler.start()
}
```
**用户感知**：装完脚本进作业页/文档节点，30 秒内页面上什么都没有 → 认为"脚本没装上"。
**建议修法**：把 `mount()` 提到 `waitFor` 之前。

---

### [BUG-UX-6] 点「停止」无法取消已在途的切课动作（高，实测复现）
**证据** `src/05-scheduler.js:132-139` —— `stop()` 仍只 `clearInterval`，`gotoNext`（`:300-370`）全程没有任何 `running` / abort 检查，`await U.sleep(...)` 之后无条件 `cat.click(next)`。
**实测**（v0.3.0 源码）
```
已 stop()，running = false
[智慧树助手] 主循环已停止
[智慧树助手] 已切换并重新绑定：第3节
  >> 停止之后真实发生的章节点击： 第1节
  >> 结论： 仍未修复 —— 点了停止，页面仍跳课
```
**用户感知**：点「下一节」后赶紧点「停止」，几秒后页面照样跳到下一节 → "停止按钮没用"。
**建议修法**：`stop()` 置 `_aborted = true`，`gotoNext` 在 `sleep` 后、`cat.click(next)` 前检查；或保存 pending 的 `setTimeout` 句柄并 `clearTimeout`。

---

### [BUG-UX-9] 倍速滑条：`document.activeElement` 在 Shadow DOM 下永远取不到滑条（中，实测复现）
**证据** `src/06-panel.js:538`（行号已两度漂移：383 → 524 → 538，问题始终未变）
```js
const speed = box.querySelector('[data-cfg-num="speed"]');
if (speed && document.activeElement !== speed) speed.value = String(cfg.speed);
```
对比同文件 `_syncInput` 用的是正确写法 `this._shadow.activeElement`。
**实测（第二轮，v0.3.0 源码）**：滑条 `focus()` 后 `document.activeElement = DIV#zhs-helper-panel`，`=== 滑条 ? false`。
**用户感知**：`refresh()` 每 1.5 秒无条件回写滑条值，拖动中一旦出现浮点/夹逼差异（如 `1.2000000000000002` → `1.2`）滑块会回跳。
**建议修法**：改为 `this._shadow.activeElement !== speed`。

---

### [BUG-UX-10] 摆设配置 `answerDialog` / `panelVisible` 仍无人消费（中）
**证据** `00-config.js:39` `answerDialog: true`、`:49` `panelVisible: true`。第五轮对 `src/` 全量 Grep（`config\.(answerDialog|panelVisible)` 0 命中；`answerDialog` 仅命中的是 `13-answerer.js:56/100` 的同名方法 `_answerDialog`，非读键），设置页 `data-cfg` 列表（`06-panel.js:207-263`）也**没有这两个开关**，`mount()`（`:142-164`）面板根节点写死 `<div class="panel show">` 永远可见 → 确为死配置。
**专项调研**：team-lead 已就这两个键下《死配置调研》，结论与处置方案（接上 / 移除，含最小改法）见同目录 `config-keys-answerDialog-panelVisible.md`。
**建议修法**：两个键语义都有价值，**建议接上**——`answerDialog` 包住 `05-scheduler.js` 守卫2 的弹题分支、`panelVisible` 在 `mount()`/`refresh()` 读后控制初始显隐，并各补一行 `data-cfg` 开关（均无需改 `CONFIG_REV`）。

---

### [BUG-UX-11] 「调试日志」开关仍只管控制台（中）
**证据** `00-config.js:124` `if (level === 'debug') { if (ZHS.config.debug) console.log(...) }`；而 `_renderLogs`（`06-panel.js:605-615`）用 `ZHS.Log.all().slice(-80)`，**无任何 level 过滤**。
**用户感知**：关掉调试日志期望面板变干净，日志页照旧刷满 debug 行。

---

### [BUG-UX-12] 关掉「自动播放」仍连带让「倍速」「静音」失效（中）
**证据** `05-scheduler.js:238-242`
```js
if (cfg.autoPlay) {
  ZHS.Player.setSpeed(video, cfg.speed);       // 倍速在 autoPlay 分支内
  if (cfg.mute) ZHS.Player.mute(video);        // 静音也在 autoPlay 分支内
  await ZHS.Player.ensurePlaying(video);
}
```
**用户感知**：只想关自动播放，结果倍速、静音一起失效 → "倍速开关坏了"。

---

### [BUG-UX-13] 投票次数 / 题库地址仍无反馈、无校验（低）
**证据** `06-panel.js:381-387` 只 `setConfig`，无 `Log`/`alert`（同页 `:307 / :316 / :326 / :335` 都有 `Log.info`）；题库地址 `:302-309` 只 `trim()`，`Bank.ping()`（`09-bank.js:170`）存在但面板未接。
**建议修法**：补 Log 与格式校验；题库地址旁加「测试题库」按钮复用 `Bank.ping()`。

---

### [BUG-UX-14] 「测试连接」按钮状态仍会长期残留（低）
**证据** `06-panel.js:349-353` 测试后改文案为「连接正常 / 连接失败」并加 `.ok / .bad` 类，之后不复位。
（提示本身可理解：`10-llm.js:127` 无 Key 时返回 `msg: '未配置 API Key'`，这块没问题。）
**建议修法**：`.in-key` 的 `onchange` 里复位按钮文案与样式。

---

## 四、v0.3.0 新增的 5 条

### [BUG-UX-15] ❌ 仍存在 —— 停止条件达标时，日志硬编码打印「全部课程已看完」，与报告/标题三处口径不一致（中）
**证据** `05-scheduler.js:421`（`finishAll` 内，第二轮复验行号已从 418 漂到 421）
```js
ZHS.Log.info('=== 全部课程已看完 ===');
```
而 `_stopByCondition`（`:81-89`）在「按时长 / 按节数达标」时也调用 `finishAll`，此时课程**并未看完**。
**实测**（`stopMode='lessons'`、`stopLessons=1`、`_completedThisRun=5`）
```
[info] === 已达到设定的完成节数 1 节 ===
[info] === 全部课程已看完 ===          ← 矛盾
[info]   总节点：3
[info]   已完成：0
[info]   未完成：3                      ← 明明 3 节没看
报告 触发原因 = 已达到设定的完成节数 1 节（本次运行已完成 5 节）
报告 完成情况 = 0/3
```
面板报告标题因 `allDone=false` 显示「运行已结束（仍有未完成课程）」，与日志的「全部看完」打架。
**建议修法**：把 `:418` 改成按 `allDone` 动态生成，或把标题文案作为参数由调用方传入。

---

### [BUG-UX-16] ✅ 已修复 —— 漏答 / 随机现已进总结报告
**第二轮实测**（无题库、无 Key，连解 3 题后调 `finishAll`）
```
stats = {"bank":0,"llm":0,"cache":0,"random":0,"skipped":3,"fail":0}
报告「答题通道」= 题库 0 / LLM 0 / 缓存 0 / 随机 0 / 未作答 3 / 失败 0
```
**修复点** `05-scheduler.js:415-416`
```js
答题通道: '题库 ' + st.bank + ' / LLM ' + st.llm + ' / 缓存 ' + st.cache
  + ' / 随机 ' + st.random + ' / 未作答 ' + st.skipped + ' / 失败 ' + st.fail,
```
**残留小建议**：`skipped > 0` 时报告**标题**仍是「运行已结束（仍有未完成课程）」，没提示"有 3 题没答"。建议在标题或单独一行显式提示漏答数，避免用户只看标题。

---

### [BUG-UX-17] `window.zhs.next()` 未传 `{manual:true}`，与面板按钮行为不一致（低）
**证据** `07-main.js:93`
```js
next: () => ZHS.Scheduler.gotoNext('手动'),     // 少了第二个参数
```
而面板按钮是 `06-panel.js:414` `gotoNext('手动', { manual: true })`。
**用户感知**：按文档/控制台用 `zhs.next()` 时，会走自动路径 —— 随机延迟 3~9 秒、遇忙静默吞掉，与面板点按的手感完全不同。
**建议修法**：`next: () => ZHS.Scheduler.gotoNext('手动', { manual: true })`。

---

### [BUG-UX-18] ✅ 已修复 —— 提示已节流，且 `alert` 现在支持自定义时长
**第三轮实测**（连续解 8 题，无题库、无 Key，用计数器包住 `panel.alert`）
```
题目数 = 8, 实际弹提示次数 = 1
传入参数个数 = 3
提示文案 = 未配置答题通道，已跳过多题未作答。请在设置页配置大模型密钥并点「保存」，或关闭「自动答题」
stats.skipped = 8
```
**修复点**
1. `11-solver.js:14-18` 新增 `NO_CHANNEL_ALERT_COOLDOWN_MS = 60000` 节流常量（注释明确写了"作业页可能一次跑 20 题，每题弹一次会把面板刷爆"）。
2. `:96-103` 用 `noChannelAlertAt` 做 60 秒节流。
3. 文案改为「已跳过**多题**未作答」并给出明确动作（"去设置页配置大模型密钥并点「保存」"），语义不再含糊。
4. `06-panel.js:650` `alert` 现在接受第三个参数：`const ms = Number(durationMs) > 0 ? Number(durationMs) : 8000;` —— 初版报的"第三参数被丢弃"也已修。

---

### [BUG-UX-19] ✅ 已修复 —— 引导文案、默认值、UI 开关三处都已对齐
**第二轮实测**（从 Shadow DOM 内直接取文案与元素）
```
设置页有 gatedRandom 开关? true
引导第2条文案: 自动答题已默认开启；没填 API Key、题库也查不到时，脚本不作答并弹提示（不瞎蒙，避免错答拉分）
```
**三处修复点**
1. `06-panel.js:171` 引导第 2 条改为「…脚本**不作答**并弹提示（不瞎蒙，避免错答拉分）」，不再承诺随机兜底。
2. `00-config.js:45` `gatedRandom: false` 已进 `DEFAULTS`（注释写明"宁可漏，不可错"）。
3. `00-config.js:66-70` `CONFIG_REV = 3` + `FORCE_UPGRADE = { autoAnswer: true, gatedRandom: false }` —— 老用户本地存的旧配置会被强制拉到新默认，避免"代码改了默认但用户端不生效"。
4. `06-panel.js:205` 补了「无通道时随机兜底」开关，`:203-204` 配了说明文案。

（初版发现时该配置既无默认值也无 UI，引导却承诺了它；现已闭环。）

---

## 五、汇总表（v0.3.0 当前源码）

### 5.1 底部按钮

| 按钮 | 绑定 | 状态 | 说明 |
|---|---|---|---|
| 启动 | `06-panel.js:405-408` | ✅ 正常 | 有 alert 反馈；目录为空时给出 error 提示而非假总结 |
| 停止 | `06-panel.js:409-412` | ✅ 正常 | 有 alert；自动路径的在途跳转已能被取消（BUG-UX-6 第四轮实测通过）。仅「刚点下一节又立刻点停止」会照跳，属代码注释内的设计取舍 |
| 下一节 | `06-panel.js:429` | ✅ 正常 | manual 跳过延迟、遇忙有提示；`zhs.next()` 也已补 manual（BUG-UX-17 已修） |
| 答题 | `06-panel.js:416-422` | ✅ 正常 | manual 绕过配置已生效；但面板仍无条件提示"已触发"（措辞仍偏乐观） |

### 5.2 设置页开关

| 开关 | 默认 | 消费点 | 状态 |
|---|---|---|---|
| 自动播放 | `true` | `05-scheduler.js:238` | 正常（但会连带倍速/静音，BUG-UX-12） |
| 自动下一节 | `true` | `05-scheduler.js:229,253` | 正常 |
| 跳过已完成 | `true` | `05-scheduler.js:320` | 正常 |
| 静音 | `true` | `05-scheduler.js:240` | 有条件正常（BUG-UX-12） |
| 断点续播 | `true` | `04-resume.js:139,165,172,222` | 正常 |
| 倍速（滑条） | `1.5` | `05-scheduler.js:239` | 正常（有回跳隐患，BUG-UX-9） |
| 自动答题 | **`true`**（v0.3.0 改） | `05-scheduler.js:179`、`13-answerer.js:23,200` | 正常 |
| 答完自动关闭 | `true` | `13-answerer.js:95`、`05-scheduler.js:187` | 正常 |
| 题库通道 | `true` | `11-solver.js:57`、`09-bank.js:117` | 正常 |
| LLM 通道 | `true` | `11-solver.js:70` | 正常 |
| 调试日志 | `true` | `00-config.js:124` | 部分生效（BUG-UX-11） |
| 无通道时随机兜底 | **`false`** | `11-solver.js:87`、`06-panel.js:205` | ✅ 已闭环（默认值 + UI + 迁移三件套齐全，可作范本） |
| 停止条件 / 分钟 / 节数 | `none` / 120 / 10 | `05-scheduler.js:52-77` | 正常（分钟/节数输入无 Log 反馈） |
| 投票次数 | `3` | `11-solver.js:72` | 正常（无反馈，BUG-UX-13） |
| 题库地址 | 默认本地 | `09-bank.js:120` | 正常（无校验、无测试按钮，BUG-UX-13） |
| 测试连接 / 保存 | — | `10-llm.js:125` / `06-panel.js:361` | 正常（按钮状态残留，BUG-UX-14） |

### 5.3 摆设 / 缺失项

| 项 | 状态 |
|---|---|
| `answerDialog`（`00-config.js:39`） | **摆设**，零消费点 |
| `panelVisible`（`00-config.js:49`） | **摆设**，零消费点（行号因 `gatedRandom` 插入而从 45 漂到 49） |
| `gatedRandom`（`00-config.js:45` / `06-panel.js:205` / `11-solver.js:87`） | ✅ 已闭环：有默认值、有 UI 开关、有 `CONFIG_REV` 迁移、引导文案已对齐 |
| `answerHomework`（`00-config.js:40`，默认 false） | 手动路径已绕过；自动路径仍无 UI 开关 |

---

## 六、修复优先级（针对 v0.3.0）

> 已按**第四轮复验**更新（2026-09-18 00:11）：BUG-UX-2 / 6 / 15 / 16 / 17 / 18 / 19 均已修复，**P0、P1 全部清零**。剩余 6 条均为 P2/P3，不影响"点得动"，只影响"用得舒服"。

| 优先级 | 编号 | 一句话 |
|---|---|---|
| ~~P1~~ | ~~BUG-UX-6~~ | ✅ 已修：`gotoNext` 延迟后复查 `running` 再决定是否点（第四轮实测章节点击 0 次） |
| P2 | BUG-UX-12 | 倍速/静音移出 `autoPlay` 分支（关自动播放会连带弄坏倍速，误导性最强的一条） |
| P3 | BUG-UX-9 | 倍速滑条守卫改 `this._shadow.activeElement`（拖动中可能回跳） |
| P3 | BUG-UX-10 | 删掉或接上摆设配置 `answerDialog` / `panelVisible` |
| P3 | BUG-UX-11 | 「调试日志」开关应同时过滤面板日志区 |
| P3 | BUG-UX-13 | 投票次数 / 题库地址补输入反馈与校验（可复用 `Bank.ping()`） |
| P3 | BUG-UX-14 | 「测试连接」按钮状态复位 |
| P3 | **BUG-UX-20** | `06-panel.js:589` 把 `report.未作答` 改成 `report.漏答题数`（键名对不上 → 漏答数恒 0，"N 题未作答"两个分支是死代码） |
| — | BUG-UX-16 / 18 / 19 | ✅ 已修（"报告标题提示漏答数"的**代码已写**，但被 BUG-UX-20 的键名错误挡住，未真正生效） |

---

## 七、验证方法（可复现）

- 用 jsdom 直接按 `build.js` 的文件名顺序拼接 `src/*.js` 并注入（**绕过未重新构建的 `dist/`**），注入 GM 桩函数后调用真实的处理函数。
- 探针脚本位于系统临时目录 `%TEMP%\zhs-ux-v3.js` / `v4` / `v5` / `v6` / **`v7`（第四轮，含 A~E 五组场景）**，**未写入项目目录**。
- 每轮换源码后都要重跑同一批探针，否则结论会停留在旧版本（v0.2.1 → v0.3.0 期间已出现过一次"报告结论整体过时"）。
- 章节点击用 `document.addEventListener('click', ..., true)` 事件委托捕获：`Catalog.click()`（`02-adapter.js:424`）的 `querySelector('a, .child-name, …')` 按文档顺序命中的是 `.child-name` 这个 span，**不是** `<a>`，直接监听 `<a>` 会漏掉真实点击。
- 本报告未修改任何源码；`git status` 中的 `M` 标记为其他 teammate 的改动。

---

## 八、附：关键代码坐标（第三轮复验时刻）

> ⚠️ **行号会漂移**：源码在持续修改，同一处代码三轮复验里已多次移动。
> 已知漂移（旧 → 现）：`全部课程已看完` 418→421→**431**；`答题通道` 413→415→**425**；`_rebindAfterNav` 442→**450**；倍速滑条守卫 383→524→**538**；`panelVisible` 45→**49**。**引用前请重新 grep，以代码行为为准。**

| 位置 | 内容 | 状态 |
|---|---|---|
| `05-scheduler.js:147-154` | `stop()` 仍只清 interval（本身未加 abort，BUG-UX-6 靠下一行的闸门兜住） | ⚠️ 兜底已生效 |
| `05-scheduler.js:300-310` | `gotoNext` manual 处理（BUG-UX-7） | ✅ 已修 |
| `05-scheduler.js:324-340` | `!next` 三分支，`total===0` 优先（BUG-UX-1） | ✅ 已修 |
| `05-scheduler.js:425-426` | 答题通道含 `随机 N / 未作答 N`（BUG-UX-16） | ✅ 已修 |
| `05-scheduler.js:451-453` | 标题按 `未完成/总节点` 动态生成（BUG-UX-15） | ✅ 已修 |
| `05-scheduler.js:370-376` | 停止闸门：延迟后复查 `ZHS.state.running`（BUG-UX-6） | ✅ 已修 |
| `06-panel.js:171` | 引导第 2 条文案（BUG-UX-19） | ✅ 已修 |
| `06-panel.js:203-205` | 随机兜底说明 + `gatedRandom` 开关（BUG-UX-19） | ✅ 已修 |
| `06-panel.js:539` | `document.activeElement` 守卫失效（BUG-UX-9） | ❌ 未修 |
| `06-panel.js:586` | 报告标题按 `allDone` 判定（**这处是对的**，矛盾源在日志） | ✅ 正确 |
| `06-panel.js:603` | `_syncInput` 用 `this._shadow.activeElement`（正确写法范本） | ✅ 正确 |
| `06-panel.js:645-651` | `alert(msg, type, durationMs)` 已支持第三参数（BUG-UX-18） | ✅ 已修 |
| `13-answerer.js:23,27,200` | manual 绕过配置（BUG-UX-3/4/5） | ✅ 已修 |
| `13-answerer.js:127` | 关闭失败时清 `_lastDialogSig`（BUG-UX-5） | ✅ 已修 |
| `11-solver.js:14-18` | `NO_CHANNEL_ALERT_COOLDOWN_MS` 提示节流（BUG-UX-18） | ✅ 已修 |
| `11-solver.js:35` | stats 含 random/skipped（BUG-UX-16） | ✅ 已修 |
| `11-solver.js:93` | `gatedRandom` 门禁（BUG-UX-19） | ✅ 已修 |
| `00-config.js:39` | `answerDialog`（摆设） | ❌ 未修 |
| `00-config.js:45 / 49` | `gatedRandom`（已闭环）/ `panelVisible`（摆设） | ✅ / ❌ |
| `00-config.js:66-70` | `CONFIG_REV = 3` 配置迁移机制 | ✅ 已修 |
| `07-main.js:25-28` | 面板先挂载再等视频（BUG-UX-2） | ✅ 已修 |
| `07-main.js:97` | `zhs.next()` 已补 `{ manual: true }`（BUG-UX-17） | ✅ 已修 |
| `00-config.js:39,49` | 摆设配置 `answerDialog` / `panelVisible`（BUG-UX-10） | ❌ 未修 |

---

## 九、第四轮复验（2026-09-18 00:11，源码快照：05-scheduler.js 00:08 / 07-main.js 00:09）

第三版之后 `05-scheduler.js`、`07-main.js` 又被改动，我用同一个 jsdom 探针 **`%TEMP%\zhs-ux-v7.js`** 重跑了五组场景，全部基于**当前 `src/`**（不读 `dist/`）。

### 9.1 BUG-UX-6 ✅ 已修复 —— 自动路径的"点了停止还在跳"

新增闸门 `05-scheduler.js:370-376`：

```js
// 停止闸门（BUG-UX-6）：随机延迟可能长达十几秒，期间用户点了「停止」，
// 若不复查就照样点下去，会出现「明明停了页面还在跳」。
// 手动触发例外——用户刚点过按钮，就是要跳。
if (!ZHS.state.running && !manual) {
  ZHS.Log.info('运行已停止，取消本次跳转');
  return;
}
```

**实测（V7-A）**：`nextDelayMin/Max = 4/6`，调 `gotoNext('自动')`，500ms 后调 `stop()`，再等 9 秒：

```
[info] 即将切换到「第3节」，等待 7 秒（剩余未完成 3 节）
[info] 主循环已停止
[info] 运行已停止，取消本次跳转
  停止后实际发生的章节点击: （无）
  >> BUG-UX-6 自动路径: ✅ 已修复（延迟期间停止生效）
```

**对照（V7-B）**：`gotoNext('手动', {manual:true})` 后立刻 `stop()` → 仍然跳到第 3 节。这是 `:371-372` 注释里写明的设计取舍（"用户刚点过按钮，就是要跳"），**不算缺陷**，但建议在面板「停止」的 alert 里补一句"若刚点过下一节，本次跳转不会取消"，避免用户二次困惑。

**残留（极低危）**：`stop()` 本身（`05-scheduler.js:147-154`）仍只 `clearInterval` + `running=false`，没有 abort 标志。现在靠"点击前复查 `running`"兜住，功能上够了；真正的改进点是给 `stop()` 加 `_aborted` 并在 `cat.click(next)` 前的最后一刻再查一次，以及让 `_rebindAfterNav` 的 20 秒等待可被中断。

### 9.2 BUG-UX-2 ✅ 已修复 —— 面板不再等 30 秒

`07-main.js:25-28` 把挂载提到 `waitFor` 之前，注释直接引用了本条编号：

```js
// 3. 面板先挂载：不等视频，进来就能看到界面。
//    以前写在 waitFor 之后，在作业页 / 尚未进入播放页时要干等 30 秒才出面板，
//    用户会误以为脚本没装上（BUG-UX-2）。
if (ZHS.panel) ZHS.panel.mount();
```

并且 `:34-36` 在等不到视频时主动提示（10 秒长提示）：`未检测到视频，可能尚未进入播放页；面板可正常使用，进播放页后会自动开始`。

**实测（V7-D）**：构造一个**完全没有 `<video>`** 的页面，800ms 后 `document.getElementById('zhs-helper-panel')` 已存在 → ✅ 已修。

### 9.3 BUG-UX-15 ✅ 已修复 —— 日志标题不再撒谎

`05-scheduler.js:449-453`：

```js
// 标题不能撒谎（BUG-UX-15）：达标停止 / 未看完就停 都不能硬说「全部看完」。
const headline = Number(report.未完成) === 0 && Number(report.总节点) > 0
  ? '=== 全部课程已看完 ==='
  : '=== 运行已结束（仍有 ' + report.未完成 + ' 节未完成）===';
```

**实测（V7-E）**：未看完就调 `finishAll` → 未完成 3 / 总节点 3 → 日志标题 `=== 运行已结束（仍有 3 节未完成）===` → 日志 / 报告 / 面板标题三处口径终于一致。
（顺带确认报告里已新增「漏答题数：0」一行。）

### 9.4 BUG-UX-17 ✅ 已修复 —— `zhs.next()` 补上了 manual

`07-main.js:94 / 97`：

```js
start: () => ZHS.Scheduler.start({ manual: true }),
next:  () => ZHS.Scheduler.gotoNext('手动', { manual: true }),
```

**实测（V7-C）**：人为置 `_navigating = true` 模拟在途，再调 `window.zhs.next()` → **章节点击 0 次**，且弹出「正在切换课时中，请稍候」→ 与面板按钮手感一致。✅

### 9.5 本轮重测仍为 ❌ 的项（无变化，供排期参考）

| 编号 | 当前坐标 | 现状 |
|---|---|---|
| BUG-UX-9 | `06-panel.js:539` `if (speed && document.activeElement !== speed)` | 仍用 `document`，Shadow DOM 下恒不等 → 拖动中可能回跳 |
| BUG-UX-10 | `00-config.js:39 / 49` | `answerDialog`、`panelVisible` 全局零消费点（本轮 grep 复核） |
| BUG-UX-12 | `05-scheduler.js:253-257` | 倍速 / 静音仍在 `if (cfg.autoPlay)` 分支内 |
| BUG-UX-11 / 13 / 14 | `00-config.js:124`、`06-panel.js:381-387`、`06-panel.js:349-353` | 本轮未改动 |

### 9.6 本轮的方法论提醒（给后续接手的人）

1. **必须重新构建再下结论**：`dist/zhihuishu-helper.user.js`（23:05 之后重建过一次，但晚于它的 `05-scheduler.js` 00:08、`07-main.js` 00:09 改动**还没进去**）。用户装的是 `dist/`，验证的一定要是重新 `node build.js` 之后的产物。
2. **行号必须现 grep**：本轮又见到 `06-panel.js` 滑条守卫 538→539、`07-main.js` 挂载点 26→25-28、`zhs.next()` 93→97。前几轮报出的行号到下一轮就可能失效，报告里所有"坐标"只能当搜索关键字用。
3. **Shadow DOM 的探针要进 `shadowRoot`**：`document.querySelector` 取不到面板内部控件，必须先 `document.getElementById('zhs-helper-panel').shadowRoot`。
