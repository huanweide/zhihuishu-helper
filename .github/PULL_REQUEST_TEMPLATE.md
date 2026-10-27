## 这个 PR 解决什么

<!-- 一句话：改了什么、为什么改 -->

## 改动范围

<!-- 列出动到的模块，例如：05-scheduler.js / 06-panel.js -->

- [ ] `src/*.js`
- [ ] `test/run.js`
- [ ] 文档（README / CHANGELOG / docs/）

## 门禁自检（四条必须全过）

```bash
node build.js                  # 拼装 dist
node tools/check-dist-fresh.js # dist 与 src 一致
node test/run.js               # 逻辑单测（当前基线：717 通过 / 0 失败）
git diff --cached              # 确认无密钥 / token 进暂存区
```

- [ ] `node build.js` 通过
- [ ] `node tools/check-dist-fresh.js` 通过
- [ ] `node test/run.js` 通过（如断言数变化，说明新增了测试，请在 PR 里写明）
- [ ] 未引入密钥 / token / 个人数据

## 红线自查

本项目有四条不越界的红线，改动若触碰任一请说明理由：

- [ ] 未自动跳转进入作业 / 考试页面
- [ ] 未对视频做 `seek`（只点真实播放按钮）
- [ ] 未劫持用户主动操作（用户手动操作时脚本让路）
- [ ] 未引入无依据的随机兜底（`gatedRandom` 默认关）

## 备注

<!-- 权衡、残留限制、后续 TODO -->
