# round-15 对抗性复核报告（review-worker-40）

- **复核对象**：commit `e75a026`（v0.6.17，round-15），声称收口 round-14 引入的 7 个缺陷
- **复核方式**：读源码 + 实跑测试 + jsdom 差分探针（同一场景分别跑 round-14 `0bb3129` 与 round-15 `e75a026` 的 src）
- **结论摘要**：
  - 测试实跑 **284 / 0 全绿**（真实结果，见文末）。
  - `nowIsTarget` 同名节假成功**确实修好了**（差分实测：r14=true假成功 → r15=false正确）。
  - **新发现 3 个 round-15 新引入的缺陷**（都在调度层 `start(opts.resume)`），详见 P1/P2/P3。
  - 任务书担心的「`current()` 强校验导致判据恒 false → 所有切换判失败」**经实测不成立**（r14/r15 行为一致，非本轮回归），但存在一个**先于本轮的老限制**，见 P4。
  - 面板判据、`fromIdx` 重名反查、闭包 `target` 引用：**均无问题**。

---

## 一、实际运行测试

命令：

```bash
cd C:/Users/Administrator/WorkBuddy/2026-09-17-21-07-36/zhihuishu-helper
node test/run.js
```

真实输出（末尾）：

```
==================================================
通过 284 / 失败 0
全部通过 ✓
```

**符合声称的 284/0。** 但注意：这 284 条断言中**没有任何一条**覆盖本轮新增的 `resume` 语义 ——
`grep -n "resume\|preflight\|navFailTotal" test/run.js` 只命中第 258/260/1205 行的
`zhs-helper-resume`（那是播放进度存储，与 `start({resume})` 无关）和 `S.preflight()` 的
存在性检查。**green 不代表 resume 分支被验过。**

---

## 二、逐条结论（a~f + 第 3/5 点）

### 【a】`resume=true` 不重置 `_navFailCount`/`_navFailKey` → **成立（缺陷）**

- 证据（`src/05-scheduler.js`）：
  - L79-88：`if (resume) { … } else { this._navFailKey = null; this._navFailCount = 0; … }`
    —— resume 分支**不碰**这两个字段。
  - L604：`this._navFailCount = (_targetKey === this._navFailKey ? this._navFailCount : 0) + 1;`
  - L607：`const hitSame = this._navFailCount >= SAME_NAV_MAX;`（`SAME_NAV_MAX = 5`，L43）
- 探针实测（在临时目录构造，已删除）：

```
自愈后 _navFailCount = 4 （残留，未重置）
→ 自愈后面对同一目标「坏节点X」失败 1 次：
   _navFailCount = (同key? 4:0)+1 = 5 → hitSame 成立 → 立即 stop('transient')
```

**后果**：若坏节点是永久性的（平台改版 / 节点被锁死打不开），自愈恢复后**第一次失败就再次停机**。
自愈名额只有 3 次（`TRANSIENT_MAX = 3`，L222），60s 冷却 + 每次 1 次失败，
3 轮后彻底放弃 → 用户观感正是「**自动恢复后马上又停**」。
虽然 60s 冷却期内不会高频抖，但冷却到点后「恢复→立刻停」会稳定复现 3 次，与 round-15 想消除的
「中途停了就永远不动」是同一类不良体验的变体。

**判定：缺陷成立（新引入）。** 与任务书 a) 的猜测一致。

---

### 【b】`resume=true` 不重置 `_navFailTotal` → **成立（缺陷）**

- 证据：`src/05-scheduler.js`
  - L86（resume=false 分支）：`this._navFailTotal = 0;              // round-15【C2】：本轮累计切课失败`
  - L606：`this._navFailTotal = (this._navFailTotal || 0) + 1;`
  - L608：`const hitTotal = this._navFailTotal >= NAV_FAIL_TOTAL_MAX;`（`NAV_FAIL_TOTAL_MAX = 8`，L46）
