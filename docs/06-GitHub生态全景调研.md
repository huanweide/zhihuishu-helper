# GitHub 网课自动化生态全景调研（智慧树专题 + 浏览器操控前沿）

> 调研日期：2026-10-21 ｜ 方式：GitHub API 实抓 40+ 仓库 README/源码 + 5 组 WebSearch 专题 + 项目存量 `reference/` 克隆交叉验证
> 目的：为 zhihuishu-helper 找可借鉴架构、摸清生态全貌、绘制风险地图
> 边界声明（本项目铁律）：只做**平时作业/章节练习/单元测试**辅助；正式监考考试代答不碰；不商业化

---

## 〇、TL;DR（一分钟版）

1. **生态比想象的大**：GitHub 上智慧树/超星/雨课堂自动化项目 50+ 个，头部 ocsjs 3888★、Samueli924/chaoxing 3649★、cxmooc-tools 2716★、fuckZHS 2481★、Autovisor 1027★；通用验证码识别 ddddocr 14856★、AI 浏览器代理 browser-use 118749★。
2. **技术路线三流派**：① 油猴 DOM 脚本流（本项目所在，隐身性最优）；② Python 协议逆向流（fuckZHS/Samueli924，快但怕平台改接口）；③ Playwright/PyWebView 浏览器流（Autovisor/666cy666，折中）。**没有银弹，只有取舍**。
3. **本项目架构选择被验证为隐身最优**：Tampermonkey 跑在用户日常浏览器里 `navigator.webdriver=false`，而 Playwright/CDP 拉起的浏览器这个标志是 `true`——这是反检测的第一道门，本项目天然在最隐蔽的一侧。
4. **真威胁不是技术是风控**：智慧树有「异常学习日志」制度，检测手段 = 学习时长不足 + IP 跨度 + 做题时长 + seek 跳跃（触发腾讯 Turing 滑块）。**不 seek、倍速 ≤1.5、真实播放**这三条本项目已守住，是生死线。
5. **法律风险分层清晰**：个人自用辅助 = 违反平台协议/校规（学习记录有被清零先例，桂林理工一次 2000+ 条）；商业代刷 = **刑事**（黑龙江肇州案 7 人被抓，首例代刷网课刑案）；开源仓库本身有被律师函/404 先例（WAADRI 删库、fuckZHS 曾被下架）。**本项目「自用+不商业化+不碰监考」定位已是风险最低姿态，务必保持**。
6. **最值得抄的 5 个东西**：tikuAdapter 题库适配器标准格式（本项目 bank 端口 8060 已天然对标）、Cooanyh 的「Gist 题库 + Levenshtein 90% 模糊 + 未命中回落 AI」、zhs-assistant 的 0~60s 随机人类延迟、ddddocr 字母验证码 98% 识别（目标检测+阈值调优）、maomao1996 的 metablock 版本单一来源工程化。

---

## 一、生态全景图（50+ 项目分类台账）

### 1.1 智慧树/知到赛道（15 个，直接竞品/参考）

