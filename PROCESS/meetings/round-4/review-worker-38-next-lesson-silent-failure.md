# Round-4 代码审查：一集放完 → 切下一节的「静默失败」路径全排查

- 审查人：review-worker-38（只读静态审查，**未修改任何文件、未 commit**）
- 审查对象：`src/05-scheduler.js`（onLessonEnd / gotoNext / tick）、`src/02-adapter.js`（目录识别 / findNext / clickAndVerify / statusOf / hasActive）、`src/04-resume.js`（进度绑定）
- 代码基线：本机当前工作区（2026-09-19 读取）
- 用户痛点对应：「不能自动跳转下一集 / 点了下一节也没用」

---

## 0. 结论先行（三句话）

1. **最近几轮修复方向是对的**：`gotoNext` 现在会「点击后校验 active（`clickAndVerify`）」「连点同一目标 5 次无反应就停手告警」，`onLessonEnd` 的完成判定统一到 95%、读到 0% 也切下一节。**「点了一下就走、没人管」那个最原始的坑已经堵上。**

2. **但「切换是否真的成功」的验收标准仍然太窄**：目前只认「目标条目拿到了 `active` 类」。凡是平台**不给当前项打 active 标记**、或页面别处**碰巧有个 active**、或 **active 只是晚几拍才落到 DOM**，验收就会出错——要么**假失败**（其实切过去了却判失败，白等 9 秒 + 重复点击），要么**假成功**（根本没切却判成功，`_completedThisRun++` 虚增，收敛到「全部看完」的假总结）。这正是用户说的「以为切了其实没切」。

3. **另有 6 条真实存在的静默失败路径**（下面按严重程度排序逐条给证据与修复代码）。其中最重的一条（P1）是：**点击失败后 `lessonKey` 不回滚**，会把「下一集的进度」记到「本来那一集」的标题上，导致续播跳错节、完成判定打在错节点上、静默跳过整节课。

下面是完整链路图 + 缺陷清单。

---

## 1. 完整链路图：「一集放完 → 判定完成 → 找下一节 → 点击切换 → 写进度」

