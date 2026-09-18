# ocsjs 中 studyvideoh5 真实选择器调研报告

> 调研人：edge-cases｜性质：**只读调研，未修改任何项目源码**
> 目标：搞清楚 `https://studyvideoh5.zhihuishu.com/stuStudy/recruitAndCourseId=xxx` 这套页面的
> 真实目录 DOM 结构和「跳下一节」的实现方式，用来修复「无法自动跳下一集 / 手动点下一节无效」。
> 权威参考：`reference/ocsjs-zhs.ts`（ocsjs 项目智慧树适配，3620 行）
> 交叉验证：`reference/autovisor/modules/lesson_navigation.py`、`reference/zhs-assistant/main.js`

---

## 0. 先讲给人听：一句话结论

**studyvideoh5 在 ocsjs 里用的是「旧共享课」这一套：目录条目是 `.clearfix.video`，当前播放项是它身上多出的一个 `current_play` 类，完成标记是条目内部的 `.time_icofinish` 图标。切下一节完全靠 `DOM 元素.click()` 直接点条目本身——不调任何 window API，不改地址栏，不用 MutationObserver。"本节看完"的唯一信号是 `<video>` 的 `ended` 事件。**

我们的 `src/02-adapter.js` 里给 studyvideoh5 排的第一位适配器刚好是 `legacy`（`.clearfix.video`），**大方向是对的**。真正出问题的地方不在「条目选择器」，而在**标题取值、点击目标、完成判定的宽泛兜底、以及"当前项"定位失败后的退化行为**这 4 处（详见第 6、7 节）。

术语解释（零基础可读）：
- **选择器**：在网页里定位元素用的字符串，类似"按名字/标签找人"。
- **MutationObserver**：浏览器提供的一种"盯着网页某块区域，一有变化就通知我"的机制。
- **`ended` 事件**：`<video>` 播放器放完后浏览器自动抛出的一个通知。
- **DOM click**：用代码模拟真实的鼠标点击，而不是调页面内部函数。

---

## 1. 页面变体归属：studyvideoh5 = `StudyVideoH5`（"共享课/旧共享课"）

### 1.1 ocsjs 把四个域名塞进了同一个脚本 `gxk-study`

`reference/ocsjs-zhs.ts:646-653`：

```ts
'gxk-study': new Script({
    name: '🖥️ 共享课-学习脚本',
    matches: [
        ['共享课学习页面', 'studyvideoh5.zhihuishu.com'],
        ['新共享课学习页面', 'studyplush5.zhihuishu.com'],
        ['新版AI课页面', 'fusioncourseh5.zhihuishu.com/stuStudy'],
        ['2025-9月新智慧共享课学习页面', 'studywisdomh5.zhihuishu.com/study/index']
    ],
```

### 1.2 然后用 URL 分流到不同的处理器

`reference/ocsjs-zhs.ts:813-827`：

```ts
const type = location.href.includes('fusioncourseh5')
    ? 'AI课程'
    : location.href.includes('studyplush5')
    ? '新共享课'
    : location.href.includes('studywisdomh5')
    ? '新智慧共享课'
    : '共享课';

const ProcessorConstructor = location.href.includes('fusioncourseh5')
    ? FusionCourseH5
    : location.href.includes('studyplush5') || location.href.includes('studywisdomh5')
    ? StudyPlusH5
    : StudyVideoH5;

const processor = new ProcessorConstructor();
```

**判定结论**：URL 里既没有 `studyplush5` 也没有 `studywisdomh5` 也没有 `fusioncourseh5`，
所以 **studyvideoh5 走的是 else 兜底分支 → `StudyVideoH5`**，`type === '共享课'`。

也就是说：**studyvideoh5 属于 ocsjs 分类里的「旧共享课」，对应我们 `ADAPTERS.legacy` 那一套**。
我们 `src/02-adapter.js:161-164` 的注释也正好写的是这个意思，优先级排第一，正确。

```js
    // studyvideoh5（旧共享课学习页）→ 按侦察 VERSION_MAP 优先 legacy 结构（.clearfix.video / .time_icofinish），
    // wisdom（.child-info.hasvideo / .child-check）兜底。两者完成标记都走 isFinished 的通用兜底，
    // 无论平台用哪套 class 都能识别右侧栏对勾/完成标记。
    if (host.includes('studyvideoh5')) return [ADAPTERS.legacy, ADAPTERS.wisdom, ADAPTERS.fusion, ADAPTERS.card2025, ADAPTERS.polymas];
```

> ⚠️ 团队里流传的怀疑「`.child-info.hasvideo` 与真实页面不匹配」——**这个怀疑的方向要修正**：
> `.child-info.hasvideo` 是 wisdom 版的选择器，本来就不该在 studyvideoh5 上生效；
> studyvideoh5 的 `legacy` 选择器本身是对的，**问题不在这里**。

### 1.3 一个很重要的附加结论：studyvideoh5 不需要"软件辅助"

`reference/ocsjs-zhs.ts:30-37`：

```ts
/**
 * 需要软件辅助的掌握度页面
 */
const remote_not_required_pages = [
    'fusioncourseh5.zhihuishu.com',
    'studywisdomh5.zhihuishu.com',
    'wisdom-mooc.zhihuishu.com'
];
```

studyvideoh5 **不在**这个名单里。名单里的页面因为视频播放器有特殊反自动化，必须借助本机软件发真实鼠标事件；
**studyvideoh5 不需要**——`reference/ocsjs-zhs.ts:931-933` 明确说明：

```ts
} else {
    item.click();
}
```

即在 studyvideoh5 上，**JS 的 `element.click()` 就能正常触发切课**。这是个好消息：
我们不需要做任何模拟鼠标的重活，只要点对了元素就行。

---

## 2. studyvideoh5 的四件套选择器（核心答案）

以下全部来自 `class StudyVideoH5`（`reference/ocsjs-zhs.ts:62-193`）。