| 项目 | ★ | 技术路线 | 答题能力 | 验证码应对 | 活跃度 | 对本项目价值 |
|---|---|---|---|---|---|---|
| ocsjs/ocsjs | 3888 | 油猴多平台（`zhihuishu_all_version/` 多版本适配目录） | 题库+考试 | 自动打码 | 今天更新 | ⭐⭐⭐ 多版本适配架构对标 |
| CodFrm/cxmooc-tools | 2716 | 扩展+油猴+火狐三渠道 | 题库+考试答题 | 自动填写验证码 | 今天更新 | ⭐⭐ 题库众筹模式、免责声明范式 |
| Samueli924/chaoxing | 3649 | Python 协议流 CLI | 可插拔题库 provider（言溪等） | — | 活跃 | ⭐⭐⭐ submit=false 只存不交模式 |
| VermiIIi0n/fuckZHS | 2481 | Python 协议流（绕开混淆前端） | 弹题 | 无 | 活跃 | ⭐⭐⭐ 后端 API 路线细节、风控参数 |
| CXRunfree/Autovisor | 1027 | Python Playwright（免安装版） | — | 半自动（弹图等人输） | 今天更新 | ⭐⭐ 已存 `reference/autovisor` |
| perhaps-yo/zhihuishu | 264 | 油猴 | 无（仅播放） | 无 | 活跃 | ⭐ 简洁范本 |
| wangzexi/ZhiHuiShu-Assistant | 265 | 油猴（console 粘贴） | 关弹题 | 无 | 活跃 | ⭐⭐⭐ **0~60s 随机人类延迟** |
| destoryD/chaoxing-api | 263 | 题库 API 服务（datam.site） | 题库98% | — | 活跃 | ⭐⭐ 题库即服务 |
| king-wang123/ZHIHUISHU-Auto-Answer-Assistant | 128 | Python + LLM | LLM 多次生成 | — | 2025 停更 | ⭐⭐ 已存 `reference/zhs-llm-answer` |
| yanyongyu/CXmoocSearchTool | 124 | 查题软件 | 题库 | — | 一般 | ⭐ |
| Bao-qing/zhihuishu | 81 | 逆向刷课 | — | — | 今天更新 | ⭐⭐ |
| zhixiaobai/Python-zhihuishu | 61 | Python 秒刷 | — | — | 今天更新 | ⭐ |
| 666cy666/Script-Zhihuishu | 68 | PyWebView+Selenium | 章节测试 | **opencv+ddddocr 98%** | 活跃 | ⭐⭐⭐ 验证码实战圣经 |
| luoyily/zhihuishu-tool | 48 | API 工具 | — | — | 活跃 | ⭐⭐ |
| Cooanyh/zhihuishu-zhangwodu | 20 | 油猴 ScriptCat | **AI+题库模糊匹配** | — | 活跃 | ⭐⭐⭐ 掌握度答题+题库回落架构 |
| notnotype/zhihuishu-cli | 24 | 终端 API | — | — | 活跃 | ⭐⭐ |
| Conastin/zhihuishuInteractiveScore | 35 | 互动分 | — | — | 活跃 | ⭐⭐ 互动分功能面 |
| skyformat99/Zhihuishu_Aided | 11 | 图像识别挂机 | — | — | 活跃 | ⭐ |
| cszmzh/zhihuishu-answer | 12 | 答案查询 | 题库 | — | 活跃 | ⭐ |
| scriptcat.org #6016 刷课助手 | — | ScriptCat | 考试答题+双题库 | 广告验证码 | 活跃 | ⭐⭐ 商业模式+功能矩阵参考 |

### 1.2 超星学习通/尔雅赛道（12 个，同源不同平台）

| 项目 | ★ | 亮点 | 备注 |
|---|---|---|---|
| cxOrz/chaoxing-signin | 1774 | 签到全家桶（拍照/手势/位置/二维码） | 功能面参考 |
| aquamarine5/ChaoxingSignFaker | 822 | **伪造签到活动**（滑动验证码+人脸） | 技术激进 |
| eric-gitta-moore/chaoxing-sign-app | 559 | 多账号批量签到 | 账号矩阵 = 高危区 |
| liuyunfz/chaoxing_tool | 410 | 任务点/学习次数/资源下载 | — |
| kuizuo/chaoxing-sign | 210 | Nuxt 协议复现 | 工程范本 |
| qcxs/chaoxing | 59 | **逆向 apk**（解锁拖进度/考试切屏/填空题粘贴/多签） | ⚠️ 含作弊功能，只看技术洞察 |
| WAADRI/ChaoXing_node_signin | 191 | **收到官方律师函，已删库** | ⚠️⚠️ 风险实锤 |

### 1.3 雨课堂赛道（8 个）

Niuwh/yuketang-jiaoben 573★、LetMeFly666/YuketangAutoPlayer 218★（无窗口模式）、AneryCoft/course_helper 309★、heyblackC/yuketangHelper 234★、ZaytsevZY/yuketang-helper-auto 115★（AI 答题）、MuWinds/yuketangHelperBUU 99★（扫码登录+多线程+AI）。**用户桌面已有 RainClassroomAssistant/yuketang-helper-auto 克隆，可交叉参考。**

### 1.4 浏览器自动化/反检测前沿（10 个）

