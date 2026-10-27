"use client";
import { ArrowRight } from "lucide-react";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import { useWalletLogin } from "@/components/wallet/WalletLoginProvider";
import { protocolConfig } from "@/config/protocol";
import { ONBOARDING_STEPS, TESTNETS } from "@/lib/onboarding";
import { useOnboarding } from "./OnboardingProvider";

/** Testnets only: says where the app runs and leads into the setup guide (connect, or resume
 * the wallet's next step) until the wallet is set up. */
export function TestnetBanner() {
  const wallet = useWallet();
  const login = useWalletLogin();
  const { step, faucet, open, show } = useOnboarding();
  if (!TESTNETS.includes(protocolConfig.chainId) || wallet.restoring) return null;
  // Hidden once set up, while the guide is open, and until a member's faucet claim is known.
  if (wallet.account && (step === null || step === "done" || open)) return null;
  if (step === "tokens" && faucet === null) return null;
  const number = step && step !== "done" ? ONBOARDING_STEPS.indexOf(step) + 1 : 0;
  return (
    <div
      role="note"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-brand-soft px-5 py-1.5 text-center text-sm text-brand-strong"
    >
      <span>probabl runs on {protocolConfig.chainName}: free test tokens, no real money.</span>
      <Button
        variant="link"
        size="sm"
        onClick={wallet.account ? show : login}
        className="h-auto px-0 font-medium text-brand-strong underline underline-offset-2"
      >
        {wallet.account
          ? `Finish setup (step ${number} of ${ONBOARDING_STEPS.length})`
          : "Get started"}
        <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  );
}
