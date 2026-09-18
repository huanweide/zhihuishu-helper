# 智慧树网课助手（zhihuishu-helper）

> 目标：在**智慧树（zhihuishu.com / 知到）**平台上实现
> ① 自动播放 ② 断点续播 ③ AI 自动答题
>
> 仅限个人学习研究使用，禁止商用与传播。使用风险自负。

---

## 一、项目目标（三条主线）

| 编号 | 功能 | 说明 | 优先级 |
|------|------|------|--------|
| F1 | 自动播放 | 自动静音 + 倍速 + 防暂停 + 自动下一节/下一章 | P0 |
| F2 | 断点续播 | 关闭页面/浏览器/断网后重新打开，自动从上次位置继续 | P0 |
| F3 | AI 自动答题 | 课中弹题 + 章节测试 + 作业，OCR/文本取题 → LLM 生成答案 → 自动勾选 | P1 |

---

## 二、平台侦察结论（2026-09-17 实测抓取）

### 2.1 智慧树的页面家族（关键：**网址格式不固定，播放页 UI 分多套**）

| 版本代号 | 域名 / 路径 | 目录选择器（当前项标识） | 完成标识 |
|----------|-------------|--------------------------|----------|
| **wisdom** 智慧版 | `studyvideoh5.zhihuishu.com/stuStudy` | `.child-info.hasvideo`（`.current`） | `.child-check` |
| **fusion** 翻转课/AI课 | `fusioncourseh5.zhihuishu.com/stuStudy` | `.chapter-content-second`（`.current`） | `.finish-icon` |
| **hike** 新形态/AI教学中心 | `hike.zhihuishu.com` | `.file-item`（`.active`） | `.icon-finish` |
| **legacy** 旧版 | 老共享课 | `.clearfix.video`（`.current_play`） | `.time_icofinish` |
| 2025-09 新共享课 | `studywisdomh5.zhihuishu.com/study/index` | 卡片式 `[class*="card-container"]` | `.finished-icon` |
| 新共享课 | `studyplush5.zhihuishu.com` | 需实测 | 待测 |

> 用户本次提供的是 `studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=...`，
> 属于 **wisdom 智慧版**（`recruitAndCourseId` 是共享课特征参数）。

### 2.2 视频元素与控制器选择器（旧版共享课，实测有效）

| 用途 | 选择器 |
|------|--------|
| 播放器本体 | `video`（全局唯一） |
| 播放/暂停按钮 | `.playButton` |
| 音量盒 | `.volumeBox` / `.volumeIcon` |
| 倍速盒 | `.speedBox` / `.speedTab15`（1.5倍）/ `.speedList [rate="1.5"]` |
| 清晰度（流畅） | `.definiBox` / `.line1bq` |
| 进度条 | `.current_play .progressbar` / `.progressbar_box` |
| 章节条目 | `.clearfix.video`（旧）/ `.child-info.hasvideo`（新） |

### 2.3 课中弹题（`#playTopic-dialog`）

```
容器:    #playTopic-dialog
题目分页: #playTopic-dialog .el-pager .number
选项:    #playTopic-dialog ul .topic-item
选项按钮: #playTopic-dialog .topic .radio ul > li:nth-child(N)
关闭:    #playTopic-dialog .close-btn, #playTopic-dialog .btn
```

### 2.4 作业/考试答题页

| 页面 | 地址特征 | 题干选择器 | 选项选择器 |
|------|----------|-----------|-----------|
| 共享课作业 | `stuExamWeb.html#/webExamList/dohomework` | `.subject_node` / `.question-topic` | `.nodeLab` / `label` |
| 共享课考试 | `stuExamWeb.html#/webExamList/doexamination` | 同上 | 同上 |
| hike 作业 | `/stu/answer-homework` | `.question-topic` | `label` |
| hike 考试 | `/stu-exam/answer-exam` | `.question-topic` | `label` |
| 校内课作业 | `/atHomeworkExam/stu/homeworkQ/exerciseList` | - | - |

题型判定（从页面文本读）：
- `单选题` → single
- `多选题` → multiple
- `判断题` → judgement（选项为"对/错"）
- `填空题` → completion（填 `textarea`）

