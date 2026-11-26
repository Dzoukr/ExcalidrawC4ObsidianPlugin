// The C4 model as stored on Excalidraw elements: pure data, no Obsidian or Excalidraw runtime. The geometry of boxes,
// the shapes of elements and their colors have modules of their own, all to be had from here too.

import { bounds, center } from "./geometry.ts"; // with its extension, for the tests running in Node
import type { Box, Vec } from "./geometry.ts";
import { ELEMENT_WIDTH, MIN_HEIGHT } from "./shapes.ts";
import type { ContainerType } from "./shapes.ts";
import type { Look } from "./looks.ts";

export * from "./geometry.ts";
export * from "./shapes.ts";
export * from "./looks.ts";

/** Key under which C4 data is kept in an element's customData. */
export const KEY = "c4";

export const KINDS = ["person", "system", "container", "component"] as const;
export type C4Kind = (typeof KINDS)[number];

/** A person, software system, container or component: the data of its box. */
export interface C4Element {
  kind: C4Kind;
  name: string;
  type?: ContainerType; // containers only; generic when not set or not known
  icon?: string; // custom containers only: the id of an Obsidian icon drawn in the top left corner of the box
  technology?: string; // containers and components only
  description?: string;
  external?: boolean; // outside the system being described
  id?: string; // the same element in every diagram; the box's own id for elements drawn before ids
  parent?: string; // the system of a container, the container of a component
  metadata?: Record<string, string>; // key: value pairs, not drawn
  note?: string; // Markdown, not drawn: marked on the canvas, shown when the element is selected
  look?: Partial<Look>; // colors of this element, over those of its type
}

/** The data of a relationship arrow. */
export interface C4Relationship {
  relationship: true;
  description: string;
  technology?: string;
  metadata?: Record<string, string>; // key: value pairs, not drawn
  note?: string; // Markdown, not drawn: marked on the canvas, shown when the relationship is selected
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
  theme?: string; // the drawing's colors: a built-in theme or one of the user's; none before the drawing had C4 elements
  pins?: Record<string, Pins>; // by layer: where the ghosts of the levels above were moved to in it by hand
}

/** Where ghosts were moved to by hand in a layer, by the id of the element each is a ghost of. */
export type Pins = Record<string, Vec>;

/** The dashed boundary of a diagram's scope, and its label. */
interface C4Boundary {
  boundary: string; // id of the system or container
}

/**
 * A group of elements in one layer, drawn as a dotted box around them with its name at the bottom left, as the
 * containers of a microservice: no C4 element, only a way of showing what belongs together. It is kept on its box;
 * its label is a part of the box.
 */
export interface C4Group {
  group: string; // id of the group
  name: string;
  parent?: string; // id of the group it is nested in
  members: string[]; // ids of the elements in it, not in the groups nested in it
  look?: Partial<Look>; // colors of this group, over those of groups: its outline and its label
}

/** The C4 data kept in an element's customData, as data of some shape: each reader checks the fields it goes by. */
const c4Of = <T>(customData: Record<string, unknown> | undefined): Partial<T> | undefined => customData?.[KEY] as Partial<T> | undefined;

/** The data of a group's box, its members only the ids among them; null for any other element. */
export function groupData(customData: Record<string, unknown> | undefined): C4Group | null {
  const d = c4Of<C4Group>(customData);
  if (typeof d?.group !== "string" || typeof d.name !== "string") return null;
  return { ...(d as C4Group), members: Array.isArray(d.members) ? d.members.filter((m): m is string => typeof m === "string") : [] };
}

/** Metadata from the rows of a form: keys trimmed, rows without a key left out, the last of the same key kept. */
export function cleanMetadata(rows: readonly (readonly [string, string])[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of rows) if (key.trim()) out[key.trim()] = value.trim();
  return Object.keys(out).length ? out : undefined;
}

/** A note from a form: none when it is only white space, else as typed, without white space around it. */
export function cleanNote(note: string | undefined): string | undefined {
  return note?.trim() || undefined;
}

/** The note of an element or relationship, when it has one. */
export const noteOf = (data: { note?: unknown }): string | undefined => (typeof data.note === "string" ? cleanNote(data.note) : undefined);

const isKind = (k: unknown): k is C4Kind => KINDS.includes(k as C4Kind);

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

/** The data of an element's box; null for any other element. */
export function elementData(customData: Record<string, unknown> | undefined): C4Element | null {
  const d = c4Of<C4Element>(customData);
  return d && isKind(d.kind) && typeof d.name === "string" ? (d as C4Element) : null;
}

/** The data of a relationship arrow; null for any other element. */
export function relationshipData(customData: Record<string, unknown> | undefined): C4Relationship | null {
  const d = c4Of<C4Relationship>(customData);
  return d?.relationship === true && typeof d.description === "string" ? (d as C4Relationship) : null;
}

