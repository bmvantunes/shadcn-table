import { detectPlatform, getHotkeyManager } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { page, userEvent } from "vitest/browser";
import { cleanup, render } from "vitest-browser-react";

import { BrunoTableClient } from "./index";
import { settleBrunoTableBrowserFrames } from "./internal/browser-test-helpers";
import {
  installBrunoTableCellRangeInstrumentationListener,
  type BrunoTableCellRangeInstrumentationEvent,
} from "./internal/cell-range-clipboard";
import type { BrunoTableClientSource, BrunoTableColumns } from "./public-types";

type Row = Readonly<{
  readonly id: string;
  readonly name: string;
  readonly score: number;
  readonly quantity: bigint;
}>;

const columns = [
  {
    columnId: "COL_ID_NAME",
    field: "name",
    headerName: "Name",
    valueType: "text",
    width: 180,
  },
  {
    columnId: "COL_ID_SCORE",
    field: "score",
    headerName: "Score",
    valueType: "number",
    width: 180,
  },
  {
    columnId: "COL_ID_QUANTITY",
    field: "quantity",
    headerName: "Quantity",
    valueType: "bigint",
    width: 240,
    valueFormatter: ({ value }) => `${value.toString()} displayed`,
  },
] satisfies BrunoTableColumns<Row>;

const rows = [
  { id: "ada", name: "Ada", score: 4, quantity: 9_007_199_254_740_993n },
  { id: "babbage", name: "Babbage", score: 2, quantity: 9_007_199_254_740_995n },
  { id: "curie", name: "Curie", score: 3, quantity: 9_007_199_254_740_997n },
] satisfies readonly Row[];

function source(nextRows: readonly Row[] = rows, version = 1) {
  return {
    rows: nextRows,
    totalRows: nextRows.length,
    version,
    status: "ready" as const,
  };
}

function table(tableId: string, nextRows: readonly Row[] = rows, version = 1) {
  return tableWithSource(tableId, source(nextRows, version));
}

