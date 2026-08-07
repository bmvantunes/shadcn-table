# React Compiler through Oxc in the current Vite+ stack

Research snapshot: 2026-08-02.

## Conclusion

Do not remove Babel yet.

The Rust rewrite of React Compiler is real, merged, materially faster, and already integrated into Oxc's source tree. The important distinction is that it is **not currently available through a supported, published Vite or Vite+ integration**. In this repository's exact stack, the supported code-emitting React Compiler path remains:

```text
@rolldown/plugin-babel -> babel-plugin-react-compiler
```

Vite already uses Oxc for TypeScript, JSX, and React Fast Refresh. Oxlint also runs Rust React Compiler analysis for its `react/react-compiler` rule. Neither of those facts means that Oxc is currently emitting React Compiler's memoization transform in the Vite or `vp pack` pipeline.

The native migration should happen once Oxc's new dedicated `oxc-transform-react` package is published and either Vite exposes an official integration or we can justify a small, well-tested adapter. Pinning the withdrawn `oxc-transform@0.136` API would trade a supported compiler path for an abandoned experimental one.

## Exact repository stack

The relevant package currently uses:

- `vite-plus@0.2.7` and `@voidzero-dev/vite-plus-core@0.2.7`;
- `@vitejs/plugin-react@6.0.5`;
- React `19.2.8`;
- `@rolldown/plugin-babel@0.2.3`, `@babel/core@7.29.7`, and `babel-plugin-react-compiler@1.0.0`;
- Vite+'s bundled `oxc-transform@0.141.0` and `tsdown@0.22.14`.

