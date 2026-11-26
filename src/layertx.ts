import { AppState, El, ExcalidrawAutomate, ExcalidrawView, SceneTx, nextVersion } from "./excalidraw";
import { ghostSource, ghostsFor } from "./ghosts";
import { LayerGroups } from "./groups";
import { DiagramId, Scene, boxBindings, endsOf, guarded, markPatches } from "./layers";
import { C4Store, CONTEXT, KEY, Pins, Vec, ViewKind, bounds, elementData, isGhost, partOf, relationshipData, storeData } from "./model";

/** The invisible element keeping the layers that are not on the canvas. */
const findCarrier = (els: readonly El[]): El | undefined => els.find((e) => !e.isDeleted && storeData(e.customData));

/**
 * The selection of elements, as Excalidraw makes it when they are clicked: a box drawn with parts is selected with its
 * group, so that it moves and is deleted with them.
 */
export function selectionOf(els: readonly El[], ids: string[]): Pick<AppState, "selectedElementIds" | "selectedGroupIds"> {
  const selectedElementIds: Record<string, boolean> = {};
  const selectedGroupIds: Record<string, boolean> = {};
  for (const id of ids) {
    selectedElementIds[id] = true;
    const group = els.find((e) => !e.isDeleted && partOf(e.customData) === id)?.groupIds?.[0];
    if (!group) continue;
    selectedGroupIds[group] = true;
    for (const e of els) if (!e.isDeleted && e.groupIds?.includes(group)) selectedElementIds[e.id] = true;
  }
  return { selectedElementIds, selectedGroupIds };
}

/** The layers kept by a drawing, read from its scene. */
export function readStore(els: readonly El[]): C4Store {
  const carrier = findCarrier(els);
  const s = carrier ? storeData(carrier.customData) : null;
  const theme = typeof s?.theme === "string" && s.theme ? { theme: s.theme } : {};
  const pins = s?.pins && typeof s.pins === "object" ? { pins: s.pins } : {};
  return { current: s?.current ?? CONTEXT, views: { [CONTEXT]: null, ...(s?.views ?? {}) }, hidden: s?.hidden ?? {}, ...theme, ...pins };
}

/** The index of every layer of a drawing, read from its scene, and the layer on the canvas. */
export function readScene(els: readonly El[]): { scene: Scene; current: DiagramId } {
  const carrier = findCarrier(els);
  const store = readStore(els);
  const layers = new Map<DiagramId, El[]>(Object.entries(store.hidden).map(([layer, hidden]) => [layer, hidden as El[]]));
  layers.set(store.current, els.filter((e) => e !== carrier && !isGhost(e.customData)));
  return { scene: new Scene(layers, store.views), current: store.current };
}

const lastCarrier = new WeakMap<ExcalidrawView, { path: string | undefined; carrier: El }>();

/**
 * Puts the carrier back when it went missing from the canvas, as after "Unlock all" and a delete: without it, every
 * layer but the current one would be lost.
 */
export function protectStore(view: ExcalidrawView) {
  const api = view.excalidrawAPI;
  if (!api) return;
  const path = view.file?.path;
  const carrier = findCarrier(api.getSceneElements());
  if (carrier) return lastCarrier.set(view, { path, carrier });
  const last = lastCarrier.get(view);
  if (!last || last.path !== path) return;
  const store = storeData(last.carrier.customData);
  if (!store || !Object.keys(store.hidden).length) return;
  const back = { ...last.carrier, isDeleted: false, locked: true, ...nextVersion(last.carrier) };
  const others = api.getSceneElementsIncludingDeleted().filter((e) => e.id !== back.id);
  api.updateScene({ elements: [...others, back], captureUpdate: "NEVER" });
}

/**
 * Elements the plugin took off the canvas, which the guard of the levels above lets go. Only until the guard has seen
 * them deleted: after that, no guard keeps them any more.
 */
const removedByPlugin = new Set<string>();

/**
 * The elements of the levels above on the canvas as they were last seen, to put back when they are deleted, and the
 * relationships glued to them, to glue back.
 */
export interface Guard {
  file: string | undefined; // the drawing and layer they were seen on: on another, nothing is put back
  layer: DiagramId;
  keep: Map<string, El>;
  glued: Map<string, El>;
  relationships: Map<string, [string, string]>; // between two elements, by arrow: the elements they go between
}

