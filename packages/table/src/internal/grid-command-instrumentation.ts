import type { BrunoTableGridCommand } from "./column-management";

type GridCommandListener = (command: BrunoTableGridCommand) => void;

const listenersByTableId = new Map<string, Set<GridCommandListener>>();
let listenerCount = 0;

export function recordBrunoTableGridCommand(tableId: string, command: BrunoTableGridCommand): void {
  if (listenerCount === 0) return;
  const listeners = listenersByTableId.get(tableId);
  if (listeners === undefined) return;
  for (const listener of listeners) {
    try {
      listener(command);
    } catch {
      // Diagnostics are observational and must never alter command behavior.
    }
  }
}

export function installBrunoTableGridCommandListener(
  tableId: string,
  listener: GridCommandListener,
): () => void {
  let listeners = listenersByTableId.get(tableId);
  if (listeners === undefined) {
    listeners = new Set<GridCommandListener>();
    listenersByTableId.set(tableId, listeners);
  }
  listeners.add(listener);
  listenerCount += 1;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners?.delete(listener);
    if (listeners?.size === 0 && listenersByTableId.get(tableId) === listeners) {
      listenersByTableId.delete(tableId);
    }
    listenerCount -= 1;
  };
}
