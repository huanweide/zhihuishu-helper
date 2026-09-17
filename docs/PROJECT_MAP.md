# 项目索引（PROJECT MAP）

> 最后更新：2026-09-17 21:52
> 状态：**M2 完成**，油猴脚本 v0.1.0（自动播放 + 断点续播）已可安装实测

---

## 〇、快速上手

```bash
npm run build     # 构建 → dist/zhihuishu-helper.user.js
npm test          # 71 项逻辑单测
```

装脚本：浏览器装 Tampermonkey → 把 `dist/zhihuishu-helper.user.js` 拖进浏览器窗口。
详见 [`docs/10-M2使用说明.md`](10-M2使用说明.md)。

---

## 二、文档地图

| 文档 | 内容 | 什么时候看 |
|------|------|-----------|
| [`README.md`](../README.md) | 总览：目标、侦察结论、方案对比、目录、里程碑 | 第一次接触本项目 |
| [`docs/01-侦察报告.md`](01-侦察报告.md) | 智慧树全域名图谱、5 套页面 DOM 选择器明细、弹题结构、反自动化措施 | 写代码前查选择器 |
| [`docs/02-技术方案.md`](02-技术方案.md) | 模块架构、三条主线的详细设计、Prompt 模板、风险对策 | 开发时对照实现 |
| [`docs/03-踩坑记录.md`](03-踩坑记录.md) | 实测遇到的问题与解决 | 遇到 bug 先翻这里 |
| [`docs/90-快照与回溯.md`](90-快照与回溯.md) | 快照机制说明 + 恢复步骤 | 想回退代码时 |
| [`docs/11-测试报告.md`](11-测试报告.md) | 两层测试体系、覆盖明细、抓出的真 bug | 想了解测试怎么跑 |

---

## 三、代码地图（v0.1.0）

```
src/                              # 源码（14 模块，按序拼装）
├── 00-config.js       ✅       配置层：GM存储 + 倍速夹逼 + 日志缓冲
├── 01-util.js         ✅       工具层：节流/两种可见性/等待/文本处理
├── 02-adapter.js      ✅       适配层：5套页面自动识别 + 统一目录 API
├── 03-player.js       ✅       播放层：静音/倍速/防暂停/卡死检测/回退重试
├── 04-resume.js       ✅       续播层：GM持久化/过期清理/时长换算/换源比例换算
├── 05-scheduler.js    ✅       调度层：2s主循环 + 三级守卫 + 结束判定
├── 06-panel.js        ✅       面板层：Shadow DOM 悬浮控制台（状态/日志/设置）
├── 07-main.js         ✅       入口层：初始化 + SPA监听 + window.zhs
├── 08-questions.js    ✅ M4   题目采集（弹题/作业/hike 三场景 + 题型推断）
├── 09-bank.js         ✅ M4   题库通道：TikuAdapter 协议 + 答案归一化
├── 10-llm.js          ✅ M5   LLM 通道：OpenAI 兼容 + 多次投票
├── 11-solver.js       ✅ M5   求解编排：题库优先 → LLM 兜底 → 随机保底 + 缓存
├── 12-filler.js       ✅ M4   回填层：多重兜底点击 + 防重复点击取消
└── 13-answerer.js     ✅ M5   答题编排：弹题签名防抖 + 分页/批量作答

build.js                     ✅   构建：src/*.js → dist/*.user.js
test/run.js                  ✅   逻辑单测：160 项断言（jsdom）
test/screenshot.js           ✅   截屏测试：51 项断言（真实 Chrome + 11 张截图）
test/fixture-media.js        ✅   媒体打桩（解决 duration=Infinity）
test/fixture-player.html     ✅   仿真播放页
test/fixture-dialog.html     ✅   仿真弹题页
tools/probe.js               ✅   一次性诊断脚本
tools/snapshot.sh            ✅   快照：三层保护
dist/                        ✅   产物（git 忽略）
```

### 运行时 API（Console 可调）

```js
zhs.stats()        // 课程完成统计
zhs.logs()         // 全部日志
zhs.start() / zhs.stop()
zhs.next()         // 手动切下一节
zhs.clearResume()  // 清除续播记录
zhs.config({speed: 1.8})
```