```
tick()  [05-scheduler.js:197]
  └─ _tickInner()  [05-scheduler.js:212]
       ├─ 守卫1 验证码（有则暂停等人工，带 2 分钟上限） [217-235]
       ├─ 守卫2 弹题（有则暂停/作答，带预算）           [243-315]
       ├─ 守卫3 阻塞弹窗（有则点关闭，本轮 return）      [319-326]
       ├─ video 为空 → 连续 3 轮才当文档节点 gotoNext    [330-340]
       ├─ Player.checkStall / ensurePlaying（保活）      [343-349]
       ├─ 【冷却闸门】距上次切课 <15s → 跳过结束判定      [355-357]   ← 见 P5
       └─ Player.atEnd(video) 为真 → onLessonEnd(video)  [359-361]

onLessonEnd(video)  [05-scheduler.js:372]
  ├─ _navigating 重入锁（已有则直接 return）            [373-374]
  ├─ locateCur()：用 state.lessonKey 找回「本轮这一节」 [377-379]
  │     失败则退到 Catalog.current()
  ├─ 轮询等待「完成标记 或 进度>=95」，上限 8 秒        [384-390]
  │     注意：进度读数取自【当前节 cur】，cur 可能为 null
  ├─ 分支① isFinished(cur) → gotoNext('本课时已完成')   [393-398]
  ├─ 分支② progress>=95    → gotoNext('本课时已完成')   [403-408]
  ├─ 分支③ progress<=0     → gotoNext('视频播放完毕')   [411-416]  ← 最激进，见 P6
  ├─ 分支④ 1<=progress<90 → 回退重播（最多 2 次）       [420-427]
  └─ 分支⑤ 兜底 → gotoNext('课时结束，切换下一节')       [430-431]

gotoNext(reason, opts)  [05-scheduler.js:442]
  ├─ 锁归属：手动遇忙则提示后 return，否则复用/持锁      [446-452]
  ├─ cur = findByName(lessonKey) || Catalog.current()   [458-460]   ← null 后果见 P2
  ├─ bd = breakdown()（内含 ensureCatalogLoaded 懒加载） [465]
  ├─ next = skipFinished ? findNext(cur) : _nextInOrder  [467-469]
  │     findNext 会「先往后找 → 从头补漏」；全完成返回 null
  ├─ next === null 的三分支：                            [471-497]
  │     total===0        → 告警「未识别目录」+ stop()   [472-476]
  │     undone===0        → 自动跳课 或 finishAll（真完成）[477-489]
  │     undone>0 但找不到 → 告警「定位失败」+ stop()     [490-494]   ← 静默停手，见 P3
  ├─ 人类化随机延迟 2~8 秒（手动跳过）                   [503-510]
  ├─ 停止闸门复查 running（手动绕过）                    [515-518]
  ├─ 【写 lessonKey = 目标标题】（**点在验证之前**）      [521-522]    ← P1 的根
  ├─ clickAndVerify(next, {timeout:3000, tries:2})      [527]
  │     └─ 内部：hasActive? → click → 轮询 hasActive → 补点一次
  ├─ 失败分支：_navFailCount++，>=5 → stop()+alert       [528-542]  ← P4
  │            否则 alert「未生效，正在重试」+ _rebindAfterNav
  └─ 成功分支：清零计数、_navCount++、_completedThisRun++[545-548]   ← 假成功的放大器
                _lastNavAt = now（冷却闸门起点）         [549]
                reset resetReset + videoEl=null          [552-555]
                sleep(3000) → _rebindAfterNav()          [557-558]

_rebindAfterNav()  [05-scheduler.js:640]
  ├─ waitFor('video', 20000)（等不到就 warn 后返回，**不报错**）[641-646] ← P7
  ├─ Resume.bindVideo(video, courseId, lessonKey)       [650]
  │     └─ 若 video 同一元素 + courseId/lessonKey 相同 → 早退（04-resume.js:131）
  └─ 日志「已切换并重新绑定：lessonKey」

Resume.bindVideo  [04-resume.js:127]
  ├─ 守卫：同 video 同课同节 → return（不重绑）          [131]      ← P1 的帮凶
  ├─ _detach() 解绑旧监听                              [134]
  ├─ 挂 timeupdate / pause / pagehide 监听（闭包持有 lessonKey）[182-190]
  └─ save() 时以闭包里的 lessonKey 为准                 [159/172/179]
```

**关键观察**：整条链路上「切换成功」的判定只有一个信号——`target` 是否拿到 `active` 类（`02-adapter.js:627-647` 的 `hasActive`）。没有第二个独立信号（视频 src 变化 / 路由变化 / 当前节标识变化）交叉验证。所有静默失败都从这个单点信号的真假两端漏出来。

---

## 2. 缺陷清单（按严重程度排序）

> 说明：严重程度 = 对用户「跳不动 / 跳错 / 假完成」的影响 × 触发概率。
> 每条给：文件路径 + 行号 + 触发条件 + 严重程度 + 具体修复代码。

### 🔴 P1（严重）切换失败后 `lessonKey` 不回滚 → 进度记错节 + 完成判定打错节点

- **位置**：
  - `src/05-scheduler.js:521-522`（点击**之前**就写 `ZHS.state.lessonKey = _targetKey`）
  - `src/05-scheduler.js:528-541`（失败分支没有把 lessonKey 改回去，反而执行 `_rebindAfterNav()`）
  - `src/04-resume.js:127-131`（bindVideo 用这个错的 lessonKey 绑定）
  - `src/05-scheduler.js:377-379`（下一轮 `onLessonEnd.locateCur()` 也读这个值）