- 定义/初始化/重置完整性核对：
  - **定义**：无显式字段声明（Scheduler 对象 L48-53 只声明了 `_navCount` / `_lastNavAt`），靠 `|| 0` 惰性初始化 → 可接受。
  - **重置点**：仅 L86（`start` 的 `!resume` 分支）与 L635（`gotoNext` 成功分支）。
  - **缺口**：`start({resume:true})` 路径**没有重置**。
- 探针实测：

```
自愈恢复成功 = true
自愈后 _navFailTotal = 7 （未被重置）
常量 NAV_FAIL_TOTAL_MAX = 8
→ 自愈后「再失败 1 次」_navFailTotal 即达 8 → 立刻永久停机（hitTotal）
```

**后果**：本轮累计 7 次失败 → 触发 transient 自愈 → 恢复后**再失败 1 次就硬停机**，
比「8 次」的设计意图严苛得多，等于自愈后可用预算被压缩到 1。

**这是有意还是 bug？** 从注释看是有意「保留本轮统计」，但**保留的是「失败总数」这种止损计数器，
而不是「已完成进度」这种成果计数器**，两者性质相反：
`startedAt`/`_navCount`/`_completedThisRun` 保留是对的（成果不能丢），
但 `_navFailCount`/`_navFailTotal`/`_navFailKey` 保留是**止损闸门不清零**，
会导致自愈形同虚设。**判定：缺陷成立（设计疏漏，非笔误）。**

---

### 【c】`resume` 时 `preflight()` 会重跑 → **成立（副作用）**

- 证据：`src/05-scheduler.js` L95：`this.preflight();   // 启动即做一次全量体检（N1）`
  —— 该调用**在 `if (resume) {} else {}` 之外**，两种启动都会执行。
- `preflight()` 内的副作用：L174-176

```js
if (ZHS.panel) {
  ZHS.panel.alert('检测到 ' + bd.undone + ' 节未看完，开始自动学习', 'info');
}
```

- 探针实测：

```
全新启动 preflight 调用次数 = 1 | alert 次数 = 1
自愈时 preflight 调用次数 = 1
自愈时 alert 次数 = 1 → [{"msg":"检测到 2 节未看完，开始自动学习","kind":"info"}]
```

**后果**：每自愈一次就再弹一次「开始自动学习」info 提示。单看不算致命（重复提示），
但结合 P1/P2 —— 自愈可能每 60s 失败一次 —— 用户会看到**反复刷屏的「开始自动学习」**，
反而掩盖了真正的异常。另外全量 `breakdown()` 会走 `ensureCatalogLoaded()` 滚动目录（L559/886），
在自愈瞬间做一次目录滚动可能触发额外渲染。**判定：缺陷成立（次要）。**

---

### 第 3 点：`current()` 收窄 + 强校验是否让正常场景返回 null → **成立（会返回 null），但不构成回归；真正链路见 P4**

- 证据：`src/02-adapter.js` L380-408（`current()`）与 L397-401：

```js
if (cur) {
  const list = this.items();
  const isItem = list.some((el) => el === cur || el.contains(cur) || cur.contains(el));
  if (isItem) return cur;
}
// 兜底：用 lessonKey 文本匹配
const key = ZHS.state.lessonKey;
```

- 探针实测（场景 C，active 打在条目的**子节点** `.child-name` 上 —— 平台真实写法之一）：

```
active 类被放在第2条的子节点 .child-name 上
current() = null | 是第 -1 条
```

> 说明：wisdom 的 `ad.active = '.child-info.hasvideo.current'`（L30）要求 `current` 类长在
> `child-info hasvideo` 那个元素上。若平台改成在内层 `.child-name` 加 `current`，
> `scope.querySelector(ad.active)` 命中不到 → `cur=null` → 强校验分支不执行 →
> 靠 `lessonKey` 兜底。**若 `lessonKey` 为空（首次进入尚未绑定）→ `current()` 返回 null。**

- 另一实测（场景 A，hike 版，active 打在被 `items()` 过滤掉的中间层目录节点）：

