type EditGeometryInput = Readonly<{
  readonly grid: HTMLElement;
  readonly layer: HTMLElement;
  readonly rowId: string;
  readonly rowIndex: number | undefined;
  readonly rowHeight: number;
}>;

/** Imperative fixed-row geometry for one active Cell Edit Session. */
export class BrunoTableCellEditGeometryController {
  private input: EditGeometryInput | undefined;
  private frame: number | undefined;
  private rowId: string | undefined;
  private appliedRowIndex: number | undefined;
  private anchorViewportTop: number | undefined;
  private hiddenProjectionRow: HTMLElement | undefined;

  public readonly reconcile = (input: EditGeometryInput): void => {
    if (this.rowId !== input.rowId) {
      this.restoreProjectionRow();
      this.rowId = input.rowId;
      this.appliedRowIndex = input.rowIndex;
      this.anchorViewportTop = findProjectedRow(
        input.grid,
        input.rowId,
      )?.getBoundingClientRect().top;
    }
    this.input = input;
    this.schedule();
  };

  public readonly release = (): void => {
    const input = this.input;
    if (this.frame !== undefined && input !== undefined) {
      input.grid.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    }
    this.frame = undefined;
    this.input = undefined;
    this.rowId = undefined;
    this.appliedRowIndex = undefined;
    this.anchorViewportTop = undefined;
    this.restoreProjectionRow();
  };

  private readonly schedule = (): void => {
    const input = this.input;
    if (input === undefined || this.frame !== undefined) return;
    const view = input.grid.ownerDocument.defaultView;
    if (view === null) return;
    this.frame = view.requestAnimationFrame(() => {
      this.frame = undefined;
      this.flush();
    });
  };

  private readonly flush = (): void => {
    const input = this.input;
    if (input === undefined) return;
    const { grid, layer, rowId, rowIndex } = input;
    if (rowIndex !== undefined && this.appliedRowIndex !== undefined) {
      const requestedDelta = (rowIndex - this.appliedRowIndex) * input.rowHeight;
      if (requestedDelta !== 0) {
        const before = grid.scrollTop;
        grid.scrollTop = before + requestedDelta;
      }
      this.appliedRowIndex = rowIndex;
    } else if (rowIndex !== undefined) {
      this.appliedRowIndex = rowIndex;
    }

    const projectedRow = findProjectedRow(grid, rowId);
    if (this.anchorViewportTop === undefined && projectedRow !== undefined) {
      this.anchorViewportTop = projectedRow.getBoundingClientRect().top;
    }
    if (projectedRow !== this.hiddenProjectionRow) {
      this.restoreProjectionRow();
      this.hiddenProjectionRow = projectedRow;
      projectedRow?.style.setProperty("visibility", "hidden");
    }

    const parent = layer.offsetParent?.getBoundingClientRect();
    const anchor = this.anchorViewportTop;
    if (parent !== undefined && anchor !== undefined) {
      layer.style.insetInlineStart = `${String(grid.scrollLeft)}px`;
      layer.style.top = `${String(anchor - parent.top)}px`;
    }
  };

  private readonly restoreProjectionRow = (): void => {
    this.hiddenProjectionRow?.style.removeProperty("visibility");
    this.hiddenProjectionRow = undefined;
  };
}

function findProjectedRow(grid: HTMLElement, rowId: string): HTMLElement | undefined {
  for (const cell of grid.querySelectorAll<HTMLElement>('[role="gridcell"][data-bruno-row-id]')) {
    if (cell.dataset["brunoRowId"] !== rowId) continue;
    if (cell.closest("[data-bruno-edit-owned-row]") !== null) continue;
    const row = cell.closest<HTMLElement>('[role="row"]');
    if (row !== null) return row;
  }
  return undefined;
}
