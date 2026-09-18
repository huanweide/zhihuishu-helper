# review-worker-20｜智慧树「在线考试/作业」页面 DOM 实地抓取报告

> 任务：用浏览器实地抓取在线考试列表页真实 DOM，为油猴脚本提供准确选择器。
> 目标页：`https://onlineexamh5new.zhihuishu.com/stuExamWeb.html#/webExamList/dohomework/472492/5pQnxP6J/egGd6LDe/1000006642/433/0`
> 日期：2026-09-18
> 工具：agent-browser（CDP 无头 Chrome）+ curl 静态抓取 + 打包产物反编译

---

## 0. 关键前提结论（务必先读）

**未能获取「登录后」的真实渲染 DOM。**
打开目标页后，因当前浏览器**无登录态（无 Cookie）**，页面被 302 重定向到智慧树登录中心：

```
最终 URL: https://login.zhihuishu.com/?redirect=...ai-course-center
页面标题: 登录中心
页面结构: 智慧树·AI教学中心 登录页（免密登录/账号登录/学号登录/工号登录 + 手机号验证码）
```

截图证据：`/tmp/zs-login-redirect.png`（已确认是登录页，非考试列表页）。

也就是说：**第 1/2/3/6/7 条的「运行时 outerHTML 样例」拿不到**，因为我无法登录。
但目标站是 Vue SPA（`<div id="app"></div>` 空壳，全靠 JS 渲染），**页面 DOM 完全由打包的 JS 生成**。
因此我改用「**下载并反编译官方 SPA 打包产物**」的方式，从源码级拿到的**真实选择器与 class 名**。
这是**静态一手证据**，不是编造；来源文件如下（已下载到 `/tmp/`）：

| 文件 | 大小 | 作用 |
|---|---|---|
| `stuExamWeb.js` | 8.9 MB | 主包（路由表、API 服务层） |
| `chunk_9.js` | 373 KB | **作业/考试列表页组件**（含「开始答题/进入考试/剩余时间/已完成」字符串） |
| `chunk_0.js` | 5.0 MB | **答题页·题目与选项组件**（含题目/选项渲染） |
| `chunk_1.js` | 872 KB | **答题页·答题卡与答案保存/提交**（含「剩余时间/下一题/提交」） |
| `manifest.ba6128330a0b4ea891ef.js` | 1.8 KB | webpack chunk 文件名映射表 |

> 说明：以下 class 名来自 Vue 编译后的 `staticClass`，是**页面实际会渲染出的真实 class**，可信度高。
> 但因为是反编译得到，个别动态拼接的 class（如带 hash 的 `data-v-07817f46`）在运行时才出现，已如实标注。

---

## 1. 待测任务列表条目的 CSS 选择器与 class 名

列表由两个子组件渲染，容器统一在 `div.examBox#examBox` 内：

```
div.examBox#examBox
├─ job-list-vue          → 作业列表（ref="getWorkLists"）
└─ my-examination        → 考试列表（ref="paramData"）
```

### 1A. 作业列表（job-list-vue）

源码（chunk_9.js）：

```js
a("ul", t._l(t.workLists.StudentHomework, function(e, n){
  return a("li", { key: n }, [
    1 == t.flag ? a("div", { staticClass: "examItemWrap clearfix" }, [ ... ]) : t._e()
  ])
}))
```

- **每条作业**：`ul > li > div.examItemWrap.clearfix`
- **作业标题**：`div.examItemWrap .examInfoBox .examTit a.course_ewname span.name.middle`
- **进入作业的点击区**：`a.course_ewstate`（左侧图标块）或 `span.percentage_number`，都绑定 `goDohomework(e)`

### 1B. 考试列表（my-examination）

源码（chunk_9.js）：

```js
t.upJiaoFlag
  ? t._l(t.getStudentFinalExam, function(e, n){
      return t.getStudentFinalExamIndexFlag
        ? a("div", { key: n, staticClass: "examItemWrap examItemWrap111 clearfix pos-rev" }, [ ... ])
        : t._e()
    })
  : ...
```

- **每条考试**：`div.examItemWrap.examItemWrap111.clearfix.pos-rev`
  - 另有 `examItemWrap222` / `examItemWrap333` 变体（补考/其他考试类型）