function tableWithSource(tableId: string, clientSource: BrunoTableClientSource<Row>) {
  return (
    <BrunoTableClient
      tableId={tableId}
      columns={columns}
      initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
      clientSource={clientSource}
      getRowId={(row) => row.id}
    />
  );
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

describe("BrunoTableClient one-axis Cell Range and atomic Copy", () => {
  test("shares one anchor across click and Shift keyboard extensions without creating a rectangle", async () => {
    const writes: string[] = [];
    const restoreClipboard = installClipboard(async (text) => {
      writes.push(text);
    });
    try {
      await render(table("TABLE_ID_CELL_RANGE_KEYBOARD"));
      const grid = page.getByRole("grid", { name: "Data for TABLE_ID_CELL_RANGE_KEYBOARD" });
      grid.element().focus();

      await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
      await settleBrunoTableBrowserFrames();
      await expect
        .element(page.getByRole("gridcell", { name: "Ada" }))
        .toHaveAttribute("aria-selected", "true");
      await expect
        .element(page.getByRole("gridcell", { name: "4", exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expect
        .element(page.getByRole("gridcell", { name: "9007199254740993 displayed", exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expect
        .element(page.getByRole("gridcell", { name: "Babbage" }))
        .not.toHaveAttribute("aria-selected");

      await userEvent.keyboard(copyGesture());
      await vi.waitFor(() => expect(writes).toEqual(["Ada\t4\t9007199254740993"]));
      await userEvent.keyboard("{Escape}");
      await settleBrunoTableBrowserFrames();
      await expect
        .element(page.getByRole("gridcell", { name: "Ada" }))
        .not.toHaveAttribute("aria-selected");
      await expect
        .element(page.getByRole("gridcell", { name: "9007199254740993 displayed", exact: true }))
        .toHaveAttribute("aria-selected", "true");

      await userEvent.click(page.getByRole("gridcell", { name: "Ada" }));
      const curie = page.getByRole("gridcell", { name: "Curie" });
      curie.element().dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 11,
          shiftKey: true,
        }),
      );
      curie.element().dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 11,
          shiftKey: true,
        }),
      );
      await settleBrunoTableBrowserFrames();
      await userEvent.keyboard(copyGesture());
      await vi.waitFor(() => expect(writes.at(-1)).toBe("Ada\nBabbage\nCurie"));

      await userEvent.click(page.getByRole("gridcell", { name: "Babbage" }));
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await settleBrunoTableBrowserFrames();
      await userEvent.keyboard(copyGesture());
      await vi.waitFor(() => expect(writes.at(-1)).toBe("Babbage\nCurie"));
      await expect
        .element(page.getByRole("gridcell", { name: "2", exact: true }))
        .not.toHaveAttribute("aria-selected");

      await userEvent.click(page.getByRole("gridcell", { name: "Babbage" }));
      await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
      await settleBrunoTableBrowserFrames();
      await expect
        .element(page.getByRole("gridcell", { name: "Ada" }))
        .toHaveAttribute("aria-selected", "true");
      await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
      await settleBrunoTableBrowserFrames();
      await expect
        .element(page.getByRole("gridcell", { name: "Ada" }))
        .not.toHaveAttribute("aria-selected");
      await expect
        .element(page.getByRole("gridcell", { name: "Babbage" }))
        .not.toHaveAttribute("aria-selected");
    } finally {
      restoreClipboard();
    }
  });

  test("locks pointer drag to the dominant axis after slop and batches mounted work by frame", async () => {
    const events: BrunoTableCellRangeInstrumentationEvent[] = [];
    const removeInstrumentation = installBrunoTableCellRangeInstrumentationListener(
      "TABLE_ID_CELL_RANGE_POINTER",
      (event) => events.push(event),
    );
    try {
      await render(table("TABLE_ID_CELL_RANGE_POINTER"));
      await settleBrunoTableBrowserFrames();
      events.length = 0;
      const ada = page.getByRole("gridcell", { name: "Ada" });
      const curieQuantity = page.getByRole("gridcell", {
        name: "9007199254740997 displayed",
        exact: true,
      });
      ada.element().dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 10,
          clientY: 10,
          pointerId: 19,
        }),
      );
      curieQuantity.element().dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: 13,
          clientY: 13,
          pointerId: 19,
        }),
      );
      await settleBrunoTableBrowserFrames();
      await expect
        .element(page.getByRole("gridcell", { name: "4", exact: true }))
        .not.toHaveAttribute("aria-selected");

      for (let index = 0; index < 8; index += 1) {
        curieQuantity.element().dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            clientX: 30 + index,
            clientY: 17,
            pointerId: 19,
          }),
        );
      }
      await settleBrunoTableBrowserFrames();
      curieQuantity.element().dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX: 37,
          clientY: 17,
          pointerId: 19,
        }),
      );
      await settleBrunoTableBrowserFrames();

      await expect
        .element(page.getByRole("gridcell", { name: "9007199254740993 displayed", exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expect
        .element(page.getByRole("gridcell", { name: "9007199254740997 displayed", exact: true }))
        .not.toHaveAttribute("aria-selected");
      const pointerFrames = events.filter((event) => event.kind === "pointer-frame");
      expect(pointerFrames.length).toBeLessThanOrEqual(3);
      const decorations = events.filter(
        (
          event,
        ): event is Extract<
          BrunoTableCellRangeInstrumentationEvent,
          { readonly kind: "mounted-decoration" }
        > => event.kind === "mounted-decoration",
      );
      expect(decorations.length).toBeGreaterThan(0);
      expect(Math.max(...decorations.map((event) => event.mountedCellCount))).toBeLessThanOrEqual(
        9,
      );

      const grid = page.getByRole("grid", { name: "Data for TABLE_ID_CELL_RANGE_POINTER" });
      const activeBeforeCancel = grid.element().getAttribute("aria-activedescendant");
      const babbage = page.getByRole("gridcell", { name: "Babbage" });
      babbage.element().dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 10,
          clientY: 10,
          pointerId: 20,
        }),
      );
      curieQuantity.element().dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: 17,
          clientY: 30,
          pointerId: 20,
        }),
      );
      await settleBrunoTableBrowserFrames();
      curieQuantity.element().dispatchEvent(
        new PointerEvent("pointercancel", {
          bubbles: true,
          cancelable: true,
          pointerId: 20,
        }),
      );
      await settleBrunoTableBrowserFrames();
      expect(grid.element().getAttribute("aria-activedescendant")).toBe(activeBeforeCancel);
      await expect
        .element(page.getByRole("gridcell", { name: "9007199254740993 displayed", exact: true }))
        .toHaveAttribute("aria-selected", "true");
    } finally {
      removeInstrumentation();
    }
  });

  test("completes a vertical-dominant diagonal drag by projecting onto the anchor column", async () => {
    const writes: string[] = [];
    const restoreClipboard = installClipboard(async (text) => {
      writes.push(text);
    });
    try {
      await render(table("TABLE_ID_CELL_RANGE_VERTICAL_POINTER"));
      const adaScore = page.getByRole("gridcell", { name: "4", exact: true });
      const curieQuantity = page.getByRole("gridcell", {
        name: "9007199254740997 displayed",
        exact: true,
      });
      adaScore.element().dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 10,
          clientY: 10,
          pointerId: 21,
        }),
      );
      curieQuantity.element().dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: 17,
          clientY: 30,
          pointerId: 21,
        }),
      );
      await settleBrunoTableBrowserFrames();
      curieQuantity.element().dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX: 17,
          clientY: 30,
          pointerId: 21,
        }),
      );
      await settleBrunoTableBrowserFrames();

      await expect.element(adaScore).toHaveAttribute("aria-selected", "true");
      await expect
        .element(page.getByRole("gridcell", { name: "2", exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expect
        .element(page.getByRole("gridcell", { name: "3", exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expect.element(curieQuantity).not.toHaveAttribute("aria-selected");
      await userEvent.keyboard(copyGesture());
      await vi.waitFor(() => expect(writes.at(-1)).toBe("4\n2\n3"));
    } finally {
      restoreClipboard();
    }
  });

  test("does not start a range gesture from focusable custom cell content", async () => {
    const interactiveColumns = [
      {
        columnId: "COL_ID_NAME",
        field: "name",
        headerName: "Name",
        valueType: "text",
        width: 180,
        cellRenderer: ({ row }: { readonly row: Row }) => (
          <article aria-label={`Focusable ${row.name}`} tabIndex={0}>
            {row.name}
          </article>
        ),
      },
      {
        columnId: "COL_ID_SCORE",
        field: "score",
        headerName: "Score",
        valueType: "number",
        width: 180,
      },
      {
        columnId: "COL_ID_QUANTITY",
        field: "quantity",
        headerName: "Quantity",
        valueType: "bigint",
        width: 240,
      },
    ] satisfies BrunoTableColumns<Row>;
    await render(
      <BrunoTableClient
        tableId="TABLE_ID_CELL_RANGE_INTERACTIVE"
        columns={interactiveColumns}
        initialOrderBy={[{ columnId: "COL_ID_NAME", direction: "asc" }]}
        clientSource={source()}
        getRowId={(row) => row.id}
      />,
    );
    const score = page.getByRole("gridcell", { name: "4", exact: true });
    await userEvent.click(score);
    await settleBrunoTableBrowserFrames();
    const focusable = page.getByRole("article", { name: "Focusable Babbage" });
    focusable.element().dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 25,
      }),
    );
    page
      .getByRole("gridcell", { name: "3", exact: true })
      .element()
      .dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: 30,
          clientY: 10,
          pointerId: 25,
        }),
      );
    await settleBrunoTableBrowserFrames();
    await expect.element(score).toHaveAttribute("aria-selected", "true");
    await expect
      .element(page.getByRole("gridcell", { name: "3", exact: true }))
      .not.toHaveAttribute("aria-selected");

    score.element().dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 10,
        clientY: 10,
        pointerId: 26,
      }),
    );
    const curieScore = page.getByRole("gridcell", { name: "3", exact: true });
    curieScore.element().dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: 17,
        clientY: 30,
        pointerId: 26,
      }),
    );
    await settleBrunoTableBrowserFrames();
    curieScore.element().dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        clientX: 17,
        clientY: 30,
        pointerId: 26,
      }),
    );
    await settleBrunoTableBrowserFrames();
    await expect.element(score).toHaveAttribute("aria-selected", "true");
    await expect.element(curieScore).toHaveAttribute("aria-selected", "true");
  });

  test("bounds edge autoscroll publications and mounted decoration work by animation frame", async () => {
    const tableId = "TABLE_ID_CELL_RANGE_AUTOSCROLL";
    const events: BrunoTableCellRangeInstrumentationEvent[] = [];
    const removeInstrumentation = installBrunoTableCellRangeInstrumentationListener(
      tableId,
      (event) => events.push(event),
    );
    const manyRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${String(index).padStart(3, "0")}`,
      name: `Row ${String(index).padStart(3, "0")}`,
      score: index,
      quantity: BigInt(index),
    }));
    try {
      await render(table(tableId, manyRows));
      await settleBrunoTableBrowserFrames();
      events.length = 0;
      const grid = page.getByRole("grid", { name: `Data for ${tableId}` });
      const anchor = page.getByRole("gridcell", { name: "Row 000", exact: true }).first();
      const target = page.getByRole("gridcell", { name: "Row 010", exact: true }).first();
      const bounds = grid.element().getBoundingClientRect();
      const start = anchor.element().getBoundingClientRect();
      const startX = start.left + start.width / 2;
      const startY = start.top + start.height / 2;
      const initialScrollLeft = grid.element().scrollLeft;
      const initialScrollTop = grid.element().scrollTop;

      anchor.element().dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: startX,
          clientY: startY,
          pointerId: 22,
        }),
      );
      target.element().dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          clientX: startX + 5,
          clientY: bounds.bottom - 1,
          pointerId: 22,
        }),
      );
      await settleBrunoTableBrowserFrames(4);

      expect(grid.element().scrollTop).toBeGreaterThan(initialScrollTop);
      expect(grid.element().scrollLeft).toBe(initialScrollLeft);
      const pointerFrames = events.filter((event) => event.kind === "pointer-frame");
      const publications = events.filter((event) => event.kind === "publication");
      const decorations = events.filter(
        (
          event,
        ): event is Extract<
          BrunoTableCellRangeInstrumentationEvent,
          { readonly kind: "mounted-decoration" }
        > => event.kind === "mounted-decoration",
      );
      expect(pointerFrames.length).toBeGreaterThan(0);
      expect(pointerFrames.length).toBeLessThanOrEqual(5);
      expect(publications.length).toBeLessThanOrEqual(pointerFrames.length + 1);
      expect(decorations.length).toBeGreaterThan(0);
      expect(Math.max(...decorations.map((event) => event.mountedCellCount))).toBeLessThanOrEqual(
        60,
      );

      grid.element().scrollTop = grid.element().scrollHeight;
      await settleBrunoTableBrowserFrames(3);
      const framesAtVerticalClamp = events.filter((event) => event.kind === "pointer-frame").length;
      await settleBrunoTableBrowserFrames(3);
      expect(events.filter((event) => event.kind === "pointer-frame")).toHaveLength(
        framesAtVerticalClamp,
      );

      grid.element().dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          clientX: startX + 5,
          clientY: bounds.bottom - 1,
          pointerId: 22,
        }),
      );
      const framesAfterRelease = events.filter((event) => event.kind === "pointer-frame").length;
      await settleBrunoTableBrowserFrames(3);
      expect(events.filter((event) => event.kind === "pointer-frame")).toHaveLength(
        framesAfterRelease,
      );
    } finally {
      removeInstrumentation();
    }
  });

  test.each(["ltr", "rtl"] as const)(
    "routes %s horizontal edge autoscroll through the pinned logical viewport",
    async (direction) => {
      const wideNameColumn = {
        field: "name",
        valueType: "text",
        width: 320,
      } as const;
      const wideColumns = [
        { ...wideNameColumn, columnId: "COL_ID_WIDE_1", headerName: "Wide 1", pinned: "start" },
        { ...wideNameColumn, columnId: "COL_ID_WIDE_2", headerName: "Wide 2" },
        { ...wideNameColumn, columnId: "COL_ID_WIDE_3", headerName: "Wide 3" },
        { ...wideNameColumn, columnId: "COL_ID_WIDE_4", headerName: "Wide 4" },
        { ...wideNameColumn, columnId: "COL_ID_WIDE_5", headerName: "Wide 5" },
        { ...wideNameColumn, columnId: "COL_ID_WIDE_6", headerName: "Wide 6" },
        { ...wideNameColumn, columnId: "COL_ID_WIDE_7", headerName: "Wide 7" },
        { ...wideNameColumn, columnId: "COL_ID_WIDE_8", headerName: "Wide 8", pinned: "end" },
      ] satisfies BrunoTableColumns<Row>;

      const tableId = `TABLE_ID_CELL_RANGE_HORIZONTAL_${direction.toUpperCase()}`;
      const events: BrunoTableCellRangeInstrumentationEvent[] = [];
      const removeInstrumentation = installBrunoTableCellRangeInstrumentationListener(
        tableId,
        (event) => events.push(event),
      );
      const screen = await render(
        <div dir={direction}>
          <BrunoTableClient
            tableId={tableId}
            columns={wideColumns}
            initialOrderBy={[{ columnId: "COL_ID_WIDE_1", direction: "asc" }]}
            clientSource={source([rows[0]!])}
            getRowId={(row) => row.id}
          />
        </div>,
      );
      try {
        await settleBrunoTableBrowserFrames();
        events.length = 0;
        const grid = page.getByRole("grid", { name: `Data for ${tableId}` });
        const cells = page.getByRole("gridcell", { name: "Ada", exact: true });
        const anchor = cells.first();
        const target = cells.last();
        const initialHeaders = new Set(
          page
            .getByRole("columnheader")
            .all()
            .map((header) => header.element().textContent),
        );
        const bounds = grid.element().getBoundingClientRect();
        const anchorBounds = anchor.element().getBoundingClientRect();
        const startX = anchorBounds.left + anchorBounds.width / 2;
        const startY = anchorBounds.top + anchorBounds.height / 2;
        const edgeX = direction === "rtl" ? bounds.left + 1 : bounds.right - 1;
        const initialScrollLeft = grid.element().scrollLeft;
        const initialScrollTop = grid.element().scrollTop;

        anchor.element().dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: startX,
            clientY: startY,
            pointerId: direction === "rtl" ? 24 : 23,
          }),
        );
        target.element().dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            clientX: edgeX,
            clientY: startY + 1,
            pointerId: direction === "rtl" ? 24 : 23,
          }),
        );
        await settleBrunoTableBrowserFrames(50);

        expect(grid.element().scrollLeft).not.toBe(initialScrollLeft);
        expect(grid.element().scrollTop).toBe(initialScrollTop);
        const currentHeaders = new Set(
          page
            .getByRole("columnheader")
            .all()
            .map((header) => header.element().textContent),
        );
        expect(currentHeaders).not.toEqual(initialHeaders);
        await expect
          .element(page.getByRole("columnheader", { name: "Wide 1" }))
          .toBeInTheDocument();
        await expect
          .element(page.getByRole("columnheader", { name: "Wide 8" }))
          .toBeInTheDocument();

        target.element().dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            cancelable: true,
            clientX: edgeX,
            clientY: startY + 1,
            pointerId: direction === "rtl" ? 24 : 23,
          }),
        );
        const framesAfterRelease = events.filter((event) => event.kind === "pointer-frame").length;
        expect(framesAfterRelease).toBeGreaterThan(0);
        expect(framesAfterRelease).toBeLessThanOrEqual(110);
        expect(events.filter((event) => event.kind === "publication").length).toBeLessThanOrEqual(
          framesAfterRelease + 1,
        );
        await settleBrunoTableBrowserFrames(3);
        expect(events.filter((event) => event.kind === "pointer-frame")).toHaveLength(
          framesAfterRelease,
        );
      } finally {
        removeInstrumentation();
        await screen.unmount();
      }
    },
  );

  test("preserves an exact identity span across value publications and rejects changed interiors", async () => {
    const writes: string[] = [];
    const restoreClipboard = installClipboard(async (text) => {
      writes.push(text);
    });
    try {
      const screen = await render(table("TABLE_ID_CELL_RANGE_IDENTITIES"));
      const grid = page.getByRole("grid", { name: "Data for TABLE_ID_CELL_RANGE_IDENTITIES" });
      grid.element().focus();
      await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
      await settleBrunoTableBrowserFrames();

      const valuePublication = rows.map((row) =>
        row.id === "babbage" ? { ...row, score: 200 } : row,
      );
      await screen.rerender(table("TABLE_ID_CELL_RANGE_IDENTITIES", valuePublication, 2));
      await settleBrunoTableBrowserFrames();
      await expect
        .element(page.getByRole("gridcell", { name: "Babbage" }))
        .toHaveAttribute("aria-selected", "true");
      await userEvent.keyboard(copyGesture());
      await vi.waitFor(() => expect(writes.at(-1)).toBe("Ada\nBabbage\nCurie"));

      const inserted = [
        { id: "ada", name: "Ada", score: 4, quantity: 9_007_199_254_740_993n },
        { id: "boole", name: "Boole", score: 5, quantity: 11n },
        { id: "babbage", name: "Babbage", score: 2, quantity: 9_007_199_254_740_995n },
        { id: "curie", name: "Curie", score: 3, quantity: 9_007_199_254_740_997n },
      ] satisfies readonly Row[];
      await screen.rerender(table("TABLE_ID_CELL_RANGE_IDENTITIES", inserted, 3));
      await settleBrunoTableBrowserFrames();
      await expect
        .element(page.getByRole("gridcell", { name: "Babbage" }))
        .not.toHaveAttribute("aria-selected");
      await userEvent.keyboard(copyGesture());
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await expect
        .element(page.getByRole("log", { name: "Table interaction status" }))
        .toHaveTextContent("Copy failed: the selected cells are no longer available");

      await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");
      await settleBrunoTableBrowserFrames();
      await userEvent.keyboard(copyGesture());
      await vi.waitFor(() => expect(writes.at(-1)).toBe("Boole\nCurie"));
    } finally {
      restoreClipboard();
    }
  });

  test("does not resurrect a range after empty, loading, or invalid Client bodies", async () => {
    const tableId = "TABLE_ID_CELL_RANGE_BODY_RESET";
    const transitions = [
      { rows: [], totalRows: 0, version: 2, status: "ready" },
      { rows: [], totalRows: rows.length, version: 4, status: "loading" },
      { rows: [], totalRows: rows.length, version: 6, status: "ready" },
    ] satisfies readonly BrunoTableClientSource<Row>[];
    const screen = await render(table(tableId));
    for (const [index, transition] of transitions.entries()) {
      const grid = page.getByRole("grid", { name: `Data for ${tableId}` });
      grid.element().focus();
      await userEvent.keyboard("{Shift>}{ArrowDown}{/Shift}");
      await settleBrunoTableBrowserFrames();
      await expect
        .element(page.getByRole("gridcell", { name: "Babbage" }))
        .toHaveAttribute("aria-selected", "true");

      await screen.rerender(tableWithSource(tableId, transition));
      await settleBrunoTableBrowserFrames();
      await screen.rerender(table(tableId, rows, index * 2 + 3));
      await settleBrunoTableBrowserFrames();
      await expect
        .element(page.getByRole("gridcell", { name: "Ada" }))
        .not.toHaveAttribute("aria-selected");
      await expect
        .element(page.getByRole("gridcell", { name: "Babbage" }))
        .not.toHaveAttribute("aria-selected");
    }
  });

  test("uses one immutable payload while a live publication races the asynchronous write", async () => {
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
      const screen = await render(table("TABLE_ID_CELL_RANGE_ATOMIC"));
      const grid = page.getByRole("grid", { name: "Data for TABLE_ID_CELL_RANGE_ATOMIC" });
      grid.element().focus();
      await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
      await userEvent.keyboard(copyGesture());
      await vi.waitFor(() => expect(writes).toEqual(["Ada\t4\t9007199254740993"]));
      expect(
        page.getByRole("log", { name: "Table interaction status" }).element().textContent,
      ).toBe("");

      await screen.rerender(
        table(
          "TABLE_ID_CELL_RANGE_ATOMIC",
          rows.map((row) =>
            row.id === "ada" ? { ...row, score: 400, quantity: 9_007_199_254_741_111n } : row,
          ),
          2,
        ),
      );
      await settleBrunoTableBrowserFrames();
      expect(writes).toEqual(["Ada\t4\t9007199254740993"]);
      resolveWrite?.();
      await expect
        .element(page.getByRole("log", { name: "Table interaction status" }))
        .toHaveTextContent("3 cells copied");
    } finally {
      restoreClipboard();
    }
  });

  test("reports clipboard rejection only after failure and preserves the valid range", async () => {
    const restoreClipboard = installClipboard(async () => {
      throw new Error("denied");
    });
    try {
      await render(table("TABLE_ID_CELL_RANGE_FAILURE"));
      const grid = page.getByRole("grid", { name: "Data for TABLE_ID_CELL_RANGE_FAILURE" });
      grid.element().focus();
      await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
      await userEvent.keyboard(copyGesture());
      await expect
        .element(page.getByRole("log", { name: "Table interaction status" }))
        .toHaveTextContent("Copy failed: the browser rejected the clipboard write");
      await expect
        .element(page.getByRole("gridcell", { name: "Ada" }))
        .toHaveAttribute("aria-selected", "true");
      await expect
        .element(page.getByRole("gridcell", { name: "4", exact: true }))
        .toHaveAttribute("aria-selected", "true");
    } finally {
      restoreClipboard();
    }
  });

  test("captures exact pinned and two-axis virtualized identity spans beyond mounted cells", async () => {
    const wideNameColumn = {
      field: "name",
      valueType: "text",
      width: 320,
    } as const;
    const virtualColumns = [
      { ...wideNameColumn, columnId: "COL_ID_WIDE_1", headerName: "Wide 1", pinned: "start" },
      { ...wideNameColumn, columnId: "COL_ID_WIDE_2", headerName: "Wide 2" },
      { ...wideNameColumn, columnId: "COL_ID_WIDE_3", headerName: "Wide 3" },
      { ...wideNameColumn, columnId: "COL_ID_WIDE_4", headerName: "Wide 4" },
      { ...wideNameColumn, columnId: "COL_ID_WIDE_5", headerName: "Wide 5" },
      { ...wideNameColumn, columnId: "COL_ID_WIDE_6", headerName: "Wide 6" },
      { ...wideNameColumn, columnId: "COL_ID_WIDE_7", headerName: "Wide 7" },
      { ...wideNameColumn, columnId: "COL_ID_WIDE_8", headerName: "Wide 8", pinned: "end" },
    ] satisfies BrunoTableColumns<Row>;
    const virtualRows = Array.from({ length: 100 }, (_, index) => ({
      id: `row-${String(index).padStart(3, "0")}`,
      name: `Row ${String(index).padStart(3, "0")}`,
      score: index,
      quantity: BigInt(index),
    }));
    const writes: string[] = [];
    const restoreClipboard = installClipboard(async (text) => {
      writes.push(text);
    });
    try {
      await render(
        <BrunoTableClient
          tableId="TABLE_ID_CELL_RANGE_VIRTUAL"
          columns={virtualColumns}
          initialOrderBy={[{ columnId: "COL_ID_WIDE_1", direction: "asc" }]}
          clientSource={source(virtualRows)}
          getRowId={(row) => row.id}
        />,
      );
      const grid = page.getByRole("grid", { name: "Data for TABLE_ID_CELL_RANGE_VIRTUAL" });
      grid.element().focus();
      await userEvent.keyboard("{Shift>}{End}{/Shift}");
      await settleBrunoTableBrowserFrames();
      await userEvent.keyboard(copyGesture());
      await vi.waitFor(() =>
        expect(writes.at(-1)).toBe(Array.from({ length: 8 }, () => "Row 000").join("\t")),
      );
      await userEvent.keyboard("{Home}");
      await userEvent.keyboard(
        detectPlatform() === "mac"
          ? "{Meta>}{Shift>}{ArrowDown}{/Shift}{/Meta}"
          : "{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}",
      );
      await settleBrunoTableBrowserFrames();
      await userEvent.keyboard(copyGesture());
      await vi.waitFor(() =>
        expect(writes.at(-1)).toBe(virtualRows.map((row) => row.name).join("\n")),
      );
      await expect
        .element(page.getByRole("gridcell", { name: "Row 099", exact: true }).first())
        .toHaveAttribute("aria-selected", "true");
    } finally {
      restoreClipboard();
    }
  });

  test("registers scoped Mod+C through the shared adapter and removes it on cleanup", async () => {
    const manager = getHotkeyManager();
    const registrationsFor = (grid: HTMLElement | SVGElement) =>
      [...manager.registrations.state.values()].filter(
        (registration) => registration.target === grid && registration.hotkey === "Mod+C",
      );
    const screen = await render(table("TABLE_ID_CELL_RANGE_HOTKEY"));
    const grid = page.getByRole("grid", { name: "Data for TABLE_ID_CELL_RANGE_HOTKEY" }).element();
    expect(registrationsFor(grid)).toHaveLength(1);
    await screen.unmount();
    expect(registrationsFor(grid)).toHaveLength(0);
  });
});
