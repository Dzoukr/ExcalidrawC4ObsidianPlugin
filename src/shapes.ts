// The shapes C4 elements are drawn as, after the key of the C4 model's diagrams: which shape an element has, the parts
// drawing it around its box, and the room it leaves the text of the box. Pure: no Obsidian or Excalidraw runtime.

import type { Box, Vec } from "./geometry.ts"; // with its extension, for the tests running in Node
import type { C4Element } from "./model.ts";

/** What a container is, which gives its box its shape. */
export const CONTAINER_TYPES = [
  "generic", "server", "web", "mobile", "desktop", "function", "job", "queue", "database", "storage", "directory",
  "custom",
] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

export const CONTAINER_TYPE_TITLES: Record<ContainerType, string> = {
  generic: "Generic",
  server: "Server app",
  web: "Web app",
  mobile: "Mobile app",
  desktop: "Desktop app",
  function: "Function",
  job: "Job",
  queue: "Message queue",
  database: "Database",
  storage: "Storage",
  directory: "Directory",
  custom: "Custom",
};

export const isContainerType = (t: unknown): t is ContainerType => CONTAINER_TYPES.includes(t as ContainerType);

/**
 * The shape an element is drawn as, after the key of the C4 model's diagrams. The box carrying the data and the text is
 * a rectangle, as Excalidraw only puts text in a rectangle, ellipse or diamond; the other shapes are drawn by parts
 * behind it, grouped with it.
 */
export type Shape =
  | "rounded" | "person" | "component" | "terminal" | "cylinder" | "bucket" | "folder" | "browser" | "phone" | "monitor" | "lambda" | "clock"
  | "pipe" | "icon";

const CONTAINER_SHAPES: Record<ContainerType, Shape> = {
  generic: "rounded",
  storage: "bucket",
  directory: "folder",
  database: "cylinder",
  server: "terminal",
  web: "browser",
  mobile: "phone",
  desktop: "monitor",
  function: "lambda",
  job: "clock",
  queue: "pipe",
  custom: "rounded", // with an icon, "icon"
};

/** The shape of an element; only containers have a type, which picks theirs, and a custom one may have an icon. */
export function shapeOf(e: Pick<C4Element, "kind" | "type" | "icon">): Shape {
  if (e.kind === "person") return "person";
  if (e.kind === "component") return "component";
  if (e.kind !== "container") return "rounded";
  const type = isContainerType(e.type) ? e.type : "generic";
  return type === "custom" && e.icon ? "icon" : CONTAINER_SHAPES[type];
}

/** The icon of an element, which only a custom container has. */
export const iconOf = (e: Pick<C4Element, "kind" | "type" | "icon">): string | undefined => (shapeOf(e) === "icon" ? e.icon : undefined);

/** The corners of a rectangle as Excalidraw keeps them: none for sharp ones. */
export type Roundness = { type: number; value?: number } | null;

export const RADIUS = 12; // corners of a rounded box
const SMALL_RADIUS = 6; // corners of the boxes making up the other shapes
const PERSON_RADIUS = 48; // corners of the body of a person, rounder than Excalidraw rounds a rectangle

/** Rounded corners of a radius, as Excalidraw draws them. */
export const corners = (value: number): Roundness => ({ type: 3, value });

/** A color of an element: its outline, its text (for the details of its shape), its fill, or none. */
export type Ink = "outline" | "detail" | "body" | "none";

/**
 * A part of a shape drawn behind its box: a rectangle (with rounded corners of a radius, if given) or ellipse in a box,
 * or a line through points, closed and filled when it ends where it starts. A fine part, a line of an icon, is drawn
 * thinner than the outlines and never sketchy, so that the icon stays clear.
 */
export interface Part {
  type: "rectangle" | "ellipse" | "line";
  box?: Box;
  points?: Vec[];
  round?: number;
  stroke: Ink;
  fill: Ink;
  fine?: boolean;
}

