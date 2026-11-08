import { useSyncExternalStore } from "react";

/** A phone: a narrow screen, or a touch screen held sideways (short and coarse). Pickers and
 * dialogs open as bottom sheets there, anchored popovers and centred dialogs elsewhere. */
export const PHONE_QUERY = "(max-width: 767px), (pointer: coarse) and (max-height: 500px)";

const subscribe = (change: () => void) => {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};

/** Whether the screen is a phone's. False on the server and while hydrating (the page is
 * prerendered for every screen), the screen's own answer from then on. */
export function usePhone() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
