"use client";

import type { ReactNode } from "react";
import { FirstTradeTour } from "@/components/onboarding/FirstTradeTour";
import { OnboardingProvider } from "@/components/onboarding/OnboardingProvider";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletLoginProvider } from "@/components/wallet/WalletLoginProvider";
import { IndexStreamProvider } from "./IndexStreamProvider";
import { ThemeProvider } from "./ThemeProvider";
import { UiStateProvider } from "./UiStateProvider";
import { WalletProvider } from "./WalletProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <WalletProvider>
        <TooltipProvider delay={250}>
          <WalletLoginProvider>
            <OnboardingProvider>
              <IndexStreamProvider>
                <UiStateProvider>{children}</UiStateProvider>
              </IndexStreamProvider>
            </OnboardingProvider>
          </WalletLoginProvider>
          <FirstTradeTour />
          <Toaster />
        </TooltipProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}
