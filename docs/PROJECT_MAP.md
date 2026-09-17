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

---

## 三、代码地图（v0.1.0 已实现）

```
src/                              # 源码（8 模块，按序拼装）
├── 00-config.js       ✅       配置层：GM存储 + 倍速夹逼 + 日志缓冲
├── 01-util.js         ✅       工具层：节流/可见性/等待/文本处理
├── 02-adapter.js      ✅       适配层：5套页面自动识别 + 统一目录 API
├── 03-player.js       ✅       播放层：静音/倍速/防暂停/卡死检测/回退重试
├── 04-resume.js       ✅       续播层：GM持久化/过期清理/时长换算
├── 05-scheduler.js    ✅       调度层：2s主循环 + 三级守卫 + 结束判定
├── 06-panel.js        ✅       面板层：Shadow DOM 悬浮控制台
├── 07-main.js         ✅       入口层：初始化 + SPA监听 + window.zhs
├── 08-questions.js    ⬜ M4   题目采集（弹题/作业/考试）
├── 09-solver.js       ⬜ M4   答案求解（题库通道）
├── 10-llm.js          ⬜ M5   LLM 通道 + 投票
└── 11-filler.js       ⬜ M4   答案回填 + 校验

build.js               ✅       构建：src/*.js → dist/*.user.js
test/run.js            ✅       单测：71 项断言（jsdom）
tools/snapshot.sh      ✅       快照：三层保护
dist/                  ✅       产物（git 忽略）
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
- [x] **M2 自动播放 + 断点续播 + 悬浮面板（v0.1.0，71 项测试全绿）**
- [ ] M4 AI 答题——题库通道
- [ ] M5 AI 答题——LLM 通道 + 投票
- [ ] M6 面板打磨 + 习惯分

## 七、下一步（M4）

1. 写 `08-questions.js`：采集弹题（`#playTopic-dialog`）/ 作业（`.subject_node`）
2. 写 `09-solver.js`：对接 TikuAdapter（`:8060/adapter-service/search`）
3. 写 `11-filler.js`：答案回填 + 200ms 后校验
4. 加对应单测

