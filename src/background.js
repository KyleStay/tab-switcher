import { DEFAULT_SETTINGS, STORAGE_KEYS, mergeSettings } from "./core/defaults.js";
import {
  createInitialState,
  getCycleTarget,
  listTabs,
  removeTab,
  touchTab,
  updateTab
} from "./core/mru.js";

let mruState = { byKey: {}, order: [] };
let settings = DEFAULT_SETTINGS;
let readyPromise = hydrate();

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await readyPromise;
  await refreshAllTabs();
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    await chrome.storage.local.set({ [STORAGE_KEYS.firstRunSeen]: false });
  }
});

chrome.runtime.onStartup.addListener(() => {
  readyPromise = hydrate();
  readyPromise.then(refreshAllTabs);
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  await readyPromise;
  const tab = await chrome.tabs.get(tabId);
  mruState = touchTab(mruState, { ...tab, windowId });
  await persistTabs();
});

chrome.tabs.onUpdated.addListener(async (tabId, _changeInfo, tab) => {
  await readyPromise;
  if (typeof tab.id !== "number" || typeof tab.windowId !== "number") return;
  mruState = updateTab(mruState, tab);
  await persistTabs();
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  await readyPromise;
  mruState = removeTab(mruState, tabId, removeInfo.windowId);
  await persistTabs();
});

chrome.tabs.onAttached.addListener(queueRefreshAllTabs);
chrome.tabs.onDetached.addListener(queueRefreshAllTabs);
chrome.tabs.onMoved.addListener(queueRefreshAllTabs);
chrome.tabs.onReplaced.addListener(queueRefreshAllTabs);
chrome.windows.onRemoved.addListener(queueRefreshAllTabs);

chrome.commands.onCommand.addListener(async (command, tab) => {
  await readyPromise;
  if (command === "switch-previous-tab") {
    await cycleFrom(tab, 1);
  }
  if (command === "switch-next-tab") {
    await cycleFrom(tab, -1);
  }
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
  await readyPromise;
  await refreshAllTabs();
}

async function persistTabs() {
  await chrome.storage.local.set({ [STORAGE_KEYS.tabs]: mruState });
}

async function handleMessage(message) {
  await readyPromise;

  switch (message?.type) {
    case "get-state":
      return { ok: true, state: await getSwitcherState() };
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
    default:
      return { ok: false, error: "Unknown message type" };
  }
}

async function getSwitcherState() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentWindowId = activeTab?.windowId ?? null;
  const openTabs = listTabs(mruState, {
    currentWindowId,
    currentWindowOnly: settings.currentWindowOnly
  });
  const commands = await chrome.commands.getAll();
  const firstRun = await chrome.storage.local.get(STORAGE_KEYS.firstRunSeen);
  const closedTabs = settings.includeClosedTabs ? await getClosedSessions() : [];

  return {
    activeTab,
    tabs: openTabs,
    closedTabs,
    settings,
    commands,
    firstRunSeen: Boolean(firstRun[STORAGE_KEYS.firstRunSeen])
  };
}

async function getClosedSessions() {
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
  return sessions
    .filter((session) => session.tab)
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
  const target = getCycleTarget(mruState, tab, direction, {
    currentWindowId: tab?.windowId ?? null,
    currentWindowOnly: settings.currentWindowOnly
  });

  if (target) await activateTab(target);
}
