import { expect, test, vi } from "vite-plus/test";
import { detectPlatform } from "@tanstack/react-hotkeys";
import { cdp, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";
import type { CDPSession as PlaywrightCDPSession } from "@vitest/browser-playwright";
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

test("saves one Batch edit as one exact row-grouped change set", async () => {
  const onSaveEdits = vi.fn(() => Promise.resolve());
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_BATCH_SAVE"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />,
  );

  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BATCH_SAVE" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  const save = screen.getByRole("button", { name: "Save" });
  await expect.element(save).toBeEnabled();
  await userEvent.click(save);

  expect(onSaveEdits).toHaveBeenCalledOnce();
  expect(onSaveEdits).toHaveBeenCalledWith([
    {
      rowId: "ada",
      baseRow: rows[0],
      expectedVersion: 1n,
      changes: [
        {
          columnId: "COL_ID_NAME",
          field: "name",
          before: "Ada",
          after: "Augusta",
        },
      ],
    },
  ]);
});

test("keeps a resolved Batch globally locked behind an Accepted Overlay until live confirmation", async () => {
  let resolveSave!: () => void;
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const renderTable = (sourceRows: readonly Row[], version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_BATCH_ACCEPTED_OVERLAY"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{
        rows: sourceRows,
        totalRows: sourceRows.length,
        version,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(rows, 1));

  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });
  await userEvent.click(batchEditing);
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BATCH_ACCEPTED_OVERLAY" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await expect.element(batchEditing).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Reset edits" })).toBeDisabled();
  resolveSave();
  await expect
    .element(screen.getByRole("region", { name: "Edit safety" }))
    .toHaveTextContent("Batch save accepted · waiting for live confirmation · 1 row remaining");
  await expect.element(batchEditing).toBeDisabled();
  const acceptedCell = grid.getByRole("gridcell", { name: "Augusta", exact: true });
  await expect.element(acceptedCell).toBeVisible();
  await expect.element(acceptedCell).toHaveAttribute("data-bruno-save-success");
  expect(getComputedStyle(acceptedCell.element(), "::after").animationDuration).toBe("2s");

  const confirmedRows = [{ id: "ada", name: "Augusta", revision: 2n }] as const;
  await screen.rerender(renderTable(confirmedRows, 2));

  await expect.element(batchEditing).toBeEnabled();
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();
});

test("keeps the two-second success presentation visible without motion", async () => {
  const session: PlaywrightCDPSession = cdp();
  await session.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  let resolveSave!: () => void;
  try {
    const screen = await render(
      <BrunoTableClient
        tableId="TABLE_ID_REDUCED_MOTION_SAVE_SUCCESS"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={() =>
          new Promise<void>((resolve) => {
            resolveSave = resolve;
          })
        }
      />,
    );
    const grid = screen.getByRole("grid", {
      name: "Data for TABLE_ID_REDUCED_MOTION_SAVE_SUCCESS",
    });
    grid.element().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
    await userEvent.keyboard("{Enter}");
    resolveSave();

    const acceptedCell = grid.getByRole("gridcell", { name: "Augusta", exact: true });
    await expect.element(acceptedCell).toHaveAttribute("data-bruno-save-success");
    const successStyle = getComputedStyle(acceptedCell.element(), "::after");
    expect(successStyle.animationName).toBe("none");
    expect(successStyle.opacity).toBe("1");
  } finally {
    await session.send("Emulation.setEmulatedMedia", { features: [] });
  }
});

test("unlocks a rejected Batch operation without discarding its drafts or history", async () => {
  let rejectSave!: (reason: Error) => void;
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_BATCH_REJECTION"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />,
  );
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BATCH_REJECTION" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  await expect.element(screen.getByRole("button", { name: "Reset edits" })).toBeDisabled();
  rejectSave(new Error("Batch compare-and-set failed."));

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Open Operation details for the complete explanation.");
  await expect
    .element(screen.getByRole("region", { name: "Edit safety" }))
    .toHaveTextContent("1 unsaved change");
  await expect.element(screen.getByRole("button", { name: "Reset edits" })).toBeEnabled();
  await expect.element(screen.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .toHaveAttribute("data-bruno-save-failed");
});

