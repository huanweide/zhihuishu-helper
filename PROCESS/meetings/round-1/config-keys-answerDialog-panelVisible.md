# 配置键 `answerDialog` / `panelVisible` 死配置调研（只读）

> 调研人：ux-walkthrough
> 范围：`src/` 全量（默认配置、GM/localStorage 读写、所有 `config.xxx` 读取点、设置页 UI）
> 方法：Grep `answerDialog` / `panelVisible` / `config\.(answerDialog|panelVisible)` / `data-cfg=...` + 人工通读 `00-config.js`、`06-panel.js` 的 mount/设置区
> 性质：**只读调研，未修改任何文件**。源码快照：00-config.js 23:52、06-panel.js 后续改动（行号以本次 grep 时刻为准）

---

## 一、调研结论速览

| 配置键 | 定义位置 | 默认值 | 是否有消费端 | 判定 |
|---|---|---|---|---|
| `answerDialog` | `00-config.js:39` | `true` | **无**（仅同名方法 `_answerDialog`，非读取该键） | 死配置 |
| `panelVisible` | `00-config.js:49` | `true` | **无**（mount 永远显示，设置页无对应开关） | 死配置 |

两个键都"定义了、会被持久化、但业务代码从不读取"，属于**货真价实的死配置**。详细证据见下文。

---

## 二、逐个键的定义与消费点

### 2.1 `answerDialog`（课中弹题自动答）

**定义** `src/00-config.js:39`
```js
answerDialog: true,  // 课中弹题自动答
```
在 `DEFAULTS` 内，与 `autoAnswer` / `answerHomework` / `autoCloseDialog` 相邻。

**消费点：无。**
- Grep `config\.(answerDialog|panelVisible)` → 0 命中。
- Grep 全项目 `answerDialog`（非 `config.` 限定）→ 仅两处：定义 `00-config.js:39`，以及 `13-answerer.js:56` `await this._answerDialog(root)` 和 `:100` `async _answerDialog(root)` —— 这是 **Answerer 内部的一个同名方法名**，不是读取配置键 `ZHS.config.answerDialog`，二者无关。
- 设置页 UI 没有该开关：`06-panel.js` 设置区 `data-cfg="..."` 列表（`207-263` 行）只含 `autoPlay/autoNext/skipFinished/mute/resume/speed/autoAnswer/autoCloseDialog/bankEnabled/llmEnabled/gatedRandom/debug`，**没有 `answerDialog`**。
- 当前"课中弹题自动处理"的实际开关是 `05-scheduler.js` 守卫2（`guardOverlays` + `autoAnswer`）：`cfg.guardOverlays && U.hasStructurallyVisible(QUESTION_SELECTORS)` 为真时，若 `autoAnswer` 开则作答、否则仍会 `Questions.Dialog.close()` 关闭弹窗（`:192-224`）。即**弹题处理走的是 `autoAnswer`，`answerDialog` 完全没参与**。

**结论**：`answerDialog` 是死配置——定义了、也会随 `setConfig` 被写进 GM/localStorage，但没有任何 `if (ZHS.config.answerDialog)` 分支读取它。

### 2.2 `panelVisible`（悬浮面板显示）

**定义** `src/00-config.js:49`
```js
panelVisible: true,  // 悬浮面板
```
在 `DEFAULTS` 的"通用"分组内。

**消费点：无。**
- Grep `config.panelVisible` → 0 命中。
- Grep 全项目 `panelVisible` → 仅 `00-config.js:49` 一处（定义）。
- 设置页 UI 无对应开关（`data-cfg` 列表里没有它）。
- `06-panel.js mount()`（`142-164`）：每挂载都 `box.innerHTML = this._html()`，而 `_html()` 里面板根节点写死 `<div class="panel show">`（`:169`），即**永远带 `show` 类、初始必可见**；收起只靠运行时 `.fold` 按钮（`06-panel.js` 折叠逻辑）切换，从不参考 `config.panelVisible`。所以即使把它改成 false，面板照样显示。

**结论**：`panelVisible` 同样是死配置。

---

## 三、持久化机制说明（解释"为什么能写却读不到"）

两个键不是完全孤立——它们存在于 `DEFAULTS`，且 `getConfig()`（`00-config.js:84-101`）会把 `DEFAULTS` 与用户已存配置 `Object.assign` 合并，任何人调用 `ZHS.setConfig({ answerDialog: false })` 都能把它写进 GM/localStorage。**但写入 ≠ 消费**：全代码没有任何读取分支，所以用户改不改、存不存，对运行时行为零影响。这正是"死配置"的典型特征（有写入通道、无读取通道、无 UI）。

