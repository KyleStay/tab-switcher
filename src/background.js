import { DEFAULT_SETTINGS, STORAGE_KEYS, mergeSettings, normalizeHost } from "./core/defaults.js";
import { DEVELOPMENT_ID, PUBLIC_ID } from "./core/channels.js";
import { canUseOverlayOnTab, shouldTryOverlay } from "./core/messages.js";
import { shouldIncludePrivateTabs } from "./core/private-tabs.js";
import { createInitialState, listTabs, tabKey, wrapIndex } from "./core/mru.js";

const POPUP_PATH = "src/switcher.html";
const LAUNCH_COMMANDS = ["open-switcher", "open-switcher-alt-windows"];
const CYCLE_COMMANDS = ["switch-previous-tab", "switch-next-tab"];
const CYCLE_SESSION_MS = 1400;
const isPublicBuild = chrome.runtime.id === PUBLIC_ID;
let settings = DEFAULT_SETTINGS;
let cycleSession = null;
let settingsQueue = Promise.resolve();
let launchQueue = Promise.resolve();
let cycleQueue = Promise.resolve();
const readyPromise = hydrate();

async function hydrate() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  settings = mergeSettings(stored[STORAGE_KEYS.settings]);
  // Chrome owns tab recency. Do not persist a second copy of browsing data.
  await chrome.storage.local.remove(STORAGE_KEYS.tabs);
  await configureAction();
}

function configureAction() {
  return chrome.action.setPopup({ popup: !isPublicBuild && settings.launchMode === "popup" ? POPUP_PATH : "" });
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (isSwitcherCommand(command)) return runCommand(command, tab);
});

chrome.action.onClicked.addListener((tab) => runCommand("open-switcher", tab));

if (chrome.runtime.id === DEVELOPMENT_ID) {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (sender.id !== PUBLIC_ID || message?.type !== "tab-switcher:run-command"
      || !isSwitcherCommand(message.command) || !Number.isInteger(message.windowId) || message.windowId < 0) return false;
    runCommand(message.command, undefined, message.windowId).then(sendResponse, () => sendResponse(false));
    return true;
  });
}

function isSwitcherCommand(command) {
  return LAUNCH_COMMANDS.includes(command) || CYCLE_COMMANDS.includes(command);
}

function runCommand(command, tab, forwardedWindowId) {
  const launch = LAUNCH_COMMANDS.includes(command);
  const queue = launch ? launchQueue : cycleQueue;
  const task = queue.then(async () => {
    await readyPromise;
    const activeTab = forwardedWindowId === undefined
      ? await (launch && tab ? tab : getActiveTab())
      : (await chrome.tabs.query({ active: true, windowId: forwardedWindowId }))[0];
    if (forwardedWindowId !== undefined && !activeTab) return false;
    if (isPublicBuild && Number.isInteger(activeTab?.windowId)) {
      const handled = await chrome.runtime.sendMessage(DEVELOPMENT_ID, {
        type: "tab-switcher:run-command", command, windowId: activeTab.windowId
      }).catch(() => false);
      if (handled === true) return true;
    }
    if (launch) await openSwitcher(activeTab);
    else await cycleFrom(command === "switch-previous-tab" ? 1 : -1, activeTab);
    return true;
  });
  if (launch) launchQueue = task.catch(reportError);
  else cycleQueue = task.catch(reportError);
  return task;
}

function reportError(error) {
  console.warn("Tab Switcher failed", error);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(overlayKey(tabId)).catch(reportError);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error.message || String(error) });
  });
  return true;
});

function overlayKey(tabId) {
  return STORAGE_KEYS.overlayToken + ":" + tabId;
}

async function validateSender(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error("Unknown sender");
  if (message?.type === "overlay-closed" && sender.tab && sender.frameId === 0) {
    const key = overlayKey(sender.tab.id);
    const stored = await chrome.storage.session.get(key);
    if (stored[key] === message.token) await chrome.storage.session.remove(key);
    return;
  }
  const url = new URL(sender.url || "about:blank");
  const allowed = [chrome.runtime.getURL(POPUP_PATH), chrome.runtime.getURL("src/options.html")];
  if (!allowed.includes(url.protocol + "//" + url.host + url.pathname)) throw new Error("Unknown view");
  if (sender.frameId > 0) {
    const stored = await chrome.storage.session.get(overlayKey(sender.tab?.id));
    if (!message.token || stored[overlayKey(sender.tab?.id)] !== message.token || url.hash.slice(1) !== message.token) {
      throw new Error("Open the switcher with its toolbar button or shortcut.");
    }
  }
}

