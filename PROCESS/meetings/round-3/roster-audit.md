# Round-3 · 目录适配器名册审查（roster-audit）

> 审查对象：提交 `74ac103`（fix(adapter): 修复 studyvideoh5 目录识别抢占）
> 审查范围：`src/02-adapter.js` 六处改动对六套适配器（wisdom / fusion / hike / legacy / card2025 / polymas）的回归
> 权威对照：`reference/ocsjs-zhs.ts`（OCS，主权威）、`reference/autovisor/modules/lesson_navigation.py`（Autovisor，第二信源）
> 模式：**只读**，未改动 `src/` 下任何文件
> 日期：2026-09-19

---

## 0. 结论摘要：回归清单与修复优先级

| # | 级别 | 问题 | 位置 | 一句话 |
|---|------|------|------|--------|
| 1 | **P0** | `ad.finish` 在第 1 层**无条件**判完成，改动 6 只收紧了第 3 层；polymas 的 finish 是通配 `[class*="done"]`，一旦 polymas 当选 → 整目录 allDone 停摆 | `src/02-adapter.js:95` × `:404` | 改动 6 声称修的 bug **没修掉主通道** |
| 2 | **P0** | `+100` 在「条目数封顶 30」下是准一票否决：无 active 的理论上限 115，干扰套 ≥5 条即 ≥115，**真目录数学上翻不了盘** | `src/02-adapter.js:211` × `:212` | iej 评分权重失衡 |
| 3 | **P0** | polymas 的 `container: '#main'`（几乎必中 +20）+ 4 个 active 变体（任一命中 +100）→ 干扰基线 **123**，高于真目录无 active 上限 115 | `src/02-adapter.js:93`、`:98` | 最容易被巧合命中的一套 |
| 4 | **P0** | `detect()` 结果被 `Catalog._ad` 永久缓存，全库只有 `src/07-main.js:22` 一处 `redetect()`；首帧未渲染即永久走兜底 | `src/02-adapter.js:300-303`、`:306` | 一次识别错，全程错 |
| 5 | **P1** | `hostBonus` 把 `studywisdomh5` 绑到 card2025，与 OCS 冲突（studywisdomh5 → StudyPlusH5，`.child-main`）；`card-container` 实属 `smartcoursestudent` | `src/02-adapter.js:178` vs `reference/ocsjs-zhs.ts:822-825`、`:1094` | 域名加分表整体错配 |
| 6 | **P1** | `card2025.finish = '.finished-icon'` 只看**存在**，OCS 还要求 textContent 含「已完成」 | `src/02-adapter.js:82` vs `reference/ocsjs-zhs.ts:1179` | 空图标/「未完成」也判 done |
| 7 | **P1** | fusion 套写的是 `.chapter-content-second`（= OCS **WishdomH5**），而 OCS 的 FusionCourseH5 用的是 `.clearfix.video` | `src/02-adapter.js:42` vs `reference/ocsjs-zhs.ts:256` | 两个权威源在 fusioncourseh5 上直接冲突 |
| 8 | **P1** | wisdom 套 `.child-info.hasvideo`（Autovisor）vs OCS `.child-main`；courseTitle 也冲突 | `src/02-adapter.js:29`、`:36` vs `reference/ocsjs-zhs.ts:319`、`:307` | 两源冲突，无实测裁定 |
| 9 | **P1** | hike 套是三源混搭：item/finish 来自校内课 xnk-study，container `.el-tree` 来自 HikeV2，域名 `hike.zhihuishu.com` 仅 Autovisor 有 | `src/02-adapter.js:53`、`:56`、`:59`、`:176` | OCS 的 `hike` 域其实是 polymas.com |
| 10 | **P2** | 完成标记词表缺 `success` / `select` / `active-file`（OCS Hike / HikeV2 用的正是这三个） | `src/02-adapter.js:418` | 改版后必然漏判 |
| 11 | **P2** | `legacy.container = '.clearfix'` 是清浮动通用类，几乎必中 +20，对其它套不公平 | `src/02-adapter.js:73` | 系统性偏袒 legacy |
| 12 | **P2** | `hasActive` 通用白名单含 `is-active`/`selected`（`:595`），`clickAndVerify` 会拿它当成功信号 | `src/02-adapter.js:595` × `:653` | 可能误判"点成功了" |
| 13 | **P2** | `.rate` / `.item-name` / `.child-name` / `#lessonOrder` 仅 Autovisor 单点依据，OCS 无 | `src/02-adapter.js:58`、`:45`、`:32`、`:71` | 单点信源，改版即失效 |

**必须修的优先级**：1 → 4 → 2/3 → 5 → 6 → 7/8/9 → 10-13。
即：**先堵 polymas 的 over-detect 与 detect 缓存（会直接停摆），再调评分权重（会认错目录），最后收拾选择器与权威源冲突（认错/认不到）**。

---

## 1. 审查方法与证据边界