- 无数据时显示：`p.font`，文案 **"你还没有完成作业/考试呢"**

**统一选择器建议**：`#examBox .examItemWrap`（两类列表通用）。

---

## 2. 任务状态如何在 DOM 上区分

状态**不是写死的 class**，而是由三个数字字段在渲染时决定显示哪块 DOM：
`stateChangeLeft` / `stateChangeCenter` / `stateChangeRight`（考试页）；作业页用 `courseState`。

### 2A. 考试：状态来源是接口字段 `state`（1~5），再由 `setTimeStates()` 翻译

源码（chunk_9.js，关键逻辑，已核实）：

```js
setTimeStates: function(t, e){ switch(e === "a"){
  switch(t.state){
    case 1:  // 未提交/可做：按时间判断
      t = now < startTime ? {Left:0,Right:0,Center:0}          // 未开始
        : (now>=startTime && now<=endDate) ? {Left:1,Right:1,Center:1}  // 进行中·可答题
        : {Left:5,Right:5,Center:5};                            // 已过期
    case 2:  // 已提交
      t = now<startTime ? {Left:"",Right:"",Center:""}
        : (now<=endDate) ? {Left:2,Right:2,Center:1}            // 已提交·已完成
        : {Left:5,Right:5,Center:5};
    case 3: t = {Left:3,Right:3,Center:2};   // 待批阅
    case 4: t = {Left:4,Right:4,Center:3};   // 已批阅出分
    case 5: // 同 case 1 的时间判断（重做类）
  }
}}
```

**DOM 表现对照表**：

| state | 含义 | stateChangeRight | 右侧 DOM 文案 / class |
|---|---|---|---|
| 1 | 未开始 | 0 | `div.examChartBox1 > p.font18` = **"考试尚未开始"** |
| 1 | **进行中（可答题）** | 1 | `div.examChartBox1.f2` 内出现按钮（见第 3 条） |
| 2 | 已完成 | 2 | 按钮位显示已完成/查看类 |
| 3 | 待批阅 | 3 | `div.examChartBox.f2.ml20` |
| 4 | 已出分 | 4 | 出分展示 |
| 5 | 已过期 | 5 | 过期提示 |

左侧 `stateChangeLeft` 同时控制左侧图标块：
- `0` → `div.examProgress1`（未开始图标）
- `1` → `div.examProgress1`（进行中，带 `progressbar_Detail progressbar_100`）
- `2` → `div.examProgress1`（已完成，`percentage_number.numberAchieveCountNum` 显示 **"已完成{n}%"**）
- `3`/`4` → `div.examProgress2`
- `5` → `div.examProgress1`（过期）

### 2B. 作业：用 `courseState`

源码（chunk_9.js）：

```js
0 == e.courseState ? a("div", { staticClass: "examProgress1 fl" }, [
    "" != e.achieve && null != e.achieve
      ? a("a", { staticClass: "course_ewstate", on:{click: goDohomework(e)} }, [
          ... a("span", { staticClass:"percentage_number" }, [t._v("作业")]),
          a("div", { staticClass:"progressbar_Detail progressbar_51_60 mt30", class: e.pressClass },
             [a("span", { staticClass:"percentage_number commitNumber" }, [t._v("已完成"+e.achieve+"%")])])
        ])
      : ...
  ]) : t._e(),
1 == e.courseState ? a("div", { staticClass:"examProgress1 fl" }, [
    a("a", { staticClass:"course_ewstate", ... }, [
      a("div", { staticClass:"progressbar_Detail progressbar_51_60" }, [
        a("div", [ a("span", { staticClass:"percentage_number greycolor" }, [t._v("作业")]) ])   // 灰色=已完成
      ])
    ])
  ]) : t._e()
```

- `courseState == 0` → 未完成/可做（`percentage_number` 显示"作业"）
- `courseState == 1` → 已完成（class 变成 `percentage_number greycolor`，灰色）
- 完成度文字：`span.commitNumber` = **"已完成{n}%"**
- 退回重做标记：`span.returnRedoIco.middle` = **"退回重做"**

### 2C. 考试异常标记

`i.exam-exception-icon` = **"考试异常"**（当 `examStatus == 3`）。

