// The C4 model as stored on Excalidraw elements: pure data and geometry, no Obsidian or Excalidraw runtime.

/** Key under which C4 data is kept in an element's customData. */
export const KEY = "c4";

export const KINDS = ["person", "system", "container", "component"] as const;
export type C4Kind = (typeof KINDS)[number];

/** What a container is, which gives its box its shape. */
export const CONTAINER_TYPES = ["generic", "server", "spa", "database", "storage", "directory"] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

export const CONTAINER_TYPE_TITLES: Record<ContainerType, string> = {
  generic: "Generic",
  server: "Server-side app",
  spa: "Single-page app",
  database: "Database",
  storage: "Storage",
  directory: "Directory",
};

export const isContainerType = (t: unknown): t is ContainerType => CONTAINER_TYPES.includes(t as ContainerType);

/** A person, software system, container or component: the data of its box. */
export interface C4Element {
  kind: C4Kind;
  name: string;
  type?: ContainerType; // containers only; generic when not set or not known
  technology?: string; // containers and components only
  description?: string;
  external?: boolean; // outside the system being described
  id?: string; // the same element in every diagram; the box's own id for elements drawn before ids
  parent?: string; // the system of a container, the container of a component
  metadata?: Record<string, string>; // key: value pairs, not drawn
  look?: Partial<Look>; // colors of this element, over those of its type
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
  theme?: string; // the drawing's colors: a built-in theme or one of the user's; none before the drawing had C4 elements
}

