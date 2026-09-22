import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  getLastAccessed,
  listTabs,
  wrapIndex
} from "../src/core/mru.js";

const tabs = [
  { id: 1, windowId: 10, index: 0, title: "One", url: "https://one.test", active: true },
  { id: 2, windowId: 10, index: 1, title: "Two", url: "https://two.test" },
  { id: 3, windowId: 20, index: 0, title: "Three", url: "https://three.test" }
];

test("createInitialState places active tabs first", () => {
  const state = createInitialState(tabs, 1000);
  assert.equal(listTabs(state)[0].id, 1);
});

test("createInitialState honors Chrome lastAccessed across normal and private tabs", () => {
  const state = createInitialState([
    { id: 1, windowId: 10, index: 0, title: "Normal older", lastAccessed: 1000 },
    { id: 2, windowId: 10, index: 1, title: "Normal newest", lastAccessed: 3000 },
    { id: 7, windowId: 20, index: 0, title: "Private middle", incognito: true, lastAccessed: 2000 }
  ], 5000);

  assert.deepEqual(listTabs(state).map((tab) => tab.id), [2, 7, 1]);
});

test("getLastAccessed falls back when Chrome does not provide recency", () => {
  assert.equal(getLastAccessed({ lastAccessed: 1234 }, 9000), 1234);
  assert.equal(getLastAccessed({ lastAccessed: Number.NaN }, 9000), 9000);
  assert.equal(getLastAccessed({}, 9000), 9000);
});

test("listTabs can limit results to current window", () => {
  const state = createInitialState(tabs, 1000);
  assert.deepEqual(
    listTabs(state, { currentWindowOnly: true, currentWindowId: 10 }).map((tab) => tab.id),
    [1, 2]
  );
});

test("listTabs pins the current active tab before previous tabs", () => {
  const state = createInitialState(tabs.map((tab) => ({ ...tab, lastAccessed: tab.id === 2 ? 2000 : 1000 })));

  assert.deepEqual(
    listTabs(state, { activeTab: tabs[0] }).map((tab) => tab.id),
    [1, 2, 3]
  );
});

test("listTabs pins the current active tab within the current window", () => {
  const state = createInitialState(tabs.map((tab) => ({ ...tab, lastAccessed: tab.id === 2 ? 2000 : 1000 })));

  assert.deepEqual(
    listTabs(state, { activeTab: tabs[0], currentWindowOnly: true, currentWindowId: 10 }).map((tab) => tab.id),
    [1, 2]
  );
});

test("listTabs returns no current-window results without a current window id", () => {
  const state = createInitialState(tabs, 1000);
  assert.deepEqual(listTabs(state, { currentWindowOnly: true, currentWindowId: null }), []);
});

test("wrapIndex supports cycling past either end", () => {
  assert.equal(wrapIndex(3, 3), 0);
  assert.equal(wrapIndex(-1, 3), 2);
});