- 静态通读 `src/02-adapter.js`（675 行）全部改动点，逐行定位（见 §2/§3）。
- DOM 证据来自 `test/fixtures/` 四个真实夹具：`real-h5.html`、`real-legacy.html`、`real-wisdom.html`、`studyvideoh5-legacy.html`。
- 权威选择来自 `reference/ocsjs-zhs.ts`（3620 行）六个处理器类与五个学习脚本的 `matches` 域名表；`reference/autovisor/modules/lesson_navigation.py` 作为第二信源交叉验证。
- 评分演算用 `node -e` 实跑（`scoreAdapter` 公式照抄 `src/02-adapter.js:211-221`），数字见 §3.1。
- **证据缺口**：`fusion` / `card2025` / `polymas` 三套在仓库内**没有任何真实 DOM 夹具**，其 finish 标记的标签名无法证实，所有关于它们的标签结论均标注「待实测」。

---

## 2. 【A】六处改动 × 六套适配器：逐套回归

### 2.0 先厘清一个被忽略的结构事实：改动 6 收紧的是**次要通道**

`isFinished(el)`（`src/02-adapter.js:399-441`）的判定顺序是：

```
第 1 层  :404  if (ad.finish && el.querySelector(ad.finish)) return true;   ← 无条件，不看标签/不看叶子
第 1b 层 :406  if (ad.finish && el.matches(ad.finish)) return true;
第 2 层  :410  条目自身 class 含 done/finished/completed/...
第 3 层  :418-423  通用 BADGE 扫描 ← 改动 6 只动了这里（421 图标白名单 / 422 叶子节点）
```

六套适配器 **全部定义了 `finish`**（`src/02-adapter.js:31/44/56/68/82/95`），因此**只要平台没改版，完成判定永远在第 1 层就返回**，改动 6 的收紧代码根本执行不到。

**结论 A-0**：改动 6 在「happy path」上影响为零；它只在「适配器 finish 选择器失效（平台改版 / 选错适配器）」时起作用，且把该场景从 *over-detect（误判全部已完成 → 停摆）* 翻转成 *under-detect（判不出已完成 → 重播）*。方向是对的，但——

> **它声称要修的「外层容器一命中就把整条目误判为已完成」，在第 1 层完整存活**：`src/02-adapter.js:404` 对 `ad.finish` 不做任何标签/叶子约束，而 polymas 的 `finish`（`src/02-adapter.js:95`）本身就比第 3 层的 BADGE（`:418`）还宽。

### 2.1 逐套结论

| 套 | finish 选择器 | 真实标签证据 | 第 1 层(404) | 第 3 层(418-423) | 回归判定 |
|----|---------------|--------------|--------------|------------------|----------|
| wisdom | `.child-check`（`:31`） | `test/fixtures/real-wisdom.html:22` `<span class="child-check">✓</span>`（span，叶子） | 命中 | 亦通过 | **无回归** |
| fusion | `.finish-icon`（`:44`） | 无 DOM 证据（缺夹具） | 命中（无条件） | — | **无回归，但存在反向误判**（见下） |
| hike | `.icon-finish`（`:56`） | `test/fixtures/real-h5.html:38` `<i class="icon-finish"></i>`（i，叶子） | 命中 | 亦通过 | **无回归** |
| legacy | `.time_icofinish`（`:68`） | `test/fixtures/real-legacy.html:21/26` `<span class="time_icofinish">`；`test/fixtures/studyvideoh5-legacy.html:33/53` `<i class="time_icofinish">` | 命中 | 亦通过 | **无回归** |
| card2025 | `.finished-icon`（`:82`） | 无 DOM 证据 | 命中 | — | **有回归（over-detect）** |
| polymas | `[class*="finish"],[class*="complete"],[class*="done"]`（`:95`） | 无 DOM 证据，且 OCS 无此写法 | 命中 | — | **有严重回归（over-detect）** |

### 2.2 逐套展开

#### wisdom — 无回归
- `.child-check` 在夹具里是 `<span>` 且无子元素（`test/fixtures/real-wisdom.html:22`），第 1 层（`:404`）和第 3 层（`:421` span 在白名单；`:422` 无子元素）**两条路都通过**，不受改动 6 影响。
- 隐患在选择器出处而非改动：`.child-info.hasvideo` / `.child-check` / `.child-name` 在 `reference/` 中**只**出现在 `reference/autovisor/modules/lesson_navigation.py:23/25/26`，OCS 里完全没有（`grep 'child-' reference/ocsjs-zhs.ts` 只命中 `.child-main` 于 `319/320`）。属单点信源。见 §4。

#### fusion — 无回归（但方向相反：过度判完成）
- 改动 6 对它**零影响**：`src/02-adapter.js:404` 只要 `el.querySelector('.finish-icon')` 非空就 `return true`，与 `.finish-icon` 是 `<i>` 还是 `<div>`、有无子元素**完全无关**。
- 真正的风险是反向的：若平台把 `.finish-icon` 用作「未完成占位图标」或在未学完时就渲染该图标，则整条目被判 done。`reference/ocsjs-zhs.ts:443` 的用法是 `if (el.querySelector('.finish-icon')) return false;`（**排除**已完成项）——语义一致；但 `reference/ocsjs-zhs.ts:326` 是查 `el.parentElement` 上的 `.finish-icon`，与我们的 `el.querySelector`（查自身子树）**作用域不同**，若完成图标打在父节点上，我们查不到 → 漏判 → 重播。

