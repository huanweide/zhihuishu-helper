# round-2 深挖：getChapterName 归属 / 三处改造回归核对 / ended 信号对照

> 调研人：edge-cases｜性质：**只读，未改 src/，未跑 build.js**
> 上游：team-lead 裁决 3 项（评分选举已落地；本报告核对后续改造方案 + 两个专项问题）

---

## 0. 结论速览

| # | 问题 | 一句话结论 |
|---|---|---|
| 1 | ocsjs `getChapterName(root)` 的 root 是什么；`.catalogue_title` 是章节名还是课时名 | **root 永远是单个目录条目**（getNext 的返回值）；`.catalogue_title` 在 ocsjs 模型里是**条目内部的课时名**。我们的 `legacy.title` 应写成 `'#lessonOrder, .catalogue_title'` 双选——两种现实都安全 |
| 2 | itemTitle 纯序号兜底 | 方案可行，但有一个**比显示更严重的连带雷**：纯序号 lessonKey 会让 `findByName` 的子串匹配把 "1.1" 匹到 "1.11"（02-adapter.js:528），SPA 重定位点错条目。兜底必须连着 findByName 一起改 |
| 3 | isFinished 收紧（限定 i/span/em/img/svg） | **对 wisdom/fusion/hike/polymas 零回归**（四套的专属 finish 都走规则 1，不经过规则 2）。但别加"叶子节点"要求（图标常被 `<span class="icon-x"><svg/></span>` 包一层，非叶子会被误杀）；改用"文本 ≤2 字"判据。另发现规则 3 的文本匹配有**课名地雷**（课名含"已学"的课会被永久跳过） |
| 4 | hasActive 白名单 | 白名单本身对六套适配器全兼容，但**缺 `is-current`**（Element UI tree 当前节点类）；真正风险在规则 3 的 `cur.contains(el)`（02-adapter.js:552）：polymas 的 `[class*="lesson-item"]` 是子串匹配，能命中复数容器 `lesson-items`，一旦它带 .active，所有条目 hasActive 恒真 → **clickAndVerify 首点即假成功，切课失败被静默掩盖** |
| 5 | ended 信号对照 | 我们的事件等价物齐全（`atEnd` 含 `v.ended`），差异不在信号本身，而在**结束后多依赖两层平台侧信号**（目录完成标记 + 平台进度百分比）+ 固定 8s 盲等。给出的低成本优化：把 8s 盲等改成"每 1s 查一次完成标记、命中提前走"的轮询，平均每节省 ~5s |
| 6 | 证据更新（对裁决 3 的重要补充） | **全仓库没有任何真实播放页 DOM**：`reference/live/rendered-stuStudy.html`（410KB）标题是"登录中心"，类名全是 `el-input/yidun_input`——上次 CDP 实测被登录+易盾验证码拦住，从未进过播放页。夹具+CDP 自测只能证明"代码与夹具自洽"，不能证明"夹具=真实页面"。好在评分制让运行时自适应，真正的核查点是新版 detect() 打的评分日志，建议列为用户首跑观察项 |

---

## 1. 【问题 3】`getChapterName(root)` 的 root 到底是什么

### 1.1 接口与实现

`reference/ocsjs-zhs.ts:53`（接口）：

```ts
	getChapterName(root: HTMLElement): string;
```

`reference/ocsjs-zhs.ts:76-78`（StudyVideoH5 实现）：

```ts
	getChapterName(root: HTMLElement): string {
		return root.querySelector('.catalogue_title')?.textContent || '未知章节';
	}
```

关键点：用的是 **`root.querySelector`（查子孙）**，不是 `root.closest`（查祖先）。
所以 `.catalogue_title` 必须在 root **内部**才可能被取到。

### 1.2 全部调用点追查（共 2 处实际调用，root 全是单个条目）

**调用点 1** —— gxk-study 主循环，`reference/ocsjs-zhs.ts:910-914`：

