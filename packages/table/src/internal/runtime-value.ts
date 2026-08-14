/**
 * A parsed object-shaped runtime value owned by a BrunoTable boundary.
 * @anti-slop-dictionary-owner This record is created only after the boundary object check.
 */
export interface BrunoTableRuntimeRecord {
  readonly [key: PropertyKey]:
    | object
    | string
    | number
    | bigint
    | boolean
    | symbol
    | null
    | undefined;
}

/** Parse an arbitrary JavaScript value into the record shape owned by a runtime boundary. */
export function isBrunoTableRuntimeRecord(value: unknown): value is BrunoTableRuntimeRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