/**
 * Puts back the elements of the levels above that were deleted from the layer on the canvas since the last look:
 * they are there for context and are deleted on their own level. With them the relationships glued to them, as they
 * were. Returns the guard for the next look and the names of the elements put back.
 */
export function guardLevels(view: ExcalidrawView, last: Guard | undefined): { guard: Guard; restored: string[]; deleted: [string, string][] } {
  const api = view.excalidrawAPI!;
  const all = api.getSceneElementsIncludingDeleted();
  const byId = new Map(all.map((e) => [e.id, e]));
  const tx = new SceneTx(view);
  const restored: string[] = [];
  const back = new Set<string>();
  const same = last && last.file === view.file?.path && last.layer === readStore(all.filter((e) => !e.isDeleted)).current;
  for (const [id, was] of same ? last.keep : []) {
    const now = byId.get(id);
    // Gone from the canvas altogether is another layer put on it, not a delete.
    if (!now?.isDeleted) continue;
    if (removedByPlugin.delete(id)) continue;
    tx.patch(id, { ...was, isDeleted: false, version: now.version }); // newer than the delete
    back.add(id);
    if (was.containerId) continue;
    const d = elementData(was.customData);
    if (partOf(was.customData)) continue; // put back with its box
    restored.push(d ? d.name.trim() || "Unnamed" : relationshipData(was.customData) ? "A relationship" : was.type === "text" ? "" : "The boundary");
  }
  // The relationships glued to what came back, and what they are glued to, as they were.
  for (const id of back) {
    const snapshot = (x: string) => last!.keep.get(x) ?? last!.glued.get(x);
    for (const ref of snapshot(id)!.boundElements ?? []) {
      const was = snapshot(ref.id);
      const now = tx.get(ref.id);
      if (ref.type !== "arrow" || !was || !now) continue;
      if (now.isDeleted || now.startBinding?.elementId !== was.startBinding?.elementId || now.endBinding?.elementId !== was.endBinding?.elementId) {
        tx.patch(ref.id, { ...was, isDeleted: false, version: now.version });
      }
    }
    const was = snapshot(id)!;
    for (const end of [was.startBinding?.elementId, was.endBinding?.elementId]) {
      const box = end ? tx.get(end) : undefined;
      if (box && !box.boundElements?.some((b) => b.id === id)) tx.patch(box.id, { boundElements: [...(box.boundElements ?? []), { type: "arrow", id }] });
    }
  }
  tx.commit("NEVER");
  // The relationships between two elements the user deleted, and did not get back.
  const deleted: [string, string][] = [];
  for (const [id, ends] of same ? last.relationships : []) {
    // The ones guarded here are put back, or were taken out by the plugin.
    if (back.has(id) || last!.keep.has(id) || !byId.get(id)?.isDeleted) continue;
    if (!removedByPlugin.delete(id)) deleted.push(ends);
  }
  // The ones taken off this drawing that were not guarded: the guard from now on is of what is still there.
  for (const id of removedByPlugin) if (byId.get(id)?.isDeleted) removedByPlugin.delete(id);
  // What to guard from now on: the elements of the levels above, and the relationships glued to them.
  const { scene, current } = readScene(api.getSceneElements());
  const guard: Guard = { file: view.file?.path, layer: current, keep: new Map(), glued: new Map(), relationships: new Map() };
  for (const r of scene.relationships(current)) {
    const ends = endsOf(scene, r.arrow);
    if (ends) guard.relationships.set(r.arrow.id, ends);
  }
  // Copies, not the elements on the canvas: deleting a box, Excalidraw unglues the relationships glued to it in place,
  // which would leave nothing to glue them back by.
  for (const id of guarded(scene, current)) {
    const e = scene.byId.get(id);
    if (!e) continue;
    guard.keep.set(id, structuredClone(e));
    for (const ref of e.boundElements ?? []) {
      const a = ref.type === "arrow" ? scene.byId.get(ref.id) : undefined;
      if (a) guard.glued.set(a.id, structuredClone(a));
    }
  }
  return { guard, restored: restored.filter(Boolean), deleted };
}

