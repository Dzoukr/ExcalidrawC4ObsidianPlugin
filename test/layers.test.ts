import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, copiesOf, endsOf, grid, guarded, levelsUpTo, relationshipsWithin, markPatches, misplaced, nextSlot, row, unrelated } from "../src/layers.ts";
import { BOUNDARY_LABEL, BOUNDARY_PAD, CONTEXT, ELEMENT_WIDTH, KEY, MIN_HEIGHT, MISPLACED_LOOK, allowedKinds, canBeExternal, lookOf, parentKind, fittedBoundary, isGhost, makeWay, overlaps, parentFor, pushOut, storeData, wayBack, zoomView } from "../src/model.ts";
import { ghostId, ghostTextId, ghostsFor } from "../src/ghosts.ts";
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
  assert.deepEqual(allowedKinds("container"), ["container"]); // only the level's own kind
  assert.deepEqual(allowedKinds("component"), ["component"]);
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

test("an element added on a level is copied to every level above it, up to its own", () => {
  const scene = sceneOf({
    [CONTEXT]: [box("shop", { kind: "system", id: "s" })],
    s: [box("api", { kind: "container", id: "p", parent: "s" })],
    p: [],
  });
  assert.deepEqual(levelsUpTo(scene, "p", undefined), ["s", CONTEXT]); // a person added among components
  assert.deepEqual(levelsUpTo(scene, "p", "s"), ["s"]); // a container added among components
  assert.deepEqual(levelsUpTo(scene, "p", "p"), []); // a component, at home
  assert.deepEqual(levelsUpTo(scene, "s", undefined), [CONTEXT]);
  assert.deepEqual(levelsUpTo(scene, CONTEXT, undefined), []);
});

test("going up a level, a place shrinks back with the element opened below", () => {
  const from = { x: 0, y: 0, width: 100, height: 100 };
  const to = { x: -50, y: -20, width: 300, height: 200 };
  const way = makeWay(from, to);
  const back = wayBack(from, to);
  // Whatever made way going down comes back to where it was.
  for (const b of [{ x: 200, y: 0, width: 50, height: 50 }, { x: -200, y: -200, width: 50, height: 50 }, { x: 25, y: 300, width: 50, height: 50 }]) {
    const d = way.move(b);
    assert.deepEqual(back({ ...b, x: b.x + d.x, y: b.y + d.y }), { x: b.x, y: b.y });
  }
  // Below the grown element, near its right side: below the element, near its right side.
  const p = back({ x: 180, y: 400, width: 40, height: 40 });
  assert.equal(p.y, 400 - 80);
  assert.ok(p.x + 20 > 50 && p.x + 20 <= 100);
});

test("a boundary fits the elements in it, but is never smaller than one element", () => {
  const big = { x: -500, y: -500, width: 2000, height: 2000 };
  const one = { x: 0, y: 0, width: ELEMENT_WIDTH, height: MIN_HEIGHT };
  // Shrinks around one element, with room for its label below.
  assert.deepEqual(fittedBoundary(big, [one]), {
    x: -BOUNDARY_PAD, y: -BOUNDARY_PAD, width: ELEMENT_WIDTH + 2 * BOUNDARY_PAD, height: MIN_HEIGHT + 2 * BOUNDARY_PAD + BOUNDARY_LABEL,
  });
  // Grows around two side by side.
  const two = fittedBoundary(big, [one, { ...one, x: 400 }]);
  assert.equal(two.width, 400 + ELEMENT_WIDTH + 2 * BOUNDARY_PAD);
  // Empty: the least size, around where it was.
  const empty = fittedBoundary({ x: 0, y: 0, width: 1000, height: 1000 }, []);
  assert.deepEqual([empty.x + empty.width / 2, empty.y + empty.height / 2], [500, 500]);
  assert.equal(empty.width, ELEMENT_WIDTH + 2 * BOUNDARY_PAD);
  // A long label keeps it wide enough.
  assert.equal(fittedBoundary(big, [one], { width: 500 }).width, 500 + 2 * BOUNDARY_PAD);
});

