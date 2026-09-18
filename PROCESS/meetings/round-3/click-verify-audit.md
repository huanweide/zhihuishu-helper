# Round-3 代码审查：clickAndVerify + _navFailCount 新语义

- 审查对象：`src/02-adapter.js`、`src/05-scheduler.js`
- 提交：`74ac103`（对比基线 `74ac103^`）
- 方式：只读静态审查，未修改 `src/`
- 结论摘要：**方向正确（从"数尝试次数"改成"数确认失败次数"是本质改进），但新增了三类更重的副作用，其中"从不打 active 标记的页面"存在明确的硬停路径。净评价：比旧逻辑更准，但在异常页面上更危险，需要补 4 道兜底才能真正优于旧逻辑。**

---

## 0. 改动事实核对

| 位置 | 新逻辑 | 旧逻辑（`74ac103^`） |
|---|---|---|
| `src/05-scheduler.js:522` | `cat.clickAndVerify(next, {timeout:3000, tries:2})` | `cat.click(next)` 同步点一下就返回 |
| `src/05-scheduler.js:523-537` | `switched === false` 才 `_navFailCount++`，`>=5` 则 `stop()` | 点击**之前**无条件 `++`（目标变则置 1），`>=5` 则 `stop()` |
| `src/05-scheduler.js:540-541` | 确认成功 → 计数清零 | 无清零动作（靠"目标变化"隐式清零） |
| `src/02-adapter.js:643-663` | 新增：click → 轮询 `hasActive` → 超时补点一次（超时翻倍）→ detach 按标题重定位 | 不存在 |

---

## A. 页面从不打 active/current_play 标记 → 会不会 5 次累满 → stop()？

### A-1 结论：**通常不会累满，但存在两条确定的硬停路径。不是"必停"，也不是"安全"。**

### A-2 为什么通常不会累满（ mitigating factor，必须点破）

`gotoNext` 在点击**之前**就把目标标题写进了 `ZHS.state.lessonKey`（`src/05-scheduler.js:517`），
而 `Catalog.current()` 在 `document.querySelector(ad.active)` 落空时会走文本兜底
`findByName(ZHS.state.lessonKey)`（`src/02-adapter.js:355-364`，尤其中 `:359-362`）。

于是：**即使页面永远不打标记，只要点击真的生效了，下一轮 `cur` 会被文本兜底定位到"刚点过的那一节"**，
`findNext(cur)`（`src/02-adapter.js:538-558`）就往后走一格 → `_targetKey` 变化 →
`src/05-scheduler.js:524` 的公式 `(_targetKey === _navFailKey ? this._navFailCount : 0) + 1` 归 1。

所以"从不打标记 + 点击有效"的组合下，计数在 1 ↔ 1 之间反复，**到不了 5**。
这一点比旧逻辑并不更差（旧逻辑同样靠"目标变化"清零）。

### A-3 但硬停路径是真实存在的（两条）

**路径 1：`cur` 定位不到 → 每轮回退到"第一个未完成项" → 连续 5 次同一目标 → `stop()`**

`current()` 返回 `null` 的条件（任一成立即可）：
- `findByName` 的入参为空串直接返回 `null`（`src/02-adapter.js:567`）——而 `_targetKey = cat.itemTitle(next)`，
  `itemTitle` 在 legacy 下可能先命中只写序号的 `#lessonOrder`（`src/02-adapter.js:71`、`:379`），
  虽然 `:377-380` 有 `onlyNumber` 回退，但回退到最后一行 `:390` 仍可能吐出被截断/空串；
- 点击后 SPA 重渲染，标题文本发生细微变化（省略号、空格、序号前缀），精确匹配 `:570` 落空，
  包含匹配 `:573` 也落空；
- 目标节点**根本不在 `items()` 里**（如文档/PPT 节点不被 `ad.item` 命中）。

一旦 `cur === null`：`findNext(null)` 里 `startIdx = 0`（`src/02-adapter.js:544-548`），
永远返回**同一个**首个未完成项 → `_targetKey` 每轮相同 → `src/05-scheduler.js:524` 累加 →
第 5 次 `src/05-scheduler.js:527-531` → `stop()` + `_halted = true`（`:174`），
此后连自动 `start()` 都被拦（`:64-67`），**脚本彻底不动**。

> 注意：这条路径旧逻辑也一样会停（旧逻辑是"同一目标尝试 5 次"就停），所以严格说**不是新增**，
> 但新逻辑并没有修掉它，而"点了没用"这个用户痛点恰恰最容易落在这条路径上。

**路径 2：`skipFinished === false` 的顺序模式，硬停概率更高**

