# 发布链路审查报告（round-3）

> 审查对象：提交 `74ac103`（已推 master）｜仓库 `C:\Users\Administrator\WorkBuddy\2026-09-17-21-07-36\zhihuishu-helper`
> 结论先说：**当前链路能挡住「忘了 build」，挡不住「忘了发版」和「忘了 bump 版本号」——后者才是用户真的收不到更新的原因。**
> 未改动 `src/`。

---

## 〇、先把现状钉死（实测数据，非推测）

| 项 | 实测值 | 来源 |
|---|---|---|
| dist 单文件入仓体积 | **317,481 B（≈310 KB）** | `git cat-file -s HEAD:dist/...` |
| dist 三版本未压缩合计 | 917.5 KB | b184e96 304508 + d674e70 317481 + 74ac103 317481 |
| 全库对象总量 | 5,221 KB / 323 objects | `git cat-file --batch-all-objects --batch-check` |
| **dist 占全库对象比** | **17.6%** | 917.5 / 5221 |
| `.git` 实际占用 | 3.1 M（pack 1.30 MiB） | `du -sh` / `count-objects -vH` |
| 相邻版本 dist 差异 | b184e96→d674e70 **306+/64-**；d674e70→74ac103 **仅 2+/2-** | `git diff --numstat` |
| CI | **无** `.github/workflows` | `ls` |
| git hook | **无**（`.git/hooks` 仅 sample） | `ls` |
| `core.autocrlf` | **true**，且仓库**无 `.gitattributes`** | `git config` |
| `package-lock.json` | **未被跟踪**（`.gitignore` 末段显式忽略） | `git ls-files --error-unmatch` |
| 远端 raw 响应 | `Cache-Control: max-age=300`、`Via: 1.1 varnish`、`X-Cache: HIT`、`Content-Length: 317481` | `curl -sI` |

---

## 一、raw.githubusercontent.com 的缓存问题 —— **不需要**强制刷新策略

### 实测证据

```
$ curl -sI https://raw.githubusercontent.com/huanweide/zhihuishu-helper/master/dist/zhihuishu-helper.user.js
HTTP/1.1 200 OK
Cache-Control: max-age=300
ETag: "5ea07240293b841a5072495b4ca76139cf011af215188cd8cc9702b51ede21f8"
Via: 1.1 varnish
X-Served-By: cache-nrt-rjaa8190049-NRT
X-Cache: HIT
```

### 判定

**CDN 层不是瓶颈。** `max-age=300` 意味着首次请求后最多被 Varnish 边缘节点钉 5 分钟。而 Tampermonkey 自身的自动更新检查间隔默认是 **24 小时**级别（可在设置里改成每次/每小时），两者串联后的最坏延迟 ≈ **max(5min, 24h) ≈ 一天**，且用户可以点面板「检查更新」手动打断这个等待。给 URL 加 `?t=timestamp` 只能削掉那 5 分钟，对 24 小时而言是四舍五入到 0 的收益。

### 为什么反而建议**不要**加 query string

1. `@updateURL` 的语义是「这个脚本的**永久家址**」，写进用户浏览器后长期固化。一旦你在 `tools/lib/bundle.js:39-40` 把它变成随构建时间漂移的动态串，就等于每次发版换一个家址——老用户指向旧 query、谁的 TextField 缓存更久谁就更滞后，长期不一致比 5 分钟缓存难查得多。
2. raw 对未知 query 不做任何处理，只是把它透传给 Varnish 当 cache key，**它刷新的是 Github 侧边缘 cache，不是 Tampermonkey 侧的检查间隔**。打错了靶子。
3. 加了之后 `@updateURL` 与 `@downloadURL` 必须同步改（否则 URL 不匹配），凭空多一处能漂移的地方。

### 真正的瓶颈：`@version` 有没有变大

