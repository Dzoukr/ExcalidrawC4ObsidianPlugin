import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMetadata, ELEMENT_WIDTH, KEY, MIN_HEIGHT, PADDING, arrowMidpoint, boxSize, edgePoint, laneLine, laneOffsets, normalOf, rayExit, elementData, elementLabel, lookOf, relationshipData, relationshipLabel, wrap } from "../src/model.ts";

test("wrap breaks at word boundaries and keeps paragraphs", () => {
  assert.deepEqual(wrap("one two three four", 9), ["one two", "three", "four"]);
  assert.deepEqual(wrap("a\nb", 10), ["a", "b"]);
  assert.deepEqual(wrap("supercalifragilistic x", 5), ["supercalifragilistic", "x"]);
});

test("an element's label has its name, kind with technology and description", () => {
  const label = elementLabel({ kind: "container", name: "API", technology: "ASP.NET", description: "Serves the app" });
  assert.equal(label, "API\n[Container: ASP.NET]\n\nServes the app");
});

test("only containers and components show technology", () => {
  assert.equal(elementLabel({ kind: "system", name: "Billing", technology: "ignored" }), "Billing\n[Software System]");
  assert.equal(elementLabel({ kind: "person", name: "Customer", external: true }), "Customer\n[External Person]");
});

test("a relationship label defaults to Uses and shows technology in brackets", () => {
  assert.equal(relationshipLabel({ relationship: true, description: "" }), "Uses");
  assert.equal(relationshipLabel({ relationship: true, description: "Reads from", technology: "SQL" }), "Reads from\n[SQL]");
});

test("data is recognized only with the right shape", () => {
  assert.deepEqual(elementData({ [KEY]: { kind: "component", name: "X" } }), { kind: "component", name: "X" });
  assert.equal(elementData({ [KEY]: { kind: "nope", name: "X" } }), null);
  assert.equal(elementData(undefined), null);
  assert.equal(relationshipData({ [KEY]: { kind: "system", name: "X" } }), null);
  assert.ok(relationshipData({ [KEY]: { relationship: true, description: "Uses" } }));
});

test("external elements are grey", () => {
  assert.notEqual(lookOf({ kind: "system" }).background, lookOf({ kind: "system", external: true }).background);
});

test("edgePoint finds where the line toward a point leaves the box", () => {
  const box = { x: 0, y: 0, width: 100, height: 50 };
  assert.deepEqual(edgePoint(box, { x: 500, y: 25 }), { x: 100, y: 25 });
  assert.deepEqual(edgePoint(box, { x: 50, y: -300 }), { x: 50, y: 0 });
  assert.deepEqual(edgePoint(box, { x: 50, y: 25 }), { x: 50, y: 25 });
});

test("boxSize keeps the fixed size unless the text needs more", () => {
  assert.deepEqual(boxSize({ width: 100, height: 40 }), { width: ELEMENT_WIDTH, height: MIN_HEIGHT });
  assert.deepEqual(boxSize({ width: 300, height: 200 }), { width: 300 + 2 * PADDING, height: 200 + 2 * PADDING });
});

test("arrowMidpoint is halfway along a straight arrow, else its middle point", () => {
  assert.deepEqual(arrowMidpoint({ x: 10, y: 20, points: [[0, 0], [100, 50]] }), { x: 60, y: 45 });
  assert.deepEqual(arrowMidpoint({ x: 0, y: 0, points: [[0, 0], [5, 5], [10, 0]] }), { x: 5, y: 5 });
  assert.deepEqual(arrowMidpoint({ x: 3, y: 4 }), { x: 3, y: 4 });
});

test("relationships between the same elements lie in lanes centered on the line between them", () => {
  assert.deepEqual(laneOffsets(1), [0]);
  assert.deepEqual(laneOffsets(3, 10), [-10, 0, 10]);
});

test("rayExit finds where a ray from inside a box leaves it", () => {
  const box = { x: 0, y: 0, width: 100, height: 50 };
  assert.deepEqual(rayExit(box, { x: 50, y: 25 }, { x: 1, y: 0 }), { x: 100, y: 25 });
  assert.deepEqual(rayExit(box, { x: 50, y: 10 }, { x: 0, y: -1 }), { x: 50, y: 0 });
});

test("a lane is parallel to the line between the boxes, shifted the same way in both directions", () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  const b = { x: 300, y: 0, width: 100, height: 100 };
  const n = normalOf({ x: 50, y: 50 }, { x: 350, y: 50 });
  assert.deepEqual(n, { x: -0, y: 1 });
  const there = laneLine(a, b, n, 20);
  assert.deepEqual([there.start, there.end], [{ x: 100, y: 70 }, { x: 300, y: 70 }]);
  const back = laneLine(b, a, n, -20);
  assert.deepEqual([back.start, back.end], [{ x: 300, y: 30 }, { x: 100, y: 30 }]);
  // An offset bigger than the box stays inside it.
  assert.equal(laneLine(a, b, n, 500).aimFrom.y, 90);
});

test("metadata keeps rows with a key, trimmed, the last of the same key winning", () => {
  assert.deepEqual(cleanMetadata([[" owner ", " Team A "], ["", "lost"], ["  ", "lost too"], ["tier", "1"], ["owner", "Team B"]]), { owner: "Team B", tier: "1" });
  assert.equal(cleanMetadata([]), undefined);
  assert.equal(cleanMetadata([["", "x"]]), undefined);
  assert.deepEqual(cleanMetadata([["empty", ""]]), { empty: "" });
});
