# 智慧树 polymas「AI课程中心」页面 DOM 结构实地探测报告

- 探测人：review-worker-19
- 探测时间：2026-09-18
- 目标页面：https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center
- 探测方式：agent-browser（真实 Chrome）+ curl 静态抓取 + 打包产物静态审计
- 结论可信度标注：**【实测】**=浏览器/网络实测确认；**【产物审计】**=从线上 JS/CSS 打包产物中读到的确定代码；**【未能获取】**=未拿到

---

## 0. 最重要的结论：需要登录（页面被 SSO 拦截）

用浏览器直接打开目标 URL，**没有停留在课程中心，而是被重定向到智慧树统一登录中心**。

重定向后的最终 URL（实测）：
```
https://login.zhihuishu.com/?redirect=https%3A%2F%2Fcloudapi.polymas.com%2Foauth%2Flogin%2FssoLogin%3Fredirect%3Dhttps%253A%252F%252Fhike-teaching-center.polymas.com%252Fstu-hike%252Fagent-course-hike%252Fai-course-center
```
- 页面标题变成「登录中心」，页面内容是一整个登录表单（免密登录 / 账号登录 / 学号登录 / 工号登录 / 机构登录 / 微信登录）。
- 因此 **本次无法拿到登录后真实渲染的课程列表 DOM**。
- 顺带确认：目标页面是一个纯前端 SPA（Vue），`<div id="main"></div>` 在原始 HTML 里是空的，所有课程内容都是登录后由 JS 动态渲染的，所以 `curl` 抓不到课程列表（只能拿到空壳 + 内联的兼容脚本）。

> 给主代理的判断：**油猴脚本必须在用户已登录的浏览器里运行才能采到数据**。下面的选择器是从「线上打包产物里读到的确定代码」中还原出来的，可信度高，但**建议脚本里对每个选择器都做「找不到就降级/容错」处理**，以应对版本更新。

---

## 1. 架构说明（为什么选择器长这样）

这个页面不是一个普通页面，而是「主壳 + 微前端子应用」结构，实测与产物审计都确认：

- 主壳站点 `hike-teaching-center.polymas.com` 本身只负责路由和登录鉴权（`/assets/index-CKQ5CtSR.js`）。
- 登录成功、按角色区分后，主壳会把学生重定向到学生端微应用：`/stu-hike/agent-course-hike/ai-course-center`，并把真正的课程页面挂在 **qiankun 子应用** `custom-agent-course-app`（挂载点 `#agent_course_app`，标题「智能体课程」）里。
- 子应用入口：`https://hike-teaching-center.polymas.com/custom_agent_course_app/`（HTTP 200，实测）。
- 子应用主 JS：`/custom_agent_course_app/assets/index-wT3CjyJM.js`（2.4MB，实测下载成功）。
- **课程中心列表页组件**在懒加载分块 `index-D-dM4EuX.js` 中，组件名 `index`，根节点 class = `ai-course-center-body`。
- **单个课程卡片组件**在 `CourseCard-DXhnRenm.js` 中，组件名 `CourseCard`。

---

## 2. 逐条回答（1–8）

### ① 课程列表条目的完整 CSS 选择器路径与 class 名

**【产物审计，可信度高】**

- 列表页根容器：`.ai-course-center-body`
- 顶部页签容器：`.ai-course-center-header`
- 页签内容：`.tab-content`
- 每个课程卡片（点击单元）根节点：`div.course-card`

卡片内部结构（来自 `CourseCard-DXhnRenm.js` 的渲染函数）：

```
div.course-card                      ← 整卡，绑定了 onClick，可点
├── span.tag-top                     ← 置顶角标（isTop 时才有，文案「置顶」）
├── div.course-tag (+ 类型类)        ← 课程类型标签（可选）
├── div.course-cover-box             ← 封面容器
│   └── img.course-cover             ← 封面图
├── div.course-term ...              ← 学期 / 班级行（可选）
│   └── div.current-term-dto ...
├── h4                               ← ★课程名称（无 class，纯 h4）
└── div.course-card-footer ...       ← 底部信息行
    ├── div.teacher-info ...         ← 教师 / 进度信息区
    │   └── p                        ← ★进度文字（见第 4 条）
    └── div.handle-box.ml-8px        ← 操作按钮区（可选）
```

- 课程列表外层用的是网格组件 `BaseGrid`（虚拟滚动栅格，行容器 class=`row`），所以**卡片可能不是全部一次性渲染**，滚动时才补渲。脚本遍历卡片时要注意「等渲染 + 边滚边收」。
- **推荐主选择器：`div.course-card`**；若担心误伤，可用 `.ai-course-center-body div.course-card`。

### ② 「已完成」与「未完成」在 DOM 上如何区分

