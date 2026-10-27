# 项目索引（PROJECT MAP）

> 最后更新：2026-10-25（round-55 全自动学习引擎 + LLM 正确率拉升后）
> 状态：**v0.6.65**，油猴脚本 20 模块，逻辑单测 **717 通过 / 0 失败**
> 本文件此前的版本停留在 v0.6.55，模块数/测试数/命令均已过期，以本版为准。

---

## 〇、快速上手

```bash
node build.js                  # 构建 → dist/zhihuishu-helper.user.js（版本号从 package.json 注入）
node test/run.js               # 逻辑单测（jsdom，644 项断言）—— 改 src 后必跑
node tools/check-dist-fresh.js # dist 与 src 一致性校验（漏 build 会被挡下）
node test/screenshot.js        # 截屏测试（真实 Chrome，需本机起浏览器，另行跑）
```

装脚本：浏览器装 Tampermonkey → 把 `dist/zhihuishu-helper.user.js` 拖进浏览器窗口。
用户侧自动更新：`@updateURL` 指向 jsDelivr `@master`（push 后需 purge，见第六节）。

---

## 一、项目定位与红线

**定位**：智慧树网课助手——自动播放 + 断点续播 + AI 自动答题，服务「平时作业/章节练习/单元测试」辅助。

**红线（改动任何代码前必读，违者拒绝合并）**：
1. **正式监考考试坚决不碰**；只做平时作业/章节练习/单元测试（`06c-exam.js` 的 FORBIDDEN 清单写死在代码里）。
2. **绝不 seek**：任何 `video.currentTime = x` 都会触发腾讯 Turing 滑块验证码（真机实测），脚本解不了、进度作废。唯一 seek 入口 `Player.seekTo` 仅供用户手动操作。
3. **验证码交人**：检测到 Turing/易盾激活态 → 暂停一切自动动作等人，绝不自动破解、绝不「超时放行」（放行 = 白跑 + 进度不作废期间的记录全废）。
4. **不商业化、守株待兔**：作业/考试页只在用户自己点进去时工作，绝不自动跳转/自动点列表页。
5. **隐身性优先**：纯油猴 DOM 路线（不拦 API、不注入 CDP），拟人节奏（随机暂停/随机延迟/拟人点击）是拉特征不是破解。

---

## 二、文档地图

| 文档 | 内容 | 什么时候看 |
|------|------|------------|
| `README.md` | 总览：目标、结论、目录、里程碑 | 第一次接触本项目 |
| [`docs/01-侦察报告.md`](docs/01-侦察报告.md) | 智慧树域名图谱、5 套页面 DOM 选择器、弹题结构、反自动化措施 | 写代码前查选择器 |
| [`docs/02-技术方案.md`](docs/02-技术方案.md) | 模块架构、三条主线设计、Prompt 模板、风险对策 | 开发时对照实现 |
| [`docs/03-踩坑记录.md`](docs/03-踩坑记录.md) | 实测问题与解决 | 遇到 bug 先翻这里 |
| [`docs/04-真机问题清单.md`](docs/04-真机问题清单.md) | 弹题/DOM 答案/验证码真机取证 | 验证码与弹题问题 |
| [`docs/05-切集与反作弊调研.md`](docs/05-切集与反作弊调研.md) | **八条硬约束**（切集/seek/验证码/节奏）——本项目宪法 | 改播放/切课/答题逻辑前必读 |
| [`docs/06-GitHub生态全景调研.md`](docs/06-GitHub生态全景调研.md) | 50+ 竞品调研、三技术路线、法律风险地图 | 找新思路/评估方案时 |
| [`docs/11-测试报告.md`](docs/11-测试报告.md) | 两层测试体系、覆盖明细 | 想了解测试怎么跑 |
| [`docs/90-快照与回溯.md`](docs/90-快照与回溯.md) | 快照机制 + 恢复步骤 | 想回退代码时 |

