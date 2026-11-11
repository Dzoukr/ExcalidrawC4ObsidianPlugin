# Excalidraw C4 Model

An Obsidian plugin for drawing [C4 model](https://c4model.com) diagrams inside [Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) drawings.

> Early draft. See [docs/design.md](docs/design.md) for the plan.

## Usage

A drawing is one C4 model, drawn level by level. Start with the system context (people and software systems), then zoom into a system to draw its containers, and into a container to draw its components. Zooming into a system opens it in place: its containers appear where its box was, and the rest of the levels above stays in view, dimmed, so the whole picture is never lost.

Open an Excalidraw drawing and run one of the commands, or use the panel:

- **Add person / software system / container / component**, internal or external. Each level takes only its own kinds.
- **Add relationship between the two selected elements.** It goes from the element selected first to the other one, and also appears one level up, between the elements containing its ends. Two elements can have several relationships; they lie side by side.
- **Reverse direction of selected relationship.**
- **Edit selected element or relationship**, also with Enter or a double-click. An element drawn on several levels changes on all of them.
- **Zoom into the selected system or container**, creating its layer with the elements it has relationships with.
- **Zoom out to the layer one level up.**

## Development

```bash
npm install
npm run dev   # builds on change and copies the plugin into test-vault
npm test
npm run lint
```

Open `test-vault` in Obsidian to try it out.
