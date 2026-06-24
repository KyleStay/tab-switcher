import { DEFAULT_SETTINGS, STORAGE_KEYS, mergeSettings, normalizeHost } from "./core/defaults.js";
import {
  canUseOverlayOnTab,
  createShowOverlayMessage,
  shouldFallbackToPopup,
  shouldTryOverlay
} from "./core/messages.js";
import {
  createInitialState,
  getCycleTarget,
  listTabs,
  removeTab,
  touchTab,
  updateTab,
  tabKey,
  wrapIndex
} from "./core/mru.js";

let mruState = { byKey: {}, order: [] };
let settings = DEFAULT_SETTINGS;
let readyPromise = hydrate();
let cycleSession = null;

const CYCLE_SESSION_MS = 1400;
const POPUP_PATH = "src/switcher.html";
const OVERLAY_SCRIPT = "src/content-switcher.js";

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await runSafely("install", async () => {
    await readyPromise;
    await refreshAllTabs();
    if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
      await chrome.storage.local.set({ [STORAGE_KEYS.firstRunSeen]: false });
    }
  });
});

chrome.runtime.onStartup.addListener(() => {
  readyPromise = hydrate();
  runSafely("startup", async () => {
    await readyPromise;
    await refreshAllTabs();
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await runSafely("tab activation", async () => {
    await readyPromise;
    const tab = await chrome.tabs.get(tabId);
    mruState = touchTab(mruState, { ...tab, windowId });
    await persistTabs();
  });
});

chrome.tabs.onUpdated.addListener(async (tabId, _changeInfo, tab) => {
  await runSafely("tab update", async () => {
    await readyPromise;
    if (typeof tab.id !== "number" || typeof tab.windowId !== "number") return;
    mruState = updateTab(mruState, tab);
    await persistTabs();
  });
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  await runSafely("tab removal", async () => {
    await readyPromise;
    mruState = removeTab(mruState, tabId, removeInfo.windowId);
    await persistTabs();
  });
});

chrome.tabs.onAttached.addListener(queueRefreshAllTabs);
chrome.tabs.onDetached.addListener(queueRefreshAllTabs);
chrome.tabs.onMoved.addListener(queueRefreshAllTabs);
chrome.tabs.onReplaced.addListener(queueRefreshAllTabs);
chrome.windows.onRemoved.addListener(queueRefreshAllTabs);

chrome.commands.onCommand.addListener(async (command, tab) => {
  await runSafely("command", async () => {
    await readyPromise;
    if (command === "_execute_action" || command === "open-switcher-alt-windows") {
      await openSwitcher(tab, "command");
      return;
    }
    if (command === "switch-previous-tab") {
      await cycleFrom(tab, 1);
    }
    if (command === "switch-next-tab") {
      await cycleFrom(tab, -1);
    }
  });
});

chrome.action.onClicked.addListener((tab) => {
  runSafely("action click", async () => {
    await readyPromise;
    await openSwitcher(tab, "action");
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });
  return true;
});

async function hydrate() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.tabs,
    STORAGE_KEYS.settings
  ]);

  mruState = stored[STORAGE_KEYS.tabs] || { byKey: {}, order: [] };
  settings = mergeSettings(stored[STORAGE_KEYS.settings]);
}

async function refreshAllTabs() {
  const tabs = await chrome.tabs.query({});
  const previous = mruState;
  const fresh = createInitialState(tabs);

  for (const [key, tab] of Object.entries(fresh.byKey)) {
    if (previous.byKey[key]?.lastAccessed) {
      fresh.byKey[key].lastAccessed = previous.byKey[key].lastAccessed;
    }
  }

  const survivingOrder = previous.order.filter((key) => fresh.byKey[key]);
  const newKeys = Object.keys(fresh.byKey).filter((key) => !survivingOrder.includes(key));
  mruState = { byKey: fresh.byKey, order: [...survivingOrder, ...newKeys] };
  await persistTabs();
}

async function queueRefreshAllTabs() {
  await runSafely("tab refresh", async () => {
    await readyPromise;
    await refreshAllTabs();
  });
}

async function persistTabs() {
  await chrome.storage.local.set({ [STORAGE_KEYS.tabs]: mruState });
}

async function runSafely(scope, task) {
  try {
    await task();
  } catch (error) {
    console.warn(`Tab Switcher ${scope} failed`, error);
  }
}

async function handleMessage(message) {
  await readyPromise;

  switch (message?.type) {
    case "get-state":
      return { ok: true, state: await getSwitcherState() };
    case "get-closed-tabs":
      return { ok: true, closedTabs: await getSwitcherClosedTabs() };
    case "activate-tab":
      await activateTab(message.tab);
      return { ok: true };
    case "close-tab":
      await chrome.tabs.remove(message.tab.id);
      return { ok: true };
    case "restore-closed":
      return { ok: true, restored: await restoreClosed(message.sessionId) };
    case "get-settings":
      return { ok: true, settings, commands: await chrome.commands.getAll() };
    case "update-settings":
      settings = mergeSettings({ ...settings, ...message.settings });
      await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
      return { ok: true, settings };
    case "mark-first-run-seen":
      await chrome.storage.local.set({ [STORAGE_KEYS.firstRunSeen]: true });
      return { ok: true };
    case "open-shortcut-settings":
      await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      return { ok: true };
    case "open-switcher-popup":
      await openPopupFallback();
      return { ok: true };
    case "add-active-site-to-extension-view":
      return { ok: true, ...(await addActiveSiteToExtensionView()) };
    default:
      return { ok: false, error: "Unknown message type" };
  }
}

