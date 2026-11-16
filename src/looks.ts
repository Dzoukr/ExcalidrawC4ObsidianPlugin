// The colors C4 elements and groups are drawn in: those of each type of element in the drawing's theme, and an
// element's own over them. Pure: no Obsidian or Excalidraw runtime.

import { CONTAINER_TYPES, CONTAINER_TYPE_TITLES, RADIUS, corners, isContainerType, shapeOf } from "./shapes.ts"; // with its extension, for the tests running in Node
import type { ContainerType, Roundness } from "./shapes.ts";
import type { C4Element, C4Group } from "./model.ts";

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

/** The colors of the types of element in the theme of the drawing being drawn. */
let looks: Record<LookKey, Look> = DEFAULT_LOOKS;

const isColor = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** Colors over a look: of the parts, those given that are colors, else the look's own. */
function overlay(base: Look, over: Partial<Look> | undefined, parts: readonly (keyof Look)[]): Look {
  const out = { ...base };
  for (const p of parts) if (isColor(over?.[p])) out[p] = over[p];
  return out;
}

/** Of the parts, the colors given that differ from a look's, whatever their case; none when all are the same. */
function ownOver(base: Look, look: Partial<Look>, parts: readonly (keyof Look)[]): Partial<Look> | undefined {
  const out: Partial<Look> = {};
  for (const p of parts) if (isColor(look[p]) && look[p].toLowerCase() !== base[p].toLowerCase()) out[p] = look[p];
  return Object.keys(out).length ? out : undefined;
}

/** The colors of a type from settings: the colors saved for it, with its defaults for any missing or not a color. */
export const lookFrom = (saved: Partial<Look> | undefined, key: LookKey): Look => overlay(DEFAULT_LOOKS[key], saved, LOOK_PARTS);

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
const typeLookOf = (e: Pick<C4Element, "kind" | "type" | "external">): Look => looks[lookKeyOf(e)];

/** The colors of an element: its own, where it has them, else those of its type. */
export const lookOf = (e: Pick<C4Element, "kind" | "type" | "external" | "look">): Look => overlay(typeLookOf(e), e.look, LOOK_PARTS);

/** An element's own colors: only those that differ from its type's, none when all are the same. */
export const ownLook = (e: Pick<C4Element, "kind" | "type" | "external">, look: Partial<Look>): Partial<Look> | undefined =>
  ownOver(typeLookOf(e), look, LOOK_PARTS);

/** The colors of a group: its own, where it has them, else those of groups in the drawing's theme. */
export const groupLookOf = (g: Pick<C4Group, "look">): Look => overlay(looks.group, g.look, GROUP_LOOK_PARTS);

/** A group's own colors: only those that differ from the colors of groups, none when all are the same. */
export const ownGroupLook = (look: Partial<Look>): Partial<Look> | undefined => ownOver(looks.group, look, GROUP_LOOK_PARTS);

/** The colors of a look as one string, kept on the parts of a shape to tell when they need drawing again. */
export const lookSignature = (look: Look): string => LOOK_PARTS.map((p) => look[p].toLowerCase()).join(" ");

/** How the box itself is drawn: the outline of a rounded box, else invisible, with its parts drawing the shape behind it. */
export function boxStyle(e: Pick<C4Element, "kind" | "type" | "external" | "look">): { roundness: Roundness; strokeColor: string; backgroundColor: string } {
  const look = lookOf(e);
  const shape = shapeOf(e);
  if (shape === "rounded") return { roundness: corners(RADIUS), strokeColor: look.stroke, backgroundColor: look.background };
  return { roundness: null, strokeColor: "transparent", backgroundColor: "transparent" };
}
