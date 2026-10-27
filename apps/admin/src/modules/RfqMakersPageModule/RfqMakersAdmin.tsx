"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCopy, KeyRound, RadioTower } from "lucide-react";
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
import { adminRequest } from "@/lib/admin-api";
import { short, time } from "@/lib/format";

interface MakerView {
  id: string;
  label: string;
  wallet: string;
  keyPrefix: string;
  createdAt: string;
  revokedAt: string | null;
  status: "active" | "revoked";
  connections: number;
  requests?: number;
  quotes?: number;
  declines?: number;
  rejections?: number;
  awards?: number;
}
interface Makers {
  available: boolean;
  quoteWindowMs: number | null;
  makers: MakerView[];
}
const failure = (error: unknown) => (error instanceof Error ? error.message : "Request failed");

/** Market makers approved to quote market orders over the RFQ stream: one API key per maker
 * wallet, shown once when created. Revoking a key closes its connections at once. */
export function RfqMakersAdmin() {
  const admin = useAdmin();
  const token = admin.token;
  const enabled = Boolean(token) && admin.role === "operator";
  const queryClient = useQueryClient();
  const makers = useQuery({
    queryKey: ["rfq-makers", token],
    queryFn: ({ signal }) => adminRequest<Makers>(token!, "admin/rfq/makers", { signal }),
    enabled,
    refetchInterval: 10_000,
  });
  const [label, setLabel] = useState("");
  const [wallet, setWallet] = useState("");
  const [issued, setIssued] = useState<{ label: string; apiKey: string } | null>(null);
  const create = useMutation({
    mutationFn: () =>
      adminRequest<{ maker: MakerView; apiKey: string }>(token!, "admin/rfq/makers", {
        method: "POST",
        body: JSON.stringify({ label, wallet }),
      }),
    onSuccess: (result) => {
      setIssued({ label: result.maker.label, apiKey: result.apiKey });
      setLabel("");
      setWallet("");
      toast.success(`${result.maker.label} approved`);
      void queryClient.invalidateQueries({ queryKey: ["rfq-makers"] });
    },
    onError: (error) => toast.error(failure(error)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      adminRequest<{ revoked: boolean }>(token!, `admin/rfq/makers/${id}/revoke`, {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      toast.success("Key revoked; its connections were closed");
      void queryClient.invalidateQueries({ queryKey: ["rfq-makers"] });
    },
    onError: (error) => toast.error(failure(error)),
  });
  if (!token)
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">
            Sign in as the market admin to approve RFQ makers.
          </p>
          <Button size="sm" disabled={admin.signing} onClick={() => void admin.authenticate()}>
            Sign in
          </Button>
        </CardContent>
      </Card>
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  const online = (makers.data?.makers ?? []).filter((m) => m.connections > 0).length;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> Approve a maker
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            The wallet signs each quote, and the market order's own transaction fills it from the
            wallet's exchange balance. Give the key to the maker over a private channel: it is shown
            once.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rfq-label">Name</Label>
              <Input
                id="rfq-label"
                placeholder="e.g. Desk one"
                maxLength={64}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rfq-wallet">Maker wallet</Label>
              <Input
                id="rfq-wallet"
                placeholder="0x…"
                spellCheck={false}
                value={wallet}
                onChange={(e) => setWallet(e.target.value.trim())}
              />
            </div>
            <Button
              type="submit"
              disabled={create.isPending || !enabled || !label.trim() || !wallet}
            >
              Create API key
            </Button>
          </form>
          {issued && (
            <div className="flex flex-col gap-2 rounded-lg bg-secondary p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">API key for {issued.label}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(issued.apiKey)
                      .then(() => toast.success("Key copied"))
                  }
                >
                  <ClipboardCopy data-icon="inline-start" /> Copy
                </Button>
              </div>
              <code className="break-all text-xs">{issued.apiKey}</code>
              <p className="text-xs text-muted-foreground">
                This key is not stored and cannot be shown again. Lost keys are revoked and
                replaced.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RadioTower className="size-4" /> Makers
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {makers.data && !makers.data.available
              ? "RFQ is off: the API has no one-click trading key configured."
              : `Market orders wait up to ${makers.data?.quoteWindowMs ?? 500} ms for quotes from the makers online (${online} now). Counters reset when the API restarts.`}
          </p>
        </CardHeader>
        <CardContent>
          <QueryStatus query={makers} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Wallet</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Online</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Quotes</TableHead>
                <TableHead className="text-right">Refused</TableHead>
                <TableHead className="text-right">Awards</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(makers.data?.makers ?? []).map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.label}</TableCell>
                  <TableCell className="font-mono text-xs" title={m.wallet}>
                    {short(m.wallet, 6)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{m.keyPrefix}…</TableCell>
                  <TableCell>
                    <Badge variant={m.status === "active" ? "positive" : "destructive"}>
                      {m.status}
                    </Badge>
                  </TableCell>
                  {(
                    [
                      ["online", m.connections],
                      ["requests", m.requests],
                      ["quotes", m.quotes],
                      ["refused", m.rejections],
                      ["awards", m.awards],
                    ] as const
                  ).map(([column, n]) => (
                    <TableCell key={column} className="text-right tabular-nums">
                      {n ?? 0}
                    </TableCell>
                  ))}
                  <TableCell>{time(m.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {m.status === "active" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(m.id)}
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
    </div>
  );
}
