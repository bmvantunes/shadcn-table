import { detectPlatform } from "@tanstack/react-hotkeys";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { createRef, forwardRef, StrictMode, useImperativeHandle, useState } from "react";
import { flushSync } from "react-dom";

import { BrunoTableClient, BrunoTableSelectColumn } from "./index";
import { settleBrunoTableBrowserFrames } from "./internal/browser-test-helpers";
import type { BrunoTableColumnId, BrunoTableColumns, BrunoTableValueType } from "./public-types";

type Row = Readonly<{
  readonly id: string;
  readonly name: string;
  readonly score: number;
  readonly note: string;
  readonly revision: bigint;
}>;

const columns = [
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
    isEditable: true,
    pinned: "start",
  },
  {
    columnId: "COL_ID_SCORE",
    field: "score",
    headerName: "Score",
    valueType: "number",
    isEditable: true,
    validate: ({ value }) => (value <= 10 ? undefined : "Score must be at most 10."),
  },
  {
    columnId: "COL_ID_NOTE",
    field: "note",
    headerName: "Note",
    valueType: "text",
    isEditable: true,
    pinned: "end",
  },
] satisfies BrunoTableColumns<Row>;

const rows: readonly Row[] = [
  { id: "ada", name: "Ada", score: 4, note: "first", revision: 9_007_199_254_740_993n },
  { id: "grace", name: "Grace", score: 8, note: "last", revision: 9_007_199_254_740_994n },
];

async function renderEditableTable(strict = false) {
  const onSaveEdits = vi.fn(() => Promise.resolve());
  const table = (
    <>
      <button type="button">Before table</button>
      <BrunoTableClient
        tableId="TABLE_ID_CELL_EDIT"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={onSaveEdits}
      />
      <details>
        <summary role="button">After grid summary</summary>
      </details>
      <button type="button">After table</button>
    </>
  );
  const screen = await render(strict ? <StrictMode>{table}</StrictMode> : table);
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_CELL_EDIT" });
  grid.element().focus();
  return { grid, onSaveEdits, screen };
}

function copyGesture(): string {
  return detectPlatform() === "mac" ? "{Meta>}c{/Meta}" : "{Control>}c{/Control}";
}

function installClipboard(writeText: (text: string) => Promise<void>): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
  return () => {
    if (descriptor === undefined) delete (navigator as { clipboard?: Clipboard }).clipboard;
    else Object.defineProperty(navigator, "clipboard", descriptor);
  };
}

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

test("commits through one parse-validation gate and preserves invalid editor evidence", async () => {
  const { grid, onSaveEdits, screen } = await renderEditableTable();
  await userEvent.keyboard("{ArrowRight}{Enter}");
  const editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await expect.element(editor).toHaveValue(4);
  await userEvent.clear(editor);
  await userEvent.keyboard("1e");
  await userEvent.keyboard("{Enter}");
  await expect.element(editor).toHaveFocus();
  await expect.element(editor).toHaveAttribute("aria-invalid", "true");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Enter a valid number.");
  await expect.element(screen.getByRole("alert")).toBeVisible();
  expect(onSaveEdits).not.toHaveBeenCalled();

  await userEvent.keyboard("{Backspace}1");
  await userEvent.keyboard("{Tab}");
  await expect.element(editor).toHaveFocus();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Score must be at most 10.");
  expect(onSaveEdits).not.toHaveBeenCalled();

  await userEvent.fill(editor, "5");
  await userEvent.keyboard("{Enter}");
  await expect.element(editor).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("gridcell", { name: "5", exact: true }))
    .toBeInTheDocument();
  expect(onSaveEdits).not.toHaveBeenCalled();
  expect(grid.element()).toHaveFocus();
});

test("keeps Cell Edit active after the Strict Mode effect rehearsal", async () => {
  const { grid, screen } = await renderEditableTable(true);
  await userEvent.keyboard("{Enter}");
  const editor = screen.getByRole("textbox", { name: "Edit Name" });
  await expect.element(editor).toHaveFocus();
  await userEvent.clear(editor);
  await userEvent.keyboard("Strict Ada{Enter}");
  await expect.element(editor).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("gridcell", { name: "Strict Ada", exact: true }))
    .toBeInTheDocument();
  await expect.element(grid).toHaveFocus();
});

test("leaves prevented editor movement commands with the owning widget", async () => {
  const { onSaveEdits, screen } = await renderEditableTable();
  await userEvent.keyboard("{Enter}");
  const editor = screen.getByRole("textbox", { name: "Edit Name" });
  await userEvent.fill(editor, "Blocked movement");
  const preventMovement: EventListener = (event) => event.preventDefault();
  editor.element().addEventListener("keydown", preventMovement, true);

  for (const { key, shiftKey } of [
    { key: "Enter", shiftKey: false },
    { key: "Enter", shiftKey: true },
    { key: "Tab", shiftKey: false },
    { key: "Tab", shiftKey: true },
  ]) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      shiftKey,
    });
    editor.element().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await expect.element(editor).toHaveFocus();
    await expect.element(editor).toHaveValue("Blocked movement");
  }

  editor.element().removeEventListener("keydown", preventMovement, true);
  expect(onSaveEdits).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
});

test("preserves browser-incompatible current Number seeds and caret across equivalent recompiles", async () => {
  type SeedRow = Readonly<{
    readonly id: string;
    readonly leadingZero: number;
    readonly plus: number;
  }>;
  const decode = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input)
      ? ({ _tag: "Success", value: input } as const)
      : ({ _tag: "Failure", message: "Expected number." } as const);
  const parse = (text: string) => decode(Number(text));
  const equivalent = Object.is;
  const compare = (left: number, right: number) => (left === right ? 0 : left < right ? -1 : 1);
  const plusFormat = () => "+1";
  const leadingZeroFormat = () => "01";
  const createValueType = (
    codecId: string,
    format: (value: number) => string,
  ): BrunoTableValueType<number, "numeric", "number"> => ({
    codecId,
    codecVersion: 1,
    filterFamily: "numeric",
    editorFamily: "number",
    cellAlign: "end",
    editorLayout: "inline",
    defaultWidth: 120,
    decodeRuntime: decode,
    equivalent,
    compare,
    formatCanonicalText: format,
    parseCanonicalText: parse,
    formatDisplay: format,
    encodePersisted: String,
    decodePersisted: (input) => decode(Number(input)),
  });
  const createColumns = () => {
    const plusValueType = createValueType("test/plus-number-seed", plusFormat);
    const leadingZeroValueType = createValueType(
      "test/leading-zero-number-seed",
      leadingZeroFormat,
    );
    return [
      {
        columnId: "COL_ID_PLUS",
        field: "plus",
        headerName: "Plus",
        valueType: plusValueType,
        isEditable: true,
      },
      {
        columnId: "COL_ID_LEADING_ZERO",
        field: "leadingZero",
        headerName: "Leading zero",
        valueType: leadingZeroValueType,
        isEditable: true,
      },
    ] satisfies BrunoTableColumns<SeedRow>;
  };
  const table = (seedRows: readonly SeedRow[], columns: ReturnType<typeof createColumns>) => (
    <BrunoTableClient
      tableId="TABLE_ID_NUMBER_CURRENT_SEED"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_PLUS", direction: "asc" }]}
      clientSource={{ rows: seedRows, totalRows: seedRows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={() => 1n}
      onSaveEdits={() => Promise.resolve()}
    />
  );
  const seedRows = [{ id: "number-seeds", plus: 1, leadingZero: 1 }] as const;
  const screen = await render(table(seedRows, createColumns()));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_NUMBER_CURRENT_SEED" });
  grid.element().focus();
  await userEvent.keyboard("{F2}");
  const plusEditor = screen.getByRole("textbox", { name: "Edit Plus" });
  await expect.element(plusEditor).toHaveValue("+1");
  const plusInput = plusEditor.element() as HTMLInputElement;
  plusInput.setSelectionRange(1, 1);

  await screen.rerender(table(seedRows, createColumns()));

  expect(screen.getByRole("textbox", { name: "Edit Plus" }).element()).toBe(plusInput);
  expect(plusInput.selectionStart).toBe(1);
  expect(plusInput.selectionEnd).toBe(1);
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("gridcell", { name: "01", exact: true }));
  await userEvent.keyboard("{F2}");
  const leadingZeroEditor = screen.getByRole("spinbutton", { name: "Edit Leading zero" });
  await expect.element(leadingZeroEditor).toHaveValue(1);
  expect((leadingZeroEditor.element() as HTMLInputElement).value).toBe("01");
  await userEvent.keyboard("{Enter}");
  await expect.element(leadingZeroEditor).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("gridcell", { name: "01", exact: true }))
    .toBeInTheDocument();
});

test("contains hostile value equivalence without losing the raw candidate or focus", async () => {
  type HostileRow = Readonly<{ readonly id: string; readonly value: number }>;
  let comparisons = 0;
  const valueType: BrunoTableValueType<number, "numeric", "number"> = {
    codecId: "test/hostile-browser-equivalence",
    codecVersion: 1,
    filterFamily: "numeric",
    editorFamily: "number",
    cellAlign: "end",
    editorLayout: "inline",
    defaultWidth: 120,
    decodeRuntime: (input) =>
      typeof input === "number" && Number.isFinite(input)
        ? { _tag: "Success", value: input }
        : { _tag: "Failure", message: "Expected number." },
    equivalent: (left, right) => {
      comparisons += 1;
      if (comparisons === 2) throw new Error("hostile source comparison");
      return Object.is(left, right);
    },
    compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
    formatCanonicalText: String,
    parseCanonicalText: (text) => ({ _tag: "Success", value: Number(text) }),
    formatDisplay: String,
    encodePersisted: String,
    decodePersisted: (input) => ({ _tag: "Success", value: Number(input) }),
  };
  const hostileColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "value",
      headerName: "Value",
      valueType,
      isEditable: true,
    },
  ] satisfies BrunoTableColumns<HostileRow>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_HOSTILE_EQUIVALENCE"
      columns={hostileColumns}
      initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
      clientSource={{
        rows: [{ id: "hostile", value: 4 }],
        totalRows: 1,
        version: 1,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={() => 1n}
      onSaveEdits={() => Promise.resolve()}
    />,
  );
  screen.getByRole("grid", { name: "Data for TABLE_ID_HOSTILE_EQUIVALENCE" }).element().focus();
  await userEvent.keyboard("{F2}");
  const editor = screen.getByRole("spinbutton", { name: "Edit Value" });
  await userEvent.fill(editor, "5");
  await userEvent.keyboard("{Enter}");

  await expect.element(editor).toHaveFocus();
  await expect.element(editor).toHaveValue(5);
  await expect.element(editor).toHaveAttribute("aria-invalid", "true");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("The value is invalid.");
  expect(screen.getByRole("gridcell", { name: "4", exact: true }).all()).toHaveLength(1);
});

test("does not exempt another Table Instance's detached Cancel control", async () => {
  const renderTables = (secondRows: readonly Row[]) => (
    <>
      <BrunoTableClient
        tableId="TABLE_ID_CANCEL_OWNER_A"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{ rows: [rows[0]!], totalRows: 1, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={() => Promise.resolve()}
      />
      <BrunoTableClient
        tableId="TABLE_ID_CANCEL_OWNER_B"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        initialFilters={[{ columnId: "COL_ID_NAME", type: "equals", filter: "Grace" }]}
        clientSource={{
          rows: secondRows,
          totalRows: secondRows.length,
          version: secondRows[0]?.name === "Hidden" ? 3 : 2,
          status: "ready",
        }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={() => Promise.resolve()}
      />
    </>
  );
  const screen = await render(renderTables([rows[1]!]));
  const firstGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_CANCEL_OWNER_A" });
  const secondGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_CANCEL_OWNER_B" });

  await userEvent.click(secondGrid.getByRole("gridcell", { name: "8", exact: true }));
  await userEvent.keyboard("{F2}");
  await expect.element(secondGrid.getByRole("spinbutton", { name: "Edit Score" })).toBeVisible();
  await screen.rerender(renderTables([{ ...rows[1]!, name: "Hidden" }]));
  await expect.element(screen.getByRole("button", { name: "Cancel editing" })).toBeVisible();

  firstGrid.element().focus();
  await userEvent.keyboard("{ArrowRight}{F2}");
  const firstEditor = firstGrid.getByRole("spinbutton", { name: "Edit Score" });
  await userEvent.fill(firstEditor, "99");
  const foreignCancel = screen.getByRole("button", { name: "Cancel editing" });
  foreignCancel
    .element()
    .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  (foreignCancel.element() as HTMLButtonElement).click();

  await expect.element(firstEditor).toHaveFocus();
  await expect.element(firstEditor).toHaveAttribute("aria-invalid", "true");
  await expect.element(screen.getByRole("button", { name: "Cancel editing" })).toBeVisible();
  expect(secondGrid.getByRole("spinbutton", { name: "Edit Score" }).all()).toHaveLength(1);

  const siblingEscape = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Escape",
  });
  foreignCancel.element().dispatchEvent(siblingEscape);
  expect(siblingEscape.defaultPrevented).toBe(true);
  await expect
    .element(secondGrid.getByRole("spinbutton", { name: "Edit Score" }))
    .not.toBeInTheDocument();
  await expect.element(firstEditor).toBeVisible();
  await expect.element(firstEditor).toHaveAttribute("aria-invalid", "true");
});

