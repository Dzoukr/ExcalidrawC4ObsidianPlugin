// The C4 model as stored on Excalidraw elements: pure data and geometry, no Obsidian or Excalidraw runtime.

/** Key under which C4 data is kept in an element's customData. */
export const KEY = "c4";

export const KINDS = ["person", "system", "container", "component"] as const;
export type C4Kind = (typeof KINDS)[number];

/** A person, software system, container or component: the data of its box. */
export interface C4Element {
  kind: C4Kind;
  name: string;
  technology?: string; // containers and components only
  description?: string;
  external?: boolean; // outside the system being described
  id?: string; // the same element in every diagram; the box's own id for elements drawn before ids
  parent?: string; // the system of a container, the container of a component
  metadata?: Record<string, string>; // key: value pairs, not drawn
}

/** The data of a relationship arrow. */
export interface C4Relationship {
  relationship: true;
  description: string;
  technology?: string;
  metadata?: Record<string, string>; // key: value pairs, not drawn
}

/** What a layer below the system context shows: the containers of a system or the components of a container. */
export type ViewKind = "container" | "component";

export interface C4View {
  view: ViewKind;
  scope: string; // id of the system or container
}

/** Key of the system context among the layers; every other layer is keyed by the id of its scope. */
export const CONTEXT = "";

/**
 * The layers of a drawing, kept on an invisible element: only the current layer is on the canvas, the others wait here
 * as their saved elements.
 */
export interface C4Store {
  current: string;
  views: Record<string, ViewKind | null>; // every layer, null for the system context
  hidden: Record<string, unknown[]>; // the elements of every layer but the current one
}

/** The dashed boundary of a diagram's scope, and its label. */
export interface C4Boundary {
  boundary: string; // id of the system or container
}

/** Metadata from the rows of a form: keys trimmed, rows without a key left out, the last of the same key kept. */
export function cleanMetadata(rows: readonly (readonly [string, string])[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of rows) if (key.trim()) out[key.trim()] = value.trim();
  return Object.keys(out).length ? out : undefined;
}

export const isKind = (k: unknown): k is C4Kind => KINDS.includes(k as C4Kind);

const KIND_TITLES: Record<C4Kind, string> = {
  person: "Person",
  system: "Software System",
  container: "Container",
  component: "Component",
};

export const hasTechnology = (kind: C4Kind) => kind === "container" || kind === "component";

/** Only the elements of the system context can be external; containers and components take it from their system. */
export const canBeExternal = (kind: C4Kind) => kind === "person" || kind === "system";

/** The kind of element a container or component belongs in; null for the others, which belong in no element. */
export const parentKind = (kind: C4Kind): C4Kind | null => (kind === "container" ? "system" : kind === "component" ? "container" : null);

export const kindTitle = (kind: C4Kind, external = false) => (external ? "External " : "") + KIND_TITLES[kind];

export function elementData(customData: Record<string, unknown> | undefined): C4Element | null {
  const d = customData?.[KEY] as Partial<C4Element> | undefined;
  return d && isKind(d.kind) && typeof d.name === "string" ? (d as C4Element) : null;
}

export function relationshipData(customData: Record<string, unknown> | undefined): C4Relationship | null {
  const d = customData?.[KEY] as Partial<C4Relationship> | undefined;
  return d?.relationship === true && typeof d.description === "string" ? (d as C4Relationship) : null;
}

/** A dimmed, locked copy of an element of a level above, shown around the layer on the canvas. */
export const isGhost = (customData: Record<string, unknown> | undefined): boolean =>
  (customData?.[KEY] as { ghost?: unknown } | undefined)?.ghost === true;

export function storeData(customData: Record<string, unknown> | undefined): C4Store | null {
  const d = (customData?.[KEY] as { store?: Partial<C4Store> } | undefined)?.store;
  if (!d || typeof d.current !== "string" || typeof d.views !== "object" || typeof d.hidden !== "object") return null;
  return d as C4Store;
}

export function boundaryData(customData: Record<string, unknown> | undefined): C4Boundary | null {
  const d = customData?.[KEY] as Partial<C4Boundary> | undefined;
  return typeof d?.boundary === "string" ? (d as C4Boundary) : null;
}

/** The diagram that zooms into an element of this kind, if any. */
export const zoomView = (e: Pick<C4Element, "kind" | "external">): ViewKind | null =>
  e.external ? null : e.kind === "system" ? "container" : e.kind === "container" ? "component" : null;

