# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

> 📌 **文档语言说明**：本仓库面向**中文受众**，默认仅维护**中文 README（即根目录 `README.md`）**。
> 已移除英文版 `README_EN.md` —— 不再默认生成/维护英文文档，避免双份同步漂移与无谓负担。
> GitHub 仓库页**默认渲染 `README.md`（中文）**，访客开箱即见中文，无需切换。

## [0.6.67] - 2026-10-28
> round-58：**人类化与防检测 —— 在场感知 + 拟人化节奏 + 反暴力重试**

### 新增（核心能力）
- **在场感知基座 `src/15-presence.js`**：监听鼠标/键盘/滚动/可见性/聚焦，维护「最近活动时刻」与「标签聚焦态」，
  暴露 `Presence.isUserPresent()`（标签聚焦 + 近 `userIdleSec` 秒内有活动 = 在场；隐藏标签 / 静默超时 = 离场）。
  这是反检测的第一道关：**真人在场却由脚本代劳，是最扎眼的自动化指纹**；只在你离开时动，才最像「挂机托管」的真实场景。
- **让权闸门（三铁律落地）**：
  1. **不跳转题目，等待用户跳** —— 在场时调度器不自动 `gotoNext`、不切课、不进课程中心自动选课，只保活视频，控制权留给你；
  2. **不主动答测试考试题目** —— 作业/考试页在场绝不自动作答（即便开启 `answerHomework` 也只在离场时接管）；
  3. **不多次尝试突破** —— 弹窗关闭重试封顶 2 次（原 3 次），关不掉即安静转人工，绝不连环猛关被风控盯上。
- **拟人化节奏**：
  - 答题前「思考延迟」改为随机区间（`answerDelayMin`/`answerDelayMax` 默认 2~6s），抹掉「弹出即答」机器特征；
  - 答后「停留再关」固定 1200ms 改随机 1.0~2.5s，给平台登记留余量；
  - 主循环从固定 `setInterval(2000)` 改为递归 `setTimeout` + ±0.5s 抖动，消除「完美 2 秒周期」指纹。

### 配置
- 新增 `yieldToUser`（默认 true）、`userIdleSec`（默认 90）、`answerDelayMin`（2）、`answerDelayMax`（6）。
- 面板新增「人类化与防检测」分区：在场让权开关 + 离场静默阈值输入。

### 测试
- 新增 `test/run.js` **O 组 14 条**判别测试（v0.6.67）：覆盖 `Presence` 挂载/活动更新/隐藏标签/开关关/调度器委托，及配置默认值。

### 门禁
- `node build.js` → 21 模块 v0.6.67；`node tools/check-dist-fresh.js` 一致；`node test/run.js` → **735 通过 / 0 失败**（720 + 新增 14，含 dist 校验项）
- **文档（开源接受帮助）**：README 顶部新增「用途与红线（开箱前必读）」速览（明确用途 ✅ + 不要用/红线 ⛔）；强化「开源协作 / 接受帮助」段（列出需要的帮助类型）；新增 `feature_request` 模板与 `CODE_OF_CONDUCT.md`；CONTRIBUTING 补「我们能一起做的事」并接入行为准则。

---

## [0.6.66] - 2026-10-27
> round-57：**代码层专业度 — 端到端接线闭环**（清掉 M2 遗留的半成品 + 补判别测试）

### 修复（真问题：上一轮 M2 引入但未接线的 dead code / 半成品）
- **`CourseHub.summary()` 接线落地**：该函数 v0.6.64 就已写好（课程中心资源遍历，统计「还剩多少门未学完」），
  但**全库零调用**——面板实际用的是 `ZHS.Stats.summary()`（学习行为统计，二者口径不重叠）。
  本轮在面板新增「课程中心（剩余课程）」展示区，`renderHub()` 仅在课程中心页调 `summary()` 展示剩余课程，
  否则降级提示；并加「刷新」按钮。M2 宣称的「面板展示剩余未学课程数」能力终于端到端闭环。
- **`summary()` 改调 `this.collectCards()`**（原调闭包局部 `collectCards`）：既符合对象内方法调用规范，
  又让其可被测试注入驱动（判别测试不再依赖真实 DOM 扫描）。

### 增强
- **`CourseHub` 新增 `isHubPage` / `getSummary` 导出**：`isHubPage` 供面板判断当前是否课程中心页（决定是否扫描）；
  `getSummary` 返回最近一次 `summary()` 的同步快照，面板刷新无需重复扫 DOM。
- **`summary()` 内部缓存**：调用后把结果存到 `this._lastSummary`，`getSummary()` 直接读，避免重复遍历卡片。

### 测试
- 新增 `test/run.js` **N 组 15 条**判别测试（v0.6.66）：覆盖 summary 统计口径（finished 计数、done/failed 排除）、
  getSummary 缓存、isHubPage/getSummary 导出契约。修复前 `summary()` 与面板无关联（零调用），现已端到端可证。

### 门禁
- `node build.js` → 20 模块 v0.6.66；`node tools/check-dist-fresh.js` 一致；`node test/run.js` → **721 通过 / 0 失败**（连跑稳定，非 flaky）

### 补记（同版本内 · 文档漂移与呈现收尾）
- **修文档漂移（11 处）**：上一轮只同步了 `package.json` + `CHANGELOG`，README / `docs/PROJECT_MAP.md` /
  CONTRIBUTING / PR 模板 / `docs/40-开发者笔记.md` 仍停在 **v0.6.65 + 717**（实测 0.6.66 / 721）。
  这是同类问题第二次复发（v0.6.65 才修过 677→706），故本条连同下面的新门禁一起收口。
- **新增第 ⑤ 条门禁 `tools/check-docs-consistency.js`**：校验版本号三件套（README / PROJECT_MAP / CHANGELOG）
  是否都提到当前版本、首屏是否残留旧版本号、以及各文档里的测试数是否自相矛盾；
  传 `--tests <n>` 时再校验与实跑数字一致。CI 里把 `test/run.js` 实跑出的通过数喂给它 ——
  **README 上的测试数从此由机器兜底**。已做「先红后绿」判别验证：注入 717 必红，恢复必绿。
- **README 安装区重写**：原先只给「装 Node → clone → build」一条路，
  普通用户来仓库的第一诉求是「装上」而不是「构建」，属真实转化损失。
  现改为：① jsDelivr 一键安装直链（推荐，零 Node）→ ② Releases 下载稳定版 → ③ 源码构建（要改代码才需要）。
- **控制台 API 速查补 `zhs.learn()` / `zhs.gotoLesson(n)`**：v0.6.64 加的自动学习引擎 API 一直没进速查表，
  功能宣称与文档不一致（与 M2 dead code 同类病），现已补齐。
- **发布首个 GitHub Release v0.6.66**（含 `dist/zhihuishu-helper.user.js` 附件 + 安装说明 + 四条红线）。
  此前 `latestRelease` 为 null，仓库没有稳定版下载入口。

### 修复（真 bug：异步测试组漏登记 = 红线断言假绿）
- **根因**：`test/run.js` 的 `_retryNoSeek` 组（第 3521 行）既不在末尾 `Promise.all` 里、也没有就地 `await` ——
  它在 `Promise.all(...).then()` 回调内部才定义，根本进不去那个列表。后果有两层：
  ① 断言在汇总打印之后才跑完 → 通过数随机器调度漂移（**本地 721 / CI 717**，差的就是这 4 条）；
  ② 更严重：失败也不进 `fail` 计数、exit code 不变红 → **假绿**。
  而这一组测的正是项目四大红线之一的「**补播绝不 seek**」——等于这条红线从来没被门禁真正验证过。
  现已就地 `await _retryNoSeek;`。
- **顺带揪出 6 个侥幸组**：`_nonvideo` / `_sync` / `_syncNoPct` / `_verifyHold` / `_fusionCatalog` / `_aiExercise`
  一直没登记，靠「定义在文件前段、内部无宏任务 → 跑得比汇总打印早」侥幸计入。这是时序巧合不是设计保证，
  哪天组内加一个 `await sleep` 就会重演假绿。现已全部补进 `Promise.all`。
- **新增第 ③ 条门禁 `tools/check-test-registry.js`**：静态扫 `test/run.js`，提取所有 `const _xxx = (async ...`，
  逐个核对是否进了 `Promise.all` 或就地 `await`，漏一个就红。已做判别验证：
  对修复前的版本跑必红（报出 7 个），修复后 40/40 全绿。
- **门禁编号统一为六条**（README / CONTRIBUTING / PR 模板 / ci.yml 四处口径一致）：
  ① build → ② check-dist-fresh → ③ check-test-registry → ④ test/run.js → ⑤ check-docs-consistency → ⑥ 截屏测试（本地）。
  CI 跑 ①~⑤。

---

## [0.6.65] - 2026-10-25
> round-56：**仓库呈现与工程规范补齐**（MaxLoop v4.2 模式A 一轮：外部学习 → 发现真问题 → 修复 → Oracle 复检）

本轮**不改脚本逻辑**，修的是「把一个成熟项目摆到 GitHub 上该有的东西」——
经外部调研（60k+ stars 项目的 README 实证规则）与 `gh repo view` 实测比对后收敛出的 4 条真缺陷：

### 修复（每条都有外部判据，非拍脑袋）
- **补 `LICENSE`（MIT）**：此前 `package.json` 声明 MIT、README 徽章也指向 `LICENSE`，**但文件根本不存在**——
  `gh repo view` 实测 `licenseInfo: null`（GitHub 判定「无许可证」），徽章是断链。现已补全，并在文末附免责声明。
- **新增 `CONTRIBUTING.md`**：README 挂着 "PRs Welcome" 徽章，但点进去是空的 PR 列表、无贡献指南，
  贡献链路断。现已写明模块结构、四条门禁命令、加模块的重入守卫写法、**四条不可触碰的红线**、提 issue 要带什么。
- **修正 topics**：实测发现混进了 `bilibili`（与智慧树毫无关系，属错误分类，会引来无关流量且显不专业）——已删除，
  并补 `mooc` / `online-course` / `auto-answer` / `study-helper`（现 14 个，上限 20）。
- **新增 `assets/social-preview.png`（1280×640）**：GitHub 社交分享预览图。调研里明确点名这是
  「多数项目跳过的低成本高回报优化」——无自定义预览时分享出去是信息量不足的默认卡片。
  （该文件需在仓库 Settings → Social preview 手动上传，API 不支持设置。）

### 增强
- **新增 GitHub Actions CI**（`.github/workflows/ci.yml`）：把本地四条门禁搬进 CI（build → check-dist → 706 项单测），
  让 README 的 Build 徽章有真实依据，也让 PR 自动过门禁。截屏测试需真机浏览器，仍保留本地手动执行。
- **README 徽章补质量信号**：新增 `CI`（质量信号）与 `Last commit`（活跃维护信号），
  并把 `PRs Welcome` 徽章改指新加的 CONTRIBUTING.md。徽章总数 6 个，控制在「不超过 8–10 个」的实证安全区内。
- **README 新增「📚 文档」「🤝 参与贡献」两区**：把散落的 docs 收成一张表，贡献入口与红线前置。
- **README 瘦身（403 行 / 1.6 万字 → 152 行 / 6 千字）**：把「平台侦察 / 参考项目调研 / 技术方案 / 里程碑 / 质量度量」
  五个**开发者向**章节外置到新增的 `docs/40-开发者笔记.md`，README 只留导航与首屏。
  调研实证规则要求 README 落在可读甜区，原长度明显超标、对潜在使用者信息过载。
  外置时顺手修掉 3 处失真数字（单测数还写 **677**，实测 **706**）与 1 处旧版本号（mermaid 图里仍是 v0.6.60）。
- **英文 README 追平中文侧**：此前版本徽章停在 v0.6.64、测试数字写 677（实测 706）属文档失真；
  补齐六件套徽章、真实界面截图（英文侧此前零视觉证据）、Docs / Contributing 两区；
  Features 里两条都在讲「不瞎蒙」，精简为准确率机制 / 兜底策略各一条。
- **中文侧视觉证据前置**：真实界面截图原在第 413 行（几乎没人滚到），提到首屏，文末重复展示的同一张图已删。
- **新增协作模板三件套**：`.github/ISSUE_TEMPLATE/bug_report.md`（用 `copy(zhs.logs())` 取证，
  用户脚本项目最实用）、`config.yml`（引导到文档而非开空 issue）、
  `PULL_REQUEST_TEMPLATE.md`（四条门禁 + 四条红线自检清单）。

### 门禁
- `node build.js` v0.6.65 构建通过；dist 与 src 一致（`check-dist-fresh` 过，20 模块 v0.6.65）。
- `test/run.js`：**706 通过 / 0 失败（全绿）**，本轮未改脚本逻辑，零回归。
- 代码层评审结论（诚实记录）：无 TODO/FIXME 残留、无裸 `console` 调试残留、空 `catch` 均为 DOM 防御性写法；
  端到端入口经核验已铺满 3 处面板入口 + 2 个运行时 API。**未发现值得改的代码层缺陷，故本轮不动代码**——
  不为凑数硬找问题。

---

## [0.6.64] - 2026-10-25
> round-55：**全自动学习引擎（M2）+ LLM 作答正确率拉升（M3）**

### 新增：自动学习引擎（默认开启）
- 新增总开关 `autoLearn`（默认 true）：进入课程中心即自动选未完成课并续播，**默认就是全自动**，无需逐项开开关。
- 运行时 API：`zhs.learn()` 一键开跑、`zhs.gotoLesson(n | 标题)` 跳到指定课时（支持序号 / 标题精确 / 标题子串，越界与空值安全返回）。
- 面板新增「跳到指定课时」输入框 + 「前往」按钮、「找下一门课」按钮；课程中心资源遍历 `summary()` 供面板展示剩余未学课程数。
- 断点续播闭环联动保留；红线「绝不自动跳转作业/考试页」「绝不 seek」**一字节未动**。

### 强化：LLM 测验正确率 + 永不瞎选（M3）
- 重写答题 Prompt：逐步推理（逐一排除）+ 严格单 Token 输出 + few-shot 例题锚定格式，选择题/判断题温度降到 0.1（果断少分裂）、主观题 0.3。
- 新增投票置信闸门：`vote()` 记录票型置信（全票一致=high / 过半=medium / 分裂无多数=low）；**分裂时补投一次给收敛机会，但仍无多数则标 low 交人工复核，不当答案**。
- 求解层「低置信交叉验证」：LLM 票型分裂 + 离线启发式结论一致 → 提升 medium（双独立信号互证）；不一致仍采用 LLM（有依据非瞎蒙）但保持 low 并告警。「永不瞎选」由 `gatedRandom`（默认关）把守，未引入任何随机兜底。

### 门禁
- `node build.js` v0.6.64 构建通过；dist 与 src 一致（`check-dist-fresh` 过，20 模块 v0.6.64）。
- `test/run.js`：**706 通过 / 0 失败（全绿）**，新增 25 条单测（autoLearn 默认、Prompt 强化、投票置信、低置信交叉验证、选节目标解析），零回归。

---

## [0.6.63] - 2026-10-24
> round-54：**面板 UI 文案用语复核**——去黑话、消歧义、统一术语

### 面板用语修正（纯文案，行为零改动）
- 「点检」→「检测」（通道健康检测区 hint + 按钮注释，2 处）：工业/日语黑话，普通用户看不懂。
- 学习记录统计「跳过」→「漏答」：与答题兜底区（gatedRandom「宁可漏答不瞎蒙」）、总结报告（「X 题漏答」）统一为同一术语，不再一词两说。
- 「投票次数」→「LLM 复验次数」+ 补 hint：原词是项目内部术语，用户不懂；现名直说用途，并解释「同一题让模型独立答多次取多数，降低偶发答错（越多次越费 Token）」。
- 「自动跳课」→「学完自动进下一门」：原标签易被误读成「逃课不学」，新标签与 hint（「本课学完自动去课程中心找下一门」）一致，歧义清零。

### 门禁
- `node build.js` v0.6.63 构建通过；dist 与 src 一致（`check-dist-fresh` 过，20 模块 v0.6.63）。
- `test/run.js`：**677 通过 / 0 失败（全绿）**，无新回归。

---

## [0.6.62] - 2026-10-24
> round-53：**端到端恢复播放统一闭环 + 设置面板「不瞎蒙」人话化**

### 端到端修复（关弹窗后视频不接着放，彻底收口）
- 此前 `_handleDialog` 里**两条分支**仍是裸 `video.play()` 不校验：
  - ①「答案内嵌在页面」的弹题（AI 助教小智出的，正确答案直接渲染在 DOM 里）→ 走 domAns 分支；
  - ②「未开启自动答题」时 → 走内联分支。
  自定义播放器（prism/video.js/腾讯 txp）会吞掉裸 `play()`，导致这两条路径关掉弹窗后**视频照样不接着放**。
- 本轮把两条分支统一收敛到 `Answerer._resumePlay()` 闭环（点真实播放按钮 + 复检 + 没播再点，最多 3 次），
  与课中弹题主链路共用同一套「检测→播放→复检→再点」逻辑。至此**所有关弹窗后恢复播放路径全部走闭环**，顺序错乱隐患清零。

### 设置优化（有用，非花架子）
- `gatedRandom` 开关标签由黑话「无通道时随机兜底」改为**「答不出随机猜（逃生舱）」**，
  并补一段「答题兜底三档」人话说明：题库/LLM 命中 → 离线启发式推断（不瞎蒙）→ 仍没有时本开关决定
  「关（默认）= 留空不答交人工，宁可漏答不瞎蒙」还是「开 = 随机选一个保活」。用户一眼能读懂并信任「默认不蒙」。
- 答题区顶部新增「听课答题流程」静态说明：弹题 → 题库/LLM 作答 → 提交 → 关弹窗 → 自动恢复播放，全程无需手动；
  答不出按兜底策略处理（默认不瞎蒙，交人工）。让用户理解端到端行为、确认顺序无误。

### 门禁
- `node build.js` v0.6.62 构建通过；dist 与 src 一致（`check-dist-fresh` 过，20 模块 v0.6.62）。
- 测试 676 通过 / 1 失败：失败项「章节名解析带进度%」属 02-adapter/04-resume 历史遗留，与本轮无关。

---

## [0.6.61] - 2026-10-24
> round-52：**听课页弹题答完后「关弹窗 → 检测播放 → 再点播放」闭环修复**

### 问题（用户实测）
听课页面弹题答完、关闭弹窗后，视频经常**不接着放**——表现就是「答对了、能关掉，但听完这题就停住」。
根因：旧 `_resumePlay` 只做 `if (v.paused) v.play()`，且 `play()` 的 reject 被静默吞掉，**视频没真播起来却被记成已恢复**；
同时智慧树大量课程用 prism-player / video.js / 腾讯 txp 等自定义播放器，裸 `video.play()` 常被内部状态拦截，
必须点控件自身的播放按钮才能绕开。

### 本轮改动
- **`03-player.js` 新增 `clickPlayButton(v)`**：仅在 video 暂停时，按 prism / video.js / txp / 通用选择器
  查找并点击播放器真实「播放」按钮（对应「再次选择播放」）；找不到按钮 / 跨域 iframe 取不到时静默返回 false，
  交给裸 `video.play()` 兜底，全程防御性 try/catch，绝不抛错影响主流程。
- **`13-answerer.js` 重写 `_resumePlay` 为严格闭环**：
  ① `resetHumanPause`（弹题=切课级干预，清幽灵态避免 `ensurePlaying` 被挡）→ ② 静音+倍速 →
  ③ **给出时间**（settle 300ms，弹窗刚关让播放器 UI 同步）→ ④ **检测在不在播放**：点真实播放按钮 + 裸 `play()` 兜底，
  等一下再读 `v.paused` **复检** → ⑤ 没真播起来就**再次点击播放**（最多重试 3 次）→
  ⑥ 只有确认 `!v.paused` 才记「已恢复播放」；多次仍不行交主循环 `ensurePlaying` 保活，**不假报**。
- **`13-answerer.js` `closeDialogAndResume` 关 X 前补「给出时间」**：提交（若有）后先 `sleep(400)` 让平台登记作答再关，
  对应「给出时间 → 点击 X → 继续听课」顺序，避免太早点 X 被平台以「未作答」拒绝。

### 门禁
- `node build.js` v0.6.61 构建通过；dist 与 src 一致（`check-dist-fresh` 过，20 模块 v0.6.61）。
- `node test/run.js`：676 通过 / 1 失败。失败项仍为历史遗留「章节名解析带进度%」（`第2讲 方法论 30%` vs `第2讲 方法论`，
  属 `02-adapter`/`04-resume` 目录解析范畴），与本轮播放恢复改动（`03-player`/`13-answerer`）代码路径无关，非本轮引入。

---

## [0.6.60] - 2026-10-24
> round-51：**答题逻辑修正 —— 不瞎蒙 + 给足 LLM 答题时间**

### 本轮改动
- **答题不再瞎蒙**：`13-answerer.js` 两处「无答案时 ABCD 都来一次随机猜」的兜底，**统一纳入 `gatedRandom` 开关管制**（默认 `false` 不蒙），与 `11-solver.js` 频道 D 行为一致。
  - 无通道兜底：未开启 `gatedRandom` 时放弃随机猜、保留弹窗转人工；开启才保留逃生舱（防流程卡死）。
  - `_ensureAnsweredThenClose`：`rest` 随机项仅在 `gatedRandom` 开启时纳入，否则只试已求解答案、试完没中就转人工。
- **LLM 超时给足**：`10-llm.js` 单次调用超时 `15000 → 45000ms`、单题总预算 `25000 → 70000ms`，从源头减少「答不上→瞎蒙」；总预算闸保留，不把主循环彻底堵死。

### 门禁
- `node build.js` v0.6.60 构建通过；dist 与 src 一致（`check-dist-fresh` 过，20 模块 v0.6.60）。
- `node test/run.js`：676 通过 / 1 失败。失败项「章节名解析带进度%」（`第2讲 方法论 30%` vs `第2讲 方法论`，属 `02-adapter`/`04-resume` 章节目录解析范畴），与本轮答题逻辑改动（`10-llm`/`13-answerer`）代码路径无关，为**历史遗留失败，非本轮引入**，未纳入本轮改动范围。

---

## [0.6.59] - 2026-10-22
> round-50：**端到端前端继续优化 maxloop —— 新增「重新探测目录」安全恢复型按钮（按钮做事自动化补完）**

### 本轮改动（纯恢复型操作，零碰播放状态机）
- **新增「重新探测目录」按钮**（页脚下方 `.foot2` 全宽虚线幽灵按钮，与主四键视觉层级分明）：平台改版 / SPA 切课后适配器可能误判，提供「不刷新页面」的安全重探测入口。
- 按下即调 `ZHS.Catalog.redetect()`（把 `_ad` 置空，下次访问重新 `detect()`），随后 `this.refresh()` 刷新面板目录统计并 `alert` 报告「适配器名 + 识别条目数」。
- **安全边界已锁死**：该按钮只动 Catalog 适配器探测，**不调用** `Scheduler.stop` / `gotoNext` / `Player` / 进度写回——纯恢复型，误点零副作用。
- 复用既有 `withLoading` 骨架（loading 旋转态 + 结束复位），`.foot2 button.loading` 镜像 `.foot button.loading` 旋转动画。

### 测试（`_round50` 新增 7 断言，全绿）
- R1 按钮存在 / **R2 点击触发 `Catalog.redetect`（增量≥1）** / R3 触发面板刷新
- **R4 点击不调用 `Scheduler.stop`（安全边界）** / R5 点击不调用 `Scheduler.gotoNext`（安全边界）
- R6 操作后按钮未卡 loading / R7 操作后按钮恢复可用
- 注：运行期守卫(02d-guard)与启动(07-main)也会独立调 `redetect`，故 R2 断言「增量≥1」而非精确次数，避免与运行期其它调用者耦合（首跑曾因此误报失败，已修正）

### 门禁
- `node build.js` v0.6.59 + `node test/run.js` **677 通过 / 0 失败**（上轮 676，+1 来自 round-50） + `check-dist-fresh` 过（dist 与 src 一致，20 模块 v0.6.59）

---

## [0.6.58] - 2026-10-22
> round-49：**端到端前端深度美化 + 按钮做事自动化**（在成熟设计令牌系统上精准精致化，非推翻重来）+ 停止两步确认防误触

### 本轮改动（前端精致化，零碰播放状态机）
- **头部状态灯（status-dot）**：idle 灰 / run 呼吸绿 / busy 呼吸橙 三态，挂在面板头部一眼看出活没活；`_refreshInner` 把状态灯逻辑前置到弹题卡刷新之后（沿用 round-31「最前原则」，防后续异常静默早退）。busy 判定覆盖 `dialogPhase ∈ {detected,answering,pending-human}` 与拟人离座 `isHumanPausing()`。
- **头部版本胶囊（ver 药丸）**：`<b>智慧树助手</b>` + `v{x}` 圆角胶囊，弱化版本号视觉权重。
- **进度条渐变 + 过渡**：`.cprog-bar > i` 走 `linear-gradient(90deg, pri-500→pri-400)` + `transition width .6s cubic-bezier`，进度推进有丝滑动效。
- **开关滑动动画**：`.sw::after` 加 `transition left`，`.sw.on` 加 3px 高亮环，切换有阻尼感。
- **状态页卡片化分组**：原平铺 `.kv` 包进 3 张 `.card`（播放状态 / 课程进度 / 答题与统计），带左侧色条标题；**全部刷新锚点原位保留**（`#zhs-dlg-card` 仍在 `Catalog.stats()` 之前、`.s-*`、`.cprog-bar`、`#zhs-humanpause-row` 不动）——结构与契约双安全。
- **动作按钮圆角 + 微交互**：`.foot button` 改 `border-radius: 999px` + `hover translateY(-1px)` 阴影上浮 + `active translateY(1px) scale(.97)` 回弹，方角变胶囊，点击有实体键感。
- **面板切入淡入**：`.pane` 加 `zhs-fade` 动画（opacity+translateY 22ms ease），切页不突兀。
- **停止两步确认（stop-armed）**：破坏性操作防误触——首次点「停止」变红「确认停止？」并 3 秒自动取消+轻量告警，二次点才真调 `Scheduler.stop()`；零风险不碰停止逻辑本身。

### 本轮明确敢砍（留专门轮，不在此轮纠缠状态机）
- 「立即暂停/恢复」「跳转未学章节」按钮：与拟人暂停 / `ensurePlaying` 状态机强耦合（r46/r47 刚理清），本期不做。
- 「重扫目录」按钮：需先确认 Adapter 干净重扫入口，单独一轮。

