"use client";

import { Button } from "@conditional-stocks/ui-kit/button";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppMode, useDemo } from "@/components/providers/DemoProvider";
import { beginModeSwitch } from "@/lib/demo/navigation";

export function ModeBar() {
  const mode = useAppMode();
  const demo = useDemo();
  const pathname = usePathname();
  return (
    <section aria-label="Application mode" className="border-b bg-muted/50">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-5 py-2 text-xs sm:px-8">
        <p role="status">
          {mode === "demo"
            ? "DEMO · Fictitious assets only. No wallet signatures or real transactions."
            : "LIVE · Connected to real services. Wallet actions use real assets."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {demo && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => demo.dispatch({ type: "pause", paused: !demo.state.paused })}
              >
                {demo.state.paused ? "Resume simulation" : "Pause simulation"}
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/funds">Demo controls</Link>
              </Button>
            </>
          )}
          <form
            action="/api/mode"
            method="post"
            onSubmit={(event) => {
              if (
                mode === "demo" &&
                !window.confirm(
                  "Switch to live mode? Wallet actions will use real assets. Your demo stays saved in this tab.",
                )
              ) {
                event.preventDefault();
                return;
              }
              beginModeSwitch();
            }}
          >
            <input type="hidden" name="mode" value={mode === "demo" ? "live" : "demo"} />
            <input
              type="hidden"
              name="returnTo"
              value={pathname.startsWith("/markets/") ? "/markets" : pathname}
            />
            <Button variant={mode === "demo" ? "outline" : "brand"} size="sm" type="submit">
              {mode === "demo" ? "Switch to live" : "Try demo mode"}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
}