test("starts one Immediate save operation from one accepted cell commit", async () => {
  const onSaveEdits = vi.fn(() => Promise.resolve());
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_IMMEDIATE_SAVE"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />,
  );

  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_IMMEDIATE_SAVE" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  expect(onSaveEdits).toHaveBeenCalledOnce();
  expect(onSaveEdits).toHaveBeenCalledWith([
    {
      rowId: "ada",
      baseRow: rows[0],
      expectedVersion: 1n,
      changes: [
        {
          columnId: "COL_ID_NAME",
          field: "name",
          before: "Ada",
          after: "Augusta",
        },
      ],
    },
  ]);
});

test("retains an Immediate Accepted Overlay and operation gate through live confirmation", async () => {
  let resolveSave!: () => void;
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const renderTable = (sourceRows: readonly Row[], version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_IMMEDIATE_ACCEPTED_OVERLAY"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{
        rows: sourceRows,
        totalRows: sourceRows.length,
        version,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(rows, 1));

  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_IMMEDIATE_ACCEPTED_OVERLAY" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await expect.element(batchEditing).toBeDisabled();
  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .toHaveAttribute("aria-busy", "true");
  await expect
    .element(screen.getByRole("region", { name: "Edit safety" }))
    .toHaveTextContent("1 Immediate save pending");
  resolveSave();
  await expect
    .element(screen.getByRole("region", { name: "Edit safety" }))
    .toHaveTextContent("1 Immediate save accepted · waiting for live confirmation");
  await expect.element(batchEditing).toBeDisabled();
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();

  const confirmedRows = [{ id: "ada", name: "Augusta", revision: 2n }] as const;
  await screen.rerender(renderTable(confirmedRows, 2));

  await expect.element(batchEditing).toBeEnabled();
  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .not.toHaveAttribute("aria-busy");
  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .toHaveAttribute("data-bruno-save-success");
});

test("renders an Accepted Overlay with its submitted column presentation authority", async () => {
  let resolveSave!: () => void;
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const incompatibleValueType: BrunoTableValueType<number> = {
    codecId: "test/browser-incompatible-number",
    codecVersion: 1,
    filterFamily: "numeric",
    editorFamily: "number",
    cellAlign: "end",
    editorLayout: "inline",
    defaultWidth: 120,
    decodeRuntime: (input) =>
      typeof input === "number"
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected a number." } as const),
    equivalent: Object.is,
    compare: (left, right) => (left === right ? 0 : left < right ? -1 : 1),
    formatCanonicalText: String,
    parseCanonicalText: (text) => ({ _tag: "Success", value: Number(text) }) as const,
    formatDisplay: (value) => {
      if (typeof value !== "number") throw new TypeError("Replacement formatter received text.");
      return String(value);
    },
    encodePersisted: String,
    decodePersisted: (input) =>
      typeof input === "number"
        ? ({ _tag: "Success", value: input } as const)
        : ({ _tag: "Failure", message: "Expected a number." } as const),
  };
  const incompatibleColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: incompatibleValueType,
      isEditable: true,
    },
  ] as unknown as BrunoTableColumns<Row>;
  const renderTable = (activeColumns: BrunoTableColumns<Row>) => (
    <BrunoTableClient
      tableId="TABLE_ID_ACCEPTED_OVERLAY_PRESENTATION"
      columns={activeColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(columns));
  const grid = screen.getByRole("grid", {
    name: "Data for TABLE_ID_ACCEPTED_OVERLAY_PRESENTATION",
  });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  resolveSave();
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();

  await screen.rerender(renderTable(incompatibleColumns));
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();
});