```ts
				const study = async (opts: { next: boolean }) => {
					if (state.study.stop === false) {
						const item = processor.getNext({ next: opts.next, restudy: this.cfg.restudy });
						if (item) {
							const msg = '即将学习：' + processor.getChapterName(item);
```

`item` 来自 `getNext()`，而 `getNext` 返回的是 `document.querySelectorAll('.clearfix.video')` 中的某一个
（`reference/ocsjs-zhs.ts:81-94`）→ **root = 单个 `li.clearfix.video` 条目**。

**调用点 2** —— wisdom-mooc 脚本（WishdomH5），`reference/ocsjs-zhs.ts:1901-1904`：

```ts
						const current = document.querySelector<HTMLElement>(
							'.chapter-item.current , .chapter-content-second.current'
						);
						const cn = current ? processor.getChapterName(current) : '未知章节';
```

→ **root = 单个当前条目**。

其余 4 处命中是接口声明（53）和子类覆写（204/214/310/417/532/577），不是调用点。

### 1.3 子类覆写进一步佐证「root=条目、结果是课时名」

`reference/ocsjs-zhs.ts:204-215`（FusionCourseH5，resource-box 模式）：

```ts
	getChapterName(root: HTMLElement): string {
		// AI 助教课有两种进度模式，一个是百分百，一个是必学项目进度条
		const is_resource_box_mode = !!document.querySelector('.resource-box');
		if (is_resource_box_mode) {
			// 小节名称
			const card_name = root.querySelector('.file-name');
			if (card_name) {
				return card_name.textContent || '未知章节';
			}
		}
		return super.getChapterName(root);
	}
```

注释明写 `.file-name` 是「**小节名称**」，且同样从 root（条目）内部查 → 同一语义。

`reference/ocsjs-zhs.ts:310-312`（StudyPlusH5）：

```ts
	getChapterName(item: HTMLElement): string {
		return item.parentElement?.textContent || '未知章节';
	}
```

参数名直接叫 `item`。`reference/ocsjs-zhs.ts:417-419`（WishdomH5）同理：`item.textContent`。

### 1.4 结论与落地

**`.catalogue_title` 在 ocsjs 的模型里是"每条 video 条目内部的课时名"，不是章节分组标题。**

诚实的边界说明：如果真实页面把 `.catalogue_title` 放在 li **外面**（作章节标题），ocsjs 这行会永远返回
'未知章节'——这**只影响一条 toast 文案，不影响任何功能**，所以没法从"ocsjs 没坏"反推出"条目内必有它"。
但一个 3428★、维护到 2025-12 的项目把这一行原样用了两年，倾向支持"条目内"模型。

**落地建议**：`legacy.title` 写成双选（改 `src/02-adapter.js:68`）：

```js
      // ocsjs StudyVideoH5 的课时名取条目内部的 .catalogue_title（reference/ocsjs-zhs.ts:77，
      // root=getNext 返回的单个 .clearfix.video 条目，getChapterName 用 root.querySelector 查子孙）；
      // autovisor 的 #lessonOrder（lesson_navigation.py:58）是另一路取法（title 属性优先）。
      // 双选安全：若 .catalogue_title 其实在条目外（章节标题），el.querySelector 查不到 → 自动落空，无害。
      title: '#lessonOrder, .catalogue_title',
```

配合 §2.1 的"纯序号兜底"使用（`#lessonOrder` 若只含 "1.1"，落到 `.catalogue_title` 补全名）。

**顺带纠正一处夹具注释**：新夹具 `test/fixtures/studyvideoh5-legacy.html:28/48` 把 `.catalogue_title`
建模为 **li 外面的章节标题**：

```html
    <div class="catalogue_title">第一章 函数与极限</div>
    <ul>
      <li class="clearfix video">...
```

这与 ocsjs 的模型**相反**。夹具本身可以照用（它测的是评分选举和点击，不测标题），
但建议注释里别写"按 ocsjs"，或在 §1 这条结论落地后同步调整夹具——否则后人会把夹具当成 ocsjs 权威结构的证据，
重演"拿结论当证据"的循环。

