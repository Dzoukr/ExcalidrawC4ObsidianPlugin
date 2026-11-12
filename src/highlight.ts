import type { AppState } from "./excalidraw";
import type { Box, Vec } from "./model";

/** What is selected, as drawn: a box, or a relationship's line with its label. */
export interface Shape {
  box?: Box;
  points?: Vec[];
  label?: Box;
}

const PAD = 5; // around a box, in screen pixels
const BADGE = 9; // radius of the order badges

/**
 * An outline over the canvas around what is selected, clearer than Excalidraw's own, above all on a relationship's
 * thin line: as the mind map plugin marks where a topic is dropped, a thin accent border over a faint accent fill. Numbered when more than one thing is selected, in the order of the selection, which is the way a
 * relationship goes. Never takes the pointer.
 */
export class Highlight {
  private readonly el: SVGSVGElement;

  constructor() {
    this.el = createSvg("svg", { cls: "c4-highlight" });
  }

  mount(parent: HTMLElement) {
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
  }

  update(shapes: Shape[], s: AppState, host: HTMLElement) {
    this.el.empty();
    if (!shapes.length) return;
    const zoom = s.zoom?.value ?? 1;
    const at = host.getBoundingClientRect();
    const px = (p: Vec): Vec => ({
      x: (p.x + s.scrollX) * zoom + (s.offsetLeft ?? 0) - at.left,
      y: (p.y + s.scrollY) * zoom + (s.offsetTop ?? 0) - at.top,
    });
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
  }

  destroy() {
    this.el.remove();
  }
}
