// Color themes: the colors of every type of element, built in or the user's own. Each drawing keeps its own theme.
// Pure: no Obsidian or Excalidraw runtime.

import { CONTAINER_TYPES, DEFAULT_LOOKS, LOOK_KEYS, lookFrom } from "./model.ts";
import type { ContainerType, Look, LookKey } from "./model.ts";

/** The colors of every type of element. */
export type Colors = Record<LookKey, Look>;

/** A built-in theme, a fixed palette. */
export type Preset = "classic" | "filled" | "pastel" | "ocean" | "sunset" | "forest" | "monochrome";

export const PRESETS: Record<Preset, string> = {
  classic: "Classic",
  filled: "Filled",
  pastel: "Pastel",
  ocean: "Ocean",
  sunset: "Sunset",
  forest: "Forest",
  monochrome: "Monochrome",
};

/** A theme the user made in the settings, or imported. */
export interface UserTheme {
  id: string;
  name: string;
  colors: Colors;
}

/** A drawing's colors, by id: a preset, or one of the user's themes. */
export type Theme = string;

/** The user theme made from the colors the settings had before themes. */
export const CUSTOM_THEME = "custom";

/** An outline and text in one color, on a fill. */
const outlined = (stroke: string, background = "#ffffff", text = stroke): Look => ({ stroke, background, text });

/** The colors of a theme from those of each kind; containers of a type without colors of its own have those of all containers. */
function palette(p: {
  person: Look; system: Look; container: Look; types?: Partial<Record<ContainerType, Look>>; component: Look; external: Look;
}): Colors {
  return {
    person: p.person,
    system: p.system,
    ...(Object.fromEntries(CONTAINER_TYPES.map((t) => [`container-${t}`, p.types?.[t] ?? p.container])) as Record<`container-${ContainerType}`, Look>),
    component: p.component,
    external: p.external,
  };
}

const PALETTES: Record<Preset, Colors> = {
  // As in the key of the C4 model's diagrams: blue on white, grey for external elements.
  classic: DEFAULT_LOOKS,
  // The C4 model's well-known filled boxes: dark to light blue going down the levels, grey for external elements.
  filled: palette({
    person: { background: "#08427b", stroke: "#073b6f", text: "#ffffff" },
    system: { background: "#1168bd", stroke: "#0f5eaa", text: "#ffffff" },
    container: { background: "#438dd5", stroke: "#3c7fc0", text: "#ffffff" },
    component: { background: "#85bbf0", stroke: "#78a8d8", text: "#000000" },
    external: { background: "#999999", stroke: "#8a8a8a", text: "#ffffff" },
  }),
  // A soft color for each kind and type of container.
  pastel: palette({
    person: outlined("#7048e8", "#e5dbff", "#343a40"),
    system: outlined("#1971c2", "#d0ebff", "#343a40"),
    container: outlined("#1098ad", "#c5f6fa", "#343a40"),
    types: {
      storage: outlined("#f08c00", "#fff3bf", "#343a40"),
      directory: outlined("#e8590c", "#ffe8cc", "#343a40"),
      database: outlined("#2f9e44", "#d3f9d8", "#343a40"),
      spa: outlined("#d6336c", "#ffdeeb", "#343a40"),
    },
    component: outlined("#9c36b5", "#f3d9fa", "#343a40"),
    external: outlined("#868e96", "#f1f3f5", "#495057"),
  }),
  ocean: palette({
    person: outlined("#0b7285", "#c5f6fa", "#102a43"),
    system: outlined("#1864ab", "#d0ebff", "#102a43"),
    container: outlined("#1971c2", "#e7f5ff", "#102a43"),
    types: { database: outlined("#364fc7", "#dbe4ff", "#102a43"), storage: outlined("#087f5b", "#c3fae8", "#102a43") },
    component: outlined("#5f3dc4", "#e5dbff", "#102a43"),
    external: outlined("#868e96", "#f8f9fa", "#495057"),
  }),
  sunset: palette({
    person: outlined("#c92a2a", "#ffe3e3", "#3b1f1f"),
    system: outlined("#e8590c", "#ffe8cc", "#3b1f1f"),
    container: outlined("#f08c00", "#fff3bf", "#3b1f1f"),
    types: { database: outlined("#a61e4d", "#fcc2d7", "#3b1f1f"), storage: outlined("#d9480f", "#ffd8a8", "#3b1f1f") },
    component: outlined("#c2255c", "#ffdeeb", "#3b1f1f"),
    external: outlined("#868e96", "#f8f9fa", "#495057"),
  }),
  forest: palette({
    person: outlined("#2b8a3e", "#d3f9d8", "#1b2e1f"),
    system: outlined("#5c940d", "#e9fac8", "#1b2e1f"),
    container: outlined("#087f5b", "#c3fae8", "#1b2e1f"),
    types: { database: outlined("#7c5a2e", "#f1e3d3", "#1b2e1f"), storage: outlined("#0b7285", "#c5f6fa", "#1b2e1f") },
    component: outlined("#e67700", "#fff3bf", "#1b2e1f"),
    external: outlined("#868e96", "#f8f9fa", "#495057"),
  }),
  monochrome: palette({
    person: outlined("#212529"),
    system: outlined("#212529"),
    container: outlined("#343a40"),
    component: outlined("#495057"),
    external: outlined("#adb5bd", "#ffffff", "#868e96"),
  }),
};

