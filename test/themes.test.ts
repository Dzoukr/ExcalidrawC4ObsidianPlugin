import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOOKS, LOOK_KEYS, LOOK_PARTS } from "../src/model.ts";
import {
  PRESETS, colorsOf, isPreset, mergeColors, newThemeId, parseThemes, setUserThemes, themeName, themeOptions, themeSwatches, themesToJson,
  uniqueName, validTheme,
} from "../src/themes.ts";
import type { Preset } from "../src/themes.ts";

test("every built-in theme has every color of every type of element", () => {
  for (const p of Object.keys(PRESETS) as Preset[]) {
    const c = colorsOf(p);
    for (const k of LOOK_KEYS) for (const part of LOOK_PARTS) assert.match(c[k][part], /^#[0-9a-f]{6}$/i, `${p} ${k} ${part}`);
  }
  assert.deepEqual(colorsOf("classic"), DEFAULT_LOOKS);
});

test("a user's theme is found by its id; a missing one has the Classic colors", () => {
  try {
    const colors = mergeColors({ person: { stroke: "#123456" } });
    setUserThemes([{ id: "theme-a", name: "Mine", colors }]);
    assert.equal(colorsOf("theme-a").person.stroke, "#123456");
    assert.equal(colorsOf("theme-a").system.stroke, DEFAULT_LOOKS.system.stroke, "missing colors are the Classic ones");
    assert.deepEqual(colorsOf("theme-gone"), DEFAULT_LOOKS);
    assert.equal(themeName("theme-a"), "Mine");
    assert.equal(themeName("theme-gone"), null);
    assert.deepEqual(themeOptions().map((t) => t.id).slice(-1), ["theme-a"]);
    assert.equal(validTheme("theme-a", [{ id: "theme-a", name: "Mine", colors }]), "theme-a");
    assert.equal(validTheme("theme-gone", []), "classic");
    assert.equal(validTheme("ocean", []), "ocean");
  } finally {
    setUserThemes([]);
  }
});

test("themes go out as JSON without their ids and come back in", () => {
  const colors = mergeColors({ component: { background: "#abcdef" } });
  const json = themesToJson([{ name: "Mine", colors }]);
  assert.ok(!json.includes("theme-"));
  assert.deepEqual(parseThemes(json), [{ name: "Mine", colors }]);
  assert.equal(parseThemes(JSON.stringify({ colors: {} }))?.[0].name, "Imported theme");
  assert.equal(parseThemes("not json"), null);
  assert.equal(parseThemes("[]"), null);
});

test("a new theme gets a new id and a name not taken", () => {
  assert.ok(!isPreset(newThemeId([])));
  assert.equal(uniqueName("Ocean copy", ["Ocean copy", "Ocean copy 2"]), "Ocean copy 3");
  assert.equal(themeSwatches("filled")[0], colorsOf("filled").person.background);
  assert.equal(themeSwatches("classic")[0], DEFAULT_LOOKS.person.stroke, "a white fill shows the outline instead");
});
