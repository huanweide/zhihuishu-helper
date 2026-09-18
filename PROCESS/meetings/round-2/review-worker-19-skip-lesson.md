# 智慧树「跳下一节」真实实现调研报告（reference/ 逐个排查）

- 调研人：review-worker-19
- 时间：2026-09-18
- 项目：zhihuishu-helper（只读调研，未修改任何源码）
- 目标：找出别人真实在用的脚本如何「识别目录 / 判完成 / 切下一节」，并给出可直接落地的推荐方案

---

## 0. 一句话结论（先看这个）

**所有在用的成熟项目（OCS 网课助手、Autovisor、zhs-assistant）无一例外都用「路线 A：直接 click 目录里的下一个条目」。没有任何一个项目用播放器 API、改 hash、或点播放器「下一集」按钮。**

而 `studyvideoh5`（我们出错的页面）在三份权威实现里对应的选择器**不是** `.file-item`，而是 **`.clearfix.video` + `.current_play` + `.time_icofinish`**。
我们 `src/02-adapter.js` 第 161-168 行那份「2026-09-18 实地修正」把 `hike`（`.file-item`）**置顶**给了 studyvideoh5，其唯一依据是 `gf558335.user.js` —— **这一条证据很可能是误归属的**（详见第 5 节）。这大概率就是「点了没反应」的根因。

---

## 1. reference/gf558335.user.js（真实在用油猴脚本）

GreasyFork 在跑的脚本，v3.1，`@match *://*.zhihuishu.com/*`（全局匹配，不区分页面类型）。

### 目录识别 + 完成判定 + 切换（原样摘录）

```js
20:    setInterval(function() {
21:        var video = document.querySelector('video');
22:        var allListItems = document.querySelectorAll('.file-item');   // ← 目录条目
24:        // 如果找不到视频，可能是页面还没加载完，直接返回
25:        if (!video) return;
...
41:        // --- 模块2：自动跳转 (解决播放完卡住问题) ---
42:        if (video.ended) {
43:            console.log(">>> 本集结束，寻找下一集...");
45:            for (var i = 0; i < allListItems.length; i++) {
46:                // 找到当前高亮的那一行
47:                if (allListItems[i].classList.contains('active')) {    // ← 当前项
48:                    // 检查是否存在下一行
49:                    if (i + 1 < allListItems.length) {
50:                        var nextItem = allListItems[i + 1];
51:                        console.log(">>> 即将跳转：" + nextItem.innerText);
53:                        // 点击跳转 (这会导致页面刷新，脚本会由油猴插件自动在新页面重新加载)
54:                        nextItem.click();                              // ← 路线 A
55:                    } else {
56:                        console.log(">>> 已是最后一集，任务完成。");
57:                    }
58:                    break;
59:                }
60:            }
61:        }
62:    }, 2000);
```

**要点**
- 目录条目：`.file-item`；当前项：`classList.contains('active')`
- **没有「已完成」判定**，纯靠 `video.ended` + 数组下标 +1
- 切换方式：`nextItem.click()` —— **路线 A**
- 特点：极简、2 秒轮询、**不校验点击是否生效**（点了就不管了）

---

## 2. reference/aw.ts

**结论：文件无效。** 内容只有一行 `404: Not Found` —— 是下载失败留下的残骸，**不含任何可参考代码**。

---

## 3. 其余参考项目逐个排查

### 3.1 reference/zhs-assistant/main.js（有参考价值，路线 A）

进度条宽度比对判完成 + jQuery 取下一个兄弟节点：

```js
43:  if ($('.current_play').find('.progressbar').width() == $('.current_play').find('.progressbar_box').width()) {
44:      console.log('本节完成，' + delay / 1000 + ' 秒后将切到下一课')
45:      await sleep(delay)
46:      $('.current_play').nextAll('.video')[0].click()      // ← 路线 A：nextAll('.video')
47:  }
```

- 当前项：`.current_play`；条目：`.video`
- **完成判定很独特**：比 `.progressbar` 与 `.progressbar_box` 的像素宽度是否相等（进度条走满即完成）
- 切换：`nextAll('.video')[0].click()`
- 其它可用选择器（同文件）：`.speedBox` / `.speedTab15`（1.5 倍速）、`.definiBox` / `.line1bq`（清晰度）、`.volumeBox` / `.volumeIcon`（静音）、`.playButton`、弹题 `.popbtn_cancel` + `#tmDialog_iframe` 内 `.answerOption label`