**【产物审计 + 部分实测，中等可信度】**

- 状态字段来自接口数据：每个卡片数据对象里有 `state`、`progress`、`systemCourseType`、`termIndexDtos` 等字段。
  - `data.state === 1` 走「学期/进行中」分支；否则走另一分支。
  - `data.progress` 是 **纯数字（百分比数值）**，DOM 上拼接成 `"xx%"`。
- **进度文字**由 i18n key `business.t4467` 渲染，模板为：`{progress}%`（即「已学进度：xx%」这类）。**【产物审计】**确认 `business.t4467` 的入参是 `progress: data.progress + "%"`。
- 已完成 / 未完成的相关文案（在子应用整体语言包里出现，说明页面上会出现）：`已完成`、`未完成`、`已学完`、`学习中`、`未开始`、`已结束`、`继续学习`、`开始学习`、`去学习`、`进入课程`、`学习进度`。**【产物审计】**
- 明确拿到的「完成态」类（注意：**这是课程详情/资源卡场景**，不一定是中心列表卡）：`.complete`（灰色态，`:after` 隐藏），以及子应用里有 `.data-status` / `.data-status-wrap`（空状态：无数据时的插画 + 提示）。
- **本报告无法 100% 断言**中心列表卡「已完成/未完成」到底是用 class 还是纯文案还是进度条区分——因为没登录看不到渲染结果。**安全做法**：脚本对该卡片做双重判定——
  1. 读取卡片内 `progress` 文字（`/\d+\s*%/`）判断百分比；
  2. 同时检测卡片内是否出现「已完成 / 已学完」等文字，或进度达到 100%。
  两者结合判定「是否看完」。

- 「未完成/已完成」标签用的 class 名（如 `.status`、`.complete`）在**第三方课程「170+」列表**里存在：`.course_li` 下有 `.status`（key:0 条件渲染）。**【产物审计】**

### ③ 课程名称元素的选择器

**【产物审计，可信度高】**

- **选择器：`div.course-card h4`**
- 名称文案通过 `ToolTipPro` 组件（`T(d,{content:a.data.courseName})`）注入，最终渲染成 `h4` 里的文本。
- 取文本方式：`card.querySelector('h4')?.textContent?.trim()`。

> 注意：h4 本身没有 class，所以**只能用 `div.course-card h4` 这种父子结构选择器**，不要指望 `.course-name`（该 class 出现在另一处「已完成课程」页 `CompletedCourse` 的 `.course-name`，不是这个列表卡）。

### ④ 课程进度 / 百分比元素

**【产物审计，中等可信度】**

- 进度文字位于卡片底部信息区：`div.course-card div.teacher-info p`（第一个 `p`）。
- 文本形态：`{progress}%`，其中 `progress` 是接口给的数字。示例：`66%`。
- 该 `p` 也在 `business.t4467` 的渲染分支里，旁边常跟一个按钮（`CourseButton`，文案「建课」`business.t1606`——这是教师视角；学生视角对应的按钮文案是 `继续学习/开始学习/去学习`）。
- **建议脚本**：`const pct = card.textContent.match(/(\d+)\s*%/)`，取百分比。

### ⑤ 点击哪个元素能进入课程？有没有 a 标签 / href？

**【产物审计，可信度高 —— 这是关键发现】**

- **整卡可点**：`div.course-card` 上直接绑定了 `onClick`。**没有 `<a href>`**，进入课程不是靠链接，而是靠 **JS 调 `window.open(url)` 新开标签页**。
- 卡片点击后的分流逻辑（`CourseCard-DXhnRenm.js` 里的 `Ce` 处理函数）：
  - 点击时先 emit `handleCourse` 事件给父组件；
  - 若是 **AI 课程**（`systemCourseType === AI_COURSE`），构造 URL 并 `window.open(p)` 打开新标签页。
- **url 格式（产物审计，常量前缀是运行时配置，未硬编码字符串，只能确定路径模板）**：
  ```
  ${BASE}/AIstudent/${courseId}/${classId}?key=entry        // AI 课程正常入口
  ${BASE}/course/index/${courseId}                          // 共享课程
  ${BASE}/mySpace                                           // newFlag 时
  ${BASE}/singleCourse/knowledgeStudy/${courseId}/${classId} // typeVersion===1
  ${BASE}/singleCourse/knowledgeStudy/${courseId}/${classId} // typeVersion===0（另一域名）
  ```
  - 其中 `BASE` 来自运行时导出的域名常量（`Fe` 等），**产物里没有明文域名**，故本报告**不编造完整域名**。
  - 结论：**进入课程后的 URL 路径规律是 `/AIstudent/{courseId}/{classId}?key=entry`**（AI 课程），且是**新标签页打开**。

