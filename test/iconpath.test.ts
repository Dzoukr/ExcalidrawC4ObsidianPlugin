import { test } from "node:test";
import assert from "node:assert/strict";
import { iconStrokes, simplify, splitAtJumps } from "../src/iconpath.ts";
import { iconOf, shapeOf, shapeParts, boxSize } from "../src/model.ts";

test("points along an outline split where it jumps to another place", () => {
  const samples = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 10, y: 5 }, { x: 11, y: 5 }];
  assert.deepEqual(splitAtJumps(samples, 1).map((l) => l.length), [3, 2]);
  assert.deepEqual(splitAtJumps([], 1), []);
});

test("a line keeps only the points that bend it", () => {
  const straight = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0 }));
  assert.deepEqual(simplify(straight, 0.1), [{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  const corner = [...Array.from({ length: 6 }, (_, i) => ({ x: i, y: 0 })), ...Array.from({ length: 5 }, (_, i) => ({ x: 5, y: i + 1 }))];
  assert.deepEqual(simplify(corner, 0.1), [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]);
});

test("an icon's strokes fit a square of side 1: a closed line ends where it starts, a tiny one is a dot", () => {
  const vb = { x: 0, y: 0, width: 24, height: 24 };
  const square = [{ x: 2, y: 2 }, { x: 22, y: 2 }, { x: 22, y: 22 }, { x: 2, y: 22 }, { x: 2, y: 2.01 }];
  const [closed, dot] = iconStrokes([square, [{ x: 12, y: 17 }, { x: 12.01, y: 17 }]], vb, 0.08);
  assert.deepEqual(closed[0], closed[closed.length - 1]);
  for (const p of closed) assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  assert.equal(dot.length, 1);
  assert.ok(Math.abs(dot[0].x - 12.005 / 24) < 1e-9);
});

test("only a custom container has an icon, drawn in its top left corner with thin lines and dots", () => {
  assert.equal(shapeOf({ kind: "container", type: "custom", icon: "lucide-shield" }), "icon");
  assert.equal(shapeOf({ kind: "container", icon: "lucide-shield" }), "rounded", "a generic container has none");
  assert.equal(shapeOf({ kind: "container", type: "generic", icon: "lucide-shield" }), "rounded");
  assert.equal(shapeOf({ kind: "container", type: "database", icon: "lucide-shield" }), "cylinder");
  assert.equal(shapeOf({ kind: "system", icon: "lucide-shield" }), "rounded");
  assert.equal(iconOf({ kind: "container", type: "database", icon: "lucide-shield" }), undefined);
  assert.equal(iconOf({ kind: "container", type: "custom", icon: "lucide-shield" }), "lucide-shield");
  assert.equal(iconOf({ kind: "container", icon: "lucide-shield" }), undefined);
  const box = { x: 10, y: 20, width: 240, height: 150 };
  const [rect, line, dot] = shapeParts("icon", box, [[{ x: 0, y: 0 }, { x: 1, y: 1 }], [{ x: 0.5, y: 0.5 }]]);
  assert.equal(rect.type, "rectangle");
  assert.ok(line.fine && line.type === "line");
  assert.ok(dot.fine && dot.type === "ellipse");
  for (const p of line.points!) assert.ok(p.x > box.x && p.x < box.x + 40 && p.y > box.y && p.y < box.y + 30, "in the top left corner");
  assert.deepEqual(shapeParts("icon", box), [rect], "an icon Obsidian lacks leaves a rounded box");
  assert.ok(boxSize({ width: 200, height: 120 }, "icon").height > boxSize({ width: 200, height: 120 }).height, "the text keeps clear of the icon");
});
