# round-14 改动对抗性验证报告（review-worker-39）

**验证对象**：commit `0bb3129`（版本 0.6.16）
**验证方式**：读源码 + 用 jsdom 在仓库外临时路径跑真实 `src/*.js` 探针（探针已删除，仓库无改动、无 commit）
**测试基线**：`node test/run.js` → **通过 275 / 失败 0**（与声称一致）
**仓库状态**：`git status` 干净，`src/` 未被修改

---

## 结论速览

| 块 | 结论 | 严重度 |
|---|---|---|
| A1 `_transientReloads` 从不重置 | **发现缺陷**（确认） | 中 |
| A2 自愈 `start({manual:true})` 清零计数 | **发现缺陷**（确认） | **高** |
| A3 MutationObserver 高频/抖动 | **不成立**（debounce 是尾部触发，反而会推迟自愈） | — |
| A4 `stop()` 默认参数漏网调用点 | **发现缺陷**（`condition` 分类是死代码） | 低 |
| B 面板先发布后初始化 | **链路成立但会掩盖真实错误**（确认） | 中 |
| C 课时标识回滚 | **主体验证通过**；附带发现 `_navFailCount` 软死循环 | 中 |
| D 切换验收第二信号 | **发现缺陷**（标题重复误判 + 修复不彻底 + fromKey=null 退化） | 中高 |

---

## A. 停机原因分类 + 受限自愈

### A1【缺陷·确认】`_transientReloads` 从未被重置

**证据**：全仓库 grep `_transientReloads` 只有两处 ——
- `src/05-scheduler.js:206` 读取上限判断
- `src/05-scheduler.js:213` 自增

**没有任何地方清零**。`Scheduler` 上也不存在任何 `reset*` 方法（探针实测 `Object.keys(Scheduler)` 中 reset/clear/init 类方法为 `[]`）。

**可复现场景**（探针实测输出）：
```
第 1 次瞬时故障自愈 → true,  _transientReloads=1
第 2 次瞬时故障自愈 → true,  _transientReloads=2
第 3 次瞬时故障自愈 → true,  _transientReloads=3
—— 此时用户「手动点启动」（start({manual:true})）——
手动 start 后 _transientReloads 仍 = 3   ← 期望应为 0
第 4 次瞬时故障自愈 → false              ← 永久不再自愈
```

**这是真 bug**：脚本跑一整天，遇到 3 次互不相关的瞬时故障（每次都已成功自愈、脚本正常跑了很久）后，第 4 次就永久不能自愈了。用户在面板上点「启动」也不会重置它。
**正确做法**：`start()` 里应重置 `_transientReloads = 0`（或至少在 `start({manual:true})` 用户手动启动时重置）；也可在「成功跑过一段稳定时间」后衰减。

### A2【缺陷·确认·高危】自愈重启把停止条件计数清零

**证据**：`src/05-scheduler.js:70-74`
```
ZHS.state.startedAt = Date.now();   // 每次启动重置计时
this._navCount = 0;
this._completedThisRun = 0;         // 停止条件：本次运行完成节数
```
`tryResumeAfterTransientStop()`（:215）调用 `this.start({manual:true})`，因此**每次自愈都会执行上述重置**。

**可复现场景**（探针实测）：
```
设置 stopMode='lessons', stopLessons=10
自愈前 _completedThisRun = 7      （阈值 10 节停）
自愈后 _completedThisRun = 0      ← 7→0，永远凑不够 10 节
自愈后 _navCount = 0
```

后果：
1. **「设了看 N 节就停」永远达不成** —— 每遇一次瞬时故障就清零，10 节课可能永远停不下来（也正是用户抱怨的「设了停止条件停不住」复发）。
2. **时长统计错乱** —— `startedAt` 被重置，`finishAll` 的「总耗时」（`05-scheduler.js:651` `Date.now() - ZHS.state.startedAt`）只统计自愈之后的时间，报告里的耗时少算、甚至「累计观看」口径失真。
3. `_navCount` 清零还会让总结里的「本次切换课时数」少算。

**正确做法**：`start(opts)` 应区分「全新启动」与「自愈恢复」——恢复时不重置 `startedAt/_completedThisRun/_navCount`。可加 `opts.resume` 标志。

