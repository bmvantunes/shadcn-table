type ColumnDefinitionMetadata = {
  readonly columnId: string;
  readonly headerName?: unknown;
};

const columnIdPattern = /^COL_ID_[^a-z]+$/u;

export class ColumnConfigurationError extends TypeError {}

export function validateColumns(columns: readonly ColumnDefinitionMetadata[]): void {
  const seen = new Set<string>();

  for (const { columnId, headerName } of columns) {
    if (!columnIdPattern.test(columnId)) {
      throw new ColumnConfigurationError(
        `BrunoTable columnId must start with COL_ID_ and contain no lowercase letters: ${columnId}`,
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
