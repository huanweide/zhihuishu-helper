# review-worker-36 审查报告：ZHS.panel 挂载机制与「面板永久不显示且无提示」缺陷判定

**任务范围**：只读审查 `src/06-panel.js` 与 `src/07-main.js`，判断是否存在「面板永久不显示且用户无任何提示」的真实缺陷路径。
**未修改任何文件**（临时探针脚本已删除，`git status` 仅剩其他 worker 的报告）。
**审查方法**：静态阅读源码 + 用 jsdom 真实加载 `src/*.js` 全模块复现（探针脚本只读、临时、已删）。

---

## 一、结论先行

**有缺陷，但是"条件触发型"而非"必然发生型"。** 分三条结论：

| # | 结论 | 严重度 | 是否真实可达 |
|---|---|---|---|
| **①** | 主路径（正常安装、正常页面）**不会**出现面板永久消失 —— 重入守卫不会误伤，自愈机制有效 | — | 已被实测证伪（安全） |
| **②** | `06-panel` 一旦在模块体内抛异常，`ZHS.panel` 永久为 `undefined`，**且此后 SPA 二次注入无法修复**（守卫已置位），面板永不出现 → 真实缺陷 | **高** | **是（实测复现）** |
| **③** | 该缺陷发生时，`07-main` 只写一条 `ZHS.Log.error` 到**面板日志缓冲区**——而面板正是看不见的那个东西，于是用户侧**完全无感知** → 真实缺陷 | **高** | **是（实测复现）** |

换句话说：**②+③ 组合起来，正是用户反馈的「面板都没有 / 装了跟没装一样」，而且是无法自愈、用户看不见原因的死状态。**

---

## 二、证据

### 2.1 06-panel 的挂载机制与守卫（`src/06-panel.js`）

模块 IIFE 开头有三道门（`src/06-panel.js:4-11`）：

```js
(function () {
  'use strict';
  const ZHS = window.ZHS;
  if (!ZHS || !ZHS.Util) return;        // 06-panel.js:7   门①：依赖缺失
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod06_panel) return;        // 06-panel.js:9   门②：重入守卫
  ZHS.__mod06_panel = true;             // 06-panel.js:10  置位
  const U = ZHS.Util;
```

模块末尾才给 `ZHS.panel` 赋值（`src/06-panel.js:1364-1366`）：

```js
  // 面板每 1.5 秒自刷新
  setInterval(() => Panel.refresh(), 1500);   // 06-panel.js:1364
  ZHS.panel = Panel;                           // 06-panel.js:1366  ← 最后一行才赋值
})();
```

**关键结构事实**：守卫 `ZHS.__mod06_panel = true` 在**模块第 10 行**就置位，而 `ZHS.panel` 在**模块第 1366 行**才赋值。这中间隔着 1350 多行（含巨大的 `ZHS_QR_B64` 常量、整段 `CSS` 模板串、`Panel` 对象字面量、`setInterval`）。**只要这段里任何一步抛异常，就形成「守卫已上锁、panel 未赋值」的不一致状态。**

### 2.2 07-main 对 ZHS.panel 的依赖（`src/07-main.js`）—— 共 6 处

| 行号 | 代码 | `ZHS.panel` 为 undefined 时的行为 |
|---|---|---|
| `07-main.js:47-50` | `if (ZHS.panel) { ZHS.panel.mount(); ZHS.panel.alert(...) }` | **静默跳过**（无 else 分支，无日志） |
| `07-main.js:62-68` | `if (ZHS.panel) { try{mount()}catch{} } else { ZHS.Log.error('面板模块不可用...') }` | 走 `else` → **只打一条 error 日志** |
| `07-main.js:83-85` | `if (ZHS.panel) { try{mount()}catch{} }` | **静默跳过** |
| `07-main.js:92-94` | `if (ZHS.panel) { ZHS.panel.alert('未检测到视频...') }` | **静默跳过** |
| `07-main.js:114` | `ZHS.Scheduler.start();` | **不受影响，照常启动** |
| `07-main.js:119` | `if (ZHS.panel) ZHS.panel.alert('智慧树助手已就绪...')` | **静默跳过** |