### 测试（`_round49` 新增 17 断言，全绿）
- **A 节 状态灯**：A1 元素存在 / A2 运行中→run / A3 作答中→busy / A4 停止→熄灭
- **B 节 卡片结构**：B1 `.card` 存在 / B2-B4 三标题 / B5 保留弹题状态卡锚点 / B6 保留拟人离座锚点（模板层断言）
- **C 节 停止两步确认**：C1 按钮存在 / C2 首次不调用 stop / C3 文案变「确认停止？」/ C4 加 armed 红态 / C5 二次调用一次 / C6 复位文案 / C7 移除 armed（用 `Scheduler.stop` spy 验证，不依赖真停止副作用）

### 门禁
- `node build.js` v0.6.58 + `node test/run.js` **670 通过 / 0 失败**（上轮 653，+17 来自 `_round49`）+ `check-dist-fresh` 过（dist 与 src 一致，20 模块 v0.6.58）

---

## [0.6.57] - 2026-10-22
> round-48：**端到端对账第三轮收尾——8 方向 + 保活段全查无真 bug（r46/r47 已根治拟人暂停幽灵态、无回归）+ 2 处防御性加固**（syncToCatalog 暂停守卫 + 修正误导性注释）

### 本轮改动（验证安全后的契约加固，非 bug 修复）
- **syncToCatalog 暂停期不比对进度**（`03-player.js`）：暂停态（含拟人暂停 / 弹题暂停 / AI 随堂练习暂停）提前 `return`，
  把「暂停期不干预播放位置」显式钉死，与 checkStall 的 `paused` 早退一致；强化 round-26「绝不 seek」铁律在暂停态的贯彻
  （防止未来有人在比对逻辑里加「落后也 seek 拉回」却在暂停期触发 → 命中腾讯 Turing 滑块）。配套 `_round48` 两条断言（暂停期不调 `progressOf` / 非暂停期正常比对）。
- **修正一处误导性注释**（`05-scheduler.js` L521-523）：原注释称 maybeHumanPause「冷却期内根本不执行」与代码不符——
  该方法位于切课冷却闸门（L536）**之前**、冷却期内仍会执行；真实不暂停靠 maybeHumanPause 内部的 `currentTime < 10` 守卫
  （刚切课视频从头播故不触发）。注释已改为准确描述。

### 端到端对账第三轮结论（8 方向 + 保活段，全部设计安全 / 已验证）
1. 弹题 × 切课 gotoNext：安全（SPA 卸载弹窗 DOM + 主循环自愈 + L1030 `resetHumanPause`）
2. 弹题 × 课程中心 pendingHop：安全（不同页面，跳课请求与播放页弹题不共存）
3. 作业考试页 × 主调度器：**安全**（主调度器仅在有 `<video>` 时启动，作业/考试页无 video → 永不启动；06c-exam 独立轮询且 `autoExam!==true` 时啥也不做，两套循环天然分离，「守株待兔」铁律未被破）
4. 防卡死看门狗 T2 × 拟人暂停：安全（拟人暂停 ≤90s < T1 4min，时序不重叠）
5. AI 随堂练习 × 看门狗/拟人态：安全（`_handleAiExercise` 已 `resetHumanPause`）
6. 目录识别 × resume：历史已修（lessonKey 写时机）
7. 多弹题并发 abMultiDialog：已测（状态机防重入）
8. 调度器重绑 × 进行中弹题：安全（SPA 卸载 + 主循环自愈）
- 保活段深挖：checkStall（`if(v.paused)return` 早退）/ syncToCatalog（round-26 已删 seek，暂停期仅纯日志告警）/ ensurePlaying（`isHumanPausing` 早退）/ maybeHumanPause（到期播报加 `paused` 守卫）在拟人暂停期均安全，无 seek、无伪卡死、无学习时长真空。

### 门禁
- `node build.js` v0.6.57 + `node test/run.js` **653 通过 / 0 失败**（上轮 651，+2 来自 `_round48`）+ `check-dist-fresh` 过

---

## [0.6.56] - 2026-10-22
> round-47：**端到端对账第二轮——拟人暂停「幽灵态」跨上下文延续缺陷根治**（弹题转人工四分支 + 调度器 stop 全清理）+ 看门狗交叉点验证（安全）

### 本轮修复（同一类缺陷：round-46 只修了「弹题已答」路径，漏了其余「离座」幽灵态出口）
- **弹题转人工四分支全加 `resetHumanPause()`**（`05-scheduler.js` L607/L628/L631/L657 对应四处 `pending-human` 分支）：
  复现链——拟人暂停激活（video 真暂停）→ 恰在窗口内弹题出现并转人工 → 用户答完关弹窗后，主循环 `ensurePlaying` 被 `isHumanPausing()` 挡住 → **视频诡异冻住最多 90 秒后静默恢复**，平台还记录一段学习时长真空。根因与 round-46 同源（「离座」状态跨过弹题干预延续），只是出口不同。
- **`stop()` 加 `resetHumanPause()`**（L245 后）：拟人暂停只在主循环活跃期有意义，停机残留的 `_humanPauseUntil` 会在重启后短暂挡住 `ensurePlaying`（同类冻住）。

### 本轮验证（边做边查证）
- **防卡死看门狗 × 拟人暂停交叉点：设计安全**。`checkStall` 有 `if (v.paused) return false` 早退，拟人暂停是 `video.pause()` 真暂停，`v.paused===true`，看门狗整段不执行，绝不会误触发 seek/重载（命中 Turing 滑块的死路）；暂停到期视频恢复后 `currentTime` 推进会重置 `_lastActiveAt`，不产生伪卡死。确认无需改代码。
- **`resetHumanPause` 调用点现状**：弹题 domAns 分支 + 未开自动答题分支 + `_resumePlay` 收敛点 + `_handleAiExercise` + `gotoNext` + 弹题转人工四分支 + `stop()` = 全出口收敛，幽灵态不再有泄漏路径。

### 门禁
- 新增测试组 `_round47`（契约层 A + 端到端层 B + 生命周期层 C 共 6 断言）：A1 拟人暂停期 ensurePlaying 被挡（冻住根因）/A2 清态后恢复；B 驱动 `_handleDialog` 走转人工分支后幽灵态清零；C `stop()` 清态。
- `node build.js` v0.6.56 + `node test/run.js` **651 通过 / 0 失败**（上轮基线 649，+2 来自 round-47 的新断言覆盖）+ `check-dist-fresh` 过。

---

## [0.6.55] - 2026-10-22
> round-46：**端到端对账第一轮——修复 round-45 引入的「拟人暂停 × 弹题干预」状态纠缠 + PROJECT_MAP 重写（v0.1.0 → v0.6.54 真实图景）**

### 端到端审视方法
对 21 个模块（11492 行）按用户旅程全链路通读对账：注入/启动 → 目录识别 → 切课 → 播放保活 → 弹题 → 求解 → 作业考试 → 课程中心 → 面板/统计。逐段用第一性原理核对「这段逻辑与上下游的交互是否自洽」，不猜、只看代码。

### 根因（round-45 的整合缺陷，本轮确诊）
`maybeHumanPause` 触发后（`video.pause()` + `_humanPauseUntil=T`），若此时弹题插入，`_handleDialog` 答完弹题会恢复播放（`video.play()`），但 `_humanPauseUntil` 未清除。两个后果：
1. **到期假播报**：到期时无条件播报「模拟离座结束，恢复播放」——视频早在弹题处理完就已恢复，「离座」期间实际在处理弹题，语义全错；
2. **保活真空**：到期前 `ensurePlaying` 对视频的任何暂停都不恢复（`isHumanPausing()` 挡着），最长 90 秒。

round-45 在切课时做了 `resetHumanPause`，**弹题是同类干预却漏了**——单点修复正确、交叉点没对账，正是「整体思考每个逻辑」要抓的东西。

### 改动
1. **恢复播放路径统一收敛 reset**（`13-answerer.js`）：`_resumePlay()` 开头先 `resetHumanPause()`——它是弹题处理后恢复播放的唯一收敛点（7 个调用点全覆盖：closeDialogAndResume 成功路径 / forceCloseDialog / _ensureAnsweredThenClose / _tryNonStandardAB 等）。
2. **内联恢复路径补齐**：`13-answerer.js` `_handleAiExercise` 末尾、`05-scheduler.js` `_handleDialog` 的 domAns 分支与「未开启自动答题」分支，均不走 `_resumePlay`，各自补 `resetHumanPause()`。
3. **到期播报加守卫**（`03-player.js`）：只有视频确实处于暂停（`video.paused`）才播报「离座结束」；视频已在播则静默清零。双保险，防其他未覆盖路径的假播报。
4. **PROJECT_MAP.md 重写**：原文停留在 v0.1.0 / M2 / 14 模块 / 489 项测试 / 已不存在的 npm 命令，对新会话/协作者是错误图景。重写为 v0.6.55 真实状态：21 模块清单与职责、端到端链路图、docs/05 八条硬约束、运行时 API、测试与发布流程。

### 验证
- 新增测试组 39（round-46）：`_resumePlay` 清零拟人态 / 到期视频已在播不播报（假播报守卫）/ 到期视频暂停正常播报恰好一次（守卫不误伤）/ **入口级：domAns 分支跑完 `_handleDialog` 后拟人态清零**。
- `node build.js` 通过（v0.6.55）；`node test/run.js` **644 通过 / 0 失败**（2 连稳；上一轮基线 634）。
- 修复 `_round45` 到期播报测试与新守卫的失配（jsdom 的 `pause()` 不改 `paused` 属性，按 round-46 语义显式置真/置回）。

### 边界（守住不越界）
- 本轮是整合修复，零新功能、零行为扩张；拟人暂停仍是「节奏拟人」不是「反检测破解」。
- 正式监考考试不碰、只做平时作业/章节练习/单元测试辅助的铁律不变。

---

## [0.6.54] - 2026-10-21
> round-45：**听课程拟人节奏补齐（模拟离座随机暂停）+ 答案缓存模糊匹配**（GitHub 50+ 项目生态调研落地第一轮）

### 情报来源（本轮调研 → 代码落地）
对 GitHub 智慧树生态 50+ 项目做了两轮深挖（41 份 README + 代码级检索，产物 `docs/06-GitHub生态全景调研.md` + `reference/gh/deep/`）。三条直接影响本轮的结论：
- **pjm314159/zhs（协议逆向参考实现）**：官方客户端播放循环每轮有 0.25% 概率随机暂停 60 秒 —— 真人看课本来就会中途离开，而机器挂机最显著的特征就是「匀速不停」。
- **sweetcornna/university-helper**：进度上报按真实观看时长累加、WatchPoint 每 2 秒一个轨迹点、已完成视频直接跳过 —— 与本项目「平台记录是唯一金标准」的设计互相印证。
- **ATRI / 题库体系**：同一道题常以换行/全半角/标点差异的变体重复出现，精确缓存永远命不中，同一道题被反复请求。

### 改动
1. **拟人化随机暂停（听课程核心）**：`03-player.js` 新增 `maybeHumanPause`（每 2 秒主循环掷骰，默认 0.3% 概率 ≈ 平均二十多分钟一次，暂停 30~90 秒随机）。暂停期间 `ensurePlaying` 绝不唤醒、`checkStall` 不判卡死、不计学习时长，到期自然恢复。只在自动播放模式触发（手动模式不夺用户方向盘）；刚开播 10 秒内、暂停中、已结束、切课冷却期内均不触发。`00-config.js` 新增 `humanPause` / `humanPauseChance` / `humanPauseMinSec` / `humanPauseMaxSec`（默认开），面板新增开关 + 实时「拟人离座 · 约 N 秒后恢复」状态行。
2. **切课后强制续播**：`05-scheduler.js` `_rebindAfterNav` 绑定时就地 `play()` 并短轮询确认 `paused===false`（真机实测：点小节标题切集后平台定位到断点且 `paused=true`，必须主动 play 才继续，docs/05 硬约束 3）。
3. **弹题关闭随机延迟**：内嵌答案弹窗关闭后固定 `sleep(500)` 改随机 0.5~1.5 秒（docs/05 硬约束 8：固定值是机器特征）。
4. **答案缓存模糊匹配**：`01-util.js` 新增 `normQuestion` / `levenshtein` / `similarity`；`11-solver.js` 精确缓存未命中时按 90% 相似度复用答案（选项串必须逐字相同、归一化题干短于 8 字不模糊、开关可关），`stats.fuzzy` 计数进总结报告「答题通道」。`00-config.js` 新增 `fuzzyCache`（默认开），面板新增开关。
5. **切课时清拟人暂停态**（`resetHumanPause`）：旧节的「模拟离座」不带到新节。

### 验证
- 新增测试组 38（听课程拟人节奏 + 模糊缓存，入口级判别性）：默认值/布尔归一化/触发与不触发六情形/暂停期不唤醒/到期播报恰好一次/模糊命中不重复请求/选项不同不误命中/开关关闭失效。
- `node build.js` 通过；`node test/run.js` **634 通过 / 0 失败**（上一轮基线 595/1，唯一遗留失败项本轮同环境复测通过）。

### 边界（守住不越界）
- 拟人暂停是「节奏拟人」不是「反检测破解」：不绕过任何验证码，验证码 Guard 优先级高于一切自动化动作的铁律不变。
- 模糊匹配只复用**本次运行内**已答过的答案，不跨会话、不写题库；误命中防线是「选项逐字相同 + 90% 阈值」。
- 正式监考考试不碰；只做平时作业/章节练习/单元测试辅助的铁律不变。

---

## [0.6.53] - 2026-10-21
> round-44：**补齐作业/单元测试的填空/问答题自动作答（主观题盲区根治）**

### 根因（确诊非猜）
`06c-exam.js` 是作业/考试作答页**唯一的自动答题链路**（自启动轮询 `tick` + `autoExam` 开关，`05-scheduler` 不接管它；`13-answerer.handleHomework` 只是面板手动触发且默认关），却在主循环里对 `COMPLETION`/`QA` 直接 `continue` 跳过主观题。而下游三层能力早已就绪——`Filler.fill` 的 completion/qa 分支（`fillText` 填输入框+补事件）、`Bank.normalize` 对填空/问答原文返回、`LLM.buildPrompt` 已写好填空/问答专用 prompt——能力在半路断送，导致「平时作业/章节练习/单元测试」的自动答题对主观题完全无解。

### 改动
1. **`06c-exam.js` 主观题不再无条件跳过**：默认由 LLM 生成答案回填（新增 `fillSubjective` 复用 `Filler.fill` 的 completion/qa 分支 + `localFillText` 模块内兜底）。仅 `examSubjective: false` 时跳过；无答案（无 LLM Key/题库未命中）走「未取得答案」分支提示手动作答，**绝不瞎填污染成绩**。主观题作答日志带「LLM生成·请提交前检查」提示。
2. **`10-llm.js` 新增 `LLM.ask(question, type)`**：主观题单次生成。`vote` 的「多次投票取众数」对文本答案失效——填空/问答每次生成的文本几乎不可能逐字相同，票数都是 1，既收敛不了又白费最多 3 次调用；主观题只需一次高质量生成。返回 `Bank.normalize` 后的原文（填空/问答走原文返回分支，不字母化）。
3. **`11-solver.js` LLM 通道按题型分流**：主观题（无选项）走 `ask` 单次，选择题仍走 `vote` 投票提稳（零回归）。
4. **`00-config.js` 新增 `examSubjective`**（默认 `true`，受 `autoExam` 总开关约束）+ 加入 `BOOL_KEYS` 布尔归一化（防脏值字符串偷偷开关）。

### 验证
- 测试见 5d 用例组（主观题分流/回填/规整）；`node build.js` 通过。

### 边界（守住不越界）
- 只针对智慧树作业/考试作答页（`#/webExamList/dohomework`/`doexamination`）的**平时作业/章节练习/单元测试**；正式监考考试（如超星 `reVersionTestStartNew` + monitorStatus）不在本工具范围内。
- 主观题答案质量取决于 LLM Key；无 Key 时跳过并提示手动，不蒙答案。
- 提交仍受 `examSubmit` + `waitBeforeSubmit` 倒计时控制，用户可反悔。

---

## [0.6.52] - 2026-10-21
> 第三十轮补丁（round-43）：**根治「切不动课」根因（通用反推兜底 + detect 自愈降级）**

### 改动
1. **`Catalog.current()` 通用反推兜底（治本）**：已知适配器专属 `active` 选择器在该布局失效、返回 null 时，从真实目录条目用行业通用约定（active/current/on/selected 类名 / 媒体邻近 / lessonKey）反推当前项。正确布局的 current() 已在前面分支命中，不会走到这里 → 零回归。直接修复「Windows版/Mac版」课 `clickAndVerify` 的 `nowIsTarget` 永远 false、反复点死循环。
2. **`Catalog.hasActive()` 通用兜底**：专属判定全失败时，回退到通用「当前项」类名约定，作为 `clickAndVerify` 第二信号的最后防线。
3. **`detect()` 自愈降级（治表+兜底）**：胜出的已知适配器若连「当前项」都定位不到（最强信号缺失），且自身仅命中 <3 个节点（明显不是真目录）而 auto 能推导出 ≥3 个候选，则降级到 auto，从结构反推。正常大目录（几十节点）绝不满足 `knownCount<3`，不会误降级。
4. **抽出 `reverseCurrentFrom(list)` 单一真源**：auto 适配器的 `autoCurrent()` 与 `current()` 兜底共用同一套反推逻辑，去重、易测。

### 验证
- `node test/run.js` 新增「5c」用例组：复现「侧栏少量节点抢选 wisdom + 真实目录被忽略」与「wisdom item 命中真实大目录但用 .on 而非 .current」两场景，断言 detect 自愈降级 / current 通用反推命中。
- `node build.js` 通过；产物为测试版本（v0.6.52）。

### 残余风险 / 下一步
- 仍属「结构反推」范畴；若某平台纯靠 JS 内部状态切课（不挂类名、不改 video/URL/标题），需实测后补「后端 API 直调」档（见 zhs-cli diag）。

---

## [0.6.51] - 2026-10-21
> 第三十轮补丁（round-42）：**切课验收第 5 档（auto 类名变化软信号）+ 外置 CLI + 诊断探针**

### 改动
1. **切课验收 `autoClassFallback`（round-42）**：在 auto 兜底适配器下，点击目标条目后若其「新增了任意非瞬态类名」，即视为平台已把当前项标记打上（自适应学习：不预设 active/current/selected 等具体词，平台用任何自定义类都认）。这是 `clickAndVerify` 的第五道验收信号，覆盖「平台不给当前项挂标准 active 类名且非视频节点」的最坏布局（即用户报的「Windows版/Mac版」课切不动）。关键防护：点击若真没生效（类名不变）就返回 false，天然规避假成功。仅 auto 适配器生效，已知布局零回归。
2. **外置 CLI `tools/zhs-cli.js`**：整合 `start`（启动固定 profile 调试 Edge，登录态持久复用，用户只登录一次）/ `connect`（列标签页）/ `diag`（CDP 网络域截获后端 API + 注入页内诊断穷举 S1~S5 切课策略）/ `run`（实验性：把 dist 注入页面接管播放）。后端截获走 CDP `Network` 域（协议级、零页面污染）。`findWs` 加活体检测，避免陈旧 `DevToolsActivePort` 死端口卡死。
3. **诊断探针模块 `tools/diag-probe.js`**：导出可注入页面的诊断函数（结构抽取 + 切课策略穷举），不依赖主脚本也能跑结构抽取（降级安全）。
4. **`tools/zhs-probe.js`**：加 `module.exports`（CdpConnection/findWsFromUdd/extract），可被 CLI 复用，独立运行行为不变。

### 验证
- `node build.js` 通过；`node test/run.js` 全测通过（574/1，唯一失败为既有 gatedRandom 遗留用例，非本次引入）。
- CLI 冒烟：无浏览器时 `connect`/`diag` 干净退出码 2 + 友好提示。

### 残余风险 / 下一步
- 若某平台版本「纯靠 JS 内部状态」切课（既不挂 active 类名、也不改 video src/URL/标题），autoClassFallback 仍可能失效。此时用 `node tools/zhs-cli.js start` 开调试 Edge 登录后，`node tools/zhs-cli.js diag` 实测 strategies 哪个 didSwitch + apis 清单，据此补「后端 API 直调」档。

---

## [0.6.50] - 2026-10-21
> 第二十九轮补丁（round-41）：**auto 适配器当前项反推增强 + 测试固化**

### 改动
1. **`autoCurrent()` 新增第 4 档（媒体反推）**：当页面不给任何 DOM 挂 active/current 类名、且 lessonKey 又不准时（最坏情况），沿 `<video>/<audio>` 向上回溯祖先找候选、或命中直接包含媒体的候选，覆盖"平台纯靠 JS 内部状态"的极端布局。仍仅 auto 分支生效，已知布局零回归。
2. **测试固化**：新增「适配层（auto 自动推导兜底）」用例组（test/run.js 5b），构造未知布局 DOM 验证 `adapter.name==='auto'`、候选数、无类名时 current 回落 null、`isFinished` 图标/文本兜底、`click` 点本体不抛错、`findNext` 跳过已完成、媒体嵌入条目时 current 精准命中。
3. **`.gitignore`**：补忽略实地诊断/数据抓取调试产物（`.playwright-cli/`、`tools/zhs-audit*`、`tools/zhs-data*` 等），防误提交。

### 验证
- `node build.js` 通过；`node test/run.js` 全测通过（auto 用例组全绿，无新增回归）。

---

## [0.6.49] - 2026-10-21
> 第二十八轮补丁（round-40）：**根治"通用兜底布局切不动课"——新增自动推导适配器（auto）**

### 背景
v0.6.47/v0.6.48 在「Windows版/Mac版」这类通用兜底布局上仍切不动课。根因不在切课策略（Nav 四档策略够用），而在**目录识别**：`detect()` 无任何已知适配器命中时，回落到 `wisdom` 适配器，但 `items()` 走 `sniffItems()` 能捞到 20 个候选，而 `current()/isFinished()/hasActive()/click()` 仍沿用 wisdom 的选择器（`.child-info.hasvideo.current` / `.child-check` …），在该布局上一个都匹配不上：
- `current()` 恒为 null → `clickAndVerify` 的 `nowIsTarget` 永远 false；
- 非视频节点无视频源 → `pageSwitched` 也永远 false；
- 结果：反复点、永远判失败 → 用户看到的"切不动 / 正在切换课时中"。

### 改动
1. **自动推导适配器 `auto`**：`detect()` 在无已知适配器命中时，调用 `buildAutoAdapter()`——从 `sniffItems()` 捞到的真实候选反推目录结构（容器=最多候选的父节点），仅在此分支启用，**已知布局零回归**。
2. **`current()`（auto）**：用行业通用的"当前项"类名约定（active/current/on/selected/playing）定位当前播放项，命中不到再回落 lessonKey 文本匹配。
3. **`isFinished()`（auto）**：扫描候选后代中 class 含 finish/done/complete/check 且为图标/空壳的标记，加"已完成/已学完"文本兜底，不再依赖 wisdom 专属选择器。
4. **`hasActive()`（auto）**：同上通用类名约定判定当前项，修好切课验收。
5. **`itemTitle()` / `items()` / `click()`（auto）**：避开 `querySelector(null)` 报错（`item`/`title` 为 null），直接读条目文本、点击条目本体（上层 Nav 已先尝试 SPA 句柄直调）。
6. 配套诊断：`debug/zhihuishu-debug.user.js` 实地探针（截后端 API + 穷举候选试切 + 逐档策略实测 + 一键诊断），用于真机确认 auto 推导命中情况。

### 验证
`tsc --noEmit` 0 错 + `node test/run.js` 全绿（既有 565 用例无新回归）。真实布局切换命中情况待用户真机探针/实际开课确认。

---

## [0.6.48] - 2026-10-21
> 第二十七轮补丁（round-39c）：**治"切课切不动 + 非视频节点卡死"** —— 非视频节点不再死等 0% 进度 + 穷举切换兜底 + 切课失败自诊断。

### 背景
真机 v0.6.47：通用兜底布局，当前节点"Windows版"是**下载/文档节点（video 时长 0s）**，脚本按"视频放完等平台进度"死等 0% → 卡 3 分钟交人；且点「下一节」`gotoNext→Catalog.click` 在这个布局切不动。CDP 外部实地测试暂时不可用（主力 Edge 远程调试未真正生效），改让**脚本自证**。

### 改动
1. **非视频节点不停死等（05-scheduler `onLessonEnd`）**：`video.duration ≤ 0`（桩视频/文档/下载节点）→ 停留 4s 让平台登记后直接 `gotoNext`，不再走"视频放完等 0% 进度→卡 3 分钟"老路。
2. **穷举切换兜底 `_exhaustiveSwitch`**：`Nav.jumpTo`（SPA/URL/原生按钮/拟人点击）全失败后，对目标项各候选子目标（`a[href]`→`[onclick]`→标题/名称子→图标→本体）逐一拟人点击，每个点击后以「**当前课时是否真变成目标**」验收（不看选中态），命中即收。
3. **切课失败自诊断 `_dumpSwitchDiag`**：首次切课失败即 dump 目标项真实结构（tag/class/属性/坐标/是否被遮罩/onclick/是否有 Vue 句柄/是否 shadow）+ 框架 + 适配器选择器 + 可点子目标 + 当前课时到日志。下一跑凭这段精准定位"这个布局该点哪个、要不要真实点击"。

### 说明
CDP 外部 field-test 暂不可用（Edge 远程调试未生效，9222 被无调试标志的 msedge 占用）。要让脚本彻底切得动，需下一轮依据「切课诊断」日志定位真实可点元素；若确诊需真实点击(isTrusted)，再上 CDP `Input.dispatchMouseEvent` 或引导用户用带 `--remote-debugging-port` 的调试 Edge 开课。

---

## [0.6.47] - 2026-10-20
> 第二十六轮补丁（round-39b）：**AI 助教随堂练习弹题分流到 ocsjs 同款简单处理器** —— 多轮只读审计 + 开会质询定位 Root Cause（路由抢跑）后落地。

### Root Cause（多轮审计收敛）
AI 助教弹题命中 `QUESTION_SELECTORS`（`.el-dialog__wrapper .el-dialog`）→ 被调度器守卫 2 交给 `Answerer` 的 **isChecked 门控流**；而 AI 弹题选中态常不可见（代码自留真机结论"点选项后选中态不变"）→ 永远判"选不中"→ 转人工。**正确的处理器（守卫 4，ocsjs 同款）本就存在，却被守卫 2 的 `return` 抢先挡死。**

