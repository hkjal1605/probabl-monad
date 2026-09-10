"use client";

import { Toaster } from "@conditional-stocks/ui-kit/sonner";
import { ThemeProvider } from "@conditional-stocks/ui-kit/theme";
import { TooltipProvider } from "@conditional-stocks/ui-kit/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { AppMode } from "@/lib/demo/mode";
import { ModeProvider } from "./DemoProvider";
import { UiStateProvider } from "./UiStateProvider";
import { WalletProvider } from "./WalletProvider";

export function AppProviders({ children, mode }: { children: ReactNode; mode: AppMode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 10_000 } },
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ModeProvider mode={mode}>
          <WalletProvider>
            <TooltipProvider delayDuration={250}>
              <UiStateProvider>{children}</UiStateProvider>
              <Toaster richColors position="bottom-right" />
            </TooltipProvider>
          </WalletProvider>
        </ModeProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
