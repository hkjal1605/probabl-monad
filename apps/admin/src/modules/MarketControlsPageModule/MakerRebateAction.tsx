"use client";
import { formatBps, isRebateRate, MAX_REBATE_BPS } from "@conditional-stocks/evm-client";
import { makerRebateTransaction } from "@conditional-stocks/evm-client/admin";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "@/components/providers/AdminProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminConfig } from "@/config/protocol";

/** What the filled maker gets back, as a share of what the taker receives: the taker rate times
 * the rebate (30 bps at 25% is 0.075%). */
export const rebatePerFill = (takerFeeBps: number, rebateBps: number) =>
  formatBps((takerFeeBps * rebateBps) / 10_000);

/** Sets a market's maker rebate: the share of each fill's taker fee, in bps of that fee, paid to
 * the filled maker. Only the market admin signs it; it applies from the next fill. */
export function MakerRebateAction({
  marketId,
  takerFeeBps,
  rebateBps,
  marketAdmin,
}: {
  marketId: string;
  takerFeeBps: number;
  rebateBps: number;
  marketAdmin: string;
}) {
  const admin = useAdmin(),
    cache = useQueryClient();
  const [value, setValue] = useState(String(rebateBps)),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [hash, setHash] = useState<string | null>(null);
  const lock = useRef(false);
  const next = value.trim() === "" ? Number.NaN : Number(value);
  const valid = isRebateRate(next);
  const transaction =
    valid && next !== rebateBps
      ? makerRebateTransaction(adminConfig, marketAdmin as `0x${string}`, Number(marketId), next)
      : null;
  const execute = async () => {
    if (!transaction || lock.current || hash) return;
    lock.current = true;
    setBusy(true);
    try {
      const submitted = await admin.sendTransaction(transaction);
      setHash(submitted);
      await cache.invalidateQueries({ queryKey: ["markets"] });
      toast.success("Confirmed. The maker rebate updates after indexing.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Maker rebate transaction failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const id = `maker-rebate-${marketId}`;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Label htmlFor={id}>Maker rebate · bps of the taker fee</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          className="w-32 font-mono"
          inputMode="numeric"
          value={value}
          aria-invalid={!valid}
          onChange={(event) => {
            setValue(event.target.value);
            setReviewed(false);
            setHash(null);
          }}
        />
        <Button
          variant="outline"
          disabled={
            !transaction || busy || admin.signing || Boolean(hash) || admin.account !== marketAdmin
          }
          onClick={() => (reviewed ? execute() : setReviewed(true))}
        >
          {busy
            ? "Waiting for wallet / chain…"
            : `${reviewed ? "Sign" : "Review"} · Set maker rebate`}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {!valid
          ? `Enter whole bps from 0 to ${MAX_REBATE_BPS.toLocaleString("en-US")} (50% of the taker fee).`
          : takerFeeBps === 0
            ? "This market charges no taker fee, so a rebate pays nothing."
            : `${formatBps(next)} of each taker fee goes to the filled maker: ${rebatePerFill(takerFeeBps, next)} of what the taker receives, in the same claims.`}
      </p>
      {reviewed && transaction && (
        <div className="rounded-lg bg-secondary p-3 text-xs leading-6">
          <p>
            Set the maker rebate on {adminConfig.chainName} from {formatBps(rebateBps)} to{" "}
            {formatBps(next)} of the taker fee. It applies from the next fill; network gas applies,
            and the call is simulated before the wallet request.
          </p>
          <p className="break-all font-mono">Exchange: {transaction.to}</p>
          <p className="break-all font-mono">Market: {marketId}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigator.clipboard
                .writeText(
                  JSON.stringify(
                    { to: transaction.to, data: transaction.data, value: "0" },
                    null,
                    2,
                  ),
                )
                .then(() => toast.success("Transaction payload copied"))
                .catch(() => toast.error("Clipboard unavailable"))
            }
          >
            Copy transaction
          </Button>
        </div>
      )}
      {hash && (
        <p role="status" className="break-all font-mono text-xs">
          Confirmed: {hash}
        </p>
      )}
    </div>
  );
}