---

## 2. 【问题 1】三处改造的回归核对

### 2.1 itemTitle 回退链（现码 `src/02-adapter.js:356-368`）

现链：① `el.querySelector(ad.title)` → 有 `title` 属性用属性，否则文本；② `el.querySelector('span[title]')`；③ `U.normText(el.innerText).slice(0,80)`。

**纯序号场景的真实影响面**（比"显示难看"严重）：

`ad.title='#lessonOrder'` 若文本只有 "1.1"（无 title 属性），则：
- `ZHS.state.lessonKey = "1.1"`（`src/05-scheduler.js:521`）
- **第 1 章 1.1 和第 2 章 2.1 不冲突，但 "1.1" 与 "1.11" 冲突**：`findByName` 的兜底是子串匹配
  （`src/02-adapter.js:528`）：

```js
      hit = all.find((el) => this.itemTitle(el).includes(key) || key.includes(this.itemTitle(el)));
```

  key="1.1" 时，`itemTitle(el)="1.11 xxx"` 的 `includes("1.1")` === true → **命中错误条目**。
  触发路径：`clickAndVerify` 里节点被 SPA 重渲染后按标题重定位（`src/02-adapter.js:606-609`）。
  后果：重点到错误的课时——这正好又是"点了没反应/切错课"的一种成因。

**建议的兜底链**（伪代码，可直接抄）：

```js
    itemTitle(el) {
      if (!el) return '';
      const ORD = /^\d+(\.\d+)+$/;              // 纯序号：1.1 / 2.10（不带文字）
      const pick = (t) => {
        if (!t) return '';
        const attr = t.getAttribute && t.getAttribute('title');
        const v = U.normText(attr || t.innerText || t.textContent);
        return v;
      };
      // 1. 适配器专属标题
      let v = pick(el.querySelector(this.adapter.title));
      // 2. 纯序号 → 试条目内 .catalogue_title（仅 legacy，ocsjs 课时名位）
      if (this.adapter.name === 'legacy' && (!v || ORD.test(v))) {
        const c = pick(el.querySelector('.catalogue_title'));
        if (c && !ORD.test(c)) v = c;
      }
      // 3. 通用 span[title]
      if (!v || ORD.test(v)) {
        const s = el.querySelector('span[title]');
        const c = s ? U.normText(s.getAttribute('title')) : '';
        if (c && !ORD.test(c)) v = c;
      }
      // 4. 整行文本，去掉尾部百分比/时长噪声（normText 已折叠空白）
      if (!v || ORD.test(v)) {
        v = U.normText(el.innerText || el.textContent)
          .replace(/\d+(\.\d+)?\s*%/g, '')          // 进度
          .replace(/\s*\d+:\d{2}(:\d{2})?\s*$/,'')  // 结尾时长
          .trim().slice(0, 80);
      }
      return v;
    }
```

要点：
- 纯序号判定用 `/^\d+(\.\d+)+$/`（至少带一个点），避免把 "第1章" 这种短名误伤——短但非纯序号的名字是有信息量的。
- `.catalogue_title` 兜底**限定 legacy**，防止在 wisdom/fusion/hike 页面撞上同名异义元素。
- **必须连着改 `findByName`**：子串匹配加最短长度或词边界，二选一即可：

```js
      // 包含匹配兜底：序号型 key 的子串匹配会误命中（"1.1" ⊂ "1.11"），加词边界
      const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(^|\\s)' + esc + '(\\s|$)');
      hit = all.find((el) => { const t = this.itemTitle(el); return re.test(t) || t.includes(key) && key.length >= 4; });
```

- 加一条**唯一性自检**（防 lessonKey 全表重名）：在 gotoNext 设 key 前比对
  `new Set(items.map(itemTitle)).size === items.length`，不唯一时 `Log.warn('目录存在重名课时，标题定位不可靠，将以 DOM 顺序为准')`。低成本，能提前暴露 §1 的另一种现实（`.catalogue_title` 若真是章节名，条目名就会全表重名，这条日志正好把它钓出来）。

