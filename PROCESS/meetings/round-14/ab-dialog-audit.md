# `.el-dialog` A/B 弹题未走答题通道 — 根因审计（只读，未改任何文件）

## 1. 场景判定的分叉点：`.el-dialog` 弹窗整条链路是**死的**

**结论**：如果 `.el-dialog` 容器上没有 `topic-dialog` 这串类名，`Dialog.root()` 恒返回 `null`，主循环的弹题守卫根本不会进入，`_tryNonStandardAB` 永远不会被调用。

证据 1 —— `root()` 只认两种类名（`src/08-questions.js:90-91`）：
```js
root() {
  let r = document.querySelector('#playTopic-dialog, [class*="topic-dialog"]');
  if (r && U.isStructurallyVisible(r)) return r;
```
`.el-dialog` 不含 `topic-dialog` 子串 → 选择器不命中。后面只剩 iframe 兜底（`tmDialog_iframe`，`:94`），与 `.el-dialog` 无关 → 最终 `return null`（`:104`）。

证据 2 —— 守卫 2 的进入条件是「三段与」（`src/05-scheduler.js:326-329`）：
```js
if (cfg.guardOverlays && ZHS.Questions.Dialog.present()
    && U.hasStructurallyVisible(QUESTION_SELECTORS)) {
  ...
  if (ZHS.config.autoAnswer && cfg.answerDialog && ZHS.Answerer) {
```
`QUESTION_SELECTORS = '#playTopic-dialog, [class*="topic-dialog"]'`（`:22`），与 `present()` 同源。`present()` 先调 `root()`，为 null 直接 `return false`（`src/08-questions.js:108-111`），后面那个 `querySelector('.topic-item, .topic-title, ul li')` **根本没机会执行**。→ 守卫 2 被跳过 → `handleDialog` 不被调用。

证据 3 —— 唯一的调用链在 `handleDialog` 内部（`src/13-answerer.js:42-44, 72`）：
```js
const root = ZHS.Questions.Dialog.root();
if (!root) { ... return; }          // 拿不到根就返回
...
await this._answerDialog(root, sig);
```
`_answerDialog`（`:124-129`）→ `_tryNonStandardAB(root, sig)` 的前提是 `handleDialog` 已拿到 root，而 root 来源与守卫 2 是**同一个 `Dialog.root()`**。

**明确回答：这条链路不通，是死代码。** 全仓 `grep "Dialog.root|Dialog.present"` 只有 4 处（`05-scheduler.js:322/326`、`13-answerer.js:42`），全部依赖 `#playTopic-dialog, [class*="topic-dialog"]`；构建产物 `dist/` 里也搜不到 `el-dialog` 的任何匹配逻辑。凡是严格 `.el-dialog` 的弹窗，脚本既不会暂停视频、不会作答、也不会去关它——用户看到的「没在答」正是此因，而不是「答了但乱了」。

附带一处不一致（非根因）：主循环 `:341` 调的是 `ZHS.Answerer.handleDialog()` **不带 `manual`**，所以 `:31-32` 的 `if (!manual && !ZHS.config.autoAnswer) return;` 会生效；主循环能在 `autoAnswer=false` 时仍走进 `:329` 分支，是外层 `cfg.answerDialog` 与 `Answerer` 的字段名对不上（`handleDialog(opts.manual)` vs `cfg.answerDialog`）。

## 2. 选项读取：即使拿到了 root，`.el-radio` 路径也只能读出**一坨拼接文本**

