import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeColors } from "../src/themes.ts";
import { DEFAULT_LOOKS, lookKeyOf, lookSignature, lookSignatureOf, ownLook, useColors, FONT_SIZE, NAME_FONT_SIZE, ROOM_LINE, SHAPE_VERSION, nameRoom, nameText, shapeDrawing, shapeVersionOf, boxStyle, partOf, shapeOf, shapeParts, cleanMetadata, nearestIn, ELEMENT_WIDTH, KEY, MIN_HEIGHT, PADDING, arrowMidpoint, boxSize, edgePoint, laneLine, laneOffsets, normalOf, rayExit, elementData, elementLabel, lookOf, relationshipData, relationshipLabel, wrap } from "../src/model.ts";

test("wrap breaks at word boundaries and keeps paragraphs", () => {
  assert.deepEqual(wrap("one two three four", 9), ["one two", "three", "four"]);
  assert.deepEqual(wrap("a\nb", 10), ["a", "b"]);
  assert.deepEqual(wrap("supercalifragilistic x", 5), ["supercalifragilistic", "x"]);
});

const ROOM = `${ROOM_LINE}\n${ROOM_LINE}\n`; // the room for a name of one line

test("an element's label has room for its name, kind with technology and description", () => {
  const label = elementLabel({ kind: "container", name: "API", technology: "ASP.NET", description: "Serves the app" });
  assert.equal(label, `${ROOM}[Container: ASP.NET]\n\nServes the app`);
});

