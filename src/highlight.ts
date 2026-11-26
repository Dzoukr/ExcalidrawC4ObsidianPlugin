import { getIcon } from "obsidian";
import type { AppState } from "./excalidraw";
import type { Box, Vec } from "./model";

/** What is selected, as drawn: a box, or a relationship's line with its label. */
export interface SelectionShape {
  box?: Box;
  points?: Vec[];
  label?: Box;
}

const PAD = 5; // around a box, in screen pixels
const BADGE = 9; // radius of the order badges
const MARK = 9; // radius of the marks of notes
const MARK_ICON = "sticky-note";

/** Turns points of the drawing into points over the canvas, in pixels from the top left corner of the host. */
export function screenOf(s: AppState, host: HTMLElement): (p: Vec) => Vec {
  const zoom = s.zoom?.value ?? 1;
  const at = host.getBoundingClientRect();
  return (p) => ({
    x: (p.x + s.scrollX) * zoom + (s.offsetLeft ?? 0) - at.left,
    y: (p.y + s.scrollY) * zoom + (s.offsetTop ?? 0) - at.top,
  });
}

/** The mark of an element or relationship that has a note: its id, its note, and where it is drawn. */
export interface NoteMark {
  id: string;
  note: string;
  shape: SelectionShape;
}

/** Where the mark of a note is over the canvas: a box's top right corner; a relationship's label's, or the middle of its line without one. */
export function markPoint(shape: SelectionShape, s: AppState, host: HTMLElement): Vec | null {
  const px = screenOf(s, host);
  const b = shape.box ?? shape.label;
  if (b) return px({ x: b.x + b.width, y: b.y });
  return shape.points?.length ? px(shape.points[Math.floor(shape.points.length / 2)]) : null;
}

/** The mark of a note over the canvas, as a box: the note opens next to it. */
export function markBox(shape: SelectionShape, s: AppState, host: HTMLElement): Box | null {
  const p = markPoint(shape, s, host);
  return p && { x: p.x - MARK, y: p.y - MARK, width: 2 * MARK, height: 2 * MARK };
}

/**
 * An outline over the canvas around what is selected, clearer than Excalidraw's own, above all on a relationship's
 * thin line: as the mind map plugin marks where a topic is dropped, a thin accent border over a faint accent fill.
 * Numbered when more than one thing is selected, in the order of the selection, which is the way a relationship goes.
 * Over it, a small mark at the top right corner of every element and relationship that has a note, which is not drawn
 * on the canvas, so not exported either. Only the marks take the pointer: a click on one opens or closes its note.
 */
export class Highlight {
  private readonly el: SVGSVGElement;

  constructor(onMark: (id: string) => void) {
    this.el = createSvg("svg", { cls: "c4-highlight" });
    // On the overlay itself, which keeps them while its marks are drawn again.
    this.el.addEventListener("pointerdown", (e) => {
      if (e.target instanceof Element && e.target.closest(".c4-note-mark")) e.stopPropagation(); // not for Excalidraw
    });
    this.el.addEventListener("click", (e) => {
      const id = e.target instanceof Element ? e.target.closest(".c4-note-mark")?.getAttribute("data-id") : null;
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      onMark(id);
    });
  }

  mount(parent: HTMLElement) {
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
  }

  /** Draws the outline of what is selected and the marks of the notes, the one open lit. */
  update(shapes: SelectionShape[], marks: NoteMark[], open: string | undefined, s: AppState, host: HTMLElement) {
    this.el.empty();
    if (!shapes.length && !marks.length) return;
    const zoom = s.zoom?.value ?? 1;
    const px = screenOf(s, host);
    const rect = (b: Box, pad: number, cls: string) => {
      const a = px(b);
      return this.el.createSvg("rect", { cls, attr: {
        x: a.x - pad, y: a.y - pad, width: b.width * zoom + 2 * pad, height: b.height * zoom + 2 * pad, rx: 8,
      } });
    };
    shapes.forEach((shape, i) => {
      let corner: Vec | undefined;
      if (shape.box) {
        rect(shape.box, PAD, "c4-highlight-box");
        corner = px(shape.box);
      }
      if (shape.points?.length) {
        const d = shape.points.map(px).map((p, j) => `${j ? "L" : "M"}${p.x},${p.y}`).join(" ");
        this.el.createSvg("path", { cls: "c4-highlight-line", attr: { d } });
        if (shape.label) {
          rect(shape.label, 3, "c4-highlight-box");
          corner = px(shape.label);
        } else corner ??= px(shape.points[Math.floor(shape.points.length / 2)]);
      }
      if (shapes.length > 1 && corner) {
        const c = { x: corner.x - PAD, y: corner.y - PAD };
        this.el.createSvg("circle", { cls: "c4-highlight-badge", attr: { cx: c.x, cy: c.y, r: BADGE } });
        this.el.createSvg("text", { cls: "c4-highlight-number", attr: { x: c.x, y: c.y } }).textContent = String(i + 1);
      }
    });
    for (const { id, shape } of marks) {
      const p = markPoint(shape, s, host);
      if (!p) continue;
      const label = id === open ? "Hide note" : "Show note";
      const g = this.el.createSvg("g", { cls: "c4-note-mark", attr: { "data-id": id, role: "button", "aria-label": label } });
      g.toggleClass("is-open", id === open);
      g.createSvg("circle", { cls: "c4-note-mark-dot", attr: { cx: p.x, cy: p.y, r: MARK } });
      const icon = getIcon(MARK_ICON);
      if (!icon) continue;
      const size = MARK * 1.2;
      icon.addClass("c4-note-mark-icon");
      for (const [k, v] of Object.entries({ x: p.x - size / 2, y: p.y - size / 2, width: size, height: size })) icon.setAttribute(k, String(v));
      g.appendChild(icon);
    }
  }

  destroy() {
    this.el.remove();
  }
}
