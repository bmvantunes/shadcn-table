const developmentExpression = 'globalThis.process?.env?.NODE_ENV !== "production"';

export function BrunoTableProductionDefines() {
  return {
    name: "bruno-table-production-defines",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("/src/")) return;
      const replaceDevelopment = id.endsWith("/src/bruno-table-client.tsx");
      if (
        !code.includes("__BRUNO_TABLE_TEST_DIAGNOSTICS__") &&
        !(replaceDevelopment && code.includes("__BRUNO_TABLE_DEVELOPMENT__"))
      ) {
        return;
      }
      return {
        code: code
          .replaceAll("__BRUNO_TABLE_TEST_DIAGNOSTICS__", "false")
          .replaceAll(
            "__BRUNO_TABLE_DEVELOPMENT__",
            replaceDevelopment ? developmentExpression : "false",
          ),
        map: null,
      };
    },
  };
}