---

## 三、代码地图（v0.6.64，20 模块，按端到端链路排列）

```
src/                              # 源码（按序拼装，文件名即加载序）
├── 00-config.js      331 行   配置层：DEFAULTS + GM存储 + 布尔归一化 + 配置迁移 + 日志缓冲 + 共享状态
├── 01-util.js        395 行   工具层：节流/防抖/两种可见性/拟真点击/编辑距离(round-45) + Const 单一真源
├── 02-adapter.js    1323 行   适配层：6 套页面适配器评分选举 + auto 降级 + 切课四信号验收 + 虚拟滚动补全
├── 02d-guard.js      136 行   看门狗：进展指纹心跳，T1~T4 逐级升级（重探测→唤醒→跳节→交人）
├── 02e-nav.js        236 行   导航策略链：spa 直调 → URL 深链 → 原生下一节 → 拟人点击（隐蔽度递减）
├── 03-player.js      321 行   播放层：静音/倍速(≤1.5)/防暂停/卡死检测/进度对账(不 seek)/拟人随机暂停(round-45)
├── 04-resume.js      310 行   续播层：GM 持久化/过期清理/时长换算/恢复(零 seek，位置交给平台)
├── 05-scheduler.js  1244 行   调度层：2s 主循环 + 守卫 0~4（回家/验证码/弹题/阻塞/温馨提示）+ 结束判定 + 切课 + 弹题即时唤醒
├── 06-panel.js      1578 行   面板层：Shadow DOM 悬浮控制台（状态/日志/设置/报告/答题统计）
├── 06b-course-hub.js 832 行   课程中心：自动跳课（intent 授权凭证 + pendingHop 看门狗 + 失败名单）
├── 06c-exam.js       853 行   作业/考试作答页：守株待兔自动答题（FORBIDDEN 清单 + autoExam 严格门禁 + 章节范围 + 主观题）
├── 07-main.js        256 行   入口层：boot 三Try + 面板兜底条 + SPA 监听自愈 + window.zhs
├── 08-questions.js  1275 行   题库采集：三场景（弹题/作业/hike）+ 选项识别四通道(D 锚定/A 文本/B 对称/C 自动发现)
├── 09-bank.js        405 行   网络层：TikuAdapter 题库客户端 + 失败诊断分类(超时/网络/HTTP/HTML) + 答案归一化
├── 10-llm.js         206 行   LLM 通道：OpenAI 兼容 + 多次投票(选择题) + ask 单次(主观题) + 总预算闸门
├── 11-solver.js      257 行   求解编排：精确缓存 → 模糊缓存(round-45, 90%) → 题库 → LLM → 启发式 → 随机/跳过
├── 11b-heuristic.js  277 行   离线启发式：零依赖求解（以上都对/包含排雷/绝对化词/否定式题干/判断题套路）
├── 12-filler.js      315 行   回填层：多子目标×多点击方式 + SVG 选中态识别(#iconxuanzhong) + 选中自检 + 诊断转储
├── 13-answerer.js    832 行   答题编排：弹题签名防抖 + 标准链路 + 非标准 A/B + AI 随堂练习 + 多页 + 退避/转人工
├── 14-stats.js       145 行   统计层：答题明细(200 条上限) + 按天聚合 + 学习时长/习惯分

build.js                     ✅   构建：src/*.js → dist/*.user.js（版本从 package.json 注入）
test/run.js                  ✅   逻辑单测：644 项断言（jsdom，两组之间互不共享状态）
tools/check-dist-fresh.js    ✅   dist/src 一致性（漏 rebuild 的守门员）
tools/zhs-cli.js             ✅   外置 CLI：start/connect/diag/deep/inject/run（用户只登录一次，见 skill zhihuishu-cli）
tools/diag-probe.js          ✅   诊断探针：只读结构 dump + 切课策略穷举（CDP 注入用）
```

### 端到端链路（一图流）

