# 注入侧调查：为什么「装了 27 次，面板都没有」

- 调查范围：`dist/zhihuishu-helper.user.js`（v0.6.3）、`src/00-config.js` ~ `src/07-main.js`、`src/06-panel.js`、`tools/lib/bundle.js`
- 基线提交：`74ac103`（`git status` 干净，`dist/` 已被纳入版本库）
- 性质：只读调查，未修改 `src/` 任何文件
- 结论一句话：**代码本身在正常环境下能挂上面板（实测 4 套 fixture 全部挂载成功），所以「看不到面板」几乎必然发生在「脚本没被注入」或「注入后静默早退」这两段，而这两段都【没有任何用户可见提示】。**

---

## 0. 先给实测证据（排除法）

用 jsdom 把 `dist` 注入 4 个真实夹具（`test/fixtures/*.html`），观察面板是否真的进 DOM：

| 夹具 | 页面识别 | `#zhs-helper-panel` 进 DOM | `.panel.show` | 异常 |
|---|---|---|---|---|
| `real-h5.html` | hike（评分 135） | ✅ | ✅ | 无 |
| `real-legacy.html` | legacy（135） | ✅ | ✅ | 无 |
| `real-wisdom.html` | wisdom（137） | ✅ | ✅ | 无 |
| `studyvideoh5-legacy.html` | legacy（138） | ✅ | ✅ | 无 |
| `real-wisdom.html` + **关掉 GM API** | wisdom | ✅ | ✅ | 无（正确降级到 localStorage） |
| `real-wisdom.html` + **无 video 元素** | wisdom | ✅ | ✅ | 无 |

另外两项门禁均通过：

- `node tools/check-dist-fresh.js` → `[ok] dist 与 src 一致（16 模块, v0.6.3）`（`tools/check-dist-fresh.js:33`）
- `node --check dist/zhihuishu-helper.user.js` → 语法 OK，不存在「拼装缺括号导致整体不执行」
- `dist` 含全部 16 个模块分隔注释（`dist/zhihuishu-helper.user.js:32` 起，含 `/* ===== 06-panel.js ===== */` 在 2284 行、`/* ===== 07-main.js ===== */` 在 5203 行）

**推论**：产物是好的、启动链在标准页面上能跑通。用户侧看不到面板，要么是**根本没注入**，要么是**注入了但在某个静默分支早退**。下面逐条定位这些分支。

---

## 1. dist 头部 metadata 审计

头部完整位置：`dist/zhihuishu-helper.user.js:1-23`（生成源：`tools/lib/bundle.js:19-38`）。

| 项 | 行号 | 内容 | 会不会阻止注入 |
|---|---|---|---|
| `@match` | 7 | `*://*.zhihuishu.com/*` | **会**（唯一能真正阻止注入的项），见 1.1 |
| `@match` | 8 | `*://*.polymas.com/*` | 同上 |
| `@match` | 9 | `*://*.zhihuishu.cn/*` | 同上 |
| `@grant` | 11-13 | `GM_setValue` / `GM_getValue` / `GM_xmlhttpRequest` | 不会。与代码实际用到的 API 完全对齐（见第 4 节），无「用了没 grant」的项 |
| `@connect` | 14-17 | `localhost / 127.0.0.1 / api.deepseek.com / *` | 不会。`@connect *` 已覆盖全部，`GM_xmlhttpRequest` 不会触发 Violentmonkey 的授权弹窗 |
| `@run-at` | 18 | `document-idle` | 不阻止注入，只是时机（见第 5 节）。且**面板挂载不依赖任何页面 DOM**，所以即使时机偏早也不会没面板 |
| `@updateURL` / `@downloadURL` | 21 / 22 | `raw.githubusercontent.com/.../master/dist/...` | 不阻止注入。但若用户点了「更新」而拉不到 raw，**VM 会保留旧代码**，反复重装拿到的是同一份旧脚本 |
| `@noframes` | — | **未声明** | 不阻止（反而更宽松：iframe 里也会注入） |
| `@require` | — | 未使用 | 无外部依赖，不会因为 CDN 拉不到而整体失败 |

### 1.1 【高】`@match` 的三条都是「必须带子域」的通配，裸域不匹配

`*://*.zhihuishu.com/*`（`dist/zhihuishu-helper.user.js:7`）要求主机名形如 `xxx.zhihuishu.com`。
**`https://zhihuishu.com/...`（裸域，无子域）不匹配。**

