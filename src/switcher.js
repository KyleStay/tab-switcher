import { rankItems } from "./core/fuzzy.js";

const elements = {
  shell: document.querySelector(".shell"),
  onboarding: document.querySelector("#onboarding"),
  dismissOnboardingButton: document.querySelector("#dismissOnboardingButton"),
  shortcutSettingsButton: document.querySelector("#shortcutSettingsButton"),
  optionsButton: document.querySelector("#optionsButton"),
  queryInput: document.querySelector("#queryInput"),
  resultSummary: document.querySelector("#resultSummary"),
  results: document.querySelector("#results")
};

let state = null;
let ranked = [];
let selectedIndex = 0;
let lastQuery = sessionStorage.getItem("tabSwitcher.lastQuery") || "";

init();

async function init() {
  state = await send({ type: "get-state" }).then((response) => response.state);
  applySettings();
  elements.queryInput.value = state.settings.restorePreviousQuery ? lastQuery : "";
  elements.queryInput.focus();
  elements.queryInput.select();
  bindEvents();
  render();
}

function bindEvents() {
  elements.queryInput.addEventListener("input", () => {
    selectedIndex = 0;
    if (state.settings.restorePreviousQuery) {
      sessionStorage.setItem("tabSwitcher.lastQuery", elements.queryInput.value);
    }
    render();
  });

  elements.queryInput.addEventListener("keydown", handleKeyDown);
  elements.results.addEventListener("mousemove", handlePointerMove);
  elements.results.addEventListener("click", handleClick);
  elements.optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.shortcutSettingsButton.addEventListener("click", () => send({ type: "open-shortcut-settings" }));
  elements.dismissOnboardingButton.addEventListener("click", async () => {
    elements.onboarding.hidden = true;
    await send({ type: "mark-first-run-seen" });
  });
}

function applySettings() {
  elements.shell.dataset.density = state.settings.density;
  if (state.settings.theme !== "system") document.documentElement.dataset.theme = state.settings.theme;
  elements.onboarding.hidden = state.firstRunSeen && !hasMissingShortcut();
}

function render() {
  const query = elements.queryInput.value;
  const duplicateTitles = getDuplicateTitles(state.tabs);
  const openItems = state.tabs.map((tab) => ({
    type: "tab",
    duplicateOrdinal: duplicateTitles.get(tabKey(tab)),
    ...tab
  }));
  const closedItems = state.closedTabs.map((session) => ({
    type: "closed",
    sessionId: session.sessionId,
    ...session.tab
  }));
  const allItems = [...openItems, ...closedItems];
  ranked = rankItems(allItems, query, { maxResults: state.settings.maxResults });
  selectedIndex = clamp(selectedIndex, 0, Math.max(0, ranked.length - 1));

  elements.resultSummary.textContent = summarizeResults(ranked.length, query);
  elements.results.replaceChildren(...ranked.map(renderResult));

  if (!ranked.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = query.trim() ? "No matching tabs" : "No tabs available yet";
    elements.results.append(empty);
  }

  scrollSelectedIntoView();
}

function renderResult(result, index) {
  const item = result.item;
  const row = document.createElement("li");
  row.className = `result ${item.type === "closed" ? "closed" : ""}`;
  row.role = "option";
  row.dataset.index = String(index);
  row.ariaSelected = String(index === selectedIndex);

  const icon = renderIcon(item);
  const text = document.createElement("div");
  const title = document.createElement("div");
  const url = document.createElement("div");
  title.className = "title";
  url.className = "url";
  const titleText = item.title || "Untitled";
  const urlText = formatUrl(item.url);
  title.append(...highlight(titleText, result.ranges, 0));
  url.append(...highlight(urlText, result.ranges, titleText.length + 1));
  text.append(title, url);

  const badges = document.createElement("div");
  badges.className = "badges";
  badges.append(...buildBadges(item).map((label) => {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = label;
    return badge;
  }));

  row.append(icon, text, badges);
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
  fallback.textContent = item.type === "closed" ? "↺" : "T";
  return fallback;
}