---

## 四、参考项目（`reference/` 目录，只读）

| 目录 | 来源 | 借鉴点 |
|------|------|--------|
| `reference/autovisor/` | [CXRunfree/Autovisor](https://github.com/CXRunfree/Autovisor) | Playwright 全套：目录适配、进度同步回退、验证码守卫、防检测 |
| `reference/zhihuishu-ext/` | [UnravelYoung/zhihuishu](https://github.com/UnravelYoung/zhihuishu) | 最简 Chrome 扩展 |
| `reference/zhs-llm-answer/` | [king-wang123/ZHIHUISHU-Auto-Answer-Assistant](https://github.com/king-wang123/ZHIHUISHU-Auto-Answer-Assistant) | **LLM 答题核心**：OCR + Prompt + 多次投票 |
| `reference/zhs-assistant/` | [wangzexi/ZhiHuiShu-Assistant](https://github.com/wangzexi/ZhiHuiShu-Assistant) | 54 行最简：倍速+静音+弹题+切课 |
| `reference/ocsjs-zhs.ts` | [ocsjs/ocsjs](https://github.com/ocsjs/ocsjs) | **权威参考**：5 套页面适配 + 题型判定 + 题库适配器架构 |
| `reference/gf558335.user.js` | greasyfork 558335 | 2.3KB 极简防暂停 |
| `reference/tiku-readme.md` | [DokiDoki1103/tikuAdapter](https://github.com/DokiDoki1103/tikuAdapter) | 题库适配器协议文档 |

---

## 五、关键结论速查

### 5.1 选择器速查（当前目标页面 studyvideoh5）

```js
// 视频
const video = document.querySelector('video');

// 章节条目 / 当前项 / 完成标识
'.child-info.hasvideo'  '.child-info.hasvideo.current'  '.child-check'

// 播放器 UI
'.playButton'  '.volumeBox'  '.speedBox'  '.definiBox'

// 课中弹题
'#playTopic-dialog'  →  '.el-pager .number'  '.topic-item'  '.close-btn'

// 作业页
'.subject_node'  '.question-topic'  '.nodeLab'  '.el-pager .number'
```

### 5.2 三个必踩的坑

1. **倍速 ≤ 1.8** —— 超过平台可能不记录进度
2. **不能最小化浏览器** —— `requestAnimationFrame` 停摆导致卡死
3. **进度不同步要回退重播** —— 视频放完但平台记录 < 100% 时，`currentTime` 设到对应点重播

### 5.3 AI 答题双通道

```
题库（TikuAdapter :8060 /adapter-service/search）
  ↓ 未命中
LLM（DeepSeek）→ 生成 3 次 → 投票取众数
  ↓
回填 + 200ms 后校验是否选上
```

---

## 六、里程碑进度

- [x] M0 情报侦察（5 套页面结构 + 8 个参考项目）
- [x] M1 项目骨架（文档 + 快照机制）
- [x] M2 自动播放 + 断点续播 + 悬浮面板
- [x] **M4 AI 答题——题库通道 + 双通道编排**
- [x] **M5 AI 答题——LLM 通道 + 投票 + 端到端截屏测试**
- [ ] M6 面板打磨 + 习惯分

**当前门禁：逻辑单测 160/160 + 截屏测试 51/51 = 211 项全绿**（v0.1.0）

## 七、下一步（M6）

1. 面板打磨：答题记录页、题库/LLM 通道健康检测按钮、答题结果回看
2. 习惯分：观看时长统计、每日学习报告
3. 真实站点验证：装进 Tampermonkey，在真实智慧树页面上跑一轮
4. 验证码场景（`yidun_popup`）的人工介入提示优化

## 八、测试怎么跑

```bash
npm run test        # 逻辑单测（jsdom）        —— 160 项
npm run test:shot   # 截屏测试（真实 Chrome）  —— 51 项 + 11 张截图
npm run test:all    # 构建 + 两层测试全跑
npm run probe       # 诊断：GM 存储 / 视频桩 / 日志实际状态
```

详见 [`docs/11-测试报告.md`](11-测试报告.md)。

