# review-worker-37：调度器停机后能否自愈（只读审查）

审查对象（只读，未修改任何文件，未 commit）：
- `src/05-scheduler.js`（主调度器）
- `src/07-main.js`（初始化 + SPA 自愈）

---

## 一、结论先行

**存在真实缺陷路径：调度器一旦 `stop()`，就永久停机，「自愈通道」从设计上根本不负责把它拉起来。**

一句话概括根因：
> `stop()` 会同时做两件事 —— 清掉定时器（`_timer = null`）**并**打上 `_halted = true`。而 `watchSpa()` 的补启动只调 `boot()` → `bootOnce()` → `Scheduler.start()`（**不带 `manual`**），`start()` 见到 `_halted` 立刻 return（`05-scheduler.js:64-67`）。同时 `initialized` 已经是 `true`，`boot()` 开头 `if (initialized ...) return`（`07-main.js:33`）也提前返回。**两道守卫，两把锁，任何一条都足以让重启失败，而它们同时存在。**

于是任何**由脚本自身判定**触发的 `stop()`，都会变成「停了就永远不动」：

| 触发 `stop()` 的场景 | 代码位置 | 是否瞬时/可恢复 | 停机后能否自愈 |
|---|---|---|---|
| 目录临时读不到（`bd.total === 0`） | `05-scheduler.js:471-476` | 会（DOM 晚加载/切课期间目录被重建） | **不能** |
| 有未完成但定位不到可点节点（`bd.undone > 0`） | `05-scheduler.js:490-495` | 会（列表虚拟滚动/懒加载） | **不能** |
| 连续 5 次点击同一条目无反应 | `05-scheduler.js:532-537` | 会（点击时 SPA 尚在渲染） | **不能** |
| 自动跳课回课程中心 | `05-scheduler.js:481-486` | 设计如此（换页），新页面是全新环境 | 不适用（重启靠新页 boot） |
| 达到停止条件 / 全部看完 | `05-scheduler.js:115-123`、`585-633` | 不应自愈 | 正确（不该自愈） |
| 用户点「停止」 | `06-panel.js:1015-1018` | 不应自愈 | 正确（不该自愈） |

**关键区分**：`stop()` 目前只有「一个」语义 —— 「停机且不许自动重启」。但调用者其实分三类：
1. **用户主动停** → 应当禁止自动重启 ✅（现有行为正确）
2. **达成目标停**（时长/节数/全看完） → 也不应自动重启 ✅（现有行为正确）
3. **瞬时故障停**（读不到目录 / 定位不到节点 / 点击无反应） → **误伤了**：这些是「资源暂时没准备好」，不是「用户让我停」，却被打上与用户手动停完全相同的标记，且**没有任何机制会把它们重新拉起**。这正是用户口径「中途就不动了 / 卡住不跳下一集」的机制性成因之一。

**注意**：`watchSpa()` 里唯一的重置 `bootTries = 0`（`07-main.js:147`）只在 `v !== ZHS.state.videoEl`（视频元素被替换）时执行，且它重置的是 **bootTries，不是 `initialized`，也不是 `_halted`**。所以即使视频换新、DOM 完全恢复，`initialized` 仍为 `true`，`_halted` 仍为 `true`，主循环仍然起不来。

---

## 二、证据（文件:行号 + 关键代码）

### 证据 1：`stop()` 打的双重锁
`src/05-scheduler.js:166-176`
```js
stop() {
  if (this._timer) {
    clearInterval(this._timer);
    this._timer = null;              // ← 定时器清掉
  }
  ZHS.state.running = false;         // ← 运行态置假
  // 标记「本轮已判定停机」：阻止页面初始化流程里的自动 start() 把它重新拉起。
  this._halted = true;               // ← 第二把锁：禁止非手动 start
  ZHS.Log.info('主循环已停止');
},
```
**`_halted` 没有任何一处被复位**，除非调用 `start({ manual: true })`（见证据 2）。它也没有区分「谁停的」——用户停、达标停、故障停，共用同一个布尔。

