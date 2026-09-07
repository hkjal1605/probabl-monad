import "server-only";
import { cookies } from "next/headers";
import { MODE_COOKIE, parseMode } from "./mode";

export const appMode = async () => parseMode((await cookies()).get(MODE_COOKIE)?.value);
export const isDemoMode = async () => (await appMode()) === "demo";
