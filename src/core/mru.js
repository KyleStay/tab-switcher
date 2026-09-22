export function tabKey(tab) {
  return `${tab.windowId}:${tab.id}`;
}

export function normalizeTab(tab, lastAccessed = getLastAccessed(tab, Date.now())) {
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
    const normalized = normalizeTab(tab, getLastAccessed(tab, tab.active ? now : now - tab.index - 1));
    const key = tabKey(normalized);
    byKey[key] = normalized;
    order.push(key);
  }

  order.sort((left, right) => byKey[right].lastAccessed - byKey[left].lastAccessed);

  return { byKey, order };
}

export function listTabs(state, { activeTab = null, currentWindowId = null, currentWindowOnly = false } = {}) {
  if (currentWindowOnly && currentWindowId === null) return [];

  const seen = new Set();
  const ordered = [];
  const activeKey = activeTab ? tabKey(activeTab) : null;

  if (activeKey) {
    const active = state.byKey[activeKey];
    if (active && (!currentWindowOnly || active.windowId === currentWindowId)) {
      seen.add(activeKey);
      ordered.push(active);
    }
  }

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

export function wrapIndex(index, length) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function getLastAccessed(tab, fallback) {
  return Number.isFinite(tab?.lastAccessed) ? tab.lastAccessed : fallback;
}