> 对脚本的含义：想「自动进入课程」，可靠做法是 **直接点 `div.course-card`**（等价于用户点击，会触发它内部的 `window.open`），而不是去找 href。若想绕过点击直接跳转，需要自己拼 `/AIstudent/{courseId}/{classId}?key=entry`，但 `courseId/classId` 需要从卡片数据里取（Vue 组件 props，DOM 上不一定暴露）——**不推荐**，直接点击更稳。

### ⑥ 页面上是否有「继续学习 / 开始学习」按钮，选择器是什么

**【产物审计，中等可信度】**

- **有**。子应用语言包中同时存在 `继续学习`、`开始学习`、`去学习`、`进入课程` 这些文案。
- 「继续学习」出现在**课程学习/播放页**（组件 `index-HsdgDDGr.js`，含 `resume-study-tip`、`study-tips`、`back-course-btn`、`course-name`、`completed-*` 等 class），即进入某门课之后。
- 列表卡上的学习按钮是 `CourseButton` 组件（`CourseButton-GFO9kMOy.js`），**没有固定 class**，是组件。
- **未能获取**：列表卡上学习按钮的确切最终 class 名（需要登录态渲染才能确认）。
- **建议脚本**：用文案查找更稳 —— 在卡片内查找包含「继续学习 / 开始学习 / 去学习 / 进入课程」的元素；或直接点整卡（见第 ⑤ 条）。

### ⑦ 一个课程条目的 outerHTML 样例

**未能获取真实的 outerHTML**（原因：未登录，页面未渲染，`#main`/`#agent_course_app` 里没有课程节点）。

根据 `CourseCard` 渲染函数**重建**的骨架样例（脱敏，课程名统一替换为「课程A」；此结构为代码还原，非真实抓取，仅供选择器参考）：

```html
<div class="course-card">
  <!-- 可选：置顶角标 -->
  <span class="tag-top">置顶</span>

  <!-- 可选：课程类型标签，类型类动态拼接 -->
  <div class="course-tag ai-course">
    <i class="iconfont aloha-icon-juebiao"></i> AI智课·课程A
  </div>

  <!-- 封面 -->
  <div class="course-cover-box">
    <img class="course-cover" src="https://image.zhihuishu.com/...(占位)" alt="课程A">
  </div>

  <!-- 可选：学期/班级行 -->
  <div class="course-term flex items-center justify-between">
    <span>运行学期：2025-2026-1</span>
  </div>

  <!-- 课程名（h4 无 class） -->
  <h4>课程A</h4>

  <!-- 底部信息行 -->
  <div class="course-card-footer flex items-center justify-between">
    <div class="teacher-info flex items-center">
      <p>66%</p>                <!-- 进度：{progress}% -->
      <!-- 旁边是 CourseButton：继续学习 / 开始学习 -->
    </div>
    <div class="handle-box ml-8px"></div>
  </div>
</div>
```

> ⚠️ 再次强调：这是**代码还原**，不是实测 DOM。真实渲染的 class 拼接、`data-v-xxxx` 作用域属性、卡片实际顺序可能与上面略有出入。脚本请以 `div.course-card` / `h4` / `%` 文本这三个最稳的锚点为准。

### ⑧ 页面 URL 跳转规律（进入课程后的 URL 格式）

**【产物审计，可信度高（路径部分）】**

- 课程中心页 URL：`/stu-hike/agent-course-hike/ai-course-center`（学生）；教师为 `/tch-hike/agent-course-hike/ai-course-center`。
- 主壳会根据登录角色自动重定向：学生 → `/stu-hike/...`，且会区分是否「定制学校」（`/custom-stu-hike/` vs `/stu-hike/`）。**【产物审计】**
- 进入某门 AI 课程后的 URL 路径规律：
  ```
  {BASE}/AIstudent/{courseId}/{classId}?key=entry
  ```
  由卡片点击后用 `window.open` 新开标签页打开。**【产物审计】**
- `{BASE}` 域名是运行时配置（非明文），**未能获取**具体域名。建议实机登录后再抓一次 Network 里的跳转 URL 以补全。

---

## 3. 相关接口（工具，供脚本参考）

**【产物审计，来自 `cchub_main.js` / `stu_app_main.js`】**

- 主壳网关（实测请求时返回 503，说明需要带登录态/正确路由）：
  `https://hike-teaching-center-gateway.polymas.com`
- 已知接口（教师侧）：
  - `GET  {gateway}/basic-course/courseAgent/queryAgentList`  ← AI 课程列表查询
  - `POST {gateway}/teacher-course/class/term/list`
  - `POST {gateway}/teacher-course/course/library/...` 等资源类接口
