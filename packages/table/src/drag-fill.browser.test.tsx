import { afterEach, expect, test, vi } from "vite-plus/test";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { BrunoTableClient } from "./index";
import { settleBrunoTableBrowserFrames } from "./internal/browser-test-helpers";
import type { BrunoTableColumns } from "./public-types";

type Row = Readonly<{
  readonly id: string;
  readonly first: string;
  readonly second: string;
  readonly third: string;
  readonly fourth: string;
  readonly revision: bigint;
}>;

const columns = [
  {
    columnId: "COL_ID_FIRST",
    field: "first",
    headerName: "First",
    valueType: "text",
    width: 80,
    isEditable: true,
  },
  {
    columnId: "COL_ID_SECOND",
    field: "second",
    headerName: "Second",
    valueType: "text",
    width: 80,
    isEditable: true,
  },
  {
    columnId: "COL_ID_THIRD",
    field: "third",
    headerName: "Third",
    valueType: "text",
    width: 80,
    isEditable: true,
  },
  {
    columnId: "COL_ID_FOURTH",
    field: "fourth",
    headerName: "Fourth",
    valueType: "text",
    width: 80,
    isEditable: true,
  },
] as const satisfies BrunoTableColumns<Row>;

const rejectionColumns = [
  columns[0],
  {
    ...columns[1],
    validate: ({ value }: { readonly value: string }) =>
      value === "alpha" ? "Second cannot repeat alpha." : undefined,
  },
  columns[2],
  columns[3],
] satisfies BrunoTableColumns<Row>;

const rows = [
  {
    id: "row-1",
    first: "alpha",
    second: "beta",
    third: "third",
    fourth: "fourth",
    revision: 1n,
  },
] satisfies readonly Row[];

function centerOf(element: Element): Readonly<{ x: number; y: number }> {
  const bounds = element.getBoundingClientRect();
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

function pointer(
  type: "pointerdown" | "pointermove" | "pointerup",
  pointerId: number,
  point: Readonly<{ x: number; y: number }>,
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: point.x,
    clientY: point.y,
    pointerId,
  });
}

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

test("repeats an editable Client linear range through one Batch Drag Fill gesture", async () => {
  const onSaveEdits = vi.fn(() => Promise.resolve());
  await render(
    <div style={{ width: 480 }}>
      <BrunoTableClient
        tableId="TABLE_ID_DRAG_FILL_PRODUCTION"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_FIRST", direction: "asc" }]}
        clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={onSaveEdits}
      />
    </div>,
  );
  await userEvent.click(page.getByRole("switch", { name: "Batch editing" }));
  const grid = page.getByRole("grid", { name: "Data for TABLE_ID_DRAG_FILL_PRODUCTION" });
  grid.element().focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await settleBrunoTableBrowserFrames();

  const handle = grid.element().querySelector<HTMLElement>("[data-bruno-drag-fill-handle]");
  expect(handle).not.toBeNull();
  const fourth = grid
    .getByRole("gridcell", { name: "fourth", exact: true })
    .element() as HTMLElement;
  handle!.dispatchEvent(pointer("pointerdown", 91, centerOf(handle!)));
  fourth.dispatchEvent(pointer("pointermove", 91, centerOf(fourth)));
  await settleBrunoTableBrowserFrames();
  fourth.dispatchEvent(pointer("pointerup", 91, centerOf(fourth)));

  await vi.waitFor(() => {
    expect(grid.getByRole("gridcell", { name: "alpha", exact: true }).all()).toHaveLength(2);
    expect(grid.getByRole("gridcell", { name: "beta", exact: true }).all()).toHaveLength(2);
  });
  expect(onSaveEdits).not.toHaveBeenCalled();
});

