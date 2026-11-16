import { ItemView, Notice, Plugin } from "obsidian";
import {
  Selected, SelectedGroup, SelectedItem, SelectedRelationship, addElement, addGroup, addRelationship, canAdd, canEdit, canRelate, deleteBelow, diagramInfo, dissolveGroups, dropBoxes, hasKind, isElement,
  isGroup, isRelationship, ghostAt, itemAt, itemOf, moveBoundary, redrawResized, regroup, restoreBoundary, reverseRelationship, onlyC4Selected, refreshLooks, setDrawingTheme, themeOfDrawing, useDrawingColors, selectNext, selectedElements, selectedEnds,
  selectedItem, selectionShapes, updateElement, updateGroup, updateRelationship, zoomIn, zoomOut,
} from "./actions";
import { Guard, guardLevels, protectStore, refreshCanvas, selectionOf } from "./layertx";
import { AppState, El, ExcalidrawAPI, ExcalidrawView, VIEW_TYPE_EXCALIDRAW, isExcalidrawView } from "./excalidraw";
import {
  Box, C4Element, C4Group, C4Kind, C4Relationship, ContainerType, GROUP_LOOK_PARTS, KEY, KINDS, Look, boundaryData, canBeExternal, elementData, groupData, groupLookOf,
  hasTechnology, iconOf, isContainerType, kindTitle, levelOf, lookOf, ownGroupLook, ownLook, zoomView,
} from "./model";
import { setNewDrawingTheme, setUserThemes } from "./themes";
import { C4Panel } from "./panel";
import { MODE, MODE_KEY, Owner, isAlone, ownerOf, register } from "./mode";
import { PLAIN, offer, withdraw } from "./chooser";
import { Highlight } from "./highlight";
import { ShortcutAction, actionOf, isMove, shortcutOf } from "./keys";
import { C4SettingTab, DEFAULT_SETTINGS, Settings, SettingsHost, loadSettings } from "./settings";
import { Field, FormModal, Verb, elementFields, externalToggle, iconPicker, lookPickers, reverseButton, submitText, typeToggle } from "./forms";
import { ThemeModal, showThemeMenu } from "./themeui";

const NO_EXCALIDRAW = "The Excalidraw plugin's scripting API is not available.";

/** Tells the user when something was not done, the Excalidraw plugin's scripting API not being available. */
function reportIfFailed(done: boolean) {
  if (!done) new Notice(NO_EXCALIDRAW);
}

/** A drawing whose Excalidraw component has mounted. */
type MountedView = ExcalidrawView & { excalidrawAPI: ExcalidrawAPI };

interface ViewState {
  view: ExcalidrawView;
  api: ExcalidrawAPI;
  panel: C4Panel;
  highlight: Highlight;
  unsubscribe?: () => void;
  raf: number;
  highlightRaf: number;
  canvasRaf: number;
  selection: unknown; // the selection the panel shows, to refresh it only when the selection changes
  viewMode: boolean | undefined;
  drag?: Map<string, Box>; // where the C4 boxes and groups were when the pointer went down on the drawing, until it goes up
  dropping?: Map<string, Box>; // the drag whose drop is being handled, once the pointer went up
  revision: number; // of the elements last checked for misplaced boxes
  guard?: Guard; // the elements of the levels above, put back when deleted
  groups?: Set<string>; // the boxes of the groups on the canvas at the last look, to tell which were deleted since
  claimed?: boolean; // taken over for C4, until the frontmatter says so
  plain?: boolean; // kept plain Excalidraw, until the frontmatter says so
  keyWritten?: boolean; // the drawing's kind was written to its frontmatter
}

const ATTACH_RETRIES = 50;

export default class ExcalidrawC4Plugin extends Plugin implements SettingsHost {
  settings: Settings = DEFAULT_SETTINGS;
  private states = new Map<ExcalidrawView, ViewState>();
  private retries = new WeakMap<ExcalidrawView, number>();
  private retryTimer = 0;
  // While paused, keys and double-clicks are left to Excalidraw. Not saved: a restart resumes.
  private paused = false;

