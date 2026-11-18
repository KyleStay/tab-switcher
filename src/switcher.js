import { buildSearchDocument, rankItems, formatUrl } from "./core/fuzzy.js";
import { tabKey, wrapIndex } from "./core/mru.js";
import { normalizeHost } from "./core/defaults.js";
import { DEFAULT_EXTENSION_VIEW_HOSTS } from "./core/messages.js";
import {
  clearPrivateTabState,
  groupPrivateResults,
  shouldIncludePrivateTabs,
  toPrivateTabDisplayItem
} from "./core/private-tabs.js";
import { getPopupNavigationAction, shouldActivateSelectionOnSpace } from "./core/shortcuts.js";

const isOverlay = window !== window.top;
const overlayToken = isOverlay ? location.hash.slice(1) : null;
const isMac = navigator.platform.toLowerCase().includes("mac");

const elements = {
  shell: document.querySelector(".shell"),
  onboarding: document.querySelector("#onboarding"),
  onboardingShortcut: document.querySelector("#onboardingShortcut"),
  dismissOnboardingButton: document.querySelector("#dismissOnboardingButton"),
  shortcutSettingsButton: document.querySelector("#shortcutSettingsButton"),
  optionsButton: document.querySelector("#optionsButton"),
  queryInput: document.querySelector("#queryInput"),
  resultSummary: document.querySelector("#resultSummary"),
  results: document.querySelector("#results"),
  resultsMessage: document.querySelector("#resultsMessage"),
  extensionViewButton: document.querySelector("#extensionViewButton"),
  enterHint: document.querySelector("#enterHint"),
  escapeHint: document.querySelector("#escapeHint"),
  copyHint: document.querySelector("#copyHint"),
  closeHint: document.querySelector("#closeHint"),
  revealHint: document.querySelector("#revealHint"),
  revealKey: document.querySelector("#revealKey"),
  popupButton: document.querySelector("#popupButton"),
  retryButton: document.querySelector("#retryButton")
};

let state = null;
let items = [];
let ranked = [];
let selectedIndex = 0;
let renderedRows = [];
let closedTabsRequestId = 0;
let revealState = clearPrivateTabState();
let privateTabsByKey = new Map();
let revealTimer;
let queryQueue = Promise.resolve();

document.documentElement.dataset.overlay = String(isOverlay);
document.documentElement.dataset.popup = String(chrome.extension.getViews({ type: "popup" }).includes(window));
bindGlobalEvents();
bindEvents();
init();

async function init() {
  closedTabsRequestId += 1;
  renderLoading();
  elements.queryInput.focus();

  try {
    state = await send({ type: "get-state" }).then((response) => response.state);
    applySettings();
    elements.queryInput.value = state.lastQuery || "";
    prepareItems();
    render();
    elements.queryInput.select();
    if (isOverlay) await send({ type: "overlay-ready" });
    schedulePrivateRedaction();
    loadClosedTabs();
  } catch (error) {
    renderError(error);
  }
}

function bindGlobalEvents() {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (elements.queryInput.value) {
        if (state) clearQuery();
        else elements.queryInput.value = "";
      }
      else closeView();
    }
    if (isOverlay && event.key === "Tab") {
      const controls = [...document.querySelectorAll("input, button")].filter((control) => !control.disabled && control.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    }
  });
  window.addEventListener("pagehide", clearSensitiveState);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state) {
      prepareItems();
      render({ preserveSelection: true });
    }
  });
}

function bindEvents() {
  elements.queryInput.addEventListener("input", () => {
    if (!state) return;
    selectedIndex = 0;
    persistQuery();
    render();
  });

  elements.queryInput.addEventListener("keydown", handleKeyDown);
  elements.results.addEventListener("mousemove", handlePointerMove);
  elements.results.addEventListener("click", handleClick);
  elements.optionsButton.addEventListener("click", async () => {
    try { await chrome.runtime.openOptionsPage(); await closeView(); } catch (error) { showActionError(error); }
  });
  elements.extensionViewButton.addEventListener("click", addCurrentSiteToExtensionView);
  elements.shortcutSettingsButton.addEventListener("click", () => send({ type: "open-shortcut-settings" }).catch(showActionError));
  elements.dismissOnboardingButton.addEventListener("click", async () => {
    try {
      await send({ type: "mark-first-run-seen" });
      if (state) state.firstRunSeen = true;
      elements.onboarding.hidden = true;
      elements.queryInput.focus();
    } catch (error) { showActionError(error); }
  });
  elements.retryButton.addEventListener("click", init);
  elements.popupButton.hidden = !isOverlay;
  elements.popupButton.addEventListener("click", async () => {
    try { await send({ type: "open-switcher-popup" }); await closeView(); } catch (error) { showActionError(error); }
  });
}

