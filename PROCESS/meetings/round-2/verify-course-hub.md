# 独立验证报告：课程中心自动选课 / 自动跳课（06b-course-hub.js）

- **验证员**：独立验证子代理（立场：尽力证伪，不盖章）
- **被验证对象**：`src/06b-course-hub.js`（新增 597 行）、`src/00-config.js`、`src/05-scheduler.js:434-446`、`src/06-panel.js:226-231`
- **验证时间**：2026-09-18
- **验证方式**：自写独立脚本 `test/verify-course-hub.js`（82 项断言，jsdom + vm，加载 src 全模块），另加临时探针脚本复现缺陷（已删除）
- **不会 commit / push**，未修改任何 `src/` 文件

---

## 〇、一句话结论

**同事声称的「测试全过」是真的**（244/0、12/0、build 正常，我复现一致）；**但新功能的"能跑"存在 3 个真实缺陷**，其中 2 个会导致功能在真实使用中失效或产生用户可见的错误行为。同事的自测覆盖了"快乐路径"，但漏掉了**并发竞态、键命名空间一致性、以及默认开开关下的无前置自动点课**三个点。

---

## 一、V1 —— 测试结果是真的吗？（结论：通过）

### 实际命令 + 真实输出

**1) `node build.js`**
```
构建完成: dist/zhihuishu-helper.user.js  (217.3 KB, 15 模块, v0.5.1)
  + 00-config.js
  + 01-util.js
  + 02-adapter.js
  + 03-player.js
  + 04-resume.js
  + 05-scheduler.js
  + 06-panel.js
  + 06b-course-hub.js      ← 新模块，拼装顺序正确（06-panel 之后、07-main 之前）
  + 07-main.js
  + 08-questions.js
  + 09-bank.js
  + 10-llm.js
  + 11-solver.js
  + 12-filler.js
  + 13-answerer.js
```

**2) `node test/run.js`**
```
==================================================
通过 244 / 失败 0
全部通过 ✓
```

**3) `node tools/verify-install-page.js`**
```
==========================================
通过 12 / 失败 0
安装页校验通过 ✓
```

### 独立结论
**通过。** 三个数字（244、12、build 成功）与同事所述完全一致，无夸大。
补充：`06b-course-hub.js` 的文件名字典序恰好排在 `06-panel.js` 之后、`07-main.js` 之前，拼装顺序安全（新模块依赖 `ZHS.Util` 已加载，不依赖 panel/main）。

---

## 二、V2 —— 新功能真的能跑吗？（结论：基本通过，核心解析/选择逻辑正确）

我自写 `test/verify-course-hub.js`，在 jsdom 里构造题目要求的假课程中心 DOM，覆盖 A–O 共 82 项断言，**全部通过**。关键结果：

| 断言 | 结果 | 证据 |
|---|---|---|
| `collectCards()` 收到 3 张卡 | OK | 名称 `["线性代数","高等数学","大学物理"]` |
| 名称/百分比/完成态解析 | OK | 100/35/0；线性代数 `finished=true`，另两门 `false` |
| `pickNext()` 跳过已完成，选**高等数学** | OK | 返回 `高等数学` |
| 标记高等数学 done 后 → **大学物理** | OK | 返回 `大学物理` |
| 标记大学物理 failed 后 → **null** | OK | 返回 `null` |
| `enterCourse()` 写 intent | OK | `intent={courseId:"高等数学",courseName:"高等数学",at:...}` |
| `enterCourse()` 调用 click | OK | `clicked=1`（探针单独确认） |
| intent 回拨 11 分钟判过期 | OK | `getIntent()===null`，且 store 中被清空 |
| intent 回拨 9 分钟仍有效 | OK | 返回对象 |
| 无 `.ai-course-center-body` 时不抛异常 | OK | `collectCards()` 返回 `[]`，`pickNext()` 返回 `null` |
| 有空容器无卡片时不抛异常 | OK | 同上 |

**jsdom 环境限制说明**：jsdom 不做布局计算，`getBoundingClientRect()` 全 0，故 `U.isVisible()` 恒为 `false`，`enterCourse` 会走 `scrollIntoView` 分支而非直接 click 分支。这是测试环境特性，非代码缺陷（两条分支最终都调用 `el.click()`，已验证）。

