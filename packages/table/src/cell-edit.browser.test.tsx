import { detectPlatform } from "@tanstack/react-hotkeys";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { createRef, forwardRef, useImperativeHandle, useState } from "react";
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
      const [layout, setLayout] = useState({ rowSelection: false, width: 760 });
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

    flushSync(() => harnessRef.current?.updateLayout(170, true));
    flushSync(() => harnessRef.current?.updateLayout(760, false));
    flushSync(() => harnessRef.current?.updateLayout(170, true));
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

    flushSync(() => harnessRef.current?.updateLayout(760, false));
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
    readonly ordinal: number;
  }>;
  const tallRows: readonly TallRow[] = Array.from({ length: 300 }, (_unused, ordinal) => ({
    id: `row-${String(ordinal)}`,
    start: ordinal === 0 ? "begin" : `start-${String(ordinal)}`,
    destination: ordinal === 299 ? "far destination" : `destination-${String(ordinal)}`,
    ordinal,
  }));
  const tallColumns = [
    {
      columnId: "COL_ID_START",
      field: "start",
      headerName: "Start",
      valueType: "text",
      isEditable: ({ row }: { readonly row: TallRow }) => row.ordinal === 0,
    },
    {
      columnId: "COL_ID_DESTINATION",
      field: "destination",
      headerName: "Destination",
      valueType: "text",
      isEditable: ({ row }: { readonly row: TallRow }) => row.ordinal === 299,
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

  await userEvent.keyboard("{F2}{Tab}");
  const destination = screen.getByRole("gridcell", { name: "far destination", exact: true });
  expect(grid.element().getAttribute("aria-activedescendant")).toBe(destination.element().id);
  expect(grid.element().scrollTop).toBeGreaterThan(0);

  await userEvent.keyboard("{F2}{Shift>}{Tab}{/Shift}");
  const start = screen.getByRole("gridcell", { name: "begin", exact: true });
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
  const liveEditColumns = [
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
      columns={liveEditColumns}
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
  grid.element().focus();
  await userEvent.keyboard("{F2}");
  let editor = screen.getByRole("textbox", { name: "Edit Value" });
  await userEvent.fill(editor, "Candidate survives");
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

  await screen.rerender(renderTable([peer], 4));
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("This row was removed from the server. Changes cannot be saved.");
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
  const selectionColumnId = screen
    .getByRole("checkbox", { name: "Select all rows", exact: true })
    .element()
    .closest<HTMLElement>('[role="columnheader"]')?.dataset["brunoColumnId"];
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
    .element(screen.getByRole("checkbox", { name: "Select row 2", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("textbox", { name: "Edit Value" })).not.toBeInTheDocument();

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
  const cancel = screen.getByRole("button", { name: "Cancel editing" });
  cancel.element().focus();
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
  const peers: readonly FarRow[] = Array.from({ length: 400 }, (_unused, index) => ({
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

  flushSync(() => harnessRef.current?.publish({ ...target, ordinal: 1_000 }, 2));
  flushSync(() => harnessRef.current?.publish({ ...target, ordinal: 350 }, 3));
  flushSync(() => harnessRef.current?.publish({ ...target, ordinal: 900 }, 4));
  await settleBrunoTableBrowserFrames();
  editor = screen.getByRole("textbox", { name: "Edit Value" });
  await expect.element(editor).toHaveValue("Far candidate");
  await expect.element(editor).toHaveFocus();
  expect(grid.element().scrollTop).toBeGreaterThan(0);
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
    readonly nullableChoice: "" | "ready" | null;
    readonly requiredChoice: "" | "ready";
  }>;
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
