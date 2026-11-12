// The levels above the layer on the canvas, shown around it as dimmed, locked copies so the whole picture stays in view.
// Pure: works on plain element data, no Obsidian or Excalidraw runtime.

import type { El } from "./excalidraw";
import { BOUNDARY_LABEL, BOUNDARY_PAD, CONTEXT, KEY, boundaryData, bounds, center, isGhost, laneLine, laneOffsets, makeWay, normalOf, relationshipData } from "./model.ts";
import type { Box, Vec } from "./model.ts";
import type { DiagramId, Scene } from "./layers.ts";

const PREFIX = "c4g-";
const OPACITY = 0.35;
// Text stays readable on the dimmed boxes: dark and less dimmed.
const TEXT_OPACITY = 0.6;
const TEXT_COLOR = "#1e1e1e";

export const ghostId = (id: string) => PREFIX + id;

/**
 * The id of a ghost's text: 8 characters at most, the same every time. The Obsidian plugin gives a text with a longer id
 * a new one on saving, which would part it from its box when the ghosts are made again.
 */
export function ghostTextId(id: string): string {
  let h = 0x811c9dc5; // FNV-1a
  for (const ch of PREFIX + id) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return "g" + (h >>> 0).toString(36).padStart(7, "0");
}

/** The id of the ghost of an element. */
const idOf = (e: El) => (e.type === "text" ? ghostTextId(e.id) : ghostId(e.id));

/** The id of the element a ghost is a copy of. */
export const ghostSource = (id: string): string | null => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null);