### 2.1 单个章节条目选择器：`.clearfix.video`（无容器前缀，全文档查）

`reference/ocsjs-zhs.ts:80-84`：

```ts
getNext(opts: { next: boolean; restudy: boolean }) {
    let videoItems = Array.from(document.querySelectorAll<HTMLElement>('.clearfix.video'));
    // 如果不是复习模式，则排除掉已经完成的任务
    if (!opts.restudy) {
        videoItems = videoItems.filter((el) => el.querySelector('.time_icofinish') === null);
    }
```

注意特征：**`.clearfix` 和 `.video` 是两个并列 class 打在同一个元素上**（不是父子关系），
所以写选择器时必须是 `.clearfix.video`（中间没有空格），写成 `.clearfix .video` 会完全查不到。

### 2.2 当前播放项标识：类 `current_play`（加在条目自身）

`reference/ocsjs-zhs.ts:87-94`：

```ts
    for (let i = 0; i < videoItems.length; i++) {
        const item = videoItems[i];
        if (item.classList.contains('current_play')) {
            return videoItems[i + (opts.next ? 1 : 0)];
        }
    }

    return videoItems[0];
}
```

即当前项是 `<li class="clearfix video current_play">` 这种形态。
ocsjs 用的是 `item.classList.contains('current_play')`，等价于 CSS `.clearfix.video.current_play`。

### 2.3 完成标记（对勾）：条目**内部**的 `.time_icofinish`

`reference/ocsjs-zhs.ts:83-85`（上面已引）：

```ts
    if (!opts.restudy) {
        videoItems = videoItems.filter((el) => el.querySelector('.time_icofinish') === null);
    }
```

语义非常干净：**条目内部存在 `.time_icofinish` → 已完成 → 从待学列表里剔除**。
注意这是 `el.querySelector(...)`（查子孙），不是加到条目自身。

### 2.4 目录列表容器：ocsjs **没有用任何容器选择器**

`reference/ocsjs-zhs.ts:81` 是 `document.querySelectorAll('.clearfix.video')` —— 直接从根节点全量查，
**不经过任何父容器**。

但第三条来源告诉我们容器的形态是"兄弟列表"（见 4.2 的 `.nextAll('.video')`），
这意味着条目是**同级 `<li>`**，它们的共同父级才是真正的容器：

`reference/zhs-assistant/main.js:43-47`：

```js
if ($('.current_play').find('.progressbar').width() == $('.current_play').find('.progressbar_box').width()) {
    console.log('本节完成，' + delay / 1000 + ' 秒后将切到下一课')
    await sleep(delay)
    $('.current_play').nextAll('.video')[0].click()
}
```

`nextAll('.video')` = "取 `.current_play` 之后的所有同级 `.video` 兄弟"——**能取到兄弟，就说明它们是同一个 ul/ol 下的同级 li**。

### 2.5 顺带给出的：课时名 / 课程名 / 进度

| 用途 | ocsjs 用法 | 行号 | 我们现在的 `ADAPTERS.legacy`（`src/02-adapter.js:62-73`） |
|---|---|---|---|
| 课时名（条目内） | `root.querySelector('.catalogue_title')?.textContent` | 76-78 | `title: '#lessonOrder'` ← **与 ocsjs 不一致** |
| 课程名 | `$el('.source-name')?.textContent` | 72-74 | `courseTitle: '.source-name'` ✅ 一致 |
| 进度文本 | FusionCourseH5 分支用 `.progress-num` 且比对 `'100%'` | 278-281 | `progress: '.progress-num'` ✅ 一致 |
| 是否存在目录 | `$$el('.clearfix.video')?.length > 0` | 138-140 | 用 `items().length` ✅ 等价 |

`reference/ocsjs-zhs.ts:76-78` 原文：

```ts
getChapterName(root: HTMLElement): string {
    return root.querySelector('.catalogue_title')?.textContent || '未知章节';
}
```

`reference/ocsjs-zhs.ts:278-281` 原文（副证的进度选择器）：

```ts
            videoItems = videoItems.filter((el) => {
                const num_el = el.querySelector('.progress-num');
                return num_el === null || num_el.textContent !== '100%';
            });
```

---

## 3. ocsjs 是怎么「切下一节」的（原样摘录）

一共三段，环环相扣：**取下一项 → 点它 → 开始看**。

### 3.1 取下一项：`StudyVideoH5.getNext`（`reference/ocsjs-zhs.ts:80-95`，完整原文）

```ts
	getNext(opts: { next: boolean; restudy: boolean }) {
		let videoItems = Array.from(document.querySelectorAll<HTMLElement>('.clearfix.video'));
		// 如果不是复习模式，则排除掉已经完成的任务
		if (!opts.restudy) {
			videoItems = videoItems.filter((el) => el.querySelector('.time_icofinish') === null);
		}

		for (let i = 0; i < videoItems.length; i++) {
			const item = videoItems[i];
			if (item.classList.contains('current_play')) {
				return videoItems[i + (opts.next ? 1 : 0)];
			}
		}

		return videoItems[0];
	}
```

要点：
1. 先**整体过滤掉已完成**，再在这份"未完成列表"里找 `current_play` 的下标，返回**紧邻的下一个**。
2. 找不到 `current_play`（比如刚进页面）→ 返回第 0 个未完成项。
3. 已经是最后一个 → `videoItems[i+1]` 是 `undefined` → 上层调 `finishAlert()` 收尾。

### 3.2 点它：`study()` 主循环（`reference/ocsjs-zhs.ts:910-978`，原文节选）

