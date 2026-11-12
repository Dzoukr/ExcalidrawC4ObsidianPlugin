import { AppState, El, ExcalidrawAutomate, ExcalidrawView, getEA } from "./excalidraw";
import { ghostSource } from "./ghosts";
import type { Shape } from "./highlight";
import { DiagramId, Scene, copiesOf, endOfLevel, endsOf, grid, levelsUpTo, newId, nextSlot, ofLevel, relationshipsWithin, row, unrelated } from "./layers";
import { LayerTx, readScene, selectionOf } from "./layertx";
import {
  BOUNDARY_LABEL, BOUNDARY_PAD, Box, C4Element, C4Relationship, ELEMENT_WIDTH, KEY, MIN_HEIGHT, PADDING, RELATIONSHIP_COLOR, Vec, ViewKind, allowedKinds, arrowMidpoint,
  boundaryLabel, bounds, boxSize, canBeExternal, center, contains, edgePoint, elementData, fittedBoundary, laneLine, laneOffsets, normalOf, elementLabel, lookOf, isGhost, makeWay, nameText, FONT_SIZE, NAME_FONT_SIZE,
  overlaps, parentFor, parentKind, pushOut, relationshipData, wayBack, relationshipLabel, zoomView, nearestIn, boxStyle, partOf, shapeOf, shapeParts, corners, shapeVersionOf, type Ink, MISPLACED_LOOK, SHAPE_VERSION, STROKE_WIDTH,
} from "./model";
import type { Direction } from "./model";

const GAP = 120; // between an element and the one added below it
const RELATIONSHIP_FONT_SIZE = 14;
const BOUNDARY_COLOR = "#444444";

export interface Selected {
  el: El;
  data: C4Element;
}

export interface SelectedRelationship {
  el: El;
  data: C4Relationship;
}

/** The box or arrow a text belongs to, the box a part of a shape belongs to, else the element itself. */
function ownerOf(byId: ReadonlyMap<string, El>, el: El | undefined): El | undefined {
  if (el?.containerId) return byId.get(el.containerId);
  const part = el && partOf(el.customData);
  return part ? byId.get(part) : el;
}

/**
 * The selected elements carrying C4 data; selecting a box's or arrow's text, or a part of a box's shape, counts as
 * selecting the box or arrow.
 */
function selectedC4(view: ExcalidrawView): El[] {
  const api = view.excalidrawAPI;
  if (!api) return [];
  const byId = new Map(api.getSceneElements().map((e) => [e.id, e]));
  const out = new Map<string, El>();
  for (const [id, on] of Object.entries(api.getAppState().selectedElementIds ?? {})) {
    if (!on) continue;
    const el = ownerOf(byId, byId.get(id));
    if (el && (elementData(el.customData) || relationshipData(el.customData))) out.set(el.id, el);
  }
  return [...out.values()];
}

/** The selected C4 elements. */
export function selectedElements(view: ExcalidrawView): Selected[] {
  return selectedC4(view).flatMap((el) => {
    const data = elementData(el.customData);
    return data ? [{ el, data }] : [];
  });
}

/** The one selected C4 element or relationship, or null when there is none or more. */
export function selectedItem(view: ExcalidrawView): Selected | SelectedRelationship | null {
  const [el, ...rest] = selectedC4(view);
  return el && !rest.length ? itemOf(el) : null;
}

/** A C4 element or relationship with its data, or null for another element. */
export function itemOf(el: El): Selected | SelectedRelationship | null {
  const element = elementData(el.customData);
  if (element) return { el, data: element };
  const relationship = relationshipData(el.customData);
  return relationship ? { el, data: relationship } : null;
}

export const isRelationship = (item: Selected | SelectedRelationship): item is SelectedRelationship => "relationship" in item.data;

/** The part of the drawing in view. */
const viewport = (s: AppState): Box => {
  const zoom = s.zoom?.value ?? 1;
  return { x: -s.scrollX, y: -s.scrollY, width: s.width / zoom, height: s.height / zoom };
};

/**
 * Selects the C4 element or relationship next to the selection in a direction, in the layer on the canvas; with
 * `extend`, adds it to the selection, which keeps the order things were selected in. A relationship is where the middle
 * of its arrow is. With nothing selected, what is nearest the middle of the view. Brings it into view. False when
 * there is nothing that way.
 */
export function selectNext(view: ExcalidrawView, dir: Direction, extend: boolean): boolean {
  const api = view.excalidrawAPI!;
  const { scene, current } = readScene(api.getSceneElements());
  const place = (e: El): Box => (relationshipData(e.customData) ? { ...arrowMidpoint(e), width: 0, height: 0 } : e);
  const targets = scene.elementsIn(current)
    .filter((e) => !e.containerId && !e.locked && (elementData(e.customData) || relationshipData(e.customData)))
    .map((el) => ({ el, ...place(el) }));
  const selected = selectedC4(view);
  const vp = viewport(api.getAppState());
  let next: (typeof targets)[number] | undefined;
  if (!selected.length) {
    const mid = center(vp);
    const d = (b: Box) => Math.hypot(center(b).x - mid.x, center(b).y - mid.y);
    next = [...targets].sort((a, b) => d(a) - d(b))[0];
  } else {
    // From what was selected last, so a row of elements can be selected one after another.
    const last = selected[selected.length - 1];
    next = nearestIn(targets.filter((t) => !selected.some((s) => s.id === t.el.id)), center(place(last)), dir);
  }
  if (!next) return false;
  const ids = extend ? [...selected.map((s) => s.id), next.el.id] : [next.el.id];
  const appState: Partial<AppState> = selectionOf(api.getSceneElements(), ids);
  // Into view when it is not, with its middle in the middle of the view.
  if (!(next.x >= vp.x && next.y >= vp.y && next.x + next.width <= vp.x + vp.width && next.y + next.height <= vp.y + vp.height)) {
    const c = center(next);
    Object.assign(appState, { scrollX: vp.width / 2 - c.x, scrollY: vp.height / 2 - c.y });
  }
  api.updateScene({ appState, captureUpdate: "NEVER" });
  return true;
}

/** The selected C4 elements and relationships as drawn, in the order of the selection, for the highlight. */
export function selectionShapes(view: ExcalidrawView): Shape[] {
  const byId = new Map(view.excalidrawAPI!.getSceneElements().map((e) => [e.id, e]));
  return selectedC4(view).map((el) => {
    if (!relationshipData(el.customData)) return { box: el };
    const ref = el.boundElements?.find((b) => b.type === "text");
    const label = ref ? byId.get(ref.id) : undefined;
    return { points: (el.points ?? []).map(([x, y]) => ({ x: el.x + x, y: el.y + y })), label };
  });
}