多方资料一致指出，Tampermonkey 走的是「取 `@updateURL` → 读头部 → 比对 `@version` → 决定是否拉 `@downloadURL`」的路径，**`@version` 未递增会被直接判定为「无更新」**，无论 body 内容变了多少：

- https://github.com/Tampermonkey/tampermonkey/issues/242 （有 downloading URL 版本已到 3，本地仍停在 2）
- https://stackoverflow.com/questions/49392803 （版本没 bump 就不自动更新）
- CSDN 排查清单同样把「`@version` 未递增」列为失效首因

**结论：把精力从「CDN 缓存」挪到「版本号单调递增」上，收益高一个数量级。** 这正是第三问要做的事。

---

## 二、dist/*.user.js 入仓 —— **合理且必要**，体积不是问题，但发现一个真隐患

### 2.1 合理性

`dist/*` 之后紧跟 `!dist/zhihuishu-helper.user.js`（`.gitignore` 依赖与构建产物段）是**唯一正确解**。因为 `@updateURL`（`tools/lib/bundle.js:39`）必须在 `raw.githubusercontent.com/.../master/` 下命中一个**真实存在的已提交文件**——不是 CI 产物、不是 Release asset、不是 branch 上可能不存在的东西。不入仓，用户就永远装不上更新。`dist/install.html` 从未入库（已二次确认无历史），白名单没有放得过宽，`dist/*` 的排除立场守住了。

### 2.2 会不会膨胀 —— 不会

- 单文件 310 KB，三版本累计 917.5 KB，占全库对象 **17.6%**；`.git` 现在才 3.1 M。
- **相邻版本差异极小**：b184e96→d674e70 是 306+/64-，d674e70→74ac103 只有 **2 行**（就是 `@version` 与 `window.__ZHS_BUILD__.version` 各一行，这也是两个 blob 同为 317,481 B 却 hash 不同的原因——内容确实只差版本号那几 B）。
- Git 的 delta 压缩（默认 `pack.depth=50`）对这种 99% 相似的纯文本相邻 blob 极为有效，增量实际是 KB 级。按当前节奏推 20 个版本，dist 侧的增量估算在 **几十 KB** 量级，而 pack 总体只会从 1.30 MiB 涨一点点。

**顺手指一下真正的膨胀源**：`git cat-file --batch-all-objects` 的 top 里有 `test/live-screenshots/edge-discover-01-首页.png` 89,328 B、`test/screenshots/T4-02-恢复后.png` 62,309 B × 2、`T1-02-脚本生效.png` 61,564 B 等一批 PNG。二进制不可 delta，反复提交才是真·膨胀，且与 dist 无关。建议另案处理（`git filter-repo` 清理历史 或 挪出仓库）。

**结论：dist 入仓保留，不必改策略。**

### 2.3 隐患（这次排查最值得修的一条）—— `core.autocrlf=true` + 无 `.gitattributes`

实测：

```
$ stat -c '%s' dist/zhihuishu-helper.user.js      → 318,819
$ git cat-file -s HEAD:dist/zhihuishu-helper.user.js → 317,481
$ python: CR(\r\n) count = 1338, LF count = 6713
```

即：**工作区的 dist 是 6,713 行里混了 1,338 行 CRLF、其余 LF 的“混血”文件；提交时被 clean filter 归一化成 LF，落库 317,481 B。** 远端 `Content-Length: 317481` 印证了用户真正下载到的是 LF 版。

后果有三，都不致命但都在侵蚀「校验」的可信度：

1. **你本地 `check:dist` 通过的那个文件，和用户拿到的那个文件，不是同一份字节**（差 1,338 B）。今天只是空白符，明天如果有人在 Windows 上用另一个编辑器动过一行，边界就会漂。
2. `check-dist-fresh.js` 逐字节比对是与**磁盘文件**比（`tools/check-dist-fresh.js:29`），而 git 会对磁盘文件做转换——**这道门禁校验的对象和用户实际消费的对象在概念上错位了**。
3. 换机器 / 换 `core.autocrlf` 后，可能出现「本地怎么 build 都对不上 HEAD」的玄学。

