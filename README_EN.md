<p align="center">
  <img src="assets/banner.svg" alt="zhihuishu-helper">
</p>

# 🎬 zhihuishu-helper · Smart Course Assistant for Zhihuishu/Zhida

[![License](https://img.shields.io/github/license/huanweide/zhihuishu-helper)](LICENSE)
[![CI](https://github.com/huanweide/zhihuishu-helper/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/zhihuishu-helper/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/huanweide/zhihuishu-helper?label=version)](https://github.com/huanweide/zhihuishu-helper/releases)
[![Stars](https://img.shields.io/github/stars/huanweide/zhihuishu-helper)](https://github.com/huanweide/zhihuishu-helper/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/huanweide/zhihuishu-helper)](https://github.com/huanweide/zhihuishu-helper/commits/master)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

> **Other auto-play scripts settle for "it runs". This one settles for "it resumes, and it never guesses."** — A Tampermonkey userscript that automates the tedious parts of the Zhihuishu / Zhida (智慧树 / 知到) online-course platform: autoplay, breakpoint resume, and AI-assisted answering — all **locally in your browser**, no backend, no account handoff.
>
> **Auto-flow**: open course page → scan the syllabus → mute + speed + anti-pause playback → on quiz: resolve via `bank → LLM → heuristic` → fill and verify → auto-advance → summary card when done
> `detect → play → answer → advance → finish`

[30-Second Demo](#-30-second-demo) · [What It Does](#-what-it-does) · [Features](#-features) · [Quick Start](#-quick-start) · [Console API](#-console-api) · [Architecture](#-architecture) · [Add a Channel](#-add-your-own-solving-channel) · [Roadmap](#-roadmap) · [Security Boundary](#-security-boundary) · [License](#-license)

---

## 🎬 30-Second Demo

**Without the script:**

```
$ you (third time opening this lesson)
  → drag the progress bar around hunting for where you stopped      # no memory of position
  → quiz dialog: "Which of the following is NOT…"                   # blocks playback entirely
  → click C at random and submit                                    # wrong, and you'll never know
  → manually click "next lesson"                                    # you have to babysit it
  → close the browser → where does tomorrow start?                  # pure guesswork
```

**With the script:**

```
$ open the course page, click "Start" in the panel
=== Course Checkup ===
24 nodes total: 18 done / 5 unfinished / 1 locked (75% complete)
  pending 1: Chapter 3 · 3.2 Caching Strategies
  pending 2: Chapter 3 · 3.3 Distributed Locks
[zhs] mute + speed 1.8 + anti-pause ready
[zhs] resumed at 12:40 from last session (cross-iframe persistence)   ← breakpoint resume
[zhs] quiz: bank hit (channel=bank) → filled and verified             ← no blind guessing
[zhs] lesson finished, advancing to next
```

One-sentence difference: **it doesn't just press play — it remembers and handles "where you stopped", "what the answer is", and "what comes next."**

---

## 🎬 What It Does

`User:` click "Start" in the panel, then turn off the monitor and go to sleep.

```
Round 1: Checkup  → full syllabus scan; tag each node done / unfinished / locked
Round 2: Skip     → skip finished nodes; locked ones are skipped too (clicking them does nothing)
Round 3: Play     → mute + speed (cap 1.8) + anti-pause + progress-regression retry
Round 4: Resume   → position persisted via GM_setValue; survives tab/browser/network restarts
Round 5: Answer   → quizzes / homework / chapter tests: bank → LLM → offline heuristic
Round 6: Fill     → write into the DOM control, then read it back to verify; retry if not applied
Round 7: Finish   → summary card when everything is done, then auto-stop
```

> ⚠️ **What it will NOT do**: never navigates to homework/exam pages on its own (it only answers when *you* opened that page), never `seek`s the player, never picks an option at random when unsure. See [Security Boundary](#-security-boundary).

---

## 🎬 Features

- **🔁 Resume Engine** — playback position stored in `GM_setValue` (shared across iframes/pages, persisted to disk), degrading to `localStorage` when no GM environment exists. Close the tab, the browser, or the network — it picks up where you left off. `src/04-resume.js`
- **🎯 No-Guess Gate** — an answer must come from one of three real channels (bank hit / LLM / offline heuristic). If all three fail, the question is left blank for you. Every "random pick" path is gated by `gatedRandom` and **off by default**. `src/11-solver.js`
- **🧭 Multi-Version Adapter** — Zhihuishu runs 5 coexisting page structures (wisdom / fusion / hike / legacy / card2025); the adapter unifies them behind one API. If a redesign invalidates every preset selector, a **structural fallback scan** kicks in (no class-name guessing — it infers the syllabus from DOM structure). `src/02-adapter.js`
- **🐕 Stall Watchdog** — single-point triggers have blind spots; this catches the case where *nothing* is progressing yet *no* trigger fired, and recovers. Last line of defense. `src/02d-guard.js`
- **⚡ Dual-Channel Solver** — question bank (`TikuAdapter` protocol) first, LLM (OpenAI-compatible: SiliconFlow / DeepSeek / OpenAI / custom, generous 45s/70s timeouts) as fallback, plus an **offline heuristic** third tier for zero-network, zero-key situations. Multi-vote cross-checking with a confidence gate. `src/09-bank.js` `src/10-llm.js` `src/11b-heuristic.js`
- **🛡️ Passive Exam Mode** — answers only when you are *already* on a homework/exam page; it never navigates there. A project red line. `src/06c-exam.js`
- **📊 Honest Stats** — the panel answers the two questions you actually ask: "how many questions today, and where did the answers come from?" and "how long did I study?" — per-channel breakdown (bank / LLM / cache / failed). `src/14-stats.js`
- **🧩 Shadow-DOM Panel** — the floating panel is style-isolated via Shadow DOM: it doesn't pollute the course page, and the page CSS can't break it. `src/06-panel.js`
- **🎭 Humanized Playback** — randomized pauses and "away" simulation instead of crude, obvious automation patterns.

---

## 🎬 Quick Start

### Install

> Install [Tampermonkey](https://www.tampermonkey.net/) first, then pick any route below.

**Route A — one-click (recommended · no Node needed)**

Open the [jsDelivr install link](https://cdn.jsdelivr.net/gh/huanweide/zhihuishu-helper@master/dist/zhihuishu-helper.user.js) → Tampermonkey prompts to install → click **Install**.

**Route B — download a stable build (no Node needed)**

Grab `zhihuishu-helper.user.js` from [Releases](https://github.com/huanweide/zhihuishu-helper/releases) and drag it into your browser.

**Route C — build from source (only if you modify code)**

```bash
git clone https://github.com/huanweide/zhihuishu-helper.git
cd zhihuishu-helper
npm install
node build.js          # produces dist/zhihuishu-helper.user.js
```

Then open `dist/zhihuishu-helper.user.js` with Tampermonkey to install.

The script auto-activates on `zhihuishu.com` / `zhihuishu.com.cn` / `zhida` course pages.

> Requires a question-bank source and/or an LLM API key to answer questions. Without them it still autoplays and resumes — it just leaves questions for you.

### Build

```bash
node build.js
```

```
=== building zhihuishu-helper v0.6.66 ===
  + 00-config.js
  + 01-util.js
  ...
  + 14-stats.js
[ok] wrote dist/zhihuishu-helper.user.js (20 modules)
```

### Self-check (the four gates — run after any code change)

```bash
node build.js                    # ① bundle src/*.js in order → dist/*.user.js
node tools/check-dist-fresh.js   # ② verify dist matches src (catches a forgotten build)
node test/run.js                 # ③ logic tests (jsdom + vm module injection)
node test/screenshot.js          # ④ screenshot tests (needs real Chrome — local only)
```

```bash
$ node tools/check-dist-fresh.js
[ok] dist matches src (20 modules, v0.6.66)

$ node test/run.js
==================================================
passed 721 / failed 0
all passed ✓
```

> Gate ④ needs a real browser, so it is **not run in CI** — its role is real-device visual verification, not gating. CI runs ①②③; that is exactly what the CI badge above certifies.

---

## 🎬 Console API

Open the console with `F12`:

| Command | Purpose |
|---|---|
| `zhs.start()` | start the main loop |
| `zhs.stop()` | stop all automation |
| `zhs.next()` | jump to the next unfinished section |
| `zhs.stats()` | course completion stats |
| `zhs.logs()` | full log array |
| `zhs.clearResume()` | clear resume record for this course |
| `zhs.config({ speed: 1.5 })` | change config (speed cap 1.8) |
| `window.ZHS.Resume.list()` | list all resume records |
| `window.ZHS.Solver.stats` | answer stats: bank vs LLM hits |
| `window.ZHS.Bank.ping()` | test bank channel connectivity |
| `window.ZHS.LLM.test()` | test LLM channel connectivity |

---

## 🎬 Architecture

The default engine is a **2-second main loop over `detect → play → answer → advance` with layered fallbacks** — not a monolithic script. 20 modules are concatenated along the pipeline; each layer does one job and each has a degradation path.

### Core concepts

| Concept | Meaning |
|---|---|
| version | one of the 5 coexisting Zhihuishu page structures; unified by the adapter so upper layers don't care |
| resume point | playback position of a lesson, stored in `GM_setValue`, cross-iframe and persisted |
| channel | answer source: bank / LLM / offline heuristic / cache. There is no fifth |
| gate | verification before and after filling — "not actually filled" doesn't count as answered |
| watchdog | catches the blind spot where nothing progresses yet no single trigger fires |
| passive | answers only when the user is already on a homework/exam page; never navigates there |

### Main loop

```
         ┌──────────────── every 2s ────────────────┐
         ▼                                          │
    [ guard check ] ── captcha (Yidun slider)? ──▶ pause + prompt for manual solve
         │
         ▼
    [ keepalive ] ── paused? ──▶ resume + mute + speed
         │
         ▼
    [ quiz detect ] ── quiz? ──▶ collect → solve → fill → verify
         │                          │
         │                          └─ no channel resolved? ──▶ leave blank, hand to human
         ▼
    [ end check ] ── lesson done? ──▶ mark done → advance
         │
         ▼
    [ all done? ] ── yes ──▶ summary card + auto-stop
         │
         └──── no ──────────────────────────────────┘
```

### Core modules

| Module | File | Responsibility |
|---|---|---|
| Config & shared state | `src/00-config.js` | single `ZHS` namespace, no global pollution |
| Utilities | `src/01-util.js` | DOM waiting, visibility checks, throttle, random delays |
| Adapter | `src/02-adapter.js` | detect the 5 page versions, unify syllabus access |
| Watchdog | `src/02d-guard.js` | global anti-stall fallback |
| Navigation | `src/02e-nav.js` | lesson switching / course hopping |
| Player | `src/03-player.js` | mute, speed, anti-pause, progress-regression retry |
| Resume | `src/04-resume.js` | breakpoint record & restore (`GM_setValue` → `localStorage`) |
| Scheduler | `src/05-scheduler.js` | 2s main loop + dialog guard |
| Panel | `src/06-panel.js` | Shadow-DOM-isolated floating control panel |
| Course hub | `src/06b-course-hub.js` | auto-pick unfinished courses, auto-hop when done |
| Homework/exam | `src/06c-exam.js` | passive-mode answering |
| Entry point | `src/07-main.js` | init + SPA route watching |
| Question collection | `src/08-questions.js` | structured extraction from 3 scenarios (in-video quiz / shared-course homework / hike homework) |
| Bank client | `src/09-bank.js` | `TikuAdapter` protocol client |
| LLM client | `src/10-llm.js` | OpenAI-compatible interface + multi-generation voting |
| Solver | `src/11-solver.js` | channel orchestration: bank first → LLM fallback |
| Offline heuristic | `src/11b-heuristic.js` | third-tier fallback with zero network / zero key / zero bank |
| Filler | `src/12-filler.js` | write into controls and read back to verify |
| Answer orchestration | `src/13-answerer.js` | collect → solve → fill as one flow |
| Stats | `src/14-stats.js` | answer records + study-time stats |

---

## 🎬 Add Your Own Solving Channel

The solver is a channel list tried in order — adding one never touches playback or scheduling:

```js
// push your own channel into src/11-solver.js
ZHS.Solver.channels.push({
  name: 'my-bank',                       // shown in the panel stats
  async solve(q) {                       // q = { question, options[], type }
    const r = await fetch('https://my-bank.example/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q.question, options: q.options, type: q.type })
    });
    const d = await r.json();
    // return null when unsure — let the chain continue, never guess
    return d.answer ? { answer: d.answer, source: 'my-bank' } : null;
  }
});
```

> Hard rule: your channel **must return `null`** when it cannot resolve an answer — never a random option. That is the foundation of the No-Guess Gate.

---

## 🎬 Roadmap

- [x] Autoplay (mute + speed + anti-pause + auto-advance)
- [x] Breakpoint resume (cross-iframe / cross-page / survives network loss)
- [x] Dual-channel answering (bank + LLM) + offline heuristic third tier
- [x] Fully-automatic learning engine (auto-pick courses, auto-hop when one finishes)
- [x] 721 logic tests + 70 screenshot tests
- [x] 5 page-version adapters + structural fallback scan
- [ ] More question-bank protocols (currently only the `TikuAdapter` standard protocol)
- [ ] Panel themes / custom color schemes
- [ ] Batch export and review of chapter tests
- [ ] Real-device E2E in CI (currently needs local Chrome)

---

## 🎬 Security Boundary

This project will **never** do the following:

1. **Never navigate to homework/exam pages automatically** — passive only: it answers when *you* are on that page, never routes there itself.
2. **Never `seek` the player** — if progress jumps ahead it only warns; it does not rewind or fast-forward.
3. **Never guess answers for you** — every "random pick when unresolved" path is gated by `gatedRandom` and off by default; leaving it blank for a human is preferred.
4. **Never commit credentials** — API keys live only in your local config; no key / token / cookie may enter code or docs.

Also: personal study and research only; commercial use and redistribution are prohibited. Use at your own risk, and comply with the Zhihuishu terms of service and your institution's rules.

### Known limitations

- **You may shrink the browser window, but don't minimize it** — browsers throttle timers in invisible tabs to once per minute, which freezes the main loop.
- **Speed cap is 1.8** — going beyond is flagged as anomalous by the platform.
- **Screenshot tests (70) require real Chrome** and run manually, not in CI.
- After a Zhihuishu redesign, preset selectors may fail; the structural fallback scan keeps it running, though possibly with lower precision.

---

## 🎬 Docs

| Document | What's inside |
|---|---|
| [docs/20-使用说明.md](docs/20-使用说明.md) | Full usage guide (Chinese) |
| [docs/30-自动学习引擎方案.md](docs/30-自动学习引擎方案.md) | Auto-learning engine design (Chinese) |
| [docs/01-侦察报告.md](docs/01-侦察报告.md) | Page structures, selectors, field findings |
| [docs/02-技术方案.md](docs/02-技术方案.md) | Module architecture, three main lines |
| [docs/03-踩坑记录.md](docs/03-踩坑记录.md) | Real-device issues and triage order |
| [docs/40-开发者笔记.md](docs/40-开发者笔记.md) | Developer notes: recon, reference survey, capability benchmark |
| [docs/PROJECT_MAP.md](docs/PROJECT_MAP.md) | Module map (20 modules) + gate commands |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## 🎬 Contributing

Issues and PRs are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) — it covers the module layout, the four gates, and the four red lines this project never crosses.

When filing a bug, include the script version, the page-version code (wisdom / fusion / hike / legacy / card2025), and the panel's log tab contents.

## 🎬 Disclaimer

This tool is for **automating your own study workflow**. Use it responsibly and in accordance with your institution's academic-integrity policies. The author is not affiliated with Zhihuishu / Zhida.

## 🎬 License

[MIT](LICENSE) — free to use, modify, and redistribute.

---

## ⭐ Star

If this script got your courses done, a Star is the biggest help — it decides how many other people stuck with the same grind can find it.

[![Star](https://img.shields.io/github/stars/huanweide/zhihuishu-helper?style=social)](https://github.com/huanweide/zhihuishu-helper)
