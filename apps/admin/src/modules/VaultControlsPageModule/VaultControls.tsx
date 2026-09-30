"use client";

import { formatTokenAmount, parseTokenAmount } from "@conditional-stocks/domain";
import {
  type DeltaVaultRisk,
  deltaVaultAddMarket,
  deltaVaultCancelAll,
  deltaVaultGrantRole,
  deltaVaultPause,
  deltaVaultRemoveMarket,
  deltaVaultRevokeRole,
  deltaVaultSetCaps,
  deltaVaultSetLimits,
  deltaVaultSetRisk,
  deltaVaultSetWithdrawLimit,
  deltaVaultUnpause,
  marketNumber,
} from "@conditional-stocks/evm-client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type Address, getAddress } from "viem";
import { QueryStatus } from "@/components/data/QueryStatus";
import { useAdmin } from "@/components/providers/AdminProvider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminConfig } from "@/config/protocol";
import {
  limitsFromForm,
  readVaultConsole,
  riskFromForm,
  type VaultConsole,
  type VaultRoles,
  vaultRoles,
} from "@/lib/delta-vaults";
import { short } from "@/lib/format";
import { VaultAction } from "./VaultAction";

export function VaultControls() {
  if (!adminConfig.deltaVaults.length)
    return (
      <p className="text-sm text-muted-foreground">
        No vaults are configured. Set NEXT_PUBLIC_DELTA_VAULTS to the vault addresses.
      </p>
    );
  return (
    <div className="flex flex-col gap-6">
      {adminConfig.deltaVaults.map((vault) => (
        <VaultPanel key={vault} vault={vault} />
      ))}
    </div>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function VaultPanel({ vault }: { vault: Address }) {
  const admin = useAdmin();
  const query = useQuery({
    queryKey: ["delta-vaults", vault],
    queryFn: () => readVaultConsole(vault),
    refetchInterval: 10_000,
  });
  const roles = useQuery({
    queryKey: ["delta-vaults", vault, "roles", admin.account],
    queryFn: () => vaultRoles(vault, admin.account!),
    enabled: !!admin.account,
  });
  if (!query.data) return <QueryStatus query={query} />;
  const held: VaultRoles = roles.data ?? {
    admin: false,
    curator: false,
    keeper: false,
    guardian: false,
  };
  const { state, quote, base } = query.data;
  const q = (raw: bigint) => `${formatTokenAmount(raw, quote.decimals)} ${quote.symbol ?? ""}`;
  const b = (raw: bigint) => `${formatTokenAmount(raw, base.decimals)} ${base.symbol ?? ""}`;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>
          {state.name} · <span className="font-mono text-sm">{short(state.address)}</span>
        </CardTitle>
        <Badge variant={state.paused ? "destructive" : "secondary"}>
          {state.paused ? "Paused" : "Active"}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Setting label="Supply" value={formatTokenAmount(state.totalSupply, 18)} />
          <Setting label="Plain quote" value={q(state.holdings.quote)} />
          <Setting label="Plain stock" value={b(state.holdings.base)} />
          <Setting
            label="Oracle price"
            value={state.oraclePrice === null ? "Unavailable" : state.oraclePrice.toString()}
          />
          <Setting label="Quote cap" value={q(state.caps.quote)} />
          <Setting label="Stock cap" value={b(state.caps.base)} />
          <Setting label="Withdrawals / day" value={`${state.withdrawLimitBps / 100}%`} />
          <Setting
            label="Order lifetime · oracle age · fee cap"
            value={`${state.limits.maxTtl}s · ${state.limits.maxOracleAge}s · ${state.limits.maxFeeBps}bps`}
          />
          <Setting label="Vault admin" value={short(state.admin)} />
          <Setting
            label="Your roles"
            value={
              (Object.entries(held) as [keyof VaultRoles, boolean][])
                .filter(([, has]) => has)
                .map(([role]) => role)
                .join(", ") || "none"
            }
          />
        </div>
        <Guardian vault={vault} held={held} paused={state.paused} />
        <Markets console={query.data} held={held} />
        <AdminSettings console={query.data} held={held} />
      </CardContent>
    </Card>
  );
}

function Guardian({ vault, held, paused }: { vault: Address; held: VaultRoles; paused: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Emergency</h3>
      <div className="flex flex-wrap gap-3">
        {paused ? (
          <VaultAction
            label="Unpause"
            requires="admin"
            allowed={held.admin}
            build={() => deltaVaultUnpause(vault)}
          />
        ) : (
          <VaultAction
            label="Pause deposits and quoting"
            requires="guardian"
            variant="destructive"
            allowed={held.guardian}
            build={() => deltaVaultPause(vault)}
          />
        )}
        <VaultAction
          label="Cancel every quote"
          requires="keeper or guardian"
          allowed={held.guardian || held.keeper}
          build={() => deltaVaultCancelAll(vault)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Pausing makes every resting vault quote unfillable at once. Withdrawals stay open.
      </p>
    </section>
  );
}

const riskForm = (risk: DeltaVaultRisk | undefined, v: VaultConsole) => ({
  bandPercent: risk ? String(risk.bandBps / 100) : "10",
  cutoffBufferMinutes: risk ? String(risk.cutoffBuffer / 60) : "60",
  maxOrder: risk ? formatTokenAmount(risk.maxOrder, v.quote.decimals) : "5000",
  maxResting: risk ? formatTokenAmount(risk.maxResting, v.quote.decimals) : "50000",
  maxImbalance: risk ? formatTokenAmount(risk.maxImbalance, v.base.decimals) : "100",
});

function RiskFields({
  prefix,
  form,
  setForm,
}: {
  prefix: string;
  form: ReturnType<typeof riskForm>;
  setForm: (form: ReturnType<typeof riskForm>) => void;
}) {
  const fields: [keyof typeof form, string][] = [
    ["bandPercent", "Price band (% of oracle)"],
    ["cutoffBufferMinutes", "Stop before cutoff (min)"],
    ["maxOrder", "Max order (quote)"],
    ["maxResting", "Max resting (quote)"],
    ["maxImbalance", "Max YES−NO stock"],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {fields.map(([key, label]) => (
        <TextField
          key={key}
          id={`${prefix}-${key}`}
          label={label}
          value={form[key]}
          onChange={(value) => setForm({ ...form, [key]: value })}
        />
      ))}
    </div>
  );
}

function Markets({ console: v, held }: { console: VaultConsole; held: VaultRoles }) {
  const [market, setMarket] = useState("");
  const [form, setForm] = useState(() => riskForm(undefined, v));
  const decimals = { quote: v.quote.decimals, base: v.base.decimals };
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-medium">Markets (curator)</h3>
      {v.state.markets.map((m) => (
        <MarketRow key={m.market} console={v} market={m} held={held} />
      ))}
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <TextField id="add-market" label="On-chain market id" value={market} onChange={setMarket} />
        <RiskFields prefix="add" form={form} setForm={setForm} />
        <VaultAction
          label="Add market"
          requires="curator"
          allowed={held.curator}
          build={() =>
            deltaVaultAddMarket(
              v.state.address,
              marketNumber(market.trim()),
              riskFromForm(form, decimals),
            )
          }
        />
      </div>
      <Limits console={v} held={held} />
    </section>
  );
}

function MarketRow({
  console: v,
  market: m,
  held,
}: {
  console: VaultConsole;
  market: VaultConsole["state"]["markets"][number];
  held: VaultRoles;
}) {
  const [form, setForm] = useState(() => riskForm(m.risk, v));
  const decimals = { quote: v.quote.decimals, base: v.base.decimals };
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Setting label="Market" value={String(m.market)} />
        <Setting label="YES−NO stock" value={signed(m.exposure.imbalance, v.base.decimals)} />
        <Setting
          label="Resting quotes"
          value={formatTokenAmount(m.exposure.resting, v.quote.decimals)}
        />
        <Setting label="Tracked orders" value={String(m.orders.length)} />
      </div>
      <RiskFields prefix={`risk-${m.market}`} form={form} setForm={setForm} />
      <div className="flex flex-wrap gap-3">
        <VaultAction
          label={`Set risk · market ${m.market}`}
          requires="curator"
          allowed={held.curator}
          build={() => deltaVaultSetRisk(v.state.address, m.market, riskFromForm(form, decimals))}
        />
        <VaultAction
          label={`Remove market ${m.market}`}
          requires="curator"
          allowed={held.curator}
          build={() => deltaVaultRemoveMarket(v.state.address, m.market)}
        />
      </div>
    </div>
  );
}

