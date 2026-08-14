import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { isGlobalReflectMethodCall } from "../shared/reflect-method.ts";

function isProxyGetTrap(node: ESTree.CallExpression): boolean {
  let current: ESTree.Node | null = node.parent;
  let functionNode: ESTree.Function | ESTree.ArrowFunctionExpression | null = null;
  while (current !== null && current.type !== "Program") {
    if (current.type === "FunctionExpression" || current.type === "ArrowFunctionExpression") {
      functionNode = current;
      break;
    }
    current = current.parent;
  }
  if (functionNode === null) return false;

  const property = functionNode.parent;
  if (
    property.type !== "Property" ||
    property.value !== functionNode ||
    ((property.key.type !== "Identifier" || property.key.name !== "get") &&
      (property.key.type !== "Literal" || property.key.value !== "get"))
  ) {
    return false;
  }

  const object = property.parent;
  if (object.type !== "ObjectExpression" || object.parent === null) return false;
  const construction = object.parent;
  return (
    construction.type === "NewExpression" &&
    construction.callee.type === "Identifier" &&
    construction.callee.name === "Proxy" &&
    construction.arguments.includes(object)
  );
}

/** Ban Reflect.get, which bypasses ordinary property access and useful type evidence. */
export const noReflectGetRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Reflect.get; use typed property access or parse dynamic input into a named domain type. Direct delegation inside a Proxy get trap is permitted because receiver-aware property semantics are the contract being tested.",
    },
    messages: {
      reflectGet:
        "Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === "Super" || node.callee.type === "V8IntrinsicExpression") return;
        if (
          isGlobalReflectMethodCall(context.sourceCode, node.callee, "get") &&
          !isProxyGetTrap(node)
        ) {
          context.report({ node, messageId: "reflectGet" });
        }
      },
    };
  },
});
