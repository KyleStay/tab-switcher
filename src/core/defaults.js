export const STORAGE_KEYS = {
  tabs: "tabSwitcher.tabs",
  settings: "tabSwitcher.settings",
  firstRunSeen: "tabSwitcher.firstRunSeen"
};

export const DEFAULT_SETTINGS = {
  currentWindowOnly: false,
  includeClosedTabs: true,
  restorePreviousQuery: true,
  theme: "system",
  density: "compact",
  maxResults: 75
};

export const COMMAND_LABELS = {
  _execute_action: "Open switcher",
  "switch-previous-tab": "Previous MRU tab",
  "switch-next-tab": "Next MRU tab"
};

export function mergeSettings(value = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(
      Object.entries(value).filter(([, settingValue]) => settingValue !== undefined)
    )
  };
}

