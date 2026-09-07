"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  applyDemoAction,
  createDemoState,
  DEMO_STORAGE_KEY,
  DEMO_TICK_MS,
  type DemoAction,
  type DemoState,
  demoMarkets,
  restoreDemoState,
} from "@/lib/demo/engine";
import type { AppMode } from "@/lib/demo/mode";
import { beginModeSwitch } from "@/lib/demo/navigation";
import { logger } from "@/lib/logger";

const ModeContext = createContext<AppMode>("live");
const DemoContext = createContext<{
  state: DemoState;
  markets: ReturnType<typeof demoMarkets>;
  dispatch: (action: DemoAction) => DemoState;
  reset: () => void;
} | null>(null);
export const useAppMode = () => useContext(ModeContext);
export const useDemo = () => useContext(DemoContext);

export function ModeProvider({ mode, children }: { mode: AppMode; children: ReactNode }) {
  useEffect(() => {
    // Cookies are shared between tabs. Reload other documents after a successful
    // switch so a cached live page cannot coexist with the demo cookie (or vice versa).
    const changed = (event: StorageEvent) => {
      if (event.key === "probabl.mode.changed" && event.newValue !== mode) {
        beginModeSwitch();
        window.location.reload();
      }
    };
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    try {
      localStorage.setItem("probabl.mode.changed", mode);
    } catch {
      /* Mode still works in this document. */
    }
    window.addEventListener("storage", changed);
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("pageshow", restored);
    };
  }, [mode]);
  return (
    <ModeContext.Provider value={mode}>
      {mode === "demo" ? <DemoProvider>{children}</DemoProvider> : children}
    </ModeContext.Provider>
  );
}
function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState | null>(null);
  const current = useRef<DemoState | null>(null);
  const warned = useRef(false);
  const commit = useCallback((next: DemoState) => {
    current.current = next;
    setState(next);
    try {
      sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(next));
    } catch {
      if (!warned.current) {
        warned.current = true;
        toast.warning(
          "Browser storage is unavailable. The demo works, but resets when you reload.",
        );
      }
    }
  }, []);
  // Deliberately per-tab: reloads retain state, other tabs cannot double-fill orders.
  useEffect(() => {
    let restored: DemoState | null = null;
    try {
      const saved = sessionStorage.getItem(DEMO_STORAGE_KEY);
      restored = saved ? restoreDemoState(saved) : null;
      if (saved && !restored)
        toast.warning("Incompatible demo data was reset. Live data was not touched.");
    } catch {
      /* Storage may be disabled; the simulator remains usable in memory. */
    }
    const initial = restored ?? createDemoState();
    commit(initial);
    logger.info("demo.started", { restored: Boolean(restored) });
  }, [commit]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!current.current || current.current.paused || document.visibilityState === "hidden")
        return;
      try {
        commit(applyDemoAction(current.current, { type: "tick" }));
      } catch (error) {
        commit({ ...current.current, paused: true });
        logger.error("demo.tick.failed", { error });
        toast.error("Simulation paused after an error. Reset the demo to restart.");
      }
    }, DEMO_TICK_MS);
    return () => clearInterval(timer);
  }, [commit]);
  const markets = useMemo(() => (state ? demoMarkets(state) : []), [state]);
  if (!state)
    return (
      <div
        role="status"
        className="flex min-h-svh items-center justify-center text-muted-foreground"
      >
        Starting local demo…
      </div>
    );
  const dispatch = (action: DemoAction) => {
    if (!current.current) throw new Error("Demo is starting.");
    const next = applyDemoAction(current.current, action);
    commit(next);
    return next;
  };
  return (
    <DemoContext.Provider
      value={{
        state,
        markets,
        dispatch,
        reset: () => {
          commit(createDemoState());
          toast.success("Demo reset. Your real wallet and live data were not changed.");
        },
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}
