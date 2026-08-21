# Keyboard navigation and focus

## Principle

Navigation operates on the logical grid, never on "the next mounted DOM element".

The renderer may have separate pinned and virtualized regions, but navigation sees one coherent coordinate system.

Every BrunoTable-owned shortcut enters through one private, table-scoped Hotkey Adapter. Its React
boundary uses `@tanstack/react-hotkeys` for registration, matching, listener lifecycle, repeated-key
delivery, conflict policy, and platform normalization. Cross-platform chords use TanStack's `Mod`
syntax; feature code receives an already-matched gesture and retains ownership of typed navigation,
column, filter, sort, and workflow commands. Hotkey registration and DOM-listener cost is bounded
per Table Instance or active workflow and never varies with mounted rows, cells, or headers.
The Adapter is the only current production module allowed to receive a raw `KeyboardEvent` and
passes feature owners a key- and modifier-free gesture capability containing only command effects
and ownership evidence. The build guard maintains an explicit finite map from exact normalized
root-relative module paths to evidence capabilities. The Adapter capability alone may import React
Hotkeys; it admits no React or DOM keyboard handler. A future native editor/input/IME owner may add
a separate `native-evidence` entry whose component-owned handler can inspect composition evidence
but cannot interpret keys or modifiers. The emitted guard permits handler/listener evidence only
when that exact source capability exists, with the source scan providing attribution after bundling.
It must not weaken the rule or reintroduce binding inference.

The Adapter scopes ordinary commands to the owning grid surface and explicitly bridges the few
portalled table workflows that remain owned by that Table Instance. Mounted menu triggers publish
only their controlled open action into a weak ownership registry; they add no hotkey or DOM
listener. A workflow opens through this supported action seam, and the Adapter does not synthesize
pointer, mouse, or keyboard DOM events. Native inputs, textareas, contenteditable regions, editors, IME composition, dead keys,
AltGr/Option-produced text, and Base UI-owned menu/dialog behavior keep their native or component
ownership. These are evidence and interaction semantics, not a second BrunoTable shortcut matcher.
Later keyboard work—including sparse Server held-arrow behavior—extends this Adapter and the
existing command/navigation domain rather than adding another event-key interpreter.

## Coordinate model

```ts
type BrunoTableRegion = "group-header" | "column-header" | "filter-header" | "body" | "footer";

type BrunoTableCoordinate = {
  region: BrunoTableRegion;
  headerDepth?: number;
  rowIndex?: number;
  rowId?: BrunoTableRowId;
  columnId: BrunoTableColumnId;
};
```

## Logical column order

Pinned state does not change logical order.

```text
pinned start -> centre -> pinned end
```

Arrow-right from the final pinned-start column enters the first centre column.

Arrow-right from the final centre column enters the first pinned-end column.

Hidden and non-navigable columns are skipped.

Pinned membership and order come from each table's current column definitions and sanitized preferences. No field name or Column Identity is special.

When a table pins columns at both logical sides:

```text
pinned-start columns -> centre columns -> pinned-end columns
```

Arrow Right from the final pinned-start column enters the first centre column. Arrow Right from the final centre column enters the first pinned-end column. Arrow Left traverses the exact reverse path. Each key command moves exactly one adjacent navigable column regardless of how many columns a scroll operation could reveal.

## Navigation pipeline

```text
matched table-scoped Hotkey Adapter command
    ↓
resolve logical destination
    ↓
record logical Active Cell
    ↓
reveal destination through the shared virtualizer
    ↓
publish the required row range
    ↓
project the active descendant onto the mounted cell or loading slot
```

Conceptual API:

```ts
function navigate(command: NavigationCommand) {
  const destination = navigationModel.resolve(currentFocus, command);

  focusStore.set(destination);
  viewport.revealCell(destination, { align: "auto" });
}
```

Navigation never waits for a DOM node or a network response before accepting the next command. The logical Active Cell is authoritative; mounted DOM focus is only its current projection.

For an ordinary Client live publication inside the same projection, follow a surviving active Row Identity to its new display index without revealing it. If that identity disappears while rows remain, target the row at the previous display index, clamped to the new last row, and retain the active Column Identity when it is still navigable. Clear the Active Cell only when the result becomes empty. This positional fallback chooses a new identity after authoritative disappearance; it never treats the row index itself as identity.

## Grouping shape reset