- **触发条件**：`clickAndVerify` 返回 false（平台改版 / 目标被遮挡 / active 标记没落到 DOM），即「点了没切过去」。此时 `lessonKey` 已经是**下一节**的标题，但页面实际还在**原来那一节**播。
- **后果链**（三处都是静默的）：
  1. `_rebindAfterNav` → `Resume.bindVideo(video, courseId, 下一节标题)`。
     - 若 SPA 复用同一个 `<video>` 元素（智慧树新版 Aliplayer 常见），`04-resume.js:131` 的守卫会因「同 video + 同 courseId + lessonKey 与上次不同」而**重绑**，监听器闭包换成「下一节标题」→ **实际在播的旧课，进度被记到下一节的键上**。
     - 若 video 换了新元素，同样把「下一节」记成新键，而播放的可能是旧课。
  2. 下一轮 `onLessonEnd.locateCur()`（`05-scheduler.js:377-379`）按 `lessonKey=下一节` 找回的是**没切过去的那一个节点**，完成判定（`isFinished`/`progressOf`）打在**错误节点**上。
  3. `gotoNext` 的 `cur`（`458-460`）也据此定位 → `findNext(cur)` 从错误位置往后找 → **静默跳过一整节课**（用户感知：某一集没看，进度却显示在往后走）。
- **用户可感知症状**：续播跳到错误的集数；某集明明没看却「变绿了」；报告里完成节数虚高。
- **严重程度**：🔴 严重（数据错位，且不报错、不告警，用户只能事后发现）
- **修复方案**（在 `05-scheduler.js:521` 附近先存旧值，失败时回滚）：

  ```js
  // 05-scheduler.js，替换 520-522 行附近
  // 记录新课时标识，供续播使用
  const _prevKey = ZHS.state.lessonKey;          // ← 新增：先存旧值
  const _targetKey = cat.itemTitle(next);
  ZHS.state.lessonKey = _targetKey;

  const switched = await cat.clickAndVerify(next, { timeout: 3000, tries: 2 });
  if (!switched) {
    // ← 新增：点击没生效，lessonKey 必须回滚，否则进度会记到错误节
    ZHS.state.lessonKey = _prevKey;
    this._navFailCount = (_targetKey === this._navFailKey ? this._navFailCount : 0) + 1;
    // …（其余失败处理保持不变）
  }
  ```

  另外建议 `Resume.bindVideo` 增加「显式重绑」参数，或在失败分支**不调用** `_rebindAfterNav`（因为没切过去，video 没变，不需要重绑；此时重绑只会用错的 lessonKey 污染绑定）。

---

### 🔴 P2（严重）`cur` 定位失败 → `findNext` 回退到「第一个未完成项」→ 每轮点同一节 → 5 次后硬停

- **位置**：
  - `src/05-scheduler.js:458-460`（`cur` 可能为 null：`findByName(lessonKey)` 与 `Catalog.current()` 都落空）
  - `src/02-adapter.js:564-601`（`findNext`：`fromEl` 为 null 时 `startIdx=0`，恒返回首个 undone）
  - `src/05-scheduler.js:528-536`（`_navFailCount>=5` → `stop()` + `_halted=true`）
  - `src/02-adapter.js:609-618`（`findByName` 精确匹配失败后走**双向 includes**，短标题互相包含会命中错节点）
- **触发条件**（任一）：
  - `itemTitle` 吐出空串 / 纯序号 → `findByName('')` 直接返回 null（`02-adapter.js:610`）；
  - 点击后 SPA 重渲染，标题文本发生细微变化（省略号、空格、序号前缀），精确匹配 + 包含匹配都落空；
  - 目标节点根本不在 `items()` 里（文档/PPT 节点不被 `ad.item` 命中）。
