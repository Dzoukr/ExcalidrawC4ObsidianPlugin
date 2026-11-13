import {
  App, ColorComponent, FuzzySuggestModal, ItemView, Menu, Modal, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, SettingDefinitionPage,
  normalizePath, setIcon,
} from "obsidian";
import {
  Selected, SelectedGroup, SelectedItem, SelectedRelationship, addElement, addGroup, addRelationship, canAdd, canEdit, canRelate, deleteBelow, diagramInfo, dissolveGroups, dropBoxes, hasKind, isElement,
  isGroup, isRelationship, itemAt, itemOf, redrawResized, regroup, reverseRelationship, onlyC4Selected, refreshLooks, setDrawingTheme, themeOfDrawing, useDrawingColors, selectNext, selectedElements,
  selectedItem, selectionShapes, updateElement, updateGroup, updateRelationship, zoomIn, zoomOut,
} from "./actions";
import { Guard, guardLevels, protectStore, refreshCanvas, selectionOf } from "./layertx";
import { AppState, El, ExcalidrawAPI, ExcalidrawView, VIEW_TYPE_EXCALIDRAW, isExcalidrawView } from "./excalidraw";
import {
  Box, C4Element, C4Kind, CONTAINER_TYPES, CONTAINER_TYPE_TITLES, ContainerType, Ink, KINDS, Shape, boundaryData, bounds, canBeExternal, cleanMetadata, elementData, groupData, hasTechnology,
  isContainerType, kindTitle, levelOf, shapeDrawing, shapeOf, zoomView, LOOK_KEYS, LOOK_KEY_TITLES, LOOK_PARTS, LOOK_PART_TITLES, Look, LookKey,
  lookOf, ownLook, KEY,
} from "./model";
import {
  CUSTOM_THEME, Colors, Theme, UserTheme, colorsOf, copyColors, isPreset, mergeColors, newThemeId, parseThemes, setNewDrawingTheme, setUserThemes,
  themeName, themeOptions, themeSwatches, themesToJson, uniqueName, validTheme,
} from "./themes";
import { C4Panel, PANEL_POSITIONS, PanelPosition, isPanelPosition } from "./panel";
import { MODE, MODE_KEY, Owner, isAlone, ownerOf, register } from "./mode";
import { PLAIN, offer, withdraw } from "./chooser";
import { Highlight } from "./highlight";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, SHORTCUT_NAMES, ShortcutAction, Shortcuts, actionOf, isMove, loadShortcuts, shortcutOf } from "./keys";

const NO_EXCALIDRAW = "The Excalidraw plugin's scripting API is not available.";

interface Settings {
  showPanel: boolean;
  panelPosition: PanelPosition;
  shortcuts: Shortcuts;
  theme: Theme; // of new drawings
  themes: UserTheme[]; // the user's own, after the built-in ones
  askKind: boolean; // ask what a drawing nobody's yet is for, even with no other plugin drawing its own kind of diagram
}

const DEFAULT_SETTINGS: Settings = { showPanel: true, panelPosition: "right", shortcuts: DEFAULT_SHORTCUTS, theme: "classic", themes: [], askKind: false };

/**
 * The themes from saved settings, their colors over the defaults. The colors the settings had before themes, if any
 * were changed, become the Custom theme.
 */
function loadThemes(saved: (Partial<Settings> & { looks?: unknown }) | null): UserTheme[] {
  const out: UserTheme[] = [];
  const looks = saved?.looks;
  const list: unknown[] = Array.isArray(saved?.themes)
    ? saved.themes
    : looks && typeof looks === "object" && Object.keys(looks).length ? [{ id: CUSTOM_THEME, name: "Custom", colors: looks }] : [];
  for (const t of list as Partial<UserTheme>[]) {
    if (!t || typeof t.id !== "string" || !t.id || isPreset(t.id) || out.some((x) => x.id === t.id)) continue;
    out.push({ id: t.id, name: typeof t.name === "string" && t.name.trim() ? t.name : "Theme", colors: mergeColors(t.colors) });
  }
  return out;
}

interface ViewState {
  view: ExcalidrawView;
  api: ExcalidrawAPI;
  panel: C4Panel;
  highlight: Highlight;
  unsubscribe?: () => void;
  raf: number;
  highlightRaf: number;
  selection: unknown; // the selection the panel shows, to refresh it only when the selection changes
  viewMode: boolean | undefined;
  drag?: Map<string, Box>; // where the C4 boxes and groups were when the pointer went down on the drawing, until it goes up
  revision: number; // of the elements last checked for misplaced boxes
  guard?: Guard; // the elements of the levels above, put back when deleted
  groups?: Set<string>; // the boxes of the groups on the canvas at the last look, to tell which were deleted since
  claimed?: boolean; // taken over for C4, until the frontmatter says so
  plain?: boolean; // kept plain Excalidraw, until the frontmatter says so
  keyWritten?: boolean; // the drawing's kind was written to its frontmatter
}

const ATTACH_RETRIES = 50;

