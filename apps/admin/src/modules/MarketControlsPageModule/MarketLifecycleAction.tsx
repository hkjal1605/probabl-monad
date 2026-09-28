"use client";
import { lifecycleTransaction } from "@conditional-stocks/evm-client/admin";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "@/components/providers/AdminProvider";
import { Button } from "@/components/ui/button";
import { adminConfig } from "@/config/protocol";

export function MarketLifecycleAction({
  marketId,
  action,
  reason,
  authority,
}: {
  marketId: string;
  action: "openMarket" | "freezeAtCutoff" | "freezeMarket";
  reason?: string;
  /** The role account the exchange requires (anyone may freeze at cutoff). */
  authority: string;
}) {
  const admin = useAdmin(),
    cache = useQueryClient();
  const [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [hash, setHash] = useState<string | null>(null);
  const lock = useRef(false);
  const code = action === "openMarket" ? 0 : action === "freezeMarket" ? 1 : 2;
  const from = action === "freezeAtCutoff" ? (admin.account ?? authority) : authority;
  const transaction = lifecycleTransaction(
    adminConfig,
    from as `0x${string}`,
    Number(marketId),
    code,
    reason,
  );
  const label =
    action === "openMarket"
      ? "Open market"
      : action === "freezeAtCutoff"
        ? "Freeze at cutoff"
        : "Emergency freeze";
  const execute = async () => {
    if (lock.current || hash) return;
    lock.current = true;
    setBusy(true);
    try {
      const submitted = await admin.sendTransaction(transaction);
      setHash(submitted);
      await cache.invalidateQueries({ queryKey: ["markets"] });
      toast.success("Confirmed. Market state updates after indexing.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Lifecycle transaction failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 flex flex-col gap-3">
      {reviewed && (
        <div className="rounded-lg bg-secondary p-3 text-xs leading-6">
          <p>
            {label} on {adminConfig.chainName}. Network gas applies. The exchange checks timing and
            the signer's role; the call is simulated before the wallet request.
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
      <Button
        variant="outline"
        disabled={
          busy ||
          admin.signing ||
          Boolean(hash) ||
          (action !== "freezeAtCutoff" && admin.account !== authority)
        }
        onClick={() => (reviewed ? execute() : setReviewed(true))}
      >
        {busy ? "Waiting for wallet / chain…" : `${reviewed ? "Sign" : "Review"} · ${label}`}
      </Button>
      {hash && (
        <p role="status" className="break-all font-mono text-xs">
          Confirmed: {hash}
        </p>
      )}
    </div>
  );
}
