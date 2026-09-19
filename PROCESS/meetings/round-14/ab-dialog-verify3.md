# 第三轮对抗复核 · ab-dialog-verify3（v0.6.21，未 commit）

复核人：ab-dialog-verify（独立验证 worker）
对象：`_symmetricOptions` 方案B、32q/32p 测试、`close()` P2 修复、门禁、累积副作用
方法：真实 jsdom 装载 `src/`（与 test/run.js 同法：`runScripts:'outside-only'` + `vm.runInContext`），构造 DOM 实测返回值与点击目标；不读代码臆测。
门禁实测：`node build.js` → `node tools/check-dist-fresh.js` → `node test/run.js` = **通过 358 / 失败 0**（与声称一致）。

---

## 1. 方案B 攻击：`_symmetricOptions` 会误报 → **P1（阻塞发布）**

### 1.1 实测：真选项与导航按钮混入同一对称组

```html
<div class="el-dialog__body">
  <div class="question-topic">请选择正确的说法</div>
  <div class="list">
    <div class="option">选项一</div>
    <div class="option">选项二</div>
    <div class="option">上一题</div>
    <div class="option">下一题</div>   <!-- 与选项 同父、同 tag、同 class，共 4 个 -->
  </div>
</div>
```

实测输出：
```
readOptions().texts          = ["选项一","选项二","上一题","下一题"]
readCurrent().options        = ["选项一","选项二","上一题","下一题"]
Solver.solve 收到的 options  = ["选项一","选项二","上一题","下一题"]
被 Filler.clickOption 点击的元素 = ["下一题@DIV.option"]   ← 真的点了！
closeDialogAndResume 调用次数 = 1
★★★ P1 确认：脚本真的点了「上一题/下一题」导航按钮
```

这不是单元级假象：我把 Solver 桩成返回 `D`，走的是 `Answerer._tryNonStandardAB` 的**真实入口**，`optEls[3]` 就是「下一题」，`Filler.clickOption` 被真调用（`test/run.js:305` 同一条路径）。用户此前抱怨的「乱点」会以新形态重现：脚本读题点错元素。

### 1.2 根因一：分组键用「父节点索引」而非父节点本身（`08-questions.js:403`）

```js
const key = p === el.parentElement ? (el.tagName + '|' + (el.className || '')) : '';  // :400
const gk = 'P' + Array.from(p.parentNode ? p.parentNode.children : []).indexOf(p) + '|' + key;  // :403
```

- `:400` 的 `p === el.parentElement` **恒为真**（`p` 就是 `el.parentElement`），该行等价于无条件取 `tagName|className`，形同虚设。
- `:403` 把「父节点在其父的 children 中的**下标**」当作父的身份。**两个不同父节点只要下标相同，键就相同**，元素被并进同一组。

实测（两个无关容器，各在父中为第 0 个子）：
```
c1 在父(body)中的 index = 0 ；c2 在父(#wrap)中的 index = 0
喂入 4 个候选（2 真 + 2 操作词），返回 = 4 ["甲","乙","上一题","下一题"]
★ 返回 4 ⇒ 跨父串组成立
```
即：跨父节点串组是**确定性 bug**，不依赖某平台巧合。

### 1.3 根因二：`ACTION_WORDS` 只在「**全部**成员都是操作词」时排除（`:412`）

```js
const allAction = texts.every((t) => ACTION_WORDS.indexOf(t) >= 0);
if (allAction) continue;
```
`.every` 意味着**混合组（2 真选项 + 2 操作词）直接放行**。实测页脚 4 个纯操作按钮能被排除（返回 0，✓），但混入 2 个真选项后即刻失守（返回 4，✗）。另注：`上一题/下一题` 虽在 `ACTION_WORDS`（`:130`）内，也救不了混合组。

### 1.4 现实性边界（如实说明，供排期判断）
我另测两种**常见**结构，未误报：
- 标准 Element UI（选项 `.el-radio` + 页脚 `.el-button`）：`texts=["选项一","选项二"]`，未混入。
- 选项 `.option` / 导航 `.btn`（**不同 tag+class**）：未混入。

因此 P1 触发条件是**平台把上一页/下一页等控制件渲染成与选项同父、同 tag、同 class 且总数 2~4**（如把导航放进选项列表容器、复用 `.option`）。智慧树弹题 DOM 我不能登录实测，**无法排除真实发生**；而 `:403` 的跨父串组使其触发面比"同父"更宽。鉴于后果是「脚本点错导航、可能切页/交卷」，按判据标注 **P1 阻塞发布**。
**建议修法**（3 行内）：`gk` 改用父节点身份（`WeakMap` 计数或直接 `groups` 嵌套按 `p` 分组）；并把 `allAction` 改为 `texts.some(t => ACTION_WORDS.includes(t))` 时剔除该成员或整组弃用。