function Limits({ console: v, held }: { console: VaultConsole; held: VaultRoles }) {
  const [form, setForm] = useState({
    ttlMinutes: String(v.state.limits.maxTtl / 60 || 5),
    oracleAgeHours: String(v.state.limits.maxOracleAge / 3600 || 25),
    maxFeeBps: String(v.state.limits.maxFeeBps),
  });
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="grid grid-cols-3 gap-3">
        <TextField
          id="ttl"
          label="Order lifetime (min)"
          value={form.ttlMinutes}
          onChange={(ttlMinutes) => setForm({ ...form, ttlMinutes })}
        />
        <TextField
          id="oracle-age"
          label="Oracle age (h)"
          value={form.oracleAgeHours}
          onChange={(oracleAgeHours) => setForm({ ...form, oracleAgeHours })}
        />
        <TextField
          id="fee-cap"
          label="Fee cap (bps)"
          value={form.maxFeeBps}
          onChange={(maxFeeBps) => setForm({ ...form, maxFeeBps })}
        />
      </div>
      <VaultAction
        label="Set quoting limits"
        requires="curator"
        allowed={held.curator}
        build={() => deltaVaultSetLimits(v.state.address, limitsFromForm(form))}
      />
    </div>
  );
}

function AdminSettings({ console: v, held }: { console: VaultConsole; held: VaultRoles }) {
  const [caps, setCaps] = useState({
    quote: formatTokenAmount(v.state.caps.quote, v.quote.decimals),
    base: formatTokenAmount(v.state.caps.base, v.base.decimals),
  });
  const [limit, setLimit] = useState(String(v.state.withdrawLimitBps / 100));
  const [grant, setGrant] = useState({ role: "keeper", account: "" });
  const role = () => {
    if (!["curator", "keeper", "guardian"].includes(grant.role))
      throw new Error("Role must be curator, keeper or guardian");
    return grant.role as "curator" | "keeper" | "guardian";
  };
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-medium">Capacity, withdrawals and roles (vault admin)</h3>
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <div className="grid grid-cols-2 gap-3">
          <TextField
            id="quote-cap"
            label={`Quote cap (${v.quote.symbol ?? "quote"})`}
            value={caps.quote}
            onChange={(quote) => setCaps({ ...caps, quote })}
          />
          <TextField
            id="base-cap"
            label={`Stock cap (${v.base.symbol ?? "stock"})`}
            value={caps.base}
            onChange={(base) => setCaps({ ...caps, base })}
          />
        </div>
        <VaultAction
          label="Set deposit caps"
          requires="admin"
          allowed={held.admin}
          build={() =>
            deltaVaultSetCaps(
              v.state.address,
              parseWhole(caps.quote, v.quote.decimals),
              parseWhole(caps.base, v.base.decimals),
            )
          }
        />
      </div>
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <TextField
          id="withdraw-limit"
          label="Net withdrawals per day (% of supply, 10–100)"
          value={limit}
          onChange={setLimit}
        />
        <VaultAction
          label="Set withdrawal limit"
          requires="admin"
          allowed={held.admin}
          build={() => deltaVaultSetWithdrawLimit(v.state.address, Math.round(Number(limit) * 100))}
        />
      </div>
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <div className="grid grid-cols-[140px_1fr] gap-3">
          <TextField
            id="role"
            label="Role"
            value={grant.role}
            onChange={(value) => setGrant({ ...grant, role: value.trim() })}
          />
          <TextField
            id="account"
            label="Account"
            value={grant.account}
            onChange={(account) => setGrant({ ...grant, account })}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <VaultAction
            label="Grant role"
            requires="admin"
            allowed={held.admin}
            build={() =>
              deltaVaultGrantRole(v.state.address, role(), getAddress(grant.account.trim()))
            }
          />
          <VaultAction
            label="Revoke role"
            requires="admin"
            allowed={held.admin}
            build={() =>
              deltaVaultRevokeRole(v.state.address, role(), getAddress(grant.account.trim()))
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          The admin role itself moves only through the vault's delayed two-step transfer.
        </p>
      </div>
    </section>
  );
}

/** A signed raw amount in whole tokens: positive is long stock-if-YES. */
const signed = (raw: bigint, decimals: number) =>
  `${raw < 0n ? "−" : raw > 0n ? "+" : ""}${formatTokenAmount(raw < 0n ? -raw : raw, decimals)}`;

const parseWhole = (value: string, decimals: number) =>
  parseTokenAmount(value.trim().replaceAll(",", ""), decimals);
