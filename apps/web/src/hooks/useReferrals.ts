"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMemberAccount } from "@/components/providers/WalletProvider";
import {
  type MyInvites,
  type ReferralDashboard,
  referralsApi,
} from "@/services/referrals-api-service";

/** The member's invite codes and referral rewards. They change when trades finalize and markets
 * resolve, so they are read on open, every minute while the page is visible, and after actions. */
export function useReferrals() {
  const owner = useMemberAccount();
  const [data, setData] = useState<{
    owner: string;
    invites: MyInvites;
    dashboard: ReferralDashboard;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const load = useCallback(async () => {
    if (!owner) return;
    const request = ++latest.current;
    setLoading(true);
    try {
      const [invites, dashboard] = await Promise.all([
        referralsApi.invites(owner),
        referralsApi.dashboard(owner),
      ]);
      if (request !== latest.current) return;
      setData({ owner, invites, dashboard });
      setError(null);
    } catch (cause) {
      if (request === latest.current)
        setError(cause instanceof Error ? cause.message : "Rewards are unavailable right now.");
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [owner]);
  useEffect(() => {
    if (!owner) return;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    return () => {
      latest.current++;
      clearInterval(timer);
    };
  }, [owner, load]);
  const current = data?.owner === owner ? data : null;
  return {
    invites: current?.invites ?? null,
    dashboard: current?.dashboard ?? null,
    error,
    loading: loading || (owner !== null && current === null && error === null),
    refresh: load,
  };
}
