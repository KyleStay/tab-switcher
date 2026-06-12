import test from "node:test";
import assert from "node:assert/strict";
import { fuzzyMatch, rankItems } from "../src/core/fuzzy.js";

test("fuzzyMatch rewards word prefixes", () => {
  const prefix = fuzzyMatch("Visual Studio Code", "stu");
  const scattered = fuzzyMatch("A slow test utility", "stu");

  assert.ok(prefix.score > scattered.score);
});

test("rankItems applies MRU boost for equal matches", () => {
  const items = [
    { title: "GitHub Pull Request", url: "https://github.com/one" },
    { title: "GitHub Pull Request", url: "https://github.com/two" }
  ];

  const ranked = rankItems(items, "github");
  assert.equal(ranked[0].item.url, "https://github.com/one");
});

test("rankItems supports multi-token search", () => {
  const items = [
    { title: "Chrome Extensions Docs", url: "https://developer.chrome.com/docs/extensions" },
    { title: "VS Code Release Notes", url: "https://code.visualstudio.com" }
  ];

  const ranked = rankItems(items, "chrome docs");
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].item.title, "Chrome Extensions Docs");
});

test("rankItems uses exact matching for long queries", () => {
  const items = [
    { title: "A very specific browser tab title for testing", url: "https://example.com" },
    { title: "A very special unrelated title", url: "https://example.net" }
  ];

  const ranked = rankItems(items, "specific browser tab title");
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].item.url, "https://example.com");
});

