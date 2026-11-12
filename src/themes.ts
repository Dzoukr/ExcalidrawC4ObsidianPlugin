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
  // As in the key of the C4 model's diagrams: blue on white, green for people, grey for external elements.
  classic: DEFAULT_LOOKS,
  // The C4 model's well-known filled boxes: dark to light blue going down the levels, green for people, grey for external elements.
  filled: palette({
    person: { background: "#297e06", stroke: "#236b05", text: "#ffffff" },
    system: { background: "#1168bd", stroke: "#0f5eaa", text: "#ffffff" },
    container: { background: "#438dd5", stroke: "#3c7fc0", text: "#ffffff" },
    component: { background: "#85bbf0", stroke: "#78a8d8", text: "#000000" },
    external: { background: "#999999", stroke: "#8a8a8a", text: "#ffffff" },
  }),
  // As a mind map's branches: a color of its own for each kind and type of container, a full fill under a strong outline.
  pastel: palette({
    person: outlined("#6741d9", "#d0bfff", "#212529"),
    system: outlined("#1971c2", "#a5d8ff", "#212529"),
    container: outlined("#0c8599", "#99e9f2", "#212529"),
    types: {
      storage: outlined("#f08c00", "#ffec99", "#212529"),
      directory: outlined("#e8590c", "#ffd8a8", "#212529"),
      database: outlined("#2f9e44", "#b2f2bb", "#212529"),
      server: outlined("#3b5bdb", "#bac8ff", "#212529"),
      spa: outlined("#c2255c", "#fcc2d7", "#212529"),
    },
    component: outlined("#9c36b5", "#eebefa", "#212529"),
    external: outlined("#868e96", "#e9ecef", "#495057"),
  }),
  // The colors of the sea and what lives in it.
  ocean: palette({
    person: outlined("#0b7285", "#66d9e8", "#102a43"),
    system: outlined("#1864ab", "#74c0fc", "#102a43"),
    container: outlined("#364fc7", "#91a7ff", "#102a43"),
    types: {
      storage: outlined("#2b8a3e", "#8ce99a", "#102a43"),
      directory: outlined("#5c940d", "#c0eb75", "#102a43"),
      database: outlined("#087f5b", "#63e6be", "#102a43"),
      spa: outlined("#862e9c", "#e599f7", "#102a43"),
    },
    component: outlined("#5f3dc4", "#b197fc", "#102a43"),
    external: outlined("#868e96", "#e9ecef", "#495057"),
  }),
  // The colors of the evening sky, from red to purple.
  sunset: palette({
    person: outlined("#c92a2a", "#ffa8a8", "#3b1f1f"),
    system: outlined("#d9480f", "#ffc078", "#3b1f1f"),
    container: outlined("#e67700", "#ffe066", "#3b1f1f"),
    types: {
      storage: outlined("#5f3dc4", "#b197fc", "#3b1f1f"),
      directory: outlined("#e03131", "#ffc9c9", "#3b1f1f"),
      database: outlined("#a61e4d", "#faa2c1", "#3b1f1f"),
      spa: outlined("#f08c00", "#ffd8a8", "#3b1f1f"),
    },
    component: outlined("#862e9c", "#e599f7", "#3b1f1f"),
    external: outlined("#868e96", "#e9ecef", "#495057"),
  }),
  // Greens of leaves and moss, with bark, water and autumn leaves.
  forest: palette({
    person: outlined("#2b8a3e", "#8ce99a", "#1b2e1f"),
    system: outlined("#5c940d", "#c0eb75", "#1b2e1f"),
    container: outlined("#087f5b", "#63e6be", "#1b2e1f"),
    types: {
      storage: outlined("#0b7285", "#66d9e8", "#1b2e1f"),
      directory: outlined("#e67700", "#ffe066", "#1b2e1f"),
      database: outlined("#7c5a2e", "#e0c3a0", "#1b2e1f"),
      spa: outlined("#c92a2a", "#ffa8a8", "#1b2e1f"),
    },
    component: outlined("#d9480f", "#ffc078", "#1b2e1f"),
    external: outlined("#868e96", "#e9ecef", "#495057"),
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