/**
 * Brings what the canvas shows about its elements up to date after they changed, as after a drag: relationships
 * dropped onto the name or shape of a box glued to the box, the marks of the boxes that are where they do not belong, the groups fitted to what is in them, and the ghosts of the levels above,
 * whose boundaries fit around what is drawn. Left out of the undo history: undo takes the elements back, and this follows them again.
 */
export function refreshCanvas(view: ExcalidrawView) {
  const api = view.excalidrawAPI;
  if (!api) return;
  const { scene, current } = readScene(api.getSceneElements());
  const pins = readStore(api.getSceneElements()).pins?.[current];
  const tx = new SceneTx(view);
  for (const [id, p] of boxBindings(api.getSceneElements())) tx.patch(id, p);
  for (const [id, p] of markPatches(scene, current)) tx.patch(id, p);
  for (const [id, p] of new LayerGroups(scene, current).patches()) tx.patch(id, p);
  syncGhosts(tx, scene, current, pins);
  tx.commit("NEVER");
}

/** Brings the ghosts of the levels above the layer on the canvas up to date, behind everything else. */
function syncGhosts(tx: SceneTx, scene: Scene, current: DiagramId, pins?: Pins) {
  const fresh = ghostsFor(scene, current, pins);
  const old = tx.live().filter((e) => isGhost(e.customData));
  if (!fresh.length && !old.length) return;
  const keep = new Set(fresh.map((g) => g.id));
  for (const o of old) if (!keep.has(o.id)) tx.delete(o.id);
  // With the links between a box and its text, which a ghost saved by the Obsidian plugin may have lost, and whether
  // it is locked, as ghosts once were.
  const shape = (e: El) => JSON.stringify([
    e.x, e.y, e.width, e.height, e.points, e.text, e.opacity, e.strokeColor, e.backgroundColor, e.containerId ?? null, e.boundElements?.map((b) => b.id) ?? null, !!e.locked,
    e.startBinding?.elementId ?? null, e.endBinding?.elementId ?? null,
  ]);
  const added: El[] = [];
  for (const g of fresh) {
    const o = tx.get(g.id);
    if (!o) added.push(g);
    else if (o.isDeleted || shape(o) !== shape(g)) tx.patch(g.id, { ...g, isDeleted: false });
  }
  if (added.length) tx.insert(added, 0);
  // The boxes drawn in the layer know of the ghost relationships glued to them, for the canvas to move these along
  // with them as they are dragged; of no others.
  const glued = new Map<string, string[]>();
  for (const g of fresh) {
    for (const b of [g.startBinding, g.endBinding]) {
      if (b && !keep.has(b.elementId)) glued.set(b.elementId, [...(glued.get(b.elementId) ?? []), g.id]);
    }
  }
  for (const e of tx.live()) {
    if (isGhost(e.customData) || (!glued.has(e.id) && !e.boundElements?.some((r) => ghostSource(r.id)))) continue;
    const bound = [...(e.boundElements ?? []).filter((r) => !ghostSource(r.id)), ...(glued.get(e.id) ?? []).map((id) => ({ type: "arrow", id }))];
    if (JSON.stringify(bound) !== JSON.stringify(e.boundElements ?? [])) tx.patch(e.id, { boundElements: bound });
  }
}

/** An element without the ghost relationships glued to it, which only the layer on the canvas has. */
const unglued = (e: El): El => (e.boundElements?.some((r) => ghostSource(r.id)) ? { ...e, boundElements: e.boundElements.filter((r) => !ghostSource(r.id)) } : e);

/**
 * A change to any layer of a drawing: the current layer through the scene, the others in the store on the carrier
 * element. Committing applies it all in one updateScene call, so it is one undo step.
 */
export class LayerTx {
  readonly tx: SceneTx;
  private readonly store: Omit<C4Store, "hidden">; // the layers not on the canvas are in `hidden`
  private readonly hidden = new Map<DiagramId, Map<string, El>>();
  private readonly removed: string[] = []; // taken off the canvas
  private carrier: El | undefined;
  private dirty = false;

  constructor(view: ExcalidrawView) {
    this.tx = new SceneTx(view);
    this.carrier = findCarrier(this.tx.live());
    const s = readStore(this.tx.live());
    this.store = { current: s.current, views: { ...s.views }, theme: s.theme, pins: { ...(s.pins ?? {}) } };
    for (const [layer, els] of Object.entries(s.hidden)) this.hidden.set(layer, new Map((els as El[]).map((e) => [e.id, e])));
  }