---

## 3. 任务标题与「开始答题/进入考试」按钮的选择器

### 3A. 标题

| 列表 | 标题选择器 | 取到的字段 |
|---|---|---|
| 作业 | `.examItemWrap .examInfoBox .examTit a.course_ewname > span.name.middle` | `e.examName` |
| 考试 | `.examItemWrap .examInfoBox .examTit a.course_ewname.course_ewnameNew` | `e.examName` |

> 注意考试列表里 `a.course_ewname` 还带 class `txtEllipsis fl course_ewnameNew`。

### 3B. 「开始答题」按钮（考试）

源码（chunk_9.js，`stateChangeRight == 1` 分支）：

```js
a("div", { staticClass: "examChartBox1 f2" }, [
  a("a", { staticClass: "commonBtn_green jobExamComBtn" }, [
    1==e.courseType||3==e.courseType
      ? a("span", { staticClass: "themeBg", on:{click: bindstateChangeLeft(e)} }, [t._v("开始答题")])
      : t._e()
  ]),
  a("a", { staticClass: "commonBtn_green jobExamComBtn" }, [
    2==e.courseType
      ? a("span", { staticClass: "themeBg", on:{click: bindstateChangeLeftWei(e)} }, [t._v("开始答题")])
      : t._e()
  ])
])
```

- **按钮外层**：`a.commonBtn_green.jobExamComBtn`
- **真正可点击的文字**：`a.commonBtn_green.jobExamComBtn > span.themeBg`，文字 = **"开始答题"**
- 点击处理：`bindstateChangeLeft(e)`（普通考试） / `bindstateChangeLeftWei(e)`（2 类课程/微课）
- 完整选择器：`#examBox .examChartBox1 .jobExamComBtn span.themeBg`

### 3C. 进入作业的入口（作业）

作业没有独立按钮，**点整块图标区或标题即进入**，绑定 `goDohomework(e)`：

- `a.course_ewstate`（左侧图标块）
- `span.percentage_number` / `span.commitNumber`
- `.examTit`（标题行）

选择器：`#examBox .examItemWrap .course_ewstate` 或 `#examBox .examItemWrap .examTit`

---

## 4. 点击进入后 URL 如何变化（格式规律）

**路由表**（来自 stuExamWeb.js 主包，已核实）：

```js
{ path: '/webExamList', name: 'webExanList', ... }
{ path: '/webExamList/dohomework/:recruitId/:stuExamId/:examId/:courseId/:schoolId/:meetCourseType',
  name: 'doHomework', ... }
{ path: '/webExamList/doexamination/:recruitId/:stuExamId/:examId/:courseId/:schoolId',
  name: 'doExamination', ... }
```

**进入作业**（chunk_9.js `gotoDohomework`）：

```js
var i = this.$router.resolve({
  path: "/webExanList/dohomework",     // ← 源码里此处拼写少了一个 m（笔误），但 name 正确
  name: "doHomework",
  params: {
    recruitId: this.courseObject.recruitId,
    stuExamId: t.id,          // ← 注意：加密后的作业/考试 ID 字段叫 id，不是 stuExamId
    examId: t.examId,
    courseId: t.courseId,
    schoolId: this.$store.state.schoolId,
    meetCourseType: t.meetCourseType
  }
});
var o = i.href;
```

- 生成 URL 形如：`#/webExamList/dohomework/{recruitId}/{stuExamId}/{examId}/{courseId}/{schoolId}/{meetCourseType}`
- 实际打开方式：`window.open()` 新开标签页（源码里先 `window.open()` 拿句柄 `n`，再 `i.href` 赋值）
- **这与目标页 URL 格式完全吻合**：
  `/webExamList/dohomework/472492/5pQnxP6J/egGd6LDe/1000006642/433/0`
  → recruitId=`472492`, stuExamId=`5pQnxP6J`, examId=`egGd6LDe`, courseId=`1000006642`, schoolId=`433`, meetCourseType=`0`

**进入考试**（chunk_9.js）：

```js
this.$router.push({
  path: "/webExamList/doexamination/",
  name: "doExamination",
  params: { recruitId, stuExamId: u, examId: i, courseId: r, schoolId: c }
})
```