- **后果**：`cur=null` → `findNext(null)` 永远返回同一个「首个未完成项」→ `_targetKey` 每轮相同 → `_navFailCount` 累加 → 第 5 次 `stop()` 并置 `_halted=true`，此后连自动 `start()` 都被拦（`05-scheduler.js:64-67`）→ **脚本彻底不动，且只有一条 error 级 alert**。
- **严重程度**：🔴 严重（静默停机，用户以为在跑其实已瘫）。
- **修复方案**（给 `cur` 定位失败兜底 + `findByName` 收紧模糊匹配）：

  ```js
  // 02-adapter.js，findByName 收紧双向 includes（替换 609-618）
  findByName(key) {
    if (!key) return null;
    const all = this.items();
    let hit = all.find((el) => this.itemTitle(el) === key);
    if (hit) return hit;
    // ← 收紧：仅允许「条目标题包含 key」的单向匹配，且 key 长度 >= 4，
    //   避免短标题（如 "1"、"A"）双向 includes 命中一堆无关节点
    const k = String(key).trim();
    if (k.length < 4) return null;
    return all.find((el) => {
      const t = this.itemTitle(el);
      return t.length >= 4 && (t.indexOf(k) >= 0 || k.indexOf(t) >= 0);
    }) || null;
  }
  ```

  ```js
  // 05-scheduler.js，gotoNext 里给 cur 兜底（替换 458-460 附近）
  let cur = ZHS.state.lessonKey
    ? (ZHS.Catalog.findByName(ZHS.state.lessonKey) || ZHS.Catalog.current())
    : ZHS.Catalog.current();
  // ← 新增：cur 仍为 null 且目录里有当前项时，用 active 兜底；再不行也不让 findNext 从 0 开始误点首项
  if (!cur) {
    const catCur = ZHS.Catalog.current();
    if (catCur) cur = catCur;
    else {
      ZHS.Log.warn('无法定位当前课时（lessonKey=' + ZHS.state.lessonKey + '），暂停自动跳转以免重复点击首项');
      if (ZHS.panel) ZHS.panel.alert('无法定位当前课时，已暂停自动跳转，请手动检查目录', 'warn');
      return;   // 不停机、不误点，等下一轮 DOM 稳定后重试
    }
  }
  ```

---

### 🟠 P3（高）`findNext` 返回 null 且 `undone>0` 时静默 `stop()`——「未解锁」「标题读不出」被当成「没得跳」

- **位置**：
  - `src/05-scheduler.js:490-494`（`undone>0` 但找不到 → warn + `stop()`）
  - `src/02-adapter.js:514-522`（`statusOf`：`itemTitle` 为空直接判 `NA`，而 `findNext` 只接受 `UNDONE`）
  - `src/02-adapter.js:569`（`pickable` 仅 `=== STATUS.UNDONE`，**跳过 `LOCKED` 与 `NA`**）
  - `src/02-adapter.js:577-579`（`findNext` 在两个循环里都只挑 `UNDONE`，中间夹着的 locked/na 直接跨过去——这是对的，但若**只剩 locked/na** 就返回 null）
- **触发条件**：目录里所有「未完成」条目要么是 locked（前置没完成），要么 `itemTitle` 读不出来（判成 NA）。用户感知：**脚本停了，但面板上明明还有没看完的节**。
- **后果**：`stop()`（`_halted=true`）→ 用户手动点「启动」才能恢复，且会再次撞上同一堵墙。日志里只有一句 warn，用户未必看到。
- **严重程度**：🟠 高（功能性停止，但有告警，比 P1/P2 稍好）。
- **修复方案**（把「全是 locked」与「全是 NA」区分开，并给出更准确的话术与自救建议）：

  ```js
  // 05-scheduler.js，替换 490-494 分支
  } else {
    const lockedCount = (cat.scan() || []).filter((x) => x.status === ZHS.STATUS.LOCKED).length;
    if (lockedCount > 0 && lockedCount >= bd.undone + lockedCount) {
      // 剩下的全是未解锁：不是脚本坏了，是前置没完成
      ZHS.Log.warn('剩余 ' + lockedCount + ' 节均未解锁（需先完成前置课时），自动跳转暂停');
      if (ZHS.panel) ZHS.panel.alert('剩余课时未解锁，需先完成前置课时。请手动确认学习顺序', 'warn', 12000);
    } else {
      ZHS.Log.warn('还有 ' + bd.undone + ' 节未完成，但无法定位到可点击节点（可能被锁定或选择器不匹配）');
      if (ZHS.panel) ZHS.panel.alert('还有 ' + bd.undone + ' 节未完成但定位失败，请检查目录', 'warn');
    }
    this.stop();
  }
  ```