const RIM = 14; // half the height of the top of a cylinder or bucket
const BAR = 22; // the bar at the top of a browser window
const TAB = 14; // how far the tab of a folder stands up
const HEAD = 104; // the head of a person
// Room for the prompt in the corner of a terminal, the lambda of a function, the clock of a job, the icon of a custom container.
const PROMPT = 28;
const BEZEL = 22; // the frame of a phone lying on its side, left and right of its screen
const STAND = 24; // the stand under a monitor
const ICON = 22; // the square an icon is drawn in, in the top left corner, as a lambda or a clock

/** A four-pointed star, in a square of side 1: the icon pictured for a custom container, which can have any. */
export const CUSTOM_PICTURE: Vec[][] = [[
  { x: 0.5, y: 0.1 }, { x: 0.6, y: 0.4 }, { x: 0.9, y: 0.5 }, { x: 0.6, y: 0.6 }, { x: 0.5, y: 0.9 }, { x: 0.4, y: 0.6 }, { x: 0.1, y: 0.5 },
  { x: 0.4, y: 0.4 }, { x: 0.5, y: 0.1 },
]];

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

/** The parts drawing a shape around a box, back to front; the icon's strokes, in a square of side 1, for an icon shape. */
export function shapeParts(shape: Shape, b: Box, icon: Vec[][] = []): Part[] {
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
    case "phone":
      // A phone lying on its side: its screen between a speaker on the left and a home button on the right.
      return [
        { type: "rectangle", box: b, round: 18, stroke: "outline", fill: "body" },
        { type: "rectangle", box: { x: x + BEZEL, y: y + 8, width: w - 2 * BEZEL, height: h - 16 }, round: 4, stroke: "outline", fill: "none" },
        { type: "rectangle", box: { x: x + BEZEL / 2 - 2.5, y: y + h / 2 - 14, width: 5, height: 28 }, round: 3, stroke: "detail", fill: "detail" },
        { type: "ellipse", box: { x: x + w - BEZEL / 2 - 5, y: y + h / 2 - 5, width: 10, height: 10 }, stroke: "detail", fill: "none" },
      ];
    case "monitor": {
      // A screen on a stand: a straight neck down to a foot drawn as a line, as large as the box lets them be, so that
      // the stand of a small picture of it is small too.
      const cx = x + w / 2;
      const s = Math.min(STAND, h * 0.2);
      const foot = y + h - 1.5; // half the outline in, so that the line stays inside the box
      const half = Math.min(w * 0.4, s * 4.5) / 2;
      return [
        { type: "rectangle", box: { x, y, width: w, height: h - s }, round: SMALL_RADIUS, stroke: "outline", fill: "body" },
        { type: "rectangle", box: { x: cx - s * 0.2, y: y + h - s, width: s * 0.4, height: foot - (y + h - s) }, stroke: "outline", fill: "body" },
        { type: "line", points: [{ x: cx - half, y: foot }, { x: cx + half, y: foot }], stroke: "outline", fill: "none" },
      ];
    }
    case "lambda":
      // A λ in the top left corner.
      return [
        { type: "rectangle", box: b, round: RADIUS, stroke: "outline", fill: "body" },
        { type: "line", points: [{ x: x + 12, y: y + 8 }, { x: x + 15, y: y + 8 }, { x: x + 24, y: y + 27 }], stroke: "detail", fill: "none" },
        { type: "line", points: [{ x: x + 18.8, y: y + 16 }, { x: x + 12, y: y + 27 }], stroke: "detail", fill: "none" },
      ];
    case "clock":
      // A clock in the top left corner.
      return [
        { type: "rectangle", box: b, round: RADIUS, stroke: "outline", fill: "body" },
        { type: "ellipse", box: { x: x + 10, y: y + 8, width: 19, height: 19 }, stroke: "detail", fill: "none" },
        { type: "line", points: [{ x: x + 19.5, y: y + 11.5 }, { x: x + 19.5, y: y + 17.5 }, { x: x + 24, y: y + 20 }], stroke: "detail", fill: "none" },
      ];
    case "icon": {
      // The icon in the top left corner, where a function has its lambda; a stroke of one point is a dot.
      const at = (p: Vec): Vec => ({ x: x + 8 + p.x * ICON, y: y + 5 + p.y * ICON });
      return [
        { type: "rectangle", box: b, round: RADIUS, stroke: "outline", fill: "body" },
        ...icon.filter((s) => s.length).map((s): Part => {
          if (s.length > 1) return { type: "line", points: s.map(at), stroke: "detail", fill: "none", fine: true };
          const c = at(s[0]);
          return { type: "ellipse", box: { x: c.x - 0.5, y: c.y - 0.5, width: 1, height: 1 }, stroke: "detail", fill: "detail", fine: true };
        }),
      ];
    }
    case "pipe": {
      // A cylinder lying on its side, as a queue is drawn: the outline, and the front of its right end.
      const [left, right, cy] = [x + RIM, x + w - RIM, y + h / 2];
      const outline = [...arc(right, cy, RIM, h / 2, -Math.PI / 2, Math.PI / 2), ...arc(left, cy, RIM, h / 2, Math.PI / 2, (3 * Math.PI) / 2)];
      return [
        { type: "line", points: [...outline, outline[0]], stroke: "outline", fill: "body" },
        { type: "line", points: arc(right, cy, RIM, h / 2, Math.PI / 2, (3 * Math.PI) / 2), stroke: "outline", fill: "none" },
      ];
    }
  }
}

