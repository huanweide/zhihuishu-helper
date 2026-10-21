# gotoNext 连点守卫调研（只读）

> 子代理：playback-flow
> 任务：只读调研自动播放流程中 `gotoNext` 的实现、锁、以及「点击下一节无效」时是否会死循环
> 对象：`zhihuishu-helper/src/05-scheduler.js`（其余版本未经 build 拼接，以 `node build.js` 顺序拼接为准）
> 代码基线：本次读取时 `src/05-scheduler.js` 已较上一轮（round-1）又更新过 —— 我此前提的 BUG-PB-4 冷却闸门已被采纳（`NAV_COOLDOWN_MS = 15000`，05-scheduler.js:28 / 348-350）；本报告基于本次读取的当前内容给出行号。

---

## 1. gotoNext 实现位置

**`src/05-scheduler.js:400`**（`async gotoNext(reason, opts)`），函数体 400–478。

- 计算目标：`cur = ZHS.Catalog.current()` → `next = skipFinished ? this._nextInOrder(cur) : cat.findNext(cur)`（413–422）
- 无目标 → 按情况 `stop()` / `finishAll()`（424–440）
- 人类化随机延迟（443–450）→ 停止闸门复查 `ZHS.state.running`（455–458）
- 真正点：`ZHS.state.lessonKey = itemTitle(next); cat.click(next); this._navCount++` **（461–463）**
- 重置状态 + `ZHS.state.videoEl = null; await sleep(3000); await this._rebindAfterNav()`（467–474）
- `cat.click` 定义在 **`src/02-adapter.js:420–432`**：只 `clickable.click()` 并 `return true/false`，**不验证是否真的切走**。

---

## 2. 当前锁与重试逻辑全貌

### 2.1 锁（防重入，但**不**防「点击无效」）

| 字段/机制 | 位置 | 作用 |
|-----------|------|------|
| `Scheduler._busy` | 05-scheduler.js:42 | `tick()` 开头 `if (this._busy) return;`（串行化每一轮 tick，避免并发重入） |
| `Scheduler._navigating` | 05-scheduler.js:43 | 主锁。`onLessonEnd` 入口置 true（359–360），`finally` 重置（391）；`gotoNext` 用「锁归属」模式：`owned = !this._navigating`（404），忙时若 `manual` 则 warn+return（405–409），否则复用；`gotoNext` 自己持锁时 `finally` 把锁交还（476） |
| `_lastNavAt` / `NAV_COOLDOWN_MS=15000` | 05-scheduler.js:45 / 28 | 切课后打时间戳（465）；`_tickInner` 在 `Date.now()-_lastNavAt < 15000` 内跳过结束判断（348–350）——这是我上轮提的 BUG-PB-4 修复，已落地 |

> **关键结论**：这把锁只是「同一时刻别有两个 gotoNext 在跑」的并发锁。每次 gotoNext 返回后锁就释放了（或 onLessonEnd 的 finally 释放）。**它不记录「点击是否真的把课时切走了」**，因此无法阻止「每轮都点同一个没反应的按钮」。

### 2.2 针对「切课点击」的重试 / 退避

**不存在。** 全文件里与「失败计数」相关的字段都服务于别处：

- `_dialogCloseFails` / `_dialogHumanNotified`（弹题关闭失败，270 / 289）
- `BLOCK_GUARD_MAX_TICKS = 15`（阻塞弹窗连续点不掉上限，38）
- `retryFromPlatformProgress`（进度回退重播，跟点击无关）
- `_noVideoTicks`（连续无视频计数，324–331，每 3 轮才触发一次 gotoNext，但仍是「点了不验证」）

**没有任何计数器盯着 `cat.click(next)` 的成败。** 而且 `gotoNext:462` 是 `cat.click(next);` **把返回值直接丢弃**，即使 `click` 返回 `false` 也照样 `_navCount++`。

---

## 3. 连点同一节失败时的实际行为（会卡死吗？）

**会 —— 静默死循环，不告警、不停止。**

推理链（最坏情况：平台改版 / 下一节按钮无反应 / active 类名不匹配导致 `current()` 永远指向旧条目）：

1. 视频播放到结尾 → `_tickInner` 结束判断（过了 `_lastNavAt` 冷却闸门后）→ `onLessonEnd` → 进度读到 0/100 → `gotoNext('视频播放完毕'|'本课时已完成')`；
2. `cur = Catalog.current()` 仍返回**旧条目**（点击没改变 active 态）→ `findNext(cur)` 每次都算出**同一个 `next`**；
3. `cat.click(next)` 点了，但页面没跳 → 函数返回，锁释放，`_lastNavAt` 刷新（冷却闸门只是把下一轮延后 15s，**不阻断**）；
4. 下一轮：旧条目仍在 ended 态 → 又走一遍 2→3 → 又点同一个 `next` → `_navCount` 一直涨，但课时从没变；
5. 只要 `findNext(cur)` 还能返回该 `next`（即它在锁定/完成态之外），就**永远返回同一节** → 无限连点；只有 `findNext` 返回 `null`（后续都锁定/完成，或目录丢了）才会走到 `stop()`/`finishAll()`，而「点不动」时 `current()` 不变，`findNext` 不会变，故**到不了 null**。

