import { expect, test, vi } from "vite-plus/test";
import { detectPlatform } from "@tanstack/react-hotkeys";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { StrictMode } from "react";

import { BrunoTableClient, BrunoTableQuickFilter, BrunoTableToolbar } from "./index";
import { useBrunoTableClientFilterContext } from "./internal/client-filter-context";
import { installBrunoTableGridCommandListener } from "./internal/grid-command-instrumentation";
import type { BrunoTableColumns, BrunoTableValueType } from "./public-types";

type Row = Readonly<{
  readonly id: string;
  readonly name: string;
  readonly revision: bigint;
}>;

const columns = [
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
    isEditable: true,
  },
] satisfies BrunoTableColumns<Row>;

const rows = [{ id: "ada", name: "Ada", revision: 1n }] as const;

function ResetCommandProbe({
  onResult,
}: Readonly<{ readonly onResult: (accepted: boolean) => void }>) {
  const { runtime } = useBrunoTableClientFilterContext();
  return (
    <button
      type="button"
      onClick={() => onResult(runtime.dispatchGridCommand({ type: "edits.reset" }))}
    >
      Dispatch Reset Command
    </button>
  );
}

function makeCanonicalTextColumns(lowercase: boolean): BrunoTableColumns<Row> {
  const decodeRuntime = (input: unknown) =>
    typeof input === "string"
      ? ({ _tag: "Success", value: lowercase ? input.toLowerCase() : input } as const)
      : ({ _tag: "Failure", message: "Expected text." } as const);
  const valueType: BrunoTableValueType<string> = {
    codecId: lowercase ? "test/browser-lowercase" : "test/browser-identity",
    codecVersion: 1,
    filterFamily: "text",
    editorFamily: "text",
    cellAlign: "start",
    editorLayout: "inline",
    defaultWidth: 120,
    decodeRuntime,
    equivalent: Object.is,
    compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
    formatCanonicalText: String,
    parseCanonicalText: (text) => ({ _tag: "Success", value: text }) as const,
    formatDisplay: String,
    encodePersisted: String,
    decodePersisted: decodeRuntime,
  };
  return [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType,
      isEditable: true,
    },
  ] satisfies BrunoTableColumns<Row>;
}

function makeCaseSensitivityColumns(caseSensitive: boolean): BrunoTableColumns<Row> {
  const decodeRuntime = (input: unknown) =>
    typeof input === "string"
      ? ({ _tag: "Success", value: input } as const)
      : ({ _tag: "Failure", message: "Expected text." } as const);
  const valueType: BrunoTableValueType<string> = {
    codecId: "test/browser-case-sensitivity",
    codecVersion: 1,
    filterFamily: "text",
    editorFamily: "text",
    cellAlign: "start",
    editorLayout: "inline",
    defaultWidth: 120,
    decodeRuntime,
    equivalent: caseSensitive
      ? Object.is
      : (left, right) => left.toLowerCase() === right.toLowerCase(),
    compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
    formatCanonicalText: String,
    parseCanonicalText: (text) => ({ _tag: "Success", value: text }) as const,
    formatDisplay: String,
    encodePersisted: String,
    decodePersisted: decodeRuntime,
  };
  return [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType,
      isEditable: true,
    },
  ] satisfies BrunoTableColumns<Row>;
}

test.afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

