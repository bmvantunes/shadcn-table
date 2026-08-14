import { BRUNO_TABLE_TEST_LISTENER_DIAGNOSTIC_SENTINEL } from "./test-diagnostic-build-contract";

const registrationCounts = new WeakMap<Set<unknown>, Map<unknown, number>>();

export function installTableScopedListener<T>(
  listenersByTableId: Map<string, Set<T>>,
  tableId: string,
  listener: T,
  onInstall?: (buildContract: string) => void,
  onRemove?: (buildContract: string) => void,
): () => void {
  let listeners = listenersByTableId.get(tableId);
  if (listeners === undefined) {
    listeners = new Set<T>();
    listenersByTableId.set(tableId, listeners);
  }
  listeners.add(listener);
  // SAFETY: The WeakMap is keyed only by Set identity; listener element types remain owned by listenersByTableId.
  let registrations = registrationCounts.get(listeners as Set<unknown>);
  if (registrations === undefined) {
    registrations = new Map<unknown, number>();
    // SAFETY: The WeakMap is keyed only by Set identity; listener element types remain owned by listenersByTableId.
    registrationCounts.set(listeners as Set<unknown>, registrations);
  }
  registrations.set(listener, (registrations.get(listener) ?? 0) + 1);
  onInstall?.(BRUNO_TABLE_TEST_LISTENER_DIAGNOSTIC_SENTINEL);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const registrationCount = registrations?.get(listener) ?? 0;
    if (registrationCount <= 1) {
      registrations?.delete(listener);
      listeners?.delete(listener);
    } else {
      registrations?.set(listener, registrationCount - 1);
    }
    if (registrations?.size === 0) {
      // SAFETY: The WeakMap is keyed only by Set identity; listener element types remain owned by listenersByTableId.
      registrationCounts.delete(listeners as Set<unknown>);
    }
    if (listeners?.size === 0 && listenersByTableId.get(tableId) === listeners) {
      listenersByTableId.delete(tableId);
    }
    onRemove?.(BRUNO_TABLE_TEST_LISTENER_DIAGNOSTIC_SENTINEL);
  };
}
