import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXTENSION_VIEW_HOSTS,
  MESSAGE_TYPES,
  canUseOverlayOnTab,
  createShowOverlayMessage,
  isShowOverlayMessage,
  shouldFallbackToPopup,
  shouldTryOverlay
} from "../src/core/messages.js";

test("launch mode helpers describe overlay attempts", () => {
  assert.equal(shouldTryOverlay("hybrid"), true);
  assert.equal(shouldTryOverlay("overlay"), true);
  assert.equal(shouldTryOverlay("popup"), false);
});

test("launch mode helpers describe popup fallback", () => {
  assert.equal(shouldFallbackToPopup("hybrid"), true);
  assert.equal(shouldFallbackToPopup("popup"), true);
  assert.equal(shouldFallbackToPopup("overlay"), false);
});

test("show overlay message has stable shape", () => {
  const message = createShowOverlayMessage({ reason: "command" });
  assert.deepEqual(message, {
    type: MESSAGE_TYPES.showOverlay,
    reason: "command"
  });
  assert.equal(isShowOverlayMessage(message), true);
  assert.equal(isShowOverlayMessage({ type: "get-state" }), false);
});

test("overlay eligibility excludes loading and restricted pages", () => {
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "https://example.com" }), true);
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "file:///tmp/example.html" }), true);
  assert.equal(canUseOverlayOnTab({ id: 1, status: "loading", url: "https://example.com" }), false);
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "chrome://extensions" }), false);
  assert.equal(canUseOverlayOnTab({ status: "complete", url: "https://example.com" }), false);
});

test("overlay eligibility excludes shortcut-heavy web apps", () => {
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "https://mail.google.com/mail/u/0/#inbox" }), false);
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "https://docs.google.com/document/d/example/edit" }), false);
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "https://app.slack.com/client/T/C" }), false);
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "https://company.atlassian.net/jira/software/projects/TAB" }), false);
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "https://mycompany.lightning.force.com/lightning/page/home" }), false);
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "https://developer.chrome.com/docs/extensions" }), true);
});

test("default extension-view host list covers common app surfaces without duplicates", () => {
  assert.equal(DEFAULT_EXTENSION_VIEW_HOSTS.length, new Set(DEFAULT_EXTENSION_VIEW_HOSTS).size);
  assert.equal(DEFAULT_EXTENSION_VIEW_HOSTS.includes("mail.google.com"), true);
  assert.equal(DEFAULT_EXTENSION_VIEW_HOSTS.includes("docs.google.com"), true);
  assert.equal(DEFAULT_EXTENSION_VIEW_HOSTS.includes("app.slack.com"), true);
  assert.equal(DEFAULT_EXTENSION_VIEW_HOSTS.includes("atlassian.net"), true);
  assert.equal(DEFAULT_EXTENSION_VIEW_HOSTS.includes("figma.com"), true);
  assert.equal(DEFAULT_EXTENSION_VIEW_HOSTS.includes("github.com"), true);
  assert.equal(DEFAULT_EXTENSION_VIEW_HOSTS.includes("teams.microsoft.com"), true);
  assert.equal(DEFAULT_EXTENSION_VIEW_HOSTS.includes("google.com"), false);
});

test("overlay eligibility excludes user extension-view hosts", () => {
  const settings = { extensionViewHosts: ["example.com", "mail.example.test"] };
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "https://docs.example.com/a" }, settings), false);
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "https://mail.example.test/inbox" }, settings), false);
  assert.equal(canUseOverlayOnTab({ id: 1, status: "complete", url: "https://example.org/a" }, settings), true);
});
