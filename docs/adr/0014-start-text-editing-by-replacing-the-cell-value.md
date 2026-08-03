# Start text editing by replacing the cell value

When an editable `BrunoTableClient` cell owns the Active Cell and the user produces printable text in Navigation Mode, BrunoTable starts a Cell Edit Session in replace mode. The initial raw editor candidate is the text the user just produced; it does not prepend or append to the cell's existing presentation. For example, typing `b`, `y`, `e` over a focused cell that currently contains `hello` edits the candidate as `bye`.

Enter and F2 remain the non-destructive edit-entry paths: they start the editor from the cell's current pre-session typed value. Escape from either entry path restores that exact pre-session value, including an existing Batch draft, without creating a transaction.

Replace-on-type applies only when the concrete cell is currently editable and its compiled editor supports direct text input. It targets only the Active Cell, even when a Client Cell Range Selection exists. Read-only Client cells and every Server cell remain in Navigation Mode.

Only text-producing input starts replace mode. Command shortcuts that produce no text, navigation keys, function keys, `Delete`, and `Backspace` do not seed an editor or mutate a cell. International input must preserve the browser's produced text: AltGr/Option characters, composition, dead-key, and IME sequences are normalized as text input rather than treating modifier presence or intermediate `keydown` values as proof that text was or was not committed.

The seed is raw editor text, not a parsed value. Parsing, blank policy, synchronous local validation, draft creation, Batch history, and Immediate persistence still occur only at Cell Edit Commit. An invalid candidate therefore remains in the editor under the existing blocking-validation contract.
