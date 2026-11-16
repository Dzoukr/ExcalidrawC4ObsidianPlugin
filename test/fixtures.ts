// What the tests draw with: elements as Excalidraw keeps them, scenes of layers made of them, and the colors set for a test.

import { Scene } from "../src/layers.ts";
import { CONTEXT, DEFAULT_LOOKS, KEY, useColors } from "../src/model.ts";
import type { C4Element, Look, LookKey, ViewKind } from "../src/model.ts";
import type { El } from "../src/excalidraw.ts";

/** What every element has, a square at the origin. */
export const base = { x: 0, y: 0, width: 100, height: 100, strokeColor: "", backgroundColor: "", roughness: 0 };

/** The box of an element, named as its box. */
export const box = (boxId: string, data: Partial<C4Element> & Pick<C4Element, "kind">, at: Partial<El> = {}): El => ({
  ...base, ...at, id: boxId, type: "rectangle", customData: { [KEY]: { name: boxId, ...data } },
});

/** A relationship arrow between two boxes, saying "Uses". */
export const arrow = (id: string, from: string, to: string): El => ({
  ...base, id, type: "arrow",
  startBinding: { elementId: from }, endBinding: { elementId: to },
  customData: { [KEY]: { relationship: true, description: "Uses" } },
});

/** The boundary rectangle of a layer's scope. */
export const boundary = (id: string, scope: string, at: Partial<El> = {}): El => ({
  ...base, ...at, id, type: "rectangle", customData: { [KEY]: { boundary: scope } },
});

/** An element moved to a place. */
export const at = (e: El, x: number, y: number): El => ({ ...e, x, y });

/** The layers of a drawing, by their scope: the layers of "p" and "w" show components, the others containers. */
export const sceneOf = (layers: Record<string, El[]>) => {
  const views: Record<string, ViewKind | null> = { [CONTEXT]: null };
  for (const l of Object.keys(layers)) if (l !== CONTEXT) views[l] = l === "p" || l === "w" ? "component" : "container";
  return new Scene(new Map(Object.entries(layers)), views);
};

/** Runs a test with the colors of a theme, putting the default ones back afterwards. */
export function withColors(colors: Record<LookKey, Look>, run: () => void) {
  useColors(colors);
  try {
    run();
  } finally {
    useColors(DEFAULT_LOOKS);
  }
}