### 3.2 reference/zhihuishu-ext/（**已过时，不建议参考**，路线 A+E）

`zhihuishu.js` 用的是**很老**的 DOM（`watchstate` 属性时代）：

```js
59: function playVideo(list) {
60:   for (let i = 0, len = list.length; i < len; i++) {
61:     let watchstate = list[i].getAttribute('watchstate')
62:     let id = list[i].getAttribute('id')
63:     // 视频没被播放过并且不是标题行
64:     if ((watchstate === '0' || watchstate === '2') && id !== 'video-0') {
65:       list[i].click() // 播放视频
66:       return true
67:     }
68:   }
69: }
```
```js
100: function background() {
101:   // 每10s检查视频是否播放完毕，是的话，刷新页面
102:   setInterval(() => {
103:     let video = getElement('video')
104:     if (video.ended) {
105:       console.log('正在刷新页面...')
106:       wait1s(1)
107:       window.location.reload()        // ← 路线 E：靠刷新推进
108:     }
109:   }, 10000)
```
```js
126:   let list = document.getElementById('chapterList').getElementsByTagName('li')   // 老 DOM
132:   let video = document.querySelector('.vjs-tech')
```

- 目录：`#chapterList li` + `watchstate` 属性（**当前页面已不存在**）
- 是唯一用**路线 E（播完→刷新→重挑第一个未看）**的项目
- `content.js` 只有 6 行，单纯把 `zhihuishu.js` 注入页面，无目录逻辑

### 3.3 reference/live/（**无参考价值**）

`stuStudy.html` / `rendered-stuStudy.html` / `probe.html` / `hike.html` 全部是**登录页快照**（title 为「登录中心」，含 `login_center_app`、`.login-entry` 等），资源时间戳是 2026-07。**未登录 → 抓不到目录 DOM**，无法用于确认当前选择器。

### 3.4 reference/zhs-llm-answer/（与目录导航**无关**）

`auto_answer_question.py` / `onepage.py` 是 Selenium + LLM 的**答题**脚本。命中的 `clearfix` 是**选项标签** `.label.clearfix`（第 86/99 行），「下一题」是考试里的翻页按钮：

```python
# auto_answer_question.py
86:  answer_elements = question_element.find_elements(By.XPATH, './/div[@class="label clearfix"]')
104: # 下一题
107: next_button = driver.find_elements(By.XPATH, '//button[@class="el-button el-button--primary is-plain"]')[-1]
119: next_button.click()
```

**与课程目录/章节切换完全无关。**

### 3.5 reference/tiku-readme.md（与目录导航**无关** —— 一句话结论）

**一句话：它是「题库接口适配器」的说明文档（把言溪/不挂科/万能等题库 API 统一成标准格式的搜题服务），只服务于自动答题，与课程目录导航/跳下一节毫无关系。**

---

## 4. 两份「宝藏」参考（任务清单外，但价值最高）

### 4.1 reference/ocsjs-zhs.ts —— OCS 网课助手源码（**最权威，持续更新到 2025-12**）

它把智慧树拆成 **6 套页面处理器**，每套有自己的目录选择器。核心接口（第 49-60 行）：

```ts
49: interface ZHSProcessor {
50:   remotePage: RemotePage | undefined | void;
51:   init?(): void;
52:   getCourseName(): string;
53:   getChapterName(root: HTMLElement): string;
54:   hasJob(): boolean;
55:   getNext(opts: { next: boolean; restudy: boolean }): HTMLElement | undefined;   // ← 拿下一节
56:   hideDialog(): void;
57:   handleTestDialog(remotePage?: RemotePage): void | Promise<void>;
58:   switchPlaybackRate(rate: number, remotePage?: RemotePage): void | Promise<void>;
59:   switchLine(definition: 'line1bq' | 'line1gq', remotePage?: RemotePage): void | Promise<void>;
60: }
```

#### StudyVideoH5（= **studyvideoh5 共享课**，我们出错的页面）第 80-95 行：