/**
 * The kinds a diagram takes, those of its own level: null is the system context. The elements around a boundary come
 * from the levels above and are added there.
 */
export function allowedKinds(view: ViewKind | null): C4Kind[] {
  if (!view) return ["person", "system"];
  return view === "container" ? ["container"] : ["component"];
}

/** The level that takes elements of a kind, as the user knows it. */
export const levelOf = (kind: C4Kind): string => (kind === "container" ? "Container" : kind === "component" ? "Component" : "System");

/** Parent of an element added to a diagram: the scope for its children, the scope's parent for a sibling container. */
export function parentFor(kind: C4Kind, view: C4View | null, scopeParent: string | undefined): string | undefined {
  if (!view) return undefined;
  if (view.view === "container") return kind === "container" ? view.scope : undefined;
  if (kind === "component") return view.scope;
  return kind === "container" ? scopeParent : undefined;
}

export const boundaryLabel = (scope: Pick<C4Element, "kind" | "name">) =>
  `${scope.name.trim() || "Unnamed"}\n[${kindTitle(scope.kind)}]`;

/** Characters per line of an element's text, which keeps boxes about the same width. */
export const WRAP = 24;
export const RELATIONSHIP_WRAP = 28;

/** The text of an element's box: name, [kind: technology] and description, as in C4 diagrams. */
export function elementLabel(e: C4Element, wrapAt = WRAP): string {
  const tech = hasTechnology(e.kind) ? e.technology?.trim() : "";
  const tag = `[${kindTitle(e.kind, e.external)}${tech ? `: ${tech}` : ""}]`;
  const lines = [...wrap(e.name.trim() || "Unnamed", wrapAt), tag];
  const description = e.description?.trim();
  if (description) lines.push("", ...wrap(description, wrapAt));
  return lines.join("\n");
}

/** The text on a relationship arrow: what it does and, below, [technology]. */
export function relationshipLabel(r: C4Relationship, wrapAt = RELATIONSHIP_WRAP): string {
  const lines = wrap(r.description.trim() || "Uses", wrapAt);
  const tech = r.technology?.trim();
  if (tech) lines.push(`[${tech}]`);
  return lines.join("\n");
}

/** Wraps each paragraph at word boundaries; a word longer than the width gets a line of its own. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

export interface Look {
  background: string;
  stroke: string;
  text: string;
}

// The usual C4 colors: dark to light blue going down the levels, grey for external elements.
const LOOKS: Record<C4Kind, { internal: Look; external: Look }> = {
  person: {
    internal: { background: "#08427b", stroke: "#073b6f", text: "#ffffff" },
    external: { background: "#686868", stroke: "#5d5d5d", text: "#ffffff" },
  },
  system: {
    internal: { background: "#1168bd", stroke: "#0f5eaa", text: "#ffffff" },
    external: { background: "#999999", stroke: "#8a8a8a", text: "#ffffff" },
  },
  container: {
    internal: { background: "#438dd5", stroke: "#3c7fc0", text: "#ffffff" },
    external: { background: "#b3b3b3", stroke: "#a6a6a6", text: "#ffffff" },
  },
  component: {
    internal: { background: "#85bbf0", stroke: "#78a8d8", text: "#000000" },
    external: { background: "#cccccc", stroke: "#bfbfbf", text: "#000000" },
  },
};

export const lookOf = (e: Pick<C4Element, "kind" | "external">): Look => LOOKS[e.kind][e.external ? "external" : "internal"];

export const RELATIONSHIP_COLOR = "#707070";

/** The outline of a box drawn where it does not belong, as an error: red, thick and dashed. */
export const MISPLACED_LOOK = { strokeColor: "#e03131", strokeWidth: 4, strokeStyle: "dashed" } as const;

export interface Vec {
  x: number;
  y: number;
}

export interface Box extends Vec {
  width: number;
  height: number;
}

export const center = (b: Box): Vec => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** The smallest box around the boxes, grown by a margin; null for none. */
export function bounds(boxes: Box[], margin = 0): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)) - margin;
  const y = Math.min(...boxes.map((b) => b.y)) - margin;
  const r = Math.max(...boxes.map((b) => b.x + b.width)) + margin;
  const btm = Math.max(...boxes.map((b) => b.y + b.height)) + margin;
  return { x, y, width: r - x, height: btm - y };
}