### 改动（按"问题×所有解法×代码"总表落地）
1. **检测**：`Const.QUESTION_SELECTORS` 补 `.ai-test-question-wrapper` / `.ai-class-exercise-dialog`（此前 StudyPlusH5 变体完全不被发现）。
2. **路由分流**：`Answerer.handleDialog` 入口按 `_isAiExercise(root)` 判定，AI 弹题**直接转 `_handleAiExercise` 并 return**，不再进 isChecked 流（自动 + 手动两条路径都覆盖，因都收敛到 handleDialog）。
3. **统一处理器 `_handleAiExercise`**（ocsjs 原厂 grounding，双变体）：选一项（内嵌答案→LLM/题库/启发式→第一个）→ 点提交（`.submit-btn .submits`/`.el-dialog__footer button.el-button`/文本兜底）→ 点关闭（`.close-box`/`.header-icon`/`.el-dialog__close`/文本兜底）→ **以「弹窗是否消失」验收（`_aiBoxVisible`）** → 恢复播放。**成功判据=关掉没，不依赖选中态。**
4. **移除死代码**：调度器旧守卫 4 已被 `_handleAiExercise` 取代，删除避免两套逻辑打架。
5. 经典 `#playTopic-dialog` 与其它弹题路径不变，仍走 Answerer 原流程。

---

## [0.6.46] - 2026-10-20
> 第二十五轮补丁（round-39）：**按 ocsjs 原厂实现校正弹窗答题全流程** —— 单次纯净点击 + 选完先提交再关 + AI 弹窗专用选择器。

### 背景
maxloop 深度调研：直接拉取 ocsjs `zhs.ts` 源码，拿到它对智慧树课中弹题的**原厂验证过的实现**，逐一校正我的偏差。

### ocsjs 原厂实现（verbatim 提炼）
- 经典 `#playTopic-dialog`：点 `#playTopic-dialog .topic .radio ul > li:nth-child(N)`（**单次原生 `.click()`**，不派发事件、不判断选中）→ 关 `#playTopic-dialog .close-btn, #playTopic-dialog .btn`。
- **AI 助教弹窗 `StudyPlusH5`（`.ai-test-question-wrapper`）**：选项 `.options .option` → **提交 `.submit-btn .submits`** → 关 `.close-box`。
- **AI 助教弹窗 `WishdomH5`（`.ai-class-exercise-dialog`）**：选项 `.ques-list .item .option` → 提交 `.el-dialog__footer .el-button.btn` → 关 `.header-icon`。

### 我校正的三处关键偏差
1. **点击**：早期"20 连发"式过度点击（多子目标×多事件）反而把已选中的点乱/误触。改为 **ocsjs 原厂的「选项本体单次原生 `.click()`」为主路径**，SVG 自检通过即收，失败才升级（保留 pointer/坐标/键盘作兜底）。
2. **提交（重大遗漏）**：AI 弹窗流程是「选完→**先点提交**→再关」。我之前选完直接关，平台以「未提交答案」拒绝关闭 → **关不掉死循环的真因之一**。新增 `_clickSubmitIfAny()`，仅在检测到 AI 弹窗时、于其作用域内点提交（`.submit-btn .submits` / `.el-dialog__footer .el-button.btn`），在 `closeDialogAndResume` 关闭前调用；经典 `#playTopic-dialog` 不提交（与原厂一致）。
3. **关闭选择器**：`Dialog.close` 补 AI 弹窗关闭控件 `.close-box` / `.header-icon`（旧列表没有，AI 弹窗关不掉）。

---

## [0.6.45] - 2026-10-20
> 第二十四轮补丁（round-38）：**根治「选项点不中」—— 选中态识别错了信号**（深度调研 ocsjs/greasyfork/Natro92 后定位）。

### 背景
连续多轮加点击方式仍 `选项点击后仍未选中`。深度调研成熟实现后定位真因：**智慧树课中弹题的「选中态」既不是 class 也不是 input.checked，而是 SVG 图标 `<use>` 的 `href`**（未选中 `#iconxuan` → 选中 `#iconxuanzhong`，Natro92 逆向实锤；greasyfork 自动答题脚本用 `.item-topic` + `choose[0].click()` 点一次即中；ocsjs 适配层最全）。
我的 `isChecked` 只查 class/input/aria，**完全不认 SVG 选中态** → 明明点中了也判"未选中" → 继续乱点一堆子目标/指针/键盘把已选中的点乱 → 误报选不中。**不是点不中，是看不懂"选中了没"。**

### 改动
1. **`isChecked` 增加 SVG 图标选中识别（12-filler.js）**：扫描选项内 `<use>/[href]/[xlink:href]`，`href` 命中 `#iconxuanzhong|zhongzhong|icon-selected/checked/...|radio-on/checked/selected` 即判选中。`#iconxuan`（未选中）不含 zhong，不会误命中。`isClearlyChecked`（防取消守卫）保持严格、不被 SVG 误触。
2. **选项选择器补 `.item-topic`**（08-questions readOptions 宽口径 / 13-answerer A/B 兜底 / `_ensureAnsweredThenClose`），与成熟脚本一致地抓对元素。
3. 新增单测 11.6 锁定 SVG 选中态识别。

### 后续（若仍选不中）
若诊断显示选项需真实点击(isTrusted)，脚本内合成事件无法伪造 —— 下轮建 CDP `Input.dispatchMouseEvent` 真实点击外部方案（fuckZHS 走的是直接打后端 API 的另一条路）。

---

## [0.6.44] - 2026-10-20
> 第二十三轮补丁（round-37b）：**治「选项点不中」再加三种机制 + 诊断转储** —— 为精准修复采集真实 DOM。

### 背景
v0.6.43 后真机：AI助教弹题 `LLM：B` → 逐个选项试过 → 仍 `选项点击后仍未选中` → 转人工。多子目标 × 多点击方式都无效，说明点击机制/对象根本不对，需先看清真实 DOM 再精准修。

### 改动
1. **`clickOption` 增三种本质不同机制**：(a) 坐标点击 `elementFromPoint(center)` 最顶层元素（破遮罩/蒙层拦截）；(b) 指针事件 `pointerdown/pointerup/click`（治只监听 pointer 的现代部件）；(c) 聚焦 + 键盘（空格/回车/方向键，治 radio 组）。
2. **诊断转储 `Filler.dumpDiag(root, els)`**：选不中转人工前，把选项真实结构打进日志——root 路径/是否 shadow/iframe、每个选项 tag/class/全部属性/坐标/是否被其它元素盖住（elementFromPoint）/onclick/完整 HTML 片段、弹窗内 radio 选中态。**用户把日志这段发回即可精准修**。
3. 接线：`_ensureAnsweredThenClose` 与 `_tryNonStandardAB` 第二段的"选不中"分支均先 `dumpDiag` 再转人工。

### 说明
若诊断显示选项被遮罩盖住 → 用坐标点击已覆盖；若在 shadow/iframe → 按结构精准定位；若确需真实点击(isTrusted) → 需外部 CDP 真实点击方案（下轮可建）。先拿诊断再定。

---

## [0.6.43] - 2026-10-20
> 第二十二轮补丁（round-37）：**修「选项点了选不中」+ 严格「没答完不能关闭」** —— 真机日志驱动（AI助教课中弹题）。

### 背景
用户真机日志：AI助教小智课中弹题（判断题 A.对/B.错），`LLM 投票收敛：B` → `选项点击后仍未选中` → `弹题关闭失败` 反复重试 → 卡死。用户诉求：「没密钥答不出就随机选 ABCD 都来一次，每步代码等待，没答完不能关闭；这种题只需要选择就可以了」。
根因：① 选项点击后**选不中**（AI助教弹窗选项结构特殊，`el.click()`/内层点击都不触发选中）；② 选中自检一失败就走「按默认视为已作答 → 硬关」分支，而平台不许关闭未作答弹题 → 关不掉死循环。

### 改动
1. **`Filler.clickOption` 大幅强化（12-filler.js）**：候选子目标（radio/check/circle/icon/label/input/span/a/i/本体）× 多点击方式（拟人点击 + dispatchEvent）逐个尝试，每步 `isChecked` 自检，选中即收手；末尾 `input.checked` 强制兜底。`isChecked` 扩为宽口径（aria-checked/selected/pressed、selected/choosed 等类、子 input、子节点标记）；新增 `isClearlyChecked` 严格判定专用于「已选中则跳过」防取消守卫。
2. **`_solveCurrentPage`（13-answerer.js）**：选中失败时补一次整元素点击重试；记录 `_lastSolvedIdxs`；不再自欺"按默认视为已作答"，诚实标记未答上。
3. **严格「没答完不能关闭」**：`!anyAnswered` 分支改走新增 `_ensureAnsweredThenClose` —— 逐个尝试选项（优先已求解答案，其余随机"ABCD 都来一次"），每步 `isChecked` 自检 + 代码等待，**确认选中后才等待 1.2s 让平台登记再关闭**；逐个都选不中则转人工保留弹窗，**绝不在未选中时硬关**。
4. **A/B 兜底（`_tryNonStandardAB` 第二段）**同步重写为「逐个试→确认选中→等待→才关」，与上面一致。

### 测试
- 新增 11.4/11.5 覆盖点击目标级联与原生下一节按钮；`clickOption`/`isChecked`/`_ensureAnsweredThenClose` 逻辑经既有用例 + 真机验证。

---

## [0.6.42] - 2026-10-20
> 第二十一轮补丁（round-36）：**跳转手段再拓宽** —— 点目录项改多子目标级联 + 新增平台原生「下一节/继续」按钮策略。

### 背景
用户原话：「点下一节没用……你不能做出手动选择吗，例如任何手段或者智慧树平台本身的按钮指令，或者点击各种手段去跳转」。
真机日志（新布局、通用兜底适配器）：`点击「Mac版」2 次仍未见页面切换` + `[Nav] 所有跳转策略均失败` —— 裸点目录容器不切节。

### 改动
1. **`Catalog.click` 多子目标级联（`_bestClickTarget`）**：不再裸点容器。按优先级挑最可能带处理器的子目标——适配器 `clickTarget` → 标题/名称类子节点 → 带 `onclick` 节点 → `a[href]`，用拟人化点击派发；找不到才回落 `el.click()`。依据 legacy 真机结论（点 `.catalogue_title` 标题能切、点 li 本体跳门户首页）。
2. **Nav 新增策略③ `nativeNext`**：定位平台原生「下一节/下一集/继续学习」按钮并拟人点击（用户明确要求「用平台本身的按钮指令」）。仅 `gotoNext` 场景开启（`allowNativeNext`），续播定位指定节不启用； visibility 用 `getComputedStyle` 判定。
3. 策略链扩充为：spa → url → nativeNext(仅 gotoNext) → humanClick。

### 测试
- 新增 11.4/11.5：点击目标级联优先标题子节点/回落 a[href]；原生下一节按钮可定位并拟人点击、无按钮返回 false。

---

## [0.6.41] - 2026-10-20
> 第二十轮补丁（round-35）：**导航通道去「脚本化」+ 跳未学习节可达性修复** —— 多样化策略替代单一合成点击、虚拟滚动目录补全不再提前锁死。

### 背景
用户原话：「下一节选项是不行的，会被检测到是脚本踢出去，不能用下一节这个通道方法跳转……目前还是不能跳转到没有学习的地方」。
既有跳转通道 `gotoNext → Catalog.click → el.click()/realClick` 全是 `isTrusted=false` 的合成 MouseEvent，智慧树反作弊据此判定脚本并踢人；同时 `findNext` 受虚拟滚动限制，未滚到的未学节常不在 DOM 里，导致「跳不到没学过的地方」。

### 改动
1. **新增导航策略链 `02e-nav.js`（`ZHS.Nav.jumpTo`）**：按隐蔽度从高到低尝试，任一成功即收——
   - ① `spa`：直接调 SPA 内部方法（Vue `$emit('click')` / React `props.onClick` / 播放器 `load(id)`），**零 DOM 事件，最隐蔽**；
   - ② `url`：URL/hash 深链（浏览器原生导航；智慧树多数不支持，失败自动回落）；
   - ③ `humanClick`：拟人化合成点击（`realClickHuman`：随机起点→路径 mousemove→悬停→微抖动坐标点击→前后随机微延迟），仅作最后兜底。
   - 验收原则：①/② 无点击策略用「目录当前项是否真的变成目标项」判定（不触发二次点击）；只有③ 才走 `clickAndVerify`。
2. **修复 `ensureCatalogLoaded` 过早锁死**：原实现首轮页面未就绪即 `!grew` 永久锁死 `_catalogLoaded`，虚拟滚动后面的未学节永远补不出来。现改为「连续两次 no-growth 才稳定锁」，并新增 `ensureCatalogLoadedAsync()`（异步等平台分批渲染）。`gotoNext` 切换前先 `await` 异步加载完整目录。
3. **接线**：`05-scheduler.gotoNext` / `03-player.retryFromPlatformProgress` / `04-resume.restore` / `07-main` 进入即跳首节未学 四处跳转全部改走 `ZHS.Nav.jumpTo`；`Catalog.click` 保留给 `clickAndVerify` 内部与兜底。

### 测试
- 新增 11 节用例：SPA 内部通道优先且不调用 clickAndVerify；无句柄时回落拟人化点击兜底；全失败返回 false。

---

## [0.6.40] - 2026-10-20
> 第十九轮补丁（round-34）：**「不要被卡住」三层防卡死方案** —— 检测健康自检 + 完成态交叉校验 + 全局防卡死看门狗。

### 背景
用户原话：「代码方面把东西检测数据-代码层面考量很多情况与层层方案，希望不要被卡住」。
既有单点防护（视频卡死 120s 唤醒、0% 停滞 3min 交人、pendingHop 5min 看门狗、瞬时故障自愈）
已能挡大部分场景，但仍有盲区：
- 检测层返回空/错目录 → `breakdown().undone === 0` 误报「全部看完」→ 假完成停摆；
- 视频被平台缓冲卡住、currentTime 不前进，但 `checkStall` 反复唤醒、视频又不是 0% → 两端都不触发；
- SPA 静默换掉目录节点但 courseId 没变 → adapter 缓存陈旧 → `findNext` 永远指向旧节点。

### 三层方案
1. **检测健康自检层** `Catalog.diagnose()`：给出识别置信度 `low/mid/high`（空目录/无标题→low），供上层判断是否可信。
2. **完成态交叉校验层** `Catalog.trulyAllDone()`：取代裸 `undone === 0`。声明「全看完」须同时满足：
   ① 目录识别置信度非 low；② 当前视频进度已到完成线（91%）或无可播视频。否则回落「定位失败/瞬时故障」分支，绝不误停。
3. **全局防卡死看门狗层** `02d-guard.js`：心跳每 60s 采样「已完成节数 + 视频进度 + currentTime」指纹，无变化即停滞，按停滞时长分四级升级：
   - T1（4min）重探测页面版本 + 清目录缓存；
   - T2（8min）强制续播唤醒 + 重新对账；
   - T3（12min）尝试跳下一节；
   - T4（16min）标记瞬时停摆交人（`stop('transient')`），**永不静默挂起**。
   看门狗仅由 `Scheduler.start/stop` 启停，停止后不残留定时器。

### 接入点
- `02-adapter.js`：新增 `diagnose()` / `trulyAllDone()`；
- `05-scheduler.js`：`start()/stop()` 挂接看门狗；`preflight` 与 `gotoNext` 的「全部看完」判据改用 `trulyAllDone()`；
- `02d-guard.js`：新增看门狗模块（按字母序在 02-adapter 之后、05-scheduler 之前加载，保证 `ZHS.Guard` 在 `start()` 调用时已存在）。

### 验证
- `node build.js` 通过（dist 头部 @version 0.6.40）；
- `node test/run.js` 新增 9b/9c 两段单测覆盖（自检置信度、视频进度交叉校验防误停、看门狗启停与 _tick 不抛错）；
- 既有 536 用例不受回归影响（只新增判据，未删改旧逻辑）。


> 第十八轮补丁（round-33）：**修「进入课程永远停在第 1 节、不能自动跳未学节」** + 落地网课实时监控启动器。

### 现象
开网课自动播放时，脚本总是从页面默认加载的那一节（通常是第 1 节）开始，不会自动跳到「未学完的节」。用户原话：「你自动看的是第一节课，不能跳转到没学的课（自动）」。

### 根因
进入课程的初始化流程（`07-main.js` `boot()`）只靠 `Resume.restore()` 跳节：
- 有续播记录 → 跳到记录里的断点节（正常）；
- **无记录（缺失/过期/被清）→ 直接播页面默认加载的那节**，没有任何「跳到首节未学」的兜底。
- 智慧树常把新课默认停在第 1 节，于是表现成「永远看第一节课」。

课内续跳本身正常（`gotoNext` 用的是 `Catalog.findNext(cur)`，能正确找下一个未学节），问题只在**进入那一刻**。

### 修法
在 `07-main.js` 第 5.5 段（`Resume.restore` 之后）加兜底：
- 仅当 `skipFinished` 开关开（语义本就是「自动跳过已完成节点」）；
- 且当前节 `isFinished` 为真；
- 且 `Catalog.findNext(null)` 能捞到未学节；
- 才 `Catalog.click(首节未学)` 并等 3s 加载。

三条件同时成立才跳，避免误跳：全新课第 1 节本就没看完 → 不跳，保持平台默认位置。

### 配套：网课实时监控启动器
按已完成的浏览器操控方案调研，新增 `tools/zhs-monitor.cmd` + `tools/zhs-cdp.js`：
- 读 Edge `DevToolsActivePort` → 拼 CDP ws → `playwright-cli attach --cdp=<ws> zhs` 接管已登录的 Edge；
- `playwright-cli -s=zhs show --port 0` 起实时画面面板；
- 后台用 `console` / `snapshot` / `video-start` / `tracing-*` 观察与留证。
- 前置：Edge 内 `edge://inspect/#remote-debugging` 勾选 Allow remote debugging（Chromium 136+ 默认 profile 接管唯一干净入口）。

### 验证
- `node build.js` 通过，dist 同步检查通过；
- `node test/run.js` **536 通过 / 1 失败**（唯一失败仍是 `开启随机兜底后能作答` 这条 pre-existing 红灯，与本次改动无关——只动了入口流程，未碰答题器）。

---

## [0.6.38] - 2026-10-20
> 第十七轮补丁（round-32b）：**修面板「日志」页切过去永远空白**。

### 现象
把 0.6.37 装进真机后，状态卡已能跟随弹题变化（实测：插入弹题后 1065ms 由「空闲」变「作答中」），但面板「日志」页仍是空的。

### 根因：渲染触发条件自相矛盾
- `_renderLogs()` **只**被 `onLog()` 调用；
- 而 `onLog()` 第一件事就是 `if (!pane.classList.contains('on')) return;`（注释写着「只在日志页刷新」）；
- 切 tab 时只是切 CSS class（`.pane.on`），没有 JS 回调去触发渲染。

三段一撞：切到日志页的那一刻，**没有任何人渲染它** → 空白；只有之后恰好产生一条新日志时才会突然显示出来。用户看到的就是「日志功能坏了」。

### 修法
在 `_refreshInner()` 里补一段：当前激活的 pane 是 `log` 时，每次刷新都渲染一次日志。
切页后 1.5 秒内必有内容，且日志随新条目滚动（`onLog` 的即时刷新仍保留，等于双保险）。

### 验证
- `test/run.js` 第 70 组补 2 条断言：日志页标签存在、**切到日志页后有日志内容**（修前必然失败）。
- 跑测 **536 通过 / 1 失败**（唯一失败仍是 `开启随机兜底后能作答` 这条 pre-existing 红灯，非本轮回归）。

---

## [0.6.37] - 2026-10-20
> 第十七轮（round-32）：**修面板刷新真源**——真机实测发现面板状态字段与弹题状态卡**全部永久冻死**，且零报错。

### 真机现象（这次是浏览器里跑出来的，不是推演）
在真机 Edge 上装好脚本后，用 MutationObserver 插入模拟弹题夹具：
- 日志里脚本**确实**在自动作答（「检测到课中弹题，开始自动作答」「LLM 投票收敛于 A」「派发 Esc 重试 3 次」）；
- 但面板状态卡 **9 秒内 600 次 15ms 细粒度采样，纹丝不动**，恒为「弹题：空闲」；
- `.s-uptime`（本次运行分钟数）**75 秒不涨**（60 秒就该变「1 分钟」）；
- 面板「日志」页**永远空白**；
- 75 秒内 shadow 树里全部 12 次 DOM 变更**全是 alert 提示条**（那是 `panel.alert()` 直接改 DOM，不走刷新流程）——**状态字段一个都没动**；
- **全程零报错**（所以之前几轮都没发现）。

### 根因：两份对象 + `this` 绑定分裂
`06-panel.js` 先建占位对象 `ZHS.panel = {}`，末尾再 `Object.assign(ZHS.panel, Panel)` 把方法填进去。于是模块里同时存在两个对象：

| 位置 | 调用 | `this` 指向 | 结果 |
| --- | --- | --- | --- |
| `07-main.js` | `ZHS.panel.mount()` | 占位对象 `ZHS.panel` | `_root` / `_shadow` 落在它身上 ✓ |
| `06-panel.js` 定时器 | `setInterval(() => Panel.refresh(), 1500)` | **原 `Panel` 对象** | `Panel._shadow` 永远 undefined → `_refreshInner()` 第一行 `if (!this._shadow) return;` **每 1.5 秒静默早退** |

后果：面板**所有**状态字段（运行状态 / 课程进度 / 当前课时 / 视频进度 / 未看完 / 未解锁 / 本次完成 / 已答题数 / 本次运行）永远停在挂载那一刻的初始值；**round-31 新增的弹题状态卡**因为更新代码就在 `refresh()` 里，也跟着永远不更新；面板「日志」页因为渲染同样在 `refresh()` 里，也永远空白。

### 修法（三处，缺一不可）
1. **定时器改绑真源**：`setInterval` 改为调 `ZHS.panel.refresh()`，与 `mount()` 保持同一个对象。
2. **加结构性防御**：`refresh()` 开头判断「若真正持有面板实例的是 `ZHS.panel` 而 `this` 不是它，则转发过去」——这样**任何**调用姿势（`Panel.refresh()` / `ZHS.panel.refresh()`）都能真正刷新，杜绝同类坑再靠人眼发现。
3. **状态卡更新块前移**：原本放在 `_refreshInner()` **最末尾**，而上面 `Player.video()` / `Catalog.stats()` / `Catalog.breakdown()` 任意一处抛异常就会中断整段刷新——注释写着「独立于 Catalog，Catalog 异常也不影响此卡刷新」，**实际并未兑现**。现已移到方法开头（拿到 `.wrap` 之后立刻更新），任何后续异常都影响不到它。

### 顺带确认的另一件事：观测面
带 `@grant GM_*` 的用户脚本跑在**篡改猴的隔离世界**，页面主世界读不到它挂的 `window.ZHS`（本次全程 `window.ZHS === undefined`，而脚本明明在跑）。**正确观测面是「控制台日志 + DOM（shadow root 穿透）」**，不是页面全局变量。

### 验证
- `test/run.js` 新增第 70 组（7 条断言）覆盖：面板挂载后状态卡随 `dialogPhase` 变化、**1.5 秒定时器周期自动刷新状态卡**（修前必失败）、`Catalog.stats()` 抛异常时状态卡仍更新、源码层防线（定时器不得裸调 `Panel.refresh()`、状态卡块必须排在 `Catalog.stats()` 之前）。
- 跑测 **533 通过 / 2 失败**：一条是 `开启随机兜底后能作答`（round-31 之前的 **pre-existing 红灯**，位于 Answerer 作答计数层，需单独开轮排查，非本轮回归）；另一条是 `dist 产物与 src 同步`，本轮 build 后消除。

---

## [0.6.36] - 2026-10-20
> 第十六轮（round-31）：**弹题实时感知（MutationObserver 常驻）+ 面板状态卡 + 离线启发式开关**。

### 痛点：主循环 2 秒轮询，弹题随机弹出时响应有「空窗」
弹题是随机插入 DOM 的，旧实现只能靠 2 秒一轮的主循环去「碰」它。后果：
- 弹窗已经弹出、但下一轮轮询还没到 → 白白等最多 2 秒才去答；
- **更隐蔽的坑**：主循环此刻正 `await` 在别的分支（如视频探测、章节跳转）里，轮询被这条 await 卡住，弹题响应延迟被成倍放大，体验上像「卡死」。

### 解法：弹窗一插入 DOM 立即唤醒，不再死等轮询
- 新增 `Scheduler._initDialogObserver()`：用 `MutationObserver` 常驻监听 `document.documentElement` 的 `childList/subtree` 变化，弹窗节点一进 DOM 就异步唤醒 `_kickDialog()`（微任务级去抖，不刷 CPU）。
- 单一真源：把「守卫 2」原来的弹题体抽成 `Scheduler._handleDialog()`，主循环路径与 Observer 即时路径**都收敛到它**；用 `_dialogHandling` 防重入，杜绝两条路径状态打架。
- `start()` 挂载 observer、`stop()` 一并卸载（`_disposeDialogObserver()`），SPA 二次启动自带去重。

### 端到端美化：弹题实时状态卡 + 启发式开关
- 面板首页新增**弹题实时状态卡**：`空闲 / 检测到 / 作答中 / 已答 / 待人工` 五态，带脉冲圆点，独立刷新不受其它模块异常影响。
- `ZHS.state` 新增三字段支撑状态卡：`dialogActive` / `dialogPhase`（`none|detected|answering|answered|pending-human`）/ `dialogLastAt`。
- 设置页新增**「离线启发式兜底」开关**（`heuristicFallback`），与 round-30 的离线启发式求解层打通，用户可一键关掉兜底蒙答。

### 顺手修的真实 bug（单测抓出）
- `_disposeDialogObserver()` 把 `this._dialogObserver = null` 写在了 `if` 块内：从未挂载过时 observer 是 `undefined`，disposed 后仍是 `undefined` 而非 `null`，状态不一致。改为「无论是否曾挂载，disposed 后统一置 null」，恢复「未挂载/已卸载 → null」单一不变量。

### 验证
- `test/run.js` 新增第 69 组（21 条断言）覆盖：状态字段初始值、observer 挂载/幂等/卸载、插入节点异步唤醒 `_kickDialog`、`_kickDialog` 四类路由（guardOverlays 关 / present 假复位 / present 真调用 / 重入忽略）、面板模板含状态卡与开关、配置布尔归一化。
- 跑测 `527 通过 / 1 失败`；唯一剩余失败 `开启随机兜底后能作答` 为 round-31 之前的 **pre-existing 红灯**（位于 Answerer 作答计数层，与本轮无关），需单独开轮排查，非本轮回归。

## [0.6.35] - 2026-10-20
> 第十五轮（round-30）：**补上「答不上就卡死」的最后一环 —— 离线启发式兜底**。

### 起因：平台规则被确认后，旧的「宁漏勿错」直接变成了「必卡死」
用户校准了一条此前假设错的关键行为：
> 弹窗是**随机弹出**的答题，没有规律，**必须答完题才能关闭**。

这条一成立，代价结构就变了——「答不上」不再是漏一题，而是**弹窗关不掉、挂机当场中断**。
而原来的求解链在最普遍的用户状态下恰好是**一条通道都没有**的：