- 说明：学生侧课程列表接口名**未能确认**（学生端与教师端接口前缀不同，且未登录拿不到调用）。

---

## 4. 给油猴脚本的落地建议（基于以上证据）

1. **前提**：脚本只在用户已登录的浏览器里工作。未登录时页面会跳到 `login.zhihuishu.com`，脚本应检测到并提示「请先登录」。
2. **等子应用渲染完**：课程列表挂在 qiankun 子应用 `#agent_course_app` 里，且用虚拟滚动（`BaseGrid`）。脚本要：
   - `MutationObserver` 等到出现 `div.course-card`；
   - 采集时**边滚动边收集**，去重。
3. **卡片选择器**：`.ai-course-center-body div.course-card`（主锚点）。
4. **课程名**：`card.querySelector('h4')?.textContent?.trim()`。
5. **是否看完**：优先看卡片文本里的 `xx%`（`/(\d+)\s*%/`），辅以「已完成/已学完」文字判定；**不要只依赖某个 class**（未 100% 确认）。
6. **进入课程**：直接 `card.click()`（整卡绑定了 onClick，会触发它自己的 `window.open`）。不要去找 `a[href]`——没有。
7. **容错**：所有选择器都加空值判断；页面改版时降级为「按文字找」（如找包含「继续学习/开始学习/进入课程」的可点元素）。

---

## 5. 未获取 / 存疑清单（如实列出）

| 项目 | 状态 | 原因 |
|---|---|---|
| 登录后真实渲染的课程列表 DOM | 未能获取 | 页面强制跳转 SSO 登录 |
| 一个课程条目的真实 outerHTML | 未能获取 | 同上（第⑦条为代码还原） |
| 「已完成/未完成」最终渲染是 class 还是文案 | 存疑（中等） | 未登录看不到，只能从产物推断 |
| 列表卡「继续学习」按钮的确切 class | 未能获取 | 同上，且是组件无固定 class |
| 进入课程的完整域名 `{BASE}` | 未能获取 | 运行时配置，产物中非明文 |
| 学生侧课程列表接口名 | 未能获取 | 未登录无调用记录 |
| `.agent-teaching-card` 是否用于中心列表卡 | 否 | 产物审计显示它只用于 `resource-panel`（课程详情内的资源卡），非中心列表卡 |

---

## 6. 探测过程可复现（命令与产物）

工作目录：`/c/Users/Administrator/WorkBuddy/2026-09-17-21-07-36`（临时产物，未改动项目文件）

```bash
# 1) 浏览器打开目标页（实测被重定向到登录）
agent-browser open "https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center"
agent-browser get url      # → login.zhihuishu.com/?redirect=...
agent-browser snapshot -i  # → 登录表单

# 2) 抓主壳 HTML 骨架（SPA 空壳）
curl -s -L "https://hike-teaching-center.polymas.com/stu-hike/agent-course-hike/ai-course-center" -o polymas_probe.html

# 3) 找子应用入口
curl -s "https://hike-teaching-center.polymas.com/assets/qiankun-custom-TrbwXS-K.js"   # entry 列表
curl -s "https://hike-teaching-center.polymas.com/assets/index-CKQ5CtSR.js"            # 主壳 JS

# 4) 学生端微应用
curl -s "https://hike-teaching-center.polymas.com/custom_agent_course_app/"            # 入口 HTML
curl -s "https://hike-teaching-center.polymas.com/custom_agent_course_app/assets/index-wT3CjyJM.js"   # 主 JS
curl -s "https://hike-teaching-center.polymas.com/custom_agent_course_app/styles/index-Cth-Cjoq.css"  # 主 CSS

# 5) 关键组件（课程中心列表 + 卡片）
curl -s "https://hike-teaching-center.polymas.com/custom_agent_course_app/assets/index-D-dM4EuX.js"        # 列表页
curl -s "https://hike-teaching-center.polymas.com/custom_agent_course_app/assets/CourseCard-DXhnRenm.js"   # 卡片
curl -s "https://hike-teaching-center.polymas.com/custom_agent_course_app/assets/BaseGrid-C7WgJhqy.js"     # 网格
```

关键证据文件（临时，位于工作目录）：
- `polymas_probe.html`（主壳空壳）
- `qk.js`（qiankun 入口列表，含 `/custom_agent_course_app/`）
- `stu_app_index.html`（学生端入口，`custom-agent-course-app`）
- `stu_app_main.js`（学生端主包）
- `chunks/index-D-dM4EuX.js`（课程中心列表页组件 `ai-course-center-body`）
- `chunks/CourseCard-DXhnRenm.js`（`CourseCard`：`div.course-card` / `h4` / `progress` / `window.open` 跳转）
- `chunks/BaseGrid-C7WgJhqy.js`（虚拟滚动网格）
