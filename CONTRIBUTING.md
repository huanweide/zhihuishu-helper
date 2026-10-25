# 贡献指南

感谢你愿意参与。本项目是一个**单文件油猴脚本**，目标很克制：在用户自己的浏览器里把「看网课」这件机械的事自动化，同时**永不替用户瞎蒙答案**。

提 PR 前请先读完本文，尤其是**第 4 节红线**——触碰红线的改动一律不收。

---

## 1. 开发前置

```bash
git clone <本仓库>
cd zhihuishu-helper
npm install          # 仅 jsdom / puppeteer-core，用于逻辑单测与截屏测试
```

无需 Docker、无需后端。脚本最终形态是 `dist/zhihuishu-helper.user.js` 这一个文件。

## 2. 项目结构

```
src/*.js      20 个模块，按文件名排序拼装（见下方"加模块"）
build.js      拼装入口；拼装规则单一真源在 tools/lib/bundle.js
tools/        check-dist-fresh（产物新鲜度）、make-install-page 等
test/run.js   逻辑单测（jsdom，当前 706 断言）
test/screenshot.js  真机截屏测试（需本机 Chrome/Edge）
dist/         构建产物，**不要手改**，它由 src 重算
docs/         侦察报告、技术方案、踩坑记录、使用说明
```

模块按端到端链路分层（名字即加载顺序）：

| 层 | 模块 | 职责 |
|---|---|---|
| 配置/工具 | `00-config` `01-util` | 配置读写与迁移、节流/可见性/URL 等工具 |
| 适配 | `02-adapter` `02d-guard` `02e-nav` | 4 套页面识别、守卫、跳转策略链 |
| 播放/续播 | `03-player` `04-resume` | 播放控制、断点存储与恢复 |
| 调度 | `05-scheduler` | 主循环、切课、停止条件、自愈 |
| 界面/场景 | `06-panel` `06b-course-hub` `06c-exam` | 控制面板、课程中心、考试 |
| 入口 | `07-main` | 启动、运行时 API（`window.zhs`） |
| 答题链路 | `08-questions` `09-bank` `10-llm` `11-solver` `11b-heuristic` `12-filler` `13-answerer` | 取题→题库/LLM→求解→启发式→回填→编排 |
| 统计 | `14-stats` | 学习记录 |

## 3. 开发流程与门禁（**四条必须全绿**）

改完 `src/` 后依次跑：

```bash
node build.js                  # ① 拼装 dist
node tools/check-dist-fresh.js # ② 校验 dist 与 src 一致（漏 build 会被挡下）
node test/run.js               # ③ 逻辑单测必须全绿（当前 706 通过 / 0 失败）
node test/screenshot.js        # ④ 可选：真机截屏（需本机浏览器）
```

一键跑：`npm run test:all`（前三条）。

**`dist/` 不要手改**——它是产物，`check-dist-fresh` 会做字节级比对，手改必然不过。

## 4. 红线（触碰即拒收）

这四条是项目的立身之本，改动前先确认你没有破坏它们：

1. **绝不自动跳转到作业页 / 考试页**。只守株待兔：用户在作业/考试页时脚本才作答，绝不主动导航过去。
2. **绝不 seek（拖动）播放器进度**。进度超前只告警，不回退、不快进。
3. **绝不替用户瞎蒙答案**。所有"无答案时随机猜"的路径受 `gatedRandom` 管制且**默认关闭**；宁可留空交人工。
4. **不写凭据进仓库**。API Key 只走用户本地配置，任何 key/token/cookie 不得进代码或文档。

## 5. 提交规范

- commit message 用中文或英文均可，但要**说清改了什么、为什么**，参考仓库既有风格：
  `v0.6.xx round-xx: <一句话主题>`，正文分条列改动。
- **版本号**：改 `package.json` 的 `version`（build 会注入 `__ZHS_BUILD__.version`，别在代码里硬编码版本号），并在 `CHANGELOG.md` 顶部加一条。这两处是"版本两件套"，缺一不可。
- **新增/修改逻辑必须补单测**。测试挂在 `test/run.js` 对应分组下，风格照抄既有断言即可。
- 推送走 SSH 远端：`git push origin master`。

## 6. 加一个新模块

1. 在 `src/` 建 `NN-name.js`（`NN` 决定加载顺序）。
2. 文件必须自带 IIFE 包裹与重入守卫，否则 SPA 二次注入会叠加定时器：

   ```js
   (function () {
     'use strict';
     const ZHS = window.ZHS;
     if (!ZHS) return;                    // 依赖未就绪
     if (ZHS.__modNN_name) return;        // 重入守卫：模块名唯一
     ZHS.__modNN_name = true;
     // ...
   })();
   ```

   > 为什么必须这样：模块内联进大 IIFE 后，顶层 `return` 会变成"退出外层函数"，守卫失效 → 定时器翻倍。构建期有 `assertIifeBoundaries` 自检会拦。

3. 挂在 `ZHS.XXX` 命名空间上（如 `ZHS.Foo = Foo;`），不要污染全局。
4. 跑一遍四条门禁。

## 7. 报告问题

提 issue 时请带上：

- 脚本版本号（面板设置页顶部可见）
- 目标页面 URL 与**页面版本代号**（wisdom / fusion / hike / legacy，见 `docs/01-侦察报告.md`）
- 面板「日志」页的相关日志（快捷键或切到日志页复制）
- 复现步骤

日志是排查的主要依据——本项目的定位之一就是**故障可诊断**，所以日志里通常已经写了原因和建议。

## 8. 行为准则

- 仅限个人学习研究，禁止商用与传播；这一点写在 LICENSE 里，也请遵守。
- 讨论对事不对人；不接受任何形式的"帮我绕过考试监考"类需求。

---

有问题先开 issue 讨论，比直接提一个大 PR 更容易被接受。
