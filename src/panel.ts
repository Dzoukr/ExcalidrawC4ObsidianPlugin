import { setIcon } from "obsidian";
import { C4Kind, KINDS, kindTitle } from "./model";

export interface PanelActions {
  add: (kind: C4Kind) => void;
  relate: () => void;
  edit: () => void;
  reverse: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  theme: (at: HTMLElement) => void; // shows the themes at the button
  togglePause: () => void;
}

export interface PanelState {
  pair: boolean; // exactly two C4 elements are selected, to connect with a relationship
  item: boolean; // exactly one C4 element or relationship is selected, to edit
  relationship: boolean; // exactly one relationship is selected, to reverse
  title: string; // of the layer on the canvas
  kinds: C4Kind[]; // the kinds the layer takes
  zoomIn: boolean; // the selection has a layer to zoom into
  zoomOut: string | null; // title of the layer one level up
  paused: boolean; // the plugin leaves keys and double-clicks to Excalidraw
}

/** Where the panel is docked: a row at the bottom or top of the canvas, or a column on its left or right side. */
export type PanelPosition = "bottom" | "top" | "left" | "right";

export const PANEL_POSITIONS: Record<PanelPosition, string> = { bottom: "Bottom", top: "Top", left: "Left side", right: "Right side" };

export const isPanelPosition = (p: unknown): p is PanelPosition => typeof p === "string" && Object.prototype.hasOwnProperty.call(PANEL_POSITIONS, p);

const ICONS: Record<C4Kind, string> = { person: "user", system: "box", container: "container", component: "component" };

type Key = C4Kind | "relate" | "edit" | "reverse" | "zoomIn" | "zoomOut" | "theme" | "pause";

const PAUSE = "Pause C4 editing (use Excalidraw's own shortcuts)";
const RESUME = "Resume C4 editing";

/** Floating control bar docked on an Excalidraw view: add elements, connect and edit the selection. */
export class C4Panel {
  readonly el: HTMLElement;
  private readonly buttons = new Map<Key, HTMLButtonElement>();
  private position: PanelPosition = "right";
  private readonly title: HTMLElement;

  constructor(a: PanelActions) {
    this.el = createDiv({ cls: "c4-panel c4-pos-right" });
    // Names the panel, which may sit next to other plugins' panels.
    this.el.createDiv({ cls: "c4-badge", text: "C4" });
    // The layer on the canvas: the others are out of sight.
    this.title = this.el.createDiv({ cls: "c4-title" });
    const group = () => this.el.createDiv({ cls: "c4-group" });
    const button = (g: HTMLElement, key: Key, icon: string, label: string, fn: (b: HTMLButtonElement) => void) => {
      const b = g.createEl("button", { cls: "c4-btn clickable-icon", attr: { "aria-label": label } });
      setIcon(b, icon);
      // Keep focus on the canvas so Excalidraw's keys keep working.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.preventDefault();
        fn(b);
      });
      this.buttons.set(key, b);
    };
    const add = group();
    for (const kind of KINDS) button(add, kind, ICONS[kind], `Add ${kindTitle(kind).toLowerCase()}`, () => a.add(kind));
    const change = group();
    button(change, "relate", "spline", "Add relationship between the two selected elements", a.relate);
    button(change, "edit", "pencil", "Edit selected element or relationship", a.edit);
    button(change, "reverse", "arrow-left-right", "Reverse direction of selected relationship", a.reverse);
    const zoom = group();
    button(zoom, "zoomIn", "zoom-in", "Zoom into the selected system or container", a.zoomIn);
    button(zoom, "zoomOut", "zoom-out", "Zoom out", a.zoomOut);
    const more = group();
    button(more, "theme", "palette", "Theme of the drawing", (b) => a.theme(b));
    button(more, "pause", "pause", PAUSE, a.togglePause);
  }

  mount(parent: HTMLElement) {
    // The view content becomes the positioning box, so the panel offsets are measured from the canvas area.
    parent.addClass("c4-host");
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
  }

  setPosition(p: PanelPosition) {
    if (p === this.position) return;
    this.el.removeClass(`c4-pos-${this.position}`);
    this.el.addClass(`c4-pos-${p}`);
    this.position = p;
  }

  setVisible(visible: boolean) {
    this.el.toggleClass("c4-hidden", !visible);
  }

  update(s: PanelState) {
    // Paused, only the button that resumes works, lit so it is obvious how to resume.
    const pause = this.buttons.get("pause")!;
    if (pause.hasClass("is-active") !== s.paused) setIcon(pause, s.paused ? "play" : "pause");
    pause.toggleClass("is-active", s.paused);
    pause.setAttribute("aria-label", s.paused ? RESUME : PAUSE);
    this.el.toggleClass("c4-paused", s.paused);
    if (s.paused) {
      for (const b of this.buttons.values()) b.disabled = b !== pause;
      return;
    }
    this.buttons.get("theme")!.disabled = false;
    pause.disabled = false;
    this.buttons.get("relate")!.disabled = !s.pair;
    this.buttons.get("edit")!.disabled = !s.item;
    this.buttons.get("reverse")!.disabled = !s.relationship;
    for (const kind of KINDS) this.buttons.get(kind)!.disabled = !s.kinds.includes(kind);
    this.buttons.get("zoomIn")!.disabled = !s.zoomIn;
    const out = this.buttons.get("zoomOut")!;
    out.disabled = !s.zoomOut;
    out.setAttribute("aria-label", s.zoomOut ? `Zoom out to ${s.zoomOut}` : "Zoom out");
    this.title.setText(s.title);
    this.title.setAttribute("aria-label", s.title);
  }

  destroy() {
    this.el.parentElement?.removeClass("c4-host");
    this.el.remove();
  }
}