#### hike — 无回归（选择器本身有出处问题，见 §4）
- `<i class="icon-finish">`（`test/fixtures/real-h5.html:38`）：`i` 在白名单（`:421`）且无子元素（`:422`），两层都过。
- `.icon-finish` 有 OCS 背书：`reference/ocsjs-zhs.ts:1525` `const finish = !!item.querySelector('.icon-finish');`。但该文件里 `.file-item` + `.icon-finish` 属于**校内课 xnk-study**（`reference/ocsjs-zhs.ts:1489-1491`，域名 `zhihuishu.com/aidedteaching/sourceLearning`），不是 hike 域。见 §4.3。

#### legacy — 无回归
- 两个夹具里 `.time_icofinish` 分别是 `<span>`（`test/fixtures/real-legacy.html:21/26`）和 `<i>`（`test/fixtures/studyvideoh5-legacy.html:33/53`），**都在 `:421` 白名单内**，且都无子元素。第 1 层（`:404`）也直接命中。
- 改动 5（`itemTitle` 回退链）对 legacy 是**正向修复**：`src/02-adapter.js:71` 的 `#lessonOrder` 在旧页里只写 `"1.2"`（`reference/autovisor/modules/lesson_navigation.py:58` 也只有 `#lessonOrder`），`onlyNumber`（`:377`）识别后走 `:383` 的 FALLBACK 找到 `.catalogue_title`（`reference/ocsjs-zhs.ts:77` 用的正是它）。**这是六处改动里唯一一处明显正向且无副作用的。**
- 唯一小瑕疵：FALLBACK（`:383`）含 `.time`，而它是按 **DOM 顺序**取第一个（`el.querySelectorAll(FALLBACK)` 返回文档序，不是选择器书写顺序）。若 legacy 条目里存在 `.time` 元素且排在 `.catalogue_title` 之前，会取到进度文本而非课时名。低危，建议把 `.time` 从 FALLBACK 里删掉或移到末尾。

#### card2025 — **有回归（over-detect）**
- `src/02-adapter.js:82` `finish: '.finished-icon'`，`src/02-adapter.js:404` 只看**存在**。
- 但 OCS 的语义要求更多：`reference/ocsjs-zhs.ts:1179`
  ```ts
  if (card.querySelector('.finished-icon')?.textContent?.includes('已完成')) { continue; }
  ```
  即 `.finished-icon` 存在 **且** 文本含「已完成」才算完成。若该图标在未完成时也渲染（或文本是「未完成」/空），我们就会**把未完成的任务点判成已完成** → `findNext`（`src/02-adapter.js:538`）跳过它 → 课程刷不完就停。
- 这条**不是改动 6 引入的**，但改动 6 收紧第 3 层后，第 1 层的这个漏洞更加凸显（原本靠宽的第 3 层还能"歪打正着"，现在两条路都只剩第 1 层这一个错误通道）。

#### polymas — **有严重回归（over-detect），且改动 6 没修到**
- `src/02-adapter.js:95`：
  ```js
  finish: '[class*="finish"], [class*="complete"], [class*="done"]',
  ```
  这是**子串通配**，比第 3 层 BADGE（`src/02-adapter.js:418`）还宽（BADGE 至少还多列了 `learned/studied/checkmark/is-finish`，但两者都无标签约束）。
- 它在 `src/02-adapter.js:404` **无条件**返回 `true`：条目子树里只要有任意元素 class 含 `done` / `complete` / `finish`（例如 OCS 里出现的 `.ai-test-question-wrapper .done`，`reference/ocsjs-zhs.ts:351`），整条目即判完成。
- **后果链**：polymas 在候选池里（`src/02-adapter.js:194`），只要它评分最高（见 §3.3，`container: '#main'` 几乎必中 +20）→ `items()` 返回 polymas 的集合 → 每个条目都 `isFinished=true` → `breakdown().allDone`（`src/02-adapter.js:522`）= true → 弹「全部看完」停摆。**这正是 74ac103 想修的那个现象，换了个通道复发。**
- 同时 polymas 的 `finish` **在 OCS 里没有任何依据**：`grep 'course-node\|catalog-item\|lesson-item' reference/ocsjs-zhs.ts` 零命中；`[class*="chapter-item"]` 的出处是 `reference/ocsjs-zhs.ts:426` / `:1902`（WishdomH5，属 wisdom-mooc），与 polymas 无关。见 §4.6。

### 2.3 回答用户提问：「有没有哪套的 item 元素本身就是 icon 标签、或 finish 标记是大容器」

- **item 元素是 icon 标签**：六套的 `item` 选择器都不是 icon 标签名（`:29/.child-info.hasvideo`、`:42/.chapter-content-second`、`:53/.file-item`、`:66/.clearfix.video`、`:80/[class*="card-container"]`、`:92/[class*="course-node"]...`）。但 card2025（`:80`）与 polymas（`:92`）用的是 `[class*=""]` **子串匹配**，理论上能命中 `<i class="card-container-icon">` 这类图标元素自身，把它们当目录条目。概率低，实为「无权威依据的猜测式选择器」带来的噪声，见 §4.5/§4.6。
- **finish 标记是大容器**：fusion / card2025 / polymas 三套在仓库内**没有 DOM 夹具**，无法证伪。从 `.finished-icon` 需要承载「已完成」文本（`reference/ocsjs-zhs.ts:1179`）推断，它很可能是 `<div class="finished-icon"><i/><span>已完成</span></div>` 这类**带子元素的容器**——这正是改动 6 在第 3 层会**漏判**的形态（`div` 不在 `:421` 白名单、且 `:422` 因有子元素不成立）。不过这三套都有自定义 `finish`，第 1 层（`:404`）会先兜住，所以**漏判不会真的发生，发生的是 over-detect**。
- **结论**：改动 6 的「图标型/叶子」限定，**没有误伤任何一套的正常完成判定**（六套全部有 `finish`，全走第 1 层）；它的真实代价是——一旦平台改版导致 `ad.finish` 失效，通用兜底会**漏判**，且 OCS 实际使用的 `label.success`（`reference/ocsjs-zhs.ts:593`）、`i.select`（`:548`）、`.active-file`（`:557`）三种完成标记**都不在** BADGE 词表（`src/02-adapter.js:418`）里，改版后必然漏判。