`_nextInOrder`（`src/05-scheduler.js:562-575`）只跳过 `LOCKED`，**不跳过 DONE**，
且同样依赖 `cur`。若 `cur` 为 null（同上），它每轮都返回 `items()[0]`（`:571-573`），
哪怕这一节早已完成、点了也不会有任何状态变化 → 5 次 → `stop()`。

### A-4 即使不停，代价也比旧逻辑重（这是"更危险"的实质）

在"从不打标记 + 点击有效"的页面上，每节切课都要额外付出：

1. **9 秒空等**：首次 3s + 补点后 `timeout*2`=6s（`src/02-adapter.js:653`），全部 `await` 在
   `tick()` 的 `_busy` 临界区内（`src/05-scheduler.js:197-209`），
   期间**弹题守卫、验证码守卫、stall 检测、保活全部停摆**。
2. **失败分支再冻结最长 20 秒**：`src/05-scheduler.js:535` → `_rebindAfterNav()`（`:635-646`）
   → `U.waitFor('video', 20000)`（`src/01-util.js:101-109`）。
   若目标是文档节点（本来就没 video），整整 20s 满额等待，单轮最坏 ≈ 29 秒主线程被占。
3. **多打一次点击**：`tries=2`（`src/05-scheduler.js:522`）。假阴性时会再点一次**已经切过去的那一节**，
   在 studyvideoh5 这类"点当前节 = 重新加载该节"的页面上，存在把刚开播的视频打回 0 秒的风险
   （本次审查无法从代码证伪，属高风险未验证项）。
4. **每节弹一次误报告警**：`src/05-scheduler.js:533`（"切换 X 未生效，正在重试…"），
   在健康页面上也会刷屏，直接摧毁用户对告警的信任。
5. **`_completedThisRun` 不递增**（`:543` 只在成功分支），`stopMode='lessons'` 会永远达不成 → 用户设定的"看 N 节就停"静默失效。

### A-5 判定

> **是否比旧逻辑更糟？分维度：**
> - "会不会彻底不动"：与旧逻辑**基本持平**（都靠目标变化清零，都在 `cur` 定位失败时硬停）。
> - "停之前的表现"：新逻辑**明显更糟**（9s+20s 阻塞、重复点击、误报刷屏、完成计数丢失）。
> - "抓真失败的能力"：新逻辑**明显更好**（旧逻辑把"还没点"也算一次失败，且目标一变就清零，
>   真正的"点了没动"反而被掩盖——`src/05-scheduler.js:494-496` 的注释说的正是这件事）。
>
> 所以：**不是"更危险地会停"，而是"更准，但把误判的代价从 0 抬到了约 30 秒/节"。**

---

## B. `hasActive` 通用白名单是否覆盖充分？

现状（`src/02-adapter.js:584-604`）：

- `:593` 适配器专属 `activeClass`（**只给 hike / polymas 配了**，见 `:55`、`:94`；
  legacy / wisdom / fusion / card2025 都没有）；
- `:595` 通用词：`^(active|current_play|current-play|current|is-active|is-current|selected|playing)$`
  —— **整 token 全等**匹配；
- `:598` `el.matches(ad.active)`；
- `:600-602` `document.querySelector(ad.active)` + 互包含。

### B-1 缺的常见写法（按现实出现频率排序）

1. **BEM / 变体修饰符**：`file-item--active`、`item--current`、`node_active`、`lesson-active`。
   整 token 全等匹配（`:595`）一个都吃不下 —— 这是最大缺口。
2. **Vue Router 链接态**：`router-link-active` / `router-link-exact-active` / `nuxt-link-active`。
   Vue SPA 目录几乎必带，当前完全不认。
3. **前缀式**：`is-playing`、`is-checked`、`is-selected`、`is-open`、`is-focus`、`is-highlight`。
4. **缩写态**：`cur`、`now`、`on`、`checked`、`highlight`、`hl`、`opened`。
5. **ARIA 属性**：`aria-current="true"` / `aria-selected="true"` / `data-active="true"` /
   `data-current="true"`。`hasActive` **完全没有读任何属性**，只认 class（`:586-602`），
   对无类名标记的新版页面是结构性盲区。
6. **多词组合**：`item-current`、`chapter-current`、`play-current`、`current-lesson`。

建议：`:595` 的正则由"全等"放宽为"token 前缀/后缀匹配"，例如
`/(^|[-_])(active|current|selected|playing|checked|highlight)([-_]|$)/i`
再叠加 `aria-current` / `aria-selected` / `data-active` 属性判定。

### B-2 `hasActive` 的两个结构性缺陷（比漏词更严重）