### 2.2 isFinished 收紧（现码 `src/02-adapter.js:376-396`）

**回归影响面核对（逐适配器）**：

| 适配器 | 规则 1（专属 finish，02-adapter.js:381） | 规则 2 会不会被用到 |
|---|---|---|
| wisdom `.child-check`（31） | ✅ 覆盖 | 正常情况不依赖 |
| fusion `.finish-icon`（44） | ✅ 覆盖 | 同上 |
| hike `.icon-finish`（55） | ✅ 覆盖 | 同上 |
| legacy `.time_icofinish`（67） | ✅ 覆盖 | 同上 |
| card2025 `.finished-icon`（79） | ✅ 覆盖 | 同上 |
| polymas `[class*="finish"],[class*="complete"],[class*="done"]`（91） | ✅ 覆盖（本身就是宽匹配） | 同上 |

**结论：收紧规则 2 对六套适配器零回归**——规则 1 全部兜住了各自的专属标记，规则 2 只是变体安全网。

**但方案本身有两处要修正**：

1. **不要加"非图标标签要求叶子节点"**。图标常被包一层：`<span class="icon-done"><svg/></span>`——
   这个 span 有子节点，不是叶子，会被误杀。改用**"文本极短"**判据：完成图标不带文字，
   `matched.textContent.trim().length <= 2` 即视为图标；带"已完成"文字的徽标交回规则 3 处理。
2. 标签白名单建议 `i, em, svg, img, use, b, span`，**不含 div**（div 多为结构容器；
   polymas 若真用 div 打完成类，它的规则 1 已经宽匹配覆盖）。

**顺带发现的两个既有问题（比收紧更值得先修）**：

3. **类名打在条目自身上的完成态会漏**。规则 1 用 `el.querySelector`（只查子孙，02-adapter.js:381），
   若平台把 `done` 打在条目本身（如 `<div class="child-info hasvideo done">`）就查不到。
   `isLocked` 已有先例（`el.matches(ad.locked)`，02-adapter.js:419），建议规则 1 补一句：

```js
        if (ad.finish && (el.matches(ad.finish) || el.querySelector(ad.finish))) return true;
```

4. **规则 3 的课名地雷**（02-adapter.js:390-391）：

```js
      const txt = U.normText(el.innerText || el.textContent);
      if (/(已完成|已学完|已学习|学完|已看完|已学|100\s*%)/.test(txt)) return true;
```

   `innerText` 是**整条条目**的文本——包含课时名。任何一门课叫《已学知识梳理》《学完这节课你将收获》
   之类，条目会被**永久判完成 → 永远跳过**；`100\s*%` 也可能撞上标题里的百分数。
   建议：规则 3 改为"等值匹配 + 限定小元素"，并把 `100\s*%` 删掉
   （规则 4 的 `_readProgress` 走 `.progress-num`/`aria-valuenow` 精确通道，已经覆盖了这个需求）：

```js
      // 3. 徽标文本：只认「等值」的完成文案，且必须是短文本元素（防止课时名含「已学」被误判）
      const badges = el.querySelectorAll('i, em, span, b, div');
      for (const b of badges) {
        const t = U.normText(b.textContent);
        if (t && t.length <= 6 && /^(已完成|已学完|已学习|已看完|学完)$/.test(t)) return true;
      }
```

### 2.3 hasActive 白名单（现码 `src/02-adapter.js:539-555`）

**白名单逐适配器核对**（`02-adapter.js:546`：`^(active|current_play|current-play|current|is-active|selected|playing)$`）：

| 适配器 | 平台真实 active 类 | 白名单覆盖 |
|---|---|---|
| legacy | `current_play`（ocsjs-zhs.ts:89） | ✅ |
| wisdom | `current`（ocsjs:335；autovisor active_class） | ✅ |
| fusion | `current` / `current_play`（ocsjs:293） | ✅ |
| hike | `active`（ocsjs:1529 `.file-item.active`） | ✅ |
| card2025 | `active`（ocsjs:1166/242） | ✅ |
| polymas | `active` / `is-active` | ✅ |
| （HikeV2） | `is-current`（ocsjs:602，Element UI tree 当前节点类） | ❌ **建议补 `is-current`** |

