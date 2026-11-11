import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, grid, nextSlot, row } from "../src/layers.ts";
import { CONTEXT, KEY, allowedKinds, isGhost, makeWay, overlaps, parentFor, pushOut, storeData, zoomView } from "../src/model.ts";
import { ghostId, ghostsFor } from "../src/ghosts.ts";
import type { C4Element, ViewKind } from "../src/model.ts";
import type { El } from "../src/excalidraw.ts";

const base = { x: 0, y: 0, width: 100, height: 100, strokeColor: "", backgroundColor: "", roughness: 0 };

const box = (boxId: string, data: Partial<C4Element> & Pick<C4Element, "kind">): El => ({
  ...base, id: boxId, type: "rectangle", customData: { [KEY]: { name: boxId, ...data } },
});

const arrow = (id: string, from: string, to: string): El => ({
  ...base, id, type: "arrow",
  startBinding: { elementId: from }, endBinding: { elementId: to },
  customData: { [KEY]: { relationship: true, description: "Uses" } },
});

// System context: user → shop → mail. The shop has a web app and an API; the API has a controller.
const context = [
  box("user", { kind: "person", id: "u" }),
  box("shop", { kind: "system", id: "s" }),
  box("mail", { kind: "system", id: "m", external: true }),
  arrow("a1", "user", "shop"),
  arrow("a2", "shop", "mail"),
];
const shop = [
  box("web", { kind: "container", id: "w", parent: "s" }),
  box("api", { kind: "container", id: "p", parent: "s" }),
  box("user2", { kind: "person", id: "u" }),
  arrow("a3", "user2", "web"),
];

const sceneOf = (layers: Record<string, El[]>) => {
  const views: Record<string, ViewKind | null> = { [CONTEXT]: null };
  for (const l of Object.keys(layers)) if (l !== CONTEXT) views[l] = l === "p" || l === "w" ? "component" : "container";
  return new Scene(new Map(Object.entries(layers)), views);
};

test("an element is in the layer it is kept in", () => {
  const scene = sceneOf({ [CONTEXT]: context, s: shop });
  assert.equal(scene.diagramOf(scene.byId.get("web")!), "s");
  assert.equal(scene.diagramOf(scene.byId.get("user")!), CONTEXT);
  assert.deepEqual(scene.boxes(CONTEXT).map((b) => b.id).sort(), ["mail", "shop", "user"]);
  assert.equal(scene.diagramFor("s"), "s");
  assert.equal(scene.diagramFor("p"), undefined);
  assert.deepEqual(scene.view("s"), { view: "container", scope: "s" });
  assert.equal(scene.view(CONTEXT), null);
});

test("boxes with the same id are one element; old boxes go by their own id", () => {
  const scene = sceneOf({ [CONTEXT]: [...context, box("old", { kind: "system" })], s: shop });
  assert.deepEqual(scene.boxesOf("u").map((b) => b.id), ["user", "user2"]);
  assert.equal(scene.modelId(scene.byId.get("old")!), "old");
});

test("a layer's boundary is the one of its scope", () => {
  const tag = { [KEY]: { boundary: "s" } };
  const scene = sceneOf({ [CONTEXT]: context, s: [...shop, { ...base, id: "b", type: "rectangle", customData: tag }, { ...base, id: "l", type: "text", customData: tag }] });
  const { rect, label } = scene.boundary("s");
  assert.equal(rect?.id, "b");
  assert.equal(label?.id, "l");
  assert.deepEqual(scene.boundary(CONTEXT), {});
});

test("a representative is the element or the innermost element containing it drawn in the layer", () => {
  const scene = sceneOf({ [CONTEXT]: context, s: shop, p: [box("ctl", { kind: "component", id: "c", parent: "p" })] });
  assert.deepEqual(scene.ancestors("c"), ["p", "s"]);
  assert.equal(scene.representative("c", CONTEXT)?.id, "shop");
  assert.equal(scene.representative("c", "s")?.id, "api");
  assert.equal(scene.representative("s", "s"), undefined); // the scope is only a boundary there
});

test("a relationship drawn in a container layer goes up to the system context, unless one is there", () => {
  const scene = sceneOf({ [CONTEXT]: context, s: shop });
  assert.deepEqual(scene.liftTargets("u", "w", "s"), []); // user → shop already exists
  assert.deepEqual(scene.liftTargets("w", "m", "s"), []); // shop → mail exists too
  const fresh = sceneOf({ [CONTEXT]: context.filter((e) => e.id !== "a2"), s: shop });
  assert.deepEqual(fresh.liftTargets("w", "m", "s").map((t) => [t.diagram, t.from.id, t.to.id]), [[CONTEXT, "shop", "mail"]]);
});

test("a relationship inside one element does not go up to it", () => {
  const scene = sceneOf({ [CONTEXT]: context, s: shop });
  assert.deepEqual(scene.liftTargets("w", "p", "s"), []);
});

test("neighbours are what has relationships with the scope or anything in it, at the layer's level", () => {
  const scene = sceneOf({
    [CONTEXT]: [...context, box("other", { kind: "system", id: "x" })],
    s: [...shop, box("db", { kind: "container", id: "d", parent: "s" }), arrow("a6", "web", "api")],
    p: [
      box("ctl", { kind: "component", id: "c", parent: "p" }),
      box("db2", { kind: "container", id: "d", parent: "s" }),
      box("crm", { kind: "container", id: "r", parent: "x" }), // a container of another system
      arrow("a4", "ctl", "db2"),
      arrow("a5", "ctl", "crm"),
    ],
  });
  const of = (scope: string) => scene.neighbours(scope).map((n) => `${n.id}${n.incoming ? "<" : ">"}`).sort();
  assert.deepEqual(of("s"), ["m>", "u<", "x>"]);
  assert.deepEqual(of("p"), ["d>", "w<", "x>"]);
  assert.deepEqual(scene.children("s").sort(), ["d", "p", "w"]);
});