test("starts in Immediate mode with a persistent clean Edit Safety Footer", async () => {
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_EDIT_MEMORY"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );

  const batchEditing = screen.getByRole("switch", { name: "Batch editing", exact: true });
  await expect.element(batchEditing).not.toBeChecked();
  await expect.element(batchEditing).toBeEnabled();
  expect(batchEditing.element()).not.toHaveAttribute("aria-describedby");
  await expect.element(screen.getByRole("region", { name: "Edit safety" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Reset edits" })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("installs no edit mode or safety chrome for a read-only Client instance", async () => {
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_READ_ONLY_EDIT_MEMORY"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
    />,
  );

  await expect
    .element(screen.getByRole("switch", { name: "Batch editing" }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("region", { name: "Edit safety" })).not.toBeInTheDocument();
});

test("blocks Edit Mode changes while an editor or committed draft owns work", async () => {
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_EDIT_MODE_GUARD"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  const batchEditing = screen.getByRole("switch", { name: "Batch editing", exact: true });

  await userEvent.click(batchEditing);
  await expect.element(batchEditing).toBeChecked();

  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_EDIT_MODE_GUARD" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("textbox", { name: "Edit Name" })).toHaveFocus();
  await expect.element(batchEditing).toBeDisabled();
  const modeDescriptionId = batchEditing.element().getAttribute("aria-describedby");
  expect(modeDescriptionId).toBeTruthy();
  expect(document.getElementById(modeDescriptionId ?? "")?.textContent).toContain(
    "Finish or reset current edit work",
  );

  await userEvent.keyboard("{Escape}");
  await expect.element(batchEditing).toBeEnabled();

  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  const editor = screen.getByRole("textbox", { name: "Edit Name" });
  await userEvent.fill(editor, "Augusta");
  await userEvent.keyboard("{Enter}");

  await expect.element(batchEditing).toBeDisabled();
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("1 unsaved change");
  await expect.element(screen.getByRole("button", { name: "Reset edits" })).toBeEnabled();
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("reconciles current draft convergence against replacement column semantics", async () => {
  const initialColumns = makeCanonicalTextColumns(false);
  const replacementColumns = makeCanonicalTextColumns(true);
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_COLUMN_DOMAIN_CURRENT"
      columns={initialColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_COLUMN_DOMAIN_CURRENT" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "ada");
  await userEvent.keyboard("{Enter}");

  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_COLUMN_DOMAIN_CURRENT"
      columns={replacementColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );

  await expect.element(screen.getByRole("button", { name: "Reset edits" })).toBeDisabled();
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("No unsaved changes");
});

test("reconciles redo-only convergence against replacement column semantics", async () => {
  const initialColumns = makeCanonicalTextColumns(false);
  const replacementColumns = makeCanonicalTextColumns(true);
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_COLUMN_DOMAIN_REDO"
      columns={initialColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });
  await userEvent.click(batchEditing);
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_COLUMN_DOMAIN_REDO" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "ada");
  await userEvent.keyboard("{Enter}");
  grid.element().focus();
  await userEvent.keyboard(
    detectPlatform() === "mac" ? "{Meta>}z{/Meta}" : "{Control>}z{/Control}",
  );

  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_COLUMN_DOMAIN_REDO"
      columns={replacementColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );

  await expect.element(batchEditing).toBeEnabled();
  expect(grid.element().getAttribute("aria-keyshortcuts")).not.toMatch(/Control\+Shift\+Z/);
});

test("keeps an open Reset Review in the replacement column value domain", async () => {
  const initialColumns = makeCanonicalTextColumns(false);
  const replacementColumns = makeCanonicalTextColumns(true);
  const save = vi.fn(() => Promise.resolve());
  const renderTable = (activeColumns: BrunoTableColumns<Row>, version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_COLUMN_DOMAIN_REVIEW"
      columns={activeColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={save}
    />
  );
  const screen = await render(renderTable(initialColumns, 1));
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_COLUMN_DOMAIN_REVIEW" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Mine");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));
  const review = screen.getByRole("alertdialog", { name: "Reset Review" }).getByRole("grid");
  await expect.element(review.getByRole("gridcell", { name: "Ada", exact: true })).toBeVisible();

  await screen.rerender(renderTable(replacementColumns, 1));
  expect(
    review.element().querySelector('td[data-bruno-column-id="COL_ID_SERVER_NOW"]'),
  ).toHaveTextContent("ada");
  expect(
    review.element().querySelector('td[data-bruno-column-id="COL_ID_YOURS"]'),
  ).toHaveTextContent("mine");

  await screen.rerender(renderTable(replacementColumns, 2));
  expect(
    review.element().querySelector('td[data-bruno-column-id="COL_ID_SERVER_NOW"]'),
  ).toHaveTextContent("ada");
  expect(save).not.toHaveBeenCalled();
});

test("reconciles simultaneous source and column replacements as one coherent snapshot", async () => {
  const initialRows = [{ id: "ada", name: "base", revision: 1n }] as const;
  const driftedRows = [{ id: "ada", name: "foo", revision: 2n }] as const;
  const replacementRows = [{ id: "ada", name: "bar", revision: 3n }] as const;
  const renderTable = (
    activeColumns: BrunoTableColumns<Row>,
    sourceRows: readonly Row[],
    version: number,
  ) => (
    <BrunoTableClient
      tableId="TABLE_ID_COHERENT_SOURCE_COLUMNS"
      columns={activeColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: sourceRows.length, version, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />
  );
  const screen = await render(renderTable(makeCaseSensitivityColumns(true), initialRows, 1));
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_COHERENT_SOURCE_COLUMNS" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "FOO");
  await userEvent.keyboard("{Enter}");

  await screen.rerender(renderTable(makeCaseSensitivityColumns(true), driftedRows, 2));
  await expect.element(grid.getByRole("gridcell", { name: "FOO", exact: true })).toBeVisible();

  await screen.rerender(renderTable(makeCaseSensitivityColumns(false), replacementRows, 3));

  await expect.element(grid.getByRole("gridcell", { name: "FOO", exact: true })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Reset edits" })).toBeEnabled();
});

test("captures Row Version evidence through the latest extractor", async () => {
  const initialExtractor = vi.fn((_row: Row) => 1n);
  const latestExtractor = vi.fn((_row: Row) => 2n);
  const save = vi.fn(() => Promise.resolve());
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_LATEST_ROW_VERSION"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={initialExtractor}
      onSaveEdits={save}
    />,
  );

  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_LATEST_ROW_VERSION"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={latestExtractor}
      onSaveEdits={save}
    />,
  );

  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_LATEST_ROW_VERSION" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  expect(initialExtractor).not.toHaveBeenCalled();
  expect(latestExtractor).toHaveBeenCalledWith(rows[0]);
});

test("reviews pending work before Reset and changes nothing until confirmation", async () => {
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_REVIEW"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );

  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_RESET_REVIEW" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();

  const reset = screen.getByRole("button", { name: "Reset edits" });
  await userEvent.click(reset);
  const reviewDialog = screen.getByRole("alertdialog", { name: "Reset Review" });
  await expect.element(reviewDialog).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Keep Editing" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Reset All Changes" })).toBeVisible();
  const resetAll = screen.getByRole("button", { name: "Reset All Changes" });
  const resetDescriptionId = resetAll.element().getAttribute("aria-describedby");
  expect(resetDescriptionId).toBeTruthy();
  expect(document.getElementById(resetDescriptionId ?? "")?.textContent).toContain(
    "1 pending changed cell",
  );
  const reviewGrid = reviewDialog.getByRole("grid");
  await expect.element(reviewGrid).toBeVisible();
  await expect
    .element(reviewGrid.getByRole("gridcell", { name: "Ada", exact: true }))
    .toBeVisible();
  await expect
    .element(reviewGrid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .toBeVisible();
  await expect
    .element(reviewGrid.getByRole("gridcell", { name: "Draft", exact: true }))
    .toBeVisible();
  for (const headerName of ["Server now", "Yours", "Status"] as const) {
    await expect
      .element(reviewGrid.getByRole("button", { name: `Sort by ${headerName}` }))
      .not.toBeInTheDocument();
    await expect
      .element(reviewGrid.getByRole("button", { name: `Filter ${headerName}` }))
      .not.toBeInTheDocument();
  }

  const updatedRows = [{ id: "ada", name: "Adele", revision: 2n }] as const;
  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_REVIEW"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{
        rows: updatedRows,
        totalRows: updatedRows.length,
        version: 2,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  await expect
    .element(reviewGrid.getByRole("gridcell", { name: "Adele", exact: true }))
    .toBeVisible();

  (screen.getByRole("button", { name: "Keep Editing" }).element() as HTMLButtonElement).click();
  await expect
    .element(screen.getByRole("alertdialog", { name: "Reset Review" }))
    .not.toBeInTheDocument();
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();

  await userEvent.click(reset);
  const confirmReset = screen.getByRole("button", { name: "Reset All Changes" });
  confirmReset.element().scrollIntoView({ block: "center" });
  (confirmReset.element() as HTMLButtonElement).click();
  await expect
    .element(screen.getByRole("alertdialog", { name: "Reset Review" }))
    .not.toBeInTheDocument();
  await expect.element(grid).toHaveFocus();
  await expect.element(grid.getByRole("gridcell", { name: "Adele", exact: true })).toBeVisible();
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("No unsaved changes");
  await expect.element(reset).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("reviews and resets a lone invalid active candidate", async () => {
  const candidateClassName = ({ value }: { readonly value: string }) => `name-${value}`;
  const validatingColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      isEditable: true,
      cellClassName: candidateClassName,
      validate: ({ value }: { readonly value: string }) =>
        value === "invalid candidate" ? "Choose a valid name." : undefined,
    },
  ] satisfies BrunoTableColumns<Row>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_ACTIVE_CANDIDATE"
      columns={validatingColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_RESET_ACTIVE_CANDIDATE" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "invalid candidate");
  await userEvent.keyboard("{Enter}");

  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("1 invalid · 1 unsaved");

  const reset = screen.getByRole("button", { name: "Reset edits" });
  await expect.element(reset).toBeEnabled();
  await userEvent.click(reset);
  const review = screen.getByRole("alertdialog", { name: "Reset Review" });
  await expect.element(review).toBeVisible();
  const reviewGrid = review.getByRole("grid");
  await expect
    .element(reviewGrid.getByRole("gridcell", { name: "invalid candidate", exact: true }))
    .toBeVisible();
  await expect
    .element(reviewGrid.getByRole("gridcell", { name: "Choose a valid name.", exact: true }))
    .toBeVisible();
  expect(
    reviewGrid
      .getByRole("gridcell", { name: "invalid candidate", exact: true })
      .element()
      .closest<HTMLElement>("[role=gridcell]")?.className,
  ).not.toContain("name-Ada");

  expect(
    review
      .element()
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })),
  ).toBe(true);
  await expect.element(review).toBeVisible();

  await userEvent.keyboard("{Escape}");
  await expect.element(review).not.toBeInTheDocument();
  const retainedEditor = screen.getByRole("textbox", { name: "Edit Name" });
  await expect.element(retainedEditor).toHaveValue("invalid candidate");

  await userEvent.click(reset);
  await expect.element(screen.getByRole("alertdialog", { name: "Reset Review" })).toBeVisible();

  const confirmReset = screen.getByRole("button", { name: "Reset All Changes" });
  confirmReset.element().scrollIntoView({ block: "center" });
  (confirmReset.element() as HTMLButtonElement).click();
  await expect.element(review).not.toBeInTheDocument();
  await expect.element(screen.getByRole("textbox", { name: "Edit Name" })).not.toBeInTheDocument();
  await expect.element(reset).toBeDisabled();
  await expect.element(grid.getByRole("gridcell", { name: "Ada", exact: true })).toBeVisible();
});

