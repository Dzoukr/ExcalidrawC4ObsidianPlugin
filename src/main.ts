import { App, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, setIcon } from "obsidian";
import {
  Selected, SelectedRelationship, addElement, addRelationship, canAdd, canEdit, canRelate, deleteBelow, diagramInfo, dropBoxes, isRelationship, itemAt, itemOf, reverseRelationship,
  selectedElements, selectedItem, updateElement, updateRelationship, zoomIn, zoomOut,
} from "./actions";
import { Guard, guardLevels, protectStore, refreshCanvas } from "./layertx";
import { AppState, El, ExcalidrawAPI, ExcalidrawView, VIEW_TYPE_EXCALIDRAW, isExcalidrawView } from "./excalidraw";
import { C4Kind, KINDS, Vec, boundaryData, canBeExternal, cleanMetadata, elementData, hasTechnology, kindTitle, levelOf } from "./model";
import { C4Panel, PANEL_POSITIONS, PanelPosition, isPanelPosition } from "./panel";

const NO_EXCALIDRAW = "The Excalidraw plugin's scripting API is not available.";

interface Settings {
  showPanel: boolean;
  panelPosition: PanelPosition;
}

const DEFAULT_SETTINGS: Settings = { showPanel: true, panelPosition: "right" };

interface ViewState {
  view: ExcalidrawView;
  api: ExcalidrawAPI;
  panel: C4Panel;
  unsubscribe?: () => void;
  raf: number;
  selection: unknown; // the selection the panel shows, to refresh it only when the selection changes
  viewMode: boolean | undefined;
  drag?: Map<string, Vec>; // where the C4 boxes were when the pointer went down on the drawing, until it goes up
  revision: number; // of the elements last checked for misplaced boxes
  guard?: Guard; // the elements of the levels above, put back when deleted
}

const ATTACH_RETRIES = 50;

