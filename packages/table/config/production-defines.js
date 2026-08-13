import { transformAsync, types as babelTypes } from "@babel/core";

function removeBrunoTableTestDiagnostics() {
  const diagnosticFalseNodes = new WeakSet();
  return {
    name: "remove-bruno-table-test-diagnostics",
    visitor: {
      ReferencedIdentifier(path) {
        if (path.node.name !== "__BRUNO_TABLE_TEST_DIAGNOSTICS__") return;
        const replacement = babelTypes.booleanLiteral(false);
        diagnosticFalseNodes.add(replacement);
        path.replaceWith(replacement);
      },
      ConditionalExpression: {
        exit(path) {
          if (!diagnosticFalseNodes.has(path.node.test)) return;
          path.replaceWith(path.node.alternate);
        },
      },
      IfStatement: {
        exit(path) {
          if (!diagnosticFalseNodes.has(path.node.test)) return;
          if (path.node.alternate === null) path.remove();
          else path.replaceWith(path.node.alternate);
        },
      },
      LogicalExpression: {
        exit(path) {
          if (path.node.operator !== "&&" || !diagnosticFalseNodes.has(path.node.left)) return;
          const replacement = babelTypes.booleanLiteral(false);
          diagnosticFalseNodes.add(replacement);
          path.replaceWith(replacement);
        },
      },
    },
  };
}

export function brunoTableProductionDefines() {
  return {
    name: "bruno-table-production-defines",
    enforce: "pre",
    async transform(code, id) {
      if (!id.includes("/src/")) return;
      let productionCode = code;
      let map;
      if (productionCode.includes("__BRUNO_TABLE_TEST_DIAGNOSTICS__")) {
        const result = await transformAsync(productionCode, {
          babelrc: false,
          configFile: false,
          filename: id,
          parserOpts: {
            plugins: id.endsWith("x") ? ["typescript", "jsx"] : ["typescript"],
            sourceType: "module",
          },
          plugins: [removeBrunoTableTestDiagnostics],
          sourceMaps: true,
        });
        productionCode = result?.code ?? productionCode;
        map = result?.map;
      }
      const transformedCode = id.endsWith("/src/bruno-table-client.tsx")
        ? productionCode.replaceAll(
            "__BRUNO_TABLE_DEVELOPMENT__",
            'globalThis.process?.env?.NODE_ENV !== "production"',
          )
        : productionCode;
      return { code: transformedCode, map };
    },
  };
}