/** A color mixed with white, keeping a share of it; null for a color that is no hex color. */
export function fade(color: string, share: number): string | null {
  if (color === "transparent") return color;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const mix = [0, 2, 4].map((i) => Math.round(255 - (255 - parseInt(hex.slice(i, i + 2), 16)) * share));
  return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * How a ghost is dimmed. Text is made dark and less dimmed, to stay readable. Shapes get their colors mixed with white
 * rather than made see-through, so a shape still hides what is behind it, such as the head of a person the top of its
 * body; colors that cannot be mixed are made see-through.
 */
function dim(e: El): Partial<El> {
  if (e.type === "text") return { opacity: Math.round((e.opacity ?? 100) * TEXT_OPACITY), strokeColor: TEXT_COLOR };
  const strokeColor = fade(e.strokeColor, OPACITY);
  const backgroundColor = fade(e.backgroundColor, OPACITY);
  if (strokeColor === null || backgroundColor === null) return { opacity: Math.round((e.opacity ?? 100) * OPACITY) };
  return { strokeColor, backgroundColor };
}

/** A ghost of an element: the same look, dimmed and locked, unbound, and no C4 element any more. */
function ghost(e: El, p: Partial<El>): El {
  const g: El & { index?: unknown } = {
    ...e,
    id: idOf(e),
    locked: true,
    ...dim(e),
    customData: { [KEY]: { ghost: true } },
    groupIds: (e.groupIds ?? []).map(ghostId),
    containerId: e.containerId ? ghostId(e.containerId) : null,
    boundElements: null,
    startBinding: null,
    endBinding: null,
    link: null,
    ...p,
  };
  delete g.index; // Excalidraw gives ghosts their own place in the z-order
  return g;
}

/** A boundary grown to hold a box, with room for its label below it. */
function grow(b: Box, around: Box | null): Box {
  if (!around) return b;
  const x = Math.min(b.x, around.x);
  const y = Math.min(b.y, around.y);
  const r = Math.max(b.x + b.width, around.x + around.width);
  const btm = Math.max(b.y + b.height, around.y + around.height + BOUNDARY_LABEL);
  return { x, y, width: r - x, height: btm - y };
}

const textOf = (scene: Scene, e: El): El | undefined => {
  const ref = e.boundElements?.find((b) => b.type === "text");
  return ref ? scene.byId.get(ref.id) : undefined;
};

/** A ghost of an element moved by an offset, with the parts of its shape behind it, its text, and the bold name over that. */
function moved(scene: Scene, e: El, d: Vec): El[] {
  const text = textOf(scene, e);
  const parts = scene.parts(e.id).map((p) => ghost(p, { x: p.x + d.x, y: p.y + d.y }));
  const behind = parts.filter((p) => p.type !== "text");
  const over = parts.filter((p) => p.type === "text");
  const g = ghost(e, { x: e.x + d.x, y: e.y + d.y, boundElements: text ? [{ type: "text", id: ghostTextId(text.id) }] : null });
  return text ? [...behind, g, ghost(text, { x: text.x + d.x, y: text.y + d.y }), ...over] : [...behind, g, ...over];
}

/**
 * The ghosts of every level above the layer on the canvas. Each level makes way around the element the level below
 * opens in, as far as that level reaches; an element drawn in a level below is not repeated. Relationships of the
 * levels above are drawn between wherever their ends are shown.
 */
export function ghostsFor(scene: Scene, current: DiagramId): El[] {
  const v = scene.view(current);
  let opened: Box | undefined = v ? scene.boundary(current).rect : undefined;
  if (!v || !opened) return [];
  // Where each element is shown, by its id.
  const shown = new Map<string, Box>(scene.boxes(current).map((b) => [scene.modelId(b)!, b]));
  const out: El[] = [];
  let scope = v.scope;
  for (let guard = 0; guard < 10; guard++) {
    const up = scene.parentLayer(scope);
    const scopeBox = scene.boxIn(scope, up);
    if (!scopeBox || !opened) break;
    const way = makeWay(scopeBox, opened);
    const handled = new Set<string>([scopeBox.id]);
    const here = new Map<string, Box>();

    // Boxes not shown yet, out of the way.
    for (const b of scene.boxes(up)) {
      const text = textOf(scene, b);
      if (text) handled.add(text.id);
      for (const p of scene.parts(b.id)) handled.add(p.id);
      handled.add(b.id);
      const id = scene.modelId(b)!;
      if (id === scope || shown.has(id)) continue;
      const d = way.move(b);
      out.push(...moved(scene, b, d));
      here.set(id, { x: b.x + d.x, y: b.y + d.y, width: b.width, height: b.height });
    }
    for (const [id, b] of here) shown.set(id, b);

    // The boundary of this level grows around the level opened in it, and further around its elements shown below,
    // as a boundary fits the elements in it.
    const { rect, label } = scene.boundary(up);
    let next: Box | undefined;
    if (rect) {
      const inner = [...shown].filter(([id]) => id !== up && scene.within(id, up)).map(([, b]) => b);
      next = grow(way.stretch(rect), bounds([opened, ...inner], BOUNDARY_PAD));
      out.push(ghost(rect, next));
      handled.add(rect.id);
      if (label) {
        // Its label keeps to the bottom left corner.
        out.push(ghost(label, { x: label.x + next.x - rect.x, y: label.y + next.y + next.height - rect.y - rect.height }));
        handled.add(label.id);
      }
    }

    // Relationships between where their ends are shown, side by side as on the canvas; one carried down to this
    // level's boundary meets the boundary where it is shown now.
    const BOUNDARY = "#boundary"; // no element id has a #
    const endOf = (id: string | undefined): string | undefined => {
      const e = id ? scene.byId.get(id) : undefined;
      if (!e) return undefined;
      return rect && e.id === rect.id ? BOUNDARY : scene.modelId(e) ?? undefined;
    };
    const at = (end: string) => (end === BOUNDARY ? next : shown.get(end));
    const pairs = new Map<string, { arrow: El; from: string; to: string }[]>();
    for (const arrow of scene.elementsIn(up)) {
      if (arrow.containerId || !relationshipData(arrow.customData)) continue;
      handled.add(arrow.id);
      const text = textOf(scene, arrow);
      if (text) handled.add(text.id);
      const from = endOf(arrow.startBinding?.elementId);
      const to = endOf(arrow.endBinding?.elementId);
      if (!from || !to || from === scope || to === scope || !at(from) || !at(to)) continue;
      const key = [from, to].sort().join(">");
      pairs.set(key, [...(pairs.get(key) ?? []), { arrow, from, to }]);
    }
    for (const [key, list] of pairs) {
      const [first, second] = key.split(">").map((end) => at(end)!);
      const normal = normalOf(center(first), center(second));
      const offsets = laneOffsets(list.length);
      list.forEach(({ arrow, from, to }, i) => {
        const a = at(from)!;
        const b = at(to)!;
        const { start, end } = laneLine(a, b, normal, offsets[i]);
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const text = textOf(scene, arrow);
        out.push(ghost(arrow, {
          x: start.x, y: start.y, points: [[0, 0], [dx, dy]], width: Math.abs(dx), height: Math.abs(dy),
          boundElements: text ? [{ type: "text", id: ghostTextId(text.id) }] : null,
        }));
        if (text) out.push(ghost(text, { x: start.x + dx / 2 - text.width / 2, y: start.y + dy / 2 - text.height / 2 }));
      });
    }

    // Everything else drawn on this level, out of the way like the boxes.
    for (const e of scene.elementsIn(up)) {
      if (handled.has(e.id) || e.containerId || isGhost(e.customData) || boundaryData(e.customData) || relationshipData(e.customData)) continue;
      if (!e.type || e.opacity === 0) continue;
      out.push(...moved(scene, e, way.move(e)));
    }

    if (up === CONTEXT) break;
    scope = up;
    opened = next;
  }
  return out;
}