`readCurrent()` 选择器（`src/08-questions.js:165`）：
```js
... .el-radio, .el-checkbox, .radio > label, .checkbox > label
```
Element UI 单选的实际 DOM：
```html
<label class="el-radio">
  <span class="el-radio__input"><input class="el-radio__original" type="radio"></span>
  <span class="el-radio__label">A. 说法正确</span>
</label>
```
- `.el-radio` 命中**外层 `<label>`**（恰好是可点击层，这点不差）；`.el-radio__label` 未被单列，靠祖先继承。
- `readText()` 用 `innerText`（`:59-63`），外层 label 的 innerText = 整棵子树文本拼接 → 对 `A. 说法正确` 得到 `"A. 说法正确"`；若 `<span class="el-radio__input">` 内含装饰性文字/符号，会粘连成 `"A. 说法正确"` 之类的**无分隔拼接**。
- 更麻烦的是：`readCurrent()` 的选择器**同时**包含 `.el-radio` 和 `.radio > label`——如果页面是 `<div class="radio"><label>…</label></div>` 且 label 内含 `.el-radio`，同一个选项会被 `querySelectorAll` 命中**两次**（去重只有 `Array.from`，没有 Set）。选项数组变成 `[A,B,A,B]`，交给 `Solver` 后答案字母与 `Bank.toIndexes`（`13-answerer.js:364`）的索引就对不上，点错位置。
- 结论：`.el-radio` 结构**能读到选项**，但读到的是外层 label 的拼接文本，且存在重复命中风险 → 即使用 `normText` 归一化，也无法保证与题库/LLM 期望的 `A. xxx` 干净格式一致。

## 3. 题干读取：**读空**

`readCurrent()` 题干选择器（`src/08-questions.js:162`）：
```js
const titleEl = r.querySelector('.topic-title, .topic-content, .topic-question');
```
Element UI Dialog 的题面通常在 `.el-dialog__title`（标题栏）与 `.el-dialog__body`（正文）里，这三个类名一个都不匹配 → `title = ''`。

后果链：`Solver.solve({ title:'', ... })` → 通道 A 被 `&& question` 拦掉（`src/11-solver.js:66`），通道 B 同理（`:79`），只剩 `gatedRandom` 随机兜底或 `return null`。**题干读不到 = 整个求解层失效**，这是比「选项读空」更硬的阻断点。

## 4. `_tryNonStandardAB`：**完全没有读题，没有调用 Solver** —— 用户说的「乱点」在代码上成立

`src/13-answerer.js:238-258`：
```js
const optSel = 'li, label, .el-radio, .el-checkbox, [role="radio"], [role="option"], .option-item, .choice-item, .answer-option';
let opts = Array.from(root.querySelectorAll(optSel)).filter((el) => {
  const t = (el.textContent || '').replace(/\s+/g, '').toLowerCase();
  return /^([ab][.、:：]?|是|否|对|错|正确|错误|√|×)/.test(t);
});
...
const idx = opts.length > 1 ? (Math.random() < 0.5 ? 0 : 1) : 0;   // ← 随机
const pick = opts[idx];
try { pick.click(); } catch (e) {}
```
全文没有任何 `ZHS.Solver.solve` 调用、没有 `qSnap.title` 参与、没有 `Bank.toIndexes`、没有 `Filler.isChecked` 自检。它只做了「扫文本前缀 → 随机取一个 → 点一下 → 试关」。**这是用户反馈的代码证据：确实只是在乱点，不存在答题通道。**

另有一个副作用：`optSel` 里的 `li, label` 是**无域名限定**的，会命中 `.el-dialog` 页脚/分页等任意 `<li>`，甚至 `label` 是空文本时被正则剔除后 `opts` 可能只剩噪音元素；`opts.slice(0,2)`（`:245`）在有 1 个真选项 + 1 个噪音 `<li>` 时就会点错元素。

## 5. 最小修复方案（不改文件，仅方案）

**前提**：`.el-dialog` 在没有 `topic-dialog` 类名时，走不到任何现有弹题逻辑。所以修复分两层，缺一不可。

**改动 A（必须）：让 `.el-dialog` 弹窗能被识别为弹题容器。**
- `src/08-questions.js:91`：`root()` 的选择器扩为
  `document.querySelector('#playTopic-dialog, [class*="topic-dialog"], .el-dialog__wrapper:not([style*="display: none"]) .el-dialog')`
  ——理由：`.el-dialog__wrapper` 是 Element UI 弹窗的真实可见性载体（隐藏时 wrapper 上带 `display:none`），加 `:not` 可过滤掉关掉后残留的 DOM，避免误判「弹窗还在」。同时需要给 `.el-dialog` 场景一个 `root` 的可见性校验（现有 `U.isStructurallyVisible`）。