/** Everything a shape is drawn with, the outline of a rounded box included, as for a picture of it. */
export function shapeDrawing(shape: Shape, b: Box, icon: Vec[][] = []): Part[] {
  return shape === "rounded" ? [{ type: "rectangle", box: b, round: RADIUS, stroke: "outline", fill: "body" }] : shapeParts(shape, b, icon);
}

/**
 * Room a shape takes inside its box besides the text, on each side as the text is centered: above and below it, such as
 * the top of a cylinder or the bar of a browser window, and left and right of it, such as the ends of a pipe.
 */
const SHAPE_ROOM: Record<Shape, Vec> = {
  rounded: { x: 0, y: 0 },
  person: { x: 0, y: 0 },
  component: { x: 0, y: 0 },
  terminal: { x: 0, y: PROMPT },
  cylinder: { x: 0, y: 2 * RIM },
  bucket: { x: 0, y: 2 * RIM },
  folder: { x: 0, y: TAB },
  browser: { x: 0, y: BAR },
  phone: { x: BEZEL, y: 0 },
  monitor: { x: 0, y: STAND },
  lambda: { x: 0, y: PROMPT },
  clock: { x: 0, y: PROMPT },
  pipe: { x: 2 * RIM, y: 0 },
  icon: { x: 0, y: PROMPT },
};

/** Version of the shapes, kept on their parts: parts drawn by an earlier one are drawn again. */
export const SHAPE_VERSION = 8;

export const ELEMENT_WIDTH = 240;
export const MIN_HEIGHT = 150;
export const PADDING = 16;

/**
 * Size of an element's box around its text: C4 boxes look alike, so at least a fixed size. With room for its shape,
 * which the text is centered in.
 */
export const boxSize = (text: { width: number; height: number }, shape: Shape = "rounded") => {
  const room = textRoom(text, shape);
  return { width: Math.max(ELEMENT_WIDTH, room.width), height: Math.max(MIN_HEIGHT, room.height) };
};

/** The least size of an element's box: room for its text and its shape, as for a box resized by hand. */
export const textRoom = (text: { width: number; height: number }, shape: Shape = "rounded") => {
  const room = SHAPE_ROOM[shape];
  return { width: text.width + 2 * PADDING + 2 * room.x, height: text.height + 2 * PADDING + 2 * room.y };
};