```
adapter = hike | items = [ '1.1 导论', '1.2 概述' ]
current() = null
ad.active 全局命中数 = 1
```

> hike：`items()` 会过滤掉「有子节点的中间节点」（L357-364），但 `current()` 的 `ad.active`
> 查询不看这个过滤，`isItem` 校验于是失败 → 返回 null。**这是强校验的直接副作用，实测已复现。**

- **但它是否会让所有切换判失败？→ 不会。** 差分实测（r14 vs r15，同一场景）：

| 场景（应 true） | round-14 | round-15 | 分歧 |
|---|---|---|---|
| active 挪到新条目（标准） | true | true | 无 |
| 只在容器加 data-current（改版） | false | false | 无 |
| 播放器标题变、目录不动 | false | false | 无 |

| 场景（应 false） | round-14 | round-15 | 分歧 |
|---|---|---|---|
| 点击无任何反应 | false | false | 无 |
| 点击后 active 留在原节 | false | false | 无 |
| 页面别处出现同名 active（老假成功源） | false | false | 无 |

**没有出现「r14 成功、r15 失败」的分歧** → 第 3 点的强校验**不是本轮引入的回归**。
原因见 P4 的链路分析：`current()` 返回 null 时 `nowIsTarget` 落回标题比对（L753-757），
而 `_activeOnlyFallback` 只在 `nowIsTarget` 判不了时才兜底，两者组合后并没有比 r14 更严。

---

### 【d】`fromIdx` 用标题反查索引，重名节是否取错 → **取错成立，但后果无害**

- 证据：`src/02-adapter.js` L727：

```js
const fromIdx = fromKey ? _idxOf(this.items().find((it) => this.itemTitle(it) === fromKey)) : -1;
```

`.find` 返回**第一个**标题相等的条目。目录里有多个「习题讲解」时，`fromIdx` 永远指向第一个。

- 探针实测（3 个同名节，真实 current=index1、target=index2）：

```
真实 current = index 1（第2个同名节），target = index 2（第3个同名节）
clickAndVerify 结果 = false     ← 期望 false（未切换）✓
真实切到 index2 后再判 = true    ← 期望 true ✓
```

- 再看 `nowIsTarget` 里 `fromIdx` 的用法（L750）：

```js
if (fromIdx >= 0 && curIdx === fromIdx && curIdx !== tgtIdx) return false;
return false;   // L751：无论如何都 return false
```

**关键观察**：L750 这条 `if` 后面紧接的 L751 就是**无条件 `return false`**。
也就是说 —— 在 `curIdx >= 0 && tgtIdx >= 0 && curIdx !== tgtIdx` 的前提下，
**不管 `fromIdx` 取对还是取错，结果都是 `return false`。**
`fromIdx` 那条判断是**死代码**，取错也影响不到结果。

**判定：`fromIdx` 确实会取第一个同名节（"取错"成立），但因被 L751 覆盖，不产生误判。**
属于「写了但没用上的保险」，不是缺陷。

---

### 【e】`nowIsTarget` 闭包里 `target` 是否始终指向最新节点 → **无问题**

- 证据：`src/02-adapter.js` L718 `let target = el;`，L781/L786 `target = again;`。
  JS 闭包**捕获变量本身**（不是值快照），循环内重新赋值后，闭包内读到的是新值。
- 探针实测（第一次点击触发 SPA 换节点 → 循环内 `findByName` 重定位新节点并点击成功）：

```
结果 = true | 耗时 37 ms
→ true = 闭包 target 随重新赋值正确工作
```

**判定：不成立（无缺陷）。**

---

### 【f】`_activeOnlyFallback` 的 `tgtIdx >= 0 → return false` 是否导致判据恒 false → **单独看成立，但与前三点组合后不成立**

- 证据：`src/02-adapter.js` L801-807：

```js
_activeOnlyFallback(target, fromKey) {
  if (!target || !this.hasActive(target)) return false;      // L803
  const list = this.items();
  const tgtIdx = list.findIndex((it) => it === target || it.contains(target) || target.contains(it));
  if (tgtIdx >= 0) return false;                             // L807：索引可用时不走兜底
  ...
}
```

