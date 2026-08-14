import { defineRule } from "@oxlint/plugins";
import type { ESTree, Scope, SourceCode } from "@oxlint/plugins";

import { isGlobalReflectMethodCall } from "../shared/reflect-method.ts";

function isGlobalProxy(sourceCode: SourceCode, expression: ESTree.Node): boolean {
  if (expression.type !== "Identifier" || expression.name !== "Proxy") return false;
  if (sourceCode.isGlobalReference(expression)) return true;
  let scope: Scope | null = sourceCode.getScope(expression);
  while (scope !== null) {
    const variable = scope.set.get(expression.name);
    if (variable !== undefined) return variable.defs.length === 0;
    scope = scope.upper;
  }
  return true;
}

function isDelegatingProxyGetTrap(
  node: ESTree.CallExpression,
  sourceCode: SourceCode,
): boolean {
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
  if (
    construction.type !== "NewExpression" ||
    !isGlobalProxy(sourceCode, construction.callee) ||
    construction.arguments.length !== 2 ||
    construction.arguments[1] !== object ||
    functionNode.params.length !== 3 ||
    node.arguments.length !== 3
  ) {
    return false;
  }

  const [targetParameter, propertyParameter, receiverParameter] = functionNode.params;
  const [targetArgument, propertyArgument, receiverArgument] = node.arguments;
  return (
    targetParameter?.type === "Identifier" &&
    propertyParameter?.type === "Identifier" &&
    receiverParameter?.type === "Identifier" &&
    targetArgument?.type === "Identifier" &&
    propertyArgument?.type === "Identifier" &&
    receiverArgument?.type === "Identifier" &&
    targetArgument.name === targetParameter.name &&
    propertyArgument.name === propertyParameter.name &&
    receiverArgument.name === receiverParameter.name
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
          !isDelegatingProxyGetTrap(node, context.sourceCode)
        ) {
          context.report({ node, messageId: "reflectGet" });
        }
      },
    };
  },
});
