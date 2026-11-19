# Tab Switcher

Tab Switcher is a Manifest V3 Chrome extension that brings a VS Code-style quick-open workflow to browser tabs. It keeps tabs ordered by most recent use, lets you fuzzy-search titles and URLs, and supports keyboard-first switching without leaving the browser.

## Features

- Quick popup switcher for open tabs, ordered by most recent use.
- Fuzzy matching across tab titles and URLs with highlighted matches.
- Recently closed tab restore support.
- Older/newer MRU tab commands for direct keyboard cycling outside the popup.
- Options for current-window-only results, previous query restore, theme, density, and max result count.
- First-run shortcut guidance with a link to Chrome's shortcut settings.

## Keyboard Shortcuts

The extension suggests these default shortcuts:

- `Command+E` on macOS or `Ctrl+E` elsewhere: **Open Tab Switcher**. `Option+E` on macOS or `Alt+E` elsewhere is suggested for **Open Tab Switcher (alternate)**.
- `Option+Q` on macOS or `Alt+Q` elsewhere: cycle to the next older MRU tab.
- `Option+Shift+Q` on macOS or `Alt+Shift+Q` elsewhere: cycle to the next newer MRU tab.

Inside the switcher, use arrows, page keys, `Home`/`End`, or `Command`/`Ctrl` + `J`/`K`/`N`/`P` to move through results, then press `Enter`. `Tab` and `Shift+Tab` move between search and buttons.

When search is empty, press `Delete` on macOS or `Backspace` on Windows to close the selected open tab. Use the row’s × button to close an open tab with any search.

Chrome may leave a shortcut unassigned if it is reserved or already in use. Visit `chrome://extensions/shortcuts` to confirm or remap **Open Tab Switcher**. Chrome manages any existing custom bindings.

## Load Locally

Requires Chrome 127 or newer. The default popup is anchored to Chrome’s toolbar. Choose **Centered overlay with popup fallback** in Settings to open the switcher in the middle of supported webpages. The launch shortcuts and toolbar follow that setting.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this project folder.
5. Pin the extension if you want quick mouse access to the popup.

## Project Layout

- `manifest.json`: Chrome extension manifest and command declarations.
- `src/background.js`: service worker that reads Chrome's tab recency, manages settings, and handles tab actions.
- `src/switcher.html`, `src/switcher.css`, `src/switcher.js`: popup UI.
- `src/content-switcher.js`: a native modal dialog containing the same UI in an extension iframe.
- `src/options.html`, `src/options.css`, `src/options.js`: extension options page.
- `src/core/`: pure JavaScript helpers for settings, MRU ordering, and fuzzy ranking.
- `tests/`: Node test coverage for pure core behavior.

## Development

No install step is required for the current test suite.

```sh
npm test
```

`npm run package` builds the Store upload ZIP and the unpacked **Tab Switcher Dev** build in `dist/dev`. With the updated Store build and Dev enabled in the same profile, the public toolbar action and assigned shortcuts run in Dev. When Dev is disabled or absent, the public build handles them again. Settings stay per installation. Dev has no suggested shortcuts, so it can use the public bindings while both copies are enabled. For Dev alone, assign its own shortcuts in Chrome.

Use the packaged Dev folder for this behavior. Earlier keyless Dev builds have a different ID. The Store build must be updated on the existing listing before it can hand off commands. A forwarded launch may use the toolbar popup when Chrome grants page access only to the public build. The public build handles commands in windows Dev cannot access.

When changing extension UI or Chrome APIs, reload the unpacked extension from `chrome://extensions` before testing in the browser.

Tab titles and URLs are read live and are not saved to disk by the extension. Optional previous queries use extension session storage and are disabled whenever private tab support is enabled. Overlay frames require a per-tab session token before they can request data or perform actions; ordinary pages cannot inspect their contents. Closing an overlay removes its frame.

The optional browser smoke check uses an existing Playwright installation and the disposable Chrome runner. It copies the extension to a temporary directory, grants that copy loopback-only test access, and removes its browser and profile after testing:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-smoke.mjs
```