### 独立结论
**核心解析与选择逻辑（V2 主体）通过。** 但 `enterCourse` 的**返回值语义有缺陷**（见「问题 2」），会影响其调用者对"是否成功"的判断。

---

## 三、V3 —— 有没有破坏原有行为？（结论：改动范围干净，但新模块有"无前置自动点课"风险）

### 3.1 改动范围（结论：通过）
`git diff HEAD -- src/05-scheduler.js` 只删除了 **2 行**，全部位于 `bd.undone === 0` 分支内：
```
-            // 真正全看完 → 出总结并停止
-            await this.finishAll(reason);
```
另外两个分支 `bd.total === 0`（第 429-433 行）和「有未完成但定位失败」（第 447-452 行）**逐字未变**。逐行核对 `src/05-scheduler.js:428-454` 确认。

### 3.2 `finishAll` 仍可正常调用（结论：通过）
- `finishAll` 调用点：`05-scheduler.js:117`（达标停止路径）与 `:445`（新 `else` 分支）。
- 新开关关闭时：`cfg.autoCourseHop && hub && !hub.isHubPage()` → `false` → 走 `else` → `await this.finishAll(reason)`，原逻辑完整保留。已用 jsdom 断言 `autoCourseHop=false` 时 `returnToHub()` 返回 `false`。

### 3.3 变量作用域（结论：通过）
`canHop` / `hub` 均为 `const`，声明在 `else if` 块内部。`grep -n "canHop\|const hub =" src/*.js` 显示全项目仅 `05-scheduler.js:437-439` 三处，**无外层污染、无重名**。

### 3.4 全局副作用（结论：通过）
- **未劫持 `window.open`**：`grep` 全文，`06b` 只在注释里提到 `window.open`，无赋值/覆盖。
- **未泄漏全局**：`CourseHub` 只挂在 `ZHS.CourseHub`，`window.CourseHub` / `window.collectCards` / `window.pickNext` 均为 `undefined`。
- **存储隔离**：只读写自己的 `zhs-helper-hub` 键，未触碰配置文件键。
- **IIFE 包裹**：整个模块在 `(function(){'use strict'; ... })()` 内。

### 3.5 ⚠️ 危险点：默认开开关时"打开课程中心页即自动点课"（结论：**不通过 —— 严重**）
题目点名要查的最危险项，实测**确实存在**：

实跑证据（默认配置，用户"只是打开课程中心页看看"）：
```
默认配置 autoCoursePick = true , autoCourseHop = true
模拟：老用户升级后（默认开）打开课程中心页，什么都不做…
3 秒内被自动点击次数 = 1 （>0 表示无前置条件即自动点课）
```

机制：`06b-course-hub.js:595` 的 `setTimeout(() => { CourseHub.start(); }, 1500)` 是**无条件自启动**。
- `start()` → `isHubPage()` 为真 → `runOnHub()` → `pickNext()` → `enterCourse()` → **点卡片**。
- **没有任何前置条件**：不要求用户先点过"开始"、不要求来自"本课学完"的跳转、不要求存在 intent。
- 卡片点击会触发平台 `window.open()` 开新标签（被迫弹窗/跳转）；若未开新标签，还有 `location.href` 兜底**把当前标签也导航走**。

唯一能拦住它的只有 `autoCoursePick` 开关，而该开关**默认 true**，且 `00-config.js` 的 `FORCE_UPGRADE` 会**强制把老用户也改成 true**（`CONFIG_REV` 3→4）。即：**所有老用户升级后，只要打开一次课程中心页，就会被自动点进一门课。**

对照：关闭开关后确认不再自动点击：
```
开关全关时，进入课程中心 3 秒内被点击次数 = 0
```
说明开关本身有效，问题在于**默认值与自启动时机的组合**。

**这属于设计风险，不是崩溃**：若产品意图就是"进了课程中心就自动接着刷"，那就是预期行为；但用户提示里明确担心"一进课程中心就自动点课，用户可能被强制弹窗"—— 实测这个担心是成立的。

---

## 四、V4 —— 死循环风险（结论：不会无限循环，但存在"假性空结果"竞态）

### 4.1 会不会无限跳回课程中心？（结论：不会）
链路：学习页学完 → `05-scheduler` 调 `markCourseDone()` → `returnToHub()` → 课程中心 `pickNext()` → `enterCourse()`。

- **收敛机制有效**：`enterCourse` 失败时 `runOnHub` 会 `markCourseFailed(id)`，`pickNext` 用 `failed.includes(key)` 过滤掉它。实跑多轮确认最终收敛：