```ts
				const study = async (opts: { next: boolean }) => {
					if (state.study.stop === false) {
						const item = processor.getNext({ next: opts.next, restudy: this.cfg.restudy });
						if (item) {
							const msg = '即将学习：' + processor.getChapterName(item);
							$message.info({ content: msg });
							$console.log(msg);
							await $.sleep(3000);
							// 最小化脚本窗口
							$render.moveToEdge();
							// 点击侧边栏任务
							if (remotePage) {
								if (type === '新共享课') {
									await remotePage.click('.title-box');
									await $.sleep(200);
								}
								await remotePage.click(item);
								await $.sleep(1000);
								// 两次点击修复黑屏问题
								await remotePage.click(item);
								await $.sleep(1000);
							} else {
								item.click();
							}
							...
							watch(
								processor,
								{ reloadWhenError: ..., volume: ..., playbackRate: ..., definition: ... },
								{
									reload() {
										// 旧共享课页面点击右侧栏就能重新加载
										if (type === '共享课') {
											study({ next: false });
										} else {
											location.reload();
										}
									},
									onended({ next }) {
										study({ next });
									}
								}
							);
						} else {
							finishAlert();
						}
					} else { ... }
				};
				// 当页面初始化时无需切换下一个视频，直接播放当前的。
				study({ next: false });
```

三个必须抄的细节：
1. **`item.click()`——点的是条目本身，不是里面的 `<a>`、也不是里面的标题 span。**（931-933 行）
2. **点之前固定 `await $.sleep(3000)`**（917 行）——点了也不立刻生效，需要给页面反应时间。
3. **`study({ next: false })` 是闭环的**：看下一节不是另起一个流程，而是把 `study` 这个函数**递归再调一次**，`next` 参数控制是取"下一个"还是"重取当前那个"（`videoItems[i + (opts.next ? 1 : 0)]`）。
   其中 `reload()` 分支（952-959）说明：**旧共享课（studyvideoh5）视频加载失败时，正确做法是再点一次右侧栏当前项，而不是刷新页面。**

### 3.3 另两条同宗实现，佐证「直接 DOM click」

新形态课的落地页（`reference/ocsjs-zhs.ts:1554-1561`）：

```ts
							watchXnk({ volume: this.cfg.volume }, () => {
								$message.info('视频完成播放，正在自动跳转下一节！');
								setTimeout(() => {
									/** 下一章 */
									const next = nextElement();
									if (next) next.click();
								}, 3000);
							});
```

第三份参考 `reference/zhs-assistant/main.js:46`：

```js
$('.current_play').nextAll('.video')[0].click()
```

三家一致：**都是对 DOM 元素直接 `.click()`，不查 window 上的内部函数，不改 URL/路由。**

---

## 4. ocsjs 怎么判断「本节已看完」

### 4.1 结论：靠 `<video>` 的 `ended` 事件 + 一个 3 秒定时器**只用来兜底误切**；**全文没有任何 MutationObserver**

`reference/ocsjs-zhs.ts:2477-2504`（原文完整）：

```ts
	const videoCheckInterval = setInterval(async () => {
		// 如果视频元素无法访问，证明已经切换了视频
		if (video?.isConnected === false) {
			clearInterval(videoCheckInterval);
			$message.info({ content: '检测到视频切换中...' });
			/**
			 * 元素无法访问证明用户切换视频了
			 * 所以不往下播放视频，而是重新播放用户当前选中的视频
			 */
			actions.onended({ next: false });
		}
	}, 3000);

	playMedia(() => video?.play());

	video.onpause = async () => {
		if (!video?.ended && state.study.stop === false) {
			await waitForCaptcha();
			await $.sleep(1000);
			video?.play();
		}
	};

	video.onended = () => {
		clearInterval(videoCheckInterval);
		// 正常切换下一个视频
		actions.onended({ next: true });
	};
```

拆开讲：
- **`video.onended`（2500-2504）才是"本节看完"的唯一正式信号** → 触发 `actions.onended({ next: true })` → 回到 3.2 的 `study({ next: true })` → 点下一个条目。
- **2477-2488 那个 `setInterval(…, 3000)` 不是在轮询"看完了没"**，它只查一件事：老 `<video>` 元素是不是被页面从 DOM 里摘掉了（`isConnected === false`）。摘掉 = 用户自己点了别的视频 → 于是 **不**往前跳，而是重播用户当前选中的那节（`{ next: false }`）。
- **`video.onpause`（2492-2498）**：被暂停了但不是放完 → 自动续播（先顺带处理验证码）。这是防止"卡住不动"的保活。

> **MutationObserver 检查结果**：在 `reference/ocsjs-zhs.ts` 全文检索 `MutationObserver` / `Observer` **零命中**
> （只命中 `waitForElement`、`setInterval` 等，见下面第 4.2 节列举）。
> 全文件用于"轮询"的只有这些地方：897、1543、1743、1801、1887、2018、2111、2289、2477、2538、2574、3576 行的 `setInterval`。

### 4.2 目录 DOM 本身多久扫一次？

**每切换一节课才扫一次**——`study()` 开头调 `processor.getNext()` 重新跑一遍 `querySelectorAll('.clearfix.video')`。
不存在"盯着侧栏等打勾"的逻辑。这点跟我们不一样（我们 `onLessonEnd` 里睡 8 秒专门等侧栏打勾）。

---

## 5. 五种页面变体的选择器对照表

`reference/ocsjs-zhs.ts` 里一共定义了 6 个 Processor 类，行号如下：

