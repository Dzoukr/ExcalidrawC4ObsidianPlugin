import { El, ExcalidrawAutomate, ExcalidrawView, SceneTx } from "./excalidraw";
import { ghostsFor } from "./ghosts";
import { DiagramId, Scene } from "./layers";
import { C4Store, CONTEXT, KEY, ViewKind, bounds, isGhost, storeData } from "./model";

const randomNonce = () => Math.floor(Math.random() * 2 ** 31);

/** The invisible element keeping the layers that are not on the canvas. */
export const findCarrier = (els: readonly El[]): El | undefined => els.find((e) => !e.isDeleted && storeData(e.customData));

/** The layers kept by a drawing, read from its scene. */
export function readStore(els: readonly El[]): C4Store {
  const carrier = findCarrier(els);
  const s = carrier ? storeData(carrier.customData) : null;
  return { current: s?.current ?? CONTEXT, views: { [CONTEXT]: null, ...(s?.views ?? {}) }, hidden: s?.hidden ?? {} };
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
  const back = { ...last.carrier, isDeleted: false, locked: true, version: (last.carrier.version ?? 0) + 1, versionNonce: randomNonce() };
  const others = api.getSceneElementsIncludingDeleted().filter((e) => e.id !== back.id);
  api.updateScene({ elements: [...others, back], captureUpdate: "NEVER" });
}

/**
 * A change to any layer of a drawing: the current layer through the scene, the others in the store on the carrier
 * element. Committing applies it all in one updateScene call, so it is one undo step.
 */
export class LayerTx {
  readonly tx: SceneTx;
  private readonly store: C4Store;
  private readonly hidden = new Map<DiagramId, Map<string, El>>();
  private carrier: El | undefined;
  private dirty = false;

  constructor(view: ExcalidrawView) {
    this.tx = new SceneTx(view);
    this.carrier = findCarrier(this.tx.live());
    const s = readStore(this.tx.live());
    this.store = { current: s.current, views: { ...s.views }, hidden: {} };
    for (const [layer, els] of Object.entries(s.hidden)) this.hidden.set(layer, new Map((els as El[]).map((e) => [e.id, e])));
  }

  get api() {
    return this.tx.api;
  }

  get current(): DiagramId {
    return this.store.current;
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
      m.set(id, { ...e, ...p, version: (e.version ?? 0) + 1, versionNonce: randomNonce(), updated: Date.now() });
      this.dirty = true;
      return;
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
    return { current: this.current, views: this.store.views, hidden };
  }

  /** The carrier with the store, at the top left of the layer on the canvas so it never widens an export. */
  private carrierFor(ea: ExcalidrawAutomate, visible: El[]): El {
    const at = bounds(visible.filter((e) => !e.containerId)) ?? { x: 0, y: 0 };
    const customData = { [KEY]: { store: this.storeValue() } };
    if (this.carrier) {
      const c = this.carrier;
      return { ...c, x: at.x, y: at.y, customData, version: (c.version ?? 0) + 1, versionNonce: randomNonce(), updated: Date.now() };
    }
    ea.clear();
    const id = ea.addRect(at.x, at.y, 1, 1);
    const el = ea.getElement(id);
    Object.assign(el, { opacity: 0, locked: true, strokeColor: "transparent", backgroundColor: "transparent", customData });
    return el;
  }

  /** Brings the ghosts of the levels above up to date with the change, behind everything else. */
  private syncGhosts() {
    const fresh = ghostsFor(this.scene(), this.current);
    const old = this.tx.live().filter((e) => isGhost(e.customData));
    if (!fresh.length && !old.length) return;
    const keep = new Set(fresh.map((g) => g.id));
    for (const o of old) if (!keep.has(o.id)) this.tx.delete(o.id);
    const shape = (e: El) => JSON.stringify([e.x, e.y, e.width, e.height, e.points, e.text, e.opacity, e.strokeColor, e.backgroundColor]);
    const added: El[] = [];
    for (const g of fresh) {
      const o = this.tx.get(g.id);
      if (!o) added.push(g);
      else if (o.isDeleted || shape(o) !== shape(g)) this.tx.patch(g.id, { ...g, isDeleted: false });
    }
    if (added.length) this.tx.insert(added, 0);
  }

  /** Applies the change to the canvas and the store. */
  commit(ea: ExcalidrawAutomate) {
    this.syncGhosts();
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
    const leaving = this.elements(this.current);
    const arriving = this.elements(layer);
    this.hidden.set(this.current, new Map(leaving.map((e) => [e.id, e])));
    this.hidden.delete(layer);
    this.store.current = layer;
    const carrier = this.carrierFor(ea, arriving);
    const layers = new Map<DiagramId, El[]>(Object.keys(this.store.views).map((l) => [l, l === layer ? arriving : this.elements(l)]));
    const ghosts = ghostsFor(new Scene(layers, this.store.views), layer);
    this.api.updateScene({
      elements: [...ghosts, ...arriving, carrier],
      appState: { selectedElementIds: Object.fromEntries(selected.map((id) => [id, true])) },
      captureUpdate: "NEVER",
    });
    this.api.history?.clear();
  }
}
