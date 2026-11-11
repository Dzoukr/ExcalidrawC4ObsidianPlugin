import { AppState, El, ExcalidrawAutomate, ExcalidrawView, getEA } from "./excalidraw";
import { DiagramId, Scene, grid, newId, nextSlot, row } from "./layers";
import { LayerTx, readScene } from "./layertx";
import {
  Box, C4Element, C4Relationship, CONTEXT, ELEMENT_WIDTH, KEY, MIN_HEIGHT, PADDING, RELATIONSHIP_COLOR, Vec, ViewKind, allowedKinds, arrowMidpoint,
  boundaryLabel, bounds, boxSize, center, edgePoint, elementData, laneLine, laneOffsets, normalOf, elementLabel, lookOf, isGhost, makeWay, overlaps, parentFor, relationshipData,
  relationshipLabel, zoomView,
} from "./model";

const GAP = 120; // between an element and the one added below it
const FONT_SIZE = 16;
const RELATIONSHIP_FONT_SIZE = 14;
const BOUNDARY_PAD = 40; // between a boundary and the elements in it
const BOUNDARY_LABEL = 56; // room for the boundary's label below the elements in it
const BOUNDARY_COLOR = "#444444";

export interface Selected {
  el: El;
  data: C4Element;
}

export interface SelectedRelationship {
  el: El;
  data: C4Relationship;
}

/** The selected elements carrying C4 data; selecting a box's or arrow's text counts as selecting the box or arrow. */
function selectedC4(view: ExcalidrawView): El[] {
  const api = view.excalidrawAPI;
  if (!api) return [];
  const byId = new Map(api.getSceneElements().map((e) => [e.id, e]));
  const out = new Map<string, El>();
  for (const [id, on] of Object.entries(api.getAppState().selectedElementIds ?? {})) {
    if (!on) continue;
    let el = byId.get(id);
    if (el?.containerId) el = byId.get(el.containerId);
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
    kinds: allowedKinds(v?.view ?? null),
    zoomIn: !!item && !isRelationship(item) && !!zoomView(item.data),
    zoomOut: v ? levelName(scene, scene.parentLayer(v.scope)) : null,
  };
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
    const owner = e.containerId ? byId.get(e.containerId) : e;
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
      const selectedElementIds = Object.fromEntries((to.select ?? []).map((id) => [id, true]));
      api.updateScene({ appState: { selectedElementIds }, captureUpdate: "NEVER" });
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
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: look.text,
    backgroundColor: look.background,
    fillStyle: "solid",
    strokeWidth: 1,
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
  const size = text ? boxSize(text) : { width: Math.max(ELEMENT_WIDTH, box.width), height: Math.max(MIN_HEIGHT, box.height) };
  Object.assign(box, { x: at.x, y: at.y, ...size, customData: { ...(box.customData ?? {}), [KEY]: data } });
  if (text) Object.assign(text, { x: at.x + (size.width - text.width) / 2, y: at.y + (size.height - text.height) / 2 });
  for (const el of els) ltx.add(el, layer);
  return ltx.get(id)!;
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
    id = addBox(ea, ltx, data, placeIn(view, scene, layer, data), layer).id;
    fitBoundary(ltx, layer);
    // Its own layer: the system context for people and systems, the layer of its parent for the others.
    const home = data.parent ? scene.diagramFor(data.parent) : CONTEXT;
    if (home !== undefined && home !== layer) {
      addBox(ea, ltx, data, slotIn(scene, home, data), home);
      fitBoundary(ltx, home);
    }
  });
  if (added) view.excalidrawAPI!.updateScene({ appState: { selectedElementIds: { [id]: true } }, captureUpdate: "NEVER" });
  return added;
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

/** Grows a layer's boundary around the scope's elements; the elements below and right of it make way. */
function fitBoundary(ltx: LayerTx, layer: DiagramId) {
  const scene = ltx.scene();
  const v = scene.view(layer);
  const { rect, label } = scene.boundary(layer);
  if (!v || !rect) return;
  const inner = scene.boxes(layer).filter((b) => scene.element(scene.modelId(b)!)?.parent === v.scope);
  const need = bounds(inner, BOUNDARY_PAD);
  const grown = bounds(need ? [rect, { ...need, height: need.height + BOUNDARY_LABEL }] : [rect])!;
  ltx.patch(rect.id, grown);
  if (label) ltx.patch(label.id, { x: grown.x + BOUNDARY_PAD / 2, y: grown.y + grown.height - label.height - BOUNDARY_PAD / 4 });
  const bottom = rect.y + rect.height;
  const right = rect.x + rect.width;
  const dy = grown.y + grown.height - bottom;
  const dx = grown.x + grown.width - right;
  for (const b of scene.boxes(layer)) {
    if (inner.includes(b)) continue;
    const by = b.y >= bottom ? dy : 0;
    const bx = b.x >= right ? dx : 0;
    if (bx || by) moveBox(ltx, b.id, bx, by);
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
    for (const b of copies) restyle(ea, ltx, b.id, { ...data, id });
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
    const size = boxSize(m);
    const x = c.x - size.width / 2;
    const y = c.y - size.height / 2;
    ltx.patch(box.id, { x, y, ...size });
    ltx.patch(text.id, {
      ...textOf(label), ...m, strokeColor: look.text, x: x + (size.width - m.width) / 2, y: y + (size.height - m.height) / 2,
    });
  }
  ltx.patch(box.id, { backgroundColor: look.background, strokeColor: look.stroke, customData: { ...(box.customData ?? {}), [KEY]: data } });
  for (const b of box.boundElements ?? []) if (b.type === "arrow") reroute(ltx, b.id);
}

