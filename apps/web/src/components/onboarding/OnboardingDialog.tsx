"use client";
import { formatInviteCode } from "@conditional-stocks/shared/invites";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Clock3,
  ExternalLink,
  Fuel,
  PenLine,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { type Address, formatUnits } from "viem";
import { getBalance } from "viem/actions";
import { useWallet } from "@/components/providers/WalletProvider";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { InviteForm } from "@/components/wallet/InviteForm";
import { protocolConfig } from "@/config/protocol";
import { GAS_FAUCETS, networkName, ONBOARDING_STEPS, type OnboardingStep } from "@/lib/onboarding";
import { tokenDisplay } from "@/lib/tokens/catalog";
import { rpc } from "@/lib/trading/rpc";
import { cn } from "@/lib/utils";
import type { FaucetDelivery } from "@/services/faucet";
import { useOnboarding } from "./OnboardingProvider";

const STEPS: Record<(typeof ONBOARDING_STEPS)[number], { label: string; hint: string }> = {
  network: { label: "Switch network", hint: "Robinhood Chain Testnet" },
  "sign-in": { label: "Sign in", hint: "A free signature" },
  tokens: { label: "Get test tokens", hint: "Stocks, USDG and gas" },
};
const ART: Record<OnboardingStep, string> = {
  network: "/onboarding/network.webp",
  "sign-in": "/onboarding/signin.webp",
  tokens: "/onboarding/tokens.webp",
  done: "/onboarding/done.webp",
};
const GAS_FAUCET = GAS_FAUCETS[protocolConfig.chainId] ?? null;
const rpcHost = (() => {
  try {
    return new URL(protocolConfig.rpcUrl).host;
  } catch {
    return protocolConfig.rpcUrl;
  }
})();
const amountFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const ethFormat = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The wallet's ETH on the deployment's RPC, reread every 10 s (and when the page regains focus,
 * e.g. back from the faucet) until it holds some. */
function useGasBalance(owner: string | null, active: boolean) {
  const [balance, setBalance] = useState<{ owner: string; value: bigint } | null>(null);
  useEffect(() => {
    if (!owner || !active) return;
    let stopped = false,
      reading = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (reading) return;
      reading = true;
      clearTimeout(timer);
      let funded = false;
      try {
        const value = await getBalance(rpc(), { address: owner as Address });
        if (!stopped) setBalance({ owner, value });
        funded = value > 0n;
      } catch {
        // Read again shortly.
      } finally {
        reading = false;
      }
      if (!stopped && !funded) timer = setTimeout(() => void read(), 10_000);
    };
    void read();
    const focus = () => void read();
    window.addEventListener("focus", focus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
    };
  }, [owner, active]);
  return balance?.owner === owner ? balance.value : null;
}

