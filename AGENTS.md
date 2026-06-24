# AGENTS.md

## Project Overview

Tab Switcher is a Manifest V3 Chrome extension for fast, keyboard-first tab switching. The popup behaves like a quick-open palette: it ranks open and recently closed tabs, highlights fuzzy matches, and activates or restores the selected item.

## Commands

- Run tests with `npm test`.
- Load the extension manually from `chrome://extensions` using **Load unpacked** and this project folder.
- After changing extension files, reload the unpacked extension before manual browser QA.

## Code Structure

- `src/core/` contains pure modules and should stay free of Chrome extension globals so it remains easy to test with Node.
- `src/background.js` owns Chrome API integration, persisted MRU state, settings, commands, and message handling.
- `src/switcher.*` owns the popup experience.
- `src/options.*` owns persisted user preferences and shortcut visibility.
- `tests/` covers core logic with Node's built-in test runner.

## Implementation Notes

- Prefer small, focused changes that preserve the current no-build setup.
- Keep extension code as plain ES modules unless a build step becomes explicitly necessary.
- Avoid moving Chrome-specific logic into `src/core/`; add testable helpers there only when they do not depend on extension APIs.
- Keep user-facing shortcut text in sync with `manifest.json`.
- Use `chrome.storage.local` keys from `src/core/defaults.js` instead of hard-coded strings.

## Codex Usage Window Efficiency

- Use bounded reads: `sed -n '1,120p' file.js`, `head -n 60 logs.txt`, `tail -n 40 logs.txt`, `rg --max-count 40 "TODO" src`, and `ls -1 src | head -n 50`.
- Skip wide dumps: avoid raw `cat`, unconstrained `find`, and unconstrained `rg`; if you need a file list, do `rg --files | head -n 100`.
- Summarize telemetry first: in SQL, select only what you need, then add `WHERE`, `ORDER BY`, `LIMIT` (for example `SELECT ts, event, user_id FROM events WHERE ts >= NOW()-INTERVAL '1 day' ORDER BY ts DESC LIMIT 20;`).
- Use fast prechecks: start with `SELECT COUNT(*) FROM events WHERE level='error';` then run a narrow follow-up query only if needed (`SELECT ... LIMIT 25`).
- Get top patterns without full scans: run `SELECT pattern, COUNT(*) AS hits FROM traces GROUP BY pattern ORDER BY hits DESC LIMIT 10;` before reading raw trace rows.
- Avoid repeated broad scans: if you edit one command, reuse or narrow the previous command instead of re-running the same large query/file read.
- Combine related reads into one pass: `rg "error|warn|fail" src -n --max-count 80` gives both error patterns in one command.
- Keep outputs tiny: append `| head`, `--max-count`, `LIMIT`, and narrow ranges (for example `git log --oneline -n 30`), and use `--stat` instead of full patch output when enough.
- Don’t fetch raw logs unless required: prefer summaries like `rg "error" logs/*.json --max-count 25` and pull full logs only when debugging a specific case.
- Reduce token load per turn: ask for exact asks (top 10 spikes, top callers, top failed endpoints) and avoid requesting full transcripts.
- Keep context tight in your updates: provide concise one- or two-line results summaries instead of reprinting command history.

## Verification

Before handing off functional changes:

1. Run `npm test`.
2. For popup, options, or manifest changes, manually reload the unpacked extension and smoke-test the affected path in Chrome.
3. Check `git status --short` and avoid mixing unrelated changes into commits.
