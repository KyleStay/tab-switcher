import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchText, fuzzyMatch, rankItems, formatUrl } from "../src/core/fuzzy.js";

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

test("rankItems projects ranges onto rendered display URL fields", () => {
  const items = [
    {
      title: "Chrome Extensions Docs",
      url: "https://developer.chrome.com/docs/extensions",
      displayUrl: "developer.chrome.com/docs/extensions"
    }
  ];

  const [ranked] = rankItems(items, "developer.chrome.com/docs/ext");

  assert.equal(buildSearchText(items[0]), "Chrome Extensions Docs developer.chrome.com/docs/extensions");
  assert.deepEqual(ranked.fieldRanges.url, [[0, 29]]);
});

test("rankItems projects URL ranges when title is empty", () => {
  const items = [
    {
      title: "",
      url: "https://example.com/docs",
      displayUrl: "example.com/docs"
    }
  ];

  const [ranked] = rankItems(items, "example");

  assert.equal(buildSearchText(items[0]), " example.com/docs");
  assert.deepEqual(ranked.fieldRanges.url, [[0, 7]]);
});

test("rankItems can reuse a prebuilt search document", () => {
  const items = [
    {
      title: "Visible Title",
      url: "https://example.com",
      searchDocument: {
        text: "Cached Match cached.example",
        offsets: {
          title: [0, 12],
          url: [13, 27]
        }
      }
    }
  ];

  const [ranked] = rankItems(items, "cached");

  assert.equal(ranked.item.title, "Visible Title");
  assert.deepEqual(ranked.fieldRanges.title, [[0, 6]]);
});

test("fuzzyMatch keeps surrogate-pair highlight ranges intact", () => {
  const match = fuzzyMatch("😀 Docs", "😀");

  assert.deepEqual(match.ranges, [[0, 2]]);
});

test("formatted URLs retain deep-link queries, ports, and fragments for search", () => {
  const url = "https://example.test:8443/report?id=alpha#details";
  const item = { title: "Report", url, displayUrl: formatUrl(url) };
  assert.equal(item.displayUrl, "example.test:8443/report?id=alpha#details");
  assert.equal(rankItems([item], "alpha details").length, 1);
});