---

## 3. 【B】`scoreAdapter` 的 +100 被无关 active 巧合命中

### 3.1 权重失衡：+100 是「准一票否决」

公式照抄 `src/02-adapter.js:211-221`：

```
score = min(条目数,30)          // :211   上限 30
      + (ad.active 命中 ?100:0) // :212   ← 关键
      + (container 命中 ?20:0)  // :213
      + 有标题条目数 × 2        // :216-220 上限 60
      + hostBonus(0~5)          // :221
```

`node -e` 实跑结果：

| 情形 | 得分 |
|------|------|
| 真目录，**无** active，N=10，container 命中，bonus=3 | **53** |
| 真目录，**无** active，N=26，container 命中，bonus=3 | 101 |
| 真目录，**无** active，N=27，container 命中，bonus=3 | 104 |
| 真目录，**无** active，N=30（条目/标题双封顶），bonus=5 | **115（理论上限）** |
| 干扰套：1 条 + 巧合 active，无 container | **103** |
| 干扰套：3 条 + 巧合 active | **109** |
| 干扰套：5 条 + 巧合 active | **115** |
| 干扰套：10 条 + 巧合 active | **130** |
| 干扰套：1 条 + 巧合 active + container 命中 | **123** |
| 真目录，**有** active，N=1，container 命中，bonus=3 | **126** |

**读出三条硬结论**：

1. **真目录要 ≥27 个条目才能压过「1 个干扰项 + 巧合 active」**（`104 > 103`）。多数课程一章只有 5~20 节 → **必输**。
2. **干扰套只要 ≥5 个条目且命中 active，真目录在 active 缺席时数学上不可能翻盘**：真目录上限 115（含 bonus 5），干扰套 115 起跳；`detect` 用严格大于（`src/02-adapter.js:281` `if (s > bestScore)`），同分时按 `candidates()` 顺序（`:194` legacy→hike→wisdom→fusion→card2025→polymas）取先者 → **干扰套若排位更前，115:115 也赢**。
3. **`+100` 的致命性完全取决于「真目录那一帧有没有 active」**：真目录有 active 时 126 稳赢（所以 happy path 没事）；一旦 active 缺席，就完全暴露。

### 3.2 真实可能的巧合场景（按 概率×危害 排序）

#### 场景 1（**真实可能 · 高危害**）— studyvideoh5 侧边推荐位带高亮
`test/fixtures/studyvideoh5-legacy.html:68-78` 已明确记录了这一干扰区：页面别处存在 3 个 `.file-item`（新版 Vue 目录 / 侧边推荐位）。该夹具里它们**没有** `.active`，所以 legacy 赢了。
但很多站点的侧边推荐位会做「当前高亮」。一旦其中一个带 `.active`：
- hike = `3 + 100 + 2×3 = 109`
- legacy（假设首帧 active 未渲染，10 节）= `10 + 20 + 20 + 3 = 53`

→ **hike 抢走识别权**，`items()` 返回 3 个推荐位，`findNext`（`src/02-adapter.js:538`）一轮就返回 null → 弹「全部看完」停摆。
**这就是 74ac103 声称修掉的那个 bug**：改动 3 把它从「必然发生」降级为「当干扰项恰好带 active 时发生」——缓释了，但没根治。

#### 场景 2（**真实可能 · 最高危害**）— polymas 的 `#main` 让它白拿 +20
`src/02-adapter.js:98` `container: '#main'`。`#main` 是极通用的 id（几乎所有 Vue 应用都有），只要页面有 `id="main"` 就 +20。
`src/02-adapter.js:93` 的 active 是 **4 个变体的逗号分隔选择器**，而 `src/02-adapter.js:212` 用的是 `document.querySelector(ad.active)` —— **任意一个变体命中即 +100**。其中 `.catalog-item.active`、`[class*="lesson-item"].active` 是极通用的类名组合。
→ polymas 的「干扰基线」 = `1 + 100 + 20 + 2 = 123`**，高于真目录无 active 的理论上限 115**。
→ **polymas 一旦巧合命中任一 active 变体，任何真目录（在 active 缺席时）都翻不了盘**，且 polymas 当选还会叠加 §2.2 的 over-detect，直接停摆。

