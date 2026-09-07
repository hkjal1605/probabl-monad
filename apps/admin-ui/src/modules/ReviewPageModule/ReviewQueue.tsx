"use client";

import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@conditional-stocks/ui-kit/dialog";
import { Input } from "@conditional-stocks/ui-kit/input";
import { Label } from "@conditional-stocks/ui-kit/label";
import { Textarea } from "@conditional-stocks/ui-kit/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCopy, FileCheck2, LoaderCircle, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "@/components/providers/AdminProvider";
import { adminRequest, type EvidenceView } from "@/lib/admin-api";
import { short, time } from "@/lib/format";

const creationChecks = [
  "stock-and-quote",
  "condition-id",
  "yes-no-orientation",
  "rules-and-dates",
  "source-and-raw-hash",
];
const resolutionChecks = [
  "frozen-or-awaiting",
  "condition-id",
  "yes-no-orientation",
  "final-status",
  "polygon-reference",
  "attachments",
  "payout-vector",
];
export function ReviewQueue() {
  const admin = useAdmin();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["evidence"],
    queryFn: () => adminRequest<{ packets: EvidenceView[] }>(admin.token ?? "", "admin/evidence"),
    enabled: Boolean(admin.token),
    refetchInterval: 8_000,
  });
  const packets = query.data?.packets ?? [];
  return (
    <div className="mt-8 grid gap-4">
      {packets.map((packet) => (
        <PacketCard
          key={packet.envelope.packetHash}
          packet={packet}
          onDone={() => queryClient.invalidateQueries({ queryKey: ["evidence"] })}
        />
      ))}
      {packets.length === 0 && (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
          No evidence packets are waiting.
        </div>
      )}
    </div>
  );
}
function PacketCard({ packet, onDone }: { packet: EvidenceView; onDone: () => void }) {
  const admin = useAdmin();
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<EvidenceView["previews"][number] | null>(
    packet.previews.at(-1) ?? null,
  );
  const keys =
    packet.envelope.packet.kind === "market-creation" ? creationChecks : resolutionChecks;
  const hash = packet.envelope.packetHash;
  const review = async (decision: "approve" | "reject") => {
    setBusy(true);
    try {
      await adminRequest(admin.token ?? "", `admin/evidence/${hash}/review`, {
        body: JSON.stringify({ checklist: checks, decision, notes }),
        method: "POST",
      });
      toast.success(`Packet ${decision === "approve" ? "approved" : "rejected"}`);
      onDone();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Review failed");
    } finally {
      setBusy(false);
    }
  };
  const simulate = async () => {
    setBusy(true);
    try {
      const value = await adminRequest<EvidenceView["previews"][number]>(
        admin.token ?? "",
        `admin/evidence/${hash}/transaction`,
        { body: "{}", method: "POST" },
      );
      setPreview(value);
      toast.success("Transaction simulated against current chain state");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Simulation failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge
              variant={packet.envelope.packet.kind === "market-creation" ? "brand" : "warning"}
            >
              {packet.envelope.packet.kind.replace("market-", "")}
            </Badge>
            <Badge
              variant={
                packet.status === "approved"
                  ? "positive"
                  : packet.status === "rejected"
                    ? "destructive"
                    : "secondary"
              }
            >
              {packet.status}
            </Badge>
          </div>
          <CardTitle className="mt-3">
            {packet.envelope.packet.kind === "market-creation"
              ? (packet.envelope.packet.polymarket?.question ?? "Market creation packet")
              : `Resolve market ${short(packet.envelope.packet.localMarket?.marketId ?? "")}`}
          </CardTitle>
          <p className="mt-2 text-xs text-muted-foreground">
            Prepared by {short(packet.envelope.packet.preparer)} ·{" "}
            {time(packet.envelope.packet.preparedAt)}
          </p>
        </div>
        <code className="text-xs text-muted-foreground">{short(hash, 6)}</code>
      </CardHeader>
      <CardContent>
        {packet.status === "prepared" && (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">
                <FileCheck2 />
                Independent review
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>Review immutable evidence</DialogTitle>
                <DialogDescription>
                  The preparer cannot review this packet. Verify every item from its original source
                  before approving.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                {keys.map((key) => (
                  <label key={key} className="flex items-start gap-3 rounded-xl border p-3">
                    <input
                      type="checkbox"
                      checked={checks[key] === true}
                      onChange={(event) =>
                        setChecks((current) => ({ ...current, [key]: event.target.checked }))
                      }
                      className="mt-0.5 size-4 accent-[var(--brand)]"
                    />
                    <span className="text-sm font-medium">{key.replaceAll("-", " ")}</span>
                  </label>
                ))}
              </div>
              <Textarea
                placeholder="Reviewer notes (append-only)"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <Button variant="destructive" onClick={() => review("reject")} disabled={busy}>
                  <XCircle />
                  Reject
                </Button>
                <Button
                  variant="brand"
                  onClick={() => review("approve")}
                  disabled={busy || keys.some((key) => !checks[key])}
                >
                  {busy ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}Approve
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
        {packet.status === "approved" && (
          <Button variant={preview ? "outline" : "brand"} onClick={simulate} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <FileCheck2 />}
            {preview ? "Re-simulate current action" : "Simulate Safe payload"}
          </Button>
        )}
        {preview && (
          <div className="mt-4 rounded-xl border bg-muted/45 p-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Safe transaction · {preview.action}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(
                      JSON.stringify(
                        { data: preview.data, to: preview.to, value: preview.value },
                        null,
                        2,
                      ),
                    )
                    .then(() => toast.success("Safe payload copied"))
                }
              >
                <ClipboardCopy />
                Copy JSON
              </Button>
            </div>
            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">To</dt>
                <dd className="mt-1 break-all font-mono">{preview.to}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Chain</dt>
                <dd className="mt-1 font-mono">{preview.chainId}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Calldata</dt>
                <dd className="mt-1 max-h-24 overflow-auto break-all font-mono">{preview.data}</dd>
              </div>
            </dl>
            <Reconcile packetHash={hash} action={preview.action} onDone={onDone} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Reconcile({
  action,
  onDone,
  packetHash,
}: {
  action: string;
  onDone: () => void;
  packetHash: string;
}) {
  const admin = useAdmin();
  const [transactionHash, setTransactionHash] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await adminRequest(admin.token ?? "", `admin/evidence/${packetHash}/reconcile`, {
        body: JSON.stringify({ action, transactionHash }),
        method: "POST",
      });
      toast.success("Safe execution reconciled to canonical chain state");
      onDone();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Reconciliation failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 border-t pt-4">
      <Label htmlFor={`tx-${packetHash}`}>Executed Safe transaction hash</Label>
      <div className="mt-2 flex gap-2">
        <Input
          id={`tx-${packetHash}`}
          className="font-mono"
          value={transactionHash}
          onChange={(event) => setTransactionHash(event.target.value)}
          placeholder="0x…"
        />
        <Button onClick={run} disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)}>
          {busy ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}Reconcile
        </Button>
      </div>
    </div>
  );
}