export default class ExcalidrawC4Plugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;
  private states = new Map<ExcalidrawView, ViewState>();
  private retries = new WeakMap<ExcalidrawView, number>();
  private retryTimer = 0;

  async onload() {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    if (!isPanelPosition(this.settings.panelPosition)) this.settings.panelPosition = DEFAULT_SETTINGS.panelPosition;
    this.addSettingTab(new C4SettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncViews()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncViews()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.syncViews()));
    this.app.workspace.onLayoutReady(() => this.syncViews());
    // Enter or a double-click on a C4 element or relationship opens its form instead of Excalidraw's text editing.
    this.registerDomEvent(window, "keydown", (e) => this.onEnter(e), { capture: true });
    this.registerDomEvent(window, "dblclick", (e) => this.onDoubleClick(e), { capture: true });
    // A box dragged into another system or container moves into it; one dragged out of its boundary is marked.
    this.registerDomEvent(window, "pointerdown", (e) => this.onPointerDown(e), { capture: true });
    this.registerDomEvent(window, "pointerup", () => this.onPointerUp(), { capture: true });
    this.registerDomEvent(window, "pointercancel", () => this.onPointerUp(), { capture: true });

    for (const kind of KINDS) {
      for (const external of canBeExternal(kind) ? [false, true] : [false]) {
        this.addCommand({
          id: `add-${external ? "external-" : ""}${kind}`,
          name: `Add ${kindTitle(kind, external).toLowerCase()}`,
          checkCallback: (checking) => this.withView(checking, (view) => this.promptElement(view, kind, external)),
        });
      }
    }
    this.addCommand({
      id: "add-relationship",
      name: "Add relationship between the two selected elements",
      checkCallback: (checking) =>
        this.withView(checking, (view) => this.promptRelationship(view), (view) => !!selectedPair(view)),
    });
    this.addCommand({
      id: "edit-selected",
      name: "Edit selected element or relationship",
      checkCallback: (checking) => this.withView(checking, (view) => this.promptEdit(view), (view) => !!editableItem(view)),
    });
    this.addCommand({
      id: "reverse-relationship",
      name: "Reverse direction of selected relationship",
      checkCallback: (checking) => this.withView(checking, (view) => this.reverse(view), (view) => !!selectedRelationship(view)),
    });
    this.addCommand({
      id: "zoom-in",
      name: "Zoom into the selected system or container",
      checkCallback: (checking) => this.withView(checking, (view) => this.zoomIn(view), (view) => diagramInfo(view).zoomIn),
    });
    this.addCommand({
      id: "zoom-out",
      name: "Zoom out to the layer one level up",
      checkCallback: (checking) => this.withView(checking, (view) => this.zoomOut(view), (view) => !!diagramInfo(view).zoomOut),
    });
  }

  /** The drawing in the active tab, while it is being edited rather than only viewed. */
  private editedView(): ExcalidrawView | null {
    const view = this.app.workspace.getActiveViewOfType(ItemView);
    if (!isExcalidrawView(view) || !view.excalidrawAPI) return null;
    const s = view.excalidrawAPI.getAppState();
    return s.viewModeEnabled || s.editingTextElement ? null : view;
  }

  private onEnter(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.isComposing || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const view = this.editedView();
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!view || target?.closest("input, textarea, [contenteditable='true'], .modal-container")) return;
    if (target && target !== activeDocument.body && !view.contentEl.contains(target)) return;
    if (!selectedItem(view)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.promptEdit(view);
  }

  private onDoubleClick(e: MouseEvent) {
    const view = this.editedView();
    if (!view || !(e.target instanceof HTMLCanvasElement) || !view.contentEl.contains(e.target)) return;
    const api = view.excalidrawAPI!;
    const s = api.getAppState();
    const zoom = s.zoom?.value ?? 1;
    const at = { x: (e.clientX - (s.offsetLeft ?? 0)) / zoom - s.scrollX, y: (e.clientY - (s.offsetTop ?? 0)) / zoom - s.scrollY };
    const el = itemAt(view, at);
    const item = el && itemOf(el);
    if (!item) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    api.updateScene({ appState: { selectedElementIds: { [item.el.id]: true } }, captureUpdate: "NEVER" });
    // The selection reaches the app state only later.
    this.promptEdit(view, item);
  }

  private onPointerDown(e: PointerEvent) {
    if (!(e.target instanceof Node)) return;
    for (const s of this.states.values()) {
      if (!s.view.contentEl.contains(e.target)) continue;
      s.drag = new Map(boxesOf(s.api.getSceneElements()).map((b) => [b.id, { x: b.x, y: b.y }]));
    }
  }

  private onPointerUp() {
    for (const s of this.states.values()) {
      const before = s.drag;
      if (!before) continue;
      s.drag = undefined;
      // After Excalidraw has finished the drag.
      window.setTimeout(() => this.afterDrag(s, before), 0);
    }
  }

  private afterDrag(s: ViewState, before: Map<string, Vec>) {
    if (!this.states.has(s.view) || s.api.getAppState().viewModeEnabled) return;
    const moved = boxesOf(s.api.getSceneElements()).filter((b) => {
      const was = before.get(b.id);
      return was && (Math.abs(was.x - b.x) > 0.5 || Math.abs(was.y - b.y) > 0.5);
    });
    const messages = moved.length ? dropBoxes(s.view, moved.map((b) => b.id)) : [];
    for (const message of messages) new Notice(message);
    if (messages.length) this.refreshPanel(s);
    this.checkCanvas(s);
  }

  /**
   * Marks the boxes that are where they do not belong and fits the ghosts around what is drawn, whenever the elements
   * change and nothing is being dragged.
   */
  private checkCanvas(s: ViewState, els = s.api.getSceneElements()) {
    if (s.drag) return;
    const state = s.api.getAppState();
    if (state.viewModeEnabled || state.editingTextElement) return;
    const revision = revisionOf(els);
    if (revision === s.revision) return;
    s.revision = revision;
    const { guard, restored, deleted } = guardLevels(s.view, s.guard);
    s.guard = guard;
    // A relationship deleted here is deleted from the levels below too.
    if (deleted.length && deleteBelow(s.view, deleted)) new Notice("Deleted the relationship from the levels below too.");
    if (restored.length) {
      const one = restored.length === 1;
      new Notice(`${restored.join(", ")} ${one ? "belongs" : "belong"} to a level above: zoom out to delete ${one ? "it" : "them"}.`);
    }
    refreshCanvas(s.view);
  }

  private reverse(view: ExcalidrawView) {
    const r = selectedRelationship(view);
    if (r && !reverseRelationship(view, r.el.id)) new Notice(NO_EXCALIDRAW);
  }

  private zoomIn(view: ExcalidrawView) {
    if (!zoomIn(view)) new Notice(NO_EXCALIDRAW);
    this.refreshView(view);
  }

  private zoomOut(view: ExcalidrawView) {
    if (!zoomOut(view)) new Notice(NO_EXCALIDRAW);
    this.refreshView(view);
  }

  /** Shows another layer in the panel: the selection may not have changed. */
  private refreshView(view: ExcalidrawView) {
    const s = this.states.get(view);
    if (s) this.refreshPanel(s);
  }

  onunload() {
    window.clearTimeout(this.retryTimer);
    for (const s of this.states.values()) this.detach(s);
    this.states.clear();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    for (const s of this.states.values()) this.refreshPanel(s);
  }

  /** Docks a panel on every open drawing and removes the ones of closed drawings. */
  private syncViews() {
    const views = this.app.workspace.getLeavesOfType(VIEW_TYPE_EXCALIDRAW).map((l) => l.view).filter(isExcalidrawView);
    for (const [v, s] of this.states) {
      if (!views.includes(v)) {
        this.detach(s);
        this.states.delete(v);
      }
    }
    for (const v of views) this.attach(v);
  }

  private attach(view: ExcalidrawView) {
    const api = view.excalidrawAPI;
    if (!api) {
      // The Excalidraw component mounts asynchronously after the view opens.
      const n = this.retries.get(view) ?? 0;
      if (n < ATTACH_RETRIES) {
        this.retries.set(view, n + 1);
        window.clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => this.syncViews(), 200);
      }
      return;
    }
    this.retries.delete(view);
    const existing = this.states.get(view);
    if (existing?.api === api) {
      existing.panel.mount(view.contentEl);
      this.refreshPanel(existing);
      return;
    }
    if (existing) this.detach(existing);
    const panel = new C4Panel({
      add: (kind) => this.promptElement(view, kind, false),
      relate: () => this.promptRelationship(view),
      edit: () => this.promptEdit(view),
      reverse: () => this.reverse(view),
      zoomIn: () => this.zoomIn(view),
      zoomOut: () => this.zoomOut(view),
    });
    const s: ViewState = { view, api, panel, raf: 0, selection: null, viewMode: undefined, revision: NaN };
    panel.mount(view.contentEl);
    s.unsubscribe = api.onChange?.((els, appState) => this.onSceneChange(s, els, appState));
    this.states.set(view, s);
    this.refreshPanel(s);
    this.checkCanvas(s);
  }

  private detach(s: ViewState) {
    s.unsubscribe?.();
    if (s.raf) window.cancelAnimationFrame(s.raf);
    s.panel.destroy();
  }

  /**
   * Excalidraw reports every change, even a pointer move: the panel follows only the selection and view mode, the marks
   * of misplaced boxes only the elements.
   */
  private onSceneChange(s: ViewState, els: readonly El[], appState: AppState) {
    if (!s.drag && revisionOf(els) !== s.revision) window.requestAnimationFrame(() => this.checkCanvas(s));
    if (appState.selectedElementIds === s.selection && appState.viewModeEnabled === s.viewMode) return;
    s.selection = appState.selectedElementIds;
    s.viewMode = appState.viewModeEnabled;
    if (!s.raf) {
      s.raf = window.requestAnimationFrame(() => {
        s.raf = 0;
        this.refreshPanel(s);
      });
    }
  }

  private refreshPanel(s: ViewState) {
    protectStore(s.view);
    const visible = this.settings.showPanel && !s.api.getAppState().viewModeEnabled;
    s.panel.setVisible(visible);
    s.panel.setPosition(this.settings.panelPosition);
    if (visible) s.panel.update({
        pair: !!selectedPair(s.view),
        item: !!editableItem(s.view),
        relationship: !!selectedRelationship(s.view),
        ...diagramInfo(s.view),
      });
  }

  /** Runs the command on the active drawing; a command is only offered while one is open and it applies. */
  private withView(checking: boolean, run: (view: ExcalidrawView) => void, applies?: (view: ExcalidrawView) => boolean): boolean {
    const view = this.app.workspace.getActiveViewOfType(ItemView);
    if (!isExcalidrawView(view) || !view.excalidrawAPI || (applies && !applies(view))) return false;
    if (!checking) run(view);
    return true;
  }

  private promptElement(view: ExcalidrawView, kind: C4Kind, initiallyExternal: boolean) {
    if (!canAdd(view, kind)) {
      // Only the kinds of the level on the canvas: the others are added on their own level.
      const where = kind === "container" ? "a software system" : kind === "component" ? "a container" : null;
      new Notice(where
        ? `${kindTitle(kind)}s are added on the ${levelOf(kind)} level: select ${where} one level up and zoom in.`
        : `${kind === "person" ? "People" : "Software systems"} are added on the System level: zoom out.`);
      return;
    }
    let external = initiallyExternal;
    const rows: [string, string][] = [];
    const heading = () => `Add ${kindTitle(kind, external).toLowerCase()}`;
    const modal = new FormModal(this.app, heading(), elementFields(kind, external), (v) => {
      const metadata = cleanMetadata(rows);
      const added = addElement(view, { kind, external, name: v.name ?? "", technology: v.technology, description: v.description, metadata });
      if (!added) new Notice(NO_EXCALIDRAW);
    });
    if (canBeExternal(kind)) modal.extras.push(externalToggle(() => external, (on) => {
      external = on;
      modal.setTitle(heading());
    }));
    modal.extras.push(metadataEditor(rows, () => modal.submit()));
    modal.open();
  }

  private promptEdit(view: ExcalidrawView, item = selectedItem(view)) {
    if (!item) return;
    if (!canEdit(view, item)) {
      // Shown here for context, from a level above.
      const what = isRelationship(item) ? "This relationship" : item.data.name.trim() || "This element";
      const where = isRelationship(item) ? "a level above" : `the ${levelOf(item.data.kind)} level`;
      new Notice(`${what} belongs to ${where}: zoom out to edit it.`);
      return;
    }
    if (isRelationship(item)) this.promptEditRelationship(view, item);
    else this.promptEditElement(view, item);
  }

  private promptEditElement(view: ExcalidrawView, { el, data }: Selected) {
    let external = !!data.external;
    const heading = () => `Edit ${kindTitle(data.kind, external).toLowerCase()}`;
    const values = { name: data.name, technology: data.technology ?? "", description: data.description ?? "" };
    const fields = elementFields(data.kind, external).map((f) => ({ ...f, value: values[f.key as keyof typeof values] }));
    const rows: [string, string][] = Object.entries(data.metadata ?? {});
    const modal = new FormModal(this.app, heading(), fields, (v) => {
      const technology = hasTechnology(data.kind) ? v.technology : undefined;
      const metadata = cleanMetadata(rows);
      const updated = updateElement(view, el.id, { ...data, external, name: v.name ?? "", technology, description: v.description, metadata });
      if (!updated) new Notice(NO_EXCALIDRAW);
    }, "Save");
    // Containers and components are external as their system is.
    if (canBeExternal(data.kind)) modal.extras.push(externalToggle(() => external, (on) => {
      external = on;
      modal.setTitle(heading());
    }));
    modal.extras.push(metadataEditor(rows, () => modal.submit()));
    modal.open();
  }

  private promptEditRelationship(view: ExcalidrawView, { el, data }: SelectedRelationship) {
    const fields: Field[] = [
      { key: "description", name: "Description", value: data.description },
      { key: "technology", name: "Technology", value: data.technology ?? "", placeholder: "E.g. JSON/HTTPS" },
    ];
    const els = view.excalidrawAPI?.getSceneElements() ?? [];
    const nameOf = (id?: string) => {
      const end = els.find((e) => e.id === id);
      const scope = boundaryData(end?.customData)?.boundary;
      // A relationship carried down to a boundary: the boundary's label names its system or container.
      const label = scope ? els.find((e) => e.type === "text" && boundaryData(e.customData)?.boundary === scope)?.text?.split("\n")[0] : undefined;
      return elementData(end?.customData)?.name || label || "Unnamed";
    };
    const ends = [nameOf(el.startBinding?.elementId), nameOf(el.endBinding?.elementId)];
    let reversed = false;
    const title = () => (reversed ? [...ends].reverse() : ends).join(" → ");
    const modal = new FormModal(this.app, title(), fields, (v) => {
      const updated = updateRelationship(view, el.id, { ...data, description: v.description ?? "", technology: v.technology }, reversed);
      if (!updated) new Notice(NO_EXCALIDRAW);
    }, "Save");
    modal.headerButton = reverseButton(() => {
      reversed = !reversed;
      modal.setTitle(title());
    });
    modal.open();
  }

  private promptRelationship(view: ExcalidrawView) {
    // The element selected first is where the relationship starts, unless reversed.
    const [a, b] = selectedElements(view);
    if (!a || !b) return;
    if (!canRelate(view, a, b)) {
      new Notice("Both elements belong to a level above: zoom out to connect them.");
      return;
    }
    let reversed = false;
    const ends = (): [Selected, Selected] => (reversed ? [b, a] : [a, b]);
    const title = () => {
      const [from, to] = ends();
      return `${from.data.name || "Unnamed"} → ${to.data.name || "Unnamed"}`;
    };
    const fields: Field[] = [
      { key: "description", name: "Description", value: "Uses" },
      { key: "technology", name: "Technology", placeholder: "E.g. JSON/HTTPS" },
    ];
    const modal = new FormModal(this.app, title(), fields, (v) => {
      const [from, to] = ends();
      const added = addRelationship(view, from.el, to.el, { relationship: true, description: v.description ?? "", technology: v.technology });
      if (!added) new Notice(NO_EXCALIDRAW);
    });
    modal.headerButton = reverseButton(() => {
      reversed = !reversed;
      modal.setTitle(title());
    });
    modal.open();
  }
}