/** Numbered steps, ticked off as they are done; on the dark brand panel. */
function Stepper({ step }: { step: OnboardingStep }) {
  const at = step === "done" ? ONBOARDING_STEPS.length : ONBOARDING_STEPS.indexOf(step);
  return (
    <ol aria-label="Setup progress" className="flex flex-col">
      {ONBOARDING_STEPS.map((id, i) => {
        const state = i < at ? "done" : i === at ? "current" : "upcoming";
        return (
          <li
            key={id}
            aria-current={state === "current" ? "step" : undefined}
            className="relative flex gap-3 pb-6 last:pb-0"
          >
            {i < ONBOARDING_STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-8 bottom-1.5 left-[13.5px] w-px transition-colors duration-500",
                  i < at ? "bg-brand" : "bg-white/12",
                )}
              />
            )}
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-all duration-300",
                state === "done" && "bg-brand text-[#071a12]",
                state === "current" &&
                  "bg-brand/12 text-brand shadow-[0_0_20px_-4px_#00e191] ring-1 ring-brand",
                state === "upcoming" && "text-white/45 ring-1 ring-white/15",
              )}
            >
              {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              <span className="sr-only">{state === "done" ? " (done)" : ""}</span>
            </span>
            <span className="flex min-w-0 flex-col gap-1.5 pt-1.5">
              <span
                className={cn(
                  "text-sm leading-none font-medium",
                  state === "upcoming" ? "text-white/55" : "text-white",
                )}
              >
                {STEPS[id].label}
              </span>
              <span className="text-xs leading-none text-white/45">{STEPS[id].hint}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The same progress as three bars, for phones. */
function StepBars({ step }: { step: OnboardingStep }) {
  const at = step === "done" ? ONBOARDING_STEPS.length : ONBOARDING_STEPS.indexOf(step);
  return (
    <div aria-hidden className="grid grid-cols-3 gap-1.5 sm:hidden">
      {ONBOARDING_STEPS.map((id, i) => (
        <span key={id} className="flex flex-col gap-1.5">
          <span
            className={cn(
              "h-1 rounded-full transition-colors duration-500",
              i <= at ? "bg-brand" : "bg-muted",
              i === at && "bg-brand/60",
            )}
          />
          <span
            className={cn(
              "text-[11px] leading-none",
              i === at ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {STEPS[id].label}
          </span>
        </span>
      ))}
    </div>
  );
}

function TokenIcon({ symbol, size = "sm" }: { symbol: string; size?: "sm" | "default" }) {
  const image = tokenDisplay(symbol, null, protocolConfig.chainId)?.image;
  return (
    <Avatar size={size}>
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback>{symbol.slice(0, 2)}</AvatarFallback>
    </Avatar>
  );
}

function Pending({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
      <Spinner className="size-3.5 text-brand-strong" />
      {children}
    </p>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-xs font-medium text-destructive">
      {children}
    </p>
  );
}

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-strong [&_svg]:size-4">
        {icon}
      </span>
      {children}
    </li>
  );
}

function NetworkStep() {
  const wallet = useWallet();
  const [switching, setSwitching] = useState(false);
  const waiting = switching || wallet.status === "connecting";
  const from = wallet.chainId === null ? "Your network" : networkName(wallet.chainId);
  const details = [
    ["Network", protocolConfig.chainName],
    ["RPC", rpcHost],
    ["Chain ID", String(protocolConfig.chainId)],
    ["Currency", "ETH"],
  ] as const;
  const switchNetwork = async () => {
    setSwitching(true);
    try {
      await wallet.ensureNetwork();
    } catch {
      // The wallet controller shows why.
    } finally {
      setSwitching(false);
    }
  };
  return (
    <StepBody
      title="Switch to Robinhood Testnet"
      description="probabl's testnet runs on Robinhood Chain. Approve the network in your wallet to use the product. It's added for you if your wallet doesn't have it yet."
      action={
        <Button size="lg" className="w-full sm:w-auto" disabled={waiting} onClick={switchNetwork}>
          {waiting ? <Spinner data-icon="inline-start" /> : null}
          {waiting ? "Waiting for your wallet…" : "Switch to Robinhood Testnet"}
        </Button>
      }
    >
      <div className="flex items-center gap-2 rounded-lg border bg-card p-2 text-xs font-medium">
        <span className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-muted-foreground line-through decoration-muted-foreground/40">
          {from}
        </span>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-md bg-brand-soft px-2 py-1.5 text-brand-strong">
          <span className="size-1.5 shrink-0 rounded-full bg-brand shadow-[0_0_8px_#00e191]" />
          <span className="truncate">{protocolConfig.chainName}</span>
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        {details.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="truncate font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {waiting ? (
        <Pending>Approve adding and switching the network in your wallet.</Pending>
      ) : (
        wallet.error && <Problem>{wallet.error}</Problem>
      )}
    </StepBody>
  );
}

function SignInStep() {
  const wallet = useWallet();
  const [error, setError] = useState<string | null>(null);
  const signing = wallet.status === "signing";
  // Connecting finishes reading the wallet's session after the network switch: signing in waits.
  const settling = wallet.status === "connecting" || wallet.restoring;
  if (wallet.access === "invite-required")
    return (
      <StepBody
        title="Enter your invite code"
        description="probabl is invite-only for now. Enter the code a member shared with you to join and start trading."
      >
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <BadgeCheck className="size-3.5 text-brand-strong" />
          Signed in as{" "}
          <span className="font-medium text-foreground">{short(wallet.account ?? "")}</span>
        </p>
        <InviteForm autoFocus />
        <p className="text-xs text-muted-foreground">
          No code yet? Ask a member for their invite link: opening it fills the code in.
        </p>
      </StepBody>
    );
  const signIn = async () => {
    setError(null);
    try {
      await wallet.authenticate();
    } catch (cause) {
      setError(
        (cause as { code?: unknown } | null)?.code === 4001
          ? "The signature was declined in your wallet."
          : cause instanceof Error
            ? cause.message
            : "Sign-in failed",
      );
    }
  };
  return (
    <StepBody
      title="Sign in with your wallet"
      description="Sign a message to prove this wallet is yours. The same sign-in as the header's Sign in button."
      action={
        <Button
          size="lg"
          className="w-full sm:w-auto"
          disabled={signing || settling}
          onClick={signIn}
        >
          {signing || settling ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PenLine data-icon="inline-start" />
          )}
          {signing ? "Sign in your wallet…" : settling ? "Connecting…" : "Sign in"}
        </Button>
      }
    >
      <ul className="flex flex-col gap-2.5">
        <Point icon={<BadgeCheck />}>Proves you own this wallet</Point>
        <Point icon={<Fuel />}>Free: a signature, never a transaction</Point>
        <Point icon={<Clock3 />}>Keeps you signed in for 30 days</Point>
      </ul>
      {wallet.invite && (
        <p className="text-xs text-muted-foreground">
          Your invite{" "}
          <span className="font-medium text-foreground">{formatInviteCode(wallet.invite)}</span> is
          used when you sign in.
        </p>
      )}
      {signing ? (
        <Pending>Confirm the signature request in your wallet.</Pending>
      ) : (
        error && <Problem>{error}</Problem>
      )}
    </StepBody>
  );
}