- **假阴性**：`:600` 用 `document.querySelector(ad.active)` 取的是**全页第一个**匹配元素，
  而不是"目录内"的那个。页面上任何别处的 `.active`（推荐位、tab、面包屑）都会抢走它，
  随后 `cur === el || el.contains(cur) || cur.contains(el)` 三个条件全落空 → 返回 false。
  这正是 `74ac103` 花大力气修掉的"识别抢占"老 bug 的翻版——**`detect()` 修好了，`hasActive()` 没修**。
- **假阳性**：反过来，若某个**祖先容器**带 `ad.active`（例如目录外壳 `.active`），
  `cur.contains(el)` 成立 → 任何条目都判成"已切换" → `clickAndVerify` 立即返回 true，
  失败检测整体失效。同理 `:595` 裸词 `current` / `selected` 在容器类元素上也很常见。

### B-3 只验"目标拿到 active"，不验"旧的丢了 active"

`hasActive(target)` 为真不代表"从 A 切到了 B"。若 `findNext` 因 `cur` 定位错误
返回了**当前正在播的那一节**（`src/02-adapter.js:554-556` 的"从头补漏"就可能回绕），
`hasActive` 立刻为真 → `clickAndVerify` 0 毫秒返回 true →
`src/05-scheduler.js:540-543` 清零计数并 `_completedThisRun++`，
**实际一节课都没前进，但停止条件被虚增**。建议在返回 true 前加一条：
"当前节 ≠ 上一节的 lessonKey"。

---

## C. `_navFailCount` 新语义下会误累加的场景清单

| # | 场景 | 触发链 | 是否真失败 |
|---|---|---|---|
| C1 | 页面从不打 active 标记，且 `cur` 定位不到 | `02-adapter.js:355-364` 返回 null → `findNext(null)` 恒回首项 → `05-scheduler.js:524` 累加 → 5 次 `stop()` | **误判**（点击其实成功） |
| C2 | 文档/PPT 节点（无 video、无标记） | `05-scheduler.js:330-340` 每 3 tick 调一次 `gotoNext`，目标不变；失败分支再叠 20s `waitFor('video')` | **误判** |
| C3 | 平台标记延迟 > 9 秒（慢网/大课/换源） | `02-adapter.js:653` 3s+6s 双超时耗尽 | **误判** |
| C4 | 页面别处存在 `.active`（推荐位/tab）抢走 `querySelector` | `02-adapter.js:600-602` | **误判** |
| C5 | 同名课时（多个节点标题相同） | `02-adapter.js:570` 精确匹配命中错的兄弟节点 | **误判** |
| C6 | `itemTitle` 吐空串 / 纯序号 | `05-scheduler.js:516` 得到 `''` → `findByName('')` 返回 null（`02-adapter.js:567`）→ 同 C1 | **误判** |
| C7 | **手动连点"下一节"** | `06-panel.js:1011` / `07-main.js:100`（`manual:true` 跳过 `:510` 的运行闸门） | **误判，且新逻辑独有**：从不打标记的页面上手动点 5 次就永久停手 |
| C8 | 点击刚被弹题/验证码遮罩吞掉 | 守卫 2/3 先 `return`，本轮根本没走到 | 不算误判（设计意图内） |
| C9 | 目标已是当前节（`findNext` 回绕） | `hasActive` 立即为真 → 假成功，计数清零 | **反向误判**（该停不停、完成数虚增） |
| C10 | `findByName` 的双向 `includes`（`02-adapter.js:573`） | 短标题互相包含 → 重定位到错误节点 → 验证失败 | **误判** |

补充：计数在 `start()` 里清零（`05-scheduler.js:72-73`），跨课程/重启不会串味，这一点没问题。

---

## D. `click` 之后 `_rebindAfterNav()` 的时序竞态

### D-1 失败分支抢先改写了 `lessonKey`（最严重）

`src/05-scheduler.js:517` 在点击**之前**写入 `ZHS.state.lessonKey = _targetKey`；
点击验证失败后（`:523`）并没有回滚。紧接着失败分支执行
`this._lastNavAt = Date.now(); await this._rebindAfterNav();`（`:534-535`）。
后果链：

1. `_rebindAfterNav`（`:635-646`）用**新** lessonKey 去 `Resume.bindVideo`。
   - 若 video 元素被复用（Aliplayer 常见）→ `04-resume.js:131` 早退，监听器闭包仍是**旧** lessonKey → 新课进度记到旧键；
   - 若 video 换了新元素 → 新元素绑到**新** lessonKey，但实际播放的可能是**旧**课（因为没切过去）→ 旧课进度记到新键。
   两种都是错的。
