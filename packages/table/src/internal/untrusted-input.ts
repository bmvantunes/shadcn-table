/** Captures one plain data record without invoking accessors from an untrusted snapshot. */
export function captureBrunoTablePlainRecord(
  input: unknown,
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    ) {
      return undefined;
    }
    const snapshot: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        return undefined;
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
}