test("keeps Reset Review outside consumer Table Identity registration", async () => {
  const identityErrors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const otherColumns = [
    {
      columnId: "COL_ID_ID",
      field: "id",
      headerName: "Identity",
      valueType: "text",
    },
  ] satisfies BrunoTableColumns<Row>;
  const screen = await render(
    <>
      <BrunoTableClient
        tableId="TABLE_ID_IDENTITY_OWNER"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={vi.fn(() => Promise.resolve())}
      />
      <BrunoTableClient
        tableId="TABLE_ID_IDENTITY_OWNER:reset-review"
        columns={otherColumns}
        initialOrderBy={[{ columnId: "COL_ID_ID", direction: "asc" }]}
        clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
      />
    </>,
  );

  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", {
    name: "Data for TABLE_ID_IDENTITY_OWNER",
    exact: true,
  });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));
  const review = screen.getByRole("alertdialog", { name: "Reset Review" });
  await expect.element(review).toBeVisible();
  await expect.element(review.getByRole("grid", { name: "Reset Review changes" })).toBeVisible();

  expect(identityErrors).not.toHaveBeenCalledWith(
    expect.stringContaining('simultaneous use of tableId "TABLE_ID_IDENTITY_OWNER:reset-review"'),
  );
});

test("Reset preserves the owning table's sorting and Row Selection state", async () => {
  const preferenceRows = [
    { id: "ada", name: "Ada", revision: 1n },
    { id: "grace", name: "Grace", revision: 1n },
  ] as const;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_PREFERENCES"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{
        rows: preferenceRows,
        totalRows: preferenceRows.length,
        version: 1,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      rowSelection
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );

  await userEvent.click(
    screen.getByRole("button", {
      name: "Sort by Name, currently ascending, priority 1",
    }),
  );
  const selectedRow = screen.getByRole("checkbox", { name: "Select row 1" });
  await userEvent.click(selectedRow);
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  await userEvent.click(
    screen
      .getByRole("grid", { name: "Data for TABLE_ID_RESET_PREFERENCES" })
      .getByRole("gridcell", { name: "Grace", exact: true }),
  );
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Amazing Grace");
  await userEvent.keyboard("{Enter}");

  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));
  const resetAllChanges = screen.getByRole("button", { name: "Reset All Changes" });
  await expect.element(resetAllChanges).toBeEnabled();
  resetAllChanges.element().scrollIntoView({ block: "center" });
  (resetAllChanges.element() as HTMLButtonElement).click();
  await expect
    .element(screen.getByRole("alertdialog", { name: "Reset Review" }))
    .not.toBeInTheDocument();

  await expect.element(screen.getByRole("checkbox", { name: "Select row 1" })).toBeChecked();
  await expect
    .element(screen.getByRole("columnheader", { name: /Name, sorted descending/ }))
    .toHaveAttribute("aria-sort", "descending");
});

