export const STORAGE_KEYS = {
  tabs: "tabSwitcher.tabs",
  settings: "tabSwitcher.settings",
  firstRunSeen: "tabSwitcher.firstRunSeen",
  lastQuery: "tabSwitcher.lastQuery"
};

export const DEFAULT_SETTINGS = {
  currentWindowOnly: false,
  includeClosedTabs: true,
  restorePreviousQuery: false,
  launchMode: "hybrid",
  extensionViewHosts: [],
  theme: "system",
  density: "compact",
  maxResults: 75,
  automationExpireMinutes: 15,
  testKeepalivePromptAutomation: false
};

export const SETTING_LIMITS = {
  maxResults: { min: 20, max: 300 },
  automationExpireMinutes: { min: 1, max: 1440 }
};

export const COMMAND_LABELS = {
  _execute_action: "Open switcher",
  "open-switcher-alt-windows": "Open switcher alternate shortcut",
  "switch-previous-tab": "Cycle to older recent tab",
  "switch-next-tab": "Cycle to newer recent tab"
};

export function mergeSettings(value = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(
      Object.entries(value).filter(([, settingValue]) => settingValue !== undefined)
    )
  };

  return {
    currentWindowOnly: normalizeBoolean(merged.currentWindowOnly, DEFAULT_SETTINGS.currentWindowOnly),
    includeClosedTabs: normalizeBoolean(merged.includeClosedTabs, DEFAULT_SETTINGS.includeClosedTabs),
    restorePreviousQuery: normalizeBoolean(merged.restorePreviousQuery, DEFAULT_SETTINGS.restorePreviousQuery),
    launchMode: normalizeEnum(merged.launchMode, ["hybrid", "overlay", "popup"], DEFAULT_SETTINGS.launchMode),
    extensionViewHosts: normalizeHostList(merged.extensionViewHosts),
    theme: normalizeEnum(merged.theme, ["system", "dark", "light"], DEFAULT_SETTINGS.theme),
    density: normalizeEnum(merged.density, ["compact", "comfy"], DEFAULT_SETTINGS.density),
    maxResults: normalizeInteger(
      merged.maxResults,
      SETTING_LIMITS.maxResults.min,
      SETTING_LIMITS.maxResults.max,
      DEFAULT_SETTINGS.maxResults
    ),
    automationExpireMinutes: normalizeInteger(
      merged.automationExpireMinutes,
      SETTING_LIMITS.automationExpireMinutes.min,
      SETTING_LIMITS.automationExpireMinutes.max,
      DEFAULT_SETTINGS.automationExpireMinutes
    ),
    testKeepalivePromptAutomation: normalizeBoolean(
      merged.testKeepalivePromptAutomation,
      DEFAULT_SETTINGS.testKeepalivePromptAutomation
    )
  };
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function normalizeHostList(value) {
  const entries = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,]+/);
  const hosts = entries
    .map(normalizeHost)
    .filter(Boolean);
  return [...new Set(hosts)].sort();
}

export function normalizeHost(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";

  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return text
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split(":")[0]
      .trim();
  }
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
