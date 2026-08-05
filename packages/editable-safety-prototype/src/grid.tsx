import { Badge } from "@bruno/shadcn/badge";
import { Field, FieldError } from "@bruno/shadcn/field";
import { Input } from "@bruno/shadcn/input";
import { Spinner } from "@bruno/shadcn/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@bruno/shadcn/table";
import { LockSimpleIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { cellKey, formatCellValue, orderRows, type BrunoTableEditableField } from "./data";
import type { EditableSafetyDemo } from "./demo-model";

function statusVariant(status: string): "default" | "outline" | "secondary" {
  if (status === "Working") return "default";
  if (status === "Held") return "secondary";
  return "outline";
}

function InvalidQuantityEditor({ demo }: { readonly demo: EditableSafetyDemo }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function keepFocusWhenInvalid() {
    if (!demo.commitInvalidEditor()) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <Field data-invalid={demo.invalidError.length > 0} className="min-w-44 gap-1">
      <Input
        ref={inputRef}
        aria-invalid={demo.invalidError.length > 0}
        aria-label="Edit quantity"
        inputMode="numeric"
        value={demo.invalidValue}
        onChange={(event) => {
          demo.setInvalidValue(event.target.value);
          demo.setInvalidError("");
        }}
        onBlur={keepFocusWhenInvalid}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            demo.setInvalidEditorOpen(false);
            demo.setInvalidError("");
            return;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            keepFocusWhenInvalid();
          }
        }}
      />
      <FieldError>{demo.invalidError}</FieldError>
    </Field>
  );
}

function EditableCell({
  demo,
  rowId,
  field,
  children,
}: {
  readonly demo: EditableSafetyDemo;
  readonly rowId: string;
  readonly field: BrunoTableEditableField;
  readonly children: React.ReactNode;
}) {
  const key = cellKey(rowId, field);
  const pending = demo.pendingCells.has(key);
  const flashed = demo.flashedCells.has(key);
  const dirty = demo.changes.some((change) => change.rowId === rowId && change.field === field);
  const conflict = demo.conflicts.some(
    (candidate) => candidate.rowId === rowId && candidate.field === field,
  );
  const state = pending
    ? "pending"
    : conflict
      ? "conflict"
      : flashed
        ? "success"
        : dirty
          ? "dirty"
          : "clean";

  return (
    <TableCell className="relative h-14 text-right tabular-nums" data-cell-state={state}>
      <div className="flex items-center justify-end gap-2">
        {pending ? <Spinner className="size-3.5" /> : null}
        {children}
        {demo.batchSaving ? <LockSimpleIcon className="size-3.5 text-muted-foreground" /> : null}
      </div>
    </TableCell>
  );
}

export function TradingGrid({ demo }: { readonly demo: EditableSafetyDemo }) {
  const editedRowId = "ORD-1043";

  return (
    <div className="relative overflow-auto rounded-lg border bg-card" aria-busy={demo.batchSaving}>
      <Table className="min-w-[920px]">
        <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
          <TableRow>
            <TableHead className="w-32">Order ID</TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead>Desk</TableHead>
            <TableHead className="text-right">Limit price</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Revision</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orderRows.map((row) => (
            <TableRow key={row.id} className="h-14">
              <TableCell className="font-mono text-xs text-muted-foreground">{row.id}</TableCell>
              <TableCell className="font-semibold">{row.symbol}</TableCell>
              <TableCell>{row.desk}</TableCell>
              <EditableCell demo={demo} rowId={row.id} field="price">
                {formatCellValue(row.price)}
              </EditableCell>
              {row.id === editedRowId && demo.invalidEditorOpen ? (
                <TableCell
                  className="h-14 bg-destructive/5 p-2 text-right"
                  data-cell-state="invalid"
                >
                  <InvalidQuantityEditor demo={demo} />
                </TableCell>
              ) : (
                <EditableCell demo={demo} rowId={row.id} field="quantity">
                  {formatCellValue(row.quantity)}
                </EditableCell>
              )}
              <EditableCell demo={demo} rowId={row.id} field="status">
                <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
              </EditableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {formatCellValue(row.revision)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {demo.batchSaving ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center bg-background/35 pt-14 backdrop-blur-[1px]">
          <Badge className="gap-2 shadow-md" variant="secondary">
            <Spinner className="size-3.5" />
            Saving batch · editing locked
          </Badge>
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite">
        {demo.pendingCells.size} immediate saves pending.{" "}
        {demo.batchSaving ? "Batch save in progress." : ""}
      </div>
    </div>
  );
}

export function CellStateLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <i className="size-2 rounded-full bg-muted-foreground/50" />
        Edited
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i className="size-2 rounded-full bg-destructive" />
        Conflict
      </span>
      <span className="inline-flex items-center gap-1.5">
        <PencilSimpleIcon className="size-3" />
        Enter edits · Escape cancels
      </span>
    </div>
  );
}
