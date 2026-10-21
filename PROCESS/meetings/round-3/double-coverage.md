# Round-3 评审：studyvideoh5 双套 DOM 是否都能吃下

- 评审对象：`src/02-adapter.js`（提交 `74ac103`）
- 信源：A 套 = `reference/gf558335.user.js:22/47/54`；B 套 = `reference/ocsjs-zhs.ts:73/77/81/84/89/139`
- 方式：jsdom 造 DOM + 加载 `00-config/01-util/02-adapter` 实跑 `detect()` 与 `Catalog`（脚本见同目录 `sim-double-coverage.js`、`sim-selector-hits.js`、`sim-legacy-title.js`）。**未修改 `src/` 任何文件。**

---

## 0. 结论一句话

**两套选择器都写全了、也没有拼错，纯 A / 纯 B 页面都能正确工作。**
真正的漏洞不在"覆盖不全"，而在**两套并存时的判别**：`scoreAdapter()` 的 +100 "当前项"分是全局 `querySelector`，不看可见性、不看容器归属，所以**已经隐藏、点不动的旧容器残骸会和真目录同分甚至更高**，能把真目录顶掉。

---

## 1. 核查①：两套选择器是否写全 / 有无拼错

`ADAPTERS.hike`（A 套）= `src/02-adapter.js:50-62`；`ADAPTERS.legacy`（B 套）= `src/02-adapter.js:63-76`。

### A 套（hike）逐字段命中 —— 夹具 `test/fixtures/real-h5.html`

| 字段 | 行号 | 选择器 | 命中 | 与信源比对 |
|---|---|---|---|---|
| item | :53 | `.file-item` | 5 | = gf558335:22 ✓ |
| active | :54 | `.file-item.active` | 1 | = gf558335:47 ✓ |
| activeClass | :55 | `active` | — | ✓ |
| finish | :56 | `.icon-finish` | 1 | ✓ |
| title | :57 | `span[title]` | 5 | ✓ |
| progress | :58 | `.rate` | 3 | ✓ |
| container | :59 | `.el-tree` | 1 | ✓ |
| locked | :61 | `.el-icon-lock, [class*="lock"]` | 0* | 夹具里锁节点在第 2 章展开后才渲染 |

\* :61 命中 0 是因为 `scoreAdapter` 跑在展开之前（见 §3.4）；`items()` 里 `expandTreeOnce()`（:329）之后再 `isLocked()` 就能命中，属夹具时序，不算缺陷。

### B 套（legacy）逐字段命中 —— 夹具 `test/fixtures/studyvideoh5-legacy.html`

| 字段 | 行号 | 选择器 | 命中 | 与信源比对 |
|---|---|---|---|---|
| item | :66 | `.clearfix.video` | 5 | = ocsjs-zhs.ts:81 / :139 ✓ |
| active | :67 | `.clearfix.video.current_play` | 1 | = ocsjs-zhs.ts:89 ✓ |
| finish | :68 | `.time_icofinish` | 2 | = ocsjs-zhs.ts:84 ✓（拼写一致） |
| title | :71 | `#lessonOrder, .catalogue_title` | 7 | `#lessonOrder` 符合任务书；`.catalogue_title` = ocsjs-zhs.ts:77 ✓ |
| progress | :72 | `.progress-num` | 5 | ✓ |
| container | :73 | `.clearfix` | 5 | ✓ |
| courseTitle | :74 | `.source-name` | 1 | = ocsjs-zhs.ts:73 ✓ |
| locked | :75 | `[class*="lock"]` | 0 | **夹具无锁节点，本字段零验证** |

**拼写结论：8+8 个选择器逐字对过信源，无一处拼错。`hike` 与 `legacy` 两套都写全了。**

---

## 2. 核查②：`scoreAdapter()` 在两套下分别选谁（含计算过程）

评分公式（`src/02-adapter.js:206-223`，稳定可读时）：

```
score = min(条目数, 30)          // :211
      + 100 × [命中 active]      // :212  ← 全局 document.querySelector，无容器限定、无可见性判定
      + 20  × [命中 container]   // :213
      + 2   × 能读出课时名的条目数（上限 30 条）// :216-220
      + hostBonus(name)          // :221 → :173-190
```
`studyvideoh5` 域名下 `hostBonus`：`legacy +3`、`wisdom +3`、`hike 0`（:188）。