代码库里出现过的真实域名（grep 统计）全部带子域，因此**目前是覆盖的**：

- `https://studyvideoh5.zhihuishu.com`（30 处）
- `https://hike-teaching-center.polymas.com`（9 处）
- `https://onlineexamh5new.zhihuishu.com`（4 处）
- `https://www.zhihuishu.com`（2 处）、`https://onlineweb.zhihuishu.com`（2 处）
- `https://studyvideoh3.zhihuishu.com`、`https://hike.zhihuishu.com`

但这是**唯一一个能让「VM 显示已安装、页面上毫无动静」的 metadata 项**，也是与用户症状 100% 吻合的项：Violentmonkey 的脚本列表始终显示「已安装」，但当标签页 URL 不匹配任何 `@match` 时，VM 图标上不显示该脚本，页面里也什么都不会发生 —— 用户的主观感受就是「跟没装一样」。

风险点：智慧树一旦启用新域名/裸域/其他 TLD（例如 `.cn` 已在列但 `.net`/`.edu.cn` 不在列），脚本会**整体静默失效**，且没有任何提示。

### 1.2 【中】`dist/install.html` 是 v0.6.2 的旧包，且未纳入 Git

- `dist/install.html` 内嵌脚本的 `@version` = **0.6.2**（`grep "@version" dist/install.html`），标题也是 `v0.6.2`
- 当前 `dist/zhihuishu-helper.user.js` 已是 **0.6.3**（`dist/zhihuishu-helper.user.js:4`）
- `dist/install.html` 里 `0.6.3` 出现次数为 **0**
- `git ls-files dist/` 只有 `dist/zhihuishu-helper.user.js` —— install.html **不在版本库里**（`.gitignore` 的 `dist/*` + `!dist/zhihuishu-helper.user.js`），它只存在于本地磁盘，生成于 09-18 22:09，而 dist 重建于 09-19 00:04

后果：用户如果走「一键安装引导页」这条路径，装进去的是 **v0.6.2**。`npm run release` 虽然会重建它（`package.json` 的 `release` 脚本），但当前仓库状态没有重建过。这与「装了 27 次都一样」高度吻合 —— **每次装的可能是同一份过期包**。

---

## 2. src/07-main.js 启动链：每一步的静默失败点

启动链原文：`src/07-main.js:4-105`（dist 中对应 `dist/zhihuishu-helper.user.js:5203-5309`）。

```
07-main.js:7   if (!ZHS || !ZHS.Util) return;      ← 【静默早退 #1】
07-main.js:9   if (ZHS.__mod07_main) return;       ← 【静默早退 #2】重入守卫
07-main.js:87  readyState==='loading' ? 等 DOMContentLoaded : 立即 boot()
07-main.js:15  async function boot()
07-main.js:17    initialized = true;               ← 【关键】先置位，再干活
07-main.js:19    Log.info('=== 初始化开始 ===')
07-main.js:22    ZHS.Catalog.redetect();           ← 【可抛异常，且在 mount 之前】
07-main.js:25    ZHS.Catalog.getCourseId();        ← 同上
07-main.js:31    if (ZHS.panel) ZHS.panel.mount(); ← 【面板出现与否的唯一开关】
07-main.js:34    await U.waitFor('video', 30000)
07-main.js:75    if (!initialized && v) boot();    ← 【自愈通道】
```

### 2.1 【高】`boot()` 全程没有 try/catch，且 `mount()` 排在第 1、2 步之后

`src/07-main.js:15-60` 的 `boot()` 是 `async` 函数，**没有任何 try/catch**。第 3 步才挂面板（`:31`），第 1、2 步是识别页面版本和课程 ID（`:22`、`:25`）。

只要 `:22` 或 `:25` 抛任何异常（例如真实页面上 `scoreAdapter` 之外的路径访问了 null），整个 `boot()` 立刻中断，变成 **unhandled promise rejection**：

- 面板**永远不出现**（`mount()` 在异常点之后）
- 页面**零提示**（只写 console，用户不看控制台）
- 更糟的是 `initialized` 在 `:17` 已经被置成 `true`，于是 `watchSpa` 的兜底自愈 `if (!initialized && v) boot()`（`:75`）**永远不会被触发** —— 一次异常，永久失效，直到刷新页面

