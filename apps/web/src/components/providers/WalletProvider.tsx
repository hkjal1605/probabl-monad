"use client";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { protocolConfig } from "@/config/protocol";
import { waitForReceipt } from "@/lib/trading/rpc";
import { createWalletController, type WalletState } from "@/lib/wallet/controller";
import { discoverWallets, walletSources } from "@/lib/wallet/injected";
import { captureInvite, forgetInvite, pendingInvite } from "@/lib/wallet/invite";
import { browserStorage } from "@/lib/wallet/session";
import { browserApiOrigin } from "@/services/constants";
import { requestJson } from "@/services/protocol-api-service";
import { clearWalletStores } from "@/stores/createResourceStore";

type WalletController = ReturnType<typeof createWalletController>;
type WalletValue = WalletState &
  Pick<
    WalletController,
    | "connect"
    | "disconnect"
    | "ensureNetwork"
    | "invalidateSession"
    | "refreshSession"
    | "sendTransaction"
  > & {
    /** Signs in (or reuses the session), joining with an invite link's code when one is kept. */
    authenticate(): Promise<string>;
    /** Joins with `code`, signing in first when needed: one signature. */
    joinWithInvite(code: string): Promise<string>;
    /** The code of the invite link this browser opened, until it is used. */
    invite: string | null;
  };
const Context = createContext<WalletValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() =>
    createWalletController({
      deployment: protocolConfig,
      sources: walletSources,
      storage: browserStorage,
      origin: () => window.location.origin,
      api: browserApiOrigin,
      waitForReceipt,
      request: requestJson,
      clearCache: clearWalletStores,
    }),
  );
  const [invite, setInvite] = useState<string | null>(null);
  const authenticate = useCallback(() => controller.authenticate(invite), [controller, invite]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  useEffect(() => {
    setInvite(
      captureInvite(window.location, window.history, browserStorage()) ??
        pendingInvite(browserStorage()),
    );
    const stopDiscovery = discoverWallets(window);
    controller.start({ window, document });
    return () => {
      controller.stop();
      stopDiscovery();
    };
  }, [controller]);
  // A code is spent once the wallet joined, or once it was found unusable.
  useEffect(() => {
    if (invite && (state.member || state.inviteError)) {
      forgetInvite(browserStorage());
      setInvite(null);
    }
  }, [invite, state.member, state.inviteError]);
  const value = useMemo(
    () => ({
      ...state,
      invite,
      connect: controller.connect,
      disconnect: controller.disconnect,
      ensureNetwork: controller.ensureNetwork,
      authenticate,
      joinWithInvite: controller.joinWithInvite,
      invalidateSession: controller.invalidateSession,
      refreshSession: controller.refreshSession,
      sendTransaction: controller.sendTransaction,
    }),
    [state, invite, controller, authenticate],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useWallet() {
  const value = useContext(Context);
  if (!value) throw new Error("WalletProvider is required");
  return value;
}

/** The connected wallet when it may read its own data (signed in and invited), else null. */
export function useMemberAccount() {
  const { account, access } = useWallet();
  return access === "member" || access === "suspended" ? account : null;
}