| ocsjs 类名 | 定义行号 | 对应页面 / 域名 | 条目 item | 当前项 active | 完成标记 finish | 与我们 ADAPTERS 的对应 |
|---|---|---|---|---|---|---|
| **`StudyVideoH5`** ← **studyvideoh5 归这里** | **62-193** | studyvideoh5.zhihuishu.com（含 `/stuStudy`） | **`.clearfix.video`**（81） | **`current_play`（类）**（89） | **`.time_icofinish`**（84） | `legacy`（02-adapter.js:62-73）✅ 选择器一致 |
| `FusionCourseH5` | 198-300 | fusioncourseh5.zhihuishu.com/stuStudy | `.clearfix.video`（256）/ resource-box 模式下 `.resources-item`（224） | `current_play`（293）/ resource-box 下 `activeNode`（289）/ 卡片模式下 `.active`（242） | `.time_icofinish`（继承）/ `.isFinish`（235）/ `.progress-num`=='100%'（278-281） | `fusion`（02-adapter.js:39-49）⚠️ 我们写的是 `.chapter-content-second`，**ocsjs 对 fusion 用的是 `.clearfix.video` 的变体** |
| `StudyPlusH5` | 305-407 | studyplush5.zhihuishu.com、studywisdomh5.zhihuishu.com/study/index | **`.child-main`**（319） | **`current`（类，加在 `.child-main` 上）**（335） | **`.finish-icon`**（326，查父元素的兄弟分支） | `wisdom`（`.child-info.hasvideo`）❌ 类名不同；`card2025`（`[class*="card-container"]`）也不同 |
| `WishdomH5` | 412-522 | wisdom-mooc.zhihuishu.com/study/index（2025-12 新） | **`.chapter-content .chapter-item`**，有子节点时摊平成 `.chapter-content-second`（426-437） | **`current`**（452） | **`.finish-icon`**（443） | 我们 `card2025` 部分沾边（`.finished-icon` 与 `.finish-icon` 差一个字母）⚠️ |
| `Hike` | 527-570 | polymas / hike 教学空间（2025-9） | `.source-icon` 的**父的父**（541-543） | 含 `.active-file` 子孙（557） | `i.select`（548） | `polymas`（02-adapter.js:86-97）靠 `[class*="..."]` 模糊匹配 |
| `HikeV2` | 572-615 | polymas AI 智慧学习（2025-9 起） | **`.el-tree-node`**（叶子节点，586-588） | 代码写的是 `classList.contains('.is-current')`（602，**注意多了个点，这是 ocsjs 自己的 bug**，永远匹配不到） | `label.success`（593） | `hike`（02-adapter.js:50-61）`.file-item` 不同 |

下面 §5.1 给出逐项比对。

### 5.1 我们 `src/02-adapter.js` 里 6 套适配器 vs ocsjs 真值（逐项比对）

| 我们的 ad | 我们的 item（行） | ocsjs 真值 | 判定 |
|---|---|---|---|
| `legacy` | `.clearfix.video`（65） | `.clearfix.video`（81） | ✅ **完全一致** |
| `legacy` | active `.clearfix.video.current_play`（66） | `current_play` 类（89） | ✅ 一致 |
| `legacy` | finish `.time_icofinish`（67） | `.time_icofinish`（84） | ✅ 一致 |
| `legacy` | **title `#lessonOrder`（68）** | **`.catalogue_title`（77）** | ❌ **不一致，详见第 6 节 A** |
| `legacy` | progress `.progress-num`（69） | `.progress-num`（279，副证） | ✅ 一致 |
| `legacy` | container `.clearfix`（70） | 无容器；条目为同级 `<li>`（副证 nextAll） | ⚠️ 有误导，但**当前代码未使用该字段** |
| `wisdom` | `.child-info.hasvideo`（29） | ocsjs 里不存在这套 class | ⁉️ 来源应是 `reference/autovisor` 而非 ocsjs（见 §7） |

---

## 6. 我们脚本与权威实现的 4 处实质偏差（这是"跳不过去"的真凶候选）

> 以下的行号都是**我们自己repo**的行号，可以直接过去看。

### A. 课时标题取错 → `lessonKey` 不可靠 → "当前项"定位退化

- `src/02-adapter.js:68` → `title: '#lessonOrder'`
- ocsjs 权威值 `reference/ocsjs-zhs.ts:77` → `.catalogue_title`

`itemTitle()`（`src/02-adapter.js:264-276`）先查 `el.querySelector(ad.title)`，查不到才回退到
`U.normText(el.innerText || el.textContent).slice(0, 80)`——**而 legacy 条目的整行文本里混有章节序号、时长、百分比**，
这种回退值噪声很大。后果链条：

```
itemTitle 回退到噪声文本
  → ZHS.state.lessonKey 记了个脏值（src/05-scheduler.js:521）
  → 下一轮 Catalog.current() 的文本兜底匹配不上（src/02-adapter.js:255-259）
  → current() 返回 null
  → findNext(null) 从下标 0 重新开始找（src/02-adapter.js:407-411）
  → 每轮都点到第 1 个"未完成"项，页面没动
  → _navFailCount 累计到 SAME_NAV_MAX（src/05-scheduler.js:489-499）
  → 弹「连续 N 次点击 XX 无效，已停止自动跳转」并 stop()
```

**这条链条和用户反馈的「手动点下一节也无效」完全吻合**：不是没点，是每次都点同一个。

### B. 点击目标点错：点了条目内部的 `<a>` / 其他版本的 class

- `src/02-adapter.js:440-452`：

```js
    click(el) {
      if (!el) return false;
      // 智慧树用 a 标签承载跳转，优先点内部可点击元素
      const clickable = el.querySelector('a, .child-name, .item-name, .file-name, span[title]') || el;
      try {
        clickable.click();
```

- ocsjs 权威值 `reference/ocsjs-zhs.ts:932`：**`item.click()`**，直点条目。
- 第三源 `reference/zhs-assistant/main.js:46`：`.nextAll('.video')[0].click()`，也直点条目。

`.child-name` / `.item-name` / `.file-name` 是 wisdom / fusion / hike 三个版本的内部标题 class，
在 legacy 页面逻辑上不该出现；而 `el.querySelector('a, ...')` **会命中条目里任意一个 `<a>`**（包括和学习无关的外链），风险不小。

### C. 完成判定过宽 → 把"没看过的"误判成"已完成" → 找不到可点的下一节

- `src/02-adapter.js:291-303`：

