import { Button } from "@bruno/shadcn/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@bruno/shadcn/alert-dialog";
import { Switch } from "@bruno/shadcn/switch";
import { ScrollArea } from "@bruno/shadcn/scroll-area";
import { createToastManager, Toaster } from "@bruno/shadcn/toast";
import { Store } from "@tanstack/store";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type NamedExoticComponent,
  type ReactElement,
  type ReactNode,
} from "react";

import type { BrunoTableCellEditDraftReviewSourceRow } from "./cell-edit";
import type { BrunoTableGridCommand } from "./column-management";
import type { BrunoTableEditMemoryRuntime } from "./edit-memory";

const saveFailureToastManager = createToastManager();
const saveFailureToasterOwners = new Set<string>();
const saveFailureToasterOwnerStore = new Store<string | undefined>(undefined);

function registerSaveFailureToasterOwner(ownerId: string): () => void {
  saveFailureToasterOwners.add(ownerId);
  if (saveFailureToasterOwnerStore.get() === undefined) {
    saveFailureToasterOwnerStore.setState(() => ownerId);
  }
  return () => {
    saveFailureToasterOwners.delete(ownerId);
    if (saveFailureToasterOwnerStore.get() === ownerId) {
      saveFailureToasterOwnerStore.setState(() => saveFailureToasterOwners.values().next().value);
    }
  };
}

type BrunoTableEditModeControlProps = Readonly<{
  readonly runtime: BrunoTableEditMemoryRuntime;
}>;

export const BrunoTableEditModeControl: NamedExoticComponent<BrunoTableEditModeControlProps> = memo(
  function BrunoTableEditModeControl({ runtime }: BrunoTableEditModeControlProps): ReactElement {
    const id = useId();
    const descriptionId = `${id}-description`;
    const snapshot = useSyncExternalStore(
      runtime.subscribeMode,
      runtime.getModeSnapshot,
      runtime.getModeSnapshot,
    );
    return (
      <div>
        <label className="flex items-center justify-between gap-2 text-xs/relaxed" htmlFor={id}>
          <span>Batch editing</span>
          <Switch
            aria-describedby={!snapshot.canChange ? descriptionId : undefined}
            id={id}
            size="sm"
            checked={snapshot.mode === "batch"}
            disabled={!snapshot.canChange}
            onCheckedChange={(checked) => {
              runtime.requestMode(checked ? "batch" : "immediate");
            }}
          />
        </label>
        <span className="sr-only" id={descriptionId}>
          Finish or reset current edit work before changing Edit Mode.
        </span>
      </div>
    );
  },
);

const BrunoTablePendingEditStatus = memo(function BrunoTablePendingEditStatus({
  runtime,
}: {
  readonly runtime: BrunoTableEditMemoryRuntime;
}): ReactElement {
  const status = useSyncExternalStore(
    runtime.subscribeSafetyStatus,
    runtime.getSafetyStatusSnapshot,
    runtime.getSafetyStatusSnapshot,
  );
  const saveWork = useSyncExternalStore(
    runtime.subscribeSaveWork,
    runtime.getSaveWorkSnapshot,
    runtime.getSaveWorkSnapshot,
  );
  const pendingCount = status.pendingCount;
  const statusParts: string[] = [];
  if (status.conflictCount > 0)
    statusParts.push(
      `${String(status.conflictCount)} ${status.conflictCount === 1 ? "conflict" : "conflicts"}`,
    );
  if (status.blockedCount > 0)
    statusParts.push(
      `${String(status.blockedCount)} blocked ${status.blockedCount === 1 ? "change" : "changes"}`,
    );
  if (status.validationCount > 0) statusParts.push(`${String(status.validationCount)} invalid`);
  if (pendingCount > 0) statusParts.push(`${String(pendingCount)} unsaved`);
  const saveWorkParts: string[] = [];
  if (saveWork.pendingImmediateCount > 0) {
    saveWorkParts.push(
      `${String(saveWork.pendingImmediateCount)} Immediate ${saveWork.pendingImmediateCount === 1 ? "save" : "saves"} pending`,
    );
  }
  if (saveWork.awaitingImmediateCount > 0) {
    saveWorkParts.push(
      `${String(saveWork.awaitingImmediateCount)} Immediate ${saveWork.awaitingImmediateCount === 1 ? "save" : "saves"} accepted · waiting for live confirmation`,
    );
  }
  if (saveWork.pendingBatchCount > 0) saveWorkParts.push("Batch save pending");
  if (saveWork.awaitingBatchRowCount > 0) {
    saveWorkParts.push(
      `Batch save accepted · waiting for live confirmation · ${String(saveWork.awaitingBatchRowCount)} ${saveWork.awaitingBatchRowCount === 1 ? "row" : "rows"} remaining`,
    );
  }
  return (
    <span aria-live="polite">
      {saveWorkParts.length > 0
        ? saveWorkParts.join(" · ")
        : statusParts.length === 0
          ? "No unsaved changes"
          : status.blockedCount === 0 && status.validationCount === 0 && status.conflictCount === 0
            ? `${String(pendingCount)} unsaved ${pendingCount === 1 ? "change" : "changes"}`
            : statusParts.join(" · ")}
    </span>
  );
});