test("only containers and components show technology", () => {
  assert.equal(elementLabel({ kind: "system", name: "Billing", technology: "ignored" }), `${ROOM}[Software System]`);
  assert.equal(elementLabel({ kind: "person", name: "Customer", external: true }), `${ROOM}[External Person]`);
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
  assert.notEqual(lookOf({ kind: "system" }).stroke, lookOf({ kind: "system", external: true }).stroke);
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

test("going in a direction picks the nearest box that way, straight ahead before one off to the side", () => {
  const b = (id: string, x: number, y: number) => ({ id, x, y, width: 100, height: 100 });
  const boxes = [b("right", 300, 0), b("rightFar", 600, 0), b("diagonal", 200, 150), b("below", 0, 300), b("left", -300, 20)];
  const from = { x: 50, y: 50 };
  assert.equal(nearestIn(boxes, from, "right")?.id, "right");
  assert.equal(nearestIn(boxes, from, "down")?.id, "below");
  assert.equal(nearestIn(boxes, from, "left")?.id, "left");
  assert.equal(nearestIn(boxes, from, "up"), undefined);
});

test("a container's type gives its shape; without one it is generic, a rounded box like a system; only containers have a type", () => {
  assert.equal(shapeOf({ kind: "person" }), "person");
  assert.equal(shapeOf({ kind: "system" }), "rounded");
  assert.equal(shapeOf({ kind: "container" }), "rounded");
  assert.equal(shapeOf({ kind: "container", type: "generic" }), "rounded");
  assert.equal(shapeOf({ kind: "container", type: "database" }), "cylinder");
  assert.equal(shapeOf({ kind: "container", type: "storage" }), "bucket");
  assert.equal(shapeOf({ kind: "container", type: "directory" }), "folder");
  assert.equal(shapeOf({ kind: "container", type: "server" }), "terminal");
  assert.equal(shapeOf({ kind: "container", type: "web" }), "browser");
  assert.equal(shapeOf({ kind: "container", type: "mobile" }), "phone");
  assert.equal(shapeOf({ kind: "container", type: "desktop" }), "monitor");
  assert.equal(shapeOf({ kind: "container", type: "function" }), "lambda");
  assert.equal(shapeOf({ kind: "container", type: "job" }), "clock");
  assert.equal(shapeOf({ kind: "container", type: "queue" }), "pipe");
  assert.equal(shapeOf({ kind: "component", type: "database" }), "component");
  assert.equal(shapeOf({ kind: "system", type: "database" }), "rounded");
});

test("a box drawn by parts is invisible itself, a rectangle shape is the box", () => {
  assert.equal(boxStyle({ kind: "container", type: "database" }).backgroundColor, "transparent");
  assert.equal(boxStyle({ kind: "container", type: "server" }).backgroundColor, "transparent");
  assert.equal(boxStyle({ kind: "component" }).backgroundColor, "transparent");
  assert.equal(boxStyle({ kind: "system" }).roundness?.type, 3);
  assert.equal(boxStyle({ kind: "person" }).backgroundColor, "transparent");
  assert.equal(boxStyle({ kind: "system" }).backgroundColor, lookOf({ kind: "system" }).background);
});

test("the parts of a shape lie in its box, except a person's head above it and a component's small boxes left of it", () => {
  const box = { x: 10, y: 20, width: 240, height: 150 };
  assert.deepEqual(shapeParts("rounded", box), []);
  const inside = (x: number, y: number) => x >= box.x - 1e-9 && x <= box.x + box.width + 1e-9 && y >= box.y - 1e-9 && y <= box.y + box.height + 1e-9;
  for (const shape of ["terminal", "cylinder", "bucket", "folder", "browser", "phone", "monitor", "lambda", "clock", "pipe"] as const) {
    const parts = shapeParts(shape, box);
    assert.ok(parts.length, shape);
    for (const p of parts) {
      for (const v of p.points ?? []) assert.ok(inside(v.x, v.y), shape);
      if (p.box) assert.ok(inside(p.box.x, p.box.y) && inside(p.box.x + p.box.width, p.box.y + p.box.height), shape);
    }
    const outline = parts[0].points;
    if (outline) assert.deepEqual(outline[0], outline[outline.length - 1], `${shape} outline is closed`);
  }
  const [body, head] = shapeParts("person", box);
  assert.equal(head.type, "ellipse");
  for (const v of body.points!) assert.ok(inside(v.x, v.y), "the body is the box");
  assert.deepEqual(body.points![0], body.points![body.points!.length - 1], "the body is closed");
  assert.ok(head.box!.y < box.y && head.box!.y + head.box!.height > box.y, "the head sits on the body");
  const [frame, ...small] = shapeParts("component", box);
  assert.deepEqual(frame.box, box);
  assert.equal(small.length, 2);
  for (const s of small) assert.ok(s.box!.x < box.x && s.box!.x + s.box!.width > box.x, "the small boxes stand out of the left side");
});

test("a shape with a top, a bar or ends leaves the text room", () => {
  const text = { width: 100, height: 140 };
  assert.ok(boxSize(text, "cylinder").height > boxSize(text).height);
  assert.ok(boxSize(text, "browser").height > boxSize(text).height);
  assert.ok(boxSize(text, "terminal").height > boxSize(text).height);
  assert.ok(boxSize(text, "monitor").height > boxSize(text).height);
  const wide = { width: 260, height: 40 };
  assert.ok(boxSize(wide, "pipe").width > boxSize(wide).width);
  assert.ok(boxSize(wide, "phone").width > boxSize(wide).width);
  assert.equal(boxSize(wide, "pipe").height, boxSize(wide).height);
});

test("a part keeps the id of its box", () => {
  assert.equal(partOf({ [KEY]: { part: "box1" } }), "box1");
  assert.equal(partOf({ [KEY]: { kind: "system", name: "X" } }), null);
  assert.equal(shapeVersionOf({ [KEY]: { part: "box1" } }), 1);
  assert.equal(shapeVersionOf({ [KEY]: { part: "box1", shape: SHAPE_VERSION } }), SHAPE_VERSION);
});

test("a picture of a shape draws a rounded box's own outline too", () => {
  const box = { x: 0, y: 0, width: 240, height: 150 };
  assert.equal(shapeDrawing("rounded", box).length, 1);
  assert.deepEqual(shapeDrawing("cylinder", box), shapeParts("cylinder", box));
});

test("the larger name is drawn over room kept for it at the top of the text of a box, at least as high", () => {
  for (const name of ["API", "Internet Banking System With A Rather Long Name", " "]) {
    const lines = nameText({ name }).split("\n").length;
    assert.ok(nameRoom({ name }) * FONT_SIZE >= lines * NAME_FONT_SIZE, name);
    const label = elementLabel({ kind: "system", name });
    assert.ok(label.startsWith(Array(nameRoom({ name })).fill(ROOM_LINE).join("\n") + "\n["), name);
  }
  assert.equal(nameText({ name: " " }), "Unnamed");
  assert.ok(ROOM_LINE.trim(), "nothing trims the room away");
});

test("each type of element has its colors from the settings, an element its own over them", () => {
  try {
    useColors(mergeColors({ "container-database": { stroke: "#ff0000", text: "not a color" }, external: { background: "#eeeeee" } }));
    const db = { kind: "container" as const, type: "database" as const };
    assert.equal(lookKeyOf(db), "container-database");
    assert.equal(lookKeyOf({ ...db, external: true }), "external");
    assert.equal(lookKeyOf({ kind: "container" }), "container-generic");
    assert.deepEqual(lookOf(db), { ...DEFAULT_LOOKS["container-database"], stroke: "#ff0000" });
    assert.equal(lookOf({ kind: "system", external: true }).background, "#eeeeee");
    assert.deepEqual(lookOf({ ...db, look: { text: "#00ff00" } }), { ...DEFAULT_LOOKS["container-database"], stroke: "#ff0000", text: "#00ff00" });
    assert.equal(lookOf({ kind: "person" }).stroke, DEFAULT_LOOKS.person.stroke);
    // Only the colors that differ from the type's are the element's own.
    assert.deepEqual(ownLook(db, { stroke: "#FF0000", text: "#00ff00" }), { text: "#00ff00" });
    assert.equal(ownLook(db, { stroke: "#ff0000" }), undefined);
    assert.notEqual(lookSignature(lookOf(db)), lookSignature(DEFAULT_LOOKS["container-database"]));
    assert.equal(lookSignatureOf({ [KEY]: { part: "b", look: lookSignature(lookOf(db)) } }), lookSignature(lookOf(db)));
  } finally {
    useColors(DEFAULT_LOOKS);
  }
});

test("a group has the colors of groups in the theme, over which it keeps only its own outline and label", async () => {
  const { groupLookOf, ownGroupLook } = await import("../src/model.ts");
  try {
    useColors({ ...DEFAULT_LOOKS, group: { background: "#ffffff", stroke: "#111111", text: "#222222" } });
    assert.deepEqual(groupLookOf({}), { background: "#ffffff", stroke: "#111111", text: "#222222" });
    assert.equal(groupLookOf({ look: { stroke: "#ff0000" } }).stroke, "#ff0000");
    assert.deepEqual(ownGroupLook({ stroke: "#ff0000", text: "#222222", background: "#00ff00" }), { stroke: "#ff0000" });
    assert.equal(ownGroupLook({ stroke: "#111111" }), undefined);
  } finally {
    useColors(DEFAULT_LOOKS);
  }
});