- **任务书设想的链路**：`current()` 返回 null（强校验失败）→ `nowIsTarget` 恒 false；
  同时 `_activeOnlyFallback` 因 `tgtIdx>=0` 返回 false → 判据 `nowIsTarget() || fallback`
  **恒 false** → 所有正常切换判失败。
- **实测否定了这条链路**，两个原因：

  1. `nowIsTarget()` 里 `cur=null` 时**不会立刻 return false 就完事**——
     看 L739 `if (!cur) return false;` 确实是 false，但**这不是唯一出口**。
     当 `cur` 非 null 而 `curIdx`/`tgtIdx` 取不到时，会落到 L753-757 的标题比对分支。
     实测场景 C 中 `current()` 前一刻返回旧节、点击后返回 null（active 不在目录内），
     这条链路最终的判据是 `hasActive(target)`，而 r14 同样依赖它 → **两边一起失败，不分歧**。
  2. 我用「平台真的切过去了」的 3 种标记方式逐一差分，**r14 与 r15 结果完全一致**（见第 3 点表格）。

- **真正的「判据恒 false」场景实测确实存在，但不是 round-15 引入的**（见 P4）。

**判定：f 点描述的组合链路不成立；`_activeOnlyFallback` 没有制造新的假失败。**

---

### 第 5 点：面板判据 `!!(ZHS.panel && typeof ZHS.panel.mount === 'function')` → **无问题**

- 证据：
  - `src/07-main.js` L98：`const panelUsable = !!(ZHS.panel && typeof ZHS.panel.mount === 'function');`
  - `src/06-panel.js` L351：`mount() { … }` 定义在 Panel 对象上；
  - `src/06-panel.js` L1375：`Object.assign(ZHS.panel, Panel);` 随后 L1377 `ZHS.__panel_ready = true;`
- 探针实测（正常加载）：

```
ZHS.panel 是对象? true
__panel_ready = true
typeof ZHS.panel.mount = function
panelUsable = true
```

**`mount` 是 Panel 的方法，只有 `Object.assign` 成功执行（= 模块跑到末尾）后才存在，
所以 `typeof mount==='function'` 与 `__panel_ready` 等价，不会把「能显示的面板」误判成不可用。**
反过来，若模块体中途抛异常，`ZHS.panel` 是 round-14 预置的空对象（L17 `if (!ZHS.panel) ZHS.panel = {};`），
此时 `typeof mount` 为 `undefined` → 正确落入 else 分支并打印 `__panel_ready=undefined`。
**判定：不成立（判据正确，改进有效）。**

---

## 三、P1/P2/P3/P4 汇总（本轮真正的问题）

| 编号 | 问题 | 位置 | 性质 | 严重度 |
|---|---|---|---|---|
| **P1** | `resume` 不重置 `_navFailCount`/`_navFailKey`，自愈后同目标首次失败即再停机 | `05-scheduler.js` L79-88 + L604-607 | **round-15 新引入** | 中高 |
| **P2** | `resume` 不重置 `_navFailTotal`(上限8)，自愈后再失败 1 次即硬停机 | `05-scheduler.js` L86 + L606-608 | **round-15 新引入** | 中高 |
| **P3** | `preflight()` 在 resume 时重跑，重复弹「开始自动学习」 | `05-scheduler.js` L95 + L174-176 | **round-15 新引入** | 低 |
| **P4** | 「平台切了但目录不打 active」时 `clickAndVerify` 判 false（白等 + 重复点 + 5 次硬停） | `02-adapter.js` L772-775 | **round-14 已存在的老限制，非本轮回归** | 中（老账） |

### P4 的实测证据（老限制，说明清楚以免误记到 round-15 头上）

差分探针，同场景「平台确已切换到 1.2，但目录内无任何 active」：