### 证据 2：`start()` 拒绝非手动重启
`src/05-scheduler.js:61-78`
```js
start(opts) {
  const manual = !!(opts && opts.manual);
  if (this._timer) return;
  if (this._halted && !manual) {
    ZHS.Log.debug('此前已判定停止，自动启动被忽略（如需重跑请手动点「启动」）');
    return;                          // ← 自动重启在这里被挡死
  }
  this._halted = false;
  ZHS.state.running = true;
  ...
  this._timer = setInterval(() => this.tick(), LOOP_INTERVAL);
```
全仓库能带 `manual: true` 调用的只有三处，**全是用户主动点击**：
- `src/06-panel.js:1011-1014`（面板「启动」按钮）
- `src/06-panel.js:1020`（面板「下一节」按钮，走的是 `gotoNext`，不是 `start`）
- `src/07-main.js:174`（控制台 `zhs.start()`）

自动链路（`bootOnce` → `Scheduler.start()`，`src/07-main.js:114`）**不带 `manual`**，因此必然被 `_halted` 挡下。

### 证据 3：`boot()` 的第一道守门
`src/07-main.js:32-34`
```js
async function boot() {
  if (initialized || bootTries >= BOOT_MAX_TRIES) return;
  bootTries++;
```
`initialized` 在成功跑完 `bootOnce()` 时置真（`07-main.js:36-37`），且**除 `bootOnce` 抛异常外没有任何地方把它置回 false**。脚本正常跑起来一次之后，`initialized` 永久为 `true` → `boot()` 永久直接 return → 即使 DOM 恢复也不会再走 `Scheduler.start()`。

### 证据 4：SPA 自愈通道只做「重绑」，不碰 `_halted`
`src/07-main.js:124-153`
```js
function watchSpa() {
  const onDomChange = U.debounce(() => {
    ... // courseId 变化分支：只 resetCatalogCache + 更新 state
    const v = document.querySelector('video');
    if (v && v !== ZHS.state.videoEl) {
      ZHS.Log.debug('检测到视频元素变化，重新绑定');
      ZHS.state.videoEl = v;
      bootTries = 0;                 // ← 只重置 boot 名额，不动 initialized / _halted
      if (newLessonKey) ZHS.state.lessonKey = newLessonKey;
      ZHS.Resume.bindVideo(v, ZHS.state.courseId, ZHS.state.lessonKey);
    }
    // 页面还没初始化但出现视频 → 补启动（含启动失败后的重试，受次数上限约束）
    if (!initialized && bootTries < BOOT_MAX_TRIES && v) boot();   // ← initialized=true 时永不触发
  }, 1000);
  ...
}
```
这一行的注释诚实交代了它的职责边界：**「视频元素被替换 → 重新绑定，但不重启整套流程」**（`07-main.js:142`）。也就是说：
- 它确实能救「`bootOnce` 抛异常导致 `initialized=false`」这一类故障（这是 2026-09-19 那次修正的目标）。
- 它**完全不负责**救「`stop()` 之后 `_halted=true`」这一类故障——`initialized` 此时是 `true`，补启动分支根本不进入。

### 证据 5：三条「瞬时故障 → 永久停机」的具体路径

**(a) 目录临时读不到** `src/05-scheduler.js:471-476`
```js
if (!next) {
  if (bd.total === 0) {
    // 目录都没识别到：绝不能弹「全部看完」的假总结
    ZHS.Log.warn('未识别到课程目录，无法切换。请确认已进入课程播放页');
    if (ZHS.panel) ZHS.panel.alert('未识别到课程目录，请先进入具体课程的播放页', 'error');
    this.stop();                     // ← 永久停机
  }
```
触发条件：切课瞬间右侧栏被 SPA 重建，`Catalog.breakdown()` 在那一拍返回 `total=0`。这是**亚秒级的临时状态**，但代价是永停。而且 `gotoNext` 是 `onLessonEnd` → `atEnd` 每轮都会重新走的路径，**一旦命中就再无挽回**。

