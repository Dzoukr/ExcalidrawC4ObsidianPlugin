// The layers of a C4 drawing: which layer each element is in, how elements nest, and what each layer should show.
// Pure: works on plain element data, no Obsidian or Excalidraw runtime.

import type { El } from "./excalidraw";
import { CONTEXT, MISPLACED_LOOK, STROKE_WIDTH, boundaryData, boxStyle, center, contains, elementData, partOf, relationshipData } from "./model.ts"; // with its extension, for the tests running in Node
import type { Box, C4Element, C4Relationship, C4View, Vec, ViewKind } from "./model.ts";

/** A layer: the id of its scope, or CONTEXT for the system context. */
export type DiagramId = string;

export interface Relationship {
  arrow: El;
  from: El;
  to: El;
  data: C4Relationship;
}

/** A neighbour of a layer's scope: an element outside it that something inside it has a relationship with. */
export interface Neighbour {
  id: string;
  incoming: boolean; // it uses the scope, rather than the other way round
}

/** A read-only index of the C4 elements, layers and relationships of a drawing. */
export class Scene {
  readonly byId = new Map<string, El>();
  private readonly layerOf = new Map<string, DiagramId>(); // by Excalidraw element id
  private readonly data = new Map<string, C4Element>(); // by element id, from its first box
  private readonly boxesById = new Map<string, El[]>();
  private readonly partsByBox = new Map<string, El[]>(); // the parts drawing a box's shape, back to front
  private readonly views: Readonly<Record<DiagramId, ViewKind | null>>;

  constructor(layers: ReadonlyMap<DiagramId, readonly El[]>, views: Readonly<Record<DiagramId, ViewKind | null>>) {
    this.views = views;
    for (const [layer, els] of layers) {
      for (const e of els) {
        if (e.isDeleted) continue;
        this.byId.set(e.id, e);
        this.layerOf.set(e.id, layer);
      }
    }
    for (const e of this.byId.values()) {
      const part = partOf(e.customData);
      if (part) this.partsByBox.set(part, [...(this.partsByBox.get(part) ?? []), e]);
      const d = elementData(e.customData);
      if (!d || e.containerId) continue;
      const id = d.id ?? e.id;
      if (!this.data.has(id)) this.data.set(id, d);
      const list = this.boxesById.get(id) ?? [];
      list.push(e);
      this.boxesById.set(id, list);
    }
  }

  /** The element a box stands for, or null when it is no C4 box. */
  modelId(box: El): string | null {
    const d = elementData(box.customData);
    return d ? d.id ?? box.id : null;
  }

  element(id: string): C4Element | undefined {
    return this.data.get(id);
  }

  boxesOf(id: string): El[] {
    return this.boxesById.get(id) ?? [];
  }

  /** The parts drawing a box's shape around it, back to front. */
  parts(boxId: string): El[] {
    return this.partsByBox.get(boxId) ?? [];
  }

  diagramOf(el: El): DiagramId {
    return this.layerOf.get(el.id) ?? CONTEXT;
  }

  /** What a layer shows; null for the system context. */
  view(diagram: DiagramId): C4View | null {
    const kind = this.views[diagram];
    return kind ? { view: kind, scope: diagram } : null;
  }

  diagrams(): DiagramId[] {
    return Object.keys(this.views);
  }

  /** The layer that zooms into the element, if there is one. */
  diagramFor(scope: string): DiagramId | undefined {
    return scope !== CONTEXT && scope in this.views ? scope : undefined;
  }

  /** Every element of a layer. */
  elementsIn(diagram: DiagramId): El[] {
    return [...this.byId.values()].filter((e) => this.layerOf.get(e.id) === diagram);
  }

  /** The layer one level up from the scope's layer: the one of its parent, or the system context. */
  parentLayer(scope: string): DiagramId {
    const parent = this.parent(scope);
    return (parent && this.diagramFor(parent)) || CONTEXT;
  }

  /** The C4 boxes in a layer. */
  boxes(diagram: DiagramId): El[] {
    return [...this.byId.values()].filter((e) => !e.containerId && elementData(e.customData) && this.diagramOf(e) === diagram);
  }

  /** The element's box in a layer, if it is drawn there. */
  boxIn(id: string, diagram: DiagramId): El | undefined {
    return this.boxesOf(id).find((b) => this.diagramOf(b) === diagram);
  }