test("does not exempt a nested Table Instance's detached Cancel control", async () => {
  type NestedHandle = Readonly<{ hide: () => void }>;
  const nestedRef = createRef<NestedHandle>();
  const NestedTable = forwardRef<NestedHandle>(function NestedTable(_props, ref) {
    const [hidden, setHidden] = useState(false);
    useImperativeHandle(ref, () => ({ hide: () => setHidden(true) }), []);
    const nestedRow = hidden
      ? { ...rows[1]!, id: "ada", name: "Hidden" }
      : { ...rows[1]!, id: "ada" };
    return (
      <BrunoTableClient
        tableId="TABLE_ID_NESTED_CANCEL_OWNER"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        initialFilters={[{ columnId: "COL_ID_NAME", type: "equals", filter: "Grace" }]}
        clientSource={{
          rows: [nestedRow],
          totalRows: 1,
          version: hidden ? 2 : 1,
          status: "ready",
        }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={() => Promise.resolve()}
      />
    );
  });
  const outerColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      isEditable: true,
      pinned: "start",
    },
    {
      columnId: "COL_ID_SCORE",
      field: "score",
      headerName: "Score",
      valueType: "number",
      isEditable: true,
      validate: ({ value }) => (value <= 10 ? undefined : "Score must be at most 10."),
    },
    {
      columnId: "COL_ID_NOTE",
      field: "note",
      headerName: "Note",
      valueType: "text",
      isEditable: true,
      pinned: "end",
      cellRenderer: () => <NestedTable ref={nestedRef} />,
    },
  ] satisfies BrunoTableColumns<Row>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_OUTER_CANCEL_OWNER"
      columns={outerColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: [rows[0]!], totalRows: 1, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() => Promise.resolve()}
    />,
  );
  const outerGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_OUTER_CANCEL_OWNER" });
  await userEvent.click(outerGrid.getByRole("gridcell", { name: "4", exact: true }));
  await userEvent.keyboard("{F2}");
  const outerEditor = outerGrid.getByRole("spinbutton", { name: "Edit Score" });
  await userEvent.fill(outerEditor, "99");
  const outerEditorElement = outerEditor.element();

  const nestedGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_NESTED_CANCEL_OWNER" });
  expect(nestedGrid.getByRole("gridcell", { name: "Grace", exact: true }).all()).toHaveLength(1);
  expect(
    nestedGrid
      .getByRole("gridcell", { name: "Grace", exact: true })
      .element()
      .closest("[data-bruno-table]"),
  ).toBe(nestedGrid.element().closest("[data-bruno-table]"));
  nestedGrid.element().focus();
  await userEvent.keyboard("{ArrowRight}{F2}");
  const nestedEditor = nestedGrid.getByRole("spinbutton", { name: "Edit Score" });
  await expect.element(nestedEditor).toBeVisible();
  flushSync(() => nestedRef.current?.hide());
  const nestedCancel = screen.getByRole("button", { name: "Cancel editing" });
  await expect.element(nestedCancel).toBeVisible();

  nestedCancel
    .element()
    .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  (nestedCancel.element() as HTMLButtonElement).click();

  expect(document.activeElement).toBe(outerEditorElement);
  await vi.waitFor(() => expect(outerEditorElement.getAttribute("aria-invalid")).toBe("true"));
  await expect.element(nestedCancel).toBeVisible();
  await expect.element(nestedEditor).toBeVisible();

  const nestedEscape = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Escape",
  });
  nestedCancel.element().dispatchEvent(nestedEscape);
  expect(nestedEscape.defaultPrevented).toBe(true);
  await expect.element(nestedEditor).not.toBeInTheDocument();
  await expect.element(outerEditor).toBeVisible();
  await expect.element(outerEditor).toHaveAttribute("aria-invalid", "true");
});

test("anchors simultaneous nested editors with colliding Row Identities to their owning rows", async () => {
  const nestedRow: Row = {
    id: "shared",
    name: "Nested",
    score: 1,
    note: "Nested note",
    revision: 1n,
  };
  const NestedTable = () => (
    <BrunoTableClient
      tableId="TABLE_ID_NESTED_GEOMETRY_OWNER"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: [nestedRow], totalRows: 1, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() => Promise.resolve()}
    />
  );
  const outerRows: readonly Row[] = [
    { id: "host", name: "A host", score: 0, note: "Host", revision: 1n },
    { id: "shared", name: "Z target", score: 2, note: "Target", revision: 1n },
  ];
  const outerColumns = [
    columns[0]!,
    columns[1]!,
    {
      columnId: "COL_ID_NOTE",
      field: "note",
      headerName: "Note",
      valueType: "text",
      isEditable: true,
      pinned: "end",
      cellRenderer: ({ row, value }: { readonly row: Row; readonly value: string }) =>
        row.id === "host" ? <NestedTable /> : value,
    },
  ] satisfies BrunoTableColumns<Row>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_OUTER_GEOMETRY_OWNER"
      columns={outerColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: outerRows, totalRows: 2, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() => Promise.resolve()}
    />,
  );
  const outerGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_OUTER_GEOMETRY_OWNER" });
  const nestedGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_NESTED_GEOMETRY_OWNER" });
  const nestedCell = nestedGrid.getByRole("gridcell", { name: "1", exact: true });
  const owningSlot = (grid: HTMLElement, rowId: string) =>
    [
      ...grid.querySelectorAll<HTMLElement>(`[data-bruno-edit-row-slot="${CSS.escape(rowId)}"]`),
    ].find((slot) => slot.closest("[data-bruno-table]") === grid.closest("[data-bruno-table]"));

  await userEvent.click(nestedCell);
  await userEvent.keyboard("{F2}");
  const nestedEditor = nestedGrid.getByRole("spinbutton", { name: "Edit Score" });
  await settleBrunoTableBrowserFrames();
  const nestedSlot = owningSlot(nestedGrid.element() as HTMLElement, "shared");
  expect(nestedSlot).toBeDefined();
  const nestedEditorTop = nestedEditor.element().getBoundingClientRect().top;
  const outerTargetTop = outerGrid
    .getByRole("gridcell", { name: "Z target", exact: true })
    .element()
    .getBoundingClientRect().top;

  outerGrid.element().focus();
  await userEvent.keyboard("{ArrowDown}{F2}");
  const outerEditor = outerGrid.getByRole("textbox", { name: "Edit Name" });
  await settleBrunoTableBrowserFrames();
  await expect.element(outerEditor).toHaveFocus();
  await expect.element(nestedEditor).toBeVisible();
  const outerSlot = owningSlot(outerGrid.element() as HTMLElement, "shared");
  expect(outerSlot).toBeDefined();
  expect(
    Math.abs(outerEditor.element().getBoundingClientRect().top - outerTargetTop),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(nestedEditor.element().getBoundingClientRect().top - nestedEditorTop),
  ).toBeLessThanOrEqual(1);
  const editorCellIds = [nestedEditor, outerEditor].map(
    (editor) => editor.element().closest<HTMLElement>('[role="gridcell"]')?.id,
  );
  expect(editorCellIds.every((id) => id !== undefined && id.length > 0)).toBe(true);
  expect(new Set(editorCellIds).size).toBe(2);
  for (const id of editorCellIds) {
    expect(document.querySelectorAll(`[id="${CSS.escape(id ?? "")}"]`)).toHaveLength(1);
  }

  await userEvent.keyboard("{Escape}");
  await expect.element(outerEditor).not.toBeInTheDocument();
  await expect.element(nestedEditor).toBeVisible();
  nestedEditor.element().focus();
  await userEvent.keyboard("{Escape}");
  await expect.element(nestedEditor).not.toBeInTheDocument();
});

test("does not retarget after a valid outside commit into a sibling Table Instance", async () => {
  const screen = await render(
    <>
      <BrunoTableClient
        tableId="TABLE_ID_OUTSIDE_COMMIT_A"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{ rows: [rows[0]!], totalRows: 1, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={() => Promise.resolve()}
      />
      <BrunoTableClient
        tableId="TABLE_ID_OUTSIDE_COMMIT_B"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{ rows: [rows[0]!], totalRows: 1, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={() => Promise.resolve()}
      />
    </>,
  );
  const firstGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_OUTSIDE_COMMIT_A" });
  const secondGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_OUTSIDE_COMMIT_B" });
  firstGrid.element().focus();
  await userEvent.keyboard("{ArrowRight}{F2}");
  const editor = firstGrid.getByRole("spinbutton", { name: "Edit Score" });
  await userEvent.fill(editor, "5");
  const secondName = secondGrid.getByRole("gridcell", { name: "Ada", exact: true });

  await userEvent.click(secondName);

  await expect.element(editor).not.toBeInTheDocument();
  const committedScore = firstGrid.getByRole("gridcell", { name: "5", exact: true });
  expect(firstGrid.element().getAttribute("aria-activedescendant")).toBe(
    committedScore.element().id,
  );
  expect(secondGrid.element().getAttribute("aria-activedescendant")).toBe(secondName.element().id);
});

test("does not retarget after a valid outside commit into a nested Table Instance", async () => {
  const NestedTable = () => (
    <BrunoTableClient
      tableId="TABLE_ID_NESTED_OUTSIDE_COMMIT"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: [rows[0]!], totalRows: 1, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() => Promise.resolve()}
    />
  );
  const outerColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      isEditable: true,
      pinned: "start",
    },
    {
      columnId: "COL_ID_SCORE",
      field: "score",
      headerName: "Score",
      valueType: "number",
      isEditable: true,
      validate: ({ value }) => (value <= 10 ? undefined : "Score must be at most 10."),
    },
    {
      columnId: "COL_ID_NOTE",
      field: "note",
      headerName: "Note",
      valueType: "text",
      isEditable: true,
      pinned: "end",
      cellRenderer: NestedTable,
    },
  ] satisfies BrunoTableColumns<Row>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_OUTER_OUTSIDE_COMMIT"
      columns={outerColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: [rows[0]!], totalRows: 1, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() => Promise.resolve()}
    />,
  );
  const outerGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_OUTER_OUTSIDE_COMMIT" });
  const nestedGrid = screen.getByRole("grid", { name: "Data for TABLE_ID_NESTED_OUTSIDE_COMMIT" });
  outerGrid.element().focus();
  await userEvent.keyboard("{ArrowRight}{F2}");
  const editor = outerGrid.getByRole("spinbutton", { name: "Edit Score" });
  await userEvent.fill(editor, "5");
  const nestedName = nestedGrid.getByRole("gridcell", { name: "Ada", exact: true });

  await userEvent.click(nestedName);

  await expect.element(editor).not.toBeInTheDocument();
  const committedScore = outerGrid.getByRole("gridcell", { name: "5", exact: true });
  expect(outerGrid.element().getAttribute("aria-activedescendant")).toBe(
    committedScore.element().id,
  );
  expect(nestedGrid.element().getAttribute("aria-activedescendant")).toBe(nestedName.element().id);
});

test("keeps the validation explanation inside the scrollport across collision changes", async () => {
  const manyRows = Array.from(
    { length: 40 },
    (_, index): Row => ({
      id: `row-${String(index)}`,
      name: `Person ${String(index)}`,
      score: index,
      note: `note-${String(index)}`,
      revision: BigInt(index + 1),
    }),
  );
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_VALIDATION_COLLISION"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: manyRows, totalRows: manyRows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() => Promise.resolve()}
    />,
  );
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_VALIDATION_COLLISION" });
  const lowerCell = grid.getByRole("gridcell", { name: "18", exact: true });
  lowerCell.element().scrollIntoView({ block: "end" });
  await settleBrunoTableBrowserFrames();
  await userEvent.click(lowerCell);
  await userEvent.keyboard("{F2}");
  const editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await userEvent.fill(editor, "99");
  await userEvent.keyboard("{Enter}");
  const alert = screen.getByRole("alert", { name: "" });
  const lowerEditorRect = editor.element().getBoundingClientRect();
  let alertRect = alert.element().getBoundingClientRect();
  let gridRect = grid.element().getBoundingClientRect();
  expect(alertRect.top).toBeGreaterThanOrEqual(gridRect.top);
  expect(alertRect.bottom).toBeLessThanOrEqual(gridRect.bottom);
  expect(alertRect.bottom).toBeLessThanOrEqual(lowerEditorRect.top);
  await expect.element(editor).toHaveFocus();
  await expect.element(editor).toHaveAttribute("aria-describedby", alert.element().id);

  grid.element().scrollTop += 240;
  grid.element().dispatchEvent(new Event("scroll"));
  await settleBrunoTableBrowserFrames();
  const upperEditorRect = editor.element().getBoundingClientRect();
  alertRect = alert.element().getBoundingClientRect();
  gridRect = grid.element().getBoundingClientRect();
  expect(alertRect.top).toBeGreaterThanOrEqual(gridRect.top);
  expect(alertRect.bottom).toBeLessThanOrEqual(gridRect.bottom);
  expect(alertRect.top).toBeGreaterThanOrEqual(upperEditorRect.bottom);
  await expect.element(editor).toHaveFocus();
  await expect.element(editor).toHaveValue(99);

  grid.element().style.height = "52px";
  gridRect = grid.element().getBoundingClientRect();
  const beforeConstrainedEditorRect = editor.element().getBoundingClientRect();
  grid.element().scrollTop += beforeConstrainedEditorRect.top - gridRect.top - 8;
  grid.element().dispatchEvent(new Event("scroll"));
  await settleBrunoTableBrowserFrames();
  const constrainedEditorRect = editor.element().getBoundingClientRect();
  alertRect = alert.element().getBoundingClientRect();
  gridRect = grid.element().getBoundingClientRect();
  expect(constrainedEditorRect.top - gridRect.top).toBeLessThan(24);
  expect(gridRect.bottom - constrainedEditorRect.bottom).toBeLessThan(24);
  expect(alertRect.height).toBeGreaterThanOrEqual(24);
  expect(alertRect.top).toBeGreaterThanOrEqual(gridRect.top);
  expect(alertRect.bottom).toBeLessThanOrEqual(gridRect.bottom);
  await expect.element(editor).toHaveFocus();
  await expect.element(editor).toHaveValue(99);
  await expect.element(editor).toHaveAttribute("aria-describedby", alert.element().id);
});

test("uses the sole active Table Instance as the document Escape fallback", async () => {
  const { screen } = await renderEditableTable();
  await userEvent.keyboard("{Enter}");
  const editor = screen.getByRole("textbox", { name: "Edit Name" });
  await expect.element(editor).toBeVisible();

  const documentEscape = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Escape",
  });
  document.body.dispatchEvent(documentEscape);

  expect(documentEscape.defaultPrevented).toBe(true);
  await expect.element(editor).not.toBeInTheDocument();
});