---

### 🟠 P4（高）假成功：`hasActive(target)` 为真 ≠ 真的切过去了

- **位置**：
  - `src/02-adapter.js:686-714`（`clickAndVerify`：**唯一**判据是 `hasActive(target)`）
  - `src/02-adapter.js:627-647`（`hasActive` 的假阳性来源）：
    - `:643` `document.querySelector(ad.active)` 取的是**全页第一个**匹配元素（不限定在目录容器内）；
    - `:644` `cur.contains(el)` —— 若某个**祖先容器**带 `ad.active`，则任意条目都判成「已切换」；
    - `:638` 通用词 `active|current|selected|playing` 在容器类元素上也很常见。
- **触发条件**（任一）：
  - `findNext` 因 `cur` 定位错误而「从头补漏回绕」，返回的正是**当前正在播的那一节** → `hasActive(target)` 立刻为真 → `clickAndVerify` 0 毫秒返回 true；
  - 页面别处（推荐位/tab/面包屑）有 `.active` 祖先容器包住了目录条目。
- **后果**：`05-scheduler.js:545-548` 清零失败计数 + `_navCount++` + `_completedThisRun++`，**实际一节课都没前进**。`_completedThisRun` 虚增会让 `stopMode='lessons'` 提前触发假「完成 N 节」总结。
- **严重程度**：🟠 高（假成功，静默，且污染停止条件）。
- **修复方案**（加「不能是同一节」的第二判据 + `hasActive` 作用域收口）：

  ```js
  // 02-adapter.js，clickAndVerify 内，替换 692-699 附近的判据
  const titleKey = this.itemTitle(el);
  const prevKey = ZHS.state.lessonKey;      // ← 点击前的当前节标识
  let target = el;
  for (let i = 0; i < tries; i++) {
    // ← 改为：必须 hasActive 且「当前节已经不是点击前那一节」
    if (this.hasActive(target) && ZHS.state.lessonKey !== prevKey) return true;
    this.click(target);
    const ok = await waitUntil(
      () => this.hasActive(target) && ZHS.state.lessonKey !== prevKey,
      i === 0 ? timeout : timeout * 2, 150
    );
    if (ok) return true;
    // …（重定位逻辑不变）
  }
  ```

  ```js
  // 02-adapter.js，hasActive 作用域收口（替换 642-645）
  try {
    // ← 限定在目录容器内查 active，避免被页面别处的 .active 抢走/误判
    const scope = (ad.container && document.querySelector(ad.container)) || document;
    const cur = ad.active ? scope.querySelector(ad.active) : null;
    if (cur && (cur === el || el.contains(cur) || cur.contains(el))) return true;
  } catch (e) { /* 选择器兼容 */ }
  ```

  > ⚠️ 注意：上面「`ZHS.state.lessonKey !== prevKey`」依赖 P1 的修复——若 P1 不修，`lessonKey` 在点击前就被改成了目标值，这里会永远不等，必须与 P1 一起改。

---

### 🟡 P5（中）冷却闸门在失败分支被自己耗光 → BUG-PB-4（12 秒跳一节）有复发路径

- **位置**：
  - `src/05-scheduler.js:539-540`（失败分支先打 `_lastNavAt` 再 `await _rebindAfterNav()`）
  - `src/05-scheduler.js:641`（`_rebindAfterNav` 里 `waitFor('video', 20000)`）
  - `src/05-scheduler.js:355-357`（闸门判据 `Date.now() - _lastNavAt < 15000`）
