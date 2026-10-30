<p align="center">
  <img src="assets/banner.svg" alt="智慧树助手 zhihuishu-helper">
</p>

<p align="center"><sub>**English** · [README_EN.md](./README_EN.md)</sub></p>

# 🎬 智慧树助手（zhihuishu-helper）

[![License](https://img.shields.io/github/license/huanweide/zhihuishu-helper)](LICENSE)
[![CI](https://github.com/huanweide/zhihuishu-helper/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/zhihuishu-helper/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/huanweide/zhihuishu-helper?label=version)](https://github.com/huanweide/zhihuishu-helper/releases)
[![Stars](https://img.shields.io/github/stars/huanweide/zhihuishu-helper)](https://github.com/huanweide/zhihuishu-helper/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/huanweide/zhihuishu-helper)](https://github.com/huanweide/zhihuishu-helper/commits/master)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

> **别人家的刷课脚本是「能跑就行」，本项目是「断了能接上、答不上不乱猜」** —— 一个 Tampermonkey 油猴脚本，自动播放 / 断点续播 / AI 自动答题，全程跑在你自己的浏览器里，账号不交给任何第三方。
>
> A Tampermonkey userscript for Zhihuishu (智慧树 / 知到): auto-play, crash-resumable playback, and evidence-first AI answering — 100% local, no account handoff.
>
> **自动流**：打开网课页 → 脚本体检目录 → 静音倍速防暂停播放 → 遇弹题「题库 → LLM → 启发式」求解 → 回填并校验 → 一节完自动切下一节 → 全看完弹总结卡片
> `识别 → 播放 → 答题 → 切集 → 收尾`

**适合谁用**：被智慧树网课折磨的大学生；想挂课又想保住学习记录、但不愿把账号交给云端自动化脚本的人。

---

## 📌 用途与红线（开箱前必读）

**这个脚本是做什么的（用途 ✅）**
- **辅助平时学习**：平时作业 / 章节练习 / 单元测试的答题辅助，加上自动播放、断点续播、课中弹题自动处理。
- **全自动托管（仅限你离开时）**：你不在电脑前时自动续播、课程中心选课、跳到下一门——像"挂机托管"。
- **人类化防检测**：在场让权（你在场不代劳）、随机思考延迟、抖动主循环，降低被平台判为机器人的风险。
- **拿不准就交给你**：三通道（题库 / LLM / 启发式）都解不出时留空转人工，绝不瞎蒙。

**⛔ 不要用 / 红线（违反即可能封号或 PR 被拒）**
- **不要用于正式监考考试**。考试页严格"守株待兔"：只有你本人点进去才作答，绝不自动跳转、绝不代你答监考卷。
- **不要最小化浏览器窗口**（只能缩小）。最小化会把定时器节流到 ~1 次/分钟，主循环冻结、进度作废。
- **不要把倍速调到 1.8 以上**。超过会被平台判定异常、进度不记录。
- **不要指望它"替你在场时代劳"**。你在场时它主动让权、不切题不答题——这是防检测的核心，控制权永远在你。
- **不要手动改 `dist/` 产物、也不要指望它绕验证码**。手改会被校验拦截且升级即覆盖；验证码一律交人工。
- **不要商用 / 不要传播 / 不要把账号或 API Key 交给任何第三方**。脚本纯本地运行，永不收集任何凭据。

> 更完整的边界、已知限制与开发红线见 [安全边界](#-安全边界--security-boundary)；开发侧四条不可触碰红线见 [贡献指南](CONTRIBUTING.md)。

[30 秒看懂](#-30-秒看懂) · [用途与红线](#-用途与红线开箱前必读) · [它能做什么](#-它能做什么--what-it-does) · [特性](#-特性--features) · [快速开始](#-快速开始--quick-start) · [控制台 API](#-控制台-api-速查) · [架构](#-架构--architecture) · [加一个求解通道](#-加一个你自己的求解通道) · [路线图](#-路线图--roadmap) · [开源协作](#-开源协作-接受帮助) · [安全边界](#-安全边界-security-boundary) · [License](#-license)

---

## 🎬 30 秒看懂

**没有本脚本** —— 你手动刷一节课的样子：

```
$ 你（第 3 次打开这节课）
  → 从进度条 12:40 手动拖回去找上次看到哪      # 记不住位置，来回试
  → 弹题：「下列哪项不是……」                   # 卡住，关不掉，播放停摆
  → 瞎勾一个 C 交上去                          # 答错了也不知道
  → 一节看完，手动点下一节                     # 人得守着
  → 关掉浏览器睡觉 → 明天进度从哪开始？         # 全靠记忆
```

**装上本脚本** —— 同样的课：

```
$ 打开课程页，点面板「启动」
=== 课程体检 ===
共 24 个节点：已完成 18 / 未看完 5 / 未解锁 1（完成度 75%）
  待学 1：第三章 3.2 缓存策略
  待学 2：第三章 3.3 分布式锁
[智慧树助手] 静音 + 倍速 1.8 + 防暂停已就绪
[智慧树助手] 已恢复到上次位置 12:40（跨 iframe 持久化）     ← 断点续播
[智慧树助手] 弹题：命中题库（通道=bank）→ 已回填并校验通过   ← 不瞎蒙
[智慧树助手] 本节结束，自动切下一节
```

一句话差别：**它不是帮你「点播放」，而是帮你把「学到哪 / 答什么 / 下一节是谁」这三件事记住并做完。**

---

## 🎬 它能做什么 / What It Does

`User:` 点一下面板「启动」，然后关掉显示器去睡觉。

```
Round 1: 体检   → 全量扫描目录，把每个节点标成 已完成 / 未看完 / 未解锁
Round 2: 跳课   → 自动跳过已完成的，只学没看完的（未解锁的点了也没用，跳过）
Round 3: 播放   → 静音 + 倍速（上限 1.8）+ 防暂停 + 进度回退重试
Round 4: 续播   → 进度写进 GM_setValue，关页面/断网/重启浏览器都能接回原处
Round 5: 答题   → 弹题/作业/章节测试：题库优先 → LLM 兜底 → 离线启发式兜底
Round 6: 回填   → 填进页面控件后再读回来校验一次，没填上就重试
Round 7: 收尾   → 全部看完弹总结卡片，自动停止（真看完了才写「全部看完」）
```

> ⚠️ **它不做**：不主动跳到作业页 / 考试页（只在你自己点进去时作答）、不拖动播放器进度、不在没把握时替你瞎勾答案。详见 [安全边界](#-安全边界--security-boundary)。

---

## 🎬 特性 / Features

- **🔁 断点续播引擎 (Resume Engine)** —— 进度写进 `GM_setValue`（跨 iframe / 跨页面共享、落盘持久化），无 GM 环境自动降级 `localStorage`；关页面、关浏览器、断网重开都能从上次位置继续。`src/04-resume.js`
- **🎯 不瞎蒙闸门 (No-Guess Gate)** —— 答案必须来自「题库命中 / LLM 生成 / 离线启发式」三条真实通道之一；三条都拿不到就留空转人工。所有"随机猜"路径受 `gatedRandom` 管制且**默认关闭**。`src/11-solver.js`
- **🧭 五套页面适配层 (Version Adapter)** —— 智慧树 5 套并存页面结构（wisdom / fusion / hike / legacy / card2025）统一成同一组方法；万一改版导致预设选择器全落空，自动启用**结构兜底扫描**（不猜类名，从 DOM 结构反推目录）。`src/02-adapter.js`
- **🐕 防卡死看门狗 (Stall Watchdog)** —— 单点触发器都有盲区：「整体无进展但没一个触发器命中」也照样能被抓到并恢复，这是最后一道防线。`src/02d-guard.js`
- **⚡ 双通道求解器 (Dual-Channel Solver)** —— 题库（`TikuAdapter` 标准协议）优先，LLM（OpenAI 兼容，默认 DeepSeek，超时给足 45s/70s）兜底，零网络零 Key 时还有**离线启发式**第三层。`src/09-bank.js` `src/10-llm.js` `src/11b-heuristic.js`
- **🛡️ 守株待兔式作业模式 (Passive Exam Mode)** —— 只在**你已经身处**作业 / 考试页时才作答，绝不主动导航过去；这是项目红线。`src/06c-exam.js`
- **📊 真实统计层 (Honest Stats)** —— 面板能回答两个你真会问的问题：「今天答了几题、答案都是哪来的」「学了多久」；通道来源逐条可查（题库 / LLM / 缓存 / 失败）。`src/14-stats.js`
- **🧩 Shadow DOM 面板 (Isolated Panel)** —— 悬浮面板用 Shadow DOM 隔离样式，不污染网课页面、不被页面 CSS 反向破坏。`src/06-panel.js`

---

## 🎬 快速开始 / Quick Start

### 安装

> 先装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome / Edge / Firefox 都行），下面三条路线任选一条。

**路线 A：一键安装（推荐 · 不用装 Node）**

打开 [jsDelivr 一键安装直链](https://cdn.jsdelivr.net/gh/huanweide/zhihuishu-helper@master/dist/zhihuishu-helper.user.js) → 油猴会自动弹出安装确认 → 点「安装」完事。

**路线 B：下载稳定版（不用装 Node）**

到 [Releases](https://github.com/huanweide/zhihuishu-helper/releases) 下载 `zhihuishu-helper.user.js` 附件，把文件拖进浏览器即装。

**路线 C：从源码构建（要改代码才需要）**

```bash
git clone https://github.com/huanweide/zhihuishu-helper.git
cd zhihuishu-helper
npm install
node build.js          # 生成 dist/zhihuishu-helper.user.js
```

然后用 Tampermonkey 打开 `dist/zhihuishu-helper.user.js` 即装。完整图文见 [安装说明](docs/20-使用说明.md)。

### 一次性跑起来

```bash
node build.js
```

```
=== 构建 zhihuishu-helper v0.6.67 ===
  + 00-config.js
  + 01-util.js
  ...
  + 14-stats.js
[ok] 已生成 dist/zhihuishu-helper.user.js（21 模块）
```

### 自检（改完代码必跑的门禁）

```bash
node build.js                      # ① 构建：src/*.js 按序拼装 → dist/*.user.js
node tools/check-dist-fresh.js     # ② 校验 dist 与 src 一致（漏 build 会被挡下）
node tools/check-test-registry.js  # ③ 测试组登记检查（异步组漏 await = 假绿）
node test/run.js                   # ④ 逻辑单测（jsdom + vm 模块注入）
node tools/check-docs-consistency.js --tests 735  # ⑤ 文档一致性（版本号/测试数不漂移）
node test/screenshot.js            # ⑥ 截屏测试（需真机 Chrome，本地手动跑）
```

```bash
$ node tools/check-dist-fresh.js
[ok] dist 与 src 一致（21 模块, v0.6.67）

$ node test/run.js
==================================================
通过 735 / 失败 0
全部通过 ✓
```

> 第 ⑥ 条依赖真机浏览器，因此**不在 CI 里跑**；它的定位是「真机视觉验证」，不是门禁。CI 跑 ①~⑤：
> 第 ③ 条静态扫出「没被 await 的异步测试组」（漏 await = 断言漏计 + 失败不变红 = 假绿，实测抓出过 7 个）；
> 第 ⑤ 条拿第 ④ 条实跑出的通过数校验 README 上的数字，杜绝「版本升了、文档还写上一版」的漂移（实测已犯过两次）。
> 这也是 CI 徽章的真实依据。

---

## 🎬 控制台 API 速查

按 `F12` 打开控制台：

| 命令 | 用途 |
|------|------|
| `zhs.start()` | 启动主循环 |
| `zhs.stop()` | 停下所有自动化动作 |
| `zhs.next()` | 手动跳到下一个未完成章节 |
| `zhs.learn()` | 手动触发「找下一门没学完的课」 |
| `zhs.gotoLesson(3)` | 直接跳到第 3 个课时 |
| `zhs.stats()` | 课程完成统计 |
| `zhs.logs()` | 全部日志（数组） |
| `zhs.clearResume()` | 清除本课程的续播记录 |
| `zhs.config({ speed: 1.5 })` | 改配置（倍速上限 1.8） |
| `window.ZHS.Resume.list()` | 看所有续播记录 |
| `window.ZHS.Solver.stats` | 答题统计：题库命中几次、LLM 几次 |
| `window.ZHS.Bank.ping()` | 测题库通道连通性 |
| `window.ZHS.LLM.test()` | 测 LLM 通道连通性 |

---

## 🎬 架构 / Architecture

默认引擎是**「识别 → 播放 → 答题 → 切集」的 2 秒主循环 + 分层兜底**，不是一把梭的单文件脚本：21 个模块按链路拼装，每层只做一件事，且每层都有降级路径。

### 核心概念

| 概念 | 含义 |
|------|------|
| 页面版本 (version) | 智慧树 5 套并存页面结构之一；适配层统一成同一组方法，上层无感 |
| 断点 (resume point) | 一节课的播放位置，存 `GM_setValue`，跨 iframe / 落盘持久化 |
| 通道 (channel) | 答案来源：题库 / LLM / 离线启发式 / 缓存。没有第五种 |
| 闸门 (gate) | 回填前后各校验一次，「没真填上」就不算答完 |
| 看门狗 (watchdog) | 抓「整体无进展但单点触发器都没命中」的盲区 |
| 守株待兔 (passive) | 只在用户已在作业 / 考试页时作答，绝不主动导航过去 |

### 主循环

```
           ┌──────────────── 每 2s 一次 ────────────────┐
           ▼                                            │
      [ 守卫检查 ] ── 安全验证(易盾滑块)? ──▶ 暂停 + 提示手动完成
           │
           ▼
      [ 保活播放 ] ── 被暂停? ──▶ 自动恢复 + 静音 + 倍速
           │
           ▼
      [ 弹题检测 ] ── 有弹题? ──▶ 采集 → 求解 → 回填 → 校验
           │                          │
           │                          └─ 三通道都无解? ──▶ 留空转人工（不瞎蒙）
           ▼
      [ 结束判断 ] ── 本节放完? ──▶ 记完成 → 切下一节
           │
           ▼
      [ 全部完成? ] ── 是 ──▶ 弹总结卡片 + 自动停止
           │
           └──── 否 ────────────────────────────────────┘
```

### 核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| 配置与共享状态 | `src/00-config.js` | 单一 `ZHS` 命名空间，不污染页面全局 |
| 工具 | `src/01-util.js` | DOM 等待、可见性检测、节流、随机延迟 |
| 适配层 | `src/02-adapter.js` | 识别 5 套页面版本，统一目录访问接口 |
| 看门狗 | `src/02d-guard.js` | 全局防卡死兜底 |
| 导航 | `src/02e-nav.js` | 切集 / 跳课导航 |
| 播放层 | `src/03-player.js` | 静音、倍速、防暂停、进度回退重试 |
| 续播层 | `src/04-resume.js` | 断点记录与恢复（`GM_setValue` → `localStorage` 降级） |
| 调度层 | `src/05-scheduler.js` | 2 秒主循环 + 弹窗守卫 |
| 面板 | `src/06-panel.js` | Shadow DOM 隔离的悬浮控制面板 |
| 课程中心调度 | `src/06b-course-hub.js` | 自动选未看完的课、学完自动跳下一门 |
| 作业/考试 | `src/06c-exam.js` | 守株待兔式作答 |
| 主入口 | `src/07-main.js` | 初始化 + SPA 路由监听 |
| 题目采集 | `src/08-questions.js` | 三种场景（课中弹题 / 共享课作业 / hike 作业）抽结构化题目 |
| 题库客户端 | `src/09-bank.js` | `TikuAdapter` 标准协议客户端 |
| LLM 客户端 | `src/10-llm.js` | OpenAI 兼容接口 + 多次生成投票 |
| 求解层 | `src/11-solver.js` | 双通道编排：题库优先 → LLM 兜底 |
| 离线启发式 | `src/11b-heuristic.js` | 零网络 / 零 Key / 零题库时的第三层兜底 |
| 回填层 | `src/12-filler.js` | 填进控件并回读校验 |
| 答题编排 | `src/13-answerer.js` | 采集 → 求解 → 回填 串成完整流程 |
| 统计层 | `src/14-stats.js` | 答题记录 + 学习时长统计 |
| 在场感知 | `src/15-presence.js` | 用户在场检测与让权基座（活动/聚焦态监听） |

详细的平台侦察、选择器实测表与参考项目调研见 [开发者笔记](docs/40-开发者笔记.md)，模块地图见 [PROJECT_MAP](docs/PROJECT_MAP.md)。

---

## 🎬 加一个你自己的求解通道

求解层是「通道列表 + 依次尝试」的结构，加一条通道不用碰播放和调度：

```js
// 在 src/11-solver.js 的通道链里插入你自己的通道
ZHS.Solver.channels.push({
  name: 'my-bank',                       // 面板统计里显示的名字
  async solve(q) {                       // q = { question, options[], type }
    const r = await fetch('https://my-bank.example/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q.question, options: q.options, type: q.type })
    });
    const d = await r.json();
    // 拿不到就返回 null —— 让链路继续往下走绝不留空猜
    return d.answer ? { answer: d.answer, source: 'my-bank' } : null;
  }
});
```

> 铁律：你的通道**拿不到答案时必须返回 `null`**，绝不能返回随机选项。这是「不瞎蒙」闸门的地基。

---

## 🎬 路线图 / Roadmap

- [x] 自动播放（静音 + 倍速 + 防暂停 + 自动下一节/章）
- [x] 断点续播（跨 iframe / 跨页面 / 断网恢复）
- [x] 双通道答题（题库 + LLM）+ 离线启发式第三层
- [x] 全自动学习引擎（进课程中心自动选课、学完自动跳下一门）
- [x] 人类化与防检测（在场让权：你在场不代劳；拟人节奏：随机思考延迟 + 抖动主循环；反暴力重试：弹窗关不掉即转人工）
- [x] 735 项逻辑单测 + 70 项截屏测试
- [x] 五套页面版本适配 + 结构兜底扫描
- [ ] 更多平台的题库协议适配（目前仅 `TikuAdapter` 标准协议）
- [ ] 面板多主题 / 自定义配色
- [ ] 章节测试的批量导出与复盘
- [ ] 真机 E2E 纳入 CI（当前依赖真机 Chrome，仅本地跑）

---

## 🤝 开源协作 / 接受帮助

**本项目欢迎一切建设性帮助，并认真接纳每一份贡献。** 无论你是来报 bug、提需求、改代码还是补文档，都先开 issue 聊聊，比直接甩一个大 PR 更容易被接受。

**我们尤其需要这几类帮助 🤝**
- 🐛 **报 bug（带日志）**——附脚本版本、页面版本代号（wisdom / fusion / hike / legacy / card2025）和面板「日志」页内容；[缺陷报告模板](.github/ISSUE_TEMPLATE/bug_report.md)已备好。
- 💡 **新功能 / 改进建议**——从日常使用痛点出发，开 issue 打 `enhancement`；[功能建议模板](.github/ISSUE_TEMPLATE/feature_request.md)已备好。
- 🧩 **适配新页面版本**——智慧树改版后预设选择器可能失效，欢迎来补适配或结构兜底。
- 🔌 **新增求解通道**——接你自己的题库 / 校内答案源（见[加通道](#-加一个你自己的求解通道)），记住铁律：解不出必须返回 `null`，绝不瞎蒙。
- 📝 **文档 / 翻译**——把使用说明、踩坑记录写得更清楚，或帮忙做英文文档。
- ✅ **测试用例**——给 `test/run.js` 补更多判别测试，守住"绝不 seek / 绝不瞎蒙 / 让权"等红线。

开工前请先读 [贡献指南](CONTRIBUTING.md)——里面写了模块结构、四条门禁命令，以及**四条不可触碰的红线**（尤其「绝不自动跳考试页」与「绝不替用户瞎蒙答案」）。参与即视为同意 [行为准则](CODE_OF_CONDUCT.md)。

---

## 🎬 安全边界 / Security Boundary

本项目**永远不会**做以下事情：

1. **绝不自动跳转到作业页 / 考试页** —— 只守株待兔：你在作业/考试页时它才作答，绝不主动导航过去。
2. **绝不 seek（拖动）播放器进度** —— 进度超前只告警，不回退、不快进。
3. **绝不替用户瞎蒙答案** —— 所有"无答案时随机猜"的路径受 `gatedRandom` 管制且默认关闭；宁可留空交人工。
4. **不写凭据进仓库** —— API Key 只走用户本地配置，任何 key / token / cookie 不得进代码或文档。

此外：仅限个人学习研究使用，禁止商用与传播；使用风险自负。使用者应遵守智慧树平台服务条款及其所在学校规定。

---

## 🎬 已知限制

- **浏览器可以缩小，但不要最小化** —— 浏览器对不可见标签页会把定时器节流到 1 次/分钟，脚本主循环会被冻住。
- **倍速上限 1.8** —— 超过会被平台判定异常。
- **截屏测试（70 项）依赖真机 Chrome**，仅在本地手动执行，CI 不跑。
- 智慧树改版后预设选择器可能失效，此时依赖结构兜底扫描，精度可能不如专门适配。

---

## 🎬 文档

| 文档 | 内容 |
|------|------|
| [安装与使用说明](docs/20-使用说明.md) | 3 步装好、配置说明、常见问题 |
| [自动学习引擎方案](docs/30-自动学习引擎方案.md) | 全自动学习链路设计与红线边界 |
| [平台侦察报告](docs/01-侦察报告.md) | 页面结构、选择器、实测结论 |
| [技术方案](docs/02-技术方案.md) | 模块架构、三条主线设计 |
| [踩坑记录](docs/03-踩坑记录.md) | 真机问题与排查顺序 |
| [GitHub 生态调研](docs/06-GitHub生态全景调研.md) | 同类项目横向对比 |
| [开发者笔记](docs/40-开发者笔记.md) | 平台侦察 + 参考项目调研 + 能力 Benchmark |
| [模块地图](docs/PROJECT_MAP.md) | 21 个模块按链路排列 + 四条门禁命令 |
| [更新日志](CHANGELOG.md) | 每个版本改了什么、为什么 |

---

## 🎬 License

[MIT](LICENSE) © huanweide

---

## ⭐ Star

如果这个脚本帮你把网课刷完了，点个 Star 就是最大的支持 —— 它决定了这个项目能被多少同样被网课折磨的人看到。

[![Star](https://img.shields.io/github/stars/huanweide/zhihuishu-helper?style=social)](https://github.com/huanweide/zhihuishu-helper)


---

## 🧰 更多开源工具（by huanweide）

- 🎬 字幕 / 视频：[bili-subtitle-universal](https://github.com/huanweide/bili-subtitle-universal) · [live-subtitle](https://github.com/huanweide/live-subtitle) · [video-brief](https://github.com/huanweide/video-brief)
- 🩺 代码健康全家桶（18 轴零依赖 CLI）：[family-showcase](https://github.com/huanweide/family-showcase)
- ✍️ 写小说：[novel-smith](https://github.com/huanweide/novel-smith) · AI 小说工坊（本地优先，零云端依赖）
- 🔧 命令行利器：[idiot-index](https://github.com/huanweide/idiot-index) · [recall-cli](https://github.com/huanweide/recall-cli) · [forge-safeguard](https://github.com/huanweide/forge-safeguard-20260812)
- 🖥️ 桌面 / 资讯：[floatsnip](https://github.com/huanweide/floatsnip) · [tech-news-hub](https://github.com/huanweide/tech-news-hub)
- 📦 全部仓库：<https://github.com/huanweide?tab=repositories>

## 🧰 同一作者的其他工具

> 作者在做一系列开源效率工具，欢迎顺手点 Star 支持：

- 📚 长篇创作 — AI 小说工坊，本地规则引擎零依赖：[点此访问](https://github.com/huanweide/novel-smith)
- 🎬 字幕/视频 — B站字幕一键提取（零 Key 取官方字幕）：[点此访问](https://github.com/huanweide/bili-subtitle-universal)
- 📺 实时字幕 — 直播/会议实时字幕：[点此访问](https://github.com/huanweide/live-subtitle)
- ✂️ 视频摘要 — 长视频一键总结：[点此访问](https://github.com/huanweide/video-brief)
- 🖥️ 总览 — 作者全部开源项目集散：[点此访问](https://github.com/huanweide/family-showcase)
- 🩺 代码健康 — 零依赖多轴静态体检：[点此访问](https://github.com/huanweide/doctors)
