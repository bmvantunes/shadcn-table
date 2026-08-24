type BrunoTableServerGroupedPresence =
  | Readonly<{ readonly _tag: "Missing" }>
  | Readonly<{ readonly _tag: "Present"; readonly value: unknown }>;

export type BrunoTableServerGroupedRowSnapshot = Readonly<{
  readonly rowCount: bigint;
  readonly groupKeys: readonly BrunoTableServerGroupedPresence[];
  readonly presences: ReadonlyMap<string, BrunoTableServerGroupedPresence>;
}>;

const brunoTableServerGroupedRows = new WeakSet<object>();

export function markBrunoTableServerGroupedRow(row: object): void {
  brunoTableServerGroupedRows.add(row);
}

export function isBrunoTableServerGroupedRow(
  row: unknown,
): row is BrunoTableServerGroupedRowSnapshot {
  return typeof row === "object" && row !== null && brunoTableServerGroupedRows.has(row);
}