### A3【结论：不成立】MutationObserver 高频调用 / 抖动循环

- `src/01-util.js:44` 的 `debounce` 是**尾部触发**（每次都 `clearTimeout` 再重设），**DOM 持续变化时回调被无限推迟，只有静止满 1s 才执行一次**。探针实测：连续触发 50 次 → 立即执行 0 次；1.3s 后执行 1 次。
- 因此「视频播放中 DOM 常变 → tryResume 被高频调用」**不成立**，反而会**推迟**自愈（播放视频时页面几乎不停变化，`watchSpa` 回调可能长时间不触发）。这是设计上的隐患，但不是「高频调用」。
- 真实的「抖动」形态（探针实测）：`start()` 会重置 `_navFailCount=0`（:73），所以自愈起来后同一个坏节点又能再失败 5 次才 `stop('transient')` → 再自愈。周期约「60s 冷却 + 5 次点击」，**每轮 `_transientReloads` +1，3 轮后永久停**。不会无限循环（上限 3 兜住了），但 3 轮内会反复空转点同一坏节点，且每轮 A2 的计数清零问题叠加。

### A4【缺陷·确认】`stop()` 默认参数漏网调用点

全仓库 `this.stop()` / `Scheduler.stop()` 调用点：
| 位置 | 语义 | 传入 | 评价 |
|---|---|---|---|
| `06-panel.js:1023` | 用户点停止 | 默认 user | ✅ 正确 |
| `07-main.js:215` | `zhs.stop()` | 默认 user | ✅ 正确 |
| `05-scheduler.js:527` | 全部学完 + autoCourseHop 跳课 | 默认 user | ⚠️ 语义上更像 `condition` |
| `05-scheduler.js:689` | `finishAll`（全部看完/达标停） | 默认 user | ⚠️ 语义上应为 `condition` |

**更关键**：`'condition'` 这个分类**从未被任何调用点传入**——grep 全仓库，`'condition'` 只出现在 `05-scheduler.js:170` 的 JSDoc 注释里。也就是说 `condition` 是**死分类**，只存在于文档和测试里（测试是手动 `S.stop('condition')` 造的）。
`finishAll` → `this.stop()` 实际走 `user`。效果上 user 与 condition 都会 `_halted=true`、都不会被自愈，所以**无功能危害**，但设计声明的三分类名不副实，属于「声称做了但没接上」。

---

## B. 面板先发布后初始化

**链路验证：成立，且会掩盖真实错误（确认）**

探针在 `06-panel.js` 的 `const Panel = {` 之前注入抛错，模拟模块体中途异常：
```
加载 06-panel.js 出错：模拟：面板模板/对象定义中途抛异常
ZHS.panel === {}                        ← 占位对象已发布（06-panel.js:17 生效）
ZHS.panel.mount 类型 = undefined
ZHS.__panel_ready = undefined           ← 末尾 Object.assign 未执行（1376 行不可达）
ZHS.__mod06_panel 守卫已锁 = true        ← 模块永不再执行
→ 进入 07-main:93 的 true 分支 → mount() 抛 TypeError: ZHS.panel.mount is not a function
```

逐条回答：
1. **`if (ZHS.panel) ZHS.panel.mount()` 会进入 true 分支吗？** 会。`{}` 是 truthy。→ 调 `undefined` 的 `mount()` → 抛 `TypeError: ... is not a function`。✅ 链路成立。
2. **红条会显示吗？** 会。`07-main.js:94` 的 catch 块里调用了 `showPanelMissingNotice('挂载异常')`（:97）。兜底可见性达标。
3. **会不会掩盖真正错误？** **会，且是本块的最大问题**：
   - 真实的异常信息（"模拟：面板模板/对象定义中途抛异常"）在 `bootOnce` 里被 `catch` 掉，只写成 `ZHS.Log.warn('面板挂载失败：' + TypeError 消息)`——**日志里记的是 `TypeError: mount is not a function`，而不是面板真正的故障原因**。排查方向被带偏。
   - `07-main.js:99-103` 的 `else` 分支（`未识别到 ZHS.panel → 打 error 日志 + 红条"模块未就绪"`）**永远不可达**，因为 `ZHS.panel` 已被填成占位对象。那句「面板模块不可用」的诊断日志再也不会打印。
   - 而且守卫 `__mod06_panel` 已锁，**刷新前面板无法自愈**（这正是本轮想解决的"永久 undefined"，现在换成了"永久空对象"，本质一样：仍然不自愈，只是多了个红条）。