test("retains a resolved save operation across a non-authoritative loading gap", async () => {
  let resolveSave!: () => void;
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const renderTable = (
    sourceRows: readonly Row[],
    version: number,
    status: "loading" | "ready",
  ) => (
    <BrunoTableClient
      tableId="TABLE_ID_SAVE_LOADING_GAP"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: 1, version, status }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(rows, 1, "ready"));
  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SAVE_LOADING_GAP" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await screen.rerender(renderTable([], 2, "loading"));
  await expect
    .element(screen.getByRole("region", { name: "Edit safety" }))
    .toHaveTextContent("1 Immediate save pending");
  resolveSave();
  await expect.element(batchEditing).toBeDisabled();
  await expect
    .element(screen.getByRole("region", { name: "Edit safety" }))
    .toHaveTextContent("1 Immediate save accepted · waiting for live confirmation");

  await screen.rerender(renderTable(rows, 3, "ready"));
  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .toHaveAttribute("aria-busy", "true");
  await expect.element(batchEditing).toBeDisabled();

  const confirmedRows = [{ id: "ada", name: "Augusta", revision: 2n }] as const;
  await screen.rerender(renderTable(confirmedRows, 4, "ready"));
  await expect.element(batchEditing).toBeEnabled();
});

test("retains a resolved save operation across a terminal source publication", async () => {
  let resolveSave!: () => void;
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const terminalRows = [{ id: "grace", name: "Grace", revision: 1n }] as const;
  const renderTable = (
    sourceRows: readonly Row[],
    version: number,
    status: "closed" | "ready" | "stale",
  ) => (
    <BrunoTableClient
      tableId="TABLE_ID_SAVE_TERMINAL_GAP"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: sourceRows.length, version, status }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(rows, 1, "ready"));
  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SAVE_TERMINAL_GAP" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  resolveSave();
  await expect
    .element(screen.getByRole("region", { name: "Edit safety" }))
    .toHaveTextContent("1 Immediate save accepted · waiting for live confirmation");
  await expect.element(batchEditing).toBeDisabled();

  await screen.rerender(renderTable(terminalRows, 2, "closed"));
  await expect.element(batchEditing).toBeDisabled();

  await screen.rerender(renderTable(terminalRows, 3, "stale"));
  await expect.element(batchEditing).toBeEnabled();
});

test("disables Batch Save for terminal source state and restores it for stale authority", async () => {
  const onSaveEdits = vi.fn(() => Promise.resolve());
  const renderTable = (status: "closed" | "ready" | "stale", version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_BATCH_TERMINAL_PREFLIGHT"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version, status }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable("ready", 1));
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BATCH_TERMINAL_PREFLIGHT" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  const save = screen.getByRole("button", { name: "Save", exact: true });
  await expect.element(save).toBeEnabled();

  await screen.rerender(renderTable("closed", 2));
  await expect.element(save).toBeDisabled();
  expect(onSaveEdits).not.toHaveBeenCalled();

  await screen.rerender(renderTable("stale", 3));
  await expect.element(save).toBeEnabled();
});

test("retains an Immediate candidate until save preflight becomes authoritative", async () => {
  const onSaveEdits = vi.fn(() => Promise.resolve());
  const renderTable = (
    sourceRows: readonly Row[],
    version: number,
    status: "loading" | "ready",
  ) => (
    <BrunoTableClient
      tableId="TABLE_ID_IMMEDIATE_LOADING_GAP"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: 1, version, status }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(rows, 1, "ready"));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_IMMEDIATE_LOADING_GAP" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");

  await screen.rerender(renderTable(rows, 2, "loading"));
  expect(onSaveEdits).not.toHaveBeenCalled();
  await expect
    .element(screen.getByRole("region", { name: "Edit safety" }))
    .toHaveTextContent("1 unsaved change");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await screen.rerender(renderTable(rows, 3, "ready"));
  const restoredEditor = screen.getByRole("textbox", { name: "Edit Name" });
  await expect.element(restoredEditor).toHaveValue("Augusta");
  restoredEditor.element().focus();
  await userEvent.keyboard("{Enter}");
  expect(onSaveEdits).toHaveBeenCalledOnce();
  expect(onSaveEdits).toHaveBeenNthCalledWith(1, [
    {
      rowId: "ada",
      baseRow: rows[0],
      expectedVersion: 1n,
      changes: [
        {
          columnId: "COL_ID_NAME",
          field: "name",
          before: "Ada",
          after: "Augusta",
        },
      ],
    },
  ]);
});