| 项目 | ★ | 核心机制 | 对本项目意义 |
|---|---|---|---|
| browser-use/browser-use | 118749 | AI browser agent，Stealth Bench V2 90.5% 榜首 | 云隐身浏览器 $0.02/h、CAPTCHA solving 是一线风向 |
| vibheksoni/stealth-browser-mcp | 3192 | **nodriver**（非 Playwright）+ CDP + MCP，过 Cloudflare | nodriver 绕开 Playwright 检测特征，101 工具含 hook 请求 |
| sml2h3/ddddocr | 14856 | 通用验证码离线识别，**滑块双算法**（边缘匹配+图像差异） | 正对 Turing 滑块/字母验证码 |
| requireCool/stealth.min.js | 1097 | 自动追踪生成最新 stealth 补丁 | 检测点清单活文档 |
| diprajpatra/selenium-stealth | 739 | selenium 隐身 | — |
| go-rod/stealth | 337 | Go rod 反检测 | — |
| AtuboDad/playwright_stealth | 990 | playwright 隐身 | 本项目 CLI 在用 Playwright，可参考 |
| sml2h3/ddddocr-fastapi | 1130 | ddddocr 服务化（docker） | 本地识别服务部署范本 |
| 86maid/ddddocr | 351 | rust 版 ddddocr | 轻量替代 |
| nodriver（被上述 MCP 依赖） | — | undetected-chromedriver 精神续作 | CDP 不设 webdriver 标志 |

### 1.5 油猴工程化样板（7 个，2026-10-21 已由子代理深读）

ipcjs/oh-my-userscripts 4063★（banner 注入+CI 回填产物）、maomao1996/tampermonkey-scripts 241★（**metablock.json 版本单一来源**）、hoothin/UserScripts 4339★（Pagetual 规则与代码分离）、ChinaGodMan/UserScripts 2101★（eslint-plugin-userscripts）、WindRunnerMax/TKScript 1390★（GH Pages+jsDelivr 双源）、XIU2/UserScript 10113★（头部书写范本）、TechXueXi/techxuexi-js 3658★（轮询状态机）。

---

## 二、智慧树赛道深拆：三条技术路线

### 2.1 路线 A：油猴 DOM 脚本流（本项目所在）

代表：ocsjs、cxmooc-tools、Cooanyh、zhs-assistant、scriptcat #6016。

- **ocsjs 架构（最值得对标）**：`zhihuishu.js` 入口 + `zhihuishu_all_version/` 多版本适配目录 + `chaoxing_all_version/` + `mooc_all_version/`。一套代码多平台，靠目录组织版本适配——与本项目 6 适配器（wisdom/fusion/hike/legacy/card2025/polymas）同构，可学其组织方式。
- **优势**：跑在用户日常浏览器，`navigator.webdriver=false`，无自动化标志；登录态天然复用；SPA 路由监听即可。
- **劣势**：受页面混淆影响（fuckZHS 作者因 hike 前端 JS 混淆 + **检查 DevTools 打开**而弃 DOM 转协议流）；功能天花板受 DOM 可见性限制。

### 2.2 路线 B：Python 协议逆向流

代表：fuckZHS、Samueli924/chaoxing、zhixiaobai。

- fuckZHS 核心参数（README 实证）：`end_thre=0.91`（平台 >91% 进度记完成）、倍速上限 **hike 1.25x / 知到 1.5x**（服务器接受更高但"怕暴露就谨慎些"）、uuid 从 cookies 解析、双课程类型（hike 校内学分课 courseId/fileId vs 知到共享学分课 recruitAndCourseId/videoId）、二维码登录已成唯一登录方式（账号密码登录被平台废弃）。
- Samueli924：题库 provider 可插拔（`TikuYanxi` 言溪题库等，token 配置）、**submit 模式：true=达覆盖率提交（正确率不保证）/ false=只保存不提交，用户自查后提交**——false 模式与本项目「不瞎填、提示检查」理念完全一致。
- **优势**：无浏览器开销、可秒刷、服务器部署。
- **劣势**：平台一改接口就全废；账号密码/QR 登录态管理复杂；协议流 = 请求特征明显（无真实浏览器行为熵），正是平台重点识别对象。

### 2.3 路线 C：Playwright/PyWebView 浏览器流

代表：Autovisor（1027★，免安装版）、666cy666（PyWebView+Selenium）。