Every Group By add, remove, or reorder replaces the logical row-and-column projection. After cancelling any active range gesture and deriving that projection, reset the Active Cell to row zero and its first visible navigable Logical Column. While grouped, that column is the first active group key. After clearing the final key, it is the first visible navigable column in restored base Logical Column Order. Do not translate the previous raw row into a group, preserve a coincidentally matching column, or carry a group coordinate across a reordered key tuple.

If the new result is empty, clear the Active Cell. A Server generation may retain row zero as a loading-slot destination until authoritative `totalRows` proves the result empty. Reset vertical geometry to the start and reveal the new destination only when the body owns focus. A pointer or keyboard Group By control retains DOM focus; updating the private logical body destination must not pull focus back into the grid. Persisted grouping restored during SSR or hydration starts with no Active Cell because focus is transient and never persisted.

## Live grouped reconciliation

When the Group By tuple itself is unchanged, a live publication never invokes the grouping-shape reset. Follow a surviving active Group Row Identity to its new logical index while retaining the same valid Column Identity, and do not auto-reveal the move. If the group disappears, target the group now at its previous display index, clamped to the new last row, using the same column when still navigable or the first visible navigable grouped column otherwise. Clear Active Cell only when no grouped row remains. A sparse Server destination may remain a loading slot; do not infer its identity from displayed group values.

## Group By Region

Grouping never requires drag-and-drop. Keyboard users add an eligible inactive column through Add Group or its column-menu command and remove it through the chip's explicit Remove action or the active column-menu command. When the chip itself owns focus, `Alt+ArrowLeft` and `Alt+ArrowRight` move it one position, keep focus on it, and announce its label plus new position through a polite live region. A boundary command does nothing. Removing a chip focuses the nearest survivor, or Add Group after removing the final chip. Do not introduce Space/Enter pickup mode, hidden drag state, or document-global shortcuts.

## Header and body navigation

Without filter headers:

```text
column header
    ↕
first body row
```

With filter headers:

```text
column header
    ↕
filter header
    ↕
first body row
```

Grouped headers form additional levels.

Arrow Up and Arrow Down walk those levels consistently.

## Horizontal navigation in grouped headers

Leaf headers move left/right between leaf columns.

Moving up enters the owning group.

Moving down returns to the remembered preferred child or the first focusable child.

Maintain preferred-column memory when moving vertically.

## Scrolling

Navigation must always reveal the destination.

Both Client and Server Tables use the same vertically and horizontally virtualized renderer. When an Arrow command reaches the final visible row, Active Cell Reveal advances the logical row normally and scrolls by the minimum amount required to mount it. The same rule applies repeatedly while the key is held.

The Client Table's virtual row count is the complete locally filtered and sorted row model. Its rows already exist in memory, so reveal changes scroll geometry and mounted cells but never asks the Client Source for a page.

The Server Table's virtual row count is the source's exact `totalRows`. Reveal may target an unloaded sparse row slot. The resulting virtual range change extends or replaces the active effect-view-server window; it does not fetch a "next page". Source overscan should normally request rows ahead of the visible boundary before the Active Cell reaches it.

While pinning is active, scroll centre columns horizontally by the minimum delta required to reveal the destination inside the unobscured centre viewport. That viewport begins after the total pinned-start width and ends before the total pinned-end width.

Active pinned columns are already horizontally visible but still require vertical scrolling.

Entering either active pinned region must not change horizontal scroll position. Crossing from a pinned-start column into centre reveals the first centre destination only; crossing from centre into pinned-end focuses the pinned destination without block-scrolling the centre region.

Before any viewport with pinned columns is measured, pinning is suspended. After measurement, a mixed layout remains suspended while its pinned widths would leave less than 80 CSS pixels for the centre, and a centreless layout remains suspended while its total pinned width exceeds the viewport. Both pinned insets become zero, and horizontal navigation and reveal operate over one virtualized start → centre → end sequence, including formerly pinned destinations. Reverse traversal preserves end → centre → start identity order. Measuring or widening the viewport until the active pinned layout fits restores pinned behavior without changing the Active Cell or Logical Column Order.

Do not delegate horizontal navigation reveal directly to native `Element.scrollIntoView()`. It does not understand the grid's logical pinned insets and can jump multiple columns. BrunoTable owns this geometry even when TanStack supplies private selection or movement primitives.

In a read-only body cell whose custom renderer contains interactive descendants, Enter or F2
enters that cell's first same-document interactive control from the grid root. Embedded browsing
contexts stay outside ordinary Tab order but are never automatic interaction-entry targets because
their keyboard events cannot bubble to the grid. All interactive descendants stay outside ordinary
Tab order so virtualization cannot create unstable tab stops. Escape returns focus to the grid root
without changing the Active Cell; once inside, the control otherwise owns its native key behavior,
and Tab leaves the grid through the ordinary document order.

