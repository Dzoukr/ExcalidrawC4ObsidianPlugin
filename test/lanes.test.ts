import { test } from "node:test";
import assert from "node:assert/strict";
import { arrowAlong, labelOn, pairLanes, pairOrder } from "../src/lanes.ts";
import type { LaneEnd } from "../src/lanes.ts";

const glued = (...ids: string[]) => ids.map((id) => ({ id, type: "arrow" }));
const left: LaneEnd = { id: "a", x: 0, y: 0, width: 200, height: 100, boundElements: glued("r1", "r2") };
const right: LaneEnd = { id: "b", x: 500, y: 0, width: 200, height: 100, boundElements: glued("r2", "r1") };

test("the boxes of a pair are in the order of their element ids, whichever is given first", () => {
  assert.deepEqual(pairOrder(left, right).map((e) => e.id), ["a", "b"]);
  assert.deepEqual(pairOrder(right, left).map((e) => e.id), ["a", "b"]);
});

test("arrows either way between two boxes get the same lanes, whichever box is given first", () => {
  const arrows = [{ id: "r1", from: "a" }, { id: "r2", from: "b" }];
  assert.deepEqual(pairLanes(left, right, arrows), pairLanes(right, left, arrows));
});

test("each arrow goes from the box it starts at to the other one", () => {
  const lanes = pairLanes(left, right, [{ id: "r1", from: "a" }, { id: "r2", from: "b" }]);
  const there = lanes.get("r1")!;
  const back = lanes.get("r2")!;
  assert.equal(there.from.id, "a");
  assert.equal(there.to.id, "b");
  assert.equal(there.start.x, 200); // leaves the left box at its right side
  assert.equal(there.end.x, 500);
  assert.equal(back.from.id, "b");
  assert.equal(back.start.x, 500);
  assert.equal(back.end.x, 200);
});

test("the lanes go in the order the arrows are glued to the first box of the pair, side by side", () => {
  const arrows = [{ id: "r2", from: "a" }, { id: "r1", from: "a" }];
  const lanes = pairLanes(right, left, arrows);
  // Glued to "a" as r1, r2: r1 takes the first lane, whatever order the arrows are given in.
  assert.ok(lanes.get("r1")!.start.y < lanes.get("r2")!.start.y);
  const swapped = pairLanes(right, { ...left, boundElements: glued("r2", "r1") }, arrows);
  assert.ok(swapped.get("r2")!.start.y < swapped.get("r1")!.start.y);
  assert.notEqual(lanes.get("r1")!.start.y, lanes.get("r2")!.start.y);
});

test("arrows the first box does not know of take the last lanes", () => {
  const lanes = pairLanes(left, right, [{ id: "stray", from: "a" }, { id: "r1", from: "a" }]);
  assert.ok(lanes.get("r1")!.start.y < lanes.get("stray")!.start.y);
});

test("a single arrow goes along the line between the centers", () => {
  const lane = pairLanes(left, right, [{ id: "r1", from: "a" }]).get("r1")!;
  assert.deepEqual([lane.start, lane.end], [{ x: 200, y: 50 }, { x: 500, y: 50 }]);
});

test("an arrow along a lane is a line of two points from its start, and its label sits on the middle", () => {
  const lane = { start: { x: 10, y: 20 }, end: { x: 110, y: -20 } };
  assert.deepEqual(arrowAlong(lane), { x: 10, y: 20, points: [[0, 0], [100, -40]], width: 100, height: 40 });
  assert.deepEqual(labelOn(lane, { width: 40, height: 10 }), { x: 40, y: -5 });
});
