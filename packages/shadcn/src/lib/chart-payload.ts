/**
 * A runtime-checked object used only for dynamic property lookup.
 * @anti-slop-dictionary-owner Values remain unknown until each caller narrows them.
 */
export interface ChartPayload {
  readonly [key: string]: unknown;
}

export type ChartPayloadProperty =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | ChartPayload
  | null
  | undefined;

export function isChartPayload(value: unknown): value is ChartPayload {
  return typeof value === "object" && value !== null;
}

export function readChartPayloadProperty(payload: ChartPayload, key: string): ChartPayloadProperty {
  const value = payload[key];
  if (value === null || value === undefined) return value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    typeof value === "symbol"
  ) {
    return value;
  }
  return isChartPayload(value) ? value : undefined;
}
