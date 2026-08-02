type ColumnIdentity = {
  readonly columnId: string;
};

const columnIdPattern = /^COL_ID_[^a-z]+$/u;

export class ColumnConfigurationError extends TypeError {}

export function validateColumns(columns: readonly ColumnIdentity[]): void {
  const seen = new Set<string>();

  for (const { columnId } of columns) {
    if (!columnIdPattern.test(columnId)) {
      throw new ColumnConfigurationError(
        `BrunoTable columnId must start with COL_ID_ and contain no lowercase letters: ${columnId}`,
      );
    }

    if (seen.has(columnId)) {
      throw new ColumnConfigurationError(`BrunoTable columnId must be unique: ${columnId}`);
    }

    seen.add(columnId);
  }
}
