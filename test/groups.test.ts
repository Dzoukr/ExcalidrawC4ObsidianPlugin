import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene } from "../src/layers.ts";
import { LayerGroups, isGroupElement } from "../src/groups.ts";
import { ghostsFor } from "../src/ghosts.ts";
import { CONTEXT, FONT_SIZE, GROUP_LABEL, GROUP_PAD, KEY, fittedGroup, groupData, groupLabelAt } from "../src/model.ts";
import type { C4Element, C4Group, ViewKind } from "../src/model.ts";
import type { El } from "../src/excalidraw.ts";

const base = { x: 0, y: 0, width: 100, height: 100, strokeColor: "", backgroundColor: "", roughness: 0 };

const box = (boxId: string, data: Partial<C4Element> & Pick<C4Element, "kind">, at: Partial<El> = {}): El => ({
  ...base, ...at, id: boxId, type: "rectangle", customData: { [KEY]: { name: boxId, ...data } },
});

const group = (rectId: string, data: Partial<C4Group> & Pick<C4Group, "group">, at: Partial<El> = {}): El[] => [
  { ...base, ...at, id: rectId, type: "rectangle", strokeStyle: "dotted", customData: { [KEY]: { name: rectId, members: [], ...data } } },
  { ...base, id: `${rectId}-label`, type: "text", width: 60, height: 20, fontSize: FONT_SIZE, customData: { [KEY]: { part: rectId } } },
];

const sceneOf = (layers: Record<string, El[]>) => {
  const views: Record<string, ViewKind | null> = { [CONTEXT]: null };
  for (const l of Object.keys(layers)) if (l !== CONTEXT) views[l] = "container";
  return new Scene(new Map(Object.entries(layers)), views);
};

/** Applies changes to elements, as a commit would. */
const apply = (els: El[], patches: [string, Partial<El>][]) => els.map((e) => ({ ...e, ...Object.fromEntries(patches.filter(([id]) => id === e.id).flatMap(([, p]) => Object.entries(p))) }));

test("a group's data is read from its box, with its members", () => {
  assert.deepEqual(groupData({ [KEY]: { group: "g", name: "Orders" } }), { group: "g", name: "Orders", members: [] });
  assert.deepEqual(groupData({ [KEY]: { group: "g", name: "Orders", members: ["a", 1, "b"] } })?.members, ["a", "b"]);
  assert.equal(groupData({ [KEY]: { kind: "system", name: "S" } }), null);
  assert.equal(groupData(undefined), null);
});

test("a group fits around what is in it, with room for its label below; empty, it stays as it is", () => {
  const inner = [{ x: 0, y: 0, width: 100, height: 50 }, { x: 200, y: 100, width: 100, height: 50 }];
  assert.deepEqual(fittedGroup({ x: 9, y: 9, width: 9, height: 9 }, inner), {
    x: -GROUP_PAD, y: -GROUP_PAD, width: 300 + 2 * GROUP_PAD, height: 150 + 2 * GROUP_PAD + GROUP_LABEL,
  });
  assert.equal(fittedGroup({ x: 0, y: 0, width: 0, height: 0 }, inner, { width: 1000 }).width, 1000 + GROUP_PAD);
  assert.deepEqual(fittedGroup({ x: 5, y: 6, width: 7, height: 8 }, []), { x: 5, y: 6, width: 7, height: 8 });
});

test("a group's box and its label are told apart from other elements", () => {
  const els = [...group("g1", { group: "g" }), box("a", { kind: "system" })];
  const byId = new Map(els.map((e) => [e.id, e]));
  assert.ok(isGroupElement(byId, byId.get("g1")!));
  assert.ok(isGroupElement(byId, byId.get("g1-label")!));
  assert.ok(!isGroupElement(byId, byId.get("a")!));
});

// Two systems in an inner group, nested in an outer group with a third system.
const nested = () => [
  box("a", { kind: "system", id: "A" }, { x: 0, y: 0 }),
  box("b", { kind: "system", id: "B" }, { x: 200, y: 0 }),
  box("c", { kind: "system", id: "C" }, { x: 0, y: 400 }),
  ...group("in", { group: "gi", parent: "go", members: ["A", "B"] }),
  ...group("out", { group: "go", members: ["C"] }),
];

test("groups nest in one another, and know what is in them", () => {
  const groups = new LayerGroups(sceneOf({ [CONTEXT]: nested() }), CONTEXT);
  const inner = groups.get("gi")!;
  const outer = groups.get("go")!;
  assert.equal(groups.parent(inner), outer);
  assert.equal(groups.parent(outer), undefined);
  assert.deepEqual(groups.children(outer), [inner]);
  assert.deepEqual(groups.leafBoxes(outer).map((b) => b.id).sort(), ["a", "b", "c"]);
  assert.equal(groups.groupOf("A"), inner);
  assert.equal(groups.groupOf("C"), outer);
  assert.equal(inner.label?.id, "in-label");
});

