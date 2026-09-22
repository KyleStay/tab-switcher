import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../src/core/defaults.js";
import {
  canUsePrivateTabs,
  groupPrivateResults,
  isPrivateTabRevealed,
  shouldIncludePrivateTabs,
  toPrivateTabDisplayItem
} from "../src/core/private-tabs.js";

const privateSettings = {
  ...DEFAULT_SETTINGS,
  privateTabsEnabled: true
};

const privateTab = {
  id: 7,
  windowId: 20,
  index: 0,
  title: "Secret Roadmap",
  url: "https://private.example.test/plan",
  favIconUrl: "https://private.example.test/favicon.ico",
  incognito: true
};

test("private tabs require browser access and user opt-in", () => {
  assert.equal(canUsePrivateTabs({ hasIncognitoAccess: false, settings: privateSettings }), false);
  assert.equal(canUsePrivateTabs({ hasIncognitoAccess: true, settings: DEFAULT_SETTINGS }), false);
  assert.equal(canUsePrivateTabs({ hasIncognitoAccess: true, settings: privateSettings }), true);
});

test("hidden display mode excludes private tabs even after opt-in", () => {
  assert.equal(shouldIncludePrivateTabs({
    hasIncognitoAccess: true,
    settings: { ...privateSettings, privateTabDisplayMode: "hidden" }
  }), false);
});

test("private display item masks sensitive fields by default", () => {
  const item = toPrivateTabDisplayItem({
    tab: privateTab,
    settings: privateSettings,
    revealState: { openedAt: 1000 },
    isSelected: false,
    now: 1000
  });

  assert.equal(item.title, "Private tab");
  assert.equal(item.url, "");
  assert.equal(item.displayUrl, "Hidden URL");
  assert.equal(item.favIconUrl, "");
  assert.equal(item.copyUrl, "");
  assert.equal(item.ariaLabel, "Private tab, hidden title, hidden URL");
  assert.match(item.searchDocument.text, /private incognito/i);
  assert.doesNotMatch(item.searchDocument.text, /roadmap|private\.example/i);
});

test("selected reveal exposes fields only for the selected display item", () => {
  const item = toPrivateTabDisplayItem({
    tab: privateTab,
    settings: privateSettings,
    revealState: { openedAt: 1000 },
    isSelected: true,
    now: 1000
  });

  assert.equal(item.title, "Secret Roadmap");
  assert.equal(item.url, "https://private.example.test/plan");
  assert.equal(item.displayUrl, "private.example.test/plan");
  assert.equal(item.copyUrl, "https://private.example.test/plan");
  assert.equal(item.ariaLabel, "Private tab, Secret Roadmap, private.example.test/plan");
  assert.doesNotMatch(item.searchDocument.text, /roadmap|private\.example/i);
});

test("search hidden private contents is explicit", () => {
  const item = toPrivateTabDisplayItem({
    tab: privateTab,
    settings: { ...privateSettings, privateSearchHiddenContent: true },
    revealState: { openedAt: 1000 },
    isSelected: false,
    now: 1000
  });

  assert.match(item.searchDocument.text, /Secret Roadmap/);
  assert.match(item.searchDocument.text, /private\.example\.test/);
});

test("groupPrivateResults places private tabs after open tabs and before closed tabs", () => {
  const normal = { item: { type: "tab", title: "Normal" } };
  const privateResult = { item: { title: "Private tab", private: true } };
  const closed = { item: { type: "closed", title: "Closed" } };

  assert.deepEqual(groupPrivateResults([normal, closed, privateResult], "grouped"), [
    { heading: null, results: [normal] },
    { heading: "Private tabs", results: [privateResult] },
    { heading: null, results: [closed] }
  ]);
});

test("domain and URL masking work independently and block full URL copying", () => {
  for (const [privateMaskUrl, privateMaskDomain, displayUrl] of [
    [true, true, "Hidden URL"], [true, false, "private.example.test"],
    [false, true, "Hidden domain/plan"], [false, false, "private.example.test/plan"]
  ]) {
    const item = toPrivateTabDisplayItem({ tab: privateTab, settings: { ...privateSettings, privateRevealMode: "never", privateMaskUrl, privateMaskDomain } });
    assert.equal(item.displayUrl, displayUrl);
    assert.equal(item.copyUrl, privateMaskUrl || privateMaskDomain ? "" : privateTab.url);
  }
});

test("timed reveals expire exactly at the deadline, including a zero clock", () => {
  const settings = { ...privateSettings, privateRevealMode: "timed", privateRevealDurationMinutes: 1 };
  assert.equal(isPrivateTabRevealed({ settings, revealState: { openedAt: 0 }, now: 59_999 }), true);
  assert.equal(isPrivateTabRevealed({ settings, revealState: { openedAt: 0 }, now: 60_000 }), false);
});
