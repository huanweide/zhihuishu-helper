# Autovisor 导航 / 跳课实现 逆向调研

- 调研人：playback-flow
- 基线：`reference/autovisor/`（Python + Playwright，外部参考项目，873★）
- 对照基线：本地 `src/02-adapter.js`、`src/05-scheduler.js`、`src/03-player.js`（**注意：这些文件正在被队友并发修改，本报告记录的本地行号以我读取时刻为准**）
- 性质：只读调研，未修改任何源码
- 目的：为「自动看完就下一集而不是重播」「点下一节也没用」两个用户主诉提供可直接落地的改法

---

## 0. 结论速览（先看这段）

| 问题 | Autovisor 的答案 | 我们脚本的现状 | 差距 |
|---|---|---|---|
| 靠什么定位目录项？ | 4 套硬编码选择器常量，按 URL 域做**优先级排序**，再用 `count()>0` 探测命中 | 6 套适配器（wisdom/fusion/hike/legacy/card2025/polymas）+ 兜底 sniff | 我们更多更全，**这块不用学它** |
| 对 studyvideoh5 有特殊处理吗？ | **没有**。全项目只在 2 处出现，都不是导航逻辑 | 我们有专门适配器 | 见 §3，是个"反直觉结论" |
| 怎么跳下一节？ | **直接点目录条目**（`lesson.click()`），**不用**"下一节"按钮 | 同样是点目录条目（`Catalog.click`） | 一致 |
| 点了怎么确认成功？ | `wait_for_lesson_active()`：8s 内每 0.2s 检查目标项的 class 是否含 `current` | **无确认**，`click()` 后 `sleep(3000)` 就当成功 | **关键差距①** |
| 确认失败怎么办？ | 重试 **1 次**，再失败 → `CourseOutcome.FAILED` → 整轮停 | 已有 `SAME_NAV_MAX` 连点守卫（方向对），但**计数在点击前自增** | **关键差距②** |
| "看完了"以谁为准？ | **只认平台目录进度**（`lesson_progress >= 100`），从不拿 `video.currentTime` 判完成 | 已经改为"右侧栏对勾为金标准"（方向对），但 `progress<=0` 分支仍可能重播 | 见 §6 |
| 视频放完但平台进度不足 | 回退到 `duration*percent/100` 继续播，**最多 2 次**，超限停 | 回退到 `max(0, progress-5)`；progress=0 时 → **从头重播** | **关键差距③（就是用户说的"重播"）** |

---

## 1. CATALOG 选择器常量全集

定义位置：`reference/autovisor/modules/lesson_navigation.py:8-64`

数据类（`lesson_navigation.py:8-18`）：

```python
@dataclass(frozen=True)
class CatalogSelectors:
    name: str
    item: str          # 目录条目
    active: str        # 当前项
    finish: str        # 完成标记
    title: str         # 课时名
    active_class: str  # ★ 当前项的 class 名（切课成功判据就用它）
    progress: str | None = None
    progress_attribute: str | None = None
    course_title: str | None = None
```

四套常量（`:21-64`）：

```python
WISDOM_CATALOG = CatalogSelectors(          # :21-31  智慧版共享课
    name="wisdom",
    item=".child-info.hasvideo",
    active=".child-info.hasvideo.current",
    finish=".child-check",
    title=".child-name",
    active_class="current",
    progress="[role='progressbar'][aria-valuenow]",
    progress_attribute="aria-valuenow",
    course_title=".course-name",
)

FUSION_CATALOG = CatalogSelectors(          # :33-40  翻转课
    name="fusion",
    item=".chapter-content-second",
    active=".chapter-content-second.current",
    finish=".finish-icon",
    title=".item-name",
    active_class="current",
)

HIKE_CATALOG = CatalogSelectors(            # :42-51  新形态课
    name="hike",
    item=".file-item",
    active=".file-item.active",
    finish=".icon-finish",
    title="span[title]",
    active_class="active",
    progress=".rate",
    course_title=".course-name",
)

LEGACY_CATALOG = CatalogSelectors(          # :53-62  旧版
    name="legacy",
    item=".clearfix.video",
    active=".clearfix.video.current_play",
    finish=".time_icofinish",
    title="#lessonOrder",
    active_class="current_play",
    progress=".progress-num",
    course_title=".source-name",
)

CATALOGS = (WISDOM_CATALOG, FUSION_CATALOG, HIKE_CATALOG, LEGACY_CATALOG)   # :64
```

### 与我们脚本的逐字段对照

我们 `src/02-adapter.js:25-98` 的 `ADAPTERS`：

| 字段 | Autovisor wisdom | 我们 wisdom (02-adapter.js:26-38) | 是否一致 |
|---|---|---|---|
| item | `.child-info.hasvideo` | `.child-info.hasvideo` | ✅ |
| active | `.child-info.hasvideo.current` | `.child-info.hasvideo.current` | ✅ |
| finish | `.child-check` | `.child-check` | ✅ |
| title | `.child-name` | `.child-name` | ✅ |
| progress | `[role='progressbar'][aria-valuenow]` | `[role="progressbar"][aria-valuenow]` | ✅ |
| progressAttr | `aria-valuenow` | `aria-valuenow` | ✅ |
| courseTitle | `.course-name` | `.course-name` | ✅ |
| **activeClass** | `current` | **缺失** | ❌ **就差这一个** |

