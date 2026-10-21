# 跨页跳转可行性调研报告（只读调研，未改动任何 src 文件）

范围：判断「一门课听完后自动退回课程中心 → 找下一门未听完的课 → 点进去继续听」在技术上是否可行、怎么实现最稳。
方法：通读 `src/00..07`、`build.js`、`dist` 头部，全部结论附 `文件:行号`。

---

## Q1. 现有脚本有没有「跨页面/跨标签页」的状态持久化能力？

**结论：有，而且已经封装好，可直接复用。**

存储能力存在于两套实现（都是 `GM_setValue/GM_getValue` 优先，无 GM 时降级 `localStorage`）：

| 封装函数 | 位置 | 用途 |
|---|---|---|
| `readStore()` / `writeStore(store)` | `src/04-resume.js:16` / `src/04-resume.js:30` | 断点续播记录读写（内部 `hasGM` 判断在 `:14`）|
| `Resume.save/load/clear/clearAll/list` | `src/04-resume.js:54 / :72 / :89 / :99 / :105` | 对外 API，按 `courseId` 存一条记录 |
| `store(obj)` / `getConfig()` / `saveConfig()` | `src/00-config.js:73 / :84 / :103` | 全局配置读写 |
| `panel._readFlag/_writeFlag` | `src/06-panel.js:565 / :575` | 通用布尔标记读写（当前只用于新手引导 `zhs-onboarded`，见 `:507`、`:513`）|

**关键点**：`GM_setValue`（`src/04-resume.js:14`、`src/00-config.js:59`）写入的是油猴脚本自己的存储域，**跨标签页、跨域名共享**。也就是说在 `hike-teaching-center.polymas.com` 写入的意图，`xxx.polymas.com` 或 `zhihuishu.com` 的学习页里能读回来 —— 这正是跨页方案的基础，**不需要新建底层存储设施，只需按 Q7 加一个新 key**。

未发现 `sessionStorage` 的使用（全库 Grep 仅命中上述 GM/localStorage，无 sessionStorage）。

---

## Q2. 现有 localStorage 的 key 命名规范是什么？

**结论：规范是 `zhs-helper-<用途>`（带 `zhs-helper-` 前缀）；布尔标记用 `zhs-<用途>`。无独立版本号字段——版本号内嵌在配置对象里。**

实例引证：
| key | 位置 | 说明 |
|---|---|---|
| `zhs-helper-resume` | `src/04-resume.js:13` (`STORE_KEY`) | 续播记录 |
| `zhs-helper-config` | `src/00-config.js:76`、`:77`、`:87`、`:88` | 全局配置 |
| `zhs-onboarded` | `src/06-panel.js:507`、`:513` | 布尔标记（短前缀风格）|

版本号机制：不是独立 key，而是**配置对象内的 `configRev` 字段** —— `src/00-config.js:66` (`CONFIG_REV = 3`)、`:95-99` 迁移逻辑、`:107` 写回。续播记录里对应的是每条记录的 `updatedAt` + `resumeExpireDays` 过期机制（`src/04-resume.js:77-84`）。

**建议**：新会话库沿用 `zhs-helper-<用途>` 风格（如 `zhs-helper-hub`），并在对象里带 `rev` 字段便于将来迁移。

---

## Q3. 油猴脚本在「新标签页」里会自动运行吗？

**结论：会。`@match` 用的是通配子域规则，两个目标 URL 都在命中范围内。**

`dist/zhihuishu-helper.user.js:7-9`（源在 `build.js:20-22`）的全部 match 规则：
```
// @match  *://*.zhihuishu.com/*
// @match  *://*.polymas.com/*
// @match  *://*.zhihuishu.cn/*
```
无 `@include`，无 `@exclude`；`@run-at document-idle`（`dist:18`）；`@grant GM_setValue/GM_getValue/GM_xmlhttpRequest`（`dist:11-13`）。

两条 URL 判定：
- `https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center` → **命中**（`*://*.polymas.com/*` 覆盖任意子域 + 任意路径）。**ai-course-center 路径不在 match 内这一硬问题不存在。**
- `{BASE}/AIstudent/{courseId}/{classId}?key=entry` → **命中**，前提是 BASE 的域名以 `.polymas.com` 结尾。从 match 规则反推，BASE 只可能是 `polymas.com` 的子域（如 `hike-teaching-center.polymas.com`、`xxx-student.polymas.com` 等），或 `*.zhihuishu.com` / `*.zhihuishu.cn`。注意 `*://*.polymas.com/*` **不匹配裸域 `polymas.com`**（无子域），若平台实际用裸域访问则需补一条 `*://polymas.com/*` —— 建议实测 `location.hostname` 确认（适配器 `src/02-adapter.js:153` 已按 `host.includes('polymas.com')` 判断，覆盖裸域，但脚本注入是另一回事）。

另注：脚本在 `document-idle` 注入，新标签页正常加载即会执行 `src/07-main.js:84-89` 的启动逻辑，**无需额外干预**。

---

## Q4. 现有 gotoNext 在「本页已无可点条目」时怎么处理？

