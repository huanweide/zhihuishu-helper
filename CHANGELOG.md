# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
