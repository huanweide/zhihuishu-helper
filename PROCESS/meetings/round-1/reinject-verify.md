# 独立验证报告：构建结构性改动 + 模块重入守卫

> 子代理：playback-flow（本轮角色：**不信任任何结论的验收员**）
> 立场：不复读改写描述，全部内容自行读源码 / 跑产物核对；发现与描述不符处直接点出。
> 只读：**未修改 src/ 与 dist/ 任何业务代码**。新增两个验证脚本（工具，非业务）：`tools/reinject-verify-independent.js`、`tools/build-selfcheck-verify.js`。
> 验证时间：本次会话；被测产物 `dist/zhihuishu-helper.user.js`（v0.6.0）

---

## 〇、先说与描述不符的三处（重要）

任务描述里有三处与实际代码/产物**对不上**，我按实际报：

| 描述 | 实际 | 说明 |
|------|------|------|
| 「15 个模块（01-util 到 13-answerer）各补了模块级守卫」 | 实际 **16 个模块**，其中 **15 个**用 `ZHS.__modXX` 守卫，`00-config` 用 `window.__ZHS_HELPER__` | `src/` 里有 **16 个 .js**：多出 `06b-course-hub.js` 和 `06c-exam.js`，不在「01~13」这个说法覆盖范围内（06b/06c 确实也有守卫，见 §D） |
| build.js 注入 `version = "x.y.z"` | 实际注入 `window.__ZHS_BUILD__.version = "0.6.0"` | 值来自 package.json，当前 0.6.0，非占位符 |
| 「正则数模块级 IIFE（`^\(function \(\) \{`）确认是 **17** 个（1 外层 + 16 模块）」 | **数出来是 17，但口径要说清**：`^\(function \(\) \{` 匹配到的是 **17** 个 —— 其中 1 个是第 25 行的**外层** IIFE，另外 16 个是模块 IIFE（模块 IIFE 也顶格写在第 0 列）。所以「17 = 1 外层 + 16 模块」这个算式成立 | 需要注意：模块 IIFE 是顶格的，不能靠缩进区分内外层 |

结论：**改动本身成立**，但「15 个模块」的表述漏了 06b/06c；好在它们也都有守卫，不影响安全性。

---

## A. 产物模块级 IIFE 计数 → **17（1 外层 + 16 模块）**

**实际跑出来的数字**

- `grep -c '^(function () {' dist/zhihuishu-helper.user.js` → **17**
- 模块标记 `/* ===== NN...`（`^/\* ===== \d\d`）→ **16**
- 沙箱重建产物统计（`tools/build-selfcheck-verify.js`）：
  - 列0 顶格 `(function () {` 个数：**17**
  - 模块标记个数：**16**
- 结构证据（`dist/zhihuishu-helper.user.js`）：
  - `:25` `(function () {` + `:26 'use strict';` → 外层包裹
  - `:28-30` 构建注入：`window.__ZHS_BUILD__ = window.__ZHS_BUILD__ || {};` / `window.__ZHS_BUILD__.version = "0.6.0";`
  - `:32` `/* ===== 00-config.js ===== */` → `:38` 模块 IIFE
  - `:243` `/* ===== 01-util.js ===== */` → `:247` 模块 IIFE
  - ……直到 `:5949` `/* ===== 13-answerer.js ===== */` → `:5953` 模块 IIFE

**判定：✅ 成立**（口径修正：17 是「含外层」，模块是 16 个不是 16 个中的 15 个；外层 1 + 模块 16 = 17）。

**build.js 自检独立复验（额外做的，任务没要求但很关键）**

我不信任「自检存在」这个说法，直接做了破坏性验证（在系统临时沙箱里复制项目，不碰真项目）：

```
[基线] exit=0  "构建完成: ... (288.2 KB, 16 模块, v0.6.0)"
[破坏] 已移除 src/01-util.js 的模块级 IIFE 包裹
构建自检失败：期望至少 16 个模块级 IIFE，实际 15 个。
模块边界被破坏会导致重入守卫失效（定时器叠加），请检查 src/*.js 是否保留了 (function () { ... })(); 包裹。
[破坏后] exit=1
[还原后] exit=0
```

