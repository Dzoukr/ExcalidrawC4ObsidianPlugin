// Keyboard shortcuts of a drawing, as the user sets them in the plugin's settings.
// Pure: no Obsidian or Excalidraw runtime.

export const SHORTCUT_ACTIONS = ["add", "zoomIn", "zoomOut", "edit", "up", "down", "left", "right"] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

/** A shortcut for each action, as "Ctrl+Shift+K"; an empty one is turned off. */
export type Shortcuts = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: Shortcuts = {
  add: "Insert", zoomIn: "Enter", zoomOut: "Backspace", edit: "Space", up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
};

/** The actions that go from element to element; with Shift added to their key they add to the selection. */
export const MOVES = ["up", "down", "left", "right"] as const satisfies readonly ShortcutAction[];
export type Move = (typeof MOVES)[number];
export const isMove = (a: ShortcutAction): a is Move => (MOVES as readonly string[]).includes(a);

export const SHORTCUT_NAMES: Record<ShortcutAction, { name: string; desc: string }> = {
  add: {
    name: "Add element",
    desc: "Adds an element of the level on the canvas; with two elements selected, a relationship between them.",
  },
  zoomIn: { name: "Zoom in", desc: "Into the selected system or container." },
  zoomOut: { name: "Zoom out", desc: "To the level above. Its key never deletes a C4 element; Delete does." },
  edit: { name: "Edit", desc: "The selected element or relationship." },
  up: { name: "Select above", desc: "The nearest element or relationship, instead of moving the selection. With Shift, adds it to the selection." },
  down: { name: "Select below", desc: "The nearest element or relationship, instead of moving the selection. With Shift, adds it to the selection." },
  left: { name: "Select on the left", desc: "The nearest element or relationship, instead of moving the selection. With Shift, adds it to the selection." },
  right: { name: "Select on the right", desc: "The nearest element or relationship, instead of moving the selection. With Shift, adds it to the selection." },
};

/** The parts of a key press a shortcut is made of. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIERS = ["Control", "Meta", "Alt", "Shift", "AltGraph", "CapsLock", "Fn", "OS"];

/** The shortcut a key press makes: its modifiers in a fixed order, then the key. Null for a modifier alone. */
export function shortcutOf(e: KeyPress): string | null {
  if (!e.key || MODIFIERS.includes(e.key) || e.key === "Dead" || e.key === "Unidentified") return null;
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [e.ctrlKey && "Ctrl", e.metaKey && "Meta", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean);
  return [...mods, key].join("+");
}

/**
 * The action a key press runs, by the shortcuts; the first one when two share a key. A move's key with Shift added
 * extends the selection.
 */
export function actionOf(shortcuts: Shortcuts, e: KeyPress): { action: ShortcutAction; extend: boolean } | null {
  const pressed = shortcutOf(e);
  if (!pressed) return null;
  const action = SHORTCUT_ACTIONS.find((a) => shortcuts[a] === pressed);
  if (action) return { action, extend: false };
  const plain = e.shiftKey ? shortcutOf({ ...e, shiftKey: false }) : null;
  const move = plain ? MOVES.find((a) => shortcuts[a] === plain) : undefined;
  return move ? { action: move, extend: true } : null;
}

/** The shortcuts saved in the settings, with the defaults for the ones missing. */
export function loadShortcuts(saved: unknown): Shortcuts {
  const out = { ...DEFAULT_SHORTCUTS };
  if (saved && typeof saved === "object") {
    for (const a of SHORTCUT_ACTIONS) {
      const v = (saved as Record<string, unknown>)[a];
      if (typeof v === "string") out[a] = v;
    }
  }
  return out;
}