test("cancels before a live blank-policy change can reinterpret the active candidate", async () => {
  type NullableRow = Readonly<{
    readonly id: string;
    readonly value: number | null | undefined;
  }>;
  const initialColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "value",
      headerName: "Value",
      valueType: "number",
      isEditable: true,
      blankValue: null,
    },
  ] as const satisfies BrunoTableColumns<NullableRow>;
  type HarnessHandle = Readonly<{ changeBlankPolicy: () => void }>;
  const harnessRef = createRef<HarnessHandle>();
  const Harness = forwardRef<HarnessHandle>(function Harness(_props, ref) {
    const [usesUndefined, setUsesUndefined] = useState(false);
    useImperativeHandle(ref, () => ({ changeBlankPolicy: () => setUsesUndefined(true) }), []);
    const activeColumns = [
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "number",
        isEditable: true,
        blankValue: usesUndefined ? undefined : null,
      },
    ] as const satisfies BrunoTableColumns<NullableRow>;
    // The public contract deliberately rejects a conditional nullable blank policy. This cast is
    // confined to a hostile live-reconciliation test for already-compiled runtime columns.
    const runtimeColumns = activeColumns as typeof initialColumns;
    return (
      <BrunoTableClient
        tableId="TABLE_ID_BLANK_POLICY_RECONCILIATION"
        columns={runtimeColumns}
        initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
        clientSource={{
          rows: [{ id: "row", value: null }],
          totalRows: 1,
          version: 1,
          status: "ready",
        }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={() => 1n}
        onSaveEdits={() => Promise.resolve()}
      />
    );
  });
  const screen = await render(<Harness ref={harnessRef} />);
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BLANK_POLICY_RECONCILIATION" });
  grid.element().focus();
  await userEvent.keyboard("{F2}");
  const editor = screen.getByRole("spinbutton", { name: "Edit Value" });
  await userEvent.clear(editor);
  await userEvent.keyboard("1e");
  await expect.element(editor).toHaveFocus();

  flushSync(() => harnessRef.current?.changeBlankPolicy());
  await settleBrunoTableBrowserFrames();

  await expect.element(editor).not.toBeInTheDocument();
  await expect.element(screen.getByRole("gridcell", { name: "", exact: true })).toBeInTheDocument();
});

test("retains the editor and blocks every commit while live edit permission is denied", async () => {
  type PermissionRow = Readonly<{
    readonly id: string;
    readonly value: string;
    readonly allowed: boolean;
  }>;
  const editablePredicate = vi.fn(
    ({ value: liveValue }: { readonly row: PermissionRow; readonly value: string }) =>
      liveValue !== "locked",
  );
  const permissionColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "value",
      headerName: "Value",
      valueType: "text",
      isEditable: editablePredicate,
    },
  ] satisfies BrunoTableColumns<PermissionRow>;
  type HarnessHandle = Readonly<{ setValue: (value: string) => void }>;
  const harnessRef = createRef<HarnessHandle>();
  const Harness = forwardRef<HarnessHandle>(function Harness(_props, ref) {
    const [value, setValue] = useState("source");
    useImperativeHandle(ref, () => ({ setValue }), []);
    return (
      <BrunoTableClient
        tableId="TABLE_ID_LIVE_EDIT_PERMISSION"
        columns={permissionColumns}
        initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
        clientSource={{
          rows: [{ id: "row", value, allowed: true }],
          totalRows: 1,
          version: value === "source" ? 1 : 2,
          status: "ready",
        }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={() => 1n}
        onSaveEdits={() => Promise.resolve()}
      />
    );
  });
  const screen = await render(<Harness ref={harnessRef} />);
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_LIVE_EDIT_PERMISSION" });
  grid.element().focus();
  await userEvent.keyboard("{F2}");
  const editor = screen.getByRole("textbox", { name: "Edit Value" });
  await userEvent.fill(editor, "candidate");

  flushSync(() => harnessRef.current?.setValue("locked"));
  await expect.element(editor).toHaveFocus();
  await expect.element(editor).toHaveValue("candidate");
  await expect.element(editor).toHaveAttribute("aria-invalid", "true");
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("This cell is no longer editable.");
  await userEvent.keyboard("{Enter}");
  await expect.element(editor).toHaveFocus();
  await expect.element(editor).toHaveValue("candidate");

  flushSync(() => harnessRef.current?.setValue("source"));
  await expect.element(editor).not.toHaveAttribute("aria-invalid", "true");
  await userEvent.keyboard("{Enter}");
  await expect.element(editor).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("gridcell", { name: "candidate", exact: true }))
    .toBeVisible();
});

test("preserves a Select editor across an equivalent fresh helper definition", async () => {
  type SelectRow = Readonly<{ readonly id: string; readonly choice: "a" | "b" }>;
  const compileSelectColumns = () =>
    [
      BrunoTableSelectColumn({
        columnId: "COL_ID_CHOICE",
        field: "choice",
        headerName: "Choice",
        options: ["a", "b"],
        isEditable: true,
      }),
    ] satisfies BrunoTableColumns<SelectRow>;
  type HarnessHandle = Readonly<{ rerenderColumns: () => void }>;
  const harnessRef = createRef<HarnessHandle>();
  const Harness = forwardRef<HarnessHandle>(function Harness(_props, ref) {
    const [revision, setRevision] = useState(1);
    useImperativeHandle(
      ref,
      () => ({ rerenderColumns: () => setRevision((current) => current + 1) }),
      [],
    );
    const selectColumns = compileSelectColumns();
    return (
      <BrunoTableClient
        tableId="TABLE_ID_SELECT_RECOMPILE"
        columns={selectColumns}
        initialOrderBy={[{ columnId: "COL_ID_CHOICE", direction: "asc" }]}
        clientSource={{
          rows: [{ id: "row", choice: "a" }],
          totalRows: 1,
          version: revision,
          status: "ready",
        }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={() => 1n}
        onSaveEdits={() => Promise.resolve()}
      />
    );
  });
  const screen = await render(<Harness ref={harnessRef} />);
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SELECT_RECOMPILE" });
  grid.element().focus();
  await userEvent.keyboard("{F2}");
  const editor = screen.getByRole("combobox", { name: "Edit Choice" });
  await userEvent.selectOptions(editor, "scalar:1");
  const nativeEditor = editor.element();

  flushSync(() => harnessRef.current?.rerenderColumns());
  await expect.element(editor).toHaveFocus();
  expect(screen.getByRole("combobox", { name: "Edit Choice" }).element()).toBe(nativeEditor);
  await expect.element(editor).toHaveValue("scalar:1");

  await userEvent.keyboard("{Enter}");
  await expect.element(editor).not.toBeInTheDocument();
  await expect.element(screen.getByRole("gridcell", { name: "b", exact: true })).toBeVisible();
});

test.each(["ltr", "rtl"] as const)(
  "keeps one native Number editor node across %s responsive and pinned layout changes",
  async (direction) => {
    type StableEditorRow = Readonly<{
      readonly id: string;
      readonly score: number;
      readonly startPeer: string;
      readonly center: string;
      readonly endScore: number;
    }>;
    const stableColumns = [
      {
        columnId: "COL_ID_STABLE_SCORE",
        field: "score",
        headerName: "Stable score",
        valueType: "number",
        isEditable: true,
        pinned: "start",
        width: 120,
      },
      {
        columnId: "COL_ID_STABLE_START_PEER",
        field: "startPeer",
        headerName: "Stable start peer",
        valueType: "text",
        pinned: "start",
        width: 100,
      },
      {
        columnId: "COL_ID_STABLE_CENTER",
        field: "center",
        headerName: "Stable center",
        valueType: "text",
        width: 1_200,
      },
      {
        columnId: "COL_ID_STABLE_END_SCORE",
        field: "endScore",
        headerName: "Stable end score",
        valueType: "number",
        isEditable: true,
        pinned: "end",
        width: 120,
      },
    ] satisfies BrunoTableColumns<StableEditorRow>;
    type HarnessHandle = Readonly<{
      updateLayout: (width: number, rowSelection: boolean) => void;
    }>;
    const harnessRef = createRef<HarnessHandle>();
    const Harness = forwardRef<HarnessHandle>(function Harness(_props, ref) {
      const [layout, setLayout] = useState({ rowSelection: false, width: 440 });
      useImperativeHandle(
        ref,
        () => ({ updateLayout: (width, rowSelection) => setLayout({ width, rowSelection }) }),
        [],
      );
      return (
        <div dir={direction} style={{ width: layout.width }}>
          <BrunoTableClient
            tableId={`TABLE_ID_STABLE_NATIVE_NUMBER_EDITOR_${direction.toUpperCase()}`}
            columns={stableColumns}
            initialOrderBy={[{ columnId: "COL_ID_STABLE_SCORE", direction: "asc" }]}
            clientSource={{
              rows: [
                {
                  id: "stable",
                  score: 4,
                  startPeer: "peer",
                  center: "center",
                  endScore: 7,
                },
              ],
              totalRows: 1,
              version: 1,
              status: "ready",
            }}
            getRowId={(row) => row.id}
            editable
            getRowVersion={() => 1n}
            onSaveEdits={() => Promise.resolve()}
            {...(layout.rowSelection ? ({ rowSelection: true } as const) : {})}
          />
        </div>
      );
    });
    const screen = await render(<Harness ref={harnessRef} />);
    const grid = screen.getByRole("grid", {
      name: `Data for TABLE_ID_STABLE_NATIVE_NUMBER_EDITOR_${direction.toUpperCase()}`,
    });
    await vi.waitFor(() =>
      expect(grid.element().querySelector('[data-pinned-region="start"]')).not.toBeNull(),
    );
    grid.element().focus();
    await userEvent.keyboard("{F2}");
    const editor = screen.getByRole("spinbutton", { name: "Edit Stable score" });
    await userEvent.clear(editor);
    await userEvent.keyboard("1e");
    const nativeEditor = editor.element() as HTMLInputElement;
    expect(nativeEditor.validity.badInput).toBe(true);
    const initialSelectionStart = nativeEditor.selectionStart;
    const initialSelectionEnd = nativeEditor.selectionEnd;
    expect(nativeEditor.closest('[role="gridcell"]')?.getAttribute("aria-colindex")).toBe("1");

    flushSync(() => harnessRef.current?.updateLayout(440, true));
    flushSync(() => harnessRef.current?.updateLayout(440, false));
    flushSync(() => harnessRef.current?.updateLayout(440, true));
    await settleBrunoTableBrowserFrames();
    await vi.waitFor(() =>
      expect(grid.element().querySelector('[data-pinned-region="start"]')).toBeNull(),
    );
    const suspendedEditor = screen.getByRole("spinbutton", { name: "Edit Stable score" }).element();
    expect(suspendedEditor).toBe(nativeEditor);
    expect(nativeEditor.validity.badInput).toBe(true);
    expect(nativeEditor.selectionStart).toBe(initialSelectionStart);
    expect(nativeEditor.selectionEnd).toBe(initialSelectionEnd);
    await expect.element(editor).toHaveFocus();
    expect(nativeEditor.closest('[role="gridcell"]')?.getAttribute("aria-colindex")).toBe("2");
    await expect.element(screen.getByRole("checkbox", { name: "Select row 1" })).toBeVisible();
    const suspendedHeader = screen
      .getByRole("columnheader", { name: /^Stable score/u })
      .element()
      .getBoundingClientRect();
    const suspendedCell = nativeEditor.getBoundingClientRect();
    expect(Math.abs(suspendedCell.left - suspendedHeader.left)).toBeLessThanOrEqual(1);

    flushSync(() => harnessRef.current?.updateLayout(440, false));
    await settleBrunoTableBrowserFrames();
    await vi.waitFor(() =>
      expect(grid.element().querySelector('[data-pinned-region="start"]')).not.toBeNull(),
    );
    expect(screen.getByRole("spinbutton", { name: "Edit Stable score" }).element()).toBe(
      nativeEditor,
    );
    expect(nativeEditor.validity.badInput).toBe(true);
    await expect.element(editor).toHaveFocus();
    await expect
      .element(screen.getByRole("checkbox", { name: "Select row 1" }))
      .not.toBeInTheDocument();

    const startHeader = screen.getByRole("columnheader", { name: /^Stable score/u }).element();
    grid.element().scrollLeft = direction === "rtl" ? -64 : 64;
    grid.element().dispatchEvent(new Event("scroll"));
    await settleBrunoTableBrowserFrames();
    expect(screen.getByRole("spinbutton", { name: "Edit Stable score" }).element()).toBe(
      nativeEditor,
    );
    expect(nativeEditor.validity.badInput).toBe(true);
    await expect.element(editor).toHaveFocus();
    const startEditorRect = nativeEditor.getBoundingClientRect();
    const startHeaderRect = startHeader.getBoundingClientRect();
    expect(
      Math.abs(
        direction === "rtl"
          ? startEditorRect.right - startHeaderRect.right
          : startEditorRect.left - startHeaderRect.left,
      ),
    ).toBeLessThanOrEqual(1);
    await userEvent.keyboard("{Escape}");

    const endCell = screen.getByRole("gridcell", { name: "7", exact: true });
    await userEvent.click(endCell);
    await userEvent.keyboard("{F2}");
    const endEditor = screen.getByRole("spinbutton", { name: "Edit Stable end score" });
    await userEvent.clear(endEditor);
    await userEvent.keyboard("1e");
    const nativeEndEditor = endEditor.element() as HTMLInputElement;
    expect(nativeEndEditor.validity.badInput).toBe(true);
    expect(nativeEndEditor.closest('[role="gridcell"]')?.getAttribute("aria-colindex")).toBe("4");
    const endSelectionStart = nativeEndEditor.selectionStart;
    const endSelectionEnd = nativeEndEditor.selectionEnd;
    const endHeader = screen.getByRole("columnheader", { name: /^Stable end score/u }).element();
    grid.element().scrollLeft = direction === "rtl" ? -128 : 128;
    grid.element().dispatchEvent(new Event("scroll"));
    await settleBrunoTableBrowserFrames();
    expect(screen.getByRole("spinbutton", { name: "Edit Stable end score" }).element()).toBe(
      nativeEndEditor,
    );
    expect(nativeEndEditor.validity.badInput).toBe(true);
    expect(nativeEndEditor.selectionStart).toBe(endSelectionStart);
    expect(nativeEndEditor.selectionEnd).toBe(endSelectionEnd);
    await expect.element(endEditor).toHaveFocus();
    const endEditorRect = nativeEndEditor.getBoundingClientRect();
    const endHeaderRect = endHeader.getBoundingClientRect();
    expect(
      Math.abs(
        direction === "rtl"
          ? endEditorRect.left - endHeaderRect.left
          : endEditorRect.right - endHeaderRect.right,
      ),
    ).toBeLessThanOrEqual(1);
    await userEvent.keyboard("{Escape}");
  },
);

test("starts from exact current values, replaces from produced text, and cancels without a transaction", async () => {
  const { grid, onSaveEdits, screen } = await renderEditableTable();
  await userEvent.keyboard("{Enter}");
  let editor = screen.getByRole("textbox", { name: "Edit Name" });
  await expect.element(editor).toHaveValue("Ada");
  await userEvent.fill(editor, "Discard me");
  await userEvent.keyboard("{Escape}");
  await expect.element(editor).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("gridcell", { name: "Ada", exact: true }))
    .toBeInTheDocument();
  expect(onSaveEdits).not.toHaveBeenCalled();

  await userEvent.keyboard("ß");
  editor = screen.getByRole("textbox", { name: "Edit Name" });
  await expect.element(editor).toHaveValue("ß");
  editor.element().dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: "Escape",
    }),
  );
  await expect.element(editor).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");

  await userEvent.keyboard("{Delete}{Backspace}");
  grid.element().dispatchEvent(new ClipboardEvent("cut", { bubbles: true }));
  await expect.element(screen.getByRole("textbox", { name: "Edit Name" })).not.toBeInTheDocument();
  expect(onSaveEdits).not.toHaveBeenCalled();
});

