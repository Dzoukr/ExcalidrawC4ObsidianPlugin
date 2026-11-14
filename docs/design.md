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
| Group | name | dotted grey box around its elements, name at the bottom left |

Box text follows the C4 convention: name, `[Kind: technology]`, blank line, description.

### Shapes

The shapes follow the key of the diagrams on c4model.com, in the Classic theme white with the outline and text in one color: blue, grey for external elements (see Colors and themes). Only containers have a `type`, chosen in their form from a row of buttons with a picture of each shape (arrow keys move along it), which gives their shape: **generic** a rounded box (also without a type), **server app** a rounded box with a `>_` prompt in its top left corner, **web app** a browser window, **mobile app** a phone lying on its side, **desktop app** a monitor on a stand, **function** a rounded box with a λ in its top left corner, **job** one with a clock there, **message queue** a cylinder lying on its side (a pipe, its text clear of its ends), **database** a cylinder, **storage** a bucket, **directory** a folder. A person has a head in front of the top of a body rounder than Excalidraw rounds a rectangle (a quarter of its height at most), so both are parts, a component the two small boxes of the UML symbol. Every kind and type has the same colors for now.

The box carrying the data and the text stays a rectangle, as Excalidraw only puts text in a rectangle, ellipse or diamond, and relationships are glued to it. Where it is no rectangle shape it is invisible, and the shape is drawn by **parts** behind it (`customData.c4.part`: the id of the box), grouped with the box and its text so they are selected, moved and deleted together. The plugin draws the parts again whenever it changes the box, moves them with it, ghosts them with it, guards them with it, and on its next change to the drawing redraws boxes drawn before their shape or look was what it is now: the parts keep the version of the shapes (`customData.c4.shape`).

A box resized by hand keeps its new size, at least as large as its text needs: Excalidraw scales the text and the parts with it, so once the resize is done its text and name go back to their font sizes, centered, and its parts are drawn again for the new size (one undo step after the resize). A group's label goes back to its font size the same way, and the group is fitted to what is in it again.

The name of an element is larger than the rest of its box's text, as in the C4 model's diagrams. Excalidraw draws a text in one size, so the name is a text of its own, also a part, over room the box's text keeps for it at the top: lines holding only a zero-width space, which nothing trims away.

Only people and systems, the elements of the system context, say whether they are external. Containers and components are external as their system is: the form does not offer it, and making a system external or internal does the same to everything inside it.

### Colors and themes

Every type of element has its colors, an outline, a fill and a text color: a person, a software system, each type of container, a component, and one set for all external elements. Groups have an outline and a label color only: they have no fill, so as not to hide what is behind them. A **theme** gives them all, as in the mind map plugin:

- Built-in themes: **Classic** (the key of the C4 model's diagrams: blue on white, green for people, grey for external elements), **Filled** (the well-known filled C4 boxes, dark to light blue down the levels, green for people), **Pastel** (a color for each kind and type of container, as a mind map's branches), **Ocean**, **Sunset**, **Forest** and **Monochrome**.
- The user's own themes, on the settings' Themes page: each started as a copy of any theme, renamed, deleted, its colors edited type by type, reordered; imported and exported as JSON through the clipboard or a file. Colors missing from an imported theme are the Classic ones. The colors the settings had before themes became the Custom theme.
- **Each drawing keeps its theme** (`theme` in the store on the carrier). A drawing takes the theme of new drawings, a setting, with its first C4 element; it is changed from the panel's theme menu or the command palette. A drawing whose theme was deleted has the Classic colors.

An element can have colors of its own, set in its edit form, over those of its type in the drawing's theme: only the ones that differ are kept (`look` in its data), and the form resets them to its type's.

The parts of a shape keep the colors they were drawn in (`customData.c4.look`). Whenever the plugin changes a drawing, and when one opens, the boxes drawn in other colors than theirs now are drawn again in theirs, keeping their size; after a theme or its colors change, the open drawings are drawn again.

