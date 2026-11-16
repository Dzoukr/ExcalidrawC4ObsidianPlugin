import { test } from "node:test";
import assert from "node:assert/strict";
import { iconStrokes, simplify, splitAtJumps } from "../src/iconpath.ts";

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