/** Whether all that is selected is C4 elements and relationships, or nothing is. */
export function onlyC4Selected(view: ExcalidrawView): boolean {
  const api = view.excalidrawAPI!;
  const byId = new Map(api.getSceneElements().map((e) => [e.id, e]));
  return Object.entries(api.getAppState().selectedElementIds ?? {}).every(([id, on]) => {
    if (!on) return true;
    const e = ownerOf(byId, byId.get(id));
    return !!e && (!!elementData(e.customData) || !!relationshipData(e.customData));
  });
}

/** What the panel shows about the layer on the canvas. */
export interface DiagramInfo {
  title: string; // of the layer
  kinds: C4Element["kind"][]; // the kinds it takes
  zoomIn: boolean; // the selection has a layer to zoom into
  zoomOut: string | null; // title of the layer one level up
}

export function diagramInfo(view: ExcalidrawView): DiagramInfo {
  const { scene, current } = readScene(view.excalidrawAPI!.getSceneElements());
  const v = scene.view(current);
  const item = selectedItem(view);
  return {
    title: levelName(scene, current),
    // With more than one element selected, only a relationship can be added.
    kinds: selectedElements(view).length > 1 ? [] : allowedKinds(v?.view ?? null),
    zoomIn: !!item && !isRelationship(item) && !!zoomView(item.data),
    zoomOut: v ? levelName(scene, scene.parentLayer(v.scope)) : null,
  };
}

/**
 * Whether an element or relationship can be edited in the layer on the canvas: an element of its level, or a
 * relationship with an end there.
 */
export function canEdit(view: ExcalidrawView, item: Selected | SelectedRelationship): boolean {
  const { scene, current } = readScene(view.excalidrawAPI!.getSceneElements());
  if (isRelationship(item)) return [item.el.startBinding?.elementId, item.el.endBinding?.elementId].some((e) => endOfLevel(scene, current, e));
  const id = scene.modelId(item.el);
  return !!id && ofLevel(scene, current, id);
}

/** Whether two elements can be connected in the layer on the canvas: one of them belongs to its level. */
export function canRelate(view: ExcalidrawView, a: Selected, b: Selected): boolean {
  const { scene, current } = readScene(view.excalidrawAPI!.getSceneElements());
  return [a.el.id, b.el.id].some((e) => endOfLevel(scene, current, e));
}

/** The C4 level a layer is on. */
function levelName(scene: Scene, layer: DiagramId): string {
  const v = scene.view(layer);
  return v ? (v.view === "container" ? "Container" : "Component") : "System";
}

/** The C4 element or relationship drawn at a point of the layer on the canvas, the topmost one. */
export function itemAt(view: ExcalidrawView, p: Vec): El | undefined {
  const els = view.excalidrawAPI!.getSceneElements();
  const byId = new Map(els.map((e) => [e.id, e]));
  const reach = 8 / (view.excalidrawAPI!.getAppState().zoom?.value ?? 1);
  const inside = (b: Box) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.locked) continue;
    const owner = ownerOf(byId, e);
    if (!owner) continue;
    if (elementData(owner.customData) && inside(e)) return owner;
    if (!relationshipData(owner.customData)) continue;
    if (e.containerId) {
      if (inside(e)) return owner; // the relationship's label
    } else if (e.points?.length) {
      const pts = e.points.map(([x, y]) => ({ x: e.x + x, y: e.y + y }));
      for (let j = 1; j < pts.length; j++) if (distanceToSegment(p, pts[j - 1], pts[j]) <= reach) return owner;
    }
  }
  return undefined;
}

function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A layer to put on the canvas when a change is done, with elements to select there. */
interface SwitchTo {
  layer: DiagramId;
  select?: string[];
}

/** Runs a change over the layers with a scripting API instance. False when Excalidraw's scripting API is not available. */
function withLayers(view: ExcalidrawView, change: (ea: ExcalidrawAutomate, ltx: LayerTx) => SwitchTo | void): boolean {
  const ea = getEA(view);
  if (!ea || !view.excalidrawAPI) return false;
  try {
    const ltx = new LayerTx(view);
    const to = change(ea, ltx);
    completeShapes(ea, ltx);
    if (!to) {
      ltx.commit(ea);
      return true;
    }
    ltx.switchTo(ea, to.layer, to.select);
    // The layer takes the place of the box zoomed into: the view only moves when the layer does not fit in it.
    const api = view.excalidrawAPI;
    const shown = api.getSceneElements().filter((e) => !e.containerId && e.opacity !== 0 && !isGhost(e.customData));
    const b = bounds(shown);
    const vp = viewport(api.getAppState());
    if (b && !(b.x >= vp.x && b.y >= vp.y && b.x + b.width <= vp.x + vp.width && b.y + b.height <= vp.y + vp.height)) {
      ea.viewZoomToElements(false, shown);
      // Zooming drops the selection.
      api.updateScene({ appState: selectionOf(api.getSceneElements(), to.select ?? []), captureUpdate: "NEVER" });
    }
    return true;
  } finally {
    ea.destroy?.();
  }
}

/** Adds a box with the element's label at a point, in a layer. Returns the box. */
function addBox(ea: ExcalidrawAutomate, ltx: LayerTx, data: C4Element, at: Vec, layer: DiagramId): El {
  const s = ltx.api.getAppState();
  const look = lookOf(data);
  const style = boxStyle(data);
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: look.text,
    backgroundColor: look.background,
    fillStyle: "solid",
    strokeWidth: STROKE_WIDTH,
    strokeStyle: "solid",
    roughness: s.currentItemRoughness,
    roundness: { type: 3 },
    opacity: 100,
    angle: 0,
    fontFamily: s.currentItemFontFamily,
    fontSize: FONT_SIZE,
    textAlign: "center",
    verticalAlign: "middle",
  });
  const id = ea.addText(at.x, at.y, elementLabel(data), {
    box: true,
    boxPadding: PADDING,
    boxStrokeColor: look.stroke,
    textAlign: "center",
    textVerticalAlign: "middle",
  });
  const els = ea.getElements();
  const box = els.find((e) => e.id === id)!;
  const text = els.find((e) => e.containerId === id);
  const size = text ? boxSize(withName(ea, text, text, data), shapeOf(data)) : { width: Math.max(ELEMENT_WIDTH, box.width), height: Math.max(MIN_HEIGHT, box.height) };
  Object.assign(box, { x: at.x, y: at.y, ...size, ...style, customData: { ...(box.customData ?? {}), [KEY]: data } });
  if (text) Object.assign(text, { x: at.x + (size.width - text.width) / 2, y: at.y + (size.height - text.height) / 2 });
  for (const el of els) ltx.add(el, layer);
  reshape(ea, ltx, id, data);
  return ltx.get(id)!;
}