```js
      // 2. 通用完成标记：各版本对勾/完成图标的 class 变体（finish/done/complete/learned/studied/checkmark 等）
      try {
        if (el.querySelector('[class*="finish"], [class*="done"], [class*="complete"], [class*="learned"], [class*="studied"], [class*="checkmark"], [class*="is-finish"]')) {
          return true;
        }
      } catch (e) { /* 选择器兼容 */ }
      // 3. 子元素文本兜底（有时完成标记是「已学完」三个字而非图标）
      const txt = U.normText(el.innerText || el.textContent);
      if (/(已完成|已学完|已学习|学完|已看完|已学|100\s*%)/.test(txt)) return true;
```

- ocsjs 权威值 `reference/ocsjs-zhs.ts:84`：**只看 `.time_icofinish`**，一个条件，完事。

我们这条规则用的是 `querySelector`，会扫**条目内所有子孙的 class 子串**。
聪明的对照：`.time_icofinish` 自己就含 `finish` 子串，所以第 2 规则没问题；
但 `[class*="done"]` 会命中 `hidden`、`el-radio__input` 不算、可是 `has-DONE` 之类乱七八糟的都会命中；
再看第 3 条：只要条目整段文本里出现"**100%**"四个字符就判完成——
**如果页面上列的是"共 100% 时长"之类的静态文案，整列就会被一次性判成已完成**。

误判的后果（`src/05-scheduler.js:451-482`）：

```js
        const bd = cat.breakdown();
        const next = cfg.skipFinished === false
          ? this._nextInOrder(cur, cat)
          : cat.findNext(cur);
        if (!next) {
            ...
          } else if (bd.undone === 0) {
            // 真正全看完
            ...
          } else {
            ZHS.Log.warn('还有 ' + bd.undone + ' 节未完成，但无法定位到可点击节点（可能被锁定或选择器不匹配）');
```

**注意这一句的自相矛盾**：日志说"还有 N 节未完成"，但同时 `findNext` 找不到——
因为 `bd`（走 `statusOf`）和 `findNext`（走 `pickable = statusOf === UNDONE`）用的是同一套 `statusOf`，
两边应该一致。要真想把这段跑出来，最可能的就是**迭代过程中 DOM 被重渲染**（条目被整段替换），
再看题。无论如何，**收紧完成判定、让它和 ocsjs 一样干净**是最稳的第一步。

### D. `current_play` 拿不到时没有"兄弟节点"兜底

- `src/02-adapter.js:252-261` `current()` 只做两件事：查 `.clearfix.video.current_play`、拿 `lessonKey` 做文本匹配。
- 而 `reference/zhs-assistant/main.js:43-47` 提供了第三条路：**不依赖完成标记、也不依赖标题文本，直接看 `.progressbar` 宽度是否等于 `.progressbar_box` 宽度**（进度条填满 = 本节看完），然后用**DOM 兄弟关系** `nextAll('.video')[0]` 取下一节。

我们完全没有用这条更稳、更"结构性"的路。

---

## 7. 交叉验证（另两份参考，结论一致）

### 7.1 `reference/autovisor/modules/lesson_navigation.py:53-62`

```python
LEGACY_CATALOG = CatalogSelectors(
    name="legacy",
    item=".clearfix.video",
    active=".clearfix.video.current_play",
    finish=".time_icofinish",
    title="#lessonOrder",
    active_class="current_play",
    progress=".progress-num",
    course_title=".source-name",
)
```

**说明**：我们 `ADAPTERS.legacy` 里那个 `#lessonOrder` 大概率是从这里抄来的，而不是从 ocsjs。
ocsjs 是 3428★、持续维护到 2025-12 新页面的主项目，**优先级应高于 autovisor**。
而且 autovisor `catalog_candidates`（84-88 行）默认返回 `(WISDOM, LEGACY, FUSION)`——**wisdom 排第一**，
这跟我们的学习无关，但说明两套项目的"默认判定"并不一致。

### 7.2 `reference/zhs-assistant/main.js:43-47`（已引）

`.current_play` 内部的 `.progressbar` / `.progressbar_box` 宽度比对 + `.nextAll('.video')[0].click()`。
这份 2018 年的老脚本能一直有效到它的作者弃更，说明 **`.clearfix.video` / `.current_play` 这套类名非常稳定**。

### 7.3 三源一致性小结

| 选择器 | ocsjs（3428★，维护到 2025-12） | autovisor（Python） | zhs-assistant（jQuery） |
|---|---|---|---|
| 条目 | `.clearfix.video`（81） | `.clearfix.video`（55） | `.video`（46） |
| 当前项 | `current_play`（89） | `current_play`（59） | `.current_play`（43） |
| 完成 | `.time_icofinish`（84） | `.time_icofinish`（57） | progressbar 宽度比对（43） |
| 标题 | `.catalogue_title`（77） | `#lessonOrder`（58） | — |
| 下一节 | `videoItems[i+1].click()`（90/932） | — | `.nextAll('.video')[0].click()`（46） |

**结论：条目 / 当前项 / 完成标记 三源一致，可以直接采信。`#lessonOrder` 只有 autovisor 一家在用。**

---

## 8. 落地建议（可直接抄用，共 5 条）

> 按"风险由高到低、收益由大到小"排序。每条都给具体到文件和代码片段的做法。

### ✅ 建议 1（最高优先级）：legacy 的点击改成「直点条目本身」

**改 `src/02-adapter.js:440-452` 的 `Catalog.click`**，让它按适配器走分支——legacy 直点条目，其它版本维持现状：