  /** The boundary rectangle and its label in a layer. */
  boundary(diagram: DiagramId): { rect?: El; label?: El } {
    const out: { rect?: El; label?: El } = {};
    for (const e of this.byId.values()) {
      if (this.diagramOf(e) !== diagram || boundaryData(e.customData)?.boundary !== diagram) continue;
      if (e.type === "text") out.label = e;
      else out.rect = e;
    }
    return out;
  }

  parent(id: string): string | undefined {
    return this.data.get(id)?.parent;
  }

  /** The elements containing the element, innermost first. */
  ancestors(id: string): string[] {
    const out: string[] = [];
    for (let p = this.parent(id); p && !out.includes(p) && p !== id; p = this.parent(p)) out.push(p);
    return out;
  }

  /** The element or the innermost element containing it that is drawn in the diagram. */
  representative(id: string, diagram: DiagramId): El | undefined {
    for (const e of [id, ...this.ancestors(id)]) {
      const box = this.boxIn(e, diagram);
      if (box) return box;
    }
    return undefined;
  }

  /** The relationship arrows between C4 boxes, in one diagram or all of them. */
  relationships(diagram?: DiagramId): Relationship[] {
    const out: Relationship[] = [];
    for (const arrow of this.byId.values()) {
      const data = relationshipData(arrow.customData);
      if (!data || (diagram !== undefined && this.diagramOf(arrow) !== diagram)) continue;
      const from = arrow.startBinding ? this.byId.get(arrow.startBinding.elementId) : undefined;
      const to = arrow.endBinding ? this.byId.get(arrow.endBinding.elementId) : undefined;
      if (from && to && this.modelId(from) && this.modelId(to)) out.push({ arrow, from, to, data });
    }
    return out;
  }

  hasRelationship(diagram: DiagramId, from: string, to: string): boolean {
    return this.relationships(diagram).some((r) => this.modelId(r.from) === from && this.modelId(r.to) === to);
  }

  /**
   * Where else a relationship between two elements should be drawn: every other diagram that shows its ends or the
   * elements containing them, as two different boxes, and has no such relationship yet.
   */
  liftTargets(from: string, to: string, except: DiagramId): { diagram: DiagramId; from: El; to: El }[] {
    const out: { diagram: DiagramId; from: El; to: El }[] = [];
    for (const diagram of this.diagrams()) {
      if (diagram === except) continue;
      const a = this.representative(from, diagram);
      const b = this.representative(to, diagram);
      if (!a || !b) continue;
      const ma = this.modelId(a)!;
      const mb = this.modelId(b)!;
      if (ma !== mb && !this.hasRelationship(diagram, ma, mb)) out.push({ diagram, from: a, to: b });
    }
    return out;
  }

  /** Whether the element is the scope or inside it. */
  within(id: string, scope: string): boolean {
    return id === scope || this.ancestors(id).includes(scope);
  }

  /** The elements whose parent is the scope. */
  children(scope: string): string[] {
    return [...this.data.entries()].filter(([, d]) => d.parent === scope).map(([id]) => id);
  }

  /** Every element inside the element, at any depth. */
  descendants(id: string): string[] {
    return [...this.data.keys()].filter((e) => e !== id && this.ancestors(e).includes(id));
  }

  /** Whether an element with this parent is external: as its system is, at the top of its parents. */
  inheritedExternal(parent: string | undefined): boolean {
    if (!parent) return false;
    const top = [parent, ...this.ancestors(parent)].pop()!;
    return !!this.element(top)?.external;
  }

  /**
   * The elements a diagram of the scope shows around its boundary: everything outside the scope that has a relationship
   * with the scope or with anything inside it, as the element at the diagram's level containing it.
   */
  neighbours(scope: string): Neighbour[] {
    const around = this.ancestors(scope);
    // The outermost element containing it that is still a sibling of the scope or of one of its ancestors.
    const lift = (id: string) => {
      for (const e of [id, ...this.ancestors(id)]) {
        const p = this.parent(e);
        if (!p || around.includes(p)) return e;
      }
      return id;
    };
    const out = new Map<string, Neighbour>();
    for (const r of this.relationships()) {
      const a = this.modelId(r.from)!;
      const b = this.modelId(r.to)!;
      const inA = this.within(a, scope);
      const inB = this.within(b, scope);
      if (inA === inB) continue;
      const id = lift(inA ? b : a);
      if (this.within(id, scope)) continue;
      const known = out.get(id);
      // Something that both uses and is used by the scope sits with the ones using it.
      out.set(id, { id, incoming: inB || !!known?.incoming });
    }
    return [...out.values()];
  }
}