test("keeps in-flight save evidence in its captured Row Version domain", async () => {
  let resolveSave!: () => void;
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const renderTable = (
    sourceRows: readonly Row[],
    version: number,
    getRowVersion: (row: Row) => bigint,
  ) => (
    <BrunoTableClient
      tableId="TABLE_ID_IN_FLIGHT_VERSION_DOMAIN"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: sourceRows.length, version, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={getRowVersion}
      onSaveEdits={onSaveEdits}
    />
  );
  const originalExtractor = (candidate: Row) => candidate.revision;
  const replacementExtractor = (_candidate: Row) => 999n;
  const screen = await render(renderTable(rows, 1, originalExtractor));
  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_IN_FLIGHT_VERSION_DOMAIN" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await screen.rerender(renderTable(rows, 2, replacementExtractor));
  resolveSave();
  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .toHaveAttribute("data-bruno-save-success");
  await expect.element(batchEditing).toBeDisabled();

  const confirmedRows = [{ id: "ada", name: "Ada", revision: 2n }] as const;
  await screen.rerender(renderTable(confirmedRows, 3, replacementExtractor));
  await expect.element(batchEditing).toBeEnabled();
});

test("preserves pending and accepted save presentation when a column becomes read-only", async () => {
  let resolveSave!: () => void;
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const readOnlyColumns = [
    {
      columnId: "COL_ID_NAME",
      field: "name",
      headerName: "Name",
      valueType: "text",
      isEditable: false,
    },
    {
      columnId: "COL_ID_EDITABLE_PEER",
      field: "name",
      headerName: "Editable peer",
      valueType: "text",
      isEditable: true,
    },
  ] satisfies BrunoTableColumns<Row>;
  const renderTable = (activeColumns: BrunoTableColumns<Row>, sourceRows: readonly Row[]) => (
    <BrunoTableClient
      tableId="TABLE_ID_SAVE_READ_ONLY_REPLACEMENT"
      columns={activeColumns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: sourceRows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(columns, rows));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SAVE_READ_ONLY_REPLACEMENT" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await screen.rerender(renderTable(readOnlyColumns, rows));
  const pendingCell = grid.getByRole("gridcell", { name: "Augusta", exact: true });
  await expect.element(pendingCell).toHaveAttribute("aria-busy", "true");
  resolveSave();
  await expect.element(pendingCell).toHaveAttribute("data-bruno-save-success");
  await expect.element(pendingCell).toHaveAttribute("aria-busy", "true");
});

test("reports an Immediate save failure persistently and exposes an accessible Close control", async () => {
  const onSaveEdits = vi.fn(() => Promise.reject(new Error("Version changed on the server.")));
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_IMMEDIATE_FAILURE"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />,
  );
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_IMMEDIATE_FAILURE" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  const alert = screen.getByRole("alert");
  await expect
    .element(alert)
    .toHaveTextContent("Open Operation details for the complete explanation.");
  await expect.element(alert).not.toHaveTextContent("Version changed on the server.");
  await expect
    .element(grid.getByRole("gridcell", { name: "Ada", exact: true }))
    .toHaveAttribute("data-bruno-save-failed");
  const operationDetails = screen
    .getByRole("region", { name: "Notifications" })
    .getByRole("button", { name: "Operation details" });
  await expect.element(operationDetails).toBeVisible();
  await userEvent.click(operationDetails);
  await expect
    .element(screen.getByRole("alertdialog", { name: "Save operation details" }))
    .toHaveTextContent("Operation 1: Version changed on the server.");
  await expect
    .element(screen.getByRole("alertdialog", { name: "Save operation details" }))
    .toHaveTextContent("Row ada, column COL_ID_NAME (field name).");
  await userEvent.click(screen.getByRole("button", { name: "Close details" }));
  await expect.element(alert.getByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  await expect
    .element(alert.getByRole("button", { name: "Save", exact: true }))
    .not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Close toast" }));
  await expect.element(alert).not.toBeInTheDocument();
});

test("retains one concurrent failure when another operation converges", async () => {
  const sourceRows = [
    { id: "ada", name: "Ada", revision: 1n },
    { id: "grace", name: "Grace", revision: 1n },
  ] as const;
  const rejectSave: Array<(reason: Error) => void> = [];
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectSave.push(reject);
      }),
  );
  const renderTable = (activeRows: readonly Row[], version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_CONCURRENT_FAILURE_CONVERGENCE"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: activeRows, totalRows: activeRows.length, version, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(sourceRows, 1));
  const grid = screen.getByRole("grid", {
    name: "Data for TABLE_ID_CONCURRENT_FAILURE_CONVERGENCE",
  });
  for (const [before, after] of [
    ["Ada", "Augusta"],
    ["Grace", "Amazing Grace"],
  ] as const) {
    await userEvent.click(grid.getByRole("gridcell", { name: before, exact: true }));
    await userEvent.keyboard("{Enter}");
    await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), after);
    await userEvent.keyboard("{Enter}");
  }

  rejectSave[0]!(new Error("Ada save failed."));
  rejectSave[1]!(new Error("Grace save failed."));
  await expect.element(screen.getByRole("alert")).toHaveTextContent("2 save operations failed.");

  const partiallyConverged = [{ id: "ada", name: "Augusta", revision: 2n }, sourceRows[1]] as const;
  await screen.rerender(renderTable(partiallyConverged, 2));
  const remainingAlert = screen.getByRole("alert");
  await expect.element(remainingAlert).toHaveTextContent("A save operation failed.");
  await userEvent.click(screen.getByRole("button", { name: "Operation details" }));
  const details = screen.getByRole("alertdialog", { name: "Save operation details" });
  await expect.element(details).toHaveTextContent("Grace save failed.");
  await expect.element(details).not.toHaveTextContent("Ada save failed.");
  await userEvent.click(details.getByRole("button", { name: "Close details" }));
  await userEvent.click(screen.getByRole("button", { name: "Close toast" }));
  await expect.element(remainingAlert).not.toBeInTheDocument();
});

