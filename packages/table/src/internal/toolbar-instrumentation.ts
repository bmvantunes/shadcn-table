export type BrunoTableToolbarProjection =
  | "result-row-count"
  | "loaded-row-count"
  | "active-filter-count"
  | "active-sort-count";

export type BrunoTableToolbarSubscriptionEvent = Readonly<{
  readonly tableId: string;
  readonly projection: BrunoTableToolbarProjection;
  readonly phase: "subscribe" | "unsubscribe" | "notify";
}>;

let listener: ((event: BrunoTableToolbarSubscriptionEvent) => void) | undefined;
export type BrunoTableToolbarLifetimeEvent = Readonly<{
  readonly tableId: string;
  readonly kind: "runtime-create" | "row-pipeline-subscribe" | "row-pipeline-unsubscribe";
  readonly identity: object;
}>;

let lifetimeListener: ((event: BrunoTableToolbarLifetimeEvent) => void) | undefined;

export function installBrunoTableToolbarSubscriptionListener(
  next: (event: BrunoTableToolbarSubscriptionEvent) => void,
): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = undefined;
  };
}

export function installBrunoTableToolbarLifetimeListener(
  next: (event: BrunoTableToolbarLifetimeEvent) => void,
): () => void {
  lifetimeListener = next;
  return () => {
    if (lifetimeListener === next) lifetimeListener = undefined;
  };
}

export function recordBrunoTableToolbarSubscription(
  event: BrunoTableToolbarSubscriptionEvent,
): void {
  listener?.(event);
}

export function recordBrunoTableToolbarLifetime(event: BrunoTableToolbarLifetimeEvent): void {
  lifetimeListener?.(event);
}
