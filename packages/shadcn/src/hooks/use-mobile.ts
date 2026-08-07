import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribeToMobileMediaQuery(onStoreChange: () => void): () => void {
  const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);

  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getMobileMediaQuerySnapshot(): boolean {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribeToMobileMediaQuery,
    getMobileMediaQuerySnapshot,
    () => false,
  );
}
