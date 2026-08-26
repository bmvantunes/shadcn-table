export type EffectivePresetOption<TDefaults, TOptions, TKey extends PropertyKey> =
  TOptions extends Record<TKey, infer TValue>
    ? TValue
    : TDefaults extends Record<TKey, infer TValue>
      ? TValue
      : never;

type IsPotentiallyEditable<TEditable> = [TEditable] extends [false | undefined] ? false : true;
type IsStaticallyEditable<TEditable> = [TEditable] extends [
  true | ((...arguments_: never[]) => unknown),
]
  ? true
  : false;

export type EffectiveFieldPresetCapability<TRow, TField extends keyof TRow, TDefaults, TOptions> =
  EffectivePresetOption<TDefaults, TOptions, "blankValue"> extends infer TBlank
    ? [TBlank] extends [never]
      ? EffectivePresetOption<TDefaults, TOptions, "isEditable"> extends infer TEditable
        ? [TEditable] extends [never]
          ? unknown
          : IsPotentiallyEditable<TEditable> extends true
            ? null extends TRow[TField]
              ? never
              : undefined extends TRow[TField]
                ? never
                : unknown
            : unknown
        : never
      : IsStaticallyEditable<EffectivePresetOption<TDefaults, TOptions, "isEditable">> extends true
        ? [TBlank] extends [null]
          ? null extends TRow[TField]
            ? unknown
            : never
          : [TBlank] extends [undefined]
            ? undefined extends TRow[TField]
              ? unknown
              : never
            : never
        : never
    : never;
