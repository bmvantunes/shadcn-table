// PROTOTYPE — throwaway terminal shell. The portable logic lives in model.ts and api.ts.

import {
  BrunoTablePrototypeInitialState,
  BrunoTablePrototypeReduce,
  BrunoTablePrototypeSnapshot,
} from "./model.ts";

const BrunoTablePrototypeBold = "\u001B[1m";
const BrunoTablePrototypeDim = "\u001B[2m";
const BrunoTablePrototypeReset = "\u001B[0m";

let BrunoTablePrototypeCurrentState = BrunoTablePrototypeInitialState;

function BrunoTablePrototypeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, entry: unknown) => (typeof entry === "bigint" ? `${entry.toString()}n` : entry),
    2,
  );
}

function BrunoTablePrototypeRender(): void {
  const snapshot = BrunoTablePrototypeSnapshot(BrunoTablePrototypeCurrentState);
  const frame = [
    "\u001B[2J\u001B[H",
    `${BrunoTablePrototypeBold}BrunoTable column API prototype${BrunoTablePrototypeReset}`,
    `${BrunoTablePrototypeDim}Throwaway proof: beautiful plain-array helpers + strict inference + atomic save shape${BrunoTablePrototypeReset}`,
    "",
    `${BrunoTablePrototypeBold}Question${BrunoTablePrototypeReset}`,
    snapshot.question,
    "",
    `${BrunoTablePrototypeBold}Relevant state${BrunoTablePrototypeReset}`,
    BrunoTablePrototypeJson(snapshot.state),
    "",
    `${BrunoTablePrototypeBold}[1]${BrunoTablePrototypeReset} columns  ${BrunoTablePrototypeBold}[2]${BrunoTablePrototypeReset} preset precedence  ${BrunoTablePrototypeBold}[3]${BrunoTablePrototypeReset} computed projection`,
    `${BrunoTablePrototypeBold}[4]${BrunoTablePrototypeReset} atomic save  ${BrunoTablePrototypeBold}[5]${BrunoTablePrototypeReset} compiler contract  ${BrunoTablePrototypeBold}[q]${BrunoTablePrototypeReset} quit`,
    "",
  ].join("\n");

  process.stdout.write(frame);
}

function BrunoTablePrototypeQuit(): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\u001B[2J\u001B[HColumn API prototype closed.\n");
}

BrunoTablePrototypeRender();

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", (chunk) => {
    const key = typeof chunk === "string" ? chunk : chunk.toString();
    if (key === "q" || key === "\u0003") {
      BrunoTablePrototypeQuit();
      return;
    }
    BrunoTablePrototypeCurrentState = BrunoTablePrototypeReduce(
      BrunoTablePrototypeCurrentState,
      key,
    );
    BrunoTablePrototypeRender();
  });
}
