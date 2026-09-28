"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "@/components/providers/AdminProvider";
import { Button } from "@/components/ui/button";
import { type AdminPreview, adminRequest, type EvidenceView } from "@/lib/admin-api";
import { readDeployment } from "@/lib/chain";
import { packetTokens, verifyAdminPreview } from "@/lib/transactions";

export function ExecuteEvidence({
  packet,
  preview,
  onDone,
}: {
  packet: EvidenceView;
  preview: AdminPreview;
  onDone: () => void;
}) {
  const admin = useAdmin(),
    cache = useQueryClient();
  const [busy, setBusy] = useState(false),
    [hash, setHash] = useState<string | null>(null);
  const lock = useRef(false);
  const authority = admin.account === preview.from;
  const execute = async () => {
    if (lock.current || hash) return;
    lock.current = true;
    setBusy(true);
    const assertContext = admin.captureContext();
    try {
      // Rebuild from the approved evidence and the live deployment, and require the API's
      // current preview to be the same, immediately before signing.
      const { deployment } = await readDeployment(packetTokens(packet));
      const expected = verifyAdminPreview(packet, preview, deployment);
      const current = await adminRequest<AdminPreview>(
        admin.token ?? "",
        `admin/evidence/${packet.envelope.packetHash}/transaction`,
        {
          method: "POST",
          body: "{}",
        },
      );
      const refreshed = verifyAdminPreview(packet, current, deployment);
      assertContext();
      if (
        current.action !== preview.action ||
        JSON.stringify(expected) !== JSON.stringify(refreshed)
      )
        throw new Error("Market state changed. Refresh and review the next action before signing.");
      let submitted = "";
      for (const transaction of expected) submitted = await admin.sendTransaction(transaction);
      setHash(submitted);
      await cache.invalidateQueries({ queryKey: ["markets"] });
      onDone();
      toast.success("Transaction confirmed. Reconcile its hash below once indexed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Transaction failed");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 flex flex-col gap-3 pt-4">
      <p className="text-sm text-muted-foreground">
        This is a real onchain transaction and costs gas.{" "}
        {authority
          ? "Verify the action and evidence above before signing."
          : "Connect the required authority wallet to execute directly. Multisig execution requires a separately reviewed integration."}
      </p>
      <Button
        variant="default"
        disabled={!authority || busy || admin.signing || Boolean(hash)}
        onClick={execute}
      >
        {busy ? "Waiting for wallet / chain…" : `Sign ${preview.action.replaceAll("-", " ")}`}
      </Button>
      {hash && (
        <p role="status" className="break-all font-mono text-xs">
          Confirmed: {hash}
        </p>
      )}
    </div>
  );
}
