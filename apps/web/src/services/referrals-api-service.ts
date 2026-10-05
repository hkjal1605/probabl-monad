import type { MemberView } from "@/lib/wallet/session";
import { requestJson } from "./api";

/** An amount of one token, raw units. */
export interface TokenAmountView {
  token: string;
  symbol: string | null;
  decimals: number | null;
  amount: string;
}
export interface InviteCodeView {
  code: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number;
  uses: number;
  note: string | null;
  status: "available" | "used" | "revoked" | "expired";
  members: { wallet: string; joinedAt: string }[];
}
export interface MyInvites {
  member: MemberView;
  quota: number;
  created: number;
  remaining: number;
  codes: InviteCodeView[];
}
/** pending: the market is open, rewards are claims; unlocking: resolved, claimable from
 * `unlockAt` (Monday 00:00 UTC); claimable; lapsed: the claims lost. */
export type RewardStatus = "pending" | "unlocking" | "claimable" | "lapsed";
export interface RewardMarketView {
  marketId: string;
  venueId: string;
  cutoff: string;
  resolvedAt: string | null;
  unlockAt: number | null;
  status: RewardStatus;
  /** The market's YES probability (x1e6) for estimating claims, while it is open. */
  probabilityYesX6: string | null;
  /** Claims per side (branch 0 YES, 1 NO) and collateral (0 quote, 1 the stock token). */
  accrued: (TokenAmountView & { branch: number; collateral: number })[];
  realized: TokenAmountView[] | null;
}
export interface PayoutView extends TokenAmountView {
  id: string;
  status: "sent" | "paid" | "failed";
  transactionHash: string;
  createdAt: string;
}
export interface ReferralDashboard {
  program: { shareBps: number; months: number };
  now: number;
  claimsEnabled: boolean;
  nextUnlockAt: number | null;
  referees: { wallet: string; joinedAt: string; earningUntil: string; fills: number }[];
  markets: RewardMarketView[];
  totals: {
    claimable: TokenAmountView[];
    unlocking: (TokenAmountView & { unlockAt: number })[];
    paid: TokenAmountView[];
  };
  payouts: PayoutView[];
}
export interface ClaimResult {
  payouts: { token: string; amount: string; transactionHash: string; status: string }[];
  unavailable: TokenAmountView[];
}

/** The signed-in member's invites and referral rewards (owner-checked by the API). */
export const referralsApi = {
  invites: (owner: string, signal?: AbortSignal) =>
    requestJson<MyInvites>(`/v1/me/invites?owner=${encodeURIComponent(owner)}`, {
      auth: true,
      ...(signal ? { signal } : {}),
    }),
  createInvite: () => requestJson<{ code: string }>("/v1/me/invites", { body: {}, auth: true }),
  dashboard: (owner: string, signal?: AbortSignal) =>
    requestJson<ReferralDashboard>(`/v1/me/referrals?owner=${encodeURIComponent(owner)}`, {
      auth: true,
      ...(signal ? { signal } : {}),
    }),
  claim: () =>
    requestJson<ClaimResult>("/v1/me/referrals/claim", {
      body: {},
      auth: true,
      timeoutMs: 120_000,
    }),
};