**白名单本身的安全性**（已核对，无需担心）：
- 只查 `el` **自身** className（544-546 行），不查子孙 → 页面上下拉菜单的 `.selected`、tab 的 `.is-active` 都不构成误伤；
- 正则全词锚定（`^...$`）→ `current-term`、`selected-count` 这类不会误命中。

**真正的回归风险在规则 3（550-553），与白名单无关但要一起看**：

```js
      try {
        const cur = ad.active ? document.querySelector(ad.active) : null;
        if (cur && (cur === el || el.contains(cur) || cur.contains(el))) return true;
      } catch (e) { /* 选择器兼容 */ }
```

`cur.contains(el)` 是危险方向：polymas 的 active 选择器是 `[class*="lesson-item"].active`（02-adapter.js:90），
`[class*=` 是**子串**匹配，会同时命中复数容器 `lesson-items`。一旦那个容器带 `.active`，
`cur.contains(el)` 对**所有**条目都为 true → `hasActive` 恒真 →
`clickAndVerify`（02-adapter.js:604）第一次点击就"确认成功"→ **切课失败被静默掩盖**，
连 05-scheduler.js:612 的"点击 N 次仍未见切换"告警都不会触发。
建议只留同向判定：

```js
        if (cur && (cur === el || el.contains(cur))) return true;
```

（`el.contains(cur)` 保留：active 类打在条目内部标题上是现实存在的形态。）

---

## 3. 【问题 2】ocsjs「本节看完」信号 vs 我们的判定（逐行对照）

### 3.1 ocsjs 侧（权威基线，`reference/ocsjs-zhs.ts`）

| 行号 | 机制 | 角色 |
|---|---|---|
| 2500-2504 | `video.onended = () => { clearInterval(...); actions.onended({ next: true }); }` | **唯一正式"看完"信号** |
| 2477-2488 | `setInterval(3000)` 查 `video?.isConnected === false` | 不是轮询进度；是检测"用户手动切走"（video 被摘出 DOM）→ `onended({next:false})` 重播用户选中项 |
| 2492-2498 | `video.onpause` → 未 ended 且未停止就续播 | 保活 |
| 2447/2464 | `media.currentTime = 1` / `media.pause()` | 起播重置 |
| 917 | `await $.sleep(3000)`（点击目录后） | 给 SPA 反应时间 |
| 952-959 | reload 分支：共享课不刷新页面，重点当前侧栏项 | 失败恢复 |

**ocsjs 全文没有：MutationObserver、平台进度轮询、目录完成标记轮询**（完成标记 `.time_icofinish` 只在 `getNext` 里用来**过滤**待学列表，84 行，不用于"何时切"）。

### 3.2 我们侧（`src/03-player.js` + `src/05-scheduler.js`）

