// The lanes of the straight relationships between two boxes, side by side so that they do not lie on top of each other.
// The canvas lays out the arrows of a layer with them, and the ghosts of the levels above the same way.
// Pure: works on plain boxes, no Obsidian or Excalidraw runtime.

import { center, laneLine, laneOffsets, normalOf } from "./model.ts";
import type { Box, Vec } from "./model.ts";

/** One end of a pair of boxes: where it is drawn, its element id, and the arrows glued to it, in their order. */
export interface LaneEnd extends Box {
  id: string;
  boundElements?: readonly { id: string; type: string }[] | null;
}

/** A relationship arrow between the two boxes of a pair: its id, and the element id of the box it starts at. */
export interface LaneArrow {
  id: string;
  from: string;
}

/**
 * The line of one relationship: where it leaves the box it starts at and the one it ends at, the points inside them it
 * aims at, and those two boxes.
 */
export interface Lane {
  start: Vec;
  end: Vec;
  aimFrom: Vec;
  aimTo: Vec;
  from: LaneEnd;
  to: LaneEnd;
}

/** The two boxes of a pair in the order their lanes are laid out from: by element id, the same for arrows either way. */
export const pairOrder = <E extends { id: string }>(a: E, b: E): [E, E] => (a.id.localeCompare(b.id) <= 0 ? [a, b] : [b, a]);

/**
 * Lays out the straight relationships between two boxes side by side, in both directions, so that arrows either way
 * share one set of lanes: across the line from the first box of the pair to the other, in the order the arrows are
 * glued to that first box, arrows it does not know of last. Returns the lane of each arrow, by its id.
 */
export function pairLanes(a: LaneEnd, b: LaneEnd, arrows: readonly LaneArrow[]): Map<string, Lane> {
  const [first, second] = pairOrder(a, b);
  const glued = (first.boundElements ?? []).map((r) => r.id);
  const rank = (id: string) => {
    const i = glued.indexOf(id);
    return i < 0 ? glued.length : i;
  };
  const ordered = [...arrows].sort((p, q) => rank(p.id) - rank(q.id));
  const normal = normalOf(center(first), center(second));
  const offsets = laneOffsets(ordered.length);
  return new Map(ordered.map((arrow, i) => {
    const from = arrow.from === first.id ? first : second;
    const to = from === first ? second : first;
    return [arrow.id, { ...laneLine(from, to, normal, offsets[i]), from, to }];
  }));
}

/** An arrow drawn along a lane, as a straight line of two points from where it starts. */
export function arrowAlong(lane: { start: Vec; end: Vec }): { x: number; y: number; points: number[][]; width: number; height: number } {
  const dx = lane.end.x - lane.start.x;
  const dy = lane.end.y - lane.start.y;
  return { x: lane.start.x, y: lane.start.y, points: [[0, 0], [dx, dy]], width: Math.abs(dx), height: Math.abs(dy) };
}

/** Where the label of an arrow along a lane goes: with its middle at the middle of the line. */
export function labelOn(lane: { start: Vec; end: Vec }, label: { width: number; height: number }): Vec {
  const dx = lane.end.x - lane.start.x;
  const dy = lane.end.y - lane.start.y;
  return { x: lane.start.x + dx / 2 - label.width / 2, y: lane.start.y + dy / 2 - label.height / 2 };
}
