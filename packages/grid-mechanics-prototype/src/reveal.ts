export interface BrunoTableRevealAxisInput {
  readonly itemEnd: number;
  readonly itemStart: number;
  readonly leadingInset: number;
  readonly maxScrollOffset: number;
  readonly scrollOffset: number;
  readonly trailingInset: number;
  readonly viewportSize: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Returns the smallest scroll offset that makes the item visible between the
 * sticky leading and trailing regions. Fully visible items do not move.
 */
export function getMinimalRevealOffset({
  itemEnd,
  itemStart,
  leadingInset,
  maxScrollOffset,
  scrollOffset,
  trailingInset,
  viewportSize,
}: BrunoTableRevealAxisInput): number {
  const visibleStart = scrollOffset + leadingInset;
  const visibleEnd = scrollOffset + viewportSize - trailingInset;

  if (itemStart < visibleStart) {
    return clamp(itemStart - leadingInset, 0, maxScrollOffset);
  }

  if (itemEnd > visibleEnd) {
    return clamp(itemEnd - viewportSize + trailingInset, 0, maxScrollOffset);
  }

  return scrollOffset;
}
