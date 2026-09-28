import test from "node:test";
import assert from "node:assert/strict";
import { getPopupNavigationAction, shouldActivateSelectionOnSpace } from "../src/core/shortcuts.js";

function keyEvent(overrides = {}) {
  return {
    key: "ArrowDown",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides
  };
}

test("popup navigation maps arrow and page keys", () => {
  assert.deepEqual(getPopupNavigationAction(keyEvent({ key: "ArrowDown" })), { type: "move", delta: 1 });
  assert.deepEqual(getPopupNavigationAction(keyEvent({ key: "ArrowUp" })), { type: "move", delta: -1 });
  assert.deepEqual(getPopupNavigationAction(keyEvent({ key: "PageDown" })), { type: "move", delta: 8 });
  assert.deepEqual(getPopupNavigationAction(keyEvent({ key: "PageUp" })), { type: "move", delta: -8 });
});

test("popup navigation maps home and end keys", () => {
  assert.deepEqual(getPopupNavigationAction(keyEvent({ key: "Home" })), { type: "select", position: "first" });
  assert.deepEqual(getPopupNavigationAction(keyEvent({ key: "End" })), { type: "select", position: "last" });
});

test("Tab and Shift+Tab keep native focus navigation", () => {
  assert.equal(getPopupNavigationAction(keyEvent({ key: "Tab" })), null);
  assert.equal(getPopupNavigationAction(keyEvent({ key: "Tab", shiftKey: true })), null);
});

test("popup navigation maps Ctrl or Command editor-style movement", () => {
  assert.deepEqual(getPopupNavigationAction(keyEvent({ key: "n", ctrlKey: true })), { type: "move", delta: 1 });
  assert.deepEqual(getPopupNavigationAction(keyEvent({ key: "j", metaKey: true })), { type: "move", delta: 1 });
  assert.deepEqual(getPopupNavigationAction(keyEvent({ key: "p", ctrlKey: true })), { type: "move", delta: -1 });
  assert.deepEqual(getPopupNavigationAction(keyEvent({ key: "k", metaKey: true })), { type: "move", delta: -1 });
});

test("popup navigation ignores launch and modified text-editing shortcuts", () => {
  assert.equal(getPopupNavigationAction(keyEvent({ key: "e", ctrlKey: true })), null);
  assert.equal(getPopupNavigationAction(keyEvent({ key: "ArrowDown", shiftKey: true })), null);
  assert.equal(getPopupNavigationAction(keyEvent({ key: "Tab", ctrlKey: true })), null);
  assert.equal(getPopupNavigationAction(keyEvent({ key: "n", ctrlKey: true, shiftKey: true })), null);
  assert.equal(getPopupNavigationAction(keyEvent({ key: "j", metaKey: true, altKey: true })), null);
});

test("space activates the selected result only when the query is blank", () => {
  assert.equal(shouldActivateSelectionOnSpace(keyEvent({ key: " " }), ""), true);
  assert.equal(shouldActivateSelectionOnSpace(keyEvent({ key: "Spacebar" }), "   "), true);
  assert.equal(shouldActivateSelectionOnSpace(keyEvent({ key: " " }), "docs"), false);
  assert.equal(shouldActivateSelectionOnSpace(keyEvent({ key: " ", shiftKey: true }), ""), false);
  assert.equal(shouldActivateSelectionOnSpace(keyEvent({ key: "Enter" }), ""), false);
});