  async onload() {
    this.settings = loadSettings((await this.loadData()) as Partial<Settings> | null);
    this.applyThemes();
    this.addSettingTab(new C4SettingTab(this.app, this));

    // Other plugins drawing their own kind of diagram find this one here, and leave its drawings alone.
    this.register(register());
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      for (const s of this.states.values()) {
        if (s.view.file !== file) continue;
        s.claimed = false;
        s.plain = false;
        this.refresh(s);
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
        const view = this.activeView();
        if (!view || this.isMine(view)) return false;
        if (!checking) void this.claim(view);
        return true;
      },
    });
    this.addCommand({
      id: "keep-plain",
      name: "Keep this drawing plain Excalidraw",
      checkCallback: (checking) => {
        const view = this.activeView();
        if (!view || this.kindOf(view) === PLAIN) return false;
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

  /** The drawing in the active tab, once Excalidraw has mounted in it. */
  private activeView(): MountedView | null {
    const view = this.app.workspace.getActiveViewOfType(ItemView);
    return isExcalidrawView(view) && view.excalidrawAPI ? (view as MountedView) : null;
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
      this.refresh(s);
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
    for (const s of this.states.values()) this.refresh(s);
  }

  /** The drawing in the active tab, while it is being edited rather than only viewed. */
  private editedView(): ExcalidrawView | null {
    const view = this.activeView();
    if (!view) return null;
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
    if (selectedEnds(view).length === 2) return this.promptRelationship(view);
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
    if (!item) {
      // A ghost of a level above is not edited here, nor is its text.
      if (ghostAt(view, at)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }
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
      s.drag = new Map(tracked(s.api.getSceneElements()).map((b) => [b.id, { x: b.x, y: b.y, width: b.width, height: b.height }]));
    }
  }

  private onPointerUp() {
    for (const s of this.states.values()) {
      const before = s.drag;
      if (!before || s.dropping === before) continue;
      s.dropping = before;
      // After Excalidraw has finished the drag. Until then nothing is fitted to where things were dropped: a group
      // fitted around a box dragged out of it would keep it, and would look dragged itself.
      window.setTimeout(() => {
        if (s.drag !== before) return; // another drag began
        s.drag = undefined;
        this.afterDrag(s, before);
      }, 0);
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
    const selected = s.api.getAppState().selectedElementIds ?? {};
    const moved = els.flatMap((b) => {
      const was = before.get(b.id);
      // A group resized rather than moved takes nothing along: it is fitted to what is in it again. Only a group the
      // user dragged is moved, not one fitted to what is in it.
      const fitted = !!groupData(b.customData) && (resized(b) || !selected[b.id]);
      return was && !fitted && (off(was.x, b.x) || off(was.y, b.y)) ? [{ id: b.id, dx: b.x - was.x, dy: b.y - was.y }] : [];
    });
    // A boundary moved takes what was in it along, before anything dropped is put where it landed.
    const dragged = new Set(moved.map((m) => m.id));
    for (const b of tracked(s.api.getSceneElements())) {
      const was = before.get(b.id);
      if (boundaryData(b.customData) && was && !resized(b) && (off(was.x, b.x) || off(was.y, b.y))) moveBoundary(s.view, b.id, was, dragged);
    }
    // Groups first: a group dragged takes what is in it along, and what is dropped into a group goes in it.
    if (moved.length) regroup(s.view, moved);
    const messages = moved.length ? dropBoxes(s.view, moved.map((b) => b.id)) : [];
    // Boxes resized keep their new size, with their text and shape drawn again for it.
    redrawResized(s.view, els.filter((b) => elementData(b.customData) && resized(b)).map((b) => b.id));
    // A boundary resized by hand goes back to fitting what is in it.
    for (const b of tracked(s.api.getSceneElements())) if (boundaryData(b.customData) && resized(b)) restoreBoundary(s.view, b.id, before.get(b.id)!);
    for (const message of messages) new Notice(message);
    if (messages.length) this.refreshPanel(s);
    this.checkCanvas(s);
  }

  /**
   * Marks the boxes that are where they do not belong and fits the ghosts around what is drawn, whenever the elements
   * change and nothing is being dragged.
   */
  private checkCanvas(s: ViewState) {
    if (s.drag || !this.isMine(s.view)) return;
    const els = s.api.getSceneElements();
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
    if (r) reportIfFailed(reverseRelationship(view, r.el.id));
  }

  private zoomIn(view: ExcalidrawView, item?: Selected) {
    reportIfFailed(zoomIn(view, item));
    this.refreshView(view);
  }

  private zoomOut(view: ExcalidrawView) {
    reportIfFailed(zoomOut(view));
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
    const s: ViewState = { view, api, panel, highlight, raf: 0, highlightRaf: 0, canvasRaf: 0, selection: null, viewMode: undefined, revision: NaN };
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
    if (s.canvasRaf) window.cancelAnimationFrame(s.canvasRaf);
    s.panel.destroy();
    s.highlight.destroy();
  }

  /**
   * Excalidraw reports every change, even a pointer move: the panel follows only the selection and view mode, the marks
   * of misplaced boxes only the elements.
   */
  private onSceneChange(s: ViewState, els: readonly El[], appState: AppState) {
    if (!s.drag && !s.canvasRaf && revisionOf(els) !== s.revision) {
      s.canvasRaf = window.requestAnimationFrame(() => {
        s.canvasRaf = 0;
        // Not once the drawing is closed, or attached again with another state.
        if (this.states.get(s.view) === s) this.checkCanvas(s);
      });
    }
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

  /** Shows the panel and the highlight as the drawing, its owner and the pause are now. */
  private refresh(s: ViewState) {
    this.refreshPanel(s);
    this.refreshHighlight(s);
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
    const view = this.activeView();
    if (!view || (applies && !applies(view))) return false;
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
    this.groupForm(view, "Add", { group: "", name: "", members: [] }, (name, look) => addGroup(view, name, look));
  }

  private promptEditGroup(view: ExcalidrawView, { el, data }: SelectedGroup) {
    this.groupForm(view, "Edit", data, (name, look) => updateGroup(view, el.id, name, look));
  }

  /** The form of a group, the same for adding and editing it: its name and its own colors. */
  private groupForm(view: ExcalidrawView, verb: Verb, data: C4Group, save: (name: string, look?: Partial<Look>) => boolean) {
    useDrawingColors(view); // the colors the form shows
    let look: Partial<Look> = { ...data.look };
    const fields: Field[] = [{ key: "name", name: "Name", value: data.name, placeholder: "E.g. Customer service" }];
    const modal = new FormModal(this.app, `${verb} group`, fields, (v) => {
      useDrawingColors(view); // for its own colors, those that differ from the colors of groups in the drawing's theme
      reportIfFailed(save(v.name ?? "", ownGroupLook(look)));
    }, submitText(verb));
    modal.extras.push(lookPickers(
      "Colors",
      () => groupLookOf({ look }),
      (part, value) => (look = { ...look, [part]: value }),
      () => (look = {}),
      GROUP_LOOK_PARTS,
    ).render);
    modal.open();
  }

  /** Lets the user pick the drawing's theme. */
  private chooseTheme(view: ExcalidrawView) {
    new ThemeModal(this.app, themeOfDrawing(view), (t) => reportIfFailed(setDrawingTheme(view, t))).open();
  }

  /** The themes as a menu at the panel's button, the drawing's one checked. */
  private themeMenu(view: ExcalidrawView, at: HTMLElement) {
    showThemeMenu(at, "Theme of the drawing", (t) => reportIfFailed(setDrawingTheme(view, t.id)), themeOfDrawing(view));
  }

  private promptEditElement(view: ExcalidrawView, { el, data }: Selected) {
    this.elementForm(view, "Edit", data, (updated) => updateElement(view, el.id, updated));
  }

  /** The form of an element, the same for adding and editing it; `save` gets the element as the form leaves it. */
  private elementForm(view: ExcalidrawView, verb: Verb, data: C4Element, save: (data: C4Element) => boolean) {
    useDrawingColors(view); // the colors the form shows
    let external = !!data.external;
    let type: ContainerType = isContainerType(data.type) ? data.type : "generic";
    let icon = data.icon;
    const heading = () => `${verb} ${kindTitle(data.kind, external).toLowerCase()}`;
    const values = { name: data.name, technology: data.technology ?? "", description: data.description ?? "" };
    const fields = elementFields(data.kind, external).map((f) => ({ ...f, value: values[f.key as keyof typeof values] }));
    let look: Partial<Look> = { ...data.look };
    const typed = () => ({ kind: data.kind, ...(data.kind === "container" ? { type } : {}), external });
    const modal = new FormModal(this.app, heading(), fields, (v) => {
      const technology = hasTechnology(data.kind) ? v.technology : undefined;
      useDrawingColors(view); // for its own colors, those that differ from its type's in the drawing's theme
      const element: C4Element = {
        ...data, ...typed(), icon, name: v.name ?? "", technology, description: v.description, metadata: modal.metadata, look: ownLook(typed(), look),
      };
      // Only a custom container has an icon.
      if (!iconOf(element)) delete element.icon;
      reportIfFailed(save(element));
    }, submitText(verb));
    const colors = lookPickers(
      "Colors",
      () => lookOf({ ...typed(), look }),
      (part, value) => (look = { ...look, [part]: value }),
      () => (look = {}),
    );
    if (data.kind === "container") {
      let iconSetting: HTMLElement | undefined;
      modal.before.push(typeToggle(() => type, (t) => {
        type = t;
        iconSetting?.toggle(t === "custom");
        colors.refresh();
      }));
      modal.before.push(iconPicker(this.app, () => icon, (i) => (icon = i), (el) => {
        iconSetting = el;
        el.toggle(type === "custom");
      }));
    }
    // Containers and components are external as their system is.
    if (canBeExternal(data.kind)) modal.extras.push(externalToggle(() => external, (on) => {
      external = on;
      modal.setTitle(heading());
      colors.refresh();
    }));
    modal.extras.push(colors.render);
    modal.editMetadata(data.metadata);
    modal.open();
  }

  private promptEditRelationship(view: ExcalidrawView, { el, data }: SelectedRelationship) {
    const els = view.excalidrawAPI?.getSceneElements() ?? [];
    const nameOf = (id?: string) => {
      const end = els.find((e) => e.id === id);
      const scope = boundaryData(end?.customData)?.boundary;
      // A relationship carried down to a boundary: the boundary's label names its system or container.
      const label = scope ? els.find((e) => e.type === "text" && boundaryData(e.customData)?.boundary === scope)?.text?.split("\n")[0] : undefined;
      return elementData(end?.customData)?.name || label || "Unnamed";
    };
    const ends: [string, string] = [nameOf(el.startBinding?.elementId), nameOf(el.endBinding?.elementId)];
    this.relationshipForm("Edit", ends, data, (updated, reversed) => updateRelationship(view, el.id, updated, reversed));
  }

  private promptRelationship(view: ExcalidrawView) {
    // The element selected first is where the relationship starts, unless reversed.
    const [a, b] = selectedEnds(view);
    if (!a || !b) return;
    if (!canRelate(view, a, b)) {
      new Notice("An element has no relationship with what it is in.");
      return;
    }
    const ends: [string, string] = [a.data.name || "Unnamed", b.data.name || "Unnamed"];
    this.relationshipForm("Add", ends, { relationship: true, description: "Uses" }, (added, reversed) => {
      const [from, to] = reversed ? [b, a] : [a, b];
      return addRelationship(view, from.el, to.el, added);
    });
  }

  /**
   * The form of a relationship, the same for adding and editing it, its title the names of its ends; `save` gets the
   * relationship as the form leaves it, and whether it was turned the other way round.
   */
  private relationshipForm(verb: Verb, ends: [string, string], data: C4Relationship, save: (data: C4Relationship, reversed: boolean) => boolean) {
    const fields: Field[] = [
      { key: "description", name: "Description", value: data.description },
      { key: "technology", name: "Technology", value: data.technology ?? "", placeholder: "E.g. JSON/HTTPS" },
    ];
    let reversed = false;
    const title = () => (reversed ? [...ends].reverse() : ends).join(" → ");
    const modal = new FormModal(this.app, title(), fields, (v) => {
      reportIfFailed(save({ ...data, description: v.description ?? "", technology: v.technology, metadata: modal.metadata }, reversed));
    }, submitText(verb));
    modal.headerButton = reverseButton(() => {
      reversed = !reversed;
      modal.setTitle(title());
    });
    modal.editMetadata(data.metadata);
    modal.open();
  }
}

/** Whether a drawing has anything of C4 in it: elements, their layers or ghosts. */
const hasC4 = (els: readonly El[]): boolean => els.some((e) => !e.isDeleted && !!e.customData?.[KEY]);

/** What is watched while the pointer is down: what can be dragged and dropped, and the boundary, which can be resized. */
const tracked = (els: readonly El[]): El[] => [...draggables(els), ...els.filter((e) => !e.isDeleted && e.type !== "text" && boundaryData(e.customData))];

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
  const [a, b, ...rest] = selectedEnds(view);
  return a && b && !rest.length && canRelate(view, a, b) ? [a, b] : null;
}
