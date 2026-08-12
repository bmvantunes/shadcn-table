import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { BrunoTableClient } from "./index";
import {
  installBrunoTableClientCellRenderListener,
  installBrunoTableClientGridSurfaceRenderListener,
  installBrunoTableClientColumnReorderFrameListener,
  installBrunoTableClientColumnPreviewStyleWriteListener,
  installBrunoTableClientColumnResizeFrameListener,
  installBrunoTableClientHeaderRenderListener,
  installBrunoTableClientRowOrderPlanningListener,
  installBrunoTableClientViewRenderListener,
} from "./internal/render-instrumentation";

type Row = Readonly<{
  id: string;
  name: string;
  score: number;
  status: string;
}>;

const columns = [
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_SCORE",
    field: "score",
    headerName: "Score",
    valueType: "number",
    width: 96,
  },
  {
    columnId: "COL_ID_STATUS",
    field: "status",
    headerName: "Status",
    valueType: "text",
    width: 140,
  },
] as const;

const rows: readonly Row[] = [
  { id: "ada", name: "Ada", score: 4, status: "Ready" },
  { id: "grace", name: "Grace", score: 2, status: "Queued" },
];

const source = {
  rows,
  totalRows: rows.length,
  version: 1,
  status: "ready" as const,
};

const tableProps = {
  tableId: "TABLE_ID_COLUMN_MANAGEMENT",
  getRowId: (row: Row) => row.id,
  columns,
  initialOrderBy: [{ columnId: "COL_ID_SCORE", direction: "asc" }],
  clientSource: source,
} as const;

const manyColumns = [
  ...columns,
  {
    columnId: "COL_ID_EXTRA_1",
    field: "name",
    headerName: "Extra 1",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_EXTRA_2",
    field: "name",
    headerName: "Extra 2",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_EXTRA_3",
    field: "name",
    headerName: "Extra 3",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_EXTRA_4",
    field: "name",
    headerName: "Extra 4",
    valueType: "text",
    width: 160,
  },
  {
    columnId: "COL_ID_EXTRA_5",
    field: "name",
    headerName: "Extra 5",
    valueType: "text",
    width: 160,
  },
] as const;

const interleavedColumns = [
  columns[0]!,
  { ...columns[2]!, pinned: "end" as const },
  { ...columns[1]!, pinned: "start" as const },
] as const;

afterEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
});