- Autovisor 验证码策略（`reference/autovisor` 已存）：**半自动——检测到验证码暂停+弹图+等人输入**，与本项目当前策略相同（不自动破解，人工过码）。
- 666cy666 验证码实战（博客实证）：智慧树会弹「点击侧向大写 F」字母验证码；ddddocr 直接识别不准（字母不在同一 Y 轴+侧向），**先目标检测定位单个字母再识别+调阈值 → 98%+**；策略「验证码可以刷新，卡我无数次，我赢你一次就够」——刷新重试兜底。
- **劣势**：`navigator.webdriver=true` 是原罪（除非用 nodriver 类方案）；需要养 profile。

### 2.4 三流派对比结论

| 维度 | DOM 脚本流 | 协议逆向流 | 浏览器流 |
|---|---|---|---|
| 隐身性 | ★★★（webdriver=false） | ★（请求特征裸奔） | ★★（需 nodriver 补救） |
| 抗平台改版 | ★★（选择器会失效但有兜底） | ★（接口一改全废） | ★★ |
| 功能上限 | ★★（受 DOM 限制） | ★★★（可直接调接口） | ★★★ |
| 部署成本 | 零（装脚本即用） | 中（Python 环境） | 高（浏览器+profile） |
| 本项目借鉴 | 主场 | 参数与题库 provider 模式 | 验证码半自动策略 |

**本项目的路线选择（油猴 DOM 流）在隐身性维度是最优解，应坚持；协议流的价值在于「参数情报」（0.91 完成阈值、倍速上限），已在 v0.6.52 前用真机侦察拿到同类数据。**

---

## 三、题库体系深拆

### 3.1 题库适配器标准（tikuAdapter，项目已存 reference/tiku-readme.md）

itihey/tikuAdapter 把市面题库接口统一成标准格式，已支持 8 家：

| 题库 | 费用 | 备注 |
|---|---|---|
| icodef | 免费 | q.icodef.com |
| buguake 不挂科 | 免费 | 百度 easylearn |
| wanneng 万能 | 付费 | lyck6.cn |
| Tikuhai 题库海 | 付费 | — |
| aidian 爱点 | 付费 | — |
| enncy 言溪 | 付费 | tk.enncy.cn（Samueli924 默认 provider） |
| lemon 柠檬 | 付费 | lemtk.xyz |
| 自定义 | — | JSON 配置 |

**关键发现：本项目 bank 模块的 `health()` 测试提示端口 8060，正是 tikuAdapter 的默认端口**——本项目 bank 架构已天然对标该标准。落地建议：README 明示兼容 tikuAdapter 标准响应格式，用户可一键对接任一题库源。

### 3.2 众筹题库模式（cxmooc-tools）

「题库大部分答案来源于用户答题后的页面采集，需要有人第一次做过，后来的人才能搜索到」——本项目 bank 的 crowdsource 采集思路与之同构，可学其「考试答案页自动收集」时机。

### 3.3 题库即服务（destoryD/chaoxing-api）

datam.site 商业 API，宣称 98% 准确率+联网搜索，覆盖 12+ 平台，配套 screen-searcher 截图搜题。**这是「题库 SaaS」商业模式，本项目明确不碰商业化，但可作为用户自选外部题库源的备查。**

### 3.4 本项目可抄的题库架构（Cooanyh 模式）

```
Gist 托管 JSON 题库（[{q, a}] 标准格式）
  → Levenshtein 距离 90% 模糊匹配
  → 命中：返回题库答案
  → 未命中：勾选"自动回落 AI"则调 LLM API
```

这正是本项目「bank → LLM → heuristic」管线的模糊匹配增强版。**落地建议：bank 命中判定从精确匹配升级为相似度阈值匹配（90%），可显著提升命中率。**

---

## 四、答题能力深拆

### 4.1 LLM 答题流派对比

| 项目 | 模型 | 策略 | 主观题 |
|---|---|---|---|
| king-wang123（已存 reference） | Kimi/GLM/DeepSeek | 多次生成保准确 | 未处理 |
| Cooanyh | DeepSeek/Zhipu/OpenAI/Gemini + 免费 GLM-4.5-Flash | 题库优先+AI 回落 | — |
| MuWinds/yuketangHelperBUU | AI | 多线程+AI | — |

**本项目 v0.6.53 已补齐主观题（填空/问答）盲区，且修正了 vote 对文本答案失效的问题（单次 ask）——在 LLM 答题工程化程度上已超过上述多数项目的公开版本。**

### 4.2 未覆盖的功能面（机会清单）