test("Reset Review preserves authentic source rows for compiled presentation", async () => {
  class PrototypeRow {
    readonly #prefix = "Rendered";

    public constructor(
      public readonly id: string,
      public readonly name: string,
      public readonly revision: bigint,
    ) {}

    public render(value: string): string {
      return `${this.#prefix} ${value}`;
    }

    public className(value: string): string {
      return `${this.#prefix.toLowerCase()}-${value}`;
    }
  }
  const formattedColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      cellAlign: "end",
      isEditable: true,
      cellRenderer: ({ row, value }: { readonly row: PrototypeRow; readonly value: string }) =>
        row.render(value),
      cellClassName: ({ row, value }: { readonly row: PrototypeRow; readonly value: string }) =>
        row.className(value),
    },
  ] satisfies BrunoTableColumns<PrototypeRow>;
  const prototypeRows = [new PrototypeRow("ada", "Ada", 1n)] as const;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_PRESENTATION"
      columns={formattedColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{
        rows: prototypeRows,
        totalRows: prototypeRows.length,
        version: 1,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );

  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_RESET_PRESENTATION" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));

  const review = screen.getByRole("alertdialog", { name: "Reset Review" }).getByRole("grid");
  await expect
    .element(review.getByRole("gridcell", { name: "Rendered Ada", exact: true }))
    .toBeVisible();
  await expect
    .element(review.getByRole("gridcell", { name: "Rendered Augusta", exact: true }))
    .toBeVisible();
  const serverValue = review
    .getByRole("gridcell", { name: "Rendered Ada", exact: true })
    .element()
    .closest<HTMLElement>("[role=gridcell]");
  expect(serverValue).not.toBeNull();
  expect(serverValue?.className).toContain("rendered-Ada");
  expect(serverValue?.className).toContain("text-end");
  expect(getComputedStyle(serverValue!).textAlign).toBe("end");
  const mineValue = review
    .getByRole("gridcell", { name: "Rendered Augusta", exact: true })
    .element()
    .closest<HTMLElement>("[role=gridcell]");
  expect(mineValue?.className).toContain("rendered-Augusta");
});

