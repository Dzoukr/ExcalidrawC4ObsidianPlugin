// The plugin's settings: what they are, how they are loaded, and the tab where the user changes them.

import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, SettingDefinitionPage, normalizePath } from "obsidian";
import { LOOK_KEYS, LOOK_KEY_TITLES, LookKey, lookPartsOf } from "./model";
import {
  Colors, Theme, UserTheme, colorsOf, copyColors, isPreset, mergeColors, newThemeId, parseThemes, themeOptions, themesToJson, uniqueName, validTheme,
} from "./themes";
import { PANEL_POSITIONS, PanelPosition, isPanelPosition } from "./panel";
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, SHORTCUT_NAMES, ShortcutAction, Shortcuts, loadShortcuts, shortcutOf } from "./keys";
import { lookPickers } from "./forms";
import { showThemeMenu } from "./themeui";

export interface Settings {
  showPanel: boolean;
  panelPosition: PanelPosition;
  shortcuts: Shortcuts;
  theme: Theme; // of new drawings
  themes: UserTheme[]; // the user's own, after the built-in ones
  askKind: boolean; // ask what a drawing nobody's yet is for, even with no other plugin drawing its own kind of diagram
  parentNotes: boolean; // the notes of the levels above, around a level, can be opened on it
}

export const DEFAULT_SETTINGS: Settings = { showPanel: true, panelPosition: "right", shortcuts: DEFAULT_SHORTCUTS, theme: "classic", themes: [], askKind: false, parentNotes: true };

/** The themes from saved settings, their colors over the defaults. */
function loadThemes(saved: Partial<Settings> | null): UserTheme[] {
  const out: UserTheme[] = [];
  const list: unknown[] = Array.isArray(saved?.themes) ? saved.themes : [];
  for (const t of list as Partial<UserTheme>[]) {
    if (!t || typeof t.id !== "string" || !t.id || isPreset(t.id) || out.some((x) => x.id === t.id)) continue;
    out.push({ id: t.id, name: typeof t.name === "string" && t.name.trim() ? t.name : "Theme", colors: mergeColors(t.colors) });
  }
  return out;
}

/** The settings as saved, with the defaults for what is missing or not valid. */
export function loadSettings(saved: Partial<Settings> | null): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...saved, shortcuts: loadShortcuts(saved?.shortcuts) };
  if (!isPanelPosition(settings.panelPosition)) settings.panelPosition = DEFAULT_SETTINGS.panelPosition;
  settings.askKind = settings.askKind === true;
  settings.parentNotes = settings.parentNotes !== false;
  settings.themes = loadThemes(saved);
  settings.theme = validTheme(settings.theme, settings.themes);
  return settings;
}

/** The plugin as its settings tab sees it: the settings, and saving them. */
export interface SettingsHost extends Plugin {
  settings: Settings;
  saveSettings(): Promise<void>;
  saveThemes(): Promise<void>;
}

/** What deleting a theme does to the drawings that have it. */
const DELETED_THEME = "Drawings with this theme get the Classic colors.";

export class C4SettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SettingsHost) {
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
    else if (key === "parentNotes") settings.parentNotes = !!value;
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
    showThemeMenu(el, "Start from", (t) => this.addThemes([{ name: `${t.name} copy`, colors: copyColors(t.id) }]));
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
    new ConfirmModal(this.app, `Delete theme ${t.name}?`, DELETED_THEME, "Delete", () => {
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
            { name: "Delete theme", desc: DELETED_THEME, action: () => this.deleteTheme(t) },
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
      "",
      () => theme.colors[key],
      (part, value) => {
        theme.colors[key] = { ...theme.colors[key], [part]: value };
        void this.plugin.saveThemes();
      },
      () => {
        theme.colors[key] = { ...colorsOf("classic")[key] };
        void this.plugin.saveThemes();
      },
      lookPartsOf(key),
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
        desc: "A row at the bottom or top of the drawing, or a column on its left or right side. On phones, where Excalidraw's own toolbars take the bottom, Bottom shows it at the top.",
        control: { type: "dropdown", key: "panelPosition", options: PANEL_POSITIONS },
      },
      {
        name: "Show notes of the levels above",
        desc: "The notes of what the levels above show around a level, dimmed, such as external systems, and of the systems and containers whose boundaries are around it, can be opened from their marks there.",
        control: { type: "toggle", key: "parentNotes" },
      },
    ];
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
        if (e.key === "Enter" && !e.isComposing) submit();
      });
      window.setTimeout(() => t.inputEl.select(), 0);
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Rename").setCta().onClick(submit));
  }

  onClose() {
    this.contentEl.empty();
  }
}