1. **掌握度答题**（Cooanyh）：`studywisdomh5` 的「知识点掌握」页，灰色未完成知识点自动练习——智慧树翻转课的核心任务点，本项目未覆盖。
2. **互动分**（Conastin/zhihuishuInteractiveScore）：弹幕/点赞等互动行为积分。
3. **习惯分**（scriptcat #6016）：模拟鼠标移动累积学习习惯分——低风险高收益，一条 `mousemove` 模拟即可。
4. **考试页只搜不填**（scriptcat #6016 的「手动确认」模式）：一键搜题+一键填入但默认不自动提交——与本项目理念一致，可作面板功能参考。

---

## 五、验证码与风控对抗（本项目生死线）

### 5.1 智慧树风控实锤（官方登录页文案实证）

`passport.zhihuishu.com` 风控流程（WebSearch 抓到官方文案）：

```
系统监测到你的账号存在异常学习行为 → 记录到「异常学习日志」（作为最终成绩参考）
  → 要求签署「我承诺诚信学习和考试」
  → 未通过验证：当日 24:00 前禁止登录
  → 申诉需修改密码 + 两位同班同学身份验证
```

**这是平台侧的一手证据：智慧树把「异常学习日志」直接挂钩成绩。**

### 5.2 检测手段清单（学校通报+平台行为交叉验证）

| 检测手段 | 实证来源 | 本项目暴露面 | 状态 |
|---|---|---|---|
| 学习时长不足（看 0 分钟但完成任务点） | 桂林理工通报附件 | 真实播放，非协议秒刷 | ✅ 安全 |
| IP 地址跨度大 | 桂林理工通报附件 | 单账号单机 | ✅ 安全 |
| 做题时长不满足 | 桂林理工通报附件 | 逐题作答有间隔 | ✅ 安全 |
| seek 跳跃 → Turing 滑块 | 本项目 docs/05 真机实测 | 绝不 seek | ✅ 已守 |
| 快速连切/合成事件/无鼠标移动 | docs/05 切集偶发踢页 | 已有点标题切集+导航守卫 | ✅ 已守 |
| 倍速异常 | fuckZHS README（hike 1.25/知到 1.5 上限） | ≤1.5 | ✅ 已守 |
| navigator.webdriver | scrappey/crawlex 检测栈科普 | TM 脚本天然 false | ✅ 架构优势 |
| DevTools 打开检测 | fuckZHS README（hike 前端混淆+检测） | 用户日常浏览器不开 DevTools | ✅ 安全 |

### 5.3 验证码类型与应对

已遭遇/生态记录的智慧树验证码：

| 类型 | 触发条件 | 生态方案 | 本项目建议 |
|---|---|---|---|
| 腾讯 Turing 滑块拼图 | **主动 seek 到结尾**（docs/05 实证） | ddddocr 滑块双算法+轨迹模拟（复杂度高，平台轨迹检测在升级） | ❌ 不自动过——根治办法是「绝不 seek」，已从根本上规避 |
| 字母点击型（点侧向 F） | 异地登录/自动刷课被检测（666cy666 实证） | opencv 目标检测+ddddocr，98%+，刷新重试兜底 | ⚠️ 可选升级：ddddocr-node 本地识别+刷新重试；当前「暂停+人工」策略已够用且最稳 |
| 登录滑块 | 异地/异常登录 | 人工 | ✅ 人工 |

**结论：本项目「验证码暂停+人工过码+绝不 seek」组合是把 Turing 滑块出现概率压到最低的正解，不追自动破解（轨迹检测持续升级，投入产出比差）。**

### 5.4 反检测细节库（生态精华）

- **0~60s 随机人类延迟**（zhs-assistant）：自动点击前随机等待，打断机器节奏。
- **模拟鼠标移动刷习惯分**（scriptcat #6016）：周期性微小 mousemove。
- **贝塞尔曲线鼠标轨迹**（tsight 风控博弈文）：平台建「行为熵值」模型，直线瞬移鼠标是自杀。
- **WebSocket 心跳伪造**（tsight）：高端平台手段，智慧树暂未见到，储备知识。
- **navigator 伪装局限**（scrappey）：JS 覆写 webdriver 会留 `Function.toString` 非 native 痕迹+原型链位置变化——**所以正确解是「压根不进自动化模式」，即 TM 脚本路线**。本项目架构已在此正确一侧。

---

## 六、浏览器操控前沿理解（用户点名的 second topic）