附带伤害：

- `_navCount` 虚高，最终 `finishAll` 总结里「本次切换课时数」失真；
- 若某次 `click` 偶尔生效了一瞬间又弹回（半拉子切换），会更混乱；
- 即便 `_lastNavAt` 冷却闸门存在，也只是把死循环从「12 秒一节」放缓到「约 15~25 秒一节」，**本质没停**。

> 唯一能自然停下来的情形：目录里只剩 1 个未完成且就是当前条目 → `findNext` 返回 null → 走 `finishAll`/`stop`。≥2 个条目且当前条目卡死时必死循环。

---

## 4. 修复建议：连点 N 次仍失败 → 告警并停手

**建议 N = 5**（约 5 次无效点击 ≈ 1–2 分钟，足够排除网络/加载抖动，又不至于让用户干等太久）。

### 4.1 插入点

`src/05-scheduler.js` 的 `gotoNext` 内，**真正调用 `cat.click(next)` 之前**（即当前 462 行附近），加「连续同目标计数」；并在 `Scheduler` 状态字段（41–45 行）和常量区（28 行附近）补两个字段/一个常量。

### 4.2 状态与常量（加在 `Scheduler` 对象顶部 / 常量区）

```js
// 切课冷却（已有）
const NAV_COOLDOWN_MS = 15000;
// ↓ 新增：连点同一节失败上限，超过则停手交人工
const SAME_NAV_MAX = 5;
```

```js
const Scheduler = {
  _timer: null,
  _busy: false,
  _navigating: false,
  _navCount: 0,
  _lastNavAt: 0,
  _navFailKey: null,   // ↓ 新增：最近一次尝试点击的目标课时名
  _navFailCount: 0,    // ↓ 新增：连续点击同一目标且未切走的次数
```

### 4.3 伪代码（放在 `cat.click(next)` 之前）

```js
// ===== 连点同一节失败守卫（防平台改版/按钮无反应导致静默死循环）=====
const targetKey = cat.itemTitle(next);
if (targetKey === this._navFailKey) {
  this._navFailCount += 1;
} else {
  this._navFailKey = targetKey;
  this._navFailCount = 1;
}
if (this._navFailCount >= SAME_NAV_MAX) {
  ZHS.Log.error('连续 ' + this._navFailCount + ' 次点击「' + targetKey
    + '」仍未能切换（疑似平台改版/按钮无反应），已停止自动跳转，请手动处理');
  if (ZHS.panel) {
    ZHS.panel.alert('切课失败：连续 ' + this._navFailCount + ' 次点击「' + targetKey
      + '」无效，已停止自动跳转，请手动切换或检查目录', 'error', 15000);
  }
  this.stop();          // stop() 应置 _halted，避免自动重启（见 05-scheduler.js:56 区域）
  return;
}
// 正常点击
ZHS.state.lessonKey = targetKey;
cat.click(next);
this._navCount++;
```

### 4.4 配套复位（重要，否则会误伤正常续跑）

- `start()`（56 行起）：进入时 `this._navFailKey = null; this._navFailCount = 0;`，避免上一轮残留计数污染新会话。
- 防御性增强（可选，更稳）：在 `await U.sleep(3000); await this._rebindAfterNav();`（473–474）之后**验证切课是否真生效**——读 `ZHS.Catalog.current()`，若仍等于本次点击前的 `cur`（课时没变），说明这轮就是无效点击，把 `_navFailCount` 再 +1；若变了则 `_navFailCount = 0`（正常推进）。这样即使 `findNext` 因为某种原因算出不同 key，也能兜住「点了但没动」的情况。

### 4.5 为什么 N=5 的「同 key 计数」足够

健康站点上点「下一节」后 `current()` 会前移 → 下一轮 `findNext(cur)` 算出**不同**的 `targetKey` → 计数归 1，不会触发停手。只有「点了没动、cur 不变、`next` 恒为同一节」才会让 key 连续重复，于是自然收敛到「连续 N 次同一节」即判定失败。比「固定时间/固定轮数」更准，不会因为用户课程真的只有几节而误停。

---

## 5. 一句话结论

`gotoNext`（`src/05-scheduler.js:400`）有并发锁 `_navigating` 和切课冷却闸门 `_lastNavAt`/`NAV_COOLDOWN_MS`，**但没有任何「点击是否生效」的校验或重试上限**；`cat.click` 的返回值在 `:462` 被丢弃。当「下一节按钮点了没反应」时，脚本会**每轮（受冷却闸门约束约 15~25 秒一次）重复点击同一节、永不停止、也不告警**，属于静默死循环。补一个「连续 N=5 次点击同一目标仍无变化则 `this.stop()` + alert」的守卫即可根治，插入点见 §4.3，复位点见 §4.4。
