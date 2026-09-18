# 判断题（true/false）静默跳过根因调研报告

> 调研方式：只读。逐文件核对当前 `src/` 源码（行号取自本次读取，若后续代码漂移以代码内容为准则）。
> 结论：**确认存在判断题被静默跳过、不作答的情况，但仅发生在「课中弹题」路径**；作业/考试页正常。
> 根因：弹题路径 `_solveCurrentPage` 只用 `toIndexes(answer)`（只认 A-D 字母）点击选项，判断题答案为 `对`/`错` 文本时 `toIndexes` 返回 `[]`，且后续 `else if` 分支只覆盖 `completion`/`qa`，**漏掉了 `judgement`**，导致两个分支都不命中 → 不点击任何选项 → `answered=false` → 弹题无法关闭（转人工挂起）→ 表现为用户反馈的"停住"。回填层 `Filler.fill` 已正确实现判断题适配器（`12-filler.js:113-130`），但弹题路径没有调用它。

---

## 1. 相关文件与行号（当前源码）

| 文件 | 行号 | 作用 | 与判断题的关系 |
|---|---|---|---|
| `src/13-answerer.js` | `213-263` | `_solveCurrentPage` 弹题单页求解作答 | **问题在此函数内** |
| `src/13-answerer.js` | `231` | `const idxs = ZHS.Bank.toIndexes(result.answer);` | 判断题文本答案 → `[]` |
| `src/13-answerer.js` | `232-250` | `if (idxs.length) { … click … }` | 字母答案才点，判断题进不来 |
| `src/13-answerer.js` | `251` | `} else if (q.type === 'completion' || q.type === 'qa') {` | **漏写 `judgement`** |
| `src/13-answerer.js` | `252-261` | 调 `ZHS.Filler.fill(...)` 回填 | 仅 completion/qa 走到 |
| `src/13-answerer.js` | `262` | `return answered;` | 未点击返回 `false` |
| `src/13-answerer.js` | `294` | `handleHomework` 内 `ZHS.Filler.fill(q, result)` | 作业页走 Filler，正常 |
| `src/12-filler.js` | `105-157` | `fill(q, result)` 回填主函数 | |
| `src/12-filler.js` | `113-130` | `if (type === 'judgement')` 分支 | **正确按文本点「对/错」** |
| `src/12-filler.js` | `27-72` | `clickOption` 点击+自检 | 被 judgement 分支复用 |
| `src/09-bank.js` | `65-70` | `normalize` 判断题归一化 | 对/正确/True→`对`，错/错误/False→`错` |
| `src/09-bank.js` | `90-95` | `toIndexes` | 仅匹配 `[A-D]`，对/错→`[]` |
| `src/11-solver.js` | `44-121` | `solve` 主入口 | 返回 `result.answer`（文本或字母） |
| `src/08-questions.js` | `35-53` | `guessType` | 识别判断题（含选项「对/错」推断） |
| `src/08-questions.js` | `156-174` | `DialogQuestions.readCurrent` | 弹题读题，`type` 来自 guessType |
| `src/10-llm.js` | `17` | LLM 判断题提示词 | 明确要求只输出 `"对"` 或 `"错"` |

---

## 2. 判断题当前处理路径（识别 → 作答 完整调用链）

### 2.1 课中弹题路径（存在静默跳过）