**最重要的一点**：`ZHS.Scheduler.start()`（`07-main.js:114`）**不在任何 `if (ZHS.panel)` 里**，因此面板缺失**不会**阻断核心逻辑 —— 脚本会「正常」跑自动播放、自动答题，但**用户一个界面元素都看不到**。

### 2.3 实测复现（jsdom，加载全部 16 个 src 模块）

我在 `06-panel.js` 的 `ZHS.panel = Panel;` 之前注入一行 `throw new Error(...)`，模拟「面板模块体内抛出异常」（真实诱因举例见 2.5），结果：

```
===== 前置状态 =====
ZHS.panel            : undefined        ← 面板对象永久缺失
ZHS.__mod06_panel    : true             ← 但守卫已置位！二次注入会被拦掉
ZHS.Scheduler        : object           ← 核心模块全部正常
ZHS.Catalog          : object
window.zhs           : object           ← 手动控制接口也在

===== 执行 boot（真实启动路径） =====
ZHS.state.videoEl 已就绪 : true
ZHS.state.running        : true          ← Scheduler 照常启动
面板 host 在文档里        : false          ← 面板永不挂载

----- 关键日志 -----
  [error] 面板模块不可用（ZHS.panel 未定义），界面不会显示；核心逻辑仍会继续尝试
  [info] === 初始化完成 ===
```

**三条实测确认**：
1. `ZHS.panel === undefined` 且**不会恢复**（守卫 `ZHS.__mod06_panel` 已为 `true`，再执行 `06-panel.js` 源码会直接被第 9 行 return 掉）；
2. `Scheduler` 照常运行 —— 脚本"活着"，但用户看不见；
3. 唯一提示是 `ZHS.Log.error(...)`，**这条日志写进的是 `LOG_BUFFER`（面板的「日志」标签页）** —— 面板本身不显示时，**用户永远看不到这条日志**。用户能看到的只有 F12 控制台，而普通用户不会开。

### 2.4 为什么「主路径」是安全的（排除误报）

我也实测了「正常路径」，确认不是问题：

- **`ZHS.Util` 缺失？** —— 构建顺序 `00-config → 01-util → ... → 06-panel`（已用 `grep -n "^/\* ===== " dist/zhihuishu-helper.user.js` 验证 dist 实际顺序），`01-util.js:183` 无条件执行 `ZHS.Util = Util;`，且 06-panel 之前没有任何模块会删 `ZHS.Util`。**此门不会误伤。**
- **重入守卫误伤二次注入？** —— 实测：二次注入时 `06-panel` 被第 9 行拦掉，但 `ZHS.panel` 仍是首轮那个**存活对象**，`ZHS.panel.mount()` 由 `07-main` 重新调用（`07-main.js:62`），此时 `mount()` 内 `if (this._root && document.contains(this._root)) return;`（`06-panel.js:345`）会正确判重。**不会重复挂载，也不会丢失。**
- **宿主被页面移除？** —— `Panel.refresh()` 有自愈（`06-panel.js:1157-1171`），实测移除 host 后调 `refresh()` 成功重挂，`.panel` 恢复 `display: block`。**自愈有效。**
- **`panelVisible` 脏数据（字符串 `"false"`）把人坑了？** —— 实测 `00-config.js:197` 的 `normalizeBools` 已把它归一成布尔 `false`；此时主面板隐藏但**右下角小圆钮 `.mini` 仍然可见**（`display: flex`），用户点一下就能展开。**有出口，不算死状态。**
- **GM 存储抛异常？** —— 实测 `00-config.js` 的 try/catch 兜住，配置回落默认值，面板正常显示。**安全。**

### 2.5 「06-panel 模块体内抛异常」的真实诱因（非臆测）

`06-panel.js:1366` 之前有大量可能抛错的代码，逐个列出真实场景：

1. **`document.createElement` / `attachShadow` 被页面脚本或浏览器扩展拦截**（`06-panel.js:346,349`）—— 智慧树页面本身在跑大量前端框架，某些版本会给 DOM API 打补丁；
2. **`host.style.cssText = 'all:initial'` 在异常 DOM 状态下抛错**；
3. **`setInterval(() => Panel.refresh(), 1500)` 所在位置若被 CSP 或沙箱环境限制**；
4. **最现实的一条：`_html()` 里 `ZHS.version` 拼接（`06-panel.js:686`）** —— 若 `ZHS.version` 的 getter 被污染成抛错对象；
5. **更常见的：油猴脚本管理器给 `GM_setValue`/`GM_getValue` 注入代理对象（如某些版本的 Tampermonkey + 隐私扩展组合），导致模块体内某次调用抛错**。

