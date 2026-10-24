# zhihuishu-helper · Smart Course Assistant for Zhihuishu/Zhida

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Current Version](https://img.shields.io/badge/version-v0.6.63-green.svg)](CHANGELOG.md) [![Stars](https://img.shields.io/github/stars/huanweide/zhihuishu-helper?style=social)](https://github.com/huanweide/zhihuishu-helper/stargazers)

> A **Tampermonkey userscript** that automates the tedious parts of the Zhihuishu / Zhida (智慧树 / 知到) online-course platform — autoplay, breakpoint resume, and AI-assisted answering — while **never blindly guessing** when it can't be sure.

---

## Why this exists

Zhihuishu/Zhida make you watch every video and answer every quiz to finish a course. Doing it by hand is a huge time sink. This script handles the mechanical work **locally in your browser** (no backend, no account, no data leaves your machine).

The key principle that separates it from other "auto-answer" scripts:

> **No blind guessing.** When the script cannot confidently determine the correct answer (no bank match, no model channel available), it leaves the question blank and hands it back to you — instead of randomly clicking an option and risking a wrong submission.

## Features

- **Autoplay + breakpoint resume** — keeps videos playing and recovers exactly where you left off, even after an in-video quiz dialog.
- **AI auto-answer** — resolves quiz questions via a local question bank and/or an LLM channel (SiliconFlow / DeepSeek / OpenAI / custom), with multi-vote cross-checking.
- **No-blind-guess fallback (3 tiers)** — ① bank/LLM hit → use directly; ② no hit but offline heuristic on → linguistic inference (**not a guess**); ③ still nothing → a single toggle decides: **off (default) = leave blank for manual review**, on = random pick as a last-resort escape hatch.
- **Humanized playback** — randomized pauses / "away" simulation to avoid crude detection patterns.
- **Study records + habit-score stats** — per-day bank/LLM/skipped counts, persisted locally.
- **Zero backend** — pure JavaScript userscript, ~20 modules, **677 logic tests**, MIT licensed.

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
node test/run.js              # logic tests (677 pass, 0 fail)
```

## Disclaimer

This tool is for **automating your own study workflow**. Use it responsibly and in accordance with your institution's academic-integrity policies. The author is not affiliated with Zhihuishu / Zhida.

## License

[MIT](LICENSE) — free to use, modify, and redistribute.