The Oxc and tsdown versions are fixed in the [Vite+ v0.2.7 dependency catalog](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/pnpm-workspace.yaml#L96-L121). The active compiler wiring is in the repository's [`packages/shadcn/vite.config.ts`](../../../packages/shadcn/vite.config.ts).

## What is already native, and what is not

| Concern                                      | Current engine                                  | Runs React Compiler's memoization transform?           |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| TypeScript erasure and JSX lowering in Vite  | Oxc                                             | No                                                     |
| React Fast Refresh in `@vitejs/plugin-react` | Oxc                                             | No                                                     |
| `react/react-compiler` lint rule             | Oxlint using native compiler analysis           | No; lint/diagnostics only                              |
| Vite client dev/build transform              | Babel compiler through `@rolldown/plugin-babel` | Yes                                                    |
| Default Vitest/server transform              | Vite pipeline, but compiler preset is filtered  | No; the preset applies only to `consumer === "client"` |
| `vp pack` library transform                  | Babel compiler through `pack.plugins`           | Yes                                                    |

Vite's own feature guide says JSX is handled by Oxc and exposes ordinary JSX settings through `oxc.jsx`; it does not document React Compiler as a Vite `oxc` option ([Vite JSX guide](https://vite.dev/guide/features.html#jsx)). The installed plugin-react source configures Oxc's JSX runtime and Fast Refresh ([plugin-react 6.0.5 source](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.0.5/packages/plugin-react/src/index.ts#L81-L140)). Its documented React Compiler API is separately and explicitly Babel-based: `babel({ presets: [reactCompilerPreset()] })` with `@rolldown/plugin-babel`, `@babel/core`, and `babel-plugin-react-compiler` ([plugin-react 6.0.5 README](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.0.5/packages/plugin-react/README.md#L80-L129)). The preset source resolves `babel-plugin-react-compiler` directly and limits it to Vite environments whose consumer is `client` ([preset source](https://github.com/vitejs/vite-plugin-react/blob/plugin-react%406.0.5/packages/plugin-react/src/reactCompilerPreset.ts#L9-L35)). Consequently, registering the plugin at the top level makes it available to the shared Vite pipeline, but the ordinary server-side Vitest transform is intentionally skipped; browser/client environments can opt into it.

React's own current Vite instructions prescribe the same Babel-backed configuration and emphasize that the compiler must receive original source before other transforms ([React installation guide](https://react.dev/learn/react-compiler/installation#vite)).

Oxlint is useful as a strict compatibility gate, but its rule runs the compiler in lint-only mode and reports violations or compiler bailouts; it does not rewrite output ([Oxlint rule documentation](https://oxc.rs/docs/guide/usage/linter/rules/react/react-compiler.html)).

## The native Oxc timeline

### The Rust compiler exists

React merged its experimental Rust port on 2026-06-09. The merge describes it as work in progress, reports roughly 3x speedup when used behind a Babel adapter and roughly 10x faster transform logic, and expects native Oxc/SWC integrations to avoid serialization overhead ([React PR #36173](https://github.com/facebook/react/pull/36173)). That makes the native direction compelling; it does not make every integration production-ready.

### `oxc-transform` briefly exposed it

Oxc first integrated the Rust port in release `0.135.0` ([release notes](https://github.com/oxc-project/oxc/releases/tag/crates_v0.135.0), [integration PR #22942](https://github.com/oxc-project/oxc/pull/22942)). Version `0.136.0` exposed this JavaScript API:

```ts
import { transform } from "oxc-transform";

await transform("Component.tsx", source, {
  reactCompiler: {
    compilationMode: "infer",
    target: "19",
  },
  jsx: {
    runtime: "automatic",
  },
});
```

The release declarations specify that `reactCompiler` ran first and accepted `boolean | ReactCompilerOptions` ([0.136 declarations](https://github.com/oxc-project/oxc/blob/crates_v0.136.0/napi/transform/index.d.ts#L537-L568)). Internally it was a feature-gated transform pass ([Oxc PR #23201](https://github.com/oxc-project/oxc/pull/23201)).

That JavaScript API existed only in `oxc-transform` `0.135.0` and `0.136.0`. Oxc deliberately removed it from the N-API package in `0.137.0` because Cargo feature-gating could not produce a truthful, consistent published `index.d.ts`; the removal PR explicitly calls this a breaking change and names the two affected releases ([Oxc PR #23590](https://github.com/oxc-project/oxc/pull/23590)).

The installed `0.141.0` declarations therefore expose only `styledComponents` and `taggedTemplateEscape` under `PluginsOptions`, and no `reactCompiler` field in `TransformOptions` ([0.141 declarations](https://github.com/oxc-project/oxc/blob/crates_v0.141.0/napi/transform/index.d.ts#L327-L330), [transform options](https://github.com/oxc-project/oxc/blob/crates_v0.141.0/napi/transform/index.d.ts#L458-L489)). Adding `oxc: { reactCompiler: ... }` to this Vite+ version is neither typed nor implemented.

Oxc's website currently still shows the withdrawn `oxc-transform(..., { reactCompiler: true })` example and labels it experimental ([Oxc React Compiler page](https://oxc.rs/docs/guide/usage/transformer/react-compiler)). For this fast-moving feature, the versioned package declarations and removal PR are the stronger compatibility contract.

Rolldown briefly exposed the same option as `transform.reactCompiler` for bundler, standalone-transform, and Vite users on 2026-06-17 ([Rolldown PR #9801](https://github.com/rolldown/rolldown/pull/9801)). The following day, its Oxc `0.137.0` update removed the integration because Oxc had removed the upstream API ([Rolldown removal commit](https://github.com/rolldown/rolldown/commit/455fb604daca39660ab8bd23b47a428f974e8e6c)). The option therefore never appeared in a stable Rolldown release. Current Rolldown `1.2.1`, Vite `8.2.0`, and the versions embedded by Vite+ `0.2.7` have no `reactCompiler` transform field; unknown fields are not a usable compatibility path.

### The replacement is a separate package, but it is not published

On 2026-07-29, after Oxc `0.142.0` had been published, Oxc merged a dedicated N-API package named `oxc-transform-react` ([binding PR #24934](https://github.com/oxc-project/oxc/pull/24934)). It then removed React Compiler coupling from the general transformer and kept the integration in that dedicated binding ([decoupling PR #25065](https://github.com/oxc-project/oxc/pull/25065)).

Its intended API is much closer to what this repository wants:

```ts
import { transformSync } from "oxc-transform-react";

const result = transformSync("Component.tsx", source, {
  compilationMode: "infer",
  target: "19",
  sourcemap: true,
});
```

The binding promises to run React Compiler first on the pristine AST, then lower TypeScript and JSX ([current package declarations](https://github.com/oxc-project/oxc/blob/e52f4c4585464b10865d4d1d1fee5257ee997359/napi/transform-react/index.d.ts)). However, as of this research date, [`oxc-transform-react` is absent from npm](https://registry.npmjs.org/oxc-transform-react). No Vite, plugin-react, Vite+, Rolldown, or tsdown first-party source currently integrates that package. Its next published version is not yet known.

## Why Vite and `vp pack` need separate treatment

The repository's current duplication is intentional:

```ts
plugins: [react(), reactCompilerForVite, tailwindcss()],
pack: {
  plugins: [reactCompilerForLibrary],
},
```

Top-level Vite plugins participate in the Vite/Vitest pipeline, subject to each plugin's environment filter. `vp pack` is a separate library build powered by tsdown and reads the independent `pack` configuration ([Vite+ pack guide](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/docs/guide/pack.md#L1-L42)). The v0.2.7 implementation extracts `viteConfig.pack`, passes each pack config to tsdown, and uses the plugins inside that object; it does not merge the top-level Vite plugin array ([Vite+ pack source](https://github.com/voidzero-dev/vite-plus/blob/v0.2.7/packages/cli/src/pack-bin.ts#L148-L173)).

Consequently, a future native adapter must be installed in both places just as the Babel adapter is today:

- a pre-transform Vite plugin for dev and tests;
- a Rolldown plugin in `pack.plugins` for published library output.

The implementation may be shared, but the two registrations cannot be collapsed into one config entry.

## Safe migration gate

Replace Babel only after all of these are true:

1. `oxc-transform-react` is published for every platform supported by the repository and no longer requires a Git dependency or local Rust build.
2. Preferably, Vite/plugin-react exposes a first-party native compiler integration. If not, Oxc documents a supported bundler adapter contract rather than only a low-level transform function.
3. The adapter runs before JSX or source-rewriting transforms, because React Compiler requires pristine source.
4. The same compiler options and file filters are used in Vite/Vitest and `vp pack` without compiling dependencies or non-React modules.
5. Source maps, Fast Refresh, SSR/client modes, diagnostics, and compiler bailouts are exercised explicitly.
6. The existing compiler smoke fixture still proves that emitted package code imports `react/compiler-runtime` and contains memo-cache output.
7. Full package exports, SSR import checks, tests, tarball audit, and representative consumer builds pass before deleting the Babel dependencies.

At that point, the expected cleanup is complete removal of `@babel/core`, `@rolldown/plugin-babel`, and `babel-plugin-react-compiler`, plus replacement of both current Babel plugin instances. Until then, the existing configuration is the supported path and already uses Oxc everywhere Vite can safely use it today.
