import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/core/defaults.js";

let generation = 0;
async function boot(storedSettings = null) {
  const listeners = {};
  const calls = { popup: [], writes: [], created: [], activated: [], windows: [] };
  const tabs = [
    { id: 1, windowId: 1, index: 0, active: true, title: "Current", url: "https://example.test/", lastAccessed: 300 },
    { id: 2, windowId: 1, index: 1, title: "Previous", url: "https://example.test/2", lastAccessed: 200 },
    { id: 3, windowId: 1, index: 2, title: "Older", url: "https://example.test/3", lastAccessed: 100 },
    { id: 4, windowId: 2, index: 0, incognito: true, title: "Secret", url: "https://secret.test/", lastAccessed: 250 },
    { id: 5, windowId: 3, index: 0, title: "Popup window", url: "https://popup.test/", lastAccessed: 50 }
  ];
  const local = { [STORAGE_KEYS.settings]: storedSettings, [STORAGE_KEYS.tabs]: { corrupt: true } };
  const session = {};
  const storage = (data) => ({
    get: async (key) => ({ [key]: data[key] }),
    set: async (values) => { calls.writes.push(values); Object.assign(data, values); },
    remove: async (key) => { delete data[key]; }
  });
  const event = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const origin = "chrome-extension://test-extension/";
  globalThis.chrome = {
    runtime: { id: "test-extension", getURL: (path) => origin + path, onMessage: event("message") },
    commands: { onCommand: event("command"), getAll: async () => [] },
    action: {
      onClicked: event("action"),
      setPopup: async ({ popup }) => { calls.popup.push(popup); },
      openPopup: async () => { throw new Error("Popup unavailable"); }
    },
    extension: { isAllowedIncognitoAccess: async () => true },
    storage: { local: storage(local), session: storage(session) },
    scripting: { executeScript: async () => {} },
    windows: {
      getAll: async (options) => {
        calls.windows.push(options);
        return [
          { id: 1, type: "normal", tabs: tabs.filter((tab) => tab.windowId === 1) },
          { id: 2, type: "normal", tabs: tabs.filter((tab) => tab.windowId === 2) },
          { id: 3, type: "popup", tabs: tabs.filter((tab) => tab.windowId === 3) }
        ];
      },
      update: async () => {}
    },
    tabs: {
      onRemoved: event("removed"),
      query: async () => tabs.filter((tab) => tab.active),
      get: async (id) => { const tab = tabs.find((tab) => tab.id === id); if (!tab) throw new Error("Missing tab"); return tab; },
      update: async (id) => {
        calls.activated.push(id);
        for (const tab of tabs) tab.active = tab.id === id;
        tabs.find((tab) => tab.id === id).lastAccessed = Date.now();
      },
      remove: async (id) => { tabs.splice(tabs.findIndex((tab) => tab.id === id), 1); },
      create: async (options) => { calls.created.push(options); },
      sendMessage: async () => ({ ok: false, error: "Frame blocked" })
    },
    sessions: { getRecentlyClosed: async () => [], restore: async () => {} }
  };
  await import(`../src/background.js?test=${generation++}`);
  const sender = { id: "test-extension", url: origin + "src/switcher.html", frameId: 0 };
  const send = (message, context = sender) => new Promise((resolve) => listeners.message(message, context, resolve));
  await send({ type: "get-settings" });
  return { send, sender, calls, local, session, tabs, listeners };
}

test("background reads one live snapshot, recovers settings, and removes obsolete browsing storage", async () => {
  const app = await boot();
  const response = await app.send({ type: "get-state" });
  assert.equal(response.ok, true);
  assert.deepEqual(response.state.settings, DEFAULT_SETTINGS);
  assert.deepEqual(response.state.tabs.map((tab) => tab.id), [1, 2, 3, 5]);
  assert.deepEqual(app.calls.windows, [{ populate: true, windowTypes: ["normal", "popup"] }]);
  assert.equal(app.local[STORAGE_KEYS.tabs], undefined);
  assert.deepEqual(app.calls.writes, []);
  app.tabs[2].lastAccessed = 400;
  const next = await app.send({ type: "get-state" });
  assert.deepEqual(next.state.tabs.map((tab) => tab.id), [1, 3, 2, 5]);
});

test("private data and actions require opt-in; iframe requests require the session token", async () => {
  const app = await boot();
  assert.equal((await app.send({ type: "activate-tab", tab: { id: 4 } })).ok, false);
  assert.equal((await app.send({ type: "close-tab", tab: { id: "2" } })).ok, false);
  assert.equal((await app.send({ type: "get-state" }, { ...app.sender, url: "https://example.test" })).ok, false);
  await app.send({ type: "update-settings", settings: { privateTabsEnabled: true } });
  const iframe = { ...app.sender, url: app.sender.url + "?overlay=1#good", frameId: 3, tab: { id: 1 } };
  assert.equal((await app.send({ type: "get-state", token: "good" }, iframe)).ok, false);
  app.session[STORAGE_KEYS.overlayToken + ":1"] = "good";
  const response = await app.send({ type: "get-state", token: "good" }, iframe);
  assert.equal(response.ok, true);
  assert.ok(response.state.tabs.some((tab) => tab.id === 4));
  assert.equal((await app.send({ type: "get-state", token: "bad" }, iframe)).ok, false);
});

test("launch mode configures the action and rejected popups fall back to an extension tab", async () => {
  const app = await boot();
  assert.equal(app.calls.popup.at(-1), "src/switcher.html");
  await app.send({ type: "update-settings", settings: { launchMode: "hybrid" } });
  assert.equal(app.calls.popup.at(-1), "");
  app.listeners.action(app.tabs[0]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.calls.created.length, 1);
  assert.match(app.calls.created[0].url, /src\/switcher.html$/);
  assert.equal(app.calls.popup.at(-1), "");
  assert.equal(app.session[STORAGE_KEYS.overlayToken + ":1"], undefined);
});

test("query restoration uses session storage and is disabled for private support", async () => {
  const app = await boot({ restorePreviousQuery: true });
  await app.send({ type: "save-query", query: "example" });
  assert.equal((await app.send({ type: "get-state" })).state.lastQuery, "example");
  app.tabs[0].active = false;
  app.tabs[3].active = true;
  await app.send({ type: "save-query", query: "incognito query" });
  assert.equal(app.session[STORAGE_KEYS.lastQuery], undefined);
  await app.send({ type: "update-settings", settings: { privateTabsEnabled: true } });
  await app.send({ type: "save-query", query: "secret" });
  assert.equal(app.session[STORAGE_KEYS.lastQuery], undefined);
  assert.equal((await app.send({ type: "get-state" })).state.lastQuery, "");
});

test("rapid MRU commands use live active tabs without bouncing between two entries", async () => {
  const app = await boot();
  app.listeners.command("switch-previous-tab");
  app.listeners.command("switch-previous-tab");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(app.calls.activated, [2, 3]);
  assert.deepEqual(app.calls.writes, []);
});