### A 套页面（`real-h5.html`）

| 候选 | 计算 | 得分 |
|---|---|---|
| **hike** | 条目 5 → 5；`.file-item.active` 命中 → +100；`.el-tree` 命中 → +20；5 条都读得出名 → +10；host 0 | **135** |
| legacy | `.clearfix.video` 命中 0 → :209 直接 return | 0 |
| wisdom/fusion/card2025/polymas | item 命中 0 | 0 |

→ 当选 **hike**，实测日志 `评分 135`。正确。
当选后行为实测：`items()`=3（章节头被 :332-339 的叶子过滤掉）、`current`="1.2 数列的极限"、`next`="1.3 函数的极限"、进度 100/60/0 —— **A 套吃得住**。

### B 套页面（`studyvideoh5-legacy.html`）

| 候选 | 计算 | 得分 |
|---|---|---|
| **legacy** | 条目 5 → 5；`.clearfix.video.current_play` 命中 → +100；`.clearfix` 命中 → +20；5 条有名 → +10；host +3 | **138** |
| hike | 侧栏干扰 3 条 → 3；`.file-item.active` 无 → +0；`.el-tree` 无 → +0；3 条有名 → +6；host 0 | 9 |
| 其余 | item 命中 0 | 0 |

→ 当选 **legacy**，实测日志 `legacy=138 / hike=9`。正确。
当选后行为：`items()`=5、`current`="数列的极限"、`next`="函数的极限"、1.1/2.1 判 done(100%)、1.2=60%、1.3/2.2=undone —— **B 套吃得住**。

**小结：纯 A 选 hike、纯 B 选 legacy，方向全对；+100 的"当前项"分确实把侧栏 3 个 `.file-item` 噪声压住了（9 : 138）。**

---

## 3. 核查③：两套并存时谁会赢 —— 这才是问题所在

### 3.1 并列场景矩阵（实跑，非推演）

| # | 场景 | legacy | hike | 赢家 | 对不对 |
|---|---|---|---|---|---|
| S3 | A 真(5,active) + B 残留(5,**无** current_play) | 38 | **135** | hike | ✅ |
| S4 | B 真(5,current_play) + A 残留(5,**无** active) | **138** | 35 | legacy | ✅ |
| S5 | B 真(5) + A 残留(20,无 active) | **138** | 80 | legacy | ✅ |
| S7 | A 真(5,active) + B 残留(20,无 current_play) | 83 | **135** | hike | ✅ |
| **S6** | **A 真(5,active) + B 残留(20,仍带 current_play)** | **183** | 135 | legacy | ❌ **错** |
| **S8** | **A 真(5,active) + B 残留(5,current_play，`display:none` 已隐藏)** | **138** | 135 | legacy | ❌ **错** |
| **S9** | **A 真但章节折叠(仅 2 条露出) + B 残留(3,current_play)** | **132** | 126 | legacy | ❌ **错** |

### 3.2 为什么会错：胜负退化成"数条目"

两套都命中"当前项"时公式塌缩为：

```
hike   = 3N + 120      (N = .file-item 数)
legacy = 3M + 123      (M = .clearfix.video 数，含 ocsjs 域名偏置 +3)
```

→ **legacy 只要 M ≥ N 就赢**，与"哪套是真目录"完全无关，只比谁节点多。S6/S8/S9 三个错例都是这条公式的直接产物。

### 3.3 三个具体的误判放大器

1. **+100 不看可见性（最严重）**：`src/02-adapter.js:212` 用 `document.querySelector(ad.active)` 全文档找，`display:none` 的残骸照样满分。S8 里一个**根本点不动**的隐藏旧容器拿 138 分，压过真 A 套的 135 分；选错后 `items()` 返回的全是隐藏节点（实测 5 条全是残留），点谁都没反应 —— 这正是用户报的"点了下一节也没用"。
2. **+100 是"或"不是"且"**：判定只用 active，不校验该 active 节点是否落在本套的 `container` 里（:59 / :73）。容器分（+20）与当前项分（+100）互不约束。
3. **条目数线性计分（:211）**：残留容器通常比"折叠中的新树"节点更多，天然占优。

### 3.4 折叠时序放大了 2、3