interface Field {
  key: string;
  name: string;
  value?: string;
  placeholder?: string;
  multiline?: boolean;
}

function elementFields(kind: C4Kind, external: boolean): Field[] {
  const fields: Field[] = [{ key: "name", name: "Name", placeholder: kindTitle(kind, external) }];
  if (hasTechnology(kind)) fields.push({ key: "technology", name: "Technology", placeholder: "E.g. Spring Boot, PostgreSQL" });
  fields.push({ key: "description", name: "Description", multiline: true });
  return fields;
}

/** The form setting that makes an element external: outside the system being described, drawn in grey. */
const externalToggle = (get: () => boolean, set: (on: boolean) => void) => (el: HTMLElement) => {
  new Setting(el)
    .setName("External")
    .setDesc("Outside the system being described.")
    .addToggle((t) => t.setValue(get()).onChange(set));
};

/**
 * The form's metadata of an element, as key: value rows next to its name like the other fields, edited in place: a
 * row is added with the button below them and removed with its own. Enter submits the form.
 */
const metadataEditor = (rows: [string, string][], submit: () => void) => (el: HTMLElement) => {
  const setting = new Setting(el).setName("Metadata").setClass("c4-field").setClass("c4-metadata");
  const list = setting.controlEl.createDiv({ cls: "c4-metadata-rows" });
  const render = (focus?: number) => {
    list.empty();
    rows.forEach((row, i) => {
      const line = list.createDiv({ cls: "c4-metadata-row" });
      const input = (part: 0 | 1, placeholder: string) => {
        const field = line.createEl("input", { type: "text", cls: `c4-metadata-${part ? "value" : "key"}`, attr: { placeholder } });
        field.value = row[part];
        field.addEventListener("input", () => (row[part] = field.value));
        field.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" || e.isComposing) return;
          e.preventDefault();
          submit();
        });
        return field;
      };
      const key = input(0, "Key");
      line.createSpan({ cls: "c4-metadata-colon", text: ":" });
      input(1, "Value");
      const remove = line.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Remove", role: "button" } });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        rows.splice(i, 1);
        render();
      });
      if (i === focus) key.focus();
    });
  };
  render();
  setting.addButton((b) =>
    b.setIcon("plus").setButtonText("Add").onClick(() => {
      rows.push(["", ""]);
      render(rows.length - 1);
    }),
  );
};

