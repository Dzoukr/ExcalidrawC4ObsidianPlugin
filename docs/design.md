# Excalidraw C4 Model: design draft

Draw [C4 model](https://c4model.com) diagrams in Excalidraw drawings in Obsidian. The boxes and arrows are ordinary Excalidraw elements, with their C4 data stored in `customData.c4`. The drawing stays a normal Excalidraw drawing even when the plugin is not installed.

## Model

| Element | Data | Look |
|---|---|---|
| Person | name, description | dark blue, grey if external |
| Software system | name, description | blue, grey if external |
| Container | name, technology, description | light blue, grey if external |
| Component | name, technology, description | lightest blue, grey if external |
| Relationship | description, technology | dashed grey arrow, label in the middle |

Box text follows the C4 convention: name, `[Kind: technology]`, blank line, description.

## Done (0.1.0)

- Commands to add each element kind, internal or external, through a small form. A new element goes below the selected one, or in the middle of the view.
- A command to add a relationship between two selected elements, with a toggle to reverse its direction.
- A command to edit the selected element (name, technology, description, external) or relationship. The box is resized around its new text, keeping its center, and its relationships are straightened again.

## Levels: one drawing, one layer on the canvas

A drawing is one C4 workspace. Its diagrams are layers you zoom through, and the canvas shows one layer at a time:

- **System context**: people and software systems.
- **Container layer** of a software system: a dashed **boundary** labelled with the system holds its containers; around it are the people and systems it talks to.
- **Component layer** of a container: its components inside the container's boundary, and around it the other containers of the same system and the people and systems outside.

Zooming into a system swaps the canvas for its layer in the same place: the boundary takes the place of the system's box, and the elements around keep their places. Zooming out swaps the layer above back.

The levels above stay in view around the layer, as **ghosts**: dimmed, locked copies of their elements (`customData.c4.ghost`, ids prefixed `c4g-`), which are not part of any layer and are made again whenever the plugin changes the drawing or switches layers. Each level above makes way for the element opened below it, as far as that element's boundary reaches: what lies beyond an edge of the element's box moves as far as that edge did, and the boundary of the level above stretches around it. An element drawn in the layer is not repeated as a ghost, and the relationships of the levels above are drawn between wherever their ends are shown.

### Storage

- Only the current layer is on the canvas, as ordinary elements. The other layers are kept, as their elements, in `customData.c4.store` of one invisible, locked element: `{ current, views, hidden }`, where `views` names every layer (the system context is `""`, every other layer the id of its scope) and `hidden` holds the elements of all but the current one.
- Everything is in one scene, so a change to several layers (an edit, a relationship going up a level) is one undo step. Switching layers starts the undo history over, since undo cannot reach the layers off the canvas.
- Without the plugin, the drawing shows the layer it was saved on, with the ghosts of the levels above; the others are still in the file.
- If the invisible element goes missing (after "Unlock all" and a delete), the plugin puts it back.
- Images in layers off the canvas may lose their embedded files when the drawing is saved: not handled yet.

### Model

- Every element has a stable `id` and, for a container or component, a `parent`: the system of a container, the container of a component. Elements drawn before this had no id; their box's id stands in for it.
- One element can be drawn in several layers: every box with the same `id` is the same element. Editing one updates all of them and the boundary of its own layer.
- Deleting a box removes it from its layer only. Drawings that are not C4 elements belong to the layer they were drawn on.

### Adding elements

| Layer | Can add | Parent |
|---|---|---|
| System context | people, systems | — |
| Container layer of S | containers (inside the boundary), people, systems | S for containers |
| Component layer of C | components (inside the boundary), containers, people, systems | C for components, C's system for containers |

An element added outside its home layer (a person added to a container layer, a container added to a component layer) is also added to its home layer, so the system context always lists every person and system. The boundary grows around new boxes, and the boxes below and right of it make way.

### Zooming

- **Zoom in** on a selected internal system or container puts its layer on the canvas, first creating it if there is none: the boundary centered on the box, the children already known inside, and as neighbours the elements that have a relationship with it or with anything inside it. A neighbour already in the current layer keeps its place, moved out of the boundary's way; the others go above (they use the scope) or below (the scope uses them). Relationships among them are drawn too.
- **Zoom out** puts the layer one level up on the canvas, with the element selected.
- The view stays put unless the new layer does not fit in it.
- The panel shows the current level (System, Container or Component) and offers only the kinds it takes.
- Enter, or a double-click on a C4 element or relationship, opens its form instead of Excalidraw's text editing.

### Relationships

- A relationship goes from the element selected first to the one selected second (shift-click keeps the order). The form can reverse it, and so can the edit form and a command for a selected relationship.
- Two elements can have any number of relationships, either way. They lie side by side in lanes across the line between the elements, and each arrow is glued (`mode: "orbit"`, its own `fixedPoint`) to its own point inside the boxes, so Excalidraw keeps them apart when a box moves. Any change the plugin makes to a box or relationship lays out the lanes of that pair again.

### Relationships between levels

A relationship drawn in one layer is drawn in every other layer that shows its ends or the elements containing them, unless one is already there. So `User → Web app` drawn in the container layer of S puts `User → S` in the system context. It never goes down a level: a context relationship to S is only a neighbour in S's container layer, waiting to be connected to a container.

## Next

1. **Person shape**: a head circle above the body, grouped with the box.
2. **Checks**: relationships one level up that no relationship below accounts for; elements missing from their home diagram.
3. **Legend**: a generated key of the kinds and arrows used in the drawing.
4. **Keyboard workflow**, as in the mind map plugin: add a container under the selection, connect it with the selection, etc.
5. **Import and export**: Structurizr DSL or C4-PlantUML.
