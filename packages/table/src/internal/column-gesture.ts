import { assign, createActor, createMachine } from "xstate";

export type BrunoTableColumnGestureKind = "resize" | "reorder";

type BrunoTableColumnGestureEvent =
  | Readonly<{
      readonly type: "START";
      readonly kind: BrunoTableColumnGestureKind;
    }>
  | Readonly<{ readonly type: "COMMIT" }>
  | Readonly<{ readonly type: "CANCEL" }>
  | Readonly<{ readonly type: "INVALIDATE" }>;

type BrunoTableColumnGestureContext = Readonly<{
  readonly kind: BrunoTableColumnGestureKind | undefined;
}>;

const brunoTableColumnGestureMachine = createMachine({
  id: "brunoTableColumnGesture",
  initial: "idle",
  types: {} as {
    context: BrunoTableColumnGestureContext;
    events: BrunoTableColumnGestureEvent;
  },
  context: { kind: undefined },
  states: {
    idle: {
      on: {
        START: {
          target: "active",
          actions: assign({ kind: ({ event }) => event.kind }),
        },
      },
    },
    active: {
      on: {
        COMMIT: { target: "idle", actions: assign({ kind: undefined }) },
        CANCEL: { target: "idle", actions: assign({ kind: undefined }) },
        INVALIDATE: { target: "idle", actions: assign({ kind: undefined }) },
      },
    },
  },
});

type BrunoTableColumnGestureSnapshot = Readonly<{
  readonly value: "idle" | "active";
  readonly status: "active" | "done" | "error" | "stopped";
  readonly kind: BrunoTableColumnGestureKind | undefined;
}>;

export type BrunoTableColumnGestureActor = Readonly<{
  readonly start: () => void;
  readonly stop: () => void;
  readonly send: (event: BrunoTableColumnGestureEvent) => void;
  readonly getSnapshot: () => BrunoTableColumnGestureSnapshot;
}>;

export function createBrunoTableColumnGestureActor(): BrunoTableColumnGestureActor {
  const actor = createActor(brunoTableColumnGestureMachine);
  actor.start();
  return Object.freeze({
    start: () => {
      actor.start();
    },
    stop: () => {
      actor.stop();
    },
    send: (event: BrunoTableColumnGestureEvent) => {
      actor.send(event);
    },
    getSnapshot: () => {
      const snapshot = actor.getSnapshot();
      return Object.freeze({
        value: snapshot.value === "active" ? "active" : "idle",
        status: snapshot.status,
        kind: snapshot.context.kind,
      });
    },
  });
}