#### 场景 3（**真实可能 · 高危害**）— 首帧未播放 / SPA 切换瞬间，且错误被永久缓存
- 多数智慧树课在用户点开第一集之前，目录里**没有** `current_play` / `active`。此时真目录拿不到 +100。
- `detect()` 的结果被 `Catalog._ad` 缓存（`src/02-adapter.js:300-303`）。全库**只有一处** `redetect()` 调用：`src/07-main.js:22`（`boot()` 内）。`grep -rn 'redetect' src/` 确认：定义 `:306`，调用仅 `07-main.js:22`。
- → **首帧（Vue 尚未渲染目录）识别一次，之后永不重算**。若首帧全 0 → `ZHS.state.siteVersion='unknown'`（`:289`）+ 返回 `ADAPTERS.wisdom`（`:291`）→ `items()` 因 `list.length===0` 走 `sniffItems()`（`:341-350`），而 `sniffItems` 捞的是「任意 ≥3 个同构兄弟的 div/li/a」（`:120-147`），极其不靠谱。
- → **一次识别错，全程错**。这是改动 3/4 引入的结构性缺口：旧的「第一个命中就当选」至少在后续 `items()` 空时会走 sniff，新的评分选举给了错误结果后连重试都没有。

#### 场景 4（理论可能 · 中危害）— Element UI / 组件库的通用 `.active`
`reference/ocsjs-zhs.ts:107-109`（倍速菜单 `.speedList [rate=...]`）、`:143`（清晰度 `.definiLines .xxx:not(.active)`）、`:242`（`card.className.includes('active')`）说明平台确实到处用 `.active`。
但**六个 active 选择器里有五个是复合条件**（`.child-info.hasvideo.current`、`.chapter-content-second.current`、`.clearfix.video.current_play`、`[class*="card-container"].active`、`.file-item.active`），需要「结构类名 + 状态类名」同时满足，因此**倍速/清晰度菜单这类不会误中**——这是当前设计里做得对的地方。
例外是 polymas 的 `[class*="course-node"].active` / `[class*="chapter-item"].active` 用了 `[class*=""]` 子串，放宽了结构条件（场景 2 已覆盖）。

#### 场景 5（理论可能 · 中危害）— `hasActive` 的通用白名单反过来污染成功判定
`src/02-adapter.js:595` 的通用白名单含 `is-active` / `selected` / `playing`，Element UI 的 `.el-menu-item.is-active`、`.el-tabs__item.is-active` 都会命中。
它不影响 `+100`（那里用 `ad.active`），但影响 `clickAndVerify`（`src/02-adapter.js:653` `waitUntil(() => this.hasActive(target))`）：**若目标条目本身不是当前项，但页面别处的 `is-active` 元素恰好是 target 的祖先或后代**（`:601` `cur.contains(el) || el.contains(cur)` 的包含判断），会误判「点成功了」→ `gotoNext` 认为切换成功 → 实际没切 → 卡在原地。

### 3.3 后果链路（统一）

```
scoreAdapter +100 被无关 active 命中
  → detect() 选错适配器（src/02-adapter.js:281）
  → Catalog._ad 缓存，全程不再重算（:300-303，仅 07-main.js:22 一次 redetect）
  → items() 返回错误集合（:330）
  → findNext/pending 打在空气上（:538/:561）
  → 现象 A：一轮就 allDone → 弹「全部看完」停摆（:522）
  → 现象 B：点不到目标 → clickAndVerify 两次失败 → 记「确认失败」→ 用户看到「点了下一节也没反应」
```
与 `74ac103` commit message 描述的用户现象**完全一致**——说明该 bug 的修复是不彻底的。

---

## 4. 【C】与 `reference/ocsjs-zhs.ts` 的逐项对照

> 说明：我们的 wisdom / fusion / hike / legacy 四套**并非来自 OCS**，而是来自 `reference/autovisor/modules/lesson_navigation.py:21-62`。故下表同时列出两个权威源，冲突处标红。
> OCS 的页面→处理器映射见 `reference/ocsjs-zhs.ts:820-825`；各脚本的域名见 `:646-653`（gxk-study）、`:1092-1099`（smart.study）、`:1489-1491`（xnk-study）、`:1603-1608`（wisdom.study）、`:1931-1936`（hike.study）、`:2151-2156`（hike_v2.study）。

### 4.1 legacy（旧版共享课 / studyvideoh5）

| 字段 | 我们（src/02-adapter.js） | OCS（reference/ocsjs-zhs.ts） | Autovisor | 判定 |
|------|---------------------------|-------------------------------|-----------|------|
| item | `.clearfix.video` **:66** | `.clearfix.video` **:81**、**:256**、**:139** | `.clearfix.video` **:55** | ✅ 一致 |
| active | `.clearfix.video.current_play` **:67** | `current_play` **:89**、**:293** | `current_play` **:56** | ✅ 一致 |
| finish | `.time_icofinish` **:68** | `.time_icofinish` **:84** | `.time_icofinish` **:57** | ✅ 一致 |
| title | `#lessonOrder, .catalogue_title` **:71** | `.catalogue_title` **:77** | `#lessonOrder` **:58** | ✅ 我们取了两源并集，**正向** |
| progress | `.progress-num` **:72** | `.progress-num` **:279-280**（且要求 `!=='100%'`） | `.progress-num` **:60** | ⚠️ 一致，但 OCS 用**字符串全等 `100%`**，我们用 `>=98`（`:430`/`:454`）；OCS 无 98% 这个概念 |
| container | `.clearfix` **:73** | 无 | 无 | ⚠️ **我们自造**，且 `.clearfix` 是清浮动通用类 → 几乎必中 +20，评分偏袒（见 #11） |
| courseTitle | `.source-name` **:74** | `.source-name` **:73** | `.source-name` **:61** | ✅ 一致 |