---

## 四、处置建议

### 4.1 `answerDialog` —— 建议「接上」（语义有价值，且现状有坑）

**理由**：它的意图是"课中弹题要不要自动处理"，本应是一个独立的总闸。现状是弹题自动处理被 `autoAnswer` 绑架——用户关掉 `autoAnswer`（只想要"不自动作答"）时，脚本**仍会自动关闭弹窗**（`:213`）。这其实是 BUG-UX-3 一类"行为不透明"的延伸：用户以为关了自动答题就全程手动了，结果弹题还是被脚本默默关掉。把 `answerDialog` 接上，正好能表达"弹题出现时是否自动处理（作答/关闭）"，让用户真正掌控。

**最小可行接入方案**：
1. `06-panel.js` 设置区加一行开关（紧跟 `autoAnswer`/`autoCloseDialog` 之后）：
   `<div class="row"><label>弹题自动处理</label><button class="sw" data-cfg="answerDialog"></button></div>`
   （`data-cfg` 机制已通用，`:311` 的 `querySelectorAll('.sw[data-cfg]')` 会自动绑定点击 → `setConfig`，无需额外代码）
2. `05-scheduler.js` 守卫2（`:192`）把整个弹题分支用 `answerDialog` 包一层：
   改 `if (cfg.guardOverlays && U.hasStructurallyVisible(QUESTION_SELECTORS))` 为
   `if (cfg.guardOverlays && cfg.answerDialog && U.hasStructurallyVisible(QUESTION_SELECTORS))`。
   这样 `answerDialog=false` 时，弹题不被脚本碰（完全交给用户手动），关掉 `autoAnswer` 也只控制"答不作答"、不再偷偷关弹窗。
3. 默认值保持 `true`，**无需**改 `CONFIG_REV`（默认不变、老用户无感）。

**若改走「移除」**（不推荐，除非确定永不想要此功能）：删 `00-config.js:39` 一行即可；运行时无任何引用，删后无副作用。但会让"弹题是否自动处理"彻底失去独立开关，与上面那个坑绑定。

### 4.2 `panelVisible` —— 「接上」或「移除」二选一，倾向「接上」

**理由（接上）**：面板显隐是用户常要的偏好（有人嫌悬浮面板挡视线，想默认折叠/隐藏，需要时再点 `.mini` 唤出）。接上成本极低。

**最小可行接入方案（接上）**：
1. `06-panel.js` 设置区加一行：
   `<div class="row"><label>默认显示面板</label><button class="sw" data-cfg="panelVisible"></button></div>`
2. `mount()` 末尾（`06-panel.js:163` 之后）或 `refresh()` 里读 `ZHS.config.panelVisible`：为 `false` 时把 `box` 的 `.panel` 去掉 `show` 类（或 `host.style.display='none'`），让面板默认收起/隐藏；用户仍可用 `.mini` 按钮 (`zhs-helper-panel .mini`) 唤出。
3. 默认值 `true`，无需改 `CONFIG_REV`。

**若改走「移除」**：删 `00-config.js:49` 一行即可；设置页与运行时都无引用。代价：永久失去"面板默认显隐"偏好（若以后想加，得重新设计）。

### 4.3 相邻提醒（非本次任务范围，但影响决策）

`answerHomework`（`00-config.js:40`，默认 `false`）与上面两个不同——它是**有消费端但无 UI 开关**（仅在 `13-answerer.js:200` `if (!manual && (!autoAnswer || !answerHomework)) return;` 被读取，作业页手动路径才能绕过）。它不算死配置，但和 `answerDialog` 一样"用户改不了"。若决定接 `answerDialog`，建议顺手在设置区补一行 `data-cfg="answerHomework"`，把"作业页自动答"也交给用户，逻辑闭环更完整。

---

## 五、验证方式（可复现）

- 死配置判定靠全量 Grep + 通读，不依赖运行；如需动态确认，可在 jsdom 加载 `src/*.js` 后打印 `Object.keys(ZHS.config)` 与 "是否有代码读取该键"——但因无运行时读取点，动态法只能证"有键"，无法证"有用"，故以静态 Grep 为准。
- 本调研未触碰 `dist/`（其构建时间晚于部分 src 改动，属已知陈旧，发布前需 `node build.js`）。