test("shares one notification viewport across multiple editable tables", async () => {
  const renderEditableTable = (tableId: string) => (
    <BrunoTableClient
      tableId={tableId}
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() => Promise.reject(new Error(`Failure for ${tableId}.`))}
    />
  );
  const screen = await render(
    <div>
      {renderEditableTable("TABLE_ID_FAILURE_VIEWPORT_FIRST")}
      {renderEditableTable("TABLE_ID_FAILURE_VIEWPORT_SECOND")}
    </div>,
  );

  for (const tableId of ["TABLE_ID_FAILURE_VIEWPORT_FIRST", "TABLE_ID_FAILURE_VIEWPORT_SECOND"]) {
    const grid = screen.getByRole("grid", { name: `Data for ${tableId}` });
    grid.element().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), `${tableId}-value`);
    await userEvent.keyboard("{Enter}");
  }

  const notificationRegions = screen.getByRole("region", { name: "Notifications" }).all();
  expect(notificationRegions).toHaveLength(1);
  const alerts = screen.getByRole("alert").all();
  expect(alerts).toHaveLength(2);
  await expect.element(alerts[0]!).toHaveTextContent("A save operation failed.");
});

test("does not reopen stale failure details when a later save fails", async () => {
  let failureIndex = 0;
  const onSaveEdits = vi.fn(() => {
    failureIndex += 1;
    return Promise.reject(new Error(`Failure ${String(failureIndex)}.`));
  });
  const renderTable = (sourceRows: readonly Row[], version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_FAILURE_DETAILS_GENERATION"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: sourceRows.length, version, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(rows, 1));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_FAILURE_DETAILS_GENERATION" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Open Operation details for the complete explanation.");
  await userEvent.click(screen.getByRole("button", { name: "Operation details" }));
  const details = screen.getByRole("alertdialog", { name: "Save operation details" });
  await expect.element(details).toBeVisible();

  const convergedRows = [{ id: "ada", name: "Augusta", revision: 2n }] as const;
  await screen.rerender(renderTable(convergedRows, 2));
  await expect.element(details).not.toBeInTheDocument();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Ada");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Open Operation details for the complete explanation.");
  await expect.element(details).not.toBeInTheDocument();
});

