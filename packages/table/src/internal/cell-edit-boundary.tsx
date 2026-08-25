import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { NamedExoticComponent, ReactElement } from "react";

import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableCellEditMovement } from "./cell-edit";
import { BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH, BrunoTableCellEditRuntime } from "./cell-edit";
import { yieldBrunoTableGridTabStopForNativeTraversal } from "./focus";
import { useBrunoTableCellEditorHotkeys } from "./hotkey-adapter";

type BrunoTableCellEditBoundaryProps = Readonly<{
  readonly column: CompiledColumn;
  readonly runtime: BrunoTableCellEditRuntime;
}>;

export const BrunoTableCellEditBoundary: NamedExoticComponent<BrunoTableCellEditBoundaryProps> =
  memo(function BrunoTableCellEditBoundary({
    column,
    runtime,
  }: BrunoTableCellEditBoundaryProps): ReactElement | null {
    const control = useRef<HTMLElement>(null);
    const attachControl = useCallback((element: HTMLElement | null) => {
      control.current = element;
    }, []);
    const generatedErrorId = useId();
    const session = useSyncExternalStore(
      runtime.subscribeSession,
      runtime.getSessionSnapshot,
      runtime.getSessionSnapshot,
    );
    const invalidMessage = session.kind === "editing" ? session.invalidMessage : undefined;
    const errorId = invalidMessage === undefined ? undefined : generatedErrorId;
    const selectInitialTextOnMount = useRef(
      session.kind === "editing" && session.selectInitialText,
    );
    const initialRawNumberSeed =
      session.kind === "editing" && numberSeedRequiresRawBuffer(column, session.initialText)
        ? session.initialText
        : undefined;
    const rawNumberSeed = useRef(initialRawNumberSeed);
    const [rawNumberDisplay, setRawNumberDisplay] = useState(initialRawNumberSeed);
    const cancel = useCallback(() => {
      const grid = control.current?.closest<HTMLElement>('[role="grid"]') ?? null;
      runtime.cancel();
      grid?.focus({ preventScroll: true });
    }, [runtime]);
    const commit = useCallback(
      (movement: BrunoTableCellEditMovement): boolean => {
        const grid = control.current?.closest<HTMLElement>('[role="grid"]') ?? null;
        if (!runtime.commitActiveCandidate()) return true;
        const moved = runtime.requestMovement(movement);
        if (moved || movement.startsWith("enter")) {
          grid?.focus({ preventScroll: true });
          return true;
        }
        if (grid !== null) {
          grid.focus({ preventScroll: true });
          yieldBrunoTableGridTabStopForNativeTraversal(grid);
        }
        return false;
      },
      [runtime],
    );
    useBrunoTableCellEditorHotkeys(control, { cancel, commit });
    useLayoutEffect(() => {
      const element = control.current;
      if (element === null) return;
      const unregister = runtime.registerActiveCandidate({
        read: () => ({
          rawText:
            element instanceof HTMLInputElement && element.type === "checkbox"
              ? String(element.checked)
              : column.semantics.editorFamily === "number" && rawNumberSeed.current !== undefined
                ? rawNumberSeed.current
                : Reflect.get(element, "value"),
          nativeInvalid:
            column.semantics.editorFamily === "number" &&
            (rawNumberSeed.current !== undefined ||
              (element instanceof HTMLInputElement &&
                element.type === "number" &&
                element.validity.badInput &&
                element.value.length === 0)),
        }),
        restoreFocus: () => element.focus({ preventScroll: true }),
      });
      element.focus({ preventScroll: true });
      if (
        selectInitialTextOnMount.current &&
        element instanceof HTMLInputElement &&
        element.type !== "checkbox"
      ) {
        element.select();
      }
      const handleInput = () => {
        if (
          element instanceof HTMLInputElement &&
          column.semantics.editorFamily === "number" &&
          rawNumberSeed.current !== undefined
        ) {
          const rawText = element.value.slice(0, BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH + 1);
          rawNumberSeed.current = rawText;
          if (numberCandidateCanUseNativeControl(column, rawText)) {
            rawNumberSeed.current = undefined;
            setRawNumberDisplay(undefined);
          } else {
            setRawNumberDisplay(rawText);
          }
        }
      };
      element.addEventListener("input", handleInput);
      return () => {
        element.removeEventListener("input", handleInput);
        unregister();
      };
    }, [column, runtime]);
    useLayoutEffect(() => {
      const editor = control.current?.closest<HTMLElement>("[data-bruno-cell-editor]") ?? null;
      const document = editor?.ownerDocument;
      if (editor === null || document === undefined) return;
      let blockedClickTarget: EventTarget | null = null;
      const commitOutsidePointer = (event: PointerEvent) => {
        blockedClickTarget = null;
        if (event.target instanceof Node && editor.contains(event.target)) return;
        if (!runtime.commitActiveCandidate()) {
          blockedClickTarget = event.target;
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };
      const suppressRejectedClick = (event: MouseEvent) => {
        const blocked = blockedClickTarget;
        blockedClickTarget = null;
        if (blocked === null || event.target !== blocked) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      document.addEventListener("pointerdown", commitOutsidePointer, true);
      document.addEventListener("click", suppressRejectedClick, true);
      return () => {
        document.removeEventListener("pointerdown", commitOutsidePointer, true);
        document.removeEventListener("click", suppressRejectedClick, true);
      };
    }, [runtime]);
    if (session.kind !== "editing") return null;
    return (
      <div data-bruno-cell-editor="" style={{ height: "100%", position: "relative" }}>
        {column.semantics.editorFamily === "boolean" ? (
          <input
            ref={attachControl}
            aria-describedby={errorId}
            aria-invalid={invalidMessage === undefined ? undefined : true}
            aria-label={`Edit ${column.headerName}`}
            defaultChecked={session.initialText === "true"}
            type="checkbox"
          />
        ) : column.semantics.editorFamily === "select" &&
          column.semantics.selectCanonicalOptions !== undefined ? (
          <select
            ref={attachControl}
            aria-describedby={errorId}
            aria-invalid={invalidMessage === undefined ? undefined : true}
            aria-label={`Edit ${column.headerName}`}
            defaultValue={session.initialText}
            style={{ boxSizing: "border-box", height: "100%", width: "100%" }}
          >
            {column.semantics.selectCanonicalOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={attachControl}
            aria-describedby={errorId}
            aria-invalid={invalidMessage === undefined ? undefined : true}
            aria-label={`Edit ${column.headerName}`}
            defaultValue={session.initialText}
            maxLength={BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH}
            inputMode={
              column.semantics.editorFamily === "number" ||
              column.semantics.editorFamily === "bigint" ||
              column.semantics.editorFamily === "bigdecimal"
                ? "decimal"
                : undefined
            }
            step={
              column.semantics.editorFamily === "number" && rawNumberDisplay === undefined
                ? "any"
                : undefined
            }
            style={{ boxSizing: "border-box", height: "100%", width: "100%" }}
            type={
              column.semantics.editorFamily === "number" && rawNumberDisplay === undefined
                ? "number"
                : "text"
            }
          />
        )}
        {invalidMessage === undefined ? null : (
          <div
            id={errorId}
            role="alert"
            style={{
              background: "Canvas",
              border: "1px solid currentColor",
              insetInlineStart: 0,
              maxWidth: 320,
              padding: 4,
              position: "absolute",
              top: "100%",
              whiteSpace: "normal",
              zIndex: 9,
            }}
          >
            {invalidMessage}
          </div>
        )}
      </div>
    );
  });

function numberSeedRequiresRawBuffer(column: CompiledColumn, initialText: string): boolean {
  if (column.semantics.editorFamily !== "number" || initialText.length === 0) return false;
  try {
    return column.semantics.parseCanonicalText(initialText)._tag === "Failure";
  } catch {
    return true;
  }
}

function numberCandidateCanUseNativeControl(column: CompiledColumn, rawText: string): boolean {
  return rawText.length === 0 || !numberSeedRequiresRawBuffer(column, rawText);
}
