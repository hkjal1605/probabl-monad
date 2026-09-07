export const MODE_COOKIE = "probabl-mode";
export type AppMode = "live" | "demo";
export const parseMode = (value: string | undefined): AppMode =>
  value === "demo" ? "demo" : "live";