**修复（零成本）** —— 新增 `.gitattributes`：

```
# dist 是油猴 @updateURL 直接消费的产物，必须逐字节可复现，禁止任何换行转换
dist/*.user.js -text
```

`-text` 等价于「按二进制处理，checkin/checkout 都不做 eol 转换」。生效后会有一笔一次性的 1,338 B 换行归一 churn，之后永久稳定。

---

## 三、`check-dist-fresh.js` 还应该加什么

现有实现（`tools/check-dist-fresh.js`）的优点要认：**不比 mtime（第 14 行注释已正确排除）**、**拼装逻辑复用 `tools/lib/bundle.js` 不产生第二份真源**、**不一致时给可读的差异定位而非糊一墙 diff**。这三点是扎实的。

按优先级补，建议如下：

### P0-1 版本号单调递增校验（**必加**）

这是当前唯一的「内容更新了但用户永远收不到」的漏洞，而且现有逐字节比对完全拦不住：src 改了、dist 也重建了、字节比对通过 ✓，但 `package.json` 的 `version` 没 bump → dist 头 `@version` 不变（注意 `@version` 是从 `PKG.version` 取的，`tools/lib/bundle.js:18,22`）→ Tampermonkey 判定无更新 → **所有用户停留在旧逻辑，「改了等于没改」原封不动地重演一遍 2026-09-18。**

实现要点（在 `tools/check-dist-fresh.js` 里加一段）：

- **上一个版本号必须从 git 取，不能从磁盘取**：`git show HEAD:dist/zhihuishu-helper.user.js`，因为此时 dist 可能已被 build 覆盖。首次入库（`HEAD` 里还没有该文件）时跳过。
- **必须走 semver 比较，不能字符串比较**：`0.6.10` vs `0.6.9` 按字典序是 `0.6.10 < 0.6.9`，字符串比较会误判为「版本回退」而报错，逼人绕过门禁。逐段转数字比较：`[0,6,10] > [0,6,9]` ✓。不必引 `semver` 包，二十行内搞定。
- 规则：新版本 **>** 旧版本 → 放行（正常发版）；**==** → 放行（同一版本反复 build，常见于调 CI）；**<** → 硬失败并打印 `旧版本→新版本` 两个号。

### P0-2 git 钩子自动跑（**必加**，且比 CI 重要）

见第四问的论证：**门禁的位置比门禁的内容更重要**。放在 `release` 里等于没有。

### P1 CI 里跑 `check:dist`，但**不要**自动 rebuild

- 建议 CI 跑**校验型**而非**重建型**。CI 里 `npm run build` 会自动把 dist 补对，于是绿灯常亮——「开发者本地忘了 build」这件事被 CI 悄悄擦掉，人永远不长记性；而且 CI 改完产物还得回推 master，凭空多一个自动提交。
- **但 CI 现在根本起不来**：`package-lock.json` 被 `.gitignore` 显式忽略且未被跟踪，而 `npm ci` **强制要求 lockfile**，会直接失败。这是引入 CI 前必须先拍板的一道题：
  - 要么把 `package-lock.json` 从 `.gitignore` 里摘出来入库（有可复现依赖的好处）；
  - 要么 CI 里改用 `npm install`（慢且不可复现）。
  - 我倾向前者：这个项目有 `jsdom` / `puppeteer-core` 两个依赖，`install-page`/`verify-install` 都要真跑。
- 另注意 `test/screenshot.js:17` 依赖 `dist/zhihuishu-helper.user.js` 且要真跑 Chrome headless，CI runner 里不一定装得好——建议 CI 只跑 `check:dist` + `npm test`，把 `test:shot` 留成本地/手动。

### P2 远端一致性探针（可选，非阻塞）

