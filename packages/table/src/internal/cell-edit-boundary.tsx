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
import { useBrunoTableCellEditorHotkeys } from "./hotkey-adapter";

const BLANK_EDITOR_OPTION = "blank";
const scalarEditorOption = (index: number): string => `scalar:${String(index)}`;

type BrunoTableCellEditBoundaryProps = Readonly<{
  readonly column: CompiledColumn;
  readonly runtime: BrunoTableCellEditRuntime;
  readonly onCommittedOutsideCellPointer?: ((rowId: string, columnId: string) => void) | undefined;
  readonly yieldGridTabStop?: ((grid: HTMLElement) => void) | undefined;
}>;

export const BrunoTableCellEditBoundary: NamedExoticComponent<BrunoTableCellEditBoundaryProps> =
  memo(function BrunoTableCellEditBoundary({
    column,
    runtime,
    onCommittedOutsideCellPointer,
    yieldGridTabStop,
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
    const candidate = runtime.getActiveCandidateSnapshot();
    const errorId = invalidMessage === undefined ? undefined : generatedErrorId;
    const selectInitialTextOnMount = useRef(
      session.kind === "editing" && session.selectInitialText,
    );
    const initialRawNumberSeed =
      session.kind === "editing" &&
      column.semantics.editorFamily === "number" &&
      candidate.rawText.length > 0 &&
      (!session.selectInitialText || numberSeedRequiresRawBuffer(column, candidate.rawText))
        ? candidate.rawText
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
          yieldGridTabStop?.(grid);
        }
        return false;
      },
      [runtime, yieldGridTabStop],
    );
    useBrunoTableCellEditorHotkeys(control, { cancel, commit });
    useLayoutEffect(() => {
      const element = control.current;
      if (element === null) return;
      const unregister = runtime.registerActiveCandidate({
        restoreFocus: () => element.focus({ preventScroll: true }),
      });
      if (
        element instanceof HTMLInputElement &&
        rawNumberSeed.current !== undefined &&
        numberCandidateCanUseNativeControl(column, element, rawNumberSeed.current)
      ) {
        rawNumberSeed.current = undefined;
        setRawNumberDisplay(undefined);
      }
      element.focus({ preventScroll: true });
      if (
        selectInitialTextOnMount.current &&
        element instanceof HTMLInputElement &&
        element.type !== "checkbox"
      ) {
        element.select();
      }
      const handleInput = () => {
        if (element instanceof HTMLSelectElement) return;
        if (
          element instanceof HTMLInputElement &&
          column.semantics.editorFamily === "number" &&
          rawNumberSeed.current !== undefined
        ) {
          const rawText = element.value.slice(0, BRUNO_TABLE_CELL_EDIT_MAX_CANDIDATE_LENGTH + 1);
          rawNumberSeed.current = rawText;
          if (numberCandidateCanUseNativeControl(column, element, rawText)) {
            rawNumberSeed.current = undefined;
            setRawNumberDisplay(undefined);
          } else {
            setRawNumberDisplay(rawText);
          }
        }
        const rawText =
          element instanceof HTMLInputElement && element.type === "checkbox"
            ? String(element.checked)
            : column.semantics.editorFamily === "number" && rawNumberSeed.current !== undefined
              ? rawNumberSeed.current
              : String(Reflect.get(element, "value"));
        runtime.updateActiveCandidate(
          rawText,
          column.semantics.editorFamily === "number" &&
            rawNumberSeed.current === undefined &&
            element instanceof HTMLInputElement &&
            element.type === "number" &&
            element.validity.badInput &&
            element.value.length === 0,
        );
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
        if (
          event.target instanceof Node &&
          (editor.contains(event.target) ||
            (event.target instanceof Element &&
              event.target.closest("[data-bruno-cell-edit-cancel]") !== null))
        ) {
          return;
        }
        if (!runtime.commitActiveCandidate()) {
          blockedClickTarget = event.target;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (event.target instanceof Element) {
          const cell = event.target.closest<HTMLElement>(
            '[role="gridcell"][data-bruno-row-id][data-bruno-column-id]',
          );
          const rowId = cell?.dataset["brunoRowId"];
          const columnId = cell?.dataset["brunoColumnId"];
          if (rowId !== undefined && columnId !== undefined) {
            onCommittedOutsideCellPointer?.(rowId, columnId);
          }
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
    }, [onCommittedOutsideCellPointer, runtime]);
    if (session.kind !== "editing") return null;
    const blankValue = column.kind === "field" ? column.blankValue : undefined;
    const renderBooleanSelect =
      column.semantics.editorFamily === "boolean" && blankValue !== undefined;
    return (
      <div data-bruno-cell-editor="" style={{ height: "100%", position: "relative" }}>
        {column.semantics.editorFamily === "boolean" && !renderBooleanSelect ? (
          <input
            ref={attachControl}
            aria-describedby={errorId}
            aria-invalid={invalidMessage === undefined ? undefined : true}
            aria-label={`Edit ${column.headerName}`}
            defaultChecked={candidate.rawText === "true"}
            onChange={(event) =>
              runtime.updateActiveCandidate(String(event.currentTarget.checked), false)
            }
            type="checkbox"
          />
        ) : renderBooleanSelect ? (
          <select
            ref={attachControl}
            aria-describedby={errorId}
            aria-invalid={invalidMessage === undefined ? undefined : true}
            aria-label={`Edit ${column.headerName}`}
            defaultValue={
              candidate.kind === "blank"
                ? BLANK_EDITOR_OPTION
                : candidate.rawText === "true"
                  ? scalarEditorOption(1)
                  : scalarEditorOption(0)
            }
            onChange={(event) => {
              const selected = event.currentTarget.value;
              runtime.updateActiveCandidate(
                selected === scalarEditorOption(1) ? "true" : "false",
                false,
                selected === BLANK_EDITOR_OPTION ? "blank" : "scalar",
              );
            }}
            style={{ boxSizing: "border-box", height: "100%", width: "100%" }}
          >
            <option value={BLANK_EDITOR_OPTION}>
              {blankValue?.value === null ? "Blank (null)" : "Blank (undefined)"}
            </option>
            <option value={scalarEditorOption(0)}>False</option>
            <option value={scalarEditorOption(1)}>True</option>
          </select>
        ) : column.semantics.editorFamily === "select" &&
          column.semantics.selectCanonicalOptions !== undefined ? (
          <select
            ref={attachControl}
            aria-describedby={errorId}
            aria-invalid={invalidMessage === undefined ? undefined : true}
            aria-label={`Edit ${column.headerName}`}
            defaultValue={
              candidate.kind === "blank"
                ? BLANK_EDITOR_OPTION
                : scalarEditorOption(
                    column.selectOptionCanonicalIndexes?.get(candidate.rawText) ?? 0,
                  )
            }
            onChange={(event) => {
              const selected = event.currentTarget.value;
              if (selected === BLANK_EDITOR_OPTION) {
                runtime.updateActiveCandidate("", false, "blank");
                return;
              }
              const optionIndex = Number(selected.slice("scalar:".length));
              runtime.updateActiveCandidate(
                column.semantics.selectCanonicalOptions?.[optionIndex] ?? "",
                false,
              );
            }}
            style={{ boxSizing: "border-box", height: "100%", width: "100%" }}
          >
            {blankValue === undefined ? null : (
              <option value={BLANK_EDITOR_OPTION}>
                {blankValue.value === null ? "Blank (null)" : "Blank (undefined)"}
              </option>
            )}
            {column.semantics.selectCanonicalOptions.map((option, index) => (
              <option key={scalarEditorOption(index)} value={scalarEditorOption(index)}>
                {option === "" ? "Empty string" : option}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={attachControl}
            aria-describedby={errorId}
            aria-invalid={invalidMessage === undefined ? undefined : true}
            aria-label={`Edit ${column.headerName}`}
            defaultValue={candidate.rawText}
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

function numberCandidateCanUseNativeControl(
  column: CompiledColumn,
  input: HTMLInputElement,
  rawText: string,
): boolean {
  if (rawText.length === 0) return true;
  if (numberSeedRequiresRawBuffer(column, rawText)) return false;
  const probe = input.ownerDocument.createElement("input");
  probe.type = "number";
  probe.value = rawText;
  return probe.value === rawText;
}
