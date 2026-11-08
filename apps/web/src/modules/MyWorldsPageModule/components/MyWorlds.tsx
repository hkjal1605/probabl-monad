"use client";
import { Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataError } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { AccountGate } from "@/components/wallet/AccountGate";
import { useWorldAccount, useWorldPositions } from "@/hooks/useWorldAccount";
import { useRead } from "@/hooks/useWorlds";
import { dollars, money } from "@/lib/worlds/format";
import { worldsApi } from "@/services/worlds-api";
import { PositionCard } from "./PositionCard";

/** A member's worlds: their world balance and one-tap trading, and every position as a story in
 * progress, with cash-out and collection. */
export function MyWorlds() {
  return (
    <AccountGate title="My worlds" description="Connect your wallet to see the worlds you hold.">
      <Positions />
    </AccountGate>
  );
}

function Positions() {
  const account = useWorldAccount();
  const owner = account.owner;
  const lower = owner?.toLowerCase();
  // The same read as the header's portfolio value (one for both).
  const wallet = useWorldPositions();
  const books = useRead("world-books", (signal) => worldsApi.books(signal), {
    everyMs: 30_000,
    follows: (u) => u.books.length > 0 || u.events.length > 0,
  });
  const fills = useRead(
    owner ? `world-my-fills:${owner}` : null,
    (signal) => worldsApi.myFills(owner!, signal),
    {
      follows: (u) => u.owners.some((o) => o.toLowerCase() === lower),
    },
  );
  const paid = useMemo(() => {
    const out = new Map<number, number>();
    for (const f of fills.data ?? []) {
      if (f.taker.toLowerCase() !== lower) continue;
      const v = dollars(f.price) + (f.sell ? -dollars(f.fee) : dollars(f.fee));
      out.set(f.book, (out.get(f.book) ?? 0) + (f.sell ? -v : v));
    }
    return out;
  }, [fills.data, lower]);
  const byId = useMemo(() => new Map((books.data ?? []).map((b) => [b.id, b])), [books.data]);
  const positions = wallet.data?.positions ?? [];
  const open = positions.filter(
    (p) => !p.redeemable && p.state !== "failed" && p.state !== "passed" && p.state !== "fixed",
  );
  const settled = positions.filter((p) => !open.includes(p));
  const refresh = () => {
    wallet.refresh();
    fills.refresh();
    account.refresh();
  };

  return (
    <div className="flex flex-col gap-10 pt-6 sm:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-medium tracking-[-0.02em]">My worlds</h1>
          <p className="text-sm text-muted-foreground">Every world you hold, and how it's going.</p>
        </div>
        <Button render={<Link href="/worlds" />} nativeButton={false}>
          <Plus data-icon="inline-start" />
          New world
        </Button>
      </div>

      <Balance account={account} />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Open</h2>
        {wallet.error && !wallet.data ? (
          <DataError message="Your positions are unavailable right now." retry={wallet.refresh} />
        ) : wallet.loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        ) : open.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {open.map((p) => (
              <PositionCard
                key={p.book}
                position={p}
                book={byId.get(p.book)}
                paid={paid.get(p.book) ?? 0}
                account={account}
                onChanged={refresh}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
            <p className="text-base font-medium">No open worlds yet.</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Say what you think will happen, or back a world someone else opened.
            </p>
            <Button variant="secondary" render={<Link href="/worlds" />} nativeButton={false}>
              Find a world
            </Button>
          </div>
        )}
      </section>

      {settled.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Settled</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {settled.map((p) => (
              <PositionCard
                key={p.book}
                position={p}
                book={byId.get(p.book)}
                paid={paid.get(p.book) ?? 0}
                account={account}
                onChanged={refresh}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Balance({ account }: { account: ReturnType<typeof useWorldAccount> }) {
  const onboarding = useOnboarding();
  const [amount, setAmount] = useState("");
  const credit = account.credit === null ? null : dollars(account.credit);
  const walletBalance = account.walletBalance === null ? null : dollars(account.walletBalance);
  const value = Number(amount);
  const raw = value > 0 ? BigInt(Math.round(value * 100)) * 10_000n : 0n;
  return (
    <section className="grid gap-4 rounded-xl bg-card p-4 ring-1 ring-border sm:grid-cols-[minmax(0,1fr)_auto] sm:p-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">World balance</span>
            <span className="text-2xl font-medium tabular-nums">
              {credit === null ? "—" : money(credit, { cents: true })}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">In your wallet</span>
            <span className="text-lg tabular-nums text-muted-foreground">
              {walletBalance === null ? "—" : money(walletBalance, { cents: true })}
            </span>
          </div>
        </div>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          {account.permission?.active
            ? "One-tap trading is on: trades fill in one tap, up to $1,000 each."
            : "One-tap trading is off: turn it on to trade worlds in one tap."}
          {!account.permission?.active && (
            <Button
              variant="link"
              size="xs"
              className="h-auto p-0"
              disabled={account.busy}
              onClick={account.enable}
            >
              Turn on
            </Button>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:w-72">
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
            $
          </span>
          <Input
            value={amount}
            inputMode="decimal"
            placeholder="Amount"
            aria-label="Amount in dollars"
            className="pl-6"
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={
              account.busy || raw === 0n || (walletBalance !== null && value > walletBalance)
            }
            onClick={() => account.deposit(raw, () => setAmount(""))}
          >
            {account.busy && <Spinner data-icon="inline-start" />}
            Add
          </Button>
          <Button
            variant="secondary"
            disabled={account.busy || raw === 0n || (credit !== null && value > credit)}
            onClick={() => account.withdraw(raw)}
          >
            Withdraw
          </Button>
        </div>
        {walletBalance !== null && walletBalance < 1 && onboarding.enabled && (
          <Button
            variant="link"
            size="xs"
            className="h-auto self-start p-0"
            onClick={onboarding.show}
          >
            Get test dollars for your wallet
          </Button>
        )}
      </div>
    </section>
  );
}
