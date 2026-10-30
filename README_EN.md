**中文** · [README.md](./README.md)

<p align="center">
  <img src="assets/banner.svg" alt="智慧树助手 zhihuishu-helper">
</p>

[![License](https://img.shields.io/github/license/huanweide/zhihuishu-helper)](LICENSE)
[![CI](https://github.com/huanweide/zhihuishu-helper/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/zhihuishu-helper/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/huanweide/zhihuishu-helper?label=version)](https://github.com/huanweide/zhihuishu-helper/releases)
[![Stars](https://img.shields.io/github/stars/huanweide/zhihuishu-helper)](https://github.com/huanweide/zhihuishu-helper/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/huanweide/zhihuishu-helper)](https://github.com/huanweide/zhihuishu-helper/commits/master)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

# Zhihuishu Helper (zhihuishu-helper)

> Other people's course-skipping scripts are "just make it run"; this project is "resumable when it breaks, and never guesses when it can't answer" — a Tampermonkey userscript for auto-play, crash-resumable playback, and evidence-first AI answering. 100% local, no account handoff to any third party.
>
> A Tampermonkey userscript for Zhihuishu (智慧树 / 知到): auto-play, crash-resumable playback, and evidence-first AI answering — 100% local, no account handoff.
>
> **Pipeline**: open the course page → script health-checks the catalog → muted speed-up anti-pause playback → on a popup question, solve via "question bank → LLM → heuristic" → fill back and verify → auto-advance to the next section → pop a summary card when all done
> `detect → play → answer → switch episode → wrap up`

**Who it's for**: college students tortured by Zhihuishu courses; people who want to leave a course playing yet keep accurate study records, but refuse to hand their account to a cloud automation script.

---

## Who Should Use It / Who Should NOT

**Good fit if —**

- You have to take Zhihuishu (智慧树 / 知到) courses and want auto-play, resume, and honest in-course question answering **without** handing your account to a cloud service.
- You want to leave a course playing in the background but keep accurate learning records.
- You're a developer who wants to plug in your own question bank / answer source.

**Not for you if —**

- You want to cheat on **proctored / formal exams**. The script deliberately does not touch exam pages unless you are already on them, and never auto-navigates to them (a hard project red line).
- You expect a "set-and-forget" that breaks platform rules. It enforces speed ≤ 1.8×, no window minimization, and no blind guessing — these are safety limits, not bugs.
- You're not on the Zhihuishu / 知到 platform; the adapter targets its page structures specifically.

---

## Purpose and Red Lines (read before installing)

**What the script does (✅)**

- **Assist everyday study**: answering aid for routine homework / chapter exercises / unit tests, plus auto-play, resume, and in-course popup handling.
- **Full auto-hosting (only when you're away)**: when you're not at the computer, it auto-resumes, picks the next unfinished course in the course center, and jumps to the next one — like idle hosting.
- **Humanized anti-detection**: yield control when you're present (no acting on your behalf while you're there), randomized thinking delay, jittered main loop — to lower the risk of being flagged as a bot.
- **Hands it to you when unsure**: when all three channels (bank / LLM / heuristic) fail, it leaves the answer blank for a human — never a blind guess.

**⛔ Don't use / red lines (violating may get you banned or your PR rejected)**

- **Don't use it for proctored exams.** The exam page is strictly "sit-and-wait": it only answers once you personally click in; it never auto-jumps and never answers a proctored paper for you.
- **Don't minimize the browser window** (shrinking is fine). Minimizing throttles timers to ~once per minute, freezing the main loop and voiding progress.
- **Don't set speed above 1.8×.** Exceeding it gets flagged as abnormal and progress won't be recorded.
- **Don't expect it to act on your behalf while you're present.** When you're there, it yields control, doesn't switch questions or answer — this is the core of anti-detection; control is always yours.
- **Don't manually edit `dist/` output, and don't expect it to bypass captchas.** Manual edits get blocked by checks and overwritten on update; captchas are always handed to a human.
- **Don't commercialize / distribute / hand your account or API key to any third party.** The script runs purely locally and never collects any credentials.

> For the full boundaries, known limitations, and development red lines, see [Security Boundary](#security-boundary). The four untouchable development red lines are in [CONTRIBUTING.md](CONTRIBUTING.md).

[30-Second Overview](#30-second-overview) · [Purpose and Red Lines](#purpose-and-red-lines) · [What It Does](#what-it-does) · [Features](#features) · [Quick Start](#quick-start) · [Console API](#console-api) · [Architecture](#architecture) · [Add a Solver Channel](#add-a-solver-channel) · [Roadmap](#roadmap) · [Open Collaboration](#open-collaboration) · [Security Boundary](#security-boundary) · [License](#license)

---

## 30-Second Overview

**Without this script** — what manually grinding one lesson looks like:

```text
$ You (opening this lesson for the 3rd time)
  → drag the progress bar back from 12:40 to find where you left off   # can't remember, trial and error
  → popup: "Which of the following is NOT…"                            # stuck, can't close, playback stalls
  → blindly tick a C and submit                                         # wrong, and you don't know
  → after one lesson, manually click the next                           # someone has to babysit
  → close the browser to sleep → where does tomorrow start?             # all from memory
```

**With this script** — the same lesson:

```text
$ Open the course page, click "Start" on the panel
=== Course health check ===
24 nodes total: 18 done / 5 unwatched / 1 locked (75% complete)
  next 1: Chapter 3 3.2 Cache strategy
  next 2: Chapter 3 3.3 Distributed lock
[Zhihuishu Helper] mute + 1.8× speed + anti-pause ready
[Zhihuishu Helper] resumed to last position 12:40 (cross-iframe persistence)   ← resume
[Zhihuishu Helper] popup: hit question bank (channel=bank) → filled back and verified   ← no guessing
[Zhihuishu Helper] section ended, auto-advanced to next
```

The one-line difference: **it doesn't just "click play" for you — it remembers and finishes the three things "where am I / what do I answer / who's next".**

---

## What It Does

`User:` click "Start" on the panel, then turn off the monitor and sleep.

```text
Round 1: health check  → scan the whole catalog, tag each node as done / unwatched / locked
Round 2: skip          → auto-skip finished ones, only study unwatched (locked ones are useless to click, skip)
Round 3: play          → mute + speed-up (cap 1.8×) + anti-pause + progress-rollback retry
Round 4: resume        → progress written to GM_setValue; closing the page / losing network / restarting browser all resume from the last spot
Round 5: answer        → popup/homework/chapter test: question bank first → LLM fallback → offline heuristic fallback
Round 6: fill back     → fill into the page control then read it back to verify; retry if not actually filled
Round 7: wrap up       → when all watched, pop a summary card and auto-stop (only writes "all done" when truly done)
```

> ⚠️ **What it does NOT do**: it won't proactively jump to homework / exam pages (only answers when you click in yourself), won't drag the player progress, and won't blindly tick answers when unsure. See [Security Boundary](#security-boundary).

---

## Features

- **🔁 Resume Engine** — progress written to `GM_setValue` (shared across iframes / pages, persisted to disk); auto-degrades to `localStorage` without GM. Closing the page, the browser, or a network drop all resume from the last position. `src/04-resume.js`
- **🎯 No-Guess Gate** — an answer must come from one of three real channels: "bank hit / LLM generated / offline heuristic". If none can produce one, it leaves it blank for a human. All "random guess" paths are governed by `gatedRandom` and **off by default**. `src/11-solver.js`
- **🧭 Five Version Adapters** — Zhihuishu's 5 coexisting page structures (wisdom / fusion / hike / legacy / card2025) unified into one method set; if a redesign makes all preset selectors fail, it auto-enables a **structural fallback scan** (infers the catalog from DOM structure, not class names). `src/02-adapter.js`
- **🐕 Stall Watchdog** — single-point triggers have blind spots: "overall no progress but no single trigger fired" is still caught and recovered — the last line of defense. `src/02d-guard.js`
- **⚡ Dual-Channel Solver** — question bank (`TikuAdapter` standard protocol) first, LLM (OpenAI-compatible, DeepSeek by default, generous 45s/70s timeouts) fallback, plus an **offline heuristic** third layer with zero network and zero key. `src/09-bank.js` `src/10-llm.js` `src/11b-heuristic.js`
- **🛡️ Passive Exam Mode** — answers only when you are **already on** the homework / exam page; never navigates there proactively. A hard project red line. `src/06c-exam.js`
- **📊 Honest Stats** — the panel answers two questions you'd actually ask: "how many did I answer today and where did the answers come from" and "how long did I study"; channel sources are traceable line by line (bank / LLM / cache / fail). `src/14-stats.js`
- **🧩 Shadow DOM Panel** — the floating panel uses Shadow DOM to isolate styles: it doesn't pollute the course page, nor gets broken by the page's CSS. `src/06-panel.js`

---

## Quick Start

### Install

> First install [Tampermonkey](https://www.tampermonkey.net/) (Chrome / Edge / Firefox all work), then pick one of the three routes below.

**Route A: one-click install (recommended · no Node needed)**

Open the [jsDelivr one-click install link](https://cdn.jsdelivr.net/gh/huanweide/zhihuishu-helper@master/dist/zhihuishu-helper.user.js) → Tampermonkey auto-pops an install confirmation → click "Install" and done.

**Route B: download a stable build (no Node needed)**

Go to [Releases](https://github.com/huanweide/zhihuishu-helper/releases), download the `zhihuishu-helper.user.js` attachment, and drag the file into the browser to install.

**Route C: build from source (only if you want to change code)**

```bash
git clone https://github.com/huanweide/zhihuishu-helper.git
cd zhihuishu-helper
npm install
node build.js          # generate dist/zhihuishu-helper.user.js
```

Then open `dist/zhihuishu-helper.user.js` with Tampermonkey to install. Full illustrated guide: [Usage Guide](docs/20-使用说明.md).

### Build and run once

```bash
node build.js
```

```text
=== Building zhihuishu-helper v0.6.67 ===
  + 00-config.js
  + 01-util.js
  ...
  + 14-stats.js
[ok] generated dist/zhihuishu-helper.user.js (21 modules)
```

### Self-check (mandatory gates after changing code)

```bash
node build.js                      # ① build: src/*.js concatenated in order → dist/*.user.js
node tools/check-dist-fresh.js     # ② verify dist matches src (forgotten build gets blocked)
node tools/check-test-registry.js  # ③ test-group registration check (un-awaited async group = fake green)
node test/run.js                   # ④ logic unit tests (jsdom + vm module injection)
node tools/check-docs-consistency.js --tests 735  # ⑤ doc consistency (version/test-count drift)
node test/screenshot.js            # ⑥ screenshot tests (needs real Chrome, run locally)
```

```bash
$ node tools/check-dist-fresh.js
[ok] dist matches src (21 modules, v0.6.67)

$ node test/run.js
==================================================
Passed 735 / Failed 0
All passed ✓
```

> Step ⑥ depends on a real browser, so it's **not run in CI**; its role is "real-device visual verification", not a gate. CI runs ①–⑤:
> Step ③ statically catches "async test groups that weren't awaited" (missing await = uncounted assertions + failures that don't turn red = fake green; it has caught 7 in practice);
> Step ⑤ validates the README numbers against the actual pass count from step ④, preventing "version bumped but docs still show the old version" drift (happened twice before).
> This is also the real basis for the CI badge.

---

## Console API

Press `F12` to open the console:

| Command | Purpose |
|------|------|
| `zhs.start()` | start the main loop |
| `zhs.stop()` | stop all automation actions |
| `zhs.next()` | manually jump to the next unfinished section |
| `zhs.learn()` | manually trigger "find the next unfinished course" |
| `zhs.gotoLesson(3)` | jump directly to the 3rd lesson |
| `zhs.stats()` | course completion stats |
| `zhs.logs()` | all logs (array) |
| `zhs.clearResume()` | clear this course's resume record |
| `zhs.config({ speed: 1.5 })` | change config (speed cap 1.8) |
| `window.ZHS.Resume.list()` | view all resume records |
| `window.ZHS.Solver.stats` | answer stats: how many bank hits, how many LLM |
| `window.ZHS.Bank.ping()` | test question-bank channel connectivity |
| `window.ZHS.LLM.test()` | test LLM channel connectivity |

---

## Architecture

The default engine is a **"detect → play → answer → switch episode" 2-second main loop + layered fallback**, not a one-shot single-file script: 21 modules assembled by chain, each layer does one thing and each has a degradation path.

### Core concepts

| Concept | Meaning |
|------|------|
| Page version | One of Zhihuishu's 5 coexisting page structures; the adapter unifies them into one method set, upper layers unaware |
| Resume point | A lesson's playback position, stored in `GM_setValue`, persisted across iframes / to disk |
| Channel | Answer source: question bank / LLM / offline heuristic / cache. There is no fifth. |
| Gate | Verified once before and once after filling back; "not actually filled" doesn't count as answered |
| Watchdog | Catches the blind spot of "overall no progress but no single trigger fired" |
| Passive | Answers only when the user is already on the homework / exam page; never navigates there proactively |

### Main loop

```text
           ┌──────────────── every 2s ────────────────┐
           ▼                                            │
      [ Guard check ] ── security verification (slider captcha)? ──▶ pause + prompt manual completion
           │
           ▼
      [ Keep-alive playback ] ── paused? ──▶ auto-resume + mute + speed-up
           │
           ▼
      [ Popup detection ] ── popup? ──▶ collect → solve → fill → verify
           │                          │
           │                          └─ all 3 channels fail? ──▶ leave blank for human (no guess)
           ▼
      [ End judgment ] ── this section done? ──▶ mark done → next section
           │
           ▼
      [ All done? ] ── yes ──▶ pop summary card + auto-stop
           │
           └──── no ────────────────────────────────────┘
```

### Core modules

| Module | File | Responsibility |
|------|------|------|
| Config & shared state | `src/00-config.js` | single `ZHS` namespace, doesn't pollute page globals |
| Utility | `src/01-util.js` | DOM wait, visibility detection, throttle, random delay |
| Adapter layer | `src/02-adapter.js` | recognize 5 page versions, unify catalog access interface |
| Watchdog | `src/02d-guard.js` | global anti-stall fallback |
| Navigation | `src/02e-nav.js` | switch / skip navigation |
| Playback layer | `src/03-player.js` | mute, speed-up, anti-pause, progress-rollback retry |
| Resume layer | `src/04-resume.js` | resume point record & recovery (`GM_setValue` → `localStorage` degrade) |
| Scheduler | `src/05-scheduler.js` | 2-second main loop + popup guard |
| Panel | `src/06-panel.js` | Shadow DOM isolated floating control panel |
| Course-center scheduler | `src/06b-course-hub.js` | auto-pick unwatched course, jump to next when done |
| Homework / exam | `src/06c-exam.js` | passive (sit-and-wait) answering |
| Main entry | `src/07-main.js` | init + SPA route listening |
| Question collector | `src/08-questions.js` | structured questions from 3 scenarios (in-course popup / shared-course homework / hike homework) |
| Bank client | `src/09-bank.js` | `TikuAdapter` standard protocol client |
| LLM client | `src/10-llm.js` | OpenAI-compatible interface + multi-generation voting |
| Solver layer | `src/11-solver.js` | dual-channel orchestration: bank first → LLM fallback |
| Offline heuristic | `src/11b-heuristic.js` | third-layer fallback with zero network / zero key / zero bank |
| Fill-back layer | `src/12-filler.js` | fill into control and read back to verify |
| Answer orchestration | `src/13-answerer.js` | collect → solve → fill assembled into a complete flow |
| Stats layer | `src/14-stats.js` | answer records + study-time stats |
| Presence sensing | `src/15-presence.js` | user-presence detection and yield base (activity / focus-state listening) |

For detailed platform recon, selector test tables, and reference-project research, see the [Developer Notes](docs/40-开发者笔记.md); module map: [PROJECT_MAP](docs/PROJECT_MAP.md).

---

## Add a Solver Channel

The solver layer is a "channel list + try in order" structure; adding a channel doesn't touch playback or scheduling:

```js
// Insert your own channel into the channel chain in src/11-solver.js
ZHS.Solver.channels.push({
  name: 'my-bank',                       // name shown in panel stats
  async solve(q) {                       // q = { question, options[], type }
    const r = await fetch('https://my-bank.example/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q.question, options: q.options, type: q.type })
    });
    const d = await r.json();
    // return null when you can't get it — let the chain continue, never leave a random guess
    return d.answer ? { answer: d.answer, source: 'my-bank' } : null;
  }
});
```

> Iron rule: your channel **must return `null` when it can't answer**, never a random option. This is the foundation of the "no blind guessing" gate.

---

## Roadmap

- [x] Auto-play (mute + speed-up + anti-pause + auto next section/chapter)
- [x] Resume (cross-iframe / cross-page / offline recovery)
- [x] Dual-channel answering (bank + LLM) + offline heuristic third layer
- [x] Full auto-learning engine (enter course center, auto-pick course, auto-jump to next when done)
- [x] Humanization & anti-detection (yield when present: no acting while you're there; human-like pacing: random thinking delay + jittered main loop; anti-brute-force retry: popup that won't close → hand to human)
- [x] 735 logic unit tests + 70 screenshot tests
- [x] Five page-version adapters + structural fallback scan
- [ ] More platform question-bank protocol adapters (currently only the `TikuAdapter` standard protocol)
- [ ] Panel multi-theme / custom colors
- [ ] Batch export and review of chapter tests
- [ ] Real-device E2E in CI (currently depends on real Chrome, local-only)

---

## Open Collaboration

**This project welcomes all constructive help and takes every contribution seriously.** Whether you're reporting a bug, requesting a feature, changing code, or improving docs, open an issue to talk first — easier to accept than dropping a big PR.

**We especially need these kinds of help 🤝**

- 🐛 **Bug reports (with logs)** — include script version, page-version code (wisdom / fusion / hike / legacy / card2025), and the panel's "Logs" page content; a [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) is ready.
- 💡 **New feature / improvement suggestions** — start from daily pain points, open an issue tagged `enhancement`; a [feature request template](.github/ISSUE_TEMPLATE/feature_request.md) is ready.
- 🧩 **Adapt new page versions** — when Zhihuishu redesigns, preset selectors may fail; help add adapters or structural fallback.
- 🔌 **New solver channels** — connect your own question bank / campus answer source (see [Add a Channel](#add-a-solver-channel)); remember the iron rule: return `null` when you can't solve, never guess.
- 📝 **Docs / translation** — make the usage guide and pitfall notes clearer, or help with English docs.
- ✅ **Test cases** — add more discrimination tests to `test/run.js`, guarding red lines like "never seek / never guess / yield control".

Read [CONTRIBUTING.md](CONTRIBUTING.md) before starting — it covers module structure, the four gate commands, and the **four untouchable red lines** (especially "never auto-jump to exam pages" and "never blindly guess answers for the user"). Participating means you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Security Boundary

This project will **never** do the following:

1. **Never auto-navigate to homework / exam pages** — only sit-and-wait: it answers when you're on the homework/exam page, never navigates there proactively.
2. **Never seek (drag) the player progress** — if progress runs ahead, it only warns, never rewinds or fast-forwards.
3. **Never blindly guess answers for the user** — all "random guess when no answer" paths are governed by `gatedRandom` and off by default; it would rather leave it blank for a human.
4. **Never write credentials into the repo** — API keys only go through the user's local config; no key / token / cookie may enter code or docs.

Additionally: for personal study and research only, commercial use and distribution prohibited; use at your own risk. Users should comply with Zhihuishu's terms of service and their school's regulations.

---

## Known Limitations

- **The browser can shrink, but don't minimize it** — invisible tabs get timers throttled to once per minute, freezing the main loop.
- **Speed cap 1.8×** — exceeding it gets flagged as abnormal by the platform.
- **Screenshot tests (70 cases) depend on real Chrome**, run locally only, not in CI.
- After a Zhihuishu redesign, preset selectors may fail; then it relies on the structural fallback scan, whose precision may be lower than dedicated adaptation.

---

## Documentation

| Document | Content |
|------|------|
| [Install & Usage Guide](docs/20-使用说明.md) | 3-step install, config, FAQ |
| [Auto-Learning Engine Plan](docs/30-自动学习引擎方案.md) | full auto-learning chain design and red-line boundaries |
| [Platform Recon Report](docs/01-侦察报告.md) | page structure, selectors, tested conclusions |
| [Tech Plan](docs/02-技术方案.md) | module architecture, three main-line designs |
| [Pitfall Log](docs/03-踩坑记录.md) | real-device issues and troubleshooting order |
| [GitHub Ecosystem Survey](docs/06-GitHub生态全景调研.md) | horizontal comparison with similar projects |
| [Developer Notes](docs/40-开发者笔记.md) | platform recon + reference research + capability benchmark |
| [Module Map](docs/PROJECT_MAP.md) | 21 modules arranged by chain + four gate commands |
| [Changelog](CHANGELOG.md) | what changed and why each version |

---

## License

[MIT](LICENSE) © huanweide

---

## Star

If this script helped you finish your courses, a Star is the biggest support — it decides how many other course-tortured people can find this project.

[![Star](https://img.shields.io/github/stars/huanweide/zhihuishu-helper?style=social)](https://github.com/huanweide/zhihuishu-helper)

---

## Other Tools by the Same Author

- 🎬 Subtitles / video: [bili-subtitle-universal](https://github.com/huanweide/bili-subtitle-universal) · [live-subtitle](https://github.com/huanweide/live-subtitle) · [video-brief](https://github.com/huanweide/video-brief)
- 🩺 Code-health suite (18-axis zero-dependency CLI): [family-showcase](https://github.com/huanweide/family-showcase)
- ✍️ Novel writing: [novel-smith](https://github.com/huanweide/novel-smith) · AI novel workshop (local-first, zero cloud dependency)
- 🔧 Command-line utilities: [idiot-index](https://github.com/huanweide/idiot-index) · [recall-cli](https://github.com/huanweide/recall-cli) · [forge-safeguard](https://github.com/huanweide/forge-safeguard-20260812)
- 🖥️ Desktop / news: [floatsnip](https://github.com/huanweide/floatsnip) · [tech-news-hub](https://github.com/huanweide/tech-news-hub)
- 📦 All repositories: <https://github.com/huanweide?tab=repositories>