```ts
80:  getNext(opts: { next: boolean; restudy: boolean }) {
81:    let videoItems = Array.from(document.querySelectorAll<HTMLElement>('.clearfix.video'));
82:    // 如果不是复习模式，则排除掉已经完成的任务
83:    if (!opts.restudy) {
84:      videoItems = videoItems.filter((el) => el.querySelector('.time_icofinish') === null);
85:    }
86:
87:    for (let i = 0; i < videoItems.length; i++) {
88:      const item = videoItems[i];
89:      if (item.classList.contains('current_play')) {
90:        return videoItems[i + (opts.next ? 1 : 0)];
91:      }
92:    }
93:
94:    return videoItems[0];
95:  }
```
配套：`getCourseName()` → `.source-name`（第 73 行）；`getChapterName()` → `.catalogue_title`（第 77 行）；`hasJob()` → `$$el('.clearfix.video')?.length > 0`（第 139 行）。

#### 真正执行点击的地方（第 910-933 行）——**注意两次点击**：

```ts
910:  const study = async (opts: { next: boolean }) => {
912:    const item = processor.getNext({ next: opts.next, restudy: this.cfg.restudy });
913:    if (item) {
917:      await $.sleep(3000);
919:      $render.moveToEdge();                       // 最小化脚本窗口，避免遮挡点击
921:      if (remotePage) {
922:        if (type === '新共享课') {
923:          await remotePage.click('.title-box');    // 侧栏折叠时先点开标题栏
924:          await $.sleep(200);
925:        }
926:        await remotePage.click(item);
927:        await $.sleep(1000);
928:        // 两次点击修复黑屏问题
929:        await remotePage.click(item);
930:        await $.sleep(1000);
931:      } else {
932:        item.click();                             // ← 点条目本身，不是点内部子元素
933:      }
```

#### 处理器的页面分派（第 821-825 行）：

```ts
821:  const ProcessorConstructor = location.href.includes('fusioncourseh5')
822:    ? FusionCourseH5
823:    : location.href.includes('studyplush5') || location.href.includes('studywisdomh5')
824:    ? StudyPlusH5
825:    : StudyVideoH5;          // ← studyvideoh5 落到这里
```

#### 其余处理器（供多态兜底参考）

| 处理器 | 适用页面 | 条目 | 当前项 | 完成标记 |
|---|---|---|---|---|
| `StudyVideoH5` (62) | studyvideoh5 共享课 | `.clearfix.video` (81) | `.current_play` (89) | `.time_icofinish` (84) |
| `FusionCourseH5` (198) | fusioncourseh5 AI课 | `.resources-item` (224) / `.clearfix.video`(256) | `.active` (242) / `.activeNode` (289) | `.isFinish` (235) / `.progress-num`!=100% (279) |
| `StudyPlusH5` (305) | studyplus / studywisdom | `.child-main` (319) | `.current` (335) | `.finish-icon` (326) |
| `WishdomH5` (412) | 2025-9 新智慧课 | `.chapter-content .chapter-item` → `.chapter-content-second` (426-430) | `.current` (452) | `.finish-icon` (443) |
| `Hike` (527) | hike-teaching-center.polymas.com | `.source-icon` 的 `parentElement.parentElement` (541) | `.active-file` (557) | `i.select` (548) |
| `HikeV2` (572) | polymas 新版 | `.el-tree-node`（无子节点者）(586) | `.is-current` (602) | `label.success` (593) |

#### 两个极易忽略、但对「点了没反应」至关重要的细节

1. **侧栏/抽屉必须打开**（HikeV2 第 2188-2196 行）：
```ts
2188:  const next = async () => {
2189:    // 打开章节列表
2190:    document.querySelector('.drawer-panel')?.classList.add('active');
2192:    const nextJob = processor.getNext({ next: true, restudy: this.cfg.restudy });
2193:    if (nextJob) {
2194:      nextJob.scrollIntoView({ behavior: 'smooth', block: 'center' });   // 先滚进视口
2195:      await $.sleep(200);
2196:      nextJob.click();
```
2. **当前节不是视频就跳过**（Hike 第 2058 行）：
```ts
2058:  if (!document.querySelector('.active-file')?.parentElement?.parentElement?.querySelector('.icon-movie')) {
2059:    $message.warn('当前章节不支持学习，即将跳转下一节');
2061:    await next();
2062:    return;
2063:  }
```
3. 还有 **WishdomH5 展开全部折叠章节**（第 1696 行）：
```ts
1696:  document.querySelectorAll<HTMLElement>('.el-collapse-item__wrap').forEach((e) => (e.style.display = ''));
```