/** The form's button that turns a relationship the other way round; the form's title shows which way it goes. */
const reverseButton = (flip: () => void): HeaderButton => ({ icon: "arrow-left-right", label: "Reverse direction", onClick: flip });

/** The C4 boxes among the elements. */
const boxesOf = (els: readonly El[]): El[] => els.filter((e) => !e.containerId && !e.isDeleted && elementData(e.customData));

/** Changes whenever an element changes. */
function revisionOf(els: readonly El[]): number {
  let r = els.length;
  for (const e of els) r = (r * 31 + (e.version ?? 0)) | 0;
  return r;
}

/** The one selected relationship, when it can be edited in the layer on the canvas. */
function selectedRelationship(view: ExcalidrawView): SelectedRelationship | null {
  const item = editableItem(view);
  return item && isRelationship(item) ? item : null;
}

/** The one selected element or relationship, when it can be edited in the layer on the canvas. */
function editableItem(view: ExcalidrawView): Selected | SelectedRelationship | null {
  const item = selectedItem(view);
  return item && canEdit(view, item) ? item : null;
}

/** The two selected elements, when they can be connected in the layer on the canvas. */
function selectedPair(view: ExcalidrawView): [Selected, Selected] | null {
  const [a, b, ...rest] = selectedElements(view);
  return a && b && !rest.length && canRelate(view, a, b) ? [a, b] : null;
}

