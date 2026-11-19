import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { DEVELOPMENT_ID, PUBLIC_ID } from "../src/core/channels.js";

test("public and Dev packages use distinct identities and delegate without competing for shortcuts", () => {
  const cwd = new URL("../", import.meta.url);
  const build = () => JSON.parse(execFileSync("python3", ["scripts/package.py"], { cwd, encoding: "utf8" }));
  const first = build();
  const production = JSON.parse(readFileSync(new URL("../dist/production/manifest.json", import.meta.url)));
  const dev = JSON.parse(readFileSync(new URL("../dist/dev/manifest.json", import.meta.url)));
  assert.deepEqual(dev.permissions, production.permissions);
  assert.ok(!dev.permissions.includes("management"));
  assert.equal(dev.content_scripts, undefined, "No passive page effects in either channel");
  assert.deepEqual(dev.background, production.background);
  assert.deepEqual(Object.keys(dev.commands), Object.keys(production.commands));
  assert.ok(Object.values(production.commands).every((command) => command.suggested_key));
  assert.ok(Object.values(dev.commands).every((command) => !command.suggested_key));
  assert.equal(dev.name, production.name + " Dev");
  assert.equal(production.key, undefined, "Keep the existing Store item's signing identity");
  assert.equal(production.action.default_popup, undefined, "Route public toolbar clicks through the worker");
  assert.equal(dev.action.default_popup, "src/switcher.html");
  assert.equal(production.externally_connectable, undefined);
  assert.deepEqual(dev.externally_connectable, { ids: [PUBLIC_ID] });
  const key = Buffer.from(dev.key, "base64");
  assert.equal(createPublicKey({ key, format: "der", type: "spki" }).asymmetricKeyType, "rsa");
  const devId = createHash("sha256").update(key).digest("hex").slice(0, 32)
    .replace(/./g, (nibble) => "abcdefghijklmnop"[parseInt(nibble, 16)]);
  assert.equal(devId, DEVELOPMENT_ID);
  assert.notEqual(devId, PUBLIC_ID);
  for (const [size, path] of Object.entries(production.icons)) {
    const icon = readFileSync(new URL(`../dist/production/${path}`, import.meta.url));
    assert.equal(icon.readUInt32BE(16), Number(size));
    assert.equal(icon.readUInt32BE(20), Number(size));
  }
  assert.ok(production.icons["128"], "Chrome Web Store icon is present");
  assert.deepEqual(build(), first, "Identical sources create identical release ZIPs");
});
