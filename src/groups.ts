// Groups: dotted boxes around the elements of one layer that belong together, such as the containers of a
// microservice, nested in one another. A group is shown only in its own layer.
// Pure: works on plain element data, no Obsidian or Excalidraw runtime.

import type { El } from "./excalidraw";
import { FONT_SIZE, bounds, center, contains, fittedGroup, groupData, groupLabelAt, partOf } from "./model.ts"; // with its extension, for the tests running in Node
import type { Box, C4Group, Vec } from "./model.ts";
import type { DiagramId, Scene } from "./layers.ts";

/** A group as drawn: its box carrying its data, and its label. */
export interface Group {
  rect: El;
  label?: El;
  data: C4Group;
}

/** Whether an element is a group's box or its label. */
export const isGroupElement = (byId: ReadonlyMap<string, El>, e: El): boolean => {
  if (groupData(e.customData)) return true;
  const part = partOf(e.customData);
  const owner = part ? byId.get(part) : undefined;
  return !!owner && !!groupData(owner.customData);
};

const same = (a: number, b: number) => Math.abs(a - b) < 0.5;

/**
 * The font size and size of a group's label in the font size it is drawn in: Excalidraw scales the label with the box
 * when the two are resized together, and the size of a text goes with its font size.
 */
export function labelSize(label: El): { fontSize: number; width: number; height: number } {
  const r = label.fontSize ? FONT_SIZE / label.fontSize : 1;
  return { fontSize: FONT_SIZE, width: label.width * r, height: label.height * r };
}

/** The groups of a layer and how they nest. */
export class LayerGroups {
  readonly all: Group[] = [];
  private readonly byGroup = new Map<string, Group>();
  private readonly scene: Scene;
  readonly layer: DiagramId;

  constructor(scene: Scene, layer: DiagramId) {
    this.scene = scene;
    this.layer = layer;
    for (const e of scene.elementsIn(layer)) {
      const data = e.containerId ? null : groupData(e.customData);
      if (!data) continue;
      const g: Group = { rect: e, label: scene.parts(e.id).find((p) => p.type === "text"), data };
      this.all.push(g);
      if (!this.byGroup.has(data.group)) this.byGroup.set(data.group, g);
    }
  }

  /** The group with the id. */
  get(id: string | undefined): Group | undefined {
    return id ? this.byGroup.get(id) : undefined;
  }

  /** The group of the box. */
  ofRect(rectId: string): Group | undefined {
    return this.all.find((g) => g.rect.id === rectId);
  }

  /** The group a group is nested in, when it is in the layer; a group nested in itself, round a cycle, is in none. */
  parent(g: Group): Group | undefined {
    const p = this.get(g.data.parent);
    const seen = new Set<Group>();
    for (let q = p; q && !seen.has(q); q = this.get(q.data.parent)) {
      if (q === g) return undefined;
      seen.add(q);
    }
    return p;
  }

  /** The groups a group is in, innermost first. */
  ancestors(g: Group): Group[] {
    const out: Group[] = [];
    for (let p = this.parent(g); p && !out.includes(p) && p !== g; p = this.parent(p)) out.push(p);
    return out;
  }

  /** The groups nested right in a group. */
  children(g: Group): Group[] {
    return this.all.filter((c) => c !== g && this.parent(c) === g);
  }

  /** The group and every group nested in it, at any depth. */
  within(g: Group): Group[] {
    return this.all.filter((c) => c === g || this.ancestors(c).includes(g));
  }

  /** The boxes of the elements right in a group, those drawn in the layer. */
  memberBoxes(g: Group): El[] {
    return g.data.members.flatMap((id) => {
      const b = this.scene.boxIn(id, this.layer);
      return b ? [b] : [];
    });
  }

  /** The boxes of the elements in a group and in the groups nested in it. */
  leafBoxes(g: Group): El[] {
    return this.within(g).flatMap((c) => this.memberBoxes(c));
  }

  /** The group an element is right in, if any. */
  groupOf(id: string): Group | undefined {
    return this.all.find((g) => g.data.members.includes(id));
  }

  /** What a box takes up with the parts of its shape, such as the head of a person. */
  extent(box: El): Box {
    return bounds([box, ...this.scene.parts(box.id)])!;
  }

  /** Every group fitted to what is in it, by the id of its box: the groups nested in it first. */
  fitted(): Map<string, Box> {
    const out = new Map<string, Box>();
    const fit = (g: Group): Box => {
      const known = out.get(g.rect.id);
      if (known) return known;
      out.set(g.rect.id, g.rect); // until fitted, for a cycle
      const inner = [...this.memberBoxes(g).map((b) => this.extent(b)), ...this.children(g).map(fit)];
      const b = fittedGroup(g.rect, inner, g.label && labelSize(g.label));
      out.set(g.rect.id, b);
      return b;
    };
    for (const g of this.all) fit(g);
    return out;
  }

  /**
   * The changes that fit every group to what is in it, and keep its label at its bottom left corner, in the font size
   * it is drawn in.
   */
  patches(): [string, Partial<El>][] {
    const fitted = this.fitted();
    const out: [string, Partial<El>][] = [];
    for (const g of this.all) {
      const b = fitted.get(g.rect.id)!;
      if (!(["x", "y", "width", "height"] as const).every((k) => same(b[k], g.rect[k]))) out.push([g.rect.id, b]);
      if (!g.label) continue;
      const size = labelSize(g.label);
      const at = groupLabelAt(b, size);
      const scaled = !!g.label.fontSize && g.label.fontSize !== FONT_SIZE;
      if (scaled || !same(at.x, g.label.x) || !same(at.y, g.label.y)) out.push([g.label.id, scaled ? { ...at, ...size } : at]);
    }
    return out;
  }

  /**
   * The innermost group whose box holds a point, leaving some groups out, as one being dropped and the groups in it:
   * the one nested deepest, else the smallest.
   */
  at(p: Vec, except: ReadonlySet<Group> = new Set()): Group | undefined {
    const under = this.all.filter((g) => !except.has(g) && contains(g.rect, p));
    const depth = (g: Group) => this.ancestors(g).length;
    return under.sort((a, b) => depth(b) - depth(a) || a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
  }

  /** The group a box dropped where it is now belongs in, by its center. */
  dropTarget(box: Box, except: ReadonlySet<Group> = new Set()): Group | undefined {
    return this.at(center(box), except);
  }

  /**
   * The groups whose elements are all among the boxes, fitted, with at least one in them: what a boundary around
   * those boxes holds too.
   */
  around(boxIds: ReadonlySet<string>): Box[] {
    const fitted = this.fitted();
    return this.all.filter((g) => {
      const leaves = this.leafBoxes(g);
      return leaves.length > 0 && leaves.every((b) => boxIds.has(b.id));
    }).map((g) => fitted.get(g.rect.id)!);
  }
}