test("groups nested round a cycle are in none", () => {
  const els = [...group("x", { group: "gx", parent: "gy" }), ...group("y", { group: "gy", parent: "gx" })];
  const groups = new LayerGroups(sceneOf({ [CONTEXT]: els }), CONTEXT);
  assert.equal(groups.parent(groups.get("gx")!), undefined);
  assert.equal(groups.parent(groups.get("gy")!), undefined);
  assert.equal(groups.fitted().size, 2);
});

test("every group is fitted to what is in it, the nested ones first, with its label at its bottom left", () => {
  let els = nested();
  const fitted = new LayerGroups(sceneOf({ [CONTEXT]: els }), CONTEXT).fitted();
  const inner = fitted.get("in")!;
  const outer = fitted.get("out")!;
  assert.deepEqual(inner, { x: -GROUP_PAD, y: -GROUP_PAD, width: 300 + 2 * GROUP_PAD, height: 100 + 2 * GROUP_PAD + GROUP_LABEL });
  assert.deepEqual(outer, {
    x: inner.x - GROUP_PAD, y: inner.y - GROUP_PAD, width: inner.width + 2 * GROUP_PAD, height: 500 + 3 * GROUP_PAD + GROUP_LABEL,
  });
  els = apply(els, new LayerGroups(sceneOf({ [CONTEXT]: els }), CONTEXT).patches());
  const label = els.find((e) => e.id === "out-label")!;
  assert.deepEqual({ x: label.x, y: label.y }, groupLabelAt(outer, label));
  // Fitted, it stays.
  assert.deepEqual(new LayerGroups(sceneOf({ [CONTEXT]: els }), CONTEXT).patches(), []);
});

test("members not drawn in the layer leave a group as it is", () => {
  const els = [...group("g1", { group: "g", members: ["gone"] }, { x: 5, y: 5, width: 50, height: 50 })];
  const groups = new LayerGroups(sceneOf({ [CONTEXT]: els }), CONTEXT);
  assert.deepEqual(groups.fitted().get("g1"), { x: 5, y: 5, width: 50, height: 50 });
});

test("what is dropped goes into the innermost group under its center", () => {
  let els = nested();
  els = apply(els, new LayerGroups(sceneOf({ [CONTEXT]: els }), CONTEXT).patches());
  const groups = new LayerGroups(sceneOf({ [CONTEXT]: els }), CONTEXT);
  const inner = groups.get("gi")!;
  const outer = groups.get("go")!;
  assert.equal(groups.dropTarget({ x: 100, y: 0, width: 100, height: 100 }), inner);
  assert.equal(groups.dropTarget({ x: 0, y: 300, width: 100, height: 100 }), outer);
  assert.equal(groups.dropTarget({ x: 2000, y: 0, width: 100, height: 100 }), undefined);
  // A group is not dropped into itself or the groups in it.
  assert.equal(groups.dropTarget(inner.rect, new Set(groups.within(inner))), outer);
  assert.equal(groups.dropTarget(outer.rect, new Set(groups.within(outer))), undefined);
});

test("a boundary holds the groups of the elements in it", () => {
  const groups = new LayerGroups(sceneOf({ [CONTEXT]: nested() }), CONTEXT);
  assert.deepEqual(groups.around(new Set(["a", "b"])).length, 1);
  assert.deepEqual(groups.around(new Set(["a", "b", "c"])).length, 2);
  assert.deepEqual(groups.around(new Set(["a"])), []);
});

test("groups are shown only on their own level, not among the ghosts of the levels above", () => {
  const context = [
    box("shop", { kind: "system", id: "s" }, { x: 0, y: 0 }),
    box("mail", { kind: "system", id: "m" }, { x: 400, y: 0 }),
    ...group("g1", { group: "g", members: ["m"] }),
  ];
  const tag = { [KEY]: { boundary: "s" } };
  const shop = [{ ...base, id: "bnd", type: "rectangle", customData: tag }, box("web", { kind: "container", id: "w", parent: "s" })];
  const ghosts = ghostsFor(sceneOf({ [CONTEXT]: context, s: shop }), "s");
  assert.ok(ghosts.some((g) => g.id === "c4g-mail"));
  assert.ok(!ghosts.some((g) => g.id === "c4g-g1"));
  assert.equal(ghosts.filter((g) => g.type === "text").length, 0);
});

test("a label scaled with its group is drawn in its own font size again", () => {
  const els = [
    box("a", { kind: "system", id: "A" }),
    ...group("g1", { group: "g", members: ["A"] }).map((e) => (e.type === "text" ? { ...e, fontSize: 32, width: 120, height: 40 } : e)),
  ];
  const patches = new LayerGroups(sceneOf({ [CONTEXT]: els }), CONTEXT).patches();
  const label = patches.find(([id]) => id === "g1-label")![1];
  assert.equal(label.fontSize, FONT_SIZE);
  assert.equal(label.width, 60);
  assert.equal(label.height, 20);
  const fixed = apply(els, patches);
  assert.deepEqual(new LayerGroups(sceneOf({ [CONTEXT]: fixed }), CONTEXT).patches(), []);
});