实测中 `detect()`（`src/02-adapter.js:274-292`）与 `getCourseId()`（`src/02-adapter.js:309-319`）在 4 套夹具上都不抛异常，但这两个函数**没有任何 try/catch 包裹**：
- `detect()` 里 `scoreAdapter()`（`src/02-adapter.js:206-223`）内部有 try/catch，安全；
- 但 `detect()` 末尾 `ZHS.Log.info(...)`（`src/02-adapter.js:285`）依赖 `ZHS.state`，且 `hostBonus()`（`:173-190`）读 `location.hostname` —— 在 VM sandbox 下若 `location` 被页面覆写就会抛；
- `getCourseId()`（`src/02-adapter.js:318`）的 `location.hash.match(...)` 在 hash 为特殊形态时返回 `null`，已用 `|| []` 兜住，安全。

结论：**风险真实存在但概率中等**；真正致命的是「抛了也没人知道、也不会自愈」这个组合。

### 2.2 【中】`src/07-main.js:7` 与 `src/07-main.js:31` 的双重静默

- `src/07-main.js:7`：`if (!ZHS || !ZHS.Util) return;` —— 若 `window.ZHS` 没建立（例如 `00-config.js` 因 `src/00-config.js:9` 的 `if (window.__ZHS_HELPER__) return;` 提前退出），整个主入口**静默返回**，连一行 error 都没有。
- `src/07-main.js:31`：`if (ZHS.panel) ZHS.panel.mount();` —— **`ZHS.panel` 为 undefined 时，这里既没有 else 分支、也没有 warn/error、更没有页面提示**。只要面板模块没成功定义 `ZHS.panel`（赋值点在 `src/06-panel.js:1341`），脚本会继续往下跑完（等 30 秒视频、尝试续播……），而用户看到的依旧是「什么都没有」。

这两处合起来就是完整的「静默失效链」：面板没挂 → 执行流继续 → 没有任何可见反馈。

### 2.3 【低】`watchSpa()` 自身失败也被静默

`src/07-main.js:78-83`：`MutationObserver` 创建/启动包在 try/catch 里，失败只写 `ZHS.Log.debug`，而 debug 日志**默认不进控制台也不进面板缓冲**（`src/00-config.js:232`：`if (ZHS.config.debug) console.log(...)`）。也就是说 SPA 兜底通道挂掉了，用户和排查者都看不到。

---

## 3. src/06-panel.js：面板怎么创建、怎么进 DOM、失败有没有提示

### 3.1 创建与插入（正常路径）

`src/06-panel.js:344-372` `mount()`：

```
:345  if (this._root && document.contains(this._root)) return;   ← 幂等
:346  const host = document.createElement('div');
:347  host.id = 'zhs-helper-panel';
:348  host.style.cssText = 'all:initial';
:349  this._shadow = host.attachShadow({ mode: 'open' });
:351  style.textContent = CSS;        ← 样式走 shadow <style>，不依赖 GM_addStyle（好事）
:357  box.innerHTML = this._html();   ← 面板全部 DOM
:360  document.documentElement.appendChild(host);   ← 插到 <html> 下，不依赖 body
:363  this._bind(box);
:364  this._bindFullscreen();
:365  this.refresh();
:367  if (ZHS.config.panelVisible === false) → 移除 .panel 的 show 类
:371  ZHS.Log.debug('控制面板已挂载');
```

几个结论：

- **Shadow DOM 是正确选择**：样式不依赖 `GM_addStyle`（dist 也没 grant 它），不受页面 CSS 污染。
- **父节点是 `document.documentElement`（`:360`）**，不是 `document.body`。好处：`@run-at document-idle` 下 body 一定存在，且不会被 SPA 重建 body 时连带删掉。**这一条不是嫌疑**。
- `.wrap` 是 `position:fixed; right/bottom; z-index:2147483647`（`src/06-panel.js:126-127`），层级拉满，**不会被页面元素盖住**。
- **`.mini` 圆点按钮默认就是可见的**：`.mini { ... display: flex ... }`（`src/06-panel.js:144`），模板里 `<button class="mini">智</button>`（`src/06-panel.js:683`）在 `.panel` 之外。
  → **这条是重要的排查依据**：只要 `mount()` 跑过，用户至少能看到右下角一个 44px 蓝色圆点。用户说「面板都没有」= **连圆点都没有** = **`mount()` 根本没执行** = 问题落在第 1 节（没注入）或第 2 节（早退/异常），不在面板渲染本身。

### 3.2 【中】`mount()` 失败会被完全吞掉

