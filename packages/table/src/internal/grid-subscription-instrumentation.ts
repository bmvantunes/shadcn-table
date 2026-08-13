import { installTableScopedListener } from "./listener-registry";

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
  return installTableScopedListener(
    columnCommandSubscriptionListenersByTableId,
    tableId,
    listener,
    () => {
      diagnosticListenerCount += 1;
    },
    () => {
      diagnosticListenerCount -= 1;
    },
  );
}