```js
    /** 点击条目（真正触发切换） */
    click(el) {
      if (!el) return false;
      // ocsjs 权威实现对 studyvideoh5（legacy/.clearfix.video）就是 item.click() 直点条目本身
      // （reference/ocsjs-zhs.ts:932），第三源 zhs-assistant/main.js:46 也是 nextAll('.video')[0].click()，
      // 都不是点内部的 <a> 或标题 span。点错目标 = 点了没反应，这是「无法跳下一节」的头号嫌疑。
      const isLegacy = this.adapter && this.adapter.name === 'legacy';
      const clickable = isLegacy
        ? el
        : (el.querySelector('a, .child-name, .item-name, .file-name, span[title]') || el);
      try {
        clickable.click();
        return true;
      } catch (e) { ... }
    },
```

配套：点在 `src/05-scheduler.js:522` `cat.click(next)` 之前，保留现有的 `await U.sleep(...)` 节奏；
按 ocsjs `reference/ocsjs-zhs.ts:917` 的做法，**点之前固定睡 3 秒**（当前代码是点之后睡 3 秒，见 `src/05-scheduler.js:533`，建议两边都留）。

### ✅ 建议 2：`legacy.title` 用 ocsjs 的 `.catalogue_title`，`#lessonOrder` 降为兜底

**改 `src/02-adapter.js:65-71`**：

```js
      // ocsjs 对 studyvideoh5 的课时标题取的是 .catalogue_title（reference/ocsjs-zhs.ts:77）；
      // #lessonOrder 来自 reference/autovisor/modules/lesson_navigation.py:58，覆盖面窄，
      // 取不到时 itemTitle 会回退到整行 innerText（混着序号/时长/百分比），污染 ZHS.state.lessonKey。
      title: '.catalogue_title, #lessonOrder, #sourceTit',
```

同时**加一层保险**：在 `src/02-adapter.js:264-276` 的 `itemTitle` 里做规范化（去掉百分比、时长，压缩空白），
让 `lessonKey` 尽量干净。**新建/保留一层过滤逻辑，别直接替换**—以适应新旧两版。

### ✅ 建议 3：给 `current()` 加「兄弟关系」兜底（最强的一条）

完全不要依赖标题文本。**在 `src/02-adapter.js:252-261` 的 `current()` 里加第三条**：

```js
      // 兜底 3：progressbar 宽度比对 + DOM 兄弟关系（参考 reference/zhs-assistant/main.js:43-47）
      // current_play 类有时会滞后/丢失，这时按 DOM 顺序定位更可靠
      const items = this.items();
      const withVideo = items.filter((el) => el.classList.contains('video'));
      for (let i = 0; i < withVideo.length; i++) {
        const bar = withVideo[i].querySelector('.progressbar');
        const box = withVideo[i].querySelector('.progressbar_box');
        if (bar && box && bar.getBoundingClientRect().width === box.getBoundingClientRect().width) {
          return withVideo[i];
        }
      }
```

以及在 `findNext(fromEl)`（`src/02-adapter.js:401`）的最前面，**用 DOM 兄弟关系直接取下一项**：

```js
      // 结构性兜底：不看完成标记、不看标题，按 ocsjs 的「当前项之后紧邻的那个」的语义取
      // （reference/ocsjs-zhs.ts:87-94 的 videoItems[i + 1] / zhs-assistant 的 nextAll('.video')[0]）
      if (fromEl) {
        let sib = fromEl.nextElementSibling;
        while (sib && !(sib.matches && sib.matches('.clearfix.video'))) sib = sib.nextElementSibling;
        if (sib) return sib;
      }
```

> 注：`while` 循环是为了跳过中间可能存在的大字体/装饰性节点，保证拿到的是真正的下一个条目。

### ✅ 建议 4：把完成判定收紧到 ocsjs 的口径（先紧后松，并记录命中来源）

**改 `src/02-adapter.js:284-304` 的 `isFinished`**：legacy 适配器下**优先只认 `.time_icofinish`**，
把现在的"通用 class 子串 + 100% 文本"从"一命中就 return true"降级为**最后一级**，并加日志说明走的是哪一级：

```js
    isFinished(el) {
      if (!el) return false;
      const ad = this.adapter;
      // 1. 适配器专属完成标记：ocsjs 对 studyvideoh5 只用 .time_icofinish（reference/ocsjs-zhs.ts:84）
      if (ad.finish && el.querySelector(ad.finish)) { this._lastFinishRule = 'finish'; return true; }
      // 2. 100% 文本判定：ocsjs 的副证是 .progress-num 的文本严格等于 '100%'
      //    （reference/ocsjs-zhs.ts:278-281），所以我们也不能笼统用全文 textContent 去匹配 '100%'。
      const num = el.querySelector('.progress-num, .progress-num-inner');
      if (num && String(num.textContent || '').trim() === '100%') { this._lastFinishRule = 'progress100'; return true; }
      // 3. 通用兜底（旧行为保留，但改为最后一级 + 打点），方便在面板里看清到底哪一级生效
      ...
    }
```

配合 `ZHS.Log.info('完成判定命中规则：' + this._lastFinishRule)`（记得用 `info` 不用 `debug`，
`src/00-config.js` 里 debug 已经不进面板 200 条缓冲了），一旦再有"没看完就跳 / 看完了不跳"，一眼能看出是哪条规则误判。

### ✅ 建议 5：补一个"下一次兜底重试点两下" + 空 video 时不刷新而是重点当前项

ocsjs 有两个我们没照抄的健壮性细节：

**(a) 远程模式下点两次修黑屏**（`reference/ocsjs-zhs.ts:926-930`）：

```ts
								await remotePage.click(item);
								await $.sleep(1000);
								// 两次点击修复黑屏问题
								await remotePage.click(item);
								await $.sleep(1000);
```

我们没有远程能力，但可以做一个**低成本的兜底**:如果在 `src/05-scheduler.js:522` `cat.click(next)` 之后
`await U.sleep(3000)` 仍拿不到视频（也就是现有的 `_noVideoTicks` 逻辑，见 `src/05-scheduler.js:330-340`），
**先再点一次同一个条目，而不是立刻判为文档节点往下跳**——这更符合 ocsjs 的语义。