/** Changes a relationship's data and label, and with `reverse` turns it the other way round. */
export function updateRelationship(view: ExcalidrawView, arrowId: string, data: C4Relationship, reverse = false): boolean {
  return withLayers(view, (ea, ltx) => {
    const arrow = ltx.get(arrowId);
    if (!arrow) return;
    ltx.patch(arrow.id, { customData: { ...(arrow.customData ?? {}), [KEY]: data } });
    const text = boundText(ltx, arrow);
    if (text) {
      const label = relationshipLabel(data);
      const m = measure(ea, text, label);
      const mid = arrowMidpoint(arrow);
      ltx.patch(text.id, { ...textOf(label), ...m, x: mid.x - m.width / 2, y: mid.y - m.height / 2 });
    }
    if (reverse) turn(ltx, arrowId);
  });
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
export function zoomIn(view: ExcalidrawView): boolean {
  const item = selectedItem(view);
  if (!item || isRelationship(item)) return false;
  const kind = zoomView(item.data);
  if (!kind) return false;
  return withLayers(view, (ea, ltx) => {
    const scene = ltx.scene();
    const scope = scene.modelId(item.el)!;
    if (!ltx.hasLayer(scope)) createLayer(ea, ltx, scene, item.el, { ...item.data, id: scope }, kind);
    carryDown(ea, ltx, scope);
    return { layer: scope };
  });
}

/** Puts the layer one level up on the canvas, with the scope of the current layer selected. */
export function zoomOut(view: ExcalidrawView): boolean {
  return withLayers(view, (_ea, ltx) => {
    const scene = ltx.scene();
    const v = scene.view(ltx.current);
    if (!v) return;
    const up = scene.parentLayer(v.scope);
    const box = scene.boxIn(v.scope, up);
    return { layer: up, select: box ? [box.id] : [] };
  });
}

/**
 * Creates the layer of a system or container where its box is: the scope's boundary around the elements already known
 * to be in it, and around the boundary the elements with relationships to it, where they are in the current layer.
 */
function createLayer(ea: ExcalidrawAutomate, ltx: LayerTx, scene: Scene, scopeBox: El, scopeData: C4Element & { id: string }, kind: ViewKind) {
  const scope = scopeData.id;
  if (!elementData(scopeBox.customData)?.id) ltx.patch(scopeBox.id, { customData: { ...(scopeBox.customData ?? {}), [KEY]: scopeData } });
  ltx.addLayer(scope, kind);
  const children = scene.children(scope);
  const neighbours = scene.neighbours(scope);

  // The boundary takes the place of the scope's box, grown to hold its elements.
  const cell = { width: ELEMENT_WIDTH, height: MIN_HEIGHT };
  const cols = Math.max(2, Math.min(3, Math.ceil(Math.sqrt(children.length))));
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
    const here = scene.boxIn(n.id, ltx.current);
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
 * Brings the relationships of the scope one level up down into its layer, each once: as arrows between the element
 * at the other end and the scope's boundary, to be moved onto the element inside that they are about. One already
 * shown in the layer, from or to anything inside the scope, is not repeated.
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
    const carried = r.data.carried ?? [];
    if (carried.includes(scope)) continue;
    ltx.patch(r.arrow.id, { customData: { ...(r.arrow.customData ?? {}), [KEY]: { ...r.data, carried: [...carried, scope] } } });
    const outgoing = from === scope;
    const other = outgoing ? to : from;
    const scene = ltx.scene();
    const shown = scene.relationships(scope).some((x) => {
      const f = scene.modelId(x.from)!;
      const t = scene.modelId(x.to)!;
      return outgoing ? scene.within(f, scope) && t === other : f === other && scene.within(t, scope);
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
    const data: C4Relationship = { relationship: true, description: r.data.description, technology: r.data.technology };
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