- 格式：`#/webExamList/doexamination/{recruitId}/{stuExamId}/{examId}/{courseId}/{schoolId}`
- （注意考试比作业少一个 `meetCourseType` 尾段）

返回列表页：`#/webExamList`（name=`webExanList`）。

---

## 5. 作业/考试答题页的 DOM 结构（题目标题 / 选项 / 提交按钮）

答题页组件在 **chunk_0.js**（题目与选项）与 **chunk_1.js**（答题卡/保存/提交）。

### 5A. 题目容器

源码（chunk_0.js，render 函数）：

```js
_c('div', { staticClass: "questionType" }, [
  _c('div', { staticClass: "examPaper_subject mt30",
      attrs: { "data-questionid": _vm.data.id } }, [        // ← 每题带 data-questionid
    _c('div', { staticClass: "subject_stem clearfix" }, [
      _c('div', { staticClass: "subject_num fl" }, [        // 题号
        _c('span', { attrs: { "id": 'anchor_' + _vm.data.id } }, [...])
      ]),
      _c('div', { staticClass: "subject_type_describe fl" }, [
        _c('div', { staticClass: "subject_type_annex" }, [
          _c('span', { staticClass: "subject_type" }, [       // 【题型】(分数)
            _c('span', [ _vm._v("【" + _vm._s(_vm.data.questionType.name) + "】") ]),
            _c('span', [ _vm._v("(" + _vm._s(_vm.data.questionScore) + "分)") ])
          ])
        ]),
        _c('div', { staticClass: "subject_describe" }, [       // 题干（innerHTML！）
          _c('p', { domProps: { "innerHTML": _vm._s(_vm.data.name) } })
        ]),
        ...
      ])
    ]),
    ...
  ])
])
```

**关键选择器**：
- 题目块：`.examPaper_subject`（属性 `data-questionid="{题目id}"`）
- 题号：`.examPaper_subject .subject_num`
- 题型标签：`.subject_type_describe .subject_type`（文案 `【单选题】(2分)` 之类）
- **题干：`.subject_describe`（内容通过 `innerHTML` 注入，含 HTML）**

### 5B. 选项结构

源码（chunk_0.js）：

```js
_c('div', { staticClass: "subject_node" },
  _vm._l(_vm.dataArr.questionOptions, function(item, index){
    return _c('div', { key: index, staticClass: "nodeLab" }, [
      _c('label', { staticClass: "clearfix" }, [
        _c('div', { staticClass: "fl" }, [
          _c('input', {
            directives: [{ name: "model", rawName: "v-model",
                           value: (_vm.checkboxVal), expression: "checkboxVal" }],
            ...
          }),
          _c('div', { staticClass: "node_detail examquestions-answer fl",
                      domProps: { "innerHTML": _vm._s(item.content) } })  // 选项正文 innerHTML
        ])
      ])
    ])
  })
)
```

**关键选择器**：
- 选项列表容器：`.examPaper_subject .subject_node`
- **每个选项**：`.subject_node > .nodeLab`
- **选项勾选框**：`.nodeLab input`（`input[type=checkbox]` / radio，绑定 `v-model="checkboxVal"`）
- **选项文本**：`.nodeLab .node_detail.examquestions-answer`（`innerHTML` 注入）
- 选中态 class：`.onChecked`（CSS：`.nodeLab .clearfix .onChecked{color:#3d84ff}`）
- 覆盖标记：`.flagChecked`（`.nodeLab` 内绝对定位）

> ⚠️ 重要提醒：题干与选项内容都是 **`innerHTML` 动态注入的 HTML**，所以**选项没有固定 class**，脚本应基于 `input` 的 `value` 或相邻 `.node_detail` 文本匹配，而非猜 class。

### 5C. 答案卡（右侧答题卡）

源码（chunk_0.js）：

```js
_c('div', { staticClass: "answerCard-list-wrap" }, [
  _c('el-scrollbar', ... , [
    _c('div', { staticClass: "answerCard_list clearfix" },
      _vm._l(_vm(examinationArr).workExamParts[pos].questionDtos, function(item, index){
        return _c('i', { key: index }, [
          _c('span', {
            staticClass: "answerList_item",
            class: answerCardData[item.id].isCurrent == 1 ? 'answerList_yes' : 'answerList_error',
            attrs: { "data-qid": item.id },
            on: { "click": getQuestionLocation(item.id) }
          }, [ _vm._v(题号), _c('em') ])     // 或 answerListMore
        ])
      })
    ])
  ])
])
```