/**
 * Draws the parts of a box's shape behind it, in place of the ones it had: grouped with the box and its text, so that
 * they are selected, moved and deleted together.
 */
function reshape(ea: ExcalidrawAutomate, ltx: LayerTx, boxId: string, data: C4Element) {
  const box = ltx.get(boxId);
  if (!box) return;
  const old = ltx.partsOf(boxId);
  const own = old[0]?.groupIds?.[0];
  for (const p of old) ltx.remove(p.id);
  const parts = shapeParts(shapeOf(data), box);
  const label = boundText(ltx, box);
  const groupIds = [...(parts.length || label ? [own ?? newId()] : []), ...(box.groupIds ?? []).filter((g) => g !== own)];
  if (JSON.stringify(groupIds) !== JSON.stringify(box.groupIds ?? [])) {
    ltx.patch(box.id, { groupIds });
    if (label) ltx.patch(label.id, { groupIds });
  }
  const look = lookOf(data);
  const marked = box.strokeColor === MISPLACED_LOOK.strokeColor;
  ltx.patch(box.id, { ...boxStyle(data), ...(marked ? { strokeColor: MISPLACED_LOOK.strokeColor } : { strokeWidth: STROKE_WIDTH, strokeStyle: "solid" }) });
  if (label && label.strokeColor !== look.text) ltx.patch(label.id, { strokeColor: look.text });
  const color: Record<Ink, string> = { outline: look.stroke, detail: look.text, body: look.background, none: "transparent" };
  for (const part of parts) {
    ea.clear();
    Object.assign(ea.style, {
      strokeColor: color[part.stroke],
      backgroundColor: color[part.fill],
      fillStyle: "solid",
      strokeWidth: STROKE_WIDTH,
      strokeStyle: "solid",
      roughness: box.roughness,
      opacity: 100,
      angle: 0,
    });
    const b = part.box ?? box;
    const id = part.type === "line"
      ? ea.addLine((part.points ?? []).map((p) => [p.x, p.y]))
      : part.type === "ellipse" ? ea.addEllipse(b.x, b.y, b.width, b.height) : ea.addRect(b.x, b.y, b.width, b.height);
    const pts = part.points ?? [];
    const closed = pts.length > 2 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y;
    const roundness = part.type === "rectangle" && part.round ? corners(part.round) : null;
    const el: El = { ...ea.getElement(id), roundness, groupIds, customData: { [KEY]: { part: box.id, shape: SHAPE_VERSION } } };
    if (part.type === "line") el.polygon = closed;
    ltx.addBehind(el, box.id);
  }
  if (label) ltx.addInFront(nameOver(ea, label, box, data, groupIds), label.id);
}

/** The name of an element, larger than the rest of the text of its box, over the room the text keeps for it at the top. */
function nameOver(ea: ExcalidrawAutomate, label: El, box: El, data: C4Element, groupIds: string[]): El {
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: label.strokeColor, opacity: 100, angle: 0, fontFamily: label.fontFamily, fontSize: NAME_FONT_SIZE, textAlign: "center",
  });
  const name = ea.getElement(ea.addText(0, 0, nameText(data), { textAlign: "center" }));
  return {
    ...name,
    x: box.x + box.width / 2 - name.width / 2,
    y: label.y,
    groupIds,
    customData: { [KEY]: { part: box.id, shape: SHAPE_VERSION } },
  };
}

/** The size of the text of a box with its name, which is larger, and may be wider. */
function withName(ea: ExcalidrawAutomate, text: El, size: { width: number; height: number }, data: C4Element) {
  ea.style.fontFamily = text.fontFamily;
  ea.style.fontSize = NAME_FONT_SIZE;
  return { width: Math.max(size.width, ea.measureText(nameText(data)).width), height: size.height };
}

/**
 * Redraws the boxes drawn before their shapes, looks and text were what they are now, such as a person without a head,
 * resizing them around their text.
 */
function completeShapes(ea: ExcalidrawAutomate, ltx: LayerTx) {
  const scene = ltx.scene();
  for (const layer of scene.diagrams()) {
    for (const b of scene.boxes(layer)) {
      const data = elementData(b.customData)!;
      const parts = scene.parts(b.id);
      const named = b.boundElements?.some((r) => r.type === "text") ? 1 : 0; // the bold name over its text
      const current = parts.length === shapeParts(shapeOf(data), b).length + named && parts.every((p) => shapeVersionOf(p.customData) === SHAPE_VERSION);
      if (!current || b.backgroundColor !== boxStyle(data).backgroundColor) restyle(ea, ltx, b.id, data);
    }
  }
}

/** Adds a box for the element to the layer on the canvas, and to the element's own layer if that is another one, and selects it. */
export function addElement(view: ExcalidrawView, element: C4Element): boolean {
  let id = "";
  const added = withLayers(view, (ea, ltx) => {
    const scene = ltx.scene();
    const layer = ltx.current;
    const v = scene.view(layer);
    const data: C4Element = { ...element, id: newId(), parent: parentFor(element.kind, v, v ? scene.parent(v.scope) : undefined) };
    if (!data.parent) delete data.parent;
    if (!canBeExternal(data.kind)) data.external = scene.inheritedExternal(data.parent);
    const added = addBox(ea, ltx, data, placeIn(view, scene, layer, data), layer);
    id = added.id;
    // Beside the boxes already there, not on top of one: further right, the way the next one in a row goes.
    const free = freeSpot(added, scene.boxes(layer));
    if (free.x !== added.x || free.y !== added.y) moveBox(ltx, id, free.x - added.x, free.y - added.y);
    const box = ltx.get(id)!;
    fitBoundary(ltx, layer, [box.id]);
    // Every level above, up to its own: the system context for people and systems, the layer of its parent for the
    // others. In the same place relative to what is around it: each level down makes way for the element opened in
    // it, so going up the place shrinks back with that element.
    let at: Box = box;
    let below = layer;
    for (const up of levelsUpTo(scene, layer, data.parent)) {
      const now = ltx.scene();
      const scope = now.view(below)?.scope;
      const scopeBox = scope && now.parentLayer(scope) === up ? now.boxIn(scope, up) : undefined;
      const rect = now.boundary(below).rect;
      if (scopeBox && rect) at = { ...at, ...wayBack(scopeBox, rect)(at) };
      at = { ...at, ...copyPlace(now, up, data, at) };
      const copy = addBox(ea, ltx, data, at, up);
      fitBoundary(ltx, up, [copy.id]);
      below = up;
    }
  });
  if (added) {
    const api = view.excalidrawAPI!;
    api.updateScene({ appState: selectionOf(api.getSceneElements(), [id]), captureUpdate: "NEVER" });
  }
  return added;
}