fusion/hike/legacy 三套我们也完全一致（`02-adapter.js:39-73`），而且我们额外多了 `card2025`（`:74-84`）和 `polymas`（`:86-97`）两套，**比 Autovisor 覆盖面更广**。

> ⚠️ `activeClass` 的缺失是有后果的：Autovisor 判定"切课成功"用的是 `active_class` 而不是 `active` 选择器（原因见 §4）。我们目前只有 `active` 选择器，没有独立的 class 名字段，所以**没法写出 Autovisor 那种"点完确认生效"的逻辑**。这是 §7 建议 1 要补的东西。

---

## 2. "找下一节未完成课时"的完整逻辑

### 2.1 入口：先建待学列表

`reference/autovisor/modules/utils.py:251-269`：

```python
async def get_filtered_class(
    page: Page, catalog: CatalogSelectors, include_all=False
) -> list[Locator]:
    try:
        await page.wait_for_selector(catalog.item, timeout=2000)
    except TimeoutError:
        pass

    all_class = await page.locator(catalog.item).all()      # :259 每次重新查询 DOM
    if include_all:
        logger.debug(f"Get to-review class: {len(all_class)}")
        return all_class

    to_learn_class = []
    for each in all_class:
        if not await lesson_is_complete(each, catalog):     # :266 过滤掉已完成的
            to_learn_class.append(each)
    logger.debug(f"Get to-learn class: {len(to_learn_class)} / {len(all_class)}")
    return to_learn_class
```

"已完成"判定（`lesson_navigation.py:109-126`）：

```python
async def lesson_progress(lesson: Locator, catalog: CatalogSelectors) -> int:
    if await lesson.locator(catalog.finish).count() > 0:    # :110 有对勾 → 直接 100
        return 100
    if not catalog.progress:
        return 0
    progress = lesson.locator(catalog.progress).first
    if await progress.count() == 0:
        return 0
    if catalog.progress_attribute:
        value = await progress.get_attribute(catalog.progress_attribute)
    else:
        value = await progress.text_content()
    return parse_progress_value(value)                       # :122

async def lesson_is_complete(lesson: Locator, catalog: CatalogSelectors) -> bool:
    return await lesson_progress(lesson, catalog) >= 100     # :126
```

`parse_progress_value`（`:67-76`）：去 `%` → `float()` → 失败返回 0 → clamp 到 `[0,100]`。

### 2.2 拿到列表后：一次性建好，按顺序逐个点

`reference/autovisor/modules/course_runner.py:48-62`：

```python
    await page.wait_for_selector(catalog.item, state="attached")   # :48
    to_learn = await get_filtered_class(page, catalog)             # :49 未完成列表
    learning = bool(to_learn)
    lessons = (
        to_learn
        if learning
        else await get_filtered_class(page, catalog, include_all=True)  # :54 全学完 → 复习模式
    )
    if not lessons:
        logger.error("课程目录中没有可播放的视频课时.")              # :57
        return CourseOutcome.FAILED

    start_time = time.time()
    paused_time = 0.0
    for index, lesson in enumerate(lessons):                       # :62 顺序遍历
```

**关键设计差异**：Autovisor 是在**开跑前一次性**把待学列表定下来（`lessons` 是个固定列表），循环里不再重新查找"下一节未完成"。我们脚本是**每次 `gotoNext` 都重新 `findNext(cur)` 现找**（`05-scheduler.js:455`）。

- Autovisor 的优点：不会因"当前节点定位失败"而卡死在原地。
- Autovisor 的缺点：中途某节状态变了（比如被平台锁了）不会重新规划。
- 对我们的影响：我们"每次现找"的方向是对的，但**必须保证"找出来的 next 一定 ≠ 当前项"**，否则就是死循环（这正是我上一轮 `gotoNext-guard.md` 里证明的死锁）。

### 2.3 目录识别：按 URL 域排优先级（不是按 DOM 猜）

`lesson_navigation.py:83-106`：

```python
def catalog_candidates(course_url: str) -> tuple[CatalogSelectors, ...]:
    if "hike.zhihuishu.com" in course_url:
        return (HIKE_CATALOG,)
    if "fusioncourseh5" in course_url:
        return (FUSION_CATALOG, WISDOM_CATALOG, LEGACY_CATALOG)
    return (WISDOM_CATALOG, LEGACY_CATALOG, FUSION_CATALOG)      # :88 默认兜底


async def detect_catalog(
    page: Page, course_url: str = "", timeout_ms: int = 20_000
) -> CatalogSelectors:
    candidates = catalog_candidates(course_url or page.url)
    selector = ", ".join(catalog.item for catalog in candidates)   # :95 拼成一个多选择器
    try:
        await page.wait_for_selector(selector, state="attached", timeout=timeout_ms)
    except TimeoutError as exc:
        raise RuntimeError("课程目录加载超时，未识别到新版、旧版或翻转课目录") from exc

    for catalog in candidates:                                     # :103 按优先级逐个试
        if await page.locator(catalog.item).count() > 0:
            return catalog
    raise RuntimeError("课程目录结构无法识别")                       # :106
```