test("Reset Review applies a row-aware source value formatter to Server and Yours", async () => {
  const formatterColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      isEditable: true,
      valueFormatter: ({ row, value }: { readonly row: Row; readonly value: string }) =>
        `Formatted ${value} for ${row.id}`,
    },
  ] satisfies BrunoTableColumns<Row>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_FORMATTER"
      columns={formatterColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );

  await userEvent.click(screen.getByRole("switch", { name: "Batch editing", exact: true }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_RESET_FORMATTER" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));

  const review = screen.getByRole("alertdialog", { name: "Reset Review" }).getByRole("grid");
  await expect
    .element(review.getByRole("gridcell", { name: "Formatted Ada for ada", exact: true }))
    .toBeVisible();
  await expect
    .element(review.getByRole("gridcell", { name: "Formatted Augusta for ada", exact: true }))
    .toBeVisible();
});

test("Reset Review contains unavailable Server values before typed presentation callbacks", async () => {
  type DecodedRow = Readonly<{
    readonly id: string;
    readonly value: string;
    readonly revision: bigint;
  }>;
  const decodeRuntime = (input: unknown) =>
    input === "unavailable"
      ? ({ _tag: "Failure", message: "Unavailable source value." } as const)
      : typeof input === "string"
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected text." } as const);
  const valueType: BrunoTableValueType<string, "text", "text"> = {
    codecId: "test/reset-review-unavailable",
    codecVersion: 1,
    filterFamily: "text",
    editorFamily: "text",
    cellAlign: "start",
    editorLayout: "inline",
    defaultWidth: 120,
    decodeRuntime,
    equivalent: Object.is,
    compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
    formatCanonicalText: String,
    parseCanonicalText: (text) => ({ _tag: "Success", value: text }),
    formatDisplay: String,
    encodePersisted: String,
    decodePersisted: decodeRuntime,
  };
  const valueFormatter = vi.fn(({ value }: { readonly value: string }) => {
    if (value === undefined) throw new Error("typed formatter received unavailable evidence");
    return `Formatted ${value}`;
  });
  const cellClassName = vi.fn(({ value }: { readonly value: string }) => {
    if (value === undefined) throw new Error("typed class callback received unavailable evidence");
    return `value-${value}`;
  });
  const decodedColumns = [
    {
      columnId: "COL_ID_VALUE",
      field: "value",
      headerName: "Value",
      valueType,
      isEditable: true,
      valueFormatter,
      cellClassName,
    },
  ] as const satisfies BrunoTableColumns<DecodedRow>;
  const initialRows: readonly DecodedRow[] = [{ id: "row", value: "server", revision: 1n }];
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_UNAVAILABLE"
      columns={decodedColumns}
      initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
      clientSource={{ rows: initialRows, totalRows: 1, version: 1, status: "ready" }}
      getRowId={(candidate) => candidate.id}
      editable
      getRowVersion={(candidate) => candidate.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_RESET_UNAVAILABLE" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Value" }), "mine");
  await userEvent.keyboard("{Enter}");

  const unavailableRows: readonly DecodedRow[] = [
    { id: "row", value: "unavailable", revision: 2n },
  ];
  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_UNAVAILABLE"
      columns={decodedColumns}
      initialOrderBy={[{ columnId: "COL_ID_VALUE", direction: "asc" }]}
      clientSource={{ rows: unavailableRows, totalRows: 1, version: 2, status: "ready" }}
      getRowId={(candidate) => candidate.id}
      editable
      getRowVersion={(candidate) => candidate.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));

  const review = screen.getByRole("alertdialog", { name: "Reset Review" }).getByRole("grid");
  await expect
    .element(review.getByRole("gridcell", { name: "Unavailable", exact: true }))
    .toBeVisible();
  await expect
    .element(review.getByRole("gridcell", { name: "Formatted mine", exact: true }))
    .toBeVisible();
  expect(valueFormatter.mock.calls.some(([context]) => context.value === undefined)).toBe(false);
  expect(cellClassName.mock.calls.some(([context]) => context.value === undefined)).toBe(false);
});