2. 更糟：下一轮 `onLessonEnd` 的 `locateCur()`（`:377-379`）依赖 `lessonKey` 找回"真正在播的那一节"，
   此时它找回来的是**没切过去的那一个节点** → 完成判定打在错误节点上 →
   `findNext(cur)` 从错误位置往后找 → **静默跳过一整节课**。

### D-2 成功分支同样没验"视频真的换源了"

`:552` 固定 `sleep(3000)` 后 `_rebindAfterNav()` → `U.waitFor('video', 20000)`
（`01-util.js:101-109`）只取页面上第一个 `<video>`，**不校验 src 是否已切换**。
若 SPA 复用同一个 video 元素（智慧树新版常见），`waitFor` 毫秒级返回旧元素，
`bindVideo` 被 `:131` 的守卫挡下 → 时间更新监听器仍闭包着**上一节**的 lessonKey。
`clickAndVerify` 只验 active、**不验 video 换源**，这道缝完全靠
`NAV_COOLDOWN_MS = 15000`（`:31`，闸门在 `:355-357`）兜底——那块注释本身就承认这是治标。

### D-3 冷却窗口在失败分支被自己耗光

失败分支先打时间戳（`:534`）再 `await` 最长 20s 的 `_rebindAfterNav()`。
若真耗满 20s，`Date.now() - _lastNavAt` 早已 > 15s，闸门形同虚设；
下一轮 `tick` 立刻恢复结束判定，而页面里可能还是上一节的 ended video →
再次 `gotoNext` → 再来一轮 9s+20s。**这是 BUG-PB-4（12 秒跳一节）在新代码下的变体复发路径。**
成功分支（`:544` 打戳 → `:552` 睡 3s → `:553` rebind）同样存在"打戳早于真正就绪"的问题，只是窗口更短。

### D-4 主线程被长 `await` 独占（新引入）

`tick()` 用 `_busy` 做防重入（`:197-209`），而 `gotoNext` 全程 `await` 在它内部。
旧逻辑点击是同步的，`tick` 立刻返回；现在单轮最坏 ≈ 9s（clickAndVerify）+ 20s（rebind）= 29s，
期间验证码守卫（`:217`）、弹题守卫（`:247`）、`checkStall`（`:343`）、`ensurePlaying`（`:348`）**全部不执行**。
弹题若恰好在这 29 秒内弹出，视频会无人看管地继续跑/无人作答。

### D-5 detach 重定位的时序窗口

`02-adapter.js:655-658` 只在 `waitUntil` **整段超时之后**才检查 `isConnected`。
若 SPA 在点击后立刻重渲染（节点当场 detach），第一轮必然白等满 3s；
且重定位走 `findByName`，受 C5/C10 的模糊匹配影响，可能拿到错误节点再点一次。

---

## E. 建议（不改 src，只列方向）

1. **给"切换成功"加第二信号**：`clickAndVerify` 判定改为
   `hasActive(target) || 视频 src 变化 || location/路由变化 || lessonKey 对应节点变化`，
   任一成立即成功 —— 直接消灭 A/C1/C2 的"从不打标记"硬伤。
2. **`hasActive` 作用域收口**：`:600` 的 `querySelector` 限定在 `ad.container` 内查（`:35`/`:46`/`:59` 等已配），
   并按 B-1 放宽白名单 + 补 `aria-current` / `aria-selected` / `data-active`。
3. **失败分支回滚 `lessonKey`**：`switched === false` 时把 `ZHS.state.lessonKey` 恢复为点击前的旧值
   （在 `:517` 之前先存一份），修掉 D-1 的错绑与静默跳节。
4. **失败分支别再 `await` 20s**：把 `_rebindAfterNav` 的等待降到 3~5s（成功分支可保留长等待），
   并在 `clickAndVerify` 外层套总预算（复用 `:183` 的 `_withBudget`），别让 `_busy` 长期独占。
5. **`_completedThisRun` / `_navCount` 与 stop 条件解耦**：验证失败不应让"看 N 节就停"静默失效（A-4.5）。
6. **补测**：`test/` 与 `tools/e2e-*` 目前只有"打标记"的 happy path（`tools/e2e-studyvideoh5.js:79/102`），
   缺"永不打标记的页面"、"文档节点无 video"、"页面别处存在同名 .active"三个反例夹具。

---

## F. 一句话定论

**新逻辑判定更准（抓的是"确认失败"，旧逻辑抓的是"尝试次数"），但把误判代价从"点一下白点"抬到了"每节约 30 秒阻塞 + 重复点击 + 误报"，并且在 `cur` 定位失败时仍会 5 次硬停。总体：比旧逻辑好，但只在"页面会打 active 标记"的前提下更好；对不打标记的页面，它比旧逻辑更危险。必须先补 E-1（第二信号）和 E-3（失败回滚 lessonKey）再上线。**
