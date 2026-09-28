"use client";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { availableWallets, walletSources } from "@/lib/wallet/injected";
import type { WalletKind } from "@/lib/wallet/session";

const Context = createContext<(() => void) | null>(null);

/** One wallet chooser for every "Login" / "Connect" entry point. */
export function WalletLoginProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [choices, setChoices] = useState<
    { kind: WalletKind; name: string; icon: string | null }[] | null
  >(null);
  const connect = useCallback(
    (kind?: WalletKind) => {
      setChoices(null);
      void wallet.connect(kind).catch((cause) =>
        toast.add({
          type: "error",
          title: cause instanceof Error ? cause.message : "Wallet connection failed",
        }),
      );
    },
    [wallet.connect],
  );
  const login = useCallback(() => {
    const found = availableWallets(walletSources()).map(({ kind, name, icon }) => ({
      kind,
      name,
      icon,
    }));
    // With one (or no) wallet there is nothing to choose; connecting surfaces
    // the wallet itself or the "install a wallet" error.
    if (found.length <= 1) connect(found[0]?.kind);
    else setChoices(found);
  }, [connect]);
  return (
    <Context.Provider value={login}>
      {children}
      <Dialog open={choices !== null} onOpenChange={(open) => !open && setChoices(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Login</DialogTitle>
            <DialogDescription>Choose a wallet to connect.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {choices?.map((choice) => (
              <Button
                key={choice.kind}
                variant="outline"
                className="justify-start"
                onClick={() => connect(choice.kind)}
              >
                {choice.icon && <img src={choice.icon} alt="" className="size-5 rounded" />}
                {choice.name}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}

/** Opens the wallet chooser (or connects directly when only one wallet exists). */
export function useWalletLogin() {
  const login = useContext(Context);
  if (!login) throw new Error("WalletLoginProvider is required");
  return login;
}