- `src/06-panel.js:1228`：`try { this.mount(); } catch (e) { /* 挂载失败则放弃显示 */ }` —— 唯一一处 catch 是 `showReport()` 的兜底，注释都写了「放弃显示」，**不写日志、不提示用户**。
- `src/06-panel.js:1146-1150` `refresh()` 整体 try/catch，失败只写 `debug` 日志（默认不可见）。
- `src/07-main.js:31` 调用 `mount()` 时**不在 try 里**，异常直接冒泡炸掉 `boot()`（回到 2.1）。

**结论：面板创建失败在三种场合都不会产生任何用户可见提示。**

### 3.3 【中-低】`panelVisible` 持久化在 GM 存储里，卸载脚本不会清除

`src/06-panel.js:367`：若 `ZHS.config.panelVisible === false`，挂载后立刻 `classList.remove('show')`，只剩 44px 的 `.mini` 圆点。
配置存在 `GM_setValue('zhs-helper-config', ...)`（`src/00-config.js:151`），**Violentmonkey 的存储不随脚本卸载而清空**。
→ 用户若曾关掉「显示悬浮面板」（`src/06-panel.js:798` 的设置项），那么无论重装多少次，每次都只会得到一个小圆点，主观上就是「面板没有」。

（注：`.fold` 折叠按钮 `src/06-panel.js:832` 只改 class 不写配置，所以单纯折叠不会持久化。）

---

## 4. 依赖 `GM_*` 而 Violentmonkey 未授权时会卡住的路径？

**结论：不存在。这一层是干净的。** 逐一核对：

| 位置 | 用法 | 授权状态 | 未授权时行为 |
|---|---|---|---|
| `src/00-config.js:80` | `const hasGM = typeof GM_setValue === 'function' && typeof GM_getValue === 'function'` | 已 grant（dist:11-12） | `hasGM=false` → 走 `localStorage`（`:151-152`） |
| `src/00-config.js:162` | `hasGM ? GM_getValue(...) : localStorage.getItem(...)` | 已 grant | 安全降级 |
| `src/04-resume.js:17,21,36` | 同上模式 | 已 grant | 降级 localStorage |
| `src/06-panel.js:1105` | `typeof GM_getValue === 'function' ? ... : localStorage` | 已 grant | 安全降级 |
| `src/06b-course-hub.js:25,53,80` | 同上 | 已 grant | 安全降级 |
| `src/09-bank.js:20,31` | `typeof GM_xmlhttpRequest === 'function'` 后用 | 已 grant（dist:13） | 降级 fetch，`@connect *` 也不触发授权弹窗 |
| `unsafeWindow` / `GM_addStyle` / `GM_registerMenuCommand` / `GM_notification` | **全仓库 0 处使用** | — | 无风险 |

实测佐证：探针在**完全不提供 `GM_*`** 的 jsdom 环境里跑 `dist`，面板照样挂载（第 0 节第 5 行）。

唯一副作用：因为没有 `GM_registerMenuCommand`，**VM 的脚本菜单里没有任何入口**，用户无法从菜单侧判断脚本是否真的在跑，也无法手动触发 `window.zhs.boot()`。这加剧了「看不出装没装」的困境（`src/07-main.js:95-104` 暴露了 `window.zhs.boot()`，但用户不知道）。

---

## 5. `@run-at document-idle` 与 SPA 时机

`src/07-main.js:87-92`：

```js
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { boot(); watchSpa(); });
} else { boot(); watchSpa(); }
```

### 5.1 【低】`document-idle` 本身不会错过面板

`@run-at document-idle`（`dist/zhihuishu-helper.user.js:18`）保证执行时 `readyState` 已是 `complete`，走 else 分支立即 `boot()`。而 `mount()`（`:31`）在 `await U.waitFor('video', 30000)`（`:34`）**之前**，且 `mount()` 不依赖任何页面 DOM（只 `createElement` + `appendChild` 到 `documentElement`）。

→ **SPA 首屏晚渲染、视频懒加载，都不会导致面板不出现。** 这一点代码是刻意设计过的，注释见 `src/07-main.js:28-30`（BUG-UX-2 的修复）。

### 5.2 【中】`initialized` 置位过早 + 30 秒挂起 = 自愈通道失效

`src/07-main.js:17` 在函数一开始就 `initialized = true`，随后 `:34` `await` 最多挂起 30 秒。这 30 秒内：

