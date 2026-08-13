import { transformAsync, types as babelTypes } from "@babel/core";

function replaceBrunoTableProductionDefines(replaceDevelopment) {
  const diagnosticFalseNodes = new WeakSet();
  const createNodeEnvironment = () =>
    babelTypes.optionalMemberExpression(
      babelTypes.optionalMemberExpression(
        babelTypes.memberExpression(
          babelTypes.identifier("globalThis"),
          babelTypes.identifier("process"),
        ),
        babelTypes.identifier("env"),
        false,
        true,
      ),
      babelTypes.identifier("NODE_ENV"),
      false,
      true,
    );
  return {
    name: "replace-bruno-table-production-defines",
    visitor: {
      ReferencedIdentifier(path) {
        if (path.node.name === "__BRUNO_TABLE_TEST_DIAGNOSTICS__") {
          const replacement = babelTypes.booleanLiteral(false);
          diagnosticFalseNodes.add(replacement);
          path.replaceWith(replacement);
          return;
        }
        if (!replaceDevelopment || path.node.name !== "__BRUNO_TABLE_DEVELOPMENT__") return;
        path.replaceWith(
          babelTypes.logicalExpression(
            "&&",
            babelTypes.binaryExpression(
              "===",
              babelTypes.unaryExpression("typeof", createNodeEnvironment()),
              babelTypes.stringLiteral("string"),
            ),
            babelTypes.binaryExpression(
              "!==",
              createNodeEnvironment(),
              babelTypes.stringLiteral("production"),
            ),
          ),
        );
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

export function BrunoTableProductionDefines() {
  return {
    name: "bruno-table-production-defines",
    enforce: "pre",
    async transform(code, id) {
      if (!id.includes("/src/")) return;
      const replaceDevelopment = id.endsWith("/src/bruno-table-client.tsx");
      if (
        !code.includes("__BRUNO_TABLE_TEST_DIAGNOSTICS__") &&
        !(replaceDevelopment && code.includes("__BRUNO_TABLE_DEVELOPMENT__"))
      ) {
        return;
      }
      const result = await transformAsync(code, {
        babelrc: false,
        configFile: false,
        filename: id,
        parserOpts: {
          plugins: id.endsWith("x") ? ["typescript", "jsx"] : ["typescript"],
          sourceType: "module",
        },
        plugins: [replaceBrunoTableProductionDefines(replaceDevelopment)],
        sourceMaps: true,
      });
      return { code: result?.code ?? code, map: result?.map };
    },
  };
}