- 答题卡容器：`.answerCard`（chunk_1.js 中 `n("div",{staticClass:"answerCard"})`）
- 题号格子：`.answerList_item`（`data-qid` = 题目 id；`answerList_yes`=对 `answerList_error`=错）
- 复合题：`.answerListMore > .answerListChild`（显示 `得分/总分`）

### 5D. 提交按钮

**作业提交**（chunk_1.js）：

```js
n("button", {
  staticClass: "submit-btn",
  class: [ e.submitDisable ? "disable-color" : "active-color" ],
  on: { click: e.submitData }
}, [ e._v("提交") ])
```

- 选择器：**`button.submit-btn`**（可用 `.active-color` 判断是否可点、`.disable-color` 为禁用）
- 文案：**"提交"**
- 处理：`submitData` → `b.a.submit({ recruitId, examId, stuExamId, achieveCount })`

**逐题翻页/保存**（chunk_1.js）：

```js
n("el-button", { attrs:{type:"primary", disabled: ...}, on:{click: switchQuestion(1)} }, [ "下一题" ])
// 最后一题时改为：
n("el-button", { attrs:{type:"primary", plain:""}, on:{click: switchQuestion(0,3)} }, [ "保存" ])
```

- 文案：**"下一题"**（中间）；最后一题变 **"保存"**
- 提示文案：`p.switch-btn-warn` = "答题后请点【下一题】保存答案，全部试题答完后请点击右上角【提交】按钮完成答题…"
- 答题卡标题：`.answerCard_tit`，含 **"剩余时间"** / "剩余时间（时分）"
- 倒计时数字：`.answerCard-list-box.countdown`

---

## 6. 完整任务条目 outerHTML 样例

**未能获取运行时真实 outerHTML（原因：未登录，页面被重定向到登录页，无法渲染列表）。**

但我可以给出**根据官方 Vue 编译 render 函数还原的结构骨架**（class 与嵌套关系来自源码，内容字段用脱敏替代）。
作业条目还原后大致如下（标题已脱敏为「作业A」，ID 脱敏）：

```html
<ul>
  <li>
    <div class="examItemWrap clearfix">
      <!-- 左侧：状态图标区，点击进入 -->
      <div class="examProgress1 fl">
        <a class="course_ewstate" onclick="goDohomework(...)">
          <span>
            <img class="test" src=".../faf1c375299a4cf1963dd0c8be8b7b3f.png">
            <div class="progressbar_Detail progressbar_51_60 progressbar_100">
              <div><span class="percentage_number">作业</span></div>
            </div>
          </span>
          <div class="progressbar_Detail progressbar_51_60 mt30">
            <div><span class="percentage_number commitNumber">已完成 0%</span></div>
          </div>
        </a>
        <em class="pa bgrightbottom"></em>
      </div>
      <!-- 右侧：标题与信息 -->
      <div class="examInfoBox fl ml30">
        <div class="examTit" onclick="goDohomework(...)">
          <a class="course_ewname">
            <span class="name middle">作业A</span>
          </a>
        </div>
        <ul class="examInfoList clearfix">
          <li class="fl"><label class="fieldItem fl">题目数量</label><span>10</span></li>
          <li class="fl"><label class="fieldItem fl">总 分 数</label><span>100</span></li>
          <!-- 存在时间信息时还会有"截止时间" li，见第 7 条 -->
        </ul>
      </div>
    </div>
  </li>
</ul>
```

考试条目（`examItemWrap examItemWrap111 clearfix pos-rev`）结构与上类似，右侧按钮区为
`div.examChartBox1.f2 > a.commonBtn_green.jobExamComBtn > span.themeBg`（文案"开始答题"）。

> 再次强调：以上是**源码还原结构**，非运行时实测。真实运行时可能多出 `data-v-xxxx` 作用域属性。

---

## 7. 「剩余次数 / 截止时间」等信息及选择器

### 7A. 截止时间