test("each layer takes its own kinds, and new elements get the scope as parent", () => {
  assert.deepEqual(allowedKinds(null), ["person", "system"]);
  assert.ok(allowedKinds("container").includes("container"));
  assert.ok(!allowedKinds("container").includes("component"));
  assert.equal(parentFor("container", { view: "container", scope: "s" }, undefined), "s");
  assert.equal(parentFor("person", { view: "container", scope: "s" }, undefined), undefined);
  assert.equal(parentFor("component", { view: "component", scope: "p" }, "s"), "p");
  assert.equal(parentFor("container", { view: "component", scope: "p" }, "s"), "s");
  assert.equal(parentFor("system", null, undefined), undefined);
});

test("only internal systems and containers can be zoomed into", () => {
  assert.equal(zoomView({ kind: "system" }), "container");
  assert.equal(zoomView({ kind: "container" }), "component");
  assert.equal(zoomView({ kind: "system", external: true }), null);
  assert.equal(zoomView({ kind: "component" }), null);
});

test("the store of layers is recognized only with the right shape", () => {
  const store = { current: "", views: { "": null }, hidden: {} };
  assert.deepEqual(storeData({ [KEY]: { store } }), store);
  assert.equal(storeData({ [KEY]: { store: { current: "" } } }), null);
  assert.equal(storeData({ [KEY]: { kind: "system", name: "X" } }), null);
});

test("pushOut moves a box the shortest way out of an obstacle's reach", () => {
  const obstacle = { x: 0, y: 0, width: 100, height: 100 };
  assert.deepEqual(pushOut({ x: 300, y: 0, width: 10, height: 10 }, obstacle, 20), { x: 300, y: 0 });
  assert.deepEqual(pushOut({ x: 90, y: 40, width: 20, height: 20 }, obstacle, 20), { x: 120, y: 40 });
  assert.deepEqual(pushOut({ x: 40, y: -5, width: 20, height: 20 }, obstacle, 20), { x: 40, y: -40 });
  assert.ok(overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 15, y: 0, width: 10, height: 10 }, 10));
  assert.ok(!overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 15, y: 0, width: 10, height: 10 }));
});

test("layout helpers", () => {
  const b = { x: 0, y: 0, width: 10, height: 10 };
  assert.deepEqual(nextSlot([b], null, 5, 0), { x: 0, y: 15 });
  assert.deepEqual(nextSlot([], { x: 100, y: 100, width: 50, height: 50 }, 5, 7), { x: 107, y: 107 });
  assert.deepEqual(grid(4, { x: 0, y: 0 }, { width: 10, height: 10 }, 5), [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 0, y: 15 }, { x: 15, y: 15 }]);
  assert.deepEqual(row(2, 0, 0, 10, 4), [{ x: -12, y: 0 }, { x: 2, y: 0 }]);
});

test("the drawing around an element makes way as it grows", () => {
  const way = makeWay({ x: 0, y: 0, width: 100, height: 100 }, { x: -50, y: -20, width: 300, height: 200 });
  assert.deepEqual(way.move({ x: 200, y: 0, width: 50, height: 50 }), { x: 150, y: 0 }); // right of it
  assert.deepEqual(way.move({ x: -200, y: -200, width: 50, height: 50 }), { x: -50, y: -20 }); // above left
  assert.deepEqual(way.move({ x: 25, y: 300, width: 50, height: 50 }), { x: 0, y: 80 }); // below
  // A boundary around it grows edge by edge.
  assert.deepEqual(way.stretch({ x: -10, y: -10, width: 300, height: 120 }), { x: -60, y: -30, width: 500, height: 220 });
});

test("the levels above show around the layer, making way for it, without repeating its elements", () => {
  const at = (e: El, x: number, y: number) => ({ ...e, x, y });
  const tag = { [KEY]: { boundary: "s" } };
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
      { ...base, id: "b", type: "rectangle", x: -200, y: -100, width: 500, height: 300, customData: tag },
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
  assert.ok(ghosts.every((e) => e.locked && isGhost(e.customData) && !e.startBinding));
  assert.deepEqual(ghostsFor(scene, CONTEXT), []);
});

test("a relationship carried down to a boundary shows as a ghost one level further down", () => {
  const at = (e: El, x: number, y: number) => ({ ...e, x, y });
  const shopTag = { [KEY]: { boundary: "s" } };
  const webTag = { [KEY]: { boundary: "w" } };
  const scene = sceneOf({
    [CONTEXT]: [at(box("user", { kind: "person", id: "u" }), 0, -300), at(box("shop", { kind: "system", id: "s" }), 0, 0)],
    s: [
      { ...base, id: "sb", type: "rectangle", x: -200, y: -100, width: 500, height: 300, customData: shopTag },
      at(box("user2", { kind: "person", id: "u" }), 0, -500),
      at(box("web", { kind: "container", id: "w", parent: "s" }), -100, 0),
      arrow("carried", "user2", "sb"),
    ],
    w: [{ ...base, id: "wb", type: "rectangle", x: -150, y: -50, width: 300, height: 200, customData: webTag }],
  });
  const ghosts = ghostsFor(scene, "w");
  const carried = ghosts.find((e) => e.id === ghostId("carried"));
  assert.ok(carried, "the carried relationship is shown");
  assert.ok(ghosts.some((e) => e.id === ghostId("sb")), "with the boundary it goes to");
});