### 4.2 reference/autovisor/modules/lesson_navigation.py —— **结构最清晰，直接抄这套**

一份「目录配置表」，4 套 profile（第 21-64 行）：

```python
21: WISDOM_CATALOG = CatalogSelectors(
22:     name="wisdom",
23:     item=".child-info.hasvideo",
24:     active=".child-info.hasvideo.current",
25:     finish=".child-check",
26:     title=".child-name",
27:     active_class="current",
28:     progress="[role='progressbar'][aria-valuenow]",
29:     progress_attribute="aria-valuenow",
30:     course_title=".course-name",
31: )
33: FUSION_CATALOG = CatalogSelectors(
34:     name="fusion",
35:     item=".chapter-content-second",
36:     active=".chapter-content-second.current",
37:     finish=".finish-icon",
38:     title=".item-name",
39:     active_class="current",
40: )
42: HIKE_CATALOG = CatalogSelectors(
43:     name="hike",
44:     item=".file-item",
45:     active=".file-item.active",
46:     finish=".icon-finish",
47:     title="span[title]",
48:     active_class="active",
49:     progress=".rate",
50:     course_title=".course-name",
51: )
53: LEGACY_CATALOG = CatalogSelectors(
54:     name="legacy",
55:     item=".clearfix.video",
56:     active=".clearfix.video.current_play",
57:     finish=".time_icofinish",
58:     title="#lessonOrder",
59:     active_class="current_play",
60:     progress=".progress-num",
61:     course_title=".source-name",
62: )
64: CATALOGS = (WISDOM_CATALOG, FUSION_CATALOG, HIKE_CATALOG, LEGACY_CATALOG)
```

**按 URL 选 profile（第 83-88 行）——这是判断「studyvideoh5 该用哪套」的关键证据**：

```python
83: def catalog_candidates(course_url: str) -> tuple[CatalogSelectors, ...]:
84:     if "hike.zhihuishu.com" in course_url:
85:         return (HIKE_CATALOG,)                                  # .file-item 只给 hike.zhihuishu.com
86:     if "fusioncourseh5" in course_url:
87:         return (FUSION_CATALOG, WISDOM_CATALOG, LEGACY_CATALOG)
88:     return (WISDOM_CATALOG, LEGACY_CATALOG, FUSION_CATALOG)     # studyvideoh5 走这里 → LEGACY
```

完成判定（第 109-126 行）——**完成标记优先，进度数值兜底**：

```python
109: async def lesson_progress(lesson: Locator, catalog: CatalogSelectors) -> int:
110:     if await lesson.locator(catalog.finish).count() > 0:
111:         return 100                      # 有完成图标 = 100%
112:     if not catalog.progress:
113:         return 0
115:     progress = lesson.locator(catalog.progress).first
116:     if await progress.count() == 0:
117:         return 0
118:     if catalog.progress_attribute:
119:         value = await progress.get_attribute(catalog.progress_attribute)
120:     else:
121:         value = await progress.text_content()
122:     return parse_progress_value(value)
125: async def lesson_is_complete(lesson: Locator, catalog: CatalogSelectors) -> bool:
126:     return await lesson_progress(lesson, catalog) >= 100
```

**先一次性筛出全部未完成，再逐个点**（`modules/utils.py` 第 251-269 行）：

```python
259:  all_class = await page.locator(catalog.item).all()
264:  to_learn_class = []
265:  for each in all_class:
266:      if not await lesson_is_complete(each, catalog):
267:          to_learn_class.append(each)
269:  return to_learn_class
```

**点击 + 「是否真的切过去了」校验 + 重试一次**（`modules/course_runner.py` 第 62-72 行）——**这是最有价值的模式**：

```python
62:   for index, lesson in enumerate(lessons):
63:       playback_enabled.clear()
64:       await lesson.click()
65:       active = await wait_for_lesson_active(lesson, catalog)     # 校验 class 是否真的变成 active
66:       if not active:
67:           logger.warn("课时切换超时,正在重试一次.", shift=True)
68:           await lesson.click()                                    # 重试一次
69:           active = await wait_for_lesson_active(lesson, catalog)
70:       if not active:
71:           logger.error(f"无法选中课时,目录类型: {catalog.name}")
72:           return CourseOutcome.FAILED
```