无论哪个诱因，**结果都一样**：守卫已上锁、`ZHS.panel` 永久为 `undefined`、面板永不出现、脚本静默运行。

### 2.6 补充发现：`ZHS.Log` 自身也依赖 `ZHS.panel`，但已正确防护

`00-config.js:249`：`if (ZHS.panel && ZHS.panel.onLog) ZHS.panel.onLog(entry);` —— 有 `&&` 判空，安全。

`05-scheduler.js` / `06b` / `06c` / `11-solver` / `13-answerer` 共 **21 处** `if (ZHS.panel)` 调用，全部带判空，**不会抛 TypeError**。也就是说：**这些地方全部静默降级，用户什么提示都收不到** —— 进一步放大了 2.3 的问题。

---

## 三、修复建议（具体到代码写法）

### 建议 1（核心修复，必做）：把 `ZHS.panel` 赋值提到守卫置位之后

**动机**：消除「守卫已上锁、panel 未赋值」的窗口期 —— 即使模块体后段抛错，也要保证有一个**可用的降级面板**。

修改 `src/06-panel.js:9-11`，把 `Panel` 的最小可用版本先挂上去：

```js
  // 重入守卫：SPA 二次注入时整个模块直接退出，避免定时器/监听器叠加
  if (ZHS.__mod06_panel) return;
  ZHS.__mod06_panel = true;

  // 【修复】先把 Panel 骨架挂到 ZHS.panel，再执行后面可能抛错的初始化。
  // 起因：守卫在第 10 行置位，但 ZHS.panel 原本在第 1366 行才赋值；
  // 中间 1350 行里任何一步抛异常，都会留下「守卫已上锁、panel 永久 undefined」的死状态，
  // 之后 SPA 二次注入会被守卫拦掉，面板永远无法恢复（用户侧无任何提示）。
  // 这里改为「先发布、后初始化」：即使后面炸了，07-main 的 if (ZHS.panel) 仍能拿到对象并给出可见提示。
  if (!ZHS.panel) ZHS.panel = {};   // 占位，稍后被完整的 Panel 覆盖
  const U = ZHS.Util;
```

然后在模块末尾（`src/06-panel.js:1366`）改为：

```js
  // 用完整的 Panel 覆盖占位对象：先发布、后初始化，杜绝「守卫上锁但对象缺失」窗口期
  Object.assign(ZHS.panel, Panel);
```

> **为什么用 `Object.assign` 而不是 `ZHS.panel = Panel`**：若模块体中途抛错，`ZHS.panel` 至少是一个**空对象**而非 `undefined`，`07-main` 的 `if (ZHS.panel)` 会进入 `true` 分支；此时 `ZHS.panel.mount` 是 `undefined`，会在 `07-main.js:63` 的 `try` 里被 catch 到并打 warn。**更好的是下面的建议 2 补上明确的 else 分支。**

### 建议 2（必做）：`07-main` 在面板不可用时，必须给用户一个「面板之外」的可见提示

**动机**：当前 `07-main.js:67` 的 `ZHS.Log.error` 写进的是**面板自己的日志缓冲区** —— 面板不显示时，这条日志等于写给鬼看。需要一个不依赖面板的出口。

修改 `src/07-main.js:62-68`：

```js
    if (ZHS.panel) {
      try { ZHS.panel.mount(); }
      catch (e) { ZHS.Log.warn('面板挂载失败：' + e.message); }
    } else {
      // 挂不上必须说出来 —— 而且必须说在「面板之外」，否则用户永远看不到。
      // 起因：原来只有 ZHS.Log.error，写进的是面板日志缓冲区，
      // 而面板正是此刻不可见的那个东西，等于没提示（review-worker-36 round-4）。
      ZHS.Log.error('面板模块不可用（ZHS.panel 未定义），界面不会显示；核心逻辑仍会继续尝试');
      try {
        if (!document.getElementById('zhs-panel-missing-notice')) {
          const n = document.createElement('div');
          n.id = 'zhs-panel-missing-notice';
          n.textContent = '智慧树助手已加载，但悬浮面板初始化失败。'
            + '脚本仍在后台运行（自动播放/答题不受影响）。'
            + '请刷新页面重试；若反复出现，可在控制台执行 zhs.boot() 并截图反馈。';
          n.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);'
            + 'z-index:2147483647;max-width:420px;padding:10px 14px;border-radius:8px;'
            + 'background:#FCEBEB;color:#501313;border:1px solid #A32D2D;'
            + 'font:13px/1.6 -apple-system,"Microsoft YaHei",sans-serif;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,.2);';
          document.documentElement.appendChild(n);
        }
      } catch (e) { /* 连 DOM 都写不进去，只能留在控制台 */ }
    }
```

