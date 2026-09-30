"use client";
import type { Envelope } from "@conditional-stocks/evm-client";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "@/components/providers/AdminProvider";
import { Button } from "@/components/ui/button";
import { adminConfig } from "@/config/protocol";
import { vaultTransaction } from "@/lib/delta-vaults";

/** Review, then sign, one vault call from the connected wallet. `build` validates the form and
 * throws a readable error; the call is simulated from the wallet before the wallet prompt. */
export function VaultAction({
  label,
  requires,
  allowed,
  build,
  variant = "outline",
}: {
  label: string;
  /** The vault role the contract requires, for the disabled hint. */
  requires: string;
  allowed: boolean;
  build: () => Envelope;
  variant?: "outline" | "destructive" | "default";
}) {
  const admin = useAdmin(),
    cache = useQueryClient();
  const [reviewed, setReviewed] = useState<Envelope | null>(null),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const review = () => {
    try {
      setReviewed(build());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid values");
    }
  };
  const execute = async () => {
    if (lock.current || !reviewed || !admin.account) return;
    lock.current = true;
    setBusy(true);
    try {
      await admin.sendTransaction(vaultTransaction(reviewed, admin.account));
      setReviewed(null);
      await cache.invalidateQueries({ queryKey: ["delta-vaults"] });
      toast.success(`${label}: confirmed.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      {reviewed && (
        <div className="rounded-lg bg-secondary p-3 text-xs leading-6">
          <p>
            {label} on {adminConfig.chainName}. The vault checks the signer's {requires} role; the
            call is simulated before the wallet request.
          </p>
          <p className="break-all font-mono">Vault: {reviewed.to}</p>
          <p className="break-all font-mono">Data: {reviewed.data}</p>
        </div>
      )}
      <Button
        variant={variant}
        size="sm"
        disabled={busy || admin.signing || !allowed}
        title={allowed ? undefined : `Requires the vault's ${requires} role`}
        onClick={() => (reviewed ? execute() : review())}
      >
        {busy ? "Waiting for wallet / chain…" : `${reviewed ? "Sign" : "Review"} · ${label}`}
      </Button>
    </div>
  );
}