| 通道 | 前置条件 | 拉到即用的用户通常状态 |
| --- | --- | --- |
| DOM 内嵌答案（round-26） | 平台是否把答案渲染出来 | **不一定**（4.4 实测从头到尾没有） |
| 题库 `09-bank` | 自建题库服务地址 | **没有** |
| LLM `10-llm` | 自己填 API Key | **没有** |

三条全空 → `Solver` 走到 `if (!cfg.gatedRandom) return null` → 答题器一题未答 →
平台拒绝关闭未作答弹窗 → 脚本卡在这一节，直到用户本人回来点。

### 新增：离线启发式求解器 `src/11b-heuristic.js`
零网络、零 Key、零题库，纯本地推断。七类判据：

| # | 判据 | 说明 |
| --- | --- | --- |
| 0 | 判断题套路 | 教材型陈述默认判对；题干含绝对化词则反转为错 |
| 1 | 收尾正确项 | 「以上都对 / A和B都对」命中必选 |
| 2 | 包含排雷 | 字面被长选项覆盖的短项 = 片面答案，排除 |
| 3 | 题干词汇重合 | 中文 bigram + 英数词，`命中数 / √词数` 抑制长选项刷分 |
| 4 | 否定式题干 | 「不正确 / 不属于 / 除外」→ 反过来选最离群项 |
| 5 | 绝对化/留有余地 | 「一定、所有、唯一」扣分；「通常、一般、之一」加分 |
| 6 | 长度中庸 | 偏离均值过远扣分（过长多为编出来的干扰项） |

**排序必须在题库/LLM 之后**：它是统计推断，质量低于前者，只有它们都缺席或失败时才出场，
不会拉低已经配好通道的用户本来的答题质量。

**失效判据（宁可不答，也不冒充高分）**：每条规则都带置信度，总分不够线或分项并列领跑时
直接返回 `null` 认输，由上层决定「随机兜底」还是「转人工」。

### 改动清单
- `src/11b-heuristic.js`（新增）：求解器本体，内部构件 `_grams / _tokenSet / _overlapRatio / _isNegatedStem / _isJudgePair / _solveJudgement` 只读暴露供单测锁边界。
- `src/11-solver.js`：求解链插入**通道 C**（原第 3 步编号顺延为第 4 步），命中计进 `stats.heuristic`。
- `src/00-config.js`：新增开关 `heuristicFallback`（默认 **开**），并入 `BOOL_KEYS` 布尔归一化白名单。
- `test/run.js`：**第 68 组** 9 条断言（判断题两条方向、重合胜出、否定式反向、收尾项、认输返回 null、包含排雷）。

### 门禁
`node build.js` + `npm test` → **通过 508 / 失败 0**（含 dist 与 src 同步校验）。

### 尚未完成（下一轮接着做）
- **弹题实时感知**：目前仍是主循环 2 秒轮询。弹题随机弹出，应补 MutationObserver 常驻监听，
  插入即唤醒处理，消除「正在 await 其他分支时的响应延迟」。
- **面板端到端美化**（用户指定的最后一步）：弹题实时状态卡（检测到 / 作答中 / 已答 / 待人工）、
  设置页补 `heuristicFallback` 开关入口、日志区视觉整理。

---

## [0.6.34] - 2026-10-19
> 第十四轮（round-29）：**真机功能测试 + 结论校正**。跑通了挂机主链路，同时推翻了上一轮两条错误断言，并修掉了挂机第一杀手。

### 真机实测确认（这部分是好的）
- 零 seek 续播成立：切到未完结的 4.4，平台自己把视频定位到断点（ct=284，对应记录 37%），脚本全程不 seek。
- 正常播放进度被平台正确记录：ct 59→199 期间平台进度 8%→26% 同步上涨。
- Turing 激活态判据**不误报**：常驻休眠 iframe 全程 `captcha:false`，没有把挂机卡死。
- 守卫 3.5（温馨提示）判据正确：隐藏态 wrapper 的 `display` 是 `none`，不会每轮空点「我知道了」。
- 切集走「点 `.catalogue_title`」是页内切换，URL 不变、不跳门户。

### 修掉挂机第一杀手：关弹题会整页跳门户
- 真机：点弹题的「关闭」按钮后，页面**稳定**跳到 `www.zhihuishu.com`（同一门课连测 2 次，2 次都跳）。
  跳走后既没有 video 也读不到目录 → `findNext` 返回 null → 被误判成「全部看完」而停机。
- 修复：`05-scheduler.js` 新增**守卫 0** —— 在学习页记住 `location.href`；
  连续 3 轮（约 6 秒）读不到课程目录就自动跳回学习页。连续 3 轮是为避开「页面刚加载目录未渲染」的误判。
  这一条同时兜住「切集偶发跳走」，比原先 round-27 只「不推进、干等」更进一步。

### 推翻上一轮的两条错误断言（口径修正）
1. **「答案恒定内嵌 DOM」是错的**：1.1 那道有 `正确答案：A`，但 4.4 那道（选项 `A.1/B.3`、题干是图片）
   **全文没有答案，点选选项后也不出现**。代码改为「读得到走快路径，读不到老实降级」，
   注释与文档一并更正，不再假设一定有答案。
2. **「旧文档的 `#playTopic-dialog` 已作废」是误判**：真机 DOM 里弹题容器**就是**
   `#playTopic-dialog`（a11y 名「弹题测验」是同一个元素）。插件原选择器本来就准。

### 顺带修正的事实
- 弹题不一定在 88% 出现（4.4 在 ≈55% 就弹）。
- 弹题弹出时**不保证暂停视频**（4.4 第二次弹出时视频仍在播）。
- 右上角 X 用合成事件点不掉这个弹窗，只有「关闭」文字按钮能关。

测试：新增第 67 组 5 条断言（记住回家路 / 离开计数递增 / 第 3 轮触发回跳）。
门禁：build v0.6.34 + test 499/0 + check:dist 全绿。

---

## [0.6.31] - 2026-10-19
> 第十一轮（round-26）：**真机侦察结论落地**。根除「seek 触发滑块验证码」这条致命链路，并补上腾讯 Turing 验证码识别与「答案内嵌 DOM」的弹题快答通道。

背景：用 playwright-cli 操控已登录态 Edge 真机，在 `studyvideoh5` 视频页反复实测，把
「挂机看课 + 课中弹题」的真实机制逐条取证（详见 `docs/04-真机问题清单.md`、
`docs/05-切集与反作弊调研.md`）。本轮把这些结论固化进代码。

### 一、根因修复：自动化链路彻底零 seek（「下一集被检测成脚本、跳转不支持」）

真机结论：智慧树把「异常 seek / 拖进度条」当作脚本特征 —— 一旦 seek 就弹出
**腾讯 Turing 滑块验证码**（`turing.captcha.gtimg.com` 跨域 iframe，脚本解不了），
且验证未过期间平台不记录进度。旧实现有三处 seek，全部拔掉：

| 位置 | 旧行为 | 新行为 |
|---|---|---|
| `03-player.js` `syncToCatalog()` | 播放器超前平台记录 → `v.currentTime = expected` 拉回 | 只告警、**不改动播放位置** |
| `03-player.js` `retryFromPlatformProgress()` | 播完但进度 <100% → seek 回退重播 | **重新点本节标题**，让平台按自己的记录定位（真机实测 2.25 节：点标题后停在 474/622），零 seek |
| `04-resume.js` `restore()` | 断点续播 → `seekTo(记录点)` | 只「点过去 + 播放」，位置交给平台自身记录 |

`Player.seekTo()` 保留但标注为**唯一 seek 入口、仅供手动**，自动化禁用。

### 二、补漏：腾讯 Turing 滑块验证码识别

`VERIFY_SELECTORS` 原本只有网易易盾（yidun）与老版 tcaptcha，**漏了现在实际在用的腾讯 Turing**。
新增 `Util.turingActive()`：

- 不能裸加 iframe 选择器 —— 那个 iframe 在视频页是**常驻休眠占位**（300×150，computed 仍 visible），
  裸加会让守卫 1 永久命中、脚本彻底停机（真机踩过）；
- 改用「激活态」判据：① iframe 祖先出现覆盖视口的 fixed/absolute 浮层
  ② 页面出现可见的「拖动下方滑块 / 安全验证」文案。

### 三、弹题：答案内嵌 DOM → 读出来直接关 + 续播

真机实测：AI 助教小智出的「弹题测验」把「**正确答案：A**」直接渲染在 DOM 里
（同一弹窗还写明「不影响作业考试成绩」）。这类题既不需要题库也不需要 LLM。

- 新增 `Questions.Dialog.answerFromDom()`：直接读页面给出的答案；
- 调度器新增**守卫 2.0**：读到答案就直接关闭并 `play()` 续播。旧的「必须答上才关」铁律
  对它会卡成「关不掉 → 转人工空等」的死循环（实测点选项后选中态根本不变，
  即这类题无法真正「作答」）；
- 该通道不依赖「自动答题」开关，关着也能秒过；页面没给答案时返回 null，正常回退题库/LLM。

### 四、其它真机校准

- **切集点击目标**：legacy 适配器新增 `clickTarget: '.catalogue_title, #lessonOrder'`，
  `Catalog.click()` 优先用 `Util.realClick()`（带坐标的 mousedown/mouseup/click 三连）
  点内部标题 —— 真机验证为页内切换（URL 不变）；而点 `li` 本体出现过整页跳门户首页。
- **「温馨提示」弹窗**：新增守卫 3.5 自动点「我知道了」关闭。注意「不再提示」只是打标记、
  **不会关掉当前弹窗**；顶栏「返回学堂」点了会跳门户，绝不碰。

### 五、门禁

- `npm run build` → 17 模块 / v0.6.31 构建通过
- `npm test` → **489 通过 / 0 失败**（新增第 60~63 组共 9 条回归断言，覆盖：
  休眠 iframe 不误报、激活拦截要报、DOM 读答案、补播不 seek）
- 第 32 组用例语义随铁律反转同步更新（旧断言「必须拉回」→ 新断言「绝不 seek」）

---

## [0.6.32] - 2026-10-19
> 第十二轮（round-27）：导航守卫补齐 + 文档口径与真机/代码对齐。

### 一、新增：页面被整页带走时的导航守卫

真机出现过「切集时整页跳到 `www.zhihuishu.com` 门户首页」的情况。此时既没有 video、
也没有课程目录，旧逻辑仍会走 `gotoNext` → `findNext` 因目录为空返回 null →
被判成「没有下一节 / 全部看完」而**误停**（真相是页面跑偏了，不是课看完了）。

现在 `05-scheduler.js` 无视频分支先查目录：目录为空 → **绝不推进**，只告警并等待；
页面回到学习页后自动恢复（`_navAwayNotified` 做提示节流，不刷屏）。

### 二、文档口径校准（`docs/PROJECT_MAP.md`）

三处与真机/代码不一致，已改正：

| 位置 | 旧（错） | 新（真机校准后） |
|---|---|---|
| 5.1 选择器速查 | studyvideoh5 按 wisdom 版写（`.child-info.hasvideo`） | 实测是 **legacy**：`li.clearfix.video` / `.current_play` / `.time_icofinish` / `.catalogue_title` |
| 5.2 第 1 条 | 倍速 ≤ 1.8 | **≤ 1.5**（`Player.setSpeed` 的硬上限） |
| 5.2 第 3 条 | 「进度不同步就把 `currentTime` 设回记录点重播」 | **绝不能 seek**（这条正是 0.6.31 根除的致命逻辑，附警示不要再加回来） |

顺带把过时的测试项数（160/211）更新为实际门禁 **489 通过 / 0 失败**。

### 三、门禁

`npm run build`（v0.6.32）+ `npm test` → **489 通过 / 0 失败** + `check:dist` 全绿。

---

## [0.6.33] - 2026-10-19
> 第十三轮（round-28）：给 round-26/27 新增的能力补回归网，防止日后改回去。

新增第 64~66 组（5 条断言）：

| 用例 | 固化了哪条真机结论 |
|---|---|
| 64 · legacy 切集 | 点击必须落在 `.catalogue_title` 上（并冒泡到条目）；点 li 本体会跳门户 |
| 65 · realClick | 必须派发 mousedown→mouseup→click 三连且带坐标，不能退化成裸 `click()` |
| 66 · 多选答案内嵌 | `answerFromDom()` 连「正确答案：AB」这类多选也能读出来 |

门禁：`npm run build`（v0.6.33）+ `npm test` → **494 通过 / 0 失败** + `check:dist` 全绿。

---

## [0.6.29] - 2026-09-20
> 第十轮。补全 M8「学习记录」部分：**答题来源分布 + 学习时长累计 + 习惯分统计**，并配套面板区块与第 34 组判别性测试。

### 一、新增 `ZHS.Stats` 模块（`src/14-stats.js`，新建）

把「学得怎么样」从黑盒变成可看的数据，三条铁律：

- **不影响答题主流程**：所有写入 `try/catch` 吞异常，统计崩了也不许干扰答题。
- **不被存储撑爆**：明细 `MAX_RECORDS = 200` 硬截断（灌 250 条后只留 200）。
- **习惯分规则透明**：满 `HABIT_MINUTE = 30min` 记 1 分，已得 / 还差在面板直接显示。

API：`record(title, result)` / `addStudyTime(ms)` / `summary()` / `reset()` / `_dayKey()`。

### 二、埋点接入（让数据真流动起来）

| 文件 | 改动 |
|---|---|
| `src/11-solver.js` | `solve()` 内加统计包装 `done(r)`：三出口改为 `return done(null)` / `done(result)`，成功/跳过都计入来源分布 |
| `src/05-scheduler.js` | `tick()` 开头加学习时长埋点：**仅视频真播放时**累加 `LOOP_INTERVAL`（暂停/加载/弹题阻塞不计入，避免虚高） |
| `src/06-panel.js` | 设置页新增「学习记录（M8）」区块：`renderStats()` 显示今日答题来源分布、学习分钟、习惯分已得/还差，明细与累计挂 `title`；附「刷新」「清空记录」按钮 |

### 三、判别性测试（先红后绿）

`test/run.js` 新增**第 34 组「学习统计（M8）」**（9 条断言）：今日答题数=2、题库=1、模型=1、跳过=1、学习时长=45min、习惯分=1、最近记录最新在前、明细≤200。

**隔离验证**：把 `src/14-stats.js` 移出 `src/` 重建 → 第 34 组 **9 条全红（EXIT=1）**；恢复 → **458 通过 / 0 失败**。
证明测试有判别力、不是假绿。

### 四、门禁
`node build.js` + `node tools/check-dist-fresh.js` + `node test/run.js` → **458 通过 / 0 失败**；凭据扫描 0 命中。

---

## [0.6.28] - 2026-09-20
> 第九轮。**两件事**：① 收口 round-24 遗留的观察池（8 项），挖出并修掉一个**上一轮自己埋的漏网真 Bug**；② 推进 M8「通道健康检测」。

### 一、观察池 8 项核销（先核销再动手，未核销不许改）

| 编号 | 声称 | 实际核实 | 判定 |
|---|---|---|---|
| C09 | 重复 bus Styles | 全库 **0 命中** | ❌ 漂移 |
| C20 | 案件追踪 evidence 未 intake | **0 命中** | ❌ 漂移 |
| C15 | Polling 频率过高 | 主循环 `LOOP_INTERVAL = 2000`，合理 | ❌ 不成立 |
| C16 | 阻塞式 sleep | 全部为 `await U.sleep()` 异步，非阻塞 | ❌ 不成立 |
| C10/C11 | 弹题关闭缺重试 / 重试条件 | `closeDialogAndResume` **已有** 3 次重试 + 递增退避(700×n) + 30s 冷却 + 无通道不卡死 | ❌ 已具备 |
| **C07** | `_solver()` 未打 error stack | `11-solver.js` 两处 catch 只取 `e.message` | ✅ **真 Bug（且是 round-24 漏网）** |

### 二、★ 修复 C07：诊断链路在求解层断裂（round-24 自己埋的坑）

**漏网经过**：round-24 在网络层与 LLM 层都挂上了 `e.hint`（可操作建议），并验证了**面板「测试连接」**那条路能看到建议。
但用户真正刷题走的是 `Solver.solve()`，其 catch **只取 `e.message`，把 hint 丢了**——真实答题路径上用户依旧只看到「请求失败」四个字。

> 这正是 Oracle Gate 判据 c（**入口可达性**）要防的事：**只验证一条调用路径属于假判据**。
> 上轮验证了「面板路径」却没验证「答题路径」，差点以为收工。

**改动**（`src/11-solver.js`）：
- 新增 `logChannelFail(kind, e)`：统一输出 `message + 建议：hint`，并按 `kind|code|message` **节流 30 秒**
  （作业页一次连跑 20 题，同一故障刷 20 遍会把面板挤空，后一条顶掉前一条，用户反而一条也看不清）。
- 题库异常从 `debug` 提级到 `warn`：题库挂了用户完全不知情，只看到「题没答上」。
- LLM 失败透传 `e.hint`（原来只打 `e.message`）。

### 三、M8 推进：通道健康检测

- `src/09-bank.js` 新增 `health()`：返回 `{ok, msg, hint, code}`，复用 diagnose 产出成因与建议，与 LLM 侧 `test()` 对齐。
  （保留 `ping()` 布尔版不动；经 grep 确认 `ping()` 无任何调用者，增强无兼容风险。）
- `src/06-panel.js` 设置页新增「通道健康检测」区块：「立即检测」按钮**并发点检题库 + 模型两条通道**，
  逐条显示「正常/异常｜原因 → 建议」；完整文案挂 `title`，避免面板区域窄导致后半句被截断。

### 四、判别性测试（先红后绿）

`test/run.js` 新增**第 33 组「求解层诊断透传（入口级）」**（原产物组顺延为 34）：

| 断言 | Baseline（旧代码） | Candidate |
|---|---|---|
| ★ 真实答题入口把 hint 透传到用户可见日志（从 `ZHS.Solver.solve()` 发起） | ✗ 日志只有 message | ✓ 含「建议：…」 |
| 同类故障被节流（连跑两题不重复刷屏） | ✗ 仍输出 1 条 | ✓ 0 条 |
| 题库未配置地址 → `health()` 归类 `NO_URL` | ✗ 得到 `""` | ✓ `NO_URL` |
| 题库未配置时给出可操作提示 | ✗ 空 | ✓ 含示例地址 |

**隔离验证**：`git stash push -- src/11-solver.js` → **446/2 失败**（hint 透传、节流两条全红）；
`git stash push -- src/09-bank.js` → **447/2 失败**（health 两条全红）。Candidate **449 / 0**。

> 诚实标注：组内「两通道全失败时不返回答案（不瞎蒙）」一条 baseline 也通过，
> 属**回归保护**而非判别证据，已在代码注释中标明，不混入判别结论。

### 五、过程中修掉的两个自身错误

1. **测试框架位置错误**：第 33 组首版插在 `Promise.all(...).then(同步回调)` 里用 `await` → 整文件 `SyntaxError` 起不来。
   项目约定：异步组必须是 `const _x = (async () => {...})();` 且**必须登记进末尾 `Promise.all`**，
   否则断言在汇总打印之后才跑完、失败被静默吞掉（假绿，2026-09-18 踩过）。
2. **`ZHS.config` 直写无效**：测试里直接改 `ZHS.config.answerMode` 不生效（仍走进题库通道，测错了对象）。
   必须走 `ZHS.setConfig({...})`。已写进测试注释，避免后人重踩。

### 门禁
`node build.js` + `node tools/check-dist-fresh.js` + `node test/run.js` → **449 通过 / 0 失败**；凭据扫描 0 命中。

---

## [0.6.27] - 2026-09-19
> 第八轮。**用户报「API 请求失败」的可诊断性根因**（第六台 Deep Research + 代码审查定位）。过去 LLM / 题库一旦调用失败，用户面板只显示一句「请求失败」或「返回非 JSON」——而**四种成因完全不同的故障**（请求超时、网络不通、服务端返回 HTTP 错误、服务端返回 HTML 门户页）在旧实现里全被压成同一个 `{ok:false, status:0}`，用户既不知道该改什么，也无从自查，只能反复重试（现实中就是约 40% 无效重试算力被吃掉）。本轮在网络层补「故障分类器」，把成因翻译成人能看懂的中文 + **可操作建议**，并沿调用链一路透传到面板。（本轮同时修正了一件事：前一份 review 报告里的 C01/C02/C03/C04/C05/C08/C13/C18 共 8 条经核实为**结论漂移**——对应符号在当前代码中 0 命中或早已修复，未据此改动。）

### 根因链（5 Whys）
```
现象：用户报「API 请求失败」
① 为什么？    → JSON.parse 抛异常，文案「LLM 返回非 JSON」
② 为什么？    → provider 返回的是 HTML（网关 502 页 / 代理拦截页 / 站点首页），不是 JSON
③ 为什么？    → 错误处理只做 try/catch，没有识别「响应体类型」这一层
④ 为什么？    → callOnce 的错误路径缺少「失败分类」抽象
⑤ 为什么？    → 网络层 Bank.request 只返回 {ok,status,text}，丢弃了失败成因，
                 调用方无法区分失败类型（← 设计缺口，根因）
```
占位符替换测试：`R = "把任意一个 baseUrl 改对"` → 换成 `<任意字符串>` 后修复失效 → **补丁**，退回；
`R = "网络层回报失败类型枚举，调用方据此生成建议"` → 对任意 provider 通吃 → **真根因**，放行。

### 修复
- **【失败类型枚举 FAIL + 响应体诊断 diagnose()】** （`src/09-bank.js`）—— `request()` 返回值新增 `kind` / `detail`，把过去统统塞进 `status=0` 的三种失败拆开：`TIMEOUT`（到点没回来）、`NETWORK`（根本没发出去：跨域被拦 / 地址不可达 / 本地服务没起）、`HTTP`（服务端明确回非 2xx）。新增 `diagnose(label, res, url)` 产出 `{code, msg, hint}`：402→余额不足、401/403→Key 无效、404→路径不对（多半漏了 `/v1`）、429→限流、5xx→服务端故障；响应体是 HTML 时自动抠出 `<title>`（如「502 Bad Gateway」），让用户能自证到底是谁拦的。
- **【HTML 门户页专项识别】** —— **HTTP 非 2xx 且返回 HTML**（`HTTP_HTML`）与 **HTTP 200 但返回门户首页**（`NON_JSON_HTML`，地址误填成网站根的经典误操作）分开归类，hint 给出正确格式示范（`https://api.deepseek.com`，不带 `/chat/completions`）。这是用户最容易撞、也最难自查的一类。
- **【地址重复拼接自愈】**（`src/10-llm.js`）—— 脚本会自动拼 `/chat/completions`，用户若照文档把完整调用地址也填进去，拼出 `.../chat/completions/chat/completions` 必然 404。现在检测并自动去除重复后缀，同时给出 warn。
- **【题库地址为空短路】**（`src/09-bank.js`）—— 过去 `bankUrl` 为空时仍拼成 `'/adapter-service/search'` 发出去，相对路径打到当前网课站点拿回一串 HTML，却只报一句 debug 级「返回非 JSON」，用户完全无感。现在直接短路并提示「请填写形如 http://127.0.0.1:8060 的地址」。
- **【日志提级 + 节流】** —— 题库失败从 `debug` 提升到 `warn`（失败原因必须让用户看得见），同类故障 30 秒只报一次（服务商挂掉时主循环每 2 秒一轮，不节流会把控制台刷爆，反而淹掉有用信息）。
- **【诊断透传到面板】**（`src/06-panel.js` + `10-llm.js`）—— `LLM.test()` 返回值新增 `hint` / `code`，面板「测试连接」失败时不再只显示「连接失败」，而是连解决方案一起给出（完整文案同时挂 `title`，避免窄区域截断后半句）。

### 测试
- `test/run.js` 新增 **第 32 组「网络失败诊断」共 23 条**，覆盖 9 个场景：502 HTML 页 / 200 门户页 / 超时 / 断网 / 401 / 空响应体 / 抛错带 hint / 正常 JSON 仍可解析 / `<title>` 提取。
- **全部断言落在具体返回值**（`code` 精确匹配、`msg`/`hint` 关键词），无一条 truthy 判定。

### 回退验证（硬要求）
用 `git stash push -- src/09-bank.js src/10-llm.js src/06-panel.js` 把源码回滚到修复前、**保留新测试**实测：

| 判据 | 结果 |
|---|---|
| Baseline（旧代码） | **421 通过 / 23 失败** —— 23 条新断言**全部变红** |
| Candidate（修复后） | **444 通过 / 0 失败** |

即每一条都在旧代码上真实失败、在新代码上通过，**没有任何一条「在新代码上绿但旧代码也绿」的假判据**。
（过程中修正了一次：首版 baseline 是 `TypeError` 崩溃退出，把后一半用例吞掉了，看不到「哪些失败、为什么失败」；已改为 stub 兜底让每条各自干净 FAIL，并把两个 stub 的返回值刻意取成 `undefined` / `'STUB'`，避免旧代码碰巧通过某条断言——最终从 24 条精简为 23 条真正具备判别力的用例。）

### 核销：review 报告的结论漂移（未据此改动）
| 编号 | 报告声称 | 实际核实 |
|---|---|---|
| C01 | `handleAnswerDialog` 缺 wrapper | 符号不存在；`root()` 已于 09-19 重写为「遍历全候选 + 题目特征分选最优」，与本缺陷同时 helps |
| C02/C03/C05/C08 | `initTiku` / `processSchoolQuestion` / `emitImplementationMissing` | 全库 0 命中 |
| C04 | `quotaManager` dispatch | 0 命中（`09-bank.js` 全文件仅 184 行） |
| C13/C18 | `isDevMode` / `_traded` | 0 命中 |

### 门禁
`node build.js` + `node tools/check-dist-fresh.js` + `node test/run.js` → **444 通过 / 0 失败**；凭据扫描 0 命中。

### 文档（本轮收尾）
- **README 第七章「质量度量与能力矩阵」**：① 测试门禁演进表（v0.1.0 211 → v0.6.27 444 逻辑单测，累计 514 项全绿）；② 与 ocsjs/cxmooc-tools 的能力 benchmark 对比表；③ Mermaid 能力矩阵图（F1 播放 / F2 续播 / F3 答题 / 工程化保障）。
- 全文过时的 `244 / 314 / 160` 测试计数已更正为 `444 / 514`。

---

## [0.6.26] - 2026-09-19
> 第七轮。**方案 D 主路径的短路漏洞**（team-lead 实测挖出）：0.6.25 的 `_anchoredOptions` 主路径「逐层向上、**第一圈命中就 return**」——而 `_siblingsAfter` 只在**同一父节点的直接兄弟**里选组，题干与噪声常**同父**（如 `<div class="wrap"><div class="q-title">题干</div><div class="it">A. 上一节课程回顾</div><div class="it">B. 下一节课程预告</div></div>`，真选项在 `.wrap2`）。此时第一圈就命中噪声并 return → **离题干近的噪声永远赢**，方案 D 反而比方案 C 更危险（C 至少在全树里打分选优）。本轮修主路径短路 + 元信息标签组误判。