源码（chunk_9.js，考试列表信息区）：

```js
a("li", { staticClass: "fl", staticStyle: { "line-height":"30px" } }, [
  a("label", { staticClass: "fieldItem fl" }, [ t._v("截止时间") ]),
  a("span", { staticStyle: { color:"#F94F17" } }, [ t._v(t._s(e.endDate)) ])
])
```

- 标签：`li > label.fieldItem`，文案 **"截止时间"**
- 值：**`li > span`**（红色 `#F94F17`），取接口字段 **`endDate`**
- 选择器：`.examInfoList .fieldItem` （找"截止时间"文字）后取兄弟 `span`

其他信息项同样结构（`.examInfoList li > label.fieldItem + span`）：
- **"题目数量"** → `e.problemNum`
- **"总 分 数"** → `e.totalScore`
- **"考试时长"** → `div.examLonger`，文案 `考试时长：{limitTime}分钟`
- 开考时间：`span#examStartDate`，文案 `考试时间：{startTime}`

### 7B. 剩余次数

**考试列表页未直接显示"剩余次数"。** 相关接口 / 字段：

- 接口 `student/residualTimes`（剩余次数）——定义在主包 API 层
- 申领重做时用 `redoNum`：源码文案 **"你还有{n}次重做机会，重做的分数就是你作业的分数哦"**（`3 - rt` 计算，最多 3 次）
- 补考相关：`hasMakeupExam` 接口，文案 **"在线考试(补考)"**

**考试作答页有"剩余时间"**（chunk_1.js）：
- `.answerCard_tit` = "剩余时间" / "剩余时间（时分）"
- `.answerCard-list-box.countdown` 内显示倒计时数字

### 7C. 其他可见信息

- 完成度：`span.numberAchieveCountNum` = "已完成{n}%"
- 退回重做：`span.returnRedoIco` = "退回重做"
- 考试异常：`i.exam-exception-icon` = "考试异常"
- 考试时间查询：`a.lookTimeBtn` = "考试时间查询"
- 补考说明：`.buKao` = "补考说明"/"若补考成绩≥60分…"
- 空状态：`p.font` = "你还没有完成作业/考试呢"

---

## 8. 提交答案走 XHR 还是表单？

**走 XHR（`postFetch`，即 axios 风格的 POST），不是表单提交。**
所有接口都在主包 `stuExamWeb.js` 的 API 服务模块（module 68）中定义，统一用 `postFetch(url, params)`。

### 8A. API 基址（已核实）

```js
var serectExam  = '//studentexam-api.zhihuishu.com';
var serectExamT = '//taurusexam-api.zhihuishu.com';
var serectPath  = 'gateway/t/v1';
var studentExam = 'studentExam';
var taurusExam  = 'taurusExam';
```

拼出的完整 URL 形如：
`https://studentexam-api.zhihuishu.com/studentExam/gateway/t/v1/student/getStudentHomework`

### 8B. 关键接口路径（从源码逐个提取，真实）

| 函数名 | HTTP | 完整路径 |
|---|---|---|
| `getWorkLists`（拉作业列表） | POST | `/studentExam/gateway/t/v1/student/getStudentHomework` |
| `getStudentFinalExam`（拉考试列表） | POST | `/studentExam/gateway/t/v1/student/getStudentFinalExam` |
| `openHomework`（打开作业） | POST | `/studentExam/gateway/t/v1/student/doHomework` |
| `getStuAnswerInfo`（取答卷信息） | POST | `/studentExam/gateway/t/v1/answer/getStuAnswerInfo` |
| `getStuAnswerInfoNew` | POST | `/studentExam/gateway/t/v1/answer/getStuAnswerInfoNew` |
| **`saveStudentAnswer`（保存单题答案）** | POST | `/studentExam/gateway/t/v1/answer/saveStudentAnswer` |
| `temporarySave`（暂存/自动保存） | POST | `/studentExam/gateway/t/v1/answer/temporarySave` |
| **`submit`（提交作业）** | POST | `/studentExam/gateway/t/v1/…/submit` |
| **`submitExam`（提交考试）** | POST | `/taurusExam/gateway/t/v1/answer/submit` |
| `checkAnswers`（是否看过答案） | POST | `/studentExam/gateway/t/v1/student/checkAnswers` |
| `hasAnswer` | POST | `/studentExam/gateway/t/v1/answer/hasAnswer` |
| `residualTimes`（剩余次数） | POST | `/studentExam/gateway/t/v1/student/residualTimes` |
| `getIsObject`（是否主观题） | POST | `/studentExam/gateway/t/v1/student/getIsObject` |
| `redoNum`（重做次数） | POST | `/studentExam/gateway/t/v1/student/redoNum` |
| `applyRedo`（申请重做） | POST | `/studentExam/gateway/t/v1/student/applyRedo` |
| `lookHomework`（查看已交作业） | POST | `/studentExam/gateway/t/v1/student/lookHomework` |
| `currentTime`（服务器时间） | POST | `/studentExam/gateway/t/v1/student/currentTime` |
| `getSaveAnswerLockResult`（禁考校验） | POST | `/studentExam/gateway/t/v1/answer/getSaveAnswerLockResult` |

