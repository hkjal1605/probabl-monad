import type { ComponentType } from "react";

const RELOADED_KEY = "probabl:chunk-reload";
const Nothing = () => null;

/** A lazily loaded component that survives its code failing to load (a deploy replaced the build
 * the page came from, or the network dropped). React would otherwise throw the failure through
 * the root layout and replace the whole app with an error page. The page reloads once to fetch
 * the current build; if it already did in the last minute, the part renders nothing instead. */
export function loadChunk<P>(load: () => Promise<ComponentType<P>>): Promise<ComponentType<P>> {
  return load().catch((error: unknown) => {
    try {
      const last = Number(window.sessionStorage.getItem(RELOADED_KEY) ?? 0);
      if (Date.now() - last > 60_000) {
        window.sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
        window.location.reload();
        return new Promise<ComponentType<P>>(() => {});
      }
    } catch {
      // Without storage, render nothing rather than risk a reload loop.
    }
    console.error("A part of the page failed to load", error);
    return Nothing as ComponentType<P>;
  });
}
