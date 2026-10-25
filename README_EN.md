# zhihuishu-helper · Smart Course Assistant for Zhihuishu/Zhida

[![License](https://img.shields.io/github/license/huanweide/zhihuishu-helper)](LICENSE)
[![CI](https://github.com/huanweide/zhihuishu-helper/actions/workflows/ci.yml/badge.svg)](https://github.com/huanweide/zhihuishu-helper/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/huanweide/zhihuishu-helper?label=version)](https://github.com/huanweide/zhihuishu-helper/releases)
[![Stars](https://img.shields.io/github/stars/huanweide/zhihuishu-helper)](https://github.com/huanweide/zhihuishu-helper/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/huanweide/zhihuishu-helper)](https://github.com/huanweide/zhihuishu-helper/commits/master)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

> A **Tampermonkey userscript** that automates the tedious parts of the Zhihuishu / Zhida (智慧树 / 知到) online-course platform — autoplay, breakpoint resume, and AI-assisted answering — while **never blindly guessing** when it can't be sure.

![zhihuishu-helper panel — real runtime screenshot](docs/screenshots/panel.png)

---

## Why this exists

Zhihuishu/Zhida make you watch every video and answer every quiz to finish a course. Doing it by hand is a huge time sink. This script handles the mechanical work **locally in your browser** (no backend, no account, no data leaves your machine).

The key principle that separates it from other "auto-answer" scripts:

> **No blind guessing.** When the script cannot confidently determine the correct answer (no bank match, no model channel available), it leaves the question blank and hands it back to you — instead of randomly clicking an option and risking a wrong submission.

## Features

- **Autoplay + breakpoint resume** — keeps videos playing and recovers exactly where you left off, even after an in-video quiz dialog.
- **Fully-automatic learning engine (on by default)** — `autoLearn` master switch defaults on: entering the course hub auto-picks unfinished lessons and resumes, and hops to the next course when one finishes. Jump to any lesson via `zhs.gotoLesson(n | title)`, or the panel's "jump to lesson / find next course" controls.
- **AI auto-answer** — resolves quiz questions via a local question bank and/or an LLM channel (SiliconFlow / DeepSeek / OpenAI / custom), with multi-vote cross-checking.
- **Higher answer accuracy** — reasoning-guided + few-shot prompts, low temperature (0.1) for MCQs; a **confidence gate** tags split votes as low and routes them to manual review instead of forcing an answer; an offline-heuristic cross-check promotes only mutually-confirmed answers.
- **No-blind-guess fallback (3 tiers)** — ① bank/LLM hit → use directly; ② no hit but offline heuristic on → linguistic inference (**not a guess**); ③ still nothing → a single toggle decides: **off (default) = leave blank for manual review**, on = random pick as a last-resort escape hatch.
- **Humanized playback** — randomized pauses / "away" simulation to avoid crude detection patterns.
- **Study records + habit-score stats** — per-day bank/LLM/skipped counts, persisted locally.
- **Zero backend** — pure JavaScript userscript, 20 modules, **706 logic tests**, MIT licensed.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or any userscript manager).
2. Open [`dist/zhihuishu-helper.user.js`](dist/zhihuishu-helper.user.js) — Tampermonkey will offer to install it.
3. The script auto-activates on `zhihuishu.com` / `zhihuishu.com.cn` / `zhida` course pages.

> Requires a question-bank source and/or an LLM API key to answer questions. Without them, the script still autoplays and resumes, and simply leaves questions for you to answer manually.

## How the answering flow works

```
quiz dialog appears
  → pause video
  → resolve answer (bank / LLM / heuristic)
  → submit
  → close dialog
  → auto-resume playback (click real play button → recheck → retry if needed)
```

No manual step is required in the happy path. When an answer can't be resolved, the fallback policy above decides the behavior — by default it never guesses.

## Configuration panel

Click the floating assistant button to open the settings panel:

- **Auto-answer** on/off
- **LLM channel** + API key (SiliconFlow / DeepSeek / OpenAI / custom)
- **Answer fallback** (off = no blind guess / on = random escape hatch)
- **Humanized playback** (random pauses, away simulation)
- **Auto-hop to next course** when one finishes
- **Speed / mute / study-record** controls

## Build & test

```bash
node build.js                 # bundle src/*.js → dist/zhihuishu-helper.user.js
node tools/check-dist-fresh.js # verify dist matches src (20 modules)
node test/run.js              # logic tests (706 pass, 0 fail)
```

All four gates also run in CI on every push — see the CI badge above.

## Docs

| Document | What's inside |
|---|---|
| [docs/PROJECT_MAP.md](docs/PROJECT_MAP.md) | Module map (20 modules) + gate commands |
| [docs/20-使用说明.md](docs/20-使用说明.md) | Full usage guide (Chinese) |
| [docs/30-自动学习引擎方案.md](docs/30-自动学习引擎方案.md) | Auto-learning engine design (Chinese) |
| [docs/40-开发者笔记.md](docs/40-开发者笔记.md) | Developer notes (Chinese): platform recon — selectors for 5 page variants, reference-project survey, architecture, milestones, capability benchmark |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Contributing

Issues and PRs are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) — it covers the module layout, the four gates, and the four red lines this project never crosses (no auto-jumping into exam pages, no `seek` on video, and so on).

## Disclaimer

This tool is for **automating your own study workflow**. Use it responsibly and in accordance with your institution's academic-integrity policies. The author is not affiliated with Zhihuishu / Zhida.

## License

[MIT](LICENSE) — free to use, modify, and redistribute.