test("containers and components are external as their system is", () => {
  const scene = sceneOf({
    [CONTEXT]: context,
    s: shop,
    m: [box("queue", { kind: "container", id: "q", parent: "m" }), box("worker", { kind: "component", id: "k", parent: "q" })],
  });
  assert.equal(scene.inheritedExternal("s"), false);
  assert.equal(scene.inheritedExternal("m"), true);
  assert.equal(scene.inheritedExternal("q"), true);
  assert.equal(scene.inheritedExternal(undefined), false);
  assert.deepEqual(scene.descendants("m").sort(), ["k", "q"]);
  assert.deepEqual([canBeExternal("person"), canBeExternal("system"), canBeExternal("container"), canBeExternal("component")], [true, true, false, false]);
  assert.deepEqual([parentKind("container"), parentKind("component"), parentKind("system")], ["system", "container", null]);
});

test("a box is misplaced outside the boundary of its scope, or inside one it does not belong in", () => {
  const tag = { [KEY]: { boundary: "s" } };
  const rect: El = { ...base, id: "b", type: "rectangle", x: 0, y: 0, width: 500, height: 500, customData: tag };
  const at = (e: El, x: number, y: number): El => ({ ...e, x, y });
  const layer = [
    rect,
    at(shop[0], 50, 50), // web, inside: fine
    at(shop[1], 700, 50), // api, dragged out
    at(shop[2], 200, 200), // user, dragged in
  ];
  const scene = sceneOf({ [CONTEXT]: context, s: layer });
  assert.deepEqual(misplaced(scene, "s").map((b) => b.id).sort(), ["api", "user2"]);
  assert.deepEqual(misplaced(scene, CONTEXT), []);

  // Marked red, and back to their own outline once in place again.
  const patches = new Map(markPatches(scene, "s"));
  assert.deepEqual([...patches.keys()].sort(), ["api", "user2"]);
  assert.equal(patches.get("api")!.strokeColor, MISPLACED_LOOK.strokeColor);
  const fixed = sceneOf({ [CONTEXT]: context, s: [rect, at(shop[0], 50, 50), { ...at(shop[1], 200, 50), ...MISPLACED_LOOK }] });
  assert.deepEqual(markPatches(fixed, "s"), [["api", { strokeColor: lookOf({ kind: "container" }).stroke, strokeWidth: 1, strokeStyle: "solid" }]]);
});