**(b) 旧共享课加载失败不刷新，改为重点当前项**（`reference/ocsjs-zhs.ts:952-959`）：

```ts
									reload() {
										// 旧共享课页面点击右侧栏就能重新加载
										if (type === '共享课') {
											study({ next: false });
										} else {
											location.reload();
										}
									},
```

我们 `src/05-scheduler.js` 里的 `reload` 分支如果现在是 `location.reload()`，
**在 studyvideoh5 上请改成「重点当前目录项」**（`cat.click(cat.current())`，`next: false` 语义）。
刷新会丢进度Ann Dan导致了整课重来——这正是用户最不能接受的。

---

## 9. 附：可直接贴到控制台做现场校验的一行脚本

如果能在用户浏览器上跑一次，把输出贴回来，上面 5 条建议可以立刻确认哪条是真因：

```js
// 在 studyvideoh5 播放页的控制台执行
(() => {
  const items = Array.from(document.querySelectorAll('.clearfix.video'));
  const cur = document.querySelector('.clearfix.video.current_play');
  return {
    条目总数: items.length,
    当前项下标: cur ? items.indexOf(cur) : '(未找到 current_play)',
    带完成标记的条目数: items.filter(e => e.querySelector('.time_icofinish')).length,
    标题元素统计: {
      catalogue_title命中: items.filter(e => e.querySelector('.catalogue_title')).length,
      lessonOrder命中: items.filter(e => e.querySelector('#lessonOrder')).length,
      两者都无: items.filter(e => !e.querySelector('.catalogue_title') && !e.querySelector('#lessonOrder')).length,
    },
    含误判风险的条目数: items.filter(e => e.querySelector('[class*="done"],[class*="complete"],[class*="learned"]')).length,
    当前项下一条: cur ? (cur.nextElementSibling ? cur.nextElementSibling.className : '(无 nextElementSibling)') : '-',
    进度条: cur ? (() => { const b = cur.querySelector('.progressbar'), x = cur.querySelector('.progressbar_box');
                          return b && x ? [b.getBoundingClientRect().width, x.getBoundingClientRect().width] : '(无 .progressbar)'; })() : '-',
  };
})();
```

**判读口令**：
- `条目总数` 为 0 → 页面真的改版了，整套选择器都得重做（这时请看第 10 节）。
- `当前项下标` 为 -1 / 未找到 → 走建议 3。
- `标题元素统计.两者都无` 接近总数 → 走建议 2（顺带解释为什么 `lessonKey` 是脏的）。
- `含误判风险的条目数` 明显大于 `带完成标记的条目数` → 走建议 4（完成判定被污染了）。
- 前面都对、只是点了没反应 → 走建议 1（点错目标了）。

---

## 10. ⚠️【阻塞级冲突】`src/02-adapter.js` 已被改成 `.file-item`，与 ocsjs 结论相反

写这份报告期间（`git status` 实查），**另一位同学已经把 `src/02-adapter.js` 改了**（目前是未提交的工作区改动），
把 studyvideoh5 的第一优先适配器从 `legacy(.clearfix.video)` 换成了 `hike(.file-item)`，并加了自动展开目录树：

```js
    if (host.includes('studyvideoh5')) return [ADAPTERS.hike, ADAPTERS.wisdom, ADAPTERS.legacy, ADAPTERS.fusion, ADAPTERS.card2025, ADAPTERS.polymas];
```

改动依据写的是 `reference/gf558335.user.js` 第 22/47/54 行。**这条依据站不住，理由如下。**

### 10.1 ocsjs 里 `.file-item` 根本不属于 studyvideoh5，它属于「校内课（翻转课）」

`reference/ocsjs-zhs.ts:1490-1491`：

```ts
			name: '🖥️ 校内课（翻转课）-学习脚本',
			matches: [['校内课学习页面', 'zhihuishu.com/aidedteaching/sourceLearning']],
			namespace: 'zhs.xnk.study',
```

`reference/ocsjs-zhs.ts:1519-1541`（`.file-item` 唯一出现处）：

```ts
				const nextElement = () => {
					const list = document.querySelectorAll<HTMLElement>('.file-item');

					let passActive = false;
					for (let index = 0; index < list.length; index++) {
						const item = list[index];
						const finish = !!item.querySelector('.icon-finish');
						// 判断是否需要学习
						const needsStudy = !finish || (finish && this.cfg.restudy);

						if (item.classList.contains('active')) {
							if (needsStudy) {
								return list[index + 1];
							} else {
								passActive = true;
							}
						}

						if (passActive && needsStudy) {
							return item;
						}
					}
				};
```

对照 `reference/autovisor/modules/lesson_navigation.py:42-49` 的 HIKE_CATALOG：

```python
HIKE_CATALOG = CatalogSelectors(
    name="hike",
    item=".file-item",
    active=".file-item.active",
    finish=".icon-finish",
    title="span[title]",
    active_class="active",
    progress=".rate",
    course_title=".course-name",
)
```

**两边 finish 都是 `.icon-finish`，逐字相同 → 我们 `ADAPTERS.hike` 的 `.file-item`/`.icon-finish`
就是 ocsjs 的「校内课 /aidedteaching/sourceLearning」那一套，不是 studyvideoh5。**

而 ocsjs 给 studyvideoh5 的判定是明确无二义的（`reference/ocsjs-zhs.ts:813-825`，见本报告 1.2 节），
落在 `StudyVideoH5` 分支 → `.clearfix.video`。

### 10.2 `gf558335.user.js` 不能用来判定页面归属

`reference/gf558335.user.js:7`：

```js
// @match        *://*.zhihuishu.com/*
```

它的匹配范围是**整个 zhihuishu.com**，没有针对 studyvideoh5。也就是说作者跑在哪个页面上就用哪套，
我们无法从它反推"studyvideoh5 用的是 `.file-item`"。
另外它在 `reference/gf558335.user.js:53` 自己写了一句：