- `watchSpa` 的补启动 `if (!initialized && v) boot()`（`:75`）因 `initialized===true` **永不触发**
- 若这 30 秒里用户在 SPA 内切了路由/点了别的课，脚本不会重新初始化

30 秒后走 `:35-40` 分支：写 warn 日志 + `ZHS.panel.alert('未检测到视频…')`。**这个 alert 是唯一的用户可见反馈**，但前提是面板已经挂上（`if (ZHS.panel)`，`:37`）—— 如果面板因为 2.1/2.2 没挂上，这条提示同样消失。

### 5.3 【低】MutationObserver 的 debounce 被高频 DOM 变更饿死

`src/07-main.js:64-76`：`onDomChange` 用 `U.debounce(..., 1000)`（`src/01-util.js:44-50`，每次触发重置计时器）。观察范围是 `document.documentElement` 的 `childList + subtree`（`:80`）。智慧树播放页有每秒更新的进度条/计时器文本，理论上防抖回调可能被持续推迟。
**但**这条只影响「补启动」，不影响首次 `boot()`，所以对「面板完全没有」不构成主因。

---

## 6. 汇总：按可能性排序

| # | 结论 | 证据 | 风险 |
|---|---|---|---|
| 1 | **脚本压根没在当前页面注入**：`@match` 只有 `*.zhihuishu.com` / `*.polymas.com` / `*.zhihuishu.cn` 三条（`dist:7-9`），裸域 `zhihuishu.com` 不匹配，任何新域名一律不注入。VM 仍显示「已安装」，页面毫无动静 —— 与症状完全吻合 | `dist/zhihuishu-helper.user.js:7-9` | 高 |
| 2 | **启动链的静默早退链**：`07-main.js:7` 无提示 return；`07-main.js:31` 的 `if (ZHS.panel)` 没有 else；`boot()` 无 try/catch，`:22/:25` 抛异常 → 面板永不出现 + `initialized` 已 true 导致 `:75` 自愈通道失效 | `src/07-main.js:7,15,17,22,25,31,75` | 高 |
| 3 | **装进去的是过期包**：`dist/install.html` 内嵌的是 v0.6.2（`0.6.3` 出现 0 次），且该文件不入库、只在本地磁盘，生成时间早于 dist 重建 | `dist/install.html`、`tools/make-install-page.js:16-17` | 中高 |
| 4 | **面板挂上了但被折叠成小圆点**：`panelVisible` 存在 GM 存储里（`00-config.js:151`），卸载不清空，重装多少次都是同一个状态 | `src/06-panel.js:366-369`、`src/00-config.js:151` | 中 |
| 5 | **面板创建/挂载失败全静默**：`06-panel.js:1228` catch 后直接放弃；`refresh()` 失败只写 debug；没有任何 console.error 或页面提示 | `src/06-panel.js:1146-1150,1228` | 中 |
| 6 | **SPA 时机不是问题**：`mount()` 在等视频之前、不依赖页面 DOM，`document-idle` 足够早 | `src/07-main.js:31-34`、`src/06-panel.js:360` | 低（已排除） |
| 7 | **GM 授权不是问题**：全部 GM 调用都有 `typeof === 'function'` 判断 + localStorage 降级，且 `@grant` 与实际使用完全对齐；`@connect *` 不触发授权弹窗 | `src/00-config.js:80`、`src/09-bank.js:20`、`dist:11-17` | 低（已排除） |

---

## 7. 建议用户做的自检（按成本从低到高）

1. **先确认到底有没有注入**：打开智慧树学习页 → F12 Console → 输入 `window.ZHS` 回车。
   - `undefined` → 脚本没注入（域名不在 `@match`，或 VM 里该脚本被禁用/该站点被排除）→ 把地址栏完整 URL 发出来核对
   - 有对象 → 继续第 2 步
2. **手动触发面板**：Console 里执行 `window.zhs.boot()`（入口在 `src/07-main.js:95-97`）。若报错，错误信息就是根因；若执行后右下角出现蓝色圆点「智」，说明只是折叠状态（第 4 条）。
3. **看右下角**：`.mini` 圆点默认可见（`src/06-panel.js:144,683`）。有圆点 = 面板挂上了；连圆点都没有 = `mount()` 没执行。
4. **确认版本**：Console 输入 `ZHS.version`，应为 `0.6.3`。若是 `0.6.2`，说明装的是 `dist/install.html` 里的过期包 → 直接装 `dist/zhihuishu-helper.user.js` 本体。