test("a boundary of a level above grows around its elements drawn in the layer", () => {
  const at = (e: El, x: number, y: number) => ({ ...e, x, y });
  const shopTag = { [KEY]: { boundary: "s" } };
  const apiTag = { [KEY]: { boundary: "p" } };
  const scene = sceneOf({
    [CONTEXT]: [at(box("shop", { kind: "system", id: "s" }), 0, 0)],
    s: [
      { ...base, id: "sb", type: "rectangle", x: -50, y: -50, width: 400, height: 250, customData: shopTag },
      at(box("api", { kind: "container", id: "p", parent: "s" }), 0, 0),
      at(box("web", { kind: "container", id: "w", parent: "s" }), 200, 0),
    ],
    p: [
      { ...base, id: "pb", type: "rectangle", x: -100, y: -100, width: 300, height: 300, customData: apiTag },
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
  const mail: El = { ...box("mail", { kind: "system", id: "m", external: true }), x: 400, boundElements: [{ type: "text", id: "t1" }] };
  const scene = sceneOf({
    [CONTEXT]: [box("shop", { kind: "system", id: "s" }), mail, text],
    s: [{ ...base, id: "sb", type: "rectangle", x: -50, y: -50, width: 200, height: 200, customData: { [KEY]: { boundary: "s" } } }],
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

test("a layer guards what comes from the levels above against deleting, not its own elements", () => {
  const tag = { [KEY]: { boundary: "p" } };
  const text: El = { ...base, id: "wt", type: "text", containerId: "web" };
  const layer = [
    { ...base, id: "pb", type: "rectangle", customData: tag }, // the boundary
    box("ctl", { kind: "component", id: "c", parent: "p" }), // of the level
    { ...box("web", { kind: "container", id: "w", parent: "s" }), boundElements: [{ type: "text", id: "wt" }] }, // a sibling container
    text,
    box("user", { kind: "person", id: "u" }),
    arrow("up", "user", "web"), // between two of the levels above
    arrow("own", "user", "ctl"), // with an end on the level
    arrow("uses", "ctl", "web"), // which ties the sibling container to the layer
    arrow("carried", "user", "pb"), // to the boundary
  ];
  const scene = sceneOf({ [CONTEXT]: context, s: shop, p: layer });
  assert.deepEqual([...guarded(scene, "p")].sort(), ["pb", "up", "user", "web", "wt"]);
  assert.deepEqual([...guarded(scene, CONTEXT)], []); // the system context is all one level
});

test("a box around a boundary with no relationship to its scope any more is out of the layer", () => {
  const tag = { [KEY]: { boundary: "s" } };
  const layer = [
    { ...base, id: "sb", type: "rectangle", customData: tag, boundElements: [{ type: "arrow", id: "carried" }] },
    box("web", { kind: "container", id: "w", parent: "s" }),
    box("user2", { kind: "person", id: "u" }), // uses the shop, one level up
    box("mail2", { kind: "system", id: "m", external: true }), // used by the shop, one level up
    box("bank", { kind: "system", id: "b" }), // its relationship is gone
    box("admin", { kind: "person", id: "a" }), // only carried down to the boundary
    arrow("carried", "admin", "sb"),
  ];
  const scene = sceneOf({ [CONTEXT]: [...context, box("bank0", { kind: "system", id: "b" }), box("admin0", { kind: "person", id: "a" })], s: layer });
  assert.deepEqual(unrelated(scene, "s").map((b) => b.id), ["bank"]);
  assert.ok(!guarded(scene, "s").has("bank"), "and it can be deleted");
  assert.ok(guarded(scene, "s").has("user2"));
  assert.deepEqual(unrelated(scene, CONTEXT), []);
});

test("a relationship stands for the ones below between the same elements or anything inside them", () => {
  const tag = { [KEY]: { boundary: "s" } };
  const scene = sceneOf({
    [CONTEXT]: context, // user → shop, shop → mail
    s: [
      { ...base, id: "sb", type: "rectangle", customData: tag },
      ...shop, // user → web
      box("mail2", { kind: "system", id: "m", external: true }),
      arrow("carried", "user2", "sb"), // user → the shop's boundary
      arrow("out", "api", "mail2"), // api → mail
    ],
  });
  assert.deepEqual(endsOf(scene, scene.byId.get("carried")!), ["u", "s"]);
  assert.deepEqual(relationshipsWithin(scene, "u", "s", CONTEXT).map((a) => a.id).sort(), ["a3", "carried"]);
  assert.deepEqual(relationshipsWithin(scene, "s", "m", CONTEXT).map((a) => a.id), ["out"]);
  assert.deepEqual(relationshipsWithin(scene, "s", "u", CONTEXT), []); // the other way round is another relationship
  assert.deepEqual(relationshipsWithin(scene, "u", "w", "s"), []); // not up a level
});

test("a relationship's copies are the same relationship up or down a level, saying the same", () => {
  const says = (a: El, description: string): El => ({ ...a, customData: { [KEY]: { relationship: true, description } } });
  const tag = { [KEY]: { boundary: "s" } };
  const scene = sceneOf({
    [CONTEXT]: context, // a1: user → shop, "Uses"
    s: [
      { ...base, id: "sb", type: "rectangle", customData: tag },
      ...shop.filter((e) => e.id !== "a3"),
      arrow("a3", "user2", "web"), // user → web app, "Uses": a copy
      says(arrow("a4", "user2", "api"), "Calls"), // user → API, says something else
      arrow("back", "web", "user2"), // the other way round
      arrow("carried", "user2", "sb"), // user → the shop's boundary, "Uses": a copy
    ],
  });
  assert.deepEqual(copiesOf(scene, scene.byId.get("a1")!).map((a) => a.id).sort(), ["a3", "carried"]);
  assert.deepEqual(copiesOf(scene, scene.byId.get("a3")!).map((a) => a.id), ["a1"]); // up a level, not in its own layer
  assert.deepEqual(copiesOf(scene, scene.byId.get("a4")!), []);
});
