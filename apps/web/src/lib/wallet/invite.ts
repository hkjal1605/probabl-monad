import { normalizeInviteCode } from "@conditional-stocks/shared/invites";
import type { SessionStorage } from "./session";

/** An invite link's code (`?invite=CODE`), kept until the visitor signs in with it. */
const INVITE_STORAGE_KEY = "probabl:ui:invite:v1";
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function pendingInvite(storage: SessionStorage | null, now = Date.now()): string | null {
  try {
    const value = JSON.parse(storage?.getItem(INVITE_STORAGE_KEY) ?? "null") as {
      code?: unknown;
      until?: unknown;
    } | null;
    if (typeof value?.until !== "number" || value.until <= now) return null;
    return normalizeInviteCode(value.code);
  } catch {
    return null;
  }
}
export function rememberInvite(storage: SessionStorage | null, code: string, now = Date.now()) {
  try {
    storage?.setItem(INVITE_STORAGE_KEY, JSON.stringify({ code, until: now + INVITE_TTL_MS }));
  } catch {
    /* The code stays in the address bar for this visit. */
  }
}
export function forgetInvite(storage: SessionStorage | null) {
  try {
    storage?.removeItem(INVITE_STORAGE_KEY);
  } catch {
    /* Nothing to forget. */
  }
}
/** Keeps an invite link's code and takes it out of the address bar (it stays out of shared
 * screenshots and bookmarks). Returns the code. */
export function captureInvite(
  location: Pick<Location, "href">,
  history: Pick<History, "replaceState" | "state"> | null,
  storage: SessionStorage | null,
): string | null {
  const url = new URL(location.href);
  const raw = url.searchParams.get("invite");
  if (raw === null) return null;
  const code = normalizeInviteCode(raw);
  if (code) rememberInvite(storage, code);
  url.searchParams.delete("invite");
  history?.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return code;
}