**(b) 定位不到可点节点** `src/05-scheduler.js:490-495`
```js
} else {
  // 有未完成但找不到（状态识别可能有偏差），停手让人看
  ZHS.Log.warn('还有 ' + bd.undone + ' 节未完成，但无法定位到可点击节点（可能被锁定或选择器不匹配）');
  if (ZHS.panel) ZHS.panel.alert('还有 ' + bd.undone + ' 节未完成但定位失败，请检查目录', 'warn');
  this.stop();                       // ← 永久停机
}
```
触发条件：节点在可视区外未渲染 / 懒加载中，`findNext` 返回 null。同样是瞬时状态。

**(c) 点击无反应累计 5 次** `src/05-scheduler.js:528-537`
```js
if (!switched) {
  this._navFailCount = (_targetKey === this._navFailKey ? this._navFailCount : 0) + 1;
  this._navFailKey = _targetKey;
  ZHS.Log.warn('点击「' + _targetKey + '」后未检测到切换（第 ' + this._navFailCount + ' 次）');
  if (this._navFailCount >= SAME_NAV_MAX) {
    ZHS.Log.error('连续 ' + this._navFailCount + ' 次点击「' + _targetKey + '」都无反应...已停止自动跳转');
    if (ZHS.panel) ZHS.panel.alert('切课失败：连续 ... 无效，已停止自动跳转，请手动切换', 'error', 15000);
    this.stop();                     // ← 永久停机
    return;
  }
```
触发条件：平台响应慢，`clickAndVerify` 3 秒超时内没拿到 active。连续 5 次（间隔含 1~N 秒随机延迟）后永停。这个「5 次」的门槛在慢网/弱机上完全可能被瞬时卡顿凑齐（历史文档 `PROCESS/meetings/round-3/click-verify-audit.md:52` 已记录此路径）。

### 证据 6：既有文档已确认「无自动恢复通道」
- `PROCESS/meetings/round-2/roster-mechanism.md:247-249`：
  > 「`stop()` 会置 `_halted = true`。此后：**自动**：`start()` 在 `_halted` 且非 manual 时直接忽略，主循环不会自己起来。」
- `PROCESS/meetings/round-1/edge-cases.md:545`：
  > 「`_halted` 机制：`stop()` 置 `_halted=true`，`start(opts.manual)` 可越过，避免自动流程把已停机的脚本重新拉起」
  ——注意这里的「避免自动流程重新拉起」被当成**优点**记录，但它没有区分「用户要求停」和「故障被迫停」，是把两类语义合并带来的副作用被默认接受了。

### 证据 7：（旁证）手动「下一节」也会被反复 `stop()`
`PROCESS/meetings/round-2/roster-mechanism.md:249` 已指出：`gotoNext()` 不检查 `_halted`，所以面板「下一节」还能调，但**每次都会重走失败路径再 `stop()` 一次**。这使用户即便点「下一节」也救不回来——因为 (a)/(b)/(c) 任一条件还在，`gotoNext` 内部又会 `stop()`。用户感知就是「点了没反应 / 弹个提示就没了」。

---

## 三、修复建议（具体代码）

**设计原则（必须遵守，否则会与「用户主动停止」语义冲突）：**
1. **停机原因要可区分**。新增 `_haltReason` 记录「为什么停」，只有 **`'user'`** 才允许彻底封死；`'condition'`（达标）也应封死（用户明确设了停在 N 分钟/节数）；**`'transient'`（瞬时故障）**允许在 DOM 稳定、资源就绪后自动重启。
2. **重启必须限流**。用「距上次 transient 停机至少 N 秒」+「连续 transient 重启次数上限」，避免故障未消失时变成高频空转（正是 `_halted` 当初要防的事）。
3. **不碰 `boot()` 的 `initialized` 语义**。恢复通道走独立的轻量函数，不动 `initialized`，避免把 round-7 修好的「boot 失败可重试」逻辑搅乱。

### 修复 1：`src/05-scheduler.js` —— `stop(reason)` 带上停机原因

替换 `05-scheduler.js:166-176`：
```js
    /**
     * 停止主循环
     * @param reason 'user'（用户主动停，彻底禁止自动重启）
     *             | 'condition'（达标停，也禁止自动重启）
     *             | 'transient'（瞬时故障停，允许 DOM 稳定后自动恢复）
     * 不传默认 'user'：保持既有调用方的原语义，避免静默改变行为。
     */
    stop(reason) {
      const why = reason || 'user';
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      ZHS.state.running = false;
      this._haltReason = why;
      // 只有「非用户、非达标」的停机才允许自动恢复
      this._halted = why !== 'transient';
      if (why === 'transient') {
        this._transientStoppedAt = Date.now();
        this._transientReloads = (this._transientReloads || 0) + 1;
      }
      ZHS.Log.info('主循环已停止（原因：' + why + '）');
    },
```