**唯一一套三源完全对齐的适配器。** 其余五套都有冲突。

### 4.2 wisdom（新共享课 / studyplush5）

| 字段 | 我们 | OCS | Autovisor | 判定 |
|------|------|-----|-----------|------|
| item | `.child-info.hasvideo` **:29** | `.child-main` **:319**（且要求 `parentElement.querySelector('.child-time')` **:320**） | `.child-info.hasvideo` **:23** | ❌ **两源直接冲突** |
| active | `.child-info.hasvideo.current` **:30** | `.current` **:335** | `.current` **:24** | ⚠️ 状态类名一致，结构类名冲突 |
| finish | `.child-check` **:31** | `.finish-icon`（在 **parentElement** 上）**:326** | `.child-check` **:25** | ❌ **冲突** |
| title | `.child-name` **:32** | `item.parentElement.textContent` **:311**，无子元素选择器 | `.child-name` **:26** | ❌ OCS 无对应 |
| courseTitle | `.course-name` **:36** | `.top-back-box > span:nth-child(2)` **:307** | `.course-name` **:30** | ❌ **冲突** |

**证据**：`grep 'child-info\|child-check\|child-name' reference/ocsjs-zhs.ts` → **零命中**；`grep 'child-' reference/ocsjs-zhs.ts` → 只有 `.child-main`（**:315/319/320**）与 `.child-time`（**:320**）。
**结论**：wisdom 套**整体来自 Autovisor，与 OCS 的 StudyPlusH5 不是同一套结构**。二者可能是 studyplush5 的两个子版本，也可能是 Autovisor 抄错了。**仓库内无 studyplush5 真实 DOM 可裁定**，需实测。风险：若真实页面是 `.child-main`，我们的 wisdom 得 0 分，studyplush5 上将走兜底（`:291` + sniffItems）。

### 4.3 fusion（AI 助教翻转课 / fusioncourseh5）

| 字段 | 我们 | OCS **FusionCourseH5**(198) | OCS **WishdomH5**(412) | Autovisor | 判定 |
|------|------|------------------------------|------------------------|-----------|------|
| item | `.chapter-content-second` **:42** | `.clearfix.video` **:256**（继承 StudyVideoH5） | `.chapter-content .chapter-item` 展开出 `.chapter-content-second` **:426/430** | `.chapter-content-second` **:35** | ❌ **与 FusionCourseH5 冲突**，与 WishdomH5 一致 |
| active | `.chapter-content-second.current` **:43** | `current_play` **:293**（resource-box 模式用 `activeNode` **:289**） | — | `.current` **:36** | ❌ 冲突 |
| finish | `.finish-icon` **:44** | `.finish-icon` **:443**（WishdomH5）；FusionCourseH5 用 `.progress-num==='100%'` **:279-280** 或 `.isFinish` **:235** | `.finish-icon` **:37** | ⚠️ 部分一致 |
| title | `.item-name` **:45** | `.file-name`（resource-box 模式）**:209**；否则继承 `.catalogue_title` **:77** | — | `.item-name` **:38** | ❌ OCS 无 `.item-name` |
| container | `.chapter-content` **:46** | — | `.chapter-content .chapter-content-second` **:422** | — | ⚠️ 与 WishdomH5 的 `hasJob` 选择器同源，OK |
| courseTitle | `.course-name` **:47** | `'智慧课程-AI'` **（硬编码）:199-202** | `.course-name` **:414-416** | 无 | ⚠️ FusionCourseH5 明确「无法读取课程名称」 |

**关键发现**：`reference/ocsjs-zhs.ts:198` 的 `FusionCourseH5` 只重写了 `getCourseName` / `getChapterName` / `getNext`，`getNext` 主干用的仍是 `.clearfix.video`（**:256**）+ `current_play`（**:293**）——**即 OCS 认为 fusioncourseh5 页面的目录结构与 legacy 同构**，只是多了 resource-box 分支（`.resources-item` **:224** / `.isFinish` **:235** / `activeNode` **:289**）。
而我们的 fusion 用 `.chapter-content-second`，那是 OCS 的 **WishdomH5（2025-09 新智慧共享课，**:412**，域 `studywisdomh5` 与 `wisdom-mooc`）**。
→ **fusion 套的选择器与它声称服务的域名（fusioncourseh5）不匹配**。Autovisor（**:86-87**）支持我们的写法，OCS 反对。**两源冲突，需实测裁定。**

### 4.4 hike（新形态课）

