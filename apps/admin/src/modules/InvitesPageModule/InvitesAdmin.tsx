"use client";

import { formatTokenAmount } from "@conditional-stocks/domain";
import { nativeCurrency } from "@conditional-stocks/shared/chains";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCopy, Gift, Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { QueryStatus } from "@/components/data/QueryStatus";
import { useAdmin } from "@/components/providers/AdminProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminConfig } from "@/config/protocol";
import { adminRequest } from "@/lib/admin-api";
import { short, time } from "@/lib/format";

interface TokenRow {
  token: string;
  symbol: string | null;
  decimals: number | null;
  pendingClaims: string;
  unlocking: string;
  unlocked: string;
  paid: string;
  owed: string;
  balance: string | null;
  shortfall: string;
}
interface Overview {
  program: { shareBps: number; months: number };
  payoutWallet: string | null;
  gas: string | null;
  markets: number;
  tokens: TokenRow[];
}
interface CodeView {
  code: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number;
  uses: number;
  note: string | null;
  status: "available" | "used" | "revoked" | "expired";
  members: { wallet: string; joinedAt: string }[];
}
interface MemberView {
  wallet: string;
  code: string;
  codesCreated: number;
  joinedAt: string;
  referrer: string | null;
  codeQuota: number;
  suspended: boolean;
}
const amount = (raw: string, decimals: number | null) =>
  decimals === null ? raw : formatTokenAmount(BigInt(raw), decimals);
const failure = (error: unknown) => (error instanceof Error ? error.message : "Request failed");

/** The referral program and invite-only access: launch codes, members, and what the payout
 * wallet owes against what it holds. The market admin runs it. */
export function InvitesAdmin() {
  const admin = useAdmin();
  const token = admin.token;
  const enabled = Boolean(token) && admin.role === "operator";
  const overview = useQuery({
    queryKey: ["referrals-overview", token],
    queryFn: ({ signal }) => adminRequest<Overview>(token!, "admin/referrals", { signal }),
    enabled,
    refetchInterval: 30_000,
  });
  if (!token)
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            Sign in as the market admin to manage invites, members and referral payouts.
          </p>
          <Button size="sm" disabled={admin.signing} onClick={() => void admin.authenticate()}>
            Sign in
          </Button>
        </CardContent>
      </Card>
    );
  return (
    <div className="flex flex-col gap-6">
      <QueryStatus query={overview} />
      {overview.data && <ProgramOverview overview={overview.data} />}
      <LaunchCodes token={token} enabled={enabled} />
      <Members token={token} enabled={enabled} />
    </div>
  );
}