### 修复 2：`src/05-scheduler.js` —— 三处瞬时故障 `stop()` 改传 `'transient'`

- `05-scheduler.js:476`：`this.stop();` → `this.stop('transient');`（目录临时读不到）
- `05-scheduler.js:494`：`this.stop();` → `this.stop('transient');`（定位不到可点节点）
- `05-scheduler.js:535`：`this.stop();` → `this.stop('transient');`（点击无反应）

**保持不变**（语义正确的两类）：
- `05-scheduler.js:485`（自动跳课回课程中心）：保持 `this.stop()`，因为新页面是全新环境，本页不需要恢复。
- `finishAll` 内的 `this.stop()`（`05-scheduler.js:631`）与 `_stopByCondition` 链路：达标停，保持默认 `'user'`（封死，符合用户「设了 30 分钟就该停住」的预期）。

### 修复 3：`src/05-scheduler.js` —— 新增受限的自动恢复入口

在 `Scheduler` 对象里新增（建议放在 `stop()` 之后）：
```js
    /** 连续瞬时故障自动恢复的次数上限（防故障未消时高频空转） */
    _TRANSIENT_RELOAD_MAX: 3,
    /** 两次瞬时故障恢复之间的最小间隔，避免抖动 */
    _TRANSIENT_RELOAD_GAP_MS: 60000,

    /**
     * 瞬时故障后的受控恢复：仅当停机原因是 'transient'、
     * 且距停机已过冷却期、且未超过恢复次数上限时，才重新 start。
     * 用户主动停/达标停时 _haltReason 不是 'transient'，此函数直接不动作 —— 不会冲突。
     * @returns true 表示已重新拉起
     */
    tryResumeAfterTransientStop() {
      if (this._haltReason !== 'transient') return false;
      if (this._timer) return false;                       // 已在跑
      if ((this._transientReloads || 0) >= this._TRANSIENT_RELOAD_MAX) return false;
      if (Date.now() - (this._transientStoppedAt || 0) < this._TRANSIENT_RELOAD_GAP_MS) return false;
      // 资源就绪前置条件：必须有视频元素，否则拉起也是空转
      if (!ZHS.Player || !ZHS.Player.video()) return false;

      this._halted = false;          // 内部复原，绕过 _halted 但语义清晰
      this.start({ manual: true });  // 手动通道：重置 startedAt/计数，走 preflight
      ZHS.Log.info('瞬时故障已解除，已自动恢复主循环（第 '
        + (this._transientReloads || 0) + '/' + this._TRANSIENT_RELOAD_MAX + ' 次）');
      if (ZHS.panel) ZHS.panel.alert('已自动恢复运行（此前为临时故障，如目录未就绪）', 'info', 6000);
      return true;
    },
```
> 说明：这里复用 `start({ manual: true })` 而不是新增分支，是为了**完全复用既有启动语义**（重置 `startedAt`、`_completedThisRun`、`_navCount`、`_navFailCount`，并跑 `preflight()`）。`_TRANSIENT_RELOAD_MAX` 之外的「故障真的存在」场景仍会停在停机态，不会变成新的死循环。

### 修复 4：`src/07-main.js` —— 让 `watchSpa()` 承担「故障后恢复」职责

在 `watchSpa()` 的 `onDomChange` 里、原有的视频重绑之后（`07-main.js:150` 与 `152` 之间）插入：
```js
      // 瞬时故障停机恢复：只有 stop('transient') 才有 _haltReason==='transient'，
      // 用户主动停（_haltReason==='user'）与达标停不会被这里复活 —— 语义不冲突。
      if (ZHS.Scheduler && ZHS.Scheduler.tryResumeAfterTransientStop) {
        if (ZHS.Scheduler.tryResumeAfterTransientStop()) return;
      }
```
放在 `debounce` 内（已有 1 秒去抖，`07-main.js:153`）可以天然避免抖动期反复尝试。

