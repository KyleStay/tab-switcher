import { normalizeHostList } from "./defaults.js";

export const MESSAGE_TYPES = {
  showOverlay: "tab-switcher:show-overlay",
  overlayReady: "tab-switcher:overlay-ready"
};

export const LAUNCH_MODES = ["hybrid", "overlay", "popup"];
export const DEFAULT_EXTENSION_VIEW_HOSTS = [
  "airtable.com",
  "app.asana.com",
  "app.clickup.com",
  "app.diagrams.net",
  "app.slack.com",
  "app.todoist.com",
  "atlassian.net",
  "basecamp.com",
  "calendar.google.com",
  "canva.com",
  "chat.google.com",
  "chatgpt.com",
  "claude.ai",
  "codepen.io",
  "codesandbox.io",
  "colab.research.google.com",
  "discord.com",
  "docs.google.com",
  "drive.google.com",
  "dropbox.com",
  "excalidraw.com",
  "figma.com",
  "github.com",
  "gitlab.com",
  "gmail.com",
  "keep.google.com",
  "linear.app",
  "lightning.force.com",
  "mail.google.com",
  "mail.proton.me",
  "meet.google.com",
  "miro.com",
  "monday.com",
  "notion.so",
  "office.com",
  "onedrive.live.com",
  "outlook.live.com",
  "outlook.office.com",
  "proton.me",
  "replit.com",
  "sharepoint.com",
  "stackblitz.com",
  "teams.microsoft.com",
  "trello.com",
  "web.telegram.org",
  "web.whatsapp.com",
  "web.skype.com",
  "www.figma.com",
  "www.notion.so",
  "www.overleaf.com",
  "salesforce.com",
  "zendesk.com",
  "zoom.us"
];

export function shouldTryOverlay(launchMode) {
  return launchMode === "hybrid" || launchMode === "overlay";
}

export function shouldFallbackToPopup(launchMode) {
  return launchMode === "hybrid" || launchMode === "popup";
}

export function canUseOverlayOnTab(tab, settings = {}) {
  if (!tab?.id || tab.status === "loading") return false;
  return isInjectableUrl(tab.url) && !isShortcutHeavyAppUrl(tab.url, settings);
}

export function createShowOverlayMessage({ reason = "action" } = {}) {
  return {
    type: MESSAGE_TYPES.showOverlay,
    reason
  };
}

export function isShowOverlayMessage(message) {
  return message?.type === MESSAGE_TYPES.showOverlay;
}

function isInjectableUrl(url = "") {
  return /^https?:\/\//i.test(url) || /^file:\/\//i.test(url);
}

function isShortcutHeavyAppUrl(url = "", settings = {}) {
  try {
    const { hostname } = new URL(url);
    return hostMatchesAny(hostname, DEFAULT_EXTENSION_VIEW_HOSTS)
      || hostMatchesAny(hostname, settings.extensionViewHosts);
  } catch {
    return false;
  }
}

function hostMatchesAny(hostname, hosts) {
  return normalizeHostList(hosts).some((host) => hostname === host || hostname.endsWith(`.${host}`));
}