async function handleMessage(message, sender) {
  await readyPromise;
  await validateSender(message, sender);
  switch (message?.type) {
    case "overlay-closed":
      return { ok: true };
    case "overlay-ready":
    case "hide-overlay":
      if (!sender.tab || sender.frameId <= 0) throw new Error("Not an overlay");
      await chrome.tabs.sendMessage(sender.tab.id, { type: message.type, token: message.token }, { frameId: 0 });
      return { ok: true };
    case "get-state":
      return { ok: true, state: await getSwitcherState(sender) };
    case "get-closed-tabs":
      return { ok: true, closedTabs: await getClosedSessions(message.windowId) };
    case "activate-tab":
      await activateTab(message.tab?.id);
      return { ok: true };
    case "close-tab": {
      const tab = await getAllowedTab(message.tab?.id);
      await chrome.tabs.remove(tab.id);
      return { ok: true };
    }
    case "restore-closed":
      if (typeof message.sessionId !== "string" || !message.sessionId) throw new Error("Missing closed tab session id");
      await chrome.sessions.restore(message.sessionId);
      return { ok: true };
    case "get-settings":
      return { ok: true, settings, commands: await chrome.commands.getAll(), privateTabsAccess: await getIncognitoAccess() };
    case "update-settings":
      if (!message.settings || typeof message.settings !== "object" || Array.isArray(message.settings)) throw new Error("Invalid settings");
      return updateSettings(message.settings);
    case "mark-first-run-seen":
      await chrome.storage.local.set({ [STORAGE_KEYS.firstRunSeen]: true });
      return { ok: true };
    case "open-shortcut-settings":
      await chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      return { ok: true };
    case "open-switcher-popup":
      await openPopupFallback(sender.tab?.windowId);
      return { ok: true };
    case "add-active-site-to-extension-view": {
      const activeTab = await getActiveTab(sender);
      if (!/^https?:\/\//i.test(activeTab?.url || "")) throw new Error("Current page cannot be added.");
      const host = normalizeHost(activeTab.url);
      const response = await updateSettings({ extensionViewHosts: [...settings.extensionViewHosts, host] });
      return { ...response, host };
    }
    case "save-query":
      if (typeof message.query !== "string") throw new Error("Invalid query");
      if (!settings.restorePreviousQuery || settings.privateTabsEnabled || (await getActiveTab(sender))?.incognito) {
        await chrome.storage.session.remove(STORAGE_KEYS.lastQuery);
      } else {
        await chrome.storage.session.set({ [STORAGE_KEYS.lastQuery]: message.query.slice(0, 4096) });
      }
      return { ok: true };
    default:
      throw new Error("Unknown message type");
  }
}

function updateSettings(patch) {
  const task = settingsQueue.then(async () => {
    const next = mergeSettings({ ...settings, ...patch });
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
    settings = next;
    await configureAction();
    if (!settings.restorePreviousQuery || settings.privateTabsEnabled) await chrome.storage.session.remove(STORAGE_KEYS.lastQuery);
    cycleSession = null;
    return { ok: true, settings, privateTabsAccess: await getIncognitoAccess() };
  });
  settingsQueue = task.catch(() => {});
  return task;
}

async function openSwitcher(tab) {
  if (shouldTryOverlay(settings.launchMode) && await openOverlay(tab)) return;
  // Restricted pages and explicit site exclusions must still have a usable switcher.
  await openPopupFallback(tab?.windowId);
}

async function openOverlay(tab) {
  if (!canUseOverlayOnTab(tab, settings)) return false;
  const token = crypto.randomUUID();
  const key = overlayKey(tab.id);
  try {
    await chrome.storage.session.set({ [key]: token });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content-switcher.js"] });
    const response = await chrome.tabs.sendMessage(tab.id, { type: "tab-switcher:show-overlay", token }, { frameId: 0 });
    if (!response?.ok) throw new Error(response?.error || "Overlay did not open");
    return true;
  } catch (error) {
    await chrome.storage.session.remove(key);
    await chrome.tabs.sendMessage(tab.id, { type: "hide-overlay", token }, { frameId: 0 }).catch(() => {});
    console.debug("Tab Switcher overlay unavailable", error);
    return false;
  }
}

async function openPopupFallback(windowId) {
  try {
    await chrome.action.setPopup({ popup: POPUP_PATH });
    await chrome.action.openPopup(Number.isInteger(windowId) ? { windowId } : undefined);
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL(POPUP_PATH), ...(Number.isInteger(windowId) ? { windowId } : {}) });
  } finally {
    await configureAction();
  }
}

