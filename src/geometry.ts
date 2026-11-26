// Geometry of boxes and points on the canvas: where boxes are, how they keep apart and make way for one another, and
// where the lines between them run. Pure, with no dependencies.

export interface Vec {
  x: number;
  y: number;
}

export interface Box extends Vec {
  width: number;
  height: number;
}

export const center = (b: Box): Vec => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** The smallest box around the boxes, grown by a margin; null for none. */
export function bounds(boxes: Box[], margin = 0): Box | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)) - margin;
  const y = Math.min(...boxes.map((b) => b.y)) - margin;
  const r = Math.max(...boxes.map((b) => b.x + b.width)) + margin;
  const btm = Math.max(...boxes.map((b) => b.y + b.height)) + margin;
  return { x, y, width: r - x, height: btm - y };
}

/** Whether a point lies in a box, its edges included. */
export const contains = (outer: Box, p: Vec) => p.x >= outer.x && p.x <= outer.x + outer.width && p.y >= outer.y && p.y <= outer.y + outer.height;

/**
 * How the drawing around an element makes way when the element grows from `from` to `to`, as when a layer opens in
 * its place: what lies beyond an edge of the element moves as far as that edge did.
 */
export function makeWay(from: Box, to: Box) {
  const right = from.x + from.width;
  const bottom = from.y + from.height;
  const dx = (x: number) => (x >= right ? to.x + to.width - right : x <= from.x ? to.x - from.x : 0);
  const dy = (y: number) => (y >= bottom ? to.y + to.height - bottom : y <= from.y ? to.y - from.y : 0);
  return {
    /** How far a box moves, going by its center. */
    move: (b: Box): Vec => {
      const c = center(b);
      return { x: dx(c.x), y: dy(c.y) };
    },
    /**
     * How far a box moves to keep where it is around the element, going by its center: beyond an edge as `move` does,
     * alongside the element at the same share of the way along it. Unlike `move`, it follows the element wherever it
     * goes, and never jumps as a box comes past an edge.
     */
    follow: (b: Box): Vec => {
      const along = (c: number, f0: number, fSize: number, t0: number, tSize: number) => {
        if (c <= f0) return c + t0 - f0;
        if (c >= f0 + fSize) return c + t0 + tSize - f0 - fSize;
        return t0 + ((c - f0) / fSize) * tSize;
      };
      const c = center(b);
      return { x: along(c.x, from.x, from.width, to.x, to.width) - c.x, y: along(c.y, from.y, from.height, to.y, to.height) - c.y };
    },
    /** A box around the element, stretched edge by edge: an enclosing boundary grows with it. */
    stretch: (b: Box): Box => {
      const x = b.x + dx(b.x);
      const y = b.y + dy(b.y);
      return { x, y, width: b.x + b.width + dx(b.x + b.width) - x, height: b.y + b.height + dy(b.y + b.height) - y };
    },
  };
}

/**
 * The way back from `makeWay`: where a box drawn around the grown element `to` goes when the element shrinks back to
 * `from`, as when an element added to a layer is copied one level up. Beyond an edge it moves back as far as the edge
 * did; alongside the element it stays, but no further out than the element's own edge.
 */
export function wayBack(from: Box, to: Box) {
  const axis = (c: number, f0: number, fSize: number, t0: number, tSize: number) => {
    if (c >= t0 + tSize) return c - (t0 + tSize - (f0 + fSize));
    if (c <= t0) return c - (t0 - f0);
    return Math.min(f0 + fSize, Math.max(f0, c));
  };
  return (b: Box): Vec => {
    const c = center(b);
    return {
      x: axis(c.x, from.x, from.width, to.x, to.width) - b.width / 2,
      y: axis(c.y, from.y, from.height, to.y, to.height) - b.height / 2,
    };
  };
}

export type Direction = "up" | "down" | "left" | "right";

/**
 * The box to go to from a place in a direction: the nearest one whose center lies that way, going more by the distance
 * along the direction than across it, so the one straight ahead wins over one off to the side. Undefined for none.
 */
export function nearestIn<B extends Box>(boxes: readonly B[], from: Vec, dir: Direction): B | undefined {
  const [ax, ay] = dir === "left" ? [-1, 0] : dir === "right" ? [1, 0] : dir === "up" ? [0, -1] : [0, 1];
  let best: B | undefined;
  let bestScore = Infinity;
  for (const b of boxes) {
    const c = center(b);
    const along = (c.x - from.x) * ax + (c.y - from.y) * ay;
    const across = Math.abs((c.x - from.x) * ay - (c.y - from.y) * ax);
    // Ahead, within 60 degrees either side of the direction.
    if (along <= 1 || across > along * 1.75) continue;
    const score = along + 2 * across;
    if (score < bestScore) [best, bestScore] = [b, score];
  }
  return best;
}