### 修复
- **【主路径短路 → 逐层收集 + 统一打分】** —— 主路径不再「命中即 return」，而是**逐层收集**所有候选组（含退化路径候选），带层级 `up` 进候选池后**统一打分选优**；层级只作**极轻量 tie-break**（`- up * 0.1`，5 层最多影响 0.5，**永远不可能翻转** `scoreOptionGroup` 的项数差 2 项 1000 vs 3 项 300）。实测：场景①（题干+同父噪声，真选项在另一容器）0.6.25 返回 `["A. 上一节课程回顾","B. 下一节课程预告"]` → 0.6.26 返回 `["甲说法","乙说法"]`。
- **【独立选项容器优先于「题干行」】** —— 修短路后仍不足：噪声 `A. 上一节课程回顾/B. 下一节课程预告` 与真选项**同为 2 项、内容分基座相同**，噪声却带 `A./B.` 前缀（+20）且更长（+0.14）→ 内容分反而**高 20.14**，`up` 的 0.1 级 tie-break 根本压不住。新增结构先验：给每个候选标记 `ownRow`（组父 === 题干父，即「题干所在那一行」）；**只要存在「非题干行」的候选组（≥2 项）就整批优先取它**，把题干行候选排除 —— 因为**真选项有专属容器**（`.opt-list`/`.wrap2`），噪声只会与题干同处一行。若不存在独立容器候选（如题干与选项**直接并列**），仍退回题干行，不破坏合法布局。
- **【元信息标签组误判 → `META_RE`】** —— 题干之后紧跟的常是「题型 / 分值 / 难度」元信息，且**同父同 tag 同 class**（`<div class="tag">单选题</div><div class="tag">2分</div>`）→ 满足结构对称判据，被方案 B/C/D 当成选项组。新增 `META_RE = /^(单选题|多选题|判断题|填空题|简答题|选择题|不定项选择题|\d+\s*分|难度[:：]?.*|【.*】)$/`，在 `_cleanGroup`（B/C/D 共用管线）里**整组命中即弃用**。实测：场景②（题干后元信息标签组）0.6.25 返回 `["单选题","2分"]` → 0.6.26 返回 `["甲说法","乙说法"]`。

### 测试
- `test/run.js` **32r** 段新增 4 条（㉖~㉙，共 29 条 + 1 性能）：
  - **㉖ 题干后同父噪声**（★可证伪，复刻 team-lead 场景①）：题干与噪声同父、真选项在另一容器 → 读到真选项、不含 `A. 上一节课程回顾`；
  - **㉗ 元信息标签组**（★可证伪，复刻 team-lead 场景②）：题干后紧跟 `单选题/2分` 标签组 → 跳过标签、读到真选项；
  - **㉘ 层级 tie-break 不翻转项数差**（直测纯函数）：`score(2项@5层) > score(3项@0层)`；
  - **㉙ 位置约束**（直测方案 D 本体 `_anchoredOptions`）：题干位于容器末尾、其**前**有对称噪声组 → D 本体返回 0 项，**不回头**收题干之前的组。
    - 为什么直测 D 本体而非 `readOptions` 终值：D 返回 `[]` 后 `readOptions` 会**继续**落到方案 C（全树猜测，本就无「题干之后」位置先验）；测终值等于在测 C，测不出 D 的契约。新增 `runCaseAnchored` 辅助函数专测 D 本体。
- **回退验证（硬要求）**：新建 **0.6.25 快照 `.src_0625/`**（自检身份：含 `1000` 项数基数、`JUDGE_SYMBOLS`、`_anchoredOptions` 的短路 `return found`，均命中），在其上实测 ㉖ 读到 `["A. 上一节课程回顾","B. 下一节课程预告"]`、㉗ 读到 `["单选题","2分"]`（**均失败，符合预期**）；修复后二者通过。
- 全量回归 **421 通过 / 0 失败**；门禁 `node build.js` + `node tools/check-dist-fresh.js` + `node test/run.js` 全绿。凭据扫描 0 命中。
- 顺带删除冗余探针 `probe_d.js` / `probe_r5.js`。

---

## [0.6.25] - 2026-09-19
> 第六轮，**换策略**：不再在方案 C 上继续加判据，而是新增**方案 D「题干锚定」**并用**位置先验**取代全树猜测。五轮下来（0.6.19→0.6.24）方案 C 每加一层判据就冒一个新洞，根因是它在做「全树无差别猜测」——扫描整棵子树找「长得整齐的兄弟组」，噪声和选项在全树范围内**平权**，只能靠越来越长的黑名单碰运气。但真实页面里选项的位置是固定的：题干读到 → 选项就在**同一题目容器内、题干之后**。本轮同时修掉验证员第五轮抓到的 4 个 P1。

### 新增
- **【方案 D · 题干锚定】`_anchoredOptions(scope, titleEl)` + `_siblingsAfter(parent, anchor)`** —— 用位置先验读选项：
  1. `titleEl` 为空 → 返回 `[]`，交给方案 A/B/C；
  2. 从 `titleEl.parentElement` 起**逐层向上最多 5 层**，在每层的 `children` 里找「**位于 titleEl 之后**、同 tag + 同 class 且连续」的一组兄弟（≥2）→ 命中即返回；
  3. 向上 5 层无果 → 退化：在 `scope` 内按**文档序**收集「题干之后、与题干无包含关系」的元素，按「父+tag+class」分组后用**打分制**选最优组。
  - 关键差别：噪声（分页器/步骤条/面包屑）要么在题干之前、要么不在同一层，**位置先验天然把它们排除**，不再依赖黑名单。
- **【优先级重排】** `readOptions` 新次序：**标准读 → 方案 D（最高优先，位置先验）→ 方案 A（文本正则）→ 方案 B（结构对称）→ 方案 C（全树猜测，最后兜底）**。**D 一旦读到 ≥2 就直接返回，不再跑 A/B/C**。
- **【统一过滤管线】`_cleanGroup(g)`** —— 方案 B/C/D 共用一套否决规则，集中一处避免三条通道各写一份、判据漂移。

### 修复（验证员第五轮 4 个 P1）
- **【P1① 阻塞·弹窗嵌在 `video-js` 容器内 → 所有真选项被 `inNoiseContainer` 杀死】** —— 旧 `inNoiseContainer` 从元素自身一路爬 **40 层祖先**逐个 class 匹配；实测弹题弹窗极可能挂在播放器容器（`video-js`/`prism-player`）内部，一旦命中 → 弹窗内**所有真选项**被判噪声 → `texts=[]` → 全平台弹题读不到。**修法**：黑名单**只看元素自身 className，不再爬祖先链**（「祖先是不是播放器」交给方案 D 的位置判据），并新增 `NOISE_CLASSES` 兜底成员级判定。实测 0.6.24 `[]` → 0.6.25 `["甲说法","乙说法"]`。
- **【P1② 打分权重非单调·前缀奖励压过项数基数】** —— 旧权重 `2项=100/3项=30/4项=10，前缀每个+40`：`[3项带 A./B./C. 前缀] = 30+120 = 150` **盖过** `[2项真选项] = 100` → 实测点了面包屑上的「A. 首页」。**修法·权重单调化**：项数基数 2项=**1000**/3项=300/4项=100；前缀每个 +10 且**最多计 2 个**（上限 +20）；长度 `lenSum/100`；**删掉 depth tie-break**（深度是噪声的帮凶）。单调性约束：`2项最小 1000 > 4项满前缀最大 100+20+len/100 < 150`。实测 0.6.24 `["A. 首页","B. 课程","C. 章节"]` → 0.6.25 `["说法一是对的","说法二也是对的"]`。
- **【P1③ NAV 回退豁免了页脚按钮组】** —— 旧逻辑「摘完导航词不足 2 → 回退为不摘」时**跳过**「全操作词否决」，导致页脚 `[上一题][下一题]` 被送去解题、**真点「上一题」**（会切页/交卷），比修前「读空不动作」更糟。**修法**：回退分支补一条 `allBtn && allAct`（整组都是 `<button>`/`[role=button]` **且**文本全 ∈ ACTION_WORDS → 仍弃组）；「剩余全操作词」否决只在**未回退**时生效（保住真题「返回/继续学习」测 ⑯）。实测 0.6.24 `["上一题","下一题"]` → 0.6.25 `[]`。
- **【P1④ `√`/`×` 被两条判据互相打死】** —— `OPTION_TEXT_RE` 第 ④ 分支明确认 `√|×` 是判断题选项，但 `isSingleNoiseToken('√')` 返回 `true`、且 `looksLikeNoiseTexts` 把「全符号组」判噪声 → 真选项被自己人杀掉。**修法**：新增判断题符号白名单 `JUDGE_SYMBOLS = ['√','×','✓','✗']`，`isSingleNoiseToken` **放行**、`looksLikeNoiseTexts` 的「全符号组」判定**豁免**；同时按 P1④ 要求**删掉 `isSingleNoiseToken` 里的 `/^\d$/` 分支**（全数字已由组级 `looksLikeNoiseTexts` 挡，成员级再挡会把 `["1","说法二"]` 这类真题误杀）。实测 0.6.24 `[]` → 0.6.25 `["√","×"]`。
- **【P2 · `13-answerer.js` 缺 root null 保护】** —— `root.querySelector` 前补 `root && root.querySelector`，与同函数 `readCurrent(root)` 的容忍度一致（避免 `root` 为 null 时 TypeError）。

### 测试
- `test/run.js` **32r** 段新增 8 条（⑱~㉕，共 25 条 + 1 性能），全部从真实入口 `handleDialog` 发起：
  - **⑱ 方案 D 题干锚定**（★可证伪）：题干前放一组「2 项、带 A./B. 前缀、更长」的对称噪声、题干后放真选项 → 读到题干后的真选项（无位置先验时方案 C 必然错选前缀噪声）；
  - **⑲ D 优先于 C**（★可证伪）：题干前 2 项带前缀噪声 + 题干后 2 项真选项 → 读到真选项；
  - **⑳ video-js 祖先**：弹窗嵌在 `video-js` 内、选项是普通 `.opt-item` → 读到 2 项（P1① 核心）；
  - **㉑ 打分单调性**（直测纯函数）：`score(2项无前缀) > score(4项带4前缀)`；
  - **㉒ 前缀噪声不再胜出**：3 项带前缀噪声 + 2 项真选项 → 读到真选项；
  - **㉓ NAV 回退不豁免按钮组**：正文内 `[上一题][下一题]`（button）→ 读到 0、`solve` 不调、`clickOption` 零次；
  - **㉔ √/× 判断题**：选项 `√`/`×` → 读到 2 项；
  - **㉕ 单数字选项保留**：选项组 `["1","说法二"]` → 读到 2 项。
  - **回退验证（硬要求）**：⑱⑲⑳ 在 **0.6.24 快照上实测失败**（⑱ 读到 `["A. 上一节课程回顾","B. 下一节课程预告"]`、⑲ 读到 `["A. 章节一知识点回顾","B. 章节二知识点预告"]`、⑳ 读到 `[]`），修复后全部通过。
- 全量回归 **413 通过 / 0 失败**；门禁 `node build.js` + `node tools/check-dist-fresh.js` + `node test/run.js` 全绿。凭据扫描 0 命中。
- 顺带删除冗余探针 `probe5.js`（职责与 `test/run.js` 32r 段重叠）。

---

## [0.6.24] - 2026-09-19
> 第五轮。第四轮给方案 C 加的判据仍不够「正向」：`_autoSiblings` 在实测里**又被页码顶掉真选项** —— 0.6.23 上，DOM 里同时存在 `.el-pager`（分页器，3 个 `.number`）与 `.opt-list > .opt-item`×2（真选项）时，`readOptions().texts` 返回 `["2","3"]`（页码！），真选项 `["说法一是对的","说法二也是对的"]` 全丢 → 命中分页器就能「点页码切页」而不是答题。本版给方案 C 装三道**正向判据 + 打分制**，并修掉一处由此引入的单汉字选项误杀回归。

### 修复
- **【P1 阻塞·方案 C 的「谁长谁赢」让噪声结构必胜】** —— 旧 `_autoSiblings` 用 `if (deduped.length > best.length) best = deduped;` 取最优组，**比谁成员多**；任何 3~4 项对称结构（分页器/步骤条/选项卡/面包屑/视频控制条）天生比 2 项真选项长，长度优先等于「噪声必胜」。实测 0.6.23 六种噪声结构全部返回噪声文本。**修法：三道正向判据 + 打分制**
  1. **①语义黑名单 `NOISE_CLASSES` + `inNoiseContainer(el)`**：对元素自身**及祖先链**（最多 40 层）逐 className 做**分词精确匹配**（`(' '+cls+' ').includes(' '+name+' ')`，比子串安全，`el-step` 不会误伤 `el-stepper`）。名单含 `el-pager / el-step / el-steps / el-tabs__item / el-tabs__nav / el-breadcrumb / el-rate / el-menu / el-menu-item / el-pagination / el-carousel / el-collapse-item / el-timeline-item / vjs-control-bar / vjs-control / prism-player / video-js / dplayer / artplayer / plyr__controls / courseware-menu`。组内任一成员命中 → **整组弃用**。为什么必须黑名单：结构整齐 ≠ 是选项，纯结构判据分不出「3 个页码」和「3 个选项」。
  2. **②内容形状过滤 `looksLikeNoiseTexts(texts)`**：组内文本**全为纯数字** `/^\d+$/` → 分页器；**全为纯符号** `/^[^\p{L}\p{N}]+$/u` → 图标组；任一命中 → **整组弃用**。成员级另有 `isSingleNoiseToken(t)` 挡「单数字/单符号」（页码「2」、图标「?」）。
  3. **③打分制 `scoreOptionGroup(texts, depth)` 取代「谁长谁赢」**：2 项 +100 / 3 项 +30 / 其余 +10（2 项最像 A/B 单选）；每个命中 `OPTION_TEXT_RE` 的前缀成员 +40（A./B. 是强正向信号）；文本长度做弱正向（`Σ min(len,50)/50`）；深度做同分 tie-break（保留「内层覆盖外层」原意）。`if (score > bestScore) { best = deduped; bestScore = score; }`。判据①②③在 `_symmetricOptions`（方案 B）与 `_autoSiblings`（方案 C）里**同步生效**。
  4. **④`readOptions` 合并收紧**：方案 C 只在「方案 A/B 颗粒无收」时才用 —— `if (picked.length < 2 && auto.length >= 2) els = auto; else if (picked.length > els.length) els = picked;`（避免噪声组与真选项等长时互相顶掉）。
  5. **⑤NAV_WORDS 回退（`fellBack`）**：摘导航词后若剩余 < 2 → **回退为不摘**，且回退时**跳过**「全操作词」一票否决 —— 否则真题选项恰好是「返回 / 继续学习」会被整组读空（测试⑯）。
  6. **⑥深度触顶一次性告警**：`_autoSiblings` 统计 `overDepth`（深度 > `AUTO_MAX_DEPTH=6` 被跳过的节点数），`_depthWarned` 保证只打一条 `ZHS.Log.warn`，便于线上排查「某些弹窗读不到选项」是否因深度不够。
- **【回归修复·单汉字选项被 `t.length <= 1` 误杀】** —— 引入①②时，`_autoSiblings` 成员级校验写成 `if (!t || t.length > 200 || t.length <= 1) { okGroup = false; }`，**「长度 ≤1 一律拒」把「甲」「乙」这类单汉字合法选项也杀了**（性能用例 `/50 装饰节点 + .opt-item 甲/乙` 实测 `texts=[]`、`solve=0`）。**修法**：抽 `isSingleNoiseToken(text)` —— 只挡**形状**为单数字 `/^\d$/` 或单符号 `/^[^\p{L}\p{N}]$/u` 的 token，单字母（A/B）与单汉字（甲/乙）保留。

### 测试
- `test/run.js` **32r** 段新增 7 条（⑪~⑰，共 20 条 + 1 性能），全部从真实入口 `handleDialog` 发起：
  - **⑪ 分页器回归（可证伪）** `.el-pager` 3 页码 + 真选项×2 → 读到 2 个真选项、不含纯数字，且 `clickOption` 实参不含纯数字；
  - **⑫ 步骤条** `.el-step`×4 + 真选项×2 → 读到真选项、不含「步骤一」；
  - **⑬ 选项卡** `.el-tabs__item`×3 + 真选项×2 → 读到真选项、不含「标签一」；
  - **⑭ 视频控制条** `button.vjs-control`×4 + 真选项×2 → 读到真选项、不含「播放」；
  - **⑮ 纯数字组单独存在** → 读到 0、`solve` 不被调用；
  - **⑯ NAV 回退** 真题「返回 / 继续学习」→ 仍读到 2 项（专防回退逻辑被「全操作词」否决杀掉）；
  - **⑰ 打分制** 无前缀对称噪声×3 + 带 `A./B.` 前缀真选项×2 → 选中前缀那 2 个。
  - **回退验证（硬要求）**：⑪ 在 0.6.23 代码上**实测失败**（返回 `["2","3"]` 页码），修复后通过。
- 全量回归 **397 通过 / 0 失败**；门禁 `node build.js` + `node tools/check-dist-fresh.js` + `node test/run.js` 全绿。凭据扫描 0 命中。

---

## [0.6.23] - 2026-09-19
> 第四轮验证员 `ab-dialog-verify` 在 0.6.22 上又抓到两条 P1，都出在「选项组识别」上：**导航词混入选项**（会真点到「下一题」切页/交卷）与**跨父串组**（两个无关容器的候选被并成一组）。本版逐条修复。

### 修复
- **【P1 阻塞·混合组「2 真选项 + 上一题/下一题」未被剔除，`Solver.solve` 拿 4 项解题、`Filler.clickOption` 会真点到导航词】** —— 方案 B（`_symmetricOptions`）与方案 C（`_autoSiblings`）此前都用 `texts.every(t => ACTION_WORDS.includes(t))` 判断「是不是页脚按钮组」，**只挡「全员皆操作词」**。实测 DOM `<div class="list"><div class="option">选项一</div><div class="option">选项二</div><div class="option">上一题</div><div class="option">下一题</div></div>` → `readOptions().texts = ["选项一","选项二","上一题","下一题"]`（4 项）→ 真实平台上 `clickOption` 会点到「下一题」**切页/交卷**。
  **修法·两层词表 + 成员级摘除**：新增 `NAV_WORDS`（`上一题/下一题/继续学习/返回/我知道了/知道了/提交答案`，**永远不可能是选项**）。两组判据统一改为：
  1. 先**逐个摘掉** `NAV_WORDS` 成员；
  2. 摘完剩余 < 2 → 弃用该组（全导航条）；
  3. 剩余成员**若全是** `ACTION_WORDS`（关闭/确定/提交/取消…）→ 仍弃用（页脚按钮组）；
  4. 否则保留。**刻意不用 `some` 一票否决整组**——那会把「选项文本恰好是『确定』」的真题误杀（测试⑩「确定 / 不正确」仍须读到 2 个，本版已验证保留）。
- **【P1 阻塞·`_symmetricOptions` 分组键用父节点「下标」当身份，跨父串组】** —— 旧代码 `const gk = 'P' + Array.from(p.parentNode.children).indexOf(p) + '|' + ...`：`indexOf(p)` 是「父在**它自己的父**里的下标」。两个完全无关的容器，只要各自都是其父的第 0 个子，`gk` 就相同 → 候选被并成一组（实测 4 个选项被并成 1 组 4 项，文本混合）。同时 `:412` 的 `p === el.parentElement ? ... : ''` 是**恒真死条件**（`p` 就是 `el.parentElement`），一并删除。
  **修法**：新增模块级 `WeakMap` 父身份分配器 `parentIdOf(el)`（全局唯一自增序号，WeakMap 自动回收、`reset` 无需清理），`gk = parentIdOf(p) + '|' + el.tagName + '\u0001' + (el.className||'')`。这才是真正的「同一父节点」语义。
- **【方案 A 同步收紧·文本通道剔除操作词】** —— `readOptions` 的通道①筛选从 `OPTION_TEXT_RE.test(t)` 改为 `OPTION_TEXT_RE.test(t) && ACTION_WORDS.indexOf(t) < 0`，避免文本通道也捞到页脚按钮。

### 测试
- `test/run.js` **32r** 段新增 4 条（共 13 条 + 1 性能），全部从真实入口 `handleDialog` 发起，且给 `Filler.clickOption` 加了 **spy 记录实参文本**：
  - **⑦ 关键回归（可证伪）**：混合组「2 选项 + 上一题 + 下一题」→ `texts` 只剩 2 个、不含导航词、**`clickOption` 实参不含「上一题/下一题」**；
  - **⑧ 跨父串组**：两个无关容器各 2 个同 tag 同 class 候选（各为其父第 0 子）→ `_symmetricOptions` 不得并成 4 项、`readOptions` 不得并成 4 项；
  - **⑨ 负例**：全操作词组「关闭/提交」→ 读到 0、`solve` 不被调用；
  - **⑩ 反向保护**：真题「确定 / 不正确」→ 仍读到 2 个（专防把 `.every` 改成 `.some` 的过度修复）。
  - **回退验证（硬要求）**：⑦⑧ 在 0.6.22 代码上**实测失败**（`382 通过 / 2 失败` 与后续 `378/4`），修复后通过（`382/0`）——证明测试能真正证伪、未绕开路由层。
- 全量回归 **382 通过 / 0 失败**；门禁 `node build.js` + `node tools/check-dist-fresh.js` + `node test/run.js` 全绿。凭据扫描 0 命中。

---

## [0.6.22] - 2026-09-19
> 第四轮探针挖出**第三轮才暴露的真 P1**：宽口径选项候选 `candidates` 由 `WIDE` class 白名单产出，只要选项是「纯 div/span/p + 自定义 class」（`.opt-item`/`.answer-item`/`.xx-option`/裸 `<p>`），`WIDE` 命中 **0** → 方案 A（文本正则）与方案 B（结构对称）**共用同一候选列表、同时空转** → 读不到选项 → `solve=0` → 又只乱猜。这正是用户报障「有的题目你没答」的真实成因。本版新增**方案 C：结构对称自动发现**，彻底摆脱对 class 白名单的依赖。

### 修复
- **【P1 阻塞·WIDE class 白名单漏掉自定义 class 选项，方案 A/B 双双空转】** —— `readOptions` 内两条宽口径通道都建立在 `candidates = scope.querySelectorAll(WIDE)` 之上，而 `WIDE = 'button,.btn,[role=button],.option,.option-item,.choice,.choice-item,.answer-option,.topic-item,.el-radio,.el-checkbox,label,li'`。实测：`<div class="opt-item">` / `<div class="xx-option">` / `<span class="answer-item">` / 裸 `<p>甲</p><p>乙</p>` 全部 `WIDE` 命中 **0** → 正则过滤无输入、结构对称无候选 → `texts=[]` → `solve=0`。**修法（方案 C）**：新增 `_autoSiblings(scope)`，**不依赖任何 class 白名单**，直接在 `scope` 子树里按「同父节点 + 同 tagName + 同 className + 子元素数量 2~4」自动发现兄弟选项组。接入通道优先级：标准读 → 方案 A 文本正则 → 方案 B 结构对称 → **方案 C 自动发现**，最后仍 `if (picked.length > els.length) els = picked`。三条通道互不干扰、逐级兜底。
  - **误报过滤（逐条实测）**：① 父节点**含直接文本节点** → 判为题干/标题容器排除（防负例「以下哪项不是 `<span>TCP</span> <span>UDP</span> <span>HTTP</span>` 的特点？」里 3 个 `.kw` span 顶掉真选项）；② 子元素**含嵌套块级元素**（`div/section/article/ul/ol/table/dl/form`）→ 排除题干容器；③ 文本集合 size < 2 → 排除布局重复；④ 全为操作词（关闭/确定/提交…）→ 排除页脚按钮组；⑤ 文本长度 > 200 → 排除整段题干。
  - **分组键用「tagName + className」而非只按 tag**：真实布局里选项常与题干容器**平级**（`<div class="q-title">题干</div><div class="xx-option">甲</div><div class="xx-option">乙</div>`），只按 tag 分组会让 `q-title` 混进来凑成 3 个不同 class 的 DIV、整组被否；按 tag+class 分组后两个 `.xx-option` 自成一组正确识别。
  - **性能红线**：`_autoSiblings` 每轮 `readOptions` 只对 `scope` 子树按 `children` 做**一趟**分组（O(节点数)），深度上限 `AUTO_MAX_DEPTH = 6` 层，不做全树两两比较。实测：50 个装饰节点弹窗下 `readOptions` 单次 **≈ 0.64ms**（×200 次平均），主循环 2s 一轮无压力。

### 测试
- 新增 `test/run.js` **32r**（**9 条**断言 + 1 条性能红线），全部从真实入口 `ZHS.Answerer.handleDialog` 发起（不直接调 `readOptions`，避免绕过路由层）：
  - ① `<div class="opt-item">×2` → 读到 2、`solve` 调用 1 次、答案 B 被点选；
  - ② `<span class="answer-item">×2` → 读到 2、`solve` 1 次；
  - ③ 裸 `<p>×2` → 读到 2、`solve` 1 次；
  - ⑥ 选项与题干平级（`.xx-option` 直接挂在 body 下）→ 读到 2、`solve` 1 次（锁死 tag+class 分组）；
  - ④ **负例**：题干内 `<span class="kw">TCP/UDP/HTTP</span>` ×3 + 真选项 ×2 → 仍读到 2 且不含 kw 关键词；
  - ⑤ **负例**：`<button>关闭</button><button>提交</button>` → 读到 0、`solve` 不被调用；
  - 性能：50 装饰节点下读到 2 个选项，单次 `readOptions` < 20ms（实测 0.64ms/次）。
- 全量回归 **371 通过 / 0 失败**；门禁 `node build.js` + `node tools/check-dist-fresh.js` + `node test/run.js` 全绿。凭据扫描 0 命中。

---

## [0.6.21] - 2026-09-19
> 第二轮对抗复核（ab-dialog-verify2）判定 0.6.20 **仍不能发布**：0.6.20 引入的宽口径选项正则只修好一半，`\s` 是**必需**的（不在 `?` 里），导致「纯 A/B」「长句选项」「中文序号选项」三种真实形态仍读不到选项 → `solve=0` → 依然只乱猜；另发现 `close()` 的全局兜底会点到弹窗外、32k 未覆盖真实路由层。本版逐条修复。

