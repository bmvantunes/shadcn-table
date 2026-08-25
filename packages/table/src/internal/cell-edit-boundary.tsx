import { memo, useCallback, useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { NamedExoticComponent, ReactElement } from "react";

import type { CompiledColumn } from "./compile-columns";
import type { BrunoTableCellEditMovement } from "./cell-edit";
import { BrunoTableCellEditRuntime } from "./cell-edit";
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
          focusOutsideGrid(grid, movement === "tab-forward" ? 1 : -1);
        }
        return true;
      },
      [runtime],
    );
    useBrunoTableCellEditorHotkeys(control, { cancel, commit });
    useLayoutEffect(() => {
      const element = control.current;
      if (element === null) return;
      const unregister = runtime.registerActiveCandidate({
        read: () =>
          element instanceof HTMLInputElement && element.type === "checkbox"
            ? String(element.checked)
            : Reflect.get(element, "value"),
        restoreFocus: () => element.focus({ preventScroll: true }),
      });
      element.focus({ preventScroll: true });
      if (element instanceof HTMLInputElement && element.type !== "checkbox") element.select();
      return unregister;
    }, [runtime]);
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
            inputMode={
              column.semantics.editorFamily === "number" ||
              column.semantics.editorFamily === "bigint" ||
              column.semantics.editorFamily === "bigdecimal"
                ? "decimal"
                : undefined
            }
            style={{ boxSizing: "border-box", height: "100%", width: "100%" }}
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

function focusOutsideGrid(grid: HTMLElement, direction: -1 | 1): void {
  const table = grid.closest<HTMLElement>("[data-bruno-table]");
  if (table === null) return;
  const candidates = [
    ...grid.ownerDocument.querySelectorAll<HTMLElement>(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (candidate) =>
      !table.contains(candidate) &&
      candidate.tabIndex >= 0 &&
      !candidate.matches(":disabled,[hidden],[aria-hidden='true']") &&
      candidate.getClientRects().length > 0,
  );
  const documentPosition =
    direction > 0 ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING;
  const ordered = direction > 0 ? candidates : candidates.toReversed();
  ordered
    .find((candidate) => (table.compareDocumentPosition(candidate) & documentPosition) !== 0)
    ?.focus();
}
