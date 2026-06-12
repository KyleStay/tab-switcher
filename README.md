# Tab Switcher

Tab Switcher is a Manifest V3 Chrome extension that brings a VS Code-style quick-open workflow to browser tabs. It keeps tabs ordered by most recent use, lets you fuzzy-search titles and URLs, and supports keyboard-first switching without leaving the browser.

## Features

- Quick popup switcher for open tabs, ordered by most recent use.
- Fuzzy matching across tab titles and URLs with highlighted matches.
- Recently closed tab restore support.
- Previous/next MRU tab commands for direct keyboard cycling.
- Options for current-window-only results, previous query restore, theme, density, and max result count.
- First-run shortcut guidance with a link to Chrome's shortcut settings.

## Keyboard Shortcuts

The extension suggests these default shortcuts:

- `Command+E` on macOS or `Ctrl+E` elsewhere: open the switcher.
- `Option+Q` on macOS or `Alt+Q` elsewhere: switch to the previous MRU tab.
- `Option+Shift+Q` on macOS or `Alt+Shift+Q` elsewhere: switch backward through the MRU list.

Chrome may decline reserved shortcuts. Visit `chrome://extensions/shortcuts` after loading the extension to confirm or remap them.

## Load Locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project folder.
5. Pin the extension if you want quick mouse access to the popup.

## Project Layout

- `manifest.json`: Chrome extension manifest and command declarations.
- `src/background.js`: service worker that tracks MRU state, settings, tab activation, and closed-tab restore.
- `src/switcher.html`, `src/switcher.css`, `src/switcher.js`: popup UI.
- `src/options.html`, `src/options.css`, `src/options.js`: extension options page.
- `src/core/`: pure JavaScript helpers for settings, MRU ordering, and fuzzy ranking.
- `tests/`: Node test coverage for pure core behavior.

## Development

No install step is required for the current test suite.

```sh
npm test
```

When changing extension UI or Chrome APIs, reload the unpacked extension from `chrome://extensions` before testing in the browser.
