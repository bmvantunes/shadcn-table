import { expect, test, vi } from "vite-plus/test";
import { detectPlatform } from "@tanstack/react-hotkeys";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import { StrictMode } from "react";

import { BrunoTableClient } from "./index";
import type { BrunoTableColumns } from "./public-types";

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

test.afterEach(async () => {
  await cleanup();
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

  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });
  await expect.element(batchEditing).not.toBeChecked();
  await expect.element(batchEditing).toBeEnabled();
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
  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });

  await userEvent.click(batchEditing);
  await expect.element(batchEditing).toBeChecked();

  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_EDIT_MODE_GUARD" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("textbox", { name: "Edit Name" })).toHaveFocus();
  await expect.element(batchEditing).toBeDisabled();

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
  await expect.element(screen.getByRole("alertdialog", { name: "Reset Review" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Keep Editing" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Reset All Changes" })).toBeVisible();
  const resetAll = screen.getByRole("button", { name: "Reset All Changes" });
  const resetDescriptionId = resetAll.element().getAttribute("aria-describedby");
  expect(resetDescriptionId).toBeTruthy();
  expect(document.getElementById(resetDescriptionId ?? "")?.textContent).toContain(
    "1 pending changed cell",
  );
  const reviewGrid = screen.getByRole("grid", {
    name: "Data for TABLE_ID_RESET_REVIEW:reset-review",
  });
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

  await userEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
  await expect
    .element(screen.getByRole("alertdialog", { name: "Reset Review" }))
    .not.toBeInTheDocument();
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();

  await userEvent.click(reset);
  await userEvent.click(screen.getByRole("button", { name: "Reset All Changes" }));
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
  const validatingColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      isEditable: true,
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

  const reset = screen.getByRole("button", { name: "Reset edits" });
  await expect.element(reset).toBeEnabled();
  await userEvent.click(reset);
  const review = screen.getByRole("alertdialog", { name: "Reset Review" });
  await expect.element(review).toBeVisible();
  const reviewGrid = screen.getByRole("grid", {
    name: "Data for TABLE_ID_RESET_ACTIVE_CANDIDATE:reset-review",
  });
  await expect
    .element(reviewGrid.getByRole("gridcell", { name: "invalid candidate", exact: true }))
    .toBeVisible();
  await expect
    .element(reviewGrid.getByRole("gridcell", { name: "Choose a valid name.", exact: true }))
    .toBeVisible();

  await userEvent.keyboard("{Escape}");
  await expect.element(review).not.toBeInTheDocument();
  const retainedEditor = screen.getByRole("textbox", { name: "Edit Name" });
  await expect.element(retainedEditor).toHaveValue("invalid candidate");

  await userEvent.click(reset);
  await expect.element(screen.getByRole("alertdialog", { name: "Reset Review" })).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Reset All Changes" }));
  await expect.element(screen.getByRole("textbox", { name: "Edit Name" })).not.toBeInTheDocument();
  await expect.element(reset).toBeDisabled();
  await expect.element(grid.getByRole("gridcell", { name: "Ada", exact: true })).toBeVisible();
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
  await userEvent.click(screen.getByRole("button", { name: "Reset All Changes" }));

  await expect.element(screen.getByRole("checkbox", { name: "Select row 1" })).toBeChecked();
  await expect
    .element(screen.getByRole("columnheader", { name: /Name, sorted descending/ }))
    .toHaveAttribute("aria-sort", "descending");
});

test("Reset Review reuses the source column's compiled presentation", async () => {
  const formattedColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      cellAlign: "end",
      isEditable: true,
      valueFormatter: ({ value }: { readonly value: string }) => `Formatted ${value}`,
      cellClassName: "source-highlight",
    },
  ] satisfies BrunoTableColumns<Row>;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_RESET_PRESENTATION"
      columns={formattedColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
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

  const review = screen.getByRole("grid", {
    name: "Data for TABLE_ID_RESET_PRESENTATION:reset-review",
  });
  await expect
    .element(review.getByRole("gridcell", { name: "Formatted Ada", exact: true }))
    .toBeVisible();
  await expect
    .element(review.getByRole("gridcell", { name: "Formatted Augusta", exact: true }))
    .toBeVisible();
  const serverValue = review
    .getByRole("gridcell", { name: "Formatted Ada", exact: true })
    .element()
    .closest<HTMLElement>("[role=gridcell]");
  expect(serverValue).not.toBeNull();
  expect(serverValue?.className).toContain("source-highlight");
  expect(serverValue?.className).toContain("text-end");
  expect(getComputedStyle(serverValue!).textAlign).toBe("end");
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
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();

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
  await userEvent.click(screen.getByRole("button", { name: "Reset All Changes" }));
  await expect.element(batchEditing).toBeEnabled();
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
  await userEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
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
        .getByRole("grid", { name: "Data for TABLE_ID_BLOCKED_DRAFT:reset-review" })
        .getByRole("gridcell", {
          name: "This row was removed from the server. Changes cannot be saved.",
        }),
    )
    .toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Keep Editing" }));

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