**建议**：`07-main` 的判据应从 `if (ZHS.panel)` 改为 `if (ZHS.__panel_ready || (ZHS.panel && typeof ZHS.panel.mount === 'function'))`，并在 `bootOnce` 的 catch 里把**原始异常**（而非挂载时的 TypeError）暴露到红条/日志。

---

## C. 课时标识回滚

### C 主体：**验证通过**

探针实测（stub `clickAndVerify` 恒返回 false）：
```
切换前 ZHS.state.lessonKey = "第一节"
gotoNext 结束后 ZHS.state.lessonKey = "第一节"     ← 回滚正确，没记到「第二节」
_rebindAfterNav 期间 bindVideo 调用 = [{lessonKey:"第一节"},{lessonKey:"第一节"}]
```

逐条回答你的三个问题：
1. **回滚后 `_rebindAfterNav(5000)` 用旧 `_prevKey` 去绑 video —— 对吗？**
   **对，不会把旧节进度又刷一遍。** 原因：这次 rebind 的动机是「把进度监听器重新挂回当前播放器」。此时页面**仍停在第一节**，所以用旧键绑定是**键值正确的**。绑定本身只加/换监听器，真正写进度发生在 `timeupdate`/`pause`（`04-resume.js:141-180`），写入键 = 当前节 = 第一节，写的是第一节自己的进度，不串台。回滚保护的核心目标（不把进度记到错的节上）达成。
   唯一小瑕疵：失败分支**没有调 `Resume.reset()`**（成功分支才调，`05-scheduler.js:611`），所以旧节的监听器是被 `bindVideo` 内部 `_detach()`（`04-resume.js:134`）替换掉的，行为正确但不如成功分支显式。
2. **成功分支写入顺序是否一致？** **一致。** 探针实测顺序：
   ```
   1. bindVideo(k=第一节)               ← bootOnce 的初始绑定
   2. Resume.reset()                    ← 05-scheduler:611
   3. bindVideo(k=第二节, state.lessonKey=第二节)  ← _rebindAfterNav:710，用的是已更新的新键
   ```
   `ZHS.state.lessonKey = _targetKey`（:600）在 `Resume.reset()`（:611）与 `_rebindAfterNav()`（:616）之前，顺序正确。✅

### C2【缺陷·确认】`_navFailCount` 跨节清零 → 软死循环

**证据**：`05-scheduler.js:580`
```
this._navFailCount = (_targetKey === this._navFailKey ? this._navFailCount : 0) + 1;
```
`SAME_NAV_MAX=5` 的「连点同一目标 N 次才停」保护，只在**同一个目标**反复失败时生效。若平台有 5 个不同的坏节点，每次 `findNext` 给出不同目标 → `_targetKey` 每次都变 → `_navFailCount` 每次重置为 1 → **永远凑不满 5 → 不会停机，但也永远前进不了**（软死循环，只能靠其他路径的 60s 自愈兜底，而自愈上限 3 次后会误报"请手动点启动"）。
这是「点了下一节也没用」的一种残留形态。

---

## D. 切换验收第二信号

### D1【缺陷·确认】标题重复 → `nowIsTarget` 误判

**证据**：`02-adapter.js:714` `if (curKey === titleKey) return true;` —— 判据只比较**标题文本**，而标题不是唯一键。

**可复现场景**（探针实测）：目录里有两个同名节「习题讲解」：
```
itemTitle(第2项) = "习题讲解"
itemTitle(第3项) = "习题讲解"
findByName("习题讲解") 命中：第一项（永远命中第一个同名项）
```
把「第一个习题讲解」设为 current 后，若目标是「第二个习题讲解」，`itemTitle(current()) === titleKey` 成立 → `nowIsTarget()` 返回 true → **切错节也判成功**，`_completedThisRun` 虚增、进度可能记到错的节上。智慧树的「习题讲解」「章节测验」同类标题非常常见，命中概率不低。
（另注：`findByName` 的「包含匹配兜底」（:616）更宽松，同名/包含场景下会拿到错误节点。）