function applySettings() {
  elements.shell.dataset.density = state.settings.density;
  document.documentElement.dataset.theme = state.settings.theme === "system" ? "" : state.settings.theme;
  elements.onboarding.hidden = state.firstRunSeen;
  const modifier = isMac ? "Cmd" : "Ctrl";
  if (!state.firstRunSeen) {
    const assigned = state.launchShortcuts || [];
    elements.onboardingShortcut.textContent = assigned.length
      ? `Open the switcher with ${assigned.join(" or ")}.`
      : "Set a keyboard shortcut in Chrome.";
  }
  elements.copyHint.textContent = `${modifier}+C`;
  elements.revealKey.textContent = `${modifier}+R`;
  elements.revealHint.hidden = !state.settings.privateTabsEnabled || state.settings.privateRevealMode !== "manual";
  elements.closeHint.textContent = `${modifier}+W`;
  elements.extensionViewButton.hidden = state.settings.launchMode === "popup" || !canAddActiveSite();
}

function prepareItems() {
  privateTabsByKey = new Map();
  const privateAllowed = shouldIncludePrivateTabs({
    hasIncognitoAccess: state.privateTabsAccess,
    settings: state.settings
  });
  const normalTabs = state.tabs.filter((tab) => !tab.incognito);
  const privateTabs = privateAllowed ? state.tabs.filter((tab) => tab.incognito) : [];
  const visibleTabs = state.settings.privateTabDisplayMode === "integrated"
    ? state.tabs.filter((tab) => !tab.incognito || privateAllowed)
    : [...normalTabs, ...privateTabs];
  const duplicateTitles = getDuplicateTitles(normalTabs);
  const windowIds = new Set(visibleTabs.map((tab) => tab.windowId));
  const openItems = visibleTabs.map((tab, index) => {
    if (tab.incognito) {
      const privateKey = tabKey(tab);
      privateTabsByKey.set(privateKey, tab);
      return createItem({
        ...toPrivateTabDisplayItem({ tab, settings: state.settings, revealState, isSelected: false }),
        privateKey,
        recencyRank: index
      });
    }

    return createItem({
      type: "tab",
      displayUrl: formatUrl(tab.url),
      copyUrl: tab.url || "",
      ariaLabel: [tab.title || "Untitled", formatUrl(tab.url)].filter(Boolean).join(", "),
      duplicateOrdinal: duplicateTitles.get(tabKey(tab)),
      recencyRank: index,
      showWindow: windowIds.size > 1,
      ...tab
    });
  });
  const closedItems = state.closedTabs.map((session, index) => createItem({
    type: "closed",
    sessionId: session.sessionId,
    displayUrl: formatUrl(session.tab.url),
    copyUrl: session.tab.url || "",
    ariaLabel: [session.tab.title || "Recently closed tab", formatUrl(session.tab.url)].filter(Boolean).join(", "),
    recencyRank: openItems.length + index,
    ...session.tab
  }));
  items = [...openItems, ...closedItems];
}

function render({ preserveSelection = false } = {}) {
  const query = elements.queryInput.value;
  const selectedKey = preserveSelection ? itemKey(ranked[selectedIndex]?.item) : null;
  ranked = rankResults(items, query);
  const preservedIndex = ranked.findIndex((result) => itemKey(result.item) === selectedKey);
  selectedIndex = preserveSelection
    ? preservedIndex >= 0 ? preservedIndex : clamp(selectedIndex, 0, Math.max(0, ranked.length - 1))
    : getSelectedIndex(query);

  elements.resultSummary.textContent = summarizeResults(ranked, query);
  setResultsMessage("");
  const entries = renderResultEntries(ranked);
  elements.results.replaceChildren(...entries);
  renderedRows = [...elements.results.querySelectorAll(".result")];
  elements.results.setAttribute("aria-busy", "false");
  elements.queryInput.setAttribute("aria-expanded", String(Boolean(ranked.length)));

  if (!ranked.length) renderEmpty(query);

  updateSelection();
}