- **触发条件**：目标是**文档/PPT 节点**（本来就没 video）→ 点击失败 → 失败分支 `_lastNavAt=now` → `_rebindAfterNav` 的 `waitFor('video')` 满额等 20 秒 → 20s > 15s，闸门已失效 → 下一轮 tick 立刻恢复结束判定，而页面里可能还是上一节的 ended video → 再次 `gotoNext` → **再来一轮 9s + 20s**。
- **后果**：单轮主线程被 `_busy` 独占最长约 29 秒（3s+6s clickAndVerify + 20s rebind），期间**验证码守卫、弹题守卫、保活全部停摆**；若恰好有弹题弹出，会无人作答。
- **严重程度**：🟡 中（不会永久错，但体验差、且有守卫盲区）。
- **修复方案**（失败分支缩短 rebind 等待 + 给整段套预算）：

  ```js
  // 05-scheduler.js，_rebindAfterNav 增加超时参数（替换 640-641）
  async _rebindAfterNav(timeoutMs) {
    const budget = Number.isFinite(timeoutMs) ? timeoutMs : 20000;
    let video = await U.waitFor('video', budget);
    // …
  }

  // 失败分支调用时用短超时（替换 540）
  this._lastNavAt = Date.now();
  await this._rebindAfterNav(5000);   // ← 没切过去，本来就不该长等
  ```

---

### 🟡 P6（中）分支③「progress<=0 就跳」过于激进：锁定/新节的 0% 会被当成「看完了」

- **位置**：
  - `src/05-scheduler.js:411-416`（`progress <= 0` → 直接 `gotoNext('视频播放完毕')`）
  - `src/02-adapter.js:553-557`（`progressOf`：`isFinished` 返回 100，否则 `_readProgress`；**读不到进度就是 0**）
  - `src/02-adapter.js:469-480`（`_readProgress` 无进度选择器 / 选择器未命中 → 0）
- **触发条件**：当前页面的适配器**没有配 `progress` 选择器**（如 fusion / card2025 就**没配** `progress`，见 `02-adapter.js:39-49`、`77-87`），或进度元素还没渲染 → `progressOf` 恒为 0 → 只要视频 `atEnd`，无论平台是否记录完成，一律跳下一节。
- **为什么是问题**：这是「宁可错跳不可重播」的取舍，但代价是**平台没记上学时也照跳**，用户回看时该集进度仍是 0（虽然不会卡住，但学时可能丢）。注释里已提到「先复查一次再决定切」（`PROGRESS_RECHECK_MS = 10000`，`05-scheduler.js:32-33`）——**但该常量在整个文件里从未被使用**（见下方证据），说明「读 0% 先复查」的设计**没有落地**。
- **严重程度**：🟡 中（权衡后接受，但「复查」设计缺实现，属承诺与代码不符）。
- **修复方案**（把「读 0% 先复查一次」真正实现）：

  ```js
  // 05-scheduler.js，分支③ 之前插入复查（替换 410-416）
  if (progress <= 0) {
    // ← 新增：先复查一次平台进度（可能是异步上报延迟），避免丢学时
    await U.sleep(PROGRESS_RECHECK_MS);
    cur = locateCur();
    const again = cur ? ZHS.Catalog.progressOf(cur) : 0;
    if (cur && (ZHS.Catalog.isFinished(cur) || again >= 95)) {
      ZHS.Log.info('复查后平台已记录完成（' + again + '%），切换下一节');
      ZHS.Player.resetRetry();
      await this.gotoNext('本课时已完成');
      return;
    }
    ZHS.Log.warn('复查后平台进度仍未确认（读到 ' + again + '%），按视频已放完处理，切换下一节');
    ZHS.Player.resetRetry();
    await this.gotoNext('视频播放完毕');
    return;
  }
  ```

  > 若判断 10 秒复查太重，至少把未使用的 `PROGRESS_RECHECK_MS` 常量删掉或改为注释说明「暂不启用」，避免下一位维护者以为它生效了。

---

### 🟡 P7（中）`_rebindAfterNav` 等不到 video 时只 warn 不抛错 → 后续 tick 对着 null video 空转

