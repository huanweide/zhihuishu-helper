# 独立对抗性复核报告：v0.6.19 弹题（A/B 简单答题）修复批次

**验证者**：ab-dialog-verify（独立 worker，未参与本轮修复）
**仓库**：`C:\Users\Administrator\WorkBuddy\2026-09-17-21-07-36\zhihuishu-helper`
**方法**：跑门禁 + 用 jsdom 自建 9 个临时脚本实测每条待验证项（脚本已全部删除，未改动任何 src/dist/test/CHANGELOG/package.json）

---

## 改动 1：识别链路（01-util.js / 05-scheduler.js / 08-questions.js）

**结论：选择器打通了「能找到弹窗」，但 `root()`/`present()` 只看第一个 `.el-dialog`，且对"已关闭"判定有漏洞。**

实测（jsdom，真实 Element UI 结构）：

| 场景 | 实测结果 | 判断 |
|---|---|---|
| `.el-dialog{display:none}`（关闭后） | `root()=null`、`stillPresent()=false` | ✅ 正确 |
| `.el-dialog__wrapper{display:none}` | **`stillPresent()=true`** | ❌ 误判为仍在 |
| `.el-dialog` 移除、wrapper 留空 | `stillPresent()=false` | ✅ 正确 |
| 两个 `.el-dialog`，第一个是"设置窗" | `root().id="settingsDlg"`，`readCurrent().title="设置"`、`options=[]` | ❌ 拿错容器 |
| 第一个是"提示窗"（无 body/radio），第二个才是弹题 | **`present()=false`**（页面明明有弹题！） | ❌ 漏判 |

- **①×（部分）**：`.el-dialog__wrapper .el-dialog` 这一层没考虑 wrapper 被隐藏的情况。Element UI 关闭弹窗常保留 wrapper 并给 `wrapper` 设 `display:none`（而非只改 `.el-dialog`）。实测此时 `stillPresent()=true` → `closeDialogAndResume` 三次重试全判"没关掉"，`_failCount` 递增、转人工告警。属 **P2**（会误报"弹窗关不掉"，但因 `isStructurallyVisible` 查的是 `.el-dialog` 自身，只有当平台把隐藏加在 `.el-dialog` 上才正确）。
- **②√（确实是缺陷）**：`root()`（08-questions.js:99）与 `present()`（:128）都只用 `document.querySelector` 取**第一个**匹配。真实页面同时存在设置/公告/提示弹窗时，`root()` 会锁死在无关弹窗；更糟的是 `present()` 会返回 `false`，而调度器守卫（05-scheduler.js:340 用 `hasStructurallyVisible(QUESTION_SELECTORS)` 全量扫描）却返回 `true` → **两侧判据错位**：守卫放行、Answerer 拿到无关窗、无选项 → 落到 `_tryNonStandardAB` → 找不到选项 → 误报"请手动选 A 或 B"。这正是用户历史最痛的「错位」模式。属 **P2**（需要多弹窗并存才触发）。

---

## 改动 2：题干与选项读取（08-questions.js:201-274）

**结论：去重逻辑正确（无越界误删），但 `_textHost` 优先取空 `__label` 会丢选项。**

| 场景 | 实测 | 判断 |
|---|---|---|
| A="正确" / B="不正确"（包含关系） | `["A. 正确","B. 不正确"]`，2 个 | ✅ 未误删 |
| A="对" / B="不对" | `["对","不对"]`，2 个 | ✅ 未误删 |
| 两个选项文本完全相同（多选） | `["A. 以上都对","B. 以上都对","C. 以上都不对"]`，3 个 | ✅ 保留全部 |
| 无 `.el-radio__label`（裸文本 label） | `["A. 说法一","B. 说法二"]` | ✅ 降级正常 |
| `.el-radio__label` 存在但**为空**，文字在兄弟 `.txt` | **`options=[""]`，只剩 1 个** | ❌ 缺陷 |

