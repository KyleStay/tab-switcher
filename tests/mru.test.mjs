import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  getCycleTarget,
  listTabs,
  removeTab,
  touchTab,
  updateTab,
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

test("touchTab moves a tab to the front", () => {
  const state = createInitialState(tabs, 1000);
  const next = touchTab(state, { ...tabs[1], active: true }, 2000);
  assert.equal(listTabs(next)[0].id, 2);
});

test("updateTab preserves existing recency", () => {
  const state = touchTab(createInitialState(tabs, 1000), { ...tabs[1], active: true }, 2000);
  const next = updateTab(state, { ...tabs[1], title: "Two Updated" }, 3000);
  assert.equal(listTabs(next)[0].title, "Two Updated");
});

test("updateTab does not promote unknown inactive tabs", () => {
  const state = touchTab(createInitialState(tabs, 1000), { ...tabs[1], active: true }, 2000);
  const next = updateTab(state, {
    id: 4,
    windowId: 10,
    index: 2,
    title: "Four",
    url: "https://four.test",
    active: false
  }, 3000);

  assert.deepEqual(listTabs(next).map((tab) => tab.id), [2, 1, 3, 4]);
});

test("updateTab promotes unknown active tabs", () => {
  const state = createInitialState(tabs, 1000);
  const next = updateTab(state, {
    id: 4,
    windowId: 10,
    index: 2,
    title: "Four",
    url: "https://four.test",
    active: true
  }, 3000);

  assert.deepEqual(listTabs(next).map((tab) => tab.id), [4, 1, 3, 2]);
});

test("removeTab cleans stale entries", () => {
  const state = createInitialState(tabs, 1000);
  const next = removeTab(state, 2, 10);
  assert.deepEqual(listTabs(next).map((tab) => tab.id), [1, 3]);
});

test("listTabs can limit results to current window", () => {
  const state = createInitialState(tabs, 1000);
  assert.deepEqual(
    listTabs(state, { currentWindowOnly: true, currentWindowId: 10 }).map((tab) => tab.id),
    [1, 2]
  );
});

test("listTabs returns no current-window results without a current window id", () => {
  const state = createInitialState(tabs, 1000);
  assert.deepEqual(listTabs(state, { currentWindowOnly: true, currentWindowId: null }), []);
});

test("getCycleTarget chooses the next MRU tab", () => {
  const state = createInitialState(tabs, 1000);
  const target = getCycleTarget(state, tabs[0], 1, { currentWindowOnly: true, currentWindowId: 10 });
  assert.equal(target.id, 2);
});

test("wrapIndex supports cycling past either end", () => {
  assert.equal(wrapIndex(3, 3), 0);
  assert.equal(wrapIndex(-1, 3), 2);
});