- **位置**：
  - `src/05-scheduler.js:643-646`（`if (!video) { warn; return; }`）
  - `src/05-scheduler.js:330-340`（`_tickInner` 无 video 时连续 3 轮才 `gotoNext`）
- **触发条件**：切课/切源后 video 加载超过 20 秒（慢网、video 在跨域 iframe 里拿不到）。`_rebindAfterNav` 静默返回，`ZHS.state.videoEl` 仍是 null。
- **后果**：下一轮 `_tickInner` 走「无 video」分支，连续 3 轮（6 秒）又判「文档节点」→ **再切一次课**，形成「切了但没播 → 又切」的抖动。日志里只有一句 `切课后未找到视频元素`。
- **严重程度**：🟡 中。
- **修复方案**（把「切后无 video」计数纳入判断，避免归零后反复切）：

  ```js
  // 05-scheduler.js，_rebindAfterNav 返回是否成功（替换 643-646）
  if (!video) {
    ZHS.Log.warn('切课后 20 秒内未找到视频元素，本轮不再重试');
    this._rebindFailed = (this._rebindFailed || 0) + 1;
    if (this._rebindFailed >= 3) {
      if (ZHS.panel) ZHS.panel.alert('切课后视频长时间未加载，已暂停自动跳转，请检查网络或手动重进', 'error', 12000);
      this.stop();
    }
    return false;
  }
  this._rebindFailed = 0;
  // …
  return true;
  ```

---

### 🟢 P8（低）`_completedThisRun` 只在成功分支递增，与「是否真的完成」耦合

- **位置**：`src/05-scheduler.js:548`（`this._completedThisRun = (this._completedThisRun || 0) + 1` 只在 `switched===true` 分支）
- **触发条件**：`clickAndVerify` **假失败**（其实切过去了，只是 active 没落到 DOM）→ 走失败分支 → `_completedThisRun` **不递增** → `stopMode='lessons'` 下「看 N 节就停」**永远达不成**。
- **严重程度**：🟢 低（不报错，只是用户设的自动停止条件静默失效）。与 P4（假成功）方向相反，两者一起说明：**完成计数绑在了一个不可靠的信号上**。
- **修复方案**：完成计数改为「基于前后 lessonKey 是否真的变化」判定，而不是基于 `clickAndVerify` 的返回值：

  ```js
  // 05-scheduler.js，成功/失败分支统一计数（在 545 附近）
  const reallyMoved = ZHS.state.lessonKey !== _prevKey || cat.itemTitle(cat.current()) === _targetKey;
  if (reallyMoved) {
    this._navFailCount = 0; this._navFailKey = null;
    this._navCount++;
    this._completedThisRun = (this._completedThisRun || 0) + 1;
  }
  ```

---

## 3. 重点问题专答：`gotoNext` 点击后有没有「验证真的切过去了」？

**有验证，但验证的「证据」不够硬，会两头出错。**

| 问题 | 现状 | 证据 |
|---|---|---|
| 有没有对比「切换前后当前课时标识」？ | **没有**。只对比「目标条目是否拿到 active」 | `02-adapter.js:697/699` 只调 `hasActive(target)` |
| 平台不认 active 标记会怎样？ | **假失败**：白等 3s+6s（`timeout*2`），再点一次同一节；`_navFailCount` 累加，5 次硬停 | `02-adapter.js:699`、`05-scheduler.js:528-536` |
| 点击被遮挡 / 改版点了无效会怎样？ | 点两次都不动 → 判失败 → 告警「未生效，正在重试」→ 下一轮重来 → 5 次后 `stop()` 告警停手 | `05-scheduler.js:531-536` |
| 会不会「以为切了其实没切」的假成功？ | **会**。若 `findNext` 回绕返回当前节，或页面别处有 active 容器包住条目 → `hasActive` 立刻为真 → 0 毫秒判成功、`_completedThisRun++` | `02-adapter.js:643-644`、`hasActive` 的 `cur.contains(el)` |
| 失败后状态会不会被污染？ | **会**。`lessonKey` 已被改成目标值且不回滚 → 进度记错节（P1） | `05-scheduler.js:521-522`、`528-541` |

