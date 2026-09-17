# 项目索引（PROJECT MAP）

> 最后更新：2026-09-17
> 状态：**M1 项目骨架完成**，待进入 M2 自动播放开发

---

## 一、项目一句话

智慧树网课助手：自动播放 + 断点续播 + AI 自动答题（油猴脚本形态）。

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

## 三、代码地图（待开发）

```
src/
├── zhihuishu-helper.user.js     ← 主入口（油猴脚本头 + 调度）
├── core/
│   ├── adapter.js               站点适配层
│   ├── player.js                播放控制
│   ├── resume.js                断点续播
│   ├── questions.js             题目采集
│   ├── solver.js                答案求解
│   ├── filler.js                答案回填
│   ├── panel.js                 悬浮控制台
│   └── scheduler.js             主循环调度
├── api/
│   ├── tiku.js                  题库客户端
│   └── llm.js                   LLM 客户端
└── config.js                    默认配置
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

## 六、下一步（M2）

1. 写 `src/zhihuishu-helper.user.js` 骨架（脚本头 + 配置 + 日志）
2. 实现 `adapter.js` 站点识别 + `player.js` 播放控制
3. 本地做**逻辑单测**（不启真实浏览器）
4. 交给瑞宝宝在浏览器里实测