```
===== V4-1: 模拟"点击无效"时的多轮 runOnHub =====
   第 1 轮：选中「A课」进入失败 → 记 failed，当前 failed=["A课"]
   第 2 轮：无课可进 → 停止（收敛）
最终 failedCourses = ["A课"]
```

- 学习页侧同样有既有的 `SAME_NAV_MAX` 「同目标反复点」守卫（`05-scheduler.js:456-471`），与本次改动无关，未被破坏。

### 4.2 `failedCourses` 真能拦住死循环吗？（结论：能，但有前提）
能拦住**同名/同键**的课。但见「问题 3」——`failedCourses`/`doneCourses` 的键与卡片键**可能不同源**，此时拦不住。

### 4.3 intent 10 分钟过期后用户一直没进学习页（结论：安全）
```
过期 intent 读取 = null
过期后 store.intent = null （被清掉）
学习页 settleIntentOnStudentPage(过期) 返回 = false , hopped 变化 = 0
```
过期 intent 被 `getIntent()` 主动清除，学习页不会误报"已进入课程"，也不会误加 `hopped` 统计。**通过。**

### 4.4 ⚠️ 并发竞态导致"假性空结果"（结论：**不通过 —— 严重**）
`pickNext()` 用模块级布尔 `_scanning` 做防重入（`06b-course-hub.js:33/295-300/329`）。一旦扫描进行中，**第二次 `pickNext()` 直接 `return null`**。而 `collectCards()` 最长要滚 30 次 × 300ms ≈ **9 秒**，窗口很长。

实测（先让自启动 `start()` 的扫描开始，再并发调用）：
```
t=1.7s: 外部 pickNext = null   ← 被 start() 的扫描挡住，假性"无课可进"
t=10.7s: 再 pickNext = B课      ← 扫描结束后立刻正常
```

后果（真实使用可见）：
1. `runOnHub` 把它当成"没有未看完的课程" → **误弹提示**「课程中心：没有找到未看完的课程，已停止自动选课」，并提前结束调度（`06b-course-hub.js:506-516`）。
2. 若并发来自 `gotoNext` 侧的新一轮，也可能误判"本课学完"路径。

由于 `start()` 在每次进课程中心页都会跑一轮扫描，**用户手动点"下一门"或页面 SPA 变化时极易撞上这个窗口**。

---

## 五、V5 —— 配置迁移（结论：通过）

模拟「老用户配置」`{configRev:3, speed:1.2, mute:false, bankUrl, autoPlay:false, llmKey, stopMode, stopMinutes}`，触发迁移后断言：

| 断言 | 结果 |
|---|---|
| `autoCourseHop === true` | OK |
| `autoCoursePick === true` | OK |
| `configRev === 4` | OK |
| 老字段 `speed/mute/bankUrl/llmKey/stopMode/stopMinutes` **全部保留** | OK |
| 落盘 JSON 中 `configRev=4`、`autoCourseHop=true`、`llmKey` 未丢 | OK |
| `saveConfig` 后不丢新字段（`autoCourseHop` 仍在、`speed` 未丢） | OK |
| **已是 rev4 的用户手动关过的开关被尊重**（不会被反复拉回 true） | OK |

`CONFIG_REV` 3→4 与 `FORCE_UPGRADE` 同步正确；迁移是"只跑一次"（`Number(saved.configRev||0) < CONFIG_REV` 才写回），符合既有设计。

### 独立结论
**通过。** 但请注意：正因为迁移把老用户也强制设成 `true`，V3.5 的"自动点课"风险会**波及全部存量用户**（见问题 1）。

---

## 六、V6 —— 边界与容错（结论：全部通过）

`parseCard` 边界（逐条实测）：

| 输入 | 结果 |
|---|---|
| `parseCard(null)` / `(undefined)` | 返回 `null`，不崩 |
| 空 `div` | 不崩（返回对象，`name=""`） |
| 无 `<h4>` 的卡片 | 降级用 `textContent` 取名，`percent=50` 正确 |
| 文本 `"已完成"` 无百分比 | `finished=true`、`percent=null` |
| `"abc%"` | `percent=null`、`finished=false` |
| `"100"`（无百分号） | `percent=null`、`finished=false`（不会被误判 100%） |
| `"99%"` | `finished=false` |
| `"0%"` | `percent=0` |