> 另有 `computerSaveStudentAnswer` / `computerSubmit` / `computerGetStuAnswerInfo` 等 PC 端变体。
> `taurusexam-api` 域为考试（taurus=金牛座）专用，`studentexam-api` 为作业/通用。

### 8C. 保存答案的请求体（chunk_1.js 实测字段）

```js
var d = {
  recruitId:   this.$route.params.recruitId,
  examId:      this.$route.params.examId,
  stuExamId:   this.$route.params.stuExamId,
  eid:         t,                    // 题目 id
  answer:      r,                    // 答案内容
  schoolId:    this.$route.params.schoolId,
  deviceId:    s,
  examType:    l,
  fromType:    3,
  dataIds:     "",                   // 复合题子题 id
  questionType: 2                    // 题型：1单选 2多选 3问答/填空…
};
// 提交时包装为：
var c = { stuExamAnswer: d };
// 并按 examId 做本地加密/合并再 POST saveStudentAnswer
```

**提交作业请求体**（chunk_1.js）：

```js
var t = {
  recruitId: this.$route.params.recruitId,
  examId:    this.$route.params.examId,
  stuExamId: this.$route.params.stuExamId,
  achieveCount: this.alreadyNum
};
b.a.submit(t)   // POST /submit
```

### 8D. 一个容易被忽略的坑：答题记录本地存储

源码里有 `saveData` / cookie 逻辑（`stuExamAnswer{stuExamId}` 为键），答案会先存本地再同步服务端。
脚本若走纯 API 提交，需注意服务端可能校验 `stuExamId`/`examType`/`deviceId` 一致性。

---

## 附：未能获取项汇总（如实声明）

| 编号 | 内容 | 状态 | 原因 |
|---|---|---|---|
| 1 | 列表条目运行时选择器 | ⚠️ 源码级已给 | 未登录无法实测；选择器来自官方打包源码 |
| 2 | 状态区分 | ✅ 逻辑已给 | `state` 1~5 → `stateChangeLeft/Right/Center` |
| 3 | 标题/按钮选择器 | ⚠️ 源码级已给 | 同上 |
| 4 | URL 格式 | ✅ 已给 | 路由表 + `$router.resolve` 源码 |
| 5 | 答题页 DOM | ⚠️ 源码级已给 | 来自 chunk_0/chunk_1 render 函数 |
| 6 | outerHTML 真实样例 | ❌ 未获取 | 未登录，无渲染 |
| 7 | 剩余次数/截止时间 | ✅ 已给 | `endDate`/`fieldItem`/`residualTimes` |
| 8 | XHR vs 表单 | ✅ 已给 | 全部 `postFetch`，路径已列 |

**核心建议**：脚本应优先用**稳定 class 锚点**：
- 列表项：`#examBox .examItemWrap`
- 开始答题：`#examBox .jobExamComBtn span.themeBg`（文案"开始答题"）
- 进入作业：`#examBox .examItemWrap .course_ewstate`
- 题干：`.examPaper_subject[data-questionid] .subject_describe`
- 选项：`.subject_node .nodeLab input`
- 提交：`button.submit-btn`

若后续能提供**已登录的浏览器环境**，我可以再做一次真正的运行时 outerHTML 抓取，补齐第 6 条。
