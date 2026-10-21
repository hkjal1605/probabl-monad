"use client";
import dynamic from "next/dynamic";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { protocolConfig } from "@/config/protocol";
import {
  type OnboardingProgress,
  type OnboardingStep,
  onboardingStep,
  readOnboarding,
  TESTNETS,
  writeOnboarding,
} from "@/lib/onboarding";
import { reviewWithSession } from "@/lib/trading/review-session";
import { browserStorage } from "@/lib/wallet/session";
import { ApiError } from "@/services/api";
import {
  claimFaucet,
  type FaucetClaim,
  type FaucetStatus,
  faucetStatus,
  knownWallet,
} from "@/services/faucet";
import { refreshStores } from "@/stores/createResourceStore";

// Loaded when a wallet first needs it, so the guide's art and steps stay out of every page.
const OnboardingDialog = dynamic(
  () => import("./OnboardingDialog").then((m) => m.OnboardingDialog),
  { ssr: false },
);

export interface OnboardingValue {
  /** The guide runs on this deployment (testnets). */
  enabled: boolean;
  /** The connected wallet's next step, or null without a wallet (or before its network is
   * known). Only on testnets. */
  step: OnboardingStep | null;
  /** What the faucet gives (and whether this wallet claimed), once read. */
  faucet: FaucetStatus | null;
  /** This visit's claim, for its receipt. */
  claim: FaucetClaim | null;
  claiming: boolean;
  claimError: string | null;
  claimTokens(): Promise<void>;
  open: boolean;
  /** Opens the guide at the wallet's current step. */
  show(): void;
  /** Closes it until the wallet resumes it. */
  dismiss(): void;
  /** Closes it for good: the wallet is set up. */
  finish(): void;
}
const Context = createContext<OnboardingValue | null>(null);

const SCOPE = `${protocolConfig.chainId}:${protocolConfig.exchange.toLowerCase()}`;
const ENABLED = TESTNETS.includes(protocolConfig.chainId);
// Kept by the earlier faucet banner too, so a wallet that claimed never sees the step flash.
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
const NO_CLAIM: FaucetClaim = { sent: [], unavailable: [], transactions: [] };

/** The first-run guide of a testnet: a wallet the API has never seen (not a member) is walked
 * through switching to the deployment's network, signing in (and joining with an invite), and
 * receiving test tokens. Each step is read from live state (the wallet's network, its session,
 * the faucet), so the guide always opens where the wallet is. */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const owner = ENABLED ? wallet.account : null;
  const joined = wallet.access === "member" || wallet.access === "suspended";
  const [known, setKnown] = useState<{ owner: string; known: boolean } | null>(null);
  const [progress, setProgress] = useState<{
    owner: string;
    value: OnboardingProgress | null;
  } | null>(null);
  const [manual, setManual] = useState(false);
  const [faucet, setFaucet] = useState<{ key: string; status: FaucetStatus } | null>(null);
  const [claim, setClaim] = useState<{ owner: string; result: FaucetClaim } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // This browser's progress for the wallet; a new wallet starts closed and clean.
  useEffect(() => {
    setManual(false);
    setClaimError(null);
    if (owner) setProgress({ owner, value: readOnboarding(browserStorage(), SCOPE, owner) });
  }, [owner]);

  // Is the wallet new? A member's session already says it is not.
  useEffect(() => {
    if (!owner || wallet.restoring || known?.owner === owner) return;
    if (joined) {
      setKnown({ owner, known: true });
      return;
    }
    const controller = new AbortController();
    knownWallet(owner, controller.signal).then(
      (value) => setKnown({ owner, known: value }),
      () => undefined,
    );
    return () => controller.abort();
  }, [owner, wallet.restoring, joined, known?.owner]);

  const stored = progress?.owner === owner ? progress.value : undefined;
  // A wallet that has never joined starts the guide, which then stays until it is finished or
  // dismissed (also across reloads and once the wallet has joined).
  useEffect(() => {
    if (owner && known?.owner === owner && !known.known && stored === null) {
      writeOnboarding(browserStorage(), SCOPE, owner, "active");
      setProgress({ owner, value: "active" });
    }
  }, [owner, known, stored]);

  // What the faucet gives; a member also reads whether it already claimed.
  const reader = owner && joined ? owner : null;
  const statusKey = `${owner ?? ""}:${reader ?? ""}`;
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    faucetStatus(reader, controller.signal).then(
      (status) => setFaucet({ key: statusKey, status }),
      () => undefined,
    );
    return () => controller.abort();
  }, [owner, reader, statusKey]);
  const status = faucet?.key === statusKey ? faucet.status : null;

  const claimed = claim?.owner === owner ? claim.result : null;
  const funded =
    Boolean(owner && claimedLocally(owner)) ||
    claimed !== null ||
    status?.claimed === true ||
    status?.available === false;
  const step: OnboardingStep | null =
    owner && wallet.chainId !== null
      ? onboardingStep({
          onNetwork: wallet.chainId === protocolConfig.chainId,
          access: wallet.access,
          funded,
        })
      : null;
  const open = Boolean(owner) && step !== null && (manual || stored === "active");
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  const save = useCallback(
    (value: OnboardingProgress) => {
      if (!owner) return;
      writeOnboarding(browserStorage(), SCOPE, owner, value);
      setProgress({ owner, value });
    },
    [owner],
  );
  const show = useCallback(() => {
    save("active");
    setManual(true);
  }, [save]);
  const dismiss = useCallback(() => {
    setManual(false);
    if (stored !== "done") save("dismissed");
  }, [save, stored]);
  const finish = useCallback(() => {
    setManual(false);
    save("done");
  }, [save]);

  const { sessionId, authenticate } = wallet;
  const claimTokens = useCallback(async () => {
    if (!owner || claiming) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const result = await reviewWithSession({
        session: sessionId,
        request: claimFaucet,
        authenticate,
        assertCurrent: () => undefined,
      });
      rememberClaim(owner);
      setClaim({ owner, result });
      void refreshStores(["positions"]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        rememberClaim(owner);
        setClaim({ owner, result: NO_CLAIM });
      } else setClaimError(error instanceof Error ? error.message : "Sending test tokens failed");
    } finally {
      setClaiming(false);
    }
  }, [owner, claiming, sessionId, authenticate]);

  const value = useMemo<OnboardingValue>(
    () => ({
      enabled: ENABLED,
      step,
      faucet: status,
      claim: claimed,
      claiming,
      claimError,
      claimTokens,
      open,
      show,
      dismiss,
      finish,
    }),
    [step, status, claimed, claiming, claimError, claimTokens, open, show, dismiss, finish],
  );
  return (
    <Context.Provider value={value}>
      {children}
      {mounted && <OnboardingDialog />}
    </Context.Provider>
  );
}

export function useOnboarding() {
  const value = useContext(Context);
  if (!value) throw new Error("OnboardingProvider is required");
  return value;
}