test("normalizes a synchronous save throw and releases Immediate locks", async () => {
  const onSaveEdits = vi.fn(() => {
    throw new Error("The save handler threw synchronously.");
  });
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_SYNCHRONOUS_SAVE_THROW"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />,
  );
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SYNCHRONOUS_SAVE_THROW" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Open Operation details for the complete explanation.");
  await expect
    .element(grid.getByRole("gridcell", { name: "Ada", exact: true }))
    .not.toHaveAttribute("aria-busy");
});

test("contains a hostile rejection message and still releases Immediate locks", async () => {
  const hostile = Object.create(Error.prototype, {
    message: {
      get(): never {
        throw new Error("message getter failed");
      },
    },
  }) as Error;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_HOSTILE_SAVE_REJECTION"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() => Promise.reject(hostile)}
    />,
  );
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_HOSTILE_SAVE_REJECTION" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Open Operation details for the complete explanation.");
  await expect
    .element(grid.getByRole("gridcell", { name: "Ada", exact: true }))
    .not.toHaveAttribute("aria-busy");
});

test("clears Batch rejection presentation and notification on Reset", async () => {
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_BATCH_FAILURE_RESET"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() => Promise.reject(new Error("Batch save was not confirmed."))}
    />,
  );
  await userEvent.click(screen.getByRole("switch", { name: "Batch editing" }));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_BATCH_FAILURE_RESET" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Open Operation details for the complete explanation.");

  await userEvent.click(screen.getByRole("button", { name: "Reset edits" }));
  const resetDialog = screen.getByRole("alertdialog", { name: "Reset Review" });
  await expect.element(resetDialog).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Reset All Changes" }));

  await expect.element(resetDialog).not.toBeInTheDocument();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await expect
    .element(grid.getByRole("gridcell", { name: "Ada", exact: true }))
    .not.toHaveAttribute("data-bruno-save-failed");
});

test("ignores a late save settlement after table disposal", async () => {
  let resolveSave!: () => void;
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_LATE_SAVE_SETTLEMENT"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={() =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
      }
    />,
  );
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_LATE_SAVE_SETTLEMENT" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await screen.unmount();
  const unhandled: unknown[] = [];
  const captureUnhandled = (event: PromiseRejectionEvent) => unhandled.push(event.reason);
  window.addEventListener("unhandledrejection", captureUnhandled);
  try {
    resolveSave();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(unhandled).toEqual([]);
  } finally {
    window.removeEventListener("unhandledrejection", captureUnhandled);
  }
});

