# zhihuishu-helper · 内部操作手册（agent 接手须知）

> 本文件约束任何用 AI 代理维护本仓库的会话。

## 一、仓库定位

zhihuishu-helper 是**公开**的 Tampermonkey 网课助手脚本（产品门面）。
对外只放：源码 `src/`、构建 `dist/`、使用文档 `docs/`、版本 `CHANGELOG.md`。

## 二、零号·仓库卫生铁律（2026-10-17 立，最高优先级）

**禁止往本公开仓库提交任何暴露瑞宝宝个人内部工作流 / 决策运作方式的文件。**

判别标准（命中即禁止）：
- 是否揭示「瑞宝宝个人怎么做决策 / 怎么排活 / 内部怎么开会」？
- 是否含「魔王系统 / maxloop / 多 agent 团队 / Chair / worker-A / review-worker」这类内部运作记录？
- 是否含本地绝对路径（如 `C:\Users\Administrator\...`）或 AI 人格身份（如「千惠」「IDENTITY 铁律」）？

上述一律不放公开仓库，改存本地知识库。

> 已执行：移除 `PROCESS/meetings/` 整目录（多 agent 轮次会议纪要 + Chair 整合报告），
> commit 见本仓库历史。以后保持**零新增**，不得在仓库重建 `PROCESS/meetings/` 或等价目录。

## 三、普通提交规范

- 仓库卫生改动（删敏感/暴露文件）**不 bump 版本**。
- 功能改动才 bump 版本 + 更新 CHANGELOG。
- 推送走 SSH 远端 `ghssh`；门禁（逻辑单测 + 凭据扫描 0 命中）通过后再提交。