→ **build.js 的自检是真的会拦住破坏，且退出码为 1**（`build.js:71-78`）。这条比 A 本身更有价值：它保证「以后有人误删模块边界」会在构建期就红。

---

## B. 无顶层 `const __ZHS_VERSION__`，且读 `window.__ZHS_BUILD__` → **成立**

**实际证据**

- `__ZHS_VERSION__` 在 `dist/zhihuishu-helper.user.js` 全文搜索：**只命中 2 处，都是注释**（`:221` `// 注意：必须读 window.__ZHS_BUILD__，不能用裸标识符 __ZHS_VERSION__。`、`:222` 历史坑说明）。**没有任何声明语句**。
  - 沙箱重建产物再验一次：`存在顶层 const __ZHS_VERSION__ 声明: false`，`产物出现 window.__ZHS_BUILD__: true`。
- `src/00-config.js:186-198`（产物 `:219-233` 同构）：
  ```js
  version: (() => {
    try {
      const b = window.__ZHS_BUILD__;
      if (b && typeof b.version === 'string' && b.version) return b.version;
    } catch (e) { /* 忽略 */ }
    return '0.0.0';
  })(),
  ```
- 运行时实证：注入后 `ZHS.version = 0.6.0`，与 `package.json` 的 `0.6.0` **一致**（见 C4）。说明「历史坑（永远回退 0.0.0）」确实被修掉了。

**判定：✅ 成立**。

---

## C. dist 产物注入 4 次的独立 jsdom 断言 → **8/8 全通过**

脚本：`tools/reinject-verify-independent.js`（独立手写，未复用 `tools/reinject-check.js`；自己劫持 `setInterval/setTimeout` 计数，不依赖产物内部计数器）。
方式：`vm.runInContext(code, dom.getInternalVMContext())`，同一 window 注入 4 次，`pretendToBeVisual: true`，末尾 `win.close()` + `process.exit()`。

**实跑输出（关键行）**

```
===== C. dist 产物注入 4 次 =====
每次注入新增 interval 数：[1,0,0,0]
interval 间隔分布：[1500,3000]
setTimeout 调用数：4
异常：[]
__ZHS_HELPER__ = true / ZHS.version = 0.6.0 / 面板数 = 1
分项：1500ms(panel)=1  3000ms(exam)=1  2000ms(scheduler)=0

PASS C1 累计 interval 数不随注入次数增长（第2~4次新增均为0） → {"total":1,"laterRounds":[0,0,0]}
PASS C2 4 次注入均无异常 → []
PASS C3 window.__ZHS_HELPER__ === true → true
PASS C4 ZHS.version === package.json version (0.6.0) → "0.6.0"
PASS C5 助手面板数量为 0 或 1 → true
PASS C6 panel refresh(1500ms) interval 只有 1 个（未叠加） → true

总计 8 项，失败 0 项
```

**逐条对账**

| 断言 | 要求 | 实测 | 判定 |
|------|------|------|------|
| setInterval 4 次完全相同 | 每次新增 interval 数相同 | `[1,0,0,0]` | ⚠️ 口径需修正，见下 |
| 4 次都没抛异常 | 无异常 | `[]` | ✅ |
| `window.__ZHS_HELPER__ === true` | true | `true` | ✅ |
| `ZHS.version` 正确 | = package.json 版本 | `0.6.0` = `0.6.0` | ✅ |
| 面板 0 或 1 个 | 0 或 1 | `1` | ✅ |

**关于「setInterval 数量 4 次完全相同」这条断言的口径 —— 我必须指出它写错了**

`[1,0,0,0]` 是**正确行为**，不是缺陷：守卫生效时，**只有第 1 次注入**会挂定时器（`06-panel` 的 1500ms refresh、`06c-exam` 的 3000ms 轮询），第 2/3/4 次注入因守卫直接 `return`，新增 interval 数为 **0**。所以「每次新增数都相同」这个期望（`[1,1,1,1]`）恰好是**守卫失效**才会出现的现象。