| 我们的位置 | 机制 | 与 ocsjs 的关系 |
|---|---|---|
| `03-player.js:39-44` `atEnd`：`v.ended \|\| currentTime/duration >= 0.995` | 事件语义的**属性读法** + 99.5% 兜底 | ✅ 等价偏宽。END_RATIO 兜底必要（有些播放器 seek 到末尾不触发 ended）；`hasValidDuration`（33-36）挡住了 duration=0/NaN |
| `05-scheduler.js:359` 每 2s 轮询 `atEnd` | 轮询而非事件驱动 | ⚠️ 与 ocsjs 差异：切换延迟最多 2s，可接受；无需改 |
| `05-scheduler.js:355-357` `NAV_COOLDOWN_MS=15000` 冷却闸门 | 屏蔽切课后旧 video 的残留 ended | 等价于 ocsjs 的 `isConnected` 轮询（2477-2488），目的相同、手段不同，✅ |
| `05-scheduler.js:376` `END_SETTLE_MS=8000` 固定盲等 | 等平台打勾+上报 | **ocsjs 无对应物**（它 ended 后只 sleep(3000) 就点，917/1922 行）。我们多等 5s |
| `05-scheduler.js:384` 分支 1 `isFinished(cur)` | 目录完成标记 | **ocsjs 不用于结束判定**——我们独有的平台侧依赖（但这是"对勾金标准"产品铁律的有意设计，不是 bug） |
| `05-scheduler.js:391-399` 分支 2 `progressOf(cur)>=95`、分支 4 `retryFromPlatformProgress` | 平台进度百分比（`.progress-num`/`aria-valuenow`，`02-adapter.js:69/33`） | ocsjs 仅在 fusion 非 resource-box 模式用 `progress-num !== '100%'` **过滤列表**（278-281 行），同样不用于结束判定 → 我们第二层平台侧依赖 |
| `03-player.js:141-170` `retryFromPlatformProgress`（回退重播 ≤2 次） | 平台进度不同步补救 | ocsjs 无；`retryFromPlatformProgress` 的三道闸（155-161 行，0% 不回退/末端 5s 钳制/区间校验）已消掉"卡死在一节"的老坑 ✅ |
| `04-resume.js:181-186` timeupdate/pause/pagehide/visibilitychange | 仅续播保存 | 不参与结束判定 ✅ |
| Element UI 进度条宽度（`.progressbar`/`.progressbar_box` 宽度比对，`zhs-assistant/main.js:43`） | —— | **我们没有用**（当前代码无此依赖，grep 全 src 零命中）。无需处理，仅在报告里澄清 |
| MutationObserver | —— | 我们也没用（grep 全 src 零命中），与 ocsjs 一致 ✅ |

### 3.3 依赖的不可靠信号清单（按风险排序）

1. **平台目录完成标记**（分支 1）—— 受平台渲染时机影响；我们已用 8s 盲等 + 收紧判定对冲。保留（产品铁律）。
2. **平台进度百分比**（分支 2/4）—— 受平台上报延迟影响；已有 95% 阈值 + 0% 直跳 + 2 次重播上限三重对冲。保留。
3. **固定 8s 盲等**（END_SETTLE_MS）—— 不是信号，是成本：**每节课固定多花 8 秒**。
   **低成本优化建议**（不改架构，只改等待方式）：把 `await U.sleep(END_SETTLE_MS)` 换成
   "每 1s 查一次 `Catalog.isFinished(cur)`，命中即提前走，最多 8s"的轮询。
   平台打勾快时平均省 ~5s/节，慢时行为与现在完全一致：

```js
        // 原：await U.sleep(END_SETTLE_MS);
        // 新：等平台打勾，但打勾即走（最多 END_SETTLE_MS）
        const settleDeadline = Date.now() + END_SETTLE_MS;
        while (Date.now() < settleDeadline) {
          await U.sleep(1000);
          const c = ZHS.state.lessonKey
            ? (ZHS.Catalog.findByName(ZHS.state.lessonKey) || ZHS.Catalog.current())
            : ZHS.Catalog.current();
          if (c && ZHS.Catalog.isFinished(c)) break;
        }
```

4. **一个 ocsjs 有、我们没有的信号**：`video.isConnected` 轮询（检测"用户手动切走了视频"）。
   我们用 NAV_COOLDOWN 部分覆盖，但冷却期**外**如果用户手动点了另一节，我们的 2s 轮询仍会拿旧 video
   的 ended 态进 `onLessonEnd` → `gotoNext` 会按"当前项往后"覆盖用户的选择。
   低成本对冲：`onLessonEnd` 入口处比对 `Catalog.current()` 与 `ZHS.state.lessonKey`，
   漂移则更新 lessonKey 并直接 return（用户意图优先）。可选，非阻塞。

---

## 4. 【证据更新】全仓库没有真实播放页 DOM（对裁决 3 的补充）

这次逐个核实了仓库里所有疑似"真实数据"：