/** The dashed boundary of a diagram's scope, and its label. */
export interface C4Boundary {
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

export function groupData(customData: Record<string, unknown> | undefined): C4Group | null {
  const d = customData?.[KEY] as Partial<C4Group> | undefined;
  if (typeof d?.group !== "string" || typeof d.name !== "string") return null;
  return { ...(d as C4Group), members: Array.isArray(d.members) ? d.members.filter((m): m is string => typeof m === "string") : [] };
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
export const FONT_SIZE = 16; // the text of a box
export const NAME_FONT_SIZE = 20; // the name of an element, larger than the rest of the text of its box
const NAME_WRAP = Math.floor((WRAP * FONT_SIZE) / NAME_FONT_SIZE); // as wide as the rest of the text
/** A line of the text of a box holding room for the name: not empty, so that nothing trims it away, yet showing nothing. */
export const ROOM_LINE = "\u200b";
export const RELATIONSHIP_WRAP = 28;

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

/** The colors of an element: its outline, its fill and its text. */
export interface Look {
  background: string;
  stroke: string;
  text: string;
}

export const LOOK_PARTS = ["stroke", "background", "text"] as const;
export const LOOK_PART_TITLES: Record<keyof Look, string> = { stroke: "Outline", background: "Fill", text: "Text" };

/** The types of element with colors of their own: the kinds, each type of container, all external elements, and groups. */
export const LOOK_KEYS = [
  "person", "system", ...CONTAINER_TYPES.map((t) => `container-${t}` as const), "component", "external", "group",
] as const;
export type LookKey = (typeof LOOK_KEYS)[number];

export const LOOK_KEY_TITLES: Record<LookKey, string> = {
  person: "Person",
  system: "Software system",
  ...(Object.fromEntries(CONTAINER_TYPES.map((t) => [`container-${t}`, `Container: ${CONTAINER_TYPE_TITLES[t]}`])) as Record<`container-${ContainerType}`, string>),
  component: "Component",
  external: "External element",
  group: "Group",
};

/** The colors a group is drawn in: its outline and its label. It has no fill, so as not to hide what is behind it. */
export const GROUP_LOOK_PARTS = ["stroke", "text"] as const satisfies readonly (keyof Look)[];

/** The colors a type of element is drawn in. */
export const lookPartsOf = (key: LookKey): readonly (keyof Look)[] => (key === "group" ? GROUP_LOOK_PARTS : LOOK_PARTS);

// As in the C4 model's own diagrams: an outline and text in one color on a white fill, green for people, grey for external elements.
const INTERNAL: Look = { background: "#ffffff", stroke: "#1168bd", text: "#1168bd" };
const PERSON: Look = { background: "#ffffff", stroke: "#297e06", text: "#297e06" };
const EXTERNAL: Look = { background: "#ffffff", stroke: "#6b6b6b", text: "#6b6b6b" };
// Dark grey as a boundary; groups have no fill, the one here is only there for a theme to have every color.
const GROUP: Look = { background: "#ffffff", stroke: "#444444", text: "#444444" };
export const DEFAULT_LOOKS: Record<LookKey, Look> = Object.fromEntries(
  LOOK_KEYS.map((k) => [k, k === "external" ? EXTERNAL : k === "person" ? PERSON : k === "group" ? GROUP : INTERNAL]),
) as Record<LookKey, Look>;

let looks: Record<LookKey, Look> = DEFAULT_LOOKS;

const isColor = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** The colors of a type from settings: the colors saved for it, with its defaults for any missing or not a color. */
export function lookFrom(saved: Partial<Look> | undefined, key: LookKey): Look {
  const out = { ...DEFAULT_LOOKS[key] };
  for (const p of LOOK_PARTS) if (isColor(saved?.[p])) out[p] = saved[p];
  return out;
}

/** Sets the colors of the types of element: those of the theme of the drawing being drawn. */
export function useColors(colors: Record<LookKey, Look>) {
  looks = colors;
}

/** The type of element whose colors an element has. */
export function lookKeyOf(e: Pick<C4Element, "kind" | "type" | "external">): LookKey {
  if (e.external) return "external";
  if (e.kind === "container") return `container-${isContainerType(e.type) ? e.type : "generic"}`;
  return e.kind;
}

/** The colors of an element's type. */
export const typeLookOf = (e: Pick<C4Element, "kind" | "type" | "external">): Look => looks[lookKeyOf(e)];

/** The colors of an element: its own, where it has them, else those of its type. */
export function lookOf(e: Pick<C4Element, "kind" | "type" | "external" | "look">): Look {
  const out = { ...typeLookOf(e) };
  for (const p of LOOK_PARTS) if (isColor(e.look?.[p])) out[p] = e.look[p];
  return out;
}

/** An element's own colors: only those that differ from its type's, none when all are the same. */
export function ownLook(e: Pick<C4Element, "kind" | "type" | "external">, look: Partial<Look>): Partial<Look> | undefined {
  const type = typeLookOf(e);
  const out: Partial<Look> = {};
  for (const p of LOOK_PARTS) if (isColor(look[p]) && look[p].toLowerCase() !== type[p].toLowerCase()) out[p] = look[p];
  return Object.keys(out).length ? out : undefined;
}

/** The colors of a group: its own, where it has them, else those of groups in the drawing's theme. */
export function groupLookOf(g: Pick<C4Group, "look">): Look {
  const out = { ...looks.group };
  for (const p of GROUP_LOOK_PARTS) if (isColor(g.look?.[p])) out[p] = g.look[p];
  return out;
}

/** A group's own colors: only those that differ from the colors of groups, none when all are the same. */
export function ownGroupLook(look: Partial<Look>): Partial<Look> | undefined {
  const out: Partial<Look> = {};
  for (const p of GROUP_LOOK_PARTS) if (isColor(look[p]) && look[p].toLowerCase() !== looks.group[p].toLowerCase()) out[p] = look[p];
  return Object.keys(out).length ? out : undefined;
}

/** The colors of a look as one string, kept on the parts of a shape to tell when they need drawing again. */
export const lookSignature = (look: Look): string => LOOK_PARTS.map((p) => look[p].toLowerCase()).join(" ");

/** The colors a part of a shape was drawn in, as a string. */
export const lookSignatureOf = (customData: Record<string, unknown> | undefined): string | null => {
  const v = (customData?.[KEY] as { look?: unknown } | undefined)?.look;
  return typeof v === "string" ? v : null;
};

/** Width of the outlines of boxes and of the parts of their shapes: as in the C4 model's diagrams, about 1% of a box's width. */
export const STROKE_WIDTH = 3;

/** Width of relationship arrows and boundaries, thinner than the outlines of boxes as in the C4 model's diagrams. */
export const LINE_WIDTH = 2;

/**
 * The shape an element is drawn as, after the key of the C4 model's diagrams. The box carrying the data and the text is
 * a rectangle, as Excalidraw only puts text in a rectangle, ellipse or diamond; the other shapes are drawn by parts
 * behind it, grouped with it.
 */
export type Shape = "rounded" | "person" | "component" | "terminal" | "cylinder" | "bucket" | "folder" | "browser";

const CONTAINER_SHAPES: Record<ContainerType, Shape> = {
  generic: "rounded",
  storage: "bucket",
  directory: "folder",
  database: "cylinder",
  server: "terminal",
  spa: "browser",
};

/** The shape of an element; only containers have a type, which picks theirs. */
export function shapeOf(e: Pick<C4Element, "kind" | "type">): Shape {
  if (e.kind === "person") return "person";
  if (e.kind === "component") return "component";
  if (e.kind === "container") return CONTAINER_SHAPES[isContainerType(e.type) ? e.type : "generic"];
  return "rounded";
}

export type Roundness = { type: number; value?: number } | null;

const RADIUS = 12; // corners of a rounded box
const SMALL_RADIUS = 6; // corners of the boxes making up the other shapes
const PERSON_RADIUS = 48; // corners of the body of a person, rounder than Excalidraw rounds a rectangle

/** Rounded corners of a radius, as Excalidraw draws them. */
export const corners = (value: number): Roundness => ({ type: 3, value });

/** How the box itself is drawn: the outline of a rounded box, else invisible, with its parts drawing the shape behind it. */
export function boxStyle(e: Pick<C4Element, "kind" | "type" | "external" | "look">): { roundness: Roundness; strokeColor: string; backgroundColor: string } {
  const look = lookOf(e);
  const shape = shapeOf(e);
  if (shape === "rounded") return { roundness: corners(RADIUS), strokeColor: look.stroke, backgroundColor: look.background };
  return { roundness: null, strokeColor: "transparent", backgroundColor: "transparent" };
}

/** A color of an element: its outline, its text (for the details of its shape), its fill, or none. */
export type Ink = "outline" | "detail" | "body" | "none";

/**
 * A part of a shape drawn behind its box: a rectangle (with rounded corners of a radius, if given) or ellipse in a box,
 * or a line through points, closed and filled when it ends where it starts.
 */
export interface Part {
  type: "rectangle" | "ellipse" | "line";
  box?: Box;
  points?: Vec[];
  round?: number;
  stroke: Ink;
  fill: Ink;
}

export const RIM = 14; // half the height of the top of a cylinder or bucket
export const BAR = 22; // the bar at the top of a browser window
export const TAB = 14; // how far the tab of a folder stands up
export const HEAD = 104; // the head of a person
export const PROMPT = 28; // room for the prompt in the corner of a terminal

/** Points along an ellipse from one angle to another, going clockwise on the screen. */
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, n = 16): Vec[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / n;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

/** The closed outline of a box with round corners of a radius, as large as the box lets them be. */
function roundedOutline(b: Box, radius: number): Vec[] {
  const r = Math.min(radius, b.width / 2, b.height / 2);
  const [l, t, rt, bt] = [b.x + r, b.y + r, b.x + b.width - r, b.y + b.height - r];
  const q = Math.PI / 2;
  const out = [...arc(l, t, r, r, 2 * q, 3 * q, 8), ...arc(rt, t, r, r, 3 * q, 4 * q, 8), ...arc(rt, bt, r, r, 0, q, 8), ...arc(l, bt, r, r, q, 2 * q, 8)];
  return [...out, out[0]];
}

/** A cylinder, or with its sides drawn in at the bottom a bucket: the outline, and the front of its top. */
function vessel(b: Box, inset: number, bottomRim: number): Part[] {
  const cx = b.x + b.width / 2;
  const top = arc(cx, b.y + RIM, b.width / 2, RIM, Math.PI, 2 * Math.PI); // left to right over the top
  const bottom = arc(cx, b.y + b.height - bottomRim, b.width / 2 - inset, bottomRim, 0, Math.PI); // right to left under it
  return [
    { type: "line", points: [...top, ...bottom, top[0]], stroke: "outline", fill: "body" },
    { type: "line", points: arc(cx, b.y + RIM, b.width / 2, RIM, 0, Math.PI), stroke: "outline", fill: "none" },
  ];
}

/** The parts drawing a shape around a box, back to front. */
export function shapeParts(shape: Shape, b: Box): Part[] {
  const { x, y, width: w, height: h } = b;
  switch (shape) {
    case "rounded":
      return [];
    case "person":
      // The head sits in front of the body, over its top.
      return [
        { type: "line", points: roundedOutline(b, PERSON_RADIUS), stroke: "outline", fill: "body" },
        { type: "ellipse", box: { x: x + w / 2 - HEAD / 2, y: y - HEAD * 0.9, width: HEAD, height: HEAD }, stroke: "outline", fill: "body" },
      ];
    case "component": {
      // The two small boxes of the UML symbol stand out of the left side.
      const sw = Math.min(w * 0.2, 48);
      const sh = 18;
      const small = (i: number): Part => ({
        type: "rectangle", box: { x: x - sw / 2, y: y + 14 + i * (sh + 8), width: sw, height: sh }, round: 4, stroke: "outline", fill: "body",
      });
      return [{ type: "rectangle", box: b, round: SMALL_RADIUS, stroke: "outline", fill: "body" }, small(0), small(1)];
    }
    case "terminal":
      // A command prompt, >_, in the top left corner.
      return [
        { type: "rectangle", box: b, round: RADIUS, stroke: "outline", fill: "body" },
        { type: "line", points: [{ x: x + 12, y: y + 10 }, { x: x + 22, y: y + 17 }, { x: x + 12, y: y + 24 }], stroke: "detail", fill: "none" },
        { type: "line", points: [{ x: x + 26, y: y + 25 }, { x: x + 38, y: y + 25 }], stroke: "detail", fill: "none" },
      ];
    case "cylinder":
      return vessel(b, 0, RIM / 2);
    case "bucket":
      return vessel(b, w * 0.09, RIM * 0.6);
    case "folder":
      // The tab stands up behind the top left corner of the folder.
      return [
        { type: "rectangle", box: { x: x + 8, y, width: Math.min(w * 0.35, 120), height: 2 * TAB }, round: SMALL_RADIUS, stroke: "outline", fill: "body" },
        { type: "rectangle", box: { x, y: y + TAB, width: w, height: h - TAB }, round: SMALL_RADIUS, stroke: "outline", fill: "body" },
      ];
    case "browser": {
      // A window with a bar along the top in the text color, which shows on the fill, holding three dots and an address field.
      const dot = 8;
      const field = x + 8 + 3 * (dot + 5) + 4;
      return [
        { type: "rectangle", box: b, stroke: "outline", fill: "body" },
        { type: "rectangle", box: { x, y, width: w, height: BAR }, stroke: "outline", fill: "detail" },
        ...[0, 1, 2].map((i): Part => ({
          type: "ellipse", box: { x: x + 8 + i * (dot + 5), y: y + BAR / 2 - dot / 2, width: dot, height: dot }, stroke: "body", fill: "body",
        })),
        { type: "rectangle", box: { x: field, y: y + BAR / 2 - 5, width: x + w - 8 - field, height: 10 }, round: 5, stroke: "body", fill: "body" },
      ];
    }
  }
}

/** Everything a shape is drawn with, the outline of a rounded box included, as for a picture of it. */
export function shapeDrawing(shape: Shape, b: Box): Part[] {
  return shape === "rounded" ? [{ type: "rectangle", box: b, round: RADIUS, stroke: "outline", fill: "body" }] : shapeParts(shape, b);
}

/** Room a shape takes inside its box besides the text: the top of a cylinder, the bar of a browser window. */
function shapeRoom(shape: Shape): number {
  if (shape === "cylinder" || shape === "bucket") return 2 * RIM;
  if (shape === "browser") return BAR;
  if (shape === "folder") return TAB;
  if (shape === "terminal") return PROMPT;
  return 0;
}

/** Key under which a part of a shape keeps the id of its box. */
export const partOf = (customData: Record<string, unknown> | undefined): string | null => {
  const p = (customData?.[KEY] as { part?: unknown } | undefined)?.part;
  return typeof p === "string" ? p : null;
};

/** Version of the shapes, kept on their parts: parts drawn by an earlier one are drawn again. */
export const SHAPE_VERSION = 8;

export const shapeVersionOf = (customData: Record<string, unknown> | undefined): number => {
  const v = (customData?.[KEY] as { shape?: unknown } | undefined)?.shape;
  return typeof v === "number" ? v : 1;
};

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

/**
 * Size of an element's box around its text: C4 boxes look alike, so at least a fixed size. With room for its shape,
 * which the text is centered in.
 */
export const boxSize = (text: { width: number; height: number }, shape: Shape = "rounded") => {
  const room = textRoom(text, shape);
  return { width: Math.max(ELEMENT_WIDTH, room.width), height: Math.max(MIN_HEIGHT, room.height) };
};

/** The least size of an element's box: room for its text and its shape, as for a box resized by hand. */
export const textRoom = (text: { width: number; height: number }, shape: Shape = "rounded") => ({
  width: text.width + 2 * PADDING,
  height: text.height + 2 * PADDING + 2 * shapeRoom(shape),
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