/** Where a copy of a box goes in another layer: as near the place given as there is room, on the right side of the boundary. */
function copyPlace(scene: Scene, layer: DiagramId, data: C4Element, box: Box): Vec {
  const v = scene.view(layer);
  const rect = scene.boundary(layer).rect;
  const outside = rect && !(v && data.parent === v.scope);
  // Out of the boundary it does not belong in, then clear of the boxes there.
  const p = outside && overlaps(box, rect, GAP / 2) ? pushOut(box, rect, GAP) : { x: box.x, y: box.y };
  return freeSpot({ ...box, ...p }, outside ? [rect, ...scene.boxes(layer)] : scene.boxes(layer));
}

/** Whether the layer on the canvas takes the kind of element; false tells the user to zoom first. */
export function canAdd(view: ExcalidrawView, kind: C4Element["kind"]): boolean {
  return diagramInfo(view).kinds.includes(kind);
}

/**
 * Top left corner of a new box in the layer: below the selected box, else in the system context the middle of the view,
 * and in a layer of a system or container the next free place inside or outside its boundary.
 */
function placeIn(view: ExcalidrawView, scene: Scene, layer: DiagramId, data: C4Element): Vec {
  const v = scene.view(layer);
  const inScope = !!v && data.parent === v.scope;
  const selected = selectedElements(view).filter((s) => scene.diagramOf(s.el) === layer);
  if (selected.length === 1 && (!v || (scene.element(scene.modelId(selected[0].el)!)?.parent === v.scope) === inScope)) {
    const b = selected[0].el;
    return { x: b.x + b.width / 2 - ELEMENT_WIDTH / 2, y: b.y + b.height + GAP };
  }
  if (v) return slotIn(scene, layer, data);
  const vp = viewport(view.excalidrawAPI!.getAppState());
  return { x: vp.x + vp.width / 2 - ELEMENT_WIDTH / 2, y: vp.y + vp.height / 2 - MIN_HEIGHT / 2 };
}

/** The next free place for an element in a layer: inside the boundary for the scope's elements, else beside it. */
function slotIn(scene: Scene, layer: DiagramId, data: C4Element): Vec {
  const boxes = scene.boxes(layer);
  const v = scene.view(layer);
  const rect = scene.boundary(layer).rect;
  if (!v || !rect) return nextSlot(boxes, bounds(boxes), GAP, 0);
  if (data.parent === v.scope) return nextSlot(boxes, rect, GAP, BOUNDARY_PAD);
  // Outside the boundary: in a column on its right.
  const right = rect.x + rect.width + GAP;
  const column = boxes.filter((b) => b.x >= right - GAP / 2);
  if (!column.length) return { x: right, y: rect.y };
  return { x: Math.min(...column.map((b) => b.x)), y: Math.max(...column.map((b) => b.y + b.height)) + GAP };
}

/**
 * Fits a layer's boundary to the scope's elements in it, growing or shrinking, and keeps the elements around it at
 * their distance from its edges. An element of the scope dragged out of the boundary stays out, as an error, unless
 * it was just put there by the plugin (`placed`).
 */
function fitBoundary(ltx: LayerTx, layer: DiagramId, placed: string[] = []) {
  const scene = ltx.scene();
  const v = scene.view(layer);
  const { rect, label } = scene.boundary(layer);
  if (!v || !rect) return;
  const inner = scene.boxes(layer).filter(
    (b) => scene.element(scene.modelId(b)!)?.parent === v.scope && (placed.includes(b.id) || contains(rect, center(b))),
  );
  const fitted = fittedBoundary(rect, inner, label);
  const same = (["x", "y", "width", "height"] as const).every((k) => Math.abs(fitted[k] - rect[k]) < 0.5);
  if (!same) ltx.patch(rect.id, fitted);
  const labelAt = label && { x: fitted.x + BOUNDARY_PAD / 2, y: fitted.y + fitted.height - label.height - BOUNDARY_PAD / 4 };
  if (label && labelAt && (Math.abs(labelAt.x - label.x) >= 0.5 || Math.abs(labelAt.y - label.y) >= 0.5)) ltx.patch(label.id, labelAt);
  const way = makeWay(rect, fitted);
  for (const b of scene.boxes(layer)) {
    if (inner.includes(b)) continue;
    const d = way.move(b);
    if (d.x || d.y) moveBox(ltx, b.id, d.x, d.y);
  }
  // Relationships carried down to the boundary keep meeting its edge.
  for (const b of rect.boundElements ?? []) if (b.type === "arrow") reroute(ltx, b.id);
}

/** Moves a box with its text, and straightens its relationships. */
function moveBox(ltx: LayerTx, boxId: string, dx: number, dy: number) {
  const box = ltx.get(boxId);
  if (!box) return;
  ltx.patch(box.id, { x: box.x + dx, y: box.y + dy });
  const text = boundText(ltx, box);
  if (text) ltx.patch(text.id, { x: text.x + dx, y: text.y + dy });
  for (const p of ltx.partsOf(box.id)) ltx.patch(p.id, { x: p.x + dx, y: p.y + dy });
  for (const b of box.boundElements ?? []) if (b.type === "arrow") reroute(ltx, b.id);
}

/** Changes an element's data in every layer it is drawn in, and the boundary of its own layer. */
export function updateElement(view: ExcalidrawView, boxId: string, data: C4Element): boolean {
  return withLayers(view, (ea, ltx) => {
    const scene = ltx.scene();
    const box = scene.byId.get(boxId);
    if (!box) return;
    let id = scene.modelId(box)!;
    const layer = scene.diagramOf(box);
    let copies = scene.boxesOf(id).filter((b) => b.id === boxId || scene.diagramOf(b) !== layer);
    if (scene.boxesOf(id).some((b) => b.id !== boxId && scene.diagramOf(b) === layer)) {
      // A duplicate in the same layer is another element now.
      id = newId();
      copies = [box];
    }
    // Only the elements of the system context say whether they are external; the ones inside take it from them.
    const external = canBeExternal(data.kind) ? !!data.external : scene.inheritedExternal(data.parent);
    for (const b of copies) restyle(ea, ltx, b.id, { ...data, id, external });
    if (copies.length === scene.boxesOf(id).length) passExternal(ea, ltx, scene, id, external);
    const own = scene.diagramFor(id);
    const label = own ? scene.boundary(own).label : undefined;
    if (own && label) {
      const text = boundaryLabel(data);
      ltx.patch(label.id, { ...textOf(text), ...measure(ea, label, text) });
      fitBoundary(ltx, own);
    }
  });
}

