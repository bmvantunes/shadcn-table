# Rust-native React Compiler migration

Research snapshot: 2026-08-20.

## Conclusion

The repository can now remove its React Compiler-specific Babel pipeline. The supported replacement is:

- `@vitejs/plugin-react@6.1.0` or newer in the 6.x line;
- `oxc-transform-react@0.145.0` or a compatible `^0.145.0` release;
- Oxlint `1.70.0` or newer with the built-in `react/react-compiler` rule enabled explicitly.

`@vitejs/plugin-react` 6.1.0 is the first release with experimental native React Compiler support. Its release notes prescribe installing `oxc-transform-react` and using `react({ compiler: true })` ([6.1.0 release](https://github.com/vitejs/vite-plugin-react/releases/tag/plugin-react%406.1.0), [6.1.0 changelog](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.1.0/packages/plugin-react/CHANGELOG.md#610-2026-08-19)). The shipped package declares `oxc-transform-react: ^0.145.0` as an optional peer and requires Vite 8 and Node `^20.19.0 || >=22.12.0` ([6.1.0 package manifest](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.1.0/packages/plugin-react/package.json)).

For this React 19 repository, preserve the existing compiler intent explicitly:

```ts
const reactCompilerOptions = {
  compilationMode: "infer",
  eslintSuppressionRules: [] as string[],
  panicThreshold: "all_errors",
  target: "19",
} as const;

react({ compiler: reactCompilerOptions });
```

`target: "19"` and `compilationMode: "infer"` are already native defaults, but spelling them out makes the migration behavior auditable. `panicThreshold: "all_errors"` deliberately changes the transform default from `"none"` so recoverable compiler diagnostics abort the transform. `eslintSuppressionRules: []` disables upstream-compatible lint-comment opt-outs so a Hooks suppression cannot silently remove a function from compiler coverage. The plugin also accepts `compiler: true` for the upstream defaults and documents object-valued compiler configuration ([plugin-react 6.1.0 README](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.1.0/packages/plugin-react/README.md#rust-react-compiler), [Oxc transform options](https://github.com/oxc-project/oxc/blob/crates_v0.145.0/napi/transform-react/README.md#react-compiler-options)).

The table's imperative viewport/ref ownership remains isolated in the focused `react-compiler-adapters.ts` module, but that module is still compiled and linted. Stable method bindings are captured during state initialization so React render paths do not read mutable runtime objects or refs.

## Native transform path

The `compiler` option is not a renamed Babel preset. `@vitejs/plugin-react` dynamically imports `oxc-transform-react`, installs a `vite:react-compiler` pre-transform, and passes the React Compiler options into the Rust-native transform together with JSX and Fast Refresh options ([versioned plugin source](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.1.0/packages/plugin-react/src/index.ts), [integration PR #1419](https://github.com/vitejs/vite-plugin-react/pull/1419)). The plugin fails with an actionable error if the optional package is absent.

The dedicated transform package combines the Rust React Compiler, TypeScript removal, JSX lowering, and React Fast Refresh. React Compiler runs before the other transforms so it sees original JSX, which React Compiler requires ([Oxc transform documentation](https://oxc.rs/docs/guide/usage/transformer/react-compiler.html), [versioned transform README](https://github.com/oxc-project/oxc/blob/crates_v0.145.0/napi/transform-react/README.md)). `oxc-transform-react` 0.145.0 is the compatible release requested by plugin-react 6.1.0; Oxc published that immutable release on 2026-08-18 ([Oxc 0.145.0 release](https://github.com/oxc-project/oxc/releases/tag/crates_v0.145.0)).

The migration should therefore delete, rather than retain disabled copies of:

- `@babel/core` when no unrelated repository consumer remains;
- `@rolldown/plugin-babel` when no unrelated Babel transform remains;
- `babel-plugin-react-compiler`;
- imports and calls to `reactCompilerPreset`;
- separate Babel plugin instances used for Vite, browser tests, or `pack.plugins`.

The native React plugin can be registered in both places needed by the current Vite+ layout:

```ts
plugins: [react({ compiler: reactCompilerOptions })],
pack: {
  plugins: [...react({ compiler: reactCompilerOptions })],
},
```

The spread is important for a plugin collection in `pack.plugins`. The plugin declares raw Rolldown compatibility and, outside Vite, configures Rolldown's JSX transform itself ([plugin-react 6.1.0 manifest](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.1.0/packages/plugin-react/package.json), [plugin implementation](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.1.0/packages/plugin-react/src/index.ts)). Vite+ still treats its top-level Vite plugins and `pack.plugins` as separate registrations, so enabling the compiler only at the top level would not establish compiled library output.

## Oxlint diagnostics

Oxlint added its native `react/react-compiler` rule in 1.70.0. The versioned release notes identify the implementing change, and the current rule documentation repeats the minimum version ([Oxlint 1.70.0 release](https://github.com/oxc-project/oxc/releases/tag/oxlint_v1.70.0), [implementation PR #23202](https://github.com/oxc-project/oxc/pull/23202), [rule documentation](https://oxc.rs/docs/guide/usage/linter/rules/react/react-compiler.html)).

The rule:

- runs React Compiler analysis in lint-only mode;
- surfaces the same Rules of React diagnostics as `eslint-plugin-react-compiler`;
- is experimental and may change;
- belongs to the `react` plugin, which is off by default;
- is itself off by default and must be enabled explicitly;
- accepts `reportAllBailouts: boolean`, defaulting to `false`.

The repository-equivalent configuration is:

```ts
lint: {
  plugins: ["typescript", "react"],
  rules: {
    "react/react-compiler": ["error", { reportAllBailouts: true }],
  },
},
```

For a standalone Oxlint config, the equivalent JSON is:

```json
{
  "plugins": ["react"],
  "rules": {
    "react/react-compiler": ["error", { "reportAllBailouts": true }]
  }
}
```

This repository deliberately enables `reportAllBailouts`. The native rule's default reports correctness violations but permits non-fatal optimization bailouts. With the option enabled at error severity, `vp check` also fails whenever a component or hook is not optimized, closing the gap left by transform strictness alone ([Oxlint rule source at 1.70.0](https://github.com/oxc-project/oxc/blob/oxlint_v1.70.0/crates/oxc_linter/src/rules/react/react_compiler.rs)).

The repository's Vite+ 0.2.7 installation currently resolves Oxlint 1.75.0, so it already exceeds the 1.70.0 minimum. No direct `oxlint` dependency is required solely for this rule while Vite+ owns that toolchain version.

## Behavioral caveats

Native support remains explicitly experimental in both plugin-react and Oxc. Generated output and the existing compiler smoke fixture should remain part of validation ([plugin-react README](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.1.0/packages/plugin-react/README.md#rust-react-compiler), [Oxc transform documentation](https://oxc.rs/docs/guide/usage/transformer/react-compiler.html)).

The plugin compiles only client-consumer transforms under Vite. Server-consumer transforms still pass through the native package for TypeScript/JSX lowering with React Compiler disabled. Under raw Rolldown, where Vite environment metadata is absent, the transform is treated as client output. This matches the repository's client library build but should be revisited if a future package emits a dedicated SSR artifact ([plugin implementation](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.1.0/packages/plugin-react/src/index.ts)).

React 17 and 18 targets require `react-compiler-runtime`; target 19 uses `react/compiler-runtime`. This repository targets React 19, so it needs no separate compiler runtime package ([Oxc transform types](https://github.com/oxc-project/oxc/blob/crates_v0.145.0/napi/transform-react/index.d.ts), [plugin implementation](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.1.0/packages/plugin-react/src/index.ts)).

The transform skips `node_modules` by default. Supplying native `sources` replaces that default filter, and the native boundary accepts only a string array rather than the Babel plugin's function-valued source filter. The repository does not need a custom `sources` option for its own package source ([Oxc 0.145.0 declarations](https://github.com/oxc-project/oxc/blob/crates_v0.145.0/napi/transform-react/index.d.ts)).

Finally, `eslintSuppressionRules` is retained as the upstream-compatible compiler option name, but the native implementation recognizes both ESLint and Oxlint directive comments. Its default opt-out rule names are `react-hooks/exhaustive-deps` and `react-hooks/rules-of-hooks`; this option name is not evidence that ESLint packages must stay installed ([Oxc 0.145.0 transform README](https://github.com/oxc-project/oxc/blob/crates_v0.145.0/napi/transform-react/README.md)).

## Remaining Babel and ESLint audit

- No ESLint package, plugin, configuration, or installed lockfile snapshot remains.
- No installed `@rolldown/plugin-babel` or `babel-plugin-react-compiler` snapshot remains. Their names appear only in `@vitejs/plugin-react@6.1.0`'s upstream optional peer metadata; `autoInstallPeers: false` prevents pnpm from materializing them.
- `@babel/core@7.29.7` and its TypeScript transform helpers remain transitively through `shadcn@4.16.2`. `@bruno/shadcn` requires that package because `packages/shadcn/src/styles/globals.css` imports its published `shadcn/tailwind.css` entry point.
- `@babel/runtime@7.29.7` remains transitively through `@base-ui/react` and through Vitest Browser Mode's Testing Library dependencies. Neither path participates in React Compiler transformation.

These paths are generated dependency metadata for concrete unrelated consumers, not retained React Compiler compatibility tooling. `pnpm why -r @babel/core` and `pnpm why -r @babel/runtime` provide the reproducible graph evidence.

## Recommended version pins for this migration

Use the newly published compatible pair:

```json
{
  "@vitejs/plugin-react": "^6.1.0",
  "oxc-transform-react": "^0.145.0"
}
```

Keep the Vite+/Oxlint versions already controlled by the workspace unless validation demonstrates a separate incompatibility. Remove React Compiler-specific Babel and ESLint packages after dependency and reference searches establish that no unrelated consumer remains.