| 字段 | 我们 | OCS **Hike**(527) | OCS **HikeV2**(572) | OCS **xnk-study**(1489) | Autovisor | 判定 |
|------|------|-------------------|---------------------|-------------------------|-----------|------|
| item | `.file-item` **:53** | `.source-icon` 的 `parentElement.parentElement` **:541-542** | `.el-tree-node`（过滤无 children）**:586-587** | `.file-item` **:1520** | `.file-item` **:44** | ❌ **混搭** |
| active | `.file-item.active` **:54** | `.active-file` **:557** | `.is-current` **:602** | `.file-item` 带 `active` **:1523/1551** | `.file-item.active` **:45** | ❌ **混搭** |
| finish | `.icon-finish` **:56** | `i.select` **:548** | `label.success` **:593** | `.icon-finish` **:1525** | `.icon-finish` **:46** | ❌ **混搭** |
| title | `span[title]` **:57** | — | `.el-tree-node.is-current .file-name` **:578** | `#sourceTit` **:1554** | `span[title]` **:47** | ❌ OCS 用 `#sourceTit`/`.file-name`，非 `span[title]` |
| progress | `.rate` **:58** | — | — | — | `.rate` **:49** | ⚠️ 仅 Autovisor 单点 |
| container | `.el-tree` **:59** | — | `.el-tree-node` **:582/586** | — | 无 | ❌ 来自 HikeV2，与 item 来源不同 |
| courseTitle | `.course-name` **:60** | `'无名称'`（硬编码）**:528-530** | `.header-title-wrap` **:577-579** | — | `.course-name` **:50** | ❌ 混搭 |
| 域名 | `hike.zhihuishu.com` **:176** | — | — | — | **:84**、Autovisor.py:58 | ❌ **OCS 里没有这个域名** |

**关键发现**：
1. OCS 的 6 个学习脚本域名中**没有 `hike.zhihuishu.com`**；`reference/ocsjs-zhs.ts:620-624` 的 `domains` 只有 `zhihuishu.com` 与 `hike-teaching-center.polymas.com`。`grep 'hike\.zhihuishu\.com' reference/` 只在 `Autovisor.py:58` / `lesson_navigation.py:84` / `tasks.py:183,212` 命中 → **「hike 域」是 Autovisor 独有的概念**。
2. `.file-item` + `.icon-finish` 在 OCS 里属于 **校内课（翻转课）xnk-study**，域名 `zhihuishu.com/aidedteaching/sourceLearning`（`reference/ocsjs-zhs.ts:1491`）。而我们的 `hostBonus`（`:176`）把 +5 给了 `hike.zhihuishu.com` 域 → **校内课页面拿不到这 5 分**。
3. `container: '.el-tree'`（`:59`）来自 OCS **HikeV2**（`:582`），但 HikeV2 的 item 是 `.el-tree-node`，不是 `.file-item` → **item 与 container 来自两个不同的页面版本**，同一套里自相矛盾。
4. OCS 的三种完成标记 `i.select`（**:548**）/ `label.success`（**:593**）/ `.active-file`（**:557**）我们**一个都没覆盖** → 在真实 hike/polymas 页面上完成判定必然失效。

### 4.5 card2025（2025 新版卡片式）

| 字段 | 我们 | OCS | 判定 |
|------|------|-----|------|
| item | `[class*="card-container"]` **:80** | `[class*="card-container"]` **:1163** | ✅ 一致 |
| active | `[class*="card-container"].active` **:81** | `[class*="card-container"].active` **:1271**；`card.classList.contains('active')` **:1168/1170** | ✅ 一致 |
| finish | `.finished-icon` **:82** | `.finished-icon` **:1179**（**且要求 `textContent.includes('已完成')`**） | ❌ **语义不一致**（见 #6） |
| title | `.video-title, .common-text` **:83** | `.video-title` **:1157**、`.common-text` **:1258** | ✅ 一致 |
| container | `.section-item-collapse-info` **:84** | `.section-item-collapse-info` **:1153** | ✅ 一致 |
| courseTitle | `.header-title-wrap` **:85** | — | ⚠️ OCS 未取课程名；该选择器实为 **HikeV2** 的（**:577-579**），**疑似串台** |
| 域名 | `studywisdomh5` **:178** | ❌ **实际是 `smartcoursestudent.zhihuishu.com/learnPage`（:1094-1095）** | ❌ **错配** |

**关键发现（#5）**：`src/02-adapter.js:178` `if (host.includes('studywisdomh5')) return name === 'card2025' ? 5 : 0;`
但 OCS 明确：
- `studywisdomh5` → `reference/ocsjs-zhs.ts:820-825` 选 **StudyPlusH5**（`.child-main`，**:319**），**不是卡片式**。
- `[class*="card-container"]` / `.section-item-collapse-info` 属于 **新形态课程脚本 `zhs.smart.study`**，域名 `smartcoursestudent.zhihuishu.com/learnPage`（**:1092-1099**，**:1153**）。
→ **card2025 的域名加分加在了完全错误的域名上**；而在它真正的域名 `smartcoursestudent` 上，`hostBonus` 会落到 `:189` 的 `return name === 'wisdom' ? 2 : 0`，**给 wisdom 加 2 分，给 card2025 加 0 分**。双向错配。

### 4.6 polymas（智慧树·AI 课程中心）