/**
 * How the drawing around an element makes way when the element grows from `from` to `to`, as when a layer opens in
 * its place: what lies beyond an edge of the element moves as far as that edge did.
 */
export function makeWay(from: Box, to: Box) {
  const right = from.x + from.width;
  const bottom = from.y + from.height;
  const dx = (x: number) => (x >= right ? to.x + to.width - right : x <= from.x ? to.x - from.x : 0);
  const dy = (y: number) => (y >= bottom ? to.y + to.height - bottom : y <= from.y ? to.y - from.y : 0);
  return {
    /** How far a box moves, going by its center. */
    move: (b: Box): Vec => {
      const c = center(b);
      return { x: dx(c.x), y: dy(c.y) };
    },
    /** A box around the element, stretched edge by edge: an enclosing boundary grows with it. */
    stretch: (b: Box): Box => {
      const x = b.x + dx(b.x);
      const y = b.y + dy(b.y);
      return { x, y, width: b.x + b.width + dx(b.x + b.width) - x, height: b.y + b.height + dy(b.y + b.height) - y };
    },
  };
}

/**
 * The way back from `makeWay`: where a box drawn around the grown element `to` goes when the element shrinks back to
 * `from`, as when an element added to a layer is copied one level up. Beyond an edge it moves back as far as the edge
 * did; alongside the element it stays, but no further out than the element's own edge.
 */
export function wayBack(from: Box, to: Box) {
  const axis = (c: number, f0: number, fSize: number, t0: number, tSize: number) => {
    if (c >= t0 + tSize) return c - (t0 + tSize - (f0 + fSize));
    if (c <= t0) return c - (t0 - f0);
    return Math.min(f0 + fSize, Math.max(f0, c));
  };
  return (b: Box): Vec => {
    const c = center(b);
    return {
      x: axis(c.x, from.x, from.width, to.x, to.width) - b.width / 2,
      y: axis(c.y, from.y, from.height, to.y, to.height) - b.height / 2,
    };
  };
}

export type Direction = "up" | "down" | "left" | "right";

/**
 * The box to go to from a place in a direction: the nearest one whose center lies that way, going more by the distance
 * along the direction than across it, so the one straight ahead wins over one off to the side. Undefined for none.
 */
export function nearestIn<B extends Box>(boxes: readonly B[], from: Vec, dir: Direction): B | undefined {
  const [ax, ay] = dir === "left" ? [-1, 0] : dir === "right" ? [1, 0] : dir === "up" ? [0, -1] : [0, 1];
  let best: B | undefined;
  let bestScore = Infinity;
  for (const b of boxes) {
    const c = center(b);
    const along = (c.x - from.x) * ax + (c.y - from.y) * ay;
    const across = Math.abs((c.x - from.x) * ay - (c.y - from.y) * ax);
    // Ahead, within 60 degrees either side of the direction.
    if (along <= 1 || across > along * 1.75) continue;
    const score = along + 2 * across;
    if (score < bestScore) [best, bestScore] = [b, score];
  }
  return best;
}

/** Whether two boxes overlap, or come closer than the gap. */
export const overlaps = (a: Box, b: Box, gap = 0) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/** Where a box goes to keep the gap from an obstacle: the shortest move left, right, up or down. */
export function pushOut(box: Box, obstacle: Box, gap: number): Vec {
  if (!overlaps(box, obstacle, gap)) return { x: box.x, y: box.y };
  const moves: Vec[] = [
    { x: obstacle.x - gap - box.width, y: box.y },
    { x: obstacle.x + obstacle.width + gap, y: box.y },
    { x: box.x, y: obstacle.y - gap - box.height },
    { x: box.x, y: obstacle.y + obstacle.height + gap },
  ];
  const dist = (p: Vec) => Math.abs(p.x - box.x) + Math.abs(p.y - box.y);
  return moves.reduce((a, b) => (dist(b) < dist(a) ? b : a));
}

export const contains = (outer: Box, p: Vec) => p.x >= outer.x && p.x <= outer.x + outer.width && p.y >= outer.y && p.y <= outer.y + outer.height;

export const ELEMENT_WIDTH = 240;
export const MIN_HEIGHT = 150;
export const PADDING = 16;
export const BOUNDARY_PAD = 40; // between a boundary and the elements in it
export const BOUNDARY_LABEL = 56; // room for a boundary's label below the elements in it