### Drawings of other plugins

Other plugins may draw their own kind of diagram in Excalidraw drawings too, such as the mind map plugin. Each drawing belongs to one of them, so their panels, keys and double-clicks never get in each other's way. The plugins need not know each other, only two conventions they all follow (`src/mode.ts`):

- **The drawing's kind is in its frontmatter**: `dzoukr-diagram-kind: c4`, `dzoukr-diagram-kind: mindmap` and so on, out of the `excalidraw-` keys the Excalidraw plugin keeps for itself. A plugin writes it when it takes a drawing over; a drawing of another kind it leaves alone.
- **A registry on the window**: the map `window.dzoukrDiagramKinds` holds, for the kind of each such plugin while it is enabled, the version of these conventions it follows (`{ version: 1 }`). The conventions only change in ways plugins following an earlier version still work with; a change they would not work with raises the version.
- **A shared chooser row** (`src/chooser.ts`): on a drawing nobody's yet, each plugin puts one `button.dzoukr-diagram-choice` (its kind in `data-kind`) into the `div.dzoukr-diagram-chooser` of the view, "Use this drawing for: C4 · Mind map", made by the first and removed by the last, all styling it alike; its own panel is hidden there. Last in the row, **Excalidraw** keeps the drawing plain: it writes the kind `excalidraw`, which every plugin leaves alone as it does any kind not its own. Whichever plugin offers first adds that button, and takes it out when it leaves.

Whom a drawing belongs to, for this plugin:

| Drawing | C4 alone | With another such plugin |
|---|---|---|
| Kind `c4` | C4: the whole panel | C4: the whole panel |
| Another kind | panel hidden, plugin silent | panel hidden, plugin silent |
| No kind, with C4 elements | C4; the kind is written | C4; the kind is written |
| No kind, anything else (empty included) | C4, as if no other plugin were installed; with the setting "Ask what a new drawing is for" on, nobody's, as with another plugin | nobody's: no panel, a **C4 diagrams** button in the shared chooser row, keys and double-clicks left to Excalidraw |

- The command "Keep this drawing plain Excalidraw" does the same as the Excalidraw button, on any drawing, a C4 one included (its elements stay as plain shapes).
- The C4 diagrams button in the chooser, the command "Use this drawing for C4 diagrams", or any C4 command on a drawing nobody's yet takes it over: its kind is written. The command also takes over another plugin's drawing; what that plugin drew stays as plain shapes.
- The kind of a drawing with C4 elements and none is written once its first element is drawn, or when one drawn before kinds is open; only while the drawing has no unsaved changes.
- Silent means: no keys, double-clicks, selection outline, redrawing in new colors, guard or marks. Commands from the palette are not offered on another plugin's drawing.
- The mind map plugin follows the same conventions. It has to be released with them before or with this plugin, or it would still act in C4 drawings.

### Groups