同时把 `07-main.js:152` 的补启动条件补一条「停机恢复」的注释，明确职责分工：
```js
      // 通道 A（原有）：bootOnce 抛异常 → initialized 仍为 false → 补启动
      if (!initialized && bootTries < BOOT_MAX_TRIES && v) boot();
      // 通道 B（新增，见上）：已初始化成功但被瞬时故障 stop() → 走 tryResumeAfterTransientStop
```

### 修复 5（可选，强烈建议）：`src/06-panel.js` —— 给用户一个「为什么停了」的提示

面板状态文案（`src/06-panel.js:1191`）目前只有「运行中 / 已停止」。建议在 `_haltReason === 'transient'` 且已超过恢复上限时，把状态显示为：
```js
setText('.s-run', ZHS.state.running ? '运行中'
  : (ZHS.Scheduler._haltReason === 'transient' ? '已停止（临时故障，可点「启动」重试）' : '已停止'));
```
理由：修复 1~4 之后仍存在「连续 3 次恢复都失败」的场景，此时必须让用户**看得见原因并知道能手动救回来**，否则又回到「装了没反应」的体验。这条零成本、无风险。

---

## 四、风险与回归提示（给主代理）

1. **`stop()` 签名不变**，不传参默认 `'user'`，因此所有既有调用点（面板停止按钮 `06-panel.js:1016`、`tools/*`、`test/run.js:39`、`test/screenshot.js`）行为**完全不变**，不会破坏现有测试。
2. **需要新增/补充测试**（否则无法证明修复有效）：
   - 单测：`Scheduler.stop('transient')` 后，`_halted === false`、`_haltReason === 'transient'`；调用 `tryResumeAfterTransientStop()` 在视频就绪 + 冷却期后返回 `true` 且 `_timer` 非空。
   - 单测：`Scheduler.stop()`（默认 user）后，`tryResumeAfterTransientStop()` 必须返回 `false` 且 `_timer` 仍为 null —— **这条是防止与「用户主动停止」语义冲突的关键断言**。
   - 单测：连续调用 `tryResumeAfterTransientStop()` 超过 `_TRANSIENT_RELOAD_MAX` 次后返回 `false` —— 防高频空转。
   - 集成：模拟 `bd.total === 0` 触发 `stop('transient')` → DOM 恢复目录 → `onDomChange` → 主循环重新运行，且 `_completedThisRun` 已重置。
3. **`_TRANSIENT_RELOAD_GAP_MS = 60000` 是经验值**，建议实机观测后再调；若用户环境目录加载普遍慢于 1 分钟，需要放宽。
4. **本次审查未修改任何文件、未 commit**，以上代码均为建议稿。

---

## 五、给用户的白话版（可直接引用）

**现在的问题**：脚本有个「总闸」叫 `_halted`。无论是**你亲手点停止**，还是**脚本自己遇到点小麻烦**（比如刚好那一秒没读到课程目录、视频还在加载、点章节网页没来得及反应），它都会把总闸拉下，并且**从此再也不自己合上**——哪怕下一秒网页完全恢复正常，它也只是「知道你出问题了，然后安静地不动」，连日志都是 `debug` 级别的（默认看不到）。

更麻烦的是，设计里本来有一条「自愈通道」（`watchSpa`，用 MutationObserver 盯着网页变化），但它只负责一种故障：**「第一次启动就没起来」**。对于「**起来过、后来被停机**」这种故障，它因为一个叫 `initialized` 的开关已经是 `true`，压根不会去尝试。

**修复思路**：给停止动作**分个类**——
- 你亲手点的停 → 永远不许自动重启（保持不变，这是对的）✅
- 达到你设定的时长/节数 → 不许自动重启（保持不变，这也是对的）✅
- 脚本自己遇到的**临时小麻烦** → 标记成「临时」，等网页稳定 + 视频回来 + 过了 1 分钟冷静期，自动重新启动，但最多只重试 3 次（防死循环）🆕

这样既解决了「中途就不动了」，又不会在你明确点了停止之后又自己跑起来。