export const isPreset = (t: unknown): t is Preset => typeof t === "string" && Object.prototype.hasOwnProperty.call(PRESETS, t);

/** The user's themes from the plugin settings; the plugin replaces them on load and whenever the settings change. */
let userThemes: UserTheme[] = [];

export function setUserThemes(t: UserTheme[]) {
  userThemes = t;
}

/** The theme of new drawings, from the plugin settings. */
let newDrawingTheme: Theme = "classic";

export function setNewDrawingTheme(t: Theme) {
  newDrawingTheme = t;
}

export const themeOfNewDrawings = (): Theme => newDrawingTheme;

/** The colors of a theme; a user theme that is gone, or one from another vault, has the Classic ones. */
export const colorsOf = (theme: Theme): Colors =>
  isPreset(theme) ? PALETTES[theme] : userThemes.find((t) => t.id === theme)?.colors ?? PALETTES.classic;

/** Every theme to pick from: the presets, then the user's own. */
export function themeOptions(): { id: Theme; name: string; user: boolean }[] {
  return [
    ...(Object.keys(PRESETS) as Preset[]).map((id) => ({ id, name: PRESETS[id], user: false })),
    ...userThemes.map((t) => ({ id: t.id, name: t.name, user: true })),
  ];
}

/** The theme's name; null for a user theme that is gone. */
export const themeName = (theme: Theme): string | null => (isPreset(theme) ? PRESETS[theme] : userThemes.find((t) => t.id === theme)?.name ?? null);

/** The theme, or when it is no preset or theme of the user's, Classic. */
export const validTheme = (theme: unknown, themes: UserTheme[]): Theme =>
  typeof theme === "string" && (isPreset(theme) || themes.some((t) => t.id === theme)) ? theme : "classic";

/** A few colors that show what a theme looks like: of a person, a system, a container and a component. */
export function themeSwatches(theme: Theme): string[] {
  const c = colorsOf(theme);
  const keys: LookKey[] = ["person", "system", "container-generic", "component"];
  // The fill, unless it is white, which says nothing.
  return keys.map((k) => (/^#f{6}$/i.test(c[k].background) ? c[k].stroke : c[k].background));
}

/** A new id for a user theme, unlike the presets' and those taken. */
export function newThemeId(taken: string[]): string {
  for (;;) {
    const id = `theme-${Math.random().toString(36).slice(2, 10)}`;
    if (!taken.includes(id)) return id;
  }
}

/** The name, or with a number after it when another theme has it already. */
export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; ; i++) if (!taken.includes(`${name} ${i}`)) return `${name} ${i}`;
}

/** Colors read from saved settings or an imported theme, over the Classic ones for what is missing or no color. */
export function mergeColors(value: unknown): Colors {
  const c = (value && typeof value === "object" ? value : {}) as Partial<Record<LookKey, Partial<Look>>>;
  return Object.fromEntries(LOOK_KEYS.map((k) => [k, lookFrom(c[k], k)])) as Colors;
}

/** A copy of a theme's colors, to start a theme of the user's from. */
export const copyColors = (theme: Theme): Colors => structuredClone(colorsOf(theme));

const THEME_FILE = "excalidraw-c4-themes";

/** Themes as JSON to share, without their ids: whoever imports them gets new ones. */
export function themesToJson(themes: { name: string; colors: Colors }[]): string {
  return JSON.stringify({ type: THEME_FILE, version: 1, themes: themes.map(({ name, colors }) => ({ name, colors })) }, null, 2);
}

/** The themes in exported JSON: a file of themes, a list of them or a single one, each with a name and colors. Null when there are none. */
export function parseThemes(text: string): { name: string; colors: Colors }[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const themes = (data as { themes?: unknown } | null)?.themes;
  const list: unknown[] = Array.isArray(data) ? data : Array.isArray(themes) ? themes : [data];
  const out = list
    .filter((t): t is { name?: unknown; colors: object } => !!t && typeof t === "object" && typeof (t as { colors?: unknown }).colors === "object" && !!(t as { colors?: unknown }).colors)
    .map((t) => ({ name: typeof t.name === "string" && t.name.trim() ? t.name.trim() : "Imported theme", colors: mergeColors(t.colors) }));
  return out.length ? out : null;
}
