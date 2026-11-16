import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUNDARY_LABEL, BOUNDARY_PAD, CONTEXT, isGhost } from "../src/model.ts";
import { fade, ghostId, ghostTextId, ghostsFor } from "../src/ghosts.ts";
import type { El } from "../src/excalidraw.ts";
import { arrow, at, base, boundary, box, sceneOf } from "./fixtures.ts";

test("the levels above show around the layer, making way for it, without repeating its elements", () => {
  const scene = sceneOf({
    [CONTEXT]: [
      at(box("user", { kind: "person", id: "u" }), 0, -300),
      at(box("shop", { kind: "system", id: "s" }), 0, 0),
      at(box("mail", { kind: "system", id: "m", external: true }), 500, 0),
      at(box("other", { kind: "system", id: "o" }), -600, 0),
      arrow("a1", "user", "shop"),
      arrow("a2", "user", "mail"),
    ],
    s: [
      boundary("b", "s", { x: -200, y: -100, width: 500, height: 300 }),
      at(box("web", { kind: "container", id: "w", parent: "s" }), -100, 0),
      at(box("user2", { kind: "person", id: "u" }), 0, -500),
    ],
  });
  const ghosts = ghostsFor(scene, "s");
  const g = (id: string) => ghosts.find((e) => e.id === ghostId(id));
  assert.equal(g("shop"), undefined); // opened as the boundary
  assert.equal(g("user"), undefined); // drawn in the layer
  assert.deepEqual([g("mail")?.x, g("mail")?.y], [700, 0]);
  assert.deepEqual([g("other")?.x, g("other")?.y], [-800, 0]);
  assert.equal(g("a1"), undefined); // to the opened element
  const a2 = g("a2")!;
  assert.ok(a2.y < -300 && a2.x >= 0); // from the user in the layer to the moved mail
  assert.ok(ghosts.every((e) => !e.locked && isGhost(e.customData) && !e.startBinding), "selectable, to connect a relationship to");
  assert.deepEqual(ghostsFor(scene, CONTEXT), []);
});

test("a relationship carried down to a boundary shows as a ghost one level further down", () => {
  const scene = sceneOf({
    [CONTEXT]: [at(box("user", { kind: "person", id: "u" }), 0, -300), at(box("shop", { kind: "system", id: "s" }), 0, 0)],
    s: [
      boundary("sb", "s", { x: -200, y: -100, width: 500, height: 300 }),
      at(box("user2", { kind: "person", id: "u" }), 0, -500),
      at(box("web", { kind: "container", id: "w", parent: "s" }), -100, 0),
      arrow("carried", "user2", "sb"),
    ],
    w: [boundary("wb", "w", { x: -150, y: -50, width: 300, height: 200 })],
  });
  const ghosts = ghostsFor(scene, "w");
  const carried = ghosts.find((e) => e.id === ghostId("carried"));
  assert.ok(carried, "the carried relationship is shown");
  assert.ok(ghosts.some((e) => e.id === ghostId("sb")), "with the boundary it goes to");
});

test("a boundary of a level above grows around its elements drawn in the layer", () => {
  const scene = sceneOf({
    [CONTEXT]: [at(box("shop", { kind: "system", id: "s" }), 0, 0)],
    s: [
      boundary("sb", "s", { x: -50, y: -50, width: 400, height: 250 }),
      at(box("api", { kind: "container", id: "p", parent: "s" }), 0, 0),
      at(box("web", { kind: "container", id: "w", parent: "s" }), 200, 0),
    ],
    p: [
      boundary("pb", "p", { x: -100, y: -100, width: 300, height: 300 }),
      at(box("web2", { kind: "container", id: "w", parent: "s" }), 500, 400), // the sibling, beyond where the boundary reaches
      at(box("user", { kind: "person", id: "u" }), -900, -900), // not in the shop: left out
    ],
  });
  const sb = ghostsFor(scene, "p").find((e) => e.id === ghostId("sb"))!;
  assert.ok(sb.x + sb.width >= 600 + BOUNDARY_PAD && sb.y + sb.height >= 500 + BOUNDARY_PAD + BOUNDARY_LABEL, "around the sibling");
  assert.ok(sb.x <= -100 - BOUNDARY_PAD && sb.y <= -100 - BOUNDARY_PAD, "and the layer opened in it");
  assert.ok(sb.x > -900, "but not the person");
});

test("a ghost's text keeps a short id of its own, bound to the ghost of its box", () => {
  const text: El = { ...base, id: "t1", type: "text", text: "Mail", containerId: "mail" };
  const mail = box("mail", { kind: "system", id: "m", external: true }, { x: 400, boundElements: [{ type: "text", id: "t1" }] });
  const scene = sceneOf({
    [CONTEXT]: [box("shop", { kind: "system", id: "s" }), mail, text],
    s: [boundary("sb", "s", { x: -50, y: -50, width: 200, height: 200 })],
  });
  const ghosts = ghostsFor(scene, "s");
  const g = ghosts.find((e) => e.id === ghostId("mail"))!;
  const t = ghosts.find((e) => e.type === "text")!;
  assert.equal(t.id, ghostTextId("t1"));
  assert.ok(t.id.length <= 8);
  assert.equal(ghostTextId("t1"), ghostTextId("t1"));
  assert.notEqual(ghostTextId("t1"), ghostTextId("t2"));
  assert.equal(t.containerId, g.id);
  assert.deepEqual(g.boundElements, [{ type: "text", id: t.id }]);
});

test("ghosts are dimmed by mixing their colors with white, so their fills still hide what is behind them", () => {
  assert.equal(fade("#ffffff", 0.35), "#ffffff");
  assert.equal(fade("#000000", 0.5), "#808080");
  assert.equal(fade("#000", 0.5), "#808080");
  assert.equal(fade("transparent", 0.35), "transparent");
  assert.equal(fade("rgba(0,0,0,1)", 0.35), null);
});