function createItem(item) {
  return {
    ...item,
    searchDocument: item.searchDocument || buildSearchDocument(item)
  };
}

function rankResults(sourceItems, query) {
  const matches = rankItems(sourceItems, query, { maxResults: state.settings.maxResults });
  return groupPrivateResults(matches, state.settings.privateTabDisplayMode).flatMap((group) => group.results);
}

async function loadClosedTabs() {
  if (!state?.settings.includeClosedTabs) return;
  const requestId = ++closedTabsRequestId;

  try {
    const response = await send({ type: "get-closed-tabs", windowId: state.currentWindowId });
    if (requestId !== closedTabsRequestId || !state) return;
    state.closedTabs = response.closedTabs;
    prepareItems();
    render({ preserveSelection: true });
  } catch (error) {
    if (requestId === closedTabsRequestId) showActionError(new Error("Recently closed tabs unavailable. " + error.message));
  }
}

function renderResultEntries(results) {
  const entries = [];
  const groups = groupPrivateResults(results, state.settings.privateTabDisplayMode);
  let index = 0;

  for (const group of groups) {
    if (!group.results.length) continue;
    const container = document.createElement("li");
    container.role = "group";
    container.setAttribute("aria-label", group.heading || "Tabs");
    if (group.heading) container.append(renderSectionHeading(group.heading));
    for (const result of group.results) {
      container.append(renderResult(result, index));
      index += 1;
    }
    entries.push(container);
  }

  return entries;
}

function renderSectionHeading(text) {
  const heading = document.createElement("div");
  heading.className = "result-section";
  heading.role = "presentation";
  heading.textContent = text;
  return heading;
}

function renderResult(result, index) {
  const item = displayItemForResult(result, index);
  const row = document.createElement("div");
  row.id = resultId(index);
  row.className = `result ${item.type === "closed" ? "closed" : ""} ${item.private ? "private-tab" : ""}`;
  row.role = "option";
  row.dataset.index = String(index);
  row.ariaSelected = "false";
  const actionLabel = item.type === "closed" ? "Restore" : "Switch";
  const badgesForItem = buildBadges(item);
  row.setAttribute("aria-label", [item.ariaLabel, ...badgesForItem, actionLabel].filter(Boolean).join(", "));

  const icon = renderIcon(item);
  const text = document.createElement("div");
  text.className = "result-text";

  const title = document.createElement("div");
  const url = document.createElement("div");
  title.className = "title";
  url.className = "url";

  const titleText = item.title || "Untitled";
  const urlText = item.displayUrl || "No URL";
  title.title = titleText;
  url.title = urlText;
  title.append(...highlight(titleText, item.private ? [] : result.fieldRanges?.title || []));
  url.append(...highlight(urlText, item.private ? [] : result.fieldRanges?.url || []));
  text.append(title, url);

  const meta = document.createElement("div");
  meta.className = "row-meta";
  const badges = document.createElement("span");
  badges.className = "badges";
  badges.hidden = !badgesForItem.length;
  badges.append(...badgesForItem.map(renderBadge));
  const action = document.createElement("span");
  action.className = "action";
  action.textContent = actionLabel;
  meta.append(badges, action);

  row.append(icon, text, meta);
  return row;
}

function displayItemForResult(result, index = selectedIndex) {
  const item = result?.item;
  if (!item?.private) return item;
  const tab = privateTabsByKey.get(item.privateKey);
  if (!tab) return item;
  return {
    ...item,
    ...toPrivateTabDisplayItem({
      tab,
      settings: state.settings,
      revealState,
      isSelected: index === selectedIndex
    })
  };
}