test("clears only an ambiguous failure whose submitted values later converge", async () => {
  const onSaveEdits = vi.fn(() => Promise.reject(new Error("Save outcome is unknown.")));
  const renderTable = (sourceRows: readonly Row[], version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_AMBIGUOUS_FAILURE_CONVERGENCE"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: sourceRows.length, version, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(rows, 1));
  const grid = screen.getByRole("grid", {
    name: "Data for TABLE_ID_AMBIGUOUS_FAILURE_CONVERGENCE",
  });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Open Operation details for the complete explanation.");
  await expect
    .element(grid.getByRole("gridcell", { name: "Ada", exact: true }))
    .toHaveAttribute("data-bruno-save-failed");

  const convergedRows = [{ id: "ada", name: "Augusta", revision: 2n }] as const;
  await screen.rerender(renderTable(convergedRows, 2));

  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .not.toHaveAttribute("data-bruno-save-failed");
  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .toHaveAttribute("data-bruno-save-success");
});

test("does not retain a failure when the live source converges before rejection", async () => {
  let rejectSave!: (reason: Error) => void;
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const renderTable = (sourceRows: readonly Row[], version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_CONVERGENCE_BEFORE_REJECTION"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: sourceRows.length, version, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(rows, 1));
  const batchEditing = screen.getByRole("switch", { name: "Batch editing" });
  const grid = screen.getByRole("grid", {
    name: "Data for TABLE_ID_CONVERGENCE_BEFORE_REJECTION",
  });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  await expect.element(batchEditing).toBeDisabled();

  const convergedRows = [{ id: "ada", name: "Augusta", revision: 2n }] as const;
  await screen.rerender(renderTable(convergedRows, 2));
  rejectSave(new Error("The application raced with the source."));

  await expect.element(batchEditing).toBeEnabled();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await expect
    .element(grid.getByRole("gridcell", { name: "Augusta", exact: true }))
    .not.toHaveAttribute("data-bruno-save-failed");
});

test("keeps an in-flight save owned when the latest onSaveEdits callback changes", async () => {
  let resolveFirst!: () => void;
  const firstSave = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveFirst = resolve;
      }),
  );
  const nextSave = vi.fn(() => Promise.resolve());
  const renderTable = (
    sourceRows: readonly Row[],
    version: number,
    onSaveEdits: typeof firstSave | typeof nextSave,
  ) => (
    <BrunoTableClient
      tableId="TABLE_ID_SAVE_CALLBACK_REPLACEMENT"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: sourceRows, totalRows: sourceRows.length, version, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(rows, 1, firstSave));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_SAVE_CALLBACK_REPLACEMENT" });
  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Augusta");
  await userEvent.keyboard("{Enter}");

  await screen.rerender(renderTable(rows, 1, nextSave));
  resolveFirst();
  const confirmedRows = [{ id: "ada", name: "Augusta", revision: 2n }] as const;
  await screen.rerender(renderTable(confirmedRows, 2, nextSave));

  await expect.element(screen.getByRole("switch", { name: "Batch editing" })).toBeEnabled();
  expect(firstSave).toHaveBeenCalledOnce();
  expect(nextSave).not.toHaveBeenCalled();

  grid.element().focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Name" }), "Amazing Grace");
  await userEvent.keyboard("{Enter}");
  expect(nextSave).toHaveBeenCalledOnce();
});

