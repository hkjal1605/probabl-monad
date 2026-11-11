/** The page's two lists scroll inside themselves once they are taller than a cap, so a long one
 * does not push the other out of reach. The app shows no scrollbars, so a capped list says there
 * is more another way: its lower edge fades while rows wait under it (`scrollMore` marks the box
 * `data-more`), and a table's header row stays put (`STICKY_HEAD`). */

/** The open orders' cap: short enough that the trades under them start on the same screen. */
export const ORDERS_CAP = "max-h-[min(30rem,65dvh)]";
/** The trades' cap. */
export const TRADES_CAP = "max-h-[min(36rem,70dvh)]";

/** A box that scrolls down its rows, its lower edge fading while there are more below. */
export const SCROLL_FADE =
  "overflow-y-auto data-more:[mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]";

/** A table header that stays at the top of its scrolling box. Its rule is drawn inside the
 * cells: a collapsed table's own row border does not travel with a sticky header. */
export const STICKY_HEAD =
  "sticky top-0 z-10 bg-background [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0";

/** A `ref` for a scrolling box with one child (its table or list): marks the box `data-more`
 * while it holds rows below the ones in view, as it scrolls, as rows come and go, and as the
 * screen changes size. */
export function scrollMore(box: HTMLElement | null) {
  if (!box) return;
  const read = () =>
    box.toggleAttribute("data-more", box.scrollHeight - box.scrollTop - box.clientHeight > 1);
  read();
  box.addEventListener("scroll", read, { passive: true });
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
  observer?.observe(box);
  if (box.firstElementChild) observer?.observe(box.firstElementChild);
  return () => {
    box.removeEventListener("scroll", read);
    observer?.disconnect();
  };
}