注意 `state="attached"`（只要节点存在就算命中，不要求可见）——这样即使目录被折叠也能识别。

> 我们的 `detect()` 是纯 DOM 探测（不看 URL），且带 `sniffItems()` 结构兜底（`02-adapter.js:111+`）。**比它更健壮，不用改。**

---

## 3. studyvideoh5 到底有没有特殊处理？—— **没有**

这是本次调研最反直觉的结论，必须写清楚。

**全项目 grep `studyvideoh5` 只有 2 处命中：**

**① `reference/autovisor/GUI.py:23`** —— 纯帮助文案，不是逻辑：

```python
        "课程链接：从智慧树课程页面复制链接（以 studyvideoh5.zhihuishu.com 开头）\n"
```

**② `reference/autovisor/Autovisor.py:51-59`** —— Cookie 作用域列表，不是导航：

```python
ZHS_COOKIE_URLS = [
    "https://www.zhihuishu.com",
    "https://passport.zhihuishu.com",
    "https://onlineweb.zhihuishu.com",
    "https://studyvideoh5.zhihuishu.com",      # :55
    "https://studywisdomh5.zhihuishu.com",
    "https://fusioncourseh5.zhihuishu.com",
    "https://hike.zhihuishu.com",
]
```
用途只有一处：`persist_login_cookies()` → `context.cookies(ZHS_COOKIE_URLS)`（`Autovisor.py:62-65`）保存登录态。

### 这意味着什么

1. **导航逻辑完全不按 `studyvideoh5` 分支**。`catalog_candidates()`（`:83-88`）只认 `hike.zhihuishu.com` 和 `fusioncourseh5` 两个子串，`studyvideoh5` 落进第 88 行的默认分支 `(WISDOM, LEGACY, FUSION)`，即**先按 WISDOM 的选择器找 `.child-info.hasvideo`**。
2. **URL 校验是域名无关的**。`configs.py:33` 的正则只是"任意 https 链接"：
   ```python
   self.course_match_rule = re.compile("https://[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]")
   ```
   GUI 提示"以 studyvideoh5 开头"只是引导用户从播放页复制链接，**代码并不强制**。
3. **真正做域名分支的是「答题/弹题」模块，不是导航**：`modules/tasks.py:174`（`studywisdomh5` 弹题手动处理）、`:183/:212`（`hike` 不支持自动答题）、`:208`（`fusioncourseh5` 关 `.el-dialog`）。

> 对我们脚本的含义：**不要指望靠"识别 studyvideoh5 域名"来解决跳课问题**。Autovisor 的成功来自"选择器 + 点后确认"，不是来自域名特判。而且我们脚本的 wisdom 选择器已经和 Autovisor 一字不差，说明**选择器不是病因**。

---

## 4. 切换到底是怎么执行的：点目录条目，不是点"下一节"按钮

**核心代码 `reference/autovisor/modules/course_runner.py:62-78`（逐行）：**

```python
    for index, lesson in enumerate(lessons):
        playback_enabled.clear()                                  # :63 先停掉后台"自动播放"任务
        await lesson.click()                                      # :64 ★ 直接点目录条目
        active = await wait_for_lesson_active(lesson, catalog)     # :65 ★ 确认是否变当前项
        if not active:
            logger.warn("课时切换超时,正在重试一次.", shift=True)   # :67
            await lesson.click()                                  # :68 重试 1 次
            active = await wait_for_lesson_active(lesson, catalog) # :69
        if not active:
            logger.error(f"无法选中课时,目录类型: {catalog.name}") # :71
            return CourseOutcome.FAILED                            # :72 ★ 失败即停整轮

        await page.wait_for_timeout(1000)                          # :74 固定等 1s
        title = await get_lesson_name(page, lesson, catalog)       # :75
        logger.info(f"正在学习:{title}")
        page.set_default_timeout(10000)                            # :77
        await page.wait_for_selector("video", state="attached")    # :78 等新 video 挂载
        playback_enabled.set()                                     # :79 恢复自动播放
```

**结论：全项目没有任何"下一节 / 下一集按钮"选择器。** 切换 100% 靠点目录条目。

### 成功的判据：`wait_for_lesson_active`

`lesson_navigation.py:140-148`：

```python
async def wait_for_lesson_active(
    lesson: Locator, catalog: CatalogSelectors, timeout_ms: int = 8_000
) -> bool:
    deadline = asyncio.get_running_loop().time() + timeout_ms / 1000
    while asyncio.get_running_loop().time() < deadline:
        if has_class(await lesson.get_attribute("class"), catalog.active_class):
            return True                                            # :146
        await asyncio.sleep(0.2)
    return False
```

配套的 `has_class`（`:79-80`）：