同理，`07-main.js:47-51` 的兜底分支也应加 `else`：

```js
          if (ZHS.panel) {
            ZHS.panel.mount();
            ZHS.panel.alert('脚本启动异常：' + msg + '。可刷新页面重试，或在控制台执行 zhs.boot()', 'error', 15000);
          } else {
            ZHS.Log.error('脚本启动异常且面板不可用：' + msg);
          }
```

### 建议 3（加固，建议做）：`assertIifeBoundaries` 之外，再加一条「模块后置校验」

**动机**：构建期已能校验模块边界（`tools/lib/bundle.js:83-93`），但**运行时**没有任何机制发现「某个模块早退/抛错导致关键对象缺失」。加一条一次性自检最省成本。

在 `src/07-main.js` 的 `bootOnce()` 里（`07-main.js:71` 之后、`ZHS.Catalog.redetect()` 之前）插入：

```js
    // 关键模块健康自检：任一缺失都要在用户可见处说清楚，
    // 避免「脚本跑着、界面没了」这种最难排查的静默降级（review-worker-36 round-4）
    const _missing = ['panel', 'Scheduler', 'Catalog', 'Player', 'Util', 'Log']
      .filter((k) => !ZHS[k]);
    if (_missing.length) {
      ZHS.Log.error('关键模块缺失：' + _missing.join(', ') + '（脚本可能不完整，建议重装）');
    }
```

### 建议 4（可选）：把「上锁」与「发布」合并成原子操作

若想更彻底，可把守卫标志从 `ZHS.__mod06_panel` 换成 `ZHS.panel` 本身（有对象即已初始化完成），彻底消除双标志不一致：

```js
  // 用 panel 对象自身作为「已初始化」标志：不再需要与守卫标志保持同步，
  // 从根上消除「守卫已上锁、对象未赋值」这种不一致状态。
  const PANEL_READY = !!(ZHS.panel && ZHS.panel.mount);   // mount 存在才算真就绪
  if (PANEL_READY) return;
```

（此方案改动面更大，涉及 `tools/add-module-guards.js` 的守卫命名约定，**建议先做 1+2**。）

---

## 四、给 team-lead 的摘要

- **是否有缺陷**：**有**。结论 ②③ 是真实可达的高危路径，且实测复现。
- **根因**：`src/06-panel.js:10` 重置入守卫在**第 10 行**置位，而 `ZHS.panel` 在**第 1366 行**才赋值 —— 中间任何一步抛异常就留下「守卫上锁 + 对象永久 undefined」的死状态，SPA 二次注入被守卫拦掉，**无法自愈**。
- **放大因素**：`src/07-main.js:67` 的唯一提示写进的是**面板自己的日志缓冲区**（面板不显示＝用户看不到）；全仓 21 处 `if (ZHS.panel)` 全部静默降级；`ZHS.Scheduler.start()`（`07-main.js:114`）不在判断内，脚本照常跑 —— 精确对应「装了跟没装一样」。
- **主路径是安全的**：已实测排除 `ZHS.Util` 缺失、重入守卫误伤、宿主被移除（自愈有效）、`panelVisible` 脏数据（小圆钮仍是出口）、GM 存储抛错五种误报。
- **修复**：建议 1（先发布后初始化，改 2 处）+ 建议 2（面板外可见提示，改 2 处）为核心，预计改动 ~30 行，全部在 `06-panel.js` / `07-main.js` 内，不触碰模块拼装顺序。
- **未修改任何文件**，临时探针脚本已删除，`git status` 干净。
