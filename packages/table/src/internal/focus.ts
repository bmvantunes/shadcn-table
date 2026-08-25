export function yieldBrunoTableGridTabStopForNativeTraversal(grid: HTMLElement): void {
  grid.tabIndex = -1;
  setTimeout(() => {
    if (grid.isConnected) grid.tabIndex = 0;
  }, 0);
}
