import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTable } from "@tanstack/react-table";
import type {
  CellSelectionState,
  Column,
  ReactTable,
  Row,
  TableState,
} from "@tanstack/react-table";
import type { VirtualItem } from "@tanstack/react-virtual";

import {
  END_COLUMN_IDS,
  mechanicsColumns,
  mechanicsFeatures,
  mechanicsRows,
  START_COLUMN_IDS,
  type MechanicsRow,
} from "./grid-model";
import { getMinimalRevealOffset } from "./reveal";

const HEADER_HEIGHT = 34;
const ROW_HEIGHT = 28;
const ROW_OVERSCAN = 12;
const COLUMN_OVERSCAN = 3;

type StructuralState = Pick<TableState<typeof mechanicsFeatures>, "columnPinning" | "columnSizing">;

type MechanicsTable = ReactTable<typeof mechanicsFeatures, MechanicsRow, StructuralState>;

type MechanicsColumn = Column<typeof mechanicsFeatures, MechanicsRow, unknown>;
type MechanicsTableRow = Row<typeof mechanicsFeatures, MechanicsRow>;

export interface MechanicsGridProps {
  readonly densityLabel: string;
  readonly showRail?: boolean;
}

function activeColumnForRow(ranges: CellSelectionState, rowId: string): string | null {
  const active = ranges.at(-1);
  return active?.focusRowId === rowId ? active.focusColumnId : null;
}

function activeCellKey(ranges: CellSelectionState): string {
  const active = ranges.at(-1);
  return active ? `${active.focusRowId} · ${active.focusColumnId}` : "None";
}

function formatCellValue(value: unknown): string {
  if (typeof value === "number") return value.toLocaleString("en-GB");
  return typeof value === "string" ? value : "";
}

function sumColumnWidths(columns: ReadonlyArray<MechanicsColumn>): number {
  return columns.reduce((total, column) => total + column.getSize(), 0);
}

function maxScrollOffset(element: HTMLDivElement, axis: "x" | "y"): number {
  return axis === "x"
    ? Math.max(0, element.scrollWidth - element.clientWidth)
    : Math.max(0, element.scrollHeight - element.clientHeight);
}

