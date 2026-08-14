import { describe, expect, it } from "vite-plus/test";

import { isChartPayload, readChartPayloadProperty } from "#lib/chart-payload";

describe("chart payload property lookup", () => {
  it("preserves inherited values and accessor receivers", () => {
    class InheritedPayload {
      readonly dataKey = "inherited";

      get payload() {
        return { dataKey: "nested" };
      }
    }

    function createInheritedPayload(): InheritedPayload {
      return new InheritedPayload();
    }

    const unknownPayload: unknown = createInheritedPayload();
    if (!isChartPayload(unknownPayload)) {
      throw new Error("expected a chart payload");
    }

    expect(readChartPayloadProperty(unknownPayload, "dataKey")).toBe("inherited");

    const nestedPayload = readChartPayloadProperty(unknownPayload, "payload");
    if (!isChartPayload(nestedPayload)) {
      throw new Error("expected a nested chart payload");
    }

    expect(readChartPayloadProperty(nestedPayload, "dataKey")).toBe("nested");
  });

  it("returns undefined when a property is absent across the prototype chain", () => {
    const unknownPayload: unknown = JSON.parse('{"dataKey":"series"}');
    if (!isChartPayload(unknownPayload)) {
      throw new Error("expected a chart payload");
    }

    expect(readChartPayloadProperty(unknownPayload, "missing")).toBeUndefined();
  });

  it("rejects unsupported function-valued properties at the lookup boundary", () => {
    const payload = { dataKey: () => "not a chart value" };
    if (!isChartPayload(payload)) {
      throw new Error("expected a chart payload");
    }

    expect(readChartPayloadProperty(payload, "dataKey")).toBeUndefined();
  });

  it("preserves proxy get behavior", () => {
    const proxyPayload = new Proxy({ dataKey: "ignored" }, { get: () => "proxy" });

    if (!isChartPayload(proxyPayload)) {
      throw new Error("expected a proxy chart payload");
    }

    expect(readChartPayloadProperty(proxyPayload, "dataKey")).toBe("proxy");
  });

  it("retains array payload property behavior", () => {
    const arrayPayload = ["series"];

    if (!isChartPayload(arrayPayload)) {
      throw new Error("expected an array payload");
    }

    expect(readChartPayloadProperty(arrayPayload, "length")).toBe(1);
  });
});
