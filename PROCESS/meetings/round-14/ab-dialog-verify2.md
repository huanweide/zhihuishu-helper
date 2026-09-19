# 第二轮对抗复核报告：v0.6.20（round-18）P1 复验 + 标准链路回归

**验证者**：ab-dialog-verify（独立 worker）
**仓库**：`C:\Users\Administrator\WorkBuddy\2026-09-17-21-07-36\zhihuishu-helper`
**方法**：跑门禁 + 用 jsdom 自建 6 个临时脚本实测（脚本与输出文件已全部删除，未改动任何 src/dist/test/CHANGELOG/package.json）

---

## 1. P1 复验：**部分修好 —— 仍是 P1，阻塞发布**

**结论一句话**：`readOptions` 宽口径通道让「A. / B.」这类**带前缀**的按钮式弹窗能被真求解，但正则 `^([abAB][.、,:：)]?\s|对$|错$|正确|错误|是$|否$|√|×)` 要求 A/B 后**紧跟可选分隔符再跟空白**，导致**纯「A」/「B」、长句选项、中文序号选项**三种真实形态仍读不到选项 → `solve=0` → 依然只能乱猜。P1 根因（读不到选项 ↔ 要求 ≥2 选项互斥）在新形态下**重现**。

**实测（完整 `handleDialog`，统计 solve 调用）**：

| 选项文本形态 | `readOptions().texts` | 路由 | **solve 调用** | 判定 |
|---|---|---|---|---|
| `A. 对` / `B. 错` | `["A. 对","B. 错"]` | 标准链 | **1** | ✅ |
| `对` / `错` | `["对","错"]` | 标准链 | **1** | ✅ |
| **`A` / `B`（无点号）** | **`[]`** | `_tryNonStandardAB` | **0** | ❌ |
| **长句（无 A/B 字样）** | **`[]`** | `_tryNonStandardAB` | **0** | ❌ |
| **`选项一` / `选项二`** | **`[]`** | `_tryNonStandardAB` | **0** | ❌ |

正则逐串实测（`node -e` 直测）：

```
"A"          → false     "A."        → false     "A.对"    → false
"A、对"      → false     "A) 对"     → true      "A. 说法" → true
"选项一"     → false     "智慧树课程可以倍速播放" → false
"对"→true  "错"→true  "正确"→true  "是"→false?  （"对 "带尾空格 → false，但 readText 已 trim，可忽略）
```

**判据依据**：正则分支 `[abAB][.、,:：)]?\s` 中 `\s` 是**必需**的（不在 `?` 里）；`A/B` 后面必须再有空白才匹配 → `A`、`A.`、`A、对`（分隔符后直接接汉字）全部落空。

**附带发现（重要）**：`readCurrent()` 现在内部调用 `readOptions()`，所以「A./B. 前缀」的按钮式弹窗 `readCurrent().options` **非空** → `_answerDialog` 走**标准链**（实测能作答，`answered=true`）。也就是说 **32k 测试的新 DOM 根本没走到 `_tryNonStandardAB`**——它靠直接调用该函数绕过了路由层。因此 **32k 没有覆盖"按钮式弹窗能否被正确路由并真求解"这一层**。

