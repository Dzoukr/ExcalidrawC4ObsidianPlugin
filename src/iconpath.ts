// An icon as the strokes it is drawn with on the canvas: lines through points in a square of side 1. Pure: the points
// along the icon's outlines are measured by the caller (see icons.ts).

import type { Vec } from "./model.ts"; // with its extension, for the tests running in Node

/** The lines an icon is drawn with, in a square of side 1; a line of one point is a dot. */
export type IconStrokes = Vec[][];

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Points sampled along an outline at a step, split into lines where the outline jumps from one place to another, as at
 * the start of each part of a path.
 */
export function splitAtJumps(samples: Vec[], step: number): Vec[][] {
  const out: Vec[][] = [];
  let line: Vec[] = [];
  for (const p of samples) {
    if (line.length && dist(line[line.length - 1], p) > step * 1.5) {
      out.push(line);
      line = [];
    }
    line.push(p);
  }
  if (line.length) out.push(line);
  return out;
}

/** The fewest points that keep a line within a distance of the one it was: the Ramer–Douglas–Peucker algorithm. */
export function simplify(points: Vec[], tolerance: number): Vec[] {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  const len = dist(a, b);
  let far = 0;
  let at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = len ? Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len : dist(a, p);
    if (d > far) [far, at] = [d, i];
  }
  if (far <= tolerance) return [a, b];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

/**
 * The strokes of an icon from the lines sampled along its outlines, in the units of its view box: simplified, a line
 * hardly longer than a point made a dot, a line ending where it starts closed exactly, and all scaled into a square of
 * side 1.
 */
export function iconStrokes(lines: Vec[][], viewBox: { x: number; y: number; width: number; height: number }, tolerance: number): IconStrokes {
  const side = Math.max(viewBox.width, viewBox.height) || 1;
  const unit = (p: Vec): Vec => ({ x: (p.x - viewBox.x) / side, y: (p.y - viewBox.y) / side });
  const out: IconStrokes = [];
  for (const line of lines) {
    if (!line.length) continue;
    const xs = line.map((p) => p.x);
    const ys = line.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) < tolerance * 4 && Math.max(...ys) - Math.min(...ys) < tolerance * 4) {
      out.push([unit({ x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 })]);
      continue;
    }
    const pts = simplify(line, tolerance);
    if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < tolerance * 2) pts[pts.length - 1] = pts[0];
    out.push(pts.map(unit));
  }
  return out;
}
