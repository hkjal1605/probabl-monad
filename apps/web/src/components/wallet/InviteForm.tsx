"use client";
import { formatInviteCode, normalizeInviteCode } from "@conditional-stocks/shared/invites";
import { type FormEvent, useEffect, useState } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** An invite code field that joins (signing in first when needed: one signature). */
export function InviteForm({
  onJoined,
  autoFocus,
}: {
  onJoined?: () => void;
  autoFocus?: boolean;
}) {
  const wallet = useWallet();
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  // An invite link's code fills the field.
  const { invite } = wallet;
  useEffect(() => {
    if (invite) setCode((current) => current || formatInviteCode(invite));
  }, [invite]);
  const valid = normalizeInviteCode(code) !== null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || joining) return;
    setJoining(true);
    try {
      await wallet.joinWithInvite(code);
      toast.add({ type: "success", title: "Welcome to probabl. You can trade now." });
      onJoined?.();
    } catch (error) {
      toast.add({ type: "error", title: message(error, "That invite code did not work") });
    } finally {
      setJoining(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2">
      <div className="flex gap-2">
        <Input
          aria-label="Invite code"
          placeholder="XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          maxLength={12}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          className="font-mono tracking-widest uppercase"
        />
        <Button type="submit" disabled={!valid || joining || wallet.status === "signing"}>
          {joining && <Spinner data-icon="inline-start" />}
          Join
        </Button>
      </div>
      {wallet.inviteError && (
        <p role="alert" className="text-left text-xs font-medium text-destructive">
          {wallet.inviteError}
        </p>
      )}
    </form>
  );
}