---

## 2. 32q 复核：**通过**
`_optionTextRe()`（`:329-331`）返回 `new RegExp(OPTION_TEXT_RE.source,'u')`。实测：
```
flags = "u"（无 g/y）; 两次调用同一对象 = false（每次新建）
同对象连续 test("A") 3 次 = [true,true,true]  → 无 lastIndex 漂移
```
`OPTION_TEXT_RE`（`:121`）本身 `new RegExp(src,'u')` 亦无 `g`。32q 逐串断言（`A`/`A.`/`A.对`/`A、对`/`A 说法` 命中；`Apple`/`A组`/`AB` 不命中）我逐条复跑一致，锁边界有效。

## 3. 32p 复核：**P2 — 无法区分方案A/方案B**
把方案A（正则通道）人为置为「永不命中」，三种形态实测：
```
纯 A/B    方案A命中=0  方案B=2  readOptions最终=["A","B"]           ✅ 仍绿
中文序号   方案A命中=0  方案B=2  readOptions最终=["选项一","选项二"]   ✅ 仍绿
长句      方案A命中=0  方案B=2  readOptions最终=["长句甲","长句乙"]    ✅ 仍绿
```
即：**方案A 全废时 32p 依然全绿**（`solve>=1` 由方案B 独自满足）。32p 只能证明"至少一条通道活着"，不能回归守住方案A。方案A 的边界仅由 32q 直接锁正则源，尚可；但 32p 的注释声称"三种难形态必须真求解（方案A）"与事实不符，属**测试有效性瑕疵（P2，不阻塞）**。
另：32p 的 DOM 用 `<button class="opt">` + 页脚 `<button>关闭</button>`，**从不把上一题/下一题放进同 class 组** → 上文 P1 无法被现有测试捕获，建议补一条用例。

## 4. `close()` P2 复核：**通过**
5 场景实测：
```
① r=元素 + 弹窗外有 .el-dialog__close → close()=false 外部被点=0  ✅ 不再越界
② 关闭按钮在 wrapper 上               → close()=true  wrapper 内被点=1 ✅
③ 弹窗内有关闭按钮                    → close()=true  弹窗内被点=1     ✅
④ 无 wrapper（closest=null）          → close()=false 崩溃=无          ✅
⑤ root()=document（iframe 语义）      → close()=true  全局按钮被点=1    ✅ 保留全局兜底
```
P2（全局越界）已修：作用域收敛到 `r.closest('.el-dialog__wrapper')`，仅 `r===document` 时才用全局兜底。行为正确。

## 5. 累积副作用扫描
- `readCurrent()` 返回字段 = `["title","options","type","elementList","node"]`（5 个，无遗留 `byOptions` 之类半成品）。`type="single"`、`elementList.length=2` 一致。
- `readCurrent` 调用点：`13-answerer.js:140/282/483`、`08-questions.js:248/423`。`:282` 在第一段取题面、`:483` 在标准链取题，语义一致，未见残留旧语义。
- 未发现新的全局污染、未发现 dist 与 src 失配（`check-dist-fresh` = `[ok] dist 与 src 一致（16 模块, v0.6.21）`）。
- 覆盖声明复核：`Promise.all([...])`（`test/run.js:1738`）已含 `_abEntryForms`（32p 异步组），不再有"汇总先于断言打印"的假绿。此项上轮问题已修，确认。

---

## 结论
| 级别 | 问题 | 状态 |
|---|---|---|
| **P1 阻塞发布** | 方案B 无「操作词混入」防线：真选项与导航件同父同 tag 同 class 时，`readOptions` 返回含「上一题/下一题」，脚本**实测真点导航按钮** | 未修 |
| **P1 根因（同属上条）** | `:403` 分组键用父**索引**，两个不同父同下标即串组（跨父确定性误报） | 未修 |
| P2 不阻塞 | 32p 断言无法区分方案A/方案B；且其 DOM 不含导航件，抓不到 P1 | 未修 |
| P2 不阻塞 | `:400` 的 `p === el.parentElement` 恒真，是死条件（可读性/意图失效） | 未修 |
| 通过 | 32q 正则标志/lastIndex；`close()` P2 五场景；readCurrent 无副作用；门禁 358/0；`Promise.all` 无假绿 | — |

**总评：门禁 358/0 属实，但 32p 的 DOM 与真实平台脱节，绿灯掩盖了方案B 的误报路径。P1 未修前不建议发布。**