/** Changes one box's label, colors and size, keeping its center, and straightens its relationships. */
function restyle(ea: ExcalidrawAutomate, ltx: LayerTx, boxId: string, data: C4Element) {
  const box = ltx.get(boxId);
  if (!box) return;
  const look = lookOf(data);
  const c = center(box);
  const text = boundText(ltx, box);
  if (text) {
    const label = elementLabel(data);
    const m = measure(ea, text, label);
    const size = boxSize(withName(ea, text, m, data), shapeOf(data));
    const x = c.x - size.width / 2;
    const y = c.y - size.height / 2;
    ltx.patch(box.id, { x, y, ...size });
    ltx.patch(text.id, {
      ...textOf(label), ...m, strokeColor: look.text, x: x + (size.width - m.width) / 2, y: y + (size.height - m.height) / 2,
    });
  }
  ltx.patch(box.id, { ...boxStyle(data), strokeWidth: STROKE_WIDTH, strokeStyle: "solid", customData: { ...(box.customData ?? {}), [KEY]: data } });
  reshape(ea, ltx, box.id, data);
  for (const b of box.boundElements ?? []) if (b.type === "arrow") reroute(ltx, b.id);
}

/** Makes everything inside an element external or internal with it, in every layer. */
function passExternal(ea: ExcalidrawAutomate, ltx: LayerTx, scene: Scene, id: string, external: boolean) {
  for (const d of scene.descendants(id)) {
    if (!!scene.element(d)?.external === external) continue;
    for (const b of scene.boxesOf(d)) restyle(ea, ltx, b.id, { ...elementData(b.customData)!, external });
  }
}

/** Changes a relationship's data and label, and with `reverse` turns it the other way round. */
export function updateRelationship(view: ExcalidrawView, arrowId: string, data: C4Relationship, reverse = false): boolean {
  return withLayers(view, (ea, ltx) => {
    const arrow = ltx.get(arrowId);
    if (!arrow) return;
    // With its copies in the other layers, which say the same as it did.
    const copies = copiesOf(ltx.scene(), arrow);
    for (const a of [arrow, ...copies]) {
      setRelationship(ea, ltx, a.id, { ...relationshipData(a.customData)!, ...data });
      if (reverse) turn(ltx, a.id);
    }
  });
}

/** Changes one relationship arrow's data and label. */
function setRelationship(ea: ExcalidrawAutomate, ltx: LayerTx, arrowId: string, data: C4Relationship) {
  const arrow = ltx.get(arrowId);
  if (!arrow) return;
  if (!data.metadata) delete data.metadata;
  ltx.patch(arrow.id, { customData: { ...(arrow.customData ?? {}), [KEY]: data } });
  const text = boundText(ltx, arrow);
  if (text) {
    const label = relationshipLabel(data);
    const m = measure(ea, text, label);
    const mid = arrowMidpoint(arrow);
    ltx.patch(text.id, { ...textOf(label), ...m, x: mid.x - m.width / 2, y: mid.y - m.height / 2 });
  }
}

/** Turns a relationship the other way round. */
export function reverseRelationship(view: ExcalidrawView, arrowId: string): boolean {
  return withLayers(view, (_ea, ltx) => turn(ltx, arrowId));
}

function turn(ltx: LayerTx, arrowId: string) {
  const arrow = ltx.get(arrowId);
  if (!arrow?.startBinding || !arrow.endBinding) return;
  ltx.patch(arrowId, { startBinding: arrow.endBinding, endBinding: arrow.startBinding });
  layoutPair(ltx, arrow.startBinding.elementId, arrow.endBinding.elementId);
}

const boundText = (ltx: LayerTx, el: El): El | undefined => {
  const ref = el.boundElements?.find((b) => b.type === "text");
  return ref ? ltx.get(ref.id) : undefined;
};

/** Size of the text in the font of a text element. */
function measure(ea: ExcalidrawAutomate, text: El, label: string): { width: number; height: number } {
  ea.style.fontFamily = text.fontFamily;
  ea.style.fontSize = text.fontSize;
  const m = ea.measureText(label);
  return { width: m.width, height: m.height };
}

// Excalidraw shows `text`, edits `originalText`, and the Obsidian plugin keeps `rawText` with links unparsed.
const textOf = (label: string): Partial<El> => ({ text: label, originalText: label, rawText: label });

/** Lays out the relationships between the two elements an arrow is bound to again. */
function reroute(ltx: LayerTx, arrowId: string) {
  const arrow = ltx.get(arrowId);
  if (arrow?.startBinding && arrow.endBinding) layoutPair(ltx, arrow.startBinding.elementId, arrow.endBinding.elementId);
}

/**
 * Lays out the straight relationships between two boxes side by side, in both directions, each aiming at its own point
 * inside the boxes so that Excalidraw keeps them apart when a box moves. Labels go to the middle of their arrows.
 */
function layoutPair(ltx: LayerTx, aId: string, bId: string) {
  // The same order of the boxes for both directions, so arrows either way share one set of lanes.
  const [first, second] = [ltx.get(aId), ltx.get(bId)].sort((p, q) => (p && q ? p.id.localeCompare(q.id) : 0));
  if (!first || !second || first.id === second.id) return;
  const arrows = (first.boundElements ?? [])
    .filter((r) => r.type === "arrow")
    .map((r) => ltx.get(r.id))
    .filter((e): e is El => {
      if (!e || e.points?.length !== 2 || !relationshipData(e.customData)) return false;
      const ends = [e.startBinding?.elementId, e.endBinding?.elementId];
      return ends.includes(first.id) && ends.includes(second.id);
    });
  const normal = normalOf(center(first), center(second));
  const offsets = laneOffsets(arrows.length);
  arrows.forEach((arrow, i) => {
    const from = arrow.startBinding!.elementId === first.id ? first : second;
    const to = from === first ? second : first;
    const { start, end, aimFrom, aimTo } = laneLine(from, to, normal, offsets[i]);
    const glue = (b: El, aim: Vec): [number, number] => [(aim.x - b.x) / b.width, (aim.y - b.y) / b.height];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    ltx.patch(arrow.id, {
      x: start.x,
      y: start.y,
      points: [[0, 0], [dx, dy]],
      width: Math.abs(dx),
      height: Math.abs(dy),
      startBinding: { ...arrow.startBinding!, mode: "orbit", fixedPoint: glue(from, aimFrom) },
      endBinding: { ...arrow.endBinding!, mode: "orbit", fixedPoint: glue(to, aimTo) },
    });
    const text = boundText(ltx, arrow);
    if (text) ltx.patch(text.id, { x: start.x + dx / 2 - text.width / 2, y: start.y + dy / 2 - text.height / 2 });
  });
}