  get api() {
    return this.tx.api;
  }

  get current(): DiagramId {
    return this.store.current;
  }

  /** The drawing's theme, if it has one yet. */
  get theme(): string | undefined {
    return this.store.theme;
  }

  setTheme(theme: string) {
    if (theme === this.store.theme) return;
    this.store.theme = theme;
    this.dirty = true;
  }

  /** Where the ghosts of the layer on the canvas were moved to by hand. */
  get pins(): Pins {
    return this.store.pins?.[this.current] ?? {};
  }

  /** Keeps the ghost of an element where it was moved to by hand in the layer on the canvas. */
  pin(id: string, at: Vec) {
    this.store.pins = { ...this.store.pins, [this.current]: { ...this.pins, [id]: { x: at.x, y: at.y } } };
    this.dirty = true;
  }

  /** Lets the ghosts of the elements, or all of them, go back to where the layer puts them. */
  unpin(ids?: string[]) {
    const left = ids ? Object.fromEntries(Object.entries(this.pins).filter(([id]) => !ids.includes(id))) : {};
    if (Object.keys(left).length === Object.keys(this.pins).length) return;
    const pins = { ...this.store.pins };
    if (Object.keys(left).length) pins[this.current] = left;
    else delete pins[this.current];
    this.store.pins = pins;
    this.dirty = true;
  }

  hasLayer(layer: DiagramId): boolean {
    return layer in this.store.views;
  }

  addLayer(layer: DiagramId, view: ViewKind) {
    this.store.views[layer] = view;
    if (layer !== this.current && !this.hidden.has(layer)) this.hidden.set(layer, new Map());
    this.dirty = true;
  }

  /** An element of any layer; deleted ones are gone. */
  get(id: string): El | undefined {
    const e = this.tx.get(id);
    if (e) return e.isDeleted ? undefined : e;
    for (const m of this.hidden.values()) {
      const h = m.get(id);
      if (h) return h;
    }
    return undefined;
  }

  patch(id: string, p: Partial<El>) {
    if (this.tx.get(id)) return this.tx.patch(id, p);
    for (const m of this.hidden.values()) {
      const e = m.get(id);
      if (!e) continue;
      m.set(id, { ...e, ...p, ...nextVersion(e) });
      this.dirty = true;
      return;
    }
  }

  /** The parts drawing a box's shape, in the box's layer, back to front. */
  partsOf(boxId: string): El[] {
    const layers = this.tx.get(boxId) ? [this.tx.live()] : [...this.hidden.values()].filter((m) => m.has(boxId)).map((m) => [...m.values()]);
    return layers.flat().filter((e) => !e.isDeleted && partOf(e.customData) === boxId);
  }

  /** Adds an element right behind another one, in that one's layer. */
  addBehind(el: El, id: string) {
    this.addNextTo(el, id, 0);
  }

  /** Adds an element right in front of another one, in that one's layer. */
  addInFront(el: El, id: string) {
    this.addNextTo(el, id, 1);
  }

  /** Adds an element next to another one, in that one's layer: right behind it (`after` 0) or right in front of it (1). */
  private addNextTo(el: El, id: string, after: 0 | 1) {
    if (this.tx.get(id)) return after ? this.tx.addInFront(el, id) : this.tx.addBehind(el, id);
    for (const [layer, m] of this.hidden) {
      if (!m.has(id)) continue;
      const entries = [...m.entries()];
      entries.splice(entries.findIndex(([k]) => k === id) + after, 0, [el.id, el]);
      this.hidden.set(layer, new Map(entries));
      this.dirty = true;
      return;
    }
  }

  /** Takes an element out of its layer. */
  remove(id: string) {
    if (this.tx.get(id)) {
      removedByPlugin.add(id);
      this.removed.push(id);
      return this.tx.delete(id);
    }
    for (const m of this.hidden.values()) {
      if (m.delete(id)) this.dirty = true;
    }
  }

  add(el: El, layer: DiagramId = this.current) {
    if (layer === this.current) return this.tx.add(el);
    const m = this.hidden.get(layer) ?? new Map<string, El>();
    m.set(el.id, el);
    this.hidden.set(layer, m);
    this.dirty = true;
  }