async function getActiveTab(sender = {}) {
  if (sender.tab && sender.frameId > 0) return chrome.tabs.get(sender.tab.id);
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function getTabs() {
  const [windows, hasIncognitoAccess] = await Promise.all([
    chrome.windows.getAll({ populate: true, windowTypes: ["normal", "popup"] }), getIncognitoAccess()
  ]);
  const includePrivate = shouldIncludePrivateTabs({ hasIncognitoAccess, settings });
  const tabs = windows.flatMap((window) => window.tabs || []).filter((tab) => !tab.incognito || includePrivate);
  return { mru: createInitialState(tabs), hasIncognitoAccess, includePrivate };
}

async function getSwitcherState(sender) {
  const [snapshot, activeTab, stored, session] = await Promise.all([
    getTabs(), getActiveTab(sender), chrome.storage.local.get(STORAGE_KEYS.firstRunSeen), chrome.storage.session.get(STORAGE_KEYS.lastQuery)
  ]);
  const firstRunSeen = Boolean(stored[STORAGE_KEYS.firstRunSeen]);
  const commands = firstRunSeen ? [] : await chrome.commands.getAll();
  const shortcuts = new Map(commands.map(({ name, shortcut }) => [name, shortcut]));
  const launchShortcuts = [...LAUNCH_COMMANDS, "_execute_action"].map((name) => shortcuts.get(name)).filter(Boolean);
  return {
    activeTab: activeTab?.incognito && !snapshot.includePrivate ? null : activeTab,
    currentWindowId: activeTab?.windowId ?? null,
    tabs: listTabs(snapshot.mru, { activeTab, currentWindowId: activeTab?.windowId ?? null, currentWindowOnly: settings.currentWindowOnly }),
    closedTabs: [], settings,
    privateTabsAccess: snapshot.hasIncognitoAccess,
    firstRunSeen, launchShortcuts,
    lastQuery: settings.restorePreviousQuery && !settings.privateTabsEnabled && !activeTab?.incognito ? session[STORAGE_KEYS.lastQuery] || "" : ""
  };
}

async function getClosedSessions(windowId) {
  if (!settings.includeClosedTabs) return [];
  if (settings.currentWindowOnly && !Number.isInteger(windowId)) return [];
  return (await chrome.sessions.getRecentlyClosed({ maxResults: 25 }))
    .filter((session) => session.tab && !session.tab.incognito)
    .filter((session) => !settings.currentWindowOnly || session.tab.windowId === windowId)
    .map((session) => ({ sessionId: session.tab.sessionId, closedAt: session.lastModified, tab: session.tab }));
}

async function getAllowedTab(id) {
  if (!Number.isInteger(id) || id < 0) throw new Error("Invalid tab");
  const tab = await chrome.tabs.get(id);
  if (tab.incognito && !shouldIncludePrivateTabs({ hasIncognitoAccess: await getIncognitoAccess(), settings })) throw new Error("Private tabs are disabled");
  return tab;
}

async function activateTab(id) {
  const tab = await getAllowedTab(id);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
}

async function cycleFrom(direction, activeTab) {
  const snapshot = await getTabs();
  const currentWindowId = settings.mruCycleScope === "current-window" ? activeTab?.windowId ?? null : null;
  const tabs = listTabs(snapshot.mru, { currentWindowId, currentWindowOnly: settings.mruCycleScope === "current-window" });
  if (tabs.length < 2) return;
  const activeKey = activeTab ? tabKey(activeTab) : null;
  const now = Date.now();
  const keys = tabs.map(tabKey);
  if (!cycleSession || now - cycleSession.updatedAt >= CYCLE_SESSION_MS
    || cycleSession.currentWindowId !== currentWindowId || cycleSession.keys[cycleSession.index] !== activeKey
    || cycleSession.keys.length !== keys.length || cycleSession.keys.some((key) => !keys.includes(key))) {
    cycleSession = { keys, index: Math.max(0, keys.indexOf(activeKey)), currentWindowId };
  }
  cycleSession.index = wrapIndex(cycleSession.index + direction, keys.length);
  cycleSession.updatedAt = now;
  await activateTab(tabs.find((tab) => tabKey(tab) === cycleSession.keys[cycleSession.index]).id);
}

async function getIncognitoAccess() {
  return chrome.extension.isAllowedIncognitoAccess();
}
