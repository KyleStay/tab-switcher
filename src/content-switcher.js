(() => {
  if (globalThis.__tabSwitcherOverlayLoaded) return;
  globalThis.__tabSwitcherOverlayLoaded = true;

  let buildSearchDocument;
  let rankItems;
  let getPopupNavigationAction;
  let shouldActivateSelectionOnSpace;
  let isShowOverlayMessage;
  const ROOT_ID = "tab-switcher-overlay-root";
  const QUERY_STORAGE_KEY = "tabSwitcher.overlayLastQuery";
  const isMac = navigator.platform.toLowerCase().includes("mac");
  let host = null;
  let root = null;
  let elements = null;
  let state = null;
  let items = [];
  let ranked = [];
  let selectedIndex = 0;
  let renderedRows = [];
  let closedTabsRequestId = 0;
  let previouslyFocused = null;
  const readyPromise = initialize();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isShowOverlayRequest(message)) return false;
    readyPromise.then(() => {
      if (!isShowOverlayMessage(message)) throw new Error("Unexpected overlay message");
      return showOverlay();
    }).then((handled) => {
      if (handled === false) return;
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
    return true;
  });

  function isShowOverlayRequest(message) {
    return message?.type === "tab-switcher:show-overlay";
  }

  async function initialize() {
    const [fuzzy, shortcuts, messages] = await Promise.all([
      import(chrome.runtime.getURL("src/core/fuzzy.js")),
      import(chrome.runtime.getURL("src/core/shortcuts.js")),
      import(chrome.runtime.getURL("src/core/messages.js"))
    ]);
    buildSearchDocument = fuzzy.buildSearchDocument;
    rankItems = fuzzy.rankItems;
    getPopupNavigationAction = shortcuts.getPopupNavigationAction;
    shouldActivateSelectionOnSpace = shortcuts.shouldActivateSelectionOnSpace;
    isShowOverlayMessage = messages.isShowOverlayMessage;
  }

  async function showOverlay() {
    ensureDom();
    previouslyFocused = document.activeElement;
    state = null;
    items = [];
    ranked = [];
    selectedIndex = 0;
    renderedRows = [];
    host.hidden = false;
    renderLoading();
    elements.queryInput.focus({ preventScroll: true });

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

  function ensureDom() {
    host = document.getElementById(ROOT_ID);
    if (host) {
      root = host.shadowRoot;
      elements = getElements(root);
      return;
    }

    host = document.createElement("div");
    host.id = ROOT_ID;
    host.hidden = true;
    root = host.attachShadow({ mode: "open" });
    root.append(createStyle(), createShell());
    document.documentElement.append(host);
    elements = getElements(root);
    bindEvents();
  }

  function createShell() {
    const wrapper = document.createElement("div");
    wrapper.className = "backdrop";
    wrapper.innerHTML = `
      <main class="shell" data-density="compact" role="dialog" aria-modal="true" aria-label="Tab Switcher">
        <label class="search" for="queryInput">
          <span class="prompt" aria-hidden="true">&gt;</span>
          <span class="sr-only">Search open and recently closed tabs</span>
          <input id="queryInput" type="search" autocomplete="off" spellcheck="false" placeholder="Search tabs" role="combobox" aria-autocomplete="list" aria-controls="results" aria-expanded="true">
        </label>
        <div class="meta">
          <span id="resultSummary" role="status" aria-live="polite">Loading tabs...</span>
          <div class="meta-actions">
            <button type="button" id="extensionViewButton">Use popup here</button>
            <button type="button" id="popupButton">Popup</button>
          </div>
        </div>
        <ul class="results" id="results" role="listbox" aria-label="Tabs" aria-busy="true"></ul>
        <div class="empty results-message" id="resultsMessage" role="status" aria-live="polite" hidden></div>
        <footer class="hints">
          <span>Enter switch</span>
          <span id="cycleHint">Arrows cycle</span>
          <span>Esc clear/close</span>
          <span id="copyHint">Ctrl+C copy URL</span>
          <span id="closeHint">Ctrl+W close tab</span>
        </footer>
      </main>
    `;
    return wrapper;
  }

  function createStyle() {
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        color-scheme: light dark;
        --bg: #1f2328;
        --panel: #252a31;
        --panel-2: #2d333b;
        --text: #e6edf3;
        --muted: #8b949e;
        --accent: #4ea1ff;
        --accent-soft: rgba(78, 161, 255, 0.18);
        --border: #3d444d;
        --danger: #ff7b72;
        --mark: #ffd866;
        --closed: #c69026;
        --shadow: 0 18px 48px rgba(0, 0, 0, 0.36);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      :host([hidden]) { display: none; }
      .backdrop {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding-top: max(48px, 10vh);
        background: rgba(0, 0, 0, 0.18);
      }
      .shell {
        width: min(720px, calc(100vw - 32px));
        max-height: min(600px, calc(100vh - 48px));
        background: var(--panel);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 8px;
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      @media (prefers-color-scheme: light) {
        :host {
          --bg: #f5f7fa;
          --panel: #ffffff;
          --panel-2: #eef2f7;
          --text: #17202a;
          --muted: #667085;
          --accent: #0969da;
          --accent-soft: rgba(9, 105, 218, 0.12);
          --border: #d0d7de;
          --shadow: 0 18px 42px rgba(31, 35, 40, 0.16);
          --closed: #825f00;
        }
      }
      :host([data-theme="dark"]) {
        color-scheme: dark;
        --bg: #1f2328;
        --panel: #252a31;
        --panel-2: #2d333b;
        --text: #e6edf3;
        --muted: #8b949e;
        --accent: #4ea1ff;
        --accent-soft: rgba(78, 161, 255, 0.18);
        --border: #3d444d;
        --shadow: 0 18px 48px rgba(0, 0, 0, 0.36);
        --closed: #c69026;
      }
      :host([data-theme="light"]) {
        color-scheme: light;
        --bg: #f5f7fa;
        --panel: #ffffff;
        --panel-2: #eef2f7;
        --text: #17202a;
        --muted: #667085;
        --accent: #0969da;
        --accent-soft: rgba(9, 105, 218, 0.12);
        --border: #d0d7de;
        --shadow: 0 18px 42px rgba(31, 35, 40, 0.16);
        --closed: #825f00;
      }
      *, *::before, *::after { box-sizing: border-box; }
      button, input { font: inherit; }
      button {
        height: 28px;
        padding: 0 10px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--panel-2);
        color: var(--text);
        cursor: pointer;
        white-space: nowrap;
      }
      button:hover { border-color: var(--accent); }
      button[hidden] { display: none; }
      button:focus-visible, input:focus-visible {
        outline: none;
        border-color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent-soft);
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
      }
      .search {
        display: grid;
        grid-template-columns: 24px 1fr;
        align-items: center;
        gap: 8px;
        padding: 12px 14px 8px;
      }
      .prompt {
        color: var(--accent);
        font-size: 24px;
        line-height: 1;
        text-align: center;
      }
      #queryInput {
        width: 100%;
        height: 40px;
        border: 1px solid var(--border);
        border-radius: 6px;
        outline: none;
        background: var(--bg);
        color: var(--text);
        padding: 0 12px;
        font-size: 15px;
      }
      .meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0 14px 8px 46px;
        color: var(--muted);
        font-size: 12px;
      }
      .meta span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .meta-actions {
        display: flex;
        flex: 0 0 auto;
        gap: 8px;
      }
      .results {
        margin: 0;
        padding: 0 8px 8px;
        list-style: none;
        height: min(396px, calc(100vh - 204px));
        min-height: 220px;
        overflow-y: auto;
      }
      .result {
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        min-height: 48px;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid transparent;
        position: relative;
      }
      .shell[data-density="comfy"] .result {
        min-height: 58px;
        padding-block: 8px;
      }
      .result[aria-selected="true"] {
        background: var(--accent-soft);
        border-color: rgba(78, 161, 255, 0.38);
      }
      .result[aria-selected="true"]::before {
        content: "";
        position: absolute;
        left: 0;
        top: 7px;
        bottom: 7px;
        width: 3px;
        border-radius: 999px;
        background: var(--accent);
      }
      .active-tab .title { color: var(--muted); }
      .favicon, .fallback-icon {
        width: 18px;
        height: 18px;
        border-radius: 4px;
      }
      .fallback-icon {
        display: grid;
        place-items: center;
        background: var(--panel-2);
        color: var(--muted);
        font-size: 11px;
      }
      .result-text { min-width: 0; }
      .title, .url {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.35;
      }
      .title { font-size: 13px; }
      .url {
        color: var(--muted);
        font-size: 12px;
      }
      mark {
        background: transparent;
        color: var(--mark);
        font-weight: 650;
      }
      .row-meta {
        display: flex;
        gap: 6px;
        align-items: center;
        justify-content: flex-end;
        min-width: 96px;
        max-width: min(220px, 30%);
        overflow: hidden;
      }
      .action {
        flex: 0 0 auto;
        color: var(--muted);
        font-size: 11px;
        white-space: nowrap;
      }
      .badge {
        border: 1px solid var(--border);
        border-radius: 6px;
        min-width: 0;
        padding: 2px 6px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--muted);
        font-size: 11px;
      }
      .closed { border-left-color: var(--closed); }
      .closed .fallback-icon { color: var(--closed); }
      .empty {
        display: grid;
        place-items: center;
        min-height: 220px;
        color: var(--muted);
        font-size: 13px;
        text-align: center;
      }
      .results-message[hidden], .results:empty { display: none; }
      .error { color: var(--danger); padding: 24px; }
      .hints {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        padding: 8px 14px 12px;
        border-top: 1px solid var(--border);
        color: var(--muted);
        font-size: 11px;
      }
      .hints span { white-space: nowrap; }
    `;
    return style;
  }

  function getElements(scope) {
    return {
      shell: scope.querySelector(".shell"),
      queryInput: scope.querySelector("#queryInput"),
      resultSummary: scope.querySelector("#resultSummary"),
      results: scope.querySelector("#results"),
      resultsMessage: scope.querySelector("#resultsMessage"),
      popupButton: scope.querySelector("#popupButton"),
      extensionViewButton: scope.querySelector("#extensionViewButton"),
      cycleHint: scope.querySelector("#cycleHint"),
      copyHint: scope.querySelector("#copyHint"),
      closeHint: scope.querySelector("#closeHint")
    };
  }

  function bindEvents() {
    root.addEventListener("keydown", handleRootKeyDown);
    elements.queryInput.addEventListener("input", () => {
      if (!state) return;
      selectedIndex = 0;
      persistQuery();
      render();
    });
    elements.queryInput.addEventListener("keydown", handleKeyDown);
    elements.results.addEventListener("mousemove", handlePointerMove);
    elements.results.addEventListener("click", handleClick);
    elements.popupButton.addEventListener("click", async () => {
      hideOverlay();
      await send({ type: "open-switcher-popup" });
    });
    elements.extensionViewButton.addEventListener("click", addCurrentSiteToExtensionView);
    root.querySelector(".backdrop").addEventListener("mousedown", (event) => {
      if (event.target.classList.contains("backdrop")) hideOverlay();
    });
  }

  function handleRootKeyDown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (elements.queryInput.value && state) clearQuery();
    else hideOverlay();
  }

  function applySettings() {
    elements.shell.dataset.density = state.settings.density;
    host.dataset.theme = state.settings.theme === "system" ? "" : state.settings.theme;
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

  function createItem(item) {
    return {
      ...item,
      searchDocument: buildSearchDocument(item)
    };
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

  async function loadClosedTabs() {
    if (!state?.settings.includeClosedTabs) return;
    const requestId = ++closedTabsRequestId;
    try {
      const response = await send({ type: "get-closed-tabs" });
      if (requestId !== closedTabsRequestId || !state) return;
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
    title.append(...highlight(item.title || "Untitled", result.fieldRanges?.title || []));
    url.append(...highlight(item.displayUrl || "No URL", result.fieldRanges?.url || []));
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
    if (action.type === "move") moveSelection(action.delta);
    else if (action.position === "first") setSelection(0);
    else if (action.position === "last") setSelection(ranked.length - 1);
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
      if (selected.type === "closed") await send({ type: "restore-closed", sessionId: selected.sessionId });
      else await send({ type: "activate-tab", tab: selected });
      hideOverlay();
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
      await send({ type: "add-active-site-to-extension-view" });
      hideOverlay();
      await send({ type: "open-switcher-popup" });
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

  function hideOverlay() {
    closedTabsRequestId += 1;
    state = null;
    if (host) host.hidden = true;
    if (previouslyFocused?.focus) {
      try {
        previouslyFocused.focus({ preventScroll: true });
      } catch {
        // Focus restoration is best-effort because the page may have changed.
      }
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
    elements.resultSummary.textContent = "Loading tabs...";
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
    return `tab-switcher-result-${index}`;
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
})();
