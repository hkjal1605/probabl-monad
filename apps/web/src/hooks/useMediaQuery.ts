import { useCallback, useSyncExternalStore } from "react";

/** Whether the screen matches `query`: false on the server and while hydrating (pages are
 * prerendered for every screen), the screen's own answer from then on. Lets a part that CSS
 * shows only on some screens be left unrendered, and its data unread, on the others. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (change: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", change);
      return () => list.removeEventListener("change", change);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
