"use client";

import { formatTokenAmount } from "@conditional-stocks/domain";
import { FileSearch, LoaderCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "@/components/providers/AdminProvider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminRequest, type EvidenceView, fetchMarketMetadata } from "@/lib/admin-api";
import type { TokenCheck, TokenInfo } from "@/lib/chain";
import { dateTimeInputToUnixSeconds, unixSecondsToDateTimeInput } from "@/lib/date-time";
import { short } from "@/lib/format";
import {
  assertBatchPacket,
  type BatchPlan,
  type BatchResult,
  buildBatchPlans,
  defaultMarketCaps,
  loadBatchTokens,
  MAX_BATCH_MARKETS,
  type MarketCaps,
  type MarketSource,
  parseAssetRows,
  prepareMarketBatch,
  recoverBatchResults,
  resolveRows,
  type SharedMarketFields,
  tokenIdentity,
  type VerifiedTokens,
} from "@/lib/market-batch";
import { PacketCard } from "../ReviewPageModule/ReviewQueue";

const WAD = 10n ** 18n;
interface AssetInput {
  id: number;
  token: string;
}
interface AssetRow {
  token: string;
  caps: MarketCaps;
}
const label = (value: string) =>
  value.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const amount = (value: string, decimals: number) => {
  if (!/^[0-9]{1,39}$/.test(value)) return "Enter a raw integer";
  const result = formatTokenAmount(BigInt(value), decimals);
  return result.length > 55 ? "Check this precision carefully" : result;
};
const quantityField = (name: keyof MarketCaps) =>
  name === "baseStep" || name === "maxOrderQuantity";
const tickText = (tick: string, baseDecimals: number, quoteDecimals: number) => {
  if (!/^[0-9]{1,39}$/.test(tick)) return "Enter a raw integer";
  const perToken = (BigInt(tick) * 10n ** BigInt(baseDecimals)) / WAD;
  return `≈ ${formatTokenAmount(perToken, quoteDecimals)} quote per token. Quote raw per base raw unit × 10¹⁸; a price increment, not an initial price.`;
};
const tokenName = (token: TokenInfo) => token.symbol ?? short(token.address);

export function CreateMarketForm() {
  const admin = useAdmin();
  const [marketSlug, setMarketSlug] = useState("");
  const [source, setSource] = useState<MarketSource | null>(null);
  const [assets, setAssets] = useState<AssetInput[]>([{ id: 0, token: "" }]);
  const nextId = useRef(1);
  const [verified, setVerified] = useState<VerifiedTokens | null>(null);
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [timing, setTiming] = useState({
    tradingOpen: "",
    tradingCutoff: "",
  });
  const [shared, setShared] = useState<Omit<SharedMarketFields, keyof typeof timing>>({
    metadataUri: "",
    sourceUrls: "",
  });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState<BatchPlan[]>([]);
  const [results, setResults] = useState<BatchResult[]>([]);
  const lock = useRef(false);
  const started = plans.length > 0;
  const resolved = verified ? resolveRows(verified, rows) : null;
  const blocked = !resolved || resolved.problems.some((list) => list.length > 0);
  const updateResult = (index: number, result: BatchResult) =>
    setResults((current) => current.map((value, i) => (i === index ? result : value)));
  const resetVerification = () => {
    setVerified(null);
    setRows([]);
    setConfirmed(false);
  };
  const run = async (action: (check: () => void) => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await action(admin.captureContext());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Batch operation failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const fetchSource = () =>
    run(async (check) => {
      setSource(null);
      setConfirmed(false);
      const snapshot = await fetchMarketMetadata<MarketSource>(admin.token ?? "", marketSlug);
      check();
      const defaults = {
        tradingOpen: unixSecondsToDateTimeInput(String(Math.floor(Date.now() / 1000))),
        tradingCutoff: unixSecondsToDateTimeInput(
          String(Math.floor(new Date(snapshot.normalized.endTime).getTime() / 1000)),
        ),
      };
      setSource(snapshot);
      setTiming(defaults);
      setShared({
        metadataUri: snapshot.normalized.canonicalUrl,
        sourceUrls: snapshot.normalized.canonicalUrl,
      });
    });
  const verifyTokens = () =>
    run(async (check) => {
      resetVerification();
      const parsed = parseAssetRows(assets.map((asset) => asset.token));
      const info = await loadBatchTokens(parsed);
      check();
      setVerified(info);
      setRows(
        parsed.map((token) => {
          const checked = info.checks[token];
          return {
            token,
            caps: defaultMarketCaps(checked?.ok ? checked.token.decimals : 18, info.quote.decimals),
          };
        }),
      );
    });
  const recover = async (batch: BatchPlan[], prior: BatchResult[], check: () => void) => {
    const response = await adminRequest<{ packets: EvidenceView[] }>(
      admin.token ?? "",
      "admin/evidence",
    );
    check();
    if (!Array.isArray(response.packets) || response.packets.length >= 1000)
      throw new Error(
        "The evidence list is incomplete or too large. Use the review queue to reconcile this batch.",
      );
    return recoverBatchResults(batch, prior, response.packets);
  };
  const submit = async (batch: BatchPlan[], prior: BatchResult[], check: () => void) => {
    const recovered = await recover(batch, prior, check);
    setResults(recovered);
    await prepareMarketBatch(batch, recovered, {
      check,
      update: updateResult,
      prepare: (plan) =>
        adminRequest<EvidenceView>(admin.token ?? "", "admin/evidence/creation/prepare", {
          method: "POST",
          body: JSON.stringify(plan.body),
        }),
    });
  };
  const prepare = () =>
    run(async (check) => {
      if (!source || !verified || !admin.account || !confirmed || started) return;
      const sharedWithTiming = { ...shared, tradingOpen: "", tradingCutoff: "" };
      for (const name of ["tradingOpen", "tradingCutoff"] as const) {
        try {
          sharedWithTiming[name] = dateTimeInputToUnixSeconds(timing[name]);
        } catch (error) {
          throw new Error(
            `${label(name)}: ${error instanceof Error ? error.message : "Invalid date and time"}`,
          );
        }
      }
      const fresh = await loadBatchTokens(rows.map((row) => row.token));
      check();
      if (tokenIdentity(fresh) !== tokenIdentity(verified))
        throw new Error(
          "Protocol roles, the quote token or token precision changed. Reload the tokens and review again.",
        );
      const live = resolveRows(fresh, rows);
      const problem = live.problems.findIndex((list) => list.length > 0);
      if (problem !== -1) {
        setVerified(fresh);
        setConfirmed(false);
        throw new Error(`Market ${problem + 1}: ${live.problems[problem]![0]}`);
      }
      const batch = buildBatchPlans({
        rows: live.rows,
        quote: fresh.quote,
        source,
        shared: sharedWithTiming,
        deployment: fresh.deployment,
        owner: admin.account,
      });
      const pending: BatchResult[] = batch.map(() => ({ phase: "pending" }));
      setPlans(batch);
      setResults(pending);
      await submit(batch, pending, check);
    });
  const refreshPacket = (index: number, hash: string) =>
    run(async (check) => {
      const packet = await adminRequest<EvidenceView>(admin.token ?? "", "admin/evidence/" + hash);
      check();
      assertBatchPacket(plans[index]!, packet);
      updateResult(index, { phase: "prepared", packet });
    });
  const updateRow = (index: number, change: (row: AssetRow) => AssetRow) => {
    setRows((current) => current.map((row, i) => (i === index ? change(row) : row)));
    setConfirmed(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={busy || started} className="flex flex-col gap-5">
        <Card className="ring-0">
          <CardHeader>
            <CardTitle>1. Choose one Polymarket condition</CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="creation-market-slug">Polymarket market slug</Label>
            <div className="mt-2 flex gap-3">
              <Input
                id="creation-market-slug"
                aria-describedby="creation-slug-help"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={512}
                value={marketSlug}
                placeholder="clarity-act-signed-into-law-in-2026"
                onChange={(event) => {
                  setMarketSlug(event.target.value);
                  setSource(null);
                  setConfirmed(false);
                }}
              />
              <Button onClick={fetchSource} disabled={!marketSlug.trim()}>
                <FileSearch />
                Fetch and normalize
              </Button>
            </div>
            <p id="creation-slug-help" className="mt-2 text-xs text-muted-foreground">
              Paste the individual market slug, not a full URL. Fetch once and reuse its immutable
              metadata for every asset market below.
            </p>
            {source && (
              <div className="mt-4 rounded-xl bg-secondary p-4">
                <p className="font-semibold">{source.normalized.question}</p>
                <p className="mt-2 break-all font-mono text-xs">
                  Condition: {source.normalized.conditionId}
                </p>
                <p className="mt-2 text-xs">
                  Resolution source: {source.normalized.resolutionSource}
                </p>
                <p className="mt-2 text-xs">
                  {source.normalized.outcomes
                    .map((outcome) => `${outcome.label}: index set ${outcome.indexSet}`)
                    .join(" · ")}
                  {" · Source end: "}
                  {source.normalized.endTime}
                </p>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer font-medium">Inspect source rules</summary>
                  <p className="mt-2 whitespace-pre-wrap break-words">{source.normalized.rules}</p>
                </details>
              </div>
            )}
          </CardContent>
        </Card>
        {source && (
          <>
            <Card className="ring-0">
              <CardHeader>
                <CardTitle>2. Add asset markets and their stock tokens</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Each market is one order book for one stock token (for example NVDA) against the
                  shared quote. Add another market for another asset of this event (for example
                  TSLA). Maximum {MAX_BATCH_MARKETS} markets.
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {assets.map((asset, index) => (
                  <div key={asset.id} className="rounded-xl bg-secondary p-4">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={`asset-token-${asset.id}`}>
                        Market {index + 1} · stock token contract address
                      </Label>
                      {assets.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Remove market ${index + 1}`}
                          onClick={() => {
                            setAssets((current) => current.filter((item) => item.id !== asset.id));
                            resetVerification();
                          }}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                    <Input
                      id={`asset-token-${asset.id}`}
                      className="mt-2 font-mono"
                      spellCheck={false}
                      autoCapitalize="none"
                      placeholder="0x… stock token address"
                      value={asset.token}
                      onChange={(event) => {
                        const value = event.target.value;
                        setAssets((current) =>
                          current.map((item) =>
                            item.id === asset.id ? { ...item, token: value } : item,
                          ),
                        );
                        resetVerification();
                      }}
                    />
                  </div>
                ))}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={assets.length >= MAX_BATCH_MARKETS}
                    onClick={() => {
                      setAssets((current) => [...current, { id: nextId.current++, token: "" }]);
                      resetVerification();
                    }}
                  >
                    <Plus />
                    Add another asset market
                  </Button>
                  <Button
                    onClick={verifyTokens}
                    disabled={assets.some((asset) => !asset.token.trim())}
                  >
                    Load and verify tokens
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use the stock token's contract address, not a symbol or wallet address. Each token
                  is read on chain: its decimals, symbol, the issuer's UI multiplier and pause
                  state. Paused tokens are rejected. A token without a custody pool is listed as
                  part of its creation transaction.
                </p>
                {verified && (
                  <div className="rounded-xl bg-secondary p-4">
                    <Label htmlFor="batch-quote">
                      Shared quote token · fixed by the deployed exchange
                    </Label>
                    <Input
                      id="batch-quote"
                      className="mt-2 font-mono"
                      readOnly
                      value={verified.quote.address}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {verified.quote.symbol ? `${verified.quote.symbol} · ` : ""}
                      {verified.quote.decimals} decimals. This deployment uses one quote token.
                      Other quote tokens cannot be enabled by an admin-UI change.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            {verified && rows.length > 0 && resolved && (
              <Card className="ring-0">
                <CardHeader>
                  <CardTitle>3. Review stock tokens, caps and shared timing</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {rows.length} {rows.length === 1 ? "market" : "separate markets"} will share
                    this Polymarket condition. Quantities (step, maximum quantity) are raw units of
                    each stock token; notional caps are quote raw units. Review every market.
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(["tradingOpen", "tradingCutoff"] as const).map((name) => (
                      <div key={name}>
                        <Label htmlFor={name}>{label(name)} · UTC</Label>
                        <Input
                          id={name}
                          type="datetime-local"
                          step={1}
                          min="1970-01-01T00:00:00"
                          max="9999-12-31T23:59:59"
                          required
                          aria-describedby="market-timing-help"
                          className="mt-2 font-mono"
                          value={timing[name]}
                          onChange={(event) => {
                            setTiming((current) => ({ ...current, [name]: event.target.value }));
                            setConfirmed(false);
                          }}
                        />
                      </div>
                    ))}
                    <p
                      id="market-timing-help"
                      className="text-xs text-muted-foreground sm:col-span-2"
                    >
                      Enter both times in UTC, not your local timezone. Opening defaults to now;
                      cutoff defaults to Polymarket's scheduled end. Seconds are preserved and
                      converted to Unix timestamps automatically when preparing the markets.
                    </p>
                    <div className="sm:col-span-2">
                      <Label htmlFor="metadataUri">Metadata URI</Label>
                      <Input
                        id="metadataUri"
                        className="mt-2 font-mono"
                        value={shared.metadataUri}
                        onChange={(event) => {
                          setShared((current) => ({ ...current, metadataUri: event.target.value }));
                          setConfirmed(false);
                        }}
                      />
                    </div>
                  </div>
                  {rows.map((row, index) => (
                    <AssetMarketReview
                      key={row.token}
                      index={index}
                      row={row}
                      check={
                        verified.checks[row.token] ?? {
                          ok: false,
                          address: row.token,
                          error: "Token not verified",
                        }
                      }
                      listed={verified.listed[row.token] === true}
                      quote={verified.quote}
                      problems={resolved.problems[index] ?? []}
                      onChange={(change) => updateRow(index, change)}
                    />
                  ))}
                  <div>
                    <Label htmlFor="sourceUrls">Evidence source URLs · one per line</Label>
                    <Textarea
                      id="sourceUrls"
                      className="mt-2"
                      value={shared.sourceUrls}
                      onChange={(event) => {
                        setShared((current) => ({ ...current, sourceUrls: event.target.value }));
                        setConfirmed(false);
                      }}
                    />
                  </div>
                  <label
                    htmlFor="immutable-field-confirmation"
                    className="flex items-start gap-3 rounded-xl bg-secondary p-4"
                  >
                    <Checkbox
                      id="immutable-field-confirmation"
                      className="mt-1"
                      checked={confirmed}
                      disabled={blocked}
                      onCheckedChange={setConfirmed}
                    />
                    <span className="text-sm leading-6">
                      <strong className="block">
                        Immutable-field confirmation for all {rows.length}{" "}
                        {rows.length === 1 ? "market" : "markets"}
                      </strong>
                      I checked every stock token (the right asset, decimals, multiplier), the quote
                      token, YES/NO orientation, rules, timing, step, tick and caps. Preparing
                      evidence does not approve or sign transactions.
                    </span>
                  </label>
                  <Button
                    className="w-full"
                    size="lg"
                    variant="default"
                    onClick={prepare}
                    disabled={!confirmed || blocked}
                  >
                    {busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}Prepare{" "}
                    {rows.length} market {rows.length === 1 ? "packet" : "packets"}
                  </Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </fieldset>
      {started && verified && (
        <>
          <Alert>
            <AlertTitle>4. Review, create and open each market</AlertTitle>
            <AlertDescription>
              {results.filter((result) => result.phase === "prepared").length} of {plans.length}{" "}
              evidence packets ready. Each asset market has its own on-chain order book, caps and
              settlement. Approval and wallet signatures remain explicit below. This is a sequence
              of independent operations, not one atomic transaction.
              <span className="mt-2 block">
                Creating a market first lists its stock token's custody pool when needed. Once
                trading opens, open the market in{" "}
                <Link className="underline" href="/markets">
                  Market controls
                </Link>
                . Prepared packets also remain available in the{" "}
                <Link className="underline" href="/review">
                  review queue
                </Link>{" "}
                after navigation or reload.
              </span>
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => run(async (check) => setResults(await recover(plans, results, check)))}
            >
              Recover saved packets
            </Button>
            {results.some((result) => result.phase === "pending") && (
              <Button disabled={busy} onClick={() => run((check) => submit(plans, results, check))}>
                Prepare remaining unattempted markets
              </Button>
            )}
          </div>
          {plans.map((plan, index) => {
            const result = results[index];
            return (
              <section
                key={plan.base.address}
                className="flex flex-col gap-3 rounded-xl bg-secondary p-4"
              >
                <h3 className="font-semibold">
                  Market {index + 1}: {tokenName(plan.base)} / {tokenName(plan.quote)}
                </h3>
                <p className="break-all font-mono text-xs">Stock token: {plan.base.address}</p>
                <p className="text-xs">
                  The market id is assigned when the creation transaction confirms.
                </p>
                <p role="status" className="text-sm">
                  {result?.phase}
                </p>
                {result?.phase === "uncertain" && (
                  <Alert variant="destructive">
                    <AlertTitle>Outcome needs checking</AlertTitle>
                    <AlertDescription>
                      {result.message} This request will not be retried automatically. Recover saved
                      packets or inspect the review queue before starting another batch.
                    </AlertDescription>
                  </Alert>
                )}
                {result?.phase === "prepared" && (
                  <fieldset disabled={busy} className="flex flex-col gap-3">
                    <PacketCard
                      packet={result.packet}
                      onDone={() => {
                        void refreshPacket(index, result.packet.envelope.packetHash);
                      }}
                    />
                  </fieldset>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function AssetMarketReview({
  index,
  row,
  check,
  listed,
  quote,
  problems,
  onChange,
}: {
  index: number;
  row: AssetRow;
  check: TokenCheck;
  listed: boolean;
  quote: TokenInfo;
  problems: string[];
  onChange: (change: (row: AssetRow) => AssetRow) => void;
}) {
  const decimals = check.ok ? check.token.decimals : null;
  return (
    <div className="rounded-xl bg-secondary p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          Market {index + 1}: {check.ok ? tokenName(check.token) : "unverified"} /{" "}
          {tokenName(quote)}
        </h3>
        <Badge variant={problems.length ? "destructive" : "positive"}>
          {problems.length ? `${problems.length} to fix` : "Ready"}
        </Badge>
      </div>
      <div className="mt-3 rounded-lg bg-background/60 p-3 text-xs leading-5">
        {check.ok ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">
                {check.token.symbol ?? "No symbol"}
                {check.token.name ? ` · ${check.token.name}` : ""}
              </p>
              <Badge variant="outline">{check.token.decimals} decimals</Badge>
              {check.token.paused && <Badge variant="destructive">paused</Badge>}
            </div>
            <p className="mt-1 break-all font-mono">{check.token.address}</p>
            <p className="mt-1">
              Issuer multiplier {check.token.multiplierValue} · custody pool{" "}
              {listed ? "listed" : "listed by the creation transaction"}
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold">Not listable</p>
            <p className="break-all font-mono">{check.address}</p>
            <p className="text-destructive">{check.error}</p>
          </>
        )}
      </div>
      {problems.length > 0 && (
        <Alert variant="destructive" className="mt-3">
          <AlertTitle>Fix before preparing</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {(Object.keys(row.caps) as (keyof MarketCaps)[]).map((name) => (
          <div key={name}>
            <Label htmlFor={`market-${index}-${name}`}>{label(name)}</Label>
            <Input
              id={`market-${index}-${name}`}
              className="mt-2 font-mono"
              value={row.caps[name]}
              onChange={(event) => {
                const value = event.target.value;
                onChange((current) => ({ ...current, caps: { ...current.caps, [name]: value } }));
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {decimals === null
                ? "Verify the token first"
                : name === "priceTickRawX18"
                  ? tickText(row.caps[name], decimals, quote.decimals)
                  : quantityField(name)
                    ? `${amount(row.caps[name], decimals)} tokens`
                    : `${amount(row.caps[name], quote.decimals)} quote units`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
