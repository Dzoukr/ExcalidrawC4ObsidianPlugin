import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SHORTCUTS, actionOf, loadShortcuts, shortcutOf } from "../src/keys.ts";

const press = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods,
});

test("a key press makes a shortcut: modifiers in a fixed order, then the key", () => {
  assert.equal(shortcutOf(press(" ")), "Space");
  assert.equal(shortcutOf(press("k", { shiftKey: true, ctrlKey: true })), "Ctrl+Shift+K");
  assert.equal(shortcutOf(press("Backspace")), "Backspace");
  assert.equal(shortcutOf(press("Shift", { shiftKey: true })), null); // a modifier alone
});

test("the default shortcuts add, zoom in and out, edit, and go from element to element", () => {
  const act = (key: string, mods = {}) => actionOf(DEFAULT_SHORTCUTS, press(key, mods));
  assert.deepEqual(act("Insert"), { action: "add", extend: false });
  assert.equal(act("Enter")?.action, "zoomIn");
  assert.equal(act("Backspace")?.action, "zoomOut");
  assert.equal(act(" ")?.action, "edit");
  assert.deepEqual(act("ArrowLeft"), { action: "left", extend: false });
  assert.deepEqual(act("ArrowDown", { shiftKey: true }), { action: "down", extend: true }); // Shift adds to the selection
  assert.equal(act("Enter", { shiftKey: true }), null); // only a move takes Shift
  assert.equal(actionOf({ ...DEFAULT_SHORTCUTS, edit: "" }, press(" ")), null); // turned off
});

test("saved shortcuts keep the defaults for the ones missing", () => {
  assert.deepEqual(loadShortcuts({ edit: "F2", zoomIn: 3 }), { ...DEFAULT_SHORTCUTS, edit: "F2" });
  assert.deepEqual(loadShortcuts(undefined), DEFAULT_SHORTCUTS);
});
