# Use repetition-only Drag Fill

BrunoTable Drag Fill duplicates data; it never guesses user intent. A one-cell source repeats that cell, while a multi-cell Linear Cell Range repeats its exact source sequence cyclically along the same axis, phase-aligned to the source's logical start. Filling before the source uses the same continuous cycle through Euclidean modulo, so the cell immediately before `[A, B]` receives `B`.

No value type, Column Helper, modifier key, or public fill policy enables numeric, BigInt, BigDecimal, date, text, trend, or other series inference. Target columns still parse the source cells' canonical exchange text and run normal atomic validation, so an incompatible repeated value rejects the complete gesture. Applications that truly need generated values must use an explicit application command rather than overloading Drag Fill with hidden arithmetic.