### D2【缺陷·确认】`fromKey` 为 null 时第二信号退化为「只看 active」

**证据**：`02-adapter.js:756` `if (!fromKey) return false;` + `730` 判据 `hasActive(target) && !this._stillOnFrom(fromKey, titleKey)`。
```
fromKey = null → _stillOnFrom(null,"第二节") = false
→ 判据 = hasActive(target) && true = hasActive(target)   ← 第二信号完全失效，退回旧行为
```
**调用点核查**：`05-scheduler.js:576` 调用 `clickAndVerify(next, {..., fromKey: _prevKey})`，`_prevKey = ZHS.state.lessonKey`（:570）。
- 正常运行中 `lessonKey` 由 `bootOnce`（07-main:144）设过，一般非空 → 多数场景有第二信号。
- 但首次点击、或 `lessonKey` 恰为空（目录未识别/新页）时 `fromKey=null` → 第二信号失效。**这是设计缺陷（判据依赖可选参数），不是崩溃**。

### D3【缺陷·确认·修复不彻底】`hasActive` 收窄了 `container`，但 `current()` 没收窄

本轮把 `hasActive` 的 `document.querySelector(ad.active)` 收窄到 `ad.container`（`02-adapter.js:647`），**但 `current()`（:380-388）仍是 `document.querySelector(this.adapter.active)` 全局查询**。而第二信号 `nowIsTarget()` / `_stillOnFrom()` 全都基于 `current()`。两者对「谁是当前节」可能给出**不同答案**：

**可复现场景**（探针实测）：
```
页面顶部目录里当前项是「第一节」，
播放器区另有一个带 current、标题恰为「第二节」的 .child-info（全局命中）。
current() 命中 id = x（播放器区）
itemTitle(current()) = "第二节"
→ nowIsTarget() 直接 return true → 假成功
```
即：**本轮收窄 `hasActive` 消掉了「0 毫秒假成功」的一条路，但第二信号 `current()` 走的还是那条没收窄的老路，把假成功又从另一侧放回来了**。修复方向应统一：`current()` 也应优先在 `ad.container` 内查询，或第二信号改用「与 `hasActive` 同一作用域」的判定。

---

## 附：验证方法说明（可复现）

- 探针统一用 `test/run.js` 同款方式加载 `src/*.js`：jsdom `runScripts:'outside-only'` + `vm.runInContext`，逐个文件注入。
- 探针文件写在仓库外 `C:\tmp\zhs-probe\`（Write 工具的 `/tmp` 映射到该物理路径），**验证后已删除**；未触碰 `src/`、未 build、未 commit（`git status` 干净）。
- `node test/run.js`：**275 通过 / 0 失败**。

## 建议优先修复（按危害排序）

1. **A2**：`start()` 区分全新启动 / 自愈恢复，恢复时不清 `startedAt/_completedThisRun/_navCount`（高：直接导致停止条件失效、统计失真）。
2. **A1**：`start()`（至少手动启动时）重置 `_transientReloads=0`（中：一天 3 次故障后永久不自愈）。
3. **D3**：`current()` 同步收窄到 `ad.container`，或第二信号改用与 `hasActive` 一致的判定（中高：假成功回流）。
4. **D1**：`nowIsTarget` 改用「元素身份/索引」而非纯标题文本比较；同名节不应互判成功。
5. **B**：`07-main` 判据改 `__panel_ready`/`typeof mount==='function'`，catch 里暴露**原始异常**而非 TypeError（中）。
6. **C2**：`_navFailCount` 改为「本次运行累计失败」并设全局上限，避免多坏节点轮流失败导致软死循环。
7. **A4/D2**：把 `'condition'` 接到 `finishAll`/达标停调用点；`clickAndVerify` 第二信号在 `fromKey` 缺失时应有独立兜底。
