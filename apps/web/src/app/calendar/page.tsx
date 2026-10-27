import type { Metadata } from "next";
import { CALENDAR_TAB } from "@/lib/markets/categories";
import { MarketsPageModule } from "@/modules/MarketsPageModule";

export const metadata: Metadata = {
  title: "Event calendar",
  description: "Every scheduled catalyst a market resolves on, and the stocks it moves.",
};
export default function EventCalendarPage() {
  return <MarketsPageModule category={CALENDAR_TAB} />;
}