test("keeps consumer serverText and mineText fields on their configured presentation path", async () => {
  type CollisionRow = Readonly<{
    readonly id: string;
    readonly serverText: string;
    readonly mineText: string;
  }>;
  const collisionColumns = [
    {
      columnId: "COL_ID_SERVER_TEXT",
      field: "serverText",
      headerName: "Consumer Server Text",
      valueType: "text",
      cellAlign: "end",
      cellClassName: "consumer-field",
    },
    {
      columnId: "COL_ID_MINE_TEXT",
      field: "mineText",
      headerName: "Consumer Mine Text",
      valueType: "text",
      cellAlign: "end",
      cellClassName: "consumer-field",
    },
  ] satisfies BrunoTableColumns<CollisionRow>;
  const collisionRows = [
    { id: "row", serverText: "server value", mineText: "mine value" },
  ] as const;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_CONSUMER_REVIEW_FIELD_NAMES"
      columns={collisionColumns}
      initialOrderBy={[{ columnId: "COL_ID_SERVER_TEXT", direction: "asc" }]}
      clientSource={{ rows: collisionRows, totalRows: 1, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
    />,
  );

  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_CONSUMER_REVIEW_FIELD_NAMES" });
  for (const value of ["server value", "mine value"] as const) {
    const cell = grid.getByRole("gridcell", { name: value, exact: true }).element();
    expect(cell.className).toContain("consumer-field");
    expect(getComputedStyle(cell).textAlign).toBe("end");
  }
});

test("keeps Reset Review modal focus contained and restores the opener in StrictMode", async () => {
  const screen = await render(
    <StrictMode>
      <BrunoTableClient
        tableId="TABLE_ID_RESET_FOCUS"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={vi.fn(() => Promise.resolve())}
      />
    </StrictMode>,
  );
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_RESET_FOCUS" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  const reset = screen.getByRole("button", { name: "Reset edits" });
  await userEvent.click(reset);
  const dialog = screen.getByRole("alertdialog", { name: "Reset Review" });
  expect(dialog.element().contains(document.activeElement)).toBe(true);
  await userEvent.keyboard("{Tab}{Tab}{Shift>}{Tab}{/Shift}");
  expect(dialog.element().contains(document.activeElement)).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(reset).toHaveFocus();
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();
});

test("restores focus to the owning grid instead of an earlier toolbar grid", async () => {
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_OWNED_GRID_FOCUS"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(candidate) => candidate.id}
      editable
      getRowVersion={(candidate) => candidate.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    >
      <BrunoTableToolbar>
        <div aria-label="Consumer toolbar grid" role="grid" tabIndex={0} />
      </BrunoTableToolbar>
    </BrunoTableClient>,
  );
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_RESET_OWNED_GRID_FOCUS" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));
  const confirmReset = screen.getByRole("button", { name: "Reset All Changes" });
  confirmReset.element().scrollIntoView({ block: "center" });
  (confirmReset.element() as HTMLButtonElement).click();

  await expect.element(grid).toHaveFocus();
  await expect
    .element(screen.getByRole("grid", { name: "Consumer toolbar grid" }))
    .not.toHaveFocus();
});

test("restores owning table focus after Reset when an empty body has no grid", async () => {
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_EMPTY_FOCUS"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(candidate) => candidate.id}
      editable
      getRowVersion={(candidate) => candidate.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    >
      <BrunoTableToolbar>
        <div aria-label="Consumer toolbar grid" role="grid" tabIndex={0} />
      </BrunoTableToolbar>
    </BrunoTableClient>,
  );
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_RESET_EMPTY_FOCUS" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_EMPTY_FOCUS"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: [] as readonly Row[], totalRows: 0, version: 2, status: "ready" }}
      getRowId={(candidate) => candidate.id}
      editable
      getRowVersion={(candidate) => candidate.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    >
      <BrunoTableToolbar>
        <div aria-label="Consumer toolbar grid" role="grid" tabIndex={0} />
      </BrunoTableToolbar>
    </BrunoTableClient>,
  );
  await expect.element(grid).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));
  const confirmReset = screen.getByRole("button", { name: "Reset All Changes" });
  confirmReset.element().scrollIntoView({ block: "center" });
  (confirmReset.element() as HTMLButtonElement).click();

  await expect
    .element(screen.getByRole("region", { name: "TABLE_ID_RESET_EMPTY_FOCUS" }))
    .toHaveFocus();
  await expect
    .element(screen.getByRole("grid", { name: "Consumer toolbar grid" }))
    .not.toHaveFocus();
});

