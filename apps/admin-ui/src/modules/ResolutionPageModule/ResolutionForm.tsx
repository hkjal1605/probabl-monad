"use client";

import { Alert, AlertDescription, AlertTitle } from "@conditional-stocks/ui-kit/alert";
import { Badge } from "@conditional-stocks/ui-kit/badge";
import { Button } from "@conditional-stocks/ui-kit/button";
import { Card, CardContent, CardHeader, CardTitle } from "@conditional-stocks/ui-kit/card";
import { Input } from "@conditional-stocks/ui-kit/input";
import { Label } from "@conditional-stocks/ui-kit/label";
import { Tabs, TabsList, TabsTrigger } from "@conditional-stocks/ui-kit/tabs";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, FileSearch, Gavel, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "@/components/providers/AdminProvider";
import { adminConfig } from "@/config/protocol";
import { adminRequest, type EvidenceView } from "@/lib/admin-api";
import { short } from "@/lib/format";

interface Market {
  id: string;
  state: number;
  polymarketConditionId: string;
}
interface Snapshot {
  normalized: {
    canonicalUrl: string;
    conditionId: string;
    question: string;
    resolutionStatus: string | null;
  };
  rawHash: string;
  snapshotId: string;
}
export function ResolutionForm() {
  const admin = useAdmin();
  const marketsQuery = useQuery({
    queryKey: ["markets"],
    queryFn: async () => {
      const response = await fetch("/api/indexer/markets", { cache: "no-store" });
      if (!response.ok) throw new Error("Indexer unavailable");
      return response.json() as Promise<{ markets: Market[] }>;
    },
  });
  const markets = (marketsQuery.data?.markets ?? []).filter(
    (market) => market.state === 3 || market.state === 4,
  );
  const [marketId, setMarketId] = useState("");
  const [gammaMarketId, setGammaMarketId] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [outcome, setOutcome] = useState<"yes" | "no" | "invalid">("yes");
  const [officialUrl, setOfficialUrl] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [polygonTx, setPolygonTx] = useState("");
  const [polygonBlock, setPolygonBlock] = useState("");
  const [polygonBlockHash, setPolygonBlockHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [packet, setPacket] = useState<EvidenceView | null>(null);
  const fetchMetadata = async () => {
    setBusy(true);
    try {
      const value = await adminRequest<Snapshot>(
        admin.token ?? "",
        "admin/polymarket/metadata/fetch",
        { body: JSON.stringify({ gammaMarketId }), method: "POST" },
      );
      setSnapshot(value);
      setOfficialUrl(value.normalized.canonicalUrl);
      setSourceReference(value.normalized.canonicalUrl);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Source fetch failed");
    } finally {
      setBusy(false);
    }
  };
  const prepare = async () => {
    if (!snapshot || !marketId) return;
    const payout =
      outcome === "yes"
        ? { denominator: "1", no: "0", yes: "1" }
        : outcome === "no"
          ? { denominator: "1", no: "1", yes: "0" }
          : { denominator: "2", no: "1", yes: "1" };
    setBusy(true);
    try {
      const value = await adminRequest<EvidenceView>(
        admin.token ?? "",
        "admin/evidence/resolution/prepare",
        {
          body: JSON.stringify({
            attachments: [],
            marketId,
            metadataSnapshotId: snapshot.snapshotId,
            officialStatus: snapshot.normalized.resolutionStatus ?? "resolved",
            officialUrl,
            payout,
            polygon: {
              blockHash: polygonBlockHash || null,
              blockNumber: polygonBlock || null,
              chainId: "137",
              conditionalTokensAddress: adminConfig.conditionalTokens,
              transactionHash: polygonTx || null,
            },
            sourceObservations: [
              {
                observedAt: new Date().toISOString(),
                payout,
                status: snapshot.normalized.resolutionStatus ?? "resolved",
                url: officialUrl,
              },
            ],
            sourceReference,
          }),
          method: "POST",
        },
      );
      setPacket(value);
      toast.success("Resolution evidence packet prepared");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Resolution packet failed");
    } finally {
      setBusy(false);
    }
  };
  if (packet)
    return (
      <Alert>
        <CheckCircle2 />
        <AlertTitle>Resolution packet queued for independent review</AlertTitle>
        <AlertDescription>
          <span className="block break-all font-mono text-xs">{packet.envelope.packetHash}</span>
          <span className="mt-2 block">
            The review queue will enforce a different reviewer before begin-resolution or
            resolve-market calldata can be simulated.
          </span>
        </AlertDescription>
      </Alert>
    );
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <CardTitle>1. Select the local market</CardTitle>
        </CardHeader>
        <CardContent>
          <Label htmlFor="resolution-market">Frozen or awaiting-resolution market</Label>
          <select
            id="resolution-market"
            className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm"
            value={marketId}
            onChange={(event) => setMarketId(event.target.value)}
          >
            <option value="">Select canonical market</option>
            {markets.map((market) => (
              <option value={market.id} key={market.id}>
                {short(market.id, 8)} · {market.state === 3 ? "frozen" : "awaiting resolution"}
              </option>
            ))}
          </select>
          {markets.length === 0 && (
            <p className="mt-3 text-xs text-warning">No eligible market is currently indexed.</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>2. Capture final Polymarket evidence</CardTitle>
            <Badge variant="warning">Informational source</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              value={gammaMarketId}
              onChange={(event) => setGammaMarketId(event.target.value)}
              placeholder="Gamma market ID"
            />
            <Button onClick={fetchMetadata} disabled={busy || !gammaMarketId}>
              {busy ? <LoaderCircle className="animate-spin" /> : <FileSearch />}Fetch snapshot
            </Button>
          </div>
          {snapshot && (
            <div className="mt-4 rounded-xl bg-muted/45 p-4">
              <p className="font-semibold">{snapshot.normalized.question}</p>
              <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                {snapshot.normalized.conditionId}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      {snapshot && (
        <Card>
          <CardHeader>
            <CardTitle>3. Declare and cross-reference the payout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Local payout vector</Label>
              <Tabs value={outcome} onValueChange={(value) => setOutcome(value as typeof outcome)}>
                <TabsList className="mt-2 grid w-full grid-cols-3">
                  <TabsTrigger value="yes">YES · 1/0</TabsTrigger>
                  <TabsTrigger value="no">NO · 0/1</TabsTrigger>
                  <TabsTrigger value="invalid">Invalid · ½/½</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Field
              id="official-url"
              label="Official Polymarket URL"
              value={officialUrl}
              setValue={setOfficialUrl}
            />
            <Field
              id="source-reference"
              label="Published evidence packet URI"
              value={sourceReference}
              setValue={setSourceReference}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                id="polygon-tx"
                label="Polygon resolution tx"
                value={polygonTx}
                setValue={setPolygonTx}
                optional
              />
              <Field
                id="polygon-block"
                label="Polygon block number"
                value={polygonBlock}
                setValue={setPolygonBlock}
                optional
              />
              <Field
                id="polygon-hash"
                label="Polygon block hash"
                value={polygonBlockHash}
                setValue={setPolygonBlockHash}
                optional
              />
            </div>
            <Alert variant="warning">
              <Gavel />
              <AlertTitle>This does not resolve the market</AlertTitle>
              <AlertDescription>
                It creates an immutable evidence packet. A different operator reviews it, Safe
                executes the approved payload, and reconciliation verifies the indexed transaction.
              </AlertDescription>
            </Alert>
            <Button
              className="w-full"
              size="lg"
              variant="brand"
              onClick={prepare}
              disabled={
                busy ||
                !marketId ||
                !officialUrl ||
                !sourceReference ||
                !adminConfig.conditionalTokens
              }
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <Gavel />}Prepare manual
              resolution packet
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
function Field({
  id,
  label,
  optional,
  setValue,
  value,
}: {
  id: string;
  label: string;
  optional?: boolean;
  setValue: (value: string) => void;
  value: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>
        {label}
        {optional ? " · optional" : ""}
      </Label>
      <Input
        id={id}
        className="mt-2 font-mono"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </div>
  );
}