push 之后跑一次 `curl -sI` 比对 `Content-Length` / `ETag` 与本地 git blob 大小，能抓到「推了 dist 但 raw 边缘节点还是旧的」「推错分支」这类问题。做成 `tools/check-remote-dist.js`，**不要**放进必过门禁（网络抖动会误伤）。

### 不建议加

- mtime 比对 —— 作者已在 `tools/check-dist-fresh.js:14` 正确排除，`touch` 一下就骗过去了。
- dist 里塞 build 时间戳 —— 会让每次 build 都产生 diff，与「可复现构建」和 Git delta 压缩双重冲突。

---

## 四、`package.json` scripts 的串联 —— 顺序没错，但**位置错了**

现状（`package.json:7-18`）：

```json
"check:dist": "node tools/check-dist-fresh.js",
"build": "node build.js",
"test": "node test/run.js",
"test:shot": "node test/screenshot.js",
"test:all": "node build.js && node tools/check-dist-fresh.js && node test/run.js && node test/screenshot.js",
"release": "node build.js && node tools/check-dist-fresh.js && node tools/make-install-page.js && node tools/verify-install-page.js && node test/run.js && node test/screenshot.js"
```

### 4.1 `release` 里的 `check:dist` 是**恒真冗余**

`build` 是 `release` 的第一步，它刚用自己的 SSOT 写完 dist，紧随其后的 `check:dist` 拿同一套 SSOT 重算比对——**必然相等**。这条断言今天证明不了任何关于用户利益的事，它只证明 `build.js` 和 `bundle.js` 没互相背叛（这件事有一个 commit 级的保证就够了，不需要每次 release 付一次执行成本）。

换句话说：**「改了 src 但 release 时忘了 dist」这个场景在现有 release 链路里在物理上就不可能发生**——`build` 会无条件重建。你担心的问题不在这里。

补充两点小事，都不影响结论：
- `test:all` 和 `release` 用 `node build.js` 而不是 `npm run build`，与 `"build"` 条目重复定义了路径，将来改 build 入口要改三处。
- `test/run.js:1043-1057` 已经内联了同一份 dist 新鲜度断言，所以单独 `npm test` 也有一层兜底；但它外面套了 `if (fs.existsSync(distPath))`，dist 不存在时整条**静默跳过**，属于 soft fail。

### 4.2 真正漏掉的两个场景

**场景 A：压根没跑 release。** 开发者直接 `git commit -m "fix(adapter): ..." && git push`。此时 master 上的 dist 停在旧版本，`check:dist` 一次都没被执行过，**所有门禁形同虚设**。用户刷新自己的浏览器，拿到的还是上一版的字节。

这一点值得单独强调：`tools/check-dist-fresh.js:6-11` 里记录的事故叙事是「改了 src 却忘了重建 dist」，于是对策被设计成「重建一遍再比对」——**但事故的真实形态是「整个 release 流程没被执行」，比对根本没跑。** 门禁的内容和事故的形态错配了一格。

**场景 B（更隐蔽，现在完全裸奔）：dist 内容更新了，但版本号没 bump。** 详见三-P0-1。逐字节比对一路绿灯，Tampermonkey 判定无更新，用户永远收不到。**这是当前链路唯一能真正坑到用户的洞。**

### 4.3 还缺什么

- 缺钩子安装入口（`prepare` / `hooks` script）—— 仓库里没有任何 hook，新克隆的人拿不到门禁。
- 缺 `preversion` / `version` script —— 版本号是手动改的，而它是整条更新链路里最不能忘的一环（见上文）。

---

## 五、最小落地方案

目标一句话：**让「版本号不变 + dist 不新」在 `git commit` 这一步就过不去，而不是指望谁记得 `npm run release`。**

### 第 1 步：新增 `.githooks/pre-commit`（核心，一条解决场景 A）

