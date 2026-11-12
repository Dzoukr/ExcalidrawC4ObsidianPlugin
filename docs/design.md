# Excalidraw C4 Model: design draft

Draw [C4 model](https://c4model.com) diagrams in Excalidraw drawings in Obsidian. The boxes and arrows are ordinary Excalidraw elements, with their C4 data stored in `customData.c4`. The drawing stays a normal Excalidraw drawing even when the plugin is not installed.

## Model

| Element | Data | Look |
|---|---|---|
| Person | name, description | a head above the body |
| Software system | name, description | rounded box |
| Container | type, name, technology, description | shaped by its type |
| Component | name, technology, description | box with the two small boxes of the UML component symbol on its left side |
| Relationship | description, technology | dashed grey arrow, label in the middle |

Box text follows the C4 convention: name, `[Kind: technology]`, blank line, description.

### Shapes

The shapes follow the key of the diagrams on c4model.com, white with the outline and text in one color: blue, grey for external elements. Only containers have a `type`, chosen in their form from a row of buttons with a picture of each shape (arrow keys move along it), which gives their shape: **generic** a rounded box (also without a type), **server-side app** a rounded box with a `>_` prompt in its top left corner, **single-page app** a browser window, **database** a cylinder, **storage** a bucket, **directory** a folder. A person has a head in front of the top of a body rounder than Excalidraw rounds a rectangle (a quarter of its height at most), so both are parts, a component the two small boxes of the UML symbol. Every kind and type has the same colors for now.

The box carrying the data and the text stays a rectangle, as Excalidraw only puts text in a rectangle, ellipse or diamond, and relationships are glued to it. Where it is no rectangle shape it is invisible, and the shape is drawn by **parts** behind it (`customData.c4.part`: the id of the box), grouped with the box and its text so they are selected, moved and deleted together. The plugin draws the parts again whenever it changes the box, moves them with it, ghosts them with it, guards them with it, and on its next change to the drawing redraws boxes drawn before their shape or look was what it is now: the parts keep the version of the shapes (`customData.c4.shape`).

Only people and systems, the elements of the system context, say whether they are external. Containers and components are external as their system is: the form does not offer it, and making a system external or internal does the same to everything inside it.

## Done (0.1.0)

- Commands to add each element kind through a small form; people and systems can be external. A new element goes beside the boxes already there, further right, rather than on top of one. A new element goes below the selected one, or in the middle of the view.
- A command to add a relationship between two selected elements, with a toggle to reverse its direction.
- A command to edit the selected element (name, technology, description, and external for people and systems) or relationship. The box is resized around its new text, keeping its center, and its relationships are straightened again.
- Every element and relationship can have metadata: key: value pairs (`metadata` in its data), added, changed and removed in the add and edit forms. They are not drawn. Every box of an element shares them; a relationship shares them with its copies in other layers.

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

### Editing a level

Each layer edits only its own level: the elements of its scope, inside the boundary. What is drawn around the boundary (people, systems, the other containers of the system) is there for context from the levels above, and is edited there.

| Layer | Can add and edit | Parent |
|---|---|---|
| System context | people, systems | — |
| Container layer of S | containers (inside the boundary) | S |
| Component layer of C | components (inside the boundary) | C |

- The panel offers only the kinds of the level, and the commands for the others say which level to go to.
- The edit form, its shortcut and a double-click open only for an element of the level, or a relationship with an end there (or at the boundary); for the others a notice says to zoom out. A relationship can be added when one of its ends belongs to the level.
- Only elements of the level are moved into another parent by dragging.
- What comes from the levels above (the neighbours around the boundary, the relationships between them, and the boundary itself) cannot be deleted in the layer: it is put back, with the relationships glued to it, and a notice says to zoom out. It can still be moved.
- The elements around the boundary come down from the levels above: as neighbours on zooming in, and with the relationships carried down. A neighbour stays only while a relationship ties it to the scope or to something inside it, in any layer, or to the boundary in this one: one that has none any more leaves the layer when the layer comes on the canvas (zooming in or out, which starts the undo history over), and shows again among the dimmed levels above. Until then it can be deleted by hand.
- What is drawn in the layer is in full color; the levels above are shown dimmed around it. Grey is the color of external elements, a thick red dashed outline marks an element where it does not belong.

The boundary fits the scope's elements in it, growing or shrinking, with room for its label and never smaller than one element; the boxes around it keep their distance from its edges. It is fitted again whenever the plugin adds to or edits the layer and on zooming into it.

### Moving elements between parents

- A container or component dragged out of its parent's boundary does not belong anywhere: its box is marked as an error (a thick red dashed outline) until it is back inside. So is anything else dragged into a boundary it does not belong in, such as a person or a sibling container. The marks follow every change, undo included, and are left out of the undo history. A boundary fitted again leaves a marked box out.
- A container dropped onto an internal system, or a component onto an internal container (a box in the layer or a ghost of a level above), moves into it, as does one dropped into the boundary of a layer of the right kind. It goes into the new parent's layer, which is made first if there is none (as zooming in would make it), and leaves every other layer, where its parent stands for it now. Its relationships stay: in the new layer between it and the elements at their other ends, placed around the boundary when they are not there yet, and in every other layer between the elements standing for their ends. It takes its new system's external flag.

### Zooming

- **Zoom in** on a selected internal system or container puts its layer on the canvas, first creating it if there is none: the boundary centered on the box, the children already known inside, and as neighbours the elements that have a relationship with it or with anything inside it. A neighbour already in the current layer keeps its place, moved out of the boundary's way; the others go above (they use the scope) or below (the scope uses them). Relationships among them are drawn too.
- **Zoom out** puts the layer one level up on the canvas, with the element selected.
- The view stays put unless the new layer does not fit in it.
- The panel shows the current level (System, Container or Component).
- Keyboard shortcuts, set in the plugin's settings (each can be recorded again, turned off or restored):
  - **Insert**: adds an element of the level on the canvas, of the selected element's kind when the level takes it; in the system context the form switches between a person and a system with a row of two buttons picturing them, like the type of a container. With two elements selected it adds a relationship between them.
  - **Enter**: zooms into the selected system or container.
  - **Backspace**: zooms out, with or without a selection. It never deletes a C4 element or relationship; Delete does.
  - **Arrows**: select the nearest element or relationship of the layer that way (a relationship by the middle of its arrow) instead of moving the selection, or with nothing selected the one nearest the middle of the view, scrolling it into view; with **Shift** they add it to the selection, which keeps the order for a relationship. With other drawings selected they move them, as in Excalidraw.
  - **Space**: edits the selected element or relationship. A key whose action does not apply is left to Excalidraw, but Enter never starts Excalidraw's text editing of a C4 element or relationship.
- A double-click on an internal system or container zooms into it, as Enter does; on any other C4 element or relationship it opens its form instead of Excalidraw's text editing.
- What is selected is outlined over the canvas in the accent color, clearer than Excalidraw's own selection (a relationship along its line and around its label), and numbered when more than one thing is selected, in the order a relationship between them would go. The outline is not part of the drawing.
- With more than one element selected, only a relationship can be added: the panel and the commands offer no elements.

### Relationships

- A relationship goes from the element selected first to the one selected second (shift-click keeps the order). The form can reverse it, and so can the edit form and a command for a selected relationship.
- Two elements can have any number of relationships, either way. They lie side by side in lanes across the line between the elements, and each arrow is glued (`mode: "orbit"`, its own `fixedPoint`) to its own point inside the boxes, so Excalidraw keeps them apart when a box moves. Any change the plugin makes to a box or relationship lays out the lanes of that pair again.

### Relationships between levels

A relationship drawn in one layer is drawn in every other layer that shows its ends or the elements containing them, unless one is already there. So `User → Web app` drawn in the container layer of S puts `User → S` in the system context.

Going down, each relationship of S one level up is carried into S's layer on every zoom into it, when the layer does not show it: as an arrow between the element at the other end and S's boundary, with the same description and technology, to be moved onto the container it is about, edited, or joined by others. One shown below, from or to anything inside S or its boundary, is not carried; one deleted below by mistake comes back on the next zoom. An arrow to the boundary follows the boundary as it grows, and shows as a ghost from the levels below.

Editing a relationship (its description, technology, metadata, or its direction) edits its copies in the other layers too: the relationships between the elements standing for its ends there, up a level or down, that still say what it said, as copied from it. One between the same elements that says something else is another relationship, and is left alone.

Deleting a relationship between two elements deletes, in the other layers, every relationship it stands for: between the same two elements or anything inside them, carried arrows to a boundary included. Not while the layer still has another relationship between the two the same way. It is one undo step after the delete, and a notice says so.

## Next

1. **Colors per type**: settings for the look of each kind and container type.
2. **Checks**: relationships one level up that no relationship below accounts for; elements missing from their home diagram.
3. **Legend**: a generated key of the kinds and arrows used in the drawing.
4. **Keyboard workflow**, as in the mind map plugin: add a container under the selection, connect it with the selection, etc.
5. **Import and export**: Structurizr DSL or C4-PlantUML.