export default class ExcalidrawC4Plugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;
  private states = new Map<ExcalidrawView, ViewState>();
  private retries = new WeakMap<ExcalidrawView, number>();
  private retryTimer = 0;
  // While paused, keys and double-clicks are left to Excalidraw. Not saved: a restart resumes.
  private paused = false;

  async onload() {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...saved, shortcuts: loadShortcuts(saved?.shortcuts) };
    if (!isPanelPosition(this.settings.panelPosition)) this.settings.panelPosition = DEFAULT_SETTINGS.panelPosition;
    this.settings.askKind = this.settings.askKind === true;
    this.settings.themes = loadThemes(saved);
    const migrated = !Array.isArray(saved?.themes) && this.settings.themes.some((t) => t.id === CUSTOM_THEME);
    this.settings.theme = validTheme(migrated ? CUSTOM_THEME : this.settings.theme, this.settings.themes);
    delete (this.settings as { looks?: unknown }).looks;
    this.applyThemes();
    this.addSettingTab(new C4SettingTab(this.app, this));

    // Other plugins drawing their own kind of diagram find this one here, and leave its drawings alone.
    this.register(register());
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      for (const s of this.states.values()) {
        if (s.view.file !== file) continue;
        s.claimed = false;
        s.plain = false;
        this.refreshPanel(s);
        this.refreshHighlight(s);
      }
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncViews()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncViews()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.syncViews()));
    this.app.workspace.onLayoutReady(() => this.syncViews());
    // The shortcuts from the settings; a double-click on a C4 element or relationship opens its form instead of
    // Excalidraw's text editing.
    this.registerDomEvent(window, "keydown", (e) => this.onKey(e), { capture: true });
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
      id: "add-group",
      name: "Add group around the selected elements",
      checkCallback: (checking) => this.withView(checking, (view) => this.promptGroup(view)),
    });
    this.addCommand({
      id: "add-relationship",
      name: "Add relationship between the two selected elements",
      checkCallback: (checking) =>
        this.withView(checking, (view) => this.promptRelationship(view), (view) => !!selectedPair(view)),
    });
    this.addCommand({
      id: "use-for-c4",
      name: "Use this drawing for C4 diagrams",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(ItemView);
        if (!isExcalidrawView(view) || !view.excalidrawAPI || this.ownerOfView(view) === "mine") return false;
        if (!checking) void this.claim(view);
        return true;
      },
    });
    this.addCommand({
      id: "keep-plain",
      name: "Keep this drawing plain Excalidraw",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(ItemView);
        if (!isExcalidrawView(view) || !view.excalidrawAPI || this.kindOf(view) === PLAIN) return false;
        if (!checking) void this.keepPlain(view);
        return true;
      },
    });
    this.addCommand({
      id: "toggle-pause",
      name: "Pause or resume C4 editing",
      callback: () => this.togglePause(),
    });
    this.addCommand({
      id: "change-theme",
      name: "Change theme of the drawing",
      checkCallback: (checking) => this.withView(checking, (view) => this.chooseTheme(view)),
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

  /** Whom the drawing belongs to: C4, another plugin drawing its own kind of diagram, or none yet. */
  private ownerOfView(view: ExcalidrawView): Owner {
    const s = this.states.get(view);
    if (s?.plain) return "other";
    if (s?.claimed) return "mine";
    // Asking, C4 takes no drawing without being told to, as if another plugin of its sort were enabled.
    const alone = isAlone() && !this.settings.askKind;
    return ownerOf(this.kindOf(view), hasC4(view.excalidrawAPI?.getSceneElements() ?? []), alone);
  }

  /** The kind in the drawing's frontmatter, if any. */
  private kindOf(view: ExcalidrawView): unknown {
    return view.file ? this.app.metadataCache.getFileCache(view.file)?.frontmatter?.[MODE_KEY] : undefined;
  }

  /** Leaves the drawing to Excalidraw: its frontmatter says it is plain, so neither this plugin nor the others take it. */
  private async keepPlain(view: ExcalidrawView) {
    const s = this.states.get(view);
    if (s) {
      s.claimed = false;
      s.plain = true;
      this.refreshPanel(s);
      this.refreshHighlight(s);
    }
    await this.writeKind(view, PLAIN);
  }

  private isMine(view: ExcalidrawView): boolean {
    return this.ownerOfView(view) === "mine";
  }

  /** Takes the drawing over for C4: its frontmatter says so, for this plugin and the others. */
  private async claim(view: ExcalidrawView) {
    const s = this.states.get(view);
    if (s) {
      s.claimed = true;
      s.plain = false;
      this.refreshPanel(s);
    }
    await this.writeKind(view);
  }

  /** Writes the drawing's kind to its frontmatter; false when it could not. */
  private async writeKind(view: ExcalidrawView, kind: string = MODE): Promise<boolean> {
    if (!view.file) return false;
    try {
      await this.app.fileManager.processFrontMatter(view.file, (fm: Record<string, unknown>) => {
        fm[MODE_KEY] = kind;
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Writes the kind of a C4 drawing to its frontmatter when it has none, for the other plugins drawing their own kind of
   * diagram to leave it alone: once its first C4 element is drawn, or when one drawn before the kind was is open. Only
   * when the drawing has no unsaved changes, which writing the file under it could interfere with.
   */
  private keepKind(s: ViewState, els: readonly El[]) {
    if (s.keyWritten || !s.view.file || !hasC4(els)) return;
    if (this.app.metadataCache.getFileCache(s.view.file)?.frontmatter?.[MODE_KEY]) return void (s.keyWritten = true);
    if ((s.view as { isDirty?: () => boolean }).isDirty?.()) return;
    s.keyWritten = true;
    void this.writeKind(s.view).then((ok) => {
      if (!ok) s.keyWritten = false;
    });
  }

  /** Leaves keys and double-clicks to Excalidraw, in every drawing, or takes them back. */
  private togglePause() {
    this.paused = !this.paused;
    for (const s of this.states.values()) {
      this.refreshPanel(s);
      this.refreshHighlight(s);
    }
  }

  /** The drawing in the active tab, while it is being edited rather than only viewed. */
  private editedView(): ExcalidrawView | null {
    const view = this.app.workspace.getActiveViewOfType(ItemView);
    if (!isExcalidrawView(view) || !view.excalidrawAPI) return null;
    const s = view.excalidrawAPI.getAppState();
    // Another plugin's drawing, or nobody's yet, keeps its keys and double-clicks for Excalidraw.
    return s.viewModeEnabled || s.editingTextElement || !this.isMine(view) ? null : view;
  }

  /** Runs the shortcut of a key pressed on a drawing, instead of what Excalidraw would do with the key. */
  private onKey(e: KeyboardEvent) {
    if (this.paused || e.isComposing || e.repeat) return;
    const view = this.editedView();
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!view || target?.closest("input, textarea, [contenteditable='true'], .modal-container")) return;
    if (target && target !== activeDocument.body && !view.contentEl.contains(target)) return;
    const pressed = actionOf(this.settings.shortcuts, e);
    let done = !!pressed && this.runShortcut(view, pressed.action, pressed.extend);
    // Enter never starts Excalidraw's own text editing of a C4 element or relationship: the form edits it.
    if (!done && shortcutOf(e) === "Enter" && selectedItem(view)) done = true;
    if (!done) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  /** Runs a shortcut's action when it applies; false leaves the key to Excalidraw. */
  private runShortcut(view: ExcalidrawView, action: ShortcutAction, extend: boolean): boolean {
    if (isMove(action)) {
      // Instead of moving the selection, unless something else than C4 elements and relationships is selected.
      if (!onlyC4Selected(view)) return false;
      selectNext(view, action, extend);
      return true;
    }
    switch (action) {
      case "add":
        this.addByKey(view);
        return true;
      case "zoomIn":
        if (!diagramInfo(view).zoomIn) return false;
        this.zoomIn(view);
        return true;
      case "zoomOut":
        if (diagramInfo(view).zoomOut) {
          this.zoomOut(view);
          return true;
        }
        // Its key never deletes a C4 element or relationship, as Backspace would: Delete does.
        return !!selectedElements(view).length || !!selectedItem(view);
      case "edit":
        if (!selectedItem(view)) return false;
        this.promptEdit(view);
        return true;
      case "group":
        // Instead of Excalidraw's own grouping, unless something else than C4 elements and relationships is selected.
        if (!onlyC4Selected(view)) return false;
        this.promptGroup(view);
        return true;
    }
  }

  /**
   * Adds what the selection asks for: a relationship between two selected elements, else an element of the level on the
   * canvas, of the selected element's kind when the level takes it. In the system context that is a person until the
   * drawing has one, then a system.
   */
  private addByKey(view: ExcalidrawView) {
    const selected = selectedElements(view);
    if (selected.length === 2) return this.promptRelationship(view);
    if (selected.length > 2) return void new Notice("Select two elements to add a relationship between them.");
    const kinds = diagramInfo(view).kinds;
    const own = selected[0]?.data.kind;
    const kind = own && kinds.includes(own) ? own
      : kinds.includes("person") && !hasKind(view, "person") ? "person"
      : kinds.includes("system") ? "system" : kinds[0];
    if (kind) this.promptElement(view, kind, false);
  }

  private onDoubleClick(e: MouseEvent) {
    if (this.paused) return;
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
    api.updateScene({ appState: selectionOf(api.getSceneElements(), [item.el.id]), captureUpdate: "NEVER" });
    // A system or container opens, as Enter does; anything else opens its form. The selection reaches the app state
    // only later, so the item goes along.
    if (isElement(item) && zoomView(item.data)) this.zoomIn(view, item);
    else this.promptEdit(view, item);
  }

  private onPointerDown(e: PointerEvent) {
    if (!(e.target instanceof Node)) return;
    for (const s of this.states.values()) {
      if (!s.view.contentEl.contains(e.target)) continue;
      s.drag = new Map(draggables(s.api.getSceneElements()).map((b) => [b.id, { x: b.x, y: b.y, width: b.width, height: b.height }]));
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

  private afterDrag(s: ViewState, before: Map<string, Box>) {
    if (!this.states.has(s.view) || s.api.getAppState().viewModeEnabled) return;
    const off = (a: number, c: number) => Math.abs(a - c) > 0.5;
    const els = draggables(s.api.getSceneElements());
    const resized = (b: El) => {
      const was = before.get(b.id);
      return !!was && (off(was.width, b.width) || off(was.height, b.height));
    };
    const moved = els.flatMap((b) => {
      const was = before.get(b.id);
      // A group resized rather than moved takes nothing along: it is fitted to what is in it again.
      const fitted = !!groupData(b.customData) && resized(b);
      return was && !fitted && (off(was.x, b.x) || off(was.y, b.y)) ? [{ id: b.id, dx: b.x - was.x, dy: b.y - was.y }] : [];
    });
    // Groups first: a group dragged takes what is in it along, and what is dropped into a group goes in it.
    if (moved.length) regroup(s.view, moved);
    const messages = moved.length ? dropBoxes(s.view, moved.map((b) => b.id)) : [];
    // Boxes resized keep their new size, with their text and shape drawn again for it.
    redrawResized(s.view, els.filter((b) => elementData(b.customData) && resized(b)).map((b) => b.id));
    for (const message of messages) new Notice(message);
    if (messages.length) this.refreshPanel(s);
    this.checkCanvas(s);
  }

  /**
   * Marks the boxes that are where they do not belong and fits the ghosts around what is drawn, whenever the elements
   * change and nothing is being dragged.
   */
  private checkCanvas(s: ViewState, els = s.api.getSceneElements()) {
    if (s.drag || !this.isMine(s.view)) return;
    this.keepKind(s, els);
    const state = s.api.getAppState();
    if (state.viewModeEnabled || state.editingTextElement) return;
    const revision = revisionOf(els);
    if (revision === s.revision) return;
    s.revision = revision;
    const { guard, restored, deleted } = guardLevels(s.view, s.guard);
    s.guard = guard;
    // A relationship deleted here is deleted from the levels below too.
    if (deleted.length && deleteBelow(s.view, deleted)) new Notice("Deleted the relationship from the levels below too.");
    // What was in a group deleted since goes into the group it was in.
    const all = s.api.getSceneElementsIncludingDeleted();
    const gone = [...(s.groups ?? [])].filter((id) => all.find((e) => e.id === id)?.isDeleted);
    if (gone.length) dissolveGroups(s.view, gone);
    s.groups = new Set(s.api.getSceneElements().filter((e) => !e.isDeleted && groupData(e.customData)).map((e) => e.id));
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

  private zoomIn(view: ExcalidrawView, item?: Selected) {
    if (!zoomIn(view, item)) new Notice(NO_EXCALIDRAW);
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
    window.clearTimeout(this.looksTimer);
    for (const s of this.states.values()) this.detach(s);
    this.states.clear();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    for (const s of this.states.values()) this.refreshPanel(s);
  }

  private looksTimer = 0;

  private applyThemes() {
    setUserThemes(this.settings.themes);
    setNewDrawingTheme(this.settings.theme);
  }

  /** Saves the themes, and soon after draws the open drawings in their colors. */
  async saveThemes() {
    this.applyThemes();
    await this.saveData(this.settings);
    window.clearTimeout(this.looksTimer);
    this.looksTimer = window.setTimeout(() => {
      for (const s of this.states.values()) if (!s.api.getAppState().viewModeEnabled && this.isMine(s.view)) refreshLooks(s.view);
    }, 300);
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
      existing.highlight.mount(view.contentEl);
      this.refreshPanel(existing);
      return;
    }
    if (existing) this.detach(existing);
    const panel = new C4Panel({
      add: (kind) => this.promptElement(view, kind, false),
      group: () => this.promptGroup(view),
      relate: () => this.promptRelationship(view),
      edit: () => this.promptEdit(view),
      reverse: () => this.reverse(view),
      zoomIn: () => this.zoomIn(view),
      zoomOut: () => this.zoomOut(view),
      theme: (at) => this.themeMenu(view, at),
      togglePause: () => this.togglePause(),
    });
    const highlight = new Highlight();
    const s: ViewState = { view, api, panel, highlight, raf: 0, highlightRaf: 0, selection: null, viewMode: undefined, revision: NaN };
    panel.mount(view.contentEl);
    highlight.mount(view.contentEl);
    s.unsubscribe = api.onChange?.((els, appState) => this.onSceneChange(s, els, appState));
    this.states.set(view, s);
    // Drawn in the colors of the types of element now, which may have changed since the drawing was last open.
    if (!api.getAppState().viewModeEnabled && this.isMine(view)) refreshLooks(view);
    this.refreshPanel(s);
    this.checkCanvas(s);
  }

  private detach(s: ViewState) {
    s.unsubscribe?.();
    withdraw(s.view.contentEl, MODE);
    if (s.raf) window.cancelAnimationFrame(s.raf);
    if (s.highlightRaf) window.cancelAnimationFrame(s.highlightRaf);
    s.panel.destroy();
    s.highlight.destroy();
  }

  /**
   * Excalidraw reports every change, even a pointer move: the panel follows only the selection and view mode, the marks
   * of misplaced boxes only the elements.
   */
  private onSceneChange(s: ViewState, els: readonly El[], appState: AppState) {
    if (!s.drag && revisionOf(els) !== s.revision) window.requestAnimationFrame(() => this.checkCanvas(s));
    // The highlight follows the selection, its elements, and the view as it scrolls and zooms.
    if (!s.highlightRaf) {
      s.highlightRaf = window.requestAnimationFrame(() => {
        s.highlightRaf = 0;
        this.refreshHighlight(s);
      });
    }
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

  private refreshHighlight(s: ViewState) {
    const state = s.api.getAppState();
    const off = state.viewModeEnabled || this.paused || !this.isMine(s.view);
    s.highlight.update(off ? [] : selectionShapes(s.view), state, s.view.contentEl);
  }

  private refreshPanel(s: ViewState) {
    protectStore(s.view);
    // Only on C4's own drawings. On a drawing nobody's yet, a button taking it over instead, in the row the plugins
    // drawing their own kind of diagram share.
    const owner = this.ownerOfView(s.view);
    const viewMode = !!s.api.getAppState().viewModeEnabled;
    const visible = this.settings.showPanel && !viewMode && owner === "mine";
    if (owner === "none" && !viewMode) offer(s.view.contentEl, MODE, "C4 diagrams", "Use this drawing for C4 diagrams", () => void this.claim(s.view), () => void this.keepPlain(s.view));
    else withdraw(s.view.contentEl, MODE);
    s.panel.setVisible(visible);
    s.panel.setPosition(this.settings.panelPosition);
    if (visible) s.panel.update({
        pair: !!selectedPair(s.view),
        item: !!editableItem(s.view),
        relationship: !!selectedRelationship(s.view),
        paused: this.paused,
        ...diagramInfo(s.view),
      });
  }

  /**
   * Runs the command on the active drawing; a command is only offered while one is open, it applies, and the drawing is
   * not another plugin's. On a drawing nobody's yet, it takes the drawing over for C4.
   */
  private withView(checking: boolean, run: (view: ExcalidrawView) => void, applies?: (view: ExcalidrawView) => boolean): boolean {
    const view = this.app.workspace.getActiveViewOfType(ItemView);
    if (!isExcalidrawView(view) || !view.excalidrawAPI || (applies && !applies(view))) return false;
    const owner = this.ownerOfView(view);
    if (owner === "other") return false;
    if (!checking) {
      if (owner === "none") void this.claim(view);
      run(view);
    }
    return true;
  }

  /** The form adding an element. */
  private promptElement(view: ExcalidrawView, kind: C4Kind, initiallyExternal: boolean) {
    if (selectedElements(view).length > 1) {
      new Notice("With more than one element selected, only a relationship can be added: select two elements.");
      return;
    }
    if (!canAdd(view, kind)) {
      // Only the kinds of the level on the canvas: the others are added on their own level.
      const where = kind === "container" ? "a software system" : kind === "component" ? "a container" : null;
      new Notice(where
        ? `${kindTitle(kind)}s are added on the ${levelOf(kind)} level: select ${where} one level up and zoom in.`
        : `${kind === "person" ? "People" : "Software systems"} are added on the System level: zoom out.`);
      return;
    }
    this.elementForm(view, "Add", { kind, name: "", external: initiallyExternal }, (data) => addElement(view, data));
  }

  private promptEdit(view: ExcalidrawView, item = selectedItem(view)) {
    if (!item) return;
    if (isGroup(item)) return this.promptEditGroup(view, item);
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

  /**
   * The form adding a group around the selected elements and groups of the layer on the canvas, or an empty one with
   * nothing selected.
   */
  private promptGroup(view: ExcalidrawView) {
    const fields: Field[] = [{ key: "name", name: "Name", placeholder: "E.g. Customer service" }];
    new FormModal(this.app, "Add group", fields, (v) => {
      if (!addGroup(view, v.name ?? "")) new Notice(NO_EXCALIDRAW);
    }).open();
  }

  private promptEditGroup(view: ExcalidrawView, { el, data }: SelectedGroup) {
    const fields: Field[] = [{ key: "name", name: "Name", value: data.name, placeholder: "E.g. Customer service" }];
    new FormModal(this.app, "Edit group", fields, (v) => {
      if (!updateGroup(view, el.id, v.name ?? "")) new Notice(NO_EXCALIDRAW);
    }, "Save").open();
  }

  /** Lets the user pick the drawing's theme. */
  private chooseTheme(view: ExcalidrawView) {
    new ThemeModal(this.app, themeOfDrawing(view), (t) => {
      if (!setDrawingTheme(view, t)) new Notice(NO_EXCALIDRAW);
    }).open();
  }

  /** The themes as a menu at the panel's button, the drawing's one checked. */
  private themeMenu(view: ExcalidrawView, at: HTMLElement) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Theme of the drawing").setIsLabel(true));
    const current = themeOfDrawing(view);
    const options = themeOptions();
    options.forEach((t, i) => {
      if (t.user && !options[i - 1]?.user) menu.addSeparator();
      menu.addItem((item) => item.setTitle(themeTitle(t.id)).setChecked(t.id === current).onClick(() => {
        if (!setDrawingTheme(view, t.id)) new Notice(NO_EXCALIDRAW);
      }));
    });
    const r = at.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom }, at.doc);
  }

  private promptEditElement(view: ExcalidrawView, { el, data }: Selected) {
    this.elementForm(view, "Edit", data, (updated) => updateElement(view, el.id, updated));
  }

  /** The form of an element, the same for adding and editing it; `save` gets the element as the form leaves it. */
  private elementForm(view: ExcalidrawView, verb: "Add" | "Edit", data: C4Element, save: (data: C4Element) => boolean) {
    useDrawingColors(view); // the colors the form shows
    let external = !!data.external;
    let type: ContainerType = isContainerType(data.type) ? data.type : "generic";
    const heading = () => `${verb} ${kindTitle(data.kind, external).toLowerCase()}`;
    const values = { name: data.name, technology: data.technology ?? "", description: data.description ?? "" };
    const fields = elementFields(data.kind, external).map((f) => ({ ...f, value: values[f.key as keyof typeof values] }));
    const rows: [string, string][] = Object.entries(data.metadata ?? {});
    let look: Partial<Look> = { ...data.look };
    const typed = () => ({ kind: data.kind, ...(data.kind === "container" ? { type } : {}), external });
    const modal = new FormModal(this.app, heading(), fields, (v) => {
      const technology = hasTechnology(data.kind) ? v.technology : undefined;
      const metadata = cleanMetadata(rows);
      useDrawingColors(view); // for its own colors, those that differ from its type's in the drawing's theme
      const saved = save({
        ...data, ...typed(), name: v.name ?? "", technology, description: v.description, metadata, look: ownLook(typed(), look),
      });
      if (!saved) new Notice(NO_EXCALIDRAW);
    }, verb === "Edit" ? "Save" : "Add");
    const colors = lookPickers(
      "Colors", "",
      () => lookOf({ ...typed(), look }),
      (part, value) => (look = { ...look, [part]: value }),
      () => (look = {}),
    );
    if (data.kind === "container") modal.before.push(typeToggle(() => type, (t) => {
      type = t;
      colors.refresh();
    }));
    // Containers and components are external as their system is.
    if (canBeExternal(data.kind)) modal.extras.push(externalToggle(() => external, (on) => {
      external = on;
      modal.setTitle(heading());
      colors.refresh();
    }));
    modal.extras.push(colors.render);
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
    const rows: [string, string][] = Object.entries(data.metadata ?? {});
    const title = () => (reversed ? [...ends].reverse() : ends).join(" → ");
    const modal = new FormModal(this.app, title(), fields, (v) => {
      const metadata = cleanMetadata(rows);
      const updated = updateRelationship(view, el.id, { ...data, description: v.description ?? "", technology: v.technology, metadata }, reversed);
      if (!updated) new Notice(NO_EXCALIDRAW);
    }, "Save");
    modal.headerButton = reverseButton(() => {
      reversed = !reversed;
      modal.setTitle(title());
    });
    modal.extras.push(metadataEditor(rows, () => modal.submit()));
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
    const rows: [string, string][] = [];
    const modal = new FormModal(this.app, title(), fields, (v) => {
      const [from, to] = ends();
      const metadata = cleanMetadata(rows);
      const added = addRelationship(view, from.el, to.el, { relationship: true, description: v.description ?? "", technology: v.technology, metadata });
      if (!added) new Notice(NO_EXCALIDRAW);
    });
    modal.headerButton = reverseButton(() => {
      reversed = !reversed;
      modal.setTitle(title());
    });
    modal.extras.push(metadataEditor(rows, () => modal.submit()));
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
  if (hasTechnology(kind)) fields.push({ key: "technology", name: "Technology", placeholder: "E.g. ASP.NET, Spring Boot, PostgreSQL" });
  fields.push({ key: "description", name: "Description", multiline: true });
  return fields;
}

/** A choice in a row of buttons with pictures: what it stands for, its name, and the shape pictured. */
interface PictureOption<T extends string> {
  value: T;
  title: string;
  shape: Shape;
}

/**
 * A form setting choosing one of a few options: a row of buttons, each with a picture of a shape, one of them pressed.
 * The arrow keys move along the row.
 */
const pictureToggle = <T extends string>(name: string, options: PictureOption<T>[], get: () => T, set: (value: T) => void) => (el: HTMLElement) => {
  const setting = new Setting(el).setName(name).setClass("c4-field").setClass("c4-type");
  const row = setting.controlEl.createDiv({ cls: "c4-type-toggle", attr: { role: "radiogroup", "aria-label": name } });
  const buttons = options.map((o) => {
    const b = row.createEl("button", { cls: "c4-type-option", attr: { type: "button", role: "radio", "aria-label": o.title } });
    shapePicture(b, o.shape);
    b.createSpan({ cls: "c4-type-name", text: o.title });
    return b;
  });
  const show = () => {
    options.forEach((o, i) => {
      const on = o.value === get();
      buttons[i].toggleClass("is-active", on);
      buttons[i].setAttr("aria-checked", String(on));
      buttons[i].tabIndex = on ? 0 : -1;
    });
  };
  const choose = (i: number) => {
    set(options[i].value);
    show();
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => choose(i));
    b.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = (i + step + buttons.length) % buttons.length;
      choose(next);
      buttons[next].focus();
    });
  });
  show();
};

/** The form setting choosing what a container is, which gives its box its shape. */
const typeToggle = (get: () => ContainerType, set: (type: ContainerType) => void) =>
  pictureToggle("Type", CONTAINER_TYPES.map((t) => ({ value: t, title: CONTAINER_TYPE_TITLES[t], shape: shapeOf({ kind: "container", type: t }) })), get, set);

/** The colors of a picture of a shape: the current text color for its lines, the background for its fill. */
const PICTURE_INK: Record<Ink, string> = { outline: "currentColor", detail: "currentColor", body: "var(--background-primary)", none: "none" };

/** Draws a small picture of a shape into an element, from the same parts the shape is drawn with on the canvas. */
function shapePicture(el: HTMLElement, shape: Shape) {
  // A small box, so the details of the shapes show; a person's head is as large as on the canvas, so a person's box is too.
  const parts = shapeDrawing(shape, shape === "person" ? { x: 0, y: 0, width: 240, height: 150 } : { x: 0, y: 0, width: 100, height: 64 });
  const frame = bounds(parts.map((p) => p.box ?? bounds((p.points ?? []).map((v) => ({ ...v, width: 0, height: 0 })))!), 8)!;
  const svg = el.createSvg("svg", {
    cls: "c4-type-picture",
    attr: { viewBox: `${frame.x} ${frame.y} ${frame.width} ${frame.height}`, "aria-hidden": "true" },
  });
  for (const p of parts) {
    const attr = {
      stroke: PICTURE_INK[p.stroke], fill: PICTURE_INK[p.fill], "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round",
    };
    if (p.type === "line") {
      const pts = p.points ?? [];
      const closed = pts.length > 2 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y;
      svg.createSvg(closed ? "polygon" : "polyline", { attr: { ...attr, points: pts.map((v) => `${v.x},${v.y}`).join(" ") } });
    } else if (p.box && p.type === "ellipse") {
      const b = p.box;
      svg.createSvg("ellipse", { attr: { ...attr, cx: b.x + b.width / 2, cy: b.y + b.height / 2, rx: b.width / 2, ry: b.height / 2 } });
    } else if (p.box) {
      const b = p.box;
      const r = Math.min(p.round ?? 0, Math.min(b.width, b.height) / 4);
      svg.createSvg("rect", { attr: { ...attr, x: b.x, y: b.y, width: b.width, height: b.height, rx: r } });
    }
  }
}

/**
 * Color pickers for the outline, fill and text of an element or a type of element, each named, and a button resetting
 * them to their defaults. `render` adds them to a form as a setting of their own; `into` to a given setting.
 */
function lookPickers(
  name: string, desc: string, get: () => Look, set: (part: keyof Look, value: string) => void, reset: () => void,
) {
  const pickers: Partial<Record<keyof Look, ColorComponent>> = {};
  const refresh = () => {
    const look = get();
    for (const p of LOOK_PARTS) pickers[p]?.setValue(look[p]);
  };
  const into = (setting: Setting) => {
    setting.setClass("c4-look");
    for (const p of LOOK_PARTS) {
      const field = setting.controlEl.createEl("label", { cls: "c4-look-color" });
      field.createSpan({ text: LOOK_PART_TITLES[p] });
      pickers[p] = new ColorComponent(field).setValue(get()[p]).onChange((v) => set(p, v));
    }
    setting.addExtraButton((x) => x.setIcon("rotate-ccw").setTooltip("Reset").onClick(() => {
      reset();
      refresh();
    }));
  };
  const render = (el: HTMLElement) => into(new Setting(el).setName(name).setDesc(desc).setClass("c4-field"));
  return { into, render, refresh };
}

/** The form setting that makes an element external: outside the system being described, drawn in grey. */
const externalToggle = (get: () => boolean, set: (on: boolean) => void) => (el: HTMLElement) => {
  new Setting(el)
    .setName("External")
    .setDesc("Outside the system being described.")
    .addToggle((t) => t.setValue(get()).onChange(set));
};

/**
 * The form's metadata of an element or relationship, as key: value rows next to its name like the other fields, edited in place: a
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

/** Whether a drawing has anything of C4 in it: elements, their layers or ghosts. */
const hasC4 = (els: readonly El[]): boolean => els.some((e) => !e.isDeleted && !!e.customData?.[KEY]);

/** What can be dragged and dropped in a drawing: the C4 boxes and the boxes of groups. */
const draggables = (els: readonly El[]): El[] => els.filter((e) => !e.containerId && !e.isDeleted && (elementData(e.customData) || groupData(e.customData)));

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

/** The one selected element, relationship or group, when it can be edited in the layer on the canvas. */
function editableItem(view: ExcalidrawView): SelectedItem | null {
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
    else if (key === "askKind") settings.askKind = !!value;
    else if (key === "theme") {
      settings.theme = validTheme(value, settings.themes);
      return this.plugin.saveThemes();
    }
    await this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      ...this.general(),
      {
        name: "Ask what a new drawing is for",
        desc: "On a drawing without C4 elements that is not yet anybody's, offer C4 diagrams or plain Excalidraw instead of taking it over. With another plugin drawing its own kind of diagram enabled, the plugins always ask.",
        control: { type: "toggle", key: "askKind" },
      },
      {
        name: "Theme of new drawings",
        desc: "The colors of a drawing: a built-in theme or one of your own. Each drawing keeps its own, changed from the panel's theme menu or the command palette.",
        control: { type: "dropdown", key: "theme", options: Object.fromEntries(themeOptions().map((t) => [t.id, t.name])) },
      },
      {
        type: "page",
        name: "Themes",
        desc: "Your own themes, which the theme menu offers after the built-in ones. Add, edit, import and export them.",
        displayValue: () => String(this.plugin.settings.themes.length),
        items: [this.themeList(), this.themeTransfer()],
      },
      {
        type: "group",
        heading: "Keyboard shortcuts",
        items: SHORTCUT_ACTIONS.map((a) => ({ ...SHORTCUT_NAMES[a], render: (setting: Setting) => this.shortcutSetting(setting, a) })),
      },
    ];
  }

  /**
   * A shortcut's setting: a button showing its key, which records the next key pressed with its modifiers (Escape
   * cancels), and buttons to turn it off and to restore its default.
   */
  private shortcutSetting(setting: Setting, action: ShortcutAction) {
    const shortcuts = this.plugin.settings.shortcuts;
    const save = async (key: string) => {
      shortcuts[action] = key;
      await this.plugin.saveSettings();
    };
    let stop: (() => void) | undefined;
    setting.addButton((b) => {
      const show = () => b.setButtonText(shortcuts[action] || "None");
      show();
      b.onClick(() => {
        stop?.();
        b.setButtonText("Press a key…");
        const record = (e: KeyboardEvent) => {
          const key = shortcutOf(e);
          if (!key) return; // a modifier alone: wait for the key
          e.preventDefault();
          e.stopImmediatePropagation();
          stop?.();
          if (key !== "Escape") void save(key).then(show);
          else show();
        };
        window.addEventListener("keydown", record, { capture: true });
        stop = () => {
          window.removeEventListener("keydown", record, { capture: true });
          stop = undefined;
        };
      });
      setting.addExtraButton((x) =>
        x.setIcon("x").setTooltip("Turn off").onClick(() => {
          stop?.();
          void save("").then(show);
        }),
      );
      setting.addExtraButton((x) =>
        x.setIcon("rotate-ccw").setTooltip(`Restore default (${DEFAULT_SHORTCUTS[action]})`).onClick(() => {
          stop?.();
          void save(DEFAULT_SHORTCUTS[action]).then(show);
        }),
      );
    });
    return () => stop?.();
  }

  private async saveAndUpdate() {
    await this.plugin.saveThemes();
    this.update();
  }

  /** The user's themes, each a page of its colors. */
  private themeList(): SettingDefinitionItem {
    const themes = this.plugin.settings.themes;
    return {
      type: "list",
      heading: "Your themes",
      emptyState: "No themes of your own. Add one, starting from any theme, or import one.",
      items: themes.map((t) => this.themePage(t)),
      onReorder: (from, to) => {
        themes.splice(to, 0, ...themes.splice(from, 1));
        void this.saveAndUpdate();
      },
      addItem: { name: "Add theme", action: (el) => this.chooseStart(el) },
    };
  }

  /** Lets the user pick the theme a new one starts as a copy of. */
  private chooseStart(el: HTMLElement) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Start from").setIsLabel(true));
    const options = themeOptions();
    options.forEach((t, i) => {
      if (t.user && !options[i - 1]?.user) menu.addSeparator();
      menu.addItem((item) => item.setTitle(themeTitle(t.id)).onClick(() => this.addThemes([{ name: `${t.name} copy`, colors: copyColors(t.id) }])));
    });
    const r = el.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom }, el.doc);
  }

  /** Adds themes with new ids, renamed when another theme has their name. */
  private addThemes(added: { name: string; colors: Colors }[]) {
    const themes = this.plugin.settings.themes;
    for (const t of added) {
      themes.push({ id: newThemeId(themes.map((x) => x.id)), name: uniqueName(t.name, themes.map((x) => x.name)), colors: t.colors });
    }
    void this.saveAndUpdate();
  }

  /** Deletes the theme after asking, and leaves its page. */
  private deleteTheme(t: UserTheme) {
    new ConfirmModal(this.app, `Delete theme ${t.name}?`, "Drawings with this theme get the Classic colors.", "Delete", () => {
      const settings = this.plugin.settings;
      settings.themes = settings.themes.filter((x) => x !== t);
      settings.theme = validTheme(settings.theme, settings.themes);
      void this.plugin.saveThemes().then(() => {
        // Obsidian has no public way back from a page; without it, the emptied page stays until the user goes back.
        (this as unknown as { setting?: { closePage?: () => void } }).setting?.closePage?.();
        this.update();
      });
    }).open();
  }

  /** A theme's page: renaming and deleting it, then the colors of each type of element. */
  private themePage(t: UserTheme): SettingDefinitionPage {
    const page: SettingDefinitionPage & { id: string } = {
      type: "page",
      id: t.id, // Obsidian finds the open page by its id, the name by default, so renaming the theme keeps the page open
      name: t.name,
      desc: t.id === this.plugin.settings.theme ? "New drawings get this theme." : undefined,
      items: [
        {
          type: "group",
          items: [
            {
              name: "Rename",
              desc: `Called ${t.name}.`,
              action: () => new RenameModal(this.app, t.name, (name) => {
                t.name = name;
                void this.saveAndUpdate();
              }).open(),
            },
            { name: "Delete theme", desc: "Drawings with this theme get the Classic colors.", action: () => this.deleteTheme(t) },
          ],
        },
        {
          type: "group",
          heading: "Colors",
          items: LOOK_KEYS.map((k) => ({ name: LOOK_KEY_TITLES[k], render: (setting: Setting) => this.lookSetting(setting, t, k) })),
        },
        {
          name: "Reset colors to defaults",
          desc: "Restores the Classic colors of every type of element.",
          action: () => {
            t.colors = copyColors("classic");
            void this.saveAndUpdate();
          },
        },
      ],
    };
    return page;
  }

  /** The colors of a type of element in a theme: a picker for each, and a button restoring the Classic ones. */
  private lookSetting(setting: Setting, theme: UserTheme, key: LookKey) {
    lookPickers(
      "", "",
      () => theme.colors[key],
      (part, value) => {
        theme.colors[key] = { ...theme.colors[key], [part]: value };
        void this.plugin.saveThemes();
      },
      () => {
        theme.colors[key] = { ...colorsOf("classic")[key] };
        void this.plugin.saveThemes();
      },
    ).into(setting);
  }

  /** Importing themes from the clipboard or a file, and exporting all of them. */
  private themeTransfer(): SettingDefinitionItem {
    const themes = this.plugin.settings.themes;
    return {
      type: "group",
      heading: "Import and export",
      items: [
        { name: "Import from the clipboard", desc: "Themes copied as JSON from another vault, or shared with you.", action: () => void this.importFromClipboard() },
        { name: "Import from a file", desc: "A JSON file of themes saved from another vault, or shared with you.", action: () => this.importFromFile() },
        { name: "Export to the clipboard", desc: "All your themes as JSON.", disabled: () => !themes.length, action: () => void this.copyThemes(themes) },
        {
          name: "Export as a file in the vault", desc: "All your themes as a JSON file at the root of the vault.", disabled: () => !themes.length,
          action: () => void this.saveThemesFile(themes, "C4 themes"),
        },
      ],
    };
  }

  private async copyThemes(themes: UserTheme[]) {
    try {
      await navigator.clipboard.writeText(themesToJson(themes));
    } catch {
      return void new Notice("Can't write to the clipboard.");
    }
    new Notice(`${themes.length} ${themes.length === 1 ? "theme" : "themes"} copied to the clipboard.`);
  }

  /** Saves the themes as a JSON file at the root of the vault, numbered when the name is taken. */
  private async saveThemesFile(themes: UserTheme[], name: string) {
    const vault = this.app.vault;
    let path = normalizePath(`${name}.json`);
    for (let i = 2; vault.getAbstractFileByPath(path); i++) path = normalizePath(`${name} ${i}.json`);
    try {
      await vault.create(path, themesToJson(themes));
    } catch {
      return void new Notice(`Can't save ${path}.`);
    }
    new Notice(`Saved to ${path}.`);
  }

  private importThemes(text: string) {
    const found = parseThemes(text);
    if (!found) return void new Notice("No themes to import.");
    this.addThemes(found);
    new Notice(found.length === 1 ? `Theme ${found[0].name} imported.` : `${found.length} themes imported.`);
  }

  private async importFromClipboard() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return void new Notice("Can't read the clipboard.");
    }
    this.importThemes(text);
  }

  private importFromFile() {
    const input = createEl("input", { attr: { type: "file", accept: ".json,application/json" } });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void file.text().then((text) => this.importThemes(text));
    });
    input.click();
  }

  private general(): SettingDefinitionItem[] {
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

/** A theme's name after a few of its colors: of a person, a system, a container and a component. */
function themeTitle(t: Theme): DocumentFragment {
  return createFragment((f) => {
    const swatches = f.createSpan({ cls: "c4-swatches" });
    for (const color of themeSwatches(t)) swatches.createSpan({ cls: "c4-swatch" }).setCssProps({ "--c4-swatch": color });
    f.appendText(themeName(t) ?? "Missing theme");
  });
}

/** Picks a theme by name. */
class ThemeModal extends FuzzySuggestModal<{ id: Theme; name: string }> {
  constructor(app: App, private readonly current: Theme, private readonly choose: (t: Theme) => void) {
    super(app);
    this.setPlaceholder("Theme of the drawing");
  }

  getItems(): { id: Theme; name: string }[] {
    return themeOptions();
  }

  getItemText(t: { id: Theme; name: string }): string {
    return t.id === this.current ? `${t.name} (current)` : t.name;
  }

  onChooseItem(t: { id: Theme; name: string }) {
    this.choose(t.id);
  }
}

/** Asks before doing something that can't be undone. */
class ConfirmModal extends Modal {
  constructor(app: App, private readonly heading: string, private readonly text: string, private readonly confirm: string, private readonly onConfirm: () => void) {
    super(app);
  }

  onOpen() {
    this.setTitle(this.heading);
    this.contentEl.createEl("p", { text: this.text });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.confirm).setDestructive().setCta().onClick(() => {
        this.close();
        this.onConfirm();
      }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Asks for a new name for a theme. */
class RenameModal extends Modal {
  constructor(app: App, private readonly name: string, private readonly rename: (name: string) => void) {
    super(app);
  }

  onOpen() {
    this.setTitle("Rename theme");
    let value = this.name;
    const submit = () => {
      if (!value.trim()) return;
      this.rename(value.trim());
      this.close();
    };
    new Setting(this.contentEl).setName("Name").addText((t) => {
      t.setValue(value).onChange((v) => (value = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
      window.setTimeout(() => t.inputEl.select(), 0);
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Rename").setCta().onClick(submit));
  }

  onClose() {
    this.contentEl.empty();
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
  readonly before: ((el: HTMLElement) => void)[] = []; // settings above the fields
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
    for (const before of this.before) before(this.contentEl);
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