```python
def has_class(class_attr: str | None, class_name: str) -> bool:
    return class_name in (class_attr or "").split()
```

**三个设计要点（我们缺的正是这些）：**

1. **判据是 class 名，不是选择器**。`has_class(el.class, "current")` 而不是 `page.locator(".child-info.hasvideo.current")`——后者在 SPA 里会因为整棵树重渲染而命中错误的元素。
2. **用 `split()` 精确匹配**，避免 `current_play` 被 `current` 命中这类子串误判（注意 legacy 的 `active_class` 是 `current_play`，如果用 `includes('current')` 就会在 wisdom 页误判）。
3. **轮询而非固定 sleep**：8s deadline / 0.2s 步长，最长 ~40 次探测，命中立即返回。

### 为什么 `playback_enabled` 要先 clear 再 set

`Autovisor.py:206` 起的 `play_video()` 任务（`tasks.py:120-167`）每 2s 轮询一次，会 `video.play()`、会 pause。切换瞬间旧 video 还在、新 video 没挂载，`play_video` 会去操作一个即将被销毁的元素并可能触发报错/误播。`course_runner.py:63` 的 `clear()` 就是"切换期间禁用后台播放"，`:79` 的 `set()` 是"新视频就位后恢复"。

**对照我们**：我们有 `NAV_COOLDOWN_MS = 15000` 冷却闸门（`05-scheduler.js:355`）+ `_lastNavAt` 时间戳（`:525`），**思路等价且更保守，这块不用改。**

---

## 5. 切换失败怎么处理（超时 / 目录没刷新 / 点击无效）

Autovisor 一共只有 **3 类** 失败处理，全部是"重试固定次数 + 失败即停"，**没有无限重试、没有退避算法**：

### ① 点击无效（§4 已示）：重试 1 次 → 停
`course_runner.py:66-72`。注意重试**没有退避**，两次之间只隔了一个 8s 的 `wait_for_lesson_active` 超时。

### ② 目录识别超时：整体 deadline 20s，期间优先处理安全验证
`course_runner.py:22-38`：

```python
async def detect_catalog_after_verification(
    page: Page, course_url: str
) -> CatalogSelectors:
    deadline = time.monotonic() + 20                       # :25
    while True:
        if await has_visible_verification(page):           # :27 有验证码 → 等用户过
            await wait_until_verification_hidden(page)
            deadline = time.monotonic() + 20               # :29 ★ 过了验证就重置 deadline
        remaining_ms = int(max(0, deadline - time.monotonic()) * 1000)
        if remaining_ms <= 0:
            raise RuntimeError("课程目录加载超时，且未检测到可处理的安全验证")   # :32
        try:
            return await detect_catalog(page, course_url, timeout_ms=min(1000, remaining_ms))
        except RuntimeError:
            continue                                        # :38 1s 一轮重试
```

**设计精髓**：把"人机验证耗时"从超时预算里**扣除**（`:29` 重置 deadline），而不是让它吃掉超时。可验证的可见性判据（`tasks.py:24-48`）用的是完整几何 + 样式检查：

```python
const style = getComputedStyle(element);
const rect = element.getBoundingClientRect();
const opacity = Number.parseFloat(style.opacity || "1");
return style.display !== "none" && style.visibility !== "hidden" &&
    opacity > 0.05 && rect.width > 0 && rect.height > 0 &&
    rect.bottom > 0 && rect.right > 0 &&
    rect.top < innerHeight && rect.left < innerWidth;
```

### ③ 课时未能确认完成：立即停止整门课，不继续跳
`course_runner.py:95-100`：

```python
        if not completed:
            logger.warn(
                f'"{title}" 未能确认播放完成,本轮停止切换下一课.',
                shift=True,
            )
            return CourseOutcome.FAILED                      # :100
```

上层 `Autovisor.py:247-250`：

```python
            if outcome is CourseOutcome.FAILED:
                logger.warn("课程未确认完成,已停止本轮运行.", shift=True)
                run_ok = False
                break                                        # :250 直接跳出所有课程循环
```

**这三种策略的共同点：失败立刻暴露给用户，绝不默默往下走**。跟我们用户的抱怨"点下一节也没用"（意味着脚本在点但没反应、且不给任何反馈）形成直接对照。

---

## 6. 播放层如何配合导航（这段直接对应"重播"主诉）

`reference/autovisor/modules/course_playback.py:66-217` 的 `learn_lesson()`。

### 6.1 "这节看完了"的唯一判据 = 平台目录进度 ≥ 100

```python
            catalog_progress = await lesson_progress(current_lesson, catalog)   # :106
            if catalog_progress >= 100:                                          # :107
                await page.wait_for_timeout(2000)
                completed = await wait_for_lesson_completion(
                    current_lesson, catalog, timeout_ms=5000
                )
                return paused_time, completed, False                             # :112
```

**整个函数里没有任何一处用 `video.currentTime == duration` 来判定"这节学完了"。** `video_at_end()` 只用于决定"要不要去刷新一下平台进度"。

### 6.2 视频放完但平台进度不足 → 回退到"平台记录位置"继续播，最多 2 次

