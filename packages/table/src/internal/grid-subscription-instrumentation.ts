type ColumnCommandSubscriptionListener = (event: {
  readonly tableId: string;
  readonly columnId: string;
  readonly listenerCount: number;
}) => void;

const columnCommandSubscriptionListenersByTableId = new Map<
  string,
  Set<ColumnCommandSubscriptionListener>
>();
let diagnosticListenerCount = 0;

export function recordBrunoTableColumnCommandSubscriptionNotification(
  tableId: string,
  columnId: string,
  subscribedColumnListenerCount: number,
): void {
  if (diagnosticListenerCount === 0 || subscribedColumnListenerCount === 0) return;
  const listeners = columnCommandSubscriptionListenersByTableId.get(tableId);
  if (listeners === undefined) return;
  const event = Object.freeze({
    tableId,
    columnId,
    listenerCount: subscribedColumnListenerCount,
  });
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Diagnostics are observational and must never alter notification delivery.
    }
  }
}

export function installBrunoTableColumnCommandSubscriptionListener(
  tableId: string,
  listener: ColumnCommandSubscriptionListener,
): () => void {
  let listeners = columnCommandSubscriptionListenersByTableId.get(tableId);
  if (listeners === undefined) {
    listeners = new Set<ColumnCommandSubscriptionListener>();
    columnCommandSubscriptionListenersByTableId.set(tableId, listeners);
  }
  listeners.add(listener);
  diagnosticListenerCount += 1;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners?.delete(listener);
    if (
      listeners?.size === 0 &&
      columnCommandSubscriptionListenersByTableId.get(tableId) === listeners
    ) {
      columnCommandSubscriptionListenersByTableId.delete(tableId);
    }
    diagnosticListenerCount -= 1;
  };
}