function renderIcon(item) {
  if (item.usePrivateFallbackIcon) return renderPrivateIcon();
  if (item.favIconUrl && item.url && /^https?:\/\//i.test(item.url)) {
    const url = new URL(chrome.runtime.getURL("/_favicon/"));
    url.searchParams.set("pageUrl", item.url);
    url.searchParams.set("size", "32");
    const image = document.createElement("img");
    image.className = "favicon";
    image.alt = "";
    image.src = url.href;
    image.addEventListener("error", () => image.replaceWith(renderFallbackIcon(item)));
    return image;
  }
  return renderFallbackIcon(item);
}

function renderPrivateIcon() {
  const fallback = document.createElement("span");
  fallback.className = "fallback-icon private-icon";
  fallback.setAttribute("aria-hidden", "true");
  fallback.textContent = "P";
  return fallback;
}

function renderFallbackIcon(item) {
  const fallback = document.createElement("span");
  fallback.className = "fallback-icon";
  fallback.setAttribute("aria-hidden", "true");
  fallback.textContent = item.type === "closed" ? "↶" : item.private ? "P" : (item.displayUrl || item.title || "T").charAt(0).toUpperCase();
  return fallback;
}

function renderBadge(label) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = label;
  return badge;
}

function buildBadges(item) {
  const badges = [];
  if (state.activeTab && item.type === "tab" && tabKey(item) === tabKey(state.activeTab)) badges.push("Current");
  if (item.type === "closed") badges.push("Recently closed");
  else if (item.showWindow) badges.push(`Window ${item.windowId}`);
  if (item.duplicateOrdinal) badges.push(`#${item.duplicateOrdinal}`);
  if (item.pinned) badges.push("Pinned");
  if (item.audible) badges.push(item.muted ? "Muted" : "Audio");
  if (item.private) {
    if (item.privateIndicator === "icon" || item.privateIndicator === "icon-label") badges.push("Private window");
    if (item.privateIndicator === "label" || item.privateIndicator === "icon-label") badges.push("Private");
  } else if (item.incognito) badges.push("Incognito");
  return badges;
}