校验函数（`lesson_navigation.py` 第 140-148 行）：

```python
140: async def wait_for_lesson_active(lesson, catalog, timeout_ms: int = 8_000) -> bool:
143:     while asyncio.get_running_loop().time() < deadline:
145:         if has_class(await lesson.get_attribute("class"), catalog.active_class):
146:             return True
147:         await asyncio.sleep(0.2)
148:     return False
```

---

## 5. ⚠️ 关键发现：我们现有代码的「studyvideoh5 → hike」修正可能依据不足

`src/02-adapter.js` 第 161-168 行：

```js
161:    // studyvideoh5 ——【2026-09-18 实地修正】该域名当前已改用新版 Vue 页面，
162:    // 目录是 el-tree 结构、条目选择器为 .file-item（当前项 .file-item.active）。
163:    // 旧的 .child-info.hasvideo / .clearfix.video 在该域名实测已不复存在，
...
166:    //       即 querySelectorAll('.file-item') + contains('active') + nextItem.click()。
168:    if (host.includes('studyvideoh5')) return [ADAPTERS.hike, ADAPTERS.wisdom, ADAPTERS.legacy, ADAPTERS.fusion, ADAPTERS.card2025, ADAPTERS.polymas];
```

**证据冲突（重要）**：

| 来源 | studyvideoh5 用什么 | 依据位置 |
|---|---|---|
| OCS 网课助手 | `.clearfix.video` / `.current_play` / `.time_icofinish` | ocsjs-zhs.ts:81,89,84 + 821-825 分派 |
| Autovisor | `LEGACY_CATALOG`（`.clearfix.video`…） | lesson_navigation.py:53-62, 88 |
| zhs-assistant | `.current_play` + `.video` | main.js:43-46 |
| **gf558335** | **`.file-item` / `.active`** | gf558335.user.js:22,47 |

**3 : 1**。而 `.file-item` 在权威实现里的归属是：
- OCS：只出现在 `xnk-study`（**校内课/翻转课**，`zhihuishu.com/aidedteaching/sourceLearning`）第 1520、1551 行 —— **不是 studyvideoh5**
- Autovisor：`HIKE_CATALOG` 只给 **`hike.zhihuishu.com`** 第 84-85 行 —— **不是 studyvideoh5**

且 gf558335 的 `@match` 是 `*://*.zhihuishu.com/*`（**全站通配**），它在校内课页能用不代表在 studyvideoh5 能用。

**风险机制**（`src/02-adapter.js` 第 202-213 行）：`detect()` 只要 `document.querySelector(ad.item)` **命中任意一个元素**就选该适配器。所以只要页面上碰巧存在任何 `.file-item`（哪怕是别的用途的元素），`hike` 就会**抢占胜出**，而真正的目录 `.clearfix.video` 永远轮不到 → `items()` 拿到错节点 → 点了没反应。

> 这与我们 `src/02-adapter.js` 第 260-270 行的兜底逻辑也对得上：预设选择器落空才启用 `sniffItems()`；但**这里不是落空，而是「命中了错的」**，兜底根本不会启动，于是静默失败。

---

## 6. 五条技术路线判定（A–E）

| 路线 | 是否被参考项目采用 | 谁在用 |
|---|---|---|
| **A. 直接 click 右侧目录里的下一个条目** | ✅ **全部主力方案** | OCS（932/926-929 行）、Autovisor（course_runner.py:64）、zhs-assistant（main.js:46）、gf558335（54 行）、zhihuishu-ext（65 行） |
| **B. 调用播放器/页面暴露的全局 JS API（player.next 等）** | ❌ **无人使用** | 全库搜索 `player.next` / `nextVideo` / `videojs` 控制 API / `Aliplayer` —— 参考项目中**零命中** |
| **C. 修改前端路由 / hash 后刷新** | ❌ **无人使用** | 无 `location.hash` 改写的跳课逻辑 |
| **D. 点视频播放器上的「下一集」按钮** | ❌ **无人使用** | 所有项目都绕开播放器，只操作目录侧栏 |
| **E. 提交进度后由平台自动推进，只需刷新页面** | ⚠️ **仅 1 个老项目当作主逻辑** | `zhihuishu-ext/zhihuishu.js:107`（播完 → `location.reload()` → 重挑第一个未看）。OCS 的 `location.reload()` 只在**黑屏/加载失败**时用（957、1828、2045、2241 行），且第 951-958 行明确区分：`if (type === '共享课') study({next:false}) else location.reload()` |