- **①√**：去重不会误删合法选项。代码用 `known` 集合判断**完全相等文本**（`seen.has(t)`），不是子串包含——"正确"与"不正确"是两个不同字符串，不会互相吞。（注：任务描述里说的"包含关系去重"实际是**元素 contains 去重** + **文本全等去重**两步，实现正确。）
- **②√**：文本全等去重确实**不会**误删同文选项——这是 jsdom 实测结果（保留 3 个）。原因同上：`_readOptionEls` 主选择器命中后不叠加兜底选择器，同一元素不会被二次收进列表，所以"文本全等"只在真有重复选项时才命中，不会误伤。
- **③×（缺陷）**：`_textHost` 用 `|| el` 兜底，但 `querySelector('.el-radio__label')` **返回空字符串文本的空节点时也算命中**（节点存在），不落回 `el`。实测两个选项文本都变成 `""`，随后被文本去重合并成 **1 个**（`options=[""]`）→ 选项数从 2 变 1，索引错位、无法作答。属 **P3**（需平台把文字放在 `__label` 之外的兄弟节点，实际较罕见）。

---

## 改动 3：`_tryNonStandardAB` 两段式（13-answerer.js:255-369）

**结论：第一段（真求解作答）是【不可达死代码】，用户要的"能答就答对再关"在这条链路上【并未实现】。这是本轮最严重的问题。**

**证据（关键逻辑互斥）**：

- 进入 `_tryNonStandardAB` 的条件（:132-137）：`readCurrent().options.length === 0`
- 第一段的作答入口条件（:263）：`if (title && options.length >= 2)`
- 两者**互斥** → 一旦进入该函数，`q.options.length` 必为 `0`，`>= 2` **永远为假**，第一段整块（:259-316）**永不执行**。

实测佐证（按钮式 A/B，无 radio，才会走到这里）：

```
readCurrent: title="按钮AB题"  options=[]  elementList.length=0
第一段入口 `title && options.length>=2` = false
直接调 _tryNonStandardAB：solve 调用 = 0   clickOption(乱点) = 2   close 尝试 = 2
← solve=0 证明第一段从未发起求解
```

同一根因还有一层：`q.options` 与 `q.elementList` 在 `readCurrent` 里同源（都是从 `_readOptionEls` 来），所以 `options` 为空时 `elementList` 也必为空，:268 `const list = q.elementList || []` 拿到空数组 → 即便强行进入第一段，`for (const idx of idxs)` 也点不到任何元素。

**逐条回答任务提问**：

- **①（关闭失败会否二次作答）**：本题场景下**不会重复作答**（因为第一段根本没执行），直接进第二段猜。但**设计上确实存在重复作答路径**——`if (answered) { ... closeDialogAndResume() → 若返回 false，代码不 return，继续往下跑第二段`（:299-304 注释也承认"转入随机猜的兜底流程"）。若将来第一段被修好，这就是真实缺陷：已答对的选项会被随机猜再次点击，可能点开关闭已选中的 radio。**当前因第一段是死代码而未暴露**。
- **②（第一段成功是否 return）**：:300-303 `if (ok) { this._answeredSig = sig; return; }` — 写法正确。（实测构造第一段成功的桩，`close` 调用 = 1、兜底猜日志 = 0，确认 return 生效。）但因为第一段不可达，无从实际验证。
- **③（`1 - idx` 越界）**：**安全**。:342-343 `opts.length > 1 ? [first, 1-first] : [0]` — 只有 1 个选项时 `order=[0]`，不产生 `1`。实测单选项场景无崩溃。
- **④（`_giveUpSigs` 的 sig 是否同一值）**：**一致，无问题**。实测 `giveUpSigs = ["[\"按钮AB题\"]"]`，与 `JSON.stringify(snapshot.map(s=>s.title)).slice(0,200)` 算出的值逐字相同；第二轮 `solve=0`、不再进入，去重生效。（`collect()` 改用 `readCurrent()` 后 title 值变了，但 add 与 has 用的是同一个 sig 变量，故对齐。）
- **⑤（`_countedSig` 是否误挡正常重答）**：**不误挡**。实测同 sig 第二次作答计数不增（`+1 / +0`），但**点击照常执行**，只影响给用户看的 `answeredCount`。属设计如此，可接受。

---

## 改动 4：`handleDialog` 守卫（13-answerer.js:31-40）

