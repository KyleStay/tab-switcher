// Run with PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-smoke.mjs.
// The temporary extension copy grants access only to this test's loopback fixtures.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../src/core/defaults.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || process.argv[2] || "playwright");
const run = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), "tab-switcher-qa-"));
const profile = join(temporary, "profile");
const extension = join(temporary, "extension");
const artifacts = process.env.QA_ARTIFACTS || process.argv[3];
let browser;
let cleanupPromise;
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><title>Fixture ' + req.url + '</title><button id="pageButton">Page button</button>');
});

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    if (browser) {
      try { await (await browser.newBrowserCDPSession()).send("Browser.close"); } catch {}
    }
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    let pids = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      pids = await run("pgrep", ["-f", profile]).then((result) => result.stdout.trim(), () => "");
      if (!pids) break;
      await delay(100);
    }
    assert.equal(pids, "", "Disposable Chrome survived: " + pids + " profile: " + profile);
    await rm(temporary, { recursive: true, force: true });
    console.log("Cleanup: 0 owned Chrome processes, 0 owned profiles.");
  })();
  return cleanupPromise;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => cleanup().finally(() => process.exit(1)));

try {
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const fixtureUrl = "http://127.0.0.1:" + server.address().port;
  await mkdir(extension);
  await cp(new URL("../src", import.meta.url), join(extension, "src"), { recursive: true });
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  manifest.host_permissions = ["http://127.0.0.1/*"];
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  const runner = process.env.CHROME_EXTENSION_RUNNER || join(homedir(), ".codex/skills/chrome-extension-test-runner/scripts/launch_test_chrome.py");
  const { stdout } = await run("python3", [runner, "--extension", extension, "--profile", profile, "--url", fixtureUrl + "/first"]);
  const launch = JSON.parse(stdout);
  assert.ok(launch.debugger_ready && launch.extension_loaded);
  browser = await chromium.connectOverCDP("http://127.0.0.1:" + launch.debug_port);
  const context = browser.contexts()[0];
  context.setDefaultTimeout(8000);
  const errors = [];
  const captureErrors = (page) => page.on("pageerror", (error) => errors.push(error.message));
  context.on("page", captureErrors);
  context.pages().forEach(captureErrors);
  const worker = context.serviceWorkers().find((entry) => entry.url().includes(launch.extension_id));
  const origin = "chrome-extension://" + launch.extension_id;
  const page = context.pages().find((entry) => entry.url().startsWith(fixtureUrl));
  const closingTab = await context.newPage();
  await closingTab.goto(fixtureUrl + "/restorable");
  let ui = await context.newPage();
  await ui.setViewportSize({ width: 720, height: 600 });
  await ui.goto(origin + "/src/switcher.html");
  await ui.waitForFunction(() => document.querySelector("#results").getAttribute("aria-busy") === "false");
  assert.ok(await ui.locator("[role=option]").count());
  assert.equal(await ui.locator(":focus").getAttribute("id"), "queryInput");
  await ui.keyboard.press("Tab");
  assert.notEqual(await ui.locator(":focus").getAttribute("id"), "queryInput");
  await ui.locator("#queryInput").fill("first");
  assert.match(await ui.locator("[role=option]").first().getAttribute("aria-label"), /Switch/);
  await ui.locator("#queryInput").fill("restorable");
  await ui.locator("#queryInput").press("Control+w");
  await ui.waitForFunction(() => document.querySelector("[role=option]")?.getAttribute("aria-label").includes("Restore"));
  assert.ok(closingTab.isClosed());
  const restoredReady = context.waitForEvent("page");
  await ui.locator("#queryInput").press("Enter");
  await restoredReady;
  assert.ok(await worker.evaluate(async (url) => (await chrome.tabs.query({ url })).length > 0, fixtureUrl + "/restorable"));
  // Activation closes the switcher; open a fresh instance for remaining checks.
  if (!ui.isClosed()) await ui.close();
  ui = await context.newPage();
  await ui.setViewportSize({ width: 720, height: 600 });
  await ui.goto(origin + "/src/switcher.html");
  await ui.locator("#queryInput").fill("first");

  await page.bringToFront();
  await worker.evaluate(() => chrome.action.openPopup());
  await ui.waitForFunction(() => chrome.extension.getViews({ type: "popup" })[0]?.document.querySelector("[role=option]"));
  await ui.waitForFunction(() => chrome.extension.getViews({ type: "popup" })[0]?.innerWidth >= 620);
  const popupSize = await ui.evaluate(() => {
    const popup = chrome.extension.getViews({ type: "popup" })[0];
    return { width: popup.innerWidth, height: popup.innerHeight, scrollWidth: popup.document.documentElement.scrollWidth };
  });
  assert.ok(popupSize.width >= 620 && popupSize.width <= 720, JSON.stringify(popupSize));
  assert.equal(popupSize.scrollWidth, popupSize.width);
  await ui.evaluate(() => chrome.extension.getViews({ type: "popup" })[0].close());

  const options = await context.newPage();
  await options.goto(origin + "/src/options.html");
  await options.waitForFunction(() => !document.querySelector("[name=launchMode]").disabled);
  await options.locator("[name=launchMode]").selectOption("hybrid");
  await options.waitForFunction(() => document.querySelector("#saveStatus").textContent === "Saved");
  assert.equal(await worker.evaluate(() => chrome.action.getPopup({})), "");
  await options.locator(".help-button").first().click();
  assert.equal(await options.locator(".help-button").first().getAttribute("aria-expanded"), "true");
  assert.ok(await options.locator("[name=launchMode]").getAttribute("aria-describedby"));

  // Real shared UI inside the injected dialog, using only synthetic loopback pages.
  await page.bringToFront();
  await page.locator("#pageButton").focus();
  const opened = await worker.evaluate(async ({ fixtureUrl, tokenKey }) => {
    const [tab] = await chrome.tabs.query({ url: fixtureUrl + "/*" });
    const token = crypto.randomUUID();
    await chrome.storage.session.set({ [tokenKey + ":" + tab.id]: token });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content-switcher.js"] });
    return chrome.tabs.sendMessage(tab.id, { type: "tab-switcher:show-overlay", token }, { frameId: 0 });
  }, { fixtureUrl, tokenKey: STORAGE_KEYS.overlayToken });
  assert.equal(opened.ok, true, JSON.stringify(opened));
  const overlay = page.frames().find((frame) => frame.url().startsWith(origin));
  assert.ok(overlay);
  assert.ok(await overlay.locator("[role=option]").count());
  assert.equal(await page.evaluate(() => {
    try { void window.frames[0].document.body.textContent; return false; } catch { return true; }
  }), true, "The host must not read the extension frame");
  assert.equal(await page.evaluate(() => [...document.querySelectorAll("*")].some((node) => node.shadowRoot)), false);
  await overlay.locator("#queryInput").press("Escape");
  await page.waitForFunction(() => window.frames.length === 0);
  assert.equal(await page.locator(":focus").getAttribute("id"), "pageButton");

  // A webpage embedding the public HTML directly cannot obtain tabs or issue actions.
  await page.evaluate((src) => { const frame = document.createElement("iframe"); frame.src = src; document.body.append(frame); }, origin + "/src/switcher.html?overlay=1#forged");
  await page.waitForFunction(() => window.frames.length === 1);
  const forged = await new Promise((done) => {
    const existing = page.frames().find((frame) => frame.url().includes("#forged"));
    if (existing) return done(existing);
    page.once("framenavigated", done);
  });
  await forged.locator("#retryButton").waitFor({ state: "visible" });
  assert.equal(await forged.locator("[role=option]").count(), 0);

  // Synthetic private data exercises the actual UI module without changing incognito access.
  const privatePage = await context.newPage();
  await privatePage.setViewportSize({ width: 720, height: 600 });
  await privatePage.clock.install();
  await privatePage.addInitScript(({ defaults }) => {
    const nativeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async (message) => {
      if (message.type === "get-state") return { ok: true, state: {
        settings: { ...defaults, includeClosedTabs: false, privateTabsEnabled: true, privateSearchHiddenContent: true, privateRevealMode: "timed", privateRevealDurationMinutes: 1, theme: "light" },
        firstRunSeen: true, privateTabsAccess: true, closedTabs: [], activeTab: null,
        tabs: [{ id: 99, windowId: 1, incognito: true, title: "Secret Needle", url: "https://secret.test/report?needle#details" }]
      } };
      return nativeSend(message);
    };
  }, { defaults: DEFAULT_SETTINGS });
  await privatePage.goto(origin + "/src/switcher.html");
  await privatePage.locator("[role=option]").waitFor();
  await privatePage.locator("#queryInput").fill("needle");
  assert.match(await privatePage.locator("[role=option]").textContent(), /Secret Needle/);
  await privatePage.clock.fastForward(60_001);
  assert.equal(await privatePage.locator("[role=option]").count(), 1, "Hidden private content remains searchable with explicit opt-in");
  assert.doesNotMatch(await privatePage.locator("#results").textContent(), /Secret Needle|secret\.test/);
  assert.doesNotMatch(await privatePage.locator("[role=option]").getAttribute("aria-label"), /Secret Needle|secret\.test/);

  await ui.bringToFront();
  await ui.emulateMedia({ colorScheme: "light" });
  assert.equal(await ui.locator("mark").first().evaluate((mark) => getComputedStyle(mark).color), "rgb(128, 84, 0)");
  await ui.setViewportSize({ width: 360, height: 420 });
  assert.ok(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (artifacts) {
    await mkdir(resolve(artifacts), { recursive: true });
    await ui.screenshot({ path: join(artifacts, "narrow-switcher.png") });
    await options.screenshot({ path: join(artifacts, "options.png"), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("PASS: shared popup/overlay, focus, frame isolation, token checks, settings, private search/redaction, light theme, narrow layout.");
} finally {
  await cleanup();
}