export function MechanicsGrid({ densityLabel, showRail = false }: MechanicsGridProps) {
  const table = useTable(
    {
      key: "bruno-table-grid-mechanics",
      features: mechanicsFeatures,
      columns: mechanicsColumns,
      data: mechanicsRows,
      getRowId: (row) => row.id,
      enableCellSelection: true,
      enableCellRangeSelection: false,
      enableMultiCellRangeSelection: false,
      enableCellSelectionDrag: false,
      autoResetCellSelection: false,
      initialState: {
        columnPinning: {
          start: [...START_COLUMN_IDS],
          end: [...END_COLUMN_IDS],
        },
      },
    },
    (state) => ({
      columnPinning: state.columnPinning,
      columnSizing: state.columnSizing,
    }),
  );

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const scrollReadoutRef = React.useRef<HTMLOutputElement>(null);
  const revealReadoutRef = React.useRef<HTMLOutputElement>(null);
  const scrollFrameRef = React.useRef<number | null>(null);
  const didInitializeSelectionRef = React.useRef(false);

  const rows = table.getRowModel().rows;
  const startColumns = table.getStartVisibleLeafColumns();
  const centerColumns = table.getCenterVisibleLeafColumns();
  const endColumns = table.getEndVisibleLeafColumns();
  const startWidth = sumColumnWidths(startColumns);
  const endWidth = sumColumnWidths(endColumns);

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index]?.id ?? index,
    estimateSize: () => ROW_HEIGHT,
    paddingStart: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
    overscan: ROW_OVERSCAN,
  });

  const columnVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: centerColumns.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => centerColumns[index]?.id ?? index,
    estimateSize: (index) => centerColumns[index]?.getSize() ?? 112,
    horizontal: true,
    paddingStart: startWidth,
    paddingEnd: endWidth,
    scrollPaddingStart: startWidth,
    scrollPaddingEnd: endWidth,
    overscan: COLUMN_OVERSCAN,
  });

  React.useEffect(() => {
    if (didInitializeSelectionRef.current) return;
    didInitializeSelectionRef.current = true;
    table.setFocusedCell(rows[0]?.id ?? "", startColumns[0]?.id ?? "");
  }, [rows, startColumns, table]);

  React.useEffect(() => {
    const element = scrollRef.current;
    const output = scrollReadoutRef.current;
    if (!element || !output) return;

    const update = () => {
      scrollFrameRef.current = null;
      output.value = `x ${Math.round(element.scrollLeft)} · y ${Math.round(element.scrollTop)}`;
    };
    const onScroll = () => {
      if (scrollFrameRef.current === null) {
        scrollFrameRef.current = requestAnimationFrame(update);
      }
    };

    update();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);

  const revealCell = React.useCallback(
    (rowId: string, columnId: string) => {
      const element = scrollRef.current;
      if (!element) return;

      const rowIndex = rows.findIndex((row) => row.id === rowId);
      const rowStart = HEADER_HEIGHT + rowIndex * ROW_HEIGHT;
      const beforeY = element.scrollTop;
      const nextY =
        rowIndex < 0
          ? beforeY
          : getMinimalRevealOffset({
              itemStart: rowStart,
              itemEnd: rowStart + ROW_HEIGHT,
              leadingInset: HEADER_HEIGHT,
              trailingInset: 0,
              viewportSize: element.clientHeight,
              scrollOffset: beforeY,
              maxScrollOffset: maxScrollOffset(element, "y"),
            });

      const startPinned = startColumns.some((column) => column.id === columnId);
      const endPinned = endColumns.some((column) => column.id === columnId);
      const beforeX = element.scrollLeft;
      let nextX = beforeX;

      if (!startPinned && !endPinned) {
        const columnIndex = centerColumns.findIndex((column) => column.id === columnId);
        if (columnIndex >= 0) {
          let itemStart = startWidth;
          for (let index = 0; index < columnIndex; index += 1) {
            itemStart += centerColumns[index]?.getSize() ?? 0;
          }
          const itemEnd = itemStart + (centerColumns[columnIndex]?.getSize() ?? 0);
          nextX = getMinimalRevealOffset({
            itemStart,
            itemEnd,
            leadingInset: startWidth,
            trailingInset: endWidth,
            viewportSize: element.clientWidth,
            scrollOffset: beforeX,
            maxScrollOffset: maxScrollOffset(element, "x"),
          });
        }
      }

      if (nextX !== beforeX) element.scrollLeft = nextX;
      if (nextY !== beforeY) element.scrollTop = nextY;

      if (revealReadoutRef.current) {
        revealReadoutRef.current.value = `Δx ${Math.round(nextX - beforeX)} · Δy ${Math.round(nextY - beforeY)}`;
      }
    },
    [centerColumns, endColumns, endWidth, rows, startColumns, startWidth],
  );

  const move = React.useCallback(
    (direction: "down" | "left" | "right" | "up") => {
      table.moveCellSelection(direction);
      requestAnimationFrame(() => {
        const active = table.atoms.cellSelection.get().at(-1);
        if (active) revealCell(active.focusRowId, active.focusColumnId);
      });
    },
    [revealCell, table],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const direction =
        event.key === "ArrowUp"
          ? "up"
          : event.key === "ArrowDown"
            ? "down"
            : event.key === "ArrowLeft"
              ? "left"
              : event.key === "ArrowRight"
                ? "right"
                : null;
      if (!direction) return;
      event.preventDefault();
      move(direction);
    },
    [move],
  );

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const canvasWidth = Math.max(columnVirtualizer.getTotalSize(), 960);
  const canvasHeight = Math.max(rowVirtualizer.getTotalSize(), 480);

  return (
    <section className={showRail ? "mechanics-shell mechanics-shell--rail" : "mechanics-shell"}>
      <div className="mechanics-status" aria-label="Grid runtime status">
        <span>{densityLabel}</span>
        <span>{virtualRows.length} mounted rows</span>
        <span>
          {virtualColumns.length + startColumns.length + endColumns.length} mounted columns
        </span>
        <table.Subscribe source={table.atoms.cellSelection} selector={activeCellKey}>
          {(activeCell) => <output>{activeCell}</output>}
        </table.Subscribe>
        <output ref={scrollReadoutRef}>x 0 · y 0</output>
        <output ref={revealReadoutRef}>Δx 0 · Δy 0</output>
      </div>

      <div
        ref={scrollRef}
        className="mechanics-grid"
        data-testid="mechanics-grid"
        role="grid"
        tabIndex={0}
        aria-rowcount={rows.length}
        aria-colcount={startColumns.length + centerColumns.length + endColumns.length}
        aria-label="Five thousand row by one hundred and fifty column mechanics grid"
        onKeyDown={onKeyDown}
      >
        <div className="mechanics-canvas" style={{ width: canvasWidth, height: canvasHeight }}>
          <HeaderRow
            startColumns={startColumns}
            centerColumns={centerColumns}
            endColumns={endColumns}
            virtualColumns={virtualColumns}
          />
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            return row ? (
              <SubscribedRow
                key={row.id}
                row={row}
                table={table}
                top={virtualRow.start}
                virtualColumns={virtualColumns}
                scrollRef={scrollRef}
              />
            ) : null;
          })}
        </div>
      </div>
    </section>
  );
}