**`D. scope 退化**：无 `.el-dialog__body` 时 `scope = r.querySelector('div.el-dialog__body') || r` 退回整个 `.el-dialog`，实测仍能正确读出 `["A. 对","B. 错"]`、未纳入页脚「确定/关闭」（被前缀过滤）。此点 **OK**。

---

## 2. `close()` 复验：**核心 bug 已修好，但发现一处越界误点**

**结论一句话**：footer（DIV）包 button 的场景**确实修好了**（点击落在 `<button>` 上）；但**候选选择器循环里仍有全局越界兜底**，会点到弹窗**之外**的同名 `.el-dialog__close`。

| 场景 | 实测 | 判定 |
|---|---|---|
| footer div 包 `<button>关闭</button>` | `button click=1`，`close()` 返回 true | ✅ 修好 |
| `<button>关闭</button>` 与 `<a>关闭</a>` 并存 | `button click=1`、`a click=0` | ✅ 选 button（符合"优先真控件"） |
| `<button><span>关闭</span></button>` | `button click=1` | ✅ span 被剔、点 button |
| 弹窗内无按钮、页面别处有同名「关闭」`<button>` | `click=0` | ✅ 未越界（兜底 2 用 `scope=root`） |
| **弹窗内无按钮、别处有 `.el-dialog__close`** | **`click=1`（越界！）** | ❌ **P2** |
| `<a>关闭<span>关闭</span></a>`（弹窗外） | `a=0 span=0` | 中性：`scope=root` 扫不到外层，非剔除逻辑问题 |

**P2 依据（08-questions.js:405）**：候选选择器循环里 `if (!btn && r !== document) { btn = document.querySelector(sel); }` —— 只要 root 内没有 `.el-dialog__close`，就会**全局**找，可能点到另一个弹窗/页面的关闭 X。实测外部 `.el-dialog__close` 被点 1 次。

**注意**：兜底 2（文本匹配）的 `scope = (r.querySelectorAll ? r : document)` 只扫 root 内部——这是**正确收紧**（2d 的 `click=0` 由此保证），与上面越界点是两处不同代码。

---

## 3. 断言有效性：**5 组均有效（能区分修好/没修好），但 32k 覆盖有缺口**

- **32k（7 条）**：把 `readOptions` 宽口径通道在脑中回退，该 DOM 下 `readCurrent().options` 会回到空、`_tryNonStandardAB` 第一段入口 `optTexts.length>=2` 为假 → solve=0 → 「solve 被调用 ≥1」断言必失败。**有效**。solve 计数污染检查：等待 300ms（Scheduler 已 stop）后 solve=0，无虚高；调一次后 =1。**计数干净**。
  - ⚠ **缺口**：32k 直接调 `_tryNonStandardAB`，未验证 `_answerDialog` 的路由（真实入口）。而实测按钮式弹窗现在走标准链 → **32k 断言"真求解可达"在真实调用路径上未被证明**。
- **32l（多弹窗）**：回退 `root()` 为 `querySelector` 首匹配 → `root().id` 会是 `settingsDlg` → 断言 `=== 'topicDlg'` 失败。**有效**。
- **32m（签名含选项）**：回退签名算法为「只 title」，实测 s1=s2=`["课中答题"]`（相同）→ 断言 `s1!==s2` 失败。**有效**。
- **32n（inline 隐藏）**：jsdom 不传导父级 `display:none`（实测 `getComputedStyle(.el-dialog).display="block"`，`isStructurallyVisible=true`），去掉 `hasInlineHidden` → `present()` 仍 true → 断言失败。**有效**（该修复确实必需）。
- **32o（空 __label）**：模拟旧 `_textHost`（`querySelector || el`）→ 实测产生 `[""]` len=1 → 断言 `len===2` 失败。**有效**。

**结论**：5 组断言都不是恒真断言，都能在回退后失败。唯一问题是 32k 未覆盖路由层。

---

## 4. 回归检查：**标准链路未断，性能无问题**

| 项 | 实测 | 判定 |
|---|---|---|
| 标准 `.topic-item` 课中弹题 | `_solveCurrentPage` 返回 `true`、solve=1、answeredCount=1、`root().id=playTopic-dialog` | ✅ 未回归 |
| 标准 `.el-radio`（Element UI）弹题 | 返回 `true`、answeredCount=1、`input.checked=true` | ✅ `clickOption` 改动后仍能答上 |
| 按钮式弹窗走标准链 | 返回 `true`、solve=1 | ✅ 意外地也被答上了 |
| `clicked` 判据显式化 | `:311` 判据仍等价 `isChecked(el)`，`_solveCurrentPage` 返回值语义未变 | ✅ 无变化 |
| 10 个 `.el-dialog` 时 `present()` 性能 | 2000 次总 840.9ms → **单次 0.42ms** | ✅ 主循环 2s 一轮，无影响 |
| 多弹窗且公告窗有 `ul li`（会得分）排在真题前 | `root().id = real`、`present()=true` | ✅ 选对容器 |

---

## 5. 门禁数字

```
node build.js                 → 16 模块
node tools/check-dist-fresh.js → [ok] dist 与 src 一致（16 模块, v0.6.20）
node test/run.js              → 通过 339 / 失败 0   ✅ 与声称一致
```

---

## 仍存在的缺陷

| 级别 | 问题 | 位置 | 复现 | 后果 |
|---|---|---|---|---|
| **P1 阻塞发布** | 宽口径正则要求 A/B 后**必需空白**，读不到「纯 A/B」「长句选项」「中文序号选项」 | 08-questions.js:321（正则）→ 13-answerer.js:292（入口） | 按钮文本分别为 `A`/`B`、长句、`选项一`/`选项二` → `readOptions().texts=[]` → 路由到 `_tryNonStandardAB` → `solve=0` | 这三种真实形态下**仍不读题、仍只乱猜**，用户核心诉求「能答就答对再关」未实现。**阻塞发布** |
| **P2 重要** | `close()` 候选选择器循环存在**全局越界兜底**，会点到弹窗外的同名关闭控件 | 08-questions.js:405 | 弹窗内无 `.el-dialog__close`、页面别处有该元素 → 实测外部元素被点 1 次 | 误关/误点其他弹窗或页面控件 |
| **P3 轻微** | 32k 未覆盖 `_answerDialog` 路由层，断言"真求解可达"在真实入口未被证明 | test/run.js:1531 | 直接调 `_tryNonStandardAB` 而非 `handleDialog` | 测试盲区：路由层再退化也不会被这 7 条断言发现 |

---

## 总体判断：**0.6.20 不能发布（P1 仍阻塞）**

门禁 339/0 属实，P2-1/P2-2/P2-3、P3-1/P3-2 与 `close()` 的 footer 修复**均经实测确认有效**（且 5 组断言都能区分修好/没修好），标准链路**未回归**、性能**无问题**。

但 **P1 只修好了一半**：修复引入的宽口径通道让「带 `A.`/`B.` 前缀」的按钮式弹窗通了（实际上现在走标准链），却对**「纯 A/B」「长句选项」「中文序号选项」**这三种真实形态依然读不到选项，`_tryNonStandardAB` 第一段 `optTexts.length >= 2` 仍为假 → `solve=0` → 仍只乱猜。这正是用户最初抱怨的「没在读题、没在答题，只是乱点」。

**发布前必须修**：

1. **P1**：把 :321 正则的 `\s` 改为可选（如 `[abAB][.、,:：)]?\s*`——注意 `\s*` 会让 `A` 单字符也匹配，需评估误报；更稳妥是用「A/B 后跟分隔符或行尾」+ 允许长句走「非 A/B 前缀但数量恰为 2」的白名单分支），并**补一条断言：断言 `handleDialog({manual:true})`（而非直接调 `_tryNonStandardAB`）在这些形态下 solve ≥1**。
2. **P2**：去掉 :405 的 `document.querySelector(sel)` 全局兜底，或限定在 `r` 的祖先/同一 wrapper 内。
3. **P3**：32k 改为从 `handleDialog` 入口发起。