```sh
#!/bin/sh
# 改了 src 就必须在同一个 commit 里带上新 dist。
# 为什么放 pre-commit：release 里的 build 能让 dist 变新，但救不了「压根没跑 release」。
set -e
node build.js
git add dist/zhihuishu-helper.user.js
node tools/check-dist-fresh.js   # 内含版本号单调递增校验（见第 3 步）
```

> 注意顺序：**先 build 再 add**，保证 stage 区里的 dist 就是新的；`check` 放最后做最终确认。

### 第 2 步：`.gitattributes`（修 2.3 的字节漂移）

```
dist/*.user.js -text
```

### 第 3 步：`check-dist-fresh.js` 加版本号校验（解决场景 B）

在 `tools/check-dist-fresh.js` 的字节比对**之后**（约第 34 行往后）追加一段，逻辑：

1. `git show HEAD:dist/zhihuishu-helper.user.js` 取上一个 `@version`（取不到就跳过，兼容首次入库）；
2. 与 `bundle()` 返回的 `version` 做**逐段数字比较**（不是字符串比较）；
3. `新 < 旧` → exit 1 并打印两个版本号；`新 == 旧` → 放行并打一行提示「版本未变，发新版请 bump」。

### 第 4 步：`package.json` 改 scripts

```json
"hooks": "git config core.hooksPath .githooks",
"prepare": "git config core.hooksPath .githooks",
"preversion": "node tools/check-dist-fresh.js",
"version": "node build.js && git add dist/zhihuishu-helper.user.js",
"check:dist": "node tools/check-dist-fresh.js",
"build": "npm run --silent build:js",
"release": "npm version patch && npm run build && node tools/make-install-page.js && node tools/verify-install-page.js && npm test"
```

要点：

- **`release` 用 `npm version patch` 驱动** —— 版本号由 npm 强制递增，人想忘都忘不掉，`version` 钩子顺手把新 dist 一起 git add 进那个 version commit。这一条直接消灭场景 B。
- `preversion` 在 bump 之前校验旧 dist 是否新鲜，`version` 之后再 build 一次把新版本号写进 dist 头 —— **顺序不能反**。
- `release` 里删掉 `check:dist`（4.1 已论证恒真冗余），它的位置由 pre-commit 接管。
- `prepare` 让 `npm install` 自动装 hook，新克隆的人零配置。

### 第 5 步（可选）：CI

`.github/workflows/release-guard.yml`，push/PR 到 master 触发：`npm ci && node build.js && npm run check:dist && npm test`。
**前置条件**：先把第 4 步之外的 `package-lock.json` 从 `.gitignore` 里摘出来入库，否则 `npm ci` 必挂。

### 改完之后，日常就两条命令

```
npm test                      # 开发时随便跑
git commit -m "fix: ..."      # 钩子自动 build + add + 门禁，不再需要「记得 build」
```

发版一条：

```
npm run release               # 自动 bump 版本号 → build → make/verify 安装页 → test
```

### 验证这套方案有没有真的堵住

| 事故形态 | 旧链路 | 新链路 |
|---|---|---|
| 改了 src 忘了 build | release 里能补救，但没跑 release 就裸奔 | **pre-commit 自动 build，堵住** |
| 跑都没跑 release 直接 push | 裸奔 | **pre-commit 自动跑门禁，堵住** |
| dist 新了但版本号没 bump | **完全拦不住** | **`check-dist-fresh` 版本单调递增 + `npm version` 强制 bump，堵住** |
| dist 与用户实际下载的字节不一致 | autocrlf 悄悄转换 | **`.gitattributes -text`，堵住** |

---

## 附：一句话总结

现有 `tools/lib/bundle.js` + `check-dist-fresh.js` 的 SSOT 设计是对的，`release` 的顺序也没错——**问题在于门禁被放在了「人已经想起来要发版」之后的那一步**。把它左移到 `git commit`，再补上「版本号必须递增」这条真正对准 Tampermonkey 行为机制的断言，这条链路才算闭环。
