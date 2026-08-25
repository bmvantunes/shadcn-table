import { afterEach, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { BrunoTableClient } from "./index";
import type { BrunoTableColumnId, BrunoTableColumns } from "./public-types";

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

async function renderEditableTable() {
  const onSaveEdits = vi.fn(() => Promise.resolve());
  const screen = await render(
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
    </>,
  );
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_CELL_EDIT" });
  grid.element().focus();
  return { grid, onSaveEdits, screen };
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

test("preserves incomplete Number replace seeds until the native control can own them", async () => {
  const { grid, screen } = await renderEditableTable();
  await userEvent.keyboard("{ArrowRight}-");
  let editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await expect.element(editor).toHaveAttribute("aria-valuetext", "-");
  await expect.element(editor).toHaveAttribute("placeholder", "-");
  await userEvent.keyboard("5");
  await expect.element(editor).toHaveValue(-5);
  await userEvent.keyboard("{Escape}");

  grid.element().focus();
  await userEvent.keyboard(".");
  editor = screen.getByRole("spinbutton", { name: "Edit Score" });
  await expect.element(editor).toHaveAttribute("aria-valuetext", ".");
  await userEvent.keyboard("5");
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
});

test("supports reverse commit movement and exits backward at the first eligible cell", async () => {
  const { screen } = await renderEditableTable();
  await userEvent.keyboard("{ArrowDown}{ArrowRight}{F2}{Shift>}{Enter}{/Shift}");
  await expect.element(screen.getByRole("textbox", { name: "Edit Score" })).not.toBeInTheDocument();
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
    },
    ...Array.from({ length: 20 }, (_, index) => ({
      columnId: `COL_ID_FILLER_${String(index)}` as BrunoTableColumnId,
      field: `filler${String(index)}`,
      headerName: `Filler ${String(index)}`,
      valueType: "text" as const,
      isEditable: false,
    })),
    {
      columnId: "COL_ID_DESTINATION",
      field: "destination",
      headerName: "Destination",
      valueType: "text",
      isEditable: true,
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