test("keeps bounded Batch undo and redo local to the current unsaved session", async () => {
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_BATCH_HISTORY"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });
  await userEvent.click(batchEditing);
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BATCH_HISTORY" });
  expect(grid.element().getAttribute("aria-keyshortcuts")).not.toMatch(/Control\+Z|Meta\+Z/);
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();
  expect(grid.element().getAttribute("aria-keyshortcuts")).toMatch(/Control\+Z Meta\+Z/);
  expect(grid.element().getAttribute("aria-keyshortcuts")).not.toMatch(/Control\+Shift\+Z/);

  grid.element().focus();
  await userEvent.keyboard(
    detectPlatform() === "mac" ? "{Meta>}z{/Meta}" : "{Control>}z{/Control}",
  );
  await expect.element(grid.getByRole("gridcell", { name: "Ada", exact: true })).toBeVisible();
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("No unsaved changes");
  await expect.element(batchEditing).toBeDisabled();
  expect(grid.element().getAttribute("aria-keyshortcuts")).not.toMatch(/Control\+Z Meta\+Z/);
  expect(grid.element().getAttribute("aria-keyshortcuts")).toMatch(/Control\+Shift\+Z/);
  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_BATCH_HISTORY"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 2, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  expect(grid.element().getAttribute("aria-keyshortcuts")).not.toMatch(/Control\+Z Meta\+Z/);
  expect(grid.element().getAttribute("aria-keyshortcuts")).toMatch(/Control\+Shift\+Z/);

  await userEvent.keyboard(
    detectPlatform() === "mac"
      ? "{Meta>}{Shift>}z{/Shift}{/Meta}"
      : "{Control>}{Shift>}z{/Shift}{/Control}",
  );
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("1 unsaved change");

  await userEvent.keyboard(
    detectPlatform() === "mac" ? "{Meta>}z{/Meta}" : "{Control>}z{/Control}",
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));
  expect(screen.getByRole("button", { name: "Reset All Changes" }).element()).toHaveAttribute(
    "aria-describedby",
  );
  const historyDescriptionId = screen
    .getByRole("button", { name: "Reset All Changes" })
    .element()
    .getAttribute("aria-describedby");
  expect(document.getElementById(historyDescriptionId ?? "")?.textContent).toContain(
    "1 Batch history command",
  );
  (screen.getByRole("button", { name: "Keep Editing" }).element() as HTMLButtonElement).click();
  await expect
    .element(screen.getByRole("alertdialog", { name: "Reset Review" }))
    .not.toBeInTheDocument();
  grid.element().focus();
  await userEvent.keyboard(
    detectPlatform() === "mac"
      ? "{Meta>}{Shift>}z{/Shift}{/Meta}"
      : "{Control>}{Shift>}z{/Shift}{/Control}",
  );
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();
  await userEvent.keyboard(
    detectPlatform() === "mac" ? "{Meta>}z{/Meta}" : "{Control>}z{/Control}",
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));
  const confirmReset = screen.getByRole("button", { name: "Reset All Changes" });
  confirmReset.element().scrollIntoView({ block: "center" });
  (confirmReset.element() as HTMLButtonElement).click();
  await expect.element(batchEditing).toBeEnabled();
});