/** Whether two boxes overlap, or come closer than the gap. */
export const overlaps = (a: Box, b: Box, gap = 0) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/** Where a box goes to keep the gap from an obstacle: the shortest move left, right, up or down. */
export function pushOut(box: Box, obstacle: Box, gap: number): Vec {
  if (!overlaps(box, obstacle, gap)) return { x: box.x, y: box.y };
  const moves: Vec[] = [
    { x: obstacle.x - gap - box.width, y: box.y },
    { x: obstacle.x + obstacle.width + gap, y: box.y },
    { x: box.x, y: obstacle.y - gap - box.height },
    { x: box.x, y: obstacle.y + obstacle.height + gap },
  ];
  const dist = (p: Vec) => Math.abs(p.x - box.x) + Math.abs(p.y - box.y);
  return moves.reduce((a, b) => (dist(b) < dist(a) ? b : a));
}

/**
 * The free place nearest to where a box would go, keeping half the gap from every box taken: where it is, or the
 * nearest one on a grid of half its size and the gap around it, in any direction. A move along a row costs less than one
 * across, and of two places as near, the one right or below wins, so that the box stays in sight near where it was
 * asked for rather than past everything in its row.
 */
export function nearestFree(box: Box, taken: Box[], gap: number, rings = 16): Vec {
  const free = (p: Vec) => !taken.some((t) => overlaps({ ...box, ...p }, t, gap / 2));
  if (free(box)) return { x: box.x, y: box.y };
  const sx = (box.width + gap) / 2;
  const sy = (box.height + gap) / 2;
  let best: Vec | null = null;
  let bestCost = Infinity;
  for (let i = -rings; i <= rings; i++) {
    for (let j = -rings; j <= rings; j++) {
      const cost = Math.abs(i * sx) + 1.5 * Math.abs(j * sy) - (i > 0 ? 0.2 : 0) - (j > 0 ? 0.1 : 0);
      if (cost >= bestCost) continue;
      const p = { x: box.x + i * sx, y: box.y + j * sy };
      if (free(p)) [best, bestCost] = [p, cost];
    }
  }
  // None near enough: right of everything.
  return best ?? { x: Math.max(...taken.map((t) => t.x + t.width)) + gap, y: box.y };
}

/** Middle of an arrow, where its label goes: halfway along a straight arrow, else its middle point. */
export function arrowMidpoint(arrow: Vec & { points?: number[][] }): Vec {
  const pts = arrow.points ?? [];
  if (!pts.length) return { x: arrow.x, y: arrow.y };
  const first = pts[0];
  const last = pts[pts.length - 1];
  const [x = 0, y = 0] = pts.length === 2 ? [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2] : pts[Math.floor(pts.length / 2)];
  return { x: arrow.x + x, y: arrow.y + y };
}

/** Space between relationships drawn side by side between the same two elements. */
const LANE = 36;

/** Offsets across the line between two elements of n relationships between them, centered on the line. */
export const laneOffsets = (n: number, lane = LANE): number[] => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * lane);

/** Where a ray from a point inside the box leaves it. */
export function rayExit(b: Box, p: Vec, dir: Vec): Vec {
  const tx = dir.x > 0 ? (b.x + b.width - p.x) / dir.x : dir.x < 0 ? (b.x - p.x) / dir.x : Infinity;
  const ty = dir.y > 0 ? (b.y + b.height - p.y) / dir.y : dir.y < 0 ? (b.y - p.y) / dir.y : Infinity;
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? { x: p.x + dir.x * t, y: p.y + dir.y * t } : p;
}

/**
 * A relationship's line between two boxes, shifted across the line between their centers by an offset, so that several
 * relationships between the same boxes lie side by side. `normal` is the unit vector the offset goes along; both
 * directions between the same boxes must use the same one. Returns where the line leaves each box and the points inside
 * the boxes it aims at.
 */
export function laneLine(from: Box, to: Box, normal: Vec, offset: number): { start: Vec; end: Vec; aimFrom: Vec; aimTo: Vec } {
  const inside = (b: Box, p: Vec): Vec => ({
    x: Math.min(b.x + b.width * 0.9, Math.max(b.x + b.width * 0.1, p.x)),
    y: Math.min(b.y + b.height * 0.9, Math.max(b.y + b.height * 0.1, p.y)),
  });
  const cf = center(from);
  const ct = center(to);
  const aimFrom = inside(from, { x: cf.x + normal.x * offset, y: cf.y + normal.y * offset });
  const aimTo = inside(to, { x: ct.x + normal.x * offset, y: ct.y + normal.y * offset });
  const dx = aimTo.x - aimFrom.x;
  const dy = aimTo.y - aimFrom.y;
  const len = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / len, y: dy / len };
  return { start: rayExit(from, aimFrom, dir), end: rayExit(to, aimTo, { x: -dir.x, y: -dir.y }), aimFrom, aimTo };
}

/** The unit normal of the line between two points, turned left. */
export function normalOf(a: Vec, b: Vec): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** Where the line from the box's center toward a point leaves the box. */
export function edgePoint(b: Box, toward: Vec): Vec {
  const c = center(b);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const s = Math.min(dx ? b.width / 2 / Math.abs(dx) : Infinity, dy ? b.height / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * s, y: c.y + dy * s };
}
