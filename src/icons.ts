// Obsidian's icons as the strokes they are drawn with on the canvas, measured along their outlines in the DOM.

import { getIcon, getIconIds } from "obsidian";
import { IconStrokes, iconStrokes, splitAtJumps } from "./iconpath";
import type { Vec } from "./geometry";

const PREFIX = "lucide-";
const STEP = 0.25; // between the points measured along an outline, in the units of the icon (24 to its side)
const TOLERANCE = 0.08; // how far a simplified line may stray from the outline, in the same units

const cache = new Map<string, IconStrokes>();

/** The ids of the icons to pick from: Lucide's, which Obsidian draws its own interface with. */
export const iconIds = (): string[] => getIconIds().filter((id) => id.startsWith(PREFIX)).sort();

/** The name of an icon, as its id without the prefix of its set: "shield-check". */
export const iconName = (id: string): string => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : id);

/** The strokes of an icon in a square of side 1; none for an icon Obsidian does not have. */
export function strokesOf(id: string | undefined): IconStrokes {
  if (!id) return [];
  const known = cache.get(id);
  if (known) return known;
  const strokes = measure(id);
  // None, as of an icon whose outlines the browser did not lay out, is measured again the next time.
  if (strokes.length) cache.set(id, strokes);
  return strokes;
}

function measure(id: string): IconStrokes {
  const svg = getIcon(id);
  if (!svg) return [];
  // In the document, out of sight, so that the browser lays out its outlines to measure.
  svg.setCssStyles({ position: "fixed", left: "-1000px", top: "-1000px", visibility: "hidden" });
  activeDocument.body.appendChild(svg);
  try {
    const vb = svg.viewBox.baseVal;
    const box = vb && vb.width ? { x: vb.x, y: vb.y, width: vb.width, height: vb.height } : { x: 0, y: 0, width: 24, height: 24 };
    const lines: Vec[][] = [];
    for (const el of Array.from(svg.querySelectorAll<SVGGeometryElement>("path, line, polyline, polygon, circle, ellipse, rect"))) {
      // Each part of a path on its own, so that a dot, a part hardly longer than a point, is measured too.
      for (const part of el.instanceOf(SVGPathElement) ? subpaths(svg, el) : [el]) lines.push(...sample(part));
    }
    return iconStrokes(lines, box, TOLERANCE);
  } catch {
    return [];
  } finally {
    svg.remove();
  }
}

/** Points along an outline, a step apart, from its start to its end; split where it jumps. */
function sample(el: SVGGeometryElement): Vec[][] {
  const total = el.getTotalLength();
  const n = Math.max(1, Math.ceil(total / STEP));
  const samples: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const p = el.getPointAtLength((total * i) / n);
    samples.push({ x: p.x, y: p.y });
  }
  return splitAtJumps(samples, Math.max(total / n, STEP));
}

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;

/**
 * The parts of a path, each starting with its own moveto, as paths in the icon: a part moved to relative to where the
 * one before it ended is moved to that place.
 */
function subpaths(svg: SVGSVGElement, path: SVGPathElement): SVGPathElement[] {
  const parts = (path.getAttribute("d") ?? "").split(/(?=[Mm])/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [path];
  const make = (d: string) => svg.createSvg("path", { attr: { d } });
  const out: SVGPathElement[] = [];
  for (let i = 0; i < parts.length; i++) {
    let d = parts[i];
    if (i > 0 && d.startsWith("m")) {
      const before = make(parts.slice(0, i).join(" "));
      const end = before.getPointAtLength(before.getTotalLength());
      before.remove();
      const nums = Array.from(d.slice(1).matchAll(NUMBER)).slice(0, 2);
      if (nums.length === 2) {
        const rest = d.slice(1 + nums[1].index + nums[1][0].length).trim();
        const x = end.x + parseFloat(nums[0][0]);
        const y = end.y + parseFloat(nums[1][0]);
        d = `M${x} ${y}${rest && !/^[a-z]/i.test(rest) ? " l" : " "}${rest}`;
      }
    }
    parts[i] = d;
    out.push(make(d));
  }
  return out;
}
