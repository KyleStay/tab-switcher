import { buildSearchDocument, formatUrl } from "./fuzzy.js";

export const PRIVATE_GENERIC_TITLE = "Private tab";
export const PRIVATE_HIDDEN_URL = "Hidden URL";

export function canUsePrivateTabs({ hasIncognitoAccess = false, settings } = {}) {
  return Boolean(hasIncognitoAccess && settings?.privateTabsEnabled);
}

export function shouldIncludePrivateTabs({ hasIncognitoAccess = false, settings } = {}) {
  return canUsePrivateTabs({ hasIncognitoAccess, settings })
    && settings.privateTabDisplayMode !== "hidden";
}

export function isPrivateTabRevealed({ settings, revealState = {}, isSelected = false, now = Date.now() } = {}) {
  switch (settings?.privateRevealMode) {
    case "session":
      return true;
    case "timed": {
      const openedAt = revealState.openedAt ?? now;
      const durationMs = Math.max(1, settings.privateRevealDurationMinutes || 5) * 60 * 1000;
      return now - openedAt < durationMs;
    }
    case "manual":
      return Boolean(revealState.manuallyRevealed);
    case "selected":
      return Boolean(isSelected);
    case "never":
    default:
      return false;
  }
}

export function toPrivateTabDisplayItem({ tab, settings, revealState = {}, isSelected = false, now = Date.now() }) {
  const revealed = isPrivateTabRevealed({ settings, revealState, isSelected, now });
  const rawTitle = tab.title || "Untitled";
  const rawUrl = tab.url || "";
  const rawDomain = getDomain(rawUrl);
  const visibleTitle = settings.privateMaskTitle && !revealed ? PRIVATE_GENERIC_TITLE : rawTitle;
  const hideUrl = settings.privateMaskUrl && !revealed;
  const hideDomain = settings.privateMaskDomain && !revealed;
  const visibleUrl = hideUrl
    ? hideDomain ? PRIVATE_HIDDEN_URL : rawDomain
    : hideDomain ? formatUrl(rawUrl).replace(rawDomain, "Hidden domain") : formatUrl(rawUrl);
  const visibleDomain = settings.privateMaskDomain && !revealed ? PRIVATE_HIDDEN_URL : rawDomain;
  const searchHiddenContent = Boolean(settings.privateSearchHiddenContent);
  const searchItem = searchHiddenContent
    ? { title: rawTitle, displayUrl: formatUrl(rawUrl), url: rawUrl }
    : {
      title: `${PRIVATE_GENERIC_TITLE} private incognito ${settings.privateMaskTitle ? "" : rawTitle}`,
      displayUrl: settings.privateMaskUrl
        ? settings.privateMaskDomain ? PRIVATE_HIDDEN_URL : rawDomain
        : settings.privateMaskDomain ? formatUrl(rawUrl).replace(rawDomain, "Hidden domain") : formatUrl(rawUrl),
      url: ""
    };
  const accessibleBits = [
    "Private tab",
    settings.privateMaskTitle && !revealed ? "hidden title" : visibleTitle,
    hideUrl && hideDomain ? "hidden URL" : visibleUrl
  ];

  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index ?? 0,
    type: "tab",
    private: true,
    incognito: true,
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    audible: Boolean(tab.audible),
    muted: Boolean(tab.mutedInfo?.muted || tab.muted),
    title: visibleTitle,
    url: hideUrl || hideDomain ? "" : rawUrl,
    displayUrl: visibleUrl,
    displayDomain: visibleDomain,
    favIconUrl: settings.privateMaskFavicon && !revealed ? "" : tab.favIconUrl || "",
    usePrivateFallbackIcon: settings.privateMaskFavicon && !revealed,
    copyUrl: hideUrl || hideDomain ? "" : rawUrl,
    privateIndicator: settings.privateTabIndicator,
    privateRevealed: revealed,
    ariaLabel: accessibleBits.filter(Boolean).join(", "),
    searchDocument: buildSearchDocument(searchItem)
  };
}

export function groupPrivateResults(results = [], mode = "integrated") {
  if (mode !== "grouped") return [{ heading: null, results }];
  const openResults = results.filter((result) => !result.item.private && result.item.type !== "closed");
  const privateResults = results.filter((result) => result.item.private);
  const closedResults = results.filter((result) => result.item.type === "closed");

  if (!privateResults.length) return [{ heading: null, results }];

  return [
    { heading: null, results: openResults },
    { heading: "Private tabs", results: privateResults },
    { heading: null, results: closedResults }
  ].filter((group) => group.results.length);
}

export function clearPrivateTabState() {
  return { openedAt: Date.now(), manuallyRevealed: false };
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
