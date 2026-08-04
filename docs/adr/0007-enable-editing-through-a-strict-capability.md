# Enable editing through a strict table capability

`BrunoTableClient` and `BrunoTableServer` use a discriminated editing interface: `editable: true` requires the pure typed `getRowVersion` extractor and the input-modality-neutral `onSaveEdits` persistence operation, while false or omitted editing rejects both and every other edit-only prop. Column `isEditable` declarations identify potentially editable columns and remain the authority for exact cell eligibility.

An Editable Table owns a top-right Immediate/Batch toggle and the persistent Edit Safety Footer. The end user selects the mode; consumers cannot provide a default or controlled mode prop. Toggle visibility comes from static column capability rather than scanning client rows or incomplete server rows, and mode changes are blocked while edits, validation, conflicts, or saving are active.

Both modes invoke the same `onSaveEdits` operation with a non-empty Save Change Set. Immediate mode normally sends one change but keeps paste and Drag Fill atomic as one multi-change call; Batch mode sends the accumulated net change for each dirty cell. V1 exposes no destructive cell Clear/Delete command or keyboard shortcut; a value changes only through an editor, explicit paste transaction, or repetition-only Drag Fill transaction.