function buildBadges(item) {
  const badges = [];
  if (item.type === "closed") badges.push("Closed");
  else badges.push(`W${item.windowId}`);
  if (item.active) badges.push("Active");
  if (item.duplicateOrdinal) badges.push(`#${item.duplicateOrdinal}`);
  if (item.pinned) badges.push("Pinned");
  if (item.incognito) badges.push("Incognito");
  if (item.groupId && item.groupId !== -1) badges.push(`Group ${item.groupId}`);
  return badges;
}

function highlight(text, ranges, offset = 0) {
  if (!ranges.length) return [document.createTextNode(text)];
  const nodes = [];
  let position = 0;
  for (const [start, end] of ranges) {
    const localStart = start - offset;
    const localEnd = end - offset;
    if (localEnd <= 0 || localStart >= text.length) continue;
    const clampedStart = Math.max(0, localStart);
    const clampedEnd = Math.min(text.length, localEnd);
    if (position < clampedStart) nodes.push(document.createTextNode(text.slice(position, clampedStart)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(clampedStart, clampedEnd);
    nodes.push(mark);
    position = clampedEnd;
  }
  if (position < text.length) nodes.push(document.createTextNode(text.slice(position)));
  return nodes;
}

async function handleKeyDown(event) {
  if (event.key === "ArrowDown" || isCtrlChord(event, ["n", "j"])) {
    event.preventDefault();
    moveSelection(1);
  } else if (event.key === "ArrowUp" || isCtrlChord(event, ["p", "k"])) {
    event.preventDefault();
    moveSelection(-1);
  } else if (event.key === "PageDown") {
    event.preventDefault();
    moveSelection(8);
  } else if (event.key === "PageUp") {
    event.preventDefault();
    moveSelection(-8);
  } else if (event.key === "Home") {
    event.preventDefault();
    selectedIndex = 0;
    render();
  } else if (event.key === "End") {
    event.preventDefault();
    selectedIndex = ranked.length - 1;
    render();
  } else if (event.key === "Enter") {
    event.preventDefault();
    await activateSelected();
  } else if (event.key === "Escape") {
    event.preventDefault();
    if (elements.queryInput.value) {
      elements.queryInput.value = "";
      render();
    } else {
      window.close();
    }
  } else if (isCtrlChord(event, ["w"])) {
    event.preventDefault();
    await closeSelected();
  } else if (isCtrlChord(event, ["c"])) {
    event.preventDefault();
    await copySelectedUrl();
  }
}

function handlePointerMove(event) {
  const row = event.target.closest(".result");
  if (!row) return;
  const index = Number(row.dataset.index);
  if (Number.isFinite(index) && index !== selectedIndex) {
    selectedIndex = index;
    render();
  }
}

async function handleClick(event) {
  const row = event.target.closest(".result");
  if (!row) return;
  selectedIndex = Number(row.dataset.index);
  await activateSelected();
}

function moveSelection(delta) {
  if (!ranked.length) return;
  selectedIndex = clamp(selectedIndex + delta, 0, ranked.length - 1);
  render();
}

async function activateSelected() {
  const selected = ranked[selectedIndex]?.item;
  if (!selected) return;

  if (selected.type === "closed") {
    await send({ type: "restore-closed", sessionId: selected.sessionId });
  } else {
    await send({ type: "activate-tab", tab: selected });
  }
  window.close();
}

async function closeSelected() {
  const selected = ranked[selectedIndex]?.item;
  if (!selected || selected.type === "closed") return;
  await send({ type: "close-tab", tab: selected });
  state = await send({ type: "get-state" }).then((response) => response.state);
  render();
}

async function copySelectedUrl() {
  const selected = ranked[selectedIndex]?.item;
  if (!selected?.url) return;
  await navigator.clipboard.writeText(selected.url);
  elements.resultSummary.textContent = "Copied URL";
}

function summarizeResults(count, query) {
  if (!query.trim()) return `${count} recent ${count === 1 ? "tab" : "tabs"}`;
  return `${count} ${count === 1 ? "match" : "matches"}`;
}

function scrollSelectedIntoView() {
  elements.results.querySelector('[aria-selected="true"]')?.scrollIntoView({
    block: "nearest"
  });
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
  return (event.ctrlKey || event.metaKey) && keys.includes(event.key.toLowerCase());
}

function hasMissingShortcut() {
  return state.commands.some((command) => command.name === "_execute_action" && !command.shortcut);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Extension message failed");
  return response;
}
