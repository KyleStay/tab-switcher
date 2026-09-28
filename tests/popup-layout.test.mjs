import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/switcher.css", import.meta.url), "utf8");

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("\\ ", "\\s+");
  const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]+\\}`));
  assert.ok(match, `Missing CSS block for ${selector}`);
  return match[0];
}

function globalBoxSizingBlock() {
  const match = css.match(/\*,\s*\*::before,\s*\*::after\s*\{[^}]+box-sizing:\s*border-box;[^}]+\}/);
  assert.ok(match, "Missing global border-box sizing");
  return match[0];
}

test("popup root has deterministic readable width", () => {
  assert.match(css, /--popup-width:\s*720px;/);

  const rootSizing = cssBlock("html,\nbody");
  assert.match(rootSizing, /width:\s*var\(--popup-width\);/);
  assert.match(rootSizing, /min-width:\s*0;/);
  assert.match(rootSizing, /max-width:\s*100vw/);
});

test("result rows preserve readable text space", () => {
  assert.match(cssBlock(".result"), /grid-template-columns:\s*24px\s+minmax\(0,\s*1fr\)\s+auto;/);
  assert.match(cssBlock(".result-text"), /min-width:\s*0;/);
  assert.match(cssBlock(".row-meta"), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+52px;/);
  assert.match(cssBlock(".action"), /text-align:\s*right;/);
  assert.match(cssBlock(".badge"), /text-overflow:\s*ellipsis;/);
});

test("popup chrome cannot be collapsed by controls or footer hints", () => {
  assert.match(globalBoxSizingBlock(), /box-sizing:\s*border-box;/);
  assert.match(cssBlock("button"), /white-space:\s*nowrap;/);
  assert.match(cssBlock(".meta span"), /text-overflow:\s*ellipsis;/);
  assert.match(cssBlock(".hints"), /flex-wrap:\s*wrap;/);
});

test("popup messages do not break hidden state or listbox semantics", () => {
  assert.match(css, /\[hidden\]\s*\{[^}]+display:\s*none;/);
  assert.match(css, /\.results:empty\s*\{[^}]+display:\s*none;/);
  assert.match(cssBlock(".results"), /min-height:\s*80px;/);
  assert.match(cssBlock(".results"), /flex:\s*1 1 260px;/);
});