`course_playback.py:154-200`：

```python
                if video_at_end(current_time, total_time):         # :154
                    await page.wait_for_timeout(3000)              # :155 等 3s 让平台上报
                    ...
                    refreshed = await lesson_progress(current_lesson, catalog)   # :169
                    if refreshed >= 100:
                        return paused_time, True, False            # :171 成功了，跳下一节
                    if retry_count >= 2:                           # :172 ★ 硬上限 2 次
                        logger.warn(
                            f"视频已结束但平台进度停在 {refreshed}%,停止自动重试.",
                            shift=True,
                        )
                        return paused_time, False, False           # :177 停止，不无限重试
                    retry_time = (
                        time_for_percent(total_time, refreshed)     # :179 退到平台记录的位置
                        if catalog.progress
                        else tail_retry_time(total_time)            # :181 没有进度条就退到末尾前 5s
                    )
                    logger.warn(f"视频已结束但平台仅记录 {refreshed}%,回退后重试上报.")
                    await page.evaluate(
                        """time => { const video = document.querySelector('video');
                            if (!video) return; video.currentTime = time; video.play(); }""",
                        retry_time,
                    )
                    retry_count += 1                               # :196
```

两个辅助函数（`modules/video_state.py:18-33`）：

```python
def time_for_percent(duration, percent) -> float:      # :18-27
    ...
    return duration * bounded / 100.0                   # duration × clamp(percent,0,100)/100

def tail_retry_time(duration, tail_seconds: float = 5.0) -> float:   # :30-33
    ...
    return max(0.0, duration - tail_seconds)            # duration - 5
```

### ⚠️ 与我们脚本的关键差异（这就是"重播"的病根）

我们 `03-player.js:145-146`：

```js
const back = Math.max(0, target - 5);      // target = 平台进度换算出的秒数
```

- 平台读到 97% → `back = duration*0.97 - 5`，回退一点点，合理。
- **平台读到 0%（选择器没命中 / 平台还没上报）→ `back = max(0, -5) = 0` → `currentTime = 0` → 从头整节重播。** 用户看到的"看完就重播"就是这个。

Autovisor 在同样场景走的是 `time_for_percent(duration, 0)`——数值上同样是 0，**但它有两个我们缺少的护栏**：
1. `retry_count >= 2` 硬停（`:172`），而我们靠 `Player._retryCount` 且在 `retryFromPlatformProgress` 里被 reset 过（我在 `playback-flow.md` 的 BUG-PB-1 已证明会形成无限循环）；
2. 只有在 `catalog.progress` 存在时才用 `time_for_percent`，**没有进度条就用 `tail_retry_time`（末尾前 5s）**，永远不回 0。

### 6.3 另一个护栏：播放器跑太快会主动对齐平台进度

`course_playback.py:127-152`：

```python
                expected_time = time_for_percent(total_time, catalog_progress)   # :130
                if (not synced_to_catalog and catalog.progress
                        and current_time > expected_time + 15):                  # :134 领先超 15s
                    logger.warn(f"播放器进度快于平台记录,回到 {catalog_progress}% 继续.")
                    await page.evaluate(..., expected_time)                      # :140-148
```

即：**倍速播放时，播放位置不允许领先平台记录超过 15 秒**。这样可以避免"倍速太快导致平台上报跟不上，最后卡在 80%"。我们脚本没有这个对齐机制（我们有倍速但没对齐），是潜在隐患。

### 6.4 卡死检测：120 秒无进展即停

`course_playback.py:123-125`（配合 `:27 STALL_TIMEOUT_SECONDS = 120`）：

```python
            if time.monotonic() - last_activity >= STALL_TIMEOUT_SECONDS:
                logger.warn("视频和平台进度连续 120 秒未推进,停止当前课时.")
                return paused_time, False, False
```

`last_activity` 在**任一**进展出现时刷新：平台进度上涨（`:114-117`）、视频时间前进 >0.25s（`:120-122`）、过完验证码（`:93`）、过完弹题（`:98`）。

---

## 7. 给本油猴脚本的 5 条建议（精确到选择器与调用方式）

> 优先级：① > ② > ③ > ④ > ⑤。① 直接解决"点下一节也没用"，③ 直接解决"看完就重播"。

---

### 建议 ① 【最高优先】点击后必须确认生效：补 `activeClass` + `waitActive()`

**动机**：Autovisor 靠 `wait_for_lesson_active`（`course_runner.py:65/69`）在点后确认；我们 `05-scheduler.js:522` 是 `cat.click(next)` 之后直接 `sleep(3000)` 就当成功——**点击是否生效完全没验证**，这正是"点了下一节也没用"的根因。

**Step 1 — 给每套适配器补 `activeClass` 字段**（`src/02-adapter.js:25-98`，在每套的 `active` 后面加一行）：