**结论：当前是直接 `stop()` 停掉（两种情况），这正是「听完直接退出」的位置，也是最干净的钩子插入点。**

`src/05-scheduler.js` 中 `findNext` 返回 null 后的分支（`gotoNext` 内，`:428-444`）：
```
428: if (!next) {
429:   if (bd.total === 0) {                       // 目录都没识别到
433:     this.stop();                              ← 情况 A：停
434:   } else if (bd.undone === 0) {               // 真正全看完
436:     await this.finishAll(reason);             ← 情况 B：出总结并停
437:   } else {                                    // 有未完但定位不到
439:     ZHS.Log.warn('还有 ' + bd.undone + ' 节未完成 …');
440-441: ZHS.panel.alert(...); this.stop();
442:   }
443:   return;
444: }
```
另有两条前置终止路径：`gotoNext` 里「同目标反复点」检测 `:456-461`（`this.stop()` 在 `:459`）；`_nextInOrder` 无下一节返回 null（`:504-517`，会回到上面的 `:428` 分支）。

**钩子插入点（推荐）**：在 `:434` 的 `bd.undone === 0` 分支内。当前逻辑是 `await this.finishAll(reason)` 后 `return`。建议改为：
```
bd.undone === 0  →  先判断「课程中心调度」是否开启
                     开 → 记录「本课程已听完」到会话库，跳转回课程中心
                     关 → 维持现有的 finishAll + stop（向后兼容）
```
即插入点落在 `src/05-scheduler.js:434-443` 之间。**为什么这里最合适**：① 这里是「本课程所有节都完成」的唯一判定出口；② `finishAll`（`:522`）此时已能拿到完整统计，可在跳转前先把总结写盘；③ 不影响 `:429` 的「识别不到目录」和 `:437` 的「定位失败」两条异常路径（应保持 stop，不进跨页流程，避免死循环）。

---

## Q5. 现有代码里有没有「跳转/刷新页面」的既有实现？

**结论：没有任何整页跳转/刷新的实现，全库零处。**

Grep `location.href` / `location.replace` / `location.assign` / `window.open` / `.reload()` 在 `src/` 下的命中：
| 位置 | 上下文 | 是否跳转 |
|---|---|---|
| `src/01-util.js:129` | `new URL(location.href)` —— **只读取**当前 URL 解析参数（`Util.getUrlParam`）| 否 |
| `src/08-questions.js:356` | `/dohomework\|doexamination/.test(location.href)` —— 读 URL 判断页面类型 | 否 |
| `src/08-questions.js:357` | `/answer-homework\|answer-exam/.test(location.href)` —— 同上 | 否 |

即：**`location=`、`location.replace`、`location.assign`、`window.open`、`reload` 在 src 中均无任何调用**。跳转能力需要**从零新建**（这也是为什么新模块独立成文件更清晰）。

补充事实（背景已确认）：课程卡片点击会由平台自己 `window.open` 新开标签页，脚本无法直接控制该新标签 —— 所以跨页必须靠「脚本自己发起的跳转 + 新页面里读回会话意图」两段式完成。

---

## Q6. 新的「课程中心调度器」应该放哪个文件？

**结论：新建 `src/06b-course-hub.js`。**

理由（依据 `build.js:40-42` 的拼接规则：`fs.readdirSync(SRC).filter(.js).sort()` 按**文件名字典序**拼装）：
- `06b-` 排在 `06-panel.js` 之后、`07-main.js` 之前 → 在 `07-main.js` 启动时已定义完毕，`ZHS.CourseHub` 可被 `boot()` 直接调用。
- 依赖关系上，它需要：`ZHS.Util`（sleep/querySelector 等，`01-util`，已在其前）、`ZHS.Catalog`（`02-adapter`，已在其前）、`ZHS.Log`/`ZHS.config`（`00-config`）、`ZHS.Scheduler`（`05-scheduler`，已在其前）。**全部依赖都在它之前加载，位置正确。**
- 命名用 `06b-` 而非 `06-scheduler` 是为了不打断现有「05 调度 / 06 面板」编号语义，且字典序上 `06b-` 严格位于 `06-panel.js` 与 `07-main.js` 之间（`'06b' < '07'`，同层比较字符 `'b'(98) < 'p'(112)` 亦满足）。
- 职责单一：它只做「课程中心页的卡片发现 + 未听完筛选 + 进入决策 + 会话库读写」，**不碰学习页的播放逻辑**（那是 `05-scheduler` 的事）。学习页侧的钩子（Q4 的 `:434` 分支）只负责「写会话库 + 发起跳转」，判断逻辑全部落在本新文件，保持 `05-scheduler` 不膨胀。

（备选：并入 `12-filler.js` 之类的现有模块 —— **不推荐**，职责不搭，且会让该文件身兼两职。）

---

## Q7. 会话存储要存哪些字段才能实现「跳到没听完的部分继续听」？

**建议存储结构**（新 key：`zhs-helper-hub`，复用 Q1 的 GM/localStorage 双写模式）：