- `src/05-scheduler.js:22` 的 `QUESTION_SELECTORS` 必须同步扩为同一串选择器，否则守卫 2 的第二段 `hasStructurallyVisible(QUESTION_SELECTORS)` 仍会把它挡掉。**这两处是同一份清单，建议抽成常量复用，避免再次不同步。**

**改动 B（必须）：`.el-dialog` 的题面与选项要有专门读取分支，不能靠现有通用选择器。**
- `src/08-questions.js:162`：题干选择器追加 `.el-dialog__title, .el-dialog__body .topic-title, .el-dialog__body .question-topic`；对 `.el-dialog__body` 这种容器，建议取「第一个非选项块级元素的文本」而不是整段 innerText（整段会把选项一起读进题干）。
- `src/08-questions.js:165`：选项选择器改为优先 `.el-dialog__body .el-radio, .el-dialog__body .el-checkbox`，**并把 `.radio > label` 等宽泛项挪到「未命中时」的兜底分支**，避免同题重复命中；对 `.el-radio` 取文本时改用 `el.querySelector('.el-radio__label')` 的文本，拿不到再退回整体 `readText`。

**改动 C（关键）：让 `.el-dialog` 走真答题，而不是 `_tryNonStandardAB`。**
- `src/13-answerer.js:124-129` 的 `nonStandardOpts.length === 0` 分支是「读空就随机」的入口。做完 B 之后题干/选项不再读空，就会自动绕过 `_tryNonStandardAB` 进标准链路（`:139` 起的 pages 分支 → `_solveCurrentPage` → `Solver.solve` → 点击 → `Filler.isChecked` 自检），无需新增代码。
- 保留 `_tryNonStandardAB` 作为**最后兜底**，但把它的随机点击换成真求解：即在该函数内先 `readCurrent(root)`，`options.length >= 2` 时调 `ZHS.Solver.solve({title, options, type})`，拿到字母再按索引点，点完用 `ZHS.Filler.isChecked` 自检后才 `closeDialogAndResume`；只有求解返回 null（无通道）才保留现有「提示用户手动选」分支。
- 额外补一点：`src/13-answerer.js:258` 的 `pick.click()` 建议改调 `ZHS.Filler.clickOption(pick)`（`src/12-filler.js:30-71`，已具备 `.el-radio__input` 内层点击 + `input.checked` 兜底 + 双层重试），当前直接 `.click()` 在 Element UI 上点的是外层 label，部分版本不会触发 Vue 的 v-model 更新，这也解释了「点了没选中」。

**验证方式**：改完后在 `.el-dialog` A/B 弹题页确认 `ZHS.Questions.Dialog.root()` 非空、`readCurrent()` 的 `title` 非空且 `options.length === 2`；面板日志应出现 `弹题：<题干> 选项 2 个` 与 `已作答：X（来源 bank/llm）`，而不再是 `round-13：识别到非标准 A/B 简单答题…尝试随机选`。

## 根因总结

1. **第一根因（链路断）**：`.el-dialog` 不是 `topic-dialog` → `Dialog.root()` 为 null → 守卫 2 与 `handleDialog` 双入口全部短路 → round-13 的 `_tryNonStandardAB` 是**不可达代码**。用户观察到的「没走答题通道」首先就是「没走进任何通道」。
2. **第二根因（读题断）**：即便拿到 root，`readCurrent()` 的题干选择器（`.topic-title/.topic-content/.topic-question`）匹配不到 `.el-dialog__title/.el-dialog__body` → `title=''` → `Solver.solve` 的两个通道都被 `&& question` 拦死，只剩随机兜底或直接 null。
3. **第三根因（设计断）**：`_tryNonStandardAB` 自身设计上就不含 Solver，纯 `Math.random` 二选一，且用裸 `.click()` 而非 `Filler.clickOption`，既没有「答对」的可能，也没有选中自检。

三个断点叠加，结果就是用户看到的现象：脚本在这类弹窗上「既没读题、也没答题、只乱点一下、然后要人手动选」。
