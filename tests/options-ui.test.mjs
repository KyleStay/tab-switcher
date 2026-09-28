import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/options.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/options.css", import.meta.url), "utf8");

test("options settings expose inline help affordances", () => {
  const settingNames = [...html.matchAll(/<span class="setting-name">/g)];
  const helpButtons = [...html.matchAll(/class="help-button"/g)];

  assert.ok(settingNames.length >= 16);
  assert.equal(helpButtons.length, settingNames.length);
  assert.match(css, /\.help-text\s*\{/);
  assert.doesNotMatch(css, /content:\s*attr\(data-help\)/);
});

test("numeric options show their units", () => {
  assert.match(html, /name="maxResults"[\s\S]+<span class="unit-label">results<\/span>/);
  assert.match(html, /name="privateRevealDurationMinutes"[\s\S]+<span class="unit-label">minutes<\/span>/);
});