我最初按描述原样断言，跑出 `FAIL`，随后把断言修正为**正确的不变量**：「累计 interval 数不随注入次数增长（第 2~4 次新增均为 0）」→ 通过。

> 也就是说：**如果谁的验证报告告诉你「4 次注入 setInterval 数量完全相同」并因此判定通过，那他实际是把 bug 当成了正确**。真正要验的是「后 3 次是否新增 0 个」。

**额外强证据（C6）**：1500ms（panel refresh）在 4 次注入后**只有 1 个**。这是守卫最直接的靶子 —— 因为 `06-panel.js:1339` 的 `setInterval(() => Panel.refresh(), 1500)` 是**模块顶层语句**，只要模块体被执行就会挂上；注入 4 次却仍只有 1 个，说明后 3 次模块体根本没跑进去。

**判定：✅ 成立**（描述里的断言口径需修正为「后续注入新增 0 个」）。

---

## D. 每个模块都有守卫吗 → **全部覆盖（16/16），无漏网**

`grep '__mod|__ZHS_HELPER__' src/` 实测结果：

| 模块 | 守卫 | 位置 |
|------|------|------|
| 00-config.js | `if (window.__ZHS_HELPER__) return;` | `:9`（置位在 `:184`） |
| 01-util.js | `if (ZHS.__mod01_util) return;` / `= true` | `:9-10` |
| 02-adapter.js | `if (ZHS.__mod02_adapter) return;` | `:12-13` |
| 03-player.js | `if (ZHS.__mod03_player) return;` | `:9-10` |
| 04-resume.js | `if (ZHS.__mod04_resume) return;` | `:12-13` |
| 05-scheduler.js | `if (ZHS.__mod05_scheduler) return;` | `:11-12` |
| 06-panel.js | `if (ZHS.__mod06_panel) return;` | `:9-10` |
| 06b-course-hub.js | `if (ZHS.__mod06b_course_hub) return;` | `:20-21` |
| 06c-exam.js | `if (ZHS.__mod06c_exam) return;` | `:45-46` |
| 07-main.js | `if (ZHS.__mod07_main) return;` | `:9-10` |
| 08-questions.js | `if (ZHS.__mod08_questions) return;` | `:13-14` |
| 09-bank.js | `if (ZHS.__mod09_bank) return;` | `:16-17` |
| 10-llm.js | `if (ZHS.__mod10_llm) return;` | `:11-12` |
| 11-solver.js | `if (ZHS.__mod11_solver) return;` | `:9-10` |
| 12-filler.js | `if (ZHS.__mod12_filler) return;` | `:9-10` |
| 13-answerer.js | `if (ZHS.__mod13_answerer) return;` | `:9-10` |

**漏网模块：无 —— 全部覆盖（16/16）。**
另外确认了守卫**插在 `if (!ZHS || !ZHS.Util) return;` 之后**（抽查 `06-panel.js:7-10`：`:7` 是 Util 判空、`:9-10` 才是重入守卫），与描述一致。

**一个必须点明的边界条件**：这 15 个 `ZHS.__modXX` 守卫**依赖 `01-util` 先执行并挂上 `ZHS.Util`**。如果 `01-util` 因任何原因没跑（比如它自己的守卫被先置位、或 `window.ZHS` 不存在），后续模块会在 `if (!ZHS || !ZHS.Util) return;` 处**提前退出**，此时守卫还没机会置位 —— 但这属于「本来就没加载」，不会造成重复挂载，风险可控。真正的兜底是 `00-config` 的 `__ZHS_HELPER__`，它在最前面拦截。

---

## E. 反向测试（判断验证是否可信的关键）→ **检测方法有效**

做法：读 dist 原文 → 字符串替换把 `if (ZHS.__mod06_panel) return;` 改成 `if (false) return;   /* 故意破坏守卫 */`（仅内存替换，不写文件）→ 注入 **2 次** → 看是否出现定时器叠加。

**实跑输出**