A **group** shows elements of one layer that belong together, as the containers of a microservice on [c4model.com](https://c4model.com/abstractions/microservices): a dotted grey box around them with its name at its bottom left. It is no C4 element: it has no relationships, is not zoomed into, and is shown **only in the layer it is drawn in**, never among the ghosts of the levels above. Any layer can have groups, around anything drawn in it, and groups can be nested in one another.

- Its data is on its box (`customData.c4`: `{ group, name, parent?, members }`): `members` are the ids of the elements right in it, `parent` the id of the group it is nested in. Its label is a part of the box (`part`), grouped with it in Excalidraw so that the two are selected, moved and deleted together.
- **Add group** (panel, command, **Ctrl+G** instead of Excalidraw's own grouping) puts a group around the selected elements and groups, nested in the group they are all right in when that is one; with nothing selected, an empty one in the middle of the view. Selected boxes in a selected group stay in it.
- A group **fits what is in it**, its elements with the parts of their shapes and the groups nested in it, with room for its label, whenever the drawing changes, left out of the undo history as the marks of misplaced boxes are. An empty group keeps its size. A layer's boundary holds the groups of the elements in it.
- **Dragging**: a box or group dropped goes right into the innermost group under its center, or out of every group; a group dragged takes what is in it along when dropped (a group resized is fitted again instead). One undo step after the drag.
- A new element goes into the group of the selected box it is added below, or into the selected group, below what is in it, when it belongs on that side of the boundary.
- Groups are drawn in the colors of groups in the drawing's theme (dark grey in Classic), or in colors of their own for the outline and the label, set in their form as an element's are.
- Editing a group (form, Space, Enter, double-click on its outline or label) renames it and sets its colors. Deleting it leaves its elements and the groups nested in it, which go into the group it was in, if any (one undo step after the delete). An element the plugin takes out of a layer leaves its group there; one deleted by hand stays a member until it is back, for undo.

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

The levels above stay in view around the layer, as **ghosts**: dimmed copies of their elements (`customData.c4.ghost`, ids prefixed `c4g-`), which are not part of any layer and are made again whenever the plugin changes the drawing or switches layers. Each level above makes way for the element opened below it, as far as that element's boundary reaches: what lies beyond an edge of the element's box moves as far as that edge did, and the boundary of the level above stretches around it. An element drawn in the layer is not repeated as a ghost, and the relationships of the levels above are drawn between wherever their ends are shown. A ghost can be selected, to connect a relationship to, but not edited: moved or deleted it is put back, and a double-click on it does nothing.

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

The boundary fits the scope's elements in it, growing or shrinking, with room for its label and never smaller than one element; the boxes around it keep their distance from its edges. It is fitted again whenever the plugin adds to or edits the layer and on zooming into it. Resized by hand, it goes back to fitting the elements it held before (one undo step after the resize). Moved by hand, it takes along the scope's elements that were in it, with their groups, and its label goes back to its corner (one undo step after the move); what was dragged with it, or whose group was, is not moved twice. The boundary and its label are one Excalidraw group, so the label is selected and dragged with it; a boundary drawn before gets the group the next time it is fitted, and a label Excalidraw scaled with its boundary goes back to its font size.

### Moving elements between parents

- A container or component dragged out of its parent's boundary does not belong anywhere: its box is marked as an error (a thick red dashed outline) until it is back inside. So is anything else dragged into a boundary it does not belong in, such as a person or a sibling container. The marks follow every change, undo included, and are left out of the undo history. A boundary fitted again leaves a marked box out.
- A container dropped onto an internal system, or a component onto an internal container (a box in the layer or a ghost of a level above), moves into it, as does one dropped into the boundary of a layer of the right kind. It goes into the new parent's layer, which is made first if there is none (as zooming in would make it), and leaves every other layer, where its parent stands for it now. Its relationships stay: in the new layer between it and the elements at their other ends, placed around the boundary when they are not there yet, and in every other layer between the elements standing for their ends. It takes its new system's external flag.

### Zooming

- **Zoom in** on a selected internal system or container puts its layer on the canvas, first creating it if there is none: the boundary centered on the box, the children already known inside, and as neighbours the elements that have a relationship with it or with anything inside it. A neighbour already in the current layer keeps its place, moved out of the boundary's way; the others go above (they use the scope) or below (the scope uses them). Relationships among them are drawn too.
- **Zoom out** puts the layer one level up on the canvas, with the element selected.
- The view stays put unless the new layer does not fit in it.
- The panel shows the current level (System, Container or Component).
- Keyboard shortcuts, set in the plugin's settings (each can be recorded again, turned off or restored):
  - **Insert**: adds an element of the level on the canvas, of the selected element's kind when the level takes it; with nothing selected in the system context, a person until the drawing has one, then a system. The form is the same as the one editing the element. With two elements selected it adds a relationship between them.
  - **Enter**: zooms into the selected system or container.
  - **Backspace**: zooms out, with or without a selection. It never deletes a C4 element or relationship; Delete does.
  - **Arrows**: select the nearest element or relationship of the layer that way (a relationship by the middle of its arrow) instead of moving the selection, or with nothing selected the one nearest the middle of the view, scrolling it into view; with **Shift** they add it to the selection, which keeps the order for a relationship. With other drawings selected they move them, as in Excalidraw.
  - **Space**: edits the selected element or relationship. A key whose action does not apply is left to Excalidraw, but Enter never starts Excalidraw's text editing of a C4 element or relationship.
- A double-click on an internal system or container zooms into it, as Enter does; on any other C4 element or relationship it opens its form instead of Excalidraw's text editing.
- What is selected is outlined over the canvas in the accent color, clearer than Excalidraw's own selection (a relationship along its line and around its label), and numbered when more than one thing is selected, in the order a relationship between them would go. The outline is not part of the drawing.
- With more than one element selected, only a relationship can be added: the panel and the commands offer no elements.
- **Pause**, as in the mind map plugin: the panel's pause button or a command leaves keys and double-clicks to Excalidraw, in every drawing, and hides the selection outline; the panel keeps only the button that resumes. Not saved: a restart resumes. The plugin still keeps the drawing whole while paused: elements of the levels above are put back, boxes dropped into another boundary move there, misplaced ones are marked. Commands from the palette still work.

### Relationships

- A relationship goes from the element selected first to the one selected second (shift-click keeps the order), any two but one inside the other. Either can be a ghost of a level above: its element is drawn in the layer first, where the ghost is, as an element around the boundary. Two elements of the levels above can be connected too: the relationship goes up to their level, as any does. The form can reverse it, and so can the edit form and a command for a selected relationship.
- Two elements can have any number of relationships, either way. They lie side by side in lanes across the line between the elements, and each arrow is glued (`mode: "orbit"`, its own `fixedPoint`) to its own point inside the boxes, so Excalidraw keeps them apart when a box moves. Any change the plugin makes to a box or relationship lays out the lanes of that pair again.

### Relationships between levels

A relationship drawn in one layer is drawn in every other layer that shows its ends or the elements containing them, unless one between them is already there, either way. So `User → Web app` drawn in the container layer of S puts `User → S` in the system context, and `Web app → User` drawn after it adds nothing there: a level above sums up what is below, so its one relationship may stand for a conversation both ways.

Going down, each relationship of S one level up is carried into S's layer on every zoom into it, when the layer does not show it: as an arrow between the element at the other end and S's boundary, with the same description and technology, to be moved onto the container it is about, edited, or joined by others. One shown below, from or to anything inside S or its boundary, is not carried; one deleted below by mistake comes back on the next zoom. An arrow to the boundary follows the boundary as it grows, and shows as a ghost from the levels below. An arrow dropped onto the name of a box or a part of its shape, which Excalidraw glues it to, is glued to the box itself on the next change, so that it counts as the box's relationship and is not carried down again.

Editing a relationship (its description, technology, metadata, or its direction) edits its copies on the levels below too: the relationships between the elements standing for its ends there that still say what it said, as copied from it. The levels above and the other layers of its own level are left as they are: they sum up what is below them, and one renamed below is a relationship of its own from then on. One between the same elements that says something else is another relationship, and is left alone. Deleting a relationship deletes the ones it stood for in the other layers: between the same two elements or anything inside them, either way, unless the layer still has a relationship between the two, either way.

Deleting a relationship between two elements deletes, in the other layers, every relationship it stands for: between the same two elements or anything inside them, carried arrows to a boundary included. Not while the layer still has another relationship between the two the same way. It is one undo step after the delete, and a notice says so.

## Next

1. **Checks**: relationships one level up that no relationship below accounts for; elements missing from their home diagram.
2. **Legend**: a generated key of the kinds and arrows used in the drawing.
3. **Keyboard workflow**, as in the mind map plugin: add a container under the selection, connect it with the selection, etc.
4. **Import and export**: Structurizr DSL or C4-PlantUML.
