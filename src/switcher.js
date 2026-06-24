import { STORAGE_KEYS } from "./core/defaults.js";
import { buildSearchDocument, rankItems } from "./core/fuzzy.js";
import { getPopupNavigationAction, shouldActivateSelectionOnSpace } from "./core/shortcuts.js";

const QUERY_STORAGE_KEY = STORAGE_KEYS.lastQuery;
const isMac = navigator.platform.toLowerCase().includes("mac");

const elements = {
  shell: document.querySelector(".shell"),
  onboarding: document.querySelector("#onboarding"),
  dismissOnboardingButton: document.querySelector("#dismissOnboardingButton"),
  shortcutSettingsButton: document.querySelector("#shortcutSettingsButton"),
  optionsButton: document.querySelector("#optionsButton"),
  queryInput: document.querySelector("#queryInput"),
  resultSummary: document.querySelector("#resultSummary"),
  results: document.querySelector("#results"),
  resultsMessage: document.querySelector("#resultsMessage"),
  extensionViewButton: document.querySelector("#extensionViewButton"),
  cycleHint: document.querySelector("#cycleHint"),
  copyHint: document.querySelector("#copyHint"),
  closeHint: document.querySelector("#closeHint")
};

let state = null;
let items = [];
let ranked = [];
let selectedIndex = 0;
let renderedRows = [];
let closedTabsRequestId = 0;

init();

async function init() {
  bindGlobalEvents();
  bindEvents();
  renderLoading();
  elements.queryInput.focus();

  try {
    state = await send({ type: "get-state" }).then((response) => response.state);
    applySettings();
    setQuery(state.settings.restorePreviousQuery ? sessionStorage.getItem(QUERY_STORAGE_KEY) || "" : "", {
      preserveSelection: true
    });
    prepareItems();
    render();
    elements.queryInput.select();
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
      else window.close();
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
  elements.optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.extensionViewButton.addEventListener("click", addCurrentSiteToExtensionView);
  elements.shortcutSettingsButton.addEventListener("click", () => send({ type: "open-shortcut-settings" }));
  elements.dismissOnboardingButton.addEventListener("click", async () => {
    elements.onboarding.hidden = true;
    await send({ type: "mark-first-run-seen" });
  });
}

function applySettings() {
  elements.shell.dataset.density = state.settings.density;
  document.documentElement.dataset.theme = state.settings.theme === "system" ? "" : state.settings.theme;
  elements.onboarding.hidden = state.firstRunSeen;
  const modifier = isMac ? "Cmd" : "Ctrl";
  elements.cycleHint.textContent = `Tab, arrows, ${modifier}+J/K cycle`;
  elements.copyHint.textContent = `${modifier}+C copy URL`;
  elements.closeHint.textContent = `${modifier}+W close tab`;
  elements.extensionViewButton.hidden = !canAddActiveSite();
}

function prepareItems() {
  const duplicateTitles = getDuplicateTitles(state.tabs);
  const windowIds = new Set(state.tabs.map((tab) => tab.windowId));
  const openItems = state.tabs.map((tab, index) => createItem({
    type: "tab",
    displayUrl: formatUrl(tab.url),
    duplicateOrdinal: duplicateTitles.get(tabKey(tab)),
    recencyRank: index,
    showWindow: windowIds.size > 1,
    ...tab
  }));
  const closedItems = state.closedTabs.map((session, index) => createItem({
    type: "closed",
    sessionId: session.sessionId,
    displayUrl: formatUrl(session.tab.url),
    recencyRank: openItems.length + index,
    ...session.tab
  }));
  items = [...openItems, ...closedItems];
}

function render() {
  const query = elements.queryInput.value;
  ranked = rankItems(items, query, { maxResults: state.settings.maxResults });
  selectedIndex = getSelectedIndex(query);

  elements.resultSummary.textContent = summarizeResults(ranked, query);
  setResultsMessage("");
  renderedRows = ranked.map(renderResult);
  elements.results.replaceChildren(...renderedRows);
  elements.results.setAttribute("aria-busy", "false");
  elements.queryInput.setAttribute("aria-expanded", String(Boolean(ranked.length)));

  if (!ranked.length) renderEmpty(query);

  updateSelection();
}

function createItem(item) {
  return {
    ...item,
    searchDocument: buildSearchDocument(item)
  };
}

async function loadClosedTabs() {
  if (!state?.settings.includeClosedTabs) return;
  const requestId = ++closedTabsRequestId;

  try {
    const response = await send({ type: "get-closed-tabs" });
    if (requestId !== closedTabsRequestId) return;
    state.closedTabs = response.closedTabs;
    prepareItems();
    render();
  } catch {
    // Closed tabs are progressive enrichment; open-tab switching should stay ready.
  }
}

function renderResult(result, index) {
  const item = result.item;
  const row = document.createElement("li");
  row.id = resultId(index);
  row.className = `result ${item.type === "closed" ? "closed" : ""} ${item.active ? "active-tab" : ""}`;
  row.role = "option";
  row.dataset.index = String(index);
  row.ariaSelected = "false";

  const icon = renderIcon(item);
  const text = document.createElement("div");
  text.className = "result-text";

  const title = document.createElement("div");
  const url = document.createElement("div");
  title.className = "title";
  url.className = "url";

  const titleText = item.title || "Untitled";
  const urlText = item.displayUrl || "No URL";
  title.append(...highlight(titleText, result.fieldRanges?.title || []));
  url.append(...highlight(urlText, result.fieldRanges?.url || []));
  text.append(title, url);

  const meta = document.createElement("div");
  meta.className = "row-meta";
  const action = document.createElement("span");
  action.className = "action";
  action.textContent = item.type === "closed" ? "Restore" : item.active ? "Current" : "Switch";
  meta.append(action, ...buildBadges(item).map(renderBadge));

  row.append(icon, text, meta);
  return row;
}

function renderIcon(item) {
  if (item.favIconUrl) {
    const image = document.createElement("img");
    image.className = "favicon";
    image.alt = "";
    image.src = item.favIconUrl;
    image.addEventListener("error", () => image.replaceWith(renderFallbackIcon(item)));
    return image;
  }
  return renderFallbackIcon(item);
}

function renderFallbackIcon(item) {
  const fallback = document.createElement("span");
  fallback.className = "fallback-icon";
  fallback.setAttribute("aria-hidden", "true");
  fallback.textContent = item.type === "closed" ? "R" : "T";
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
  if (item.type === "closed") badges.push("Recently closed");
  else if (item.showWindow) badges.push(`Window ${item.windowId}`);
  if (item.duplicateOrdinal) badges.push(`#${item.duplicateOrdinal}`);
  if (item.pinned) badges.push("Pinned");
  if (item.audible) badges.push(item.muted ? "Muted" : "Audio");
  if (item.incognito) badges.push("Incognito");
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
  selectedIndex = clamp(index, 0, ranked.length - 1);
  updateSelection();
}

function updateSelection() {
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
    window.close();
  } catch (error) {
    renderError(error);
  }
}

