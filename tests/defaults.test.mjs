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
    maxResults: "999",
    automationExpireMinutes: "-5"
  }), {
    ...DEFAULT_SETTINGS,
    maxResults: 300,
    automationExpireMinutes: 1
  });
});

test("mergeSettings preserves explicit false boolean values", () => {
  assert.equal(mergeSettings({ includeClosedTabs: false }).includeClosedTabs, false);
});

test("mergeSettings preserves valid launch modes", () => {
  assert.equal(mergeSettings({ launchMode: "overlay" }).launchMode, "overlay");
  assert.equal(mergeSettings({ launchMode: "popup" }).launchMode, "popup");
  assert.equal(mergeSettings({ launchMode: "hybrid" }).launchMode, "hybrid");
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
  assert.equal(
    mergeSettings({ testKeepalivePromptAutomation: "true" }).testKeepalivePromptAutomation,
    false
  );
});

test("mergeSettings falls back for non-finite maxResults", () => {
  assert.equal(mergeSettings({ maxResults: Number.NaN }).maxResults, DEFAULT_SETTINGS.maxResults);
  assert.equal(
    mergeSettings({ automationExpireMinutes: Number.NaN }).automationExpireMinutes,
    DEFAULT_SETTINGS.automationExpireMinutes
  );
});

test("command labels cover every manifest command", () => {
  assert.deepEqual(Object.keys(COMMAND_LABELS).sort(), Object.keys(manifest.commands).sort());
});