test("uses only browser-produced composition text and respects prevented nested Escape", async () => {
  const { grid, screen } = await renderEditableTable();
  grid
    .element()
    .dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, altKey: true, key: "q" }),
    );
  grid.element().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Dead" }));
  grid.element().dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "e",
      inputType: "insertCompositionText",
    }),
  );
  grid.element().dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      data: "pasted",
      inputType: "insertFromPaste",
    }),
  );
  await expect.element(screen.getByRole("textbox", { name: "Edit Name" })).not.toBeInTheDocument();
  grid
    .element()
    .dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, cancelable: true, data: "é" }),
    );
  const editor = screen.getByRole("textbox", { name: "Edit Name" });
  await expect.element(editor).toHaveValue("é");
  editor.element().addEventListener("keydown", (event) => event.preventDefault(), {
    capture: true,
    once: true,
  });
  editor
    .element()
    .dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
    );
  await expect.element(editor).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
});

test("starts replacement editing from browser-produced replacement text", async () => {
  const { grid, screen } = await renderEditableTable();
  const replacement = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertReplacementText",
  });
  Object.defineProperty(replacement, "dataTransfer", {
    value: {
      getData: (type: string) => (type === "text/plain" ? "Grace Hopper" : ""),
    },
  });

  expect(grid.element().dispatchEvent(replacement)).toBe(false);
  await expect
    .element(screen.getByRole("textbox", { name: "Edit Name" }))
    .toHaveValue("Grace Hopper");
});

test("preserves incomplete Number replace seeds until the native control can own them", async () => {
  const { grid, screen } = await renderEditableTable();
  await userEvent.keyboard("{ArrowRight}-");
  let rawEditor = screen.getByRole("textbox", { name: "Edit Score" });
  await expect.element(rawEditor).toHaveValue("-");
  await userEvent.keyboard("{End}{Delete}");
  await expect.element(rawEditor).toHaveValue("-");
  await userEvent.keyboard("{Backspace}");
  let editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await expect.element(editor).toHaveValue(null);
  await userEvent.keyboard("{Escape}");

  grid.element().focus();
  await userEvent.keyboard("e");
  rawEditor = screen.getByRole("textbox", { name: "Edit Score" });
  await userEvent.keyboard("12");
  await expect.element(rawEditor).toHaveValue("e12");
  await userEvent.keyboard("{Home}{Delete}");
  editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await expect.element(editor).toHaveValue(12);
  await userEvent.keyboard("{Escape}");

  grid.element().focus();
  await userEvent.keyboard("e12");
  rawEditor = screen.getByRole("textbox", { name: "Edit Score" });
  await userEvent.keyboard(
    detectPlatform() === "mac" ? "{Meta>}a{/Meta}" : "{Control>}a{/Control}",
  );
  await userEvent.keyboard("-5");
  editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await expect.element(editor).toHaveValue(-5);
  await userEvent.keyboard("{Escape}");

  grid.element().focus();
  grid
    .element()
    .dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, cancelable: true, data: "+5" }),
    );
  rawEditor = screen.getByRole("textbox", { name: "Edit Score" });
  await expect.element(rawEditor).toHaveValue("+5");
  await userEvent.keyboard("{Escape}");

  grid.element().focus();
  await userEvent.keyboard("+5");
  rawEditor = screen.getByRole("textbox", { name: "Edit Score" });
  await expect.element(rawEditor).toHaveValue("+5");
  await userEvent.keyboard("{Enter}");
  await expect.element(rawEditor).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("gridcell", { name: "5", exact: true }))
    .toBeInTheDocument();

  grid.element().focus();
  await userEvent.keyboard(".{Home}1");
  rawEditor = screen.getByRole("textbox", { name: "Edit Score" });
  await expect.element(rawEditor).toHaveValue("1.");
  await userEvent.keyboard("{Enter}");
  await expect.element(rawEditor).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("gridcell", { name: "1", exact: true }))
    .toBeInTheDocument();

  grid.element().focus();
  await userEvent.keyboard(".");
  rawEditor = screen.getByRole("textbox", { name: "Edit Score" });
  await expect.element(rawEditor).toHaveValue(".");
  await userEvent.keyboard("5");
  editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await expect.element(editor).toHaveValue(0.5);
  await userEvent.keyboard("{Escape}");

  grid.element().focus();
  await userEvent.keyboard("1e");
  editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await userEvent.keyboard("{Enter}");
  await expect.element(editor).toHaveFocus();
  await expect.element(editor).toHaveAttribute("aria-invalid", "true");
  await userEvent.keyboard("1");
  await expect.element(editor).toHaveValue(10);
  await userEvent.keyboard("{Enter}");
  await expect.element(editor).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("gridcell", { name: "10", exact: true }))
    .toBeInTheDocument();

  await userEvent.keyboard("{F2}");
  editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await userEvent.clear(editor);
  await userEvent.keyboard("13{ArrowLeft}2");
  await expect.element(editor).toHaveValue(123);
  await userEvent.keyboard("{End}{Delete}");
  await expect.element(editor).toHaveValue(123);
  await userEvent.keyboard("{Escape}");
});

test("gates outside pointer, sorting, and filtering before their actions", async () => {
  const { onSaveEdits, screen } = await renderEditableTable();
  await userEvent.keyboard("{ArrowRight}{F2}");
  const editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await userEvent.clear(editor);
  await userEvent.keyboard("1e");
  const outsideClick = vi.fn();
  screen
    .getByRole("button", { name: "After table" })
    .element()
    .addEventListener("click", outsideClick);
  await userEvent.click(screen.getByRole("button", { name: "After table" }));
  expect(outsideClick).not.toHaveBeenCalled();
  await expect.element(editor).toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
  await expect.element(editor).toHaveFocus();
  await expect
    .element(screen.getByRole("columnheader", { name: /^Name, sorted ascending/u }))
    .toHaveAttribute("aria-sort", "ascending");
  await userEvent.click(screen.getByRole("button", { name: "Filter Name" }));
  await expect.element(screen.getByRole("dialog", { name: "Filter Name" })).not.toBeInTheDocument();

  await userEvent.keyboard("{Backspace}{Backspace}6");
  await userEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
  await expect.element(editor).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("columnheader", { name: /^Name, sorted descending/u }))
    .toHaveAttribute("aria-sort", "descending");
  await userEvent.click(screen.getByRole("gridcell", { name: "8", exact: true }));
  await userEvent.keyboard("{F2}");
  await userEvent.click(screen.getByRole("button", { name: "Filter Name" }));
  await expect.element(screen.getByRole("dialog", { name: "Filter Name" })).toBeInTheDocument();
  expect(onSaveEdits).not.toHaveBeenCalled();
});

test("gates another cell in the edit-owned row through the same commit boundary", async () => {
  const { grid, screen } = await renderEditableTable();
  await userEvent.keyboard("{ArrowRight}{F2}");
  const editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await userEvent.clear(editor);
  await userEvent.keyboard("1e");
  await userEvent.click(screen.getByRole("gridcell", { name: "Ada", exact: true }));
  await expect.element(editor).toHaveFocus();
  expect(grid.element().getAttribute("aria-activedescendant")).not.toBe(
    screen.getByRole("gridcell", { name: "Ada", exact: true }).element().id,
  );

  await userEvent.clear(editor);
  await userEvent.fill(editor, "6");
  const nameCell = screen.getByRole("gridcell", { name: "Ada", exact: true });
  await userEvent.click(nameCell);
  await expect.element(editor).not.toBeInTheDocument();
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(nameCell.element().id);
});

test("lets Shift pointer range activation retain its pre-commit anchor", async () => {
  const writeText = vi.fn(async () => undefined);
  const restoreClipboard = installClipboard(writeText);
  try {
    const { screen } = await renderEditableTable();
    await userEvent.keyboard("{F2}");
    const editor = screen.getByRole("textbox", { name: "Edit Name" });
    const destination = screen.getByRole("gridcell", { name: "Grace", exact: true });

    await userEvent.keyboard("{Shift>}");
    await userEvent.click(destination, { modifiers: ["Shift"] });
    await userEvent.keyboard("{/Shift}");
    await expect.element(editor).not.toBeInTheDocument();

    await userEvent.keyboard(copyGesture());
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("Ada\nGrace"));
  } finally {
    restoreClipboard();
  }
});

test("rolls back Shift pointer range activation when the edit commit is invalid", async () => {
  const { grid, screen } = await renderEditableTable();
  await userEvent.keyboard("{ArrowRight}");
  const originCell = screen.getByRole("gridcell", { name: "4", exact: true });
  const originCellId = originCell.element().id;
  const destination = screen.getByRole("gridcell", { name: "8", exact: true });
  await userEvent.keyboard("{F2}");
  const editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await userEvent.clear(editor);
  await userEvent.keyboard("1e{Shift>}");
  await userEvent.click(destination, { modifiers: ["Shift"] });
  await userEvent.keyboard("{/Shift}");

  await expect.element(editor).toHaveFocus();
  await expect.element(editor).toHaveAttribute("aria-invalid", "true");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(originCellId);
  await expect.element(originCell).toHaveAttribute("aria-selected", "true");
  await expect.element(destination).not.toHaveAttribute("aria-selected");
});

test("keeps Shift interactive cell descendants behind the outside commit gate", async () => {
  const pointerUpAction = vi.fn();
  const clickAction = vi.fn();
  const interactiveColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      isEditable: true,
      pinned: "start",
    },
    {
      columnId: "COL_ID_SCORE",
      field: "score",
      headerName: "Score",
      valueType: "number",
      isEditable: true,
      validate: ({ value }) => (value <= 10 ? undefined : "Score must be at most 10."),
    },
    {
      columnId: "COL_ID_NOTE",
      field: "note",
      headerName: "Note",
      valueType: "text",
      isEditable: true,
      pinned: "end",
      cellRenderer: ({ value }) => (
        <button type="button" onPointerUp={pointerUpAction} onClick={clickAction}>
          <span>{value}</span>
        </button>
      ),
    },
  ] satisfies BrunoTableColumns<Row>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_SHIFT_INTERACTIVE_COMMIT_GATE"
      columns={interactiveColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() => Promise.resolve()}
    />,
  );
  const grid = screen.getByRole("grid", {
    name: "Data for TABLE_ID_SHIFT_INTERACTIVE_COMMIT_GATE",
  });
  await userEvent.click(grid.getByRole("gridcell", { name: "4", exact: true }));
  await userEvent.keyboard("{F2}");
  const editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  const actionButton = grid.getByRole("button", { name: "last" });
  await userEvent.clear(editor);
  await userEvent.keyboard("1e{Shift>}");
  await userEvent.click(actionButton, { modifiers: ["Shift"] });
  await userEvent.keyboard("{/Shift}");

  expect(pointerUpAction).not.toHaveBeenCalled();
  expect(clickAction).not.toHaveBeenCalled();
  await expect.element(editor).toHaveFocus();
  await expect.element(editor).toHaveAttribute("aria-invalid", "true");

  actionButton
    .element()
    .dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 81 }),
    );
  actionButton
    .element()
    .dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 82 }),
    );
  actionButton
    .element()
    .dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 81 }),
    );
  actionButton
    .element()
    .dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 82 }),
    );
  actionButton
    .element()
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  actionButton
    .element()
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(pointerUpAction).not.toHaveBeenCalled();
  expect(clickAction).not.toHaveBeenCalled();

  const actionChild = actionButton.element().querySelector("span")!;
  actionChild.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 84 }),
  );
  actionButton
    .element()
    .dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 84 }),
    );
  actionButton
    .element()
    .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  expect(pointerUpAction).not.toHaveBeenCalled();
  expect(clickAction).not.toHaveBeenCalled();

  actionButton
    .element()
    .dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 80 }),
    );
  expect(pointerUpAction).toHaveBeenCalledTimes(1);

  actionButton
    .element()
    .dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 83 }),
    );
  actionButton
    .element()
    .dispatchEvent(
      new PointerEvent("pointercancel", { bubbles: true, cancelable: true, pointerId: 83 }),
    );
  actionButton
    .element()
    .dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 83 }),
    );
  expect(pointerUpAction).toHaveBeenCalledTimes(2);

  await userEvent.fill(editor, "5");
  pointerUpAction.mockClear();
  clickAction.mockClear();
  await userEvent.keyboard("{Shift>}");
  await userEvent.click(actionButton, { modifiers: ["Shift"] });
  await userEvent.keyboard("{/Shift}");

  expect(pointerUpAction).toHaveBeenCalledTimes(1);
  expect(clickAction).toHaveBeenCalledTimes(1);
  await expect.element(editor).not.toBeInTheDocument();
});

