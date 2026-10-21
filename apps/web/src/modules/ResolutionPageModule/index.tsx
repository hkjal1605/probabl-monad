import { Suspense } from "react";
import { ResolutionClient } from "./components/ResolutionClient";
// The selected market (`?market=`) is read in the browser, so the page itself is static.
export function ResolutionPageModule() {
  return (
    <Suspense>
      <ResolutionClient markets={[]} />
    </Suspense>
  );
}
