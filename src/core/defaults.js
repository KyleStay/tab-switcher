export const STORAGE_KEYS = {
  tabs: "tabSwitcher.tabs",
  settings: "tabSwitcher.settings",
  firstRunSeen: "tabSwitcher.firstRunSeen",
  lastQuery: "tabSwitcher.lastQuery",
  overlayToken: "tabSwitcher.overlayToken"
};

export const DEFAULT_SETTINGS = {
  currentWindowOnly: false,
  mruCycleScope: "all-windows",
  includeClosedTabs: true,
  restorePreviousQuery: false,
  launchMode: "popup",
  extensionViewHosts: [],
  theme: "system",
  density: "compact",
  maxResults: 75,
  privateTabsEnabled: false,
  privateTabDisplayMode: "grouped",
  privateTabIndicator: "icon",
  privateMaskTitle: true,
  privateMaskUrl: true,
  privateMaskDomain: true,
  privateMaskFavicon: true,
  privateRevealMode: "selected",
  privateRevealDurationMinutes: 5,
  privateSearchHiddenContent: false
};

export const SETTING_LIMITS = {
  maxResults: { min: 20, max: 300 },
  privateRevealDurationMinutes: { min: 1, max: 1440 }
};

export const COMMAND_LABELS = {
  "open-switcher": "Open Tab Switcher",
  "open-switcher-alt-windows": "Open Tab Switcher (alternate)",
  _execute_action: "Activate the extension",
  "switch-previous-tab": "Cycle to older recent tab",
  "switch-next-tab": "Cycle to newer recent tab"
};

export function mergeSettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
  const merged = {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(
      Object.entries(value).filter(([, settingValue]) => settingValue !== undefined)
    )
  };

  return {
    currentWindowOnly: normalizeBoolean(merged.currentWindowOnly, DEFAULT_SETTINGS.currentWindowOnly),
    mruCycleScope: normalizeEnum(
      merged.mruCycleScope,
      ["all-windows", "current-window"],
      DEFAULT_SETTINGS.mruCycleScope
    ),
    includeClosedTabs: normalizeBoolean(merged.includeClosedTabs, DEFAULT_SETTINGS.includeClosedTabs),
    restorePreviousQuery: normalizeBoolean(merged.restorePreviousQuery, DEFAULT_SETTINGS.restorePreviousQuery),
    launchMode: normalizeEnum(merged.launchMode === "overlay" ? "hybrid" : merged.launchMode, ["hybrid", "popup"], DEFAULT_SETTINGS.launchMode),
    extensionViewHosts: normalizeHostList(merged.extensionViewHosts),
    theme: normalizeEnum(merged.theme, ["system", "dark", "light"], DEFAULT_SETTINGS.theme),
    density: normalizeEnum(merged.density, ["compact", "comfy"], DEFAULT_SETTINGS.density),
    maxResults: normalizeInteger(
      merged.maxResults,
      SETTING_LIMITS.maxResults.min,
      SETTING_LIMITS.maxResults.max,
      DEFAULT_SETTINGS.maxResults
    ),
    privateTabsEnabled: normalizeBoolean(merged.privateTabsEnabled, DEFAULT_SETTINGS.privateTabsEnabled),
    privateTabDisplayMode: normalizeEnum(
      merged.privateTabDisplayMode,
      ["hidden", "grouped", "integrated"],
      DEFAULT_SETTINGS.privateTabDisplayMode
    ),
    privateTabIndicator: normalizeEnum(
      merged.privateTabIndicator,
      ["icon", "label", "icon-label", "none"],
      DEFAULT_SETTINGS.privateTabIndicator
    ),
    privateMaskTitle: normalizeBoolean(merged.privateMaskTitle, DEFAULT_SETTINGS.privateMaskTitle),
    privateMaskUrl: normalizeBoolean(merged.privateMaskUrl, DEFAULT_SETTINGS.privateMaskUrl),
    privateMaskDomain: normalizeBoolean(merged.privateMaskDomain, DEFAULT_SETTINGS.privateMaskDomain),
    privateMaskFavicon: normalizeBoolean(merged.privateMaskFavicon, DEFAULT_SETTINGS.privateMaskFavicon),
    privateRevealMode: normalizeEnum(
      merged.privateRevealMode,
      ["never", "selected", "session", "timed", "manual"],
      DEFAULT_SETTINGS.privateRevealMode
    ),
    privateRevealDurationMinutes: normalizeInteger(
      merged.privateRevealDurationMinutes,
      SETTING_LIMITS.privateRevealDurationMinutes.min,
      SETTING_LIMITS.privateRevealDurationMinutes.max,
      DEFAULT_SETTINGS.privateRevealDurationMinutes
    ),
    privateSearchHiddenContent: normalizeBoolean(
      merged.privateSearchHiddenContent,
      DEFAULT_SETTINGS.privateSearchHiddenContent
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