function addBound(ltx: LayerTx, elId: string, arrowId: string) {
  const el = ltx.get(elId);
  if (!el || el.boundElements?.some((b) => b.id === arrowId)) return;
  ltx.patch(elId, { boundElements: [...(el.boundElements ?? []), { type: "arrow", id: arrowId }] });
}

/** Adds a labelled arrow between two boxes of one layer. */
function addArrow(ea: ExcalidrawAutomate, ltx: LayerTx, from: El, to: El, data: C4Relationship, layer: DiagramId) {
  const s = ltx.api.getAppState();
  const start = edgePoint(from, center(to));
  const end = edgePoint(to, center(from));
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: RELATIONSHIP_COLOR,
    backgroundColor: "transparent",
    strokeWidth: 1,
    strokeStyle: "dashed",
    roughness: s.currentItemRoughness,
    roundness: null,
    opacity: 100,
    angle: 0,
    fontFamily: s.currentItemFontFamily,
    fontSize: RELATIONSHIP_FONT_SIZE,
    textAlign: "center",
    verticalAlign: "middle",
  });
  const arrowId = ea.addArrow([[start.x, start.y], [end.x, end.y]], {
    startArrowHead: null,
    endArrowHead: "arrow",
    startObjectId: from.id,
    endObjectId: to.id,
  });
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const textId = ea.addText(mid.x, mid.y, relationshipLabel(data), { textAlign: "center", textVerticalAlign: "middle" });
  const arrow = ea.getElement(arrowId);
  const text = ea.getElement(textId);
  Object.assign(text, { x: mid.x - text.width / 2, y: mid.y - text.height / 2, containerId: arrowId });
  arrow.boundElements = [...(arrow.boundElements ?? []), { type: "text", id: textId }];
  arrow.customData = { ...(arrow.customData ?? {}), [KEY]: data };
  ltx.add(arrow, layer);
  ltx.add(text, layer);
  addBound(ltx, from.id, arrowId);
  addBound(ltx, to.id, arrowId);
  layoutPair(ltx, from.id, to.id);
}

/**
 * Adds a relationship from one element to another, and the same relationship to every other layer showing its ends or
 * the elements containing them, where there is none yet.
 */
export function addRelationship(view: ExcalidrawView, from: El, to: El, data: C4Relationship): boolean {
  return withLayers(view, (ea, ltx) => {
    const scene = ltx.scene();
    const layer = ltx.current;
    addArrow(ea, ltx, from, to, data, layer);
    const a = scene.modelId(from);
    const b = scene.modelId(to);
    if (!a || !b) return;
    for (const t of scene.liftTargets(a, b, layer)) addArrow(ea, ltx, t.from, t.to, data, t.diagram);
  });
}

/** Puts the layer of the selected system or container on the canvas, creating it first if there is none. */
export function zoomIn(view: ExcalidrawView, item = selectedItem(view)): boolean {
  if (!item || isRelationship(item)) return false;
  const kind = zoomView(item.data);
  if (!kind) return false;
  return withLayers(view, (ea, ltx) => {
    const scene = ltx.scene();
    const scope = scene.modelId(item.el)!;
    if (!ltx.hasLayer(scope)) createLayer(ea, ltx, scene, item.el, { ...item.data, id: scope }, kind);
    else {
      dropUnrelated(ltx, scope);
      fitBoundary(ltx, scope);
    }
    carryDown(ea, ltx, scope);
    return { layer: scope };
  });
}

/**
 * Takes the boxes around a layer's boundary that no relationship ties to its scope any more out of the layer: the view
 * of the levels above shows them again, dimmed. Done when the layer comes on the canvas, which starts the undo history
 * over, so nothing undone brings back a relationship to a box that is gone.
 */
function dropUnrelated(ltx: LayerTx, layer: DiagramId) {
  for (const b of unrelated(ltx.scene(), layer)) removeBox(ltx, b.id);
}

/** Puts the layer one level up on the canvas, with the scope of the current layer selected. */
export function zoomOut(view: ExcalidrawView): boolean {
  return withLayers(view, (_ea, ltx) => {
    const scene = ltx.scene();
    const v = scene.view(ltx.current);
    if (!v) return;
    const up = scene.parentLayer(v.scope);
    dropUnrelated(ltx, up);
    fitBoundary(ltx, up);
    const box = scene.boxIn(v.scope, up);
    return { layer: up, select: box ? [box.id] : [] };
  });
}

/**
 * Creates the layer of a system or container where its box is: the scope's boundary around the elements already known
 * to be in it, and around the boundary the elements with relationships to it, where they are in the current layer.
 */
function createLayer(
  ea: ExcalidrawAutomate, ltx: LayerTx, scene: Scene, scopeBox: El, scopeData: C4Element & { id: string }, kind: ViewKind, from: DiagramId = ltx.current,
) {
  const scope = scopeData.id;
  if (!elementData(scopeBox.customData)?.id) ltx.patch(scopeBox.id, { customData: { ...(scopeBox.customData ?? {}), [KEY]: scopeData } });
  ltx.addLayer(scope, kind);
  const children = scene.children(scope);
  const neighbours = scene.neighbours(scope);

  // The boundary takes the place of the scope's box, grown to hold its elements.
  const cell = { width: ELEMENT_WIDTH, height: MIN_HEIGHT };
  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(children.length))));
  const rows = Math.max(1, Math.ceil(children.length / cols));
  const width = cols * cell.width + (cols - 1) * GAP + 2 * BOUNDARY_PAD;
  const height = rows * cell.height + (rows - 1) * GAP + 2 * BOUNDARY_PAD + BOUNDARY_LABEL;
  const c = center(scopeBox);
  const boundary: Box = { x: c.x - width / 2, y: c.y - height / 2, width, height };
  addBoundary(ea, ltx, boundary, scopeData, scope);

  const used = Math.max(1, Math.min(cols, Math.ceil(Math.sqrt(children.length)))); // the columns grid() fills
  const gridWidth = used * cell.width + (used - 1) * GAP;
  const at = grid(children.length, { x: c.x - gridWidth / 2, y: boundary.y + BOUNDARY_PAD }, cell, GAP, cols);
  children.forEach((id, i) => addBox(ea, ltx, { ...scene.element(id)!, id }, at[i], scope));

  // Neighbours stay where they are in the current layer, making way for the boundary as the ghosts of the level
  // above do; the others go above or below it.
  const way = makeWay(scopeBox, boundary);
  const taken: Box[] = [boundary];
  const free = (b: Box) => freeSpot(b, taken);
  const place = (id: string, p: Vec) => taken.push(addBox(ea, ltx, { ...scene.element(id)!, id }, p, scope));
  const unplaced: { id: string; incoming: boolean }[] = [];
  for (const n of neighbours) {
    const here = scene.boxIn(n.id, from);
    if (here) {
      const d = way.move(here);
      place(n.id, free({ ...here, x: here.x + d.x, y: here.y + d.y }));
    }
    else unplaced.push(n);
  }
  const lay = (ns: { id: string }[], y: number) =>
    row(ns.length, c.x, y, cell.width, GAP).forEach((p, i) => place(ns[i].id, free({ ...p, ...cell })));
  lay(unplaced.filter((n) => n.incoming), boundary.y - GAP - cell.height);
  lay(unplaced.filter((n) => !n.incoming), boundary.y + boundary.height + GAP);

  // The relationships among what the layer shows, each once.
  const now = ltx.scene();
  const done = new Set<string>();
  for (const r of now.relationships()) {
    if (now.diagramOf(r.arrow) === scope) continue;
    const a = now.representative(now.modelId(r.from)!, scope);
    const b = now.representative(now.modelId(r.to)!, scope);
    if (!a || !b || a.id === b.id) continue;
    const key = `${a.id}>${b.id}>${r.data.description}`; // several relationships between the same two, if they differ
    if (done.has(key)) continue;
    done.add(key);
    addArrow(ea, ltx, a, b, r.data, scope);
  }
  fitBoundary(ltx, scope);
}

