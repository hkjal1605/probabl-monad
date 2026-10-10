"use client";
import { TESTNET_CHAIN_IDS } from "@conditional-stocks/shared/chains";
import { useEffect, useState } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { protocolConfig } from "@/config/protocol";
import { reviewWithSession } from "@/lib/trading/review-session";
import { ApiError, requestJson } from "@/services/api";
import { refreshStores } from "@/stores/createResourceStore";

const CLAIMED_KEY = "probabl:faucet-claimed";
const claimedLocally = (owner: string) => {
  try {
    return (JSON.parse(window.localStorage.getItem(CLAIMED_KEY) ?? "[]") as string[]).includes(
      owner,
    );
  } catch {
    return false;
  }
};
const rememberClaim = (owner: string) => {
  try {
    const owners = JSON.parse(window.localStorage.getItem(CLAIMED_KEY) ?? "[]") as string[];
    window.localStorage.setItem(CLAIMED_KEY, JSON.stringify([...new Set([...owners, owner])]));
  } catch {
    // Storage is a convenience; the API remains the source of truth.
  }
};

interface ClaimResult {
  sent: { symbol: string; amount: string }[];
  unavailable: string[];
}

/** Testnets only: one-click claim of test assets (and gas) from the server's faucet wallet. */
export function DevnetFaucetBanner() {
  const wallet = useWallet();
  const owner = wallet.account;
  const member = wallet.member !== null;
  const [available, setAvailable] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const devnet = TESTNET_CHAIN_IDS.includes(protocolConfig.chainId);

  useEffect(() => {
    if (!devnet) return;
    const controller = new AbortController();
    // Whether a wallet claimed is its member's to read; availability is public.
    const reader = owner && member ? owner : null;
    const query = reader ? `?owner=${encodeURIComponent(reader)}` : "";
    if (owner && claimedLocally(owner)) setClaimed(owner);
    requestJson<{ available: boolean; claimed: boolean }>(`/v1/faucet/status${query}`, {
      signal: controller.signal,
      ...(reader ? { auth: true as const } : {}),
    })
      .then((status) => {
        setAvailable(status.available);
        if (owner && status.claimed) {
          rememberClaim(owner);
          setClaimed(owner);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [devnet, owner, member]);

  if (!devnet || !available || (owner && claimed === owner)) return null;

  const claim = async () => {
    if (claiming) return;
    if (!owner) {
      toast.add({
        type: "error",
        title: "Please login first to claim testnet assets",
      });
      return;
    }
    setClaiming(true);
    try {
      const result = await reviewWithSession<ClaimResult>({
        session: wallet.sessionId,
        request: (auth) =>
          requestJson<ClaimResult>("/v1/faucet/claim", { body: {}, timeoutMs: 120_000, auth }),
        authenticate: () => wallet.authenticate(),
        assertCurrent: () => undefined,
      });
      rememberClaim(owner);
      setClaimed(owner);
      toast.add({
        type: "success",
        title: "Testnet assets transferred to your wallet",
        description: `Received ${result.sent.map((asset) => asset.symbol).join(", ")}.${
          result.unavailable.length
            ? ` ${result.unavailable.join(", ")} ran out and were skipped.`
            : ""
        } Use Deposit to start trading.`,
      });
      void refreshStores(["positions"]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        rememberClaim(owner);
        setClaimed(owner);
      }
      toast.add({
        type: "error",
        title: error instanceof Error ? error.message : "Claiming testnet assets failed",
      });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div
      role="note"
      className="flex items-center justify-center gap-1 bg-primary/10 px-5 py-1.5 text-center text-sm text-primary"
    >
      <span>Deployed on {protocolConfig.chainName}.</span>
      <Button
        variant="link"
        size="sm"
        onClick={() => void claim()}
        disabled={claiming}
        aria-busy={claiming}
        className="h-auto px-0 font-medium text-primary underline underline-offset-2 disabled:opacity-80"
      >
        {claiming ? (
          <>
            <Spinner className="size-3.5" />
            Transferring testnet assets to your wallet…
          </>
        ) : (
          "Claim testnet assets to test"
        )}
      </Button>
    </div>
  );
}