**结论：正确，无回归。面板按钮不会被挡。**

- **①√**：`src/06-panel.js:1032` 实测为 `await ZHS.Answerer.handleDialog({ manual: true })` — **传了 `manual: true`**。实测 `manual:true` 时守卫放行（`panel.alert` 正常弹出 4 条提示，含"未能识别到题目或选项…"），用户点按钮**不会被挡掉**。（注：本轮新增的双开关守卫不构成回归——它只在 `!manual` 时生效。）
- **②√**：`!!(opts && opts.manual)` 使"不传"与"显式传 `false`"**等价**，行为无区别。
- **③√**：默认值 `autoAnswer=true`、`answerDialog=true`、`autoCloseDialog=true`（00-config.js:43/53/55），**默认组合不会意外挡掉自动答题**。

---

## 改动 5：`collect()` 复用 `readCurrent()`

**结论：正确，未见破坏。**

- `collect()` 在 13-answerer.js 只有 2 个调用点：`:63`（Dialog.collect → 只取 title 当签名）和 `:507`（`ZHS.Questions.collect()` → 走 `Homework.collect`，**不经** `Dialog.collect`）。
- **①√**：作业页走 `Homework.collect()`，实测 `scene()=homework`、`hw[0].title="作业题一"`、options 正常 — **完全未受波及**。
- **②√**：分页弹题实测仍返回每页一条（`length=2`，`pageIndex=0/1`，`title` 共享），结构未变；单题分支带 `elementList`（2 个），`_isAnswered` 依赖的字段未丢。
- **⚠ 但有个次生问题**（源自改动 2/3，非 collect 本身）：无标准题面的 `.el-dialog` 会退回 `.el-dialog__title`（如"课中答题"）当 title → 同一课所有这类弹窗签名都变成 `["课中答题"]` → 第二道起被 `_answeredSig` **误判"已作答跳过"**。实测 `collect() 签名 = "[\"课中答题\"]"`。属 **P2**。

---

## 改动 6：`src/12-filler.js:101-109` 暴露 `clickOption`

**结论：导出正确，但被"统一走 clickOption"的说法夸大了——主路径（真实 el-radio A/B）根本没走它。**

- 返回值签名：`async clickOption(el) → Promise<boolean>`。`null→false`、已选中且防取消→true、点击后 `isChecked`→true、兜底仍失败→false。实测 `clickOption(null)=false`、`clickOption(真实 label)=true`。
- **⚠ 但 :278 的判据 `(clicked || isChecked(el)) && isChecked(el)` 等价于 `isChecked(el)`**，`clicked` 的真假被短路掉了，形同虚设。
- **关键事实**：真实 Element UI A/B 弹窗（`.el-radio` + `__label`）**走的是标准路径 `_solveCurrentPage`**，那里 :467 用的是**裸 `flex.click()`**，不是 `Filler.clickOption`。实测：标准路径 `solve=1 / answeredCount=1`（能作答）。所以改动 6 "避免两套点击逻辑漂移"的目标，**对主路径未生效**；只有第二段随机猜（:349）用到了它，且未接收返回值（点击失败静默继续→有注释说明是刻意）。属 **P3**。

---

## 确认有效的修复（有证据）

1. **`.el-dialog__wrapper .el-dialog` 选择器确实打通了识别链路** — 真实 Element UI A/B 弹窗现在能被 `root()` 命中、`present()=true`、`scene()='dialog'`，标准路径 `solve` 调用、`answeredCount` 递增、`_answeredSig` 落位，全流程可跑通。
2. **`collect()` 复用 `readCurrent()` 让签名能区分不同弹题** — 实测两道不同题签名不同、非空签名，未破坏作业页。
3. **`_dedupeOptions` 双重去重正确** — 包含关系、同文选项、裸 label 三种边界实测均未误删。
4. **`_giveUpSigs` 去重与 sig 对齐正确** — 实测一致，第二轮不再进入（防刷屏）。
5. **守卫双开关 + `manual:true` 绕过正确** — 面板按钮不被挡，默认配置不误挡自动答题。
6. **`1 - idx` 单选项越界有守卫** — 实测无崩溃。

