import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("development package preserves permissions and actions without claiming production shortcuts", () => {
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
  assert.equal(dev.key, undefined, "Do not fabricate a store identity");
  assert.equal(dev.externally_connectable, undefined, "No unverified peer arbitration");
  assert.deepEqual(build(), first, "Identical sources create identical release ZIPs");
});