1. 调度器守卫2 检测到弹题 → `ZHS.Answerer.handleDialog()`（`13-answerer.js:21`）
2. `handleDialog` 采集签名、去重 → `_answerDialog(root)`（`:56`）
3. `_answerDialog` 取当前页 → `_solveCurrentPage(root)`（`:106` / 多页 `:115`）
4. `_solveCurrentPage` 内部：
   a. `q = ZHS.Questions.Dialog.readCurrent(root)`（`:214`）→ 经 `guessType`（`:171`）得到 `q.type`（判断题=`'judgement'`）、`q.elementList`（选项 `li` 元素列表）
   b. `result = await ZHS.Solver.solve({ title, options, type })`（`:222`）
      - 题库通道 `Bank.search`（`:115`）→ `pickBest` → `normalize`（`:66`）把 `对/正确/True` 归一成 **`对`**，`错/错误/False` 归一成 **`错`**
      - LLM 通道 `LLM.vote` → 提示词（`:17`）要求只输出 **`"对"` / `"错"`**
      - 两通道对判断题的 `result.answer` 都是文本 **`对` 或 `错`**
   c. `idxs = ZHS.Bank.toIndexes(result.answer)`（`:231`）→ `toIndexes('对')` 正则 `/[A-D]/g` 不匹配 → 返回 **`[]`**
   d. `if (idxs.length)`（`:232`）→ `[]` 为假，**不进入**，不点击任何选项
   e. `else if (q.type === 'completion' || q.type === 'qa')`（`:251`）→ `q.type === 'judgement'`，**不匹配**，也不进入
   f. `answered` 保持 `false`（全程未点击；未设 `_noChannelThisRound` / `_noSelfCheck`）
   g. `return answered;`（`:262`）→ 返回 **`false`**
5. `_answerDialog` 收到 `anyAnswered === false`（`:134`）→ 因未设通道/自检标记 → 进 `else`（`:144`）`_pendingHuman = true` → 弹题保留、转人工 → 视频暂停、流程"停住"

> 关键矛盾：脚本**已经拿到正确答案**（对/错），但因为点击逻辑不会处理文本型答案，连"试一下点击"都没做，直接判定为"点击未生效"交给人工。下一轮 `handleDialog` 又因 `sig === this._lastDialogSig`（`:46`）提前 return，弹窗永久挂起直到人工作答——即用户反馈的"停住"。

### 2.2 作业/考试页路径（正常，作为对照）

- `handleHomework`（`:269`）→ `ZHS.Solver.solve(q)`（`:291`）→ `ZHS.Filler.fill(q, result)`（`:294`）
- `Filler.fill` 在 `type === 'judgement'` 分支（`:113-130`）按文本匹配「对/错」→ `clickOption` 点击并自检 → 正常作答
- **结论：同一道判断题在作业页能答、在课中弹题答不了**，差异就在 `_solveCurrentPage` 内联的"字母索引点击"逻辑（`:231-250`）vs `Filler.fill`。

---

## 3. 静默跳过的根因（具体哪一行导致的）

**直接触发行：`src/13-answerer.js:251`**
```js
} else if (q.type === 'completion' || q.type === 'qa') {
```
这一行把"走 `Filler.fill` 回填"的分支限定为 `completion`/`qa` 两类文本题，**漏写了 `q.type === 'judgement'`**。而它前面的 `if (idxs.length)`（`:232`）依赖 `toIndexes` 只认 A-D 字母，对判断题文本答案 `对`/`错` 必然返回 `[]`。于是 `judgement` 类型在两个分支之间"掉缝里"：不点、不填、`answered = false`。

**辅助根因：`src/09-bank.js:90-95` 的 `toIndexes`** 设计上只处理字母选项（单选/多选），对判断题的 `对`/`错` 返回 `[]`，本就不该作为判断题的唯一点击入口。弹题路径却把它当成了唯一入口。

> 旁注（偶发正确，不是修复）：若题库/LLM 对判断题返回字母 `A`/`B`，`toIndexes('A') = [0]` 会进入 `:232` 分支点 index 0，此时是否点对完全取决于选项顺序，属于脆弱的偶发型"碰巧答对"，并非本题修复目标。

---

## 4. 修复建议（具体改哪段、怎么改）

### 方案 A（最小改动、精准，推荐）
把 `:251` 的 `else if` 扩展，让判断题也走 `Filler.fill`（`Filler.fill` 已正确处理 `对`/`错` 文本匹配 + 索引兜底 + 点击自检）。