class C4SettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ExcalidrawC4Plugin) {
    super(app, plugin);
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof Settings];
  }

  async setControlValue(key: string, value: unknown) {
    const settings = this.plugin.settings;
    if (key === "showPanel") settings.showPanel = !!value;
    else if (key === "panelPosition" && isPanelPosition(value)) settings.panelPosition = value;
    await this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Show panel",
        desc: "Buttons for adding, connecting and editing elements, docked on every drawing.",
        control: { type: "toggle", key: "showPanel" },
      },
      {
        name: "Panel position",
        desc: "A row at the bottom or top of the drawing, or a column on its left or right side.",
        control: { type: "dropdown", key: "panelPosition", options: PANEL_POSITIONS },
      },
    ];
  }
}

/** A small icon button in a form's top right corner, next to its close button. */
interface HeaderButton {
  icon: string;
  label: string;
  onClick: () => void;
}

/** A small form: Enter submits, Ctrl+Enter in a multi-line field. */
class FormModal extends Modal {
  private readonly values: Record<string, string> = {};
  readonly extras: ((el: HTMLElement) => void)[] = []; // more settings below the fields
  headerButton?: HeaderButton;
  private headerEl?: HTMLElement;

  constructor(
    app: App,
    private readonly heading: string,
    private readonly fields: Field[],
    private readonly onSubmit: (values: Record<string, string>) => void,
    private readonly submitText = "Add",
  ) {
    super(app);
    for (const f of fields) this.values[f.key] = f.value ?? "";
  }