/**
 * The layers above a layer, up to and including the own layer of an element with that parent (the system context
 * without one): where copies of an element added to the layer belong.
 */
export function levelsUpTo(scene: Scene, layer: DiagramId, parent: string | undefined): DiagramId[] {
  const home = parent ? scene.diagramFor(parent) : CONTEXT;
  if (home === undefined || home === layer) return [];
  const out: DiagramId[] = [];
  for (let l = layer, v = scene.view(l); v && out.length < 10; v = scene.view(l)) {
    l = scene.parentLayer(v.scope);
    out.push(l);
    if (l === home) return out;
  }
  return [home]; // not above this layer: only its own
}

/**
 * Whether an element belongs to the level of a layer, where alone it can be edited: in the system context everything,
 * in a layer of a system or container the elements of its scope. The others are there for context, from the levels
 * above.
 */
export function ofLevel(scene: Scene, layer: DiagramId, id: string): boolean {
  const v = scene.view(layer);
  return !v || scene.parent(id) === v.scope;
}

/** Whether one end of a relationship, a box or the boundary of the layer, belongs to the layer's level. */
export function endOfLevel(scene: Scene, layer: DiagramId, elId: string | undefined): boolean {
  const end = elId ? scene.byId.get(elId) : undefined;
  if (!end) return false;
  if (boundaryData(end.customData)?.boundary === layer) return true;
  const id = scene.modelId(end);
  return !!id && ofLevel(scene, layer, id);
}

/**
 * The elements a relationship arrow goes between, by their ids: a box stands for its element, a boundary for the
 * scope it is the boundary of. Null when an end is neither.
 */
export function endsOf(scene: Scene, arrow: El): [string, string] | null {
  const end = (elId: string | undefined) => {
    const e = elId ? scene.byId.get(elId) : undefined;
    return e ? scene.modelId(e) ?? boundaryData(e.customData)?.boundary ?? null : null;
  };
  const from = end(arrow.startBinding?.elementId);
  const to = end(arrow.endBinding?.elementId);
  return from && to ? [from, to] : null;
}

/**
 * The copies of a relationship in the other layers: the same relationship between the elements standing for its ends
 * there, up a level or down, with the same description, technology and metadata, as copied from it and not edited
 * since. One between the same elements that says something else is another relationship.
 */
export function copiesOf(scene: Scene, arrow: El): El[] {
  const ends = endsOf(scene, arrow);
  const data = relationshipData(arrow.customData);
  if (!ends || !data) return [];
  const [a, b] = ends;
  const same = (d: C4Relationship) =>
    d.description.trim() === data.description.trim() && (d.technology ?? "").trim() === (data.technology ?? "").trim() &&
    JSON.stringify(d.metadata ?? {}) === JSON.stringify(data.metadata ?? {});
  const layer = scene.diagramOf(arrow);
  return [...scene.byId.values()].filter((x) => {
    const d = x.containerId ? null : relationshipData(x.customData);
    const e = d && x.id !== arrow.id && scene.diagramOf(x) !== layer ? endsOf(scene, x) : null;
    if (!d || !e || !same(d)) return false;
    const [xa, xb] = e;
    return (scene.within(a, xa) && scene.within(b, xb)) || (scene.within(xa, a) && scene.within(xb, b));
  });
}

/**
 * The relationship arrows of the other layers that a relationship from one element to another stands for: from the
 * element or anything inside it, to the other or anything inside that.
 */
export function relationshipsWithin(scene: Scene, from: string, to: string, except: DiagramId): El[] {
  return [...scene.byId.values()].filter((a) => {
    if (a.containerId || !relationshipData(a.customData) || scene.diagramOf(a) === except) return false;
    const ends = endsOf(scene, a);
    return !!ends && scene.within(ends[0], from) && scene.within(ends[1], to);
  });
}

/**
 * The boxes around the boundary of a layer that have nothing to do with its scope any more: no relationship with it or
 * with anything inside it, in any layer, and no relationship to its boundary in this one. They belong in the view of
 * the levels above, not in the layer.
 */