test("dispatches Reset and Batch history hotkeys through typed Grid Commands", async () => {
  const commandTypes: string[] = [];
  const resetResults: boolean[] = [];
  const removeListener = installBrunoTableGridCommandListener("TABLE_ID_EDIT_COMMANDS", (command) =>
    commandTypes.push(command.type),
  );
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_EDIT_COMMANDS"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(candidate) => candidate.id}
      editable
      getRowVersion={(candidate) => candidate.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    >
      <BrunoTableToolbar>
        <ResetCommandProbe onResult={(accepted) => resetResults.push(accepted)} />
      </BrunoTableToolbar>
    </BrunoTableClient>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Dispatch Reset Command" }));
  expect(resetResults).toEqual([false]);
  await expect
    .element(screen.getByRole("alertdialog", { name: "Reset Review" }))
    .not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_EDIT_COMMANDS" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  grid.element().focus();
  await userEvent.keyboard(
    detectPlatform() === "mac" ? "{Meta>}z{/Meta}" : "{Control>}z{/Control}",
  );
  await userEvent.keyboard(
    detectPlatform() === "mac"
      ? "{Meta>}{Shift>}z{/Shift}{/Meta}"
      : "{Control>}{Shift>}z{/Shift}{/Control}",
  );
  await userEvent.click(screen.getByRole("button", { name: "Dispatch Reset Command" }));

  expect(resetResults).toEqual([false, true]);
  await expect.element(screen.getByRole("alertdialog", { name: "Reset Review" })).toBeVisible();
  expect(commandTypes).toEqual(expect.arrayContaining(["edits.undo", "edits.redo", "edits.reset"]));
  removeListener();
});

test("reconciles hidden drafts while filtering leaves the row projection empty", async () => {
  const renderTable = (sourceRows: readonly Row[], version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_HIDDEN_EDIT_RECONCILIATION"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: sourceRows.length, version, status: "ready" }}
      getRowId={(candidate) => candidate.id}
      quickFilterFields={["name"]}
      editable
      getRowVersion={(candidate) => candidate.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    >
      <BrunoTableToolbar>
        <BrunoTableQuickFilter />
      </BrunoTableToolbar>
    </BrunoTableClient>
  );
  const screen = await render(renderTable(rows, 1));
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_HIDDEN_EDIT_RECONCILIATION" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("searchbox", { name: "Quick Filter" }), "missing");
  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .not.toBeInTheDocument();

  const convergedRows = [{ id: "ada", name: "Augusta", revision: 2n }] as const;
  await screen.rerender(renderTable(convergedRows, 2));

  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "Reset edits" })).toBeDisabled();
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("No unsaved changes");
});

test("leaves native undo and redo owned by interactive cell content", async () => {
  const interactiveColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      isEditable: true,
      cellRenderer: ({ value }: { readonly value: string }) => (
        <input aria-label="Consumer editor" defaultValue={value} />
      ),
    },
  ] satisfies BrunoTableColumns<Row>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_NATIVE_UNDO"
      columns={interactiveColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_NATIVE_UNDO" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  const consumerEditor = screen.getByRole("textbox", { name: "Consumer editor" });
  await userEvent.click(consumerEditor);
  await userEvent.keyboard(
    detectPlatform() === "mac" ? "{Meta>}z{/Meta}" : "{Control>}z{/Control}",
  );
  await expect.element(consumerEditor).toHaveFocus();
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("1 unsaved change");
  await userEvent.keyboard(
    detectPlatform() === "mac"
      ? "{Meta>}{Shift>}z{/Shift}{/Meta}"
      : "{Control>}{Shift>}z{/Shift}{/Control}",
  );
  await userEvent.keyboard(
    detectPlatform() === "mac" ? "{Meta>}y{/Meta}" : "{Control>}y{/Control}",
  );
  await expect.element(consumerEditor).toHaveFocus();
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("1 unsaved change");
});

test("keeps Reset Review stable while live source convergence prunes drafts and history", async () => {
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_CONVERGENCE"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });
  await userEvent.click(batchEditing);
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_RESET_CONVERGENCE" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));

  const convergedRows = [{ id: "ada", name: "Augusta", revision: 2n }] as const;
  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_CONVERGENCE"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{
        rows: convergedRows,
        totalRows: convergedRows.length,
        version: 2,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );

  await expect.element(screen.getByRole("alertdialog", { name: "Reset Review" })).toBeVisible();
  await expect
    .element(screen.getByRole("alertdialog", { name: "Reset Review" }).getByRole("status"))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Reset All Changes" })).toBeDisabled();
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("No unsaved changes");
  (screen.getByRole("button", { name: "Keep Editing" }).element() as HTMLButtonElement).click();
  await expect.element(grid).toHaveFocus();
  await expect.element(batchEditing).toBeEnabled();
});

test("preserves missing-row drafts as blocked work and reconnects the same Row Identity", async () => {
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_BLOCKED_DRAFT"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BLOCKED_DRAFT" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_BLOCKED_DRAFT"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: [] as readonly Row[], totalRows: 0, version: 2, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("1 blocked change · 1 unsaved");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));
  await expect
    .element(
      screen
        .getByRole("alertdialog", { name: "Reset Review" })
        .getByRole("grid")
        .getByRole("gridcell", {
          name: "This row was removed from the server. Changes cannot be saved.",
        }),
    )
    .toBeVisible();
  (screen.getByRole("button", { name: "Keep Editing" }).element() as HTMLButtonElement).click();
  await expect
    .element(screen.getByRole("alertdialog", { name: "Reset Review" }))
    .not.toBeInTheDocument();

  const returnedRows = [{ id: "ada", name: "Ada", revision: 3n }] as const;
  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_BLOCKED_DRAFT"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{
        rows: returnedRows,
        totalRows: returnedRows.length,
        version: 3,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={vi.fn(() => Promise.resolve())}
    />,
  );
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("1 unsaved change");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();
});
