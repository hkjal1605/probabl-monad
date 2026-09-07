import { Badge } from "@conditional-stocks/ui-kit/badge";
import { CircleAlert, CircleCheck, CircleDashed, LockKeyhole, Radio } from "lucide-react";
import type { DataQuality, MarketLifecycle, MarketView } from "@/lib/api/types";

export function LifecycleBadge({ state }: { state: MarketLifecycle }) {
  if (state === "open")
    return (
      <Badge variant="positive">
        <Radio aria-hidden="true" />
        Open
      </Badge>
    );
  if (state === "redeemable")
    return (
      <Badge variant="brand">
        <CircleCheck aria-hidden="true" />
        Redeemable
      </Badge>
    );
  if (state === "frozen" || state === "awaiting-resolution")
    return (
      <Badge variant="warning">
        <LockKeyhole aria-hidden="true" />
        {state === "frozen" ? "Frozen" : "Manual review"}
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <CircleDashed aria-hidden="true" />
      {state.replace("-", " ")}
    </Badge>
  );
}

export function QualityBadge({
  quality,
  sourceMode = "live",
}: {
  quality: DataQuality;
  sourceMode?: MarketView["sourceMode"];
}) {
  if (sourceMode === "preview" || sourceMode === "demo") {
    return (
      <Badge variant={quality === "valid" ? "outline" : "warning"}>
        <CircleDashed />
        {sourceMode === "demo" ? "Simulated" : "Preview"}
        {quality === "valid" ? " data" : ` · ${quality.replace("-", " ")}`}
      </Badge>
    );
  }
  return quality === "valid" ? (
    <Badge variant="positive">
      <CircleCheck />
      Live source
    </Badge>
  ) : (
    <Badge variant={quality === "low-depth" ? "warning" : "destructive"}>
      <CircleAlert />
      {quality.replace("-", " ")}
    </Badge>
  );
}