async function closeSelected() {
  const selected = ranked[selectedIndex]?.item;
  if (!selected || selected.type === "closed") return;

  try {
    await send({ type: "close-tab", tab: selected });
    state = await send({ type: "get-state" }).then((response) => response.state);
    prepareItems();
    render();
    loadClosedTabs();
  } catch (error) {
    renderError(error);
  }
}

async function copySelectedUrl() {
  const selected = ranked[selectedIndex]?.item;
  if (!selected?.url) return;
  await navigator.clipboard.writeText(selected.url);
  elements.resultSummary.textContent = "Copied URL";
}

async function addCurrentSiteToExtensionView() {
  try {
    const response = await send({ type: "add-active-site-to-extension-view" });
    state.settings = response.settings;
    elements.extensionViewButton.hidden = true;
    elements.resultSummary.textContent = `Using popup for ${response.host}`;
  } catch (error) {
    renderError(error);
  }
}

function canAddActiveSite() {
  const url = state?.activeTab?.url || "";
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return !state.settings.extensionViewHosts.includes(host);
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
  if (!state?.settings.restorePreviousQuery) return;
  const query = elements.queryInput.value;
  if (query) sessionStorage.setItem(QUERY_STORAGE_KEY, query);
  else sessionStorage.removeItem(QUERY_STORAGE_KEY);
}

function getSelectedIndex(query) {
  if (!ranked.length) return 0;
  if (query.trim()) return clamp(selectedIndex, 0, ranked.length - 1);
  const previousIndex = ranked.findIndex((result) => result.item.type === "tab" && !result.item.active);
  return previousIndex >= 0 ? previousIndex : 0;
}

function summarizeResults(results, query) {
  if (!results.length) return query.trim() ? "No matches" : "No tabs available";
  const openCount = results.filter((result) => result.item.type === "tab").length;
  const closedCount = results.length - openCount;
  if (!query.trim()) {
    return closedCount
      ? `${openCount} recent open, ${closedCount} recently closed`
      : `${openCount} recent ${openCount === 1 ? "tab" : "tabs"}`;
  }
  return `${results.length} ${results.length === 1 ? "match" : "matches"}`;
}

function renderLoading() {
  elements.results.replaceChildren();
  elements.results.setAttribute("aria-busy", "true");
  elements.queryInput.setAttribute("aria-expanded", "false");
  setResultsMessage("Loading tabs...");
}

function renderEmpty(query) {
  setResultsMessage(query.trim() ? "No matching tabs" : "No tabs available yet");
}

function renderError(error) {
  elements.resultSummary.textContent = "Could not load tabs";
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

function formatUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url || "No URL";
  }
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

function tabKey(tab) {
  return `${tab.windowId}:${tab.id}`;
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

function wrapIndex(index, length) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension message failed");
  return response;
}
