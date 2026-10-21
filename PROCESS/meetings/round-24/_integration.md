# round-24 整合报告 · 网络失败分层诊断（v0.6.26 → v0.6.27）

> 主持人：Chair　|　参与：worker-A（代码审查）、Deep Research（外部学习）
> 日期：2026-09-19 ~ 09-20　|　门禁终态：逻辑单测 **444/0 全绿**，凭据扫描 0 命中
> 落盘依据：`references/record-keeping.md` 第二节（会议记录）

---

## 一、阶段零：外部学习（先搜寻再审查）

本轮严格按魔王系统 v3.0 阶段零执行——**不许闭门造车**，先看完别人怎么做的再动手。

| 来源 | 结论 | 对本项目的作用 |
|---|---|---|
| arxiv 2509.14583 | Hallucination tax：约 40% 算力浪费在无效重试 | 印证「用户只会反复重试」的现状代价 |
| arxiv 2502.04925 | LLM 失败模式六分类 | 启发我们按**成因**而非按**现象**分类 |
| arxiv 2506.06161（CD-VulDet） | UI→代码推理解耦 | 启发分层：视觉语义 vs 文本查询 |
| momocow/anti-honeypot 模板（210★） | 反探测模板 | 参考项，本轮未采纳（非当前痛点） |
| GamerNoTitle/ChaoJiBiJi_v3（1.1k★） | Express + REST API 架构 | 参考项：未来若要外接 LLM 服务 |

**结论**：外部资料确认「失败分类 + 可操作提示」是通用正确方向，不是我们拍脑袋。

---

## 二、★ 结论漂移核销表（本轮最重要的动作）

worker-A 提交 24 项审查发现。**未经核销不许入改进清单**（`review-protocol.md` 第五节铁律），Chair 逐条 grep 当前工作树：

| 编号 | 报告声称 | 实际核实 | 判定 |
|---|---|---|---|
| C01 | `handleAnswerDialog` 缺 wrapper 保护 | 符号不存在；`root()` 已于 09-19 改为「遍历全候选 + 题目特征分选最优」 | ❌ **已修复**（描述的是旧版本） |
| C02 | `initTiku` 四大 healer 缺失 | `initTiku` 全库 **0 命中** | ❌ **不存在** |
| C03 | 魔王系统 Phase 0 未执行 | 与事实相反（本轮阶段零已执行） | ❌ **不成立** |
| C04 | `quotaManager` dispatch 缺重试 | `quotaManager` **0 命中**（`09-bank.js` 全文件仅 184 行） | ❌ **不存在** |
| C05 | `processSchoolQuestion` hardcode | **0 命中** | ❌ **不存在** |
| **C06** | LLM 返回 HTML → JSON.parse 炸 | `10-llm.js:78` 与 `09-bank.js:144` 确认存在 | ✅ **真 Bug** |
| C07 | `_solver()` 未打 error stack | 部分成立，非本轮重点 | ⬜ 观察池 |
| C08 | `emitImplementationMissing` 未 log | **0 命中** | ❌ **不存在** |
| C13 | `isDevMode` 未 export | **0 命中** | ❌ **不存在** |
| C17 | 网络请求缺 timeout | 实际 `timeout` 参数已存在 | ❌ **已具备** |
| C18 | `_traded` 未 catch | **0 命中** | ❌ **不存在** |

**核销结果：24 项中 11 项核销，9 项判定为漂移/不存在，仅 C06 一条成立为可动手的真 Bug。**

> 若照单全收去改，会在**不存在的函数**上"修"半天，或把**早已修好**的代码再改坏。
> 这条教训已固化进 `references/review-protocol.md` 第五节「★ 结论漂移防线」——
> 写成**流程产出物**（无核销表不许开会），而非提醒，因为提醒依赖自觉。

---

## 三、改进清单（IMP）

```
ID       来源        严重度  模块        问题描述                              证据锚点
IMP-001  worker-A    P1     网络层      四种失败被压成 status=0，用户无法自查    src/09-bank.js:23
IMP-002  worker-A    P1     LLM        返回 HTML 时只抛"返回非 JSON"            src/10-llm.js:78
IMP-003  Chair       P1     题库        bankUrl 为空仍发请求，打到网课站点       src/09-bank.js:123
IMP-004  Chair       P2     面板        测试连接失败只显示"连接失败"             src/06-panel.js:943
IMP-005  Chair       P2     日志        题库失败是 debug 级，用户看不见          src/09-bank.js:145
```