### 6.1 从「脚本」到「AI 代理」的范式迁移

browser-use（118k★）代表新范式：LLM 直接看页面（DOM 抽象/截图）→ 决策 → 执行动作。其 Stealth Bench V2 90.5% 榜首说明「隐身」已成浏览器自动化的第一指标。云隐身浏览器 $0.02/h + CAPTCHA solving + 住宅代理 = 工业化对抗栈。

**对项目的启示**：zhihuishu-helper 的「LLM 答题」模块本质上是一个窄域 AI 代理（只看题目→生成答案）。可借鉴 browser-use 的「观察-决策-执行」循环组织答题主循环，而非现在的线性流程。

### 6.2 CDP 是被检测的重灾区

- Chrome 设 `--remote-debugging-port` 即可能置 `navigator.webdriver=true`（crawlex 实证）；CDP 的 `Runtime.enable` 序列化是旁路信号（browserinsight）。
- **nodriver**（stealth-browser-mcp 的底座）不走标准 CDP 客户端，是 2026 年绕过检测的热门选择。
- **本项目 zhs-cli 的定位要清晰：CDP 只用于「诊断/侦察」，绝不能用 CDP 注入 dist 代替 TM 脚本做生产答题**——2026-10-19 实测 CDP 注入触发风控把页面踢没（memory 有记录），这次调研从原理上解释了原因（webdriver 标志+注入痕迹）。

### 6.3 本项目的浏览器操控路线图建议

```
生产答题：Tampermonkey 脚本（webdriver=false，隐身最优）← 保持
   ↓ 互补
诊断侦察：zhs-cli + playwright-cli（attach 用户已登录 Edge，被动观测优先）
   ↓ 储备
高风险场景（异地/字母验证码频发）：ddddocr-fastapi 本地识别服务（docker，localhost:8060 同端口生态位）
   ↓ 观望
AI 代理化：答题主循环借鉴 browser-use observe-decide-act（二期）
```

---

## 七、法律与风险地图（本项目红线手册）

### 7.1 规范依据（已实证）

- **教育部等五部门《关于加强普通高等学校在线开放课程教学管理的若干意见》（教高【2022】16号）**：严禁刷课/替课/刷考/替考；违规一经查实**取消课程成绩+处分记入档案**；构成犯罪的**依法追究法律责任**；建立平台黑白名单制度。

### 7.2 风险事件时间线

| 时间 | 事件 | 后果 | 启示 |
|---|---|---|---|
| 2018-2019 | 内蒙古财经大学、济南职业学院通报刷课 | 全校通报+进度清零 | 清零先例最早 |
| 2022.3 | 内蒙古工业大学通知 | **账号冻结**、学习考试终止 | 封号先例 |
| 2022.4 | 桂林理工通报：超星筛查出 2000+ 条异常 | 学习记录被清除 | 平台侧主动筛查，非举报制 |
| 2022.4 | 五部门 16 号文 | 国家层面定调 | 法律依据落地 |
| 2022 前后 | 江苏苏州工业职院等通报 | 进度清零 | 普遍化 |
| （近年） | **黑龙江肇州「代刷网课」刑案：7 人被抓** | 自主开发刷课程序+下单平台+发展代理+收费 = **犯罪** | 商业代刷是刑事红线 |
| （近年） | WAADRI/ChaoXing_node_signin（191★） | **收到官方律师函，删库** | 仓库级风险实锤 |
| （近年） | fuckZHS 曾被 404 下架（后恢复） | TG 出现倒卖其代码者 | 头部项目亦不稳；防倒卖声明必要 |

### 7.3 本项目暴露面评估（逐条）

| 暴露面 | 风险等级 | 依据 | 缓解 |
|---|---|---|---|
| 个人自用辅助自己课程的平时作业 | 低-中 | 违反平台协议/校规，但非刑事；记录清零是主要后果 | 保持「真实播放+倍速≤1.5+不 seek」，让学习数据真实可信 |
| 不碰正式监考考试 | ✅ 已守 | 替考是学术诚信红线+可能违法 | 铁律不动摇 |
| 不商业化（不卖脚本/不卖题库/不代刷） | ✅ 已守 | 肇州刑案的核心特征就是收费+代理 | 保持免费开源，README 加免责声明（抄 cxmooc-tools 范式） |
| 单账号单机 | ✅ 已守 | IP 跨度/多账号是明确检测项 | 不搞账号矩阵 |
| 开源仓库本身 | 中 | WAADRI 律师函先例；fuckZHS 被 404 过 | ① 明确「仅供学习交流」声明 ② 不碰考试功能代码 ③ 不收录任何真实账号数据 ④ 用户自用风险自负条款 |
| 调试 profile 含登录态 | 中 | live-shots/ 已 gitignore | 保持隔离，绝不入库 |