`detect()`（:279）在 `expandTreeOnce()`（:329）**之前**执行 —— 评分那一刻新树还没展开。
`test/fixtures/real-h5.html` 第 2 章就是折叠的（第 18-20 行注释明写），A 套在评分瞬间只露 5 个节点；若页面同时有 20 条 legacy 残留，就被压过去（S9 用 2 vs 3 复现了同一机制）。

### 3.5 选错之后无法自愈

`Catalog._ad` 缓存（:298-306），全仓只有 `src/07-main.js:22` 调过一次 `redetect()`。首屏若 Vue 还没渲染完、先扫到 legacy 残骸，整个页面生命周期都不会重选。

### 3.6 这是不是想要的结果

**不是。** 想当然的预期是"谁是真目录谁赢"，实际是"谁节点多、谁还挂着 current_play 谁赢"。而且由于 §3.5 的缓存，一旦在首屏误判就没有第二次机会。

---

## 4. 核查④：覆盖缺口在哪

**结论先行：不是"某套某选择器没写"。** 两套件 8 个字段全部齐备、无拼错。缺口分两类：

### 4.1 选择器层面的缺口（B 套 1 处，A 套 0 处）

**B 套 `title`（`src/02-adapter.js:71`）取到的可能不是课时名而是章节名。**

- `#lessonOrder` 在真实页面里只写序号（"1.2"），`itemTitle` 的 `onlyNumber` 守卫（:377）会把它挡掉，转走回退链（:383）。
- 回退链第 1 位就是 `.catalogue_title`：`.catalogue_title, .video-name, .item-name, .child-name, .file-name, .time, [class*="title"], span[title]`（:383）。
- 而 `ocsjs-zhs.ts:77` 的 `getChapterName` 明写 `root.querySelector('.catalogue_title')` —— 语义上是**章节名**，同章共享。

实测（`sim-legacy-title.js`，li 内同时放 `#lessonOrder` + `.catalogue_title` + `.time`）：

```
adapter = legacy
itemTitle -> "第一章 函数与极限"   ← 1.1 映射与函数
itemTitle -> "第一章 函数与极限"   ← 1.2 数列的极限
itemTitle -> "第一章 函数与极限"   ← 1.3 函数的极限
findByName("函数的极限") -> ""     ← 按名重定位彻底失配
```

后果：同章所有课时同名 → `findByName`（:566-575）失配、`ZHS.state.lessonKey` 串台、`clickAndVerify` 的"按标题重定位"（:654-659）会定位到同章第一条。
**注意：现有夹具 `studyvideoh5-legacy.html` 把 `.catalogue_title` 放在 `<li>` 外面（第 28/48 行），恰好绕开了这个坑 —— 夹具掩盖了缺陷，测试全绿不代表这块是对的。**

### 4.2 判别逻辑层面的缺口（主要矛盾）

| 缺口 | 位置 | 建议（本次未改） |
|---|---|---|
| active 命中不看可见性 | :212 | `offsetParent`/`getClientRects().length` 过滤隐藏节点后再计分 |
| active 与 container 互不约束 | :212 / :213 | 要求 active 节点落在 `container` 内（或至少近邻）才给满分 |
| 条目数线性加分，残留容器天然占优 | :211 | 改为对数/封顶更低，或只统计"可见且可点"的条目 |
| 域名偏置方向硬编码 | :188 | 两套都命中 active 时它成了决定性的 3 分，建议降级为 tie-break 专用 |
| 评分早于展开 | :279 vs :329 | `detect()` 前先跑一次 `expandTreeOnce()` |
| 结果一选终身 | :298-306 / `07-main.js:22` | `items()` 连续 N 次为空或点击连续失败时触发 `redetect()` |
| B 套 `activeClass` 未声明 | :67（对比 :55） | 补 `activeClass: 'current_play'`；现在靠 :595 的通用词兜底才不翻车，属"侥幸通过" |
| B 套 `locked` 零验证 | :75 | 夹具里没有锁节点，补一条带 `.el-icon-lock` 的 B 套用例 |

---

## 5. 复现

```
node PROCESS/meetings/round-3/sim-double-coverage.js   # 9 个场景的当选者与得分
node PROCESS/meetings/round-3/sim-selector-hits.js     # 16 个选择器逐字段命中数
node PROCESS/meetings/round-3/sim-legacy-title.js      # B 套课时名读取路径
```