function ProgramOverview({ overview }: { overview: Overview }) {
  const shortfalls = overview.tokens.filter((t) => BigInt(t.shortfall) > 0n);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="size-4" /> Referral program
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Referrers earn {overview.program.shareBps / 100}% of their referees' net fees for{" "}
          {overview.program.months} months. Rewards unlock the Monday after a market resolves and
          are paid from the payout wallet{" "}
          {overview.payoutWallet ? (
            <code className="text-xs">{overview.payoutWallet}</code>
          ) : (
            "(not configured: claims are off)"
          )}
          .
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {shortfalls.length > 0 && (
          <p role="alert" className="text-sm font-medium text-destructive">
            The payout wallet cannot cover what is owed in{" "}
            {shortfalls.map((t) => t.symbol ?? short(t.token)).join(", ")}. Sweep resolved fees or
            top it up.
          </p>
        )}
        {overview.gas !== null && (
          <p className="text-xs text-muted-foreground">
            Gas balance {Number(formatTokenAmount(BigInt(overview.gas), 18)).toFixed(4)}{" "}
            {nativeCurrency(adminConfig.chainId).symbol} · {overview.markets}{" "}
            {overview.markets === 1 ? "market" : "markets"} with rewards
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">In open markets (claims)</TableHead>
              <TableHead className="text-right">Unlocking</TableHead>
              <TableHead className="text-right">Unlocked</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Owed</TableHead>
              <TableHead className="text-right">Wallet holds</TableHead>
              <TableHead className="text-right">Shortfall</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.tokens.map((t) => (
              <TableRow key={t.token}>
                <TableCell title={t.token}>{t.symbol ?? short(t.token)}</TableCell>
                {(["pendingClaims", "unlocking", "unlocked", "paid", "owed"] as const).map(
                  (field) => (
                    <TableCell key={field} className="text-right tabular-nums">
                      {amount(t[field], t.decimals)}
                    </TableCell>
                  ),
                )}
                <TableCell className="text-right tabular-nums">
                  {t.balance === null ? "—" : amount(t.balance, t.decimals)}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${BigInt(t.shortfall) > 0n ? "font-medium text-destructive" : ""}`}
                >
                  {amount(t.shortfall, t.decimals)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const STATUS: Record<CodeView["status"], "positive" | "secondary" | "destructive"> = {
  available: "positive",
  used: "secondary",
  revoked: "destructive",
  expired: "destructive",
};

function LaunchCodes({ token, enabled }: { token: string; enabled: boolean }) {
  const queryClient = useQueryClient();
  const codes = useQuery({
    queryKey: ["admin-invites", token],
    queryFn: ({ signal }) =>
      adminRequest<{ codes: CodeView[] }>(token, "admin/invites", { signal }),
    enabled,
  });
  const [count, setCount] = useState("10");
  const [maxUses, setMaxUses] = useState("1");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      adminRequest<{ codes: string[] }>(token, "admin/invites", {
        method: "POST",
        body: JSON.stringify({
          count: Number(count),
          maxUses: Number(maxUses),
          expiresAt: expires ? new Date(expires).toISOString() : null,
          note: note || null,
        }),
      }),
    onSuccess: (result) => {
      setCreated(result.codes);
      toast.success(`${result.codes.length} codes created`);
      void queryClient.invalidateQueries({ queryKey: ["admin-invites"] });
    },
    onError: (error) => toast.error(failure(error)),
  });
  const revoke = useMutation({
    mutationFn: (code: string) =>
      adminRequest<{ revoked: boolean }>(token, `admin/invites/${code}/revoke`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-invites"] }),
    onError: (error) => toast.error(failure(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Launch codes</CardTitle>
        <p className="text-sm text-muted-foreground">
          Codes issued here admit wallets with no referrer. Members create their own codes within
          their quota.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-5 sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-count">Codes</Label>
            <Input
              id="invite-count"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-uses">Wallets per code</Label>
            <Input
              id="invite-uses"
              inputMode="numeric"
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-expiry">Expires (optional)</Label>
            <Input
              id="invite-expiry"
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-note">Note</Label>
            <Input
              id="invite-note"
              placeholder="e.g. launch partners"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={create.isPending || !enabled}>
            Create codes
          </Button>
        </form>
        {created.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg bg-secondary p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">New codes</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(created.join("\n"))
                    .then(() => toast.success("Codes copied"))
                }
              >
                <ClipboardCopy data-icon="inline-start" /> Copy all
              </Button>
            </div>
            <code className="whitespace-pre-wrap text-xs">{created.join("  ")}</code>
          </div>
        )}
        <QueryStatus query={codes} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Uses</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(codes.data?.codes ?? []).map((c) => (
              <TableRow key={c.code}>
                <TableCell className="font-mono">{c.code}</TableCell>
                <TableCell>
                  <Badge variant={STATUS[c.status]}>{c.status}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.uses} / {c.maxUses}
                </TableCell>
                <TableCell>{c.note ?? "—"}</TableCell>
                <TableCell>{time(c.createdAt)}</TableCell>
                <TableCell>{c.expiresAt ? time(c.expiresAt) : "Never"}</TableCell>
                <TableCell className="text-right">
                  {c.status === "available" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(c.code.replace("-", ""))}
                    >
                      Revoke
                    </Button>
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

function Members({ token, enabled }: { token: string; enabled: boolean }) {
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: ["admin-members", token],
    queryFn: ({ signal }) =>
      adminRequest<{ members: MemberView[] }>(token, "admin/members", { signal }),
    enabled,
  });
  const update = useMutation({
    mutationFn: (change: { wallet: string; codeQuota?: number; suspended?: boolean }) =>
      adminRequest<{ member: unknown }>(token, `admin/members/${change.wallet}`, {
        method: "POST",
        body: JSON.stringify({
          ...(change.codeQuota !== undefined ? { codeQuota: change.codeQuota } : {}),
          ...(change.suspended !== undefined ? { suspended: change.suspended } : {}),
        }),
      }),
    onSuccess: () => {
      toast.success("Member updated");
      void queryClient.invalidateQueries({ queryKey: ["admin-members"] });
    },
    onError: (error) => toast.error(failure(error)),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" /> Members
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Suspending a member stops its trading and referral earnings and revokes its unused codes;
          its own funds stay withdrawable.
        </p>
      </CardHeader>
      <CardContent>
        <QueryStatus query={members} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Wallet</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Referrer</TableHead>
              <TableHead className="text-right">Codes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(members.data?.members ?? []).map((m) => (
              <TableRow key={m.wallet}>
                <TableCell className="font-mono text-xs" title={m.wallet}>
                  {short(m.wallet, 6)}
                </TableCell>
                <TableCell>{time(m.joinedAt)}</TableCell>
                <TableCell className="font-mono text-xs">{m.code}</TableCell>
                <TableCell className="font-mono text-xs">
                  {m.referrer ? short(m.referrer) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <QuotaEditor
                    member={m}
                    busy={update.isPending}
                    save={(codeQuota) => update.mutate({ wallet: m.wallet, codeQuota })}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant={m.suspended ? "destructive" : "positive"}>
                    {m.suspended ? "Suspended" : "Active"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ wallet: m.wallet, suspended: !m.suspended })}
                  >
                    {m.suspended ? "Reinstate" : "Suspend"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function QuotaEditor({
  member,
  busy,
  save,
}: {
  member: MemberView;
  busy: boolean;
  save: (quota: number) => void;
}) {
  const [value, setValue] = useState(String(member.codeQuota));
  const quota = Number(value);
  const valid = Number.isInteger(quota) && quota >= 0 && quota <= 10_000;
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      {member.codesCreated} of
      <Input
        aria-label={`Code quota for ${member.wallet}`}
        className="h-7 w-16 text-right"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || !valid || quota === member.codeQuota}
        onClick={() => save(quota)}
      >
        Save
      </Button>
    </span>
  );
}
