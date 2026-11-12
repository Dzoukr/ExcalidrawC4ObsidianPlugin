import { test } from "node:test";
import assert from "node:assert/strict";
import { CONVENTION_VERSION, MODE_KEY, isAlone, ownerOf, register, registry } from "../src/mode.ts";

test("the kind in the frontmatter decides whom a drawing belongs to", () => {
  assert.equal(MODE_KEY, "dzoukr-diagram-kind");
  assert.equal(ownerOf("c4", false, false), "mine");
  assert.equal(ownerOf(" C4 ", false, false), "mine");
  assert.equal(ownerOf("mindmap", true, true), "other", "even with C4 elements in it, and alone");
});

test("without a kind, a drawing with C4 elements is C4's; any other is nobody's, unless C4 is alone", () => {
  assert.equal(ownerOf(undefined, true, false), "mine");
  assert.equal(ownerOf("", false, false), "none");
  assert.equal(ownerOf(undefined, false, false), "none");
  assert.equal(ownerOf(undefined, false, true), "mine", "alone, as if no other plugin were installed");
});

test("the plugins of their own kind of diagram find each other in a registry on the window, with their version", () => {
  const host = {};
  assert.ok(isAlone(host));
  const unregister = register(host);
  assert.deepEqual(registry(host).get("c4"), { version: CONVENTION_VERSION });
  assert.ok(isAlone(host));
  registry(host).set("mindmap", { version: 1 });
  assert.ok(!isAlone(host));
  unregister();
  registry(host).delete("mindmap");
  assert.ok(isAlone(host));
});