**结论：路线 A 是唯一现实可行的主方案。路线 E 只适合作为「A 连续失败」时的最后兜底（且带次数上限，避免死循环刷新）。**

---

## 7. 推荐给油猴脚本采用的跳课方案（按可靠性排序）

### 🥇 方案 1（首选）：**「先筛未完成清单 → 逐个 click 条目本体 → 校验 active → 失败重试」**

= Autovisor 的主循环 + OCS 的点击细节。**这是最可靠的组合。**

落地要点（对应我们代码的位置）：

1. **修 `studyvideoh5` 的适配器优先级**（`src/02-adapter.js:168`）
   把 `legacy` 提到 `hike` 之前；若坚持保留 hike，也要把「命中」升级为「命中且数量合理 + 能找到 active」：
   ```js
   // 建议：studyvideoh5 先试 legacy（三份权威实现一致），再 wisdom/hike 兜底
   if (host.includes('studyvideoh5')) return [ADAPTERS.legacy, ADAPTERS.wisdom, ADAPTERS.hike, ADAPTERS.fusion, ADAPTERS.card2025, ADAPTERS.polymas];
   ```
   并把 `detect()`（第 202 行）从「命中 1 个就算」改成「命中 ≥1 **且** 其中存在 active，或总数 ≥2」，避免被无关同名 class 抢占。

2. **点击条目本体，不要点内部子元素**（`src/02-adapter.js:468`）
   现在的代码：
   ```js
   const clickable = el.querySelector('a, .child-name, .item-name, .file-name, span[title]') || el;
   clickable.click();
   ```
   对 legacy（`.clearfix.video`）来说，这些内部选择器都不匹配（它的标题是 `#lessonOrder`），反而可能误点到条目里某个 `<a>`。**OCS 第 932 行、Autovisor 第 64 行都是直接 `item.click()`。** 建议改为：
   ```js
   // 先滚进视口（OCS:1714 / Autovisor:2194）
   el.scrollIntoView({ behavior: 'smooth', block: 'center' });
   el.click();
   // 必要时补第二下（OCS:928-929「两次点击修复黑屏」）
   ```

3. **点完必须校验，失败重试一次**（`src/05-scheduler.js:522` 之后）
   现在只 `cat.click(next)` + `sleep(3000)`，没有校验。建议照抄 Autovisor `course_runner.py:64-72`：
   ```js
   cat.click(next);
   const ok = await waitActive(next, cat, 8000);   // 轮询 class 是否含 active_class
   if (!ok) { cat.click(next); await waitActive(next, cat, 8000); }
   if (!ok) { /* 记失败，走方案 2 */ }
   ```

4. **点之前确保目录展开/抽屉打开**
   - 已有 `expandTreeOnce`（02-adapter.js:179-190）处理 `.el-tree-node__expand-icon`，保留
   - 补 OCS 第 2190 行：`.drawer-panel` 加 `active`
   - 补 OCS 第 1696 行：`.el-collapse-item__wrap` 强制 `display=''`

5. **完成判定用「完成图标优先，进度数值兜底」**（Autovisor `lesson_navigation.py:109-126`）
   我们 `legacy` 已有 `finish: '.time_icofinish'`、`progress: '.progress-num'`，方向正确，继续保持这个优先级。

### 🥈 方案 2（次选）：**「跳过已完成，只点下一个未完成」**（OCS `getNext` 思路，ocsjs-zhs.ts:80-95）

与方案 1 不冲突，可作为 `findNext` 的替代实现：
- 先 `querySelectorAll(item)`，过滤掉含 `finish` 标记的 → 得到「未完成队列」
- 在**未完成队列**里找当前项下标，返回 `+1`
- 找不到当前项就返回队列第一个（OCS 第 94 行 `return videoItems[0]`）
好处：天然跳过已看完的，不会因为「中间夹着已完成项」卡住。
风险：若完成标记选择器失效，会把已完成的也当未完成，可能重复学。所以**必须配方案 1 的校验**。

