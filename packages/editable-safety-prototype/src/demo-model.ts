import { toast } from "@bruno/shadcn/toast";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  cellKey,
  initialChanges,
  initialConflicts,
  type BrunoTableConflictResolution,
  type BrunoTableEditMode,
} from "./data";

export function useEditableSafetyDemo() {
  const [mode, setMode] = useState<BrunoTableEditMode>("batch");
  const [changes, setChanges] = useState(initialChanges);
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [pendingCells, setPendingCells] = useState<ReadonlySet<string>>(() => new Set());
  const [flashedCells, setFlashedCells] = useState<ReadonlySet<string>>(() => new Set());
  const [batchSaving, setBatchSaving] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [invalidEditorOpen, setInvalidEditorOpen] = useState(false);
  const [invalidValue, setInvalidValue] = useState("hello");
  const [invalidError, setInvalidError] = useState("Quantity must be a whole number.");
  const [resolutions, setResolutions] = useState<
    Readonly<Record<string, BrunoTableConflictResolution>>
  >({});
  const [conflictSaving, setConflictSaving] = useState(false);
  const timerIds = useRef<ReadonlySet<number>>(new Set());

  const trackTimer = useCallback((callback: () => void, delay: number) => {
    const id = window.setTimeout(() => {
      timerIds.current = new Set([...timerIds.current].filter((candidate) => candidate !== id));
      callback();
    }, delay);
    timerIds.current = new Set(timerIds.current).add(id);
  }, []);

  const showFailure = useCallback((title = "Order changes were not accepted") => {
    toast.add({
      id: `save-failed-${Date.now()}`,
      type: "error",
      priority: "high",
      timeout: 0,
      title,
      description:
        "The request failed with HTTP 500. Your unsaved changes are still here. Review live server updates, then use Save when you decide to try again.",
    });
  }, []);

  const startImmediateSaves = useCallback(() => {
    setMode("immediate");
    const cells = [
      cellKey("ORD-1042", "price"),
      cellKey("ORD-1043", "quantity"),
      cellKey("ORD-1044", "status"),
    ];
    setPendingCells(new Set(cells));
    cells.forEach((key, index) => {
      trackTimer(
        () => {
          setPendingCells(
            (current) => new Set([...current].filter((candidate) => candidate !== key)),
          );
          setFlashedCells((current) => new Set(current).add(key));
          trackTimer(() => {
            setFlashedCells(
              (current) => new Set([...current].filter((candidate) => candidate !== key)),
            );
          }, 2_000);
        },
        900 + index * 550,
      );
    });
  }, [trackTimer]);

  const startBatchLock = useCallback(() => {
    setMode("batch");
    setBatchSaving(true);
    trackTimer(() => {
      setBatchSaving(false);
      showFailure("Batch save failed; editing is available again");
    }, 2_000);
  }, [showFailure, trackTimer]);

  const saveConflictResolutions = useCallback(() => {
    setConflictSaving(true);
    trackTimer(() => {
      setConflictSaving(false);
      showFailure("Conflict resolution save failed");
    }, 1_500);
  }, [showFailure, trackTimer]);

  const commitInvalidEditor = useCallback(() => {
    if (!/^-?\d+$/.test(invalidValue.trim())) {
      setInvalidError("Quantity must be a whole number. Fix it or press Escape to cancel.");
      return false;
    }
    setInvalidError("");
    setInvalidEditorOpen(false);
    return true;
  }, [invalidValue]);

  const resetScenario = useCallback(() => {
    for (const id of timerIds.current) window.clearTimeout(id);
    timerIds.current = new Set();
    setMode("batch");
    setChanges(initialChanges);
    setConflicts(initialConflicts);
    setPendingCells(new Set());
    setFlashedCells(new Set());
    setBatchSaving(false);
    setConflictOpen(false);
    setResetOpen(false);
    setInvalidEditorOpen(false);
    setInvalidValue("hello");
    setInvalidError("Quantity must be a whole number.");
    setResolutions({});
    setConflictSaving(false);
  }, []);

  const resetAllChanges = useCallback(() => {
    setChanges([]);
    setConflicts([]);
    setResolutions({});
    setResetOpen(false);
  }, []);

  const resolveConflict = useCallback((rowId: string, resolution: BrunoTableConflictResolution) => {
    setResolutions((current) => ({ ...current, [rowId]: resolution }));
  }, []);

  const unresolvedCount = conflicts.filter(
    (conflict) => resolutions[conflict.rowId] === undefined,
  ).length;

  return useMemo(
    () => ({
      mode,
      setMode,
      changes,
      conflicts,
      pendingCells,
      flashedCells,
      batchSaving,
      conflictOpen,
      setConflictOpen,
      resetOpen,
      setResetOpen,
      invalidEditorOpen,
      setInvalidEditorOpen,
      invalidValue,
      setInvalidValue,
      invalidError,
      setInvalidError,
      resolutions,
      resolveConflict,
      conflictSaving,
      unresolvedCount,
      startImmediateSaves,
      startBatchLock,
      showFailure,
      saveConflictResolutions,
      commitInvalidEditor,
      resetScenario,
      resetAllChanges,
    }),
    [
      batchSaving,
      changes,
      commitInvalidEditor,
      conflictOpen,
      conflictSaving,
      conflicts,
      flashedCells,
      invalidEditorOpen,
      invalidError,
      invalidValue,
      mode,
      pendingCells,
      resetAllChanges,
      resetOpen,
      resetScenario,
      resolutions,
      resolveConflict,
      saveConflictResolutions,
      showFailure,
      startBatchLock,
      startImmediateSaves,
      unresolvedCount,
    ],
  );
}

export type EditableSafetyDemo = ReturnType<typeof useEditableSafetyDemo>;
