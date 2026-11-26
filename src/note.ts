import { App, Component, Keymap, MarkdownRenderer } from "obsidian";
import type { Box } from "./model";

/** The note shown, and the path of the drawing its links are resolved from. */
export interface ShownNote {
  note: string;
  path: string;
}

const GAP = 12; // between the card and what it is the note of, in screen pixels
const MARGIN = 8; // between the card and the edges of the canvas

/**
 * The note of the selected element or relationship, as a sticky note over the canvas right next to it, rendered as Markdown:
 * its links open what they point to. It follows the element as the view scrolls and zooms: on its right, else on its
 * left, else below or above it. Hidden while nothing with a note is selected, or what is selected is out of view.
 */
export class NoteCard {
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private shown = ""; // what is rendered, not to render it again for every change of the drawing
  private shownPath = ""; // of the drawing, which the links of the note shown are resolved from
  private anchor: Box | null = null; // where what the note is of is over the canvas
  private component?: Component; // of what is rendered, unloaded when it is rendered again

  constructor(private readonly app: App) {
    this.el = createDiv({ cls: "c4-note c4-hidden" });
    this.body = this.el.createDiv({ cls: "c4-note-body markdown-rendered" });
    this.body.addEventListener("click", (e) => {
      const a = e.target instanceof HTMLElement ? e.target.closest("a") : null;
      if (!a) return;
      const internal = a.hasClass("internal-link");
      const href = internal ? a.getAttr("data-href") ?? a.getAttr("href") : null;
      if (!internal || !href) return; // other links the browser opens
      e.preventDefault();
      void this.app.workspace.openLinkText(href, this.shownPath, Keymap.isModEvent(e));
    });
  }

  mount(parent: HTMLElement) {
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
  }

  /** Shows a note next to where what it is of is over the canvas, or hides the card for null. */
  show(note: ShownNote | null, anchor: Box | null) {
    this.render(anchor ? note : null);
    this.anchor = note ? anchor : null;
    this.place();
  }

  private render(note: ShownNote | null) {
    const key = note ? JSON.stringify(note) : "";
    if (key === this.shown) return;
    this.shown = key;
    this.component?.unload();
    this.component = undefined;
    this.body.empty();
    if (!note) return;
    this.shownPath = note.path;
    const component = (this.component = new Component());
    component.load();
    // Placed again once rendered, at the size it has then.
    void MarkdownRenderer.render(this.app, note.note, this.body, note.path, component).then(() => {
      if (this.component === component) this.place();
    });
    this.body.scrollTop = 0;
  }

  private place() {
    const host = this.el.parentElement;
    const a = this.anchor;
    const w = host?.clientWidth ?? 0;
    const h = host?.clientHeight ?? 0;
    // Out of view, the note is not shown either.
    const visible = !!a && !!this.shown && a.x + a.width > 0 && a.y + a.height > 0 && a.x < w && a.y < h;
    this.el.toggleClass("c4-hidden", !visible);
    if (!visible || !a) return;
    const cw = this.el.offsetWidth;
    const ch = this.el.offsetHeight;
    const clamp = (v: number, max: number) => Math.max(MARGIN, Math.min(v, max - MARGIN));
    const room = (space: number, size: number) => space - GAP - MARGIN >= size;
    let x = a.x;
    let y = a.y;
    if (room(w - a.x - a.width, cw)) x = a.x + a.width + GAP;
    else if (room(a.x, cw)) x = a.x - GAP - cw;
    // Neither side has room: below, else above.
    else y = room(h - a.y - a.height, ch) || !room(a.y, ch) ? a.y + a.height + GAP : a.y - GAP - ch;
    // Kept on the canvas, even over what it is the note of.
    this.el.setCssProps({ "--c4-note-x": `${clamp(x, w - cw)}px`, "--c4-note-y": `${clamp(y, h - ch)}px` });
  }

  destroy() {
    this.component?.unload();
    this.el.remove();
  }
}