`collectCards()` 滚动安全上限：把容器 `scrollHeight` 改成每次读取 +1000（模拟虚拟滚动永不收敛），实测**仍能正常返回、不卡死**（`i<30` 硬上限，`stable>=2` 提前收敛）。
```
OK  scrollHeight 无限增长时 collectCards 仍能返回（有上限）
OK  未卡死（耗时 < 10s）
```
另注：scroller 的 `originTop` 在 `finally` 中恢复，异常路径也不会把用户页面滚动位置弄乱。

---

## 七、问题列表（按严重度分级）

### 严重（会导致功能失效或产生用户可见的错误行为）

**问题 1 —— 默认开 + 无前置自启动 = 打开课程中心页即自动点课（V3.5）**
- 位置：`06b-course-hub.js:595`（无条件 `setTimeout(CourseHub.start, 1500)`）+ `00-config.js:53-54,74-75`（默认 true + FORCE_UPGRADE）。
- 证据：默认配置下，仅打开 hub 页 3 秒内 `clicked=1`。
- 影响：所有老用户升级后，进课程中心即被自动点进一门课（新标签弹窗；兜底还会导航当前标签）。
- **建议修法（大改，只报告不动手）**：加"本次跳转由脚本自身发起"的前置条件——例如仅当存在未过期 `intent` 或上一步来自 `returnToHub` 时才 `runOnHub`；或把两个开关默认改为 `false`，仅由用户主动开启；或至少在 `runOnHub` 前检查 `ZHS.config.autoCoursePick` 之外再加一个"用户已在本次会话点过开始"的标志。

**问题 2 —— `enterCourse()` 在"点击成功、已开新标签"时仍返回 `false`（V2/探针）**
- 位置：`06b-course-hub.js:379-388`。判定用 `if (isHubPage())`，但新标签是**另一个页面**，当前页 `isHubPage()` 永远为真 → 总是走"未检测到跳转"分支 → `return false`。
- 证据：
  ```
  新标签已 window.open = true
  enterCourse 返回 = false
  ```
- 影响：`runOnHub` 收到 `false` 就 `markCourseFailed(课程名)`，**把一门本来能正常学的课拉进失败名单**，下一轮直接跳过：
  ```
  模拟 runOnHub 后 failedCourses = ["高等数学"]
  ```
  即：真正的"成功进入"被误判为"失败"，可能让用户明明想刷的课被跳过。同时 `bumpStat('hopped')` 也不会执行，统计失真。
- **建议修法（小改，见第八节是否已修）**：成功点击后应视为成功（新标签场景），仅在"点击未生效"时才走兜底与 `false`。可用 `window.open` 是否被调用（包装一层）或"点击后本页 URL 未变但已 `click()` 成功"来判定。

**问题 3 —— `doneCourses`/`failedCourses` 的键与卡片键不同源，拦不住重复进入（V4.2/探针）**
- 位置：学习页写入用 `ZHS.state.courseId`（= `recruitAndCourseId`，数字串），而 hub 侧 `pickNext` 过滤用 `cardIdentity(el)`（`data-course-id` 等，字母串）。
- 证据：
  ```
  学习页写入 doneCourses = ["9001"]
  hub 页 data-course-id=C100 时 pickNext = 高等数学   ← 9001 拦不住 C100
  ```
- 影响：**同一门课刷完后可能被再次选中**（`markCourseDone` 失效），`failedCourses` 同理拦不住→ 死循环守卫在键不一致时失效。
- **建议修法（大改，只报告不动手）**：统一键来源。要么 hub 侧也用 `recruitAndCourseId`（从卡片链接/Vue 实例提取，`deriveCourseUrl` 已有类似逻辑可复用），要么学习页写入时改用与卡片一致的 `courseId`。需要真机抓一次两边的实际字段值来定。

### 一般

**问题 4 —— `_scanning` 防重入返回"假性 null"，被上层当成"无课可进"（V4.4）**
- 位置：`06b-course-hub.js:295-300`（返回 `null`）、`506-516`（`runOnHub` 把 `null` 当"无未看完课程"并弹提示）。
- 证据：并发第二次 `pickNext=null`，1.5s 后 `pickNext=B课`。
- 影响：偶发误弹「没有找到未看完的课程，已停止自动选课」，并提前结束本轮调度。
- **建议修法（小改）**：让防重入返回一个可区分的信号（如 `Symbol('busy')` 或抛特定错误），上层据此"稍后重试"而非"当作无课"。