For Page Up and Page Down, derive the target from viewport geometry, not a hard-coded row count.

## Held keys and frame scheduling

Browser key repeat produces a sequence of real navigation commands. BrunoTable must preserve every valid logical move even when rendering or the network is slower than the repeat rate.

- resolve each repeated command against the latest logical Active Cell
- clamp the destination to the current logical row and column bounds
- never wait for the previously targeted DOM cell to mount
- coalesce geometry reads, scroll writes, and required-range publication to at most once per animation frame
- publish only the latest required server window for that frame or changed range
- do not put the scroll offset or per-repeat position in top-level React state

Coalescing physical reveal work must not discard semantic key movements. Holding Arrow Down for ten valid repeats advances ten logical rows; it may perform fewer scroll writes and server-window updates.

## Server Table

Navigation may target an unloaded row.

The flow should:

1. record the logical destination
2. keep focus on the grid root
3. reveal the destination index in the virtual scroll space
4. publish the visible range plus source overscan to the active viewport generation
5. render a stable fixed-height loading cell with the destination's DOM identity if the user outruns delivery
6. replace its contents when the real row arrives without changing logical or DOM focus

Repeated key presses must coalesce range requests to the latest required contiguous window rather than forcing one network round trip per row. The Active Cell remains at the requested absolute row index while its slot is loading; BrunoTable must not skip unloaded rows, reset focus, or invent a sentinel row. Navigation stops at `totalRows - 1`.

## Editing mode versus navigation mode

Keyboard behaviour changes by mode.

### Navigation mode

- arrows move cells
- one Enter or F2 starts a Cell Edit Session when the focused cell is editable for its current row
- inside a multi-cell Linear Cell Range with at least two currently editable cells, Enter and Shift+Enter retain the range and cycle its Active Cell forward or backward along that one axis instead of opening an editor; F2 still edits
- printable text input on an eligible editable Client Active Cell starts a replace-mode Cell Edit Session seeded only with the produced text; the previous value is not included
- replace-on-type targets only the Active Cell, not every cell in a Cell Range Selection
- command shortcuts that produce no text, navigation and function keys, `Delete`, and `Backspace` never enter replace mode; AltGr/Option text remains valid produced input
- Enter on a non-editable cell does not fabricate an editor
- Shift + arrows extends Cell Range Selection in a Client Table; the first accepted direction chooses its axis, parallel commands resize or cross its anchor, and perpendicular commands are ignored until it collapses; a Server Table never creates a range
- Client Cell Range Selection always means zero or one contiguous horizontal-or-vertical range; no command may switch or extend both axes, a new selection replaces the old one, and Ctrl/Cmd never adds, toggles, or subtracts ranges
- in an Editable Client body, Tab moves to the next currently editable cell and Shift+Tab moves to the previous one, wrapping across logical rows and crossing pinned regions one column at a time
- at the terminal eligible cell, Tab or Shift+Tab leaves the grid through normal browser focus order rather than cycling; read-only Client and Server Tables use Tab only to cross the composite boundary
- when one multi-cell Linear Cell Range contains at least two currently editable cells, both Tab and Enter preserve it and cycle its Active Cell forward along the selected axis; Shift+Tab and Shift+Enter cycle backward
- printable text or F2 still starts editing the range's Active Cell
- during pointer range selection or Drag Fill, Escape first cancels the gesture and restores its pre-gesture state without also collapsing the restored range
- otherwise Escape collapses the Linear Cell Range to its Active Cell; when an editor is open, the first Escape cancels editing and the second collapses the range

### Editing mode

- editors receive normal text-input behaviour
- Escape cancels
- Enter performs a Cell Edit Commit and, when locally accepted, moves one logical body row down in the same column
- Shift+Enter performs a Cell Edit Commit and, when locally accepted, moves one logical body row up in the same column
- Enter movement does not wait for an Immediate Save Operation, reveals virtualized destinations, and does not wrap at row boundaries
- Tab performs a Cell Edit Commit and moves to the next editable cell
- Shift+Tab performs a Cell Edit Commit and moves to the previous editable cell
- inside a Linear Cell Range, accepted Enter and Tab commits advance along its axis while shifted forms reverse it
- Tab traversal uses the same row wrapping, pinned-aware reveal, virtualized destination, and terminal browser-focus exit as Navigation Mode
- a pointer press outside the active editor attempts a Cell Edit Commit before transferring logical focus or running the clicked action
- a rejected parse or validation keeps the Cell Edit Session active and does not silently discard the candidate value
- arrow keys remain with the editor unless boundary-transfer policy applies