```js
wisdom:   { ..., active: '.child-info.hasvideo.current',   activeClass: 'current',      ... },  // :30 后
fusion:   { ..., active: '.chapter-content-second.current', activeClass: 'current',     ... },  // :43 后
hike:     { ..., active: '.file-item.active',               activeClass: 'active',      ... },  // :54 后
legacy:   { ..., active: '.clearfix.video.current_play',    activeClass: 'current_play',... },  // :66 后
card2025: { ..., active: '[class*="card-container"].active', activeClass: 'active',     ... },  // :78 后
polymas:  { ..., active: '...active...',                    activeClass: 'active',      ... },  // :90 后
```

取值来源就是 Autovisor 的 `active_class`（`lesson_navigation.py:27/39/48/59`）。

**Step 2 — 在 `Catalog` 上加两个方法**（`src/02-adapter.js`，放在 `itemTitle` 后面，约 `:276` 之后）：

```js
    /**
     * 条目是否为「当前项」——用 class 名精确匹配，不用 querySelector。
     * 为什么不用 this.adapter.active 选择器：SPA 切课后整棵目录树会重渲染，
     * 用选择器查到的是"新树里的当前项"，不是"我刚点的那个元素"，
     * 会出现"点 A 却因为 B 是 current 而误判成功"。
     * split() 精确匹配也避免 legacy 的 'current_play' 被 'current' 子串命中。
     */
    isActive(el) {
      if (!el || !el.getAttribute) return false;
      const cls = el.getAttribute('class') || '';
      const want = this.adapter.activeClass || 'current';
      return cls.split(/\s+/).indexOf(want) >= 0;
    },

    /**
     * 点击后轮询确认切换生效（对齐 Autovisor wait_for_lesson_active，
     * lesson_navigation.py:140-148：8s deadline / 0.2s 步长）
     * @returns {Promise<boolean>}
     */
    async waitActive(el, timeoutMs, stepMs) {
      if (!el) return false;
      const deadline = Date.now() + (timeoutMs || 8000);
      const step = stepMs || 200;
      while (Date.now() < deadline) {
        if (this.isActive(el)) return true;
        await U.sleep(step);
      }
      return false;
    },
```

**Step 3 — 改调用点**（`src/05-scheduler.js:522` 那一行附近）：

```js
        // 记录新课时标识，供续播使用
        ZHS.state.lessonKey = cat.itemTitle(next);

        // —— 原来是：cat.click(next); 然后 sleep(3000) 就当成功 ——
        // 改为：点 → 确认 → 失败重试 1 次 → 仍失败则计入失败计数
        let landed = cat.click(next) && await cat.waitActive(next, 8000, 200);
        if (!landed) {
          ZHS.Log.warn('首次点击未生效，重试一次：' + cat.itemTitle(next));
          await U.sleep(500);
          landed = cat.click(next) && await cat.waitActive(next, 8000, 200);
        }

        this._navCount++;
        this._completedThisRun = (this._completedThisRun || 0) + 1;
        this._lastNavAt = Date.now();

        if (landed) {
          // 成功：清零连点失败计数（下面建议 ② 依赖这个）
          this._navFailCount = 0;
          this._navFailKey = '';
        } else {
          ZHS.Log.error('点击「' + cat.itemTitle(next) + '」后目录未切换，本次跳转失败');
          if (ZHS.panel) {
            ZHS.panel.alert('切课失败：点击「' + cat.itemTitle(next) + '」无反应，请手动切换', 'error', 10000);
          }
          this.stop();
          return;
        }
```

> 注意：`cat.click()` 现在返回 `boolean`（`02-adapter.js:441-452` 已有 `return true/false`），但 `05-scheduler.js:522` 把返回值丢了。上面代码把它接住了。

---

### 建议 ② 连点失败计数必须在"确认失败后"自增，且成功清零

**动机**：Autovisor 的策略是"重试 1 次，失败即 `return CourseOutcome.FAILED`"（`course_runner.py:70-72`）。我们的 `SAME_NAV_MAX` 守卫（已在 `src/05-scheduler.js:485-500` 落地，方向正确）有个时序问题：

```js
        const _targetKey = cat.itemTitle(next);
        if (_targetKey === this._navFailKey) {
          this._navFailCount++;          // :490 ← 在点击之前就自增了
        } else {
          this._navFailKey = _targetKey;
          this._navFailCount = 1;        // :493 ← 首次也记为 1
        }
        if (this._navFailCount >= SAME_NAV_MAX) { ... }
```

**问题**：成功跳转也会留下 `_navFailCount = 1`；如果这个标题在很久以后又被点到（比如目录循环回来），计数会继续累加，**存在误停风险**。

**改法**：把自增从"点击前"移到"确认失败后"（配合建议 ①）：

```js
        if (!landed) {
          const _targetKey = cat.itemTitle(next);
          if (_targetKey === this._navFailKey) this._navFailCount++;
          else { this._navFailKey = _targetKey; this._navFailCount = 1; }
          if (this._navFailCount >= SAME_NAV_MAX) {
            ZHS.Log.error('连续 ' + this._navFailCount + ' 次切换目标都是「' + _targetKey + '」且未能前进，已停止自动跳转');
            if (ZHS.panel) ZHS.panel.alert('切课失败：连续 ' + this._navFailCount + ' 次点击「' + _targetKey + '」无效，已停止自动跳转，请手动切换', 'error', 15000);
            this.stop();
            return;
          }
          // 未达上限：交给下一轮 tick 再试（相当于 Autovisor 的"重试一次"放宽为 N 次）
          return;
        }
        // 成功路径（建议 ① 里已写）：this._navFailCount = 0; this._navFailKey = '';
```