```
===== E. 反向测试：故意破坏 06-panel 的守卫 =====
已把 "if (ZHS.__mod06_panel) return;" 替换为 "if (false) return;"
每次注入新增 interval 数：[1,1]
interval 间隔分布：[1500,1500,3000]
异常：[]
分项：1500ms(panel)=2  3000ms(exam)=1  2000ms(scheduler)=0

PASS E1 破坏守卫后第 2 次注入确实新增了定时器（检测方法有效） → true
PASS E2 破坏守卫后面板 refresh interval 出现叠加 → true
^^ 反向测试通过：同一注入方式下，守卫正常=无叠加 / 守卫被破坏=有叠加，检测方法可信

对照：守卫有效时 1500ms interval = 1 个；守卫被破坏时 = 2 个
```

**对照表（这是判断可信度的核心）**

| 场景 | 注入次数 | 1500ms(panel) interval 数 | 后续注入新增 interval |
|------|----------|---------------------------|------------------------|
| 守卫**有效**（原产物） | 4 | **1** | `[0,0,0]` |
| 守卫**被破坏**（`if (false)`） | 2 | **2** | `[1]` |

→ 同一套检测代码，只改守卫一行：**有效=不叠加，破坏=叠加**。这证明我的检测方法**真的能测出定时器叠加**，而不是因为「环境里定时器本来就不会叠加」而给出假阳性通过。

**判定：✅ 反向测试通过，C 的结论可信。**

---

## 四、总体判定

| 项 | 结论 | 关键数字 |
|----|------|----------|
| A 模块 IIFE 数 | ✅ 成立（口径修正） | `^\(function \(\) \{` = **17**（1 外层 + **16** 模块，非 15） |
| A+ build.js 自检 | ✅ 成立（额外验证） | 破坏模块边界 → **exit 1**；还原 → exit 0 |
| B 无顶层 `const __ZHS_VERSION__` + 读 `__ZHS_BUILD__` | ✅ 成立 | 仅 2 处注释命中，0 处声明；运行时 version=**0.6.0** |
| C 注入 4 次 jsdom 断言 | ✅ 成立（断言口径需修正） | **8/8 PASS**；后续注入新增 interval = `[0,0,0]`；面板=1 |
| D 守卫覆盖 | ✅ 全部覆盖，无漏网 | **16/16** 模块有守卫 |
| E 反向测试 | ✅ 检测方法有效 | 守卫有效=1 个 1500ms timer；破坏=**2** 个 |

**没有发现「改动未生效」或「产物结构与描述不符」的实质性问题。** 但有三点必须让团队知道：

1. **描述里的「15 个模块」漏了 `06b-course-hub.js` / `06c-exam.js`**（实际 16 个模块）。这两个模块**都有守卫**，所以结论不变；但若以后写文档/测试断言按「15」写，会漏测这两个。
2. **「4 次注入 setInterval 数量完全相同」是错误的不变量** —— 守卫正常时应当是 `[1,0,0,0]`。任何用「完全相同」当通过标准的验证都在放过 bug。正确断言：**第 2 次起新增必须为 0**。
3. `06-panel.js:1339` 的 `setInterval(refresh, 1500)` 与 `06c-exam.js:789` 的 `setInterval(tick, 3000)` 是**模块顶层无条件语句**，是重入最敏感的靶点，建议把「这两个 timer 在二次注入后仍各只有 1 个」固化成回归断言（我已在 C6/E2 里覆盖）。

---

## 五、新增文件（工具，非业务代码）

- `tools/reinject-verify-independent.js` —— 任务 C/E 的独立验证脚本（自劫持定时器、含反向测试），`node tools/reinject-verify-independent.js`，退出码 0=全通过
- `tools/build-selfcheck-verify.js` —— 任务 A 加强项：在系统临时沙箱复制项目、破坏模块边界、验证 `build.js` 自检会 exit(1)，跑完自动还原，不触碰项目文件

两个脚本均只读项目文件；`build-selfcheck-verify.js` 的写操作全部发生在 `os.tmpdir()` 的临时沙箱，运行后已清理。