**问题 5 —— `enterCourse` 兜底 `location.href` 与"新标签"策略冲突（与问题 2 同源）**
- 位置：`06b-course-hub.js:377-388`。
- 即使点击已成功开新标签，只要 800ms 内当前页 `isHubPage()` 仍为真，就会执行 `location.href = url`，**把当前标签也导航到学习页**，与"新标签打开"的平台行为叠加，产生两个学习页标签。这与问题 2 是同一处逻辑，修问题 2 时应一并处理。

### 吹毛求疵

**问题 6 —— `bumpStat('hopped')` 双重计数风险**
`enterCourse` 成功时 `bumpStat('hopped')`（`:391`），学习页 `settleIntentOnStudentPage` 成功时也 `bumpStat('hopped')`（`:490`）。同一次"进入课程"可能被记 2 次。统计仅用于展示，影响很小。

**问题 7 —— `parseCard` 的 `"100"` 无百分号不判完成**
设计上合理（避免误判），但若平台某些卡片真的只渲染 `"100"`，就会被当成未完成而反复进入。建议真机确认百分比文案格式。属吹毛求疵，当前实现保守取向正确。

**问题 8 —— `INTENT_TTL`/`LIST_MAX` 为硬编码常量**
无配置项。当前合理，无需改。

---

## 八、本次我是否动手修了？

**没有修改任何 `src/` 文件。** 三个严重问题（1、2、3）都属于需要产品决策或需要真机字段验证的改动，按指示只报告不动手。

我只新增了一个验证脚本 `test/verify-course-hub.js`（82 项断言），供后续回归使用；临时探针脚本（`tools/probe-*.js`）已全部删除。**未 commit / push。**

---

## 九、复现方式（零基础可读）

```bash
cd C:\Users\Administrator\WorkBuddy\2026-09-17-21-07-36\zhihuishu-helper

# 1) 构建产物（把 src 各模块按文件名拼成一个 .user.js）
node build.js

# 2) 跑项目自带单测（244 项）
node test/run.js

# 3) 校验安装页内嵌脚本与产物一致（12 项）
node tools/verify-install-page.js

# 4) 跑本报告的独立验证脚本（82 项）
node test/verify-course-hub.js
```

第 4 个脚本我自己写的，做这些事：
1. 用 `jsdom` 造一个假浏览器页面，用 `vm` 把 `src/*.js` 全部执行进去（和 `test/run.js` 同一套加载方式）。
2. 造一个假课程中心 HTML（3 张课程卡：已完成 / 35% / 0%）。
3. 逐项断言：卡片解析、选课顺序、开关生效、intent 写入与过期、无 DOM 容错、滚动死循环上限、配置迁移、全局副作用。
4. P 段专门复现上面 3 个严重问题的证据，`OK` 表示"缺陷成功复现"。

---

## 十、逐条验收对照

| 项 | 结论 | 关键证据 |
|---|---|---|
| V1 测试结果真实性 | ✅ 通过 | 244/0、12/0、build 成功，全部复现 |
| V2 新功能能跑 | ⚠️ 有疑虑 | 解析/选择/开关/intent 全对；但 `enterCourse` 返回值语义错（问题 2） |
| V3 未破坏原有行为 | ⚠️ 有疑虑 | diff 仅 2 行、作用域干净、`finishAll` 保留、无全局副作用；**但默认开自启动会无前置自动点课**（问题 1） |
| V4 死循环风险 | ⚠️ 有疑虑 | 不会无限循环、failed 能收敛、intent 过期安全；**但 `_scanning` 竞态产假性 null**（问题 4），键不同源使 failed 可能失效（问题 3） |
| V5 配置迁移 | ✅ 通过 | 3→4 正确，新字段置 true，老字段不丢，rev4 用户手动设置被尊重 |
| V6 边界容错 | ✅ 通过 | 13 项 parseCard 边界 + 滚动上限 + 无 DOM 容错，全过 |

**总评：同事的自测报告在"事实层面"是诚实的（数字没造假），但"结论层面"过度乐观**——它验证了快乐路径，把 3 个真实缺陷漏在了自测之外。建议在真机（Edge/Chrome）上补一轮实测，重点看问题 1 与问题 2 的真实表现。
