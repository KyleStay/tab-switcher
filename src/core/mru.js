export function tabKey(tab) {
  return `${tab.windowId}:${tab.id}`;
}

export function normalizeTab(tab, lastAccessed = Date.now()) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index ?? 0,
    title: tab.title || "Untitled",
    url: tab.url || "",
    favIconUrl: tab.favIconUrl || "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    audible: Boolean(tab.audible),
    muted: Boolean(tab.mutedInfo?.muted),
    incognito: Boolean(tab.incognito),
    groupId: tab.groupId ?? -1,
    lastAccessed
  };
}

export function createInitialState(tabs = [], now = Date.now()) {
  const byKey = {};
  const order = [];

  for (const tab of tabs) {
    if (typeof tab.id !== "number" || typeof tab.windowId !== "number") continue;
    const normalized = normalizeTab(tab, tab.active ? now : now - tab.index - 1);
    const key = tabKey(normalized);
    byKey[key] = normalized;
    order.push(key);
  }

  order.sort((left, right) => byKey[right].lastAccessed - byKey[left].lastAccessed);

  return { byKey, order };
}

export function touchTab(state, tab, now = Date.now()) {
  const key = tabKey(tab);
  const previous = state.byKey[key] || {};
  const normalized = normalizeTab({ ...previous, ...tab }, now);
  const order = [key, ...state.order.filter((item) => item !== key)];

  return {
    byKey: { ...state.byKey, [key]: normalized },
    order
  };
}

export function updateTab(state, tab, now = Date.now()) {
  const key = tabKey(tab);
  const previous = state.byKey[key];
  const normalized = normalizeTab({ ...previous, ...tab }, previous?.lastAccessed || now);
  const order = state.order.includes(key) ? state.order : [...state.order, key];

  return {
    byKey: { ...state.byKey, [key]: normalized },
    order
  };
}

export function removeTab(state, tabId, windowId) {
  const exactKey = typeof windowId === "number" ? `${windowId}:${tabId}` : null;
  const keysToRemove = exactKey
    ? new Set([exactKey])
    : new Set(Object.keys(state.byKey).filter((key) => key.endsWith(`:${tabId}`)));

  const byKey = {};
  for (const [key, tab] of Object.entries(state.byKey)) {
    if (!keysToRemove.has(key)) byKey[key] = tab;
  }

  return {
    byKey,
    order: state.order.filter((key) => !keysToRemove.has(key))
  };
}

export function listTabs(state, { currentWindowId = null, currentWindowOnly = false } = {}) {
  const seen = new Set();
  const ordered = [];

  for (const key of state.order) {
    const tab = state.byKey[key];
    if (!tab || seen.has(key)) continue;
    if (currentWindowOnly && currentWindowId !== null && tab.windowId !== currentWindowId) continue;
    seen.add(key);
    ordered.push(tab);
  }

  const missing = Object.entries(state.byKey)
    .filter(([key, tab]) => !seen.has(key) && (!currentWindowOnly || tab.windowId === currentWindowId))
    .map(([, tab]) => tab)
    .sort((left, right) => right.lastAccessed - left.lastAccessed);

  return [...ordered, ...missing];
}

export function getCycleTarget(state, activeTab, direction = 1, options = {}) {
  const tabs = listTabs(state, options);
  if (tabs.length < 2) return null;

  const activeKey = activeTab ? tabKey(activeTab) : null;
  const activeIndex = tabs.findIndex((tab) => tabKey(tab) === activeKey);
  const startIndex = activeIndex >= 0 ? activeIndex : 0;
  const targetIndex = (startIndex + direction + tabs.length) % tabs.length;

  return tabs[targetIndex] || null;
}