const BrunoTableResetEditsButton = memo(function BrunoTableResetEditsButton({
  dispatchGridCommand,
  runtime,
}: {
  readonly dispatchGridCommand: (command: BrunoTableGridCommand) => boolean;
  readonly runtime: BrunoTableEditMemoryRuntime;
}): ReactElement {
  const canReset = useSyncExternalStore(
    runtime.subscribeCanReset,
    runtime.getCanResetSnapshot,
    runtime.getCanResetSnapshot,
  );
  const resetControlRef = useCallback(
    (element: HTMLButtonElement | null) =>
      element === null ? undefined : runtime.registerResetControl(element),
    [runtime],
  );
  return (
    <Button
      aria-label="Reset edits"
      data-bruno-cell-edit-cancel=""
      data-bruno-cell-edit-reset=""
      ref={resetControlRef}
      variant="outline"
      disabled={!canReset}
      onClick={() => dispatchGridCommand({ type: "edits.reset" })}
    >
      Reset
    </Button>
  );
});

const BrunoTableResetReview = memo(function BrunoTableResetReview({
  runtime,
  renderReview,
}: {
  readonly runtime: BrunoTableEditMemoryRuntime;
  readonly renderReview: (rows: readonly BrunoTableCellEditDraftReviewSourceRow[]) => ReactNode;
}): ReactElement {
  const snapshot = useSyncExternalStore(
    runtime.subscribeResetReview,
    runtime.getResetReviewSnapshot,
    runtime.getResetReviewSnapshot,
  );
  return (
    <AlertDialog
      open={snapshot.open}
      onOpenChange={(open) => {
        if (!open) runtime.closeResetReview();
      }}
    >
      {snapshot.open ? (
        <BrunoTableResetReviewContent
          runtime={runtime}
          pendingCount={snapshot.pendingCount}
          historyCount={snapshot.historyCount}
          canResetAll={snapshot.canResetAll}
          renderReview={renderReview}
        />
      ) : null}
    </AlertDialog>
  );
});

