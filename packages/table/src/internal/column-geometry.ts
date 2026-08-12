export type BrunoTableReorderMeasurement = Readonly<{
  readonly columnIndex: number;
  readonly left: number;
  readonly width: number;
}>;

export function resolveBrunoTableReorderTargetIndex(
  cells: readonly BrunoTableReorderMeasurement[],
  pointerX: number,
  direction: "ltr" | "rtl",
  sourceIndex: number,
  groupStart: number,
  groupEnd: number,
): number {
  const remainingCells = cells.filter((cell) => cell.columnIndex !== sourceIndex);
  let visualSlot = remainingCells.length;
  for (const [index, cell] of remainingCells.entries()) {
    const midpoint = cell.left + cell.width / 2;
    const beforeCell = direction === "rtl" ? pointerX > midpoint : pointerX < midpoint;
    if (beforeCell) {
      visualSlot = index;
      break;
    }
  }
  const referenceCell = remainingCells[visualSlot] ?? remainingCells.at(-1);
  if (referenceCell === undefined) return sourceIndex;
  const referenceIsAfterSource = referenceCell.columnIndex > sourceIndex;
  const insertAfter = visualSlot === remainingCells.length;
  const requestedTarget = insertAfter
    ? referenceCell.columnIndex + (referenceIsAfterSource ? 0 : 1)
    : referenceCell.columnIndex - (referenceIsAfterSource ? 1 : 0);
  return Math.max(groupStart, Math.min(groupEnd, requestedTarget));
}

/**
 * Projects a mounted column through a logical reorder even when the dragged source is no longer
 * mounted by horizontal virtualization. This is the source placeholder for preview math; it does
 * not require a fabricated DOM element or a second layout order.
 */
export function projectBrunoTableLogicalColumnIndex(
  columnIndex: number,
  sourceIndex: number,
  targetIndex: number,
): number {
  if (columnIndex === sourceIndex) return targetIndex;
  if (sourceIndex < targetIndex && columnIndex > sourceIndex && columnIndex <= targetIndex) {
    return columnIndex - 1;
  }
  if (sourceIndex > targetIndex && columnIndex >= targetIndex && columnIndex < sourceIndex) {
    return columnIndex + 1;
  }
  return columnIndex;
}