async function openSwitcher(tab, reason) {
  const launchMode = settings.launchMode;

  if (shouldTryOverlay(launchMode) && await openOverlay(tab, reason)) return;
  if (shouldFallbackToPopup(launchMode)) {
    await openPopupFallback(tab?.windowId);
    return;
  }

  throw new Error("Tab Switcher overlay could not open on this page.");
}

async function openOverlay(tab, reason) {
  if (!canUseOverlayOnTab(tab, settings)) return false;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [OVERLAY_SCRIPT]
    });
    await chrome.tabs.sendMessage(tab.id, createShowOverlayMessage({ reason }));
    return true;
  } catch (error) {
    console.debug("Tab Switcher overlay launch failed", error);
    return false;
  }
}

async function addActiveSiteToExtensionView() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = normalizeHost(activeTab?.url);
  if (!host || !/^https?:\/\//i.test(activeTab?.url || "")) {
    throw new Error("Current page cannot be added.");
  }

  const nextHosts = [...new Set([...settings.extensionViewHosts, host])].sort();
  settings = mergeSettings({ ...settings, extensionViewHosts: nextHosts });
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  return { host, settings };
}

async function openPopupFallback(windowId) {
  if (!chrome.action?.openPopup) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(POPUP_PATH) });
    return;
  }

  await chrome.action.setPopup({ popup: POPUP_PATH });
  try {
    await chrome.action.openPopup(Number.isInteger(windowId) ? { windowId } : undefined);
  } finally {
    globalThis.setTimeout(() => {
      chrome.action.setPopup({ popup: "" }).catch((error) => {
        console.debug("Tab Switcher popup reset failed", error);
      });
    }, 0);
  }
}

async function getSwitcherState() {
  const [activeTabs, firstRun] = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.storage.local.get(STORAGE_KEYS.firstRunSeen)
  ]);
  const [activeTab] = activeTabs;
  const currentWindowId = activeTab?.windowId ?? null;
  const openTabs = listTabs(mruState, {
    currentWindowId,
    currentWindowOnly: settings.currentWindowOnly
  });

  return {
    activeTab,
    tabs: openTabs,
    closedTabs: [],
    settings,
    firstRunSeen: Boolean(firstRun[STORAGE_KEYS.firstRunSeen])
  };
}

async function getSwitcherClosedTabs() {
  if (!settings.includeClosedTabs) return [];

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return getClosedSessions({
    currentWindowId: activeTab?.windowId ?? null,
    currentWindowOnly: settings.currentWindowOnly
  });
}

async function getClosedSessions({ currentWindowId = null, currentWindowOnly = false } = {}) {
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
  return sessions
    .filter((session) => session.tab)
    .filter((session) => {
      if (!currentWindowOnly || currentWindowId === null) return true;
      return session.tab.windowId === currentWindowId;
    })
    .map((session) => ({
      sessionId: session.tab.sessionId,
      closedAt: session.lastModified,
      tab: {
        id: null,
        windowId: session.tab.windowId ?? null,
        index: session.tab.index ?? 0,
        title: session.tab.title || "Recently closed tab",
        url: session.tab.url || "",
        favIconUrl: session.tab.favIconUrl || "",
        incognito: Boolean(session.tab.incognito),
        closed: true
      }
    }));
}

async function restoreClosed(sessionId) {
  if (!sessionId) throw new Error("Missing closed tab session id");
  return chrome.sessions.restore(sessionId);
}

async function activateTab(tab) {
  if (!tab || typeof tab.id !== "number" || typeof tab.windowId !== "number") {
    throw new Error("Invalid tab");
  }

  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
  mruState = touchTab(mruState, tab);
  await persistTabs();
}

async function cycleFrom(activeTab, direction) {
  const tab = activeTab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const options = {
    currentWindowId: tab?.windowId ?? null,
    currentWindowOnly: settings.currentWindowOnly
  };
  const tabs = listTabs(mruState, options);
  const target = getCycleSessionTarget(tabs, tab, direction, options) || getCycleTarget(mruState, tab, direction, options);

  if (target) await activateTab(target);
}

function getCycleSessionTarget(tabs, activeTab, direction, options) {
  if (tabs.length < 2) return null;

  const now = Date.now();
  const activeKey = activeTab ? tabKey(activeTab) : null;
  const sessionValid = cycleSession
    && now - cycleSession.updatedAt < CYCLE_SESSION_MS
    && cycleSession.currentWindowOnly === options.currentWindowOnly
    && cycleSession.currentWindowId === options.currentWindowId;

  if (!sessionValid) {
    const activeIndex = tabs.findIndex((tab) => tabKey(tab) === activeKey);
    cycleSession = {
      keys: tabs.map(tabKey),
      index: activeIndex >= 0 ? activeIndex : 0,
      currentWindowId: options.currentWindowId,
      currentWindowOnly: options.currentWindowOnly,
      updatedAt: now
    };
  }

  cycleSession.index = wrapIndex(cycleSession.index + direction, cycleSession.keys.length);
  cycleSession.updatedAt = now;

  const targetKey = cycleSession.keys[cycleSession.index];
  return tabs.find((candidate) => tabKey(candidate) === targetKey) || null;
}