| 素材 | 实际内容 | 结论 |
|---|---|---|
| `reference/live/rendered-stuStudy.html`（409KB） | `<title>登录中心</title>`；类名全是 `el-input/el-overlay/yidun_input`（易盾验证码） | **CDP 实测被登录+验证码拦住，从未进过播放页** |
| `reference/live/stuStudy.html`（3.9KB） | `<title>我的学堂_在线学堂_智慧树</title>` | 学习首页，非播放页 |
| `reference/live/live-01-初始状态.png`、`live-shots/01~03.png` | 登录页 / 滑块拼图验证码截图 | 同上 |
| `docs/01-侦察报告.md:4` | 自述侦察方式="GitHub 开源项目源码逆向 + 油猴脚本比对 + 平台文档" | 非抓包；且 §2.2 把 studyvideoh5 标成 wisdom 版（与 ocsjs 矛盾） |
| `test/fixtures/real-h5.html`、`studyvideoh5-legacy.html`、`real-legacy.html` | 自注"自测夹具" | 手写替身 |

**推论**：夹具 + CDP 自测能证明"代码与夹具自洽"，**不能证明"夹具 = 用户 2026 年的真实页面"**——四种说法
（侦察报告的 wisdom / ocsjs 的 legacy / gf558335 的 hike / 评分制兼容）目前没有任何一个有真实页面背书。

**但这不阻塞开发**：裁决 1 的评分选举在运行时自适应，谁真用谁。
真正的核查点是**新版 `detect()` 打的评分日志**（`src/02-adapter.js:274-275`，
"页面版本识别为：… 评分 N；候选评分 legacy=x / hike=y / …"）——建议把"用户首跑后把这条日志发回来"
列为观察项，一次就能把四派争论钉死。这比任何内部推演都硬。

**评分选举本身的推演核对**（用两份夹具手工验算）：
- `studyvideoh5-legacy.html`（旧结构+3 个 .file-item 干扰）：legacy = 5 条目 + current_play +100 + 容器 +20 + 题名 +10 + host 3 ≈ **135**；hike = 3 干扰条目 + 无 active + 无 .el-tree + 9 + host 3 ≈ **12** → legacy 胜，干扰项被压掉 ✅
- `real-h5.html`（hike/el-tree 结构）：hike ≈ 12+100+20+题名+3 ≈ **159**；legacy = 0 → hike 胜 ✅
- 无 current_play 的边界（刚打开未播放）：legacy = 5+20+10+3 = 38 仍 > hike 12 ✅

评分制成立，未发现会误伤 wisdom/fusion/hike/polymas 的场景。

---

## 5. 给 team-lead 的行动清单（按优先级）

1. **【必修】hasActive 规则 3 删掉 `cur.contains(el)`**（02-adapter.js:552）——不修的话 clickAndVerify 的失败检测在 polymas 页会被静默绕过，这是本轮核对发现的最大回归雷。
2. **【必修】isFinished 规则 3 改等值匹配 + 删 `100\s*%`**（02-adapter.js:391）——课名含"已学/学完"的课会被永久跳过。
3. **【必修】itemTitle 纯序号兜底 + findByName 词边界**（02-adapter.js:356-368 / 528）——两者必须一起改，否则序号型 lessonKey 会重定位到错误条目。
4. **【建议】规则 1 补 `el.matches(ad.finish)`**（02-adapter.js:381）——覆盖完成类打在条目自身上的形态。
5. **【建议】白名单补 `is-current`**（02-adapter.js:546）。
6. **【建议】END_SETTLE_MS 盲等改轮询**（05-scheduler.js:376）——平均每节省 ~5s。
7. **【建议】legacy.title 改 `'#lessonOrder, .catalogue_title'`** + 夹具注释纠偏（§1.4）。
8. **【观察项】用户首跑的 detect 评分日志**——唯一的"真实页面"事实核查点。

*报告结束。只读调研，未修改 src/ 任何代码；本轮新增临时文件已清理。*
