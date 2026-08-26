export function armBrunoTableProducedTextCapture(
  grid: HTMLElement,
  capture: HTMLElement | null,
): void {
  if (capture === null || grid.ownerDocument.activeElement !== grid) return;
  capture.textContent = "";
  const selection = grid.ownerDocument.getSelection();
  if (selection === null) return;
  const range = grid.ownerDocument.createRange();
  range.selectNodeContents(capture);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function clearBrunoTableProducedTextCapture(
  grid: HTMLElement,
  capture: HTMLElement | null,
): void {
  if (capture === null) return;
  capture.textContent = "";
  armBrunoTableProducedTextCapture(grid, capture);
}

export function installBrunoTableProducedTextEvidence(
  grid: HTMLElement,
  capture: HTMLElement | null,
  onProducedText: (text: string) => void,
): () => void {
  const ownsCaptureEvent = (target: EventTarget | null) => target === grid || target === capture;
  const handleCompositionStart = (event: CompositionEvent) => {
    if (!ownsCaptureEvent(event.target)) return;
    armBrunoTableProducedTextCapture(grid, capture);
  };
  const handleBeforeInput = (event: InputEvent) => {
    if (!ownsCaptureEvent(event.target)) return;
    if (event.isComposing || event.inputType === "insertCompositionText") return;
    if (typeof event.data === "string" && event.inputType === "insertText") {
      onProducedText(event.data);
      event.preventDefault();
      clearBrunoTableProducedTextCapture(grid, capture);
      return;
    }
    event.preventDefault();
    clearBrunoTableProducedTextCapture(grid, capture);
  };
  const handleCompositionEnd = (event: CompositionEvent) => {
    if (!ownsCaptureEvent(event.target)) return;
    onProducedText(event.data);
    event.preventDefault();
    clearBrunoTableProducedTextCapture(grid, capture);
  };
  grid.addEventListener("compositionstart", handleCompositionStart);
  grid.addEventListener("beforeinput", handleBeforeInput);
  grid.addEventListener("compositionend", handleCompositionEnd);
  return () => {
    grid.removeEventListener("compositionstart", handleCompositionStart);
    grid.removeEventListener("beforeinput", handleBeforeInput);
    grid.removeEventListener("compositionend", handleCompositionEnd);
  };
}
