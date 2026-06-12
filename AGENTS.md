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

## Verification

Before handing off functional changes:

1. Run `npm test`.
2. For popup, options, or manifest changes, manually reload the unpacked extension and smoke-test the affected path in Chrome.
3. Check `git status --short` and avoid mixing unrelated changes into commits.