/**
 * A boundary fitted to the elements in it: around them with room for its label at the bottom, never smaller than one
 * element or its label. With nothing in it, it keeps its center.
 */
export function fittedBoundary(current: Box, inner: Box[], label?: { width: number }): Box {
  const minWidth = Math.max(ELEMENT_WIDTH + 2 * BOUNDARY_PAD, (label?.width ?? 0) + 2 * BOUNDARY_PAD);
  const minHeight = MIN_HEIGHT + 2 * BOUNDARY_PAD + BOUNDARY_LABEL;
  const around = bounds(inner, BOUNDARY_PAD);
  const base = around ? { ...around, height: around.height + BOUNDARY_LABEL } : current;
  const c = center(base);
  const width = around ? Math.max(minWidth, base.width) : minWidth;
  const height = around ? Math.max(minHeight, base.height) : minHeight;
  // Grown to the least size around its middle, so its elements stay centered in it.
  return { x: c.x - width / 2, y: c.y - height / 2, width, height };
}

/** Size of an element's box around its text: C4 boxes look alike, so at least a fixed size. */
export const boxSize = (text: { width: number; height: number }) => ({
  width: Math.max(ELEMENT_WIDTH, text.width + 2 * PADDING),
  height: Math.max(MIN_HEIGHT, text.height + 2 * PADDING),
});

/** Middle of an arrow, where its label goes: halfway along a straight arrow, else its middle point. */
export function arrowMidpoint(arrow: Vec & { points?: number[][] }): Vec {
  const pts = arrow.points ?? [];
  if (!pts.length) return { x: arrow.x, y: arrow.y };
  const first = pts[0];
  const last = pts[pts.length - 1];
  const [x = 0, y = 0] = pts.length === 2 ? [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2] : pts[Math.floor(pts.length / 2)];
  return { x: arrow.x + x, y: arrow.y + y };
}

/** Space between relationships drawn side by side between the same two elements. */
export const LANE = 36;

/** Offsets across the line between two elements of n relationships between them, centered on the line. */
export const laneOffsets = (n: number, lane = LANE): number[] => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * lane);

/** Where a ray from a point inside the box leaves it. */
export function rayExit(b: Box, p: Vec, dir: Vec): Vec {
  const tx = dir.x > 0 ? (b.x + b.width - p.x) / dir.x : dir.x < 0 ? (b.x - p.x) / dir.x : Infinity;
  const ty = dir.y > 0 ? (b.y + b.height - p.y) / dir.y : dir.y < 0 ? (b.y - p.y) / dir.y : Infinity;
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? { x: p.x + dir.x * t, y: p.y + dir.y * t } : p;
}

/**
 * A relationship's line between two boxes, shifted across the line between their centers by an offset, so that several
 * relationships between the same boxes lie side by side. `normal` is the unit vector the offset goes along; both
 * directions between the same boxes must use the same one. Returns where the line leaves each box and the points inside
 * the boxes it aims at.
 */
export function laneLine(from: Box, to: Box, normal: Vec, offset: number): { start: Vec; end: Vec; aimFrom: Vec; aimTo: Vec } {
  const inside = (b: Box, p: Vec): Vec => ({
    x: Math.min(b.x + b.width * 0.9, Math.max(b.x + b.width * 0.1, p.x)),
    y: Math.min(b.y + b.height * 0.9, Math.max(b.y + b.height * 0.1, p.y)),
  });
  const cf = center(from);
  const ct = center(to);
  const aimFrom = inside(from, { x: cf.x + normal.x * offset, y: cf.y + normal.y * offset });
  const aimTo = inside(to, { x: ct.x + normal.x * offset, y: ct.y + normal.y * offset });
  const dx = aimTo.x - aimFrom.x;
  const dy = aimTo.y - aimFrom.y;
  const len = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / len, y: dy / len };
  return { start: rayExit(from, aimFrom, dir), end: rayExit(to, aimTo, { x: -dir.x, y: -dir.y }), aimFrom, aimTo };
}

/** The unit normal of the line between two points, turned left. */
export function normalOf(a: Vec, b: Vec): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** Where the line from the box's center toward a point leaves the box. */
export function edgePoint(b: Box, toward: Vec): Vec {
  const c = center(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const s = Math.min(dx ? b.width / 2 / Math.abs(dx) : Infinity, dy ? b.height / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}
