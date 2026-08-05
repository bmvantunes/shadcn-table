import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import {
  createEditSavePrototype,
  type PrototypeCommand,
  type PrototypeField,
  type PrototypeSnapshot,
} from "./model.ts";

const bold = "\u001B[1m";
const dim = "\u001B[2m";
const reset = "\u001B[0m";
const green = "\u001B[32m";
const red = "\u001B[31m";

function isField(input: string): input is PrototypeField {
  return input === "price" || input === "quantity";
}

function finiteNumber(input: string): number | undefined {
  const value = Number(input);
  return Number.isFinite(value) ? value : undefined;
}

function commandFrom(line: string): PrototypeCommand | "quit" | "help" | undefined {
  const [name, first, second, third, fourth] = line.trim().split(/\s+/);
  switch (name) {
    case "mode":
      return { type: "TOGGLE_MODE" };
    case "edit": {
      const value = third === undefined ? undefined : finiteNumber(third);
      if (first === undefined || second === undefined || !isField(second) || value === undefined) {
        return undefined;
      }
      return { type: "EDIT", rowId: first, field: second, value };
    }
    case "save":
      return { type: "SAVE" };
    case "resolve":
      return first === undefined ? undefined : { type: "RESOLVE", operationId: first };
    case "reject":
      return first === undefined
        ? undefined
        : { type: "REJECT", operationId: first, message: line.split(/\s+/).slice(2).join(" ") };
    case "live": {
      const version = second === undefined ? undefined : finiteNumber(second);
      const price = third === undefined ? undefined : finiteNumber(third);
      const quantity = fourth === undefined ? undefined : finiteNumber(fourth);
      if (
        first === undefined ||
        version === undefined ||
        price === undefined ||
        quantity === undefined
      ) {
        return undefined;
      }
      return {
        type: "LIVE_ROW",
        row: { id: first, version, price, quantity },
      };
    }
    case "delete":
      return first === undefined ? undefined : { type: "DELETE_ROW", rowId: first };
    case "mine":
    case "server":
      if (first === undefined || second === undefined || !isField(second)) {
        return undefined;
      }
      return {
        type: name === "mine" ? "RESOLVE_MINE" : "RESOLVE_SERVER",
        rowId: first,
        field: second,
      };
    case "undo":
      return { type: "UNDO" };
    case "redo":
      return { type: "REDO" };
    case "reset":
      return { type: "RESET" };
    case "help":
      return "help";
    case "quit":
    case "q":
      return "quit";
    default:
      return undefined;
  }
}

function lineList(lines: readonly string[]): string {
  return lines.length === 0 ? `${dim}—${reset}` : lines.map((line) => `• ${line}`).join("\n");
}

function rowLines(snapshot: PrototypeSnapshot): readonly string[] {
  return snapshot.canonicalRows.map((canonical) => {
    const projected = snapshot.projectedRows.find((row) => row.id === canonical.id) ?? canonical;
    return `${canonical.id}@${canonical.version}  canonical ${canonical.price} × ${canonical.quantity}  →  projected ${projected.price} × ${projected.quantity}`;
  });
}

function operationLines(snapshot: PrototypeSnapshot): readonly string[] {
  return snapshot.operations.map((operation) => {
    const rows = operation.rows
      .map((row) => {
        const changes = row.changes
          .map((change) => `${change.cellKey} ${change.before}→${change.after}`)
          .join(", ");
        return `${row.rowId}@${row.expectedVersion} { ${changes} }`;
      })
      .join(" · ");
    const failure = operation.failure === null ? "" : ` · failure=${operation.failure}`;
    return `${operation.id} ${operation.mode}/${operation.status} · remaining=[${operation.outstandingCells.join(", ")}] · ${rows}${failure}`;
  });
}

function render(snapshot: PrototypeSnapshot, feedback: string): void {
  console.clear();
  console.log(`${bold}PROTOTYPE — edit/save reconciliation${reset}`);
  console.log(`${dim}XState is the brain · TanStack Store is the memory${reset}\n`);
  console.log(
    `${bold}Workflow${reset}: ${snapshot.workflow}  ${bold}Mode${reset}: ${snapshot.mode}`,
  );
  console.log(`${bold}Feedback${reset}: ${feedback}\n`);
  console.log(`${bold}Rows${reset}\n${lineList(rowLines(snapshot))}`);
  console.log(
    `\n${bold}Drafts${reset}\n${lineList(
      snapshot.drafts.map(
        (draft) =>
          `${draft.cellKey} ${draft.before}→${draft.after} (Base version ${draft.baseVersion})`,
      ),
    )}`,
  );
  console.log(
    `${bold}Conflicts${reset}\n${lineList(
      snapshot.conflicts.map(
        (conflict) =>
          `${conflict.cellKey} Base=${conflict.base} Server=${conflict.server ?? "missing"} Mine=${conflict.mine}`,
      ),
    )}`,
  );
  console.log(
    `${bold}Accepted Overlays${reset}\n${lineList(
      snapshot.overlays.map(
        (overlay) =>
          `${overlay.cellKey}=${overlay.after} from ${overlay.operationId}@${overlay.expectedVersion}`,
      ),
    )}`,
  );
  console.log(
    `${bold}Locks/history${reset}: cells=${JSON.stringify(snapshot.lockedCells)} batch=${snapshot.batchLock ?? "—"} undo=${snapshot.undoDepth} redo=${snapshot.redoDepth}`,
  );
  console.log(`\n${bold}Operations${reset}\n${lineList(operationLines(snapshot))}`);
  console.log(`\n${bold}Recent events${reset}\n${lineList(snapshot.eventLog.slice(-6))}`);
  console.log(`\n${bold}Commands${reset}`);
  console.log(`${dim}mode · edit <row> <price|quantity> <value> · save${reset}`);
  console.log(
    `${dim}resolve <op> · reject <op> <message> · live <row> <version> <price> <qty>${reset}`,
  );
  console.log(`${dim}delete <row> · mine <row> <field> · server <row> <field>${reset}`);
  console.log(`${dim}undo · redo · reset · help · quit${reset}`);
}

const prototype = createEditSavePrototype();
const input = createInterface({ input: stdin, output: stdout });
let feedback = "Ready. Try: edit A price 105";

while (true) {
  render(prototype.snapshot(), feedback);
  const line = await input.question("\n> ");
  const command = commandFrom(line);
  if (command === "quit") {
    break;
  }
  if (command === "help") {
    feedback =
      "Hostile path: edit A price 105 → edit A quantity 11 → resolve OP_1 → live A 2 105 10.";
    continue;
  }
  if (command === undefined) {
    feedback = `${red}Unknown or malformed command.${reset}`;
    continue;
  }
  const dispatched = prototype.dispatch(command);
  feedback = `${dispatched.accepted ? green : red}${dispatched.message}${reset}`;
}

input.close();