const BrunoTableResetReviewContent = memo(function BrunoTableResetReviewContent({
  runtime,
  pendingCount,
  historyCount,
  canResetAll,
  renderReview,
}: {
  readonly runtime: BrunoTableEditMemoryRuntime;
  readonly pendingCount: number;
  readonly historyCount: number;
  readonly canResetAll: boolean;
  readonly renderReview: (rows: readonly BrunoTableCellEditDraftReviewSourceRow[]) => ReactNode;
}): ReactElement {
  const descriptionId = useId();
  const rows = useSyncExternalStore(
    runtime.subscribeResetReviewRows,
    runtime.getResetReviewRowsSnapshot,
    runtime.getResetReviewRowsSnapshot,
  );
  const resetSurfaceRef = useCallback(
    (element: HTMLDivElement | null) =>
      element === null ? undefined : runtime.registerResetControl(element),
    [runtime],
  );
  const pendingLabel = `${String(pendingCount)} pending changed ${pendingCount === 1 ? "cell" : "cells"}`;
  const historyLabel = `${String(historyCount)} Batch history ${historyCount === 1 ? "command" : "commands"}`;
  return (
    <AlertDialogContent
      data-bruno-cell-edit-reset=""
      ref={resetSurfaceRef}
      className="max-w-4xl sm:max-w-4xl"
      style={{
        width: "min(56rem, calc(100vw - 2rem))",
        maxHeight: "calc(100vh - 2rem)",
        overflow: "auto",
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>Reset Review</AlertDialogTitle>
        <AlertDialogDescription id={descriptionId}>
          <span>{pendingLabel}</span>. <span>{historyLabel}</span>. Review these changes before
          discarding them.
        </AlertDialogDescription>
      </AlertDialogHeader>
      {renderReview(rows)}
      <AlertDialogFooter>
        <AlertDialogCancel onClick={runtime.closeResetReview}>Keep Editing</AlertDialogCancel>
        <AlertDialogAction
          aria-describedby={descriptionId}
          disabled={!canResetAll}
          variant="destructive"
          onClick={() => {
            runtime.confirmResetAllChanges();
          }}
        >
          Reset All Changes
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
});

const BrunoTableSaveEditsButton = memo(function BrunoTableSaveEditsButton({
  runtime,
}: {
  readonly runtime: BrunoTableEditMemoryRuntime;
}): ReactElement {
  const canSave = useSyncExternalStore(
    runtime.subscribeCanSave,
    runtime.getCanSaveSnapshot,
    runtime.getCanSaveSnapshot,
  );
  return (
    <Button disabled={!canSave} onClick={runtime.requestSave}>
      Save
    </Button>
  );
});

const BrunoTableSaveFailure = memo(function BrunoTableSaveFailure({
  runtime,
}: {
  readonly runtime: BrunoTableEditMemoryRuntime;
}): ReactElement | null {
  const failure = useSyncExternalStore(
    runtime.subscribeSaveFailure,
    runtime.getSaveFailureSnapshot,
    runtime.getSaveFailureSnapshot,
  );
  const toasterOwnerId = useId();
  const toastId = `${toasterOwnerId}-bruno-table-save-failure`;
  const programmaticToastClose = useRef(false);
  const toasterOwner = useSyncExternalStore(
    (listener) => {
      const subscription = saveFailureToasterOwnerStore.subscribe(listener);
      return () => subscription.unsubscribe();
    },
    () => saveFailureToasterOwnerStore.get(),
    () => saveFailureToasterOwnerStore.get(),
  );
  const failureSignature = failure.operations.map((operation) => operation.operationId).join("\0");
  const [detailsFailureSignature, setDetailsFailureSignature] = useState<string>();
  useEffect(() => registerSaveFailureToasterOwner(toasterOwnerId), [toasterOwnerId]);
  useEffect(() => {
    if (failure.count === 0) {
      programmaticToastClose.current = true;
      saveFailureToastManager.close(toastId);
      programmaticToastClose.current = false;
      return;
    }
    saveFailureToastManager.add({
      id: toastId,
      title:
        failure.count === 1
          ? "A save operation failed."
          : `${String(failure.count)} save operations failed.`,
      description:
        failure.count === 1
          ? "Open Operation details for the complete explanation."
          : "Open Operation details for the complete explanations.",
      actionProps: {
        children: "Operation details",
        onClick: () => setDetailsFailureSignature(failureSignature),
      },
      timeout: 0,
      priority: "high",
      type: "error",
      onClose: () => {
        if (programmaticToastClose.current) return;
        setDetailsFailureSignature(undefined);
        runtime.dismissSaveFailures();
      },
    });
  }, [failure, failureSignature, runtime, toastId]);
  useEffect(
    () => () => {
      programmaticToastClose.current = true;
      saveFailureToastManager.close(toastId);
      programmaticToastClose.current = false;
    },
    [toastId],
  );
  return (
    <>
      {toasterOwner === toasterOwnerId ? (
        <Toaster toastManager={saveFailureToastManager} timeout={0} />
      ) : null}
      <AlertDialog
        open={failure.count > 0 && detailsFailureSignature === failureSignature}
        onOpenChange={(open) => setDetailsFailureSignature(open ? failureSignature : undefined)}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <AlertDialogHeader>
            <AlertDialogTitle>Save operation details</AlertDialogTitle>
            <AlertDialogDescription>
              These saves were not confirmed. Live source convergence can still clear each result.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ScrollArea className="min-h-0 max-h-[min(60dvh,32rem)]">
            <ul className="flex list-disc flex-col gap-1 py-1 ps-5 pe-4 text-sm">
              {failure.operations.map((operation, index) => (
                <li key={operation.operationId}>
                  <p>
                    Operation {String(index + 1)}: {operation.message}
                  </p>
                  <ul className="mt-1 list-[circle] space-y-1 ps-5">
                    {operation.rows.flatMap((row) =>
                      row.cells.map((cell) => (
                        <li key={`${row.rowId}\0${cell.columnId}`}>
                          Row {row.rowId}, column {cell.columnId} (field {cell.field}).
                        </li>
                      )),
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          </ScrollArea>
          <AlertDialogFooter>
            <AlertDialogCancel>Close details</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

type BrunoTableEditSafetyFooterProps = Readonly<{
  readonly dispatchGridCommand: (command: BrunoTableGridCommand) => boolean;
  readonly runtime: BrunoTableEditMemoryRuntime;
  readonly renderReview: (rows: readonly BrunoTableCellEditDraftReviewSourceRow[]) => ReactNode;
}>;

export const BrunoTableEditSafetyFooter: NamedExoticComponent<BrunoTableEditSafetyFooterProps> =
  memo(function BrunoTableEditSafetyFooter({
    dispatchGridCommand,
    runtime,
    renderReview,
  }: BrunoTableEditSafetyFooterProps): ReactElement {
    return (
      <footer
        aria-label="Edit safety"
        className="relative flex min-w-0 items-center justify-between gap-3 border-t bg-background px-3.5 py-2 text-xs/relaxed"
        role="region"
      >
        <BrunoTableSaveFailure runtime={runtime} />
        <BrunoTablePendingEditStatus runtime={runtime} />
        <div className="flex items-center gap-2">
          <BrunoTableResetEditsButton dispatchGridCommand={dispatchGridCommand} runtime={runtime} />
          <BrunoTableSaveEditsButton runtime={runtime} />
        </div>
        <BrunoTableResetReview runtime={runtime} renderReview={renderReview} />
      </footer>
    );
  });