修改 `src/13-answerer.js` 第 251 行起的分支：
```js
      } else if (q.type === 'completion' || q.type === 'qa' || q.type === 'judgement') {
        const ok = await ZHS.Filler.fill(
          { type: q.type, elementList: q.elementList, node: root },
          result
        );
        if (ok.ok) {
          answered = true;
          ZHS.state.answeredCount++;
          ZHS.Log.info('已作答：' + result.answer + '（来源 ' + result.from + '）');
        } else {
          this._noSelfCheck = true;
          ZHS.Log.warn('判断题选项点击后未检测到选中态，交由人工处理');
        }
      }
```
要点：
- 仅增加 `|| q.type === 'judgement'`，逻辑复用已有的 `Filler.fill`，零新增点击代码。
- `node: root` 传给 Filler（弹题路径 `readCurrent` 未带 `node`；judgement/单选/多选走 `elementList` 点击不依赖 `node`，completion/qa 才用 `node`，原 `:253` 也已传 `root`，保持一致）。
- `Filler.fill` 的 judgement 分支（`12-filler.js:113-130`）先按 `对`/`错` 文本在 `elementList` 里匹配，匹配不到再兜底 `list[0]=对、list[1]=错`，并用 `clickOption` 自检选中态，行为完整。

### 方案 B（彻底统一，消除"两套点击逻辑"的长期隐患）
`_solveCurrentPage` 当前内联了"字母索引点击"逻辑（`:231-250`），与 `Filler.fill` 的 single/multiple 分支重复。可把整段替换为一次 `Filler.fill` 调用，让弹题路径与作业页共用同一回填层：
```js
    async _solveCurrentPage(root) {
      const q = ZHS.Questions.Dialog.readCurrent(root);
      if (!q || !q.options.length) {
        ZHS.Log.debug('当前分页无选项，跳过');
        return false;
      }
      ZHS.Log.info('弹题：' + (q.title || '(无题干)').slice(0, 60) + ' 选项 ' + q.options.length + ' 个');
      const result = await ZHS.Solver.solve({ title: q.title, options: q.options, type: q.type });
      if (!result) { this._noChannelThisRound = true; return false; }

      const filled = await ZHS.Filler.fill(
        { type: q.type, elementList: q.elementList, node: root },
        result
      );
      if (filled.ok) {
        ZHS.state.answeredCount++;
        ZHS.Log.info('已作答：' + result.answer + '（来源 ' + result.from + '）');
        return true;
      }
      this._noSelfCheck = true;
      ZHS.Log.warn('本题回填未生效：' + result.answer + '，交由人工');
      return false;
    }
```
优点：单选/多选/判断/填空/简答全类型在弹题与作业页走同一份实现，避免"弹题答不了判断、作业能答"的分裂。
注意：`Filler.fill` 的 single/multiple 分支（`12-filler.js:132-147`）用 `toIndexes`，与现状等价；judgement 用文本匹配；因此行为等价且多覆盖判断。

### 次级健壮性建议（可选，防字母型判断题误点）
- `Filler.fill` 的 judgement 分支当前对"字母答案"兜底只取 `list[answer === '对' ? 0 : 1]`（`12-filler.js:123`）。若题库对判断题返回 `A`/`B`（未归一化），`answer === '对'` 为 false 会点 index 1，可能点反。建议在 `Filler.fill` 入口对判断题强制归一化：
```js
// Filler.fill 内，judgement 分支开头
if (type === 'judgement' && /^A$/i.test(answer)) answer = '对';
if (type === 'judgement' && /^B$/i.test(answer)) answer = '错';
```
属于锦上添花；主修复用方案 A 即可让"对/错"文本型判断题在弹题路径正常作答。

---

## 5. 影响范围与验证要点

- **影响范围**：仅"课中弹题"中的判断题。作业/考试页、单选、多选、填空、简答均不受影响。
- **用户可感现象**：课中遇到判断题弹窗时，自动答题"点了没反应"、弹窗关不掉、视频一直暂停（即用户反馈的"停住"）。
- **验证建议（不改源码可人工核对）**：在弹题页构造一道选项为「正确/错误」的题，开启 `autoAnswer`，观察日志：修复前不会出现"已作答：对/错"且弹窗转人工；修复后应有该日志并自动关闭弹窗。
- **附带提醒（非本任务范围）**：源改完后务必执行 `node build.js` 重新生成 `dist/zhihuishu-helper.user.js`，否则线上仍跑旧逻辑（此前审计标记为 P0 的 `dist/` 未重建问题）。