```
场景                                   | round-14                | round-15
平台切了但目录不打 active                 | {switched:false,clicks:2,ms:1395} | {switched:false,clicks:2,ms:1404}
```

两边都是 `false` 且都点了 2 次 → **同样的白等 + 重复点 + 最终计入 5 次硬停**。
`gotoNext`（`05-scheduler.js` L598-620）拿到 `false` 后会回滚 `lessonKey`、
累加失败计数并 `stop('transient')` —— 也就是说 P4 这个老限制**正是 P1/P2 的触发器**：
老限制造成失败 → 触发 transient 停机 → 自愈带着脏计数恢复 → 立刻再停机。

### 唯一被本轮真正修好的（差分实证）

```
场景                                   | round-14         | round-15
同名节未真正切换（防假成功）                | {switched:true,ms:38}  | {switched:false,ms:310}
```

round-14 假成功（38ms 就判过），round-15 正确判失败。**`nowIsTarget` 索引比对修复有效。**
测试 `test/run.js` 的「32f. 同名节不误判」也覆盖了这一条。

---

## 四、复现方式（用户可照做）

```bash
# 1) 跑测试（应 284/0）
cd C:/Users/Administrator/WorkBuddy/2026-09-17-21-07-36/zhihuishu-helper
node test/run.js

# 2) 复核 P1/P2/P3（无需改仓库，用 jsdom 跑 src）
#    思路：加载全部 src/*.js 到 jsdom，取 win.ZHS.Scheduler：
#    S._navFailTotal = 7; S._completedThisRun = 7;
#    S.stop('transient'); S._transientStoppedAt = Date.now() - 61000;
#    S.tryResumeAfterTransientStop();
#    → S._navFailTotal 仍为 7（应为 0）；S._completedThisRun 仍为 7（正确保留）
#    → S.preflight 被再次调用，panel.alert 又弹一次「开始自动学习」

# 3) 复核 P4（差分，需要一份 round-14 源码）
cd C:/Users/Administrator/WorkBuddy/2026-09-17-21-07-36/zhihuishu-helper
git worktree add C:/tmp/r14 0bb3129          # 导出 round-14 源码（用后 git worktree remove C:/tmp/r14）
# 然后对 <场景HTML> 分别加载 r14/src 与 src，调 Catalog.clickAndVerify(tgt, {timeout, tries, fromKey})
```

---

## 五、建议的修法（仅供参考，未改动任何源码）

1. **P1/P2**：把「止损计数器」与「成果计数器」分开处理。
   `start(opts.resume)` 的 resume 分支里补上：

   ```js
   this._navFailKey = null;
   this._navFailCount = 0;
   this._navFailTotal = 0;   // 自愈 = 重新给一次机会，不该带着旧失败账
   ```

   保留 `startedAt` / `_navCount` / `_completedThisRun` 不动（这三个保留是对的）。
   理由：自愈本身就是「相信页面已恢复」，若还留着上一次的失败余额，自愈就等于白给。

2. **P3**：给 `preflight` 加参数，resume 时静默或只打日志、不弹 alert：

   ```js
   this.preflight({ silent: resume });
   ```

3. **P4（老账，可选）**：`clickAndVerify` 的判据可增加第三个信号 ——
   「点击后 `ZHS.state.videoEl` 的 `src` 变化」或「播放器区标题变化」，
   作为「目录不打 active」的平台的兜底。这属于新功能，应先与产品侧确认再动。

---

## 六、交付自检

- [x] 实跑 `node test/run.js` → **284 / 0**，已贴真实输出
- [x] a~f 逐条给出「成立/不成立」+ `文件:行号` 证据
- [x] 第 3 点、第 4f 点已用 **jsdom 探针实测**，且做了 **round-14 vs round-15 差分**
- [x] **未修改任何 src 文件，未 commit**（`git status --short` 为空，`git worktree list` 已还原）
- [x] 探针脚本写在仓库外（`C:/tmp/zhs-probe/`），脚本文件已全部删除；仅残留一个空目录
      （沙箱拦截 rmdir，不含任何仓库文件）
