// The themes as the user picks them: in a menu at a button, or by name.

import { App, FuzzySuggestModal, Menu } from "obsidian";
import { Theme, themeName, themeOptions, themeSwatches } from "./themes";

/** A theme as offered to pick: its id, its name, and whether it is one of the user's own. */
export type ThemeOption = ReturnType<typeof themeOptions>[number];

/** A theme's name after a few of its colors: of a person, a system, a container and a component. */
function themeTitle(t: Theme): DocumentFragment {
  return createFragment((f) => {
    const swatches = f.createSpan({ cls: "c4-swatches" });
    for (const color of themeSwatches(t)) swatches.createSpan({ cls: "c4-swatch" }).setCssProps({ "--c4-swatch": color });
    f.appendText(themeName(t) ?? "Missing theme");
  });
}

/**
 * The themes as a menu below a button, under a heading: the built-in ones, then the user's own. The `checked` theme,
 * when given, is checked.
 */
export function showThemeMenu(at: HTMLElement, heading: string, choose: (t: ThemeOption) => void, checked?: Theme) {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(heading).setIsLabel(true));
  const options = themeOptions();
  options.forEach((t, i) => {
    if (t.user && !options[i - 1]?.user) menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle(themeTitle(t.id)).onClick(() => choose(t));
      if (checked !== undefined) item.setChecked(t.id === checked);
    });
  });
  const r = at.getBoundingClientRect();
  menu.showAtPosition({ x: r.left, y: r.bottom }, at.doc);
}

/** Picks a theme by name. */
export class ThemeModal extends FuzzySuggestModal<ThemeOption> {
  constructor(app: App, private readonly current: Theme, private readonly choose: (t: Theme) => void) {
    super(app);
    this.setPlaceholder("Theme of the drawing");
  }

  getItems(): ThemeOption[] {
    return themeOptions();
  }

  getItemText(t: ThemeOption): string {
    return t.id === this.current ? `${t.name} (current)` : t.name;
  }

  onChooseItem(t: ThemeOption) {
    this.choose(t.id);
  }
}