/** Testnet ETH: where to get it, and whether the wallet has some yet. */
function GasCard({ balance }: { balance: bigint | null }) {
  const funded = balance !== null && balance > 0n;
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4",
            funded ? "bg-brand text-[#071a12]" : "bg-warning-soft text-warning",
          )}
        >
          {funded ? <Check strokeWidth={3} /> : <Fuel />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium">Testnet ETH for gas</p>
          <p className="text-xs text-muted-foreground">
            {funded
              ? `${ethFormat.format(Number(formatUnits(balance, 18)))} ETH in your wallet. You're set for deposits and approvals.`
              : "Deposits and approvals need a little ETH. Get some free from the Robinhood Chain faucet."}
          </p>
        </div>
      </div>
      {!funded && GAS_FAUCET && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={GAS_FAUCET} target="_blank" rel="noopener noreferrer" />}
          >
            Open the faucet
            <ExternalLink data-icon="inline-end" />
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-warning" />
            {balance === null ? "Checking your balance…" : "Waiting for ETH…"}
          </span>
        </div>
      )}
    </div>
  );
}

function TokensStep({ balance }: { balance: bigint | null }) {
  const { faucet, claiming, claimError, claimTokens } = useOnboarding();
  if (faucet === null)
    return (
      <StepBody title="Get test tokens" description="Checking the testnet faucet…">
        <Pending>Loading</Pending>
      </StepBody>
    );
  const [quote, ...assets] = faucet.tokens;
  return (
    <StepBody
      title="Get test tokens"
      description="Free tokens to try every market. They only exist on the testnet and have no value."
      action={
        <Button
          size="lg"
          className="w-full sm:w-auto"
          disabled={claiming}
          onClick={() => void claimTokens()}
        >
          {claiming && <Spinner data-icon="inline-start" />}
          {claiming ? "Sending to your wallet…" : claimError ? "Try again" : "Get test tokens"}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-3">
          <AvatarGroup className="shrink-0 *:data-[slot=avatar]:ring-card">
            {faucet.tokens.slice(0, 4).map((t) => (
              <TokenIcon key={t.token} symbol={t.symbol} size="default" />
            ))}
            {faucet.tokens.length > 4 && (
              <AvatarGroupCount className="text-xs font-medium ring-card">
                +{faucet.tokens.length - 4}
              </AvatarGroupCount>
            )}
          </AvatarGroup>
          <div className="flex min-w-0 flex-col gap-1">
            {quote && (
              <p className="text-sm font-medium">
                {amountFormat.format(faucet.quoteUnits)} {quote.symbol}
              </p>
            )}
            {assets.length > 0 && (
              <p className="text-xs text-muted-foreground">
                + {usd.format(faucet.assetUsd)} of each of {assets.length} stock and crypto tokens
              </p>
            )}
          </div>
        </div>
        {claiming && (
          <Pending>
            Minting your tokens on {protocolConfig.chainName}. This takes a few seconds.
          </Pending>
        )}
        {!claiming && claimError && <Problem>{claimError}</Problem>}
      </div>
      <GasCard balance={balance} />
    </StepBody>
  );
}

function Received({ sent }: { sent: FaucetDelivery[] }) {
  if (!sent.length) return null;
  return (
    <ul
      aria-label="Tokens received"
      className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto pr-1 pb-3 [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)] sm:grid-cols-3"
    >
      {sent.map((d) => (
        <li
          key={d.symbol}
          className="flex min-w-0 items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs"
        >
          <TokenIcon symbol={d.symbol} />
          <span className="min-w-0 truncate">
            <span className="font-medium tabular-nums">
              {amountFormat.format(Number(formatUnits(BigInt(d.amount), d.decimals)))}
            </span>{" "}
            <span className="text-muted-foreground">{d.symbol}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function DoneStep({ balance }: { balance: bigint | null }) {
  const { claim, finish } = useOnboarding();
  const transaction = claim?.transactions.at(-1);
  return (
    <StepBody
      title="You're all set"
      description={`Your wallet is ready to trade on ${protocolConfig.chainName}.`}
      action={
        <>
          <Button size="lg" className="w-full sm:w-auto" onClick={finish}>
            Start trading
            <ArrowRight data-icon="inline-end" />
          </Button>
          {transaction && protocolConfig.explorerUrl && (
            <Button
              variant="ghost"
              size="lg"
              className="w-full sm:w-auto"
              nativeButton={false}
              render={
                <a
                  href={`${protocolConfig.explorerUrl}/tx/${transaction}`}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              View transaction
              <ExternalLink data-icon="inline-end" />
            </Button>
          )}
        </>
      }
    >
      {claim && claim.sent.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Sent to your wallet · {claim.sent.length} tokens
          </p>
          <Received sent={claim.sent} />
        </div>
      )}
      <GasCard balance={balance} />
    </StepBody>
  );
}

/** One step's heading, body and actions. */
function StepBody({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-5 animate-in fade-in-0 slide-in-from-right-2 duration-300">
      <div className="flex flex-col gap-2">
        <DialogTitle className="text-xl leading-tight font-medium">{title}</DialogTitle>
        <DialogDescription className="text-sm leading-snug">{description}</DialogDescription>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
      {action && (
        <div className="mt-auto flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">{action}</div>
      )}
    </div>
  );
}

/** The first-run guide: switch network, sign in, get test tokens. Opens at the wallet's current
 * step and moves on by itself as each one is done. */
export function OnboardingDialog() {
  const wallet = useWallet();
  const { step, open, dismiss } = useOnboarding();
  const current = step ?? "network";
  const balance = useGasBalance(
    wallet.account,
    open && (current === "tokens" || current === "done"),
  );
  const number = current === "done" ? null : ONBOARDING_STEPS.indexOf(current) + 1;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()} disablePointerDismissal>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-1.5rem)] max-w-[calc(100%-1.5rem)] gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-[780px]"
      >
        <div className="grid sm:min-h-[500px] sm:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="relative flex flex-col overflow-hidden bg-[#07120d] text-white">
            <div className="relative aspect-[16/8] w-full sm:aspect-[3/2]">
              {(Object.keys(ART) as OnboardingStep[]).map((id) => (
                // biome-ignore lint/performance/noImgElement: small bundled art crossfading in place; next/image would add a loader for nothing.
                <img
                  key={id}
                  src={ART[id]}
                  alt=""
                  decoding="async"
                  className={cn(
                    "absolute inset-0 size-full object-cover transition-opacity duration-500",
                    id === current ? "opacity-100" : "opacity-0",
                  )}
                />
              ))}
              <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#07120d] to-transparent" />
            </div>
            <div className="hidden flex-1 flex-col justify-between gap-6 px-6 pt-2 pb-6 sm:flex">
              <Stepper step={current} />
              <p className="text-xs leading-relaxed text-white/45">
                Testnet only: tokens here have no value. Your wallet and keys never leave your
                device.
              </p>
            </div>
          </aside>
          <section className="flex flex-col gap-5 p-5 sm:p-7">
            <StepBars step={current} />
            <p className="text-xs font-medium tracking-wide text-brand-strong uppercase">
              {number ? `Step ${number} of ${ONBOARDING_STEPS.length}` : "Setup complete"}
            </p>
            {current === "network" ? (
              <NetworkStep />
            ) : current === "sign-in" ? (
              <SignInStep />
            ) : current === "tokens" ? (
              <TokensStep balance={balance} />
            ) : (
              <DoneStep balance={balance} />
            )}
            {current !== "done" && (
              <Button
                variant="link"
                size="sm"
                className="h-auto self-center px-0 text-xs text-muted-foreground sm:self-start"
                onClick={dismiss}
              >
                Skip for now
              </Button>
            )}
          </section>
        </div>
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-2.5 right-2.5 text-white/80 hover:bg-white/10 hover:text-white sm:text-muted-foreground sm:hover:bg-muted sm:hover:text-foreground"
            />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