```js
                        // 点击跳转 (这会导致页面刷新，脚本会由油猴插件自动在新页面重新加载)
                        nextItem.click();
```

"点击会刷新页面"——**这不是 studyvideoh5 的行为**。按 ocsjs `reference/ocsjs-zhs.ts:952-959`，
studyvideoh5 是 SPA 原地换视频，**只有加载失败才需要 "再点一次右侧栏当前项"，压根不刷新页面**。
这更像校内课/翻转课的整页跳转行为。

### 10.3 关于那句「真实页面结构」：`test/fixtures/real-h5.html` 是自测夹具，不是抓包

仓库里新增了 `test/fixtures/real-h5.html`（4583 字节），里面只有 `el-tree-node`（21 处）和 `file-item`（12 处），
**完全没有 `.clearfix.video`**。但它自己的注释写得很清楚（`test/fixtures/real-h5.html:5-16`）：

```html
<title>studyvideoh5 真实页面结构（自测夹具）</title>
...
  该 fixture 还原 2026 年 studyvideoh5.zhihuishu.com/stuStudy 页面的真实目录 DOM：
...
  依据：reference/gf558335.user.js 第 22/47/54 行（querySelectorAll('.file-item') + active + click）。
```

**它是依据 gf558335 手写出来的测试替身，不是浏览器抓下来的真实 DOM。**
所以：用这个 fixture 跑通测试，只能证明"我们的代码符合这个夹具"，
**不能证明"studyvideoh5 就是 `.file-item`"**——那是拿结论当证据。

### 10.3b 但是：`.file-item` 这条线索也不能一棍子打死

references 是历史快照，用户报障发生在 **2026 年**。存在这种可能：**2026 年 studyvideoh5 真的改版成了 el-tree + `.file-item`**
（新版页面确实带目录树折叠，这也解释了"自动展开目录"这个需求的合理性；`src/02-adapter.js:220` 新增的
`expandTreeOnce()` 本身是个好改动，逻辑也没有依赖错误前提，建议保留）。
我这边**没有任何真实页面抓包证据能 100% 排除**这个可能。

双方的立场其实是：

| 证据源 | 结论 | 可信度评估 |
|---|---|---|
| `reference/ocsjs-zhs.ts`（3428★，维护到 2025-12） | studyvideoh5 = `.clearfix.video`；`.file-item` 属于 `/aidedteaching/sourceLearning` 校内课 | **强**：域名判定代码明确（813-825 行），`.file-item` 归属明确（1491 行） |
| `reference/autovisor/modules/lesson_navigation.py` | legacy = `.clearfix.video`；把 `.file-item` 叫 HIKE | 中：与 ocsjs 命名不同但选择器本身一致 |
| `reference/zhs-assistant/main.js` | `.current_play` + `.nextAll('.video')` | 中：老脚本，佐证 legacy 类名稳定 |
| `reference/gf558335.user.js` | `.file-item` + `.active` + click | **弱**：`@match *://*.zhihuishu.com/*` 全站通配，无法定位页面；且注释称"点击会导致页面刷新"，与 studyvideoh5 的 SPA 行为不符 |
| `test/fixtures/real-h5.html` | `.file-item` + el-tree | **弱（非独立证据）**：由 gf558335 推导而来的自测夹具 |

**所以正确的工程做法不是"二选一赌一把"，而是「先探测，再决定」。**

### 10.4 建议：把「硬写死 hike 置顶」改成「按命中数量打分」

把 `detect()` 从"按固定顺序取第一个命中的"改成"候选里谁命中的条目最多就用谁"，并在诊断面板里打印命中情况。

```js
  /**
   * 探测当前页面用哪套适配器
   * 改为「打分制」：studyvideoh5 到底用 legacy(.clearfix.video) 还是 hike(.file-item)，
   * 现有参考资料互相矛盾（ocsjs 说是 legacy，gf558335 暗示可能是 hike），
   * 与其赌一个，不如看谁在实际页面上捞到的条目更多——条目多的一定是真正的目录容器。
   */
  function detect() {
    let best = null;
    let bestCount = 0;
    const hits = [];
    for (const ad of candidates()) {
      let n = 0;
      try { n = document.querySelectorAll(ad.item).length; } catch (e) { n = 0; }
      hits.push(ad.name + '=' + n);
      if (n > bestCount) { bestCount = n; best = ad; }
    }
    if (best) {
      ZHS.state.siteVersion = best.name;
      ZHS.Log.info('页面版本识别为：' + best.label + ' (' + best.name + ')，共 ' + bestCount + ' 个条目；候选命中情况 ' + hits.join(', '));
      return best;
    }
    ZHS.state.siteVersion = 'unknown';
    ZHS.Log.warn('未能识别页面版本（候选命中情况 ' + hits.join(', ') + '），将使用通用兜底策略');
    return ADAPTERS.wisdom;
  }
```

这样两版都吃得下，**不用赌**，而且 false Negative 会变成一条可读日志而不是"跳不过去"。

配套落地点：把第 9 节那个现场校验脚本扩展一行，让人一次就问清楚：

```js
  目录候选命中数: {
    'legacy .clearfix.video': document.querySelectorAll('.clearfix.video').length,
    'hike .file-item': document.querySelectorAll('.file-item').length,
    'wisdom .child-info.hasvideo': document.querySelectorAll('.child-info.hasvideo').length,
    'el-tree': document.querySelectorAll('.el-tree-node').length,
    'iframe数': document.querySelectorAll('iframe').length,
  }
```

---

*报告结束。本次调研全程只读，未修改 `src/` 下任何一行代码，未执行 `node build.js`。*
*第 10 节所指的 `src/02-adapter.js` 改动为其他同学的工作区未提交修改，非本调研所为。*