`SAME_NAV_MAX` 建议取 **5**（Autovisor 是 2 次即停，我们是页面内脚本、没有"整轮终止"的概念，5 次既能暴露问题又不至于太早放弃）。

---

### 建议 ③ 【直接治"重播"】回退重播永远不要回到 0

**动机**：`03-player.js:145-146` 的 `back = Math.max(0, target - 5)`，当平台进度读成 0 时 `back = 0` → 整节从头重播。Autovisor 在没有进度条时用 `tail_retry_time(duration) = max(0, duration - 5)`（`video_state.py:30-33`），**永远回末尾而不是回开头**。

**改法**（`src/03-player.js`，`retryFromPlatformProgress` 内，约 `:145`）：

```js
      // 原来：const back = Math.max(0, target - 5);
      // 问题：平台进度读成 0（选择器没命中 / 平台尚未上报）时会退到 0 → 整节重播，
      //       用户看到的"看完就重播"就是这个分支。
      let back;
      if (target > 0) {
        back = Math.max(0, target - 5);                    // 正常：退到平台记录位置前 5s
      } else {
        // 读不到进度：退到末尾前 5s（对齐 Autovisor tail_retry_time），绝不回 0
        back = Math.max(0, (video.duration || 0) - 5);
        ZHS.Log.warn('平台进度读不到（target=' + target + '），退到末尾前 5s 重试上报，不从头重播');
      }
```

**配套硬上限**（对齐 `course_playback.py:172` 的 `retry_count >= 2`）：确认 `Player._retryCount` 在 `retryFromPlatformProgress` 里**不要 reset 后再返回 false**。当前代码（`03-player.js:139-143`）是"reset 到 0 然后返回 false"——这会让它永远达不到上限，形成无限重播循环（这是我 `PROCESS/meetings/round-1/playback-flow.md` 里 BUG-PB-1 的核心链路）。应改为：

```js
      if (this._retryCount >= 2) {          // 达到上限：不再重播，交给上层 gotoNext
        ZHS.Log.warn('重播已尝试 ' + this._retryCount + ' 次仍不同步，放弃重播，切下一节');
        this._retryCount = 0;               // 只在这里（或 gotoNext 成功时）清零
        return false;
      }
      this._retryCount++;
```

---

### 建议 ④ 切课前后用「标题」而不是「DOM 节点」做锚点

**动机**：Autovisor 用 Playwright `Locator`（惰性定位符），每次操作都重新查询 DOM（`utils.py:259` 每次 `page.locator(catalog.item).all()`）。我们缓存的是真实 DOM 节点，SPA 切课后旧节点会 detach，`findNext` 拿到的 `next` 可能在点击瞬间已经失效 → `click()` 点了个脱离文档的节点 → **没有任何效果，也不报错**（这就是"点下一节也没用"的另一种成因）。

**改法**（`src/05-scheduler.js:521-522` 区域）：

```js
        // 用标题做锚点（Autovisor 用惰性 Locator 达到同样效果）
        const nextTitle = cat.itemTitle(next);
        ZHS.state.lessonKey = nextTitle;

        // 点击前重新定位一次，确保节点还挂在文档里
        let target = next.isConnected ? next : cat.findByName(nextTitle);
        if (!target) {
          ZHS.Log.warn('目标节点已失效且按标题找不到：「' + nextTitle + '」');
          this.stop();
          return;
        }
        let landed = cat.click(target) && await cat.waitActive(target, 8000, 200);
```

`cat.findByName()` 已存在（`02-adapter.js:429-438`，精确匹配 + 包含匹配兜底），直接可用。

---

### 建议 ⑤ 补"播放器领先平台 15s 就对齐" + "120s 无进展即停"

**动机**：Autovisor `course_playback.py:127-152` 主动把播放位置压回平台记录位置，避免倍速太快导致平台上报跟不上、最后卡在 80% 反复重播；`:123-125` 的 120s 停滞检测防止静默死循环。我们两个都没有。

**改法 A（`src/05-scheduler.js` 的 `_tickInner` 正常保活段，约 `:345-349` 之后）**：

```js
      // 对齐平台进度：播放器不允许领先平台记录超过 15s（对齐 Autovisor course_playback.py:134）
      const curNode = ZHS.Catalog.current();
      if (curNode) {
        const p = ZHS.Catalog.progressOf(curNode);
        const dur = video.duration || 0;
        if (dur > 0 && p > 0) {
          const expected = dur * Math.min(100, Math.max(0, p)) / 100;   // = time_for_percent
          if (video.currentTime > expected + 15) {
            ZHS.Log.info('播放器领先平台记录过多（' + Math.round(video.currentTime) + 's vs '
              + Math.round(expected) + 's），回退对齐到 ' + p + '%');
            video.currentTime = expected;
            video.play();
          }
        }
      }
```