test("keeps Drag Fill layout reads out of the hot pointer frame", async () => {
  await render(
    <div style={{ width: 320 }}>
      <BrunoTableClient
        tableId="TABLE_ID_DRAG_FILL_LAYOUT_READS"
        columns={columns}
        initialOrderBy={[{ columnId: "COL_ID_FIRST", direction: "asc" }]}
        clientSource={{ rows, totalRows: rows.length, version: 1, status: "ready" }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={() => Promise.resolve()}
      />
    </div>,
  );
  const grid = page.getByRole("grid", { name: "Data for TABLE_ID_DRAG_FILL_LAYOUT_READS" });
  const gridElement = grid.element() as HTMLElement;
  gridElement.focus();
  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  await settleBrunoTableBrowserFrames();

  expect(grid.element()).toBe(gridElement);
  expect(document.activeElement).toBe(gridElement);
  const handle = gridElement.querySelector<HTMLElement>("[data-bruno-drag-fill-handle]");
  expect(handle).not.toBeNull();
  const fourth = grid.getByRole("gridcell", { name: "fourth", exact: true }).element();
  const handleCenter = centerOf(handle!);
  const fourthCenter = centerOf(fourth);
  const gridBounds = gridElement.getBoundingClientRect();
  handle!.dispatchEvent(pointer("pointerdown", 92, handleCenter));

  const gridBoundsRead = vi.spyOn(gridElement, "getBoundingClientRect");
  const selectorRead = vi.spyOn(gridElement, "querySelectorAll");
  const directionRead = vi.spyOn(window, "getComputedStyle");
  fourth.dispatchEvent(
    pointer("pointermove", 92, {
      x: gridBounds.right - 2,
      y: fourthCenter.y,
    }),
  );
  await settleBrunoTableBrowserFrames();

  expect(gridBoundsRead).toHaveBeenCalledTimes(1);
  expect(
    selectorRead.mock.calls.some(([selector]) =>
      String(selector).includes("COL_ID_BRUNO_TABLE_ROW_SELECTION"),
    ),
  ).toBe(false);
  expect(directionRead).not.toHaveBeenCalled();
});

test("retains a Drag Fill rejection across ready and loading body transitions", async () => {
  const onSaveEdits = vi.fn(() => Promise.resolve());
  const renderTable = (status: "loading" | "ready", version: number) => (
    <div style={{ width: 480 }}>
      <BrunoTableClient
        tableId="TABLE_ID_DRAG_FILL_PERSISTENT_REJECTION"
        columns={rejectionColumns}
        initialOrderBy={[{ columnId: "COL_ID_FIRST", direction: "asc" }]}
        clientSource={{
          rows: status === "ready" ? rows : [],
          totalRows: rows.length,
          version,
          status,
        }}
        getRowId={(row) => row.id}
        editable
        getRowVersion={(row) => row.revision}
        onSaveEdits={onSaveEdits}
      />
    </div>
  );
  const screen = await render(renderTable("ready", 1));
  const grid = screen.getByRole("grid", {
    name: "Data for TABLE_ID_DRAG_FILL_PERSISTENT_REJECTION",
  });
  const source = grid.getByRole("gridcell", { name: "alpha", exact: true }).element();
  const destination = grid.getByRole("gridcell", { name: "beta", exact: true }).element();
  source.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settleBrunoTableBrowserFrames();
  const handle = grid.element().querySelector<HTMLElement>("[data-bruno-drag-fill-handle]");
  if (handle === null) throw new Error("Expected an active-cell Drag Fill handle.");
  handle.dispatchEvent(pointer("pointerdown", 93, centerOf(handle)));
  destination.dispatchEvent(pointer("pointermove", 93, centerOf(destination)));
  await settleBrunoTableBrowserFrames();
  destination.dispatchEvent(pointer("pointerup", 93, centerOf(destination)));
  const rejectionIsVisible = () =>
    screen
      .getByRole("region", { name: "Notifications", exact: true })
      .all()
      .some((region) => region.element().textContent?.includes("Second cannot repeat alpha."));
  await vi.waitFor(() => expect(rejectionIsVisible()).toBe(true));

  await screen.rerender(renderTable("loading", 2));
  await vi.waitFor(() => expect(rejectionIsVisible()).toBe(true));
  await expect
    .element(screen.getByRole("button", { name: "Close toast", exact: true }))
    .toBeVisible();
  await screen.rerender(renderTable("ready", 3));
  await vi.waitFor(() => expect(rejectionIsVisible()).toBe(true));
  expect(onSaveEdits).not.toHaveBeenCalled();
});