test("keeps concurrent same-row Immediate operations isolated by Cell Identity", async () => {
  type ContactRow = Readonly<{
    readonly id: string;
    readonly first: string;
    readonly last: string;
    readonly revision: bigint;
  }>;
  const contactColumns = [
    {
      columnId: "COL_ID_FIRST",
      field: "first",
      headerName: "First",
      valueType: "text",
      isEditable: true,
    },
    {
      columnId: "COL_ID_LAST",
      field: "last",
      headerName: "Last",
      valueType: "text",
      isEditable: true,
    },
  ] satisfies BrunoTableColumns<ContactRow>;
  const initialRows = [{ id: "ada", first: "Ada", last: "Lovelace", revision: 1n }] as const;
  const settlements: Array<Readonly<{ resolve: () => void; reject: (reason: Error) => void }>> = [];
  const onSaveEdits = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settlements.push({ resolve, reject });
      }),
  );
  const renderTable = (sourceRows: readonly ContactRow[], version: number) => (
    <BrunoTableClient
      tableId="TABLE_ID_IMMEDIATE_CONCURRENCY"
      columns={contactColumns}
      initialOrderBy={[{ columnId: "COL_ID_FIRST", direction: "asc" }]}
      clientSource={{
        rows: sourceRows,
        totalRows: sourceRows.length,
        version,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />
  );
  const screen = await render(renderTable(initialRows, 1));
  const grid = screen.getByRole("grid", { name: "Data for TABLE_ID_IMMEDIATE_CONCURRENCY" });
  const first = grid.getByRole("gridcell", { name: "Ada", exact: true });
  await userEvent.click(first);
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit First" }), "Augusta");
  await userEvent.keyboard("{Enter}");
  const pendingFirst = grid.getByRole("gridcell", { name: "Augusta", exact: true });
  await userEvent.click(pendingFirst);
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("textbox", { name: "Edit First" })).not.toBeInTheDocument();
  const last = grid.getByRole("gridcell", { name: "Lovelace", exact: true });
  await userEvent.click(last);
  await userEvent.keyboard("{Enter}");
  await userEvent.fill(screen.getByRole("textbox", { name: "Edit Last" }), "Byron");
  await userEvent.keyboard("{Enter}");

  expect(onSaveEdits).toHaveBeenCalledTimes(2);
  expect(onSaveEdits).toHaveBeenNthCalledWith(1, [
    {
      rowId: "ada",
      baseRow: initialRows[0],
      expectedVersion: 1n,
      changes: [{ columnId: "COL_ID_FIRST", field: "first", before: "Ada", after: "Augusta" }],
    },
  ]);
  expect(onSaveEdits).toHaveBeenNthCalledWith(2, [
    {
      rowId: "ada",
      baseRow: initialRows[0],
      expectedVersion: 1n,
      changes: [{ columnId: "COL_ID_LAST", field: "last", before: "Lovelace", after: "Byron" }],
    },
  ]);
  await expect
    .element(screen.getByRole("region", { name: "Edit safety" }))
    .toHaveTextContent("2 Immediate saves pending");

  settlements[0]!.resolve();
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();
  await expect.element(grid.getByRole("gridcell", { name: "Byron", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Edit safety" }))
    .toHaveTextContent(
      "1 Immediate save pending · 1 Immediate save accepted · waiting for live confirmation",
    );
  await expect.element(screen.getByRole("switch", { name: "Batch editing" })).toBeDisabled();

  const firstConfirmed = [{ id: "ada", first: "Augusta", last: "Lovelace", revision: 2n }] as const;
  await screen.rerender(renderTable(firstConfirmed, 2));
  await expect.element(screen.getByRole("switch", { name: "Batch editing" })).toBeDisabled();

  settlements[1]!.reject(new Error("Second save rejected"));
  await expect.element(screen.getByRole("switch", { name: "Batch editing" })).toBeEnabled();
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
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeEnabled();
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
  const onSaveEdits = vi.fn(() => Promise.resolve());
  const screen = await render(
    <BrunoTableClient
      tableId="TABLE_ID_BLOCKED_DRAFT"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
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
      clientSource={{ rows: [] as readonly Row[], totalRows: 0, version: 2, status: "loading" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />,
  );
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("1 unsaved change");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  await screen.rerender(
    <BrunoTableClient
      tableId="TABLE_ID_BLOCKED_DRAFT"
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={{ rows: [] as readonly Row[], totalRows: 0, version: 3, status: "ready" }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
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
        version: 4,
        status: "ready",
      }}
      getRowId={(row) => row.id}
      editable
      getRowVersion={(row) => row.revision}
      onSaveEdits={onSaveEdits}
    />,
  );
  expect(
    screen
      .getByRole("region", { name: "Edit safety" })
      .element()
      .querySelector('[aria-live="polite"]'),
  ).toHaveTextContent("1 unsaved change");
  await expect.element(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  await expect.element(grid.getByRole("gridcell", { name: "Augusta", exact: true })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSaveEdits).toHaveBeenCalledOnce();
  expect(onSaveEdits).toHaveBeenNthCalledWith(1, [
    {
      rowId: "ada",
      baseRow: returnedRows[0],
      expectedVersion: 3n,
      changes: [
        {
          columnId: "COL_ID_NAME",
          field: "name",
          before: "Ada",
          after: "Augusta",
        },
      ],
    },
  ]);
});