**改法 B（停滞检测）**：`05-scheduler.js:343` 已有 `ZHS.Player.checkStall(video)`，请确认它的判据包含"平台目录进度也在涨"这一路。Autovisor 是四选一刷新（`course_playback.py:93/98/117/122`：过验证 / 过弹题 / 平台进度上涨 / 视频时间前进 >0.25s）。若我们的 `checkStall` 只看视频时间，在"视频在播但平台上报卡住"的场景下不会触发，需要补上平台进度这一路。

---

## 8. 一条反直觉提醒（不要做错方向）

调研过程中有个结论值得单独强调，避免团队往错方向改：

**Autovisor 对 `studyvideoh5` 没有任何特殊处理**（全项目只有 2 处出现：`GUI.py:23` 帮助文案、`Autovisor.py:55` Cookie 列表）。它导航成功靠的是"**选择器正确 + 点后确认生效**"这两件事，不是靠域名特判。

而我们脚本的 wisdom 选择器（`02-adapter.js:29-34`）与 Autovisor `WISDOM_CATALOG`（`lesson_navigation.py:21-31`）**六个字段一字不差**。

**推论：选择器不是病因，缺"点后确认"才是。** 建议把改造精力放在建议 ①②③，不要再去猜 studyvideoh5 的选择器变体。

---

## 附：证据索引（全部可复核）

| 结论 | 文件:行 |
|---|---|
| CatalogSelectors 数据类 | `reference/autovisor/modules/lesson_navigation.py:8-18` |
| WISDOM/FUSION/HIKE/LEGACY 常量 | `lesson_navigation.py:21-31 / 33-40 / 42-51 / 53-62` |
| `parse_progress_value` | `lesson_navigation.py:67-76` |
| `has_class`（精确 split 匹配） | `lesson_navigation.py:79-80` |
| `catalog_candidates`（URL 域分支） | `lesson_navigation.py:83-88` |
| `detect_catalog`（20s / state=attached） | `lesson_navigation.py:91-106` |
| `lesson_progress` / `lesson_is_complete` | `lesson_navigation.py:109-126 / 125-126` |
| `wait_for_lesson_completion`（5s/0.25s） | `lesson_navigation.py:129-137` |
| **★ `wait_for_lesson_active`（8s/0.2s）** | `lesson_navigation.py:140-148` |
| `get_filtered_class`（建待学列表） | `reference/autovisor/modules/utils.py:251-269` |
| `optimize_page`（关学前必读弹窗） | `utils.py:203-229` |
| `CourseOutcome` 枚举 | `modules/course_runner.py:16-19` |
| `detect_catalog_after_verification`（20s deadline 重置） | `course_runner.py:22-38` |
| **★ `run_course` 切课主循环** | `course_runner.py:41-112`（点击在 `:64/:68`，确认在 `:65/:69`，失败停在 `:72`） |
| 未完成即停整门课 | `course_runner.py:95-100` + `Autovisor.py:247-250` |
| `learn_lesson` 主循环 | `modules/course_playback.py:66-217` |
| 完成判据 = 平台进度 ≥100 | `course_playback.py:106-112` |
| 落后对齐（领先 15s 回退） | `course_playback.py:127-152` |
| 视频结束 → 等 3s → 重读进度 | `course_playback.py:154-169` |
| **★ retry_count>=2 硬停** | `course_playback.py:172-177` |
| **★ 回退到平台记录位置** | `course_playback.py:178-200` |
| `time_for_percent` / `tail_retry_time` | `modules/video_state.py:18-27 / 30-33` |
| `video_at_end`（容差 1s） | `modules/video_state.py:12-15` |
| STALL / METADATA 超时常量 | `course_playback.py:26-27`（30s / 120s） |
| 可见性几何判据 | `modules/tasks.py:24-48` |
| 验证码 / 遮挡层选择器 | `modules/tasks.py:12-21` |
| `play_video` 后台任务 | `modules/tasks.py:120-167` |
| 域名分支只在答题模块 | `modules/tasks.py:174 / 183 / 208 / 212` |
| studyvideoh5 仅 2 处（文案/Cookie） | `GUI.py:23` / `Autovisor.py:55` |
| URL 校验正则（域名无关） | `modules/configs.py:33` |
| 本地对照：ADAPTERS | `src/02-adapter.js:25-98` |
| 本地对照：isFinished / _readProgress | `src/02-adapter.js:284-318` |
| 本地对照：Catalog.click（无验证） | `src/02-adapter.js:440-452` |
| 本地对照：findByName | `src/02-adapter.js:429-438` |
| 本地对照：onLessonEnd | `src/05-scheduler.js:372-426` |
| 本地对照：gotoNext / SAME_NAV_MAX | `src/05-scheduler.js:433-538`（点击 `:522`，计数 `:488-500`） |
| 本地对照：_rebindAfterNav | `src/05-scheduler.js:616-627` |
| 本地对照：回退重播 `back = max(0, target-5)` | `src/03-player.js:145-146` |
