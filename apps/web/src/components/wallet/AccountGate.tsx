"use client";
import { formatInviteCode } from "@conditional-stocks/shared/invites";
import { KeyRound, WalletCards } from "lucide-react";
import type { ReactNode } from "react";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { protocolConfig } from "@/config/protocol";
import { InviteForm } from "./InviteForm";
import { useInviteDialog, useWalletLogin } from "./WalletLoginProvider";

/** The step a wallet takes next to trade, or null once it can: connect, switch to the
 * deployment's network, sign in, join. */
export function useAccountStep(): {
  kind: "connect" | "network" | "sign-in" | "invite" | "suspended";
  label: string;
  action: () => void;
  disabled: boolean;
  busy: boolean;
} | null {
  const wallet = useWallet();
  const login = useWalletLogin();
  const openInvite = useInviteDialog();
  const onboarding = useOnboarding();
  const busy = wallet.restoring || wallet.status === "connecting" || wallet.status === "signing";
  switch (wallet.access) {
    case "member":
      return null;
    case "disconnected":
      return { kind: "connect", label: "Connect wallet", action: login, disabled: busy, busy };
    case "signed-out":
      // Signing in needs the deployment's network: that comes first.
      if (wallet.chainId !== null && wallet.chainId !== protocolConfig.chainId)
        return {
          kind: "network",
          label: "Switch network",
          action: () =>
            void wallet.ensureNetwork().catch(() => {
              // The wallet controller shows why.
            }),
          disabled: busy,
          busy,
        };
      return {
        kind: "sign-in",
        label: "Sign in to trade",
        action: () =>
          void wallet.authenticate().catch((error) =>
            toast.add({
              type: "error",
              title: error instanceof Error ? error.message : "Sign-in failed",
            }),
          ),
        disabled: busy,
        busy,
      };
    case "invite-required":
      return {
        kind: "invite",
        label: "Enter invite code",
        // The setup guide opens at its sign-in step, which takes the code (testnets).
        action: onboarding.enabled ? onboarding.show : openInvite,
        disabled: busy,
        busy,
      };
    case "suspended":
      return {
        kind: "suspended",
        label: "Trading is suspended",
        action: () => {},
        disabled: true,
        busy: false,
      };
  }
}

/** Shows `children` to a signed-in, invited wallet; anyone else sees the next step. Browsing
 * stays open to everyone: only a wallet's own data and trading need an invite. */
export function AccountGate({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const wallet = useWallet();
  const step = useAccountStep();
  if (wallet.access === "member" || wallet.access === "suspended") return children;
  const invite = wallet.access === "invite-required";
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-card text-muted-foreground">
          {invite ? <KeyRound className="size-5" /> : <WalletCards className="size-5" />}
        </span>
        <div>
          <h1 className="text-xl font-medium">{invite ? "Invite only" : title}</h1>
          <p className="mt-2 text-sm font-medium text-muted-foreground">
            {invite
              ? "probabl is invite-only for now. Enter a code from a member to start trading."
              : step?.kind === "network"
                ? `Switch your wallet to ${protocolConfig.chainName}, then sign in.`
                : wallet.access === "signed-out"
                  ? "Sign in with your wallet: a free signature, never a transaction."
                  : description}
          </p>
        </div>
        {invite ? (
          <InviteForm />
        ) : step ? (
          <Button disabled={step.disabled} onClick={step.action}>
            {step.busy && <Spinner data-icon="inline-start" />}
            {step.kind === "sign-in" ? "Sign in" : step.label}
          </Button>
        ) : null}
        {wallet.access === "signed-out" && wallet.invite && (
          <p className="text-xs text-muted-foreground">
            Your invite {formatInviteCode(wallet.invite)} is used when you sign in.
          </p>
        )}
      </div>
    </div>
  );
}

/** The next step as an empty state inside a page or panel, or null once the wallet can act.
 * `children` describes what connecting shows. */
export function AccountStepEmpty({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const step = useAccountStep();
  if (!step || wallet.access === "suspended") return null;
  return (
    <EmptyState>
      <p>
        {step.kind === "network"
          ? `Switch your wallet to ${protocolConfig.chainName}, then sign in to continue.`
          : wallet.access === "signed-out"
            ? "Sign in with your wallet to continue: a free signature, never a transaction."
            : wallet.access === "invite-required"
              ? "An invite code is required to trade and view your portfolio."
              : children}
      </p>
      <Button disabled={step.disabled} onClick={step.action}>
        {step.busy && <Spinner data-icon="inline-start" />}
        {step.label}
      </Button>
    </EmptyState>
  );
}
