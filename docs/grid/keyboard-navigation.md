# Keyboard navigation and focus

## Principle

Navigation operates on the logical grid, never on "the next mounted DOM element".

The renderer may have separate pinned and virtualized regions, but navigation sees one coherent coordinate system.

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

For the canonical both-sides-pinned case:

```text
start: name, age -> centre: remaining data columns -> end: actions
```

Arrow Right from `age` enters the first centre column. Arrow Right from the final centre column enters `actions`. Arrow Left traverses the exact reverse path. Each key command moves exactly one adjacent navigable column regardless of how many columns a scroll operation could reveal.

## Navigation pipeline

```text
keyboard command
    ↓
resolve logical destination
    ↓
ensure row is available
    ↓
scroll destination into view
    ↓
wait for virtualized cell to mount
    ↓
apply DOM or ARIA focus
```

Conceptual API:

```ts
async function navigate(command: NavigationCommand) {
  const destination = navigationModel.resolve(currentFocus, command);

  await rowModel.ensureRowAvailable(destination.rowIndex);

  viewport.ensureCellVisible(destination);

  focusStore.set(destination);
}
```

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

For centre columns, scroll horizontally by the minimum delta required to reveal the destination inside the unobscured centre viewport. That viewport begins after the total pinned-start width and ends before the total pinned-end width.

Pinned columns are already horizontally visible but still require vertical scrolling.

Entering either pinned region must not change horizontal scroll position. Crossing from a pinned-start column into centre reveals the first centre destination only; crossing from centre into pinned-end focuses the pinned destination without block-scrolling the centre region.

Do not delegate horizontal navigation reveal directly to native `Element.scrollIntoView()`. It does not understand the grid's logical pinned insets and can jump multiple columns. BrunoTable owns this geometry even when TanStack supplies private selection or movement primitives.

For Page Up and Page Down, derive the target from viewport geometry, not a hard-coded row count.

## Server Table

Navigation may target an unloaded row.

The flow should:

1. record the logical destination
2. request the required block
3. keep focus on the grid root
4. scroll toward the destination
5. focus the cell when loaded and mounted

Repeated key presses should coalesce to the latest intended destination rather than forcing one network round trip per row.

## Editing mode versus navigation mode

Keyboard behaviour changes by mode.

### Navigation mode

- arrows move cells
- one Enter or F2 starts a Cell Edit Session when the focused cell is editable for its current row
- Enter on a non-editable cell does not fabricate an editor
- Shift + arrows extends selection
- Tab follows configured navigation policy

### Editing mode

- editors receive normal text-input behaviour
- Escape cancels
- Enter performs a Cell Edit Commit; post-commit movement is a separate explicit policy
- Tab performs a Cell Edit Commit and moves to the next editable cell
- Shift+Tab performs a Cell Edit Commit and moves to the previous editable cell
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
9. Tab can skip non-editable cells.
10. Editor cursor behaviour is preserved.
11. Sorting/filtering clears or reconciles focus safely.
12. Focus never falls to the document body because a cell unmounted.
13. One horizontal navigation command moves to exactly one adjacent navigable column.
14. Horizontal reveal uses both pinned widths and the minimum required centre scroll delta.
15. Enter starts an editable focused cell with one key press.
16. Enter, Tab, Shift+Tab, and an accepted outside pointer action commit the active cell edit.

## Test matrix

Must include:

- two pinned-start columns (`name`, `age`) through centre navigation
- final pinned-start column to first centre column, revealing only that destination
- final centre column to pinned-end `actions` without changing horizontal scroll
- pinned-end `actions` back to the final centre column with minimal reveal
- first centre column back to pinned-start without changing horizontal scroll
- header to body
- body to header
- group header to leaf header
- visible to horizontally virtualized column
- loaded to unloaded row
- one Enter starts an editable cell
- Enter commits the active editor
- Tab and Shift+Tab commit and move to the next or previous editable cell
- outside-cell and outside-grid pointer commits before focus transfer
- invalid outside-pointer commit retains the active editor
- hidden columns
- column reorder while focused
- row removal while focused
- filter change while focused