```
注入(07 boot 三Try)
  → 面板兜底条挂载(失败也看得见)
  → 目录识别(02 评分选举/auto 降级/sniffItems 兜底)
  → 断点恢复(04 零 seek：点标题切过去，位置交给平台)
  → 主循环 2s/tick(05)：
      守卫0 页面被带走→自动回家 │ 守卫1 验证码→停手等人 │ 守卫2 弹题→即时处理 │ 守卫3/3.5 阻塞/温馨提示
      → 保活：卡死检测 → 进度对账 → 拟人随机暂停(0.3%/tick,30~90s) → ensurePlaying
      → 结束判定(平台记录金标准)：isFinished/进度≥91%/0% 等 3min 交人/重播兜底(不 seek)
      → gotoNext：随机延迟 2~8s → Nav 策略链(spa→url→nativeNext→humanClick) → 四信号验收 → 切后续播+轮询
  → 弹题处理(05._handleDialog ↔ 13.Answerer)：
      DOM 答案直读 → AI 随堂练习分流 → 标准链路(读题→Solver→Filler→自检→关)
      → 非标准 A/B(先真求解后猜) → ensureAnsweredThenClose(没答完不关)
  → 求解链(11)：精确缓存 → 模糊缓存 → 题库(09) → LLM(10 vote/ask) → 启发式(11b) → 跳过/随机
  → 作业/考试(06c 守株待兔)：用户点进作答页才工作，答完即停，提交有倒计时可反悔
  → 课程中心(06b)：本课全看完 → intent 凭证 → 回中心自动选下一门
  → 看门狗(02d)：4/8/12/16 分钟无进展逐级升级，T4 交人
```

### 运行时 API（Console 可调）

```js
zhs.start() / zhs.stop()      // 手动启停（stop 后需 start({manual:true}) 或面板点启动）
zhs.next()                    // 手动切下一节
zhs.config({ speed: 1.5 })    // 改配置（倍速硬上限 1.5）
zhs.logs() / zhs.stats()      // 日志 / 课程进度
zhs.clearResume()             // 清除本课程续播记录
zhs.boot()                    // 面板挂载失败时的手动重撬
```

---

## 四、关键结论速查（防重复踩坑）

### 4.1 选择器（当前主目标 studyvideoh5 = legacy 旧版共享课）

```js
// 目录条目/当前项/完成标志
'li.clearfix.video'   'li.clearfix.video.current_play'   '.time_icofinish'
// 注意：.time_ico_half 是每节都有的进度底条，不是完成标志
// 切课点「标题文字」（点 li 本体偶发整页跳门户）：
'.catalogue_title' / '#lessonOrder'
// 弹题容器（ZHS.Const.QUESTION_SELECTORS 单一真源）：
'#playTopic-dialog, [class*="topic-dialog"], .el-dialog__wrapper .el-dialog, .ai-test-question-wrapper, .ai-class-exercise-dialog'
// AI 小智弹题答案有时直接写在 DOM：/正确答案[：:]\s*([A-Ha-h]{1,8}|对|错)/
// 选中态可能是 SVG 图标 href：#iconxuan(未选) → #iconxuanzhong(已选)，isChecked 必须认这个信号
// 作业页：.examPaper_subject / .subject_describe / .subject_node > .nodeLab / button.submit-btn
```

### 4.2 三个必踩的坑（round-26 真机校准，铁律）

1. **倍速 ≤ 1.5**——超过平台可能不记录进度（`Player.setSpeed` 硬上限就是 1.5）。
2. **不能最小化浏览器**——`requestAnimationFrame` 停摆导致卡死。
3. **绝不能 seek**（最高优先级）——任何 `video.currentTime = x` 立刻弹腾讯 Turing 滑块。进度补齐走「重新点本节标题，让平台按自己的记录定位」——零 seek。

### 4.3 反作弊与拟人节奏（docs/05 八条硬约束的代码落点）