describe("BrunoTable column management browser surface", () => {
  test("provides grouped layout menus for pinning, moving, visibility, and reset", async () => {
    const screen = await render(<BrunoTableClient<Row, typeof columns> {...tableProps} />);
    const menuTrigger = screen.getByRole("button", { name: "Column menu for Name" });

    screen
      .getByRole("button", { name: "Sort by Name" })
      .element()
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(screen.getByRole("menuitem", { name: "Move" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(menuTrigger);
    await expect
      .element(screen.getByRole("menuitem", { name: "Sort by Name" }))
      .toBeInTheDocument();
    await expect.element(screen.getByRole("menuitem", { name: "Move" })).toBeInTheDocument();
    await expect.element(screen.getByRole("menuitem", { name: "Visibility" })).toBeInTheDocument();
    await expect.element(screen.getByRole("menuitem", { name: "Reset" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitemradio", { name: "Pin to logical start" }));
    await vi.waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: /Name, width 160 pixels, pinned start/u }),
      ).toBeInTheDocument(),
    );
    await expect
      .element(screen.getByRole("columnheader", { name: /Name, width 160 pixels, pinned start/u }))
      .toHaveAttribute("data-pinned-region", "start");

    await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
    await userEvent.hover(screen.getByRole("menuitem", { name: "Visibility" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Score" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("grid").element().getAttribute("aria-colcount")).toBe("2"),
    );
    await expect.element(screen.getByRole("columnheader", { name: /Name/u })).toBeInTheDocument();
    await expect.element(screen.getByRole("columnheader", { name: /Status/u })).toBeInTheDocument();
    await expect
      .element(screen.getByRole("columnheader", { name: /Score/u }))
      .not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Column menu for Name" }).element(),
      ),
    );
  });

  test("keeps logical menu commands correct in RTL and cancels an active pointer gesture", async () => {
    const screen = await render(
      <div dir="rtl">
        <BrunoTableClient<Row, typeof columns>
          {...tableProps}
          tableId="TABLE_ID_COLUMN_MANAGEMENT_RTL"
        />
      </div>,
    );
    const grid = screen.getByRole("grid").element();
    const nameMenu = screen.getByRole("button", { name: "Column menu for Name" });
    await userEvent.click(nameMenu);
    await userEvent.hover(screen.getByRole("menuitem", { name: "Move" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Move toward logical end" }));
    await vi.waitFor(() =>
      expect(
        [...grid.querySelectorAll<HTMLElement>("th[data-bruno-column-id]")].map(
          (header) => header.dataset["brunoColumnId"],
        ),
      ).toEqual(["COL_ID_SCORE", "COL_ID_NAME", "COL_ID_STATUS"]),
    );

    await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Pin to logical end" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("columnheader", { name: /Name/u })).toHaveAttribute(
        "data-pinned-region",
        "end",
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Unpin" }));
    await vi.waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: /Name, width 160 pixels/u }),
      ).not.toHaveAttribute("data-pinned-region", "end"),
    );

    const resizeHandle = screen.getByRole("separator", { name: "Resize Name" }).element();
    resizeHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        pointerId: 12,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 180, pointerId: 12 }),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("separator", { name: "Resize Name" })).toHaveAttribute(
        "aria-valuenow",
        "160",
      ),
    );
    const secondResizeHandle = screen.getByRole("separator", { name: "Resize Name" }).element();
    secondResizeHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        pointerId: 13,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 180, pointerId: 13 }),
    );
    window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 13 }));
    await vi.waitFor(() =>
      expect(screen.getByRole("separator", { name: "Resize Name" })).toHaveAttribute(
        "aria-valuenow",
        "160",
      ),
    );
    await screen.rerender(<></>);
  });

  test("uses RTL direction for keyboard submenu navigation", async () => {
    const screen = await render(
      <div dir="rtl">
        <BrunoTableClient<Row, typeof columns>
          {...tableProps}
          tableId="TABLE_ID_COLUMN_MANAGEMENT_RTL_MENU_KEYBOARD"
        />
      </div>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
    const move = screen.getByRole("menuitem", { name: "Move" });
    move.element().focus();
    await userEvent.keyboard("{ArrowLeft}");

    await expect
      .element(screen.getByRole("menuitem", { name: "Move toward logical start" }))
      .toBeInTheDocument();
  });

  test("pointer reorder crosses into a pinned region atomically", async () => {
    const screen = await render(
      <BrunoTableClient<Row, typeof interleavedColumns>
        tableId="TABLE_ID_COLUMN_MANAGEMENT_POINTER_PIN"
        getRowId={(row: Row) => row.id}
        columns={interleavedColumns}
        initialOrderBy={tableProps.initialOrderBy}
        clientSource={source}
      />,
    );
    const grid = screen.getByRole("grid").element();
    const nameHandle = screen.getByRole("button", { name: "Reorder Name" }).element();
    const statusHeader = screen.getByRole("columnheader", { name: /Status/u }).element();
    const startX = nameHandle.getBoundingClientRect().left + 1;
    const dropX = statusHeader.getBoundingClientRect().right + 24;

    nameHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: startX,
        pointerId: 21,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: dropX,
        pointerId: 21,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: dropX,
        pointerId: 21,
      }),
    );

    await vi.waitFor(() => {
      expect(
        [...grid.querySelectorAll<HTMLElement>("th[data-bruno-column-id]")].map(
          (header) => header.dataset["brunoColumnId"],
        ),
      ).toEqual(["COL_ID_SCORE", "COL_ID_STATUS", "COL_ID_NAME"]);
      expect(
        screen.getByRole("columnheader", { name: /Name, width 160 pixels, pinned end/u }),
      ).toHaveAttribute("data-pinned-region", "end");
    });
  });

  test("keeps pointer reorder boundaries logical in RTL", async () => {
    const screen = await render(
      <div dir="rtl">
        <BrunoTableClient<Row, typeof columns>
          {...tableProps}
          tableId="TABLE_ID_COLUMN_MANAGEMENT_RTL_POINTER"
        />
      </div>,
    );
    const grid = screen.getByRole("grid").element();
    const columnOrder = () =>
      [...grid.querySelectorAll<HTMLElement>("th[data-bruno-column-id]")].map(
        (header) => header.dataset["brunoColumnId"],
      );
    const nameHandle = screen.getByRole("button", { name: "Reorder Name" }).element();
    const gridRect = grid.getBoundingClientRect();
    const handleRect = nameHandle.getBoundingClientRect();
    nameHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: handleRect.left + handleRect.width / 2,
        pointerId: 14,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: gridRect.left - 20,
        pointerId: 14,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: gridRect.left - 20,
        pointerId: 14,
      }),
    );
    await vi.waitFor(() =>
      expect(columnOrder()).toEqual(["COL_ID_SCORE", "COL_ID_STATUS", "COL_ID_NAME"]),
    );
  });

  test("keeps simultaneous pinned regions and visibility in one logical order", async () => {
    const screen = await render(
      <BrunoTableClient<Row, typeof interleavedColumns>
        tableId="TABLE_ID_COLUMN_MANAGEMENT_PINNED"
        getRowId={(row: Row) => row.id}
        columns={interleavedColumns}
        initialOrderBy={tableProps.initialOrderBy}
        clientSource={source}
      />,
    );
    const grid = screen.getByRole("grid").element();
    const columnOrder = () =>
      [...grid.querySelectorAll<HTMLElement>("th[data-bruno-column-id]")].map(
        (header) => header.dataset["brunoColumnId"],
      );

    expect(columnOrder()).toEqual(["COL_ID_SCORE", "COL_ID_NAME", "COL_ID_STATUS"]);
    await expect
      .element(screen.getByRole("columnheader", { name: /Score/u }))
      .toHaveAttribute("data-pinned-region", "start");
    await expect
      .element(screen.getByRole("columnheader", { name: /Status/u }))
      .toHaveAttribute("data-pinned-region", "end");

    await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Pin to logical start" }));
    await vi.waitFor(() =>
      expect(columnOrder()).toEqual(["COL_ID_SCORE", "COL_ID_NAME", "COL_ID_STATUS"]),
    );
    await expect
      .element(screen.getByRole("columnheader", { name: /Name, width 160 pixels, pinned start/u }))
      .toHaveAttribute("data-pinned-region", "start");

    await userEvent.click(screen.getByRole("button", { name: "Column menu for Score" }));
    await userEvent.hover(screen.getByRole("menuitem", { name: "Visibility" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Score" }));
    await vi.waitFor(() => expect(grid.getAttribute("aria-colcount")).toBe("2"));
    expect(columnOrder()).toEqual(["COL_ID_NAME", "COL_ID_STATUS"]);
    await vi.waitFor(() =>
      expect(grid.getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("columnheader", { name: /Name, width 160 pixels/u }).element().id,
      ),
    );
    await expect
      .element(screen.getByRole("columnheader", { name: /Score/u }))
      .not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Sort" })).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Unpin" }));
    await vi.waitFor(() =>
      expect(
        screen.getByRole("columnheader", { name: /Name, width 160 pixels/u }),
      ).not.toHaveAttribute("data-pinned-region", "start"),
    );
    await expect
      .element(screen.getByRole("columnheader", { name: /Status, width 140 pixels, pinned end/u }))
      .toHaveAttribute("data-pinned-region", "end");
  });

  test("supports keyboard resize and rejects hiding the final visible column", async () => {
    const screen = await render(<BrunoTableClient<Row, typeof columns> {...tableProps} />);
    const resizeHandle = screen.getByRole("separator", { name: "Resize Name" });
    resizeHandle.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(screen.getByRole("separator", { name: "Resize Name" }))
      .toHaveAttribute("aria-valuenow", "170");
    await userEvent.keyboard("{Home}");
    await expect
      .element(screen.getByRole("separator", { name: "Resize Name" }))
      .toHaveAttribute("aria-valuenow", "32");
    await userEvent.keyboard("{End}");
    await expect
      .element(screen.getByRole("separator", { name: "Resize Name" }))
      .toHaveAttribute("aria-valuenow", "1000");
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(screen.getByRole("separator", { name: "Resize Name" }))
      .toHaveAttribute("aria-valuenow", "1000");

    const nameMenu = screen.getByRole("button", { name: "Column menu for Name" });
    await userEvent.click(nameMenu);
    await userEvent.hover(screen.getByRole("menuitem", { name: "Visibility" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Score" }));
    await userEvent.hover(screen.getByRole("menuitem", { name: "Visibility" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Status" }));

    await expect
      .element(screen.getByRole("menuitemcheckbox", { name: "Name" }))
      .toHaveAttribute("aria-disabled", "true");
    await expect.element(screen.getByRole("grid")).toHaveAttribute("aria-colcount", "1");
  });

  test("resizes by logical direction in RTL for the handle and grid shortcut", async () => {
    const screen = await render(
      <div dir="rtl">
        <BrunoTableClient<Row, typeof columns>
          {...tableProps}
          tableId="TABLE_ID_COLUMN_MANAGEMENT_RTL_RESIZE"
        />
      </div>,
    );
    const resizeHandle = screen.getByRole("separator", { name: "Resize Name" });
    resizeHandle.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(resizeHandle).toHaveAttribute("aria-valuenow", "150");
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(resizeHandle).toHaveAttribute("aria-valuenow", "160");

    const grid = screen.getByRole("grid").element();
    grid.focus();
    grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { altKey: true, bubbles: true, key: "ArrowRight" }),
    );
    await expect.element(resizeHandle).toHaveAttribute("aria-valuenow", "150");
  });

  test("exposes the active header resize handle as a keyboard tab stop", async () => {
    const screen = await render(<BrunoTableClient<Row, typeof columns> {...tableProps} />);
    const grid = screen.getByRole("grid").element();
    grid.focus();
    grid.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    const resizeHandle = screen.getByRole("separator", { name: "Resize Name" });
    await vi.waitFor(() => expect(resizeHandle.element().tabIndex).toBe(0));
    expect(resizeHandle.element().getAttribute("aria-keyshortcuts")).toBe(
      "ArrowLeft ArrowRight Home End",
    );
  });

  test("resets the complete layout atomically without changing sorting", async () => {
    const screen = await render(<BrunoTableClient<Row, typeof columns> {...tableProps} />);
    const grid = screen.getByRole("grid").element();
    const columnOrder = () =>
      [...grid.querySelectorAll<HTMLElement>("th[data-bruno-column-id]")].map(
        (header) => header.dataset["brunoColumnId"],
      );

    const resizeHandle = screen.getByRole("separator", { name: "Resize Name" }).element();
    resizeHandle.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(resizeHandle).toHaveAttribute("aria-valuenow", "170");

    await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Pin to logical start" }));
    await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
    await userEvent.hover(screen.getByRole("menuitem", { name: "Visibility" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Score" }));

    await vi.waitFor(() => expect(grid.getAttribute("aria-colcount")).toBe("2"));
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Sort" })).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Column menu for Name" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Reset" })).toBeInTheDocument(),
    );
    await userEvent.hover(screen.getByRole("menuitem", { name: "Reset" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Reset complete layout" }));

    await vi.waitFor(() =>
      expect(columnOrder()).toEqual(["COL_ID_NAME", "COL_ID_SCORE", "COL_ID_STATUS"]),
    );
    await expect.element(grid).toHaveAttribute("aria-colcount", "3");
    await expect
      .element(screen.getByRole("separator", { name: "Resize Name" }))
      .toHaveAttribute("aria-valuenow", "160");
    await expect
      .element(screen.getByRole("columnheader", { name: /Name, width 160 pixels/u }))
      .not.toHaveAttribute("data-pinned-region", "start");
    await expect
      .element(
        screen.getByRole("button", { name: "Sort by Score, currently ascending, priority 1" }),
      )
      .toBeInTheDocument();
  });

  test("commits one pointer resize and one pointer reorder after rAF previews", async () => {
    const resizeFrames = vi.fn();
    const reorderFrames = vi.fn();
    const previewStyleWrites = vi.fn();
    const viewRenders = vi.fn();
    const gridSurfaceRenders = vi.fn();
    const headerRenders = vi.fn();
    const cellRenders = vi.fn();
    const rowOrderPlans = vi.fn();
    const removeResize = installBrunoTableClientColumnResizeFrameListener(resizeFrames);
    const removeReorder = installBrunoTableClientColumnReorderFrameListener(reorderFrames);
    const removePreviewStyleWrites =
      installBrunoTableClientColumnPreviewStyleWriteListener(previewStyleWrites);
    const removeView = installBrunoTableClientViewRenderListener(viewRenders);
    const removeGridSurface = installBrunoTableClientGridSurfaceRenderListener(gridSurfaceRenders);
    const removeHeader = installBrunoTableClientHeaderRenderListener(headerRenders);
    const removeRowOrderPlans = installBrunoTableClientRowOrderPlanningListener(rowOrderPlans);
    const removeCells = installBrunoTableClientCellRenderListener(cellRenders);
    try {
      const screen = await render(<BrunoTableClient<Row, typeof columns> {...tableProps} />);
      const grid = screen.getByRole("grid").element();
      const viewRendersBeforeGesture = viewRenders.mock.calls.length;
      const gridSurfaceRendersBeforeGesture = gridSurfaceRenders.mock.calls.length;
      const headerRendersBeforeGesture = headerRenders.mock.calls.length;
      const cellRendersBeforeGesture = cellRenders.mock.calls.length;
      const rowOrderPlansBeforeGesture = rowOrderPlans.mock.calls.length;
      const resizeHandle = screen.getByRole("separator", { name: "Resize Name" }).element();
      resizeHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          pointerId: 7,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 120,
          pointerId: 7,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 140,
          pointerId: 7,
        }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(viewRenders.mock.calls.length).toBe(viewRendersBeforeGesture);
      expect(gridSurfaceRenders.mock.calls.length).toBe(gridSurfaceRendersBeforeGesture);
      expect(headerRenders.mock.calls.length).toBe(headerRendersBeforeGesture);
      expect(cellRenders.mock.calls.length).toBe(cellRendersBeforeGesture);
      expect(previewStyleWrites).toHaveBeenCalled();
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 140,
          pointerId: 7,
        }),
      );
      await expect
        .element(screen.getByRole("separator", { name: "Resize Name" }))
        .toHaveAttribute("aria-valuenow", "200");
      expect(resizeFrames).toHaveBeenCalledTimes(1);
      expect(rowOrderPlans.mock.calls.length).toBe(rowOrderPlansBeforeGesture);

      const reorderHandle = screen.getByRole("button", { name: "Reorder Status" }).element();
      reorderHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          pointerId: 8,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 0,
          pointerId: 8,
        }),
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const reorderTarget = grid.querySelector<HTMLElement>("[data-bruno-reorder-target]");
      expect(reorderTarget).not.toBeNull();
      expect(reorderTarget?.style.outline).toContain("dashed");
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: 0,
          pointerId: 8,
        }),
      );
      await vi.waitFor(() => expect(reorderFrames).toHaveBeenCalledTimes(1));
    } finally {
      removeResize();
      removeReorder();
      removePreviewStyleWrites();
      removeView();
      removeGridSurface();
      removeHeader();
      removeRowOrderPlans();
      removeCells();
    }
  });

  test("commits the final rightward reorder before the next frame and cancels on Escape", async () => {
    const reorderFrames = vi.fn();
    const removeReorder = installBrunoTableClientColumnReorderFrameListener(reorderFrames);
    try {
      const screen = await render(<BrunoTableClient<Row, typeof columns> {...tableProps} />);
      const grid = screen.getByRole("grid").element();
      const columnOrder = () =>
        [...grid.querySelectorAll<HTMLElement>("th[data-bruno-column-id]")].map(
          (header) => header.dataset["brunoColumnId"],
        );
      const nameHandle = screen.getByRole("button", { name: "Reorder Name" }).element();
      const scoreHeader = screen.getByRole("columnheader", { name: /Score/u }).element();
      const scoreRect = scoreHeader.getBoundingClientRect();
      const startX = nameHandle.getBoundingClientRect().left + 1;
      const dropX = Math.max(scoreRect.right + 40, startX + 240);

      nameHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: startX,
          pointerId: 9,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: dropX,
          pointerId: 9,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: dropX,
          pointerId: 9,
        }),
      );
      await vi.waitFor(() =>
        expect(columnOrder()).toEqual(["COL_ID_SCORE", "COL_ID_STATUS", "COL_ID_NAME"]),
      );
      expect(reorderFrames).toHaveBeenCalledTimes(1);

      const statusHandle = screen.getByRole("button", { name: "Reorder Status" }).element();
      statusHandle.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          pointerId: 10,
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 0,
          pointerId: 10,
        }),
      );
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(columnOrder()).toEqual(["COL_ID_SCORE", "COL_ID_STATUS", "COL_ID_NAME"]);
      expect(grid.querySelector("[data-bruno-reorder-target]")).toBeNull();
    } finally {
      removeReorder();
    }
  });

  test("keeps a column gesture alive across same-shape live row publication", async () => {
    const screen = await render(<BrunoTableClient<Row, typeof columns> {...tableProps} />);
    const grid = screen.getByRole("grid").element();
    const statusHandle = screen.getByRole("button", { name: "Reorder Status" }).element();
    statusHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        pointerId: 11,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 0,
        pointerId: 11,
      }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(grid.querySelector("[data-bruno-reorder-target]")).not.toBeNull();

    await screen.rerender(
      <BrunoTableClient<Row, typeof columns>
        {...tableProps}
        clientSource={{ ...source, version: 2, rows: [...rows] }}
      />,
    );
    expect(grid.querySelector("[data-bruno-reorder-target]")).not.toBeNull();
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: 0,
        pointerId: 11,
      }),
    );
    await vi.waitFor(() =>
      expect(
        [...grid.querySelectorAll<HTMLElement>("th[data-bruno-column-id]")].map(
          (header) => header.dataset["brunoColumnId"],
        ),
      ).toEqual(["COL_ID_STATUS", "COL_ID_NAME", "COL_ID_SCORE"]),
    );
  });

  test("opens the keyboard menu for an active header that scrolled out of the mounted window", async () => {
    const screen = await render(
      <BrunoTableClient<Row, typeof manyColumns>
        tableId="TABLE_ID_COLUMN_MANAGEMENT_OFFSCREEN"
        getRowId={(row: Row) => row.id}
        columns={manyColumns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        clientSource={source}
      />,
    );
    const grid = screen
      .getByRole("grid", { name: "Data for TABLE_ID_COLUMN_MANAGEMENT_OFFSCREEN" })
      .element();
    const sortButton = grid.querySelector<HTMLButtonElement>('button[aria-label="Sort by Name"]');
    if (sortButton === null)
      throw new Error("The offscreen test grid did not mount its Name header.");
    sortButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    );
    grid.scrollLeft = 1_000;
    grid.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect.element(screen.getByRole("menuitem", { name: "Move" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => {
      const activeElement = document.activeElement;
      const activeHeaderMenuTrigger = grid.querySelector<HTMLButtonElement>(
        '[data-bruno-active-header-menu-trigger=""]',
      );
      if (activeElement !== activeHeaderMenuTrigger) {
        throw new Error(
          `Unexpected active element: ${activeElement?.outerHTML ?? "none"}; proxy=${activeHeaderMenuTrigger?.outerHTML ?? "none"}`,
        );
      }
    });
  });

  test("restores focus to the reordered column after its header virtualizes out", async () => {
    const screen = await render(
      <BrunoTableClient<Row, typeof manyColumns>
        tableId="TABLE_ID_COLUMN_MANAGEMENT_REORDER_FOCUS"
        getRowId={(row: Row) => row.id}
        columns={manyColumns}
        initialOrderBy={[{ columnId: "COL_ID_SCORE", direction: "asc" }]}
        clientSource={source}
      />,
    );
    const grid = screen.getByRole("grid").element();
    const reorderHandle = screen.getByRole("button", { name: "Reorder Name" }).element();
    const startX = reorderHandle.getBoundingClientRect().left + 1;
    reorderHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: startX,
        pointerId: 22,
      }),
    );
    grid.scrollLeft = 1_000;
    grid.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: grid.getBoundingClientRect().right - 2,
        pointerId: 22,
      }),
    );

    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Column menu for Name"),
    );
    expect(grid.contains(document.activeElement)).toBe(true);
  });

  test("cancels reorder on pointercancel and unmount without a late commit", async () => {
    const screen = await render(<BrunoTableClient<Row, typeof columns> {...tableProps} />);
    const grid = screen.getByRole("grid").element();
    const columnOrder = () =>
      [...grid.querySelectorAll<HTMLElement>("th[data-bruno-column-id]")].map(
        (header) => header.dataset["brunoColumnId"],
      );
    const initialOrder = columnOrder();
    const resizeHandle = screen.getByRole("separator", { name: "Resize Name" }).element();
    resizeHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        pointerId: 18,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 180, pointerId: 18 }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 18 }));
    await vi.waitFor(() =>
      expect(screen.getByRole("separator", { name: "Resize Name" })).toHaveAttribute(
        "aria-valuenow",
        "160",
      ),
    );

    const reorderHandle = screen.getByRole("button", { name: "Reorder Status" }).element();
    reorderHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        pointerId: 20,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 0, pointerId: 20 }),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
    window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 20 }));
    expect(columnOrder()).toEqual(initialOrder);

    reorderHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        pointerId: 21,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 0, pointerId: 21 }),
    );
    await screen.rerender(<></>);
    expect(document.querySelector('[role="grid"]')).toBeNull();
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 21 }));
  });

  test("cancels an in-flight resize on unmount without a late commit", async () => {
    const screen = await render(<BrunoTableClient<Row, typeof columns> {...tableProps} />);
    const resizeHandle = screen.getByRole("separator", { name: "Resize Name" }).element();
    resizeHandle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100,
        pointerId: 19,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 180, pointerId: 19 }),
    );
    await screen.rerender(<></>);
    window.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, clientX: 180, pointerId: 19 }),
    );
    expect(document.querySelector('[role="grid"]')).toBeNull();
  });
});