  /** The live elements of a layer, without the carrier and the ghosts of the levels above. */
  elements(layer: DiagramId): El[] {
    if (layer === this.current) return this.tx.live().filter((e) => e.id !== this.carrier?.id && !isGhost(e.customData));
    return [...(this.hidden.get(layer)?.values() ?? [])].filter((e) => !e.isDeleted);
  }

  scene(): Scene {
    return new Scene(new Map(Object.keys(this.store.views).map((l) => [l, this.elements(l)])), this.store.views);
  }

  private storeValue(): C4Store {
    const hidden: Record<string, El[]> = {};
    for (const [layer, m] of this.hidden) if (layer !== this.current) hidden[layer] = [...m.values()].filter((e) => !e.isDeleted);
    const pins = Object.fromEntries(Object.entries(this.store.pins ?? {}).filter(([layer, p]) => layer in this.store.views && Object.keys(p).length));
    return {
      current: this.current,
      views: this.store.views,
      hidden,
      ...(this.store.theme ? { theme: this.store.theme } : {}),
      ...(Object.keys(pins).length ? { pins } : {}),
    };
  }

  /** The carrier with the store, at the top left of the layer on the canvas so it never widens an export. */
  private carrierFor(ea: ExcalidrawAutomate, visible: El[]): El {
    const at = bounds(visible.filter((e) => !e.containerId)) ?? { x: 0, y: 0 };
    const customData = { [KEY]: { store: this.storeValue() } };
    if (this.carrier) {
      const c = this.carrier;
      return { ...c, x: at.x, y: at.y, customData, ...nextVersion(c) };
    }
    ea.clear();
    const id = ea.addRect(at.x, at.y, 1, 1);
    const el = ea.getElement(id);
    Object.assign(el, { opacity: 0, locked: true, strokeColor: "transparent", backgroundColor: "transparent", customData });
    return el;
  }

  /**
   * Marks the boxes of every layer that are where they do not belong, and unmarks the others; fits every group to what
   * is in it.
   */
  private mark() {
    const scene = this.scene();
    for (const layer of Object.keys(this.store.views)) {
      for (const [id, p] of markPatches(scene, layer)) this.patch(id, p);
      for (const [id, p] of new LayerGroups(scene, layer).patches()) this.patch(id, p);
    }
  }

  /** Applies the change to the canvas and the store. */
  commit(ea: ExcalidrawAutomate) {
    this.mark();
    const scene = this.scene();
    // A ghost no more: its element is drawn in the layer now, or gone.
    this.unpin(Object.keys(this.pins).filter((id) => !scene.element(id) || scene.boxIn(id, this.current)));
    syncGhosts(this.tx, scene, this.current, this.pins);
    if (this.dirty) {
      const carrier = this.carrierFor(ea, this.elements(this.current));
      if (this.carrier) this.tx.patch(carrier.id, { x: carrier.x, y: carrier.y, customData: carrier.customData });
      else this.tx.add(carrier);
    }
    this.tx.commit();
  }

  /**
   * Applies the change and puts another layer on the canvas, keeping the current one in the store. Undo cannot cross
   * layers, so the undo history starts over.
   */
  switchTo(ea: ExcalidrawAutomate, layer: DiagramId, selected: string[] = []) {
    this.mark();
    // What was taken off the layer leaves the canvas with it, and the guard starts over on the other layer.
    if (layer !== this.current) for (const id of this.removed) removedByPlugin.delete(id);
    const leaving = this.elements(this.current).map(unglued);
    const arriving = this.elements(layer);
    this.hidden.set(this.current, new Map(leaving.map((e) => [e.id, e])));
    this.hidden.delete(layer);
    this.store.current = layer;
    const carrier = this.carrierFor(ea, arriving);
    const layers = new Map<DiagramId, El[]>(Object.keys(this.store.views).map((l) => [l, l === layer ? arriving : this.elements(l)]));
    const ghosts = ghostsFor(new Scene(layers, this.store.views), layer, this.pins);
    this.api.updateScene({
      elements: [...ghosts, ...arriving, carrier],
      appState: selectionOf([...ghosts, ...arriving], selected),
      captureUpdate: "NEVER",
    });
    this.api.history?.clear();
  }
}