export function unrelated(scene: Scene, layer: DiagramId): El[] {
  const v = scene.view(layer);
  const rect = scene.boundary(layer).rect;
  if (!v) return [];
  const related = new Set(scene.neighbours(v.scope).map((n) => n.id));
  for (const ref of rect?.boundElements ?? []) {
    const arrow = ref.type === "arrow" ? scene.byId.get(ref.id) : undefined;
    for (const end of [arrow?.startBinding?.elementId, arrow?.endBinding?.elementId]) {
      const box = end ? scene.byId.get(end) : undefined;
      const id = box && scene.modelId(box);
      if (id) related.add(id);
    }
  }
  return scene.boxes(layer).filter((b) => {
    const id = scene.modelId(b)!;
    return !ofLevel(scene, layer, id) && !scene.within(id, v.scope) && ![...related].some((r) => scene.within(id, r));
  });
}

/**
 * The elements of a layer that come from the levels above, and so cannot be deleted there: the boxes that do not
 * belong to its level with their text and the parts of their shape, the relationships between them, and its boundary.
 */
export function guarded(scene: Scene, layer: DiagramId): Set<string> {
  const stale = new Set(unrelated(scene, layer).map((b) => b.id));
  const out = new Set<string>();
  const withText = (e: El) => {
    out.add(e.id);
    for (const b of e.boundElements ?? []) if (b.type === "text") out.add(b.id);
    for (const p of scene.parts(e.id)) out.add(p.id);
  };
  for (const e of scene.elementsIn(layer)) {
    if (e.containerId) continue;
    if (boundaryData(e.customData)?.boundary === layer) out.add(e.id);
    else if (elementData(e.customData)) {
      if (!ofLevel(scene, layer, scene.modelId(e)!) && !stale.has(e.id)) withText(e);
    } else if (relationshipData(e.customData)) {
      if (![e.startBinding?.elementId, e.endBinding?.elementId].some((end) => endOfLevel(scene, layer, end))) withText(e);
    }
  }
  return out;
}

/**
 * The boxes of a layer that are where they do not belong: an element of the layer's scope outside its boundary, or
 * anything else inside it. Goes by the center of the box.
 */
export function misplaced(scene: Scene, layer: DiagramId): El[] {
  const v = scene.view(layer);
  const rect = scene.boundary(layer).rect;
  if (!v || !rect) return [];
  return scene.boxes(layer).filter((b) => contains(rect, center(b)) !== (scene.parent(scene.modelId(b)!) === v.scope));
}

/** The changes that mark the misplaced boxes of a layer as errors, and give the others their own outline back. */
export function markPatches(scene: Scene, layer: DiagramId): [string, Partial<El>][] {
  const bad = new Set(misplaced(scene, layer).map((b) => b.id));
  const out: [string, Partial<El>][] = [];
  for (const b of scene.boxes(layer)) {
    const marked = b.strokeColor === MISPLACED_LOOK.strokeColor;
    if (bad.has(b.id) && !marked) out.push([b.id, { ...MISPLACED_LOOK }]);
    else if (!bad.has(b.id) && marked) out.push([b.id, { strokeColor: boxStyle(elementData(b.customData)!).strokeColor, strokeWidth: STROKE_WIDTH, strokeStyle: "solid" }]);
  }
  return out;
}

/** Where the next box goes in an area: below the lowest box in it, else at its top left corner. */
export function nextSlot(boxes: Box[], area: Box | null, gap: number, pad: number): Vec {
  const inside = area ? boxes.filter((b) => contains(area, { x: b.x + b.width / 2, y: b.y + b.height / 2 })) : boxes;
  if (!inside.length) return area ? { x: area.x + pad, y: area.y + pad } : { x: 0, y: 0 };
  const left = Math.min(...inside.map((b) => b.x));
  const bottom = Math.max(...inside.map((b) => b.y + b.height));
  return { x: left, y: bottom + gap };
}

/** Top left corners of n cells in a grid of at most `maxCols` columns. */
export function grid(n: number, origin: Vec, cell: { width: number; height: number }, gap: number, maxCols = 3): Vec[] {
  const cols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(n))));
  return Array.from({ length: n }, (_, i) => ({
    x: origin.x + (i % cols) * (cell.width + gap),
    y: origin.y + Math.floor(i / cols) * (cell.height + gap),
  }));
}

/** Top left corners of n cells in a row centered on a point. */
export function row(n: number, centerX: number, y: number, width: number, gap: number): Vec[] {
  const total = n * width + (n - 1) * gap;
  return Array.from({ length: n }, (_, i) => ({ x: centerX - total / 2 + i * (width + gap), y }));
}

/** A fresh element id. */
export const newId = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
