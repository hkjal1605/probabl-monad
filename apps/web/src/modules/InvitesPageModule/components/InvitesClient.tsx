"use client";
import { Copy, Gift, Link2, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { DataError, EmptyState, Stat } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { AccountGate } from "@/components/wallet/AccountGate";
import { protocolConfig } from "@/config/protocol";
import { useMarkets } from "@/hooks/useProtocolData";
import { useReferrals } from "@/hooks/useReferrals";
import { formatUsd, shortAddress, shortDate } from "@/lib/format/display";
import { marketPath } from "@/lib/markets/identity";
import { safeExternalUrl } from "@/lib/markets/resolution";
import {
  expectedUsd,
  formatAmount,
  STATUS_LABEL,
  sumByToken,
  tokenPrices,
  totalUsd,
  unlockDate,
  unlockIn,
} from "@/lib/referrals/presentation";
import {
  type InviteCodeView,
  type MyInvites,
  type ReferralDashboard,
  referralsApi,
  type TokenAmountView,
} from "@/services/referrals-api-service";
import type { MarketView } from "@/types/api";

const failure = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
const percent = (bps: number) => `${bps / 100}%`;

export function InvitesClient() {
  return (
    <AccountGate
      title="Invites & rewards"
      description="Connect your wallet to invite friends and see your referral rewards."
    >
      <InvitesContent />
    </AccountGate>
  );
}

function InvitesContent() {
  const { invites, dashboard, error, loading, refresh } = useReferrals();
  // Markets with live spot prices: USD estimates of rewards paid in stock tokens.
  const { markets } = useMarkets();
  if (error && !dashboard) return <DataError message={error} retry={() => void refresh()} />;
  if (loading || !dashboard || !invites)
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40 w-full rounded-xl" aria-label="Loading rewards" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  const prices = tokenPrices(markets);
  return (
    <div className="flex flex-col gap-6">
      <RewardSummary dashboard={dashboard} prices={prices} refresh={refresh} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <InviteCodes invites={invites} refresh={refresh} />
        <Referees dashboard={dashboard} />
      </div>
      <RewardMarkets dashboard={dashboard} markets={markets} prices={prices} />
      <PayoutHistory dashboard={dashboard} />
    </div>
  );
}

function RewardSummary({
  dashboard,
  prices,
  refresh,
}: {
  dashboard: ReferralDashboard;
  prices: Map<string, number>;
  refresh: () => Promise<void>;
}) {
  const wallet = useWallet();
  const [claiming, setClaiming] = useState(false);
  const { totals, program } = dashboard;
  const open = dashboard.markets.filter((m) => m.status === "pending");
  const expected = open.reduce<number | null>((sum, m) => {
    const usd = expectedUsd(m, prices);
    return sum === null || usd === null ? null : sum + usd;
  }, 0);
  const claimable = totalUsd(totals.claimable, prices);
  const unlocking = sumByToken(totals.unlocking);
  const canClaim =
    dashboard.claimsEnabled && totals.claimable.length > 0 && wallet.access === "member";
  const claim = async () => {
    if (!canClaim || claiming) return;
    setClaiming(true);
    try {
      const result = await referralsApi.claim();
      const paid = result.payouts.filter((p) => p.status === "paid").length;
      const sent = result.payouts.filter((p) => p.status === "sent").length;
      toast.add({
        type: "success",
        title:
          paid === result.payouts.length
            ? "Rewards paid to your wallet"
            : sent > 0
              ? "Rewards sent. They arrive once the transfer confirms."
              : "Some rewards could not be paid",
        ...(result.unavailable.length
          ? {
              description: `${result.unavailable.map(formatAmount).join(", ")} will be payable once the reward wallet is refilled.`,
            }
          : {}),
      });
    } catch (error) {
      toast.add({ type: "error", title: failure(error, "Claiming rewards failed") });
    } finally {
      setClaiming(false);
      void refresh();
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="size-4" /> Referral rewards
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          You earn {percent(program.shareBps)} of the net trading fees paid by members you invite,
          for {program.months} months after they join. A market's rewards unlock the Monday (00:00
          UTC) after it resolves and are paid in the tokens its fees were charged in.
        </p>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <Total label="Claimable now" amounts={totals.claimable} usd={claimable} />
          <Button size="sm" disabled={!canClaim || claiming} onClick={() => void claim()}>
            {claiming && <Spinner data-icon="inline-start" />}
            {dashboard.claimsEnabled ? "Claim rewards" : "Claims open soon"}
          </Button>
        </div>
        <div className="flex flex-col gap-3">
          <Total label="Unlocking" amounts={unlocking} usd={totalUsd(unlocking, prices)} />
          {dashboard.nextUnlockAt !== null && (
            <p className="text-xs text-muted-foreground">
              Next unlock {unlockDate(dashboard.nextUnlockAt)} ({unlockIn(dashboard.nextUnlockAt)})
            </p>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <Stat
            label="In open markets (estimate)"
            value={open.length ? (expected === null ? "—" : `≈ ${formatUsd(expected)}`) : "$0.00"}
          />
          <InfoTooltip content="Rewards from markets that have not resolved are held as outcome claims: their value depends on the outcome. The estimate weights each side by its current probability.">
            <p className="w-fit text-xs text-muted-foreground underline decoration-dotted underline-offset-2">
              {open.length} {open.length === 1 ? "market" : "markets"} still trading
            </p>
          </InfoTooltip>
        </div>
        <div className="flex flex-col gap-3">
          <Total label="Paid out" amounts={totals.paid} usd={totalUsd(totals.paid, prices)} />
        </div>
      </CardContent>
    </Card>
  );
}

/** A total in USD with its tokens below; the tokens themselves when a price is unknown. */
function Total({
  label,
  amounts,
  usd,
}: {
  label: string;
  amounts: TokenAmountView[];
  usd: number | null;
}) {
  if (!amounts.length) return <Stat label={label} value="$0.00" />;
  if (usd === null) return <Stat label={label} value={amounts.map(formatAmount).join(" + ")} />;
  return (
    <>
      <Stat label={label} value={formatUsd(usd)} />
      <ul className="flex flex-col gap-0.5 text-xs tabular-nums text-muted-foreground">
        {amounts.map((a) => (
          <li key={a.token}>{formatAmount(a)}</li>
        ))}
      </ul>
    </>
  );
}

const CODE_STATUS: Record<InviteCodeView["status"], "positive" | "secondary" | "destructive"> = {
  available: "positive",
  used: "secondary",
  revoked: "destructive",
  expired: "destructive",
};

function InviteCodes({ invites, refresh }: { invites: MyInvites; refresh: () => Promise<void> }) {
  const wallet = useWallet();
  const [creating, setCreating] = useState(false);
  const copy = (text: string, what: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.add({ type: "success", title: `${what} copied` }))
      .catch(() => toast.add({ type: "error", title: `Could not copy the ${what.toLowerCase()}` }));
  const link = (code: string) => `${window.location.origin}/?invite=${code}`;
  const create = async () => {
    setCreating(true);
    try {
      const { code } = await referralsApi.createInvite();
      await refresh();
      void copy(link(code), "Invite link");
    } catch (error) {
      toast.add({ type: "error", title: failure(error, "Could not create a code") });
    } finally {
      setCreating(false);
    }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Your invite codes</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {invites.created} of {invites.quota} created · each code admits one wallet
          </p>
        </div>
        <Button
          size="sm"
          disabled={creating || invites.remaining === 0 || wallet.access !== "member"}
          onClick={() => void create()}
        >
          {creating ? <Spinner data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
          Create code
        </Button>
      </CardHeader>
      <CardContent>
        {invites.codes.length === 0 ? (
          <EmptyState>Create a code and share its link to invite a friend.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y">
            {invites.codes.map((code) => (
              <li key={code.code} className="flex flex-wrap items-center gap-3 py-3">
                <code className="font-mono text-sm tracking-widest">{code.code}</code>
                <Badge variant={CODE_STATUS[code.status]}>
                  {code.status[0]!.toUpperCase() + code.status.slice(1)}
                </Badge>
                {code.members.map((m) => (
                  <span key={m.wallet} className="text-xs text-muted-foreground">
                    joined by {shortAddress(m.wallet)} · {shortDate(m.joinedAt)}
                  </span>
                ))}
                {code.status === "available" && (
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Copy code ${code.code}`}
                      onClick={() => void copy(code.code, "Code")}
                    >
                      <Copy />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Copy invite link for ${code.code}`}
                      onClick={() => void copy(link(code.code), "Invite link")}
                    >
                      <Link2 />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Referees({ dashboard }: { dashboard: ReferralDashboard }) {
  const now = Date.now();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members you invited</CardTitle>
      </CardHeader>
      <CardContent>
        {dashboard.referees.length === 0 ? (
          <EmptyState>No one has joined with your codes yet.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Wallet</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Earning until</TableHead>
                <TableHead className="text-right">Fills</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.referees.map((r) => (
                <TableRow key={r.wallet}>
                  <TableCell className="font-mono text-xs">{shortAddress(r.wallet)}</TableCell>
                  <TableCell>{shortDate(r.joinedAt)}</TableCell>
                  <TableCell>
                    {Date.parse(r.earningUntil) > now ? shortDate(r.earningUntil) : "Ended"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.fills}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_BADGE = {
  pending: "secondary",
  unlocking: "warning",
  claimable: "positive",
  lapsed: "destructive",
} as const;

function RewardMarkets({
  dashboard,
  markets,
  prices,
}: {
  dashboard: ReferralDashboard;
  markets: MarketView[];
  prices: Map<string, number>;
}) {
  const byId = new Map(markets.map((m) => [m.id, m]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rewards by market</CardTitle>
      </CardHeader>
      <CardContent>
        {dashboard.markets.length === 0 ? (
          <EmptyState>
            Rewards appear here once members you invited trade and their fills are final.
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Market</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Rewards</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Unlocks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dashboard.markets.map((row) => {
                const market = byId.get(row.marketId);
                const value =
                  row.status === "pending"
                    ? expectedUsd(row, prices)
                    : row.realized
                      ? totalUsd(row.realized, prices)
                      : null;
                return (
                  <TableRow key={row.marketId}>
                    <TableCell className="max-w-72 truncate">
                      {market ? (
                        <Link href={marketPath(market)} className="hover:underline">
                          {market.question}
                        </Link>
                      ) : (
                        `Market ${row.venueId}`
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {row.status === "pending"
                        ? row.accrued
                            .map((a) => `${formatAmount(a)} if ${a.branch === 0 ? "YES" : "NO"}`)
                            .join(" · ")
                        : row.status === "lapsed"
                          ? "The outcome went the other way"
                          : (row.realized ?? []).map(formatAmount).join(" + ")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.status === "lapsed"
                        ? "$0.00"
                        : value === null
                          ? "—"
                          : `${row.status === "pending" ? "≈ " : ""}${formatUsd(value)}`}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.unlockAt === null
                        ? "After resolution"
                        : row.status === "unlocking"
                          ? `${unlockDate(row.unlockAt)} (${unlockIn(row.unlockAt)})`
                          : unlockDate(row.unlockAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PayoutHistory({ dashboard }: { dashboard: ReferralDashboard }) {
  if (!dashboard.payouts.length) return null;
  const explorer = safeExternalUrl(protocolConfig.explorerUrl);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payouts</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Transaction</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dashboard.payouts.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{shortDate(p.createdAt)}</TableCell>
                <TableCell className="tabular-nums">{formatAmount(p)}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      p.status === "paid"
                        ? "positive"
                        : p.status === "sent"
                          ? "warning"
                          : "destructive"
                    }
                  >
                    {p.status === "paid" ? "Paid" : p.status === "sent" ? "Confirming" : "Failed"}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {explorer ? (
                    <a
                      href={`${explorer.replace(/\/$/, "")}/tx/${p.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {shortAddress(p.transactionHash, 6)}
                    </a>
                  ) : (
                    shortAddress(p.transactionHash, 6)
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