### 🥉 方案 3（兜底）：**「点不动就刷新页面」**（路线 E，zhihuishu-ext:107）

仅在方案 1/2 连续失败 N 次后启用，**必须带次数上限**（照抄 OCS 第 1812-1824 行的 `reload_count > 3` 熔断），否则会无限刷新。
且要注意 OCS 第 951-958 行的区分：**旧共享课不要靠刷新切课**（刷新会回到同一节），应改为「重新 click 侧栏当前项」。

### ❌ 不推荐：方案 4（播放器 API / 改 hash / 点播放器下一集）

**参考项目零采用**，无证据支持，且播放器 DOM 比目录更易变。不要投入。

---

## 8. 「手动点下一节也无效」——按证据排序的可能原因

1. **适配器选错**（最高概率）：`studyvideoh5` 被 `hike`（`.file-item`）抢占 → 拿到错节点 → 点了没反应。见第 5 节。
2. **点了内部子元素而非条目本体**（`02-adapter.js:468`）：legacy 条目应直接 `el.click()`。见方案 1 第 2 点。
3. **目录没展开 / 抽屉没打开**：目标节点不在可交互状态。见方案 1 第 4 点。
4. **没滚进视口**：元素在视口外，部分前端框架的点击不生效。OCS/Autovisor 都先 `scrollIntoView`。
5. **只点一下不重试**：OCS 明确写了「两次点击修复黑屏问题」（928-929 行）。

---

## 9. 附：selector 速查表（可直接搬进适配器）

| 页面 / 域名 | item | active | finish | title | progress |
|---|---|---|---|---|---|
| studyvideoh5（**旧共享课，我们的目标**） | `.clearfix.video` | `.current_play` | `.time_icofinish` | `#lessonOrder` | `.progress-num` |
| studywisdomh5 / studyplush5（新智慧） | `.child-info.hasvideo` | `.current` | `.child-check` | `.child-name` | `[role=progressbar]@aria-valuenow` |
| fusioncourseh5（AI 课） | `.chapter-content-second` | `.current` | `.finish-icon` | `.item-name` | — |
| hike.zhihuishu.com | `.file-item` | `.active` | `.icon-finish` | `span[title]` | `.rate` |
| polymas 教学空间（旧） | `.source-icon`→爷爷节点 | `.active-file` | `i.select` | — | — |
| polymas 教学空间（新） | `.el-tree-node`（叶子） | `.is-current` | `label.success` | `.file-name` | — |
| 校内课/翻转课（sourceLearning） | `.file-item` | `.active` | `.icon-finish` | `#sourceTit` | — |

---

## 10. 证据文件清单（均已实际读取）

| 文件 | 结论 |
|---|---|
| `reference/gf558335.user.js` | 路线 A；`.file-item` / `.active` / `nextItem.click()`（第 22/47/54 行）；无完成判定 |
| `reference/aw.ts` | **无效文件**（内容仅 `404: Not Found`） |
| `reference/zhs-assistant/main.js` | 路线 A；`.current_play` + `.video`；进度条宽度比对判完成（第 43-46 行） |
| `reference/zhihuishu-ext/zhihuishu.js` | 已过时（`#chapterList li` + `watchstate`）；**路线 E**（第 107 行 reload） |
| `reference/zhihuishu-ext/content.js` | 仅 6 行注入器，无目录逻辑 |
| `reference/live/*` | 全是登录页快照，无目录 DOM，**不可用** |
| `reference/zhs-llm-answer/*` | 答题脚本，**与目录导航无关** |
| `reference/tiku-readme.md` | 题库适配器文档，**与目录导航无关** |
| `reference/ocsjs-zhs.ts` | **最权威**；6 套处理器；studyvideoh5→`.clearfix.video`（81/89/84 行）；点击与细节（910-933、2188-2196、2058 行） |
| `reference/autovisor/modules/lesson_navigation.py` | **结构最佳**；4 套 profile（21-64 行）；URL 分派（83-88 行）；完成判定（109-126 行） |
| `reference/autovisor/modules/course_runner.py` | 点击+校验+重试主循环（62-72 行） |
| `reference/autovisor/modules/utils.py` | 一次性筛未完成清单（251-269 行） |