| 硬约束 | 落点 |
|--------|------|
| 切集只点标题 | `Catalog._bestClickTarget`（clickTarget 优先） |
| 切后关温馨提示 | 调度器守卫 3.5（只点「我知道了」/X，绝不碰「返回学堂」） |
| 切集/关弹题后强制 play | `_rebindAfterNav` 就地 play + 3×600ms 轮询确认 |
| 跳过已完成 + 每次重扫 | `Catalog.findNext` + `breakdown`（不缓存清单） |
| 绝不 seek | `syncToCatalog`/`retryFromPlatformProgress`/`Resume.restore` 全部零 seek |
| 导航守卫 | 调度器守卫 0（连续 3 轮读不到目录 → 自动回家） |
| 验证码兜底 | 调度器守卫 1（不 await、直接 return、停手等人） |
| 节奏防御 | 弹窗关闭 0.5~1.5s 随机、倍速 ≤1.5、拟人随机暂停 0.3%/tick、切课延迟 2~8s |

---

## 五、里程碑进度

- [x] M0 情报侦察（5 套页面结构 + 参考项目）
- [x] M1 项目骨架（文档 + 快照机制）
- [x] M2 自动播放 + 断点续播 + 悬浮面板
- [x] M4 AI 答题——题库通道 + 双通道编排
- [x] M5 AI 答题——LLM 通道 + 投票 + 端到端截屏测试
- [x] M6 面板打磨 + 习惯分（统计层已交付）
- [x] round-26~46：切课根治（评分选举/auto 兜底/四信号验收）、反作弊合规（零 seek/验证码停手）、主观题补齐、听课程拟人节奏（随机暂停/模糊缓存）、端到端对账（round-46）
- [ ] 掌握度答题（studywisdomh5）——生态调研已定位，未开工
- [ ] 真实站点全链路回归（需用户配合开调试 Edge）

**当前门禁**：`node build.js` + `node test/run.js` **717 通过 / 0 失败**（v0.6.65，jsdom；截屏测试需真机 Chrome，另行跑）。

---

## 六、发布流程（改完必走）

```bash
node build.js && node test/run.js          # 门禁：构建 + 全量测试（644/0 才算过）
# 版本铁律（本项目是两件套，不是 novel-smith 的五件套）：
#   package.json 的 version + CHANGELOG.md 新增条目（build.js 从前者注入 dist）
git add <显式文件>                          # 禁 git add -A；排调试产物（tools/dbg-*、*.last.json）
git commit -m "v0.6.xx round-xx: ..."
git push ghssh master                       # 只走 SSH 远端；push 前先 fetch 看有无分叉
curl "https://purge.jsdelivr.net/gh/huanweide/zhihuishu-helper@master/dist/zhihuishu-helper.user.js"
# 复验 CDN 服到新版本（byte 级：git show HEAD:dist/... 与 CDN 下载 cmp）
```

历史教训：曾出现远端被推入独立旧历史导致分叉（0.6.50 时 force-with-lease 收场）；push 前必须 `git fetch` 确认纯 fast-forward。

---

## 七、调试工具链（用户只登录一次）

| 工具 | 用途 |
|------|------|
| `tools/zhs-cli.js` | 固定 profile 调试 Edge（9222/[::1]）：start 开浏览器 → connect 列标签 → diag 截 API+穷举切课策略 → deep 被动深探 → inject 注入 dist |
| `tools/diag-probe.js` | 注入页面的只读诊断（框架/iframes/适配器/候选/可点子目标/遮罩） |
| `tools/dbg-n3*.js` | 早期逻辑调试固化（已入仓，历史产物） |
| skill `zhihuishu-cli` | CLI 用法 + 报告解读决策树（供 AI 直接调用） |

铁律：注入会触发风控升级（2026-10-19 踢页事件）——**先被动 deep 观测，再决定是否 inject**。
