type ColumnDefinitionMetadata = {
  readonly columnId: string;
  readonly headerName?: unknown;
};

const columnIdPrefix = "COL_ID_";

function isColumnId(columnId: string): boolean {
  const suffix = columnId.slice(columnIdPrefix.length);

  return (
    columnId.startsWith(columnIdPrefix) && suffix.length > 0 && suffix === suffix.toUpperCase()
  );
}

export class ColumnConfigurationError extends TypeError {}

export function validateColumns(columns: readonly ColumnDefinitionMetadata[]): void {
  const seen = new Set<string>();

  for (const { columnId, headerName } of columns) {
    if (!isColumnId(columnId)) {
      throw new ColumnConfigurationError(
        `BrunoTable columnId must start with COL_ID_ and have a non-empty uppercase suffix: ${columnId}`,
      );
    }

    if (seen.has(columnId)) {
      throw new ColumnConfigurationError(`BrunoTable columnId must be unique: ${columnId}`);
    }

    if (typeof headerName !== "string" || headerName.trim().length === 0) {
      throw new ColumnConfigurationError(
        `BrunoTable headerName must be a non-empty string for column: ${columnId}`,
      );
    }

    seen.add(columnId);
  }
}
