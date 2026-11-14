# Greasyfork 发布指引

> 目的：Greasyfork（greasyfork.org）是油猴脚本第一分发入口——用户找脚本先搜它，不是先搜 GitHub。
> 同赛道脚本在 Greasyfork 上的安装量普遍是 GitHub star 数的 10~100 倍。
> 本项目目前只有 jsDelivr 直链 + Releases，等于放弃了最大流量口。
> 本文档 = 一次手动上架的操作清单，全程约 15 分钟。

---

## 一、为什么发（判断依据）

| 渠道 | 用户路径 | 现状 |
|---|---|---|
| Greasyfork | 学生搜「智慧树」→ 看安装量排序 → 一键装 | ❌ 未上架 = 搜不到 |
| GitHub 搜索 | 开发者路径，学生几乎不走 | ✅ 已有 |
| jsDelivr 直链 | 只能靠 README / 他人转发 | ✅ 已有 |
| B站/知乎/贴吧 | 传播引爆点，帖子带 Greasyfork 链接转化最高 | 待传播 |

Greasyfork 的安装量还会回流信任感：安装量大的脚本在站内排序更高、用户更敢装，正循环。

---

## 二、上架步骤（需要斯瑞手动做，卡在登录态）

1. **打开 greasyfork.org，右上角用 GitHub 账号登录**（OAuth 一键，不用注册新号）。
2. 登录后进「发布你编写的脚本」页（导航栏「发布」→「发布脚本」）。
3. **代码来源选「从 URL 导入」**，粘贴：
   ```
   https://cdn.jsdelivr.net/gh/huanweide/zhihuishu-helper@master/dist/zhihuishu-helper.user.js
   ```
   Greasyfork 会自动读取 metablock 的脚本名、简介、版本号、@license MIT。
4. 「附加信息」栏可留空；「脚本描述」粘贴下面第三节准备好的文案。
5. 点发布。发布后脚本页地址形如 `greasyfork.org/zh-CN/scripts/xxxxxx`，**把这个地址记到 README**（见第四节）。

## 三、发布用描述文案（直接粘贴）

```text
智慧树/知到网课助手：自动播放（静音+倍速≤1.5+防暂停）、断点续播（关页面/断网/重启浏览器都接得回）、
课中弹题自动答（题库→AI→离线启发式三通道，答不上留空绝不瞎蒙）、作业/章节测试守株待兔式辅助。
全程本地运行，账号不经过任何第三方。开箱即用，零配置；可选配置题库或 DeepSeek Key 增强答题。
红线：不碰正式监考考试、绝不拖动进度条（会触发验证码）、验证码交人工。
使用说明与源码：https://github.com/huanweide/zhihuishu-helper
```

## 四、发布后回填（两处）

1. README.md 与 README_EN.md 的「安装」节最前面加 Greasyfork 安装按钮（学生最信这个）：

```markdown
**路线 0（推荐）：Greasyfork 一键安装** —— 点 [Greasyfork 安装页]( Greasyfork脚本地址 ) → 「安装此脚本」。
```

2. 徽章行可加一枚 Greasyfork 安装量徽章（真实安装量是最好的信任状）：

```markdown
<a href="Greasyfork脚本地址"><img src="https://img.shields.io/greasyfork/dt/脚本ID?label=安装量" alt="Greasyfork installs"></a>
```

## 五、版本更新机制（重要，避免双源漂移）

- Greasyfork 支持「从 URL 导入」的脚本在**源 URL 内容变化后**于脚本页手动点「同步」，或开通站内自动定期同步（脚本编辑页有选项）。
- 本项目 dist 是构建产物，`git push` 后记得先 `curl https://purge.jsdelivr.net/gh/huanweide/zhihuishu-helper@master/dist/zhihuishu-helper.user.js` 清 CDN，再去 Greasyfork 点同步——顺序反了会同步到旧包。
- **版本号铁律不变**：每次发版 `package.json` + CHANGELOG 双件套必须走完，Greasyfork 靠 @version 判断有无新版本。

## 六、风险与边界（发布前自查）

- Greasyfork 政策：自动化/刷课类脚本长期大量存在，本项目「辅助平时学习、不碰监考、不商业化」定位在站内属常见品类；但**不排除站方后续下架或平台律师函**（生态调研里 fuckZHS 曾被下架、WAADRI 收律师函删库）。
- 兜底：jsDelivr 直链 + Releases 双通道永远可用，Greasyfork 只是增益渠道不是命脉。
- 描述文案里已明确写「不碰监考 / 不商业化」，保持这个口径，别在评论区承诺任何越界功能。

---

## 七、上架后的传播位（可选，转化最高）

| 平台 | 打法 | 备注 |
|---|---|---|
| B站 | 搜「智慧树 刷课」看热门视频评论区/弹幕求脚本的密度 | 帖子带 Greasyfork 链接 |
| 知乎 | 「智慧树网课怎么自动播放」类问题下回答，先讲原理再给工具 | 纯广告易被折叠 |
| 贴吧/超话 | 智慧树吧、大学生网课吧 | 看吧规，防删帖 |

传播素材（动图/文案）需要时可再开工，不塞进本次任务。