interface HeaderRowProps {
  readonly centerColumns: ReadonlyArray<MechanicsColumn>;
  readonly endColumns: ReadonlyArray<MechanicsColumn>;
  readonly startColumns: ReadonlyArray<MechanicsColumn>;
  readonly virtualColumns: ReadonlyArray<VirtualItem>;
}

function HeaderRow({ centerColumns, endColumns, startColumns, virtualColumns }: HeaderRowProps) {
  return (
    <div className="mechanics-row mechanics-header" role="row" style={{ height: HEADER_HEIGHT }}>
      {startColumns.map((column) => (
        <HeaderCell key={column.id} column={column} pinned="start" />
      ))}
      {virtualColumns.map((virtualColumn) => {
        const column = centerColumns[virtualColumn.index];
        return column ? (
          <HeaderCell key={column.id} column={column} left={virtualColumn.start} />
        ) : null;
      })}
      <div
        className="mechanics-pinned-end-region mechanics-pinned-end-region--header"
        style={{ width: sumColumnWidths(endColumns) }}
      >
        {endColumns.map((column) => (
          <HeaderCell key={column.id} column={column} pinned="end-region" />
        ))}
      </div>
    </div>
  );
}

interface HeaderCellProps {
  readonly column: MechanicsColumn;
  readonly left?: number;
  readonly pinned?: "end-region" | "start";
}

function HeaderCell({ column, left, pinned }: HeaderCellProps) {
  return (
    <div
      className={[
        "mechanics-header-cell",
        pinned === "start" ? "is-pinned" : "",
        pinned === "end-region" ? "is-end-region-cell" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="columnheader"
      style={columnPosition(column, left, pinned)}
      title={column.id}
    >
      {typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}
    </div>
  );
}

interface SubscribedRowProps {
  readonly row: MechanicsTableRow;
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  readonly table: MechanicsTable;
  readonly top: number;
  readonly virtualColumns: ReadonlyArray<VirtualItem>;
}

function SubscribedRow(props: SubscribedRowProps) {
  return (
    <props.table.Subscribe
      source={props.table.atoms.cellSelection}
      selector={(selection) => activeColumnForRow(selection, props.row.id)}
    >
      {(activeColumnId) => <GridRow {...props} activeColumnId={activeColumnId} />}
    </props.table.Subscribe>
  );
}

function GridRow({
  activeColumnId,
  row,
  scrollRef,
  table,
  top,
  virtualColumns,
}: SubscribedRowProps & { readonly activeColumnId: string | null }) {
  const startCells = row.getStartVisibleCells();
  const centerCells = row.getCenterVisibleCells();
  const endCells = row.getEndVisibleCells();

  const renderCell = (
    cell: (typeof startCells)[number],
    left?: number,
    pinned?: "end-region" | "start",
  ) => (
    <div
      key={cell.id}
      className={[
        "mechanics-cell",
        pinned === "start" ? "is-pinned" : "",
        pinned === "end-region" ? "is-end-region-cell" : "",
        activeColumnId === cell.column.id ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="gridcell"
      aria-selected={activeColumnId === cell.column.id}
      style={columnPosition(cell.column, left, pinned)}
      onPointerDown={() => {
        table.setFocusedCell(row.id, cell.column.id);
        scrollRef.current?.focus({ preventScroll: true });
      }}
    >
      {formatCellValue(cell.getValue())}
    </div>
  );

  return (
    <div
      className="mechanics-row mechanics-data-row"
      role="row"
      aria-rowindex={row.getDisplayIndex() + 1}
      style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
    >
      {startCells.map((cell) => renderCell(cell, undefined, "start"))}
      {virtualColumns.map((virtualColumn) => {
        const cell = centerCells[virtualColumn.index];
        return cell ? renderCell(cell, virtualColumn.start) : null;
      })}
      <div
        className="mechanics-pinned-end-region mechanics-pinned-end-region--row"
        style={{ width: sumColumnWidths(endCells.map((cell) => cell.column)) }}
      >
        {endCells.map((cell) => renderCell(cell, undefined, "end-region"))}
      </div>
    </div>
  );
}

function columnPosition(
  column: MechanicsColumn,
  left?: number,
  pinned?: "end-region" | "start",
): React.CSSProperties {
  if (pinned === "start") {
    return { width: column.getSize(), insetInlineStart: column.getStart("start") };
  }
  if (pinned === "end-region") {
    return { width: column.getSize(), insetInlineEnd: column.getAfter("end") };
  }
  return { width: column.getSize(), left };
}