/** A dimmed copy of an element of a level above, shown around the layer on the canvas. */
export const isGhost = (customData: Record<string, unknown> | undefined): boolean => c4Of<{ ghost: unknown }>(customData)?.ghost === true;

/** The layers kept on the element holding them; null for any other element. */
export function storeData(customData: Record<string, unknown> | undefined): C4Store | null {
  const d = c4Of<{ store: Partial<C4Store> }>(customData)?.store;
  if (!d || typeof d.current !== "string" || !d.views || typeof d.views !== "object" || !d.hidden || typeof d.hidden !== "object") return null;
  return d as C4Store;
}

/** The boundary a boundary rectangle or its label belongs to; null for any other element. */
export function boundaryData(customData: Record<string, unknown> | undefined): C4Boundary | null {
  const d = c4Of<C4Boundary>(customData);
  return typeof d?.boundary === "string" ? (d as C4Boundary) : null;
}

/** The colors a part of a shape was drawn in, as a string; null for an element that keeps none. */
export const lookSignatureOf = (customData: Record<string, unknown> | undefined): string | null => {
  const v = c4Of<{ look: unknown }>(customData)?.look;
  return typeof v === "string" ? v : null;
};

/** The id of the box a part of a shape, or the label of a group, belongs to; null for an element that is no part. */
export const partOf = (customData: Record<string, unknown> | undefined): string | null => {
  const p = c4Of<{ part: unknown }>(customData)?.part;
  return typeof p === "string" ? p : null;
};

/** The version of the shapes a part was drawn by: 1 for a part drawn before the shapes had versions. */
export const shapeVersionOf = (customData: Record<string, unknown> | undefined): number => {
  const v = c4Of<{ shape: unknown }>(customData)?.shape;
  return typeof v === "number" ? v : 1;
};

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
const WRAP = 24;
export const FONT_SIZE = 16; // the text of a box
export const NAME_FONT_SIZE = 20; // the name of an element, larger than the rest of the text of its box
const NAME_WRAP = Math.floor((WRAP * FONT_SIZE) / NAME_FONT_SIZE); // as wide as the rest of the text
/** A line of the text of a box holding room for the name: not empty, so that nothing trims it away, yet showing nothing. */
export const ROOM_LINE = "​";
const RELATIONSHIP_WRAP = 28;

/** The name of an element, wrapped: drawn larger than the rest of the text of its box, on its own. */
export const nameText = (e: Pick<C4Element, "name">): string => wrap(e.name.trim() || "Unnamed", NAME_WRAP).join("\n");

/** How many lines of the text of a box the name takes the room of, at the top. */
export const nameRoom = (e: Pick<C4Element, "name">): number => Math.ceil((nameText(e).split("\n").length * NAME_FONT_SIZE) / FONT_SIZE);

/**
 * The text of an element's box, as in C4 diagrams: room for the name, which is drawn over it larger, then
 * [kind: technology] and the description.
 */
export function elementLabel(e: C4Element, wrapAt = WRAP): string {
  const tech = hasTechnology(e.kind) ? e.technology?.trim() : "";
  const tag = `[${kindTitle(e.kind, e.external)}${tech ? `: ${tech}` : ""}]`;
  const lines = [...Array<string>(nameRoom(e)).fill(ROOM_LINE), tag];
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

/** Width of the outlines of boxes and of the parts of their shapes: as in the C4 model's diagrams, about 1% of a box's width. */
export const STROKE_WIDTH = 3;

/** Width of relationship arrows and boundaries, thinner than the outlines of boxes as in the C4 model's diagrams. */
export const LINE_WIDTH = 2;

export const RELATIONSHIP_COLOR = "#707070";

/** The outline of a box drawn where it does not belong, as an error: red, thick and dashed. */
export const MISPLACED_LOOK = { strokeColor: "#e03131", strokeWidth: 4, strokeStyle: "dashed" } as const;

export const BOUNDARY_PAD = 40; // between a boundary and the elements in it
export const BOUNDARY_LABEL = 56; // room for a boundary's label below the elements in it
export const GROUP_PAD = 24; // between a group and the elements in it
export const GROUP_LABEL = 32; // room for a group's label below the elements in it

/**
 * A group fitted to what is in it: around it with room for its label at the bottom, at least as wide as the label.
 * With nothing in it, it stays as it is.
 */
export function fittedGroup(current: Box, inner: Box[], label?: { width: number }): Box {
  const around = bounds(inner, GROUP_PAD);
  if (!around) return { x: current.x, y: current.y, width: current.width, height: current.height };
  const width = Math.max(around.width, (label?.width ?? 0) + GROUP_PAD);
  return { x: around.x, y: around.y, width, height: around.height + GROUP_LABEL };
}

/** Where a group's label goes: at its bottom left corner, as a boundary's. */
export const groupLabelAt = (group: Box, label: { height: number }): Vec => ({
  x: group.x + GROUP_PAD / 2,
  y: group.y + group.height - label.height - GROUP_PAD / 3,
});

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
