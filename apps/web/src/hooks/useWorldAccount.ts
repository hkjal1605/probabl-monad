"use client";
/** A wallet's world account: what it needs before a world trade (the account step, one-tap
 * trading, funds on the world books) and the actions that get it there. One shared copy per page
 * (`WorldAccountProvider`). */
export {
  useWorldAccount,
  useWorldAccountBusy,
  useWorldPositions,
  type WorldAccount,
} from "@/components/providers/WorldAccountProvider";