test.each([
  ["forward Enter", "{Enter}", "C score", false],
  ["backward Enter", "{Shift>}{Enter}{/Shift}", "A score", false],
  ["forward Tab", "{Tab}", "C", false],
  ["backward Tab", "{Shift>}{Tab}{/Shift}", "A note", false],
  ["forward Enter after same-identity return", "{Enter}", "C score", true],
] as const)(
  "moves from the detached edit insertion boundary with %s",
  async (_description, gesture, expectedCellName, reattach) => {
    type DetachedMovementRow = Readonly<{
      readonly id: string;
      readonly name: string;
      readonly score: number;
      readonly note: string;
      readonly visibility: string;
    }>;
    const movementRows = [
      { id: "a", name: "A", score: 1, note: "A note", visibility: "shown" },
      { id: "b", name: "B", score: 2, note: "B note", visibility: "shown" },
      { id: "c", name: "C", score: 3, note: "C note", visibility: "shown" },
    ] as const satisfies readonly DetachedMovementRow[];
    const movementColumns = [
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
        isEditable: true,
      },
      {
        columnId: "COL_ID_VISIBILITY",
        field: "visibility",
        headerName: "Visibility",
        valueType: "text",
        isEditable: false,
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
        isEditable: true,
        valueFormatter: ({ row }) => `${row.name} score`,
      },
      {
        columnId: "COL_ID_NOTE",
        field: "note",
        headerName: "Note",
        valueType: "text",
        isEditable: true,
      },
    ] satisfies BrunoTableColumns<DetachedMovementRow>;
    type HarnessHandle = Readonly<{ detach: () => void; reattach: () => void }>;
    const harnessRef = createRef<HarnessHandle>();
    const Harness = forwardRef<HarnessHandle>(function Harness(_props, ref) {
      const [detached, setDetached] = useState(false);
      useImperativeHandle(
        ref,
        () => ({ detach: () => setDetached(true), reattach: () => setDetached(false) }),
        [],
      );
      return (
        <BrunoTableClient
          tableId="TABLE_ID_DETACHED_MOVEMENT_ORIGIN"
          columns={movementColumns}
          initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
          initialFilters={[{ columnId: "COL_ID_VISIBILITY", type: "equals", filter: "shown" }]}
          clientSource={{
            rows: movementRows.map((row) =>
              row.id === "b" && detached ? { ...row, visibility: "hidden" } : row,
            ),
            totalRows: movementRows.length,
            version: detached ? 2 : 1,
            status: "ready",
          }}
          getRowId={(row) => row.id}
          editable
          getRowVersion={() => 1n}
          onSaveEdits={() => Promise.resolve()}
        />
      );
    });
    const screen = await render(<Harness ref={harnessRef} />);
    const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_DETACHED_MOVEMENT_ORIGIN" });
    await userEvent.click(screen.getByRole("gridcell", { name: "B score", exact: true }));
    await userEvent.keyboard("{F2}");
    const editor = screen.getByRole("spinbutton", { name: "Edit Score" });
    flushSync(() => harnessRef.current?.detach());
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Row no longer matches current filters");
    if (reattach) {
      flushSync(() => harnessRef.current?.reattach());
      await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
      await expect.element(editor).toHaveFocus();
    }

    await userEvent.keyboard(gesture);

    await expect.element(editor).not.toBeInTheDocument();
    const expected = screen.getByRole("gridcell", { name: expectedCellName, exact: true });
    expect(grid.element().getAttribute("aria-activedescendant")).toBe(expected.element().id);
  },
);

test("traverses pinned logical order, uses the one-axis range exception, and exits at terminal Tab", async () => {
  const { grid, screen } = await renderEditableTable();
  await userEvent.keyboard("{F2}");
  await userEvent.keyboard("{Tab}");
  const scoreCell = screen.getByRole("gridcell", { name: "4", exact: true });
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(scoreCell.element().id);

  await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("textbox", { name: "Edit Name" })).not.toBeInTheDocument();
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(scoreCell.element().id);
  await userEvent.keyboard("{Enter}");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("gridcell", { name: "Ada", exact: true }).element().id,
  );
  await userEvent.keyboard("{F2}");
  await userEvent.keyboard("{Tab}");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(scoreCell.element().id);

  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("gridcell", { name: "last", exact: true }));
  await userEvent.keyboard("{F2}{Tab}");
  await expect.element(screen.getByRole("button", { name: "After grid summary" })).toHaveFocus();
  await vi.waitFor(() => expect(grid.element().tabIndex).toBe(0));
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await expect.element(grid).toHaveFocus();
});

test("traverses editable cells from Navigation Mode and yields natively only at both terminals", async () => {
  const { grid, screen } = await renderEditableTable();

  await userEvent.keyboard("{Tab}");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("gridcell", { name: "4", exact: true }).element().id,
  );
  await expect.element(grid).toHaveFocus();
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("gridcell", { name: "Ada", exact: true }).element().id,
  );

  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await expect.element(screen.getByRole("button", { name: "Sort rows, 1 active" })).toHaveFocus();

  await userEvent.click(screen.getByRole("gridcell", { name: "last", exact: true }));
  await userEvent.keyboard("{Tab}");
  await expect.element(screen.getByRole("button", { name: "After grid summary" })).toHaveFocus();
});

test("supports reverse commit movement and exits backward at the first eligible cell", async () => {
  const { grid, screen } = await renderEditableTable();
  await userEvent.keyboard("{ArrowDown}{ArrowRight}{F2}{Shift>}{Enter}{/Shift}");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("gridcell", { name: "4", exact: true }).element().id,
  );
  await userEvent.click(screen.getByRole("gridcell", { name: "Ada", exact: true }));
  await userEvent.keyboard("{F2}{Shift>}{Tab}{/Shift}");
  await expect.element(screen.getByRole("button", { name: "Sort rows, 1 active" })).toHaveFocus();
});

test("reveals an off-screen editable destination while skipping ineligible cells", async () => {
  type WideRow = Readonly<{ readonly id: string } & Record<string, string>>;
  const wideColumns: BrunoTableColumns<WideRow> = [
    {
      columnId: "COL_ID_START",
      field: "start",
      headerName: "Start",
      valueType: "text",
      isEditable: true,
      pinned: "start",
      width: 80,
    },
    ...Array.from({ length: 20 }, (_, index) => ({
      columnId: `COL_ID_FILLER_${String(index)}` as BrunoTableColumnId,
      field: `filler${String(index)}`,
      headerName: `Filler ${String(index)}`,
      valueType: "text" as const,
      isEditable: false as const,
    })),
    {
      columnId: "COL_ID_DESTINATION",
      field: "destination",
      headerName: "Destination",
      valueType: "text",
      isEditable: true as const,
    },
  ];
  const wideRow: WideRow = Object.freeze({
    id: "wide",
    start: "begin",
    destination: "revealed",
    ...Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`filler${String(index)}`, "-"]),
    ),
  });
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_CELL_EDIT_VIRTUAL"
      columns={wideColumns}
      initialOrderBy={[{ columnId: "COL_ID_START", direction: "asc" }]}
      clientSource={{ rows: [wideRow], totalRows: 1, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={() => 1n}
      onSaveEdits={() => Promise.resolve()}
    />,
  );
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_CELL_EDIT_VIRTUAL" });
  grid.element().focus();
  await userEvent.keyboard("{F2}{Tab}");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("gridcell", { name: "revealed", exact: true }).element().id,
  );
  expect(grid.element().scrollLeft).toBeGreaterThan(0);
});

test("reveals an exact far predicate destination in both directions before native terminal Tab", async () => {
  type TallRow = Readonly<{
    readonly id: string;
    readonly start: string;
    readonly destination: string;
    readonly filler: string;
    readonly ordinal: number;
  }>;
  const predicateEvaluations = vi.fn();
  const lastOrdinal = 4_999;
  const tallRows: readonly TallRow[] = Array.from(
    { length: lastOrdinal + 1 },
    (_unused, ordinal) => ({
      id: `row-${String(ordinal)}`,
      start: ordinal === 0 ? "begin" : `start-${String(ordinal)}`,
      destination: ordinal === lastOrdinal ? "far destination" : `destination-${String(ordinal)}`,
      filler: "-",
      ordinal,
    }),
  );
  const tallColumns = [
    {
      columnId: "COL_ID_START",
      field: "start",
      headerName: "Start",
      valueType: "text",
      isEditable: ({ row }: { readonly row: TallRow }) => {
        predicateEvaluations();
        return row.ordinal === 0;
      },
    },
    ...Array.from({ length: 148 }, (_unused, index) => ({
      columnId: `COL_ID_PREDICATE_FILLER_${String(index)}` as BrunoTableColumnId,
      field: "filler" as const,
      headerName: `Predicate filler ${String(index)}`,
      valueType: "text" as const,
      isEditable: () => {
        predicateEvaluations();
        return false;
      },
    })),
    {
      columnId: "COL_ID_DESTINATION",
      field: "destination",
      headerName: "Destination",
      valueType: "text",
      isEditable: ({ row }: { readonly row: TallRow }) => {
        predicateEvaluations();
        return row.ordinal === lastOrdinal;
      },
    },
    {
      columnId: "COL_ID_ORDINAL",
      field: "ordinal",
      headerName: "Ordinal",
      valueType: "number",
    },
  ] satisfies BrunoTableColumns<TallRow>;
  const screen = await render(
    <>
      <BrunoTableClient
        tableId="TABLE_ID_CELL_EDIT_TALL"
        columns={tallColumns}
        initialOrderBy={[{ columnId: "COL_ID_ORDINAL", direction: "asc" }]}
        clientSource={{
          rows: tallRows,
          totalRows: tallRows.length,
          version: 1,
          status: "ready",
        }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={() => 1n}
        onSaveEdits={() => Promise.resolve()}
      />
      <details>
        <summary role="button">After tall grid</summary>
      </details>
    </>,
  );
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_CELL_EDIT_TALL" });
  grid.element().focus();

  expect(predicateEvaluations.mock.calls.length).toBeLessThan(tallRows.length * 150);
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  const pendingRangeActive = grid.element().getAttribute("aria-activedescendant");
  await userEvent.keyboard("{Enter}{Shift>}{Enter}{/Shift}");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(pendingRangeActive);
  expect(screen.getByRole("textbox").all()).toHaveLength(0);
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("gridcell", { name: "begin", exact: true }));
  await userEvent.keyboard("{Enter}{Shift>}{Enter}{/Shift}");
  expect(screen.getByRole("textbox").all()).toHaveLength(0);
  await userEvent.keyboard("{F2}");
  const pendingEditor = screen.getByRole("textbox", { name: "Edit Start" });
  await userEvent.fill(pendingEditor, "Pending candidate");
  await userEvent.keyboard("{Enter}{Shift>}{Enter}{/Shift}{Tab}");
  await expect.element(pendingEditor).toHaveFocus();
  await expect.element(pendingEditor).toHaveValue("Pending candidate");
  await vi.waitFor(
    () =>
      expect(predicateEvaluations.mock.calls.length).toBeGreaterThanOrEqual(tallRows.length * 150),
    { timeout: 5_000 },
  );
  await userEvent.keyboard("{Tab}");
  const destination = screen.getByRole("gridcell", { name: "far destination", exact: true });
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(destination.element().id);
  expect(grid.element().scrollTop).toBeGreaterThan(0);

  await userEvent.keyboard("{F2}{Shift>}{Tab}{/Shift}");
  const start = screen.getByRole("gridcell", { name: "Pending candidate", exact: true });
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(start.element().id);
  await userEvent.keyboard("{F2}{Tab}");
  await expect
    .element(screen.getByRole("gridcell", { name: "far destination", exact: true }))
    .toBeInTheDocument();
  await userEvent.keyboard("{F2}");
  await expect.element(screen.getByRole("textbox", { name: "Edit Destination" })).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  await expect.element(screen.getByRole("button", { name: "After tall grid" })).toHaveFocus();
});

test("reconciles predicate traversal from a live row replacement", async () => {
  type LiveRow = Readonly<{
    readonly id: string;
    readonly value: string;
    readonly ordinal: number;
    readonly editable: boolean;
  }>;
  const liveColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "value",
      headerName: "Value",
      valueType: "text",
      isEditable: ({ row }: { readonly row: LiveRow }) => row.ordinal === 0 || row.editable,
    },
    {
      columnId: "COL_ID_ORDINAL",
      field: "ordinal",
      headerName: "Ordinal",
      valueType: "number",
    },
  ] satisfies BrunoTableColumns<LiveRow>;
  const renderTable = (liveRows: readonly LiveRow[], version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_CELL_EDIT_LIVE"
      columns={liveColumns}
      initialOrderBy={[{ columnId: "COL_ID_ORDINAL", direction: "asc" }]}
      clientSource={{
        rows: liveRows,
        totalRows: liveRows.length,
        version,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={() => 1n}
      onSaveEdits={() => Promise.resolve()}
    />
  );
  const initialRows: readonly LiveRow[] = [
    { id: "first", value: "first value", ordinal: 0, editable: false },
    { id: "second", value: "second value", ordinal: 1, editable: false },
  ];
  const screen = await render(renderTable(initialRows, 1));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_CELL_EDIT_LIVE" });
  grid.element().focus();
  await screen.rerender(renderTable([initialRows[0]!, { ...initialRows[1]!, editable: true }], 2));

  await userEvent.keyboard("{F2}{Tab}");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("gridcell", { name: "second value", exact: true }).element().id,
  );
});

