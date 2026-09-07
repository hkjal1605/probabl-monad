"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refresh canonical books/lifecycle without discarding the user's in-progress order form. */
export function RefreshMarket() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5_000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