```jsonc
{
  "rev": 1,                      // 结构版本号，便于将来迁移（对齐 config 的 configRev 思路）
  "active": true,                // 是否处于「课程中心调度」模式；false 时保持旧的一课到底+stop 行为
  "hubUrl": "https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center",
                                 // 课程中心页地址，跳回时用（写死一处，避免各处拼字符串）
  "intent": {                    // —— 跨页意图：A 页写下、B 页读回 ——
    "type": "open-course",       // 意图类型，当前只有 open-course；将来可扩
    "courseId": "123456",        // 要进入的课程 ID（来自卡片解析或 URL）
    "classId": "789",            // 班级 ID（拼 AIstudent 路径需要）
    "courseName": "高等数学",      // 课程名，仅用于日志/面板展示，便于人工核对
    "lessonKey": "第3章 第2节",    // 上次学到的小节标识（对齐现有 state.lessonKey 语义）
    "lessonTime": 320.5,         // 上次学到该小节的秒数（可选，续播二次保险）
    "at": 1726600000000          // 意图写入时间戳，用于过期判断（建议 >10 分钟视为失效）
  },
  "doneCourses": {               // —— 已全部听完的课程，避免重复进入 ——
    "123456": { "at": 1726600000000, "name": "高等数学" }
  },
  "failedCourses": {             // —— 已尝试但失败的课程，避免死循环 ——
    "123456": { "at": 1726600000000, "reason": "点击卡片无反应" }
  },
  "stats": {                     // 便于面板展示进度概览
    "lastScanAt": 1726600000000,
    "totalSeen": 12, "doneCount": 3, "failedCount": 1
  }
}
```

字段与需求的对应：
| 需求 | 对应字段 |
|---|---|
| 记住「上次在哪个课程、哪个小节」 | `intent.courseId` + `intent.lessonKey` + `intent.lessonTime` |
| 记住「本课程已全部听完」避免重复进入 | `doneCourses[courseId]`（学习页在 Q4 的 `:434` 分支写入）|
| 记录「已尝试但失败的课程」避免死循环 | `failedCourses[courseId]`（进入后 N 秒内未检测到 video / 卡名校验不过 → 写入）|
| 跨页传递「我要去学 courseId=xxx」 | `intent` 对象（写于课程中心跳转前，读回于学习页 `boot()`）|

**为何还要 `lessonTime` 而不只靠 lessonKey**：现有断点续播（`src/04-resume.js:54` 的 `save`）已按 `courseId` 存了 `time`，跨页场景下若 `intent` 能同时带上小节和秒数，学习页首帧即可 seek，无需依赖 `Catalog.findByName` 的文本匹配（`src/02-adapter.js:409`，文本改名易失配）——两条数据互为保险。

---

## 总结

**技术上完全可行，且基础设施大半已就绪。** 关键的「跨页/跨标签页持久化」能力现成可用：`src/04-resume.js:14-40` 的 `GM_setValue` 优先 + `localStorage` 降级双写机制，天然跨标签、跨子域生效；`@match *://*.polymas.com/*`（`dist/zhihuishu-helper.user.js:8`）已覆盖课程中心页与学习页两个域名，新标签页会自动注入脚本，ai-course-center 路径**不构成阻碍**。唯一需要从零写的是「整页跳转」原语（Q5 证实全库零调用）和「课程中心卡片发现与筛选」逻辑（新文件 `src/06b-course-hub.js`，Q6）。插入点也已定位：`src/05-scheduler.js:434` 的「本课程全看完」分支，是唯一干净的收尾出口。

**最大风险点有三个，按严重度排序：**

1. **死循环风险（最高）** —— 若「进入课程 → 听不完/进不去 → 回中心 → 又选中同一门课」形成闭环，会造成无限跳转。必须靠 `failedCourses` + `doneCourses` 两道黑名单 + `intent.at` 过期判断三重防护，并且**课程中心的「点整卡开新标签」特性意味着脚本拿不到新标签的句柄**，无法确认进入是否成功，只能靠学习页回写「我到了」来闭环——这个握手机制一旦漏写就会退化成长时间空等。这是方案最脆弱的一环。
2. **虚拟滚动卡片收集不稳** —— `.ai-course-center-body div.course-card` 是虚拟滚动（背景已确认「需边滚边收」），滚动节奏、去重、终止条件任一处理不好都会漏课或空转，且卡片内部无 `a[href]`、`courseId/classId` 只能从平台自己的点击参数里解析，改版即失效。
3. **`stop()` 语义与用户预期冲突** —— 现有 `stop()`（`src/05-scheduler.js:163-173`）会置 `_halted = true` 阻止自动重启（`:171`）。跨页跳转后新页面是全新环境不存在该标记，但**跳转前的 `stop()` 会先打断当前循环**，需确保「写盘 → 跳转」两步在 `stop()` 之前原子完成，否则可能出现「意图没写就跳了」。

次要风险：会话库与现有 `zhs-helper-resume` 的职责边界要划清（前者管「去哪个课」，后者管「课内哪个位置」），否则两套记录不同步会导致续播错位。