## 新引入的缺陷 / 未修好的点（按严重度）

| 级别 | 问题 | 位置 | 复现 | 后果 |
|---|---|---|---|---|
| **P1 阻塞** | **`_tryNonStandardAB` 第一段是死代码**：触发条件 `options.length===0` 与第一段入口 `options.length>=2` **互斥**，真求解永不执行 | 13-answerer.js:134 vs :263 | 任何按钮式/div 式 A/B 弹窗，`solve` 调用 = 0 | 用户核心诉求"能答就答对再关"**未实现**；这类弹窗只能"猜两次"，答对纯靠运气；注释与 CHANGELOG 声称的两段式与代码不符 |
| **P2 重要** | `root()`/`present()` 只取第一个 `.el-dialog`，多弹窗并存时拿错/漏判，与调度器全量扫描判据错位 | 08-questions.js:99/128 vs 05-scheduler.js:340 | 页面上先出现设置/提示/公告弹窗 | 误报"请手动选 A 或 B"、暂停视频空跑、题干被当成"设置"等无关文本 |
| **P2 重要** | 无标准题面时题干回退 `.el-dialog__title`（"课中答题"），导致同课多弹窗签名全同 | 08-questions.js:240-245 + 13-answerer.js:64 | 连续两道无 `.question-topic` 的弹题 | 第二道起被 `_answeredSig` 误判"已作答跳过"，用户看到"只有第一道会答" |
| **P2** | `.el-dialog__wrapper{display:none}`（Element UI 真实关闭形态之一）判为"仍在" | 08-questions.js:100（`isStructurallyVisible` 只查 `.el-dialog` 自身） | 平台把隐藏加在 wrapper 上 | 误报"弹窗关不掉"、`_failCount` 递增、转人工告警 |
| **P3 轻微** | `_textHost` 优先取"存在但为空"的 `.el-radio__label`，选项文本全空并被去重合并成 1 个 | 08-questions.js:219/237 | 文字放在 `__label` 外的兄弟节点 | 选项数从 2 变 1、索引错位 |
| **P3 轻微** | `clicked` 判据被短路，`clickOption` 未用于标准路径（:467 仍是裸 `flex.click()`） | 13-answerer.js:278 / :467 | 真实 el-radio 弹窗 | 与注释"统一走 clickOption 避免漂移"不符，主路径无防取消保护 |

## 门禁实测数字

```
node build.js                → 16 模块，写入 dist/zhihuishu-helper.user.js
node tools/check-dist-fresh.js → [ok] dist 与 src 一致（16 模块, v0.6.19）
node test/run.js             → 通过 316 / 失败 0   ✅ 与声称一致
```

## 总体判断：**不能发布（需先修 P1）**

门禁 316/0 是真的，但**测试没覆盖"第一段是否真的可达"这个核心断言**——现有测试只验证了"标准 el-radio 弹窗能被识别并作答"（那走的是标准路径），却没有一条断言能让 `_tryNonStandardAB` 的第一段真正跑起来。这是一个"测试通过但功能未实现"的典型盲区。

**发布前必须先修**：

1. **P1**：把 `_tryNonStandardAB` 的第一段入口条件改成与触发条件自洽（例如：允许在 `options` 为空时，仍用 `readCurrent().title` + 第二段的选项元素列表构造 `{title, options}` 去调 `Solver.solve`；或把触发条件放宽为"标准选择器命中数 < 2"），并**补一条断言 `solve` 被调用 ≥ 1 的测试**。否则用户痛点（"没在读题、没在答题，只是乱点"）只解决了一半——弹窗能识别了，但依然不读题、依然只能猜。
2. **P2**：`root()` 改为遍历所有 `.el-dialog`，取"包含题目特征（radio/checkbox/题面类）"的那一个；`present()` 改为"存在任一满足题面特征的弹窗"。
3. **P2**：题干回退 `.el-dialog__title` 时必须叠加选项文本一起参与签名（或干脆不把弹窗标题当题干），避免同课多题签名撞车。

P3 两项可延后，但建议一并修（成本极低）。