### 修复
- **【P1 阻塞·宽口径正则 `\s` 必需，三种真实形态仍读不到选项】** —— 0.6.20 的判定式 `^([abAB][.、,:：)]?\s|对$|错$|正确|错误|是$|否$|√|×)` 中 `\s` 落在可选组**之外**、是**必需**的：`A/B` 后面必须再有空白才匹配。实测 `"A"→false`、`"A."→false`、`"A、对"→false`（分隔符后直接接汉字）、`"选项一"→false`、`"智慧树可以倍速播放"→false` → `readOptions().texts=[]` → 路由到 `_tryNonStandardAB` → 入口条件 `optTexts.length >= 2` 为假 → `solve=0` → 仍只乱猜。**这正是用户最初抱怨的「没在读题、没在答题，只是乱点」。** **修法（方案 A+B 同时上）**：
  - **方案 A（放宽正则）**：改写为四分支 `OPTION_TEXT_RE = /^(?:[abAB][.、,:：)）]?\s*$ | [abAB](?![\p{L}])[.、,:：)）]\s*\S | [abAB](?![\p{L}])[.、,:：)）]?[^\p{L}\p{N}]\s*(?![A-Za-z])\S | 对$|错$|正确|错误|是$|否$|√|×)/u`。① 允许「纯 A/B」带分隔符与尾空白（`\s*$`，`\s` 不再必需）；②「A/B + 分隔符 + 内容」；③「A/B + 空白/标点 + 非拉丁字母内容」，用 `(?![\p{L}])` 与 `(?![A-Za-z])` 两道前瞻排除 `Apple`/`A组`/`A group` 这类英文词/词头误报；④ 保留对/错/正确/错误/是/否/√/× 判断题关键字。
  - **方案 B（结构对称白名单）**：新增 `_symmetricOptions(candidates)`——同一父节点下、同 `tagName`、同 `className`、数量恰为 2~4 的一组元素即视为选项组，专兜「选项一/选项二」这类既无 A/B 前缀、也无对错关键字的长句选项。**只在方案 A 颗粒无收（<2）时才启用**，避免与文本通道打架；排除「整组都是 关闭/确定/提交… 操作词」和「整组文本全相同」两种情况，防止把页脚按钮组当选项。
  - 两条通道都在 `readOptions` 内，标准通道读不足 2 个时才启用；`readCurrent` 复用 `readOptions`，因此修正后**三种形态均回归标准链**，`_tryNonStandardAB` 退回为真正的**最后兜底**（不再被常规形态触发）。
- **【P2·`close()` 全局越界兜底会点到弹窗外同名控件】** —— `close()` 的候选选择器循环末尾有一句 `btn = document.querySelector(sel)`，当弹窗内没有 `.el-dialog__close` 而页面别处有时，会**跨出弹窗**点到外部元素（实测外部元素被点 1 次）→ 误关/误点其他弹窗或页面控件。**修法**：该兜底**仅在 `r === document` 时执行**；当 `r` 是弹窗元素时，改为 `r.closest('.el-dialog__wrapper')` 限定在**本弹窗的 wrapper 内**查找，绝不跨出。
- **【P3·32k 测试绕过真实路由层】** —— 32k 直接调用 `_tryNonStandardAB`，未覆盖 `handleDialog` 的路由；路由层若再退化不会被这 7 条断言发现。**修法**：新增 32p，从**真实入口 `handleDialog`** 发起，覆盖「纯 A/B」「选项一/选项二」「长句选项」三种形态，每条都断言 **`Solver.solve` 被调用 ≥1**、答案元素被点击选中、弹窗确实关闭，并**记录实际路由**（`readCurrent().options.length >= 2` → 标准链 / 否则 → `_tryNonStandardAB`），把路由事实锁进测试而非假设。

### 测试
- 新增 `test/run.js` **32p**（handleDialog 入口 · 三种难形态 · 共 9 条）与 **32q**（正则边界逐串 · 共 9 条）两段断言。
  - **32p**：三种形态 `solveCalls >= 1`、答案 B 被点选、选对后关闭、实际路由 = 标准链（因 `readOptions` 喂给 `readCurrent`）。
  - **32q**：直接断言生产正则本身（经只读暴露 `Dialog._optionTextRe()`，**不经过**方案B 对称通道，否则 `Apple` 会被对称通道捡回来、正则漏报就测不出）。**必须命中**：`"A"`、`"A."`、`"A.对"`、`"A、对"`、`"A 说法"`、`"A. 说法"`；**必须不命中**：`"Apple"`、`"A组"`、`"AB"`。这 9 条专门盯死「将来手滑把 `\s` 改回必需」。
- 全量回归 **358 通过 / 0 失败**；门禁 `node build.js` + `node tools/check-dist-fresh.js` + `node test/run.js` 全绿。凭据扫描 0 命中。

---

## [0.6.20] - 2026-09-19
> 收口 0.6.19 的验证问题：独立对抗性复核（ab-dialog-verify）用 jsdom 实测判定**不能发布**，挖出 1 条 P1 阻塞 + 3 条 P2 + 2 条 P3。核心结论是「弹窗能识别了，但**依然不读题**」——用户核心诉求「能答就答对再关」并未真正实现。本版逐条修复。

### 修复
- **【P1 阻塞·`_tryNonStandardAB` 第一段是不可达死代码，真求解从未执行】** —— 进入该函数的条件是 `readCurrent().options.length === 0`（`13-answerer.js` 非标准判定），而第一段作答入口条件却是 `options.length >= 2`，**两者互斥** → 第一段永不执行。验证员实测：直接调用该函数，`ZHS.Solver.solve` 调用次数 = **0**，只有乱点 2 次。即用户要的「能检测出题目、答出来再关」在该链路上**完全没实现**，只能靠猜。**根因**是把「标准选择器读不到选项」错当成「这题没有选项」——按钮式/div 式 A/B 题（选项是 `button`，没有 `.el-radio`）标准选择器读不到，但它确实有选项、确实可作答。
  **修法**：在 `08-questions.js` 新增对外入口 `Dialog.readOptions(root)`，返回 `{ elements, texts }`，**独立于 `readCurrent().options` 是否为空**：先复用标准通道，读不足 2 个时再走「宽口径选择器（`button/.btn/[role=button]/.option/.choice/label/li` 等，限定在 `.el-dialog__body` 内并用 A/B 文本前缀过滤）」。`_tryNonStandardAB` 第一段改为：用 `readOptions` 独立取选项元素与文本，**入口条件改为 `title && optTexts.length >= 2`**（与「进入本函数的原因」自洽），点击元素用自己读出的 `optEls`（不再用 `q.elementList`，因后者与 `options` 同源、必然为空），并加索引越界守卫。题干新增兜底链：标准题面 → `.el-dialog__title` → `.el-dialog__body` 文本。
- **【P2·`root()`/`present()` 只取第一个 `.el-dialog`，多弹窗并存拿错容器、与守卫判据错位】** —— 真实页面里设置窗/公告/提示弹窗同样用 `.el-dialog`，谁排在前面谁被选中：拿到设置窗 → 题干读成「设置」；更糟的是 `present()` 返回 false 而调度器守卫（全量扫描 `hasStructurallyVisible`）返回 true → **两侧判据错位**，误报「请手动选 A 或 B」并暂停视频空跑。**修法**：`root()` 改为遍历全部候选，按「题目特征分」排序取最高（同时有题干+选项=3 > 只有选项=2 > 只有题干=1），全为 0（纯公告/设置窗）则返回 null；`present()` 改为「存在任一『像题的』可见弹窗即为 true」，与守卫判据对齐。
- **【P2·题干回退 `.el-dialog__title` 导致签名撞车，「只有第一题会答」复发】** —— 无标准题面的弹窗题干回退成「课中答题」这类固定文案 → 同课多道题签名全相同 → 第二道起被 `sig === _answeredSig` 误判「已作答跳过」。**修法**：`handleDialog` 算签名时叠加选项文本 —— `JSON.stringify(snapshot.map(s => (s.title||'') + '|' + (s.options||[]).join(',')))`。选此方案而非「不把弹窗标题当题干」，是因为题干本身对题库/LLM 匹配仍有价值（`title` 参与求解），不该为了签名而牺牲它；而「题干+选项」才是题的真实指纹，选项文本足以区分同标题下的不同题。
- **【P2·`.el-dialog__wrapper{display:none}` 判为「仍在」】** —— Element UI 关闭弹窗的真实形态之一是把隐藏加在 **wrapper** 上（而非 `.el-dialog` 自身），而 `isStructurallyVisible` 只查计算样式、在 jsdom 下拿不到，`stillPresent()` 误判 true → 误报「弹窗关不掉」、`_failCount` 递增、误转人工告警。**修法**：新增 `hasInlineHidden(el)`，只查 **inline `style` 属性**并**遍历整条祖先链**（`display === 'none' || visibility === 'hidden'`），`root()`/`present()` 统一经 `visibleForDialog()` 过滤。刻意**不调 `getComputedStyle`**：jsdom 无布局引擎，会给出错误答案，而平台真实关闭往往就是写 inline style。
- **【P3·`_textHost` 取到「存在但为空」的 `.el-radio__label`，选项被合并成 1 个】** —— 文字放在 `__label` 外的兄弟节点时，`querySelector(...) || el` 会因为节点存在而选中它 → 选项文本全空 → 被文本去重合并成 `[""]`。**修法**：取到 `__label` 后**校验文本非空**，为空则退回整个元素。
- **【P3·标准路径仍用裸 `flex.click()`】** —— `_solveCurrentPage` 的 `flex.click()` 对标准 `.topic-item` 够用，但对 Element UI 的 `.el-radio`（外层 label 拦住点击、真正生效的是内层 `.el-radio__input`）常常点不上，且元素已被选中时裸点击会把它**取消**（无防取消保护）。**修法**：改走 `ZHS.Filler.clickOption(flex)`，与 A/B 兜底路径统一（内含已选中防取消 → 点内层 `__input` → `input.checked` 兜底 → 重试）。同时把 `(clicked || isChecked) && isChecked` 的判据显式改为「只认 `isChecked`，`clicked` 仅用于日志」——该表达式在布尔代数上**等价于 `isChecked`**，`clicked` 被完全短路，写成原样会让读者误以为它参与判定。
- **【验证期新发现·`close()` 点到「包住按钮的容器」而非按钮，导致弹窗关不掉】** —— 修 P1 后写端到端测试时实测暴露：兜底关闭逻辑按「文本匹配 + 最长/最短排序」选元素，而 `.el-dialog__footer`（DIV）与它内部的 `<button>关闭</button>` 文本**同为"关闭"**、长度并列（都是 2）→ DIV 排在前面被选中 → 点击落在**容器**上（不冒泡到按钮的 click 处理器）→ 弹窗永远关不掉、误报转人工。另实测 `innerText` 在 jsdom 恒为 `undefined`，旧排序用 `(a.innerText||'').length` 把所有候选算成长度 0 → 排序随机化。**修法**：文本读取统一走 `innerText ?? textContent`；过滤后优先取**真控件**（`button`/`a`），并**剔除「包住了其他候选」的外层容器**（`el.contains(other)`），只留最内层元素。

### 测试
- 新增 `test/run.js` 32k～32o 五段共 **23 条**断言，其中 32k 直击本轮 P1：
  ① **32k「按钮式 A/B 弹窗真求解可达」**——构造选项为 `<button>`（无 `.el-radio`）的弹窗，断言 `readOptions` 能独立读出 2 个选项、**`Solver.solve` 被实际调用 ≥1 次**（上轮此处为 0，正是 316/0 全绿却功能未实现的盲区）、答案 B 被按索引正确点击且自检通过（`answeredCount +1`）、选对后弹窗真的被关闭；
  ② **32l** 多 `.el-dialog` 并存（设置窗排在前面）时 `root()` 选中含题目特征的题窗、`readCurrent()` 读到的是题面而非「设置」；
  ③ **32m** 题干相同、选项不同的两份弹窗签名必须不同，且签名包含选项文本；
  ④ **32n** wrapper 打 inline `display:none` / `visibility:hidden` 后 `present()`、`stillPresent()` 为 false、`root()` 返回 null；
  ⑤ **32o** `.el-radio__label` 存在但为空时不产生 `[""]`、选项数仍为 2。
  全量回归 **339 通过 / 0 失败**；门禁 `build` + `check-dist-fresh` + `test/run.js` 全绿。

---

## [0.6.19] - 2026-09-19
> 课中弹题专项修复：Element UI 的「选对才能关」A/B 简单答题此前**整条链路完全不可达**（脚本只是乱点）。对症用户原话「猜两次可以，问题是脚本没有在答这种题——它只是乱点；如果你能检测出题目、能答出来，那就答对再关」。

### 修复
- **【核心·弹题容器选择器漏掉 Element UI 弹窗，导致答题链路不可达】** —— `src/08-questions.js` 的 `DialogQuestions.root()` 与 `src/05-scheduler.js` 的守卫 2 选择器都只认 `#playTopic-dialog, [class*="topic-dialog"]`，而这类弹窗渲染成 `.el-dialog__wrapper .el-dialog`（class 里不含 `topic-dialog` 子串）→ `root()` 返回 null、`present()` 恒 false → 主循环守卫 2 进不去 → `handleDialog` 不被调用 → 答题器、A/B 兜底逻辑全部**不可达**。现选择器扩为 `#playTopic-dialog, [class*="topic-dialog"], .el-dialog__wrapper .el-dialog`；并抽成共享常量 `ZHS.Const.QUESTION_SELECTORS`（定义于 `src/01-util.js`），`src/05-scheduler.js` 与 `src/08-questions.js` 同源取值 + 字面量兜底，彻底根治「两份选择器不同步 → 一边认为是弹题、另一边找不到容器」的错位（历史事故就是漏同步造成的）。不用 `:not([style*="display:none"])` 这类伪类过滤，沿用现有的 `U.isStructurallyVisible()` 做可见性判定，避免个别环境查询伪类抛异常。
- **【核心·present() 认不出 Element UI 弹窗】** —— `present()` 原先只找 `.topic-item, .topic-title, ul li`，Element UI 结构的 A/B 弹窗一个都不匹配 → 即使 `root()` 命中也会判「没有弹题」。现追加 `.el-radio, .el-checkbox, .el-dialog__body, .el-dialog__title`。仍要求「容器内确实有可作答内容」而不是「容器存在即算」，避免把页面共用的 `.el-dialog`（公告/提示条）误当弹题频繁暂停视频。
- **【核心·题干读不到 → 所有答题通道被拦】** —— 题干选择器原为 `.topic-title, .topic-content, .topic-question`，读不到 `.el-dialog__body` 里的题面 → `title=''` → `ZHS.Solver.solve` 的题库通道（`&& question` 判据）与 LLM 通道双双被拦，等于「有答案通道也用不上」。现优先读 `.el-dialog__body .question-topic / .topic-content`，保留原选择器兜底，最后以 `.el-dialog__title` 兜底（注意不用弹窗标题当题干，它只是线索）。
- **【核心·选项读重复导致点错位置】** —— 旧选择器 `... .el-radio, ... .radio > label` 会**同时命中同一个选项**（Element UI 的 `.el-radio` 外层就是 label）→ `querySelectorAll` 返回 `[A,B,A,B]` → `Bank.toIndexes` 按答案算出的索引点到错误项、甚至把已选中项点成取消。现改为「Element UI 专属优先（`div.el-dialog__body .el-radio/.el-checkbox`）+ 标准结构兜底」两段式，并新增 `_dedupeOptions()` 双重去重（包含关系 + 文本去重）；取文本时若存在 `.el-radio__label` 则优先取它，避免外层 label 夹带页脚噪声文本。
- **【核心·A/B 兜底逻辑是纯瞎点，改为「先真求解、再猜两次」】** —— `src/13-answerer.js` 的 `_tryNonStandardAB` 原先只扫文本前缀 → `Math.random()<0.5` → `pick.click()` → 试关，全文没有 `Solver.solve` / `Bank.toIndexes` / `Filler.isChecked`（用户原话「它只是乱点」）。现改为两段式：①**真作答**——`readCurrent` 读题干+选项 → `Solver.solve` → 按答案索引点击 → `Filler.isChecked` 自检选中态，自检通过才 `answeredCount++` 并关闭弹窗；②**兜底猜**——第一段任何一步失败（读不到题/求解返回 null/自检不过）都不 return、不硬关，落到随机猜，且最多 **2 轮**（先随机选一个试关，失败换另一个再试），对应「猜两次可以」。两轮都关不掉才放弃转人工。
- **【核心·裸 `li, label` 选择器命中弹窗页脚噪声】** —— 兜底路径的 `optSel` 原含裸 `li, label`，弹窗页脚/按钮条本身也是 li/label，`slice(0,2)` 会把它们当选项点掉（「只是乱点」的另一半来源）。现只保留 `.el-radio, .el-checkbox, [role="radio"], [role="option"], .option-item, .choice-item, .answer-option`。
- **【核心·Element UI 选项点外层 label 不生效】** —— 兜底点击从裸 `pick.click()` 改为 `ZHS.Filler.clickOption(pick)`：内置「点内层 `.el-radio__input` + `input.checked` 兜底 + 重试」三段式；为此在 `src/12-filler.js` 把 `clickOption` 暴露到 `ZHS.Filler`（原先仅模块内私有，导致答题器只能用裸 click）。真作答路径同样改用它。
- **【核心·去重签名读空导致「只有第一道弹题会答」】** —— 验证时实测发现的连带缺陷：`DialogQuestions.collect()` 的 `title` 被 `handleDialog` 拿去当**作答去重签名**（`JSON.stringify(snapshot.map(s => s.title))`），而 `collect()` 用的是旧的题干选择器 → 每道 `.el-dialog` 题都产出同一个空签名 `'[""]'` → 答完第一道后，**后续任意弹题都会被 `sig === _answeredSig` 判为「已作答完成」直接跳过**，用户侧表现就是「只有第一道题会答，后面的又不理了」。现 `collect()` 改为复用 `readCurrent()` 的读取逻辑（题干 + 选项 + elementList 同源），保证「签名读到的题面」与「真正作答时读到的题面」完全一致，并同步输出 `options` / `elementList`。
- **【健壮性·同一弹窗重复计入已答题数】** —— 标准链路（`_solveCurrentPage`）先答上并 +1，若因平台拒绝而关闭失败，会落到 A/B 兜底路径**再答一次又 +1**，同一个弹窗在总结报告里算两道题。现新增 `_countedSig`（本轮已计数的弹窗签名），同一签名只累加一次。
- **健壮性·弹题自动答题配置字段与调用点不一致（D 项）】** —— `handleDialog(opts)` 的守卫是 `if (!manual && !ZHS.config.autoAnswer) return`，但**调用方**（`src/05-scheduler.js` 守卫 2）在进入前已用 `ZHS.config.autoAnswer && cfg.answerDialog` 双重校验——即「弹题自动答」子开关只被调用方检查，`handleDialog` 自己没查。两者目前等价（都只在守卫 2 内被调用），但函数是 public API（面板「答题」按钮也可直接调用），一旦将来有第二处调用就会绕开子开关，在用户关掉「课中弹题自动答」的情况下悄悄答题。现改为 `if (!manual && (!ZHS.config.autoAnswer || !ZHS.config.answerDialog)) return`（与 `handleHomework` 的同款写法对齐），并把调度器的 `handleDialog()` 显式写成 `handleDialog({ manual: false })` 表明调用意图。语义说明：`autoAnswer` 是「AI 答题总开关」，`answerDialog` 是「课中弹题」子开关，二者都需为真。

### 测试
- 新增 `test/run.js` 32g / 32h / 32i / 32j 四段共 **23 条**断言：按 Element UI 真实 DOM（`label.el-radio > span.el-radio__input > input.el-radio__original` + `span.el-radio__label`）构造 `.el-dialog` A/B 弹窗，验证 ① `root()` 命中 `.el-dialog` 容器、`present()` 为真、`scene()` 返回 `'dialog'`、共享常量含 `.el-dialog`；② 从 `.el-dialog__body .question-topic` 读到题干、从 `.el-radio__label` 读到 A/B 两个选项且**不重复**、`elementList` 与 `options` 一一对应；③ 选项选择器重叠（`.el-radio` 与 `.radio > label` 同时命中同一项）时去重为 2 个；④ 作答去重签名可区分不同弹题（`collect()` 能读出 Element UI 题面、两道不同题的签名不同）；⑤ 弹题自动答题双开关守卫（子开关 false 不进入流程 / 总开关 false 不进入流程 / 两个都真进入流程 / `manual:true` 绕过开关）。全量回归 **316 通过 / 0 失败**；门禁 `build` + `check-dist-fresh` + `test/run.js` 全绿。
- 端到端行为验证（本地 jsdom 桩，未纳入单测）：模拟「只有选中正确项才能关闭」的平台规则，实测三条路径均符合预期——①正确答案来自题库 → 选中 A 自检通过 → 关闭成功 → `answeredCount=1`（不重复计数）；②无答题通道 → 兜底猜：第一次猜错、换第二个猜对关闭成功；③两次都猜错 → 转人工（`_pendingHuman=true` + 加入 `_giveUpSigs` + 面板提示手动选 A/B）。

---

## [0.6.18] - 2026-09-19
> round-16 第三轮对抗复核收口：针对 round-15 自身新引入的 3 个缺陷（P1/P2/P3）+ 1 个老限制（P4）做修复。对症「自愈之后反而更容易死 / 恢复一次就刷屏 / 平台不打 active 就判切换失败」。

### 修复
- **【核心·自愈后同目标首次失败即再停】** —— `src/05-scheduler.js` 的 `start({resume:true})` 分支保留了 `_navFailKey` / `_navFailCount`。后果：自愈前若正卡在某个切不动的目标上（`_navFailCount` 已累到 4），恢复后**第一次**尝试同一目标就凑满 `SAME_NAV_MAX=5` 再次停机 —— 60 秒冷却 × 3 次自愈名额耗尽后彻底死透，比不自愈还糟。现 resume 分支显式清零 `_navFailKey` / `_navFailCount`，给恢复后的第一次尝试一个干净起点。
- **【核心·累计失败残留导致恢复后秒停】** —— 同理，`_navFailTotal`（本轮累计失败上限 8）在 resume 时未清零：残留到 7 时恢复后失败 1 次即触发全局兜底硬停。现 resume 分支一并清零 `_navFailTotal`。
- **【体验·自愈恢复反复弹「开始自动学习」刷屏】** —— resume 走的还是完整 `preflight()`，每次自愈都重新弹一次体检确认面板，用户端表现为「脚本自己反复弹窗」。现 `preflight(opts)` 支持 `silent` 开关，`start({resume:true})` 时以 `{silent:true}` 调用，静默体检（只记日志、不弹面板），不给用户制造干扰。
- **【核心·平台不打 active 即判切换失败（P4 老限制）】** —— 智慧树部分课型/改版下，切换成功后目录条目不补 active 类，`clickAndVerify()` 的 `nowIsTarget()` 与 `_activeOnlyFallback()` 双双判否 → 白等 9 秒 + 重复点击 + 凑满 5 次硬停，而页面其实早就切过去了。现为 `src/02-adapter.js` 新增**第三独立信号**：`pageMark()` 采集「video 的 currentSrc/src + 播放器区标题文本」快照，`pageSwitched()` 比对切换前后的快照差异判定是否真的换了一节，并带「必须已离开原节」的保护（防止采样过早把「还没切」误判成「已切」）。轮询判据改为 `nowIsTarget() || _activeOnlyFallback() || pageSwitched()` 三路任一成立即判成功。

### 测试
- 补齐 `resume` 分支测试盲区：原 284 条断言**无一条**覆盖 `start({resume:true})` 路径（这正是 P1/P2 能溜过去的原因）。现于 `test/run.js` 31b 段追加两组共 9 项断言：⑧「自愈恢复必须清零止损闸门、同时保留成果计数器（完成节数/课时数/开始时间）」⑨「自愈恢复走静默体检、不弹确认面板」。全量回归 **293 通过 / 0 失败**；门禁 `build` + `check-dist-fresh` + `test/run.js` 全绿。

---

## [0.6.17] - 2026-09-19
> round-15 对抗性验证修复：针对 round-14 自身引入的 7 个缺陷（含 2 个回归）做收口。对症「设了停止条件停不住 / 统计少算 / 假成功从另一侧回流 / 切错同名节 / 无声空转」。

### 修复
- **【核心·自愈重启清零统计 · 停止条件失效】** —— `src/05-scheduler.js` 的 `tryResumeAfterTransientStop()` 调 `start({manual:true})`，而 `start()` 会无条件重置 `startedAt` / `_completedThisRun` / `_navCount`。后果：①「设了看 N 节就停」——瞬时故障自愈一次就把已完成计数清零，**永远凑不够阈值，停止条件形同虚设**（「设了停止条件停不住」直接复发）；②总结报告里的「总耗时 / 切换课时数」只统计自愈之后一段，明显少算。现给 `start(opts)` 加 `opts.resume` 语义：自愈恢复启动（`resume:true`）**保留**这三个字段，只有全新一轮启动才重置。
- **【核心·自愈名额永不重置】** —— `_transientReloads` 全仓库只增不减，用满 3 次后即便用户手动点「启动」也救不回来，第 4 次故障起永久失去自愈能力。现改为「全新一轮启动（含用户手动启动）」时重置 `_transientReloads = 0`。
- **【核心·假成功从另一侧回流】** —— `src/02-adapter.js` 的 `current()`（判定「当前播放的是哪一节」）原用 `document.querySelector(ad.active)` 全局查询。round-14 只收窄了 `hasActive()`，`current()` 未收窄，导致播放器控制条/顶部导航/其他 tab 里恰有带 active 且标题碰巧相同的元素时「当前项」判错 → `nowIsTarget()` / `_stillOnFrom()` 全部跟着错 → **假成功回流**（切错节判成功、完成计数虚增）。现 `current()` 同样收窄到 `ad.container` 目录容器内，并追加「命中的元素必须确实是目录条目之一」的强校验。
- **【核心·同名节误判切错】** —— `clickAndVerify()` 的 `nowIsTarget()` 原用纯标题文本比对。智慧树「习题讲解」「章节测验」这类同名节很常见：只要第一节是 current，目标即使是第二节也会判成「已切到」→ 切错节、计数虚增。现改为**基于目录索引的元素身份比对**（`curIdx === tgtIdx`），标题比对降级为索引取不到时的兜底。
- **【核心·第二信号退化失效】** —— `clickAndVerify()` 原判据 `hasActive(target) && !this._stillOnFrom(fromKey, titleKey)` 中，`_stillOnFrom` 在 `fromKey` 为空时**恒返回 false**，整条判据退化成「只要目标拿到 active 就算成功」→ 第二信号完全失效。现改为「基于索引的 `nowIsTarget()` 为真才算成功」，并新增 `_activeOnlyFallback()` 作为「目录索引完全不可用」时的严格兜底（须同时确认已离开原节）。
- **【体验·面板兜底掩盖真实错误】** —— round-14 的「先发布空对象占位」使 `ZHS.panel` 恒为 truthy，`src/07-main.js` 的 `if (ZHS.panel)` 会进 true 分支去调不存在的 `mount()`，抛 `TypeError`，把「面板模块加载中断」的真实原因掩盖成「mount is not a function」。现判据改为 `ZHS.panel && typeof ZHS.panel.mount === 'function'`，并在提示条中带上真实异常信息与 `__panel_ready` 状态。
- **【核心·无声空转】** —— `gotoNext()` 的 `_navFailCount` 原「同一目标才累加、目标一变就清零」，若目录里有多个坏节点轮流失败，计数永远凑不满 `SAME_NAV_MAX` → 既不停机也不前进的软死循环。现加双计数：同目标连续失败（快速止损）+ `_navFailTotal` 本轮累计失败（全局兜底，上限 8）。
- **【内部·死分类】** —— `stop()` 的 `'condition'` 分类原从未被任何调用点传入（只在 JSDoc 出现）。现将全看完跳课（`gotoNext`）与 `finishAll` 两处正当结束显式标为 `'condition'`，使分类名副其实。