**一句话**：现在的验收是「看目录条目有没有被点亮」，这是**间接信号**；真正硬的是「**当前播放的课时标识确实从 A 变成了 B**」（对比切换前后 `Catalog.current()` 的标题 / video.src / 路由）。后者是本轮最该补的。

---

## 4. 修复优先级建议（给主代理排序）

| 优先级 | 缺陷 | 一句话理由 |
|---|---|---|
| 1 | **P1** lessonKey 失败不回滚 | 会导致进度错位 + 静默跳节，是唯一「写错数据」级别的缺陷 |
| 2 | **P4 + P8** 切换验收加第二信号、完成计数解耦 | 同时修掉「假成功」和「假失败」两个方向的误判，是根治体验问题的关键 |
| 3 | **P2** `cur` 定位失败兜底 | 防 5 次硬停后彻底瘫住 |
| 4 | **P3** stop 话术分场景 | 提升可诊断性，成本低 |
| 5 | **P6** 落地「读 0% 先复查」 | 兑现注释里的承诺，减少丢学时 |
| 6 | **P5 / P7** 缩短失败分支等待、rebind 失败熔断 | 减少主线程阻塞与守卫盲区 |

---

## 5. 附：本次审查的证据文件清单（均已实际读取）

| 文件 | 读取目的 | 关键行 |
|---|---|---|
| `src/05-scheduler.js` | 三个目标函数全链路 | 197-362（tick）、372-435（onLessonEnd）、442-562（gotoNext）、640-652（rebind） |
| `src/02-adapter.js` | 目录识别 / findNext / clickAndVerify / statusOf / hasActive | 25-106（适配器表）、424-466（isFinished）、469-480（_readProgress）、514-522（statusOf）、553-601（progressOf/findNext）、609-618（findByName）、627-647（hasActive）、658-714（click/clickAndVerify）、741-766（懒加载） |
| `src/04-resume.js` | 进度绑定与闭包 lessonKey | 56-72（save）、127-196（bindVideo）、199-212（_detach） |
| `src/03-player.js` | 结束判定与重播 | 13-16（END_RATIO）、39-45（atEnd）、142-171（retryFromPlatformProgress） |
| `src/01-util.js` | 可见性 / waitFor / waitUntilHidden | 52-98、101-109、137-145 |
| `src/00-config.js` | 默认配置（autoNext/skipFinished/stopMode…） | 26-91 |
| `src/07-main.js` | SPA 监听对 lessonKey 的写入（与 gotoNext 竞态） | 124-153 |
| `test/run.js` | 现有测试覆盖（第 21/30/31/32b 组） | 600-635、919-965、1039-1103 |
| `PROCESS/meetings/round-3/click-verify-audit.md` | 上一轮对 clickAndVerify 的审查（避免重复、验证结论） | 全文 |
| `PROCESS/meetings/round-1/gotoNext-guard.md` | 更早一版 gotoNext 审查（历史对照） | 全文 |
| `PROCESS/meetings/round-2/review-worker-19-skip-lesson.md` | 参考实现对照（OCS/Autovisor 的点击+校验） | 4.1、4.2 节 |

**特别核对**：`PROGRESS_RECHECK_MS`（`05-scheduler.js:33`）在整个 `src/` 目录内除定义外**无任何引用**——即「读 0% 先复查一次再决定切」的注释承诺未实现（P6 证据）。

---

## 6. 一句话总结

**「点了一下就走」已修好；「点了到底成没成」仍只靠 `active` 一个间接信号验收，两头的误判（假成功 / 假失败）都还在，且失败后 `lessonKey` 不回滚会把进度记到错节上（P1）。** 建议先修 P1，再把「切换成功」的判据升级为「**当前课时标识真的从 A 变成 B**」并加第二个独立信号（video.src / 路由 / 目录当前项文本）交叉验证——这两步做完，「不能自动跳下一集 / 点了下一节也没用」才算根治。
