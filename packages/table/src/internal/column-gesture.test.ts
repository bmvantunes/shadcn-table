import { describe, expect, it } from "vitest";

import { createBrunoTableColumnGestureActor } from "./column-gesture";

describe("BrunoTable column gesture workflow", () => {
  it("accepts only one active lifecycle and returns to idle on completion or cancellation", () => {
    const actor = createBrunoTableColumnGestureActor();
    actor.start();

    expect(actor.getSnapshot().value).toBe("idle");
    actor.send({ type: "START", kind: "reorder" });
    expect(actor.getSnapshot().value).toBe("active");

    actor.send({ type: "START", kind: "resize" });
    expect(actor.getSnapshot().value).toBe("active");
    actor.send({ type: "COMMIT" });
    expect(actor.getSnapshot().value).toBe("idle");

    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().value).toBe("idle");
    actor.stop();
  });
});
