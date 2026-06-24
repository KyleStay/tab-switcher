# Tab Switcher Native Helper

Chrome extensions cannot override `Ctrl+Tab` directly, so this experimental helper explores Chrome Native Messaging plus a macOS event tap.

This helper is not wired into the extension yet. The current manifest does not request `nativeMessaging`, and `src/background.js` does not connect to `com.tab_switcher.native`. Treat the files in this folder as a prototype, not as a supported installation path.

## Prototype Host Install

These steps only install the experimental host binary and manifest. They do not make `Ctrl+Tab` work with the extension until extension-side native messaging support is implemented.

1. Reload the unpacked extension in `chrome://extensions`.
2. Copy the extension ID shown on that page.
3. Run:

   ```sh
   native/install-host.sh <extension-id>
   ```

4. Reload the extension again.
5. If macOS prompts for Accessibility permission, grant it to the native host. If no prompt appears during future integration testing, open **System Settings > Privacy & Security > Accessibility** and grant permission to:

   ```text
   ~/Library/Application Support/Tab Switcher/tab-switcher-native-host
   ```

## Intended Prototype Shortcuts

- `Ctrl+Tab`: open the Tab Switcher popup and cycle forward through recent open tabs.
- `Ctrl+Shift+Tab`: cycle backward while the popup is open.
- Release `Control`: activate the selected tab.

The helper suppresses the tab key events after handling them, so Chrome's built-in tab-order switcher should not also run.

The helper only handles these shortcuts while Chrome or Chrome Canary is the frontmost app.