Do not steal arrow keys from a text editor while the caret can still move normally.

## Focus implementation

Logical focus must survive virtualization.

Prefer a grid-root focus model with `aria-activedescendant` or a carefully implemented roving-tabindex strategy.

Cells need stable DOM IDs derived from:

- table ID
- row ID
- column ID
- region if required

When the active cell unmounts:

- keep DOM focus on the grid root
- retain logical focus
- restore the active descendant when remounted

## Required commands

Support:

- ArrowLeft
- ArrowRight
- ArrowUp
- ArrowDown
- Shift + arrows
- Ctrl/Cmd + arrows
- Home
- End
- Ctrl/Cmd + Home
- Ctrl/Cmd + End
- PageUp
- PageDown
- Tab
- Shift+Tab
- Enter
- F2
- Escape

## Navigation invariants

1. Pinned state never changes logical left/right order.
2. Every successful navigation leaves the destination visible.
3. Header and body form one continuous vertical model.
4. Hidden columns are never focused.
5. Virtualized cells can be targeted before mounting.
6. Server rows can be targeted before loading.
7. Focus survives row and column virtualization.
8. Shift navigation extends from a stable anchor.
9. Cell selection owns at most one contiguous Linear Cell Range; its first accepted extension locks one axis until collapse or replacement, diagonal pointer movement projects onto that axis, and no keyboard or pointer command creates a two-axis, additive, subtractive, or disconnected range even transiently.
10. Editable Client Tab traversal skips non-editable cells, wraps across logical rows, and crosses pinned regions without jumping.
11. Editor cursor behaviour is preserved.
12. Sorting/filtering reconciles focus safely; a Client Linear Cell Range survives only while its exact ordered identity span remains unchanged and never retargets stable corners across different intervening cells.
13. Focus never falls to the document body because a cell unmounted.
14. One horizontal navigation command moves to exactly one adjacent navigable column.
15. While pinning is active, horizontal reveal uses both pinned widths and the minimum required centre scroll delta; while suspended, it uses zero pinned insets and the minimum delta inside the all-column window.
16. Enter starts an editable focused cell with one key press.
17. Printable text starts an eligible Client editor with that text replacing the previous candidate; Enter and F2 preserve the pre-session value.
18. IME composition and dead-key input seed replace mode from produced text rather than intermediate key events.
19. Without active range traversal, Enter commits and moves one logical row down while Shift+Enter commits and moves one logical row up.
20. Rejected local commit stays in the editor, while accepted Enter movement does not wait for an Immediate Save Operation and never wraps at a row boundary.
21. A multi-cell Linear Cell Range with at least two editable cells remains selected while both Tab and Enter cycle its Active Cell forward along the one axis; shifted forms reverse that order.
22. Range-navigation Enter does not start an editor; F2 and printable text retain their edit-entry roles.
23. Escape collapses range traversal to the Active Cell; editor Escape cancels first and range Escape requires the following press.
24. Terminal ordinary Tab and Shift+Tab leave the grid through browser focus order; read-only tables never trap Tab for internal cell movement.
25. Client and Server Tables both virtualize the logical row space.
26. Held-arrow navigation preserves every logical move while frame-batching physical reveal work.
27. Server keyboard reveal changes the active viewport window, never page state.
28. An unloaded active Server row retains its logical Active Cell until delivery.
29. Live sort-key movement follows the same Row Identity when its new index is known, never auto-scrolls after it, and never transfers activation to a different row at the old index.
30. If a moved Server row's new index is unknown, clear the Active Cell while retaining focus on the grid root; if a Client range's identities cease to be contiguous, clear the range.
31. An ordinary Client publication follows a surviving active Row Identity and falls back to the clamped previous display position only after that identity disappears.

## Test matrix

Must include:

- zero, one, and multiple consumer-defined columns in each pinned region
- multiple pinned-start columns traversed one at a time before centre navigation
- while pinning is active, final pinned-start column to first centre column, revealing only that destination
- while pinning is active, final centre column to first pinned-end column without changing horizontal scroll
- while pinning is active, first pinned-end column back to the final centre column with minimal reveal
- while pinning is active, first centre column back to pinned-start without changing horizontal scroll
- while pinning is suspended, forward and reverse traversal across start, centre, and end boundaries with minimum all-column reveal
- header to body
- body to header
- group header to leaf header
- visible to horizontally virtualized column
- loaded to unloaded row
- held Arrow Down across several Client viewport boundaries
- held Arrow Down across a prefetched Server viewport boundary
- held Arrow Down that outruns Server delivery, followed by row arrival
- repeated Server navigation publishes bounded contiguous window changes rather than one request per row
- final-row clamping at `totalRows - 1`
- no focus loss while the active destination is represented by a loading slot
- one Enter starts an editable cell
- typing printable text over `hello` starts a replace-mode editor whose candidate is only the produced text
- replace-on-type affects only the Active Cell when a Client range is selected
- non-text command shortcuts, Delete, Backspace, navigation keys, and function keys do not seed replace mode
- composed and dead-key text enters exactly once without leaking intermediate key values
- Escape after replace-on-type restores the exact pre-session value or Batch draft and creates no transaction
- Enter commits and moves one logical row down in the same column, including to an off-screen virtualized row
- Shift+Enter commits and moves one logical row up in the same column
- Enter and Shift+Enter remain in the editor on invalid input and do not wrap at the first or last row
- accepted Immediate Enter movement occurs before the Save Operation settles; a later rejection does not steal focus back from its new Active Cell
- live sort-key updates do not reset scroll; they reconcile the Active Cell by Row Identity when possible and never silently retarget the old absolute index
- an active Client editor row that moves under live sorting remains at the same visual Y-coordinate through frame-coalesced fixed-height scroll anchoring while surrounding rows reorder normally
- an active Client editor row filtered out by a live update remains as one anchored, accessible edit-owned exception until commit or Escape; its raw candidate is never discarded or auto-committed
- deletion of the active Client editor row retains an anchored tombstone with recoverable text, blocks commit, and exits only through Escape or accessible cancellation unless the same Row Identity reappears and reconnects
- a moved active Server row outside the known sparse window clears activation without dropping browser focus, while a reordered Client range survives only when its identity set remains contiguous
- Tab and Shift+Tab commit and move to the next or previous editable cell
- Tab crosses pinned-start, centre, and pinned-end in Logical Column Order, wrapping to the next row without a multi-column reveal jump
- Tab and Shift+Tab skip row-specific non-editable cells and reveal virtualized destinations
- Tab at the final eligible cell and Shift+Tab at the first eligible cell leave the grid in browser focus order
- read-only Client and Server Tables use Tab to cross the grid boundary rather than moving between body cells
- a horizontal or vertical selected range preserves its bounds while Tab or Enter cycles the Active Cell forward through eligible cells and shifted forms cycle backwards
- the first Shift+Arrow extension locks its axis, parallel commands may resize through the anchor, perpendicular commands do nothing, and collapse permits the next extension to choose either axis
- pointer selection remains `1×1` inside drag slop; after the threshold, greater absolute displacement wins the axis while an exact tie stays `1×1`, then only the parallel logical coordinate changes
- pointer selection and Drag Fill do not autoscroll before axis acquisition and never autoscroll the perpendicular axis afterward, including near pinned-region edges
- Escape and `pointercancel` stop autoscroll; selection restores its exact pre-gesture Active Cell/range, while Drag Fill removes its preview and creates no transaction
- pointer capture preserves the gesture outside the grid; normal release retains the last projected range or applies a valid fill preview, while fill with no axis or non-empty preview is a no-op
- rejected Drag Fill preflight applies nothing, removes the preview, and publishes one non-stacking accessible `Fill rejected` toast with no Retry action
- a new click or drag replaces the existing range, Shift extends only that range, and Ctrl/Cmd gestures never add, toggle, or subtract another range
- no selection state, visuals, copy, paste, fill, or traversal path accepts a two-axis shape, disconnected ranges, or range holes
- selected-range traversal wraps last-to-first and first-to-last, including across pinned and virtualized coordinates
- Enter in selected-range Navigation Mode advances without editing; F2 edits the current value and printable text replaces it
- accepted Enter or Tab from an editor advances along the selected axis without waiting for an Immediate Save Operation; invalid input stays in place
- a selected Linear Cell Range with zero or one currently editable cell falls back to ordinary body traversal rather than trapping Tab
- the first Escape from an active editor cancels editing without collapsing its range; the next Escape collapses the range to the Active Cell
- outside-cell and outside-grid pointer commits before focus transfer
- invalid outside-pointer commit retains the active editor
- hidden columns
- column reorder while focused
- row removal while focused
- filter change while focused