---

## 三、参考项目调研（GitHub 实测星数，2026-09-17）

| 项目 | 星 | 语言 | 实现方式 | 可借鉴点 |
|------|---|------|----------|----------|
| [ocsjs/ocsjs](https://github.com/ocsjs/ocsjs) | 3428 | TS | 油猴脚本 | **最完整**：5 套智慧树页面适配 + 题库适配器架构 + 题型判定 |
| [CodFrm/cxmooc-tools](https://github.com/CodFrm/cxmooc-tools) | 2695 | TS | 浏览器扩展 | 扩展工程化、题库接口 |
| [VermiIIi0n/fuckZHS](https://github.com/VermiIIi0n/fuckZHS) | 2280 | Python | 自动化 | Python 全自动方案 |
| [CXRunfree/Autovisor](https://github.com/CXRunfree/Autovisor) | 873 | Python | Playwright | **进程级自动化**：防检测、验证码、进度同步回退重试 |
| [DokiDoki1103/tikuAdapter](https://github.com/DokiDoki1103/tikuAdapter) | 543 | Go | 题库聚合 | **题库适配器**：统一 API，聚合 icodef/不挂科 等免费源 |
| [perhaps-yo/zhihuishu](https://github.com/perhaps-yo/zhihuishu) | 264 | JS | Chrome 扩展 | 最简自动下一集（`chapter-tree-74` 选择器） |
| [wangzexi/ZhiHuiShu-Assistant](https://github.com/wangzexi/ZhiHuiShu-Assistant) | 260 | JS | 控制台注入 | 最简：倍速+静音+弹题+切课，54 行 |
| [king-wang123/ZHIHUISHU-Auto-Answer-Assistant](https://github.com/king-wang123/ZHIHUISHU-Auto-Answer-Assistant) | 127 | Python | Selenium+LLM | **LLM 答题**：截图 → OCR → 大模型 → 多次生成投票取稳定答案 |
| [greasyfork 558335](https://greasyfork.org/zh-CN/scripts/558335) | - | JS | 油猴 | 2.3KB 极简：`.file-item.active` + `muted` 绕自动播放策略 |

### 3.1 三方方案对比（对本次目标的适配度）

| 维度 | 油猴脚本（ocsjs 类） | Playwright 自动化（Autovisor 类） | 结论 |
|------|---------------------|----------------------------------|------|
| 部署难度 | 低（装油猴即用） | 中（需 Python + 浏览器内核） | 油猴胜 |
| 防检测 | 弱（同页面上下文） | 强（独立进程，stealth 注入） | Autovisor 胜 |
| 断点续播 | 需自己做持久化 | 天然支持（脚本控制生命周期） | Autovisor 胜 |
| AI 答题 | 需跨域调用 API | 无跨域限制 | Autovisor 胜 |
| 用户操作 | 浏览器内跑 | 需开脚本、可能挡屏幕 | 油猴胜 |

**建议路线**：**油猴脚本为主（F1+F2+F3全部塞进一个 user.js）**，理由是零部署、用户可随时开关；
Playwright 作为**兜底方案**（浏览器无法常驻时）。当前先做油猴版。

---

## 四、技术方案设计

### 4.1 架构（油猴脚本版）

```
zhihuishu-helper.user.js
├── core/
│   ├── adapter.js      # 多版本页面适配层（自动识别 wisdom/fusion/hike/legacy）
│   ├── video.js        # 播放控制：静音、倍速、防暂停、自动下一节
│   ├── resume.js       # 断点续播：localStorage 记录 + 重启恢复
│   ├── question.js     # 题目抓取：弹题/作业/考试三种场景统一抽象
│   ├── solver.js       # 答题引擎：题库搜索 → LLM 兜底 → 答案回填
│   └── ui.js           # 悬浮控制面板（开关、状态、日志）
├── api/
│   ├── tiku.js         # 题库适配器客户端（对接 TikuAdapter 标准格式）
│   └── llm.js          # LLM 客户端（DeepSeek / 任意 OpenAI 兼容接口）
└── config.js           # 用户配置（API Key、倍速、开关项）
```

### 4.2 断点续播设计（F2 核心）

**存储**：`localStorage['zhs_helper_resume']`，结构：

```json
{
  "courseId": "4e5f5b5c4c5b4859454a585958435f475a",
  "lessonKey": "章节名|课时名",
  "videoTime": 372.5,
  "updatedAt": 1758114459000
}
```

**恢复流程**：
1. 页面加载 → 读 storage → 如果 `courseId` 匹配且有记录
2. 定位到记录的章节条目（`.child-info.hasvideo` 文本匹配 `lessonKey`）→ 点击
3. 等 `video` 元素 `loadedmetadata` → `video.currentTime = videoTime - 2`（回退 2 秒保险）
4. 播放中每 5 秒写一次 storage（节流）

**关键坑**：智慧树是 SPA + iframe 结构，切课会触发页面重载或 DOM 重建，
storage 必须写在**顶层 window**（`window.top.localStorage`）才能跨课持久化。

### 4.3 AI 答题设计（F3 核心）

**双通道策略**：

```
题目 ──┬─→ 通道A：题库搜索（TikuAdapter，快、准、免费优先）
       └─→ 通道B：LLM 生成（兜底，DeepSeek API）
```

**通道 A**：本地起 TikuAdapter（`:8060`），POST `/adapter-service/search`
- 请求：`{question, options[], type}`
- 免费源：icodef、不挂科（百度教育）

**通道 B**：调 LLM（复用 king-wang123 的"多次生成投票"思路）
- Prompt 模板（已验证有效）：
  ```
  单选题 → 仅输出 A/B/C/D
  多选题 → 仅输出 A,C（逗号分隔，字母序）
  判断题 → 仅输出 对 或 错
  ```
- **稳定性增强**：同一题生成 N 次，取**出现次数最多的答案**（避免模型随机性）
- 无选项文本时（图片题）：`html2canvas` 截图 → OCR → 文本 → LLM

**答案回填**：
- 单选题：`option[i].click()` 后校验 `input.checked`
- 多选题：逐个 click
- 判断题：按文本匹配"对/错"定位
- 填空题：写 `textarea.value` + 触发 `input` 事件

### 4.4 反检测注意事项（实测踩坑）

1. **不要最小化浏览器** —— 会导致 `requestAnimationFrame` 停摆、脚本卡死
2. **不要与其他脚本混用** —— 答案选不上/页面卡死
3. **验证码（滑块）** —— 智慧树会弹 `yidun_popup`，检测到需**手动过**，脚本暂停等待
4. **进度同步** —— 播放器进度可能快于平台记录，需回退到平台记录点重播（Autovisor 的做法）
5. **习惯分** —— 每天定时学 30 分钟得 1 分，如不需要可忽略

---

## 五、目录结构

```
zhihuishu-helper/
├── README.md              # 本文件：调研结论 + 方案设计
├── CHANGELOG.md           # 更新日志（含踩坑与限制）
├── build.js               # 构建：src/*.js 按序拼装 → dist/*.user.js
├── docs/
│   ├── PROJECT_MAP.md     # 项目索引：文档地图 + 代码地图 + 速查
│   ├── 01-侦察报告.md      # 平台页面结构与选择器明细
│   ├── 02-技术方案.md      # 详细设计（本 README 第四章的展开）
│   ├── 03-踩坑记录.md      # 20 个实测问题（现象/根因/解决/来源）
│   ├── 11-测试报告.md      # 两层测试体系 + 断言明细
│   ├── 20-使用说明.md      # 安装、面板、控制台 API、排障手册
│   └── 90-快照与回溯.md    # 三层快照机制
├── src/                   # 正式源码（16 模块，按序拼装）
├── test/                  # 测试：逻辑单测 + 截屏测试 + 真实站点测试
│   ├── run.js             #   逻辑单测 244 项（jsdom）
│   ├── screenshot.js      #   截屏测试 70 项（puppeteer-core + Chrome）
│   ├── live-run.js        #   真实站点测试入口（login/recon/e2e）
│   ├── fixture-media.js   #   媒体打桩（解决 duration=Infinity）
│   └── fixture-*.html     #   仿真页面
├── tools/
│   ├── snapshot.sh        #   三层快照
│   ├── probe.js           #   内部状态诊断
│   └── verify-exam.js     #   在线作业/考试作答页验收（35 项断言）
├── dist/                  # 构建产物（git 忽略）
├── reference/             # 参考项目源码 + 实测抓取（只读，git 忽略）
└── snapshot/              # 项目快照（tar/bundle，git 忽略）
```

### 快速开始

```bash
node build.js                                    # 构建
node test/run.js                                 # 逻辑单测（160 项）
node test/screenshot.js                          # 截屏测试（70 项）
node test/live-run.js login                      # 真实站点：人工登录
node test/live-run.js e2e                        # 真实站点：端到端测试
```

安装使用见 **[`docs/20-使用说明.md`](docs/20-使用说明.md)**。

---

## 六、里程碑

- [x] M0 情报侦察：摸清智慧树 5 套页面结构 + 参考项目调研
- [x] M1 项目骨架：目录、文档、Git 快照机制
- [x] **M2 自动播放（F1）+ 断点续播（F2）+ 控制面板（F6）**
- [x] **M4 AI 答题（F3）：题库通道 + 双通道编排**
- [x] **M5 AI 答题（F3）：LLM 通道 + 投票 + 端到端截屏测试**
- [x] **v0.1.0 首个可用版本：211 项测试全绿**
- [x] **v0.2.0 自动化闭环：三态识别 + 自动跳未看完 + 全完成总结 + 弹题自动关闭 + polymas 适配**
- [x] **v0.2.1 闭环加固：启动预检 + 抗改版结构兜底 + 修 3 处真 bug，293 项测试全绿**
- [x] **M6 在线作业/考试自动答题（守株待兔模式，默认关闭，绝不自动跳转）**
- [ ] M7 真实站点端到端验证（需登录态）
- [ ] M8 面板打磨：答题记录页、通道健康检测、习惯分统计

**测试门禁**：逻辑单测 244/244 + 截屏测试 70/70 = **314 项全绿**

### M6 补充说明：为什么是「守株待兔」而不是「主动出击」

用户明确要求：

> 「不要自动进入，可以设置一个设置默认关闭，自动完成待测任务作业考试」
> 「并不自动进入考试界面跳转，配置剔除自动进入」

所以 `src/06c-exam.js` 的行为边界是：

| 做 | 不做 |
|---|---|
| 用户在作业/考试页时自动答完并提交 | ❌ 绝不自动跳转到作业/考试页 |
| 提供总开关，**默认关闭** | ❌ 不扫描发现未完成作业然后自己跳过去 |
| 提供章节范围选择 | ❌ 不做「答完一个跳到下一个」的循环 |
| 只答在范围内、且是客观题的题 | ❌ 主观题（填空/问答）不瞎填，只 warn |

**硬性红线（写进代码注释，勿越界）**：
不调用 `location.href` / `location.replace` / `window.open`；
不点击列表页的 `.jobExamComBtn`（开始答题）/ `.course_ewstate`（进入作业）。
`tools/verify-exam.js` 的 G 组会用正则扫描源码，确保这些红线不被误加回来。

**复用的既有能力**（避免重复造轮子）：
- 取答案 → `ZHS.Solver.solve({title, options, type})`（内部已实现题库优先 + LLM 兜底 + 缓存 + gatedRandom 策略）
- 题型识别 → `ZHS.Questions.guessType` 同源的解析逻辑
- 选中态自检 → `ZHS.Filler.isChecked(el)`
- 答案归一化 / 字母转索引 → `ZHS.Bank.normalize` / `ZHS.Bank.toIndexes`
- 请求层 → `ZHS.Bank.request`（GM_xmlhttpRequest 绕 CORS）

---

## 七、免责声明

本项目仅供**个人学习与技术研究**，用于理解浏览器自动化、DOM 操作、LLM 应用集成。
使用者应遵守智慧树平台服务条款及其所在学校规定。因使用本项目产生的任何后果，
由使用者自行承担。
