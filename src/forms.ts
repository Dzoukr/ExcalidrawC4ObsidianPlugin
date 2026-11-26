// The forms adding and editing elements, relationships and groups, and the settings they are made of.

import { App, ColorComponent, ExtraButtonComponent, FuzzyMatch, FuzzySuggestModal, Modal, Setting, setIcon } from "obsidian";
import {
  C4Kind, CONTAINER_TYPES, CONTAINER_TYPE_TITLES, CUSTOM_PICTURE, ContainerType, Ink, LOOK_PARTS, LOOK_PART_TITLES, Look, Shape, Vec, bounds,
  cleanMetadata, hasTechnology, kindTitle, shapeDrawing, shapeOf,
} from "./model";
import { iconIds, iconName } from "./icons";

/** A text field of a form: the key of its value, its name, and what it starts as. */
export interface Field {
  key: string;
  name: string;
  value?: string;
  placeholder?: string;
  multiline?: boolean;
}

/** What a form does: add something new, or edit what is there. */
export type Verb = "Add" | "Edit";

/** The text of a form's button, after what the form does. */
export const submitText = (verb: Verb): string => (verb === "Edit" ? "Save" : "Add");

/** The text fields of an element's form, for its kind. */
export function elementFields(kind: C4Kind, external: boolean): Field[] {
  const fields: Field[] = [{ key: "name", name: "Name", placeholder: kindTitle(kind, external) }];
  if (hasTechnology(kind)) fields.push({ key: "technology", name: "Technology", placeholder: "E.g. ASP.NET, Spring Boot, PostgreSQL" });
  fields.push({ key: "description", name: "Description", multiline: true }, noteField);
  return fields;
}

/** The text field of the note of an element or relationship, which is not drawn. */
export const noteField: Field = { key: "note", name: "Note", multiline: true, placeholder: "Markdown supported note" };

/** A choice in a row of buttons with pictures: what it stands for, its name, and the shape pictured, with its icon. */
interface PictureOption<T extends string> {
  value: T;
  title: string;
  shape: Shape;
  icon?: Vec[][];
}

/**
 * A form setting choosing one of a few options: a row of buttons, each with a picture of a shape, one of them pressed.
 * The arrow keys move along the row.
 */