### 测试
- 新增 9 项 round-15 断言（自愈不清零完成计数/课时数/开始时间、手动启动重置自愈名额、同名节不误判），全量回归 **284 通过 / 0 失败**；门禁 `build` + `check-dist-fresh` + `test/run.js` 全绿。

---

## [0.6.16] - 2026-09-19
> round-14 深度审查修复（三路并行审查合并）：停机原因分类与受限自愈 + 面板「先发布后初始化」+ 课时标识回滚 + 切换验收第二信号。对症「中途停了永远不动 / 面板都没有 / 进度记错节 / 假成功假失败」。

### 修复
- **【核心·停机后永远不动 · 中途卡死】** —— `src/05-scheduler.js` 的 `stop()` 原先只有一种姿势，把「用户主动停」「任务达标停」和「瞬时故障被迫停」混在同一个 `_halted` 标志里。三条瞬时故障停机路径（`:471` 目录临时读不到、`:490` 有未完成但节点临时定位不到、`:532` 连点同条目达上限）本属亚秒级抖动，却被当成任务结束永久封死；叠加上 `07-main.js` 的 `initialized=true` 与 `_halted=true` 双锁，视频恢复、页面正常后也永远不再动。现给 `stop(why)` 加原因分类：`'user'`（默认，签名不变）/`'condition'`/`'transient'`，只有 `transient` 不置 `_halted`；新增 `tryResumeAfterTransientStop()`，在「冷却 60s + 上限 3 次 + 视频就绪」三个条件同时满足时才走 `start({manual:true})` 自愈重启，并接入 `07-main.js` 的 `watchSpa` 自愈通道。用户主动停 / 达标停语义完全不变，绝不被偷偷拉起。
- **【核心·面板永久消失 · 装了跟没装一样】** —— `src/06-panel.js` 的重入守卫在第 10 行就置位 `__mod06_panel = true`，而 `ZHS.panel` 要到第 1366 行才赋值，中间隔着巨型 base64 图片与整段 CSS 模板。只要这 1350+ 行中任何一步抛异常（页面框架给 DOM API 打补丁、扩展干扰、模板取值异常），就形成「守卫已上锁 + `ZHS.panel` 永久 undefined」的不一致状态；SPA 二次注入又被守卫直接 return，面板永远无法自愈，而脚本却在后台照常跑。现改为**「先发布后初始化」**：守卫后立即 `if (!ZHS.panel) ZHS.panel = {}` 占位，末尾用 `Object.assign(ZHS.panel, Panel)` 填充完整实现并置 `__panel_ready`，保证 `ZHS.panel` 至少是可用对象。
- **【体验·面板不可用零提示】** —— `src/07-main.js` 原先在面板缺失/挂载失败时只写一行 `ZHS.Log.error`，而日志恰恰写进「面板自己的日志缓冲」，面板正是此刻看不见的那个东西，用户完全无感知。现新增 `showPanelMissingNotice()`：在页面根节点挂一条不依赖面板、不依赖 Shadow DOM 的固定定位红条，明确告知「脚本在后台运行但面板初始化失败，请刷新重试或执行 `zhs.boot()`」，点击可关闭。
- **【核心·进度记错节 · 静默跳课】** —— `src/05-scheduler.js` 的 `gotoNext()` 原先在点击**之前**就把 `state.lessonKey` 改成目标节，点击失败分支又不回滚（还照旧 `_rebindAfterNav`）。后果：`Resume.bindVideo` 用错键绑定 → 把下一节的进度记到原来那节的标题上；下一轮完成判定打错节点 → `findNext` 从错位置往后找 → 静默跳过整节课。这是唯一的「写错数据」级缺陷。现改为**点击成功后才写** `lessonKey`，失败分支显式回滚为 `_prevKey`。
- **【核心·切换验收假成功/假失败】** —— `src/02-adapter.js` 的 `clickAndVerify()` 原先唯一判据是「目标条目拿到 active 类」这一间接信号，双向误判：平台不打 active（改版/异步慢）→ 假失败（白等 9s、重复点、凑齐 5 次硬停）；页面别处恰有带 active 的容器（全局 `document.querySelector` 命中）→ 假成功（0 毫秒判过、完成计数虚增）。现补第二独立信号：新增 `_stillOnFrom()` 交叉校验「当前播放项是否仍停在切换前那一节」，并要求「当前项标题确实等于目标标题」才算成功；同时把 `hasActive()` 里的 `ad.active` 查询从整个 `document` 收窄到 `ad.container` 目录容器内，消除全局误命中。
- **【体验·失败分支阻塞过久】** —— `src/05-scheduler.js` 的 `_rebindAfterNav()` 加可选超时参数；跳集失败分支由默认 20 秒改为 5 秒，避免 20s > 15s 冷却闸门导致闸门失效、BUG-PB-4（12 秒跳一节）复发，以及主线程被 `_busy` 独占近 29 秒期间弹题守卫/保活全停摆。

### 测试
- 新增 16 项 round-14 断言（瞬时故障自愈的成功/冷却期/超限/视频缺失/达标停五类路径，以及用户主动停不可被自愈拉起的安全边界），全量回归 **275 通过 / 0 失败**；门禁 `build` + `check-dist-fresh` + `test/run.js` 全绿。

---

## [0.6.15] - 2026-09-19
> round-13 审查修复：非标准 A/B 简单答题弹窗（如 .el-dialog 容器）的识别与随机选 A/B 兜底，杜绝反复关不掉刷屏卡死。

### 修复
- **【核心·非标准 A/B 答题弹窗关不掉刷屏】** —— 用户日志暴露：`.el-dialog` 容器承载的「选对才能关」简单 A/B 答题，标准题面/选项选择器（`src/08-questions.js` 的 `readCurrent`）识别不到，脚本误判为「无通道」并反复点 `.el-dialog__close` 三次全失败、刷屏卡死。现于 `src/13-answerer.js` 的 `_answerDialog` 开头新增非标准判定（识别到 `readCurrent` 返回空 options 即视为非标准弹窗），转 `_tryNonStandardAB`：在弹窗内按 A/B 文本或通用选项结构随机选一个点击一次 → 尝试关闭；选对即关掉恢复播放，选错（需选对才能关）或结构不符关不掉 → 本题加入 `_giveUpSigs` 放弃集合（后续轮次 `handleDialog` 直接跳过、不再刷屏），并面板提示「这是选对才能关的简单 A/B 题，自动没猜对，请手动选 A 或 B」。同时 `reset()` 与弹窗消失分支会清空 `_giveUpSigs`，保证下一题正常处理。

### 测试
- 既有回归（259 项）全绿；本轮改动集中在非标准弹窗识别与随机选 A/B 兜底，门禁以 `check-dist-fresh` + 全量 `test/run.js` 验证 dist 与 src 同步、核心逻辑无回归。

---

## [0.6.14] - 2026-09-19
> round-12 审查修复：getCourseId 兜底链（对症「断点串台 / 自动跳课去重失效」）。

### 修复
- **【核心·课程 id 取空 · 断点串台 / 去重失效】** —— `src/02-adapter.js` 的 `getCourseId()` 在 hash 路由只带 `recruitAndCourseId`、不带 `courseId` 参数时，原正则 `courseId[=\/](\w+)` 匹配不到、恒返回字面量 `'unknown-course'`。后果：断点续播 key 串台、课程中心自动跳课去重键退化失效。现加兜底链：URL 全空时优先用课程中心进入时记录的真实课程 id（`ZHS.state.hubKey`），再退读 DOM 上的 `[data-course-id]`，仍取空才回退 `'unknown-course'`；原 URL 解析路径优先级不变，零回归。

### 测试
- 既有回归（259 项）全绿；本轮仅扩展 getCourseId 兜底分支，门禁以 `check-dist-fresh` + 全量 `test/run.js` 验证 dist 与 src 同步、核心逻辑无回归。

---

## [0.6.13] - 2026-09-19
> round-11 审查修复：弹题容器选择器兜底（对症「自动答题没用」）+ 切集后 boot 名额重置（对症「装了没反应」）+ 完成判定阈值统一。

### 修复
- **【核心·弹题识别漏判 · 容器硬编码】** —— `src/08-questions.js` 的 `DialogQuestions.root()` 与 `src/05-scheduler.js` 的 `QUESTION_SELECTORS` 原只认 `#playTopic-dialog`，新版/AI 课程页若改用 `class="playTopic-dialog"` 或类名含 `topic-dialog` 的弹窗容器，会导致「自动答题没用 / 点了答题没反应」且无任何报错。现增加 `[class*="topic-dialog"]` 候选（原 id 选择器仍优先，零回归），恢复弹题识别。
- **【核心·切集后脚本失活 · boot 名额耗尽】** —— `src/07-main.js` 的 `watchSpa` 在 SPA 切集、视频元素被替换后只重绑视频不重置 `bootTries`；初始加载期间多次 DOM 突变可能把 3 次 boot 名额耗在「还没就绪」的瞬态，之后即便视频出现也因名额耗尽永久不启动（表现「装了没反应」）。现视频重新出现时重置 `bootTries = 0`，确保可重新 boot。
- **【体验·完成判定阈值统一】** —— `src/05-scheduler.js` 的 `onLessonEnd` 轮询跳出阈值原为 `>=90`、跳转阈值原为 `>=95`，两值不一致；统一为 `>=95`，避免「进度刚过 90 就草率判定完成跳集」与跳转逻辑错位。

### 测试
- 既有回归（259 项）全绿；本轮改动集中在弹题识别选择器与切集自愈，门禁以 `check-dist-fresh` + 全量 `test/run.js` 验证 dist 与 src 同步、核心逻辑无回归。

---

## [0.6.12] - 2026-09-19
> round-10 审查修复：弹题「无法自检/无通道」路径节流，避免反复重作答刷屏。

### 修复
- **【核心·弹题反复重作答刷屏】** —— `src/13-answerer.js` 的 `_answerDialog` 当某题被判定「点击未生效/环境无法自检」（`_noSelfCheck`）或「无答题通道」（`_noChannelThisRound`）后，原每轮主循环回来都重新走 `ZHS.Solver.solve` 重作答刷屏、且关闭失败反复重试。现新增 `_noSelfCheckSig/_noSelfCheckUntil` 字段：在两条「无法自检/无通道 → 尝试关闭恢复」分支记录本题签名与 30s 节流截止；下一轮 `_answerDialog` 开头若命中该签名且未过节流期，直接尝试关闭恢复并 `return`，跳过 `ZHS.Solver.solve` 重复重作答；节流到期后再恢复重试，既不卡死也不刷屏。

### 测试
- 既有回归（259 项）全绿；本轮改动集中在弹题关闭逻辑，门禁以 `check-dist-fresh` + 全量 `test/run.js` 验证 dist 与 src 同步、核心逻辑无回归。

---

## [0.6.11] - 2026-09-19
> round-9 审查修复：多页弹题去重（全部页答上才算完成，避免剩余页被永久跳过）。

### 修复
- **【核心·多页弹题去重失效】** —— `src/13-answerer.js` 的 `_answerDialog` 原多页循环用 `anyAnswered = anyAnswered || pageAnswered`（任一页答上即整体完成），导致「某一页答上就被标记 `_answeredSig` 去重关闭、其余未答页永久不答」。现改为追踪 `allAnswered`（全部页都答上才算完整完成）：多页仅部分页答上时，不标记 `_answeredSig` 且不整体关闭，下一轮主循环回来继续补答剩余页；无通道/无法自检场景尝试关闭已答页并恢复播放，有通道但部分页点不上则转人工保留弹窗补全。

### 测试
- 既有回归（259 项）全绿；本轮改动集中在多页弹题关闭逻辑，门禁以 `check-dist-fresh` + 全量 `test/run.js` 验证 dist 与 src 同步、核心逻辑无回归。

---

## [0.6.10] - 2026-09-19
> round-8 审查修复：课程中心去重键同源 + 进入看门狗 + 选择器兜底 + 页面判定鲁棒；弹题退避复位 + 面板异常捕获与自愈清状态。

### 修复
- **【核心·课程中心去重失效 · 读写键不同源】** —— `src/06b-course-hub.js` 的 `markCourseDone/markCourseFailed` 原先用 `courseId`（URL path 段）写去重键，而 `pickNext` 读侧用 `cardIdentity`（卡片 DOM 业务 id）或课程名，两者不同源导致「已完成课程仍被反复选入」的去重失效。现改为「写入优先用 `ZHS.state.hubKey`（进入时记录的卡片标识，与读取键同源），回退 path 段」，并在 `settleIntentOnStudentPage` 把进入时记录的卡片标识落到 `state.hubKey`。
- **【核心·课程中心卡死 · 进入看门狗】** —— `enterCourse` 点击后只 `return true`，若新标签因被拦截等原因没起来，该课既不被学也不被记失败，永久卡在待学。现点击成功后写 `pendingHop` 待确认记录，`settleIntentOnStudentPage` 落地时标记 settled，`runOnHub` 开头清理「超过 5 分钟未 settled」的 pendingHop 并 `markCourseFailed`，解除卡死。
- **【体验·课程卡片选择器兜底】** —— `findScroller/collectInto/waitForCards` 原先硬编码 `.ai-course-center-body` / `.course-card`，平台改类名即收 0 张。现改为依次尝试「原选择器 → `[class*="course-center"]` → `[class*="course-card"]`/`[class*="courseCard"]`」的兜底数组，原路径仍优先、零回归。
- **【体验·课程中心页判定鲁棒】** —— `isHubPage` 原先只匹配 `pathname`，query/hash 路由或大小写变化会漏判。现对 `pathname/search/hash` 统一小写后匹配 `ai-course-center`。
- **【核心·弹题退避卡死新题】** —— `src/13-answerer.js` 的 `handleDialog` 在弹窗消失时只复位 `_pendingHuman`，未清 `_cooldownUntil`。有通道弹窗转人工退避 30s 后，用户手动作答关窗、平台又弹新题，主循环因退避期直接跳过新题不答。现弹窗消失即 `_cooldownUntil = 0`，新题正常进入作答。
- **【体验·面板测试按钮异常捕获】** —— `src/06-panel.js` 的「测试连接」按钮 `ZHS.LLM.test()` 抛错时无 try/catch，会成未捕获 Promise 拒绝且文案卡在「测试中…」。`btnTest` 改为包 try/catch，异常时显示「连接异常」并恢复，仅告警不卡死。
- **【体验·按钮 loading 异常捕获】** —— `withLoading` 原只 `try{await fn()}finally{...}` 无 catch，`btn-next/btn-answer` 内 reject 会冒泡成未捕获拒绝。现加 `catch` 仅告警，按钮仍正常复原。
- **【体验·面板自愈清全屏状态】** —— `refresh` 面板被移除后重挂时未清全屏状态机（`_fsState/_fsTimer/_fsFailedNotice/_fsBoundDocs`），重挂后全屏逻辑以旧状态运行、失效 document 累积。现重挂前复位这些字段，避免误导降级提示。
- **【清理·删除死字段】** —— 移除 `src/13-answerer.js` 全程只写不读的 `_lastDialogSig`，减少误导维护者的状态噪音。

### 测试
- 既有回归（259 项）全绿；本轮改动集中在课程中心去重/选择器、弹题退避复位、面板异常捕获，门禁以 `check-dist-fresh` + 全量 `test/run.js` 验证 dist 与 src 同步、核心逻辑无回归。

---

## [0.6.9] - 2026-09-19
> round-7 审查修复：polymas 课程断点串台/去重失效 + 课程中心 98~99% 死循环 + 面板挂不上整脚本不跑 + 面板被移除后静默消失。

### 修复
- **【核心·断点串台 / 去重失效 · getCourseId 不解析路径】** —— `src/02-adapter.js` 的 `getCourseId()` 原先只从 URL 查询参数（`recruitAndCourseId`/`courseId`/`recruitId`）和 hash 里取课程号，遇到 polymas 学习页路径 `/AIstudent/{cid}/{clid}` 时恒返回 `unknown-course`。这同时拖垮两处：① `src/04-resume.js` 断点续播用 courseId 当 key，串到别的课；② 课程中心 done/failed 去重键（基于 courseId）永远相同，去重失效。现改为**路径解析优先**：先匹配 `/AIstudent/{cid}/`，命中即用，再回退到查询参数，彻底修复 polymas 课程的断点与去重。
- **【核心·课程中心↔98~99% 课程死循环】** —— `src/06b-course-hub.js` 的 `parseCard` 完成阈值原先是 `percent >= 100`，而目录侧的已完成判定 `FINISH_PCT = 98`。两者不一致导致进度停在 98~99% 的课程：目录认为「没看完」于是反复重新进入，中心页又认为「已完成」跳过，形成无限循环。现把 `parseCard` 阈值对齐为 `percent >= 98`，与目录判定同源。
- **【体验·面板挂不上 → 整脚本不跑】** —— `src/07-main.js` 第 3 步面板二次挂载原先裸调用 `ZHS.panel.mount()`，一旦抛错会中断后续初始化，表现为「面板都没有、装了没反应」。现包 `try/catch`，挂载失败仅告警不影响主流程，其余自动化照常运行。
- **【体验·面板被移除后静默消失】** —— `src/06-panel.js` 的 `refresh()` 原先不感知面板节点已被平台 DOM 变动移除，导致面板永久消失且无自愈。现增加自愈：检测到 `_root` 已脱离 `document` 时自动清理并重新 `mount()`，保证面板长期在屏。

### 测试
- 既有回归（259 项）全绿；本轮修复集中在适配层与课程中心路径分支，门禁以 `check-dist-fresh` + 全量 `test/run.js` 验证 dist 与 src 同步、核心逻辑无回归。

---

## [0.6.8] - 2026-09-19
> round-6 审查修复：断点续播进度记错旧课 + 自动答题 iframe/Element UI 选不中。

### 修复
- **【核心·进度记错旧课 · SPA 复用 video 节点】** —— `src/04-resume.js` 的 `bindVideo` 原守卫只看 `video` 元素身份，SPA 复用同一 `<video>` 节点切课/切节时，闭包里的 `courseId`/`lessonKey` 永不被刷新，进度被静默记到旧课/旧节（「跳错节/进度记错」根因）。现改为「video + 课程 + 课时」三重判定：任一变化即强制解绑重绑，保证进度记到当前课；并在切课/切节时清零 `_lastDuration`，避免旧课时长比例套到新课算出错误恢复位置。
- **【核心·自动答题选不中 · iframe 弹题漏识别】** —— `src/08-questions.js` 的 `root()` 原只在主文档外壳不可见时才降级到 iframe，导致 iframe 内真实弹题永远读不到选项。现优先识别 iframe 变体（`.answerOption/.el-radio/.el-checkbox` 等结构），主文档空壳不再误判；`readCurrent` 选项选择器扩展覆盖 `.answerOption label`、Element UI 的 `.el-radio/.el-checkbox`，并回填 `node` 字段供填空题在弹题容器内定位输入框（不再退化到整页 `document` 抓错框）。
- **【核心·课中弹题点击绕过已验证逻辑】** —— `src/13-answerer.js` 课中弹题原用裸 `flex.click()`，Element UI 下外层 label 点击可能被拦截、且反复点击会取消已选项。现统一复用已打磨的 `Filler.clickOption`（自带「已选中跳过防取消」+ 内层点击/改 input 兜底）；`autoCloseDialog=false` 分支补 `_answeredSig`，避免下一轮反复取消已选项。
- **【体验·关闭按钮选择器】** —— `src/08-questions.js` 的 `close()` 候选选择器去掉 `#playTopic-dialog` 前缀（iframe 内无此后代），并补充 `.popbtn_cancel` 等，提升跨版本关闭命中率。

### 测试
- 新增 `test/run.js` 回归：bindVideo 强制重绑（32d，验证 SPA 复用节点切课后进度记到新课程）、弹题选项选择器覆盖（32e，验证 `.answerOption`/`.el-radio` 提取与 `node` 回填）；全量 259 项通过。

---

## [0.6.7] - 2026-09-19
> round-5 审查修复：补虚拟滚动目录漏读、SPA 切课状态残留、面板首跑确认提示。

### 修复
- **【核心·不能跳转下一集 · 虚拟滚动漏读】** —— `src/02-adapter.js` 的 `findNext`/`breakdown` 此前只基于「已渲染 DOM 快照」查找。智慧树部分课程目录是虚拟滚动，未滚动到的课时根本不在 DOM 里，导致 `findNext` 永远找不到后面的未完成节（表现即「点了下一节也没用 / 不能自动跳下一集」）。现在新增 `ensureCatalogLoaded()`：对可滚动容器反复滚到底部触发平台分批懒加载，直到条目数不再增长；`findNext` 第一轮找不到时自动触发补全再找一次。`breakdown`/`stats` 也走补全，避免漏算未完成节而误判「全部看完」。
- **【核心·SPA 切课状态残留】** —— `src/07-main.js` 的 `watchSpa()` 原本只检测 `video` 元素变化，不检测课程切换。SPA 内不刷新页面直接换课时，`courseId`/`lessonKey` 残留旧值，导致 `gotoNext` 跳错节、进度记到别的课。现在在自愈通道里检测 `courseId` 变化，切课时调用 `Catalog.resetCatalogCache()` 重置目录缓存与断点上下文，并同步当前课时标识。
- **【体验·面板首跑可见性】** —— 初始化成功后新增「智慧树助手已就绪，开始自动学习」明确提示，让用户一眼确认脚本已装上并在干活（回应「装了但面板都没有」的疑虑）。

### 测试
- 新增 `test/run.js` 虚拟滚动补全（32b）与安全降级（32c）两组回归：验证懒加载触发后 `findNext` 能定位到原本不在 DOM 的后续节，且无布局环境下 `ensureCatalogLoaded` 不抛错、安全降级。

---

## [0.6.2] - 2026-09-18

> 真机反馈修复版：解决「看完不自动跳下一集（重播）」与「自动答题卡死」两个核心痛点。

### 修复
- **【核心·看完不跳节/重播】** —— `src/05-scheduler.js` 的 `onLessonEnd` 此前把「视频进度条 1~99%」当作主信号，
  而真实完成信号是**平台在章节列表（右侧栏）打的完成标记（对勾）**。当对勾已打但进度条停在 99% 时，
  走进 `retryFromPlatformProgress` 回退重播，变成「看完重看一遍」。
  现在以 `Catalog.isFinished`（右侧栏对勾/已完成图标/「已学完」文字）为**金标准**：有完成记录立即跳下一节；
  进度 ≥95% 跳；≤0 跳；**仅进度明显 <90% 且右侧栏无完成标记时才重播兜底**（最多 2 次），其余一律跳节，绝不默认重播。
  同时用「本轮播放的课时标题」找回当前节 DOM，不再依赖 `.current` 类（视频放完后该类可能被平台转移到下一节）。
  `END_SETTLE_MS` 由 3s 延长到 8s，给平台打勾+上报进度留足时间。
- **【核心·适配器选错】** —— 侦察报告 VERSION_MAP 把 `studyvideoh5` 归 `legacy`，但 `src/02-adapter.js` 的
  `candidates()` 却优先 `wisdom`，导致 studyvideoh5 可能选错适配器、完成标记/当前项定位失效。
  现在 `studyvideoh5` 优先 `legacy`，wisdom 兜底。
- **【核心·完成标记识别薄弱】** —— `isFinished` 原来只认精确类（如 `.child-check`），右侧栏对勾一旦类名有出入就识别失败。
  现在增加**通用完成标记兜底**：`[class*="finish"|"done"|"complete"|"learned"|"studied"|"checkmark"|"is-finish"]`
  + 文字兜底（已完成/已学完/已学习/学完/已看完/100%）+ 进度 100%。
- **【核心·自动答题卡死】** —— 未配置答题通道（LLM Key/题库）时，弹题答不上 → 旧逻辑转人工 `_pendingHuman` →
  主循环永久暂停等用户，违背「不要停住」。现在无通道时**不转人工卡死**：尝试关闭弹窗并恢复播放，
  下一轮主循环继续重试关闭，用签名节流告警（每 30s 一次）避免刷屏。仅「有通道但选项点不上」才转人工。
  顺手修了 `_noChannelThisRound/_noSelfCheck` 从不重置的隐患（上一题状态污染本题）。

### 测试
- 新增 `test/regression-v062.js` 锁定上述修复：studyvideoh5→legacy、isFinished 通用标记、已完成节跳节不重播、低进度仍走重播兜底。
- 七套测试全绿（run/audit/fullscreen/verify-exam/reinject-check/gray-v060/regression-v062）。

---

## [0.6.1] - 2026-09-18

> 本版是 0.6.0 的收口版：修掉一个**结构性隐患**（重入守卫全面失效）、补齐边界防护、
> 完成全屏悬浮窗适配与前端视觉统一。无新增功能。

### 修复
- **【结构性·重要】SPA 二次注入导致定时器一路翻倍** —— 0.6.0 为修「重复注入抛
  `Identifier '__ZHS_VERSION__' has already been declared`」，把所有模块塞进了一个
  **大外层 IIFE**。后果是各模块内的 `if (window.__ZHS_HELPER__) return;` 只能退出
  **它所在的那个函数** —— 被内联进外层后，顶层 `return` 变成「退出外层函数」，
  后面 15 个模块照样重复执行。实测：SPA 二次注入 → 面板 1500ms 定时器 1→2→3 逐步翻倍。
  - `build.js` 改回「**每个模块各自一个 IIFE**、直接平铺」，IIFE 边界即隔离边界；
    版本号改走 `window.__ZHS_BUILD__.version`，不再声明顶层 `const`（双保险解决声明冲突）。
  - `build.js` 新增**构建自检**：模块级 IIFE 数少于模块数 → 报错 `exit(1)`，
    防止后人误删模块边界再次悄悄废掉守卫。
  - 新增 `tools/add-module-guards.js`：批量为 16 个模块注入
    `if (ZHS.__modXX) return; ZHS.__modXX = true;`（幂等，可重复执行）。