---

## 四、阶段三：根因链与方案（5 Whys 到第⑤层）

```
① 为什么报「请求失败」？ → JSON.parse 抛异常，文案「LLM 返回非 JSON」
② 为什么？              → provider 返回的是 HTML（网关 502/代理页/站点首页）
③ 为什么？              → 错误处理只 try/catch，没识别响应体类型
④ 为什么？              → callOnce 缺「失败分类」抽象
⑤ 为什么？              → 网络层只回 {ok,status,text}，丢了失败成因 ← 真根因（设计缺口）
```

**占位符替换测试（区分真根因 vs 补丁）**：
- 补丁假设 `R = "把某个 baseUrl 改对"` → 换成 `<任意字符串>` 后修复失效 → **退回**。
- 真根因 `R = "网络层回报失败类型枚举，调用方据此生成建议"` → 对任意 provider 通吃 → **放行**。

**方案**：在网络层加 `FAIL` 枚举 + `diagnose()`，沿调用链透传到面板。
（IMP-001~005 全部 closed，详见 CHANGELOG 0.6.27 段。）

---

## 五、Oracle Gate · round-24 · IMP-001~005

> 不允许模型自判「修好了」。下表四行缺任一行不放行。

| 判据 | 证据（真实命令输出） | 通过 |
|---|---|---|
| a 目标命令 | `node test/run.js` → `通过 444 / 失败 0` | ✅ |
| b lint / 类型 | `node --check src/09-bank.js`、`src/10-llm.js` → 均 OK | ✅ |
| c 入口可达 | 由 `win.ZHS.Bank`（jsdom 真实加载 16 模块后）发起，非直接调底层 | ✅ |
| d 修复前失败 | `git stash push -- src/*.js` 后同用例 → `421 通过 / 23 失败` | ✅ |

### 判别性测试（discriminating-test，先红后绿）

| 场景 | Baseline（旧代码） | Candidate（新代码） |
|---|---|---|
| 502 HTML 页归类 | ✗ 得到 `""` | ✓ `HTTP_HTML` |
| 200 门户页归类 | ✗ 得到 `""` | ✓ `NON_JSON_HTML` |
| 超时 vs 断网 | ✗ 两者同为 `status=0` | ✓ 分别 `TIMEOUT` / `NETWORK` |
| 401 提示指向 Key | ✗ 无 hint | ✓ hint 含「API Key」 |
| 抛错带解决方案 | ✗ `返回非 JSON` | ✓ 含 HTML 说明 + hint |

**两轮执行反复**：首版 baseline 是 `TypeError` 崩溃退出，吞掉后一半用例、看不到「哪些失败、为什么失败」；
改为 stub 兜底让每条各自干净 FAIL，并把 stub 返回值刻意取 `undefined` / `'STUB'`（避免旧代码碰巧通过），
最终 24 条精简为 **23 条真正具备判别力**的用例。

---

## 六、观察池（未入清单，下轮复核）

| 项 | 说明 | 待复核 |
|---|---|---|
| C07 | `_solver()` catch 后未打 error stack | 下轮评估是否影响排障 |
| C09 | 重复 bus Styles | 需先确认符号是否真实存在（防漂移） |
| C10/C11 | 弹题关闭重试条件 | 需实测复现，无证据不入清单 |
| C15/C16 | Polling 频率 / 阻塞式 sleep | 性能项，非阻断 |
| C20 | 案件追踪 evidence 未 intake | 待确认含义 |

以上均**未获得证据支撑**，按证据制不进清单；下轮若拿到 `文件:行号` + 复现步骤再议。

---

## 七、本轮对魔王系统自身的贡献（meta）

1. **结论漂移防线**写入 `review-protocol.md` 第五节。
2. **判别性测试**首次完整走通（含「假绿剔除」这一反直觉细节）。
3. 修正 `review-protocol.md` 内部矛盾：v3.0 已称改证据制，正文却仍写投票门槛 → 已改。
4. v3.0 四件套（oracle-gate / root-cause / repeat-failure-breaker / discriminating-test）全部落地并实证。