test("keeps one Row Identity edit session through sort, filter, deletion, and return", async () => {
  type LiveEditRow = Readonly<{
    readonly id: string;
    readonly value: string;
    readonly ordinal: number;
    readonly status: string;
    readonly revision: bigint;
  }>;
  const createLiveEditColumns = () =>
    [
      {
        columnId: "COL_ID_VALUE",
        field: "value",
        headerName: "Value",
        valueType: "text",
        isEditable: true,
        validate: ({ value }: { readonly value: string }) =>
          value === "Candidate survives" ? "Candidate remains invalid." : undefined,
      },
      {
        columnId: "COL_ID_ORDINAL",
        field: "ordinal",
        headerName: "Ordinal",
        valueType: "number",
      },
      {
        columnId: "COL_ID_STATUS",
        field: "status",
        headerName: "Status",
        valueType: "text",
        enableFilter: true,
      },
    ] satisfies BrunoTableColumns<LiveEditRow>;
  const onSaveEdits = vi.fn(() => Promise.resolve());
  const renderTable = (liveRows: readonly LiveEditRow[], version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_CELL_EDIT_IDENTITY"
      columns={createLiveEditColumns()}
      initialOrderBy={[{ columnId: "COL_ID_ORDINAL", direction: "asc" }]}
      initialFilters={[{ columnId: "COL_ID_STATUS", type: "equals", filter: "keep" }]}
      clientSource={{ rows: liveRows, totalRows: liveRows.length, version, status: "ready" }}
      getRowId={(row) => row.id}
      rowSelection
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const target: LiveEditRow = {
    id: "target",
    value: "Target",
    ordinal: 0,
    status: "keep",
    revision: 1n,
  };
  const peer: LiveEditRow = {
    id: "peer",
    value: "Peer",
    ordinal: 1,
    status: "keep",
    revision: 1n,
  };
  const screen = await render(renderTable([target, peer], 1));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_CELL_EDIT_IDENTITY" });
  const selectionColumnId = screen
    .getByRole("checkbox", { name: "Select all rows", exact: true })
    .element()
    .closest<HTMLElement>('[role="columnheader"]')?.dataset["brunoColumnId"];
  grid.element().focus();
  await userEvent.keyboard("{F2}");
  let editor = screen.getByRole("textbox", { name: "Edit Value" });
  await userEvent.fill(editor, "Candidate survives");
  await userEvent.keyboard("{Enter}");
  await expect.element(editor).toHaveAttribute("aria-invalid", "true");
  await expect.element(editor).toHaveFocus();
  const activeCellId = editor.element().closest<HTMLElement>('[role="gridcell"]')?.id;
  expect(activeCellId).toBeTruthy();
  expect(
    [...document.querySelectorAll<HTMLElement>("[id]")].filter(
      (candidate) => candidate.id === activeCellId,
    ),
  ).toHaveLength(1);
  expect(
    document.getElementById(activeCellId ?? "")?.closest("[data-bruno-edit-owned-row]"),
  ).not.toBeNull();
  expect(
    [
      ...grid
        .element()
        .querySelectorAll<HTMLElement>('[role="gridcell"][data-bruno-row-id="target"]'),
    ].filter((cell) => cell.closest("[data-bruno-edit-owned-row]") === null),
  ).toHaveLength(0);
  const anchorTop = editor.element().getBoundingClientRect().top;

  await screen.rerender(renderTable([peer, { ...target, ordinal: 2, revision: 2n }], 2));
  editor = screen.getByRole("textbox", { name: "Edit Value" });
  await expect.element(editor).toHaveValue("Candidate survives");
  expect(Math.abs(editor.element().getBoundingClientRect().top - anchorTop)).toBeLessThanOrEqual(1);
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(
    editor.element().closest<HTMLElement>('[role="gridcell"]')?.id,
  );

  await screen.rerender(
    renderTable([peer, { ...target, ordinal: 2, status: "hidden", revision: 3n }], 3),
  );
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Row no longer matches current filters");
  await expect.element(screen.getByRole("status")).toBeVisible();
  await expect.element(screen.getByRole("gridcell", { name: "hidden", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("textbox", { name: "Edit Value" }))
    .toHaveValue("Candidate survives");
  const detachedSemanticOwner = [...document.querySelectorAll<HTMLElement>('[role="row"]')].find(
    (row) =>
      row
        .getAttribute("aria-owns")
        ?.split(" ")
        .includes(activeCellId ?? "") === true,
  );
  expect(detachedSemanticOwner?.getAttribute("aria-rowindex")).toBeNull();
  expect(
    detachedSemanticOwner
      ?.getAttribute("aria-owns")
      ?.split(" ")
      .some(
        (ownedId) =>
          document.getElementById(ownedId)?.dataset["brunoColumnId"] === selectionColumnId,
      ),
  ).toBe(false);
  expect(
    screen
      .getByRole("checkbox")
      .all()
      .filter((checkbox) => checkbox.element().closest("[data-bruno-edit-owned-row]") !== null),
  ).toHaveLength(0);

  await screen.rerender(renderTable([peer], 4));
  const tombstoneAlert = screen
    .getByRole("alert")
    .all()
    .find((alert) => alert.element().textContent?.includes("removed from the server") === true);
  expect(tombstoneAlert).toBeDefined();
  expect(
    screen
      .getByRole("alert")
      .all()
      .filter((alert) => alert.element().textContent?.includes("removed from the server") === true),
  ).toHaveLength(1);
  await expect
    .element(tombstoneAlert!)
    .toHaveTextContent("This row was removed from the server. Changes cannot be saved.");
  await expect
    .element(screen.getByRole("textbox", { name: "Edit Value" }))
    .toHaveAttribute("aria-invalid", "true");
  const tombstoneEditor = screen.getByRole("textbox", { name: "Edit Value" }).element();
  const validationDescriptionId = tombstoneEditor.getAttribute("aria-describedby");
  expect(validationDescriptionId).toBeTruthy();
  expect(document.getElementById(validationDescriptionId ?? "")?.textContent).toContain(
    "Candidate remains invalid.",
  );
  await expect.element(screen.getByRole("button", { name: "Cancel editing" })).toBeVisible();
  expect(
    screen
      .getByRole("checkbox")
      .all()
      .filter((checkbox) => checkbox.element().closest("[data-bruno-edit-owned-row]") !== null),
  ).toHaveLength(0);
  const tombstoneOwner = [...document.querySelectorAll<HTMLElement>('[role="row"]')].find((row) =>
    row
      .getAttribute("aria-owns")
      ?.split(" ")
      .includes(activeCellId ?? ""),
  );
  expect(
    tombstoneOwner
      ?.getAttribute("aria-owns")
      ?.split(" ")
      .some(
        (ownedId) =>
          document.getElementById(ownedId)?.dataset["brunoColumnId"] === selectionColumnId,
      ),
  ).toBe(false);
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("textbox", { name: "Edit Value" })).toHaveFocus();
  expect(onSaveEdits).not.toHaveBeenCalled();

  await screen.rerender(renderTable([peer, { ...target, ordinal: 2, revision: 5n }], 5));
  await expect
    .element(screen.getByRole("textbox", { name: "Edit Value" }))
    .toHaveValue("Candidate survives");
  await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("textbox", { name: "Edit Value" }))
    .toHaveAttribute("aria-invalid", "true");
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Candidate remains invalid.");
  await expect
    .element(screen.getByRole("checkbox", { name: "Select row 2", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("textbox", { name: "Edit Value" })).not.toBeInTheDocument();
  await vi.waitFor(() => {
    const ordinaryCells = [
      ...grid
        .element()
        .querySelectorAll<HTMLElement>('[role="gridcell"][data-bruno-row-id="target"]'),
    ].filter((cell) => cell.closest("[data-bruno-edit-owned-row]") === null);
    expect(ordinaryCells.length).toBeGreaterThan(0);
    expect(new Set(ordinaryCells.map((cell) => cell.id)).size).toBe(ordinaryCells.length);
  });

  grid.element().focus();
  await userEvent.keyboard("{F2}");
  await screen.rerender(
    renderTable([peer, { ...target, ordinal: 2, status: "hidden", revision: 6n }], 6),
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
  await expect.element(screen.getByRole("textbox", { name: "Edit Value" })).not.toBeInTheDocument();
  await expect.element(grid).toHaveFocus();

  await screen.rerender(renderTable([peer, { ...target, ordinal: 2, revision: 7n }], 7));
  await userEvent.click(screen.getByRole("gridcell", { name: "Target", exact: true }));
  await userEvent.keyboard("{F2}");
  await screen.rerender(renderTable([peer], 8));
  expect(
    screen
      .getByRole("alert")
      .all()
      .filter((alert) => alert.element().textContent?.includes("removed from the server") === true),
  ).toHaveLength(1);
  await expect
    .element(screen.getByRole("textbox", { name: "Edit Value" }))
    .not.toHaveAttribute("aria-invalid", "true");
  const cancel = screen.getByRole("button", { name: "Cancel editing" });
  await expect.element(screen.getByRole("textbox", { name: "Edit Value" })).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  await expect.element(cancel).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("textbox", { name: "Edit Value" })).not.toBeInTheDocument();
  await expect.element(grid).toHaveFocus();
});

test("coalesces a far virtualized live sort move while preserving the edit anchor", async () => {
  type FarRow = Readonly<{
    readonly id: string;
    readonly value: string;
    readonly ordinal: number;
  }>;
  const farColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "value",
      headerName: "Value",
      valueType: "text",
      isEditable: true,
    },
    {
      columnId: "COL_ID_ORDINAL",
      field: "ordinal",
      headerName: "Ordinal",
      valueType: "number",
    },
  ] satisfies BrunoTableColumns<FarRow>;
  const target: FarRow = { id: "target", value: "Far target", ordinal: 0 };
  const peers: readonly FarRow[] = Array.from({ length: 120_000 }, (_unused, index) => ({
    id: `peer-${String(index)}`,
    value: `Peer ${String(index)}`,
    ordinal: index + 1,
  }));
  const table = (targetRow: FarRow, version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_CELL_EDIT_FAR_SORT"
      columns={farColumns}
      initialOrderBy={[{ columnId: "COL_ID_ORDINAL", direction: "asc" }]}
      clientSource={{
        rows: [targetRow, ...peers],
        totalRows: peers.length + 1,
        version,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={() => 1n}
      onSaveEdits={() => Promise.resolve()}
    />
  );
  type HarnessHandle = Readonly<{ publish: (targetRow: FarRow, version: number) => void }>;
  const harnessRef = createRef<HarnessHandle>();
  const Harness = forwardRef<HarnessHandle>(function Harness(_props, ref) {
    const [publication, setPublication] = useState({ targetRow: target, version: 1 });
    useImperativeHandle(
      ref,
      () => ({ publish: (targetRow, version) => setPublication({ targetRow, version }) }),
      [],
    );
    return table(publication.targetRow, publication.version);
  });
  const screen = await render(<Harness ref={harnessRef} />);
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_CELL_EDIT_FAR_SORT" });
  grid.element().focus();
  await userEvent.keyboard("{F2}");
  let editor = screen.getByRole("textbox", { name: "Edit Value" });
  await userEvent.fill(editor, "Far candidate");
  const anchorTop = editor.element().getBoundingClientRect().top;
  const anchorRect = editor.element().getBoundingClientRect();
  let correctiveScrollPublications = 0;
  grid.element().addEventListener("scroll", () => {
    if (grid.element().scrollTop !== 420) correctiveScrollPublications += 1;
  });
  grid.element().scrollTop = 420;
  grid.element().dispatchEvent(new Event("scroll"));
  const scrolledAnchorTop = anchorTop - grid.element().scrollTop;

  flushSync(() => harnessRef.current?.publish({ ...target, ordinal: 200_000 }, 2));
  flushSync(() => harnessRef.current?.publish({ ...target, ordinal: 110_000 }, 3));
  flushSync(() => harnessRef.current?.publish({ ...target, ordinal: 150_000 }, 4));
  await settleBrunoTableBrowserFrames();
  editor = screen.getByRole("textbox", { name: "Edit Value" });
  await expect.element(editor).toHaveValue("Far candidate");
  await expect.element(editor).toHaveFocus();
  expect(grid.element().scrollTop).toBeGreaterThan(0);
  expect(grid.element().scrollTop).toBeLessThanOrEqual(4_000_000);
  expect(
    Math.abs(editor.element().getBoundingClientRect().top - scrolledAnchorTop),
  ).toBeLessThanOrEqual(1);
  expect(
    document
      .elementFromPoint(anchorRect.left + anchorRect.width / 2, anchorTop + anchorRect.height / 2)
      ?.closest("[data-bruno-edit-owned-row]"),
  ).toBeNull();
  expect(correctiveScrollPublications).toBeLessThanOrEqual(1);

  flushSync(() => harnessRef.current?.publish({ ...target, ordinal: 0 }, 5));
  await settleBrunoTableBrowserFrames();
  editor = screen.getByRole("textbox", { name: "Edit Value" });
  await expect.element(editor).toHaveValue("Far candidate");
  expect(
    Math.abs(editor.element().getBoundingClientRect().top - scrolledAnchorTop),
  ).toBeLessThanOrEqual(1);
});

test("shares pinned, virtual, and selection geometry with the edit-owned row", async () => {
  type WideEditRow = Readonly<{ readonly id: string } & Record<string, string>>;
  const centerColumns = Array.from({ length: 147 }, (_unused, index) =>
    index === 100
      ? {
          columnId: `COL_ID_WIDE_${String(index)}` as BrunoTableColumnId,
          field: `wide${String(index)}`,
          headerName: `Wide ${String(index)}`,
          valueType: "text" as const,
          isEditable: true as const,
        }
      : {
          columnId: `COL_ID_WIDE_${String(index)}` as BrunoTableColumnId,
          field: `wide${String(index)}`,
          headerName: `Wide ${String(index)}`,
          valueType: "text" as const,
          isEditable: false as const,
        },
  );
  const wideColumns: BrunoTableColumns<WideEditRow> = [
    {
      columnId: "COL_ID_WIDE_START",
      field: "start",
      headerName: "Start",
      valueType: "text",
      isEditable: true,
      pinned: "start",
      width: 80,
    },
    {
      columnId: "COL_ID_WIDE_ORDER",
      field: "order",
      headerName: "Order",
      valueType: "text" as const,
      isEditable: false as const,
    },
    ...centerColumns,
    {
      columnId: "COL_ID_WIDE_END",
      field: "end",
      headerName: "End",
      valueType: "text" as const,
      isEditable: false as const,
      pinned: "end",
      width: 80,
    },
  ];
  const makeRow = (id: string, order: string): WideEditRow =>
    Object.freeze({
      id,
      order,
      start: `start-${id}`,
      end: `end-${id}`,
      ...Object.fromEntries(
        Array.from({ length: 147 }, (_unused, index) => [
          `wide${String(index)}`,
          `wide-${String(index)}-${id}`,
        ]),
      ),
    });
  const target = makeRow("target", "000");
  const peers = Array.from({ length: 80 }, (_unused, index) =>
    makeRow(`peer-${String(index)}`, String(index + 1).padStart(3, "0")),
  );
  const table = (targetRow: WideEditRow, version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_CELL_EDIT_WIDE_GEOMETRY"
      columns={wideColumns}
      initialOrderBy={[{ columnId: "COL_ID_WIDE_ORDER", direction: "asc" }]}
      clientSource={{
        rows: [targetRow, ...peers],
        totalRows: peers.length + 1,
        version,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={() => 1n}
      onSaveEdits={() => Promise.resolve()}
      rowSelection
    />
  );
  const screen = await render(table(target, 1));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_CELL_EDIT_WIDE_GEOMETRY" });
  grid.element().focus();
  await userEvent.keyboard("{Tab}{F2}");
  const editor = screen.getByRole("textbox", { name: "Edit Wide 100" });
  await userEvent.fill(editor, "wide candidate");
  await vi.waitFor(() => expect(grid.element().scrollLeft).toBeGreaterThan(0));
  const activeCell = editor.element().closest<HTMLElement>('[role="gridcell"]');
  expect(activeCell).not.toBeNull();
  const activeId = activeCell?.id ?? "";
  const retainedActiveIds = [...document.querySelectorAll<HTMLElement>("[id]")].filter(
    (candidate) => candidate.id === activeId,
  );
  expect(retainedActiveIds).toHaveLength(1);
  const activeHeader = screen.getByRole("columnheader", { name: /^Wide 100/u });
  expect(
    Math.abs(
      (activeCell?.getBoundingClientRect().left ?? 0) -
        activeHeader.element().getBoundingClientRect().left,
    ),
  ).toBeLessThanOrEqual(1);
  const startCell = screen.getByRole("gridcell", { name: "start-target", exact: true });
  const endCell = screen.getByRole("gridcell", { name: "end-target", exact: true });
  expect(
    Math.abs(
      startCell.element().getBoundingClientRect().left -
        screen
          .getByRole("columnheader", { name: /^Start/u })
          .element()
          .getBoundingClientRect().left,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      endCell.element().getBoundingClientRect().right -
        screen.getByRole("columnheader", { name: /^End/u }).element().getBoundingClientRect().right,
    ),
  ).toBeLessThanOrEqual(1);
  const selection = screen.getByRole("checkbox", { name: "Select row 1", exact: true });
  const headerSelection = screen.getByRole("checkbox", { name: "Select all rows", exact: true });
  expect(selection).toBeVisible();
  const anchorTop = editor.element().getBoundingClientRect().top;
  const initialEditorRect = editor.element().getBoundingClientRect();
  expect(
    document
      .elementFromPoint(initialEditorRect.left + initialEditorRect.width / 2, anchorTop + 2)
      ?.closest('[role="gridcell"]'),
  ).toBe(activeCell);

  grid.element().scrollTop = 18;
  grid.element().dispatchEvent(new Event("scroll"));
  await settleBrunoTableBrowserFrames();
  const stickyHeaderRect = activeHeader.element().getBoundingClientRect();
  expect(editor.element().getBoundingClientRect().top).toBeLessThan(stickyHeaderRect.bottom);
  expect(
    document
      .elementFromPoint(
        initialEditorRect.left + initialEditorRect.width / 2,
        stickyHeaderRect.bottom - 2,
      )
      ?.closest('[role="columnheader"]'),
  ).toBe(activeHeader.element());
  const headerSelectionRect = headerSelection.element().getBoundingClientRect();
  expect(
    document.elementFromPoint(
      headerSelectionRect.left + headerSelectionRect.width / 2,
      headerSelectionRect.top + headerSelectionRect.height / 2,
    ),
  ).toBe(headerSelection.element());
  grid.element().scrollTop = 0;
  grid.element().dispatchEvent(new Event("scroll"));
  await settleBrunoTableBrowserFrames();

  const startRect = startCell.element().getBoundingClientRect();
  let editorRect = editor.element().getBoundingClientRect();
  grid.element().scrollLeft += editorRect.left - startRect.right + editorRect.width / 2;
  grid.element().dispatchEvent(new Event("scroll"));
  await settleBrunoTableBrowserFrames();
  editorRect = editor.element().getBoundingClientRect();
  expect(editorRect.left).toBeLessThan(startRect.right);
  expect(editorRect.right).toBeGreaterThan(startRect.right);
  expect(
    document
      .elementFromPoint(startRect.right - 2, editorRect.top + editorRect.height / 2)
      ?.closest('[role="gridcell"]'),
  ).toBe(startCell.element());

  const selectionRect = selection.element().getBoundingClientRect();
  editorRect = editor.element().getBoundingClientRect();
  grid.element().scrollLeft +=
    editorRect.left - selectionRect.left + editorRect.width / 2 - selectionRect.width / 2;
  grid.element().dispatchEvent(new Event("scroll"));
  await settleBrunoTableBrowserFrames();
  const selectionAfterScroll = selection.element().getBoundingClientRect();
  const gridAfterSelectionScroll = grid.element().getBoundingClientRect();
  expect(selectionAfterScroll.left).toBeGreaterThanOrEqual(gridAfterSelectionScroll.left);
  expect(selectionAfterScroll.right).toBeLessThanOrEqual(gridAfterSelectionScroll.right);
  expect(
    document.elementFromPoint(
      selectionAfterScroll.left + selectionAfterScroll.width / 2,
      selectionAfterScroll.top + selectionAfterScroll.height / 2,
    ),
  ).toBe(selection.element());

  const endRect = endCell.element().getBoundingClientRect();
  editorRect = editor.element().getBoundingClientRect();
  grid.element().scrollLeft += editorRect.right - endRect.left - editorRect.width / 2;
  grid.element().dispatchEvent(new Event("scroll"));
  await settleBrunoTableBrowserFrames();
  editorRect = editor.element().getBoundingClientRect();
  expect(editorRect.left).toBeLessThan(endRect.left);
  expect(editorRect.right).toBeGreaterThan(endRect.left);
  expect(
    document
      .elementFromPoint(endRect.left + 2, editorRect.top + editorRect.height / 2)
      ?.closest('[role="gridcell"]'),
  ).toBe(endCell.element());

  grid.element().scrollLeft = 0;
  grid.element().dispatchEvent(new Event("scroll"));
  await settleBrunoTableBrowserFrames();
  await expect.element(editor).toHaveValue("wide candidate");
  await expect.element(editor).toHaveFocus();
  const visibleHeader = screen.getByRole("columnheader", { name: /^Wide 0/u });
  const visibleCell = screen.getByRole("gridcell", { name: "wide-0-target", exact: true });
  expect(
    Math.abs(
      visibleCell.element().getBoundingClientRect().left -
        visibleHeader.element().getBoundingClientRect().left,
    ),
  ).toBeLessThanOrEqual(1);
  expect(editor.element().getBoundingClientRect().left).toBeGreaterThan(
    grid.element().getBoundingClientRect().right,
  );
  const scrolledActiveIds = [...document.querySelectorAll<HTMLElement>("[id]")].filter(
    (candidate) => candidate.id === activeId,
  );
  expect(scrolledActiveIds).toHaveLength(1);
  const semanticOwners = [...document.querySelectorAll<HTMLElement>('[role="row"]')].filter(
    (row) => row.getAttribute("aria-owns")?.split(" ").includes(activeId) === true,
  );
  expect(semanticOwners).toHaveLength(1);
  expect(semanticOwners[0]?.getAttribute("aria-rowindex")).toBe("2");
  const ownedIds = semanticOwners[0]?.getAttribute("aria-owns")?.split(" ") ?? [];
  const ownedColumnIndexes = ownedIds.map((id) =>
    Number(document.getElementById(id)?.getAttribute("aria-colindex")),
  );
  expect(ownedColumnIndexes).toEqual([...ownedColumnIndexes].sort((left, right) => left - right));
  expect(ownedIds[0]).toBe(selection.element().closest<HTMLElement>('[role="gridcell"]')?.id);
  expect(ownedIds.indexOf(activeId)).toBeLessThan(ownedIds.indexOf(endCell.element().id));

  await screen.rerender(table({ ...target, order: "999" }, 2));
  await settleBrunoTableBrowserFrames();
  await expect.element(editor).toHaveValue("wide candidate");
  await expect.element(editor).toHaveFocus();
  expect(Math.abs(editor.element().getBoundingClientRect().top - anchorTop)).toBeLessThanOrEqual(1);
});

test("compiles exact nullable blank policies without treating zero as blank", async () => {
  type NullableRow = Readonly<{
    readonly id: string;
    readonly nullable: number | null;
    readonly optional: number | undefined;
    readonly ambiguous: number | null | undefined;
    readonly required: number;
  }>;
  const nullableColumns = [
    {
      columnId: "COL_ID_NULLABLE",
      field: "nullable",
      headerName: "Nullable",
      valueType: "number",
      isEditable: true,
      blankValue: null,
      cellRenderer: ({ value }) => (value === null ? "NULL" : String(value)),
    },
    {
      columnId: "COL_ID_OPTIONAL",
      field: "optional",
      headerName: "Optional",
      valueType: "number",
      isEditable: true,
      blankValue: undefined,
      cellRenderer: ({ value }) => (value === undefined ? "UNDEFINED" : String(value)),
    },
    {
      columnId: "COL_ID_AMBIGUOUS",
      field: "ambiguous",
      headerName: "Ambiguous",
      valueType: "number",
      isEditable: true,
      blankValue: null,
      cellRenderer: ({ value }) => (value === null ? "NULL" : String(value)),
    },
    {
      columnId: "COL_ID_REQUIRED",
      field: "required",
      headerName: "Required",
      valueType: "number",
      isEditable: true,
      cellRenderer: ({ value }) => `REQUIRED ${String(value)}`,
    },
  ] satisfies BrunoTableColumns<NullableRow>;
  const nullableRow: NullableRow = {
    id: "nullable",
    nullable: 7,
    optional: 8,
    ambiguous: 9,
    required: 0,
  };
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_CELL_EDIT_NULLABLE"
      columns={nullableColumns}
      initialOrderBy={[{ columnId: "COL_ID_REQUIRED", direction: "asc" }]}
      clientSource={{ rows: [nullableRow], totalRows: 1, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={() => 1n}
      onSaveEdits={() => Promise.resolve()}
    />,
  );

  for (const [sourceText, expectedText, expectedCount] of [
    ["7", "NULL", 1],
    ["8", "UNDEFINED", 1],
    ["9", "NULL", 2],
  ] as const) {
    await userEvent.click(screen.getByRole("gridcell", { name: sourceText, exact: true }));
    await userEvent.keyboard("{F2}");
    const editor = screen.getByRole("spinbutton");
    await userEvent.clear(editor);
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() =>
      expect(screen.getByRole("gridcell", { name: expectedText, exact: true }).all()).toHaveLength(
        expectedCount,
      ),
    );
  }

  await userEvent.click(screen.getByRole("gridcell", { name: "REQUIRED 0", exact: true }));
  await userEvent.keyboard("{F2}");
  const required = screen.getByRole("spinbutton", { name: "Edit Required" });
  await expect.element(required).toHaveValue(0);
  await userEvent.clear(required);
  await userEvent.keyboard("{Enter}");
  await expect.element(required).toHaveFocus();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Enter a value.");
  await userEvent.keyboard("{Escape}");

  let resolveWrite: (() => void) | undefined;
  const writes: string[] = [];
  const restoreClipboard = installClipboard(
    (text) =>
      new Promise<void>((resolve) => {
        writes.push(text);
        resolveWrite = resolve;
      }),
  );
  try {
    const row = screen.getByRole("row").nth(1);
    await userEvent.click(row.getByRole("gridcell").nth(0));
    await userEvent.keyboard(copyGesture());
    await vi.waitFor(() => expect(writes).toEqual([""]));
    resolveWrite?.();

    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await userEvent.keyboard(copyGesture());
    await vi.waitFor(() => expect(writes).toEqual(["", "\t"]));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(row.getByRole("gridcell").nth(0));
    await userEvent.keyboard("{F2}");
    await userEvent.fill(screen.getByRole("spinbutton", { name: "Edit Nullable" }), "11");
    await userEvent.keyboard("{Enter}");
    expect(writes).toEqual(["", "\t"]);
    resolveWrite?.();
  } finally {
    restoreClipboard();
  }
});

test("keeps nullable Boolean and Select blanks distinct from exact scalar options", async () => {
  type ChoiceRow = Readonly<{
    readonly id: string;
    readonly flag: boolean | null;
    readonly toggle: "N" | "Y";
    readonly nullableToggle: "N" | "Y" | null;
    readonly nullableChoice: "" | "ready" | null;
    readonly requiredChoice: "" | "ready";
  }>;
  const toggleValueType: BrunoTableValueType<"N" | "Y", "equality", "boolean"> = {
    codecId: "test/toggle",
    codecVersion: 1,
    filterFamily: "equality",
    editorFamily: "boolean",
    booleanEditorValues: ["N", "Y"],
    cellAlign: "center",
    editorLayout: "center",
    defaultWidth: 88,
    decodeRuntime: (input) =>
      input === "N" || input === "Y"
        ? { _tag: "Success", value: input }
        : { _tag: "Failure", message: "Expected N or Y." },
    equivalent: (left, right) => left === right,
    compare: (left, right) => (left === right ? 0 : left === "N" ? -1 : 1),
    formatCanonicalText: (value) => value,
    parseCanonicalText: (text) =>
      text === "N" || text === "Y"
        ? { _tag: "Success", value: text }
        : { _tag: "Failure", message: "Expected N or Y." },
    formatDisplay: (value) => value,
    encodePersisted: (value) => value,
    decodePersisted: (input) =>
      input === "N" || input === "Y"
        ? { _tag: "Success", value: input }
        : { _tag: "Failure", message: "Expected N or Y." },
  };
  const choiceColumns = [
    {
      columnId: "COL_ID_FLAG",
      field: "flag",
      headerName: "Flag",
      valueType: "boolean",
      isEditable: true,
      blankValue: null,
      cellRenderer: ({ value }: { readonly value: ChoiceRow["flag"] }) =>
        value === null ? "Flag blank" : value ? "Flag true" : "Flag false",
    },
    {
      columnId: "COL_ID_TOGGLE",
      field: "toggle",
      headerName: "Toggle",
      valueType: toggleValueType,
      isEditable: true,
      cellRenderer: ({ value }: { readonly value: ChoiceRow["toggle"] }) => `Toggle ${value}`,
    },
    {
      columnId: "COL_ID_NULLABLE_TOGGLE",
      field: "nullableToggle",
      headerName: "Nullable toggle",
      valueType: toggleValueType,
      isEditable: true,
      blankValue: null,
      cellRenderer: ({ value }: { readonly value: ChoiceRow["nullableToggle"] }) =>
        value === null ? "Toggle blank" : `Nullable toggle ${value}`,
    },
    BrunoTableSelectColumn({
      columnId: "COL_ID_NULLABLE_CHOICE",
      field: "nullableChoice",
      headerName: "Nullable choice",
      options: ["", "ready"],
      isEditable: true,
      blankValue: null,
      cellRenderer: ({ value }: { readonly value: ChoiceRow["nullableChoice"] }) =>
        value === null ? "Nullable blank" : value === "" ? "Nullable empty" : value,
    }),
    BrunoTableSelectColumn({
      columnId: "COL_ID_REQUIRED_CHOICE",
      field: "requiredChoice",
      headerName: "Required choice",
      options: ["", "ready"],
      isEditable: true,
      cellRenderer: ({ value }: { readonly value: ChoiceRow["requiredChoice"] }) =>
        value === "" ? "Required empty" : value,
    }),
  ] satisfies BrunoTableColumns<ChoiceRow>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_CELL_EDIT_CHOICES"
      columns={choiceColumns}
      initialOrderBy={[{ columnId: "COL_ID_FLAG", direction: "asc" }]}
      clientSource={{
        rows: [
          {
            id: "choice",
            flag: null,
            toggle: "N",
            nullableToggle: null,
            nullableChoice: null,
            requiredChoice: "ready",
          },
        ],
        totalRows: 1,
        version: 1,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={() => 1n}
      onSaveEdits={() => Promise.resolve()}
    />,
  );

  await userEvent.click(screen.getByRole("gridcell", { name: "Flag blank", exact: true }));
  await userEvent.keyboard("{F2}");
  const flagEditor = screen.getByRole("combobox", { name: "Edit Flag" });
  await expect.element(flagEditor).toHaveValue("blank");
  await userEvent.selectOptions(flagEditor, "scalar:0");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("gridcell", { name: "Flag false", exact: true }))
    .toBeVisible();

  await userEvent.click(screen.getByRole("gridcell", { name: "Toggle N", exact: true }));
  await userEvent.keyboard("{F2}");
  const toggleEditor = screen.getByRole("checkbox", { name: "Edit Toggle" });
  await expect.element(toggleEditor).not.toBeChecked();
  await userEvent.click(toggleEditor);
  await userEvent.click(screen.getByRole("gridcell", { name: "Toggle blank", exact: true }));
  await expect
    .element(screen.getByRole("gridcell", { name: "Toggle Y", exact: true }))
    .toBeVisible();

  await userEvent.click(screen.getByRole("gridcell", { name: "Toggle blank", exact: true }));
  await userEvent.keyboard("{F2}");
  const nullableToggleEditor = screen.getByRole("combobox", { name: "Edit Nullable toggle" });
  await expect.element(nullableToggleEditor).toHaveValue("blank");
  await userEvent.selectOptions(nullableToggleEditor, "scalar:0");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("gridcell", { name: "Nullable toggle N", exact: true }))
    .toBeVisible();

  await userEvent.click(screen.getByRole("gridcell", { name: "Nullable blank", exact: true }));
  await userEvent.keyboard("{F2}");
  const nullableEditor = screen.getByRole("combobox", { name: "Edit Nullable choice" });
  await expect.element(nullableEditor).toHaveValue("blank");
  await userEvent.selectOptions(nullableEditor, "scalar:0");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("gridcell", { name: "Nullable empty", exact: true }))
    .toBeVisible();

  await userEvent.click(screen.getByRole("gridcell", { name: "Nullable empty", exact: true }));
  await userEvent.keyboard("{F2}");
  const nullableAgain = screen.getByRole("combobox", { name: "Edit Nullable choice" });
  await expect.element(nullableAgain).toHaveValue("scalar:0");
  await userEvent.selectOptions(nullableAgain, "blank");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("gridcell", { name: "Nullable blank", exact: true }))
    .toBeVisible();

  await userEvent.click(screen.getByRole("gridcell", { name: "ready", exact: true }));
  await userEvent.keyboard("{F2}");
  const requiredEditor = screen.getByRole("combobox", { name: "Edit Required choice" });
  expect(requiredEditor.getByRole("option", { name: /Blank/u }).all()).toHaveLength(0);
  await userEvent.selectOptions(requiredEditor, "scalar:0");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("gridcell", { name: "Required empty", exact: true }))
    .toBeVisible();
});

test("cancels an active custom Boolean editor before its exact mapping can reverse", async () => {
  type ToggleRow = Readonly<{
    readonly id: string;
    readonly name: string;
    readonly toggle: "N" | "Y";
  }>;
  const decodeToggle = (input: unknown) =>
    input === "N" || input === "Y"
      ? ({ _tag: "Success", value: input } as const)
      : ({ _tag: "Failure", message: "Expected N or Y." } as const);
  const formatToggle = (value: "N" | "Y") => value;
  const parseToggle = (text: string) => decodeToggle(text);
  const createToggleValueType = (
    booleanEditorValues: readonly ["N" | "Y", "N" | "Y"],
  ): BrunoTableValueType<"N" | "Y", "equality", "boolean"> => ({
    codecId: "test/browser-toggle-authority",
    codecVersion: 1,
    filterFamily: "equality",
    editorFamily: "boolean",
    booleanEditorValues,
    cellAlign: "center",
    editorLayout: "center",
    defaultWidth: 88,
    decodeRuntime: decodeToggle,
    equivalent: Object.is,
    compare: () => 0,
    formatCanonicalText: formatToggle,
    parseCanonicalText: parseToggle,
    formatDisplay: formatToggle,
    encodePersisted: formatToggle,
    decodePersisted: decodeToggle,
  });
  type ToggleHandle = Readonly<{ reverse: () => void }>;
  const harnessRef = createRef<ToggleHandle>();
  const Harness = forwardRef<ToggleHandle>(function Harness(_props, ref) {
    const [reversed, setReversed] = useState(false);
    useImperativeHandle(ref, () => ({ reverse: () => setReversed(true) }), []);
    const toggleColumns = [
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
      },
      {
        columnId: "COL_ID_TOGGLE",
        field: "toggle",
        headerName: "Toggle",
        valueType: createToggleValueType(reversed ? ["Y", "N"] : ["N", "Y"]),
        isEditable: true,
      },
    ] as const satisfies BrunoTableColumns<ToggleRow>;
    return (
      <BrunoTableClient<ToggleRow, typeof toggleColumns, (row: ToggleRow) => bigint>
        tableId="TABLE_ID_BOOLEAN_AUTHORITY"
        columns={toggleColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{
          rows: [{ id: "toggle", name: "Toggle row", toggle: "N" }],
          totalRows: 1,
          version: 1,
          status: "ready",
        }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={() => 1n}
        onSaveEdits={() => Promise.resolve()}
      />
    );
  });
  const screen = await render(<Harness ref={harnessRef} />);
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BOOLEAN_AUTHORITY" });
  await userEvent.click(screen.getByRole("gridcell", { name: "N", exact: true }));
  await userEvent.keyboard("{F2}");
  const editor = screen.getByRole("checkbox", { name: "Edit Toggle" });
  await expect.element(editor).not.toBeChecked();

  flushSync(() => harnessRef.current?.reverse());

  await expect.element(editor).not.toBeInTheDocument();
  await expect.element(grid.getByRole("gridcell", { name: "N", exact: true })).toBeVisible();
});

test("contains a wrong-domain custom parser Success while preserving candidate focus", async () => {
  const throwingValueType: BrunoTableValueType<string> = {
    codecId: "test/browser-throwing-parser",
    codecVersion: 1,
    filterFamily: "text",
    editorFamily: "text",
    cellAlign: "start",
    editorLayout: "inline",
    defaultWidth: 140,
    decodeRuntime: (input) =>
      typeof input === "string"
        ? { _tag: "Success", value: input }
        : { _tag: "Failure", message: "Expected string." },
    equivalent: Object.is,
    compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
    formatCanonicalText: String,
    parseCanonicalText: () => ({ _tag: "Success", value: 1n }) as never,
    formatDisplay: String,
    encodePersisted: String,
    decodePersisted: (input) =>
      typeof input === "string"
        ? { _tag: "Success", value: input }
        : { _tag: "Failure", message: "Expected string." },
  };
  const parserColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "value",
      headerName: "Value",
      valueType: throwingValueType,
      isEditable: true,
    },
  ] satisfies BrunoTableColumns<Readonly<{ readonly id: string; readonly value: string }>>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_CELL_EDIT_THROWING_PARSER"
      columns={parserColumns}
      initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
      clientSource={{
        rows: [{ id: "parser", value: "before" }],
        totalRows: 1,
        version: 1,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={() => 1n}
      onSaveEdits={() => Promise.resolve()}
    />,
  );

  await userEvent.click(screen.getByRole("gridcell", { name: "before", exact: true }));
  await userEvent.keyboard("{F2}");
  const editor = screen.getByRole("textbox", { name: "Edit Value" });
  await userEvent.fill(editor, "candidate survives");
  await userEvent.keyboard("{Enter}");
  await expect.element(editor).toHaveValue("candidate survives");
  await expect.element(editor).toHaveFocus();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Expected string.");
  await userEvent.keyboard("{Escape}");
});