  onOpen() {
    this.setTitle(this.heading);
    this.modalEl.addClass("c4-form");
    const hb = this.headerButton;
    if (hb) {
      const b = (this.headerEl = this.modalEl.createDiv({
        cls: "c4-modal-action modal-header-button mod-raised clickable-icon",
        attr: { "aria-label": hb.label, role: "button" },
      }));
      setIcon(b, hb.icon);
      // Next to the close button, wherever the platform and theme put it.
      window.requestAnimationFrame(() => {
        const close = this.modalEl.querySelector<HTMLElement>(".modal-close-button, .modal-header-button:not(.c4-modal-action)");
        if (!close) return;
        const gap = 4;
        // Layout offsets, which the modal's opening animation does not scale.
        const end = close.offsetParent === this.modalEl
          ? this.modalEl.clientWidth - close.offsetLeft
          : this.modalEl.getBoundingClientRect().right - close.getBoundingClientRect().left;
        b.setCssProps({ "--c4-action-end": `${end + gap}px` });
      });
      // Keep focus in the field being typed in.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.preventDefault();
        hb.onClick();
      });
    }
    let first: HTMLElement | null = null;
    for (const f of this.fields) {
      const setting = new Setting(this.contentEl).setName(f.name).setClass("c4-field");
      const wire = (input: HTMLElement) => {
        first ??= input;
        input.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key !== "Enter" || e.isComposing || (f.multiline && !(e.ctrlKey || e.metaKey))) return;
          e.preventDefault();
          this.submit();
        });
      };
      if (f.multiline) {
        setting.addTextArea((t) => {
          t.setValue(this.values[f.key] ?? "").setPlaceholder(f.placeholder ?? "").onChange((v) => (this.values[f.key] = v));
          t.inputEl.rows = 4;
          wire(t.inputEl);
        });
      } else {
        setting.addText((t) => {
          t.setValue(this.values[f.key] ?? "").setPlaceholder(f.placeholder ?? "").onChange((v) => (this.values[f.key] = v));
          wire(t.inputEl);
        });
      }
    }
    for (const extra of this.extras) extra(this.contentEl);
    new Setting(this.contentEl).addButton((b) => b.setButtonText(this.submitText).setCta().onClick(() => this.submit()));
    (first as HTMLElement | null)?.focus();
  }

  onClose() {
    this.headerEl?.remove();
    this.contentEl.empty();
  }

  submit() {
    this.close();
    this.onSubmit(this.values);
  }
}
