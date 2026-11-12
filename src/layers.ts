// The layers of a C4 drawing: which layer each element is in, how elements nest, and what each layer should show.
// Pure: works on plain element data, no Obsidian or Excalidraw runtime.

import type { El } from "./excalidraw";
import { CONTEXT, boundaryData, contains, elementData, relationshipData } from "./model.ts"; // with its extension, for the tests running in Node
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