test("copies one immutable source-plus-draft projection for active cells and ranges", async () => {
  let resolveWrite: (() => void) | undefined;
  const writes: string[] = [];
  const restoreClipboard = installClipboard(
    (text) =>
      new Promise<void>((resolve) => {
        writes.push(text);
        resolveWrite = resolve;
      }),
  );
  try {
    const { grid, screen } = await renderEditableTable();
    await userEvent.keyboard("{F2}");
    await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Draft Ada");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("gridcell", { name: "Draft Ada", exact: true }));
    await userEvent.keyboard(copyGesture());
    await vi.waitFor(() => expect(writes).toEqual(["Draft Ada"]));
    resolveWrite?.();

    grid.element().focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await userEvent.keyboard(copyGesture());
    await vi.waitFor(() => expect(writes).toEqual(["Draft Ada", "Draft Ada\t4"]));

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("gridcell", { name: "Draft Ada", exact: true }));
    await userEvent.keyboard("{F2}");
    await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Later draft");
    await userEvent.keyboard("{Enter}");
    expect(writes).toEqual(["Draft Ada", "Draft Ada\t4"]);
    resolveWrite?.();
  } finally {
    restoreClipboard();
  }
});

test("ordinary Enter moves exactly one row even when that destination is not editable", async () => {
  type EligibilityRow = Readonly<{ readonly id: string; readonly score: number }>;
  const eligibilityRows: readonly EligibilityRow[] = [
    { id: "first", score: 1 },
    { id: "ineligible", score: 2 },
    { id: "last", score: 3 },
  ];
  const eligibilityColumns = [
    {
      columnId: "COL_ID_SCORE",
      field: "score",
      headerName: "Score",
      valueType: "number",
      isEditable: ({ row }: { readonly row: EligibilityRow }) => row.id !== "ineligible",
    },
  ] satisfies BrunoTableColumns<EligibilityRow>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_CELL_EDIT_ELIGIBILITY"
      columns={eligibilityColumns}
      initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
      clientSource={{
        rows: eligibilityRows,
        totalRows: eligibilityRows.length,
        version: 1,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={() => 1n}
      onSaveEdits={() => Promise.resolve()}
    />,
  );
  const grid = screen.getByRole("grid", {
    name: "Data for TABLE_ID_CELL_EDIT_ELIGIBILITY",
  });
  grid.element().focus();
  await userEvent.keyboard("{F2}{Enter}");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("gridcell", { name: "2", exact: true }).element().id,
  );
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("spinbutton", { name: "Edit Score" }))
    .not.toBeInTheDocument();
  await userEvent.keyboard("{ArrowDown}{F2}{Shift>}{Enter}{/Shift}");
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("gridcell", { name: "2", exact: true }).element().id,
  );
});

test("rejects widened editable columns without a potential edit policy at runtime", async () => {
  const widenedColumns: BrunoTableColumns<Row> = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      isEditable: false,
    },
  ];

  await expect(
    render(
      <BrunoTableClient
        tableId="TABLE_ID_CELL_EDIT_WIDENED"
        columns={widenedColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={() => Promise.resolve()}
      />,
    ),
  ).rejects.toThrow(
    "BrunoTable editable Client Tables require at least one potentially editable column.",
  );
});
