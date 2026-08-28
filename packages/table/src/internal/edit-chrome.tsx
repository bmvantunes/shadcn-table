import { Button } from "@bruno/shadcn/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@bruno/shadcn/alert-dialog";
import { Switch } from "@bruno/shadcn/switch";
import {
  memo,
  useCallback,
  useId,
  useSyncExternalStore,
  type NamedExoticComponent,
  type ReactElement,
  type ReactNode,
} from "react";

import type { BrunoTableCellEditDraftReviewSourceRow } from "./cell-edit";
import type { BrunoTableGridCommand } from "./column-management";
import type { BrunoTableEditMemoryRuntime } from "./edit-memory";

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
  return (
    <span aria-live="polite">
      {statusParts.length === 0
        ? "No unsaved changes"
        : status.blockedCount === 0 && status.validationCount === 0 && status.conflictCount === 0
          ? `${pendingCount} unsaved ${pendingCount === 1 ? "change" : "changes"}`
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
        <Button variant="outline" onClick={runtime.closeResetReview}>
          Keep Editing
        </Button>
        <Button
          aria-describedby={descriptionId}
          disabled={!canResetAll}
          variant="destructive"
          onClick={() => {
            runtime.confirmResetAllChanges();
          }}
        >
          Reset All Changes
        </Button>
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
        className="flex min-w-0 items-center justify-between gap-3 border-t bg-background px-3.5 py-2 text-xs/relaxed"
        role="region"
      >
        <BrunoTablePendingEditStatus runtime={runtime} />
        <div className="flex items-center gap-2">
          <BrunoTableResetEditsButton dispatchGridCommand={dispatchGridCommand} runtime={runtime} />
          <BrunoTableSaveEditsButton runtime={runtime} />
        </div>
        <BrunoTableResetReview runtime={runtime} renderReview={renderReview} />
      </footer>
    );
  });