/** Where a box goes so that it keeps clear of others: where it is, or further right. */
function freeSpot(b: Box, taken: Box[]): Vec {
  const p = { x: b.x, y: b.y };
  while (taken.some((t) => overlaps({ ...b, ...p }, t, GAP / 2))) p.x += b.width + GAP;
  return p;
}

/**
 * Brings the relationships of the scope one level up down into its layer, on every zoom into it: as arrows between the
 * element at the other end and the scope's boundary, to be moved onto the element inside that they are about. One
 * the layer shows already, from or to anything inside the scope or its boundary, is not repeated; one missing, as
 * deleted by mistake, comes back.
 */
function carryDown(ea: ExcalidrawAutomate, ltx: LayerTx, scope: string) {
  const start = ltx.scene();
  const up = start.parentLayer(scope);
  const scopeBox = start.boxIn(scope, up);
  const rect = start.boundary(scope).rect;
  if (!scopeBox || !rect) return;
  for (const r of start.relationships(up)) {
    const from = start.modelId(r.from)!;
    const to = start.modelId(r.to)!;
    if ((from !== scope && to !== scope) || from === to) continue;
    const outgoing = from === scope;
    const other = outgoing ? to : from;
    const scene = ltx.scene();
    const shown = scene.elementsIn(scope).some((x) => {
      const ends = !x.containerId && relationshipData(x.customData) ? endsOf(scene, x) : null;
      if (!ends) return false;
      const [f, t] = ends;
      return outgoing ? scene.within(f, scope) && scene.within(t, other) : scene.within(f, other) && scene.within(t, scope);
    });
    if (shown) continue;
    let otherBox = scene.representative(other, scope);
    if (!otherBox || scene.within(scene.modelId(otherBox)!, scope)) {
      // Not drawn in the layer yet: where it is one level up, making way for the boundary.
      const there = outgoing ? r.to : r.from;
      const d = makeWay(scopeBox, rect).move(there);
      const taken = [rect, ...scene.boxes(scope)];
      otherBox = addBox(ea, ltx, { ...scene.element(other)!, id: other }, freeSpot({ ...there, x: there.x + d.x, y: there.y + d.y }, taken), scope);
    }
    const boundary = ltx.get(rect.id)!;
    const data: C4Relationship = { relationship: true, description: r.data.description, technology: r.data.technology, metadata: r.data.metadata };
    if (outgoing) addArrow(ea, ltx, boundary, otherBox, data, scope);
    else addArrow(ea, ltx, otherBox, boundary, data, scope);
  }
}

/** Adds the dashed boundary of a layer's scope, labelled at its bottom left as C4 does. */
function addBoundary(ea: ExcalidrawAutomate, ltx: LayerTx, b: Box, scope: C4Element & { id: string }, layer: DiagramId) {
  const s = ltx.api.getAppState();
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: BOUNDARY_COLOR,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "dashed",
    roughness: s.currentItemRoughness,
    roundness: null,
    opacity: 100,
    angle: 0,
    fontFamily: s.currentItemFontFamily,
    fontSize: FONT_SIZE,
    textAlign: "left",
    verticalAlign: "top",
  });
  const rectId = ea.addRect(b.x, b.y, b.width, b.height);
  const label = boundaryLabel(scope);
  const m = ea.measureText(label);
  const textId = ea.addText(b.x + BOUNDARY_PAD / 2, b.y + b.height - m.height - BOUNDARY_PAD / 4, label, { textAlign: "left" });
  const tag = { [KEY]: { boundary: scope.id } };
  for (const id of [rectId, textId]) ltx.add({ ...ea.getElement(id), customData: tag }, layer);
}

/**
 * Moves the containers and components dropped onto another system or container, or into the boundary of one, into it:
 * from then on they belong there. The boundary of the layer is fitted again around the ones dropped in it, as one
 * dragged out and back. Takes the boxes that were dragged; returns what was moved, to tell the user.
 */
export function dropBoxes(view: ExcalidrawView, boxIds: string[]): string[] {
  const els = view.excalidrawAPI!.getSceneElements();
  const { scene, current } = readScene(els);
  const ghosts = els.filter((e) => isGhost(e.customData) && !e.containerId && e.type !== "text" && e.type !== "arrow");
  const moves: { id: string; parent: string }[] = [];
  const back: string[] = []; // dropped in the boundary they belong in
  for (const boxId of boxIds) {
    const box = scene.byId.get(boxId);
    const id = box && scene.modelId(box);
    if (!box || !id || moves.some((m) => m.id === id) || !ofLevel(scene, current, id)) continue;
    const parent = dropTarget(scene, current, ghosts, box, id);
    if (parent && parent !== scene.parent(id)) moves.push({ id, parent });
    else if (parent && parent === scene.view(current)?.scope) back.push(boxId);
  }
  if (!moves.length && !back.length) return [];
  const name = (id: string) => scene.element(id)?.name.trim() || "Unnamed";
  const done = withLayers(view, (ea, ltx) => {
    if (back.length) fitBoundary(ltx, current, back);
    for (const m of moves) reparent(ea, ltx, m.id, m.parent);
  });
  return done ? moves.map((m) => `Moved ${name(m.id)} into ${name(m.parent)}.`) : [];
}

