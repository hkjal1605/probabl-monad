"use client";

import { formatTokenAmount } from "@conditional-stocks/domain";
import { revokeDelegate } from "@conditional-stocks/evm-client";
import { useState } from "react";
import { useWallet } from "@/components/providers/WalletProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { protocolConfig } from "@/config/protocol";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import {
  announceTradingPermissionChange,
  useTradingPermission,
} from "@/hooks/useTradingPermission";
import { shortAddress } from "@/lib/format/display";
import {
  DEFAULT_MAX_ORDER_QUOTE,
  DEFAULT_MAX_ORDER_SHARES,
  DEFAULT_TOTAL_QUOTE,
  DEFAULT_TOTAL_SHARES,
  tradingPermissionApproval,
} from "@/lib/trading/permission";

export function TradingPermissionCard() {
  const wallet = useWallet();
  const { permission, loaded, error, refresh } = useTradingPermission();
  const [open, setOpen] = useState(false),
    [perOrder, setPerOrder] = useState(DEFAULT_MAX_ORDER_QUOTE),
    [total, setTotal] = useState(DEFAULT_TOTAL_QUOTE),
    [perOrderShares, setPerOrderShares] = useState(DEFAULT_MAX_ORDER_SHARES),
    [totalShares, setTotalShares] = useState(DEFAULT_TOTAL_SHARES);
  const { busy, run } = useAsyncAction(
    [wallet.account, permission?.delegate, perOrder, total, perOrderShares, totalShares].join(":"),
  );
  const grant = permission?.grant;
  const unavailable =
    !permission?.available ||
    !permission.delegate ||
    permission.quoteDecimals === null ||
    permission.baseDecimals === null;
  const exhausted = Boolean(grant && !permission?.active);
  const update = async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const value = await refresh();
      if (value?.active || value?.grant?.revoked) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    announceTradingPermissionChange();
  };
  const approve = () =>
    run(async (assertCurrent) => {
      if (
        !wallet.account ||
        !permission?.delegate ||
        permission.quoteDecimals === null ||
        !permission.available ||
        permission.active
      )
        throw new Error("Trading approval is not available");
      await wallet.ensureNetwork();
      assertCurrent();
      const transaction = tradingPermissionApproval({
        owner: wallet.account,
        permission,
        perOrder,
        total,
        perOrderShares,
        totalShares,
      });
      assertCurrent();
      const hash = await wallet.sendTransaction(transaction);
      setOpen(false);
      toast.add({ type: "success", title: `Trading permission confirmed · ${hash.slice(0, 10)}…` });
      void update();
    });
  const revoke = () =>
    run(async (assertCurrent) => {
      if (!wallet.account || !permission?.delegate || !grant || grant.revoked)
        throw new Error("No active trading permission to revoke");
      await wallet.ensureNetwork();
      assertCurrent();
      const hash = await wallet.sendTransaction(
        revokeDelegate(protocolConfig.exchange, permission.delegate as `0x${string}`),
      );
      toast.add({ type: "success", title: `Trading permission revoked · ${hash.slice(0, 10)}…` });
      void update();
    });
  return (
    <Card className="rounded-xl bg-card">
      <CardHeader>
        <CardTitle>Trading permission</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!loaded && (
          <p className="text-sm font-medium text-muted-foreground">Checking permission…</p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loaded && !error && (
          <>
            <p className="text-sm font-medium text-muted-foreground">
              {permission?.active
                ? "Orders can use deposited funds without another wallet approval."
                : unavailable
                  ? "Trading permission is not configured for this deployment."
                  : exhausted
                    ? "This approval is expired, revoked or its lifetime limit is used. Approve again to replace it."
                    : "Approve a dedicated trading key once to place orders from your deposited balances."}
            </p>
            {permission?.delegate && (
              <p className="text-xs font-medium text-muted-foreground">
                Trading key:{" "}
                <span className="font-mono text-foreground">
                  {shortAddress(permission.delegate)}
                </span>
              </p>
            )}
            {grant && permission && permission.quoteDecimals !== null && (
              <>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="font-medium text-muted-foreground">Remaining lifetime limit</dt>
                    <dd className="tabular-nums">
                      {formatTokenAmount(BigInt(grant.remainingQuote), permission.quoteDecimals)}{" "}
                      USDC
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">Per order</dt>
                    <dd className="tabular-nums">
                      {formatTokenAmount(BigInt(grant.maxOrderQuote), permission.quoteDecimals)}{" "}
                      USDC
                    </dd>
                  </div>
                  {permission.baseDecimals !== null && (
                    <>
                      <div>
                        <dt className="font-medium text-muted-foreground">Remaining share limit</dt>
                        <dd className="tabular-nums">
                          {formatTokenAmount(BigInt(grant.remainingBase), permission.baseDecimals)}{" "}
                          shares
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-muted-foreground">Shares per sell</dt>
                        <dd className="tabular-nums">
                          {formatTokenAmount(BigInt(grant.maxOrderBase), permission.baseDecimals)}{" "}
                          shares
                        </dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt className="font-medium text-muted-foreground">Expires</dt>
                    <dd>{new Date(Number(grant.expiresAt) * 1000).toLocaleDateString()}</dd>
                  </div>
                </dl>
                {!grant.revoked && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={revoke}>
                    {busy ? <Spinner /> : "Revoke permission"}
                  </Button>
                )}
              </>
            )}
            {!permission?.active && !unavailable && (
              <Button disabled={busy} onClick={() => setOpen(true)}>
                {grant ? "Approve again" : "Enable trading"}
              </Button>
            )}
            {exhausted && (
              <p className="text-xs font-medium text-muted-foreground">
                A new approval replaces this one. Orders placed under the old approval stop filling;
                cancel them to release their reservations.
              </p>
            )}
          </>
        )}
      </CardContent>
      <Dialog
        open={open}
        onOpenChange={(value, details) => {
          if (busy) details.cancel();
          else setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve trading</DialogTitle>
            <DialogDescription>
              Let the protocol trading key place orders across your markets for up to 90 days. It
              pays network fees and cannot withdraw your vault funds. Each market sets its own
              trading fees, up to the protocol maximum of 10%, and every order is capped at its
              market's displayed fee. Buys count against the USDC limits and sells against the share
              limits, whatever their price. Limits are charged when orders are placed and are not
              restored by cancelling them.
            </DialogDescription>
          </DialogHeader>
          <FieldSet disabled={busy}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="trading-order-limit">Maximum per order (USDC)</FieldLabel>
                <Input
                  id="trading-order-limit"
                  value={perOrder}
                  inputMode="decimal"
                  onChange={(event) => setPerOrder(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="trading-total-limit">
                  Total lifetime order limit (USDC)
                </FieldLabel>
                <Input
                  id="trading-total-limit"
                  value={total}
                  inputMode="decimal"
                  onChange={(event) => setTotal(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="trading-share-order-limit">Maximum shares per sell</FieldLabel>
                <Input
                  id="trading-share-order-limit"
                  value={perOrderShares}
                  inputMode="decimal"
                  onChange={(event) => setPerOrderShares(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="trading-share-total-limit">
                  Total lifetime share limit
                </FieldLabel>
                <Input
                  id="trading-share-total-limit"
                  value={totalShares}
                  inputMode="decimal"
                  onChange={(event) => setTotalShares(event.target.value)}
                />
                <FieldDescription>
                  You can revoke this permission at any time. Existing orders remain until
                  cancelled.
                </FieldDescription>
              </Field>
            </FieldGroup>
          </FieldSet>
          <Button
            disabled={busy || !perOrder || !total || !perOrderShares || !totalShares}
            onClick={approve}
          >
            {busy ? <Spinner /> : "Approve in wallet"}
          </Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