- **版本号长期显示 `0.0.0`** —— `src/00-config.js` 原来读裸标识符 `__ZHS_VERSION__`，
  但那个 `const` 声明在**另一个 IIFE 作用域**里，本模块根本看不到，`typeof` 判断恒真走兜底分支。
  改为 IIFE + `try/catch` 读 `window.__ZHS_BUILD__.version`。
- **「自动选课」陈旧意图导致意外点课** —— `intent` 过期校验里 `Date.now() - at` 在 `at`
  是非数字字符串时得 `NaN`，`NaN > TTL` 为 `false` → 判定「没过期」，纸条永久有效。
  现在 `at` 必须通过 `Number.isFinite` 校验，非法一律当过期；写入侧也确保写的是数字。
- **配置真值陷阱** —— 字符串 `"false"` / `"no"` / `"0"` 会被当布尔真值，用户以为关了实际是开。
  新增 `BOOL_KEYS` + `toBool()` 归一：**仅 `'true'` / `'1'`（及非 0 数字）为真，其余一律为假**。
  `getConfig()` 返回前与 `saveConfig()` 落盘前都会归一，API 直写与存储直写两条路径都干净。
  取值保守侧优先——考试开关宁可判成关，绝不误开。
- **`setConfig` 不夹逼章节范围** —— `examChapterFrom/To` 直写 API 时无防护（面板走 floor）。
  新增 `clampInt(v, 999)`，负值归 0、超范围归 999。
- **课程进度百分比解析 4 处错误** ——
  `"12.5%"` 被截成 `5`、`"-5%"` 丢负号、`"1000%"` 把文本里后面的数字一起吞进来、
  `"1e2%"` 只取到尾数。改用锚定 `%` 前的数字 token 正则
  `([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*%`，并夹逼上限到 100（避免 `finished` 误判）。
  - 附带修掉一个更隐蔽的坑：**整卡 `textContent` 拼接会污染数字**——课程名「课4」+
    进度「12.5%」拼成「课412.5%」，直接在合并文本里匹配会得到 `412.5`。
    改为**优先在自身含 `%` 的最小元素上单独解析**，整卡文本仅作兜底。
- **课程中心本地存储老格式兼容** —— 纯字符串数组会被当对象处理并在 `replace` 后原样返回数组
  （类型污染）。现在会包装成合法对象结构再返回。
- **课程中心常规日志刷屏** —— `collectCards` 的「开始收集课程卡片…」/「共收集到 N 门课程」
  从 `info` 降到 `debug`；同时给 `Log` 补上 `debug` 级别，且 **debug 不占面板 200 条缓冲**
  （只进 console），避免常规噪声把真实告警挤掉。关键排查线索（如「自动选课开关关闭」）
  保留 `info` 以确保面板可见。

### 改进
- **全屏下悬浮面板可见** —— 进入全屏后浏览器只渲染全屏元素及其子树，原先挂在
  `documentElement` 下的面板会被隐藏。现在会自动把面板迁移到当前全屏容器内；
  对 `<video>` **原生媒体全屏**（此时 `getBoundingClientRect()` 返回 0×0）单独识别处理。
  兜底策略：确实无法共存时强制退出全屏，保证功能优先。
- **前端视觉统一** —— 样式收敛为设计令牌（CSS 自定义属性 `:host { --zhs-xxx }`），
  统一排版、间距、圆角与配色；补齐暗色主题。

### 测试
- `test/run.js` **244 / 0**、`test/audit-hub-fix.js` **22 / 0**、
  `test/fullscreen-panel.js` **120 / 0**、`tools/verify-exam.js` **35 / 0**。
- 新增 `test/gray-v060.js` 灰度测试：覆盖开关组合矩阵、配置迁移与脏数据、
  边界异常路径、全局污染与副作用、日志一致性、跨版本回归六组。
  问题数从最初的 **1 严重 + 2 一般 + 11 吹毛求疵** 收敛到 **0 严重 / 0 一般**（仅余 1 条既有风格提示）。
- 新增 `tools/reinject-check.js` 与 `tools/reinject-verify-independent.js`：
  验证同一 window 内多次注入产物时定时器不叠加（9 / 0 与 8 / 0）。
- **`tools/reinject-verify-independent.js` 内含反向测试**：故意把
  `if (ZHS.__mod06_panel) return;` 改成 `if (false) return;` 后，1500ms 定时器立刻从
  1 个变 2 个——同一套检测代码、只改守卫一行结果就反转，用以证明检测方法本身有效，
  不是假绿灯。

### 开发备注
- 写「不变式」断言时先自问一句：**如果被测行为坏掉了，这个断言会失败吗？**
  不会失败的不变式等于没断言。本版就踩过一次：把「多次注入定时器数量**完全相同**」
  当通过标准，而该条件在守卫**失效**时（`[1,1,1,1]`）同样成立，方向写反了。
  正确口径是「第 2 次起新增必须为 0」（守卫有效时为 `[1,0,0,0]`）。

---

## [0.6.0] - 2026-09-18

### 新增
- **「自动跳课」+「自动选课」（polymas 新平台）** — 新模块 `src/06b-course-hub.js`。
  解决「线性代数听完直接退出去、检测还有没有没听完的课程、点进去跳到没听完的部分继续听」。
  - **自动跳课**：本课程全部学完后自动返回课程中心寻找下一门课。
    钩子插在 `src/05-scheduler.js` 的 `gotoNext` → `bd.undone === 0` 分支（本课看完的唯一出口）。
  - **自动选课**：在课程中心自动进入未学完的课程。卡片选择器 `.ai-course-center-body div.course-card`，
    处理虚拟滚动（边滚边收 + 时长上限），整卡可点（平台走 `window.open` 新标签）。
  - 新增配置项（`src/00-config.js`，`CONFIG_REV` 3 → 4）：`autoCourseHop: true`、`autoCoursePick: true`。
  - 跨页靠 GM 存储 + intent 会话库（key `zhs-helper-hub`）串联，照 `src/04-resume.js` 的存储范式。

### 修复
- **【安全】课程中心不再劫持用户点击** —— 早先版本无条件自启动，
  用户只要打开课程中心页，1.5 秒后课就被点了、还开出新标签。
  现改为安全入口 `onPageReady()`：**只有两种情形才动手** ——
  ① `intent.via === 'auto-hop'`（上一门课学完后的自动跳课链，用户已授权）；
  ② 用户在面板手动点「找下一门课」。其余情况只打日志，绝不动手。
- **`enterCourse` 成功/失败判断反了** —— 早先用 `isHubPage()` 判断「没跳转成功」，
  但新标签场景下当前页永远是课程中心，导致恒返回 false，
  上层据此把一门本来能学的课**永久拉黑**。现改为：click 未抛异常 + intent 写入成功即返回 true；
  「到底进没进去」只由学习页 `settleIntentOnStudentPage()` 回写确认，不在跳转侧乱猜。
- **课程标识键不同源** —— 学习页存 `recruitAndCourseId`，中心页按 `data-course-id` 过滤，
  导致死循环守卫失效。现统一走 `cardIdentity()` 多级兜底 + 课程名降级。
- **`collectCards()` 卡死** —— 原先只有「30 轮」次数上限，无时长上限；
  当 `scrollHeight` 不可读（无布局环境）时判不出「到底了没」，空转最长约 9 秒。
  现加 4 秒总时长上限 + 高度不可读即刻收工。
- **可见性误判阻断点击** —— `U.isVisible()` 在无布局环境误报 false，
  原先直接跳过点击导致功能全废。现改为「不可见也照样点一次」，失败再降级点内部元素。
- **`concurrent pickNext` 假性 null** —— 防重入标志原先让并发第二次调用立即返回 null
  （`[]` 与「未知」语义混淆，上层会误弹「没有未看完的课程」）。
  现改为共享 in-flight Promise，后续调用 await 第一轮结果。
- **版本号漂移** —— `src/00-config.js` 里的 `version: '0.3.0'` 长期未同步。
  现由 `build.js` 注入 `__ZHS_VERSION__`（源自 package.json），单一来源不再漂移。

### 验证
- `node test/run.js` → 244 / 0
- `node tools/verify-exam.js` → 35 / 0
- `node test/audit-hub-fix.js`（新增，22 项）→ 22 / 0
  含「打开课程中心零点击」「有授权才点课」「未误拉黑」「源码红线」四组核心断言。

## [未发布]
- **新增「在线作业/在线考试」自动答题（守株待兔模式，默认关闭）** — 新模块 `src/06c-exam.js`。
  用户明确要求「不自动进入，默认关闭，剔除自动进入」，故本模块的行为边界是：
  **只有用户自己点进作业/考试作答页时**才自动答完并提交；**绝不自动跳转**、
  **绝不在列表页点击任何东西**、**绝不做「答完一个找下一个」的循环**。
  - 新增配置项（`src/00-config.js`，`CONFIG_REV` 4 → 5）：
    `autoExam: false`（总开关，默认关）、`examChapterFrom: 0`、`examChapterTo: 0`、
    `examSubmit: true`、`examSubmitDelay: 5`。
    **`autoExam` 刻意不进 `FORCE_UPGRADE`** —— 它的承诺是「默认关闭」，强推等于偷偷替用户打开。
  - 新增设置项（`src/06-panel.js`）：「自动答题（作业/考试）」开关、「答完自动提交」开关、
    「作答章节范围」两个数字框（沿用既有 `change` 事件 + `ZHS.setConfig` 绑定机制，未发明新机制）。
  - 复用既有答题能力，不重复造轮子：取答案走 `ZHS.Solver.solve()`（题库优先 → LLM 兜底 → 缓存），
    选中态自检走 `ZHS.Filler.isChecked()`，答案归一化走 `ZHS.Bank.normalize` / `toIndexes`。
  - 主观题（填空/问答）自动跳过并 warn，不瞎填；答完提交后**停下**，日志明说「不跳转、不寻找下一个」。
  - **如实声明的限制**：作业/考试作答页 URL 只有 `recruitId/stuExamId/examId/courseId/schoolId`，
    **不含章节号**，DOM 也无章节锚点。故「作答章节范围」仅在能从 URL 参数或页面标题解析出章节号时生效；
    拿不到时退化为「全部作答」并在日志明确写 `未能识别当前作业所属章节…按全部作答`。
  - 新增验收脚本 `tools/verify-exam.js`（35 项断言，jsdom + 源码还原 DOM），
    含「默认关闭时零点击」「列表页零点击」「源码无跳转语句」三组红线断言。

## [0.5.1] — 2026-09-18
- 邀请码支持一键复制：面板硅基流动栏新增「点击复制」按钮，点一下即把邀请码 `axOmWfWi` 写入剪贴板（含 execCommand 降级兜底），复制成功显示「已复制 ✓」；注册链接文案简化为「点击注册（自动带入邀请码）」。

## [0.5.0] — 2026-09-18
- 修复判断题在课中弹题路径被静默跳过（13-answerer.js：题型判断漏写 judgement，改为走 Filler.fill 的 judgement 分支）。
- 修复 gotoNext 连点同一节死循环（05-scheduler.js：新增「同目标连点 N=5 次仍无前进则 stop()+alert」守卫）。
- 接上死配置 answerDialog / answerHomework / panelVisible 设置开关（06-panel.js 设置页 + 05-scheduler 弹题守卫读取 answerDialog + mount 读取 panelVisible）。
- 修复报告标题「漏答数」分支读错键名（06-panel.js：report.未作答 → report.漏答题数，skipN 此前恒为 0）。

## [0.4.0] — 2026-09-17

面板升级 + 答题死循环修复 + 开源上架。

### 新增功能

- **面板 UI 升级**：正文字号从 12px 放大到 14px（标题/列表/日志同步放大），长时间看课更舒适。
- **瑞宝宝个人三件套入口**（作者默认收尾操作固化）：
  - GitHub Star 入口，带 ReTri 渐变水印样式 + ⭐，引导给作者点 star
  - 赞助通道「项目永久免费，给作者点杯奶茶吧 🧋」，点击展开微信收款码
  - 硅基流动 API 获取栏：注册链接 `https://cloud.siliconflow.cn/i/axOmWfWi`（邀请码 axOmWfWi），注明其为 DeepSeek / 大模型中转站，稳定且价格友好
- **开源上架 GitHub**：`huanweide/zhihuishu-helper`，附带一键安装页 `dist/install.html`

### 修复

- **弹题未作答强关死循环（核心）**：未实际点击作答成功时不再尝试关闭弹窗（平台会拒绝并触发 60s 重试死循环）；改为「答对后自动关闭、无通道转人工提示且不进入关闭重试」。
- **手动答题点了没反应**：手动触发绕过弹题签名挡，未答出时明确告警「无答题通道 / 未识别弹题」。
- **选择类题答对后自动关闭**：点击作答成功即通过 `isChecked` 自检，自动关闭弹窗，无需再点关闭按钮。
- 守卫预算 / `_halted` / 配置迁移等前序修复随本次构建一并发布。

---

## [0.2.1] — 2026-09-17

闭环加固：把「自动检测 → 自动跳课 → 全部看完收尾」做成可验证的真闭环，
并补上平台改版时的自救能力。

### 新增功能

**启动预检 `Scheduler.preflight()`（N1 强化）**
- 启动瞬间做一次全量目录体检，不需要等主循环跑起来
- 输出：总节点 / 已完成 / 未看完 / 未解锁 / 完成度
- 打印待学清单（最多列 10 条，超出显示「另有 N 节」）
- 若检测到已全部看完，直接提示「课程已全部看完，无需播放」
- 若目录未识别到任何节点，明确告警「请先进入具体课程」而不是空转

**结构兜底扫描 `sniffItems()`（抗平台改版）**
- 触发条件：6 套预设适配器的选择器**全部落空**时自动启用
- 原理：不猜类名，改从**结构特征**反推目录条目
  - 兄弟节点成群（≥3 个同构兄弟）→ 像列表
  - 节点内文本长度 2~80 字 → 像课时名（太短是标签，太长是大容器）
  - 排除导航/表单文本（登录/注册/首页/设置…）
  - 按 DOM 顺序返回，保证「下一节」方向正确
- 意义：polymas 等新平台改版换类名后，脚本仍能捞到目录而不是彻底失效
- 日志会明确提示「已启用结构兜底扫描，捞到 N 个候选条目」

### 修复

- **总结面板标题撒谎**（重要）：原先硬编码「全部课程已看完」，即使完成度只有 25% 也这么写。
  改为按真实数据动态判定：全完成才显示「全部课程已看完」（深蓝），
  否则显示「运行已结束（仍有未完成课程）」（橙色警示）
- **`skipFinished` 配置是摆设**：设置页有开关、配置层有默认值，但调度器找下一节时
  压根没读这个配置。现已生效 —— 关闭时走 `_nextInOrder()` 按顺序推进（不跳已完成），
  开启时走 `findNext()` 跳过已完成与未解锁
- **`showReport` 面板未挂载时静默丢失**：面板没挂载就调总结，报告直接消失。
  补上兜底 mount，确保结论一定弹得出来
- **`.gitignore` 缺 `.edge-debug-profile/`**（安全隐患）：
  该目录含真实浏览器登录 cookie 与会话数据，此前未被忽略，有误入版本库的风险。
  已补 `.edge-debug-profile/` / `*-debug-profile/` / `*.profile/` 三类规则

### 测试

- 逻辑单测 204 → **223 项**
  - 新增第 25 组：启动预检 8 项
  - 新增第 26 组：`skipFinished` 开关双向验证 2 项
  - 新增第 27 组：总结面板标题动态化（含「不撒谎」反向断言）3 项
  - 新增第 28 组：结构兜底扫描 6 项
- 截屏测试维持 **70 项**
- 合计 **293 项全绿**

### 验证要点

- 面板截图 T5-02 标题实测从「全部课程已看完」修正为「运行已结束（仍有未完成课程）」
- 兜底扫描用「随机类名 + 4 个同构兄弟」的仿真页面验证，能正确捞出 4 条并完成三态统计

---

## [0.2.0] — 2026-09-17

自动化闭环补齐：从「能自动播」升级到「全自动看完并收尾」。

### 新增功能

**N1 目录完成状态三态识别**
- 新增 `Catalog.statusOf(el)`，返回 `done` / `undone` / `locked` / `na` 四态
- 未解锁识别依据（多路交叉）：锁图标（`.lock-icon` / `.icon-lock` / `[class*="lock"]`）、`disabled` / `aria-disabled="true"` / `data-locked="true"` 属性、禁用态类名（`disabled` / `is-disabled` / `forbid`）、文本兜底（「未解锁」/「不可学习」/「暂无权限」）
- 新增 `Catalog.scan()` 返回全量状态清单；`Catalog.breakdown()` 返回三态计数
- 进度条 100% 也计入已完成（部分页面无完成图标）
- **修掉一个自引递归**：`isFinished` 调 `progressOf`、`progressOf` 又调 `isFinished` 会爆栈，抽出 `_readProgress()` 断开循环

**N2 自动跳未看完的课**
- `findNext()` 改为严格「只找 `undone`」，自动跳过 `done`（已完成）与 `locked`（未解锁，点了也没用）
- 双段查找：当前位置往后 → 找不到则回头补漏
- 新增 `Catalog.pending()` 取全部待学条目
- 新增配置项 `skipFinished`（默认开）

**N3 全部看完弹结论并停止**
- 新增 `Scheduler.finishAll(reason)`：遍历目录确认无 `undone` 后，生成总结报告、输出到日志与控制台、弹出面板结论层、停止主循环
- 报告含 10 项：课程名 / 页面版本 / 总节点 / 已完成 / 未完成 / 未解锁 / 完成度 / 本次切换课时数 / 已答题数 / 答题通道统计 / 总耗时 / 结束时间
- 面板新增蓝色总结卡（`Panel.showReport`），可关闭
- 面板状态页新增「未看完」「未解锁」两行（未看完为 0 时显绿，否则显橙）
- **修掉一个环境兼容坑**：原用 `console.table()` 输出报告，在 jsdom 等受限环境会挂起不返回，改为逐行 `console.log`

**N4 答完题自动关闭弹题**
- `Dialog.close()` 升级为多级查找：7 个精确选择器（`.close-btn` / `.el-dialog__close` / `.topic-close` 等）→ 文本按钮兜底（关闭/确定/提交/我知道了/继续学习）→ Esc
- 新增 `Dialog.stillPresent()` 校验关闭是否真生效
- 新增 `Answerer.closeDialogAndResume()`：点关闭 → 校验 → 失败重试最多 3 次（间隔递增）→ 成功后恢复播放
- **防死循环退避**：3 次都失败则按 30s→60s→…→180s 退避，避免主循环反复对同一道题作答
- 弹题关闭成功后自动恢复播放（重新静音 + 设倍速 + `play()`）
- 新增配置项 `autoCloseDialog`（默认开，关掉则只作答不关弹窗）

**N5 面板完善 API 模型配置**
- 设置页重构为三组：播放控制 / AI 答题 / 模型接口
- 模型接口组新增：API 地址（BaseURL）、模型名（带 datalist 常用模型补全）、API Key
- 新增「测试连接」按钮：实时调一次 LLM 并回显结果（按钮变色 + 文字提示）
- 新增「保存」按钮：一次性落盘 BaseURL + Model + Key
- 兼容任意 OpenAI 格式接口：DeepSeek / 通义 / Kimi / 本地 Ollama 等

**N6 智慧树·AI课程中心（polymas）适配**
- 新增 `polymas` 适配器（Vue 3 + 阿里云 Aliplayer，容器 `#main`）
- 按域名路由：`polymas.com` 优先走 polymas 适配器
- 适配器总数 5 套 → 6 套

**测试体系扩展**
- 逻辑单测 160 → **204 项**（新增第 20-24 组：三态识别 15 项 / 跳过逻辑 6 项 / 总结报告 11 项 / 弹题关闭 4 项 / 退避机制 6 项，产物断言加 3 项）
- 截屏测试 49 → **70 项**（新增 T5 组：三态可视化 9 项 + 总结面板 5 项 + 设置页控件存在性 7 项）
- 新增测试工具：`makeEnv` 环境登记 + `stopAllTimers()` 跨组隔离（修掉测试间定时器互相干扰）

**测试工具链新增**
- `tools/keep-edge.js` —— 启动常驻调试 Edge（供真实站点测试随时连接）
- `tools/edge-login-wait.js` —— 轮询等待手动登录完成（每 8 秒探测一次）
- `tools/dbg-n3.js` / `dbg-n3b.js` / `dbg-n3c.js` —— 最小复现诊断脚本
- `test/live-edge.js` 新增 `discover` 模式：自动扫描账号下的在学课程
- `test/live-edge.js` 新增 `answer` 模式：**在真实页面造模拟弹题，走完整答题链路**（归一化 11 项 / 弹题识别 7 项 / 求解 4 项 / 缓存 1 项 / 回填 3 项 / 自动处理 3 项 / 统计 2 项）

### 修复

- **目录完成度死递归**：`isFinished` ↔ `progressOf` 相互调用导致 `RangeError: Maximum call stack size exceeded`（任何遍历目录的操作都会崩）
- **`console.table` 挂起**：在 jsdom / 部分无头环境里不返回，改为逐行输出
- **测试环境串扰**：多个 jsdom 环境残留的 `setInterval` 互相干扰后续断言，加环境登记与统一清理

---

## [0.1.0] — 2026-09-17

首个可用版本：自动播放 + 断点续播 + AI 自动答题三条主线全部打通。

### 新增功能

**F1 自动播放**
- 自动静音（`volume=0` + `muted=true`，比只设 `muted` 更稳，平台会重置 `muted`）
- 自动倍速，硬夹逼在 `0.5 ~ 1.8`（超过 1.8 平台会因 `timeupdate` 采样跳变太大而判定异常播放，不记进度）
- 防暂停保活：检测到 `paused` 主动恢复播放
- 卡死看门狗：`currentTime` 120 秒不推进则判定卡住并唤醒
- 课时结束自动下一节，切课前有随机延迟（2~8 秒）模拟人类
- 进度不同步重试：视频放完但平台记录 < 100% 时，回退到记录点重播，最多 2 次

**F2 断点续播**
- 用 `GM_setValue` 持久化播放位置（跨 iframe/页面共享）
- 每 5 秒节流写入 + 暂停时立即写入 + 关页面（`pagehide`/`visibilitychange`）兜底写入
- 记录 7 天过期自动清理
- 恢复时回退 2 秒（保险，避免卡在边界）
- **视频时长变化时按比例换算恢复点**（换清晰度/换源场景）
- 前 5 秒不记录（不值得）；接近结尾（末尾 10 秒内）不记录

**F3 AI 自动答题**
- 三场景题目采集：课中弹题（`#playTopic-dialog`）、共享课作业（`.subject_node`）、hike 作业（`.q_main`）
- 题型自动推断：单选 / 多选 / 判断 / 填空 / 简答
- 图片延迟加载处理（智慧树把真实地址放 `data-src`）
- **双通道求解**：题库优先（TikuAdapter 协议）→ LLM 兜底（OpenAI 兼容接口）
- LLM 多次生成投票取众数，过半提前收敛
- 答案归一化：`'b'`→`'B'`、`'AC'`→`'A,C'`、`'正确'`→`'对'`、`'√'`→`'对'`
- 答案缓存，同一题不重复请求
- 回填多重兜底：优先点未选中内层 → 内层可见元素 → 直接改 `input.checked` + 派发事件
- 防重复点击取消选中
- 弹题签名防抖，同一份弹题不重复处理
- 多分页弹题逐页作答
- 无可用通道时随机兜底（保证不卡死流程）

**悬浮控制面板（Shadow DOM 隔离）**
- 状态页：运行状态 / 页面版本 / 当前课时 / 视频进度 / 课程完成度 / 已答题数 / 运行时长
- 日志页：实时日志，最多 200 条
- 设置页：8 个开关 + 倍速滑条 + 答题模式下拉 + 题库地址 + LLM Key + 投票次数
- 底部四按钮：启动 / 停止 / 下一节 / 答题

**页面适配（5 套并存结构统一）**
- `wisdom` 智慧版共享课（`studyvideoh5`）
- `fusion` AI 助教翻转课（`fusioncourseh5`）
- `hike` 新形态课（`hike.zhihuishu.com`）
- `legacy` 旧版共享课
- `card2025` 2025 新版卡片式（`studywisdomh5`）

**安全守卫**
- 验证码（易盾）检测 → 自动暂停等用户手动完成，完成后继续
- 弹题遮挡 → 交给答题模块处理
- 其他阻塞弹窗 → 尝试自动关闭

### 测试

- **逻辑单测 160 项**（jsdom + `vm.runInContext`）
- **截屏测试 51 项**（puppeteer-core + 真实 Chrome，11 张截图产物）
- 合计 **211 项全绿**

### 修复的真 bug

1. **`Resume.bindVideo` 重复调用吞掉 `timeupdate` 监听器**（严重）
   - 现象：倍速、静音、播放全正常，面板显示"运行中"，日志打印"已绑定进度记录到视频"，
     但 **GM 存储里永远没有续播记录，断点续播 100% 失效**
   - 根因：守卫写在副作用之后 —— 第二次调用虽因守卫直接返回，
     却把 `_saveThrottled` 覆盖成了没被任何事件触发的死函数
   - 修复：守卫前置 + 绑定序号 `bindId` + 显式 `_detach()`
   - 回归防护：`test/run.js` 第 19 组

2. `Player.hasValidDuration(null)` 返回 `null` 而非 `false`（JS 短路求值陷阱）

3. 弹题场景用 `isVisible` 判定 → jsdom 里元素尺寸为 0 导致误判"没出现"
   - 修复：新增 `isStructurallyVisible`，只排除 `display:none` / `visibility:hidden`

4. jsdom 不实现 `innerText`（恒为 `undefined`）导致多选题误判为单选
   - 修复：新增 `readText(el)` 辅助函数，优先 `innerText` 降级 `textContent`

### 已知限制

- 倍速上限 1.8（平台机制限制，不是 bug）
- 浏览器可缩小但**不可最小化**（后台标签页定时器被节流到 1 次/分钟）
- 课中弹题若渲染在跨域 iframe 内则无法读取（`#tmDialog_iframe` 跨域场景）
- OCR 图片题未实现（目前识别到图片题会跳过）

### 文档

新增：
- `docs/11-测试报告.md` —— 两层测试体系、51 项断言明细、测试环境打桩说明
- `docs/10-M2使用说明.md` —— 安装步骤、面板说明、快捷键、限制

更新：
- `docs/03-踩坑记录.md` —— 新增坑 18/19/20
- `docs/PROJECT_MAP.md` —— 代码地图补齐至 14 模块

---

## [0.0.1] — 2026-09-17

- M1 项目骨架：平台侦察报告、技术方案、踩坑记录、三层快照机制
- M2 自动播放 + 断点续播 + 悬浮面板