/**
 * The element a dragged container or component is dropped into, by the center of its box: the topmost internal system
 * or container of the right kind under it, drawn in the layer or a ghost of a level above, else the scope of the layer
 * when it is inside the boundary.
 */
function dropTarget(scene: Scene, layer: DiagramId, ghosts: El[], box: El, id: string): string | undefined {
  const kind = parentKind(scene.element(id)!.kind);
  if (!kind) return undefined;
  const c = center(box);
  const fits = (p: string | null | undefined): p is string => {
    const d = p ? scene.element(p) : undefined;
    return !!d && d.kind === kind && !d.external && !scene.within(p!, id);
  };
  for (const b of scene.boxes(layer).reverse()) {
    const p = scene.modelId(b);
    if (b.id !== box.id && fits(p) && contains(b, c)) return p;
  }
  for (const g of [...ghosts].reverse()) {
    const source = ghostSource(g.id);
    const original = source ? scene.byId.get(source) : undefined;
    const p = original ? scene.modelId(original) : null;
    if (fits(p) && contains(g, c)) return p;
  }
  const v = scene.view(layer);
  const rect = scene.boundary(layer).rect;
  return v && rect && fits(v.scope) && contains(rect, center(box)) ? v.scope : undefined;
}

/**
 * Makes an element part of another parent, in every layer: it goes into the parent's layer, which is created first if
 * there is none, and leaves the other layers, where the parent stands for it. Its relationships stay, between the
 * elements at their ends as each layer shows them.
 */
function reparent(ea: ExcalidrawAutomate, ltx: LayerTx, id: string, parent: string) {
  const before = ltx.scene();
  const data = before.element(id);
  if (!data) return;
  const oldHome = data.parent ? before.diagramFor(data.parent) : undefined;
  const external = before.inheritedExternal(parent);
  const moved: C4Element = { ...data, id, parent, external };
  for (const b of before.boxesOf(id)) restyle(ea, ltx, b.id, moved);
  passExternal(ea, ltx, before, id, external);

  let scene = ltx.scene();
  let home = scene.diagramFor(parent);
  if (home === undefined) {
    // The parent has no layer yet: made as zooming into it would, with the element in it.
    const parentBox = scene.boxIn(parent, ltx.current) ?? scene.boxesOf(parent)[0];
    const kind = zoomView(scene.element(parent)!);
    if (!parentBox || !kind) return;
    createLayer(ea, ltx, scene, parentBox, { ...scene.element(parent)!, id: parent }, kind, scene.diagramOf(parentBox));
    home = parent;
    scene = ltx.scene();
  }
  const placed: string[] = [];
  if (!scene.boxIn(id, home)) {
    placed.push(addBox(ea, ltx, moved, slotIn(scene, home, moved), home).id);
    scene = ltx.scene();
  }

  // Out of every other layer, keeping its relationships there.
  const leaving = scene.boxesOf(id).filter((b) => scene.diagramOf(b) !== home);
  const layers = new Set([home, ltx.current, ...leaving.map((b) => scene.diagramOf(b)), ...(oldHome !== undefined ? [oldHome] : [])]);
  const kept = scene.relationships()
    .filter((r) => leaving.includes(r.from) || leaving.includes(r.to))
    .map((r) => ({
      from: scene.modelId(r.from)!,
      to: scene.modelId(r.to)!,
      data: { relationship: true as const, description: r.data.description, technology: r.data.technology, metadata: r.data.metadata },
    }));
  const neighbours = scene.neighbours(parent);
  for (const b of leaving) removeBox(ltx, b.id);
  for (const k of kept) {
    let s = ltx.scene();
    // The element at the other end, as the parent's layer shows it, around the boundary.
    const other = k.from === id ? k.to : k.from;
    const n = neighbours.find((x) => s.within(other, x.id));
    if (n && !s.representative(n.id, home)) {
      const d = { ...s.element(n.id)!, id: n.id };
      addBox(ea, ltx, d, slotIn(s, home, d), home);
      s = ltx.scene();
    }
    const a = s.representative(k.from, home);
    const b = s.representative(k.to, home);
    if (a && b && a.id !== b.id && !s.hasRelationship(home, s.modelId(a)!, s.modelId(b)!)) addArrow(ea, ltx, a, b, k.data, home);
    s = ltx.scene();
    for (const t of s.liftTargets(k.from, k.to, home)) addArrow(ea, ltx, t.from, t.to, k.data, t.diagram);
  }
  for (const l of layers) fitBoundary(ltx, l, l === home ? placed : []);
}

/** Takes a box out of its layer, with its text, the parts of its shape and its relationships. */
function removeBox(ltx: LayerTx, boxId: string) {
  const box = ltx.get(boxId);
  if (!box) return;
  for (const p of ltx.partsOf(boxId)) ltx.remove(p.id);
  for (const ref of box.boundElements ?? []) {
    if (ref.type === "arrow") removeArrow(ltx, ref.id);
    else ltx.remove(ref.id);
  }
  ltx.remove(boxId);
}

/** Takes a relationship out of its layer, with its label, and unglues it from its ends. */
function removeArrow(ltx: LayerTx, arrowId: string) {
  const arrow = ltx.get(arrowId);
  if (!arrow) return;
  const text = boundText(ltx, arrow);
  if (text) ltx.remove(text.id);
  ltx.remove(arrow.id);
  for (const end of [arrow.startBinding?.elementId, arrow.endBinding?.elementId]) {
    const other = end ? ltx.get(end) : undefined;
    if (other) ltx.patch(other.id, { boundElements: (other.boundElements ?? []).filter((b) => b.id !== arrow.id) });
  }
}

/**
 * Deletes, in the other layers, the relationships that relationships deleted from the layer on the canvas stood for:
 * between the same two elements, or anything inside them. Not while the layer still has another relationship between
 * the two the same way. One undo step, after the delete itself. False when there was nothing to delete.
 */
export function deleteBelow(view: ExcalidrawView, gone: [string, string][]): boolean {
  const { scene, current } = readScene(view.excalidrawAPI!.getSceneElements());
  const arrows = gone
    .filter(([from, to]) => !scene.hasRelationship(current, from, to))
    .flatMap(([from, to]) => relationshipsWithin(scene, from, to, current));
  if (!arrows.length) return false;
  return withLayers(view, (_ea, ltx) => {
    for (const a of arrows) removeArrow(ltx, a.id);
  });
}
