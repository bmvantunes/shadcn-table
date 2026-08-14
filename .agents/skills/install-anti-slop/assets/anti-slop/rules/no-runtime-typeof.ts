import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const comparisonOperators = new Set<ESTree.BinaryExpression["operator"]>([
  "==",
  "!=",
  "===",
  "!==",
]);
const runtimeTypeTags = new Set([
  "bigint",
  "boolean",
  "function",
  "number",
  "object",
  "string",
  "symbol",
  "undefined",
]);

function isBoundaryComparison(node: ESTree.UnaryExpression): boolean {
  const parent = node.parent;
  if (
    parent === null ||
    parent.type !== "BinaryExpression" ||
    !comparisonOperators.has(parent.operator) ||
    (parent.left !== node && parent.right !== node)
  ) {
    return false;
  }
  const compared = parent.left === node ? parent.right : parent.left;
  return (
    compared.type === "Literal" &&
    typeof compared.value === "string" &&
    runtimeTypeTags.has(compared.value)
  );
}

/** Disallow extracting raw typeof tags; valid direct comparisons remain runtime type guards. */
export const noRuntimeTypeofRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow extracting raw typeof tags; valid direct comparisons remain available as runtime type guards.",
    },
    messages: {
      runtimeTypeof:
        "Extracting a raw `typeof` tag leaves representation knowledge outside a local type guard. Keep the check as a direct comparison against a valid runtime tag.",
    },
  },
  create(context) {
    return {
      UnaryExpression(node) {
        if (node.operator === "typeof" && !isBoundaryComparison(node)) {
          context.report({ node, messageId: "runtimeTypeof" });
        }
      },
    };
  },
});