function highlight(text, ranges) {
  if (!ranges.length) return [document.createTextNode(text)];
  const nodes = [];
  let position = 0;
  for (const [start, end] of ranges) {
    if (position < start) nodes.push(document.createTextNode(text.slice(position, start)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    nodes.push(mark);
    position = end;
  }
  if (position < text.length) nodes.push(document.createTextNode(text.slice(position)));
  return nodes;
}

async function handleKeyDown(event) {
  if (event.isComposing || !state) return;
  const navigationAction = getPopupNavigationAction(event);
  if (navigationAction) {
    event.preventDefault();
    applyNavigationAction(navigationAction);
  } else if (event.key === "Enter" || shouldActivateSelectionOnSpace(event, elements.queryInput.value)) {
    event.preventDefault();
    await activateSelected();
  } else if (isCtrlChord(event, ["w"])) {
    event.preventDefault();
    await closeSelected();
  } else if (isCtrlChord(event, ["c"])) {
    if (hasInputSelection()) return;
    event.preventDefault();
    await copySelectedUrl();
  } else if (isCtrlChord(event, ["r"]) && state?.settings.privateRevealMode === "manual") {
    event.preventDefault();
    toggleManualPrivateReveal();
  }
}

function applyNavigationAction(action) {
  if (action.type === "move") {
    moveSelection(action.delta);
  } else if (action.position === "first") {
    setSelection(0);
  } else if (action.position === "last") {
    setSelection(ranked.length - 1);
  }
}

function handlePointerMove(event) {
  const row = event.target.closest(".result");
  if (!row) return;
  const index = Number(row.dataset.index);
  if (Number.isFinite(index) && index !== selectedIndex) setSelection(index);
}

async function handleClick(event) {
  const row = event.target.closest(".result");
  if (!row) return;
  selectedIndex = Number(row.dataset.index);
  await activateSelected();
}

function moveSelection(delta) {
  if (!ranked.length) return;
  setSelection(wrapIndex(selectedIndex + delta, ranked.length));
}

function setSelection(index) {
  if (!ranked.length) return;
  const previousIndex = selectedIndex;
  selectedIndex = clamp(index, 0, ranked.length - 1);
  if (state?.settings.privateRevealMode === "selected" && previousIndex !== selectedIndex
    && (ranked[previousIndex]?.item.private || ranked[selectedIndex]?.item.private)) {
    for (const changedIndex of [previousIndex, selectedIndex]) {
      const row = renderResult(ranked[changedIndex], changedIndex);
      renderedRows[changedIndex].replaceWith(row);
      renderedRows[changedIndex] = row;
    }
    updateSelection();
  } else {
    updateSelection();
  }
}

function updateSelection() {
  const selected = ranked[selectedIndex]?.item;
  elements.enterHint.textContent = selected?.type === "closed" ? "Restore" : "Switch";
  elements.enterHint.parentElement.hidden = !selected;
  elements.escapeHint.textContent = elements.queryInput.value ? "Clear search" : "Dismiss";
  elements.copyHint.parentElement.hidden = !selected;
  elements.closeHint.parentElement.hidden = !selected || selected.type === "closed";
  for (const row of renderedRows) row.ariaSelected = "false";
  const selectedRow = renderedRows[selectedIndex];
  if (!selectedRow) {
    elements.queryInput.removeAttribute("aria-activedescendant");
    return;
  }
  selectedRow.ariaSelected = "true";
  elements.queryInput.setAttribute("aria-activedescendant", selectedRow.id);
  selectedRow.scrollIntoView({ block: "nearest" });
}

async function activateSelected() {
  const selected = ranked[selectedIndex]?.item;
  if (!selected) return;

  try {
    if (selected.type === "closed") {
      await send({ type: "restore-closed", sessionId: selected.sessionId });
    } else {
      await send({ type: "activate-tab", tab: selected });
    }
    await closeView();
  } catch (error) {
    showActionError(error);
  }
}

async function closeSelected() {
  const selected = ranked[selectedIndex]?.item;
  if (!selected || selected.type === "closed") return;

  try {
    closedTabsRequestId += 1;
    await send({ type: "close-tab", tab: selected });
    state = await send({ type: "get-state" }).then((response) => response.state);
    prepareItems();
    render({ preserveSelection: true });
    loadClosedTabs();
  } catch (error) {
    showActionError(error);
  }
}

async function copySelectedUrl() {
  const selected = displayItemForResult(ranked[selectedIndex]);
  if (!selected?.copyUrl) {
    elements.resultSummary.textContent = selected?.private
      ? "Private URL hidden. Reveal to copy."
      : "No URL to copy";
    return;
  }
  try {
    await navigator.clipboard.writeText(selected.copyUrl);
    elements.resultSummary.textContent = "Copied URL";
  } catch (error) { showActionError(error); }
}

function toggleManualPrivateReveal() {
  revealState = {
    ...revealState,
    manuallyRevealed: !revealState.manuallyRevealed
  };
  prepareItems();
  render({ preserveSelection: true });
  elements.resultSummary.textContent = revealState.manuallyRevealed
    ? "Private tabs revealed while this switcher is open"
    : "Private tabs hidden";
}

async function addCurrentSiteToExtensionView() {
  try {
    const response = await send({ type: "add-active-site-to-extension-view" });
    state.settings = response.settings;
    elements.extensionViewButton.hidden = true;
    elements.resultSummary.textContent = `Using popup for ${response.host}`;
  } catch (error) {
    showActionError(error);
  }
}

function canAddActiveSite() {
  const url = state?.activeTab?.url || "";
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const host = normalizeHost(url);
    return ![...DEFAULT_EXTENSION_VIEW_HOSTS, ...state.settings.extensionViewHosts].some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

function setQuery(value, { preserveSelection = false } = {}) {
  elements.queryInput.value = value;
  if (!preserveSelection) selectedIndex = 0;
  persistQuery();
}

function clearQuery() {
  setQuery("");
  render();
}

function persistQuery() {
  if (!state.settings.restorePreviousQuery || state.settings.privateTabsEnabled) return;
  const query = elements.queryInput.value;
  queryQueue = queryQueue.then(() => send({ type: "save-query", query })).catch(showActionError);
}

function getSelectedIndex(query) {
  if (!ranked.length) return 0;
  if (query.trim()) return clamp(selectedIndex, 0, ranked.length - 1);
  const activeKey = state.activeTab ? tabKey(state.activeTab) : null;
  const previousIndex = ranked.findIndex((result) => {
    const item = result.item;
    return item.type === "tab" && (!activeKey || tabKey(item) !== activeKey);
  });
  return previousIndex >= 0 ? previousIndex : 0;
}

function summarizeResults(results, query) {
  if (!results.length) return query.trim() ? "No matches" : "No tabs available";
  const openCount = results.filter((result) => result.item.type === "tab").length;
  const closedCount = results.length - openCount;
  if (!query.trim()) {
    return closedCount
      ? `${openCount} open · ${closedCount} recently closed`
      : `${openCount} open ${openCount === 1 ? "tab" : "tabs"}`;
  }
  return `${results.length} ${results.length === 1 ? "match" : "matches"}`;
}

function renderLoading() {
  elements.retryButton.hidden = true;
  elements.resultSummary.textContent = "Loading tabs…";
  elements.results.replaceChildren();
  elements.results.setAttribute("aria-busy", "true");
  elements.queryInput.setAttribute("aria-expanded", "false");
  setResultsMessage("");
}

function renderEmpty(query) {
  setResultsMessage(query.trim() ? "Try a different title or URL." : "");
}

function renderError(error) {
  elements.resultSummary.textContent = "Could not load tabs";
  elements.retryButton.hidden = false;
  elements.results.replaceChildren();
  elements.results.setAttribute("aria-busy", "false");
  elements.queryInput.setAttribute("aria-expanded", "false");
  elements.queryInput.removeAttribute("aria-activedescendant");
  setResultsMessage(error?.message || "Extension message failed", true);
}

function setResultsMessage(message, isError = false) {
  elements.resultsMessage.textContent = message;
  elements.resultsMessage.hidden = !message;
  elements.resultsMessage.classList.toggle("error", isError);
}

function getDuplicateTitles(tabs) {
  const groups = new Map();
  for (const tab of tabs) {
    const title = (tab.title || "Untitled").trim();
    if (!groups.has(title)) groups.set(title, []);
    groups.get(title).push(tab);
  }

  const duplicates = new Map();
  for (const duplicateTabs of groups.values()) {
    if (duplicateTabs.length < 2) continue;
    [...duplicateTabs]
      .sort((left, right) => left.windowId - right.windowId || left.index - right.index)
      .forEach((tab, index) => duplicates.set(tabKey(tab), index + 1));
  }
  return duplicates;
}

function isCtrlChord(event, keys) {
  return (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.shiftKey
    && keys.includes(event.key.toLowerCase());
}

function hasInputSelection() {
  return elements.queryInput.selectionStart !== elements.queryInput.selectionEnd;
}

function resultId(index) {
  return `result-${index}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function send(message) {
  const response = await chrome.runtime.sendMessage({ ...message, token: overlayToken });
  if (!response?.ok) throw new Error(response?.error || "Extension message failed");
  return response;
}

function itemKey(item) {
  return item ? item.type === "closed" ? `closed:${item.sessionId}` : tabKey(item) : null;
}

function schedulePrivateRedaction() {
  clearTimeout(revealTimer);
  if (state.settings.privateRevealMode !== "timed") return;
  const delay = revealState.openedAt + state.settings.privateRevealDurationMinutes * 60_000 - Date.now();
  revealTimer = setTimeout(() => {
    if (!state) return;
    prepareItems();
    render({ preserveSelection: true });
  }, Math.max(0, delay));
}

function showActionError(error) {
  elements.resultSummary.textContent = error?.message || "Action failed";
  elements.retryButton.hidden = false;
}

function clearSensitiveState() {
  clearTimeout(revealTimer);
  closedTabsRequestId += 1;
  state = null;
  items = ranked = renderedRows = [];
  privateTabsByKey.clear();
  elements.results.replaceChildren();
  elements.queryInput.value = "";
}

async function closeView() {
  if (isOverlay) await send({ type: "hide-overlay" });
  else window.close();
  clearSensitiveState();
}