const pictureToggle = <T extends string>(name: string, options: PictureOption<T>[], get: () => T, set: (value: T) => void) => (el: HTMLElement) => {
  const setting = new Setting(el).setName(name).setClass("c4-field");
  const row = setting.controlEl.createDiv({ cls: "c4-type-toggle", attr: { role: "radiogroup", "aria-label": name } });
  const buttons = options.map((o) => {
    const b = row.createEl("button", { cls: "c4-type-option", attr: { type: "button", role: "radio", "aria-label": o.title } });
    shapePicture(b, o.shape, o.icon);
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
export const typeToggle = (get: () => ContainerType, set: (type: ContainerType) => void) =>
  pictureToggle("Type", CONTAINER_TYPES.map((t) => ({
    value: t,
    title: CONTAINER_TYPE_TITLES[t],
    // A custom container can have any icon: its picture has one standing for them all.
    ...(t === "custom" ? { shape: "icon" as const, icon: CUSTOM_PICTURE } : { shape: shapeOf({ kind: "container", type: t }) }),
  })), get, set);

/**
 * The form setting picking a custom container's icon, drawn in the top left corner of its box: a button showing the
 * icon, which opens the icons to search, and one to take it away. `shown` gets the setting, to show only for custom
 * containers.
 */
export const iconPicker = (app: App, get: () => string | undefined, set: (icon: string | undefined) => void, shown: (el: HTMLElement) => void) => (el: HTMLElement) => {
  const setting = new Setting(el).setName("Icon").setClass("c4-field");
  const pick = setting.controlEl.createEl("button", { cls: "c4-icon-pick", attr: { type: "button" } });
  let clear: ExtraButtonComponent | undefined;
  const show = () => {
    const id = get();
    pick.empty();
    if (id) {
      setIcon(pick.createSpan({ cls: "c4-icon-glyph" }), id);
      pick.createSpan({ text: iconName(id) });
    } else pick.createSpan({ cls: "c4-icon-none", text: "Choose an icon" });
    clear?.extraSettingsEl.toggle(!!id);
  };
  pick.addEventListener("click", () => new IconModal(app, (id) => {
    set(id);
    show();
  }).open());
  setting.addExtraButton((b) => {
    clear = b;
    b.setIcon("x").setTooltip("No icon").onClick(() => {
      set(undefined);
      show();
    });
  });
  show();
  shown(setting.settingEl);
};

/** The colors of a picture of a shape: the current text color for its lines, the background for its fill. */
const PICTURE_INK: Record<Ink, string> = { outline: "currentColor", detail: "currentColor", body: "var(--background-primary)", none: "none" };

/** Draws a small picture of a shape into an element, from the same parts the shape is drawn with on the canvas. */
function shapePicture(el: HTMLElement, shape: Shape, icon: Vec[][] = []) {
  // A small box, so the details of the shapes show; a person's head is as large as on the canvas, so a person's box is too.
  const parts = shapeDrawing(shape, shape === "person" ? { x: 0, y: 0, width: 240, height: 150 } : { x: 0, y: 0, width: 100, height: 64 }, icon);
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
 * Color pickers for the outline, fill and text of an element or a type of element (or the ones of them given), each
 * named, and a button resetting them to their defaults. `render` adds them to a form as a setting of their own; `into`
 * to a given setting.
 */
export function lookPickers(
  name: string, get: () => Look, set: (part: keyof Look, value: string) => void, reset: () => void, parts: readonly (keyof Look)[] = LOOK_PARTS,
) {
  const pickers: Partial<Record<keyof Look, ColorComponent>> = {};
  const refresh = () => {
    const look = get();
    for (const p of parts) pickers[p]?.setValue(look[p]);
  };
  const into = (setting: Setting) => {
    setting.setClass("c4-look");
    for (const p of parts) {
      const field = setting.controlEl.createEl("label", { cls: "c4-look-color" });
      field.createSpan({ text: LOOK_PART_TITLES[p] });
      pickers[p] = new ColorComponent(field).setValue(get()[p]).onChange((v) => set(p, v));
    }
    setting.addExtraButton((x) => x.setIcon("rotate-ccw").setTooltip("Reset").onClick(() => {
      reset();
      refresh();
    }));
  };
  const render = (el: HTMLElement) => into(new Setting(el).setName(name).setClass("c4-field"));
  return { into, render, refresh };
}

/** The form setting that makes an element external: outside the system being described, drawn in grey. */
export const externalToggle = (get: () => boolean, set: (on: boolean) => void) => (el: HTMLElement) => {
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

/** A small icon button in a form's top right corner, next to its close button. */
export interface HeaderButton {
  icon: string;
  label: string;
  onClick: () => void;
}

/** The form's button that turns a relationship the other way round; the form's title shows which way it goes. */
export const reverseButton = (flip: () => void): HeaderButton => ({ icon: "arrow-left-right", label: "Reverse direction", onClick: flip });

/** A small form: Enter submits, Ctrl+Enter in a multi-line field. */
export class FormModal extends Modal {
  private readonly values: Record<string, string> = {};
  readonly before: ((el: HTMLElement) => void)[] = []; // settings above the fields
  readonly extras: ((el: HTMLElement) => void)[] = []; // more settings below the fields
  headerButton?: HeaderButton;
  private headerEl?: HTMLElement;
  private rows?: [string, string][]; // the metadata edited, as key: value rows, once the form has its editor

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

  /** Adds the metadata editor below the other settings so far, its rows starting as the given metadata. */
  editMetadata(metadata: Record<string, string> | undefined) {
    const rows: [string, string][] = Object.entries(metadata ?? {});
    this.rows = rows;
    this.extras.push(metadataEditor(rows, () => this.submit()));
  }

  /** The metadata as the form leaves it, without empty keys; none without the metadata editor. */
  get metadata(): Record<string, string> | undefined {
    return this.rows && cleanMetadata(this.rows);
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

/** Picks an icon by its name, each shown with its picture. */
class IconModal extends FuzzySuggestModal<string> {
  constructor(app: App, private readonly choose: (id: string) => void) {
    super(app);
    this.setPlaceholder("Icon of the container");
  }

  getItems(): string[] {
    return iconIds();
  }

  getItemText(id: string): string {
    return iconName(id);
  }

  renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement) {
    super.renderSuggestion(match, el);
    el.addClass("c4-icon-suggestion");
    const glyph = createSpan({ cls: "c4-icon-glyph" });
    setIcon(glyph, match.item);
    el.prepend(glyph);
  }

  onChooseItem(id: string) {
    this.choose(id);
  }
}