| 字段 | 我们 | OCS 证据 | 判定 |
|------|------|----------|------|
| item | `[class*="course-node"], [class*="chapter-item"], .catalog-item, [class*="lesson-item"]` **:92** | `grep` 零命中（`course-node`/`catalog-item`/`lesson-item`）；`chapter-item` 只在 **:426/1902**（WishdomH5） | ❌ **无权威依据，属猜测** |
| active | 上者 + `.active` **:93** | OCS Hike 用 `.active-file` **:557**；HikeV2 用 `.is-current` **:602** | ❌ 无依据 |
| finish | `[class*="finish"], [class*="complete"], [class*="done"]` **:95** | Hike `i.select` **:548**；HikeV2 `label.success` **:593** | ❌ **无依据且危险**（见 #1） |
| title | `[class*="title"], span[title]` **:96** | 无 | ❌ 无依据 |
| progress | `[class*="progress"], [role="progressbar"]` **:97** | 无 | ❌ 无依据 |
| container | `#main` **:98** | 无 | ❌ 无依据且过宽（见 #3） |
| courseTitle | `[class*="course-name"], [class*="title"]` **:99** | 无 | ❌ 无依据 |
| 域名 | `polymas.com` **:175** | `hike-teaching-center.polymas.com` **:621**、**:1933**、**:2153** | ✅ 域名对，前缀 `hike-teaching-center` 更精确（我们用的是 `includes('polymas.com')`，OK） |

**结论**：polymas 是六套里**唯一完全没有权威依据**的一套——七个字段全部是 `[class*=""]` 通配猜测，而 OCS 对同一域名（`polymas.com`）给出的是 `Hike`（`.source-icon`/`i.select`/`.active-file`）与 `HikeV2`（`.el-tree-node`/`label.success`/`.is-current`）两套**具体的**选择器（`reference/ocsjs-zhs.ts:527-620`）。
→ 建议：polymas 套应**直接改写成 OCS 的 Hike / HikeV2 两套**，替换掉现有的通配猜测。

### 4.7 其它不一致

| 项 | 我们 | OCS | 判定 |
|----|------|-----|------|
| 完成阈值 | `FINISH_PCT = 98`，`isFinished` 用 `pct >= 98` **:430/:440** | FusionCourseH5/StudyVideoH5 用 `num_el.textContent !== '100%'` **:280**（即 `<100` 就算未完成） | ⚠️ 不一致。我们用 98 是为了绕「平台停在 99%」，合理，但 OCS 无此做法；若平台真停在 99%，OCS 也会重播。属**我们有理由的偏离** |
| 文本兜底 | `/(已完成\|已学完\|已学习\|学完\|已看完)/` **:432** | `textContent.includes('已完成')` **:1179** | ✅ 我们更全 |
| 纯百分比 | 只在 `!ad.progress` 时认 `/^\s*(\d{1,3})\s*%\s*$/` **:435** | — | ✅ 正向（防「100% 学习完成」误判） |
| 目录树过滤 | hike 过滤掉有子节点的中介节点 **:332-338** | HikeV2 `.el-tree-node` 过滤 `el-tree-node__children` 空 **:586-587** | ✅ 一致（但注意 OCS 是 HikeV2，我们的 item 是 `.file-item`） |
| 自动展开 | `.el-tree-node__expand-icon:not(.is-leaf)` **:247** | 无 | ⚠️ 我们自造，正向 |

---

## 5. 需实测裁定 / 未能确认的项

1. **wisdom 到底用 `.child-info.hasvideo` 还是 `.child-main`** —— 两源冲突，仓库无 studyplush5 真实 DOM。需抓一份 studyplush5 页面 HTML。
2. **fusion 到底用 `.chapter-content-second` 还是 `.clearfix.video`** —— 同上，需 fusioncourseh5 真实 DOM。
3. **fusion / card2025 / polymas 的 finish 标记真实标签名** —— 三套无夹具，无法证伪「是否大容器」。
4. **`hike.zhihuishu.com` 这个域是否真实存在** —— OCS domains（`:620-624`）里没有，只有 Autovisor 提到。若不存在，`src/02-adapter.js:176` 是死代码。
5. **真实 polymas 页面（`hike-teaching-center.polymas.com`）的 DOM** —— 现有 polymas 套是猜测，需抓真实页面后按 OCS Hike/HikeV2 重写。

---

## 6. 建议的修复顺序（不含具体代码，供决策）

1. **堵 polymas over-detect（#1）**：`src/02-adapter.js:404` 的 `ad.finish` 需要与 `:418-423` 同等的「图标型/叶子」约束，或把 `:95` 的 polymas.finish 收窄为 OCS 的 `i.select` / `label.success`。
2. **补 detect 重试（#4）**：`detect()` 结果不应永久缓存；至少在 `items()` 返回空、或 `scoreAdapter` 最高分 < 某阈值时自动 `redetect()`。
3. **重配评分权重（#2/#3）**：把 `:212` 的 +100 降到与「条目数+标题」同量级（建议 40~50），并且**改为在 `list` 内部查找 active**（`list.some(el => el.matches(ad.active))`），而不是 `document.querySelector(ad.active)` 全页查找——后者才是「无关 active 命中」的根因。
4. **修域名映射（#5）**：`studywisdomh5` 应从 card2025 改为 wisdom；`smartcoursestudent` 应新增并指向 card2025；`aidedteaching/sourceLearning` 应新增并指向 hike。
5. **修 card2025.finish 语义（#6）**：`src/02-adapter.js:404` 增加「`.finished-icon` 需文本含已完成」的特例，或改用 `:1179` 的完整判定。
6. **重写 polymas（#9/§4.6）**：按 OCS `Hike`（`:541/548/557`）与 `HikeV2`（`:586/593/602`）拆成两套，删掉通配猜测。
7. **补齐完成标记词表（#10）**：BADGE（`:418`）加入 `success` / `select` / `active-file`。
