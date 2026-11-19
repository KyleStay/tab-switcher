import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMAND_LABELS, DEFAULT_SETTINGS, mergeSettings, normalizeHostList } from "../src/core/defaults.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("mergeSettings fills missing values from defaults", () => {
  assert.deepEqual(mergeSettings(), DEFAULT_SETTINGS);
});

test("mergeSettings normalizes invalid enum and number values", () => {
  assert.deepEqual(mergeSettings({
    theme: "neon",
    density: "spacious",
    launchMode: "teleport",
    mruCycleScope: "sideways",
    maxResults: "999"
  }), {
    ...DEFAULT_SETTINGS,
    maxResults: 300
  });
});

test("mergeSettings preserves explicit false boolean values", () => {
  assert.equal(mergeSettings({ includeClosedTabs: false }).includeClosedTabs, false);
});

test("mergeSettings preserves valid launch modes", () => {
  assert.equal(mergeSettings({ launchMode: "overlay" }).launchMode, "hybrid");
  assert.equal(mergeSettings({ launchMode: "popup" }).launchMode, "popup");
  assert.equal(mergeSettings({ launchMode: "hybrid" }).launchMode, "hybrid");
});

test("mergeSettings preserves valid MRU cycle scopes", () => {
  assert.equal(mergeSettings({ mruCycleScope: "all-windows" }).mruCycleScope, "all-windows");
  assert.equal(mergeSettings({ mruCycleScope: "current-window" }).mruCycleScope, "current-window");
});

test("mergeSettings normalizes extension view hosts", () => {
  assert.deepEqual(mergeSettings({
    extensionViewHosts: "https://Example.com/path\nwww.docs.example.com, mail.google.com"
  }).extensionViewHosts, ["docs.example.com", "example.com", "mail.google.com"]);
});

test("normalizeHostList deduplicates array values", () => {
  assert.deepEqual(normalizeHostList(["https://www.example.com/a", "example.com", "mail.google.com"]), [
    "example.com",
    "mail.google.com"
  ]);
});

test("mergeSettings rejects non-boolean flag values", () => {
  assert.equal(mergeSettings({ includeClosedTabs: "false" }).includeClosedTabs, true);
  assert.equal(mergeSettings({ privateTabsEnabled: "true" }).privateTabsEnabled, false);
  assert.equal(mergeSettings({ privateMaskTitle: "false" }).privateMaskTitle, true);
});

test("mergeSettings falls back for non-finite maxResults", () => {
  assert.equal(mergeSettings({ maxResults: Number.NaN }).maxResults, DEFAULT_SETTINGS.maxResults);
  assert.equal(
    mergeSettings({ privateRevealDurationMinutes: Number.NaN }).privateRevealDurationMinutes,
    DEFAULT_SETTINGS.privateRevealDurationMinutes
  );
});

test("mergeSettings normalizes private tab settings", () => {
  assert.deepEqual(mergeSettings({
    privateTabsEnabled: true,
    privateTabDisplayMode: "sideways",
    privateTabIndicator: "sparkle",
    privateRevealMode: "forever",
    privateRevealDurationMinutes: 9999,
    privateSearchHiddenContent: true
  }), {
    ...DEFAULT_SETTINGS,
    privateTabsEnabled: true,
    privateRevealDurationMinutes: 1440,
    privateSearchHiddenContent: true
  });
});

test("command labels cover every manifest command", () => {
  const { _execute_action: actionLabel, ...namedLabels } = COMMAND_LABELS;
  assert.deepEqual(Object.keys(namedLabels).sort(), Object.keys(manifest.commands).sort());
  assert.equal(actionLabel, "Activate the extension");
  assert.equal(manifest.commands["open-switcher"].suggested_key.mac, "Command+E");
  for (const command of ["open-switcher", "open-switcher-alt-windows"]) {
    assert.equal(namedLabels[command], manifest.commands[command].description);
  }
});

test("malformed stored settings recover to defaults", () => {
  for (const value of [null, false, 12, "bad", []]) assert.deepEqual(mergeSettings(value), DEFAULT_SETTINGS);
});
