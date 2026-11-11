import { App, ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, setIcon } from "obsidian";
import {
  Selected, SelectedRelationship, addElement, addRelationship, canAdd, diagramInfo, isRelationship, itemAt, itemOf, reverseRelationship, selectedElements,
  selectedItem, updateElement, updateRelationship, zoomIn, zoomOut,
} from "./actions";
import { protectStore } from "./layertx";
import { AppState, ExcalidrawAPI, ExcalidrawView, VIEW_TYPE_EXCALIDRAW, isExcalidrawView } from "./excalidraw";
import { C4Kind, KINDS, boundaryData, elementData, hasTechnology, kindTitle } from "./model";
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

    for (const kind of KINDS) {
      for (const external of [false, true]) {
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
        this.withView(checking, (view) => this.promptRelationship(view), (view) => selectedElements(view).length === 2),
    });
    this.addCommand({
      id: "edit-selected",
      name: "Edit selected element or relationship",
      checkCallback: (checking) => this.withView(checking, (view) => this.promptEdit(view), (view) => !!selectedItem(view)),
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
    const s: ViewState = { view, api, panel, raf: 0, selection: null, viewMode: undefined };
    panel.mount(view.contentEl);
    s.unsubscribe = api.onChange?.((_els, appState) => this.onSceneChange(s, appState));
    this.states.set(view, s);
    this.refreshPanel(s);
  }

  private detach(s: ViewState) {
    s.unsubscribe?.();
    if (s.raf) window.cancelAnimationFrame(s.raf);
    s.panel.destroy();
  }

  /** Excalidraw reports every change, even a pointer move: the panel follows only the selection and view mode. */
  private onSceneChange(s: ViewState, appState: AppState) {
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
        pair: selectedElements(s.view).length === 2,
        item: !!selectedItem(s.view),
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
      const where = kind === "container" ? "a software system" : "a container";
      new Notice(`${kindTitle(kind)}s belong in a diagram of ${where}: select one and zoom in.`);
      return;
    }
    let external = initiallyExternal;
    const heading = () => `Add ${kindTitle(kind, external).toLowerCase()}`;
    const modal = new FormModal(this.app, heading(), elementFields(kind, external), (v) => {
      const added = addElement(view, { kind, external, name: v.name ?? "", technology: v.technology, description: v.description });
      if (!added) new Notice(NO_EXCALIDRAW);
    });
    modal.extra = externalToggle(() => external, (on) => {
      external = on;
      modal.setTitle(heading());
    });
    modal.open();
  }

  private promptEdit(view: ExcalidrawView, item = selectedItem(view)) {
    if (!item) return;
    if (isRelationship(item)) this.promptEditRelationship(view, item);
    else this.promptEditElement(view, item);
  }

  private promptEditElement(view: ExcalidrawView, { el, data }: Selected) {
    let external = !!data.external;
    const heading = () => `Edit ${kindTitle(data.kind, external).toLowerCase()}`;
    const values = { name: data.name, technology: data.technology ?? "", description: data.description ?? "" };
    const fields = elementFields(data.kind, external).map((f) => ({ ...f, value: values[f.key as keyof typeof values] }));
    const modal = new FormModal(this.app, heading(), fields, (v) => {
      const technology = hasTechnology(data.kind) ? v.technology : undefined;
      const updated = updateElement(view, el.id, { ...data, external, name: v.name ?? "", technology, description: v.description });
      if (!updated) new Notice(NO_EXCALIDRAW);
    }, "Save");
    modal.extra = externalToggle(() => external, (on) => {
      external = on;
      modal.setTitle(heading());
    });
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

/** The form's button that turns a relationship the other way round; the form's title shows which way it goes. */
const reverseButton = (flip: () => void): HeaderButton => ({ icon: "arrow-left-right", label: "Reverse direction", onClick: flip });

/** The one selected relationship. */
function selectedRelationship(view: ExcalidrawView): SelectedRelationship | null {
  const item = selectedItem(view);
  return item && isRelationship(item) ? item : null;
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
  extra?: (el: HTMLElement) => void; // more settings below the fields
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
      const setting = new Setting(this.contentEl).setName(f.name);
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
          t.inputEl.rows = 3;
          wire(t.inputEl);
        });
      } else {
        setting.addText((t) => {
          t.setValue(this.values[f.key] ?? "").setPlaceholder(f.placeholder ?? "").onChange((v) => (this.values[f.key] = v));
          wire(t.inputEl);
        });
      }
    }
    this.extra?.(this.contentEl);
    new Setting(this.contentEl).addButton((b) => b.setButtonText(this.submitText).setCta().onClick(() => this.submit()));
    (first as HTMLElement | null)?.focus();
  }

  onClose() {
    this.headerEl?.remove();
    this.contentEl.empty();
  }

  private submit() {
    this.close();
    this.onSubmit(this.values);
  }
}
