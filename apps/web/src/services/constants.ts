import { API_ORIGIN } from "@conditional-stocks/shared/endpoints";

const configured = new URL(process.env.NEXT_PUBLIC_API_URL ?? API_ORIGIN);
if (
  (configured.protocol !== "https:" &&
    !(
      configured.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname)
    )) ||
  configured.username ||
  configured.password ||
  configured.pathname !== "/" ||
  configured.search ||
  configured.hash
)
  throw new Error("NEXT_PUBLIC_API_URL must be an HTTPS API origin (localhost HTTP is allowed).");
export const API_URL = configured.origin;
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
/** Local development reaches the API on the page's own loopback name: the session cookie stays
 * same-site whether the app was opened as localhost or 127.0.0.1. */
export const browserApiOrigin = () => {
  if (typeof window === "undefined" || !LOOPBACK.includes(configured.hostname)) return API_URL;
  const page = window.location.hostname;
  if (!LOOPBACK.includes(page) || page === configured.hostname) return API_URL;
  const local = new URL(API_URL);
  local.hostname = page;
  return local.origin;
};
export const apiUrl = (path: string) => {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    throw new Error("Invalid API path");
  const origin = browserApiOrigin();
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error("Foreign API origin");
  return url.toString();
};