### 7.4 结论：本项目定位是生态内风险最低姿态

生态全景里，其他项目的风险姿态：ocsjs/cxmooc-tools 支持考试答题（高风险功能）、qcxs 逆向 apk 解锁考试切屏（明确作弊）、destoryD 商业化题库 API、肇州团伙刑事级。**本项目「自用+平时作业+不商业化+不碰监考+不自动过验证码」是全部 50+ 项目里最干净的定位之一——这是资产，继续保持，不要在功能竞争压力下漂移。**

---

## 八、对本项目的行动清单（按投入产出比排序）

### 立即可做（半天级）

1. **bank 模糊匹配升级**：抄 Cooanyh——Levenshtein 相似度阈值（90%）替代精确匹配，命中率立涨。（src/09-bank.js）
2. **随机人类延迟**：抄 zhs-assistant——自动点击/切集前 0~60s 随机等待的**可配置档位**（默认小值，防打断体验）。（src/06c-exam.js）
3. **README 免责声明**：抄 cxmooc-tools 范式——「仅供技术学习交流、不授权商业使用、纠纷自担、捐赠不构成雇佣」。（README.md）
4. **metablock 版本单一来源**：抄 maomao1996——build.js 从 package.json 读版本注入头部，杜绝双处维护漂移。（build.js）

### 短期（1-2 天）

5. **掌握度答题功能面调研**：Cooanyh 已跑通 `studywisdomh5` 路径，先读它的实现（已存 README，可再抓源码），评估本项目是否覆盖——这是智慧树翻转课的核心任务点，用户体感价值高。
6. **习惯分模拟**：scriptcat #6016 的 mousemove 模拟，低风险小功能。
7. **SPA 双轨路由监听**：`window.onurlchange` + History API patch fallback（XIU2 模式），提升智慧树改版存活率。
8. **terser 保留头正则**：build.js 压缩配置加 `output.comments: /^ (@|==)/`。

### 中期（按需）

9. **CI build+auto-commit**（ipcjs 模式）：push → build → 自动提交 dist，raw 链接永最新。
10. **ddddocr-node 本地识别服务**（备用）：仅当字母验证码频繁到影响体验时再上，默认保持人工过码。
11. **tikuAdapter 标准格式显式对接**：README 文档化，用户可自接 8 家题库。
12. **答题主循环 AI 代理化**：借鉴 browser-use observe-decide-act（二期重构，非急需）。

### 明确不做（红线/低性价比）

- ❌ 自动过 Turing 滑块（轨迹检测升级快，且 seek 已从根上规避）
- ❌ 协议秒刷（学习时长造假=平台明确检测项，清零风险）
- ❌ 考试答题/监考代答（学术诚信+法律红线）
- ❌ 商业化任何部分（刑事风险区）
- ❌ CDP 注入做生产答题（风控实锤踢页）

---

## 附录 A：材料索引

- 本机存量：`reference/autovisor`（Autovisor 完整克隆）、`reference/zhs-assistant`、`reference/zhs-llm-answer`、`reference/zhihuishu-ext`、`reference/ocsjs-zhs.ts`、`reference/tiku-readme.md`、`reference/live/`（真机快照）
- 本轮新增：`reference/gh/` 41 个仓库 README + ocsjs zhihuishu.js 源码
- 项目自有真机侦察：`docs/05-切集与反作弊调研.md`（Turing 滑块触发条件/secretStr 反重放/人类切集方式，与生态情报互相印证）

## 附录 B：一句话总评

**智慧树自动化生态已是红海（50+ 项目、头部近 4k★），但「隐身性+法律干净度+工程质量」三者交集的健壮者稀缺——本项目只要守住「真实播放不造假、平时作业不碰监考、免费开源不商业化」三条铁律，在生态里的定位就是独一无二的，不需要在任何单点功能上与人拼杀。**
